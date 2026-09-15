import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, World } from '../src/types.ts';
import { transfer } from '../src/economy/treasury.ts';
import { financeState } from '../src/finance/state.ts';
import {
  AUCTION_CLOSE_TICK, BOND_FACE, bidBond, chargeAuctionProxies, closeAuction, closeDueAuctions,
  dailyDebtService, debtServiceCap, faceOutstanding, holdingsOf, issueOf, livePrice, openIssue,
  portfolioValue, recordRevenueDay, visibleBids, withdrawBid,
} from '../src/finance/bonds.ts';
import { buyBond, openOffers, seizeHoldings, sellBond, transferHoldings } from '../src/finance/secondary.ts';
import {
  DEFERRALS_PER_ISSUE, currencyCoverage, deferIssue, mintLumens, offerRestructure, payCoupons, redeemMatured,
  repudiate, resolveRestructures, voteRestructure,
} from '../src/finance/debt.ts';

/** Give the city a cycle of takings, so the debt-service cap is a real number. */
function withRevenue(world: World, perDay: number): void {
  financeState(world).revenueDays = Array.from({ length: 28 }, () => perDay);
}

function bidder(world: World, wallet: number): Citizen {
  return makeCitizen(world, { wallet });
}

function auction(world: World, size = 40, coupon = 1.5): string {
  withRevenue(world, 3_000);
  const result = openIssue(world, { size, coupon, termDays: 28 });
  assert.equal(result.ok, true, result.message);
  return result.issue!.id;
}

test('an issue is bounded, whole-cycled, and capped at a fifth of the takings', () => {
  const w = makeWorld();
  withRevenue(w, 2_250);
  assert.equal(debtServiceCap(w), 450);
  assert.equal(openIssue(w, { size: 10, coupon: 1.5, termDays: 28 }).ok, false, 'too small');
  assert.equal(openIssue(w, { size: 5_000, coupon: 1.5, termDays: 28 }).ok, false, 'too large');
  assert.equal(openIssue(w, { size: 100, coupon: 0.1, termDays: 28 }).ok, false, 'coupon too thin');
  assert.equal(openIssue(w, { size: 100, coupon: 9, termDays: 28 }).ok, false, 'coupon too fat');
  assert.equal(openIssue(w, { size: 100, coupon: 1.5, termDays: 30 }).ok, false, 'not a whole cycle');
  assert.equal(openIssue(w, { size: 100, coupon: 1.5, termDays: 400 }).ok, false, 'longer than twelve cycles');

  // 400 bonds at 1.5 would be 600 ℓ a day against a cap of 450.
  const over = openIssue(w, { size: 400, coupon: 1.5, termDays: 28 });
  assert.equal(over.ok, false);
  assert.match(over.message, /four of five/);
  const overridden = openIssue(w, { size: 400, coupon: 1.5, termDays: 28, override: true });
  assert.equal(overridden.ok, true);
  assert.equal(overridden.issue!.override, true, 'the override is on the record');
});

test('bids are bounded, funded and sealed until the close', () => {
  const w = makeWorld();
  const id = auction(w);
  const a = bidder(w, 500);
  const b = bidder(w, 500);
  assert.equal(bidBond(w, a.id, 'bond_404', 100, 1).ok, false);
  assert.equal(bidBond(w, a.id, id, 0, 1).ok, false, 'a price has a floor');
  assert.equal(bidBond(w, a.id, id, 300, 1).ok, false, 'and a ceiling');
  assert.equal(bidBond(w, a.id, id, 100, 0).ok, false);
  assert.equal(bidBond(w, a.id, id, 100, 41).ok, false, 'more bonds than are offered');
  assert.equal(bidBond(w, a.id, id, 100, 10).ok, false, 'a bid you cannot pay for');
  assert.equal(bidBond(w, a.id, id, 100, 4).ok, true);
  assert.equal(bidBond(w, b.id, id, 90, 4).ok, true);
  a.standing = 'suspended';
  assert.equal(bidBond(w, a.id, id, 100, 1).ok, false, 'standing bars the book');

  assert.equal(visibleBids(w, id, a.id).length, 1, 'a bidder sees their own bid');
  assert.equal(visibleBids(w, id, null).length, 0, 'and nobody sees anybody else');
  assert.equal(withdrawBid(w, b.id, visibleBids(w, id, b.id)[0].id).ok, true);
  assert.equal(visibleBids(w, id, b.id).length, 0);
});

test('a uniform-price auction fills the book downward and everyone pays the lowest accepted price', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const rich = bidder(w, 2_000);
  const middling = bidder(w, 2_000);
  const cheap = bidder(w, 2_000);
  bidBond(w, rich.id, id, 102, 8);
  bidBond(w, middling.id, id, 95, 8);
  bidBond(w, cheap.id, id, 60, 12);   // only 4 of these 12 fit
  const supply = totalMoney(w);
  const treasury = w.treasury.balance;

  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);

  const issue = issueOf(w, id)!;
  assert.equal(issue.status, 'outstanding');
  assert.equal(issue.clearingPrice, 60, 'the lowest accepted price is the price');
  assert.equal(issue.sold, 20);
  assert.equal(issue.cover, 1.4, '28 bonds bid for 20 offered');
  assert.equal(rich.wallet, 2_000 - 8 * 60, 'an honest high bid is never punished');
  assert.equal(middling.wallet, 2_000 - 8 * 60);
  assert.equal(cheap.wallet, 2_000 - 4 * 60);
  assert.equal(w.treasury.balance, treasury + 1_200);
  assert.equal(totalMoney(w), supply, 'a bond is a claim: the auction moved lumens and made none');
  assert.equal(holdingsOf(w, rich.id)[0].qty, 8);
  assert.equal(faceOutstanding(w, issue), 20 * BOND_FACE);
  assert.equal(livePrice(w, id), 60);
});

test('an auction nobody bids at fails, and the city hears about it', () => {
  const w = makeWorld();
  const id = auction(w);
  w.day = issueOf(w, id)!.closesDay + 1;
  closeDueAuctions(w);
  assert.equal(issueOf(w, id)!.status, 'failed');
  assert.equal(dailyDebtService(w), 0);
});

test('coupons are paid pro rata, missed when the Treasury is empty, and default after two days', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const big = bidder(w, 3_000);
  const small = bidder(w, 3_000);
  bidBond(w, big.id, id, 100, 15);
  bidBond(w, small.id, id, 100, 5);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);

  assert.equal(dailyDebtService(w), 30, '20 bonds at 1.5 ℓ');
  const supply = totalMoney(w);
  const bigBefore = big.wallet;
  const smallBefore = small.wallet;
  w.day += 1;
  payCoupons(w);
  assert.equal(big.wallet - bigBefore, 23, 'three quarters of 30, rounded');
  assert.equal(small.wallet - smallBefore, 8);
  assert.equal(totalMoney(w), supply);

  // An empty Treasury misses the coupon; two missed days is a default.
  transfer(w, 'treasury', 'burn', w.treasury.balance, 'burn', 'a very bad week');
  w.day += 1;
  payCoupons(w);
  assert.equal(issueOf(w, id)!.missedDays.length, 1);
  assert.equal(issueOf(w, id)!.status, 'outstanding', 'a miss is not yet a default');
  w.day += 1;
  payCoupons(w);
  assert.equal(issueOf(w, id)!.status, 'defaulted');
  assert.equal(issueOf(w, id)!.defaultedDay, w.day);
});

test('an issue that comes to term is redeemed at face', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const holder = bidder(w, 3_000);
  bidBond(w, holder.id, id, 80, 20);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);
  const paidIn = 20 * 80;
  assert.equal(holder.wallet, 3_000 - paidIn);

  const supply = totalMoney(w);
  w.day = issueOf(w, id)!.maturesDay!;
  redeemMatured(w);
  assert.equal(issueOf(w, id)!.status, 'redeemed');
  assert.equal(holder.wallet, 3_000 - paidIn + 20 * BOND_FACE, 'face, not what they paid');
  assert.equal(totalMoney(w), supply);
  assert.equal(holdingsOf(w, holder.id).length, 0);
});

test('a deferral accrues at a quarter more, knocks the price down, and runs out after two', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const holder = bidder(w, 3_000);
  bidBond(w, holder.id, id, 100, 20);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);
  const priceBefore = livePrice(w, id);

  assert.equal(deferIssue(w, id, 3).ok, true);
  const issue = issueOf(w, id)!;
  assert.equal(issue.deferredUntilDay, w.day + 3);
  assert.ok(livePrice(w, id) <= priceBefore - 10 && livePrice(w, id) >= priceBefore - 20, 'the paper falls 10 to 20');

  const walletBefore = holder.wallet;
  w.day += 1;
  payCoupons(w);
  assert.equal(holder.wallet, walletBefore, 'a deferred coupon is not paid');
  assert.equal(issue.accrued, Math.round(30 * 1.25));

  // It resumes on the day it said it would.
  w.day = issue.deferredUntilDay!;
  payCoupons(w);
  assert.equal(holder.wallet, walletBefore + 30);

  assert.equal(deferIssue(w, id, 5).ok, true);
  assert.equal(issueOf(w, id)!.deferrals, DEFERRALS_PER_ISSUE);
  assert.match(deferIssue(w, id, 5).message, /restructure or default/);
});

test('two thirds of the face restructures the paper and binds the holdouts', () => {
  const w = makeWorld();
  const id = auction(w, 30);
  const bulk = bidder(w, 5_000);
  const holdout = bidder(w, 5_000);
  bidBond(w, bulk.id, id, 100, 21);
  bidBond(w, holdout.id, id, 100, 9);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);

  const councillor = makeCitizen(w);
  councillor.office = 'councillor';
  const stranger = makeCitizen(w);
  assert.equal(offerRestructure(w, stranger.id, id, { coupon: 1, termDays: 56, haircut: 0.2 }).ok, false);
  assert.equal(offerRestructure(w, councillor.id, id, { coupon: 1, termDays: 56, haircut: 0.2 }).ok, true);
  assert.equal(offerRestructure(w, councillor.id, id, { coupon: 1, termDays: 56, haircut: 0.2 }).ok, false, 'one offer at a time');

  assert.equal(voteRestructure(w, id, stranger.id, true).ok, false, 'you vote the face you hold');
  assert.equal(voteRestructure(w, id, holdout.id, false).ok, true);
  assert.equal(voteRestructure(w, id, bulk.id, true).ok, true);
  const supply = totalMoney(w);
  resolveRestructures(w);
  const issue = issueOf(w, id)!;
  assert.equal(issue.coupon, 1);
  assert.equal(issue.haircut, 0.2);
  assert.equal(faceOutstanding(w, issue), Math.round(30 * BOND_FACE * 0.8), 'the holdout is bound too');
  assert.equal(issue.maturesDay, w.day + 56);
  assert.equal(totalMoney(w), supply, 'a haircut moves no lumens');
});

test('a restructuring two thirds will not have is refused after three days', () => {
  const w = makeWorld();
  const id = auction(w, 30);
  const bulk = bidder(w, 5_000);
  const rest = bidder(w, 5_000);
  bidBond(w, bulk.id, id, 100, 15);
  bidBond(w, rest.id, id, 100, 15);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);
  const councillor = makeCitizen(w);
  councillor.office = 'mayor';
  offerRestructure(w, councillor.id, id, { coupon: 0.5, termDays: 336, haircut: 0.5 });
  voteRestructure(w, id, bulk.id, true);
  voteRestructure(w, id, rest.id, false);
  resolveRestructures(w);
  assert.equal(financeState(w).restructures[id].status, 'open', 'it stands while the holders think');
  w.day += 3;
  resolveRestructures(w);
  assert.equal(financeState(w).restructures[id].status, 'rejected');
  assert.equal(issueOf(w, id)!.coupon, 1.5, 'the terms are unchanged');
});

test('repudiation moves no lumens, writes every holding to zero and shuts the auction for four cycles', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const holder = bidder(w, 3_000);
  bidBond(w, holder.id, id, 100, 20);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);

  const councillor = makeCitizen(w);
  councillor.office = 'councillor';
  w.government.council = [councillor.id];
  const supply = totalMoney(w);
  const wallet = holder.wallet;
  assert.equal(repudiate(w, id, { votedFor: [councillor.id] }).ok, true);
  assert.equal(totalMoney(w), supply, 'a default moves no lumens at all');
  assert.equal(holder.wallet, wallet);
  assert.equal(holdingsOf(w, holder.id).length, 0);
  assert.equal(livePrice(w, id), 0);
  assert.ok((holder.bonds[councillor.id] ?? 0) < 0, 'the holder remembers who voted for it');
  assert.equal(financeState(w).noIssuesUntilDay, w.day + 112);
  const barred = openIssue(w, { size: 40, coupon: 1.5, termDays: 28 });
  assert.equal(barred.ok, false);
  assert.match(barred.message, /repudiated/);
  assert.equal(repudiate(w, id).ok, false, 'and only once');
});

test('the secondary market moves holdings and the trade price is the live rating', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const seller = bidder(w, 3_000);
  const buyer = bidder(w, 3_000);
  bidBond(w, seller.id, id, 100, 20);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);
  assert.equal(livePrice(w, id), 100);

  const holding = holdingsOf(w, seller.id)[0];
  assert.equal(sellBond(w, buyer.id, holding.id, 90).ok, false, 'you may only sell what you hold');
  assert.equal(sellBond(w, seller.id, holding.id, 300, 5).ok, false, 'at a price the Exchange will print');
  assert.equal(sellBond(w, seller.id, holding.id, 78, 5).ok, true);
  assert.equal(sellBond(w, seller.id, holding.id, 78, 16).ok, false, 'and only once each');
  const offer = openOffers(w)[0];
  assert.equal(buyBond(w, seller.id, offer.id).ok, false, 'not from yourself');

  const supply = totalMoney(w);
  assert.equal(buyBond(w, buyer.id, offer.id).ok, true);
  assert.equal(buyer.wallet, 3_000 - 5 * 78);
  assert.equal(holdingsOf(w, buyer.id)[0].qty, 5);
  assert.equal(holdingsOf(w, seller.id)[0].qty, 15);
  assert.equal(livePrice(w, id), 78, 'the last trade is the rating');
  assert.equal(portfolioValue(w, buyer.id), 5 * 78);
  assert.equal(totalMoney(w), supply);
});

test('holdings pass to an heir and are seized on exile', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const holder = bidder(w, 3_000);
  const heir = bidder(w, 100);
  bidBond(w, holder.id, id, 100, 20);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);

  assert.equal(transferHoldings(w, holder.id, heir.id), 20);
  assert.equal(holdingsOf(w, holder.id).length, 0);
  assert.equal(holdingsOf(w, heir.id)[0].qty, 20);
  const supply = totalMoney(w);
  assert.equal(seizeHoldings(w, heir.id), 20 * BOND_FACE);
  assert.equal(holdingsOf(w, heir.id).length, 0);
  assert.equal(totalMoney(w), supply, 'seizing a claim moves nothing by itself');
});

test('coverage reads what the city could retire, and the mint is the one creation', () => {
  const w = makeWorld();
  recordRevenueDay(w);
  const coverage = currencyCoverage(w, 0);
  assert.ok(coverage > 0);

  const supply = totalMoney(w);
  assert.equal(mintLumens(w, 0).ok, false);
  assert.equal(mintLumens(w, 5_000).ok, true);
  assert.equal(totalMoney(w), supply + 5_000);
  assert.equal(w.treasury.minted, 5_000, 'and the audit reads it back to the lumen');
  assert.equal(totalMoney(w), w.treasury.foundingSupply + w.treasury.minted - w.treasury.burned);
});

test('a councillor bidding through a proxy is caught by reading the ledger', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const councillor = makeCitizen(w, { wallet: 3_000 });
  councillor.office = 'councillor';
  w.government.council = [councillor.id];
  const proxy = bidder(w, 100);
  transfer(w, councillor.id, proxy.id, 1_000, 'gift', 'a gift, on the record');
  bidBond(w, proxy.id, id, 100, 10);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);

  const caught = chargeAuctionProxies(w, issueOf(w, id)!, [proxy.id]);
  assert.deepEqual(caught, [councillor.id]);
  assert.deepEqual(chargeAuctionProxies(w, issueOf(w, id)!, [councillor.id]), [], 'bidding in your own name is not a proxy');
});

test('an auction closes at the appointed tick and not before', () => {
  const w = makeWorld();
  const id = auction(w);
  const c = bidder(w, 3_000);
  bidBond(w, c.id, id, 100, 5);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK - 1;
  closeDueAuctions(w);
  assert.equal(issueOf(w, id)!.status, 'auction');
  w.hour = AUCTION_CLOSE_TICK;
  closeDueAuctions(w);
  assert.equal(issueOf(w, id)!.status, 'outstanding');
});

test('a winning bidder who cannot pay when the hour comes forfeits the bonds', () => {
  const w = makeWorld();
  const id = auction(w, 20);
  const broke = bidder(w, 1_000);
  const good = bidder(w, 1_000);
  bidBond(w, broke.id, id, 100, 10);
  bidBond(w, good.id, id, 100, 10);
  transfer(w, broke.id, 'treasury', broke.wallet, 'fee', 'spent it all before the close');
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  const supply = totalMoney(w);
  closeAuction(w, issueOf(w, id)!);
  assert.equal(issueOf(w, id)!.sold, 10, 'only the bids that could be paid for');
  assert.equal(holdingsOf(w, broke.id).length, 0);
  assert.equal(totalMoney(w), supply);
});

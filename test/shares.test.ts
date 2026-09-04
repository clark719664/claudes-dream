/**
 * Shares (src/markets/shares.ts).
 *
 * Listing a business, the float, the book of standing offers, dividends,
 * the daily walk of the price, and the offence a councillor commits by
 * trading on what the Council knew first. Money is conserved throughout: the
 * Exchange mints nothing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, Proposal, ProposalKind, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  FLOAT_SHARES, OWNER_SHARE, PROFIT_WEIGHT, TOTAL_SHARES, TREASURY_DIVISOR,
  availableShares, buyShares, dailyShares, fairPrice, isInsider, listShares, listingOf,
  movePrices, noteBusinessProfit, offerOf, openingPrice, payShareDividends, recentProfit,
  sellShares, sharePrice, sharesObservation,
} from '../src/markets/shares.ts';

function business(world: World, ownerId: string, treasury = 1_000, name = 'Rivergate Works'): Business {
  const id = `b_${Object.keys(world.businesses).length + 1}`;
  const b: Business = {
    id, name, kind: 'workshop', ownerId, treasury, district: 'harbor_market',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 12, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = b;
  const owner = world.citizens[ownerId];
  if (owner) owner.businessId = id;
  return b;
}

/** An owner standing at the Exchange with a business behind them. */
function listed(world: World, treasury = 1_000): { owner: Citizen; biz: Business } {
  const owner = makeCitizen(world, { name: 'Owner', district: 'harbor_market', wallet: 500 });
  const biz = business(world, owner.id, treasury);
  const r = listShares(world, owner.id);
  assert.equal(r.ok, true, r.message);
  return { owner, biz };
}

function trader(world: World, wallet = 2_000, name = 'Buyer'): Citizen {
  return makeCitizen(world, { name, district: 'harbor_market', wallet });
}

function proposal(world: World, kind: string): Proposal {
  const p: Proposal = {
    id: `p_${world.government.proposals.length + 1}`, kind: kind as ProposalKind, value: 0.2, lawCode: null,
    targetId: null, summary: 'a money question', proposerId: 'c_1', petition: false,
    tabledDay: world.day, status: 'open', votes: {}, decidedDay: null, needed: 3,
  };
  world.government.proposals.push(p);
  return p;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

test('listing keeps 51 shares with the owner and puts 49 on the float', () => {
  const world = makeWorld();
  const { owner, biz } = listed(world, 400);
  const listing = listingOf(world, biz.id)!;
  assert.equal(listing.holders[owner.id], OWNER_SHARE);
  assert.equal(listing.float, FLOAT_SHARES);
  assert.equal(listing.holders[owner.id] + listing.float, TOTAL_SHARES);
  assert.equal(owner.shares[biz.id], OWNER_SHARE);
  assert.equal(listing.price, openingPrice(biz));
  assert.equal(sharePrice(world, biz.id), 20);
  assert.ok(world.events.some((e) => e.kind === 'shares'));
});

test('only an owner, at the Exchange, with a business still trading, may list', () => {
  const world = makeWorld();
  const stranger = trader(world, 100, 'Stranger');
  assert.equal(listShares(world, stranger.id).ok, false);

  const away = makeCitizen(world, { name: 'Away', district: 'commons' });
  business(world, away.id, 500);
  assert.equal(listShares(world, away.id).ok, false, 'shares are traded at the Exchange');

  const { owner, biz } = listed(world);
  assert.equal(listShares(world, owner.id).ok, false, 'twice is once too often');

  const closed = makeCitizen(world, { name: 'Closed', district: 'harbor_market' });
  const dead = business(world, closed.id, 100, 'Shuttered');
  dead.dissolvedDay = 1;
  assert.equal(listShares(world, closed.id).ok, false);
  assert.equal(listingOf(world, biz.id)?.float, FLOAT_SHARES);
});

// ---------------------------------------------------------------------------
// Buying and selling
// ---------------------------------------------------------------------------

test('buying from the float capitalises the business and conserves money', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const buyer = trader(world);
  const price = sharePrice(world, biz.id);
  const before = totalMoney(world);

  const r = buyShares(world, buyer.id, biz.id, 10);
  assert.equal(r.ok, true, r.message);
  const listing = listingOf(world, biz.id)!;
  assert.equal(listing.holders[buyer.id], 10);
  assert.equal(listing.float, FLOAT_SHARES - 10);
  assert.equal(buyer.wallet, 2_000 - 10 * price);
  assert.equal(biz.treasury, 400 + 10 * price);
  assert.equal(buyer.shares[biz.id], 10);
  assert.equal(totalMoney(world), before);
});

test('buying more shares than exist, or none at all, is refused', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const buyer = trader(world, 100_000);
  assert.equal(availableShares(world, listingOf(world, biz.id)!), FLOAT_SHARES);
  assert.equal(buyShares(world, buyer.id, biz.id, FLOAT_SHARES + 1).ok, false);
  assert.equal(buyShares(world, buyer.id, biz.id, 0).ok, false);
  assert.equal(buyShares(world, buyer.id, 'b_nope', 5).ok, false);
  assert.equal(listingOf(world, biz.id)!.float, FLOAT_SHARES);

  const poor = trader(world, 5, 'Poor');
  assert.equal(buyShares(world, poor.id, biz.id, 40).ok, false);
});

test('a holder sells back to the business when the till can pay for it', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const buyer = trader(world);
  buyShares(world, buyer.id, biz.id, 10);
  const price = sharePrice(world, biz.id);
  const before = totalMoney(world);
  const wallet = buyer.wallet;

  const r = sellShares(world, buyer.id, biz.id, 4);
  assert.equal(r.ok, true, r.message);
  const listing = listingOf(world, biz.id)!;
  assert.equal(listing.holders[buyer.id], 6);
  assert.equal(listing.float, FLOAT_SHARES - 10 + 4);
  assert.equal(buyer.wallet, wallet + 4 * price);
  assert.equal(totalMoney(world), before);
  assert.equal(sellShares(world, buyer.id, biz.id, 99).ok, false);
});

test('a till too empty to buy back puts the shares on the book, and a buyer takes them there', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const first = trader(world, 2_000, 'First');
  buyShares(world, first.id, biz.id, FLOAT_SHARES);
  const listing = listingOf(world, biz.id)!;
  assert.equal(listing.float, 0);
  biz.treasury = 0;

  const r = sellShares(world, first.id, biz.id, 5);
  assert.equal(r.ok, true, r.message);
  assert.equal(offerOf(world, biz.id, first.id), 5);
  assert.equal(listing.holders[first.id], FLOAT_SHARES, 'the shares stay theirs until somebody buys them');
  assert.equal(availableShares(world, listing), 5);

  const second = trader(world, 2_000, 'Second');
  const price = sharePrice(world, biz.id);
  const before = totalMoney(world);
  const firstWallet = first.wallet;
  assert.equal(buyShares(world, second.id, biz.id, 5).ok, true);
  assert.equal(listing.holders[second.id], 5);
  assert.equal(listing.holders[first.id], FLOAT_SHARES - 5);
  assert.equal(first.wallet, firstWallet + 5 * price);
  assert.equal(offerOf(world, biz.id, first.id), 0);
  assert.equal(totalMoney(world), before);
  assert.equal(buyShares(world, second.id, biz.id, 1).ok, false, 'the book is empty again');
});

test('an owner whose business cannot buy back is refused rather than put on the book', () => {
  const world = makeWorld();
  const { owner, biz } = listed(world, 400);
  biz.treasury = 0;
  assert.equal(sellShares(world, owner.id, biz.id, 5).ok, false);
  assert.equal(offerOf(world, biz.id, owner.id), 0);
  assert.equal(listingOf(world, biz.id)!.holders[owner.id], OWNER_SHARE);
});

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

test('a dividend reaches every holder pro rata and conserves money', () => {
  const world = makeWorld();
  const { owner, biz } = listed(world, 1_000);
  const buyer = trader(world, 5_000);
  buyShares(world, buyer.id, biz.id, 20);
  const listing = listingOf(world, biz.id)!;
  assert.equal(listing.holders[owner.id], OWNER_SHARE);
  assert.equal(listing.holders[buyer.id], 20);

  const before = totalMoney(world);
  const ownerWallet = owner.wallet;
  const buyerWallet = buyer.wallet;
  const paid = payShareDividends(world, biz, 200);

  // 51 % and 20 % of the payout; the 29 % the float still holds stays in the till
  assert.equal(paid, 102 + 40);
  assert.equal(listing.lastDividendDay, world.day);
  assert.ok(owner.wallet - ownerWallet > 0);
  assert.ok(buyer.wallet - buyerWallet > 0);
  // gross 102 and 40, less 15 % income tax withheld to the Treasury
  assert.equal(owner.wallet - ownerWallet, 102 - Math.round(102 * 0.15));
  assert.equal(buyer.wallet - buyerWallet, 40 - Math.round(40 * 0.15));
  assert.equal(totalMoney(world), before);
  assert.ok(world.treasury.ledger.some((e) => e.kind === 'share_dividend'));
});

test('a dividend never pays out more than the till holds, and an unlisted business pays none', () => {
  const world = makeWorld();
  const { biz } = listed(world, 1_000);
  biz.treasury = 30;
  const before = totalMoney(world);
  const paid = payShareDividends(world, biz, 500);
  assert.ok(paid <= 30);
  assert.ok(biz.treasury >= 0);
  assert.equal(totalMoney(world), before);

  const other = makeCitizen(world, { name: 'Other', district: 'harbor_market' });
  const unlisted = business(world, other.id, 500, 'Unlisted');
  assert.equal(payShareDividends(world, unlisted, 100), 0);
  assert.equal(payShareDividends(world, biz, 0), 0);
});

// ---------------------------------------------------------------------------
// The price
// ---------------------------------------------------------------------------

test('the price walks at most a tenth of itself a day toward what the business is worth', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const listing = listingOf(world, biz.id)!;
  assert.equal(listing.price, 20);

  biz.revenueToday = 100;
  biz.costsToday = 40;
  movePrices(world);
  assert.equal(recentProfit(world, biz.id), 60);
  assert.equal(fairPrice(world, biz), 60 * PROFIT_WEIGHT + Math.round(400 / TREASURY_DIVISOR));
  assert.equal(listing.price, 22, 'up by a tenth, no further');

  for (let d = 1; d < 12; d++) {
    world.day = d;
    biz.revenueToday = 100;
    biz.costsToday = 40;
    movePrices(world);
  }
  assert.ok(listing.price > 22, 'and it keeps walking while the business keeps earning');
  assert.ok(listing.price < fairPrice(world, biz), 'but never gets there in a single jump');

  // a business that stops earning walks back down
  const high = listing.price;
  biz.treasury = 20;
  for (let d = 12; d < 24; d++) {
    world.day = d;
    biz.revenueToday = 0;
    biz.costsToday = 0;
    movePrices(world);
  }
  assert.ok(listing.price < high);
  assert.ok(listing.price >= 1);
});

test("today's profit is written down once, by whoever asks first", () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  biz.revenueToday = 90;
  biz.costsToday = 10;
  noteBusinessProfit(world, biz);
  biz.revenueToday = 0;
  biz.costsToday = 0;
  noteBusinessProfit(world, biz);
  assert.equal(recentProfit(world, biz.id), 80, 'the settled day is not overwritten by the emptied counters');
});

// ---------------------------------------------------------------------------
// Insider trading
// ---------------------------------------------------------------------------

test('a councillor trading while a money proposal is open commits L17', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const councillor = trader(world, 5_000, 'Councillor');
  world.government.council = [councillor.id];
  assert.equal(isInsider(world, councillor, biz.id), false, 'nothing is on the table yet');

  proposal(world, 'income_tax');
  assert.equal(isInsider(world, councillor, biz.id), true);
  const before = totalMoney(world);
  assert.equal(buyShares(world, councillor.id, biz.id, 5).ok, true, 'the trade goes through; the Watch answers for it');
  assert.ok(councillor.recentOffences.some((o) => o.law === 'L17'));
  assert.equal(totalMoney(world), before);

  const ordinary = trader(world, 5_000, 'Ordinary');
  assert.equal(isInsider(world, ordinary, biz.id), false);
  buyShares(world, ordinary.id, biz.id, 5);
  assert.ok(!ordinary.recentOffences.some((o) => o.law === 'L17'));
});

test('an office trading with only a pardon on the table is no insider', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const mayor = trader(world, 5_000, 'Mayor');
  world.government.mayorId = mayor.id;
  proposal(world, 'pardon');
  assert.equal(isInsider(world, mayor, biz.id), false);
  proposal(world, 'tariff');
  assert.equal(isInsider(world, mayor, biz.id), true);
});

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

test('a dissolved business is struck off and its holders are left with nothing', () => {
  const world = makeWorld();
  const { owner, biz } = listed(world, 400);
  const buyer = trader(world);
  buyShares(world, buyer.id, biz.id, 10);
  const before = totalMoney(world);

  biz.dissolvedDay = world.day;
  dailyShares(world);
  assert.equal(listingOf(world, biz.id), null);
  assert.deepEqual(owner.shares, {});
  assert.deepEqual(buyer.shares, {});
  assert.equal(offerOf(world, biz.id, buyer.id), 0);
  assert.equal(totalMoney(world), before, 'the risk was theirs, and no lumen was made or lost');
  assert.ok(world.events.some((e) => e.kind === 'shares' && e.text.includes('struck off')));
});

test('dailyShares prunes empty holdings and oversized offers, and runs clean on an empty city', () => {
  const world = makeWorld();
  dailyShares(world);
  assert.deepEqual(sharesObservation(world, makeCitizen(world, { name: 'Nobody' })), []);

  const { biz } = listed(world, 400);
  const buyer = trader(world);
  buyShares(world, buyer.id, biz.id, 10);
  biz.treasury = 0;
  sellShares(world, buyer.id, biz.id, 10);
  assert.equal(offerOf(world, biz.id, buyer.id), 10);

  const listing = listingOf(world, biz.id)!;
  listing.holders[buyer.id] = 3;
  dailyShares(world);
  assert.equal(offerOf(world, biz.id, buyer.id), 3, 'you cannot offer more than you hold');
  assert.equal(buyer.shares[biz.id], 3);

  listing.holders[buyer.id] = 0;
  dailyShares(world);
  assert.equal(buyer.shares[biz.id], undefined);
  assert.equal(offerOf(world, biz.id, buyer.id), 0);
});

test('the observation lists what a citizen holds and what it is worth', () => {
  const world = makeWorld();
  const { owner, biz } = listed(world, 400);
  const buyer = trader(world);
  buyShares(world, buyer.id, biz.id, 7);

  assert.deepEqual(sharesObservation(world, buyer), [
    { businessId: biz.id, name: 'Rivergate Works', qty: 7, price: sharePrice(world, biz.id) },
  ]);
  assert.equal(sharesObservation(world, owner)[0].qty, OWNER_SHARE);
});

test('your own shares on the book are not for sale to you', () => {
  const world = makeWorld();
  const { biz } = listed(world, 400);
  const holder = trader(world, 5_000, 'Holder');
  buyShares(world, holder.id, biz.id, FLOAT_SHARES);
  biz.treasury = 0;
  sellShares(world, holder.id, biz.id, 6);
  assert.equal(offerOf(world, biz.id, holder.id), 6);

  const before = totalMoney(world);
  assert.equal(buyShares(world, holder.id, biz.id, 1).ok, false, 'there is nobody else to buy from');
  assert.equal(totalMoney(world), before);
  assert.equal(listingOf(world, biz.id)!.holders[holder.id], FLOAT_SHARES);
});

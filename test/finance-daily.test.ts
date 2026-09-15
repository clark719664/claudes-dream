import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, World } from '../src/types.ts';
import { financeState } from '../src/finance/state.ts';
import { AUCTION_CLOSE_TICK, bidBond, holdingsOf, issueOf, openIssue } from '../src/finance/bonds.ts';
import { bankState, depositLumens, depositOf, seedVault, vaultBalance } from '../src/finance/bank.ts';
import { buyPolicy, offerPolicy, openLines } from '../src/finance/insurance.ts';
import { foundUnderwriter } from '../src/finance/houses.ts';
import { foundMutual, joinMutual, mutualFor, payDues, potOfMutual } from '../src/finance/mutual.ts';
import { potBalance } from '../src/finance/pot.ts';
import {
  dailyFinance, enactFinanceProposal, financeReport, inheritFinanceAssets, mostPressingIssue, observeFinance,
  seizeFinanceAssets, tickFinance,
} from '../src/finance/daily.ts';

function withRevenue(world: World, perDay: number): void {
  financeState(world).revenueDays = Array.from({ length: 28 }, () => perDay);
}

function banker(world: World): Citizen {
  const c = makeCitizen(world, { district: 'harbor_market', wallet: 2_000 });
  c.skills.commerce = 60;
  world.jobs.j_bank = {
    id: 'j_bank', role: 'banker', title: 'Banker', employer: 'city', buildingId: 'lantern_bank',
    district: 'harbor_market', skill: 'commerce', minSkill: 35, minReputation: 30, wage: 17,
    output: {}, holderId: c.id, createdDay: 0,
  };
  c.jobId = 'j_bank';
  return c;
}

test('the auction closes on the tick the timetable names', () => {
  const w = makeWorld();
  withRevenue(w, 3_000);
  const id = openIssue(w, { size: 20, coupon: 1.5, termDays: 28 }).issue!.id;
  const c = makeCitizen(w, { wallet: 3_000 });
  bidBond(w, c.id, id, 95, 20);
  w.day = issueOf(w, id)!.closesDay;
  for (let hour = 0; hour < 24; hour++) {
    w.hour = hour;
    tickFinance(w);
    if (hour < AUCTION_CLOSE_TICK) assert.equal(issueOf(w, id)!.status, 'auction');
  }
  assert.equal(issueOf(w, id)!.status, 'outstanding');
  assert.equal(issueOf(w, id)!.clearingPrice, 95);
});

test('a morning of finance leaves the audit exactly where it found it', () => {
  const w = makeWorld();
  w.hour = 10;
  withRevenue(w, 3_000);
  const bank = banker(w);
  seedVault(w);

  // A bond, a deposit, a policy and a mutual, all at once.
  const id = openIssue(w, { size: 20, coupon: 1.5, termDays: 28 }).issue!.id;
  const holder = makeCitizen(w, { wallet: 3_000 });
  bidBond(w, holder.id, id, 100, 20);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  tickFinance(w);

  const saver = makeCitizen(w, { wallet: 2_000 });
  depositLumens(w, saver.id, 1_000);
  assert.equal(foundUnderwriter(w, bank.id, 'The Quay Office').ok, true);
  offerPolicy(w, bank.id, { kind: 'home', cover: 300, premium: 3, termDays: 28 });
  buyPolicy(w, saver.id, openLines(w)[0].id);

  const founder = makeCitizen(w, { wallet: 300 });
  foundMutual(w, founder.id, 'The Ninefold', 4);
  const mutual = mutualFor(w, founder.id)!;
  for (let i = 0; i < 4; i++) joinMutual(w, mutual.id, makeCitizen(w, { wallet: 100 }).id);
  payDues(w, founder.id);

  // (The audit's own equation counts the founding supply, and these citizens
  // were built raw by the test harness; what matters is that nothing this
  // layer does moves a lumen into or out of existence.)
  const supply = totalMoney(w);
  const minted = w.treasury.minted;
  w.day += 1;
  dailyFinance(w);
  assert.equal(totalMoney(w), supply, 'nothing this layer does can move the supply');
  assert.equal(w.treasury.minted, minted);
  assert.ok(holdingsOf(w, holder.id).length === 1);
  assert.equal(potBalance(w, potOfMutual(w, mutual)!), 4);
  assert.match(financeReport(w), /Debt: .*coverage/);
});

test('the Council’s five finance proposals do what they say', () => {
  const w = makeWorld();
  w.hour = 10;
  withRevenue(w, 3_000);
  banker(w);
  seedVault(w);

  // An issue is named in lumens of face and takes the founding conventions.
  assert.equal(enactFinanceProposal(w, 'bond_issue', 100).ok, false, 'too small to be an issue');
  assert.equal(enactFinanceProposal(w, 'bond_issue', 3_000).ok, true);
  const issue = Object.values(financeState(w).issues)[0];
  assert.equal(issue.size, 30);
  assert.equal(issue.coupon, 1.5);
  assert.equal(issue.termDays, w.config.cycleDays * 4);

  // The cap: 60 000 ℓ of face at 1.5 is 900 ℓ a day against a cap of 600.
  const over = enactFinanceProposal(w, 'bond_issue', 60_000);
  assert.equal(over.ok, false);
  assert.equal(enactFinanceProposal(w, 'bond_issue', 60_000, { override: true }).ok, true);

  // A deferral takes whichever issue is furthest behind.
  const holder = makeCitizen(w, { wallet: 5_000 });
  bidBond(w, holder.id, issue.id, 100, 30);
  w.day = issue.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  tickFinance(w);
  assert.equal(mostPressingIssue(w)!.id, issue.id);
  assert.equal(enactFinanceProposal(w, 'bond_defer', 0).ok, true);
  assert.equal(issueOf(w, issue.id)!.deferrals, 1);

  assert.equal(enactFinanceProposal(w, 'reserve_ratio', 40).ok, true, 'a percentage reads as a ratio');
  assert.equal(bankState(w).reserveRatio, 0.4);
  assert.equal(enactFinanceProposal(w, 'reserve_ratio', 0.15).ok, true);
  assert.equal(bankState(w).reserveRatio, 0.15);

  const vault = vaultBalance(w);
  const supply = totalMoney(w);
  assert.equal(enactFinanceProposal(w, 'bank_rescue', 500).ok, true);
  assert.equal(vaultBalance(w), vault + 500);
  assert.equal(totalMoney(w), supply, 'a bailout moves public money; it does not make any');

  const beforeMint = totalMoney(w);
  assert.equal(enactFinanceProposal(w, 'mint', 1_000).ok, true);
  assert.equal(w.treasury.minted, 1_000);
  assert.equal(totalMoney(w), beforeMint + 1_000, 'the one creation, and the audit reads it back to the lumen');
});

test('what a citizen sees of the city’s finances', () => {
  const w = makeWorld();
  w.hour = 10;
  withRevenue(w, 3_000);
  banker(w);
  seedVault(w);
  const id = openIssue(w, { size: 20, coupon: 1.5, termDays: 28 }).issue!.id;
  const c = makeCitizen(w, { wallet: 3_000 });
  bidBond(w, c.id, id, 90, 20);

  const open = observeFinance(w, c.id);
  assert.equal(open.auctions.length, 1);
  assert.equal(open.auctions[0].bids, 1);
  assert.equal(open.holdings.length, 0);

  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  tickFinance(w);
  depositLumens(w, c.id, 100);

  const view = observeFinance(w, c.id);
  assert.equal(view.holdings.length, 1);
  assert.equal(view.holdings[0].qty, 20);
  assert.equal(view.holdings[0].price, 90);
  assert.equal(view.portfolio, 20 * 90);
  assert.equal(view.bank.yours, 100);
  assert.equal(view.debtService, 30);
  assert.equal(view.debtServiceCap, 600);
  assert.equal(view.faceOutstanding, 2_000);
  assert.ok(view.coverage > 0);
  assert.equal(view.mutual, null);
});

test('what this layer holds for a citizen is seized on exile and inherited on a sunset', () => {
  const w = makeWorld();
  w.hour = 10;
  withRevenue(w, 3_000);
  banker(w);
  seedVault(w);
  const id = openIssue(w, { size: 20, coupon: 1.5, termDays: 28 }).issue!.id;
  const holder = makeCitizen(w, { wallet: 3_000 });
  const heir = makeCitizen(w, { wallet: 100 });
  bidBond(w, holder.id, id, 100, 20);
  w.day = issueOf(w, id)!.closesDay;
  w.hour = AUCTION_CLOSE_TICK;
  tickFinance(w);
  depositLumens(w, holder.id, 500);

  const passed = inheritFinanceAssets(w, holder.id, heir.id);
  assert.equal(passed.bonds, 20);
  assert.equal(passed.deposit, 500);
  assert.equal(depositOf(w, heir.id), 500);
  assert.equal(holdingsOf(w, heir.id)[0].qty, 20);

  const supply = totalMoney(w);
  const treasury = w.treasury.balance;
  const seized = seizeFinanceAssets(w, heir.id);
  assert.equal(seized.face, 2_000);
  assert.equal(seized.lumens, 500);
  assert.equal(w.treasury.balance, treasury + 500, 'the lumens are real and move');
  assert.equal(depositOf(w, heir.id), 0);
  assert.equal(holdingsOf(w, heir.id).length, 0);
  assert.equal(totalMoney(w), supply);
});

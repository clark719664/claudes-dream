/**
 * Money conservation across the whole engine: a scenario that walks every
 * kind of lumen movement (grant, wage, purchase, sale, fine, restitution,
 * business founding/payout/bankruptcy, loan issue/repay/default, dividend,
 * salaries, seizure on exile, pardon, mint and burn) asserting after every
 * step that totalMoney(world) === foundingSupply + minted − burned.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, World } from '../src/types.ts';
import {
  auditMoneySupply, payDividend, paySalaries, transfer, withholdingPay,
} from '../src/economy/treasury.ts';
import { buyFromMarket, sellToMarket } from '../src/economy/market.ts';
import { applyForJob, createCityJobs, workShift } from '../src/economy/jobs.ts';
import { dailyBusinesses, foundBusiness, hireCitizen, hourlyBusinesses } from '../src/economy/business.ts';
import { bankOpen, dailyLoans, repayLoan, requestLoan } from '../src/economy/bank.ts';
import { dailyHousing } from '../src/economy/housing.ts';
import { createCitizen } from '../src/citizens/citizen.ts';
import { dailyJustice, fileCharge, holdCourt } from '../src/government/court.ts';
import { pardonCitizen } from '../src/government/registry.ts';

function expected(w: World): number {
  return w.treasury.foundingSupply + w.treasury.minted - w.treasury.burned;
}

/** Assert the invariant at a named step. */
function conserved(w: World, step: string): void {
  assert.equal(totalMoney(w), expected(w), `money conserved after: ${step}`);
  const audit = auditMoneySupply(w);
  assert.ok(audit.ok, `audit ok after: ${step} (${audit.supply} vs ${audit.expected})`);
}

function addJudge(w: World): Citizen {
  const j = makeCitizen(w, { office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56, wallet: 0 });
  j.personality.honesty = 1;
  w.government.judges.push(j.id);
  return j;
}

test('lumens are conserved through every kind of movement in the city', () => {
  const w = makeWorld();
  conserved(w, 'founding');

  // --- arrival grant -------------------------------------------------------
  const alice = createCitizen(w, { name: 'Alice', skills: { crafting: 40, commerce: 10 } });
  const bob = createCitizen(w, { name: 'Bob', skills: { crafting: 20 } });
  assert.equal(alice.wallet, w.config.arrivalGrant);
  assert.equal(w.treasury.totals.grant, 2 * w.config.arrivalGrant);
  conserved(w, 'arrival grants');

  // --- wage with income tax withheld -------------------------------------
  createCityJobs(w);
  w.tick = 9; w.day = 0; w.hour = 9;
  alice.district = 'foundry_row';
  const forge = Object.values(w.jobs).find((j) => j.role === 'forge_operator')!;
  assert.ok(applyForJob(w, alice.id, forge.id).ok);
  const walletBefore = alice.wallet;
  const shift = workShift(w, alice.id);
  assert.ok(shift.ok, shift.message);
  const gross = Math.max(w.government.minWage, forge.wage);
  const tax = Math.round(gross * w.government.incomeTax);
  assert.equal(alice.wallet, walletBefore + gross - tax);
  assert.equal(alice.stats.totalEarned, gross - tax);
  assert.equal(alice.stats.totalTaxPaid, tax);
  assert.equal(w.treasury.totals.income_tax, tax, 'tax on a city wage is recorded, not round-tripped');
  assert.equal(w.treasury.totals.wage, gross - tax);
  conserved(w, 'city wage');

  // --- purchase and sale --------------------------------------------------
  const price = w.market.goods.compute.price;
  const buy = buyFromMarket(w, alice.id, 'compute', 3);
  assert.ok(buy.ok, buy.message);
  assert.equal(alice.inventory.compute, 3);
  assert.equal(w.treasury.totals.purchase, Math.round(price * 3));
  assert.ok((w.treasury.totals.sales_tax ?? 0) > 0, 'sales tax was collected');
  conserved(w, 'purchase');
  const sell = sellToMarket(w, alice.id, 'compute', 1);
  assert.ok(sell.ok, sell.message);
  assert.equal(alice.inventory.compute, 2);
  conserved(w, 'sale');

  // --- fine and restitution -------------------------------------------------
  addJudge(w); addJudge(w); addJudge(w);
  const theft = fileCharge(w, {
    defendantId: alice.id, law: 'L04', evidence: 1, filedBy: 'watch', victimId: bob.id, amount: 30, description: 'took 30 from Bob',
  });
  conserved(w, 'charge filed');
  const bobBefore = bob.wallet;
  const aliceBefore = alice.wallet;
  holdCourt(w);
  assert.equal(theft.verdict, 'guilty');
  assert.ok(theft.sentence && theft.sentence.fine > 0, 'a tier-2 sentence carries a fine');
  const fine = theft.sentence!.fine;
  assert.equal(alice.wallet, aliceBefore - fine, 'the fine left the wallet');
  assert.equal(bob.wallet, bobBefore + Math.min(30, fine), 'the victim was made whole out of the fine');
  conserved(w, 'fine and restitution');

  // --- mint (test top-up) -------------------------------------------------
  assert.ok(transfer(w, 'mint', alice.id, 1000, 'mint', 'test top-up'));
  assert.equal(w.treasury.minted, 1000);
  conserved(w, 'mint');

  // --- business founding, business wage, sale, daily settlement ------------
  const founded = foundBusiness(w, alice.id, 'Glass Works', 'workshop');
  assert.ok(founded.ok, founded.message);
  const biz = w.businesses[alice.businessId!];
  assert.equal(biz.treasury, 200);
  assert.equal(w.treasury.totals.capital, 200);
  assert.equal(w.treasury.totals.fee, 100);
  conserved(w, 'business founded');

  const vacancy = biz.jobs.map((id) => w.jobs[id]).find((j) => j.holderId === null)!;
  assert.ok(hireCitizen(w, biz.id, bob.id, vacancy.id).ok);
  bob.district = biz.district;
  const bizBefore = biz.treasury;
  const bobWalletBefore = bob.wallet;
  const bizShift = workShift(w, bob.id);
  assert.ok(bizShift.ok, bizShift.message);
  assert.ok(biz.treasury < bizBefore, 'the business paid the wage (and bought energy)');
  assert.ok(bob.wallet > bobWalletBefore);
  assert.ok(biz.costsToday > 0);
  conserved(w, 'business wage');

  biz.inventory.goods += 5; // stock, not money: fine for a test
  hourlyBusinesses(w);
  assert.equal(biz.inventory.goods, 0, 'the business sold its stock to the Bazaar');
  assert.ok(biz.revenueToday > 0);
  conserved(w, 'business sale');

  transfer(w, 'mint', biz.id, 400, 'mint', 'test top-up for payout');
  const ownerBefore = alice.wallet;
  dailyBusinesses(w);
  assert.ok(alice.wallet > ownerBefore, "the owner received a payout");
  assert.ok((w.treasury.totals.rent ?? 0) > 0, 'rent was paid');
  assert.ok((w.treasury.totals.payout ?? 0) > 0);
  conserved(w, 'business daily settlement');

  // --- bankruptcy: drain the till, then three bad days ----------------------
  assert.ok(transfer(w, biz.id, 'burn', biz.treasury, 'burn', 'test drain'));
  for (let i = 0; i < 3; i++) { w.day++; w.tick += 24; dailyBusinesses(w); conserved(w, `bankruptcy day ${i + 1}`); }
  assert.notEqual(biz.dissolvedDay, null, 'the business went bankrupt after three days in the red');
  assert.equal(alice.businessId, null);
  assert.equal(bob.jobId, null, 'staff were laid off');
  assert.equal(biz.treasury, 0);
  conserved(w, 'bankruptcy');

  // --- loans: issue, repay, interest, default ------------------------------
  const banker = makeCitizen(w, { name: 'Banker', reputation: 60, wallet: 0 });
  banker.skills.commerce = 50;
  const bankJob = Object.values(w.jobs).find((j) => j.role === 'banker')!;
  assert.ok(applyForJob(w, banker.id, bankJob.id).ok);
  assert.ok(bankOpen(w));
  const loanReq = requestLoan(w, alice.id, 40);
  assert.ok(loanReq.ok, loanReq.message);
  const loan = w.loans[alice.loanId!];
  assert.equal(loan.outstanding, 40);
  conserved(w, 'loan issued');
  assert.ok(repayLoan(w, alice.id, 10).ok);
  assert.equal(loan.outstanding, 30);
  conserved(w, 'loan repaid in part');
  w.day++; w.tick += 24;
  const outstandingBefore = loan.outstanding;
  dailyLoans(w);
  assert.ok(w.loans[loan.id] === undefined || loan.outstanding < outstandingBefore + 1, 'the bank collected from the wallet');
  conserved(w, 'daily loan interest and auto-repayment');
  if (!w.loans[loan.id]) {
    // the wallet was fat enough to settle it; borrow again so a default can be exercised
    assert.equal(alice.loanId, null, 'a settled loan is closed');
    assert.ok(requestLoan(w, alice.id, 40).ok);
    conserved(w, 'second loan issued');
  }
  const live = w.loans[alice.loanId!];
  // drain the borrower so no payment can be made, then a week passes
  assert.ok(transfer(w, alice.id, 'burn', alice.wallet, 'burn', 'test drain'));
  live.lastPaymentDay = w.day - 7;
  const defaults: string[] = [];
  dailyLoans(w, (_world, borrowerId) => { defaults.push(borrowerId); });
  assert.deepEqual(defaults, [alice.id], 'the default hook fired once');
  assert.equal(live.defaulted, true);
  assert.ok(alice.reputation < 50, 'defaulting costs reputation');
  conserved(w, 'loan default');

  // --- dividend, salaries, rent -----------------------------------------------
  w.government.mayorId = banker.id;
  w.government.council = [banker.id];
  banker.office = 'mayor';
  payDividend(w);
  conserved(w, 'dividend');
  paySalaries(w);
  assert.ok(banker.stats.totalEarned > 0);
  conserved(w, 'salaries');
  dailyHousing(w);
  conserved(w, 'rent');

  // --- exile: half the wallet seized, the rest to the victim ------------------
  transfer(w, 'mint', alice.id, 300, 'mint', 'test top-up');
  const sabotage = fileCharge(w, { defendantId: alice.id, law: 'L13', evidence: 1, filedBy: 'watch', description: 'sabotage' });
  holdCourt(w);
  assert.equal(sabotage.verdict, 'guilty');
  assert.ok(sabotage.sentence?.exile, 'severity 5 means exile');
  assert.equal(alice.standing, 'good', 'exile waits for the appeal window');
  conserved(w, 'exile deferred');
  const treasuryBefore = w.treasury.balance;
  const victimBefore = bob.wallet;
  const exileWallet = alice.wallet;
  w.day++; w.tick += 24;
  dailyJustice(w);
  assert.equal(alice.standing, 'exiled');
  assert.equal(alice.wallet, 0, 'the whole wallet was seized');
  assert.equal(w.treasury.balance, treasuryBefore + Math.floor(exileWallet / 2), 'half went to the Treasury');
  assert.equal(bob.wallet, victimBefore + (exileWallet - Math.floor(exileWallet / 2)), 'the rest went to the victim');
  assert.ok(!w.order.includes(alice.id));
  assert.equal(w.bans.length, 1);
  conserved(w, 'exile seizure and restitution');

  // --- pardon leaves money alone; burn is accounted --------------------------
  assert.ok(pardonCitizen(w, alice.id).ok);
  conserved(w, 'pardon');
  assert.ok(transfer(w, 'treasury', 'burn', 500, 'burn', 'test burn'));
  assert.equal(w.treasury.burned, w.treasury.totals.burn, 'every burn is accounted');
  conserved(w, 'burn');
  assert.equal(totalMoney(w), w.config.foundingSupply + w.treasury.minted - w.treasury.burned);
});

test('withholdingPay never creates money, even when the payer is short', () => {
  const w = makeWorld();
  const worker = makeCitizen(w, { wallet: 0 });
  const boss = makeCitizen(w, { wallet: 0 });
  assert.ok(transfer(w, 'treasury', boss.id, 7, 'grant', 'seed money'));
  const paid = withholdingPay(w, boss.id, worker.id, 20, 'wage', 'short employer');
  assert.equal(paid.net + paid.tax, 7, 'paid pro rata');
  assert.equal(boss.wallet, 0);
  assert.equal(totalMoney(w), w.treasury.foundingSupply);
  const none = withholdingPay(w, boss.id, worker.id, 20, 'wage', 'broke employer');
  assert.deepEqual(none, { net: 0, tax: 0 });
  assert.equal(totalMoney(w), w.treasury.foundingSupply);
});

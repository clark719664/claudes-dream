import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Citizen, Loan, World } from '../src/types.ts';
import { avgDailyIncome, bankOpen, creditLimit, dailyLoans, repayLoan, requestLoan } from '../src/economy/bank.ts';

/** A banker at the desk, built raw so the test does not depend on jobs.ts. */
function openBank(world: World): Citizen {
  const banker = makeCitizen(world, { district: 'harbor_market' });
  world.jobs.j_bank = {
    id: 'j_bank', role: 'banker', title: 'Banker', employer: 'city', buildingId: 'lantern_bank', district: 'harbor_market',
    skill: 'commerce', minSkill: 35, minReputation: 30, wage: 17, output: {}, holderId: banker.id, createdDay: 0,
  };
  banker.jobId = 'j_bank';
  return banker;
}

function earner(world: World, totalEarned: number, wallet = 0): Citizen {
  const c = makeCitizen(world, { wallet });
  c.stats.totalEarned = totalEarned;
  return c;
}

test('bankOpen requires a banker on duty and a standing bank', () => {
  const w = makeWorld();
  assert.equal(bankOpen(w), false);
  const banker = openBank(w);
  assert.equal(bankOpen(w), true);
  banker.standing = 'suspended';
  assert.equal(bankOpen(w), false);
  banker.standing = 'good';
  w.buildings.lantern_bank.damage = 1;
  assert.equal(bankOpen(w), false);
});

test('avgDailyIncome and creditLimit', () => {
  const w = makeWorld();
  w.day = 4;
  const c = earner(w, 500);
  c.arrivedDay = 0;
  assert.equal(avgDailyIncome(w, c), 100);
  assert.equal(creditLimit(w, c), 500);
  w.treasury.balance = 2000;
  assert.equal(creditLimit(w, c), 200); // treasury/10 binds
});

test('requestLoan enforces every rule and conserves money on success', () => {
  const w = makeWorld();
  const c = earner(w, 200, 10); // avg income 200/day on day 0 → limit 1000
  assert.match(requestLoan(w, c.id, 100).message, /closed/);
  openBank(w);
  assert.equal(requestLoan(w, c.id, 0).ok, false);
  assert.equal(requestLoan(w, c.id, 1001).ok, false);
  assert.equal(requestLoan(w, 'c_404', 10).ok, false);
  const broke = earner(w, 0);
  assert.match(requestLoan(w, broke.id, 10).message, /income/);
  const prob = earner(w, 200);
  prob.standing = 'probation';
  assert.equal(requestLoan(w, prob.id, 10).ok, false);

  const before = totalMoney(w);
  const t0 = w.treasury.balance;
  const res = requestLoan(w, c.id, 400);
  assert.equal(res.ok, true, res.message);
  assert.equal(c.wallet, 410);
  assert.equal(w.treasury.balance, t0 - 400);
  assert.ok(c.loanId);
  const loan = w.loans[c.loanId];
  assert.equal(loan.principal, 400);
  assert.equal(loan.outstanding, 400);
  assert.equal(loan.ratePerDay, 0.02);
  assert.equal(loan.defaulted, false);
  assert.equal(totalMoney(w), before);
  assert.equal(requestLoan(w, c.id, 10).ok, false); // one loan at a time
  assert.ok(w.events.some((e) => e.kind === 'loan'));
});

test('repayLoan pays what the wallet allows and closes the loan at zero', () => {
  const w = makeWorld();
  openBank(w);
  const c = earner(w, 200, 0);
  requestLoan(w, c.id, 100);
  const before = totalMoney(w);
  assert.equal(repayLoan(w, c.id, 0).ok, false);
  assert.equal(repayLoan(w, c.id, 30).ok, true);
  assert.equal(c.wallet, 70);
  assert.equal(w.loans[c.loanId as string].outstanding, 70);
  c.wallet = 40;
  const partial = repayLoan(w, c.id, 500); // capped by wallet
  assert.equal(partial.ok, true);
  assert.equal(c.wallet, 0);
  assert.equal(w.loans[c.loanId as string].outstanding, 30);
  assert.equal(repayLoan(w, c.id, 10).ok, false); // nothing to pay with
  c.wallet = 30;
  assert.equal(repayLoan(w, c.id, 30).ok, true);
  assert.equal(c.loanId, null);
  assert.equal(Object.keys(w.loans).length, 0);
  assert.equal(repayLoan(w, c.id, 10).ok, false);
  assert.equal(totalMoney(w), before - 100 + 100); // conserved: wallet → treasury
});

test('dailyLoans charges interest, auto-collects a quarter of the wallet and closes settled loans', () => {
  const w = makeWorld();
  openBank(w);
  const c = earner(w, 200, 0);
  requestLoan(w, c.id, 100);
  c.wallet = 40;
  const before = totalMoney(w);
  w.day = 1;
  dailyLoans(w);
  const loan = w.loans[c.loanId as string];
  assert.equal(loan.outstanding, 92); // +2 interest, −10 collected
  assert.equal(c.wallet, 30);
  assert.equal(loan.lastPaymentDay, 1);
  assert.equal(totalMoney(w), before);

  c.wallet = 10000; // test-only windfall
  const windfall = totalMoney(w);
  w.day = 2;
  dailyLoans(w);
  assert.equal(c.loanId, null);
  assert.equal(Object.keys(w.loans).length, 0);
  assert.equal(c.wallet, 10000 - 94);
  assert.equal(totalMoney(w), windfall);
});

test('dailyLoans declares a default after seven days without payment and calls onDefault once', () => {
  const w = makeWorld();
  openBank(w);
  const c = earner(w, 200, 0);
  requestLoan(w, c.id, 100);
  c.wallet = 0;
  const defaults: { id: string; loan: Loan }[] = [];
  const onDefault = (_w: World, id: string, loan: Loan) => defaults.push({ id, loan });
  for (let day = 1; day <= 6; day++) { w.day = day; dailyLoans(w, onDefault); }
  assert.equal(defaults.length, 0);
  assert.equal(w.loans[c.loanId as string].defaulted, false);
  w.day = 7;
  dailyLoans(w, onDefault);
  assert.equal(defaults.length, 1);
  assert.equal(defaults[0].id, c.id);
  assert.equal(defaults[0].loan.defaulted, true);
  assert.equal(defaults[0].loan.outstanding, 114);
  assert.equal(c.reputation, 35);
  assert.ok(w.events.some((e) => e.kind === 'loan' && e.weight === 0.6));
  w.day = 8;
  dailyLoans(w, onDefault);
  assert.equal(defaults.length, 1); // not reported twice
  // a defaulted loan still gets repaid when money appears
  c.wallet = 1000;
  w.day = 9;
  dailyLoans(w, onDefault);
  assert.equal(c.loanId, null);
});

test('dailyLoans writes off loans of exiled or vanished borrowers', () => {
  const w = makeWorld();
  openBank(w);
  const c = earner(w, 200, 0);
  requestLoan(w, c.id, 50);
  c.standing = 'exiled';
  dailyLoans(w);
  assert.equal(c.loanId, null);
  assert.equal(Object.keys(w.loans).length, 0);
  const emigrant = earner(w, 200, 0);
  requestLoan(w, emigrant.id, 50);
  w.order = w.order.filter((id) => id !== emigrant.id);
  dailyLoans(w);
  assert.equal(emigrant.loanId, null);
  assert.ok(w.events.some((e) => e.kind === 'loan' && e.text.includes('departure')));
  const ghost = earner(w, 200, 0);
  requestLoan(w, ghost.id, 50);
  delete w.citizens[ghost.id];
  dailyLoans(w);
  assert.equal(Object.keys(w.loans).length, 0);
});

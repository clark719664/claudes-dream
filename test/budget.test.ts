import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Job, JobRole, World } from '../src/types.ts';
import { transfer } from '../src/economy/treasury.ts';
import { applyForJob, createCityJobs, dailyJobs, workShift } from '../src/economy/jobs.ts';
import {
  BUDGET_FLOOR_MIN, BUDGET_FLOOR_RATE, DRAWDOWN_RATE, FOUNDING_BUDGET_RATE, cityCanPay, cityWageBudget, cityWageBudgetLeft,
  cityWagesToday, dailyBudget, isBudgetedJob, noteCitySpend, notePieceWage, pieceWagesYesterday,
} from '../src/economy/budget.ts';

function cityJob(world: World, role: JobRole): Job {
  const job = Object.values(world.jobs).find((j) => j.employer === 'city' && j.role === role && j.holderId === null);
  if (!job) throw new Error(`no open ${role}`);
  return job;
}

test('before any rollover the founding budget is a share of the balance; spending is tracked against it', () => {
  const w = makeWorld();
  assert.equal(cityWageBudget(w), Math.round(w.treasury.balance * FOUNDING_BUDGET_RATE));
  assert.equal(cityWagesToday(w), 0);
  assert.equal(cityCanPay(w, 0), true);
  assert.equal(cityCanPay(w, Number.NaN), true);
  noteCitySpend(w, 150);
  noteCitySpend(w, -5);
  assert.equal(cityWagesToday(w), 150);
  assert.equal(cityWageBudgetLeft(w), cityWageBudget(w) - 150);
  assert.equal(cityCanPay(w, cityWageBudgetLeft(w)), true);
  assert.equal(cityCanPay(w, cityWageBudgetLeft(w) + 1), false);
});

test('dailyBudget: yesterday\'s revenue less piece wages, plus the drawdown, less today\'s fixed spend; floored', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 10_000 });
  transfer(w, c.id, 'treasury', 3000, 'rent', 'revenue');
  transfer(w, 'treasury', c.id, 500, 'dividend', 'fixed');
  notePieceWage(w, 400);
  noteCitySpend(w, 700);
  const balance = w.treasury.balance;
  dailyBudget(w);
  assert.equal(cityWageBudget(w), Math.round(3000 - 400 + balance * DRAWDOWN_RATE - 500));
  assert.equal(cityWagesToday(w), 0, 'the day starts afresh');
  assert.equal(pieceWagesYesterday(w), 400);
  assert.equal(w.counters.cityWagesYesterday, 700);
  const routine = w.events.filter((e) => e.kind === 'treasury').at(-1);
  assert.ok(routine && routine.weight <= 0.1 && /wage budget/.test(routine.text));

  // no revenue at all: the floor keeps the city open, and the cut is news
  w.treasury.revenueToday = 0;
  w.treasury.spendToday = 0;
  noteCitySpend(w, 2000);
  dailyBudget(w);
  assert.equal(cityWageBudget(w), Math.max(BUDGET_FLOOR_MIN, Math.round(w.treasury.balance * BUDGET_FLOOR_RATE)));
  const austerity = w.events.filter((e) => e.kind === 'treasury').at(-1);
  assert.ok(austerity && austerity.weight === 0.5 && /Austerity/.test(austerity.text));

  // an empty Treasury has no budget
  transfer(w, 'treasury', c.id, w.treasury.balance, 'grant', 'drain');
  w.treasury.revenueToday = 0;
  w.treasury.spendToday = 0;
  dailyBudget(w);
  assert.equal(cityWageBudget(w), 0);
  assert.equal(cityCanPay(w, 1), false);
});

test('salaried city shifts stop when the budget is spent; piece-rate shifts do not; business shifts are unaffected', () => {
  const w = makeWorld();
  createCityJobs(w);
  w.hour = 9;
  w.tick = 9;
  const medic = makeCitizen(w, { district: 'verdant_quarter', wallet: 0, skills: { crafting: 20, analysis: 20, rhetoric: 20, care: 40, commerce: 20, artistry: 20 } });
  assert.equal(applyForJob(w, medic.id, cityJob(w, 'medic').id).ok, true);
  const forge = makeCitizen(w, { district: 'foundry_row', wallet: 0 });
  assert.equal(applyForJob(w, forge.id, cityJob(w, 'forge_operator').id).ok, true);
  assert.equal(isBudgetedJob(w.jobs[medic.jobId!]), true);
  assert.equal(isBudgetedJob(w.jobs[forge.jobId!]), false);

  w.counters.cityWageBudget = 20; // room for one medic shift (16 gross, 14 net)
  const before = totalMoney(w);
  assert.equal(workShift(w, medic.id).ok, true);
  assert.equal(cityWagesToday(w), 14);
  const refused = workShift(w, medic.id);
  assert.equal(refused.ok, false);
  assert.match(refused.message, /wage budget for today is spent/);
  assert.equal(medic.wallet, 14);
  assert.equal(workShift(w, forge.id).ok, true, 'piece work is outside the budget');
  assert.equal(cityWagesToday(w), 14, 'and not counted against it');
  assert.ok(pieceWagesYesterday(w) === 0 && (w.counters.cityPieceWagesToday ?? 0) > 0, 'but remembered for tomorrow');
  assert.equal(totalMoney(w), before);

  // the next morning the medic is back at work
  dailyJobs(w);
  assert.ok(cityWageBudget(w) >= BUDGET_FLOOR_MIN);
  assert.equal(workShift(w, medic.id).ok, true);
});

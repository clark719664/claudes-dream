import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Job, JobRole, World } from '../src/types.ts';
import { transfer } from '../src/economy/treasury.ts';
import { applyForJob, createCityJobs, dailyJobs, workShift } from '../src/economy/jobs.ts';
import {
  BUDGET_FLOOR_MIN, BUDGET_FLOOR_RATE, DRAWDOWN_RATE, FOUNDING_BUDGET_RATE, STRAIN_RUNWAY_DAYS, bazaarSpendYesterday,
  cityCanPay, cityWageBudget, cityWageBudgetLeft, cityWagesToday, dailyBudget, fiscalPressure, isBudgetedJob,
  noteCitySpend, notePieceWage, pieceWagesYesterday, treasurySavings,
} from '../src/economy/budget.ts';

/** Move the clock: the budget tells yesterday's takings from this morning's spending by the tick they landed on. */
function atTick(world: World, tick: number): void {
  world.tick = tick;
  world.day = Math.floor(tick / 24);
  world.hour = tick % 24;
}

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

test("dailyBudget: the day's takings, less everything else the city paid, plus the drawdown; floored", () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 10_000 });
  dailyBudget(w);                       // the city has had a morning before this one
  atTick(w, 23);                        // ...the day: takings, the Bazaar's buying, the wages it paid
  transfer(w, c.id, 'treasury', 3000, 'rent', 'revenue');
  transfer(w, 'treasury', c.id, 900, 'sale', 'the Bazaar buying a workshop out');
  transfer(w, 'treasury', c.id, 400, 'wage', 'a forge shift, paid by the piece');
  notePieceWage(w, 400);
  transfer(w, 'treasury', c.id, 700, 'wage', 'a clerk on the wage budget');
  noteCitySpend(w, 700);
  transfer(w, 'treasury', c.id, 200, 'grant', 'an arrival grant, which nothing used to deduct');
  atTick(w, 24);                        // ...and this morning, before the budget is set: the dividend
  transfer(w, 'treasury', c.id, 500, 'dividend', 'the dividend, inside the same window');
  const balance = w.treasury.balance;
  dailyBudget(w);
  // The window: 3,000 in and 2,700 out, of which 700 was the wage budget's own.
  assert.equal(cityWageBudget(w), Math.round(3000 - (2700 - 700) + balance * DRAWDOWN_RATE));
  assert.equal(bazaarSpendYesterday(w), 900);
  assert.equal(cityWagesToday(w), 0, 'the day starts afresh');
  assert.equal(pieceWagesYesterday(w), 400);
  assert.equal(w.counters.cityWagesYesterday, 700);
  const routine = w.events.filter((e) => e.kind === 'treasury').at(-1);
  assert.ok(routine && routine.weight <= 0.1 && /wage budget/.test(routine.text));

  // no revenue at all: the floor keeps the city open, and the cut is news
  atTick(w, 48);
  noteCitySpend(w, 2000);
  dailyBudget(w);
  assert.equal(cityWageBudget(w), Math.max(BUDGET_FLOOR_MIN, Math.round(treasurySavings(w) * BUDGET_FLOOR_RATE)));
  const austerity = w.events.filter((e) => e.kind === 'treasury').at(-1);
  assert.ok(austerity && austerity.weight === 0.5 && /Austerity/.test(austerity.text));

  // an empty Treasury has no budget
  atTick(w, 72);
  transfer(w, 'treasury', c.id, w.treasury.balance, 'grant', 'drain');
  dailyBudget(w);
  assert.equal(cityWageBudget(w), 0);
  assert.equal(cityCanPay(w, 1), false);
});

test('the rule deducts what nobody named, whatever hour it was paid in', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 10_000 });
  dailyBudget(w);                                   // a mark to measure the first day from
  const day = (tick: number, spend: () => void): number => {
    atTick(w, tick - 1);
    transfer(w, c.id, 'treasury', 3000, 'rent', 'takings');
    atTick(w, tick);
    spend();                                        // ...in the rollover, after the budget was set
    dailyBudget(w);
    return cityWageBudget(w);
  };
  const quiet = day(24, () => undefined);
  // The Museum buys a work an hour after the budget was set: with the day's
  // flows read off `revenueToday`/`spendToday` this fell between two days and
  // was deducted from neither.
  const busy = day(48, () => { transfer(w, 'treasury', c.id, 600, 'acquisition', 'a work for the Museum'); });
  const after = day(72, () => undefined);
  assert.ok(quiet - busy >= 550 && quiet - busy <= 650, `a 600 ℓ acquisition cost the wage line ${quiet - busy} ℓ`);
  assert.ok(Math.abs(after - quiet) <= 60, 'and cost it once, not every day after');
});

test('the drawdown is a drawdown of savings: it stops at the reserve and while the Treasury is thinning', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 200_000 });
  w.treasury.balance = 60_000;
  assert.equal(treasurySavings(w), 60_000, 'with no reserve set, the whole balance is savings');
  w.government.reserveTarget = 50_000;
  assert.equal(treasurySavings(w), 10_000);
  w.government.reserveTarget = 70_000;
  assert.equal(treasurySavings(w), 0, 'below the line the city has no savings to draw on');

  // A city holding twice its reserve and gaining draws down; the same city
  // losing money draws down nothing at all.
  w.government.reserveTarget = 30_000;
  dailyBudget(w);
  const takings = (tick: number): void => {
    atTick(w, tick - 1);
    transfer(w, c.id, 'treasury', 3000, 'rent', 'takings');
    w.treasury.balance = 60_000;                    // hold the balance still between the two readings
    atTick(w, tick);
  };
  w.stats = [{ day: 1, treasury: 59_000 } as never, { day: 15, treasury: 60_000 } as never];
  takings(24);
  dailyBudget(w);
  const gaining = cityWageBudget(w);
  w.stats = [{ day: 1, treasury: 90_000 } as never, { day: 15, treasury: 60_000 } as never];  // 2,142 ℓ a day
  takings(48);
  dailyBudget(w);
  const losing = cityWageBudget(w);
  assert.equal(gaining, Math.round(3000 + 30_000 * DRAWDOWN_RATE));
  assert.equal(losing, 3000, 'a thinning Treasury pays for the day out of what came in and nothing more');
});

test('fiscal pressure: the reserve and the runway, whichever reads worse', () => {
  const w = makeWorld();
  w.treasury.balance = 60_000;
  w.stats = [{ day: 1, treasury: 60_000 } as never, { day: 15, treasury: 60_000 } as never];
  assert.equal(fiscalPressure(w), -1, 'a Treasury that is not losing anything is comfortable');

  // Losing 1,000 ℓ a day on 60,000 ℓ: sixty days in hand against a strain line
  // of STRAIN_RUNWAY_DAYS.
  w.stats = [{ day: 1, treasury: 74_000 } as never, { day: 15, treasury: 60_000 } as never];
  const byRunway = fiscalPressure(w);
  assert.ok(Math.abs(byRunway - (1 - 60 / STRAIN_RUNWAY_DAYS)) < 1e-9, `${byRunway}`);

  // The same books with the Council's line drawn below: the runway still reads
  // worse, so it is the one that speaks.
  w.government.reserveTarget = 20_000;
  assert.equal(fiscalPressure(w), byRunway);

  // A Treasury that is gaining but stands below the line it drew for itself is
  // not comfortable: breaking the city's own word is an argument of its own.
  w.stats = [{ day: 1, treasury: 59_000 } as never, { day: 15, treasury: 60_000 } as never];
  w.government.reserveTarget = 90_000;
  assert.ok(Math.abs(fiscalPressure(w) - (90_000 - 60_000) / 90_000) < 1e-9, `${fiscalPressure(w)}`);

  // The measure it replaced was denominated in the lever it moves: a Council
  // that had cut the dividend to nothing could read `balance < dividend × pop
  // × 5` as false however little it had left. This one cannot go quiet that way.
  w.government.dividend = 0;
  assert.ok(fiscalPressure(w) > 0);
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

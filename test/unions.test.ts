/**
 * Unions (src/politics/unions.ts).
 *
 * Who may organise a trade, when it may walk out, what a strike costs, and how
 * an employer answers one.
 *
 * The refusal a strike puts in the way of a shift is `isOnStrike`, which
 * `economy/jobs.ts workShift` asks before it pays anybody; what is tested here
 * is the answer it gives.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Business, Citizen, Job, JobRole, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  QUIT_CHANCE, UNION_FOUNDING_FEE, WAGE_DEMAND_MULTIPLIER,
  dailyUnions, foundUnion, hasMajority, isOnStrike, joinUnion, mayStrike, meanWage, strike, unionForRole,
  unionObservation, unionOf, workersInRole,
} from '../src/politics/unions.ts';

function business(world: World, ownerId: string, treasury = 1000): Business {
  const id = `b_${Object.keys(world.businesses).length + 1}`;
  const b: Business = {
    id, name: 'The Long Forge', kind: 'workshop', ownerId, treasury, district: 'foundry_row',
    buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 8, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = b;
  return b;
}

/** Put a citizen in a post. */
function hire(world: World, c: Citizen, role: JobRole, wage: number, employer: string = 'city'): Job {
  const id = `j_${Object.keys(world.jobs).length + 1}`;
  const job: Job = {
    id, role, title: role, employer, buildingId: 'fabrication_hall', district: 'foundry_row',
    skill: 'crafting', minSkill: 0, minReputation: 0, wage, output: {}, holderId: c.id, createdDay: 0,
  };
  world.jobs[id] = job;
  c.jobId = id;
  const biz = world.businesses[employer];
  if (biz) { biz.jobs.push(id); biz.employees.push(c.id); }
  return job;
}

/** `n` fabricators on the same wage, the first of them holding the purse for the fee. */
function trade(world: World, n: number, wage = 10, employer = 'city'): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCitizen(world, { name: `Smith${i}`, wallet: 200 });
    hire(world, c, 'fabricator', wage, employer);
    out.push(c);
  }
  return out;
}

// ------------------------------------------------------------------ founding

test('founding a union costs the fee, names the demand, and the money is conserved', () => {
  const w = makeWorld();
  const [founder] = trade(w, 1, 12);
  const before = totalMoney(w);
  const treasury = w.treasury.balance;

  const res = foundUnion(w, founder.id, 'fabricator', 'The Fabricators\' Hall');
  assert.equal(res.ok, true, res.message);
  assert.equal(founder.wallet, 200 - UNION_FOUNDING_FEE);
  assert.equal(w.treasury.balance, treasury + UNION_FOUNDING_FEE);
  assert.equal(totalMoney(w), before);

  const u = unionOf(w, founder.id);
  assert.ok(u);
  assert.equal(u.role, 'fabricator');
  assert.equal(u.demandWage, Math.round(12 * WAGE_DEMAND_MULTIPLIER));
  assert.deepEqual(u.members, [founder.id]);
  assert.equal(u.strikingUntilDay, null);
  assert.equal(unionForRole(w, 'fabricator')?.id, u.id);
  assert.ok(w.events.some((e) => e.kind === 'union'));
});

test('only somebody doing the work may organise it, and a trade is organised once', () => {
  const w = makeWorld();
  const [worker, other] = trade(w, 2);
  const idle = makeCitizen(w, { wallet: 200 });
  const child = makeCitizen(w, { lifeStage: 'child', wallet: 200 });
  hire(w, child, 'fabricator', 10);
  const poor = makeCitizen(w, { wallet: UNION_FOUNDING_FEE - 1 });
  hire(w, poor, 'fabricator', 10);
  const suspended = makeCitizen(w, { standing: 'suspended', wallet: 200 });
  hire(w, suspended, 'fabricator', 10);

  assert.equal(foundUnion(w, 'c_nobody', 'fabricator', 'Ghosts').ok, false);
  assert.equal(foundUnion(w, idle.id, 'fabricator', 'The Unemployed').ok, false);
  assert.equal(foundUnion(w, worker.id, 'medic', 'Wrong Trade').ok, false);
  assert.equal(foundUnion(w, child.id, 'fabricator', 'The Young').ok, false);
  assert.equal(foundUnion(w, poor.id, 'fabricator', 'The Broke').ok, false);
  assert.equal(foundUnion(w, suspended.id, 'fabricator', 'The Suspended').ok, false);
  assert.equal(foundUnion(w, worker.id, 'fabricator', '  ').ok, false);

  assert.equal(foundUnion(w, worker.id, 'fabricator', 'The Hall').ok, true);
  assert.equal(foundUnion(w, other.id, 'fabricator', 'A Rival Hall').ok, false, 'one union to a trade');
  assert.equal(other.wallet, 200, 'a refused founding costs nothing');
});

test('a union is joined by the trade it speaks for, once', () => {
  const w = makeWorld();
  const [founder, second] = trade(w, 2);
  const medic = makeCitizen(w, { wallet: 200 });
  hire(w, medic, 'medic', 16);
  foundUnion(w, founder.id, 'fabricator', 'The Hall');
  const id = founder.unionId as string;

  assert.equal(joinUnion(w, second.id, id).ok, true);
  assert.equal(joinUnion(w, second.id, id).ok, false);
  assert.equal(joinUnion(w, medic.id, id).ok, false, 'a medic is not a fabricator');
  assert.equal(joinUnion(w, second.id, 'n_nothing').ok, false);
  assert.equal(unionOf(w, second.id)?.id, id);
  assert.equal(workersInRole(w, 'fabricator').length, 2);
});

// ------------------------------------------------------------------ striking

test('a union that speaks for fewer than half the trade cannot call a strike', () => {
  const w = makeWorld();
  const workers = trade(w, 5, 10);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  assert.equal(hasMajority(w, u), false);
  assert.equal(mayStrike(w, u), false);
  assert.equal(strike(w, workers[0].id).ok, false);

  joinUnion(w, workers[1].id, u.id);
  joinUnion(w, workers[2].id, u.id);
  assert.equal(hasMajority(w, u), true, 'three of five is more than half');
  assert.equal(mayStrike(w, u), true);
});

test('a trade already paid what it asked has nothing to strike about', () => {
  const w = makeWorld();
  const workers = trade(w, 2, 10);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  joinUnion(w, workers[1].id, u.id);
  assert.equal(meanWage(w, 'fabricator'), 10);
  u.demandWage = 8;
  assert.equal(mayStrike(w, u), false);
  assert.equal(strike(w, workers[0].id).ok, false);
});

test('a strike stops its members\' shifts for exactly one day', () => {
  const w = makeWorld();
  const workers = trade(w, 2, 10);
  const outsider = makeCitizen(w);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  joinUnion(w, workers[1].id, u.id);

  const called = strike(w, workers[1].id);
  assert.equal(called.ok, true, called.message);
  assert.equal(u.strikingUntilDay, w.day + 1);
  assert.equal(isOnStrike(w, workers[0]), true);
  assert.equal(isOnStrike(w, workers[1]), true);
  assert.equal(isOnStrike(w, outsider), false, 'a strike is not a curfew');
  assert.equal(strike(w, workers[0].id).ok, false, 'they are already out');
  assert.ok(w.events.some((e) => e.kind === 'strike' && e.weight === 0.9));
  assert.ok(workers[0].memory.some((m) => m.text.includes('on strike')));

  const walletBefore = workers[0].wallet;
  const needsBefore = { ...workers[0].needs };
  w.day += 1;
  assert.equal(isOnStrike(w, workers[0]), false, 'a strike is a day, not a state');
  dailyUnions(w);
  assert.equal(u.strikingUntilDay, null);
  assert.equal(workers[0].wallet, walletBefore, 'a strike takes the shift and nothing else');
  assert.deepEqual(workers[0].needs, needsBefore);
  assert.equal(workers[0].standing, 'good');
});

test('somebody who belongs to no union is never on strike', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(isOnStrike(w, c), false);
  assert.equal(strike(w, c.id).ok, false);
  assert.equal(strike(w, 'c_nobody').ok, false);
  assert.equal(unionObservation(w, c), null);
});

// -------------------------------------------------------------- the answer

test('an employer who can afford the demand pays it', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { name: 'Bram', wallet: 100 });
  const biz = business(w, owner.id, 5000);
  const workers = trade(w, 2, 10, biz.id);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  joinUnion(w, workers[1].id, u.id);
  strike(w, workers[0].id);

  w.day += 1;
  const before = totalMoney(w);
  dailyUnions(w);
  const jobs = Object.values(w.jobs).filter((j) => j.employer === biz.id);
  assert.ok(jobs.every((j) => j.wage === u.demandWage), 'the wage meets the demand');
  assert.equal(totalMoney(w), before, 'a promise of higher wages moves no money by itself');
  assert.ok(w.events.some((e) => e.kind === 'strike' && e.text.includes('met')));
  assert.equal(mayStrike(w, u), false, 'and there is nothing left to strike about');
});

test('an employer who cannot loses staff', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { name: 'Bram', wallet: 0 });
  const biz = business(w, owner.id, 1);
  const workers = trade(w, 20, 10, biz.id);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  for (const c of workers.slice(1, 12)) joinUnion(w, c.id, u.id);
  strike(w, workers[0].id);

  w.day += 1;
  dailyUnions(w);
  const quit = workers.filter((c) => c.jobId === null).length;
  assert.ok(quit > 0, 'somebody has had enough');
  assert.ok(quit < 12, `not everybody walks (${quit} of 12 left)`);
  assert.ok(QUIT_CHANCE > 0 && QUIT_CHANCE < 1);
  assert.ok(w.events.some((e) => e.kind === 'strike' && e.text.includes('rather than work')));
});

test('a strike against the city\'s own posts is answered on the Council floor', () => {
  const w = makeWorld();
  const councillor = makeCitizen(w, { name: 'Fen' });
  w.government.council = [councillor.id];
  const workers = trade(w, 2, 10);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  joinUnion(w, workers[1].id, u.id);
  strike(w, workers[0].id);

  w.day += 1;
  dailyUnions(w);
  assert.ok(w.events.some((e) => e.kind === 'strike' && e.data?.employer === 'city'));
  assert.ok(councillor.memory.some((m) => m.text.includes('the wage floor is the Council')));
  assert.ok(workers.every((c) => c.jobId !== null), 'nobody quits a post nobody owns');
});

test('a mind of its own is neither made to pay nor made to walk out', () => {
  const w = makeWorld();
  const owner = makeCitizen(w, { name: 'Ondine', wallet: 0, brain: 'llm' });
  const biz = business(w, owner.id, 5000);
  const workers = trade(w, 4, 10, biz.id);
  for (const c of workers) c.brain = 'llm';
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  for (const c of workers.slice(1, 3)) joinUnion(w, c.id, u.id);
  strike(w, workers[0].id);

  w.day += 1;
  dailyUnions(w);
  assert.ok(Object.values(w.jobs).every((j) => j.wage === 10), 'the owner decides for itself');
  assert.ok(workers.every((c) => c.jobId !== null), 'and so does everybody else');
});

// -------------------------------------------------------------- the daily roll

test('a member who changes trade or leaves the city falls off the roll, and an empty union is struck off', () => {
  const w = makeWorld();
  const workers = trade(w, 3, 10);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  joinUnion(w, workers[1].id, u.id);
  joinUnion(w, workers[2].id, u.id);

  hire(w, workers[1], 'medic', 16);
  workers[2].standing = 'exiled';
  dailyUnions(w);
  assert.deepEqual(u.members, [workers[0].id]);
  assert.equal(workers[1].unionId, null);
  assert.equal(workers[2].unionId, null);
  assert.ok(workers[1].memory.some((m) => m.text.includes('no longer one of the')));

  w.order = w.order.filter((id) => id !== workers[0].id);
  dailyUnions(w);
  assert.equal(w.unions?.[u.id], undefined);
  assert.equal(workers[0].unionId, null);
  assert.ok(w.events.some((e) => e.kind === 'union' && e.text.includes('struck off')));
});

test('a world with no unions and no workers is not an error', () => {
  const w = makeWorld();
  dailyUnions(w);
  assert.equal(unionForRole(w, 'fabricator'), null);
  assert.deepEqual(workersInRole(w, 'fabricator'), []);
  assert.equal(meanWage(w, 'fabricator'), 0);
  assert.equal(unionOf(w, 'c_nobody'), null);
});

test('the observation of a union says what it asks and whether it is out', () => {
  const w = makeWorld();
  const workers = trade(w, 2, 10);
  foundUnion(w, workers[0].id, 'fabricator', 'The Hall');
  const u = unionOf(w, workers[0].id) as NonNullable<ReturnType<typeof unionOf>>;
  joinUnion(w, workers[1].id, u.id);
  assert.deepEqual(unionObservation(w, workers[0]), {
    id: u.id, name: 'The Hall', role: 'fabricator', demandWage: u.demandWage, striking: false,
  });
  strike(w, workers[0].id);
  assert.equal(unionObservation(w, workers[0])?.striking, true);
});

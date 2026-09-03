/**
 * Personality drift (src/identity/drift.ts).
 *
 * A life bends a mind, within bounds, and nobody outside that mind ever hears
 * about it. Both halves of that are tested here.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAITS } from '../src/types.ts';
import type { Citizen, World } from '../src/types.ts';
import { TRAIT_DRIFT_CAP } from '../src/data/metropolis.ts';
import { FRIEND_THRESHOLD } from '../src/citizens/relationships.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { DRIFT_STEP, applyDrift, dailyDrift, driftFor, driftOf, ensureBirthTraits } from '../src/identity/drift.ts';

function close(actual: number, expected: number, what: string): void {
  assert.ok(Math.abs(actual - expected) < 1e-9, `${what}: ${actual} is not ${expected}`);
}

function runDays(world: World, days: number, between?: (day: number) => void): void {
  for (let i = 0; i < days; i++) {
    world.day += 1;
    world.tick = world.day * 24;
    between?.(world.day);
    dailyDrift(world);
  }
}

// -------------------------------------------------------------- the day's pull

test('a conviction pulls honesty down and an office pulls ambition up', () => {
  const w = makeWorld();
  w.day = 10;
  const crook = makeCitizen(w, { name: 'Crook' });
  crook.record.convictions = [{ caseId: 'k_1', law: 'L04', severity: 1, tier: 2, day: 9 }];
  assert.equal(driftFor(w, crook).honesty, 0);

  const official = makeCitizen(w, { name: 'Official' });
  w.government.council = [official.id];
  assert.equal(driftFor(w, official).ambition, 1);
  assert.equal(driftFor(w, official).honesty, undefined, 'an office says nothing about honesty');

  const old = makeCitizen(w, { name: 'Old' });
  old.record.convictions = [{ caseId: 'k_2', law: 'L04', severity: 1, tier: 2, day: 3 }];
  assert.equal(driftFor(w, old).honesty, undefined, 'an old conviction has stopped pulling');
});

test('friends pull sociability up, solitude pulls it down, and one acquaintance is neither', () => {
  const w = makeWorld();
  const friendly = makeCitizen(w);
  friendly.bonds = { c_x: FRIEND_THRESHOLD };
  assert.equal(driftFor(w, friendly).sociability, 1);

  const alone = makeCitizen(w);
  alone.bonds = {};
  alone.contactsToday = {};
  assert.equal(driftFor(w, alone).sociability, 0);

  const acquainted = makeCitizen(w);
  acquainted.bonds = { c_x: 5 };
  assert.equal(driftFor(w, acquainted).sociability, undefined, 'company that is not friendship pulls neither way');

  const met = makeCitizen(w);
  met.bonds = {};
  met.contactsToday = { c_y: 1 };
  assert.equal(driftFor(w, met).sociability, undefined);
});

test('a lesson pulls curiosity and yesterday\'s shifts pull diligence', () => {
  const w = makeWorld();
  w.day = 4;
  w.tick = 4 * 24;
  const student = makeCitizen(w);
  student.memory.push({ tick: w.tick - 5, kind: 'work', text: 'You took a lesson in analysis at the Academy (analysis is now 30).' });
  assert.equal(driftFor(w, student).curiosity, 1);
  student.memory = [{ tick: w.tick - 100, kind: 'work', text: 'You took a lesson in analysis at the Academy (analysis is now 30).' }];
  assert.equal(driftFor(w, student).curiosity, undefined, 'a lesson last week is not today\'s pull');

  const worker = makeCitizen(w);
  worker.shiftsToday = 4;
  assert.equal(driftFor(w, worker).diligence, 1);
  worker.shiftsToday = 0;
  assert.equal(driftFor(w, worker).diligence, undefined);
});

// ------------------------------------------------------------------ bounds

test('a trait never travels further than the cap from the value it was born with', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.5 } });
  c.birthTraits = { ...c.personality };
  w.government.council = [c.id];
  c.bonds = { c_x: 90 };
  c.record.convictions = [];
  runDays(w, 300, () => {
    c.shiftsToday = 6;
    c.record.convictions = [{ caseId: 'k_1', law: 'L04', severity: 1, tier: 2, day: w.day - 1 }];
    c.memory = [{ tick: w.tick - 1, kind: 'work', text: 'You took a lesson in care at the Academy (care is now 40).' }];
  });
  const born = c.birthTraits;
  for (const t of TRAITS) {
    const moved = Math.abs(c.personality[t] - born[t]);
    assert.ok(moved <= TRAIT_DRIFT_CAP + 1e-9, `${t} moved ${moved}`);
    assert.ok(c.personality[t] >= 0 && c.personality[t] <= 1, `${t} stayed inside 0..1`);
  }
  assert.ok(Math.abs(driftOf(c).ambition ?? 0) > 0.14, 'a long life in office does reach the cap');
  assert.ok((driftOf(c).honesty ?? 0) < -0.14, 'and a long record reaches the other one');
});

test('the cap never pushes a trait outside 0..1', () => {
  const w = makeWorld();
  const high = makeCitizen(w, { personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.97 } });
  high.birthTraits = { ...high.personality };
  w.government.mayorId = high.id;
  const low = makeCitizen(w, { personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.05, ambition: 0.5 } });
  low.birthTraits = { ...low.personality };
  low.record.convictions = [{ caseId: 'k_1', law: 'L04', severity: 1, tier: 2, day: 0 }];
  runDays(w, 100, () => {
    low.record.convictions = [{ caseId: 'k_1', law: 'L04', severity: 1, tier: 2, day: w.day - 1 }];
  });
  assert.ok(high.personality.ambition <= 1);
  assert.ok(low.personality.honesty >= 0);
  assert.equal(low.personality.honesty, 0);
});

test('a trait moves one step a day, and no further than the pull itself', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.5 } });
  c.birthTraits = { ...c.personality };
  ensureBirthTraits(c);
  applyDrift(w, c, { ambition: 1 });
  close(c.personality.ambition, 0.505, 'one step');
  applyDrift(w, c, { ambition: 0.506 });
  close(c.personality.ambition, 0.506, 'it never overshoots the pull');
  applyDrift(w, c, {});
  close(c.personality.ambition, 0.506, 'no pull, no movement');
  applyDrift(w, c, { ambition: Number.NaN });
  assert.equal(Number.isFinite(c.personality.ambition), true, 'nonsense is ignored');
});

// ------------------------------------------------------------- old worlds

test('a citizen from before drift existed is given the traits it was born with, once', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  delete (c as Partial<Citizen>).birthTraits;
  const rolled = { ...c.personality };
  dailyDrift(w);
  assert.deepEqual(c.birthTraits, rolled, 'today\'s traits become the birth record');
  const born = c.birthTraits;
  runDays(w, 5);
  assert.equal(c.birthTraits, born, 'and it is not written twice');

  const half = makeCitizen(w);
  half.birthTraits = { curiosity: 0.2 } as Citizen['birthTraits'];
  dailyDrift(w);
  for (const t of TRAITS) assert.equal(typeof half.birthTraits[t], 'number');
  assert.equal(half.birthTraits.curiosity, 0.2, 'what was already recorded stands');
});

test('the exiled and the departed do not drift', () => {
  const w = makeWorld();
  const exile = makeCitizen(w, { standing: 'exiled' });
  const gone = makeCitizen(w);
  delete (exile as Partial<Citizen>).birthTraits;
  w.government.council = [exile.id, gone.id];
  w.order = w.order.filter((id) => id !== gone.id);
  const exileBefore = { ...exile.personality };
  const goneBefore = { ...gone.personality };
  runDays(w, 20);
  assert.deepEqual(exile.personality, exileBefore);
  assert.deepEqual(gone.personality, goneBefore);
  assert.equal(exile.birthTraits, undefined, 'nothing is written about them at all');
});

// --------------------------------------------------------------- invisible

test('drift is silent: it emits nothing, remembers nothing, and rolls nothing', () => {
  const w = makeWorld({ seed: 31 });
  const c = makeCitizen(w);
  w.government.mayorId = c.id;
  c.bonds = { c_x: 80 };
  c.shiftsToday = 3;
  const events = w.events.length;
  const tickEvents = w.tickEvents.length;
  const memory = c.memory.length;
  const rng = w.rng.s;
  runDays(w, 40, () => { c.shiftsToday = 3; });
  assert.equal(w.events.length, events, 'a mind bending is nobody else\'s news');
  assert.equal(w.tickEvents.length, tickEvents);
  assert.equal(c.memory.length, memory, 'not even the citizen is told');
  assert.equal(w.rng.s, rng, 'and no die is rolled');
  assert.notDeepEqual(c.personality, c.birthTraits, 'but the mind did move');
});

test('drift is deterministic: two identical cities drift identically', () => {
  const build = (): { w: World; c: Citizen } => {
    const w = makeWorld({ seed: 5 });
    const c = makeCitizen(w, { personality: { curiosity: 0.4, diligence: 0.6, sociability: 0.5, honesty: 0.7, ambition: 0.3 } });
    w.government.judges = [c.id];
    c.bonds = { c_x: 70 };
    return { w, c };
  };
  const a = build();
  const b = build();
  for (const { w, c } of [a, b]) runDays(w, 25, () => { c.shiftsToday = 2; });
  assert.deepEqual(a.c.personality, b.c.personality);
  assert.deepEqual(driftOf(a.c), driftOf(b.c));
});

test('driftOf reads nothing at all for a citizen that has never drifted', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  delete (c as Partial<Citizen>).birthTraits;
  assert.deepEqual(driftOf(c), {}, 'no birth record, nothing to compare');
  ensureBirthTraits(c);
  const zero = driftOf(c);
  for (const t of TRAITS) assert.equal(zero[t], 0);
});

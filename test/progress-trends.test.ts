/**
 * Trends — what the city wants this month (`docs/PROGRESS.md` §6).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { adjustBond } from '../src/citizens/relationships.ts';
import { progressState } from '../src/progress/state.ts';
import {
  MAX_TRENDS, SATURATION_SHARE, TREND_PRICE_PREMIUM, cityShare, dailyTrends, detectTrends, givenName,
  givesSocialGain, holdersOf, isRising, isSaturated, liveTrends, nameWeight, refreshTrends, spreadTrends,
  takeUpChance, threeFriendsHold, trendFor, trendPriceMultiplier, trendShare, trendsObservation, trendsReport,
} from '../src/progress/trends.ts';
import { progressState as state } from '../src/progress/state.ts';

const HARP = 'glass_harp';

function workingWorld(): World {
  const w = makeWorld();
  w.tick = 10;
  w.hour = 10;
  return w;
}

/** A city of `n` ordinary citizens. */
function city(world: World, n: number): Citizen[] {
  return Array.from({ length: n }, () => makeCitizen(world));
}

function give(world: World, c: Citizen, productId: string): void {
  c.possessions.push({ id: `i_${c.id}_${productId}`, productId, acquiredDay: world.day });
}

function befriend(world: World, a: Citizen, b: Citizen): void {
  adjustBond(world, a.id, b.id, 60);
}

// ---------------------------------------------------------------------------
// Nothing seeds one
// ---------------------------------------------------------------------------

test('three strangers holding the same thing are not a trend', () => {
  const w = workingWorld();
  const people = city(w, 20);
  for (const c of people.slice(0, 3)) give(w, c, HARP);
  assert.equal(holdersOf(w, 'possession', HARP).length, 3);
  assert.deepEqual(detectTrends(w), [], 'a trend needs friends, not a coincidence');
  assert.equal(trendFor(w, 'possession', HARP), null);
});

test('three friends holding the same thing are a trend, and nobody decided it', () => {
  const w = workingWorld();
  const people = city(w, 20);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  assert.equal(threeFriendsHold(w, [a.id, b.id, c.id]), true);

  const found = detectTrends(w);
  assert.equal(found.length, 1);
  assert.equal(found[0].kind, 'possession');
  assert.equal(found[0].subject, HARP);
  assert.ok(Math.abs(found[0].share - 3 / 20) < 1e-9);
  assert.equal(detectTrends(w).length, 0, 'and it is only found once');
});

test('a thing a third of the city already holds is not catching on: it is the city', () => {
  const w = workingWorld();
  const people = city(w, 9);
  for (const p of people) give(w, p, HARP);
  befriend(w, people[0], people[1]);
  befriend(w, people[0], people[2]);
  assert.equal(cityShare(w, 'possession', HARP), 1);
  assert.deepEqual(detectTrends(w), []);
});

test('the city keeps a bounded number of trends in mind', () => {
  const w = workingWorld();
  const people = city(w, 60);
  const products = ['glass_harp', 'tin_whistle', 'echo_print', 'sketch_set', 'moss_sofa', 'lantern_lamp',
    'window_fern', 'rooftop_planter', 'clockwork_cat', 'pocket_owl', 'velvet_coat', 'running_shoes',
    'foundry_boots', 'shard_chess', 'tide_cards'];
  products.forEach((product, i) => {
    const trio = [people[i * 3], people[i * 3 + 1], people[i * 3 + 2]];
    for (const p of trio) give(w, p, product);
    befriend(w, trio[0], trio[1]);
    befriend(w, trio[0], trio[2]);
  });
  detectTrends(w);
  assert.ok(liveTrends(w).length <= MAX_TRENDS);
  assert.ok(liveTrends(w).length > 0);
});

// ---------------------------------------------------------------------------
// Taking it up
// ---------------------------------------------------------------------------

test('the roll is the formula, and a citizen with no friends is at the base', () => {
  const w = workingWorld();
  const people = city(w, 20);
  const [a, b, c, lonely] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  const trend = detectTrends(w)[0];
  assert.ok(trend);

  // A harp is an instrument, and everybody in the test city likes instruments:
  // 0.05 base + 0.10 because it matches their tastes, and nothing else.
  assert.ok(Math.abs(takeUpChance(w, lonely, trend) - 0.15) < 1e-9, 'nobody they know has one');
  lonely.tastes = { ...lonely.tastes, hobbies: [], categories: [] };
  assert.ok(Math.abs(takeUpChance(w, lonely, trend) - 0.05) < 1e-9, 'and it is nothing they care about');

  const follower = people[5];
  befriend(w, follower, a);
  const p = takeUpChance(w, follower, trend);
  // 0.05 + 0.30 × (1 of 1 friend) + 0.10 taste + 0.15 × repute/1000.
  assert.ok(p > 0.4 && p < 0.7, `chance was ${p}`);
});

test('the roll moves a reflex citizen\'s want list and nothing else', () => {
  const w = workingWorld();
  const people = city(w, 12);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  const free = people[4];
  free.brain = 'llm';
  for (const p of people.slice(4)) {
    befriend(w, p, a);
    befriend(w, p, b);
  }
  detectTrends(w);
  for (let i = 0; i < 6; i++) spreadTrends(w);

  const reflexWanting = people.filter((p) => p.brain === 'reflex' && p.wants.includes(HARP));
  assert.ok(reflexWanting.length > 0, 'reflex minds put it on the list');
  assert.deepEqual(free.wants, [], 'a free mind is never told what to want');
  assert.equal(free.possessions.length, 0, 'and nothing is ever bought on anybody\'s behalf');
});

test('a want list stays short and never repeats itself', () => {
  const w = workingWorld();
  const people = city(w, 12);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  const follower = people[7];
  befriend(w, follower, a);
  detectTrends(w);
  for (let i = 0; i < 20; i++) spreadTrends(w);
  assert.ok(follower.wants.length <= 5);
  assert.equal(new Set(follower.wants).size, follower.wants.length);
});

// ---------------------------------------------------------------------------
// Saturation
// ---------------------------------------------------------------------------

test('a thing more than three fifths of the city holds signals nothing', () => {
  const w = workingWorld();
  const people = city(w, 20);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  const trend = detectTrends(w)[0];
  assert.equal(givesSocialGain(w, HARP), true, 'while it is rare it is worth having');
  assert.ok(trendPriceMultiplier(w, HARP) > 1, 'and a shop can clear it over the shelf price');
  assert.ok(trendPriceMultiplier(w, HARP) <= 1 + TREND_PRICE_PREMIUM);

  for (const p of people.slice(3, 15)) give(w, p, HARP);   // fifteen of twenty
  refreshTrends(w);
  assert.ok(trend.share > SATURATION_SHARE);
  assert.equal(isSaturated(w, 'possession', HARP), true);
  assert.equal(givesSocialGain(w, HARP), false, 'it reads as ordinary now');
  assert.equal(trendPriceMultiplier(w, HARP), 1, 'and nobody pays over the odds for it');
});

test('saturation is the last term of the roll: it puts people off', () => {
  const w = workingWorld();
  const people = city(w, 20);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  const trend = detectTrends(w)[0];
  const holdout = people[19];
  befriend(w, holdout, a);
  const early = takeUpChance(w, holdout, trend);
  trend.share = 1;
  const late = takeUpChance(w, holdout, trend);
  assert.ok(late < early, `${late} should be under ${early}`);
});

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

test('the observation carries yesterday\'s reading, the same for everybody', () => {
  const w = workingWorld();
  const people = city(w, 20);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  detectTrends(w);
  const observed = trendsObservation(w);
  assert.equal(observed.length, 1);
  assert.equal(observed[0].subject, HARP);
  assert.ok(Math.abs(observed[0].share - 3 / 20) < 1e-9);

  // Six more buy one; the index does not move until the morning.
  for (const p of people.slice(3, 9)) give(w, p, HARP);
  assert.ok(Math.abs(trendShare(w, 'possession', HARP) - 3 / 20) < 1e-9, 'the shopkeeper reads yesterday');
  refreshTrends(w);
  assert.ok(Math.abs(trendShare(w, 'possession', HARP) - 9 / 20) < 1e-9);
  assert.equal(isRising(w, 'possession', HARP), true);
  assert.match(trendsReport(w), /Glass Harp/);
});

test('a trend that falls away is over, and the city moves on', () => {
  const w = workingWorld();
  const people = city(w, 20);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  const trend = detectTrends(w)[0];
  w.day += 1;
  for (const p of [a, b, c]) p.possessions = [];
  refreshTrends(w);
  assert.equal(trend.endedDay, w.day);
  assert.deepEqual(liveTrends(w), []);
  assert.ok(trend.peakShare > 0, 'the record remembers how far it got');
});

test('names run on their own memory, and an untrended name weighs one', () => {
  const w = workingWorld();
  const people = city(w, 20);
  assert.equal(nameWeight(w, 'Ondine'), 1);
  for (const p of people.slice(0, 4)) p.name = 'Ondine';
  befriend(w, people[0], people[1]);
  befriend(w, people[0], people[2]);
  assert.equal(givenName(people[0]), 'Ondine');
  const found = detectTrends(w).find((t) => t.kind === 'name');
  assert.ok(found, 'a name catches on like anything else');
  assert.ok(nameWeight(w, 'Ondine') > 1, 'and parents weigh it');

  found.endedDay = w.day - 1_000;
  assert.equal(nameWeight(w, 'Ondine'), 1, 'a name the city has forgotten weighs nothing extra');
});

test('the daily pass reads, finds and spreads without touching anything else', () => {
  const w = workingWorld();
  const people = city(w, 20);
  const [a, b, c] = people;
  for (const p of [a, b, c]) give(w, p, HARP);
  befriend(w, a, b);
  befriend(w, a, c);
  const walletsBefore = people.map((p) => p.wallet);
  dailyTrends(w);
  assert.equal(liveTrends(w).length, 1);
  assert.deepEqual(people.map((p) => p.wallet), walletsBefore, 'a trend never spends anybody\'s money');
  assert.equal(progressState(w).trends.length, 1);
  assert.equal(state(w), progressState(w), 'one register, created once');
});

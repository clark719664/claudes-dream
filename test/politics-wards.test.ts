/**
 * Ward representation (src/politics/wards.ts).
 *
 * The apportionment, the gap it leaves, who takes the seats when they belong
 * to places, and the reapportionment that has to be passed by a body the
 * poorest district cannot elect.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DISTRICT_IDS } from '../src/types.ts';
import type { Citizen, DistrictId, ElectionResult, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { charterOf } from '../src/politics/charter.ts';
import {
  MALAPPORTIONMENT_NEWS, apportion, apportionHooks, apportionment, clearWardPresence, dailyWards, malapportionment,
  reapportion, residentsByWard, tickWardPresence, wardOf, wardPresence, wardSeatPool, wardVotePull, wardWinners,
  wards, wardsObservation, worstWard,
} from '../src/politics/wards.ts';

/** A city with every quarter open, so every district is a ward. */
function openCity(): World {
  const w = makeWorld();
  w.openDistricts = [...DISTRICT_IDS];
  return w;
}

/** `n` citizens living in a district. */
function livingIn(world: World, district: DistrictId, n: number, prefix = 'C'): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    out.push(makeCitizen(world, { name: `${prefix}${district}${i}`, district, brain: 'llm' }));
  }
  return out;
}

// ------------------------------------------------------------ apportionment

test('with no wards the seats belong to the city at large and the gap is zero', () => {
  const w = openCity();
  livingIn(w, 'commons', 10);
  assert.equal(wardSeatPool(w), 0);
  assert.equal(malapportionment(w), 0);
  dailyWards(w);
  assert.equal(charterOf(w).malapportionment, 0);
});

test('under wards every district with anybody in it holds a seat, largest remainders after', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  livingIn(w, 'commons', 30);
  livingIn(w, 'verdant_quarter', 15);
  livingIn(w, 'harbor_market', 5);
  const counted = residentsByWard(w);
  assert.equal(counted.commons, 30);
  assert.equal(wardSeatPool(w), 5);
  const a = apportion(w);
  const total = wards(w).reduce((sum, d) => sum + (a.seats[d] ?? 0), 0);
  assert.equal(total, 5, 'the seats add up to the seats');
  assert.equal((a.seats.harbor_market ?? 0) >= 1, true, 'the smallest ward still holds one');
  assert.equal((a.seats.commons ?? 0) > (a.seats.verdant_quarter ?? 0), true);
});

test('mixed splits the seats: three to the wards and two at large', () => {
  const w = openCity();
  charterOf(w).wards = 'mixed';
  livingIn(w, 'commons', 20);
  livingIn(w, 'undercroft', 4);
  assert.equal(wardSeatPool(w), 3);
  const a = apportion(w);
  assert.equal(a.atLarge, 2);
  assert.equal(wards(w).reduce((sum, d) => sum + (a.seats[d] ?? 0), 0), 3);
});

test('the gap is published every morning and the Chronicle runs it past a quarter', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  livingIn(w, 'commons', 40);
  livingIn(w, 'undercroft', 2);
  dailyWards(w);
  const gap = malapportionment(w);
  assert.ok(gap > MALAPPORTIONMENT_NEWS, `gap ${gap}`);
  assert.equal(charterOf(w).malapportionment, gap);
  assert.ok(w.events.some((e) => e.text.includes('out of true')));
  assert.ok(worstWard(w));
  const runs = w.events.filter((e) => e.text.includes('out of true')).length;
  dailyWards(w);
  assert.equal(w.events.filter((e) => e.text.includes('out of true')).length, runs, 'once a day');
});

test('automatic reapportions at the election; fixed waits for the amendment', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  livingIn(w, 'commons', 20);
  livingIn(w, 'verdant_quarter', 20);
  dailyWards(w);
  const first = { ...apportionment(w).seats };
  livingIn(w, 'undercroft', 30);

  charterOf(w).apportion = 'fixed';
  w.government.election.cycle += 1;
  dailyWards(w);
  assert.deepEqual(apportionment(w).seats, first, 'frozen until amended');

  charterOf(w).apportion = 'automatic';
  w.government.election.cycle += 1;
  dailyWards(w);
  assert.ok((apportionment(w).seats.undercroft ?? 0) > 0, 'the count follows the people');
});

test('the apportion measure is the road under a frozen charter', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  charterOf(w).apportion = 'fixed';
  const commons = livingIn(w, 'commons', 20);
  livingIn(w, 'undercroft', 2);
  dailyWards(w);
  livingIn(w, 'undercroft', 30);
  const seat = commons[0];
  w.government.council.push(seat.id);
  const before = apportionment(w).seats.undercroft ?? 0;
  const m = {
    id: 'p_a', kind: 'apportion' as const, value: 0, subject: null, edit: null, words: 'count us again',
    proposerId: seat.id, tabledDay: w.day, readingDay: w.day, votes: {}, needed: 1,
    status: 'open' as const, decidedDay: null,
  };
  const text = apportionHooks.enact(w, m);
  assert.match(text, /apportioned/);
  assert.ok((apportionment(w).seats.undercroft ?? 0) > before);
});

test('a councillor reads a reapportionment from the ward they live in', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  charterOf(w).apportion = 'fixed';
  const commons = livingIn(w, 'commons', 30);
  const under = livingIn(w, 'undercroft', 1);
  dailyWards(w);
  livingIn(w, 'undercroft', 30);
  const m = {
    id: 'p_a', kind: 'apportion' as const, value: 0, subject: null, edit: null, words: '',
    proposerId: under[0].id, tabledDay: w.day, readingDay: w.day, votes: {}, needed: 1,
    status: 'open' as const, decidedDay: null,
  };
  assert.equal(apportionHooks.disposition?.(w, under[0].id, m), true, 'the under-represented ward wants the count');
  assert.equal(apportionHooks.disposition?.(w, commons[0].id, m), false, 'the ward that loses a seat does not');
});

// -------------------------------------------------------------- election night

test('each ward\'s seats go to its own best-polling candidates, the Mayor still polls highest', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  const commons = livingIn(w, 'commons', 30);
  const under = livingIn(w, 'undercroft', 10);
  dailyWards(w);
  const results: ElectionResult[] = [
    { candidateId: commons[0].id, votes: 30 },
    { candidateId: commons[1].id, votes: 25 },
    { candidateId: commons[2].id, votes: 20 },
    { candidateId: commons[3].id, votes: 15 },
    { candidateId: commons[4].id, votes: 12 },
    { candidateId: under[0].id, votes: 6 },
  ];
  const winners = wardWinners(w, results, 5);
  assert.equal(winners.length, 5);
  assert.equal(winners[0], commons[0].id, 'the top of the poll takes the chair');
  assert.equal(winners.includes(under[0].id), true, 'and the Undercroft holds its seat');
  charterOf(w).wards = 'none';
  const citywide = wardWinners(w, results, 5);
  assert.equal(citywide.includes(under[0].id), false, 'which under a citywide franchise it does not');
});

test('campaigning moves with the seats: an hour in a ward is an hour it saw you', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  const commons = livingIn(w, 'commons', 10);
  const under = livingIn(w, 'undercroft', 5);
  w.government.election.candidates.push(commons[0].id);
  commons[0].district = 'undercroft';
  for (let i = 0; i < 4; i++) tickWardPresence(w);
  commons[0].district = 'commons';
  tickWardPresence(w);
  assert.equal(wardPresence(w, commons[0].id, 'undercroft'), 0.8);
  const pull = wardVotePull(w, under[0].id, commons[0].id);
  assert.ok(pull > 0, 'the ward that saw them leans their way');
  clearWardPresence(w);
  assert.equal(wardPresence(w, commons[0].id, 'undercroft'), 0);
});

test('what a citizen reads of their own ward', () => {
  const w = openCity();
  charterOf(w).wards = 'districts';
  const under = livingIn(w, 'undercroft', 6);
  livingIn(w, 'commons', 24);
  dailyWards(w);
  const seen = wardsObservation(w, under[0]);
  assert.equal(seen.scheme, 'districts');
  assert.equal(seen.yourWard, 'undercroft');
  assert.equal(seen.residentsHere, 6);
  assert.equal(seen.seatsHere >= 1, true);
  assert.equal(wardOf(w, under[0]), 'undercroft');
  reapportion(w, 'a test');
  assert.ok(apportionment(w).asOfDay === w.day);
});

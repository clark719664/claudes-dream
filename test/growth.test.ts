import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import { FOUNDING_DISTRICT_IDS } from '../src/types.ts';
import type { DistrictId } from '../src/types.ts';
import { CITY_JOBS, TRAM_COST } from '../src/data/jobs.ts';
import { HOUSING_BLOCKS } from '../src/data/city.ts';
import { HEIGHTS_POPULATION, UNDERCROFT_POPULATION } from '../src/data/metropolis.ts';
import {
  addTram, canMoveBetween, dailyGrowth, describeGrowth, districtsObservation, enactTram, hasTram,
  isOpen, nextStep, openAdjacent, openDistrict, openDistricts, pathDistance, tramPartners, UNREACHABLE,
} from '../src/world/growth.ts';

function fill(world: ReturnType<typeof makeWorld>, n: number): void {
  for (let i = 0; i < n; i++) makeCitizen(world);
}

test('the founding city has exactly the seven founding districts open', () => {
  const w = makeWorld();
  const open = openDistricts(w);
  assert.equal(open.length, 7);
  assert.deepEqual([...open].sort(), [...FOUNDING_DISTRICT_IDS].sort());
  assert.equal(isOpen(w, 'heights'), false);
  assert.equal(isOpen(w, 'undercroft'), false);
  // a world saved before this layer still walks
  delete (w as { openDistricts?: DistrictId[] }).openDistricts;
  assert.equal(openDistricts(w).length, 7);
  assert.equal(isOpen(w, 'commons'), true);
});

test('a closed district cannot be entered and does not appear next door', () => {
  const w = makeWorld();
  assert.equal(openAdjacent(w, 'foundry_row').includes('heights'), false);
  assert.equal(canMoveBetween(w, 'foundry_row', 'heights'), false);
  assert.equal(canMoveBetween(w, 'harbor_market', 'undercroft'), false);
  assert.equal(pathDistance(w, 'commons', 'heights'), UNREACHABLE);
  assert.equal(nextStep(w, 'commons', 'heights'), null);
  // and the open city still works
  assert.equal(canMoveBetween(w, 'commons', 'harbor_market'), true);
  assert.equal(canMoveBetween(w, 'commons', 'commons'), true);
  assert.equal(canMoveBetween(w, 'commons', 'nowhere' as DistrictId), false);
  assert.equal(canMoveBetween(w, 'nowhere' as DistrictId, 'commons'), false);
});

test('the Heights open at their population, once, with jobs, rooms and a team', () => {
  const w = makeWorld();
  const capacity3 = w.housing.capacity[3];
  fill(w, HEIGHTS_POPULATION - 1);
  dailyGrowth(w);
  assert.equal(isOpen(w, 'heights'), false, 'one short is still shut');

  makeCitizen(w);
  const before = totalMoney(w);
  dailyGrowth(w);
  assert.equal(isOpen(w, 'heights'), true);
  assert.equal(totalMoney(w), before, 'opening a district moves no money');

  const rooms = HOUSING_BLOCKS.filter((b) => b.buildingId === 'hilltop_villas').reduce((n, b) => n + b.units, 0);
  assert.equal(w.housing.capacity[3], capacity3 + rooms);
  const posts = CITY_JOBS.filter((t) => t.buildingId === 'university' || t.buildingId === 'high_dome').length;
  const opened = Object.values(w.jobs).filter((j) => j.district === 'heights');
  assert.ok(opened.length >= posts, 'every city post in the district is on the board');
  for (const j of opened) assert.equal(j.holderId, null);
  assert.equal(w.teams?.heights?.district, 'heights');
  assert.ok((w.teams?.heights?.name ?? '').length > 0);

  const events = w.events.filter((e) => e.kind === 'growth');
  assert.equal(events.length, 1, 'opening is announced exactly once');
  assert.equal(events[0].weight, 0.9);
  assert.ok(w.citizens[w.order[0]].memory.some((m) => m.text.includes('Heights')));

  // idempotent: a second morning changes nothing
  dailyGrowth(w);
  openDistrict(w, 'heights');
  assert.equal(w.housing.capacity[3], capacity3 + rooms);
  assert.equal(w.events.filter((e) => e.kind === 'growth').length, 1);
  assert.equal(openDistricts(w).length, 8);
});

test('an open district joins the walk in both directions', () => {
  const w = makeWorld();
  openDistrict(w, 'heights');
  assert.ok(openAdjacent(w, 'foundry_row').includes('heights'));
  assert.ok(openAdjacent(w, 'heights').includes('foundry_row'));
  assert.equal(canMoveBetween(w, 'foundry_row', 'heights'), true);
  assert.equal(canMoveBetween(w, 'heights', 'foundry_row'), true);
  // the Undercroft is next to the Heights on the plan, but it is still shut
  assert.equal(openAdjacent(w, 'heights').includes('undercroft'), false);
  assert.equal(pathDistance(w, 'commons', 'heights'), 2);
  assert.equal(nextStep(w, 'commons', 'heights'), 'foundry_row');
});

test('the Undercroft opens at its own threshold and never closes again', () => {
  const w = makeWorld();
  fill(w, UNDERCROFT_POPULATION);
  dailyGrowth(w);
  assert.equal(isOpen(w, 'heights'), true);
  assert.equal(isOpen(w, 'undercroft'), true);
  assert.equal(openDistricts(w).length, 9);
  // people leave; the district stays
  w.order = w.order.slice(0, 3);
  dailyGrowth(w);
  assert.equal(isOpen(w, 'undercroft'), true);
  assert.deepEqual(districtsObservation(w).slice(-2), ['heights', 'undercroft']);
});

test('a tram makes two districts neighbours both ways and refuses a duplicate', () => {
  const w = makeWorld();
  assert.equal(pathDistance(w, 'verdant_quarter', 'harbor_market'), 2);
  assert.equal(addTram(w, 'verdant_quarter', 'harbor_market'), true);
  assert.equal(hasTram(w, 'harbor_market', 'verdant_quarter'), true);
  assert.equal(pathDistance(w, 'verdant_quarter', 'harbor_market'), 1);
  assert.ok(openAdjacent(w, 'verdant_quarter').includes('harbor_market'));
  assert.ok(openAdjacent(w, 'harbor_market').includes('verdant_quarter'));
  assert.equal(canMoveBetween(w, 'harbor_market', 'verdant_quarter'), true);
  assert.deepEqual(tramPartners(w, 'verdant_quarter'), ['harbor_market']);

  assert.equal(addTram(w, 'harbor_market', 'verdant_quarter'), false, 'the line already runs');
  assert.equal(addTram(w, 'commons', 'commons'), false);
  assert.equal(addTram(w, 'commons', 'nowhere' as DistrictId), false);
  assert.equal((w.trams ?? []).length, 1);
  assert.equal(w.events.filter((e) => e.kind === 'growth').length, 1);
  assert.ok(describeGrowth(w).includes('tram'));
});

test('a tram to a closed district is not a way in', () => {
  const w = makeWorld();
  addTram(w, 'commons', 'undercroft');
  assert.equal(openAdjacent(w, 'commons').includes('undercroft'), false);
  assert.equal(canMoveBetween(w, 'commons', 'undercroft'), false);
  openDistrict(w, 'undercroft');
  assert.equal(canMoveBetween(w, 'commons', 'undercroft'), true);
});

test('enactTram connects the furthest pair and only when the works fund can pay', () => {
  const w = makeWorld();
  w.government.publicWorksFund = TRAM_COST - 1;
  assert.equal(enactTram(w), null, 'a short fund lays no rail');
  assert.equal((w.trams ?? []).length, 0);

  const before = totalMoney(w);
  w.government.publicWorksFund = TRAM_COST + 40;
  const pair = enactTram(w);
  assert.ok(pair, 'a funded line is laid');
  assert.equal(w.government.publicWorksFund, 40, 'the works fund pays for it');
  assert.equal(totalMoney(w), before, 'the city builds it with its own hands: no lumen moves');
  assert.equal(hasTram(w, pair![0], pair![1]), true);
  assert.equal(pathDistance(w, pair![0], pair![1]), 1);
});

test('enactTram gives up when every open district is already a neighbour', () => {
  const w = makeWorld();
  w.government.publicWorksFund = TRAM_COST * 20;
  for (let i = 0; i < 30; i++) {
    if (enactTram(w) === null) break;
  }
  const open = openDistricts(w);
  for (const a of open) {
    for (const b of open) {
      if (a === b) continue;
      assert.equal(pathDistance(w, a, b), 1, `${a} and ${b} should be neighbours by now`);
    }
  }
  assert.equal(enactTram(w), null);
});

test('the walk is deterministic, bounded and honest about dead ends', () => {
  const w = makeWorld();
  assert.equal(pathDistance(w, 'commons', 'commons'), 0);
  assert.equal(nextStep(w, 'commons', 'commons'), null);
  assert.equal(pathDistance(w, 'nowhere' as DistrictId, 'commons'), UNREACHABLE);
  assert.equal(nextStep(w, 'nowhere' as DistrictId, 'commons'), null);
  const first = nextStep(w, 'verdant_quarter', 'harbor_market');
  assert.equal(nextStep(w, 'verdant_quarter', 'harbor_market'), first);
  assert.ok(first === 'commons' || first === 'archive');
  assert.equal(pathDistance(w, first as DistrictId, 'harbor_market'), 1);
});

test('growth handles an empty city and an unknown district without complaint', () => {
  const w = makeWorld();
  dailyGrowth(w);
  assert.equal(openDistricts(w).length, 7);
  openDistrict(w, 'atlantis' as DistrictId);
  assert.equal(openDistricts(w).length, 7);
  assert.equal(w.events.length, 0);
  assert.deepEqual(tramPartners(w, 'commons'), []);
  assert.equal(openAdjacent(w, 'atlantis' as DistrictId).length, 0);
});

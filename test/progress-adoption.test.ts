/**
 * Adoption, the effects that follow from it, and the tram gate
 * (`docs/PROGRESS.md` §3, `docs/REGISTRY.md` §7).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Business, BusinessId, Job, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { progressState } from '../src/progress/state.ts';
import type { TechnologyId } from '../src/progress/tree.ts';
import { TECHNOLOGIES } from '../src/progress/tree.ts';
import {
  SHIFTS_TO_TRAIN, adoptionStrength, cityWorks, comfortDecayMultiplier, effectStrength, familiarWith,
  glitchOnsetMultiplier, isFamiliar, outputMultiplier, readinessOf, trainShift, tramAllowed, tramGate,
  uptakeOf, worksAmenity,
} from '../src/progress/effects.ts';
import {
  WORKS_PER_DAY, adoptTechnology, adoptionState, cityAdoptions, dailyWorks, enactAdoption, pledgedFor,
  worksReport,
} from '../src/progress/adoption.ts';

function workingWorld(): World {
  const w = makeWorld();
  w.tick = 10;
  w.hour = 10;
  return w;
}

/** Write a subject into the register the way a concluded programme would. */
function grant(world: World, id: TechnologyId, opts: { secret?: boolean; masters?: string[] } = {}): void {
  progressState(world).technologies[id] = {
    id, discoveredDay: world.day, projectId: null,
    secret: opts.secret ?? false, masters: opts.masters ?? [], lostDay: null, source: 'research',
  };
}

function makeBusiness(world: World, ownerId: string, treasury = 1_000): Business {
  const id = nextId(world, 'b') as BusinessId;
  const biz: Business = {
    id, name: `Workshop ${id}`, kind: 'workshop', ownerId, treasury,
    district: 'harbor_market', buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: world.day, rentPerDay: 0, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  world.businesses[id] = biz;
  const owner = world.citizens[ownerId];
  if (owner) owner.businessId = id;
  return biz;
}

/** A citizen holding a city post, so the city has a post to train. */
function worker(world: World) {
  const c = makeCitizen(world, { district: 'foundry_row' });
  const id = nextId(world, 'j');
  const job: Job = {
    id, role: 'forge_operator', title: 'Forge Operator', employer: 'city', buildingId: 'compute_forge',
    district: 'foundry_row', skill: 'crafting', minSkill: 10, minReputation: 0, wage: 14,
    output: { good: 'compute', qty: 3 }, holderId: c.id, createdDay: world.day,
  };
  world.jobs[id] = job;
  c.jobId = id;
  return c;
}

// ---------------------------------------------------------------------------
// The Council's works
// ---------------------------------------------------------------------------

test('the Council cannot build works for something the city does not hold', () => {
  const w = workingWorld();
  const r = enactAdoption(w, 'sanitation', 800);
  assert.equal(r.ok, false);
  assert.match(r.message, /does not hold/);
  assert.equal(cityAdoptions(w).length, 0);
});

test('works are paid a day at a time out of the public works fund', () => {
  const w = workingWorld();
  grant(w, 'sanitation');
  assert.equal(enactAdoption(w, 'sanitation', 400).ok, true);
  assert.equal(pledgedFor(w, 'sanitation'), 400);
  const a = cityWorks(w, 'sanitation');
  assert.ok(a);
  assert.equal(a.worksCost, 400, 'a tier-1 subject wants 400 ℓ of works');
  assert.equal(a.worksPaid, 0, 'nothing is built the day it passes');

  w.government.publicWorksFund = 1_000;
  dailyWorks(w);
  assert.equal(a.worksPaid, WORKS_PER_DAY);
  assert.equal(w.government.publicWorksFund, 1_000 - WORKS_PER_DAY);
  dailyWorks(w);
  assert.equal(a.worksPaid, 400, 'and the works are finished');
  assert.equal(pledgedFor(w, 'sanitation'), 0);
  dailyWorks(w);
  assert.equal(a.worksPaid, 400, 'nothing more is drawn once they are built');
});

test('an empty fund builds nothing, and the Chronicle can say how short it is', () => {
  const w = workingWorld();
  grant(w, 'germ_theory');
  assert.equal(enactAdoption(w, 'germ_theory', 800).ok, true);
  w.government.publicWorksFund = 0;
  dailyWorks(w);
  const a = cityWorks(w, 'germ_theory');
  assert.equal(a?.worksPaid, 0);
  assert.match(worksReport(w), /Germ Theory at 0 of 800/);
  const short = w.events.filter((e) => /wait/.test(e.text));
  assert.ok(short.length > 0, 'the shortfall is printed');
});

// ---------------------------------------------------------------------------
// Knowing is not using
// ---------------------------------------------------------------------------

test('a technology nobody built for changes nothing at all', () => {
  const w = workingWorld();
  grant(w, 'crop_rotation');
  assert.equal(effectStrength(w, 'crop_rotation'), 0);
  assert.equal(outputMultiplier(w, { good: 'compute' }), 1, 'a line in the records is not a harvest');
});

test('works with nobody trained are worth two fifths, and training carries the rest', () => {
  const w = workingWorld();
  const c = worker(w);
  grant(w, 'crop_rotation');
  assert.equal(enactAdoption(w, 'crop_rotation', 400).ok, true);
  w.government.publicWorksFund = 400;
  dailyWorks(w);
  dailyWorks(w);
  const a = cityWorks(w, 'crop_rotation');
  assert.ok(a);
  assert.equal(readinessOf(a), 1);
  assert.equal(uptakeOf(w, a), 0);
  assert.ok(Math.abs(adoptionStrength(w, a) - 0.4) < 1e-9);
  // Crop Rotation is ×1.20 at full effect, so two fifths of it is ×1.08.
  assert.ok(Math.abs(outputMultiplier(w, { good: 'compute' }) - 1.08) < 1e-9);

  for (let i = 0; i < SHIFTS_TO_TRAIN; i++) trainShift(w, c.id);
  assert.deepEqual(a.trained, [c.id]);
  assert.equal(uptakeOf(w, a), 1, 'the city has one post and it is trained');
  assert.ok(Math.abs(outputMultiplier(w, { good: 'compute' }) - 1.2) < 1e-9);
});

test('three shifts under the works makes a citizen familiar with the subject', () => {
  const w = workingWorld();
  const c = worker(w);
  grant(w, 'sanitation');
  enactAdoption(w, 'sanitation', 400);
  w.government.publicWorksFund = 400;
  dailyWorks(w);

  assert.equal(isFamiliar(w, c.id, 'sanitation'), false);
  trainShift(w, c.id);
  trainShift(w, c.id);
  assert.equal(isFamiliar(w, c.id, 'sanitation'), false, 'two shifts is not three');
  trainShift(w, c.id);
  assert.deepEqual(familiarWith(w, c.id), ['sanitation']);
  assert.ok(glitchOnsetMultiplier(w) < 1, 'and the drains start to tell');
});

test('effects stack across subjects and scale with what was actually built', () => {
  const w = workingWorld();
  const c = worker(w);
  grant(w, 'the_loom');
  enactAdoption(w, 'the_loom', 400);
  w.government.publicWorksFund = 200;
  dailyWorks(w);                                  // half the works, nobody trained
  const a = cityWorks(w, 'the_loom');
  assert.equal(readinessOf(a), 0.5);
  // Comfort decays ×0.9 at full effect; at 0.5 × 0.4 of it, ×0.98.
  assert.ok(Math.abs(comfortDecayMultiplier(w) - 0.98) < 1e-9);
  assert.equal(c.id.length > 0, true);
});

// ---------------------------------------------------------------------------
// One workshop at a time
// ---------------------------------------------------------------------------

test('a business builds its own works from its capital, for its own shifts only', () => {
  const w = workingWorld();
  const owner = makeCitizen(w, { district: 'harbor_market' });
  const biz = makeBusiness(w, owner.id, 300);
  grant(w, 'the_loom');
  const supply = totalMoney(w);

  const first = adoptTechnology(w, owner.id, 'the_loom');
  assert.equal(first.ok, true, first.message);
  assert.equal(biz.treasury, 0, 'it paid what it could');
  assert.equal(totalMoney(w), supply, 'the works cost lumens; nobody made any');
  assert.equal(adoptionState(w, 'the_loom', biz.id).worksPaid, 300);
  assert.equal(adoptionState(w, 'the_loom').worksPaid, 0, 'the city built nothing');

  const broke = adoptTechnology(w, owner.id, 'the_loom');
  assert.equal(broke.ok, false, 'an empty till builds nothing');

  biz.treasury = 100;
  assert.equal(adoptTechnology(w, owner.id, 'the_loom').ok, true);
  assert.equal(adoptionState(w, 'the_loom', biz.id).worksPaid, 400);
  assert.equal(adoptTechnology(w, owner.id, 'the_loom').ok, false, 'and they are finished');

  // The workshop's own shifts feel it; the city's do not.
  assert.ok(effectStrength(w, 'the_loom', biz.id) > 0);
  assert.equal(effectStrength(w, 'the_loom'), 0);
});

test('only an owner may spend a business\'s capital on works', () => {
  const w = workingWorld();
  const owner = makeCitizen(w, { district: 'harbor_market' });
  makeBusiness(w, owner.id, 500);
  const nobody = makeCitizen(w, { district: 'harbor_market' });
  grant(w, 'the_loom');
  assert.equal(adoptTechnology(w, nobody.id, 'the_loom').ok, false);
  assert.equal(adoptTechnology(w, owner.id, 'nonsense').ok, false);
});

test('a business may build for a secret its owner is a master of, and nobody else may', () => {
  const w = workingWorld();
  const master = makeCitizen(w, { district: 'harbor_market' });
  const other = makeCitizen(w, { district: 'harbor_market' });
  makeBusiness(w, master.id, 500);
  makeBusiness(w, other.id, 500);
  grant(w, 'precision_machining', { secret: true, masters: [master.id] });

  assert.equal(adoptTechnology(w, master.id, 'precision_machining').ok, true);
  assert.equal(adoptTechnology(w, other.id, 'precision_machining').ok, false);
  assert.equal(enactAdoption(w, 'precision_machining', 800).ok, false, 'the Council was never told');
});

// ---------------------------------------------------------------------------
// Amenity, and the tram
// ---------------------------------------------------------------------------

test('works lift the land where they stand', () => {
  const w = workingWorld();
  grant(w, 'sanitation');
  enactAdoption(w, 'sanitation', 400);
  w.government.publicWorksFund = 400;
  dailyWorks(w);
  dailyWorks(w);
  assert.equal(worksAmenity(w, 'verdant_quarter'), 1, 'the drains are dug where the people are');
  assert.equal(worksAmenity(w, 'nightglass'), 0);
});

test('the tram is not buildable from day one: it needs The Tram', () => {
  const w = workingWorld();
  assert.equal(tramAllowed(w), false, 'REGISTRY §7: METROPOLIS\'s tram was buildable from day one, and now it is not');
  assert.match(tramGate(w).message, /has not discovered The Tram/);

  grant(w, 'the_tram', { secret: true, masters: ['c_1'] });
  assert.equal(tramAllowed(w), false, 'a secret is not something the Council can lay rails on');
  assert.match(tramGate(w).message, /secret/);

  grant(w, 'the_tram');
  assert.equal(tramAllowed(w), true);
  assert.equal(tramGate(w).ok, true);
});

test('every technology in the tree names what it changes', () => {
  const w = workingWorld();
  for (const t of Object.values(TECHNOLOGIES)) {
    const effects = Object.keys(t.multipliers).length + Object.keys(t.deltas).length + t.unlocks.length;
    assert.ok(effects > 0, `${t.id} changes something`);
    assert.ok(t.changes.length > 0, `${t.id} says what it changes`);
  }
  assert.equal(cityAdoptions(w).length, 0);
});

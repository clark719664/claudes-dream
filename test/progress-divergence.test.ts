/**
 * The rollover, and the thing the whole layer exists for: **two cities founded
 * the same day stop looking alike within a year** (`docs/PROGRESS.md` §5).
 *
 * Nothing in the engine assigns a city a speciality. The two cities below are
 * the same city on the same seed with the same buildings, the same money and
 * the same people; the only difference is which subjects their citizens chose
 * to open programmes on. A year later they are measurably different places.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, DistrictId, Job, Skills, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { TechnologyId } from '../src/progress/tree.ts';
import { openProject, openProjects, researchShift } from '../src/progress/projects.ts';
import { fundProject, purseOf } from '../src/progress/purse.ts';
import { adoptTechnology, enactAdoption } from '../src/progress/adoption.ts';
import {
  cityHolds, effectStrength, glitchOnsetMultiplier, heldTechnologies, outputMultiplier, trainShift,
} from '../src/progress/effects.ts';
import { dailyProgress, progressChronicle } from '../src/progress/daily.ts';
import { progressState } from '../src/progress/state.ts';

function skills(analysis: number): Skills {
  return { crafting: 20, analysis, rhetoric: 20, care: 20, commerce: 20, artistry: 20 };
}

function researcher(world: World, analysis = 90, district: DistrictId = 'archive'): Citizen {
  const c = makeCitizen(world, { district, skills: skills(analysis), wallet: 50_000 });
  const id = nextId(world, 'j');
  const job: Job = {
    id, role: 'researcher', title: 'Researcher', employer: 'city', buildingId: 'observatory',
    district: 'archive', skill: 'analysis', minSkill: 40, minReputation: 0, wage: 18,
    output: {}, holderId: c.id, createdDay: world.day,
  };
  world.jobs[id] = job;
  c.jobId = id;
  return c;
}

/** One day of the city's clock: shifts through the working hours, then the rollover. */
function liveADay(world: World, workers: Citizen[], projectId: string | null): void {
  for (let hour = 8; hour < 18; hour++) {
    world.hour = hour;
    world.tick = world.day * 24 + hour;
    if (!projectId) continue;
    for (const c of workers) researchShift(world, c.id, projectId);
  }
  world.day += 1;
  world.hour = 0;
  world.tick = world.day * 24;
  for (const c of workers) c.shiftsToday = 0;
  dailyProgress(world);
}

/**
 * Work a subject until the city holds it, reopening the programme whenever a
 * roll goes against them. Returns the days it took.
 */
function pursue(world: World, workers: Citizen[], subject: TechnologyId, days = 90): number {
  const lead = workers[0];
  let spent = 0;
  while (spent < days && !cityHolds(world, subject)) {
    let project = openProjects(world).find((p) => p.technology === subject) ?? null;
    if (!project) {
      const opened = openProject(world, lead.id, subject, `${subject} programme`);
      if (!opened.ok) return spent;
      project = openProjects(world).find((p) => p.technology === subject) ?? null;
    }
    if (!project) return spent;
    if (purseOf(world, project) < 400) fundProject(world, lead.id, project.id, 2_000);
    liveADay(world, workers, project.id);
    spent++;
  }
  return spent;
}

// ---------------------------------------------------------------------------
// The rollover
// ---------------------------------------------------------------------------

test('the rollover resolves what is finished, builds what is paid for, and reads the city', () => {
  const w = makeWorld();
  w.day = 0;
  const team = [researcher(w), researcher(w), researcher(w)];
  const supply = totalMoney(w);

  const days = pursue(w, team, 'crop_rotation');
  assert.ok(days > 0 && days < 90, `it took ${days} days`);
  assert.equal(cityHolds(w, 'crop_rotation'), true);
  assert.equal(totalMoney(w), supply, 'a year of research makes and destroys no lumens');

  // The Council votes the works, and the fund pays for them a day at a time.
  assert.equal(enactAdoption(w, 'crop_rotation', 400).ok, true);
  w.government.publicWorksFund = 400;
  dailyProgress(w);
  dailyProgress(w);
  assert.ok(effectStrength(w, 'crop_rotation') > 0, 'the works have started to tell');
  const lines = progressChronicle(w);
  assert.equal(lines.length, 4);
  assert.match(lines[0], /1 of 25 technologies held/);
});

test('a programme nobody works and nobody funds is let go, and the purse comes back', () => {
  const w = makeWorld();
  w.day = 0;
  w.hour = 10;
  w.tick = 10;
  const c = researcher(w);
  assert.equal(openProject(w, c.id, 'sanitation', 'The drains').ok, true);
  const p = openProjects(w)[0];
  assert.equal(fundProject(w, c.id, p.id, 100).ok, true);
  const supply = totalMoney(w);

  for (let i = 0; i < 20; i++) {
    w.day += 1;
    dailyProgress(w);
  }
  assert.equal(p.status, 'open', 'a funded programme is nobody\'s to close');

  // Spend the purse down and it is let go after a fortnight of silence.
  const purse = w.businesses[p.purseId];
  assert.ok(purse);
  purse.treasury = 0;
  w.treasury.balance += 100;
  for (let i = 0; i < 15; i++) {
    w.day += 1;
    dailyProgress(w);
  }
  assert.equal(p.status, 'abandoned');
  assert.equal(totalMoney(w), supply);
});

// ---------------------------------------------------------------------------
// Divergence
// ---------------------------------------------------------------------------

test('two cities founded the same day stop looking alike', () => {
  const cinderhold = makeWorld({ seed: 11 });
  const solene = makeWorld({ seed: 11 });
  cinderhold.day = 0;
  solene.day = 0;

  const forge = [researcher(cinderhold), researcher(cinderhold), researcher(cinderhold)];
  const ward = [researcher(solene), researcher(solene), researcher(solene)];

  // The same engine, the same seed, the same people. Different citizens
  // choosing different subjects — which is the whole of the difference.
  pursue(cinderhold, forge, 'blast_furnace');
  pursue(cinderhold, forge, 'the_lens');
  pursue(cinderhold, forge, 'precision_machining');

  pursue(solene, ward, 'sanitation');
  pursue(solene, ward, 'crop_rotation');

  const heldA = heldTechnologies(cinderhold);
  const heldB = heldTechnologies(solene);
  assert.ok(heldA.length >= 2, `Cinderhold held ${heldA.join(', ')}`);
  assert.ok(heldB.length >= 2, `Solene held ${heldB.join(', ')}`);
  assert.notDeepEqual(heldA, heldB, 'a year in, they are not the same city');
  assert.equal(heldA.includes('sanitation'), false);
  assert.equal(heldB.includes('precision_machining'), false);

  // And the difference is not a label: it is in the numbers the engine reads.
  for (const [world, subject] of [[cinderhold, 'blast_furnace'], [solene, 'sanitation']] as const) {
    if (!cityHolds(world, subject)) continue;
    assert.equal(enactAdoption(world, subject, 800).ok, true);
    world.government.publicWorksFund = 800;
    dailyProgress(world);
    dailyProgress(world);
    dailyProgress(world);
    dailyProgress(world);
  }
  for (const c of ward) for (let i = 0; i < 3; i++) trainShift(solene, c.id);

  assert.ok(glitchOnsetMultiplier(solene) < 1, 'Solene dug drains');
  assert.equal(glitchOnsetMultiplier(cinderhold), 1, 'Cinderhold did not');
  if (cityHolds(cinderhold, 'blast_furnace')) {
    assert.ok(outputMultiplier(cinderhold, { buildingId: 'power_station' }) > 1, 'Cinderhold rebuilt its furnace');
  }
  assert.equal(outputMultiplier(solene, { buildingId: 'power_station' }), 1);

  // Nothing in the engine chose either path: both registers were empty at the
  // founding, and every line in them was put there by a citizen's action.
  assert.equal(progressState(makeWorld({ seed: 11 })).technologies.blast_furnace, undefined);
});

test('a business can hold a technology its city\'s Council never voted for', () => {
  const w = makeWorld();
  w.day = 0;
  const team = [researcher(w), researcher(w)];
  pursue(w, team, 'the_loom');
  assert.equal(cityHolds(w, 'the_loom'), true);

  const owner = makeCitizen(w, { district: 'harbor_market', wallet: 100 });
  const id = nextId(w, 'b');
  w.businesses[id] = {
    id, name: 'The Quiet Loom', kind: 'workshop', ownerId: owner.id, treasury: 500,
    district: 'harbor_market', buildingId: 'shopfronts_harbor', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: w.day, rentPerDay: 0, daysNegative: 0,
    revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  owner.businessId = id;

  assert.equal(adoptTechnology(w, owner.id, 'the_loom').ok, true);
  assert.ok(effectStrength(w, 'the_loom', id) > 0, 'the workshop has it');
  assert.equal(effectStrength(w, 'the_loom'), 0, 'the city does not');
});

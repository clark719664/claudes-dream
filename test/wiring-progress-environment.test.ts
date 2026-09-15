/**
 * The wiring of research and the air into the city (`docs/PROGRESS.md`,
 * `docs/ENVIRONMENT.md`, `REGISTRY.md` §3).
 *
 * Both layers were built and tested in isolation. What is asserted here is the
 * thing isolation cannot show: that every action either of them added is
 * **reachable** — in the catalogue, through `validateAction`, out the far side
 * of `executeAction` into the module that owns it — that the hours they keep
 * are kept by the morning rollover, that a worked shift is counted in the air
 * above the district and in the hands trained under the works, and that the
 * land value the whole property layer runs on now reads the night's air.
 *
 * The lesson this file exists for is written in the repository's history:
 * mobility and property shipped as working functions that nothing called for
 * a whole phase, and reflex citizens never touched sponsorship until somebody
 * gave them a reason to.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import type { World } from '../src/types.ts';
import { ACTION_TYPES, ENVIRONMENT_ACTIONS, PROGRESS_ACTIONS } from '../src/types.ts';
import { ACTION_CATALOGUE } from '../src/data/actions.ts';
import { LAWS } from '../src/data/laws.ts';
import { availableActions, executeAction, validateAction } from '../src/actions/execute.ts';
import { dailyRollover } from '../src/world/daily.ts';
import { createCityJobs, workShift } from '../src/economy/jobs.ts';
import { recomputeLand } from '../src/economy/land.ts';
import { deliverToMarket } from '../src/economy/market.ts';
import { transfer } from '../src/economy/treasury.ts';
import { enactProposal } from '../src/government/council.ts';
import { enactTram } from '../src/world/growth.ts';
import { progressState } from '../src/progress/state.ts';
import { cityHolds, heldTechnologies, isFamiliar, tramAllowed } from '../src/progress/effects.ts';
import { openProjects, projectById } from '../src/progress/projects.ts';
import { purseOf } from '../src/progress/purse.ts';
import { environmentState, fittingOn, permitOf } from '../src/environment/state.ts';
import { emittersToday } from '../src/environment/emissions.ts';
import { districtEnvironment } from '../src/environment/state.ts';

const HOOKS = { guard: <T>(_w: World, _where: string, fn: () => T) => fn(), autosave: () => {} };

/** A city with the posts the two layers need, and somebody able to work them. */
function city(): { world: World; a: string; b: string } {
  const world = makeWorld();
  createCityJobs(world);
  const a = makeCitizen(world, { name: 'Ilse', district: 'archive' });
  const b = makeCitizen(world, { name: 'Bram', district: 'archive' });
  a.wallet = 800;
  b.wallet = 800;
  a.skills.analysis = 70;
  b.skills.analysis = 70;
  return { world, a: a.id, b: b.id };
}

/** Put a citizen in the Observatory's Researcher post. */
function seatResearcher(world: World, cId: string): void {
  const job = Object.values(world.jobs).find((j) => j.role === 'researcher' && j.holderId === null);
  assert.ok(job, 'the founding city has a Researcher post');
  job.holderId = cId;
  world.citizens[cId].jobId = job.id;
}

// ---------------------------------------------------------------------------
// Reachable
// ---------------------------------------------------------------------------

test('every progress and environment action is in the catalogue the whole city reads from', () => {
  for (const type of [...PROGRESS_ACTIONS, ...ENVIRONMENT_ACTIONS]) {
    assert.ok(ACTION_TYPES.includes(type), `${type} is missing from ACTION_TYPES`);
    const spec = ACTION_CATALOGUE[type];
    assert.ok(spec, `${type} has no line in the action catalogue`);
    assert.ok(spec.text.length > 20, `${type}'s catalogue line says nothing`);
  }
  // Nine in `PROGRESS.md` §8 and nine in `ENVIRONMENT.md` §9.
  assert.equal(PROGRESS_ACTIONS.length, 9);
  assert.equal(ENVIRONMENT_ACTIONS.length, 9);
});

/** One well-formed call of every action, as a mind outside the engine would send it. */
const SAMPLES: Record<string, Record<string, unknown>> = {
  open_project: { technology: 'the_lens', name: 'A better glass' },
  research: { projectId: 'rp_1' },
  fund_project: { projectId: 'rp_1', amount: 50 },
  adopt_technology: { technology: 'the_loom' },
  publish_finding: { projectId: 'rp_1' },
  keep_secret: { projectId: 'rp_1' },
  take_apprentice: { citizen: 'c_2', technology: 'the_loom' },
  teach_technology: { technology: 'the_loom' },
  sell_secret: { to: 'c_2', technology: 'the_loom', price: 100 },
  install_abatement: { building: 'compute_forge', fitting: 'filter' },
  maintain_abatement: { building: 'compute_forge' },
  discharge: { building: 'compute_forge' },
  survey_air: { district: 'foundry_row' },
  survey_water: { district: 'foundry_row' },
  plant_trees: { district: 'commons' },
  petition_zoning: { district: 'foundry_row', permit: 'residential' },
  declare_interest: { proposal: 'p_1' },
  file_nuisance: { against: 'c_2', district: 'foundry_row' },
};

test('validateAction takes every one of them from outside the engine', () => {
  for (const type of [...PROGRESS_ACTIONS, ...ENVIRONMENT_ACTIONS]) {
    const sample = SAMPLES[type];
    assert.ok(sample, `${type} has no sample call in this test`);
    const parsed = validateAction({ type, ...sample });
    assert.ok(parsed.ok, `${type} was refused by validateAction: ${parsed.ok ? '' : parsed.error}`);
  }
});

test('executeAction hands every one of them to the layer that owns it', () => {
  const { world, a } = city();
  for (const type of [...PROGRESS_ACTIONS, ...ENVIRONMENT_ACTIONS]) {
    const parsed = validateAction({ type, ...SAMPLES[type] });
    assert.ok(parsed.ok);
    const result = executeAction(world, a, parsed.action);
    // Most are refused on the facts — no such programme, no fitting on that
    // stack, nobody to sue — and that is the point: the refusal comes from the
    // module, never from a dispatcher that has never heard of the action.
    assert.doesNotMatch(result.message, /has no .* to offer|Unknown action/,
      `${type} fell through the dispatcher: ${result.message}`);
  }
});

test('the seven measures either layer puts to the Council are proposals the city can table', () => {
  const kinds = [
    'research_grant', 'adopt_technology',
    'zone', 'conserve', 'emission_charge', 'host_payment', 'abatement_works', 'relocate_works', 'buy_out',
  ];
  for (const kind of kinds) {
    const parsed = validateAction({
      type: 'propose', kind, value: 1, summary: `a measure of kind ${kind}`,
      district: 'foundry_row', permit: 'residential', building: 'compute_forge', fitting: 'filter', subject: 'rp_1',
    });
    assert.ok(parsed.ok, `propose ${kind} was refused by validateAction`);
  }
});

// ---------------------------------------------------------------------------
// Exercised: a programme opened, funded, worked and published
// ---------------------------------------------------------------------------

test('a programme is opened, funded, worked and published through the ordinary action table', () => {
  const { world, a, b } = city();
  world.hour = 10;
  seatResearcher(world, a);
  const before = totalMoney(world);
  deliverToMarket(world, 'knowledge', 20);

  const opened = executeAction(world, a, { type: 'open_project', technology: 'the_lens', name: 'A better glass' });
  assert.ok(opened.ok, opened.message);
  const project = openProjects(world)[0];
  assert.ok(project, 'the register holds the programme');
  assert.ok(availableActions(world, world.citizens[b]).includes('fund_project'), 'a patron is offered the purse');

  const funded = executeAction(world, b, { type: 'fund_project', projectId: project.id, amount: 400 });
  assert.ok(funded.ok, funded.message);
  assert.equal(purseOf(world, project), 400, 'the lumens are in the purse and nowhere else');
  // A purse is a strongbox, which is a holder of real lumens the daily audit
  // already sums (`REGISTRY.md` §5): the money moved, and none was made.
  assert.equal(totalMoney(world), before, 'a purse holds real lumens, out of the wallets they came from');

  assert.ok(availableActions(world, world.citizens[a]).includes('research'), 'the hour is on offer once the purse can pay');
  const worked = executeAction(world, a, { type: 'research', projectId: project.id });
  assert.ok(worked.ok, worked.message);
  assert.ok(project.progress > 0, 'the hour is on the board');
  assert.ok(project.shifts[a] === 1, 'and against the name that worked it');

  // Finish it by hand and let the morning put it to the test.
  project.progress = project.cost;
  dailyRollover(world, HOOKS);
  assert.notEqual(project.status, 'open', 'a programme at its cost is resolved on the rollover');
  if (project.status === 'succeeded') {
    assert.ok(cityHolds(world, 'the_lens'), 'a discovery is in the register the morning it lands');
    const published = executeAction(world, a, { type: 'publish_finding', projectId: project.id });
    assert.ok(published.ok, published.message);
    assert.equal(projectById(world, project.id)?.finding, 'published');
  }
});

// ---------------------------------------------------------------------------
// Exercised: what a shift leaves behind, and what it learns
// ---------------------------------------------------------------------------

test('a worked shift is counted in the air above the district and in the hands trained under the works', () => {
  const world = makeWorld();
  createCityJobs(world);
  const c = makeCitizen(world, { name: 'Fen', district: 'foundry_row' });
  c.skills.crafting = 60;
  const job = Object.values(world.jobs).find((j) => j.role === 'forge_operator' && j.holderId === null);
  assert.ok(job);
  job.holderId = c.id;
  c.jobId = job.id;
  world.hour = 10;
  deliverToMarket(world, 'energy', 50);

  // The city has built the works for a subject, so a shift under them trains.
  const s = progressState(world);
  s.technologies.the_loom = {
    id: 'the_loom', discoveredDay: 0, projectId: null, secret: false, masters: [], lostDay: null, source: 'research',
  };
  s.adoptions.the_loom = {
    technology: 'the_loom', businessId: null, worksPaid: 400, worksCost: 400,
    startedDay: 0, shifts: {}, trained: [], districts: ['foundry_row'],
  };

  for (let i = 0; i < 3; i++) {
    c.shiftsToday = 0;
    const r = workShift(world, c.id);
    assert.ok(r.ok, r.message);
  }
  const emitted = emittersToday(world);
  assert.ok(emitted.length > 0, 'a shift at the Forge is in the day\'s counter');
  assert.ok(emitted[0].motes > 0, 'and it is a number of motes, not nothing');
  assert.equal(emitted[0].district, 'foundry_row');
  assert.ok(isFamiliar(world, c.id, 'the_loom'), 'three shifts under the works make a trained hand');
});

test('the morning settles the air, and the land value reads it', () => {
  const world = makeWorld();
  createCityJobs(world);
  const clean = recomputeLand(world).foundry_row.amenity;
  districtEnvironment(world, 'foundry_row').air = 0.6;
  const sooty = recomputeLand(world).foundry_row.value;
  districtEnvironment(world, 'foundry_row').air = 0;
  const clear = recomputeLand(world).foundry_row.value;
  assert.ok(clear > sooty, 'a district under its own smoke is worth less than one that is not');
  assert.ok(clean >= 0);

  // And the rollover settles it: the register carries a day and mirrors it.
  world.day = 1;
  dailyRollover(world, HOOKS);
  assert.equal(environmentState(world).settledDay, 1, 'the air settles once a morning');
  assert.equal(world.counters['env:asOfDay'], 1, 'and is mirrored where the rest of the engine reads it');
});

// ---------------------------------------------------------------------------
// The Council's own door
// ---------------------------------------------------------------------------

test('a zoning measure carried by the Council changes what the district may be built for', () => {
  const { world, a } = city();
  const tabled = executeAction(world, a, {
    type: 'propose', kind: 'zone', value: 0, district: 'foundry_row', permit: 'residential',
    summary: 'Zone Foundry Row residential',
  });
  assert.ok(tabled.ok, tabled.message);
  const p = world.government.proposals[0];
  assert.ok(p, 'the measure is before the Council like any other');
  enactProposal(world, p);
  assert.equal(permitOf(world, 'foundry_row'), 'residential', 'a carried measure moves the permit');
});

test('the works and a grant are enacted by the Council through the same door as any other spend', () => {
  const { world, a } = city();
  world.hour = 10;
  seatResearcher(world, a);
  deliverToMarket(world, 'knowledge', 20);
  executeAction(world, a, { type: 'open_project', technology: 'the_lens', name: 'A better glass' });
  const project = openProjects(world)[0];
  const before = totalMoney(world);
  enactProposal(world, {
    id: 'p_9', kind: 'research_grant', value: 300, lawCode: null, targetId: null, subject: project.id,
    summary: 'A grant', proposerId: a, petition: false, tabledDay: 0, status: 'passed', votes: {},
    decidedDay: 0, needed: 3,
  });
  assert.equal(purseOf(world, project), 300, 'the Treasury pays into the named purse');
  assert.equal(totalMoney(world), before, 'and nothing is minted on the way');

  progressState(world).technologies.the_loom = {
    id: 'the_loom', discoveredDay: 0, projectId: null, secret: false, masters: [], lostDay: null, source: 'research',
  };
  world.government.publicWorksFund = 500;
  enactProposal(world, {
    id: 'p_10', kind: 'adopt_technology', value: 400, lawCode: null, targetId: null, subject: 'the_loom',
    summary: 'Build the works for The Loom', proposerId: a, petition: false, tabledDay: 0, status: 'passed',
    votes: {}, decidedDay: 0, needed: 3,
  });
  world.day += 1;
  dailyRollover(world, HOOKS);
  const adoption = progressState(world).adoptions.the_loom;
  assert.ok(adoption && adoption.worksPaid > 0, 'the fund pays the works a day at a time');
});

test('the city fits a stack out of public works, and the fitting is then a job somebody works', () => {
  const world = makeWorld();
  createCityJobs(world);
  const c = makeCitizen(world, { name: 'Perrin', district: 'foundry_row' });
  const job = Object.values(world.jobs).find((j) => j.role === 'forge_operator' && j.holderId === null);
  assert.ok(job);
  job.holderId = c.id;
  c.jobId = job.id;
  world.hour = 10;
  world.government.publicWorksFund = 500;
  enactProposal(world, {
    id: 'p_11', kind: 'abatement_works', value: 250, lawCode: null, targetId: null,
    summary: 'Fit a filter at the Compute Forge', proposerId: c.id, petition: false, tabledDay: 0,
    status: 'passed', votes: {}, decidedDay: 0, needed: 3,
  });
  // The question a Proposal cannot carry is filed beside it, so the enactment
  // reads the building and the fitting off the register.
  environmentState(world).zoning.p_11 = {
    proposalId: 'p_11', kind: 'abatement_works', district: 'foundry_row', permit: null,
    building: 'compute_forge', fitting: 'filter', value: 250, tabledDay: 0, petition: false, settledDay: null,
  };
  enactProposal(world, world.government.proposals[0] ?? {
    id: 'p_11', kind: 'abatement_works', value: 250, lawCode: null, targetId: null,
    summary: 'Fit a filter at the Compute Forge', proposerId: c.id, petition: false, tabledDay: 0,
    status: 'passed', votes: {}, decidedDay: 0, needed: 3,
  });
  const fitted = fittingOn(world, 'compute_forge');
  assert.ok(fitted, 'the city fitted the stack out of the fund');
  fitted.effect = 0.5;
  assert.ok(availableActions(world, c).includes('maintain_abatement'), 'holding it is a shift the hands there may work');
  const held = executeAction(world, c.id, { type: 'maintain_abatement', building: 'compute_forge' });
  assert.ok(held.ok, held.message);
  assert.equal(fittingOn(world, 'compute_forge')?.effect, 1, 'and it is back at its rated effect');
});

// ---------------------------------------------------------------------------
// The gate, the code and the people who may not
// ---------------------------------------------------------------------------

test('the tram waits on The Tram, whatever the fund holds', () => {
  const world = makeWorld();
  world.government.publicWorksFund = 100_000;
  assert.equal(tramAllowed(world), false);
  assert.equal(enactTram(world), null, 'a city that has not discovered it lays no line');
  progressState(world).technologies.the_tram = {
    id: 'the_tram', discoveredDay: 0, projectId: null, secret: false, masters: [], lostDay: null, source: 'research',
  };
  assert.equal(tramAllowed(world), true);
  assert.ok(enactTram(world), 'and one that has, lays one');
});

test('the five codes both layers add are on the ladder, and not one of them is a cell', () => {
  for (const code of ['L41', 'L42', 'L45', 'L46', 'L47'] as const) {
    const law = LAWS[code];
    assert.ok(law, `${code} is in the Code of the City`);
    assert.ok(law.severity >= 2 && law.severity <= 3, `${code} sits where REGISTRY.md §4 puts it`);
    assert.ok(law.visibility > 0 && law.visibility <= 1);
  }
  assert.equal(heldTechnologies(makeWorld()).length, 0, 'a founding city knows nothing yet');
});

test('a child is offered nothing of either layer but a sapling, and refused the rest if it asks', () => {
  const { world, a } = city();
  const child = world.citizens[a];
  child.lifeStage = 'child';
  const offered = availableActions(world, child);
  for (const type of [...PROGRESS_ACTIONS, ...ENVIRONMENT_ACTIONS]) {
    if (type === 'plant_trees') continue;
    assert.ok(!offered.includes(type), `a child is offered ${type}`);
  }
  const refused = executeAction(world, a, { type: 'research', projectId: 'rp_1' });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /child/i);
});

test('a suspended citizen may not research, fund, fit or read the air', () => {
  const { world, a } = city();
  world.citizens[a].standing = 'suspended';
  const offered = availableActions(world, world.citizens[a]);
  for (const type of [...PROGRESS_ACTIONS, ...ENVIRONMENT_ACTIONS]) {
    assert.ok(!offered.includes(type), `a suspended citizen is offered ${type}`);
  }
  const refused = executeAction(world, a, { type: 'survey_air', district: 'archive' });
  assert.equal(refused.ok, false);
});

test('the money supply is whole after a morning of both layers', () => {
  const { world, a, b } = city();
  world.hour = 10;
  seatResearcher(world, a);
  deliverToMarket(world, 'knowledge', 20);
  transfer(world, 'treasury', b, 200, 'grant', 'a patron\'s means');
  const before = totalMoney(world);
  executeAction(world, a, { type: 'open_project', technology: 'the_lens', name: 'A better glass' });
  const project = openProjects(world)[0];
  executeAction(world, b, { type: 'fund_project', projectId: project.id, amount: 200 });
  executeAction(world, a, { type: 'research', projectId: project.id });
  executeAction(world, b, { type: 'plant_trees', district: 'archive' });
  world.day += 1;
  dailyRollover(world, HOOKS);
  // Everything the two layers moved is a transfer between parties that already
  // existed, and a purse is one of them (`REGISTRY.md` §5) — a strongbox the
  // supply already counts. So the sum is exactly what it was.
  assert.equal(totalMoney(world), before, 'no lumen was minted or burned by either layer');
});

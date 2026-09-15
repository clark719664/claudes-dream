/**
 * Research projects and the tree (`docs/PROGRESS.md` §§1–2).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { CitizenId, DistrictId, Job, Skills, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  BRANCHES, TECHNOLOGIES, TECHNOLOGY_IDS, costsOf, missingPrerequisites, openSubjects, prerequisitesMet,
  progressCost, technologiesIn, volumesRequired, worksCost,
} from '../src/progress/tree.ts';
import { progressState } from '../src/progress/state.ts';
import {
  RESEARCH_MIN_ANALYSIS, abandonProject, insightOf, openProject, openProjects, projectById,
  readyToResolve, researchShift, resolveProject, successChance,
} from '../src/progress/projects.ts';
import { contributorsOf, enactResearchGrant, fundProject, purseOf } from '../src/progress/purse.ts';
import { cityHolds, heldTechnologies, isMasterOf } from '../src/progress/effects.ts';
import { progressObservation } from '../src/progress/observe.ts';

// ---------------------------------------------------------------------------
// Scaffolding
// ---------------------------------------------------------------------------

function skills(analysis: number): Skills {
  return { crafting: 20, analysis, rhetoric: 20, care: 20, commerce: 20, artistry: 20 };
}

function workingWorld(): World {
  const w = makeWorld();
  w.tick = 10;
  w.hour = 10;
  return w;
}

/** A citizen holding the Observatory's post, standing in the Archive. */
function researcher(world: World, analysis = 60, wallet = 1_000, district: DistrictId = 'archive') {
  const c = makeCitizen(world, { district, skills: skills(analysis), wallet });
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

/** Open a funded programme and hand back the project. */
function fundedProject(world: World, cId: CitizenId, subject = 'crop_rotation', purse = 600) {
  const opened = openProject(world, cId, subject, 'The rotation trials');
  assert.equal(opened.ok, true, opened.message);
  const p = openProjects(world)[0];
  assert.equal(fundProject(world, cId, p.id, purse).ok, true);
  return p;
}

// ---------------------------------------------------------------------------
// The tree
// ---------------------------------------------------------------------------

test('the tree is the table in PROGRESS.md §2', () => {
  assert.equal(TECHNOLOGY_IDS.length, 25, 'twenty-five technologies');
  assert.equal(BRANCHES.length, 5);
  const counted = BRANCHES.reduce((n, b) => n + technologiesIn(b).length, 0);
  assert.equal(counted, 25, 'every technology sits in exactly one branch');
  for (const id of TECHNOLOGY_IDS) {
    const t = TECHNOLOGIES[id];
    assert.ok(t.tier >= 1 && t.tier <= 4, `${id} has a tier`);
    for (const need of t.needs) {
      assert.ok(TECHNOLOGIES[need], `${id} needs a subject that exists`);
      assert.ok(TECHNOLOGIES[need].tier < t.tier, `${id} sits deeper than ${need}`);
    }
  }
});

test('the shallowest subjects are open on founding day and the rest are gated', () => {
  const open = openSubjects([]);
  assert.ok(open.length > 0);
  for (const id of open) assert.equal(TECHNOLOGIES[id].tier, 1, `${id} needs nothing`);
  assert.ok(!open.includes('the_tram'), 'the tram is not open on day one');
  assert.deepEqual(missingPrerequisites([], 'the_tram'), ['blast_furnace', 'precision_machining']);
  assert.equal(prerequisitesMet(['blast_furnace', 'precision_machining'], 'the_tram'), true);
});

test('a subject costs 40, 6 and 400 per tier', () => {
  assert.equal(progressCost(1), 40);
  assert.equal(volumesRequired(2), 12);
  assert.equal(worksCost(3), 1_200);
  assert.deepEqual(costsOf('the_glasshouse'), { progress: 160, volumes: 24, works: 1_600 });
});

// ---------------------------------------------------------------------------
// Opening one
// ---------------------------------------------------------------------------

test('only a Researcher standing in a reading room may open a programme', () => {
  const w = workingWorld();
  const outsider = makeCitizen(w, { district: 'archive', skills: skills(80) });
  assert.equal(openProject(w, outsider.id, 'crop_rotation').ok, false);

  const c = researcher(w);
  c.district = 'harbor_market';
  const away = openProject(w, c.id, 'crop_rotation');
  assert.equal(away.ok, false);
  assert.match(away.message, /observatory or university/);

  c.district = 'archive';
  const ok = openProject(w, c.id, 'crop_rotation', 'The rotation trials');
  assert.equal(ok.ok, true, ok.message);
  const p = openProjects(w)[0];
  assert.equal(p.technology, 'crop_rotation');
  assert.equal(p.cost, 40);
  assert.equal(p.volumesRequired, 6);
  assert.equal(purseOf(w, p), 0, 'a programme opens with an empty purse');
});

test('a programme cannot be opened on a subject the city lacks the prerequisites for', () => {
  const w = workingWorld();
  const c = researcher(w);
  const r = openProject(w, c.id, 'the_tram');
  assert.equal(r.ok, false);
  assert.match(r.message, /Blast Furnace and Precision Machining/);
});

test('an unknown subject is refused, not thrown', () => {
  const w = workingWorld();
  const c = researcher(w);
  assert.equal(openProject(w, c.id, 'perpetual_motion').ok, false);
  assert.equal(openProjects(w).length, 0);
});

test('two programmes cannot run on the same subject at once', () => {
  const w = workingWorld();
  const a = researcher(w);
  assert.equal(openProject(w, a.id, 'crop_rotation').ok, true);
  const second = openProject(w, a.id, 'crop_rotation');
  assert.equal(second.ok, false);
  assert.match(second.message, /already being worked on/);
});

// ---------------------------------------------------------------------------
// The purse
// ---------------------------------------------------------------------------

test('a purse holds real lumens and the money supply never moves', () => {
  const w = workingWorld();
  const c = researcher(w);
  const before = totalMoney(w);
  const p = fundedProject(w, c.id, 'crop_rotation', 500);
  assert.equal(purseOf(w, p), 500);
  assert.equal(c.wallet, 500);
  assert.equal(totalMoney(w), before, 'lumens moved, none were made');
});

test('the Council funds a purse by grant, and the remainder comes back at the end', () => {
  const w = workingWorld();
  const c = researcher(w);
  const p = fundedProject(w, c.id, 'crop_rotation', 200);
  const treasuryBefore = w.treasury.balance;
  assert.equal(enactResearchGrant(w, p.id, 300).ok, true);
  assert.equal(w.treasury.balance, treasuryBefore - 300);
  assert.equal(purseOf(w, p), 500);

  const supply = totalMoney(w);
  abandonProject(w, p.id, 'the test is over');
  assert.equal(purseOf(w, p), 0, 'the purse is empty when the programme closes');
  assert.equal(c.wallet, 1_000, 'the patron got their whole share back');
  assert.equal(w.treasury.balance, treasuryBefore, 'the Council got its own back');
  assert.equal(totalMoney(w), supply);
});

test('a patron who is not a citizen of the city cannot fund, and a bad amount is refused', () => {
  const w = workingWorld();
  const c = researcher(w);
  const p = fundedProject(w, c.id, 'crop_rotation', 10);
  assert.equal(fundProject(w, 'c_nobody', p.id, 20).ok, false);
  assert.equal(fundProject(w, c.id, p.id, 0).ok, false);
  assert.equal(fundProject(w, c.id, p.id, 5_000).ok, false, 'nobody funds what they cannot pay');
});

// ---------------------------------------------------------------------------
// A shift
// ---------------------------------------------------------------------------

test('an empty purse stops the work', () => {
  const w = workingWorld();
  const c = researcher(w);
  assert.equal(openProject(w, c.id, 'crop_rotation').ok, true);
  const p = openProjects(w)[0];
  const r = researchShift(w, c.id, p.id);
  assert.equal(r.ok, false);
  assert.match(r.message, /purse/);
  assert.equal(p.progress, 0);
});

test('a shift buys a volume, pays a wage and adds insight on the formula', () => {
  const w = workingWorld();
  const c = researcher(w, 40);
  const p = fundedProject(w, c.id, 'crop_rotation', 600);
  const supply = totalMoney(w);
  const purseBefore = purseOf(w, p);

  const r = researchShift(w, c.id, p.id);
  assert.equal(r.ok, true, r.message);
  // (0.6 + 0.9 × 0.40) × (0.7 + 0.3) × 1 = 0.96 an hour at the post's minimum.
  assert.ok(Math.abs(p.progress - 0.96) < 0.001, `insight was ${p.progress}`);
  assert.equal(p.volumesSpent, 1);
  assert.equal(p.volumesOnHand, 0);
  assert.equal(p.shifts[c.id], 1);
  assert.equal(c.shiftsToday, 1);
  assert.ok(purseOf(w, p) < purseBefore, 'the purse paid for the volume and the hour');
  assert.equal(totalMoney(w), supply, 'no lumens were made or destroyed');
});

test('colleagues on the same subject the same day are worth up to a third more', () => {
  const w = workingWorld();
  const a = researcher(w, 40, 4_000);
  const p = fundedProject(w, a.id, 'crop_rotation', 2_000);
  const helpers = [researcher(w, 40), researcher(w, 40), researcher(w, 40), researcher(w, 40)];
  assert.ok(Math.abs(insightOf(w, a, true, 0) - 0.96) < 0.001);
  assert.ok(Math.abs(insightOf(w, a, true, 3) - 0.96 * 1.36) < 0.001);
  assert.ok(Math.abs(insightOf(w, a, true, 9) - 0.96 * 1.36) < 0.001, 'the colleagues term is capped');
  assert.ok(insightOf(w, a, false, 0) < insightOf(w, a, true, 0), 'a shelf with nothing on it is worth less');
  assert.equal(helpers.length, 4);
});

test('a citizen without the analysis for it is turned away from the reading room', () => {
  const w = workingWorld();
  const c = researcher(w, 60);
  const p = fundedProject(w, c.id, 'crop_rotation', 600);
  const dull = makeCitizen(w, { district: 'archive', skills: skills(RESEARCH_MIN_ANALYSIS - 5) });
  const r = researchShift(w, dull.id, p.id);
  assert.equal(r.ok, false);
  assert.match(r.message, /analysis/);
});

test('anyone with analysis enough may work a programme they did not open', () => {
  const w = workingWorld();
  const c = researcher(w, 60);
  const p = fundedProject(w, c.id, 'crop_rotation', 600);
  const helper = makeCitizen(w, { district: 'archive', skills: skills(50) });
  const r = researchShift(w, helper.id, p.id);
  assert.equal(r.ok, true, r.message);
  assert.equal(p.shifts[helper.id], 1);
  assert.ok(helper.wallet > 200, 'the purse paid them for the hour');
});

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

test('the chance of a finding sits between a fifth and nine tenths', () => {
  const w = workingWorld();
  const c = researcher(w, 100, 6_000);
  const p = fundedProject(w, c.id, 'crop_rotation', 4_000);
  p.shifts[c.id] = 5;
  p.volumesSpent = 0;
  const low = successChance(w, p);
  assert.ok(low >= 0.2 && low <= 0.9);
  p.volumesSpent = p.volumesRequired * 4;
  assert.ok(successChance(w, p) > low, 'volumes read make a finding likelier');
  assert.ok(successChance(w, p) <= 0.9);
});

test('a programme that reaches its cost is put to the test on the rollover', () => {
  const w = workingWorld();
  const c = researcher(w, 100, 6_000);
  const p = fundedProject(w, c.id, 'crop_rotation', 4_000);
  assert.equal(readyToResolve(p), false);
  p.progress = p.cost;
  assert.equal(readyToResolve(p), true);
});

/** Resolve a project over and over until it lands the way the test needs it. */
function resolveUntil(world: World, projectId: string, want: boolean): void {
  const p = projectById(world, projectId);
  assert.ok(p);
  for (let i = 0; i < 80; i++) {
    p.status = 'open';
    p.progress = p.cost;
    const won = resolveProject(world, p);
    if (won === want) return;
  }
  assert.fail(`the programme never ${want ? 'succeeded' : 'failed'}`);
}

test('a finding writes the subject into the register and makes masters of the hands that found it', () => {
  const w = workingWorld();
  const c = researcher(w, 100, 6_000);
  const p = fundedProject(w, c.id, 'crop_rotation', 4_000);
  p.shifts[c.id] = 5;
  p.volumesSpent = p.volumesRequired;
  resolveUntil(w, p.id, true);

  assert.equal(p.status, 'succeeded');
  assert.equal(cityHolds(w, 'crop_rotation'), true);
  assert.deepEqual(heldTechnologies(w), ['crop_rotation']);
  assert.equal(purseOf(w, p), 0, 'the purse came back to whoever filled it');
  // Nothing is a secret until somebody keeps it, so nobody is a "master" of it.
  assert.equal(isMasterOf(w, c.id, 'crop_rotation'), false);
  const rec = progressState(w).technologies.crop_rotation;
  assert.deepEqual(rec?.masters, [c.id], 'the register remembers who did the work');
});

test('a dead end is not a punishment: 40 % of the work and two volumes are left behind', () => {
  const w = workingWorld();
  const c = researcher(w, 30, 6_000);
  const p = fundedProject(w, c.id, 'crop_rotation', 4_000);
  p.shifts[c.id] = 1;
  const shelf = w.market.goods.knowledge.stock;
  resolveUntil(w, p.id, false);

  assert.equal(p.status, 'failed');
  assert.equal(cityHolds(w, 'crop_rotation'), false);
  assert.equal(w.market.goods.knowledge.stock, shelf + 2, 'two volumes went back on the shelf');
  const salvage = progressState(w).salvage.crop_rotation ?? 0;
  assert.ok(Math.abs(salvage - p.cost * 0.4) < 0.5, `salvage was ${salvage}`);

  // And anybody may reopen the subject from what was left.
  const next = openProject(w, c.id, 'crop_rotation', 'The second trials');
  assert.equal(next.ok, true, next.message);
  const reopened = openProjects(w)[0];
  assert.ok(Math.abs(reopened.progress - salvage) < 0.001, 'the new programme starts from the salvage');
  assert.equal(progressState(w).salvage.crop_rotation, undefined, 'salvage is taken up once');
});

test('the observation carries the programmes, the purse and who is on them', () => {
  const w = workingWorld();
  const c = researcher(w, 60);
  const p = fundedProject(w, c.id, 'crop_rotation', 400);
  assert.equal(researchShift(w, c.id, p.id).ok, true);
  const obs = progressObservation(w, c.id);
  assert.equal(obs.projects.length, 1);
  assert.equal(obs.projects[0].technology, 'crop_rotation');
  assert.equal(obs.projects[0].funder, c.name);
  assert.ok(obs.projects[0].purse > 0);
  assert.deepEqual(obs.projects[0].researchers, [c.id]);
  assert.deepEqual(obs.held, []);
  assert.deepEqual(obs.youAreAMasterOf, []);
  assert.deepEqual(contributorsOf(p), [c.id]);
});

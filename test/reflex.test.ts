import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import { SUSPENDED_ACTIONS } from '../src/types.ts';
import type { Action, Citizen, World } from '../src/types.ts';
import { isAdjacent } from '../src/data/city.ts';
import { createCityJobs, applyForJob, isQualified } from '../src/economy/jobs.ts';
import { executeAction } from '../src/actions/execute.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { reflexBrain, reflexDecide } from '../src/brains/reflex.ts';

function at(world: World, day: number, hour: number): void {
  world.day = day;
  world.hour = hour;
  world.tick = day * 24 + hour;
}

function decide(world: World, c: Citizen): Action {
  return reflexDecide(world, c, buildObservation(world, c.id));
}

/** A settled citizen: housed, fed, rested, content, so only the situation under test drives the choice. */
function settled(world: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const c = makeCitizen(world, { homeTier: 1, ...overrides });
  world.housing.occupied[1] += 1;
  return c;
}

test('a hungry citizen eats what it has, or buys a cycle; when the Bazaar is empty it looks for the clinic or friends', () => {
  const w = makeWorld();
  at(w, 1, 12);
  const c = settled(w, { wallet: 100, district: 'commons' });
  c.needs.energy = 25;
  assert.deepEqual(decide(w, c), { type: 'eat' });
  const r = executeAction(w, c.id, decide(w, c));
  assert.equal(r.ok, true);
  assert.equal(c.needs.energy, 65);

  c.needs.energy = 25;
  c.inventory.compute = 1;
  assert.deepEqual(decide(w, c), { type: 'eat' });

  c.inventory.compute = 0;
  w.market.goods.compute.stock = 0;
  createCityJobs(w);
  const medic = Object.values(w.jobs).find((j) => j.role === 'medic')!;
  const doctor = makeCitizen(w, { district: 'verdant_quarter' });
  doctor.skills.care = 40;
  applyForJob(w, doctor.id, medic.id);
  const a = decide(w, c);
  assert.deepEqual(a, { type: 'move', district: 'verdant_quarter' }, 'heads for the Restoration Ward in a shortage');
  c.district = 'verdant_quarter';
  assert.deepEqual(decide(w, c), { type: 'visit_clinic' });
});

test('starving, broke and dishonest with a mark at hand: steal; honest citizens do not', () => {
  const w = makeWorld();
  at(w, 1, 12);
  w.market.goods.compute.stock = 0;
  const mark = makeCitizen(w, { district: 'threshold', wallet: 200 });
  const rogue = settled(w, { district: 'threshold', wallet: 0, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.2, ambition: 0.5 } });
  rogue.needs.energy = 15;
  assert.deepEqual(decide(w, rogue), { type: 'steal', from: mark.id });
  const saint = settled(w, { district: 'threshold', wallet: 0, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.9, ambition: 0.5 } });
  saint.needs.energy = 15;
  assert.notEqual(decide(w, saint).type, 'steal');
});

test('an unemployed citizen applies for a job it qualifies for in work hours, then commutes and works', () => {
  const w = makeWorld();
  createCityJobs(w);
  at(w, 1, 9);
  const c = settled(w, { district: 'commons' });
  const a = decide(w, c);
  assert.equal(a.type, 'apply_job');
  const job = w.jobs[(a as { jobId: string }).jobId];
  assert.ok(isQualified(w, c, job), 'only applies where qualified');
  assert.equal(executeAction(w, c.id, a).ok, true);
  assert.equal(c.jobId, job.id);

  for (let guard = 0; guard < 4 && c.district !== job.district; guard++) {
    const step = decide(w, c);
    assert.equal(step.type, 'move', 'walks toward the workplace');
    assert.equal(executeAction(w, c.id, step).ok, true);
  }
  assert.equal(c.district, job.district);
  assert.deepEqual(decide(w, c), { type: 'work' });
  assert.equal(executeAction(w, c.id, { type: 'work' }).ok, true);
  assert.equal(c.shiftsToday, 1);
});

test('travel is one step along a shortest path, and the night is for sleeping at home', () => {
  const w = makeWorld();
  createCityJobs(w);
  at(w, 1, 9);
  const medic = Object.values(w.jobs).find((j) => j.role === 'medic')!;
  const c = settled(w, { district: 'harbor_market' });
  c.skills.care = 40;
  applyForJob(w, c.id, medic.id);
  assert.deepEqual(decide(w, c), { type: 'move', district: 'commons' }, 'Harbor Market to the Verdant Quarter goes through the Commons');

  at(w, 1, 23);
  const sleepy = settled(w, { district: 'foundry_row' });
  sleepy.needs.rest = 50;
  const a = decide(w, sleepy);
  assert.equal(a.type, 'move');
  const via = (a as { district: string }).district;
  assert.ok(isAdjacent('foundry_row', via as never) && isAdjacent(via as never, 'verdant_quarter'), `via ${via}`);
  sleepy.district = 'verdant_quarter';
  assert.deepEqual(decide(w, sleepy), { type: 'rest' });
});

test('a homeless citizen with money moves into the Lofts', () => {
  const w = makeWorld();
  at(w, 1, 12);
  const c = makeCitizen(w, { homeTier: 0, wallet: 150 });
  assert.deepEqual(decide(w, c), { type: 'move_home', tier: 1 });
});

test('broke, dishonest and miserable with a target present: theft (deterministic per seed)', () => {
  const w = makeWorld();
  at(w, 1, 12);
  const target = makeCitizen(w, { district: 'nightglass', wallet: 150 });
  const rogue = settled(w, { district: 'nightglass', wallet: 10, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.2, ambition: 0.5 } });
  const a = decide(w, rogue);
  assert.deepEqual(a, { type: 'steal', from: target.id });
  const r = executeAction(w, rogue.id, a);
  assert.ok(r.offence === 'L04' || r.offence === 'L08');
  assert.ok(rogue.recentOffences.length === 1);
});

test('election day: an eligible voter votes for the candidate it prefers; nothing appealing means abstention', () => {
  const w = makeWorld();
  const e = w.government.election;
  at(w, e.electionDay, 12);
  const cand = settled(w, { name: 'Sable', reputation: 70 });
  cand.platform = { tax: 0.4, dividend: 0.8, minWage: 0.8, strictness: 0.5 };
  e.candidates.push(cand.id);
  const voter = settled(w, { wallet: 30 });
  voter.bonds[cand.id] = 30;
  const a = decide(w, voter);
  assert.deepEqual(a, { type: 'vote', candidate: cand.id });
  assert.equal(executeAction(w, voter.id, a).ok, true);
  assert.notEqual(decide(w, voter).type, 'vote', 'one ballot each');

  const crook = settled(w, { name: 'Rook', reputation: 10 });
  crook.platform = { tax: 0.9, dividend: 0.1, minWage: 0.1, strictness: 1 };
  e.candidates = [crook.id];
  const sceptic = settled(w, { wallet: 30 });
  sceptic.bonds[crook.id] = -50;
  sceptic.record.convictions.push({ caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 1 });
  const b = decide(w, sceptic);
  assert.notEqual(b.type, 'vote');
  assert.equal(w.counters[`abstain:${sceptic.id}:${e.electionDay}`], 1);
  assert.equal(reflexBrain.kind, 'reflex');
  assert.equal(reflexBrain.decide(w, sceptic, buildObservation(w, sceptic.id)) instanceof Object, true);
});

test('with nominations open, an ambitious reputable citizen stands on a platform of its own', () => {
  const w = makeWorld();
  at(w, 0, 12);
  const c = settled(w, { reputation: 70, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.9 } });
  let nominated: Action | null = null;
  for (let i = 0; i < 60 && !nominated; i++) {
    const a = decide(w, c);
    if (a.type === 'nominate') nominated = a;
  }
  assert.ok(nominated, 'declares within a few hours of nominations opening');
  const platform = (nominated as Extract<Action, { type: 'nominate' }>).platform;
  for (const v of Object.values(platform)) assert.ok(v >= 0 && v <= 1);
  assert.equal(executeAction(w, c.id, nominated).ok, true);
  assert.ok(w.government.election.candidates.includes(c.id));
  const timid = settled(w, { reputation: 70, personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.2 } });
  for (let i = 0; i < 30; i++) assert.notEqual(decide(w, timid).type, 'nominate');
});

test('detained citizens idle; suspended citizens stay within SUSPENDED_ACTIONS', () => {
  const w = makeWorld();
  at(w, 1, 12);
  const held = settled(w, { detainedUntilTick: w.tick + 3 });
  assert.deepEqual(decide(w, held), { type: 'idle' });
  const banned = settled(w, { standing: 'suspended', district: 'commons', wallet: 5 });
  banned.needs.energy = 10;
  banned.needs.social = 10;
  for (let i = 0; i < 20; i++) {
    const a = decide(w, banned);
    assert.ok(SUSPENDED_ACTIONS.includes(a.type), `${a.type} is not allowed while suspended`);
    executeAction(w, banned.id, a);
  }
});

test('a lonely citizen seeks company, and the same seed replays the same choices', () => {
  const w = makeWorld();
  at(w, 1, 19);
  const other = settled(w, { district: 'nightglass' });
  const c = settled(w, { district: 'nightglass' });
  c.needs.social = 20;
  const a = decide(w, c);
  assert.equal(a.type, 'socialize');
  assert.equal((a as { with: string }).with, other.id);

  const run = () => {
    const world = makeWorld({ seed: 11 });
    createCityJobs(world);
    at(world, 1, 8);
    const ids = [makeCitizen(world, { district: 'commons' }).id, makeCitizen(world, { district: 'commons' }).id];
    const trail: string[] = [];
    for (let t = 0; t < 30; t++) {
      for (const id of ids) {
        const action = decide(world, world.citizens[id]);
        trail.push(action.type);
        executeAction(world, id, action);
      }
      at(world, 1, 8 + (t % 14));
    }
    return trail.join(',');
  };
  assert.equal(run(), run());
});

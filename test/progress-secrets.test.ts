/**
 * Publishing, hoarding and how a technique travels (`docs/PROGRESS.md` §4).
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import type { Business, BusinessId, Citizen, DistrictId, Job, Skills, World } from '../src/types.ts';
import { nextId } from '../src/util/ids.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { progressState } from '../src/progress/state.ts';
import { openProject, openProjects, resolveProject } from '../src/progress/projects.ts';
import { fundProject } from '../src/progress/purse.ts';
import {
  arriveFamiliarWith, keepSecret, loseOrphanedSecrets, lostTechnologies, paperProgress, publishFinding,
  readPaperFrom, secretsHeld, sellSecret, takeApprentice, teachTechnology,
} from '../src/progress/discovery.ts';
import { cityHolds, heldTechnologies, isMasterOf, isSecret, mastersOf, visibleTo } from '../src/progress/effects.ts';
import { progressContribution, progressObservation } from '../src/progress/observe.ts';

function skills(analysis: number): Skills {
  return { crafting: 20, analysis, rhetoric: 20, care: 20, commerce: 20, artistry: 20 };
}

function workingWorld(): World {
  const w = makeWorld();
  w.tick = 10;
  w.hour = 10;
  return w;
}

function researcher(world: World, analysis = 80, wallet = 2_000, district: DistrictId = 'archive'): Citizen {
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

/** A concluded programme: open it, fund it, and force it to the outcome the test wants. */
function concluded(world: World, c: Citizen, want: boolean, subject = 'crop_rotation', funder?: string) {
  assert.equal(openProject(world, c.id, subject, 'The trials').ok, true);
  const p = openProjects(world)[0];
  assert.equal(fundProject(world, funder ?? c.id, p.id, 300).ok, true);
  p.shifts[c.id] = 4;
  p.volumesSpent = p.volumesRequired;
  for (let i = 0; i < 100; i++) {
    p.status = 'open';
    p.progress = p.cost;
    if (resolveProject(world, p) === want) return p;
  }
  assert.fail('the programme never landed the way the test needed');
}

// ---------------------------------------------------------------------------
// Publishing
// ---------------------------------------------------------------------------

test('publishing turns a finding into a paper anybody can read', () => {
  const w = workingWorld();
  const c = researcher(w);
  const p = concluded(w, c, true);
  const before = c.reputation;

  const r = publishFinding(w, c.id, p.id);
  assert.equal(r.ok, true, r.message);
  assert.equal(p.finding, 'published');
  const work = w.works[p.workId ?? ''];
  assert.ok(work, 'the paper is in the register of works');
  assert.equal(work.kind, 'paper');
  assert.equal(work.creatorId, c.id);
  assert.ok(c.works.includes(work.id));
  assert.ok(c.reputation > before, 'publishing pays in repute');
  assert.equal(cityHolds(w, 'crop_rotation'), true);
  assert.equal(paperProgress('crop_rotation'), 20, 'a paper is worth half the subject to whoever reads it');
});

test('a paper for a programme that found nothing is a false finding', () => {
  const w = workingWorld();
  const c = researcher(w, 30);
  const p = concluded(w, c, false);
  const before = c.reputation;

  const r = publishFinding(w, c.id, p.id);
  assert.equal(r.ok, true, 'a citizen may lie; the city finds out afterwards');
  assert.equal(r.offence, 'L42');
  assert.ok(c.reputation < before, 'a false finding costs the name on it');
  assert.equal(cityHolds(w, 'crop_rotation'), false, 'nothing was actually discovered');
});

test('nobody who did not work a programme may publish it', () => {
  const w = workingWorld();
  const c = researcher(w);
  const stranger = makeCitizen(w, { district: 'archive' });
  const p = concluded(w, c, true);
  assert.equal(publishFinding(w, stranger.id, p.id).ok, false);
  assert.equal(publishFinding(w, c.id, p.id).ok, true);
  assert.equal(publishFinding(w, c.id, p.id).ok, false, 'and never twice');
});

// ---------------------------------------------------------------------------
// Hoarding
// ---------------------------------------------------------------------------

test('the funder that may keep a secret keeps it, and nobody else is told', () => {
  const w = workingWorld();
  const c = researcher(w);
  c.unionId = 'u_test';                      // a union's member may keep a secret
  const outsider = makeCitizen(w, { district: 'archive' });
  const p = concluded(w, c, true);

  const kept = keepSecret(w, c.id, p.id);
  assert.equal(kept.ok, true, kept.message);
  assert.equal(isSecret(w, 'crop_rotation'), true);
  assert.equal(cityHolds(w, 'crop_rotation'), false, 'the city does not hold what it was not told');
  assert.deepEqual(heldTechnologies(w), []);
  assert.deepEqual(mastersOf(w, 'crop_rotation'), [c.id]);
  assert.equal(visibleTo(w, c.id, 'crop_rotation'), true);
  assert.equal(visibleTo(w, outsider.id, 'crop_rotation'), false);

  assert.deepEqual(progressObservation(w, outsider.id).held, [], 'a secret is in no observation but a master\'s');
  assert.deepEqual(progressObservation(w, c.id).youAreAMasterOf, ['crop_rotation']);
  assert.deepEqual(secretsHeld(w), [{ technology: 'crop_rotation', masters: [c.id] }]);
});

test('a patron who is not a guild, a union or a business cannot close the door', () => {
  const w = workingWorld();
  const c = researcher(w);
  const p = concluded(w, c, true);
  const r = keepSecret(w, c.id, p.id);
  assert.equal(r.ok, false);
  assert.match(r.message, /guild, a union or a business/);
  assert.equal(cityHolds(w, 'crop_rotation'), true);
});

test('a business that funded the work may keep it, and the city gets nothing', () => {
  const w = workingWorld();
  const c = researcher(w);
  const biz = makeBusiness(w, c.id, 2_000);
  const p = concluded(w, c, true, 'crop_rotation', biz.id);
  assert.equal(keepSecret(w, c.id, p.id).ok, true);
  assert.equal(isSecret(w, 'crop_rotation'), true);
});

test('a secret cannot be closed once the city has had it too long', () => {
  const w = workingWorld();
  const c = researcher(w);
  c.unionId = 'u_test';
  const p = concluded(w, c, true);
  w.day += 10;
  const r = keepSecret(w, c.id, p.id);
  assert.equal(r.ok, false);
  assert.match(r.message, /too long/);
});

test('a master may publish a secret, and that ends it', () => {
  const w = workingWorld();
  const c = researcher(w);
  c.unionId = 'u_test';
  const p = concluded(w, c, true);
  assert.equal(keepSecret(w, c.id, p.id).ok, true);
  assert.equal(publishFinding(w, c.id, p.id).ok, true);
  assert.equal(isSecret(w, 'crop_rotation'), false);
  assert.equal(cityHolds(w, 'crop_rotation'), true);
  assert.deepEqual(mastersOf(w, 'crop_rotation'), []);
});

// ---------------------------------------------------------------------------
// Apprentices and sales
// ---------------------------------------------------------------------------

test('an apprentice carries a secret on, and it counts toward what the city owes them', () => {
  const w = workingWorld();
  const c = researcher(w);
  c.unionId = 'u_test';
  const p = concluded(w, c, true);
  assert.equal(keepSecret(w, c.id, p.id).ok, true);
  const apprentice = makeCitizen(w, { district: 'archive' });

  assert.equal(takeApprentice(w, c.id, apprentice.id, 'crop_rotation').ok, true);
  assert.equal(isMasterOf(w, apprentice.id, 'crop_rotation'), true);
  assert.equal(progressContribution(w, c.id).deeds.apprentices, 1);
  assert.equal(progressContribution(w, c.id).worth, 12 + 20, 'an apprentice is 12, the discovery 20');
  assert.equal(takeApprentice(w, c.id, apprentice.id, 'crop_rotation').ok, false, 'they already know it');

  const elsewhere = makeCitizen(w, { district: 'harbor_market' });
  assert.equal(takeApprentice(w, c.id, elsewhere.id, 'crop_rotation').ok, false, 'you teach somebody in the room');
});

test('a secret is property: it can be sold, and the money is ordinary money', () => {
  const w = workingWorld();
  const c = researcher(w);
  c.unionId = 'u_test';
  const p = concluded(w, c, true);
  assert.equal(keepSecret(w, c.id, p.id).ok, true);
  const buyer = makeCitizen(w, { district: 'archive', wallet: 500 });
  const supply = totalMoney(w);

  const r = sellSecret(w, c.id, buyer.id, 'crop_rotation', 400);
  assert.equal(r.ok, true, r.message);
  assert.equal(buyer.wallet, 100);
  assert.equal(isMasterOf(w, buyer.id, 'crop_rotation'), true);
  assert.equal(isMasterOf(w, c.id, 'crop_rotation'), true, 'the seller keeps what they know');
  assert.equal(totalMoney(w), supply);

  const pauper = makeCitizen(w, { district: 'archive', wallet: 5 });
  assert.equal(sellSecret(w, c.id, pauper.id, 'crop_rotation', 400).ok, false);
});

// ---------------------------------------------------------------------------
// Losing it
// ---------------------------------------------------------------------------

test('a secret whose last master leaves with no apprentice is lost for good', () => {
  const w = workingWorld();
  const c = researcher(w);
  c.unionId = 'u_test';
  const p = concluded(w, c, true);
  assert.equal(keepSecret(w, c.id, p.id).ok, true);

  w.order = w.order.filter((id) => id !== c.id);   // they emigrated in the night
  const lost = loseOrphanedSecrets(w);
  assert.deepEqual(lost, ['crop_rotation']);
  assert.deepEqual(lostTechnologies(w), ['crop_rotation']);
  assert.equal(cityHolds(w, 'crop_rotation'), false);
  assert.equal(isSecret(w, 'crop_rotation'), false, 'there is nothing left to be secret');

  // And the subject is open again for anybody who wants to find it twice.
  const next = researcher(w);
  assert.equal(openProject(w, next.id, 'crop_rotation', 'Again, from nothing').ok, true);
});

test('an apprentice keeps a secret alive after the master is gone', () => {
  const w = workingWorld();
  const c = researcher(w);
  c.unionId = 'u_test';
  const p = concluded(w, c, true);
  assert.equal(keepSecret(w, c.id, p.id).ok, true);
  const apprentice = makeCitizen(w, { district: 'archive' });
  assert.equal(takeApprentice(w, c.id, apprentice.id, 'crop_rotation').ok, true);

  w.order = w.order.filter((id) => id !== c.id);
  assert.deepEqual(loseOrphanedSecrets(w), []);
  assert.deepEqual(mastersOf(w, 'crop_rotation'), [apprentice.id]);
});

// ---------------------------------------------------------------------------
// Carrying it down the road
// ---------------------------------------------------------------------------

test('a traveller familiar with a subject gives the city 30 % of its cost, once', () => {
  const w = workingWorld();
  const traveller = makeCitizen(w, { district: 'archive' });
  assert.equal(teachTechnology(w, traveller.id, 'sanitation').ok, false, 'you cannot teach what you never worked under');

  assert.deepEqual(arriveFamiliarWith(w, traveller.id, ['sanitation', 'nonsense']), ['sanitation']);
  const r = teachTechnology(w, traveller.id, 'sanitation');
  assert.equal(r.ok, true, r.message);
  assert.equal(progressState(w).salvage.sanitation, 12, '30 % of a tier-1 subject');
  assert.equal(progressContribution(w, traveller.id).deeds.taught, 1);
  assert.equal(teachTechnology(w, traveller.id, 'sanitation').ok, false, 'once per teacher per subject');

  // And the gift is waiting for whoever opens the programme.
  const c = researcher(w);
  assert.equal(openProject(w, c.id, 'sanitation', 'The drains').ok, true);
  assert.equal(openProjects(w)[0].progress, 12);
});

test('a paper another city printed is worth half the subject, once', () => {
  const w = workingWorld();
  assert.equal(readPaperFrom(w, 'sanitation', 'Cinderhold').ok, true);
  assert.equal(progressState(w).salvage.sanitation, 20);
  assert.equal(readPaperFrom(w, 'sanitation', 'Cinderhold').ok, false);
  assert.equal(readPaperFrom(w, 'nonsense', 'Cinderhold').ok, false);
});

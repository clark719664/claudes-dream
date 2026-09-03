/**
 * Ambitions (src/identity/goals.ts).
 *
 * Goals are drawn by lot and measured from public facts. Nothing in the engine
 * may score a citizen against them or steer one toward them, so what is tested
 * here is the drawing, the arithmetic, and the milestone a life leaves behind.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { GOAL_KINDS } from '../src/types.ts';
import type { Business, Citizen, Club, GoalKind, Job, World } from '../src/types.ts';
import { GOALS_PER_CITIZEN, MASTER_SKILL, MAX_MILESTONES } from '../src/data/metropolis.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  ACHIEVEMENT_PHRASES, AMASS_TARGET, CLUB_OF_TEN, LASTING_BUSINESS_DAYS, MILESTONE_PURPOSE,
  MILESTONE_REPUTATION, achieved, dailyGoals, drawGoals, goalProgress, goalsObservation,
  milestonesOf, recordMilestone,
} from '../src/identity/goals.ts';

function giveGoal(c: Citizen, kind: GoalKind): void {
  c.goals = [{ kind, progress: 0, achievedDay: null }];
}

function addClub(world: World, founder: Citizen, members: number): Club {
  const club: Club = {
    id: `u_${Object.keys(world.clubs).length + 1}`,
    name: 'The Circle',
    hobby: 'music',
    founderId: founder.id,
    convenorId: founder.id,
    members: [founder.id],
    foundedDay: 0,
    meetsOnWeekday: 3,
  };
  for (let i = 1; i < members; i++) club.members.push(makeCitizen(world).id);
  world.clubs[club.id] = club;
  return club;
}

function addBusiness(world: World, owner: Citizen, foundedDay: number): Business {
  const b: Business = {
    id: 'b_1', name: 'The Long Haul', kind: 'workshop', ownerId: owner.id, treasury: 100,
    district: 'foundry_row', buildingId: 'fabrication_works', employees: [], jobs: [],
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay, rentPerDay: 1, daysNegative: 0, revenueToday: 0, costsToday: 0,
    dissolvedDay: null, shelf: {},
  };
  world.businesses[b.id] = b;
  owner.businessId = b.id;
  return b;
}

// ------------------------------------------------------------------ drawing

test('two distinct goals are drawn by lot, at zero, and survive a save', () => {
  const w = makeWorld({ seed: 4 });
  for (let i = 0; i < 40; i++) {
    const c = makeCitizen(w);
    const goals = drawGoals(w, c);
    assert.equal(goals.length, GOALS_PER_CITIZEN);
    assert.equal(new Set(goals.map((g) => g.kind)).size, GOALS_PER_CITIZEN, 'distinct kinds');
    for (const g of goals) {
      assert.ok(GOAL_KINDS.includes(g.kind));
      assert.equal(g.progress, 0);
      assert.equal(g.achievedDay, null);
    }
    assert.equal(c.goals, goals, 'the citizen carries what was drawn');
    assert.deepEqual(JSON.parse(JSON.stringify(goals)), goals, 'a goal is plain, saveable data');
  }
});

test('the draw is even-handed: over many citizens every one of the thirteen comes up', () => {
  const w = makeWorld({ seed: 21 });
  const seen = new Set<GoalKind>();
  for (let i = 0; i < 300; i++) for (const g of drawGoals(w, makeCitizen(w))) seen.add(g.kind);
  assert.equal(seen.size, GOAL_KINDS.length, 'no goal is unreachable');
});

test('a second draw keeps the goals a citizen already has and costs no randomness', () => {
  const w = makeWorld({ seed: 9 });
  const c = makeCitizen(w);
  const first = drawGoals(w, c).map((g) => g.kind);
  const before = w.rng.s;
  const again = drawGoals(w, c).map((g) => g.kind);
  assert.deepEqual(again, first, 'coming of age twice does not redraw a life');
  assert.equal(w.rng.s, before);
});

test('a half-drawn or damaged goal list is completed rather than thrown away', () => {
  const w = makeWorld({ seed: 2 });
  const c = makeCitizen(w);
  c.goals = [{ kind: 'own_villa', progress: 0.4, achievedDay: null }, { kind: 'nonsense' as GoalKind, progress: 0, achievedDay: null }];
  const goals = drawGoals(w, c);
  assert.equal(goals.length, GOALS_PER_CITIZEN);
  assert.equal(goals[0].kind, 'own_villa');
  assert.equal(goals[0].progress, 0.4, 'the progress already made is kept');
  assert.equal(goals.filter((g) => !GOAL_KINDS.includes(g.kind)).length, 0);
});

// ----------------------------------------------------------------- progress

test('every goal reads between 0 and 1 for a citizen with nothing at all', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { wallet: 0, reputation: 0 });
  c.skills = { crafting: 0, analysis: 0, rhetoric: 0, care: 0, commerce: 0, artistry: 0 };
  for (const kind of GOAL_KINDS) {
    const p = goalProgress(w, c, kind);
    assert.ok(p >= 0 && p <= 1, `${kind} reads ${p}`);
    assert.equal(p, 0, `${kind} is nowhere yet`);
    assert.equal(achieved(w, c, kind), false);
  }
});

test('every goal can be reached, and reads 1 when it is', () => {
  const w = makeWorld({ seed: 12 });
  const reach: Record<GoalKind, (c: Citizen) => void> = {
    hold_office: (c) => { w.government.council = [c.id]; },
    become_mayor: (c) => { w.government.mayorId = c.id; },
    own_villa: (c) => { c.homeTier = 3; },
    lasting_business: (c) => { w.day = 40; addBusiness(w, c, 40 - LASTING_BUSINESS_DAYS); },
    marry: (c) => { c.family.married = true; c.family.partnerId = 'c_other'; },
    raise_child: (c) => {
      const kid = makeCitizen(w, { lifeStage: 'adult' });
      c.family.children.push(kid.id);
    },
    master_skill: (c) => { c.skills.crafting = MASTER_SKILL; },
    publish_work: (c) => { c.works = ['w_1']; },
    win_championship: (c) => { c.milestones = [{ day: 1, text: 'Nightglass are champions.' }]; },
    elder_standing: (c) => { c.lifeStage = 'elder'; c.standing = 'good'; },
    amass_5000: (c) => { c.wallet = AMASS_TARGET; },
    club_of_ten: (c) => { addClub(w, c, CLUB_OF_TEN); },
    sit_as_judge: (c) => { w.government.judges = [c.id]; },
  };
  for (const kind of GOAL_KINDS) {
    const c = makeCitizen(w, { wallet: 0 });
    reach[kind](c);
    assert.equal(goalProgress(w, c, kind), 1, `${kind} is reached`);
    assert.equal(achieved(w, c, kind), true);
    w.government.mayorId = null;
    w.government.council = [];
    w.government.judges = [];
  }
});

test('progress climbs with the facts behind it', () => {
  const w = makeWorld({ seed: 5 });
  const c = makeCitizen(w, { wallet: 0 });
  assert.equal(goalProgress(w, c, 'amass_5000'), 0);
  c.wallet = AMASS_TARGET / 2;
  assert.equal(goalProgress(w, c, 'amass_5000'), 0.5);
  c.wallet = AMASS_TARGET * 3;
  assert.equal(goalProgress(w, c, 'amass_5000'), 1, 'a very rich citizen is not more than finished');

  c.homeTier = 1;
  assert.ok(goalProgress(w, c, 'own_villa') > 0 && goalProgress(w, c, 'own_villa') < 1);

  w.day = 20;
  addBusiness(w, c, 10);
  assert.equal(goalProgress(w, c, 'lasting_business'), Math.round((10 / LASTING_BUSINESS_DAYS) * 100) / 100);
  w.businesses.b_1.dissolvedDay = 20;
  assert.equal(goalProgress(w, c, 'lasting_business'), 0, 'a business that closed counts for nothing');

  const kid = makeCitizen(w, { lifeStage: 'child', bornDay: 20 });
  c.family.children.push(kid.id);
  w.day = 27;
  const half = goalProgress(w, c, 'raise_child');
  assert.ok(half > 0 && half < 1, `a child half grown reads ${half}`);
});

test('a goal reads 0 rather than throwing when the world is missing what it names', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  c.businessId = 'b_gone';
  c.teamDistrict = 'nightglass';
  c.family.children = ['c_gone'];
  c.works = [];
  for (const kind of GOAL_KINDS) assert.ok(goalProgress(w, c, kind) >= 0);
  assert.equal(goalProgress(w, c, 'lasting_business'), 0);
  assert.equal(goalProgress(w, c, 'raise_child'), 0);
  assert.equal(goalProgress(w, c, 'win_championship'), 0);
  assert.equal(goalProgress(w, c, 'nonsense' as GoalKind), 0);
});

test('a team on a winning run reads as progress toward a championship, and a title finishes it', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  c.teamDistrict = 'nightglass';
  w.teams = { nightglass: { district: 'nightglass', name: 'The Lanterns', players: [c.id], wins: 3, losses: 1, draws: 0 } };
  const running = goalProgress(w, c, 'win_championship');
  assert.ok(running > 0 && running < 1, `a good season reads ${running}`);
  recordMilestone(w, c, 'The Lanterns are champions of Reverie.');
  assert.equal(goalProgress(w, c, 'win_championship'), 1);
});

// --------------------------------------------------------------- milestones

test('a milestone is written down, told to the city, remembered, and worth some purpose', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove' });
  c.needs.purpose = 50;
  const events = w.events.length;
  recordMilestone(w, c, 'Ondine Ashgrove took public office in Reverie.');
  assert.equal(c.milestones.length, 1);
  assert.equal(c.milestones[0].day, w.day);
  assert.equal(w.events.length, events + 1);
  const ev = w.events[w.events.length - 1];
  assert.equal(ev.kind, 'milestone');
  assert.deepEqual(ev.actors, [c.id]);
  assert.equal(c.needs.purpose, 50 + MILESTONE_PURPOSE);
  assert.ok(c.memory.some((m) => m.text.includes('took public office')), 'the citizen remembers its own day');
});

test('milestones are bounded, trimmed and never empty', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  for (let i = 0; i < MAX_MILESTONES + 12; i++) recordMilestone(w, c, `Milestone ${i}`);
  assert.equal(c.milestones.length, MAX_MILESTONES);
  assert.equal(c.milestones[c.milestones.length - 1].text, `Milestone ${MAX_MILESTONES + 11}`);
  const before = c.milestones.length;
  recordMilestone(w, c, '   ');
  assert.equal(c.milestones.length, before, 'an empty line is not a milestone');
  recordMilestone(w, c, 'x'.repeat(400));
  assert.ok(c.milestones[c.milestones.length - 1].text.length <= 160);
  assert.equal(milestonesOf(w, c.id, 2).length, 2);
  assert.deepEqual(milestonesOf(w, 'c_nobody'), []);
});

// ------------------------------------------------------------- the daily pass

test('a goal reached is marked once, on the day it is reached, with reputation and a milestone', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Rhea', reputation: 50 });
  giveGoal(c, 'own_villa');
  w.day = 5;
  dailyGoals(w);
  assert.equal(c.goals[0].progress, 0);
  assert.equal(c.goals[0].achievedDay, null);

  c.homeTier = 3;
  dailyGoals(w);
  assert.equal(c.goals[0].progress, 1);
  assert.equal(c.goals[0].achievedDay, 5);
  assert.equal(c.reputation, 50 + MILESTONE_REPUTATION);
  assert.equal(c.milestones.length, 1);
  assert.ok(c.milestones[0].text.includes(ACHIEVEMENT_PHRASES.own_villa));

  w.day = 6;
  dailyGoals(w);
  assert.equal(c.goals[0].achievedDay, 5, 'a life is only reached once');
  assert.equal(c.milestones.length, 1);
  assert.equal(c.reputation, 50 + MILESTONE_REPUTATION);
});

test('a child has no goals until it comes of age, and the daily pass leaves it alone', () => {
  const w = makeWorld();
  const kid = makeCitizen(w, { lifeStage: 'child' });
  kid.goals = [];
  kid.homeTier = 3;
  dailyGoals(w);
  assert.deepEqual(kid.goals, [], 'nothing is drawn for a child by the daily pass');
  giveGoal(kid, 'own_villa');
  dailyGoals(w);
  assert.equal(kid.goals[0].achievedDay, null, 'a child is not measured against a life yet');
  kid.lifeStage = 'adult';
  dailyGoals(w);
  assert.equal(kid.goals[0].achievedDay, w.day);
});

test('the exiled and the departed are not measured, and a citizen with no goals is skipped', () => {
  const w = makeWorld();
  const exile = makeCitizen(w, { standing: 'exiled', homeTier: 3 });
  giveGoal(exile, 'own_villa');
  const gone = makeCitizen(w, { homeTier: 3 });
  giveGoal(gone, 'own_villa');
  w.order = w.order.filter((id) => id !== gone.id);
  const empty = makeCitizen(w);
  empty.goals = [];
  dailyGoals(w);
  assert.equal(exile.goals[0].achievedDay, null);
  assert.equal(gone.goals[0].achievedDay, null);
  assert.deepEqual(empty.goals, []);
});

test('the daily pass is deterministic and moves no randomness at all', () => {
  const w = makeWorld({ seed: 33 });
  const c = makeCitizen(w, { homeTier: 3 });
  giveGoal(c, 'own_villa');
  const before = w.rng.s;
  dailyGoals(w);
  dailyGoals(w);
  assert.equal(w.rng.s, before, 'measuring a life is arithmetic, not a die roll');
});

// -------------------------------------------------------------- observation

test('what a citizen can read about its own ambitions is three plain facts', () => {
  const w = makeWorld({ seed: 6 });
  const c = makeCitizen(w, { homeTier: 3 });
  drawGoals(w, c);
  c.goals[0] = { kind: 'own_villa', progress: 0, achievedDay: null };
  dailyGoals(w);
  const observed = goalsObservation(w, c);
  assert.equal(observed.length, GOALS_PER_CITIZEN);
  for (const row of observed) {
    assert.ok(GOAL_KINDS.includes(row.kind));
    assert.ok(row.progress >= 0 && row.progress <= 1);
    assert.equal(typeof row.achieved, 'boolean');
    assert.equal(Object.keys(row).length, 3, 'nothing else is told to the citizen');
  }
  assert.equal(observed[0].achieved, true);
  const noGoals = makeCitizen(w);
  delete (noGoals as Partial<Citizen>).goals;
  assert.deepEqual(goalsObservation(w, noGoals), []);
});

test('nothing in the goals module reads a hidden trait', () => {
  const w = makeWorld({ seed: 7 });
  const c = makeCitizen(w, { wallet: 900, reputation: 62, homeTier: 2 });
  c.personality = { curiosity: 0, diligence: 0, sociability: 0, honesty: 0, ambition: 0 };
  const cold = GOAL_KINDS.map((kind) => goalProgress(w, c, kind));
  c.personality = { curiosity: 1, diligence: 1, sociability: 1, honesty: 1, ambition: 1 };
  const hot = GOAL_KINDS.map((kind) => goalProgress(w, c, kind));
  assert.deepEqual(hot, cold, 'the same public facts read the same through any mind');
  assert.deepEqual(goalsObservation(w, c), goalsObservation(w, c));
});

test('a job in the trades counts as halfway to a published work', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  assert.equal(goalProgress(w, c, 'publish_work'), 0);
  const job: Job = {
    id: 'j_1', role: 'artist', title: 'Artist', employer: 'city', buildingId: 'gallery_of_echoes',
    district: 'nightglass', skill: 'artistry', minSkill: 0, minReputation: 0, wage: 10,
    output: {}, holderId: c.id, createdDay: 0,
  };
  w.jobs[job.id] = job;
  c.jobId = job.id;
  assert.equal(goalProgress(w, c, 'publish_work'), 0.5);
  c.works = ['w_1'];
  assert.equal(goalProgress(w, c, 'publish_work'), 1);
});

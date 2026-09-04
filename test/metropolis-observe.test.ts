/**
 * The observation, after the metropolis: every new block is there for every
 * kind of citizen — a plain one, one in the cells, a juror, a detective, a
 * child and an elder — it still carries nothing hidden, and what
 * `availableActions` offers is what `executeAction` will actually entertain.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeCitizen, makeWorld } from './helpers.ts';
import { GOODS, SEASONS, WEATHERS } from '../src/types.ts';
import type { Citizen, Observation, World } from '../src/types.ts';
import { MAX_DIARY_SHOWN, MAX_FEED_SHOWN } from '../src/data/metropolis.ts';
import { createCityJobs } from '../src/economy/jobs.ts';
import { fileCharge, holdCourt, openCourtSession } from '../src/government/court.ts';
import { CUSTODY_ACTIONS } from '../src/government/jail.ts';
import { seatJury } from '../src/government/jury.ts';
import { openInvestigation } from '../src/government/investigations.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { executeAction } from '../src/actions/execute.ts';

/** A small city with jobs, a bench and a few citizens who are not alike. */
function city(): { world: World; plain: Citizen; child: Citizen; elder: Citizen } {
  const world = makeWorld();
  createCityJobs(world);
  const plain = makeCitizen(world, { name: 'Ondine', district: 'commons', wallet: 300, homeTier: 1, reputation: 60 });
  const child = makeCitizen(world, { name: 'Wren', district: 'commons', lifeStage: 'child', wallet: 20 });
  const elder = makeCitizen(world, { name: 'Sable', district: 'commons', lifeStage: 'elder', wallet: 900, homeTier: 2, reputation: 80 });
  makeCitizen(world, { name: 'Bram', district: 'commons', wallet: 150, homeTier: 1 });
  return { world, plain, child, elder };
}

/** Every block the metropolis added, checked on one observation. */
function assertMetropolisShape(obs: Observation, who: string): void {
  const self = obs.self;
  assert.ok(Array.isArray(self.goals), `${who}: self.goals`);
  assert.ok(Array.isArray(self.diary), `${who}: self.diary`);
  assert.ok(self.diary.length <= MAX_DIARY_SHOWN, `${who}: the diary block is bounded`);
  assert.ok(Array.isArray(self.milestones), `${who}: self.milestones`);
  assert.equal(typeof self.health.glitched, 'boolean', `${who}: self.health`);
  assert.ok(self.jailedUntilDay === null || typeof self.jailedUntilDay === 'number', `${who}: self.jailedUntilDay`);
  assert.ok(self.approval.mayor >= 0 && self.approval.mayor <= 1, `${who}: self.approval.mayor`);
  assert.ok(self.school === null || typeof self.school === 'string', `${who}: self.school`);
  assert.ok(['chronicle', 'ledger'].includes(self.paper), `${who}: self.paper`);
  for (const key of ['party', 'union', 'gang', 'team', 'mentor', 'mentee'] as const) {
    assert.ok(key in self, `${who}: self.${key} is missing`);
  }
  for (const key of ['property', 'shares', 'works'] as const) {
    assert.ok(Array.isArray(self[key]), `${who}: self.${key} is not a list`);
  }
  assert.ok(Array.isArray(obs.here.units), `${who}: here.units`);
  assert.ok(Array.isArray(obs.here.gigs), `${who}: here.gigs`);
  assert.ok(Array.isArray(obs.here.works), `${who}: here.works`);
  assert.ok(SEASONS.includes(obs.calendar.season), `${who}: calendar.season`);
  assert.ok(WEATHERS.includes(obs.calendar.weather), `${who}: calendar.weather`);
  assert.equal(typeof obs.calendar.year, 'number', `${who}: calendar.year`);
  assert.equal(typeof obs.calendar.referendumToday, 'boolean', `${who}: calendar.referendumToday`);
  assert.ok(obs.calendar.matchToday === null || typeof obs.calendar.matchToday.hour === 'number', `${who}: calendar.matchToday`);
  for (const good of GOODS) assert.equal(typeof obs.outer.prices[good], 'number', `${who}: outer.prices.${good}`);
  assert.equal(typeof obs.outer.tariff, 'number', `${who}: outer.tariff`);
  assert.ok(Array.isArray(obs.culture.league), `${who}: culture.league`);
  assert.ok(Array.isArray(obs.culture.topWorks), `${who}: culture.topWorks`);
  assert.equal(obs.culture.papers.length, 2, `${who}: both papers are on the stand`);
  assert.ok(Array.isArray(obs.feed) && obs.feed.length <= MAX_FEED_SHOWN, `${who}: feed`);
  assert.ok(Array.isArray(obs.rumours), `${who}: rumours`);
  assert.ok(Array.isArray(obs.jury), `${who}: jury`);
  assert.ok(Array.isArray(obs.investigations), `${who}: investigations`);
  assert.ok(Array.isArray(obs.government.parties), `${who}: government.parties`);
  assert.ok(Array.isArray(obs.government.petitions), `${who}: government.petitions`);
  assert.ok(obs.government.approval.council >= 0, `${who}: government.approval`);
  assert.ok(Array.isArray(obs.government.decrees), `${who}: government.decrees`);
  for (const key of ['propertyTax', 'wealthTax', 'tariff', 'reserveTarget'] as const) {
    assert.equal(typeof obs.government[key], 'number', `${who}: government.${key}`);
  }
}

// ---------------------------------------------------------------------------
// Every kind of citizen
// ---------------------------------------------------------------------------

test('the observation carries every metropolis block for a plain citizen, a child and an elder', () => {
  const { world, plain, child, elder } = city();
  for (const [who, c] of [['a plain citizen', plain], ['a child', child], ['an elder', elder]] as const) {
    assertMetropolisShape(buildObservation(world, c.id), who);
  }
});

test('a citizen in the cells sees the whole city and is offered only what a term leaves', () => {
  const { world, plain } = city();
  plain.jailedUntilDay = world.day + 2;
  const obs = buildObservation(world, plain.id);
  assertMetropolisShape(obs, 'a citizen in the cells');
  assert.equal(obs.self.jailedUntilDay, world.day + 2);
  // The Charter's own list and nothing else (`docs/JUSTICE.md` §2): the
  // notebook, the diary, a letter, the appeal, the plea, the lesson, the
  // shift, the parole application, and a journalist's story.
  for (const a of obs.availableActions) {
    assert.ok((CUSTODY_ACTIONS as readonly string[]).includes(a), `${a} was offered from a cell`);
  }
  for (const a of ['work', 'move', 'buy', 'sell', 'vote', 'socialize', 'gift', 'steal', 'harass', 'visit']) {
    assert.ok(!obs.availableActions.includes(a as never), `${a} was offered from a cell`);
  }
  assert.ok(obs.availableActions.includes('work_custody'), 'a shift in custody pays the victim first');
});

test('the observation carries the term, its parole and the people who may come', () => {
  const { world, plain } = city();
  const victim = makeCitizen(world, { name: 'Pell', district: 'commons' });
  const k = fileCharge(world, {
    defendantId: plain.id, law: 'P03', evidence: 0.9, filedBy: 'watch', victimId: victim.id,
    description: 'Assault: struck a citizen in the Commons',
  });
  world.hour = world.config.courtHour;
  holdCourt(world);
  assert.equal(world.cases[k.id].verdict !== null, true, 'the Court decided it');
  if (world.cases[k.id].verdict !== 'guilty') return;

  const obs = buildObservation(world, plain.id);
  const custody = obs.self.custody;
  assert.ok(custody, 'a citizen serving a term sees the term');
  assert.equal(custody.law, 'P03');
  assert.equal(custody.lawName, 'Assault');
  assert.equal(custody.caseId, k.id);
  assert.equal(custody.life, false);
  assert.ok((custody.term ?? 0) >= 5, 'never below the floor of the band');
  assert.equal(custody.daysServed, 0);
  assert.equal(custody.startDay, world.day);
  assert.equal(custody.paroleDay, world.day + Math.ceil((custody.term ?? 0) / 2));
  assert.equal(custody.paroleEligible, false);
  assert.match(String(custody.paroleProblem), /Half your term/);
  assert.equal(custody.paroleRequested, false);
  assert.equal(custody.workedToday, false);
  assert.ok(custody.conditions.length > 0, 'the Charter\'s own list travels with the term');
  assert.equal(obs.self.parole, null, 'nobody is on parole the day they go in');

  // Custody is not exile: a friend standing where they are held may come.
  const friend = makeCitizen(world, { name: 'Rook', district: plain.district });
  friend.bonds[plain.id] = 70;
  plain.bonds[friend.id] = 70;
  const visitor = buildObservation(world, friend.id);
  assert.deepEqual(visitor.self.visitable.map((v) => v.id), [plain.id]);
  assert.equal(visitor.self.visitable[0].visitedToday, false);
  assert.ok(visitor.availableActions.includes('visit'));
});

test('a job the citizen cannot take says why, and a suspension does not read as a skill gap', () => {
  const { world, plain } = city();
  const obs = buildObservation(world, plain.id);
  for (const job of obs.jobs) {
    if (job.qualified) assert.equal(job.reason, undefined, 'a job within reach needs no explanation');
    else assert.ok(job.reason && job.reason.length > 0, `${job.title} says nothing about why not`);
  }
  plain.standing = 'suspended';
  plain.suspendedUntilDay = world.day + 5;
  const barred = buildObservation(world, plain.id).jobs;
  assert.ok(barred.length > 0);
  for (const job of barred) {
    assert.equal(job.qualified, false);
    assert.equal(job.reason, 'You cannot work while suspended.');
  }
});

test('a juror sees the case before them and a detective the file they hold', () => {
  const { world, plain, elder } = city();
  const accused = makeCitizen(world, { name: 'Corvin', district: 'commons', wallet: 40 });
  world.government.judges = [elder.id];
  const k = fileCharge(world, {
    defendantId: accused.id, law: 'L08', evidence: 0.8, filedBy: 'watch',
    description: 'Grand theft: 90 ℓ taken from a wallet in the Commons',
  });
  assert.ok(k, 'the charge was filed');
  world.hour = world.config.courtHour;
  openCourtSession(world);
  if (k) seatJury(world, world.cases[k.id]);
  const jurors = world.cases[k?.id ?? ''].jury ?? [];
  assert.ok(jurors.length > 0, 'a jury was drawn for a severity-4 charge');
  const juror = world.citizens[jurors[0]];
  const jurorObs = buildObservation(world, juror.id);
  assertMetropolisShape(jurorObs, 'a juror');
  assert.equal(jurorObs.jury.length, 1, 'the case is before the juror');
  assert.equal(jurorObs.jury[0].asJuror, true);
  assert.equal(jurorObs.jury[0].defendant, accused.id);

  plain.skills.analysis = 60;
  const file = openInvestigation(world, plain.id, accused.id, 'L04');
  assert.ok(file, 'a detective opened a file');
  const detective = buildObservation(world, plain.id);
  assert.equal(detective.investigations.length, 1);
  assert.equal(detective.investigations[0].suspect, accused.id);
  assert.equal(detective.investigations[0].suspectName, accused.name);
});

// ---------------------------------------------------------------------------
// What is offered is what is accepted
// ---------------------------------------------------------------------------

/** Refusals that mean the offer itself was wrong, rather than the world moving on. */
const WRONG_OFFER = /You are a child|while (suspended|exiled)|held in the Watch House|A curfew is in force|from the cells|Unknown action|has no .* to offer/;

test('availableActions offers nothing the standing gates would refuse, for six kinds of citizen', () => {
  const { world, plain, child, elder } = city();
  const jailed = makeCitizen(world, { name: 'Ivo', district: 'commons', wallet: 80, homeTier: 1 });
  jailed.jailedUntilDay = world.day + 1;
  const suspended = makeCitizen(world, { name: 'Nell', district: 'commons', wallet: 80, homeTier: 1 });
  suspended.standing = 'suspended';
  suspended.suspendedUntilDay = world.day + 4;
  const detained = makeCitizen(world, { name: 'Vex', district: 'commons', wallet: 80 });
  detained.detainedUntilTick = world.tick + 5;

  for (const c of [plain, child, elder, jailed, suspended, detained]) {
    const offered = buildObservation(world, c.id).availableActions;
    for (const type of offered) {
      // A clone per action: the answer must not depend on what came before it.
      const copy = structuredClone(world) as World;
      const r = executeAction(copy, c.id, { type } as never);
      assert.equal(WRONG_OFFER.exec(r.message), null, `${c.name} was offered ${type} but told: ${r.message}`);
    }
  }
});

test('the observation never carries a hidden trait, and the diary is public while notes are not', () => {
  const { world, plain } = city();
  plain.personality.honesty = 0.03;
  plain.notes.push('Bram leaves his door open.');
  plain.diary.push({ day: world.day, text: 'A long day at the forge.' });
  const obs = buildObservation(world, plain.id);
  const json = JSON.stringify(obs);
  assert.ok(!json.includes('personality'), 'no personality block travels');
  assert.ok(!json.includes('0.03'), 'no hidden trait value travels');
  assert.ok(!json.includes('birthTraits'), 'no birth traits travel');
  assert.deepEqual(obs.self.diary, [{ day: world.day, text: 'A long day at the forge.' }]);
  assert.deepEqual(obs.self.notes, ['Bram leaves his door open.'], 'a citizen still reads its own notebook');
  const other = buildObservation(world, world.order[3]);
  assert.ok(!JSON.stringify(other.here.citizens).includes('Bram leaves his door open'), 'nobody else reads it');
});

/**
 * Repute and the gates (`docs/CITIZENSHIP.md` §1–2).
 *
 * The score's arithmetic and its two decays, contribution accumulating and
 * never being inherited, and what a city's gate decides and says.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Character, Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  CIVIC_DECAY, CIVIC_PENALTY, COMING_OF_AGE_REPUTE, CONTRIBUTION_CAP, CONTRIBUTION_WORTH, CUSTODIAL_DECAY,
  CUSTODIAL_PENALTY, REPUTE_BASELINE, REPUTE_MAX, accruePenalties, civicPenaltyValue, computeRepute,
  contributionWorth, custodialPenaltyValue, dailyRepute, reputeBreakdown, reputeOf,
} from '../src/standing/repute.ts';
import { contributionLedger, penaltiesOf, standingState } from '../src/standing/state.ts';
import {
  GATES, HOME_CITY, HOUSEHOLD_ALLOWANCE, REVERIE_SPONSORSHIP, gateDecision, gatesObservation, residencyLine,
  sponsor, visitLine, vouch,
} from '../src/standing/gates.ts';

function flat(v: number): Character {
  return { honesty: v, diligence: v, sociability: v, generosity: v, civic: v };
}

/** Move the whole world on by a day, the way the clock does. */
function nextDay(world: World, days = 1): void {
  world.tick += 24 * days;
  world.day = Math.floor(world.tick / 24);
  world.hour = world.tick % 24;
}

function convict(c: Citizen, spec: { caseId: string; law: string; severity: number; tier: number | null; day: number }): void {
  c.record.convictions.push({
    caseId: spec.caseId, law: spec.law as never, severity: spec.severity as never,
    tier: spec.tier as never, day: spec.day,
  });
}

// --------------------------------------------------------------- the formula

test('a new adult with no record and average conduct sits at 580', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { reputation: 50, character: flat(0.5) });
  assert.equal(computeRepute(world, c), COMING_OF_AGE_REPUTE);
});

test('every weight in the formula is exactly what the Charter prints', () => {
  const world = makeWorld();
  const best = makeCitizen(world, { reputation: 100, character: flat(1) });
  // 300 + 200 + 120 + 100 + 80 + 60, with no contribution and no penalties.
  assert.equal(computeRepute(world, best), 860);
  const worst = makeCitizen(world, { reputation: 0, character: flat(0) });
  assert.equal(computeRepute(world, worst), REPUTE_BASELINE);
  const k = reputeBreakdown(world, best.id);
  assert.ok(k);
  assert.equal(k.baseline, 300);
  assert.equal(k.reputation, 200);
  assert.equal(k.diligence, 120);
  assert.equal(k.honesty, 100);
  assert.equal(k.civic, 80);
  assert.equal(k.generosity, 60);
  assert.equal(k.score, 860);
});

test('the score is public: any citizen can read any other citizen\'s parts', () => {
  const world = makeWorld();
  const a = makeCitizen(world, { reputation: 70 });
  const b = makeCitizen(world, { reputation: 30 });
  // No caller identity anywhere in the signature: that is the whole point.
  assert.ok(reputeBreakdown(world, a.id));
  assert.ok(reputeBreakdown(world, b.id));
  assert.notEqual(reputeOf(world, a.id), reputeOf(world, b.id));
});

// ---------------------------------------------------------------- the ladder

test('a civic conviction costs its rung and decays 2 % per clean day', () => {
  assert.equal(CIVIC_PENALTY[1], 10);
  assert.equal(CIVIC_PENALTY[2], 25);
  assert.equal(CIVIC_PENALTY[3], 45);
  assert.equal(CIVIC_PENALTY[4], 80);
  assert.equal(CIVIC_PENALTY[5], 250);
  assert.equal(civicPenaltyValue(45, 0, false), 45);
  assert.equal(civicPenaltyValue(45, 10, false), 45 * (1 - CIVIC_DECAY) ** 10);
  // Four months of clean living spends an ordinary conviction.
  assert.ok(civicPenaltyValue(45, 120, false) < 45 * 0.1);
});

test('full restitution halves what is left of a civic penalty the day it clears', () => {
  assert.equal(civicPenaltyValue(80, 5, true), civicPenaltyValue(80, 5, false) / 2);
});

test('the ladder\'s penalty is entered, decays with the days, and halves on restitution', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { reputation: 50, character: flat(0.5) });
  convict(c, { caseId: 'k_1', law: 'L06', severity: 3, tier: 3, day: 0 });
  dailyRepute(world);
  assert.equal(reputeOf(world, c.id), COMING_OF_AGE_REPUTE - 45);

  for (let i = 0; i < 10; i++) {
    nextDay(world);
    dailyRepute(world);
  }
  const entry = penaltiesOf(world, c.id)[0];
  assert.equal(entry.kind, 'civic');
  assert.equal(entry.cleanDays, 9, 'the day of the conviction is not a clean day');
  assert.equal(reputeOf(world, c.id), COMING_OF_AGE_REPUTE - Math.round(civicPenaltyValue(45, 9, false)));

  // The Treasury's own book says restitution cleared; the penalty halves.
  world.counters['restitutionPaid:k_1'] = world.day;
  nextDay(world);
  dailyRepute(world);
  assert.equal(penaltiesOf(world, c.id)[0].restitutionDay, world.day - 1);
  assert.equal(reputeOf(world, c.id), COMING_OF_AGE_REPUTE - Math.round(civicPenaltyValue(45, 10, true)));
});

test('a day with a fresh conviction is not a clean day, and past decay is not undone', () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  convict(c, { caseId: 'k_1', law: 'L04', severity: 2, tier: 2, day: 0 });
  for (let i = 0; i < 5; i++) {
    nextDay(world);
    dailyRepute(world);
  }
  assert.equal(penaltiesOf(world, c.id)[0].cleanDays, 4);
  convict(c, { caseId: 'k_2', law: 'L04', severity: 2, tier: 2, day: world.day });
  nextDay(world);
  dailyRepute(world);
  assert.equal(penaltiesOf(world, c.id)[0].cleanDays, 4, 'the streak broke, but nothing already forgiven came back');
});

test('a conviction set aside on appeal takes its penalty with it', () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  convict(c, { caseId: 'k_1', law: 'L07', severity: 3, tier: 3, day: 0 });
  dailyRepute(world);
  assert.equal(penaltiesOf(world, c.id).length, 1);
  c.record.convictions = [];
  nextDay(world);
  dailyRepute(world);
  assert.equal(penaltiesOf(world, c.id).length, 0);
  assert.equal(reputeOf(world, c.id), COMING_OF_AGE_REPUTE);
});

// ---------------------------------------------------------------- custody

test('custody costs 60 to 1000 by code, and decays 0.5 % a clean day', () => {
  assert.equal(CUSTODIAL_PENALTY.P01, 60);
  assert.equal(CUSTODIAL_PENALTY.P03, 120);
  assert.equal(CUSTODIAL_PENALTY.P04, 200);
  assert.equal(CUSTODIAL_PENALTY.P07, 320);
  assert.equal(CUSTODIAL_PENALTY.P08, 500);
  assert.equal(CUSTODIAL_PENALTY.P09, 1000);
  assert.equal(custodialPenaltyValue(200, 0), 200);
  assert.equal(custodialPenaltyValue(200, 30), 200 * (1 - CUSTODIAL_DECAY) ** 30);
});

test('a custodial penalty is frozen inside and decays only from the day of release', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { reputation: 50, character: flat(0.5) });
  convict(c, { caseId: 'k_9', law: 'P03', severity: 3, tier: null, day: 0 });
  c.jailedUntilDay = 10;

  for (let i = 0; i < 6; i++) {
    nextDay(world);
    dailyRepute(world);
  }
  let entry = penaltiesOf(world, c.id)[0];
  assert.equal(entry.kind, 'custodial');
  assert.equal(entry.releaseDay, null, 'nothing is counted while they are inside');
  assert.equal(entry.cleanDays, 0);
  assert.equal(reputeOf(world, c.id), COMING_OF_AGE_REPUTE - 120);

  // Released on day 10; the clock starts there and not one day sooner.
  c.jailedUntilDay = null;
  nextDay(world);
  dailyRepute(world);
  entry = penaltiesOf(world, c.id)[0];
  assert.equal(entry.releaseDay, world.day);
  assert.equal(entry.cleanDays, 0);

  for (let i = 0; i < 4; i++) {
    nextDay(world);
    dailyRepute(world);
  }
  entry = penaltiesOf(world, c.id)[0];
  assert.equal(entry.cleanDays, 4);
  assert.equal(reputeOf(world, c.id), COMING_OF_AGE_REPUTE - Math.round(custodialPenaltyValue(120, 4)));
});

test('the three permanent ceilings hold for life, whatever else the citizen does', () => {
  const world = makeWorld();
  const tamperer = makeCitizen(world, { reputation: 100, character: flat(1) });
  convict(tamperer, { caseId: 'k_1', law: 'P07', severity: 5, tier: null, day: 0 });
  const terrorist = makeCitizen(world, { reputation: 100, character: flat(1) });
  convict(terrorist, { caseId: 'k_2', law: 'P08', severity: 5, tier: null, day: 0 });
  const eraser = makeCitizen(world, { reputation: 100, character: flat(1) });
  convict(eraser, { caseId: 'k_3', law: 'P09', severity: 5, tier: null, day: 0 });

  // Ten years of clean living: the penalties are spent, the ceilings are not.
  for (const c of [tamperer, terrorist, eraser]) {
    accruePenalties(world, c);
    for (const p of penaltiesOf(world, c.id)) {
      p.releaseDay = 0;
      p.cleanDays = 3650;
    }
  }
  assert.equal(computeRepute(world, tamperer), 600);
  assert.equal(computeRepute(world, terrorist), 250);
  assert.equal(computeRepute(world, eraser), 0);
  const k = reputeBreakdown(world, terrorist.id);
  assert.ok(k);
  assert.equal(k.ceiling, 250);
  assert.equal(k.capped, true);
});

test('the score never leaves the scale', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { reputation: 100, character: flat(1) });
  for (let i = 0; i < 20; i++) convict(c, { caseId: `k_${i}`, law: 'L14', severity: 5, tier: 5, day: 0 });
  dailyRepute(world);
  assert.equal(reputeOf(world, c.id), 0);
  assert.ok(computeRepute(world, c) <= REPUTE_MAX);
});

// ----------------------------------------------------------- contribution

test('contribution is counted from public deeds and capped at 140', () => {
  assert.equal(CONTRIBUTION_WORTH.councilCycle, 15);
  assert.equal(CONTRIBUTION_WORTH.mayorCycle, 25);
  assert.equal(CONTRIBUTION_WORTH.judgeTerm, 20);
  assert.equal(CONTRIBUTION_WORTH.child, 10);
  const world = makeWorld();
  const c = makeCitizen(world);
  const l = contributionLedger(world, c.id);
  l.councilCycles = 2;
  l.judgeTerms = 1;
  l.shifts = 250;
  assert.equal(contributionWorth(l), 15 * 2 + 20 + 8 * 2);
  l.mayorCycles = 20;
  assert.equal(contributionWorth(l), CONTRIBUTION_CAP, 'the column stops at 140');
});

test('a cycle on the Council pays once, and a judge\'s term only when it is completed', () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  world.government.council = [c.id];
  dailyRepute(world);
  nextDay(world);
  dailyRepute(world);
  assert.equal(contributionLedger(world, c.id).councilCycles, 1, 'one cycle, however many mornings');

  world.government.council = [];
  world.government.judges = [c.id];
  c.judgeTermEndsDay = world.day + 3;
  dailyRepute(world);
  assert.equal(contributionLedger(world, c.id).judgeTerms, 0);
  nextDay(world, 4);
  world.government.judges = [];
  dailyRepute(world);
  assert.equal(contributionLedger(world, c.id).judgeTerms, 1, 'the term ran to its end');
});

test('a judge removed before the end of the term is not paid for it', () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  world.government.judges = [c.id];
  c.judgeTermEndsDay = world.day + 30;
  dailyRepute(world);
  world.government.judges = [];
  nextDay(world);
  dailyRepute(world);
  assert.equal(contributionLedger(world, c.id).judgeTerms, 0);
});

test('contribution only ever rises: a business that later fails keeps what it earned', () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  world.businesses.b_1 = {
    id: 'b_1', name: 'The Long Table', kind: 'cafe', ownerId: c.id, treasury: 0, district: 'nightglass',
    buildingId: 'lantern_row', employees: [], jobs: [], inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    foundedDay: 0, rentPerDay: 0, daysNegative: 0, revenueToday: 0, costsToday: 0, dissolvedDay: null, shelf: {},
  };
  nextDay(world, 30);
  dailyRepute(world);
  assert.equal(contributionLedger(world, c.id).businesses, 1);
  world.businesses.b_1.dissolvedDay = world.day;
  nextDay(world);
  dailyRepute(world);
  assert.equal(contributionLedger(world, c.id).businesses, 1, 'the years it stood are still years it stood');
});

test('contribution is never inherited: a child starts its own column at nothing', () => {
  const world = makeWorld();
  const parent = makeCitizen(world);
  const child = makeCitizen(world, { lifeStage: 'child' });
  parent.family.children = [child.id];
  child.family.parents = [parent.id];
  const l = contributionLedger(world, parent.id);
  l.councilCycles = 4;
  l.mayorCycles = 2;
  dailyRepute(world);
  assert.ok(contributionWorth(contributionLedger(world, parent.id)) > 0);
  assert.equal(contributionWorth(contributionLedger(world, child.id)), 0);

  // And the day they come of age the column is still their own.
  child.lifeStage = 'adult';
  nextDay(world);
  dailyRepute(world);
  assert.equal(contributionWorth(contributionLedger(world, child.id)), 0);
  assert.equal(reputeOf(world, child.id), COMING_OF_AGE_REPUTE, 'a ward comes of age at the baseline');
});

test('a child is not scored at all, and a parent raising one to adulthood is', () => {
  const world = makeWorld();
  const parent = makeCitizen(world);
  const child = makeCitizen(world, { lifeStage: 'child' });
  parent.family.children = [child.id];
  dailyRepute(world);
  assert.equal(standingState(world).repute[child.id], undefined, 'repute is not computed for children');
  assert.equal(contributionLedger(world, parent.id).children, 0);
  child.lifeStage = 'adult';
  nextDay(world);
  dailyRepute(world);
  assert.equal(contributionLedger(world, parent.id).children, 1);
  assert.equal(reputeOf(world, parent.id), COMING_OF_AGE_REPUTE + CONTRIBUTION_WORTH.child);
});

// ------------------------------------------------------------------ gates

test('Reverie asks 380 to walk its streets and 440 to call it home', () => {
  const world = makeWorld();
  assert.equal(visitLine(world), 380);
  assert.equal(residencyLine(world), 440);
  assert.equal(GATES[HOME_CITY].relief[0].kind, 'sponsorship');
  assert.equal(GATES[HOME_CITY].relief[0].covers, REVERIE_SPONSORSHIP);
});

test('the gate admits on repute alone, and states what it asks either way', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { reputation: 50, character: flat(0.5) });
  const decision = gateDecision(world, c.id, 'reside');
  assert.equal(decision.admitted, true);
  assert.equal(decision.shortfall, 0);
  assert.match(decision.reasons[0], /Reverie asks 440 to call it home; your repute is 580\./);
});

test('a refusal states its reasons, names the relief, and takes nothing away', () => {
  const world = makeWorld();
  const c = makeCitizen(world, { reputation: 20, character: flat(0.2) });
  const before = { ...c };
  const decision = gateDecision(world, c.id, 'reside');
  assert.equal(decision.admitted, false);
  assert.ok(decision.shortfall > 0);
  assert.ok(decision.reasons.some((r) => r.includes('short')));
  assert.ok(decision.reasons.some((r) => r.includes('one resident vouching')));
  assert.ok(decision.reasons.some((r) => r.includes('Repute is not wealth')));
  assert.equal(c.standing, before.standing);
  assert.equal(c.wallet, before.wallet);
});

test('one resident vouching covers a shortfall of up to 50, and is spent once', () => {
  const world = makeWorld();
  const neighbour = makeCitizen(world);
  // 410: thirty short of Reverie's line, and a name covers fifty.
  const short = makeCitizen(world, { reputation: 55, character: flat(0) });
  dailyRepute(world);
  assert.equal(reputeOf(world, short.id), 410);

  const alone = gateDecision(world, short.id, 'reside');
  assert.equal(alone.admitted, false);
  assert.equal(alone.shortfall, 30);
  assert.equal(alone.covered, 0);

  assert.equal(sponsor(world, neighbour.id, short.id).ok, true);
  const backed = gateDecision(world, short.id, 'reside');
  assert.equal(backed.covered, REVERIE_SPONSORSHIP);
  assert.equal(backed.admitted, true);
  assert.deepEqual(backed.relief[0].from, [neighbour.id]);
  // A second name from the same neighbour is not a second relief.
  assert.equal(sponsor(world, neighbour.id, short.id).ok, false);
  assert.equal(vouch(world, short.id, short.id).ok, false, 'nobody vouches for themselves');
});

test('a city that takes you takes your family, within reason', () => {
  const world = makeWorld();
  const resident = makeCitizen(world);
  const partner = makeCitizen(world, { reputation: 10, character: flat(0.2) });
  partner.family.partnerId = resident.id;
  dailyRepute(world);
  const decision = gateDecision(world, partner.id, 'reside');
  assert.equal(decision.shortfall, 48);
  assert.ok(decision.relief.some((r) => r.kind === 'household' && r.covers === HOUSEHOLD_ALLOWANCE));
  assert.equal(decision.admitted, true);
});

test('a child is never tested at any gate', () => {
  const world = makeWorld();
  const child = makeCitizen(world, { lifeStage: 'child', reputation: 0, character: flat(0) });
  const decision = gateDecision(world, child.id, 'reside');
  assert.equal(decision.admitted, true);
  assert.match(decision.reasons[0], /does not test children/);
});

test('a citizen sees every gate it knows of, with the decision each would make', () => {
  const world = makeWorld();
  const c = makeCitizen(world);
  const gates = gatesObservation(world, c.id);
  assert.equal(gates.length, Object.keys(GATES).length);
  assert.equal(gates[0].city, HOME_CITY);
  assert.equal(gates[0].visit, 380);
  assert.equal(gates[0].reside, 440);
  assert.equal(gates[0].yours, true);
  assert.ok(gates[0].relief.length >= 1);
  assert.ok(gates[0].reasons.length >= 1);
});

test('a city can amend its own line, and a line that rises is still a public fact', () => {
  const world = makeWorld();
  world.counters['gate:reverie:reside'] = 700;
  assert.equal(residencyLine(world), 700);
  const c = makeCitizen(world);
  assert.equal(gateDecision(world, c.id, 'reside').threshold, 700);
});

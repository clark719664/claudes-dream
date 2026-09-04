import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen, totalMoney } from './helpers.ts';
import type { Case, CaseId, Citizen, CitizenId, World } from '../src/types.ts';
import {
  LIFE_REVIEW_DAYS, REPORTING_DUTY_DAYS, breachParole, castLifeReviewVote, castParoleVote, decideLifeReviews,
  decideParoleHearings, grantParole, lifeReviewDay, onParole, openParoleHearings, paroleConditions, paroleDayFor,
  paroleProblem, reportToWatch, requestParole, submitVictimStatement,
} from '../src/government/parole.ts';
import {
  dailyJail, daysLeft, custodyCodeOf, isJailed, isLifeTerm, jailCitizen, restitutionOwed, restrainedFrom,
  sentenceToCustody,
} from '../src/government/jail.ts';
import { LIFE_TERM_DAYS } from '../src/government/persons.ts';

/** A charge in the book, for the cases custody reads restitution and victims from. */
function makeCase(w: World, spec: Partial<Case> & { defendantId: CitizenId }): Case {
  const id = `k_${Object.keys(w.cases).length + 1}` as CaseId;
  const k: Case = {
    id, law: 'L04', severity: 3, evidence: 1, filedTick: w.tick, filedBy: 'watch',
    victimId: spec.victimId ?? null, amount: spec.amount ?? 0, description: 'for the test', status: 'tried',
    triedDay: w.day, judges: [], votes: {}, reasons: {}, openedTick: null, carriedSessions: 0,
    decidedByDefault: false, verdict: 'guilty', sentence: null, appeal: null,
    jury: [], juryVotes: {}, juryReasons: {}, advocateId: null, advocacy: 0,
    ...spec,
  };
  w.cases[k.id] = k;
  return k;
}

function addJudge(w: World, name: string): Citizen {
  const j = makeCitizen(w, { name, office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56 });
  w.government.judges.push(j.id);
  return j;
}

function addCouncil(w: World, seats: number): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < seats; i++) {
    const c = makeCitizen(w, { name: `Councillor${i}`, office: i === 0 ? 'mayor' : 'councillor' });
    if (i === 0) w.government.mayorId = c.id;
    else w.government.council.push(c.id);
    out.push(c);
  }
  return out;
}

/** Move the city on a day, running the morning roll. */
function nextDay(w: World): void {
  w.day += 1;
  w.tick = w.day * 24 + 8;
  w.hour = 8;
  dailyJail(w);
}

test('parole is heard at half the term, with the victim\'s statement, and the bench votes', () => {
  const w = makeWorld();
  w.day = 10;
  const d = makeCitizen(w, { name: 'Held', reputation: 70 });
  const victim = makeCitizen(w, { name: 'Hurt' });
  addJudge(w, 'Judge A');
  addJudge(w, 'Judge B');
  addJudge(w, 'Judge C');
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id });
  const term = sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P04', harm: 1, victimId: victim.id });
  assert.equal(term.days, 60);
  assert.equal(paroleDayFor(w, d.id), 10 + 30);

  assert.match(paroleProblem(w, d.id) ?? '', /Half your term is served on day 40/);
  assert.equal(requestParole(w, d.id).ok, false, 'not a day before half');

  w.day = 40;
  assert.equal(paroleProblem(w, d.id), null);
  assert.ok(requestParole(w, d.id).ok);
  assert.equal(requestParole(w, d.id).ok, false, 'the Court already has it');
  assert.ok(victim.memory.some((m) => m.text.includes('your statement')));

  assert.ok(submitVictimStatement(w, victim.id, d.id, false, 'I want to stop being afraid of the calendar.').ok);
  openParoleHearings(w);
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('parole hearing')));
  // The bench is three scripted judges, and they voted when the hearing opened.
  assert.ok(w.events.filter((e) => e.kind === 'vote' && e.text.includes('parole')).length >= 3);

  w.day = 41;
  decideParoleHearings(w);
  assert.equal(isJailed(d), false, 'the bench granted it');
  assert.ok(onParole(w, d.id));
  const conditions = paroleConditions(w, d.id);
  assert.equal(d.standing, 'probation');
  assert.equal(conditions?.probationUntilDay, 70, 'the rest of the term hangs over them');
  assert.equal(conditions?.reportBy, 41 + REPORTING_DUTY_DAYS);
});

test('a bench that says no keeps the citizen, and the victim can say why it should', () => {
  const w = makeWorld();
  w.day = 10;
  const d = makeCitizen(w, { name: 'Held', reputation: 20 });
  const victim = makeCitizen(w, { name: 'Hurt' });
  addJudge(w, 'Judge A');
  addJudge(w, 'Judge B');
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id });
  sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P04', harm: 1, victimId: victim.id });
  d.record.convictions.push({ caseId: 'k_x', law: 'P04' as 'L04', severity: 4, tier: 2, day: 1 });

  w.day = 40;
  requestParole(w, d.id);
  assert.ok(submitVictimStatement(w, victim.id, d.id, true, 'I still cross the road when I see them.').ok);
  assert.equal(submitVictimStatement(w, makeCitizen(w).id, d.id, true).ok, false, 'only the victim speaks as the victim');
  openParoleHearings(w);
  w.day = 41;
  decideParoleHearings(w);
  assert.ok(isJailed(d), 'the bench refused');
  assert.equal(onParole(w, d.id), false);
  assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes('refused')));
  assert.ok(d.memory.some((m) => m.text.includes('You serve the rest of the term')));
});

test('a judge who thinks for itself votes for itself, and only judges on the hearing vote', () => {
  const w = makeWorld();
  w.day = 10;
  const d = makeCitizen(w, { name: 'Held' });
  const thinker = addJudge(w, 'Thinker');
  thinker.brain = 'llm';
  const stranger = makeCitizen(w, { name: 'Stranger' });
  jailCitizen(w, d.id, 10, 'k_1');

  w.day = 15;
  requestParole(w, d.id);
  openParoleHearings(w);
  assert.equal(castParoleVote(w, stranger.id, d.id, true).ok, false, 'you sit or you do not');
  assert.ok(castParoleVote(w, thinker.id, d.id, true, 'Half the term is served and the city is not safer for the rest.').ok);
  w.day = 16;
  decideParoleHearings(w);
  assert.equal(isJailed(d), false, 'one judge, one vote, and a majority of the votes cast');
});

test('breaking a parole condition costs the remainder and half again', () => {
  const w = makeWorld();
  w.day = 10;
  const d = makeCitizen(w, { name: 'Out' });
  const victim = makeCitizen(w, { name: 'Hurt' });
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id, amount: 60 });
  sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P06', harm: 0, victimId: victim.id });
  assert.equal(daysLeft(w, d), 20);

  w.day = 20;
  const conditions = grantParole(w, d.id);
  assert.ok(conditions);
  assert.equal(conditions?.probationUntilDay, 30, 'ten days of the term were left');
  assert.equal(conditions?.restrainedFrom, victim.id);
  assert.ok(restrainedFrom(w, d.id, victim.id), 'and a restraining order to go with it');
  assert.ok((conditions?.instalment ?? 0) > 0, 'restitution by instalments');

  const result = breachParole(w, d.id, 'they went to the victim\'s door');
  assert.ok(result.ok);
  assert.ok(isJailed(d));
  assert.equal(daysLeft(w, d), 15, 'ten days left, and half again');
  assert.equal(onParole(w, d.id), false);
  assert.equal(w.bans.length, 0, 'defying custody escalates custody; it never becomes exile');
});

test('a paroled citizen who stops reporting to the Watch goes back', () => {
  const w = makeWorld();
  w.day = 10;
  const d = makeCitizen(w, { name: 'Out' });
  jailCitizen(w, d.id, 20, 'k_1');
  w.day = 20;
  grantParole(w, d.id);
  assert.equal(paroleConditions(w, d.id)?.reportBy, 20 + REPORTING_DUTY_DAYS);

  w.day = 22;
  assert.ok(reportToWatch(w, d.id).ok);
  assert.equal(paroleConditions(w, d.id)?.reportBy, 22 + REPORTING_DUTY_DAYS);
  nextDay(w); // 23
  assert.equal(isJailed(d), false, 'they reported; nothing happens');

  w.day = 26;
  w.tick = w.day * 24 + 8;
  dailyJail(w);
  assert.ok(isJailed(d), 'they stopped reporting, and the rest of the term came back with half again');
  assert.ok(w.events.some((e) => e.text.includes('stopped reporting to the Watch')));
});

test('parole instalments reach the victim, and the parole ends when the term would have', () => {
  const w = makeWorld();
  w.day = 10;
  const d = makeCitizen(w, { name: 'Out', wallet: 300 });
  const victim = makeCitizen(w, { name: 'Hurt', wallet: 0 });
  const k = makeCase(w, { defendantId: d.id, victimId: victim.id, amount: 40 });
  sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P06', harm: 0, victimId: victim.id });
  const before = totalMoney(w);
  w.day = 20;
  grantParole(w, d.id);
  assert.equal(restitutionOwed(w, d.id).amount, 40, 'the debt to the victim survives the release');

  for (let i = 0; i < 12; i++) {
    if (onParole(w, d.id)) reportToWatch(w, d.id);
    nextDay(w);
  }
  assert.ok(victim.wallet > 0, 'the instalments reached them');
  assert.equal(totalMoney(w), before, 'restitution moves money between citizens and makes none');
  assert.equal(onParole(w, d.id), false, 'and the parole ran its course');
  assert.ok(w.events.some((e) => e.text.includes('parole ran its course')));
});

// ---------------------------------------------------------------------------
// Life
// ---------------------------------------------------------------------------

test('a life term is not a number of days, and the Council reviews it every two cycles', () => {
  const w = makeWorld();
  w.day = 5;
  const d = makeCitizen(w, { name: 'Life' });
  const k = makeCase(w, { defendantId: d.id });
  const term = sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P08', harm: 1 });
  assert.equal(term.life, true);
  assert.ok(isLifeTerm(w, d.id));
  assert.equal(d.jailedUntilDay, 5 + LIFE_TERM_DAYS);
  assert.equal(lifeReviewDay(w, d.id), 5 + LIFE_REVIEW_DAYS);

  const seats = addCouncil(w, 5);
  // Two cycles later the Council must answer, and three votes are not enough.
  w.day = 5 + LIFE_REVIEW_DAYS;
  for (const s of seats.slice(0, 3)) castLifeReviewVote(w, s.id, d.id, true);
  decideLifeReviews(w);
  assert.ok(isJailed(d), 'three of five is not four of five');
  assert.equal(lifeReviewDay(w, d.id), w.day + LIFE_REVIEW_DAYS, 'and the Council is asked again in two cycles');
  assert.ok(w.events.some((e) => e.text.includes('did not release them')));

  // Two cycles on, four of five do it.
  w.day += LIFE_REVIEW_DAYS;
  for (const s of seats.slice(0, 4)) castLifeReviewVote(w, s.id, d.id, true);
  decideLifeReviews(w);
  assert.equal(isJailed(d), false);
  assert.equal(d.standing, 'probation');
  assert.ok(w.events.some((e) => e.kind === 'pardon' && e.text.includes('serving life')));
});

test('a life term is never released by the roll, and parole is not heard before 56 days', () => {
  const w = makeWorld();
  w.day = 1;
  const d = makeCitizen(w, { name: 'Life' });
  const k = makeCase(w, { defendantId: d.id });
  sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P08', harm: 1 });
  assert.match(paroleProblem(w, d.id) ?? '', /not heard before day 57/);
  for (let i = 0; i < 5; i++) nextDay(w);
  assert.ok(isJailed(d), 'the days keep passing and the term does not end');

  w.day = 57;
  assert.equal(paroleProblem(w, d.id), null, 'after 56 days the city will hear the question');
});

test('there is no parole from an erasure: only the Council can ever open that door', () => {
  const w = makeWorld();
  w.day = 1;
  const d = makeCitizen(w, { name: 'Hand' });
  const k = makeCase(w, { defendantId: d.id });
  const term = sentenceToCustody(w, { citizenId: d.id, caseId: k.id, code: 'P09', harm: 0 });
  assert.equal(term.life, true);
  assert.equal(custodyCodeOf(w, d.id), 'P09');
  w.day = 500;
  assert.match(paroleProblem(w, d.id) ?? '', /no parole from an erasure/);
  assert.equal(requestParole(w, d.id).ok, false);
  for (let i = 0; i < 3; i++) nextDay(w);
  assert.ok(isJailed(d));
});

// ---------------------------------------------------------------------------
// Living in custody
// ---------------------------------------------------------------------------

test('parole is not an amnesty: a suspension on the civic ladder is still served', () => {
  const w = makeWorld();
  w.day = 10;
  const d = makeCitizen(w, { name: 'Both' });
  jailCitizen(w, d.id, 10, 'k_1');
  d.standing = 'suspended';
  d.suspendedUntilDay = 40;

  w.day = 15;
  const conditions = grantParole(w, d.id);
  assert.ok(conditions, 'the Court may still let them out of the cells');
  assert.equal(isJailed(d), false);
  assert.equal(d.standing, 'suspended', 'the other track\'s penalty is not lifted by this one');
  assert.equal(d.suspendedUntilDay, 40);
  assert.equal(conditions?.probationUntilDay, 20, 'and the rest of the custodial term still hangs over them');
});

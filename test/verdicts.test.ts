/**
 * The Court runs on its judges' decisions (docs/FREE_MINDS.md §E).
 *
 * A sitting opens at the court hour, every judge on the bench sees the case in
 * the observation it acts on, and the votes are counted at the end of the hour
 * after. A majority of the votes cast decides; a judge who says nothing
 * abstains; a case nobody votes on is held over, and only after three sittings
 * does a bench decide it on the evidence alone.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import type { Action, Brain, Case, Citizen, Observation, World } from '../src/types.ts';
import {
  castVerdict, fileCharge, openCourtSession, tallyVerdicts,
} from '../src/government/court.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { availableActions, executeAction } from '../src/actions/execute.ts';
import { createBrainRegistry, stepTick } from '../src/world/world.ts';

function addJudge(w: World, overrides: Parameters<typeof makeCitizen>[1] = {}): Citizen {
  const j = makeCitizen(w, { office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56, ...overrides });
  w.government.judges.push(j.id);
  return j;
}

/** A world at the court hour whose three judges all think for themselves. */
function remoteBench(): { w: World; judges: Citizen[] } {
  const w = makeWorld();
  w.day = 2; w.hour = w.config.courtHour; w.tick = 2 * 24 + w.config.courtHour;
  const judges = [addJudge(w, { brain: 'remote' }), addJudge(w, { brain: 'remote' }), addJudge(w, { brain: 'remote' })];
  return { w, judges };
}

function charge(w: World, defendantId: string, evidence = 0.8): Case {
  return fileCharge(w, { defendantId, law: 'L04', evidence, filedBy: 'watch', description: 'theft in the Commons' });
}

// ---------------------------------------------------------------------------
// The sitting
// ---------------------------------------------------------------------------

test('the sitting puts the case before the bench and every judge sees it', () => {
  const { w, judges } = remoteBench();
  const d = makeCitizen(w, { brain: 'remote', reputation: 40 });
  const victim = makeCitizen(w);
  const k = fileCharge(w, {
    defendantId: d.id, law: 'L08', evidence: 0.7, filedBy: 'watch', victimId: victim.id, amount: 60,
    description: 'grand theft at the Bazaar',
  });
  d.record.convictions.push({ caseId: 'k_old', law: 'L04', severity: 2, tier: 2, day: 0 });

  openCourtSession(w);
  assert.equal(k.status, 'in_session');
  assert.equal(k.openedTick, w.tick);
  assert.deepEqual(k.judges, judges.map((j) => j.id));
  assert.deepEqual(k.votes, {}, 'nobody has voted: these judges decide for themselves');

  const obs = buildObservation(w, judges[0].id);
  assert.equal(obs.bench.length, 1);
  const seat = obs.bench[0];
  assert.equal(seat.caseId, k.id);
  assert.equal(seat.defendant, d.id);
  assert.equal(seat.defendantName, d.name);
  assert.equal(seat.law, 'L08');
  assert.equal(seat.evidence, 0.7);
  assert.equal(seat.victim, victim.id);
  assert.equal(seat.description, 'grand theft at the Bazaar');
  assert.equal(seat.priorConvictions, 1);
  assert.equal(seat.youVoted, null);
  assert.deepEqual(seat.bench, k.judges);
  assert.ok(obs.availableActions.includes('verdict'));
  assert.ok(availableActions(w, judges[1]).includes('verdict'));

  // Everyone else sees an empty bench and cannot vote.
  assert.deepEqual(buildObservation(w, victim.id).bench, []);
  assert.ok(!availableActions(w, victim).includes('verdict'));
  const outsider = executeAction(w, victim.id, { type: 'verdict', caseId: k.id, guilty: true });
  assert.equal(outsider.ok, false);
  assert.match(outsider.message, /not sitting/);
});

test('a judge that thinks for itself decides the case, and the record says how', () => {
  const { w, judges } = remoteBench();
  const d = makeCitizen(w, { brain: 'remote' });
  const k = charge(w, d.id);
  openCourtSession(w);

  const first = executeAction(w, judges[0].id, { type: 'verdict', caseId: k.id, guilty: true, reason: 'Two witnesses saw it.' });
  assert.equal(first.ok, true, first.message);
  assert.equal(k.votes[judges[0].id], 'guilty');
  assert.equal(k.reasons[judges[0].id], 'Two witnesses saw it.');
  assert.ok(w.events.some((e) => e.kind === 'vote' && e.text.includes('Two witnesses saw it.')), 'a vote is public the moment it is cast');
  assert.equal(buildObservation(w, judges[0].id).bench[0].youVoted, 'guilty');

  // A judge may change its mind while the sitting is open.
  const changed = executeAction(w, judges[0].id, { type: 'verdict', caseId: k.id, guilty: false, reason: 'On reflection, not proven.' });
  assert.equal(changed.ok, true);
  assert.match(changed.message, /changed your vote/);
  assert.equal(k.votes[judges[0].id], 'acquitted');
  executeAction(w, judges[0].id, { type: 'verdict', caseId: k.id, guilty: true, reason: 'Two witnesses saw it.' });

  assert.equal(executeAction(w, judges[1].id, { type: 'verdict', caseId: k.id, guilty: true }).ok, true);
  // The third judge says nothing at all: an abstention.
  tallyVerdicts(w);
  assert.equal(k.status, 'tried');
  assert.equal(k.verdict, 'guilty');
  assert.equal(k.triedDay, 2);
  assert.equal(k.votes[judges[2].id], undefined, 'silence is an abstention, not a vote');
  assert.equal(k.carriedSessions, 0);
  assert.equal(k.decidedByDefault, false);
  assert.ok(k.sentence);

  const line = w.events.find((e) => e.kind === 'verdict' && e.data?.caseId === k.id);
  assert.ok(line);
  assert.ok(line.text.includes('2–0'), line.text);
  assert.ok(line.text.includes(`${judges[0].name} guilty`), line.text);
  assert.ok(line.text.includes(`${judges[2].name} abstained`), 'the Chronicle names who did not vote');
  assert.ok(w.citizens[judges[0].id].reputation > 80, 'sitting on a case is service');
  assert.equal(w.citizens[judges[2].id].reputation, 80, 'an abstainer earns nothing for the hour');
  assert.equal(executeAction(w, judges[2].id, { type: 'verdict', caseId: k.id, guilty: true }).ok, false, 'the sitting is over');
});

test('a bench that is evenly split acquits: a majority of the votes cast convicts', () => {
  const { w, judges } = remoteBench();
  const d = makeCitizen(w, { brain: 'remote' });
  const k = charge(w, d.id, 0.95);
  openCourtSession(w);
  assert.equal(castVerdict(w, judges[0].id, k.id, true, 'The evidence is plain.').ok, true);
  assert.equal(castVerdict(w, judges[1].id, k.id, false, 'I am not sure it was him.').ok, true);
  tallyVerdicts(w);
  assert.equal(k.verdict, 'acquitted');
  assert.equal(k.status, 'closed');
  assert.equal(d.record.convictions.length, 0);
});

test('scripted judges vote through the same door, so the record reads the same', () => {
  const w = makeWorld();
  w.day = 2; w.hour = w.config.courtHour; w.tick = 2 * 24 + w.config.courtHour;
  const judges = [addJudge(w), addJudge(w), addJudge(w)];
  const d = makeCitizen(w, { reputation: 30 });
  const k = charge(w, d.id, 0.9);
  openCourtSession(w);
  assert.equal(k.status, 'in_session', 'the sitting is still two hours long');
  for (const j of judges) {
    assert.equal(k.votes[j.id], 'guilty');
    assert.ok(k.reasons[j.id].includes('evidence'), 'a scripted judge says what its formula weighed');
  }
  assert.ok(w.events.filter((e) => e.kind === 'vote').length === 3, 'each vote is a public act');
  tallyVerdicts(w);
  assert.equal(k.verdict, 'guilty');
});

// ---------------------------------------------------------------------------
// Carry-over
// ---------------------------------------------------------------------------

test('a case nobody votes on is held over, and after three sittings the bench decides on the evidence', () => {
  const { w, judges } = remoteBench();
  const d = makeCitizen(w, { brain: 'remote', reputation: 30 });
  const k = charge(w, d.id, 0.95);

  for (let session = 1; session <= 3; session++) {
    w.day = 1 + session; w.tick = w.day * 24 + w.config.courtHour;
    openCourtSession(w);
    assert.equal(k.status, 'in_session', `session ${session} sits`);
    tallyVerdicts(w);
    assert.equal(k.status, 'pending', `session ${session}: held over, never dropped`);
    assert.equal(k.carriedSessions, session);
    assert.equal(k.verdict, null);
    assert.ok(w.events.some((e) => e.kind === 'law' && e.text.includes(`held over to the next sitting (${session} of 3)`)));
  }

  w.day = 5; w.tick = 5 * 24 + w.config.courtHour;
  openCourtSession(w);
  tallyVerdicts(w);
  assert.equal(k.status, 'tried');
  assert.equal(k.decidedByDefault, true, 'the fourth sitting decides it whatever the judges say');
  assert.equal(k.carriedSessions, 4);
  assert.equal(Object.keys(k.votes).length, 3, 'the bench is recorded as having voted on the evidence');
  assert.equal(k.verdict, 'guilty');
  const notice = w.events.find((e) => e.kind === 'law' && e.data?.byDefault === true);
  assert.ok(notice, 'the Chronicle reports the Court\'s failure to sit');
  assert.ok(notice.text.includes('3 sittings'), notice.text);
  assert.ok(notice.weight >= 0.6);
  // A judge who does turn up before the fourth sitting is enough to decide it.
  const other = makeCitizen(w, { brain: 'remote' });
  const k2 = charge(w, other.id, 0.9);
  w.day = 6; w.tick = 6 * 24 + w.config.courtHour;
  openCourtSession(w);
  castVerdict(w, judges[0].id, k2.id, true);
  tallyVerdicts(w);
  assert.equal(k2.status, 'pending', 'one vote is not a Court');
  assert.equal(k2.carriedSessions, 1);
  w.day = 7; w.tick = 7 * 24 + w.config.courtHour;
  openCourtSession(w);
  assert.equal(k2.votes[judges[0].id], 'guilty', 'a vote already cast stands into the next sitting');
  castVerdict(w, judges[1].id, k2.id, false, 'The evidence is thin.');
  tallyVerdicts(w);
  assert.equal(k2.status, 'closed');
  assert.equal(k2.verdict, 'acquitted', 'a tie acquits');
  assert.equal(k2.decidedByDefault, false);
});

// ---------------------------------------------------------------------------
// The two hours, in the city's own clock
// ---------------------------------------------------------------------------

/** A mind that votes on whatever is before it, and otherwise lets the hour pass. */
function votingBrain(guilty: boolean, seen: string[]): Brain {
  return {
    kind: 'remote',
    decide: (_w: World, c: Citizen, obs: Observation): Action => {
      if (obs.bench.length === 0) return { type: 'idle' };
      seen.push(`${c.id}:${obs.bench[0].caseId}`);
      return { type: 'verdict', caseId: obs.bench[0].caseId, guilty, reason: 'I read the evidence myself.' };
    },
  };
}

test('the sitting spans two hours of the city: opened at the court hour, counted at the next', async () => {
  const w = makeWorld();
  const courtHour = w.config.courtHour;
  w.day = 2; w.hour = courtHour - 1; w.tick = 2 * 24 + courtHour - 1;
  const judges = [addJudge(w, { brain: 'remote' }), addJudge(w, { brain: 'remote' }), addJudge(w, { brain: 'remote' })];
  const d = makeCitizen(w, { brain: 'remote' });
  const k = charge(w, d.id, 0.9);
  const seen: string[] = [];
  const brains = createBrainRegistry({ remote: votingBrain(true, seen) });

  await stepTick(w, brains);
  assert.equal(w.hour, courtHour);
  assert.equal(k.status, 'in_session', 'the bench is chosen before anybody acts');
  assert.equal(seen.length, judges.length, 'every judge was shown the case in its own observation');
  assert.equal(Object.keys(k.votes).length, 3, 'and every one of them voted with the verdict action');
  assert.equal(k.verdict, null, 'nothing is decided in the first hour');

  await stepTick(w, brains);
  assert.equal(w.hour, courtHour + 1);
  assert.equal(k.status, 'tried');
  assert.equal(k.verdict, 'guilty');
  assert.ok(k.sentence);
  assert.ok(d.memory.some((m) => m.kind === 'verdict' && m.text.includes('guilty')));
});

test('an all-reflex city is the same city twice for the same seed', async () => {
  const run = async (): Promise<string> => {
    const w = makeWorld({ seed: 11 });
    for (let i = 0; i < 4; i++) addJudge(w);
    for (let i = 0; i < 6; i++) makeCitizen(w, { district: 'commons' });
    const officer = makeCitizen(w, { office: 'watch', district: 'commons' });
    w.government.watch.push(officer.id);
    const target = w.order[w.order.length - 1];
    fileCharge(w, { defendantId: target, law: 'L04', evidence: 0.9, filedBy: 'watch', description: 'theft' });
    const brains = createBrainRegistry({});
    for (let i = 0; i < 30; i++) await stepTick(w, brains);
    return JSON.stringify(w);
  };
  assert.equal(await run(), await run());
});

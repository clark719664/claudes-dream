/**
 * Appeals are decided by the Council's own votes (docs/FREE_MINDS.md §E).
 *
 * A conviction appealed to the Council appears in every sitting councillor's
 * observation; they answer with `vote_appeal`, and the session counts the
 * votes. A majority carries, ties uphold, and an appeal too few councillors
 * vote on is held over once and then left standing.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import type { Case, Citizen, World } from '../src/types.ts';
import { decideAppeals, fileAppeal, fileCharge, holdCourt } from '../src/government/court.ts';
import { councilSession } from '../src/government/council.ts';
import { buildObservation } from '../src/brains/observe.ts';
import { availableActions, executeAction } from '../src/actions/execute.ts';

function addJudge(w: World): Citizen {
  const j = makeCitizen(w, { office: 'judge', reputation: 80, judgeTermEndsDay: w.day + 56 });
  w.government.judges.push(j.id);
  return j;
}

function seatCouncil(w: World, n: number, brain: 'reflex' | 'remote'): Citizen[] {
  const members: Citizen[] = [];
  for (let i = 0; i < n; i++) members.push(makeCitizen(w, { brain, reputation: 60, office: i === 0 ? 'mayor' : 'councillor' }));
  w.government.council = members.map((m) => m.id);
  w.government.mayorId = members[0]?.id ?? null;
  return members;
}

/** A convicted citizen with a live appeal before a Council of `n` members. */
function appealWorld(n: number, brain: 'reflex' | 'remote' = 'remote'): { w: World; k: Case; d: Citizen; council: Citizen[] } {
  const w = makeWorld();
  w.day = 2; w.hour = w.config.courtHour; w.tick = 2 * 24 + w.config.courtHour;
  addJudge(w); addJudge(w); addJudge(w);
  const council = seatCouncil(w, n, brain);
  const d = makeCitizen(w, { brain: 'remote', wallet: 300, reputation: 40 });
  const k = fileCharge(w, { defendantId: d.id, law: 'L08', evidence: 0.95, filedBy: 'watch', description: 'grand theft' });
  holdCourt(w);
  assert.equal(k.verdict, 'guilty', 'the appeal needs something to appeal against');
  w.hour = w.config.councilHour; w.tick = 2 * 24 + w.config.councilHour;
  assert.equal(fileAppeal(w, d.id).ok, true);
  return { w, k, d, council };
}

test('an appeal reaches every councillor\'s observation and nobody else\'s', () => {
  const { w, k, d, council } = appealWorld(3);
  const obs = buildObservation(w, council[1].id);
  assert.equal(obs.appeals.length, 1);
  const before = obs.appeals[0];
  assert.equal(before.caseId, k.id);
  assert.equal(before.defendant, d.id);
  assert.equal(before.defendantName, d.name);
  assert.equal(before.law, 'L08');
  assert.equal(before.verdict, 'guilty');
  assert.equal(before.sentence?.tier, k.sentence?.tier);
  assert.equal(before.filedDay, 2);
  assert.equal(before.youVoted, null);
  assert.equal(before.carried, 0);
  assert.ok(obs.availableActions.includes('vote_appeal'));

  assert.deepEqual(buildObservation(w, d.id).appeals, [], 'the defendant does not sit on their own appeal');
  assert.ok(!availableActions(w, d).includes('vote_appeal'));
  assert.equal(executeAction(w, d.id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' }).ok, false);
  const bystander = makeCitizen(w);
  assert.deepEqual(buildObservation(w, bystander.id).appeals, []);
  assert.ok(!availableActions(w, bystander).includes('vote_appeal'));
  const refused = executeAction(w, bystander.id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' });
  assert.equal(refused.ok, false);
  assert.match(refused.message, /councillors/);
});

test('a councillor that thinks for itself decides an appeal with vote_appeal', () => {
  const { w, k, d, council } = appealWorld(3);
  const fine = k.sentence!.fine;
  assert.equal(d.wallet, 300 - fine, 'the sentence was carried out at the verdict');

  const first = executeAction(w, council[0].id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' });
  assert.equal(first.ok, true, first.message);
  assert.equal(k.appeal?.votes[council[0].id], 'overturned');
  assert.ok(w.events.some((e) => e.kind === 'vote' && e.text.includes('overturned')), 'a vote is public when it is cast');
  assert.equal(buildObservation(w, council[0].id).appeals[0].youVoted, 'overturned');

  const changed = executeAction(w, council[0].id, { type: 'vote_appeal', caseId: k.id, result: 'reduced' });
  assert.equal(changed.ok, true);
  assert.match(changed.message, /changed your vote/);
  executeAction(w, council[0].id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' });
  executeAction(w, council[1].id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' });
  // The third councillor abstains.
  decideAppeals(w);
  assert.equal(k.status, 'closed');
  assert.equal(k.appeal?.result, 'overturned');
  assert.equal(k.appeal?.decidedDay, 2);
  assert.equal(d.record.convictions.length, 0);
  assert.equal(d.wallet, 300, 'the fine came back');
  const line = w.events.find((e) => e.kind === 'appeal' && e.data?.caseId === k.id && e.data?.result === 'overturned');
  assert.ok(line);
  assert.ok(line.text.includes(`${council[0].name} overturned`), line.text);
  assert.equal(executeAction(w, council[2].id, { type: 'vote_appeal', caseId: k.id, result: 'upheld' }).ok, false, 'the session is over');
});

test('a Council evenly divided upholds the conviction', () => {
  const { w, k, council } = appealWorld(2);
  executeAction(w, council[0].id, { type: 'vote_appeal', caseId: k.id, result: 'upheld' });
  executeAction(w, council[1].id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' });
  decideAppeals(w);
  assert.equal(k.appeal?.result, 'upheld');
  assert.equal(k.status, 'closed');
});

test('an appeal too few councillors vote on is held over once, then left standing', () => {
  const { w, k, d, council } = appealWorld(3);
  decideAppeals(w);
  assert.equal(k.status, 'appealed', 'nobody voted: it waits for the next session');
  assert.equal(k.appeal?.carried, 1);
  assert.equal(k.appeal?.result, null);
  assert.ok(w.events.some((e) => e.kind === 'appeal' && e.text.includes('held over to the next session')));
  assert.equal(buildObservation(w, council[0].id).appeals[0].carried, 1);

  w.day = 3; w.tick = 3 * 24 + w.config.councilHour;
  executeAction(w, council[0].id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' });
  decideAppeals(w);
  assert.equal(k.status, 'closed');
  assert.equal(k.appeal?.result, 'upheld', 'one voice is not a Council; the sentence stands');
  assert.equal(k.appeal?.carried, 1, 'held over once and once only');
  assert.equal(d.record.convictions.length, 1);
  assert.ok(w.events.some((e) => e.kind === 'appeal' && e.text.includes('too few votes')));
});

test('scripted councillors vote through the same door, at the session', () => {
  const { w, k, council } = appealWorld(3, 'reflex');
  for (const m of council) m.bonds[k.defendantId] = 80; // devoted friends
  councilSession(w);
  assert.equal(k.status, 'closed');
  assert.equal(k.appeal?.result, 'overturned');
  for (const m of council) assert.equal(k.appeal?.votes[m.id], 'overturned');
  assert.equal(w.events.filter((e) => e.kind === 'vote' && e.data?.councillor !== undefined).length, 3,
    'a scripted councillor\'s vote is as public as anyone\'s');
});

test('vote_appeal refuses cases that are not before the Council', () => {
  const { w, k, council } = appealWorld(2);
  assert.equal(executeAction(w, council[0].id, { type: 'vote_appeal', caseId: 'k_404', result: 'upheld' }).ok, false);
  decideAppeals(w);
  assert.equal(k.status, 'appealed', 'held over first');
  w.day = 3; w.tick = 3 * 24 + w.config.councilHour;
  executeAction(w, council[0].id, { type: 'vote_appeal', caseId: k.id, result: 'reduced' });
  executeAction(w, council[1].id, { type: 'vote_appeal', caseId: k.id, result: 'reduced' });
  decideAppeals(w);
  assert.equal(k.appeal?.result, 'reduced');
  const late = executeAction(w, council[1].id, { type: 'vote_appeal', caseId: k.id, result: 'overturned' });
  assert.equal(late.ok, false);
  assert.match(late.message, /not before the Council/);
});

/**
 * Impeachment and recall (src/politics/impeachment.ts, src/politics/recall.ts,
 * src/politics/accountability.ts).
 *
 * Who may bring articles and what lays them, the tribunal each office answers
 * to, what a removal takes and what it does not, the twice-on-an-article brake,
 * the recall the charter has to open first, and the body that sits past its
 * term.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { charterOf } from '../src/politics/charter.ts';
import {
  accountability, accountabilityObservation, barredFromOffice, dailySitting, impeachmentNeeded, officeOf, tribunalFor,
} from '../src/politics/accountability.ts';
import { holdImpeachments, impeach, impeachmentDisposition, voteImpeachment } from '../src/politics/impeachment.ts';
import { callByElection, dailyRecalls, recallStanding, signRecall } from '../src/politics/recall.ts';
import { holdReferendum, referendumsOfKind, voteReferendum } from '../src/politics/referendums.ts';
import { contributionLedger } from '../src/standing/state.ts';
import { offenceCount } from '../src/politics/offences.ts';

/** A Council of five with a Mayor, and `extra` other citizens. */
function government(world: World, extra = 0): { seats: Citizen[]; people: Citizen[] } {
  const seats: Citizen[] = [];
  for (let i = 0; i < 5; i++) {
    const c = makeCitizen(world, { name: `Seat${i}` });
    seats.push(c);
    world.government.council.push(c.id);
    c.office = 'councillor';
  }
  world.government.mayorId = seats[0].id;
  seats[0].office = 'mayor';
  const people: Citizen[] = [];
  for (let i = 0; i < extra; i++) people.push(makeCitizen(world, { name: `Citizen${i}`, brain: 'llm' }));
  return { seats, people };
}

// --------------------------------------------------------- bringing articles

test('an article must name conduct in office, and the officer must hold one', () => {
  const w = makeWorld();
  const { seats } = government(w);
  const nobody = makeCitizen(w, { name: 'Nobody' });
  assert.equal(impeach(w, seats[1].id, nobody.id, 'enrichment').ok, false);
  const bad = impeach(w, seats[1].id, seats[0].id, 'laziness' as 'duty');
  assert.equal(bad.ok, false);
  assert.match(bad.message, /conduct in office/);
  assert.equal(impeach(w, seats[0].id, seats[0].id, 'duty').ok, false, 'nobody impeaches themselves');
});

test('two councillors lay the charge, and one does not', () => {
  const w = makeWorld();
  // A city big enough that one name is not already a tenth of the franchise.
  const { seats } = government(w, 20);
  assert.equal(impeach(w, seats[1].id, seats[0].id, 'direction', 0.7).ok, true);
  let im = accountability(w).impeachments[0];
  assert.equal(im.result, 'gathering');
  assert.equal(impeach(w, seats[1].id, seats[0].id, 'direction').ok, false, 'one name each');
  assert.equal(impeach(w, seats[2].id, seats[0].id, 'direction').ok, true);
  im = accountability(w).impeachments[0];
  assert.equal(im.result, 'laid');
  assert.equal(im.hearingDay, w.day + 1);
});

test('a citizen who is not a councillor needs the charter\'s share of the franchise', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 20);
  const share = Math.ceil(charterOf(w).impeachment.chargeShare * (20 + 5));
  assert.equal(share, 3);
  for (const c of people.slice(0, 2)) assert.equal(impeach(w, c.id, seats[0].id, 'payment').ok, true);
  assert.equal(accountability(w).impeachments[0].result, 'gathering');
  assert.equal(impeach(w, people[2].id, seats[0].id, 'payment').ok, true);
  assert.equal(accountability(w).impeachments[0].result, 'laid');
});

// ---------------------------------------------------------------- the hearing

test('the Mayor answers to the Council at four fifths, and the accused does not vote', () => {
  const w = makeWorld();
  const { seats } = government(w);
  impeach(w, seats[1].id, seats[0].id, 'enrichment', 0.9);
  impeach(w, seats[2].id, seats[0].id, 'enrichment');
  const im = accountability(w).impeachments[0];
  assert.deepEqual(new Set(tribunalFor(w, im)), new Set(seats.slice(1).map((c) => c.id)));
  assert.equal(impeachmentNeeded(w, im), 4, 'four of the four who sit');
  assert.equal(voteImpeachment(w, seats[0].id, seats[0].id, false).ok, false, 'not the accused');
  for (const c of seats.slice(1)) assert.equal(voteImpeachment(w, c.id, seats[0].id, true).ok, true);
  w.day += 1;
  holdImpeachments(w);
  assert.equal(im.result, 'removed');
  assert.equal(w.government.mayorId !== seats[0].id, true);
  assert.equal(seats[0].office, 'councillor', 'the seat on the Council is not the chair');
});

test('a removal is not a conviction, and it bars the office for the charter\'s days', () => {
  const w = makeWorld();
  const { seats } = government(w);
  const mayor = seats[0];
  contributionLedger(w, mayor.id).mayorCycles = 1;
  contributionLedger(w, mayor.id).lastCycleCounted = w.government.cycle;
  impeach(w, seats[1].id, mayor.id, 'payment', 0.9);
  impeach(w, seats[2].id, mayor.id, 'payment');
  for (const c of seats.slice(1)) voteImpeachment(w, c.id, mayor.id, true);
  w.day += 1;
  holdImpeachments(w);
  assert.equal(mayor.record.convictions.length, 0, 'no entry on either track');
  assert.equal(mayor.standing, 'good');
  assert.equal(barredFromOffice(w, mayor.id), w.day + charterOf(w).impeachment.barDays);
  assert.equal(contributionLedger(w, mayor.id).mayorCycles, 0, 'the unfinished cycle pays nothing');
});

test('a judge answers to the other judges and the Council together', () => {
  const w = makeWorld();
  const { seats } = government(w);
  const judge = makeCitizen(w, { name: 'Judge' });
  const other = makeCitizen(w, { name: 'OtherJudge' });
  w.government.judges.push(judge.id, other.id);
  judge.office = 'judge';
  other.office = 'judge';
  assert.equal(officeOf(w, judge.id), 'judge');
  impeach(w, seats[1].id, judge.id, 'defiance', 0.8);
  impeach(w, seats[2].id, judge.id, 'defiance');
  const im = accountability(w).impeachments[0];
  assert.equal(tribunalFor(w, im).length, 6, 'five seats and one other judge');
  assert.equal(impeachmentNeeded(w, im), 5);
});

test('the Watch Captain answers to a simple majority, and the seat is emptied', () => {
  const w = makeWorld();
  const { seats } = government(w);
  const captain = makeCitizen(w, { name: 'Captain' });
  w.government.watch.push(captain.id);
  w.government.watchCaptainId = captain.id;
  captain.office = 'watch';
  impeach(w, seats[1].id, captain.id, 'direction', 0.8);
  impeach(w, seats[2].id, captain.id, 'direction');
  const im = accountability(w).impeachments[0];
  assert.equal(impeachmentNeeded(w, im), 3, 'three of five');
  for (const c of seats.slice(0, 3)) voteImpeachment(w, c.id, captain.id, true);
  w.day += 1;
  holdImpeachments(w);
  assert.equal(im.result, 'removed');
  assert.equal(w.government.watchCaptainId, null);
});

test('an acquittal costs the bringers, and twice on an article closes it for the cycle', () => {
  const w = makeWorld();
  const { seats } = government(w);
  const before = seats[1].reputation;
  for (let round = 0; round < 2; round++) {
    impeach(w, seats[1].id, seats[0].id, 'duty', 0.1);
    impeach(w, seats[2].id, seats[0].id, 'duty');
    for (const c of seats.slice(1)) voteImpeachment(w, c.id, seats[0].id, false);
    w.day += 1;
    holdImpeachments(w);
  }
  assert.equal(seats[1].reputation < before, true, 'the bringers lose standing');
  const third = impeach(w, seats[1].id, seats[0].id, 'duty');
  assert.equal(third.ok, false);
  assert.match(third.message, /cleared twice/);
});

test('a scripted tribunal member reads the evidence, the office and the officer', () => {
  const w = makeWorld();
  const { seats } = government(w);
  impeach(w, seats[1].id, seats[0].id, 'enrichment', 0.95);
  impeach(w, seats[2].id, seats[0].id, 'enrichment');
  const im = accountability(w).impeachments[0];
  assert.equal(impeachmentDisposition(w, seats[3].id, im), true, 'strong evidence reads as removal');
  im.evidence = 0.1;
  seats[4].bonds[seats[0].id] = 80;
  assert.equal(impeachmentDisposition(w, seats[4].id, im), false, 'a friend with nothing in front of them clears them');
});

test('articles against somebody who has already lost the office lapse', () => {
  const w = makeWorld();
  const { seats } = government(w);
  impeach(w, seats[1].id, seats[0].id, 'duty', 0.9);
  impeach(w, seats[2].id, seats[0].id, 'duty');
  w.government.mayorId = null;
  w.government.council = w.government.council.filter((id) => id !== seats[0].id);
  w.day += 1;
  holdImpeachments(w);
  assert.equal(accountability(w).impeachments[0].result, 'lapsed');
});

// ------------------------------------------------------------------- recall

test('a recall needs the charter to allow it', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 20);
  w.day += 10;
  const res = signRecall(w, people[0].id, seats[0].id);
  assert.equal(res.ok, false);
  assert.match(res.message, /does not allow/);
});

test('the share of the franchise carries a recall to a ballot, and the city answers it', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 15);
  charterOf(w).recall.allowed = true;
  charterOf(w).recall.share = 0.2;
  assert.equal(signRecall(w, people[0].id, seats[0].id).ok, false, 'not in the first seven days');
  w.day += 8;
  const needed = Math.ceil(0.2 * 20);
  for (const c of people.slice(0, needed - 1)) assert.equal(signRecall(w, c.id, seats[0].id).ok, true);
  assert.equal(recallStanding(w, seats[0].id)?.needed, needed);
  assert.equal(referendumsOfKind(w, 'recall').length, 0);
  assert.equal(signRecall(w, people[needed - 1].id, seats[0].id).ok, true);
  const ballot = referendumsOfKind(w, 'recall')[0];
  assert.ok(ballot, 'the names carry it to the city');

  // The city votes: everybody here thinks for themselves, so the ayes are theirs.
  w.day = ballot.day;
  for (const c of people.slice(0, 8)) assert.equal(voteReferendum(w, c.id, ballot.id, true).ok, true);
  assert.equal(voteReferendum(w, people[9].id, ballot.id, false).ok, true);
  holdReferendum(w);
  assert.equal(ballot.result, 'passed');
  w.day += 1;
  dailyRecalls(w);
  assert.equal(w.government.mayorId !== seats[0].id, true, 'the city removed them');
  assert.equal(w.government.election.electionDay, w.day + 3, 'and a by-election follows within three days');
});

test('a recall the city rejects leaves the officer where they are', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 15);
  charterOf(w).recall.allowed = true;
  w.day += 8;
  for (const c of people) if (!referendumsOfKind(w, 'recall')[0]) signRecall(w, c.id, seats[0].id);
  const ballot = referendumsOfKind(w, 'recall')[0];
  w.day = ballot.day;
  assert.equal(voteReferendum(w, people[0].id, ballot.id, true).ok, true);
  for (const c of people.slice(1, 6)) assert.equal(voteReferendum(w, c.id, ballot.id, false).ok, true);
  holdReferendum(w);
  assert.equal(ballot.result, 'failed');
  dailyRecalls(w);
  assert.equal(w.government.mayorId, seats[0].id);
  assert.equal(signRecall(w, people[0].id, seats[0].id).ok, false, 'and not twice in a cycle');
});

test('a by-election opens nominations at once', () => {
  const w = makeWorld();
  const { seats } = government(w);
  callByElection(w, 'a test');
  assert.equal(w.government.election.electionDay, w.day + 3);
  assert.equal(w.government.election.resolved, false);
  assert.deepEqual(w.government.election.ballots, {});
  assert.ok(seats.length > 0);
});

// -------------------------------------------------------- sitting unlawfully

test('a body sitting past its term with no election called answers for it', () => {
  const w = makeWorld();
  const { seats } = government(w);
  w.government.election.resolved = false;
  w.government.election.electionDay = w.day;
  dailySitting(w);
  assert.equal(offenceCount(w, 'L39'), 0, 'three days of grace');
  w.day += 4;
  dailySitting(w);
  assert.equal(offenceCount(w, 'L39'), 1);
  dailySitting(w);
  assert.equal(offenceCount(w, 'L39'), 1, 'and once a cycle, not once a morning');
  assert.ok(seats.length > 0);
});

test('holding office while barred from it is the same offence', () => {
  const w = makeWorld();
  const { seats } = government(w);
  w.counters[`barred:${seats[1].id}`] = w.day + 10;
  dailySitting(w);
  assert.equal(offenceCount(w, 'L39'), 1);
});

test('what a citizen reads of the two roads', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 15);
  charterOf(w).recall.allowed = true;
  w.day += 8;
  impeach(w, seats[1].id, seats[0].id, 'payment', 0.6);
  signRecall(w, people[0].id, seats[2].id);
  const seen = accountabilityObservation(w, seats[3]);
  assert.equal(seen.impeachments.length, 1);
  assert.equal(seen.impeachments[0].youSit, true);
  assert.equal(seen.recalls.length, 1);
  assert.equal(seen.recalls[0].youSigned, false);
  assert.equal(seen.barredUntil, null);
});

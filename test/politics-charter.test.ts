/**
 * The charter as data, and amending it (src/politics/charter.ts,
 * src/politics/amendments.ts, src/politics/measures.ts).
 *
 * What the founding charter says, who the franchise counts, the word the
 * classifier reads back, and the two things that make an amendment different
 * from an ordinary measure: the whole body's threshold, and the day's reading.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  amendingBody, amendmentNeeded, charterOf, classifyCharter, dailyCharter, editProblem, franchiseSize,
  franchiseThreshold, hasRight, inFranchise, isEntrenched, writeEdit, charterObservation,
} from '../src/politics/charter.ts';
import {
  amendmentDisposition, isSelfInterested, openAmendments, proposeAmendment, selfInterest,
} from '../src/politics/amendments.ts';
import {
  decidingBody, measureById, measureNeeded, measureSession, measuresObservation, openMeasures, tableMeasure, voteMeasure,
} from '../src/politics/measures.ts';
import { hooksFor, politicsSession } from '../src/politics/session.ts';

/** A council of `n`, the first of them Mayor, all of them scripted minds. */
function council(world: World, n: number): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCitizen(world, { name: `Councillor${i}` });
    out.push(c);
    world.government.council.push(c.id);
    c.office = 'councillor';
  }
  if (out.length > 0) {
    world.government.mayorId = out[0].id;
    out[0].office = 'mayor';
  }
  return out;
}

// --------------------------------------------------------------- the record

test('the founding charter is Reverie\'s, and a world saved before it reads as one', () => {
  const w = makeWorld();
  const ch = charterOf(w);
  assert.equal(ch.seats, 5);
  assert.equal(ch.wards, 'none');
  assert.equal(ch.franchise, 'all');
  assert.equal(ch.amendment.by, 'council');
  assert.equal(ch.amendment.threshold, 0.8);
  assert.deepEqual(ch.entrenched, ['due_process']);
  assert.deepEqual(ch.rights, ['due_process', 'press']);
  assert.equal(ch.recall.allowed, false);
  assert.equal(ch.impeachment.barDays, 56);
  assert.deepEqual(ch.transparency, { accounts: true, votes: true, register: true, foi: true });
  assert.equal(ch.convention.petitionShare, 0.25);
  assert.equal(hasRight(w, 'press'), true);
  assert.equal(isEntrenched(w, 'due_process'), true);
  assert.equal(isEntrenched(w, 'press'), false);
});

test('a charter carrying nonsense is read back to the nearest legal value, never refused', () => {
  const w = makeWorld();
  (w as { charter?: unknown }).charter = { seats: 99, franchise: 'goats', amendment: { by: 'nobody', threshold: 4 } };
  const ch = charterOf(w);
  assert.equal(ch.seats, 15);
  assert.equal(ch.franchise, 'all');
  assert.equal(ch.amendment.by, 'council');
  assert.equal(ch.amendment.threshold, 1);
});

// ------------------------------------------------------------- the franchise

test('the franchise decides who counts, and every threshold is measured in it', () => {
  const w = makeWorld();
  const people: Citizen[] = [];
  for (let i = 0; i < 10; i++) people.push(makeCitizen(w, { name: `Voter${i}`, brain: 'llm' }));
  assert.equal(franchiseSize(w), 10);
  assert.equal(franchiseThreshold(w, 0.25), 3);

  people[0].ownedUnits = ['u_1'];
  people[1].homeTier = 2;
  charterOf(w).franchise = 'property';
  assert.equal(franchiseSize(w), 2, 'only the propertied count now');
  assert.equal(inFranchise(w, people[3]), false);
  assert.equal(franchiseThreshold(w, 0.25), 1, 'a share of a narrow franchise is a smaller road back');

  charterOf(w).franchise = 'none';
  assert.equal(franchiseSize(w), 0);
  assert.equal(franchiseThreshold(w, 0.5), 1, 'a threshold is never zero names');
});

// ------------------------------------------------------------ the classifier

test('the classifier reads the word off the charter, autocracy first', () => {
  const w = makeWorld();
  assert.equal(classifyCharter(w), 'republic');

  const ch = charterOf(w);
  ch.franchise = 'shares';
  assert.equal(classifyCharter(w), 'oligarchy');
  ch.selection = 'examination';
  assert.equal(classifyCharter(w), 'oligarchy', 'the franchise is read before the selection');
  ch.franchise = 'guild';
  assert.equal(classifyCharter(w), 'technocracy');

  ch.franchise = 'all';
  ch.selection = 'election';
  ch.seats = 0;
  assert.equal(classifyCharter(w), 'assembly');

  ch.seats = 5;
  ch.term = 0;
  assert.equal(classifyCharter(w), 'autocracy', 'no term with an executive is autocracy whatever else it says');
  ch.term = 28;
  ch.amendment.by = 'executive';
  assert.equal(classifyCharter(w), 'autocracy', 'one office holding the charter is autocracy');
});

test('when the word changes the Chronicle leads with it, and nobody declared it', () => {
  const w = makeWorld();
  makeCitizen(w, { name: 'Reader' });
  dailyCharter(w);
  charterOf(w).franchise = 'shares';
  dailyCharter(w);
  const ev = w.events.filter((e) => e.kind === 'law' && e.text.includes('no longer a republic'));
  assert.equal(ev.length, 1, w.events.map((e) => e.text).join(' | '));
  assert.equal(charterOf(w).form, 'oligarchy');
  dailyCharter(w);
  assert.equal(w.events.filter((e) => e.text.includes('no longer a republic')).length, 1, 'it is news once');
});

// ------------------------------------------------------------- the amendment

test('an amendment needs the charter\'s fraction of the whole body, not of those voting', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  assert.deepEqual(new Set(amendingBody(w)), new Set(seats.map((c) => c.id)));
  assert.equal(amendmentNeeded(w), 4, 'four of five');
  assert.equal(measureNeeded(w, 'amend_charter'), 4);
  assert.equal(measureNeeded(w, 'transparency'), 3, 'ordinary measures are a simple majority');
});

test('an amendment is read the day after it is tabled, and not before', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  const res = proposeAmendment(w, seats[0].id, { article: 'seats', value: 7, words: 'seven seats' });
  assert.equal(res.ok, true, res.message);
  const m = openMeasures(w)[0];
  assert.equal(m.kind, 'amend_charter');
  assert.equal(m.readingDay, w.day + 1);
  politicsSession(w);
  assert.equal(m.status, 'open', 'the same day is too soon');
  for (const c of seats.slice(1)) assert.equal(voteMeasure(w, c.id, m.id, true).ok, true);
  w.day += 1;
  politicsSession(w);
  assert.equal(m.status, 'passed');
  assert.equal(charterOf(w).seats, 7);
  assert.equal(charterOf(w).amendedDay, w.day);
});

test('four of five carries an amendment and three of five does not', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  assert.equal(proposeAmendment(w, seats[0].id, { article: 'seats', value: 9 }).ok, true);
  const m = openMeasures(w)[0];
  assert.equal(voteMeasure(w, seats[1].id, m.id, true).ok, true);
  assert.equal(voteMeasure(w, seats[2].id, m.id, true).ok, true);
  assert.equal(voteMeasure(w, seats[3].id, m.id, false).ok, true);
  assert.equal(voteMeasure(w, seats[4].id, m.id, false).ok, true);
  w.day += 1;
  politicsSession(w);
  assert.equal(m.status, 'failed');
  assert.equal(charterOf(w).seats, 5, 'the charter is unchanged');
});

test('an entrenched article is refused with the reason and the road that is still open', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  const res = proposeAmendment(w, seats[0].id, { article: 'due_process', value: 1 });
  assert.equal(res.ok, false);
  charterOf(w).entrenched = ['rights', 'due_process'];
  const rights = proposeAmendment(w, seats[0].id, { article: 'rights', value: ['due_process'] });
  assert.equal(rights.ok, false);
  assert.match(rights.message, /entrenched/);
  assert.match(rights.message, /convention may/);
});

test('a council that entrenched a right may not strike it out of the rights either', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  charterOf(w).entrenched = ['due_process', 'press'];
  const res = proposeAmendment(w, seats[0].id, { article: 'rights', value: ['due_process'] });
  assert.equal(res.ok, false);
  assert.match(res.message, /press is entrenched/);
});

test('self-interest is flagged, loudly, and never blocked', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  assert.equal(selfInterest(w, { article: 'term', value: 56 }), 'it extends the term of the body voting on it');
  assert.equal(selfInterest(w, { article: 'franchise', value: 'property' }), 'it narrows the franchise');
  assert.match(String(selfInterest(w, { article: 'rights', value: ['due_process'] })), /strikes press/);
  assert.equal(selfInterest(w, { article: 'seats', value: 9 }), null);

  assert.equal(proposeAmendment(w, seats[0].id, { article: 'term', value: 56 }).ok, true, 'the engine does not block it');
  const m = openMeasures(w)[0];
  assert.equal(isSelfInterested(w, m), true);
  const seen = measuresObservation(w, seats[1], (x) => isSelfInterested(w, x));
  assert.equal(seen[0].selfInterested, true, 'and every citizen reads that it is');
  for (const c of seats.slice(1)) voteMeasure(w, c.id, m.id, true);
  w.day += 1;
  politicsSession(w);
  const headline = w.events.find((e) => e.kind === 'law' && e.text.includes('self-interested'));
  assert.ok(headline, 'the headline says so');
  assert.equal(charterOf(w).term, 56);
});

test('a scripted councillor reads an amendment from where they stand', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  seats[1].ownedUnits = ['u_1'];
  assert.equal(proposeAmendment(w, seats[0].id, { article: 'franchise', value: 'property' }).ok, true);
  const m = openMeasures(w)[0];
  assert.equal(amendmentDisposition(w, seats[1].id, m), true, 'a propertied member keeps their vote and gains');
  assert.equal(amendmentDisposition(w, seats[2].id, m), false, 'a member who would lose theirs votes nay');
});

test('a measure no body was left to read falls off the order paper, and the record keeps it', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  assert.equal(proposeAmendment(w, seats[0].id, { article: 'seats', value: 3 }).ok, true);
  const m = openMeasures(w)[0];
  assert.equal(openAmendments(w).length, 1);
  w.government.council = [];
  w.government.mayorId = null;
  w.day += 8;
  politicsSession(w);
  assert.equal(m.status, 'failed');
  assert.equal(measureById(w, m.id)?.status, 'failed');
  assert.equal(charterOf(w).seats, 5);
});

// --------------------------------------------------------------- the queue

test('only somebody who sits in the deciding body may table a measure', () => {
  const w = makeWorld();
  const seats = council(w, 3);
  const outsider = makeCitizen(w, { name: 'Outsider' });
  assert.deepEqual(new Set(decidingBody(w, 'transparency')), new Set(seats.map((c) => c.id)));
  const res = tableMeasure(w, outsider.id, { kind: 'transparency', subject: 'foi', value: 0 }, hooksFor('transparency') ?? undefined);
  assert.equal(res.ok, false);
  assert.equal(proposeAmendment(w, outsider.id, { article: 'seats', value: 7 }).ok, false);
});

test('the votes are named where the charter says they are, and a tally where it does not', () => {
  const w = makeWorld();
  const seats = council(w, 3);
  assert.equal(proposeAmendment(w, seats[0].id, { article: 'seats', value: 7 }).ok, true);
  const m = openMeasures(w)[0];
  const named = measuresObservation(w, seats[1])[0];
  assert.ok(named.votes && named.votes.length === 1, 'the mover\'s own aye is named');
  charterOf(w).transparency.votes = false;
  const quiet = measuresObservation(w, seats[1])[0];
  assert.equal(quiet.votes, null);
  assert.equal(quiet.ayes, 1, 'the tally is still public');
});

// ----------------------------------------------------------- the observation

test('what a citizen reads of the charter is the record, in names', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  for (let i = 0; i < 5; i++) makeCitizen(w, { name: `Other${i}`, brain: 'llm' });
  const seen = charterObservation(w, seats[0]);
  assert.equal(seen.form, 'republic');
  assert.equal(seen.youCount, true);
  assert.equal(seen.amendment.names, 4, 'four of the five who sit');
  assert.deepEqual(seen.rights, ['due_process', 'press']);
  assert.equal(seen.recall.allowed, false);
});

test('writeEdit reaches every article the charter has, and nothing else', () => {
  const w = makeWorld();
  assert.match(String(editProblem(w, { article: 'nowhere', value: 1 })), /no article/);
  assert.equal(editProblem(w, { article: 'amendment', field: 'threshold', value: 0.6 }), null);
  assert.ok(editProblem(w, { article: 'amendment', field: 'threshold', value: 0.2 }));
  writeEdit(w, { article: 'transparency', field: 'foi', value: false });
  assert.equal(charterOf(w).transparency.foi, false);
  writeEdit(w, { article: 'rights', value: [] });
  assert.deepEqual(charterOf(w).rights, []);
});

test('an amendment session with nobody in the body waits rather than passing itself', () => {
  const w = makeWorld();
  const seats = council(w, 5);
  assert.equal(proposeAmendment(w, seats[0].id, { article: 'seats', value: 7 }).ok, true);
  const m = openMeasures(w)[0];
  w.government.council = [];
  w.government.mayorId = null;
  w.day += 1;
  measureSession(w, hooksFor);
  assert.equal(m.status, 'open');
  assert.equal(charterOf(w).seats, 5);
});

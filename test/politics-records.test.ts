/**
 * Transparency (src/politics/records.ts): the four switches, the request that
 * is public whatever the answer, the register that makes a false return
 * provable, and the one reason no vote can reach.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { charterOf } from '../src/politics/charter.ts';
import {
  ANSWER_DAYS, FILING_DAYS, answerRecord, appealRecord, dailyRecords, dailyRegister, decideRecordAppeals,
  declareProperty, holdingsOf, publishAccounts, readRecord, recordsObservation, recordsState, registerEntry,
  requestRecord, returnIsTrue, speaksFor, transparencyHooks,
} from '../src/politics/records.ts';
import type { Measure } from '../src/politics/measures.ts';
import { offenceCount } from '../src/politics/offences.ts';

function government(world: World, extra = 0): { seats: Citizen[]; people: Citizen[] } {
  const seats: Citizen[] = [];
  for (let i = 0; i < 3; i++) {
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

// ------------------------------------------------------------------- the ask

test('with foi off there is no route, and with it on any citizen may ask', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 3);
  charterOf(w).transparency.foi = false;
  const closed = requestRecord(w, people[0].id, 'council', 'the zoning vote');
  assert.equal(closed.ok, false);
  assert.match(closed.message, /no route/);
  charterOf(w).transparency.foi = true;
  assert.equal(requestRecord(w, people[0].id, 'council', 'the zoning vote').ok, true);
  assert.equal(requestRecord(w, people[0].id, 'watch', 'the patrols').ok, false, 'one at a time');
  assert.equal(speaksFor(w, seats[0].id, 'council'), true);
  assert.equal(speaksFor(w, people[0].id, 'council'), false);
});

test('a request and its answer are public, whichever answer it gets', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 3);
  assert.equal(requestRecord(w, people[0].id, 'treasury', 'the last five entries').ok, true);
  const r = recordsState(w).requests[0];
  assert.equal(answerRecord(w, people[1].id, r.id, true).ok, false, 'only the body answers');
  assert.equal(answerRecord(w, seats[0].id, r.id, true).ok, true);
  assert.equal(r.answer, 'released');
  assert.ok(r.released && r.released.includes('Treasury'));
  assert.ok(w.events.some((e) => e.text.includes('released the record')));
});

test('a refusal names one of the four reasons, and silence is itself the story', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 3);
  requestRecord(w, people[0].id, 'watch', 'who was assigned');
  const r = recordsState(w).requests[0];
  assert.equal(answerRecord(w, seats[0].id, r.id, false, 'investigation').ok, false, 'the Watch answers for the Watch');
  w.government.watch.push(seats[1].id);
  assert.equal(answerRecord(w, seats[1].id, r.id, false, 'investigation').ok, true);
  assert.equal(r.reason, 'investigation');

  assert.equal(requestRecord(w, people[1].id, 'council', 'the vote of day one').ok, true);
  const ignored = recordsState(w).requests[1];
  w.day += ANSWER_DAYS + 1;
  dailyRecords(w);
  assert.equal(ignored.answer, 'ignored');
  assert.ok(w.events.some((e) => e.text.includes('lapse unanswered')));
});

test('a refusal is appealable once, and the Court may order release', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 3);
  const judge = makeCitizen(w, { name: 'Judge' });
  w.government.judges.push(judge.id);
  requestRecord(w, people[0].id, 'council', 'the sealed deliberation');
  const r = recordsState(w).requests[0];
  answerRecord(w, seats[0].id, r.id, false, 'deliberation');
  assert.equal(appealRecord(w, seats[0].id, r.id).ok, false, 'only the citizen who asked');
  assert.equal(appealRecord(w, people[0].id, r.id).ok, true);
  assert.equal(appealRecord(w, people[0].id, r.id).ok, false, 'the Court hears it once');
  decideRecordAppeals(w);
  assert.equal(r.ordered, true);
  assert.equal(r.answer, 'open', 'the body has to answer again');
});

test('a live investigation stands, and notes and letters are never ordered released by anybody', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 3);
  const judge = makeCitizen(w, { name: 'Judge' });
  w.government.judges.push(judge.id);

  requestRecord(w, people[0].id, 'court', 'the case against Vell');
  const live = recordsState(w).requests[0];
  answerRecord(w, judge.id, live.id, false, 'investigation');
  appealRecord(w, people[0].id, live.id);
  decideRecordAppeals(w);
  assert.equal(live.ordered, false, 'the Court upheld it');

  requestRecord(w, people[1].id, 'registry', 'what Seat0 wrote in their notebook');
  const private_ = recordsState(w).requests[1];
  answerRecord(w, seats[0].id, private_.id, false, 'private');
  appealRecord(w, people[1].id, private_.id);
  decideRecordAppeals(w);
  assert.equal(private_.ordered, false);
  assert.ok(w.events.some((e) => e.text.includes('no body in any city may read them')));
});

test('a body that sits on a record the Court ordered released is obstructing one', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 3);
  const judge = makeCitizen(w, { name: 'Judge' });
  w.government.judges.push(judge.id);
  requestRecord(w, people[0].id, 'council', 'the vote');
  const r = recordsState(w).requests[0];
  answerRecord(w, seats[0].id, r.id, false, 'deliberation');
  appealRecord(w, people[0].id, r.id);
  decideRecordAppeals(w);
  w.day += 2;
  dailyRecords(w);
  assert.equal(offenceCount(w, 'L38'), 1);
});

test('what the bodies actually hold is what is already public', () => {
  const w = makeWorld();
  const { seats } = government(w);
  assert.match(readRecord(w, 'watch', 'anything'), /The Watch/);
  assert.match(readRecord(w, 'registry', 'Seat0'), /standing good/);
  assert.match(readRecord(w, 'council', 'nothing at all'), /no paper/);
  assert.ok(seats.length > 0);
});

// ---------------------------------------------------------------- the register

test('an officeholder files what the registers already show, and it is public', () => {
  const w = makeWorld();
  const { seats } = government(w);
  seats[0].ownedUnits = ['u_1', 'u_2'];
  const res = declareProperty(w, seats[0].id);
  assert.equal(res.ok, true, res.message);
  const filed = registerEntry(w, seats[0].id);
  assert.equal(filed?.homes, 2);
  assert.equal(returnIsTrue(w, seats[0]), true);
  assert.equal(holdingsOf(w, seats[0]).homes, 2);
});

test('a return that stopped being true is a false return after three days', () => {
  const w = makeWorld();
  const { seats } = government(w);
  declareProperty(w, seats[0].id);
  declareProperty(w, seats[1].id);
  declareProperty(w, seats[2].id);
  seats[0].ownedUnits = ['u_9'];
  assert.equal(returnIsTrue(w, seats[0]), false);
  dailyRegister(w);
  assert.equal(offenceCount(w, 'L37'), 0, 'three days to put it right');
  w.day += FILING_DAYS;
  dailyRegister(w);
  assert.equal(offenceCount(w, 'L37'), 1);
  declareProperty(w, seats[0].id);
  w.day += FILING_DAYS + 1;
  dailyRegister(w);
  assert.equal(offenceCount(w, 'L37'), 1, 'and a return put right is the end of it');
});

test('with the register switched off nobody files and nobody answers for it', () => {
  const w = makeWorld();
  const { seats } = government(w);
  charterOf(w).transparency.register = false;
  assert.equal(declareProperty(w, seats[0].id).ok, false);
  w.day += 10;
  dailyRegister(w);
  assert.equal(offenceCount(w, 'L37'), 0);
});

// ------------------------------------------------------------------ accounts

test('accounts on publishes the day\'s movements; off, a monthly line', () => {
  const w = makeWorld();
  government(w);
  publishAccounts(w);
  assert.ok(w.events.some((e) => e.kind === 'treasury' && e.text.includes('The accounts for day')));
  charterOf(w).transparency.accounts = false;
  w.events.length = 0;
  w.day = 3;
  publishAccounts(w);
  assert.equal(w.events.length, 0, 'not on an ordinary day');
  w.day = w.config.cycleDays;
  publishAccounts(w);
  assert.ok(w.events.some((e) => e.text.includes('once a month')));
});

test('a transparency measure moves one switch, and a councillor with holdings reads it', () => {
  const w = makeWorld();
  const { seats } = government(w);
  assert.ok(transparencyHooks.problem?.(w, { kind: 'transparency', subject: 'nonsense', value: 1 }, seats[0]));
  assert.ok(transparencyHooks.problem?.(w, { kind: 'transparency', subject: 'foi', value: 1 }, seats[0]),
    'the switch is already on');
  const m: Measure = {
    id: 'p_t', kind: 'transparency', value: 0, subject: 'foi', edit: null, words: 'close the route',
    proposerId: seats[0].id, tabledDay: w.day, readingDay: w.day, votes: {}, needed: 2,
    status: 'open', decidedDay: null,
  };
  seats[1].ownedUnits = ['u_1'];
  assert.equal(transparencyHooks.disposition?.(w, seats[1].id, m), true, 'a member with something filed votes to close it');
  assert.equal(transparencyHooks.disposition?.(w, seats[2].id, m), null, 'and one with nothing has no reading');
  const text = transparencyHooks.enact(w, m);
  assert.match(text, /closed/);
  assert.equal(charterOf(w).transparency.foi, false);
});

test('what a citizen reads of the records', () => {
  const w = makeWorld();
  const { seats, people } = government(w, 2);
  requestRecord(w, people[0].id, 'council', 'the zoning vote of day one');
  const seen = recordsObservation(w, seats[0]);
  assert.equal(seen.transparency.foi, true);
  assert.equal(seen.requests.length, 1);
  assert.equal(seen.requests[0].of, 'council');
  assert.equal(seen.yourReturnDue, true, 'an officeholder who has filed nothing owes a return');
  declareProperty(w, seats[0].id);
  assert.equal(recordsObservation(w, seats[0]).yourReturnDue, false);
});

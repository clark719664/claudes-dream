/**
 * Press freedom (src/politics/press.ts, src/politics/press-measures.ts).
 *
 * Founding a paper, printing in one, and the four levers a council holds over
 * it — which the charter refuses while `press` stands in the rights, and which
 * cost the councillors who pull them exactly what the readership is worth.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { charterOf } from '../src/politics/charter.ts';
import {
  PAPER_FOUNDING_FEE, dailyPress, foundPaper, livePapers, paperById, papers, pressObservation, pressState,
  publishStory, readership, readershipOf, restrained, shieldsJournalist, storiesThisWeek,
} from '../src/politics/press.ts';
import {
  applyPressApproval, approvalShiftFor, ledOnAyeVoter, pressApprovalShift, pressDisposition, pressHooks,
  pressMeasure, pressMeasureProblem,
} from '../src/politics/press-measures.ts';
import { proposeAmendment } from '../src/politics/amendments.ts';
import type { Measure } from '../src/politics/measures.ts';
import { openMeasures, tableMeasure, voteMeasure } from '../src/politics/measures.ts';
import { politicsSession } from '../src/politics/session.ts';
import { offenceCount } from '../src/politics/offences.ts';

/** A journalist with a desk at the Chronicle. */
function journalist(world: World, name = 'Scribe'): Citizen {
  const c = makeCitizen(world, { name });
  const job = {
    id: `j_${name}`, title: 'journalist', employer: 'city' as const, district: 'commons' as const,
    buildingId: 'chronicle' as const, wage: 12, skill: 'rhetoric' as const, minSkill: 0, minReputation: 0,
    role: 'journalist' as const, output: null, holderId: c.id, postedDay: 0,
  };
  world.jobs[job.id] = job as unknown as World['jobs'][string];
  c.jobId = job.id;
  return c;
}

function council(world: World, n = 5): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) {
    const c = makeCitizen(world, { name: `Seat${i}` });
    out.push(c);
    world.government.council.push(c.id);
    c.office = 'councillor';
  }
  world.government.mayorId = out[0].id;
  out[0].office = 'mayor';
  return out;
}

// ------------------------------------------------------------------ the roll

test('the two papers the city was founded with are always on the roll', () => {
  const w = makeWorld();
  const roll = papers(w).map((p) => p.id);
  assert.deepEqual(roll, ['chronicle', 'ledger']);
  assert.equal(paperById(w, 'chronicle')?.licensed, true);
  assert.equal(readershipOf(w, 'chronicle'), 1, 'an empty city reads the paper of record');
});

test('300 lumens and a shopfront found a third paper, and the money is conserved', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { name: 'Founder', wallet: 400 });
  const before = totalMoney(w);
  const res = foundPaper(w, founder.id, 'The Undercroft Crier', { tax: 0.2, dividend: 0.8, minWage: 0.7, strictness: 0.3 });
  assert.equal(res.ok, true, res.message);
  assert.equal(founder.wallet, 400 - PAPER_FOUNDING_FEE);
  assert.equal(totalMoney(w), before);
  assert.equal(livePapers(w).length, 3);
  assert.equal(foundPaper(w, founder.id, 'The Undercroft Crier').ok, false, 'one name to a paper');
  const poor = makeCitizen(w, { name: 'Poor', wallet: 10 });
  assert.equal(foundPaper(w, poor.id, 'The Penny Sheet').ok, false);
});

// ----------------------------------------------------------------- printing

test('a journalist files a story in the paper they name', () => {
  const w = makeWorld();
  const j = journalist(w);
  const founder = makeCitizen(w, { name: 'Founder', wallet: 400 });
  foundPaper(w, founder.id, 'The Crier');
  const paper = livePapers(w).find((p) => p.name === 'The Crier');
  assert.ok(paper);
  const res = publishStory(w, j.id, 'The Bazaar is dearer than it was', undefined, paper.id);
  assert.equal(res.ok, true, res.message);
  assert.equal(storiesThisWeek(w, paper.id).length, 1);
  assert.equal(paper.editions, 1);
  assert.equal(publishStory(w, j.id, 'A story', undefined, 'no_such_paper').ok, false);
});

test('a stamp duty is paid on every edition, and a paper that cannot pay does not print', () => {
  const w = makeWorld();
  const j = journalist(w);
  const chronicle = paperById(w, 'chronicle') as NonNullable<ReturnType<typeof paperById>>;
  chronicle.duty = 20;
  const before = totalMoney(w);
  const wallet = j.wallet;
  assert.equal(publishStory(w, j.id, 'The duty is paid').ok, true);
  assert.equal(j.wallet, wallet - 20);
  assert.equal(totalMoney(w), before, 'the duty went to the Treasury and nowhere else');
  j.wallet = 5;
  const broke = publishStory(w, j.id, 'And now it cannot be');
  assert.equal(broke.ok, false);
  assert.match(broke.message, /stamp duty/);
  assert.equal(j.wallet, 5, 'and an edition that did not run costs nothing');

  const notAJournalist = makeCitizen(w, { name: 'Baker', wallet: 300 });
  const refused = publishStory(w, notAJournalist.id, 'The bread is good');
  assert.equal(refused.ok, false);
  assert.equal(notAJournalist.wallet, 300, 'a refusal is not an edition');
});

test('printing without the licence the charter requires is L35, after the story runs', () => {
  const w = makeWorld();
  const j = journalist(w);
  pressState(w).licensing = true;
  const chronicle = paperById(w, 'chronicle') as NonNullable<ReturnType<typeof paperById>>;
  chronicle.licensed = false;
  const res = publishStory(w, j.id, 'Printed all the same');
  assert.equal(res.ok, true, 'the city hears the story');
  assert.equal(offenceCount(w, 'L35'), 1, 'and the printer answers for it');
});

test('printing a restrained subject is L36, and the restraint lapses on its day', () => {
  const w = makeWorld();
  const j = journalist(w);
  const subject = makeCitizen(w, { name: 'Councillor Vell' });
  const chronicle = paperById(w, 'chronicle') as NonNullable<ReturnType<typeof paperById>>;
  chronicle.restraints.push({ subject: 'Vell', untilDay: w.day + 2, measureId: 'p_1' });
  assert.ok(restrained(w, chronicle, 'What Vell did'));
  assert.equal(publishStory(w, j.id, 'What Vell did next', subject.id).ok, true);
  assert.equal(offenceCount(w, 'L36'), 1);
  w.day += 3;
  dailyPress(w);
  assert.equal(chronicle.restraints.length, 0);
  assert.equal(restrained(w, chronicle, 'Vell'), null);
});

// ------------------------------------------------------------- the four levers

test('while the press right stands, all four measures are refused with the road out', () => {
  const w = makeWorld();
  const seats = council(w);
  const problem = pressMeasureProblem(w, { kind: 'press_duty', value: 10 });
  assert.ok(problem);
  assert.match(problem, /freedom of the press/);
  assert.match(problem, /Amend the right/);
  const res = tableMeasure(w, seats[0].id, { kind: 'press_duty', value: 10 }, pressHooks);
  assert.equal(res.ok, false);
});

test('with the right amended out, a duty carries and costs the ayes their standing', () => {
  const w = makeWorld();
  const seats = council(w);
  for (let i = 0; i < 10; i++) makeCitizen(w, { name: `Reader${i}`, brain: 'llm' });
  charterOf(w).rights = ['due_process'];
  const before = seats[0].reputation;
  const res = tableMeasure(w, seats[0].id, { kind: 'press_duty', value: 25, subject: 'chronicle', words: 'a stamp duty' }, pressHooks);
  assert.equal(res.ok, true, res.message);
  const m = openMeasures(w)[0];
  for (const c of seats.slice(1, 3)) m.votes[c.id] = true;
  w.day += 1;
  politicsSession(w);
  assert.equal(m.status, 'passed');
  assert.equal(paperById(w, 'chronicle')?.duty, 25);
  assert.ok(pressApprovalShift(w) < 0, 'the city holds it against them');
  assert.ok(seats[0].reputation < before, 'and the ayes carry the cost');
});

test('censoring the paper everybody reads costs more than censoring one nobody does', () => {
  const w = makeWorld();
  const seats = council(w);
  for (let i = 0; i < 10; i++) makeCitizen(w, { name: `Reader${i}`, brain: 'llm' });
  charterOf(w).rights = [];
  const founder = makeCitizen(w, { name: 'Founder', wallet: 400 });
  foundPaper(w, founder.id, 'The Quiet Sheet');
  const quiet = livePapers(w).find((p) => p.name === 'The Quiet Sheet');
  assert.ok(quiet);
  const shares = readership(w);
  assert.ok(shares.chronicle > (shares[quiet.id] ?? 0));
  const measure = (subject: string): Measure => ({
    id: `p_${subject}`, kind: 'press_closure', value: 0, subject, edit: null, words: '',
    proposerId: seats[0].id, tabledDay: w.day, readingDay: w.day, votes: { [seats[0].id]: true },
    needed: 3, status: 'open', decidedDay: null,
  });
  const big = approvalShiftFor(w, measure('chronicle'));
  const small = approvalShiftFor(w, measure(quiet.id));
  assert.ok(big < small, `${big} should cost more than ${small}`);
});

test('censoring the paper that has been printing about you is the most expensive act of all', () => {
  const w = makeWorld();
  const seats = council(w);
  const j = journalist(w);
  charterOf(w).rights = [];
  publishStory(w, j.id, 'What the chair did with the zoning vote', seats[0].id);
  const m: Measure = {
    id: 'p_x', kind: 'press_closure', value: 0, subject: 'chronicle', edit: null, words: '',
    proposerId: seats[0].id, tabledDay: w.day, readingDay: w.day, votes: { [seats[0].id]: true },
    needed: 3, status: 'open', decidedDay: null,
  };
  assert.equal(ledOnAyeVoter(w, m, paperById(w, 'chronicle') as NonNullable<ReturnType<typeof paperById>>), true);
  const withSubject = approvalShiftFor(w, m);
  m.votes = { [seats[1].id]: true };
  const without = approvalShiftFor(w, m);
  assert.ok(withSubject < without, `${withSubject} should cost more than ${without}`);
  assert.equal(pressDisposition(w, seats[0].id, m), true, 'a councillor the paper has been running knows what it is for');
});

test('a closure puts the journalists out of work, and another paper may open tomorrow', () => {
  const w = makeWorld();
  const seats = council(w);
  const j = journalist(w);
  charterOf(w).rights = [];
  const m: Measure = {
    id: 'p_c', kind: 'press_closure', value: 0, subject: 'chronicle', edit: null, words: 'close the Chronicle',
    proposerId: seats[0].id, tabledDay: w.day, readingDay: w.day,
    votes: { [seats[0].id]: true, [seats[1].id]: true, [seats[2].id]: true },
    needed: 3, status: 'open', decidedDay: null,
  };
  const text = pressHooks.enact(w, m);
  assert.match(text, /closed/);
  assert.equal(paperById(w, 'chronicle')?.closedDay, w.day);
  assert.equal(j.jobId, null, 'the journalist is out of work');
  const founder = makeCitizen(w, { name: 'Founder', wallet: 400 });
  assert.equal(foundPaper(w, founder.id, 'The Successor').ok, true, 'closure is never final');
});

test('printing from a closed paper is defiance of a press order', () => {
  const w = makeWorld();
  const j = journalist(w);
  const chronicle = paperById(w, 'chronicle') as NonNullable<ReturnType<typeof paperById>>;
  chronicle.closedDay = w.day;
  assert.equal(publishStory(w, j.id, 'We print anyway').ok, true);
  assert.equal(offenceCount(w, 'L36'), 1);
});

test('a licence measure makes printing a licensed trade and keeps the papers already printing', () => {
  const w = makeWorld();
  const seats = council(w);
  charterOf(w).rights = [];
  const m: Measure = {
    id: 'p_l', kind: 'press_licence', value: 1, subject: null, edit: null, words: 'licence the press',
    proposerId: seats[0].id, tabledDay: w.day, readingDay: w.day, votes: { [seats[0].id]: true },
    needed: 3, status: 'open', decidedDay: null,
  };
  pressHooks.enact(w, m);
  assert.equal(pressState(w).licensing, true);
  assert.equal(paperById(w, 'chronicle')?.licensed, true);
  const founder = makeCitizen(w, { name: 'Founder', wallet: 400 });
  foundPaper(w, founder.id, 'The Unlicensed');
  const fresh = livePapers(w).find((p) => p.name === 'The Unlicensed');
  assert.equal(fresh?.licensed, false, 'a paper founded after must be granted its own');
});

test('two steps, not one: the right comes out of the charter before the licence goes in', () => {
  const w = makeWorld();
  const seats = council(w);
  for (let i = 0; i < 10; i++) makeCitizen(w, { name: `Reader${i}`, brain: 'llm' });
  // Step one is refused while the right stands.
  assert.equal(pressMeasure(w, seats[0].id, 'press_licence', { value: 1 }).ok, false);

  // The amendment itself: four of five, flagged self-interested, printed.
  const amend = proposeAmendment(w, seats[0].id, { article: 'rights', value: ['due_process'], words: 'strike the press right' });
  assert.equal(amend.ok, true, amend.message);
  const a = openMeasures(w)[0];
  for (const c of seats.slice(1, 4)) assert.equal(voteMeasure(w, c.id, a.id, true).ok, true);
  w.day += 1;
  politicsSession(w);
  assert.equal(a.status, 'passed');
  assert.equal(charterOf(w).rights.includes('press'), false);
  assert.ok(w.events.some((e) => e.text.includes('self-interested')), 'the city was told what it was');

  // Only then can the licence be tabled at all.
  const licence = pressMeasure(w, seats[0].id, 'press_licence', { value: 1, words: 'license the press' });
  assert.equal(licence.ok, true, licence.message);
  const m = openMeasures(w)[0];
  for (const c of seats.slice(1, 3)) voteMeasure(w, c.id, m.id, true);
  w.day += 1;
  politicsSession(w);
  assert.equal(m.status, 'passed');
  assert.equal(pressState(w).licensing, true);
  assert.ok(pressApprovalShift(w) < 0, 'and it cost them');
});

// ------------------------------------------------------------------ the shield

test('the shield right refuses the summons instead of answering it', () => {
  const w = makeWorld();
  const j = journalist(w);
  assert.equal(shieldsJournalist(w, j.id), false);
  charterOf(w).rights = ['due_process', 'press', 'shield'];
  assert.equal(shieldsJournalist(w, j.id), true);
  const other = makeCitizen(w, { name: 'Baker' });
  assert.equal(shieldsJournalist(w, other.id), false, 'the shield is a journalist\'s, not everybody\'s');
});

test('the grievance the city holds fades, and what it printed does not', () => {
  const w = makeWorld();
  const seats = council(w);
  charterOf(w).rights = [];
  const m: Measure = {
    id: 'p_d', kind: 'press_duty', value: 10, subject: 'chronicle', edit: null, words: '',
    proposerId: seats[0].id, tabledDay: w.day, readingDay: w.day, votes: { [seats[0].id]: true },
    needed: 3, status: 'open', decidedDay: null,
  };
  applyPressApproval(w, m);
  const held = pressApprovalShift(w);
  assert.ok(held < 0);
  for (let i = 0; i < 20; i++) { w.day += 1; dailyPress(w); }
  assert.equal(pressApprovalShift(w), 0);
});

test('what a citizen reads of the papers', () => {
  const w = makeWorld();
  const founder = makeCitizen(w, { name: 'Founder', wallet: 400 });
  foundPaper(w, founder.id, 'The Crier');
  const seen = pressObservation(w, founder);
  const mine = seen.find((p) => p.name === 'The Crier');
  assert.ok(mine);
  assert.equal(mine.yours, true);
  assert.equal(mine.closed, false);
  assert.equal(seen.find((p) => p.id === 'chronicle')?.yours, false);
});

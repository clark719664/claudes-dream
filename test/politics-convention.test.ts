/**
 * The constitutional convention (src/politics/convention.ts,
 * src/politics/convention-floor.ts).
 *
 * Calling one, seating its delegates, the floor's own rules — quorum, a
 * majority of the seated, absence as a no — and the ratification that either
 * replaces the charter whole at the next dawn or closes the road for a cycle.
 * Including the article the Council may not reach, and the charter that ends
 * the vote: the engine permits it, and prints the word for it.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import { charterOf, classifyCharter, franchiseThreshold } from '../src/politics/charter.ts';
import {
  callConvention, conventionHooks, conventionObservation, conventionRunning, convention, delegateSeats,
  isDelegate, liveSignatures, refuseDelegacy, signConvention, standDelegate, voteDelegate,
} from '../src/politics/convention.ts';
import {
  adoptDraft, conventionSitting, dailyConvention, draft, moveArticle, ratifyDisposition, speakConvention, voteArticle,
} from '../src/politics/convention-floor.ts';
import { holdReferendum, referendumsOfKind, voteReferendum } from '../src/politics/referendums.ts';
import { offenceCount } from '../src/politics/offences.ts';

/** A city of `n` grown citizens who think for themselves. */
function city(world: World, n: number, brain: Citizen['brain'] = 'llm'): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) out.push(makeCitizen(world, { name: `Citizen${i}`, brain }));
  return out;
}

// --------------------------------------------------------------- calling one

test('a quarter of the franchise calls a convention, and fewer does not', () => {
  const w = makeWorld();
  const people = city(w, 12);
  const needed = franchiseThreshold(w, 0.25);
  assert.equal(needed, 3);
  assert.equal(signConvention(w, people[0].id).ok, true);
  assert.equal(convention(w).state, 'petition');
  assert.equal(signConvention(w, people[0].id).ok, false, 'one name each');
  assert.equal(liveSignatures(w).length, 1);
  signConvention(w, people[1].id);
  assert.equal(convention(w).state, 'petition');
  signConvention(w, people[2].id);
  assert.equal(convention(w).state, 'delegates', 'the third name calls it');
  assert.equal(conventionRunning(w), true);
});

test('a petition that runs out of days lapses', () => {
  const w = makeWorld();
  const people = city(w, 40);
  signConvention(w, people[0].id);
  w.day += 15;
  dailyConvention(w);
  assert.equal(convention(w).state, 'failed');
});

test('the amending body can call one itself, at its own high threshold', () => {
  const w = makeWorld();
  const seats = city(w, 5, 'reflex');
  for (const c of seats) { w.government.council.push(c.id); c.office = 'councillor'; }
  w.government.mayorId = seats[0].id;
  assert.equal(conventionHooks.problem?.(w, { kind: 'call_convention' }, seats[0]) ?? null, null);
  conventionHooks.enact(w, { kind: 'call_convention', id: 'p_1', value: 0, subject: null, edit: null, words: '',
    proposerId: seats[0].id, tabledDay: 0, readingDay: 1, votes: {}, needed: 4, status: 'passed', decidedDay: 0 });
  assert.equal(convention(w).state, 'delegates');
  assert.equal(conventionHooks.problem?.(w, { kind: 'call_convention' }, seats[0]) ?? null, 'A convention is already under way.');
});

// ---------------------------------------------------------------- delegates

test('the seats are one per twelve residents, seven to fifteen, and always odd', () => {
  const w = makeWorld();
  city(w, 4);
  assert.equal(delegateSeats(w), 7, 'a small city still seats seven');
  city(w, 116);
  assert.equal(delegateSeats(w), 11);
  city(w, 200);
  assert.equal(delegateSeats(w), 15, 'and never more than fifteen');
});

test('a seat drawn by lot is freely refusable, and the next name is drawn', () => {
  const w = makeWorld();
  const people = city(w, 30, 'reflex');
  charterOf(w).convention.delegates = 'lot';
  callConvention(w, 'petition');
  w.day += 1;
  dailyConvention(w);
  const v = convention(w);
  assert.equal(v.state, 'sitting');
  assert.equal(v.delegates.length, v.seats);
  const first = v.delegates[0];
  assert.equal(refuseDelegacy(w, first).ok, true);
  assert.equal(isDelegate(w, first), false);
  assert.equal(v.delegates.length, v.seats, 'the seat is filled by somebody else');
  assert.equal(v.delegates.includes(first), false);
  assert.ok(people.length > 0);
});

test('a mixed convention elects half its seats and draws the rest', () => {
  const w = makeWorld();
  const people = city(w, 36, 'reflex');
  callConvention(w, 'petition');
  assert.equal(convention(w).state, 'delegates');
  assert.equal(standDelegate(w, people[0].id).ok, true);
  assert.equal(standDelegate(w, people[1].id).ok, true);
  assert.equal(voteDelegate(w, people[2].id, people[0].id).ok, true);
  assert.equal(voteDelegate(w, people[2].id, people[1].id).ok, false, 'one ballot each');
  w.day += 3;
  dailyConvention(w);
  const v = convention(w);
  assert.equal(v.state, 'sitting');
  assert.equal(v.delegates.includes(people[0].id), true, 'the elected seat went to the one the city voted for');
  assert.equal(v.delegates.length, v.seats);
});

// -------------------------------------------------------------- the sitting

/** A sitting convention of scripted delegates. */
function sitting(world: World, n = 30): { people: Citizen[]; delegates: Citizen[] } {
  const people = city(world, n, 'reflex');
  charterOf(world).convention.delegates = 'lot';
  callConvention(world, 'petition');
  world.day += 1;
  dailyConvention(world);
  const delegates = convention(world).delegates.map((id) => world.citizens[id]);
  return { people, delegates };
}

test('only a delegate has the floor, and the third refusal is interference', () => {
  const w = makeWorld();
  const { people } = sitting(w);
  const outsider = people.find((c) => !isDelegate(w, c.id)) as Citizen;
  for (let i = 0; i < 2; i++) {
    assert.equal(moveArticle(w, outsider.id, { article: 'seats', value: 9 }).ok, false);
  }
  assert.equal(offenceCount(w, 'L40'), 0);
  const third = voteArticle(w, outsider.id, 'w_1', true);
  assert.equal(third.ok, false);
  assert.equal(offenceCount(w, 'L40'), 1, 'the city notices somebody who will not take no for an answer');
});

test('an article carries on a majority of the delegates seated, so absence is a no', () => {
  const w = makeWorld();
  const { delegates } = sitting(w);
  const mover = delegates[0];
  assert.equal(moveArticle(w, mover.id, { article: 'seats', value: 9, words: 'nine seats' }).ok, true);
  const a = convention(w).articles[0];
  assert.equal(a.result, 'open');
  // Two ayes out of seven seats is not a majority of the seated.
  assert.equal(voteArticle(w, delegates[1].id, a.id, true).ok, true);
  for (const d of delegates.slice(2)) d.brain = 'llm';   // minds of their own who stayed silent
  conventionSitting(w);
  assert.equal(a.result, 'lost', 'silence is not an aye');
  assert.equal(charterOf(w).seats, 5);
});

test('quorum is two thirds, and a convention that cannot sit does not', () => {
  const w = makeWorld();
  const { delegates } = sitting(w);
  for (const d of delegates.slice(2)) d.standing = 'exiled';
  conventionSitting(w);
  const notice = w.events.find((e) => e.text.includes('could not sit'));
  assert.ok(notice, 'the city is told the room was empty');
});

test('a delegate draws a judge\'s wage for the day, and the money is conserved', () => {
  const w = makeWorld();
  const { delegates } = sitting(w);
  const before = totalMoney(w);
  conventionSitting(w);
  assert.equal(totalMoney(w), before, 'the Treasury paid it and nothing was made');
  assert.ok(delegates.some((d) => d.wallet > 200), 'somebody was actually paid');
  const paid = totalMoney(w);
  conventionSitting(w);
  assert.equal(totalMoney(w), paid, 'and only once a day');
});

test('a speech is public, verbatim and quotable', () => {
  const w = makeWorld();
  const { delegates } = sitting(w);
  assert.equal(speakConvention(w, delegates[0].id, 'The franchise is the road back.').ok, true);
  const ev = w.events.find((e) => e.text.includes('The franchise is the road back.'));
  assert.ok(ev);
  assert.equal(convention(w).speeches.length, 1);
});

// ---------------------------------------------------------- what it can do

test('a convention reaches an entrenched article the Council may not', () => {
  const w = makeWorld();
  const { delegates } = sitting(w);
  assert.deepEqual(charterOf(w).entrenched, ['due_process']);
  const moved = moveArticle(w, delegates[0].id, { article: 'rights', value: ['press'], words: 'strike due process' });
  assert.equal(moved.ok, true, moved.message);
  const a = convention(w).articles[0];
  for (const d of delegates) voteArticle(w, d.id, a.id, true);
  conventionSitting(w);
  assert.equal(a.result, 'carried');
  assert.deepEqual(draft(w).length, 1);
});

test('a convention can end the vote, and the engine does not refuse it', () => {
  const w = makeWorld();
  const { delegates } = sitting(w);
  const articles: string[] = [];
  for (const [i, edit] of ([
    { article: 'selection', value: 'none' },
    { article: 'term', value: 0 },
    { article: 'franchise', value: 'shares' },
  ] as const).entries()) {
    const mover = delegates[i % delegates.length];
    const res = moveArticle(w, mover.id, { article: edit.article, value: edit.value });
    assert.equal(res.ok, true, res.message);
    articles.push(convention(w).articles[convention(w).articles.length - 1].id);
  }
  for (const id of articles) for (const d of delegates) voteArticle(w, d.id, id, true);
  conventionSitting(w);
  assert.equal(draft(w).length, 3);
  adoptDraft(w);
  assert.equal(charterOf(w).term, 0);
  assert.equal(charterOf(w).franchise, 'shares');
  assert.equal(classifyCharter(w), 'autocracy', 'the classifier prints the word for it');
});

// ---------------------------------------------------------- ratification

/** Carry one article and take the convention to the ballot. */
function toTheBallot(world: World, delegates: Citizen[]): void {
  const res = moveArticle(world, delegates[0].id, { article: 'seats', value: 9, words: 'nine seats' });
  assert.equal(res.ok, true, res.message);
  const a = convention(world).articles[0];
  for (const d of delegates) voteArticle(world, d.id, a.id, true);
  const v = convention(world);
  world.day = (v.sittingUntil ?? world.day);
  conventionSitting(world);
  assert.equal(v.state, 'ratifying', 'the draft goes to the city');
}

test('the draft goes whole to the city, and a turnout too small fails it', () => {
  const w = makeWorld();
  const { delegates } = sitting(w, 40);
  toTheBallot(w, delegates);
  const v = convention(w);
  const ballot = referendumsOfKind(w, 'convention')[0];
  assert.ok(ballot);
  assert.equal(v.ballotId, ballot.id);
  // One aye and nothing else: carried on the votes cast, and far short of the turnout.
  w.day = ballot.day;
  for (const c of Object.values(w.citizens)) c.brain = 'llm';
  assert.equal(voteReferendum(w, delegates[0].id, ballot.id, true).ok, true);
  holdReferendum(w);
  assert.equal(ballot.result, 'passed');
  w.day += 1;
  dailyConvention(w);
  assert.equal(convention(w).state, 'failed');
  assert.equal(charterOf(w).seats, 5, 'the old charter stands');
  assert.ok(convention(w).cooldownUntilDay > w.day, 'and none may be called for a cycle');
  assert.equal(signConvention(w, delegates[1].id).ok, false);
});

test('a turnout that shows up replaces the charter at the next dawn', () => {
  const w = makeWorld();
  const { people, delegates } = sitting(w, 20);
  toTheBallot(w, delegates);
  const ballot = referendumsOfKind(w, 'convention')[0];
  w.day = ballot.day;
  // Everybody comes to the poll: scripted minds read the draft themselves.
  holdReferendum(w);
  assert.equal(ballot.ayes + ballot.nays >= franchiseThreshold(w, 0.4), true,
    `turnout ${ballot.ayes + ballot.nays} of ${people.length}`);
  assert.equal(ballot.result, 'passed');
  w.day += 1;
  dailyConvention(w);
  assert.equal(convention(w).state, 'carried');
  assert.equal(charterOf(w).seats, 9);
});

test('a scripted citizen reads a draft by what it does to them', () => {
  const w = makeWorld();
  const { people, delegates } = sitting(w, 20);
  const res = moveArticle(w, delegates[0].id, { article: 'franchise', value: 'property' });
  assert.equal(res.ok, true, res.message);
  const a = convention(w).articles[0];
  for (const d of delegates) voteArticle(w, d.id, a.id, true);
  const v = convention(w);
  w.day = v.sittingUntil ?? w.day;
  conventionSitting(w);
  const ballot = referendumsOfKind(w, 'convention')[0];
  const landless = people.find((c) => (c.ownedUnits ?? []).length === 0 && c.homeTier === 0) as Citizen;
  assert.equal(ratifyDisposition(w, landless.id, ballot), false, 'a citizen it would disenfranchise votes nay');
  landless.ownedUnits = ['u_1'];
  assert.equal(ratifyDisposition(w, landless.id, ballot), true, 'and one it leaves counted votes aye');
});

test('what a citizen reads of the convention is the roll, the articles and the day', () => {
  const w = makeWorld();
  const { delegates } = sitting(w);
  moveArticle(w, delegates[0].id, { article: 'seats', value: 9, words: 'nine seats' });
  const seen = conventionObservation(w, delegates[0]);
  assert.ok(seen);
  assert.equal(seen.state, 'sitting');
  assert.equal(seen.youSit, true);
  assert.equal(seen.delegates.length, seen.seats);
  assert.equal(seen.articles[0].words, 'nine seats');
  assert.equal(seen.articles[0].youVoted, true, 'the mover\'s own aye');
});

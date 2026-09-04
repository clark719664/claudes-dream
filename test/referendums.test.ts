/**
 * Referendums (src/politics/referendums.ts).
 *
 * The threshold that turns a petition into a question, who may sign and vote,
 * and what a carried referendum does to the Council.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, Proposal, World } from '../src/types.ts';
import { PETITION_SHARE, REFERENDUM_WEEKDAY } from '../src/data/metropolis.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import { tableProposal } from '../src/government/council.ts';
import {
  dailyReferendums, holdReferendum, isVoter, liveSignatures, nextReferendumDay, openReferendum, pendingReferendum,
  petitionStanding, petitionsObservation, referendumFor, referendumObservation, referendumToday,
  signPetition, signaturesNeeded, voteReferendum,
} from '../src/politics/referendums.ts';

/** A city of `n` citizens who make up their own minds (so nothing votes for them). */
function citizens(world: World, n: number): Citizen[] {
  const out: Citizen[] = [];
  for (let i = 0; i < n; i++) out.push(makeCitizen(world, { name: `Voter${i}`, brain: 'llm' }));
  return out;
}

function petition(world: World, byId: string, value = 0.3): Proposal {
  const res = tableProposal(world, byId, { kind: 'income_tax', value, summary: `set income tax to ${value}` });
  assert.equal(res.ok, true, res.message);
  const p = world.government.proposals[world.government.proposals.length - 1];
  assert.equal(p.petition, true);
  return p;
}

function signAll(world: World, signers: Citizen[], p: Proposal): void {
  for (const c of signers) {
    const res = signPetition(world, c.id, p.id);
    assert.equal(res.ok, true, res.message);
  }
}

// ------------------------------------------------------------- the threshold

test('a fifth of the city\'s voters is what a petition needs, and never fewer than one', () => {
  const w = makeWorld();
  assert.equal(signaturesNeeded(w), 1, 'an empty city still needs a name');
  const people = citizens(w, 20);
  assert.equal(signaturesNeeded(w), Math.ceil(PETITION_SHARE * 20));
  makeCitizen(w, { lifeStage: 'child', brain: 'child' });
  makeCitizen(w, { standing: 'exiled' });
  assert.equal(signaturesNeeded(w), 4, 'children and exiles are not voters');
  assert.equal(isVoter(w, people[0]), true);
});

test('twenty per cent of the city opens a referendum and nineteen does not', () => {
  const w = makeWorld();
  const people = citizens(w, 20);
  const p = petition(w, people[0].id);
  const needed = signaturesNeeded(w);
  assert.equal(needed, 4);

  signAll(w, people.slice(0, needed - 1), p);
  dailyReferendums(w);
  assert.equal(pendingReferendum(w), null, 'three names in twenty is not a fifth');

  signAll(w, people.slice(needed - 1, needed), p);
  dailyReferendums(w);
  const r = pendingReferendum(w);
  assert.ok(r, 'the fourth name puts it to the city');
  assert.equal(r.petitionId, p.id);
  assert.equal(r.day, nextReferendumDay(w));
  assert.equal(r.day % 7, REFERENDUM_WEEKDAY, 'the city votes on Stillday');
  assert.ok(w.events.some((e) => e.kind === 'referendum' && e.text.includes('is put to a vote')));
});

test('one name each, and only from a citizen who may vote', () => {
  const w = makeWorld();
  const people = citizens(w, 20);
  const p = petition(w, people[0].id);
  assert.equal(signPetition(w, people[1].id, p.id).ok, true);
  assert.equal(signPetition(w, people[1].id, p.id).ok, false, 'twice is once');
  assert.equal(signPetition(w, 'c_nobody', p.id).ok, false);
  assert.equal(signPetition(w, people[2].id, 'p_nothing').ok, false);

  const child = makeCitizen(w, { lifeStage: 'child' });
  const suspended = makeCitizen(w, { standing: 'suspended' });
  const jailed = makeCitizen(w, { jailedUntilDay: w.day + 1 });
  assert.equal(signPetition(w, child.id, p.id).ok, false);
  assert.equal(signPetition(w, suspended.id, p.id).ok, false);
  assert.equal(signPetition(w, jailed.id, p.id).ok, false);
});

test('a councillor\'s proposal is not a petition, and a petition already before the city is closed', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  w.government.council = [people[0].id];
  const proposal = tableProposal(w, people[0].id, { kind: 'dividend', value: 20, summary: 'raise the dividend' });
  assert.equal(proposal.ok, true);
  const tabled = w.government.proposals[0];
  assert.equal(signPetition(w, people[1].id, tabled.id).ok, false, 'councillors table, citizens petition');

  const p = petition(w, people[1].id);
  signAll(w, people.slice(2, 4), p);
  dailyReferendums(w);
  assert.ok(referendumFor(w, p.id));
  assert.equal(signPetition(w, people[5].id, p.id).ok, false, 'it is already before the city');
});

test('the city answers one question at a time', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const first = petition(w, people[0].id, 0.3);
  const second = petition(w, people[1].id, 0.4);
  signAll(w, people.slice(2, 4), first);
  signAll(w, people.slice(4, 7), second);
  dailyReferendums(w);
  assert.equal(pendingReferendum(w)?.petitionId, second.id, 'the fullest petition goes first');
  dailyReferendums(w);
  assert.equal(referendumFor(w, first.id), null, 'the next waits its turn');
});

// ----------------------------------------------------------------- the vote

test('a vote counts on the day of the vote, once, from a citizen who may cast one', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const p = petition(w, people[0].id);
  const r = openReferendum(w, p);

  assert.equal(voteReferendum(w, people[1].id, r.id, true).ok, false, 'not before the day');
  assert.equal(voteReferendum(w, people[1].id, 'd_nothing', true).ok, false);

  w.day = r.day;
  assert.equal(voteReferendum(w, people[1].id, r.id, true).ok, true);
  assert.equal(voteReferendum(w, people[1].id, r.id, false).ok, false, 'one vote each');
  assert.equal(r.ayes, 1);
  assert.equal(r.nays, 0);
  assert.equal(people[1].stats.votesCast, 1);

  const suspended = makeCitizen(w, { standing: 'suspended', brain: 'llm' });
  const child = makeCitizen(w, { lifeStage: 'child', brain: 'child' });
  const jailed = makeCitizen(w, { jailedUntilDay: w.day + 1, brain: 'llm' });
  assert.equal(voteReferendum(w, suspended.id, r.id, true).ok, false);
  assert.equal(voteReferendum(w, child.id, r.id, true).ok, false);
  assert.equal(voteReferendum(w, jailed.id, r.id, true).ok, false);
  assert.equal(r.ayes, 1);

  assert.deepEqual(referendumObservation(w, people[1]), { id: r.id, question: r.question, day: r.day, youVoted: true });
  assert.equal(referendumObservation(w, people[2])?.youVoted, null);
});

test('a carried referendum binds the Council: the setting changes without a Council vote', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const p = petition(w, people[0].id, 0.3);
  const r = openReferendum(w, p);
  w.day = r.day;
  for (const c of people.slice(0, 6)) voteReferendum(w, c.id, r.id, true);
  for (const c of people.slice(6, 8)) voteReferendum(w, c.id, r.id, false);
  assert.equal(w.government.council.length, 0, 'there is no Council at all');

  holdReferendum(w);
  assert.equal(r.result, 'passed');
  assert.equal(w.government.incomeTax, 0.3, 'the city set the tax itself');
  assert.equal(p.status, 'passed');
  assert.equal(p.decidedDay, w.day);
  assert.ok(w.events.some((e) => e.kind === 'referendum' && e.text.includes('Carried')));
  assert.ok(w.events.some((e) => e.kind === 'law'), 'and it is enacted like any other decision');

  holdReferendum(w);
  assert.equal(r.ayes, 6, 'the poll does not reopen');
});

test('a tie fails, and the petition it stood on fails with it', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const p = petition(w, people[0].id, 0.4);
  const r = openReferendum(w, p);
  w.day = r.day;
  voteReferendum(w, people[1].id, r.id, true);
  voteReferendum(w, people[2].id, r.id, false);
  holdReferendum(w);
  assert.equal(r.result, 'failed');
  assert.equal(w.government.incomeTax, 0.15, 'nothing changed');
  assert.equal(p.status, 'failed');
  assert.ok(w.events.some((e) => e.kind === 'referendum' && e.text.includes('A tied vote fails')));
});

test('a poll nobody comes to fails, and says so', () => {
  const w = makeWorld();
  const people = citizens(w, 3);
  const p = petition(w, people[0].id, 0.3);
  const r = openReferendum(w, p);
  w.day = r.day;
  holdReferendum(w);
  assert.equal(r.result, 'failed');
  assert.equal(w.government.incomeTax, 0.15);
  assert.ok(w.events.some((e) => e.kind === 'referendum' && e.text.includes('Nobody came')));
});

test('scripted citizens who never came make their minds up; minds of their own abstain', () => {
  const w = makeWorld();
  const scripted = makeCitizen(w, { name: 'Reflex', brain: 'reflex' });
  const free = makeCitizen(w, { name: 'Free', brain: 'llm' });
  const p = petition(w, free.id, 0.3);
  const r = openReferendum(w, p);
  w.day = r.day;
  holdReferendum(w);
  assert.equal(r.ayes + r.nays, 1, 'one scripted vote, one abstention');
  assert.equal(scripted.stats.votesCast, 1);
  assert.equal(free.stats.votesCast, 0);
});

test('the city may overrule a Council that has already said no', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const p = petition(w, people[0].id, 0.35);
  p.status = 'failed';
  p.decidedDay = w.day;
  signAll(w, people.slice(1, 4), p);
  dailyReferendums(w);
  const r = pendingReferendum(w);
  assert.ok(r, 'a rejected petition may still be taken up by the city');
  w.day = r.day;
  for (const c of people.slice(0, 5)) voteReferendum(w, c.id, r.id, true);
  holdReferendum(w);
  assert.equal(w.government.incomeTax, 0.35);
  assert.ok(w.events.some((e) => e.kind === 'referendum' && e.text.includes('overruled the Council')));
});

test('answered questions are cleared away after a cycle, votes and all', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const p = petition(w, people[0].id);
  const r = openReferendum(w, p);
  w.day = r.day;
  voteReferendum(w, people[1].id, r.id, true);
  holdReferendum(w);
  assert.equal(w.counters[`ref:${r.id}:${people[1].id}`], 1);

  w.day = r.day + w.config.cycleDays;
  dailyReferendums(w);
  assert.equal(w.referendums?.length, 0);
  assert.equal(w.counters[`ref:${r.id}:${people[1].id}`], undefined);
});

test('a poll whose day went by unheld is counted at the next morning', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const p = petition(w, people[0].id, 0.3);
  const r = openReferendum(w, p);
  w.day = r.day;
  for (const c of people.slice(0, 4)) voteReferendum(w, c.id, r.id, true);

  w.day = r.day + 2;
  dailyReferendums(w);
  assert.equal(r.result, 'passed', 'the votes cast still count');
  assert.equal(w.government.incomeTax, 0.3);
  assert.equal(pendingReferendum(w), null, 'and the next question is free to be asked');
});

test('a world with no referendums, no proposals and no citizens is not an error', () => {
  const w = makeWorld();
  dailyReferendums(w);
  holdReferendum(w);
  assert.equal(pendingReferendum(w), null);
  assert.equal(referendumObservation(w, makeCitizen(w)), null);
  assert.equal(voteReferendum(w, 'c_nobody', 'd_1', true).ok, false);
});

test('the names of citizens the city has lost do not carry a petition', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  const p = petition(w, people[0].id);
  assert.equal(signaturesNeeded(w), 2);
  signAll(w, people.slice(0, 2), p);
  assert.equal(liveSignatures(w, p).length, 2);
  assert.equal(petitionStanding(w, p.id, people[0].id)?.crossed, true);

  people[0].standing = 'exiled';                                  // through the Gate
  w.order.splice(w.order.indexOf(people[1].id), 1);               // through the Threshold
  assert.equal(liveSignatures(w, p).length, 0, 'their names stay on the paper and out of the count');
  assert.deepEqual((p as typeof p & { signatures?: string[] }).signatures, [people[0].id, people[1].id],
    'the record of who signed is not rewritten');

  dailyReferendums(w);
  assert.equal(pendingReferendum(w), null, 'a petition nobody in the city is behind goes nowhere');

  signAll(w, people.slice(2, 4), p);
  dailyReferendums(w);
  assert.ok(pendingReferendum(w), 'and two citizens who are still here put it to the vote');
});

test('what a citizen sees of the petitions before the city', () => {
  const w = makeWorld();
  const people = citizens(w, 10);
  assert.deepEqual(petitionsObservation(w, people[0]), []);
  const small = petition(w, people[0].id, 0.2);
  const big = petition(w, people[1].id, 0.4);
  signAll(w, people.slice(0, 3), big);
  signPetition(w, people[4].id, small.id);

  const seen = petitionsObservation(w, people[0]);
  assert.equal(seen.length, 2);
  assert.equal(seen[0].id, big.id, 'the best-supported comes first');
  assert.equal(seen[0].signatures, 3);
  assert.equal(seen[0].needed, signaturesNeeded(w));
  assert.equal(seen[0].proposer, 'Voter1');
  assert.equal(seen[0].youSigned, true);
  assert.equal(seen[1].youSigned, false, 'a petition this citizen did not sign says so');
  assert.equal(petitionStanding(w, 'p_nothing'), null);

  dailyReferendums(w);
  const asked = petitionsObservation(w, people[0]).map((row) => row.id);
  assert.equal(asked.includes(big.id), false, 'a petition already before the city is no longer signed');
  assert.equal(asked.includes(small.id), true);
});

test('the poll the city goes to today is the one that closes today', () => {
  const w = makeWorld();
  const people = citizens(w, 5);
  const p = petition(w, people[0].id);
  signAll(w, people.slice(0, 1), p);
  dailyReferendums(w);
  const r = pendingReferendum(w);
  assert.ok(r);
  assert.equal(referendumToday(w), null, 'not today');
  w.day = r.day;
  assert.equal(referendumToday(w)?.id, r.id);
  holdReferendum(w);
  assert.notEqual(r.result, null);
  assert.equal(referendumToday(w), null, 'and an answered question is not put twice');
});

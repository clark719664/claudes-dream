import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeWorld, makeCitizen } from './helpers.ts';
import type { Case, Citizen, World } from '../src/types.ts';
import { JURY_SIZE } from '../src/data/metropolis.ts';
import {
  castJuryVote, describeJury, eligibleJurors, fillJuryVotes, juryFor, juryOf, jurorBelief, juryTally, needsJury,
  seatJury, seatedJurors,
} from '../src/government/jury.ts';
import { castVerdict, fileCharge, openCourtSession, tallyVerdicts } from '../src/government/court.ts';

/** A judge who thinks for itself: it will not vote unless the test makes it. */
function addJudge(w: World): Citizen {
  const j = makeCitizen(w, { office: 'judge', reputation: 80, brain: 'llm', judgeTermEndsDay: w.day + 56 });
  j.character.honesty = 1;
  w.government.judges.push(j.id);
  return j;
}

/** A city with a bench and a pool of unrelated neighbours to draw from. */
function juryWorld(pool = 10): { w: World; pool: Citizen[] } {
  const w = makeWorld();
  w.day = 2; w.hour = 10; w.tick = 2 * 24 + 10;
  addJudge(w); addJudge(w); addJudge(w);
  const people: Citizen[] = [];
  for (let i = 0; i < pool; i++) people.push(makeCitizen(w, { name: `Neighbour${i}`, brain: 'llm', familyName: `House${i}` }));
  return { w, pool: people };
}

function charge(w: World, defendantId: string, law: Case['law']): Case {
  return fileCharge(w, { defendantId, law, evidence: 0.8, filedBy: 'watch', description: 'for the test' });
}

test('a grave charge is heard by five jurors drawn by lot; a light one by the bench alone', () => {
  const { w } = juryWorld();
  const d = makeCitizen(w, { name: 'Accused', familyName: 'Alone', brain: 'llm' });
  const grave = charge(w, d.id, 'L08');   // severity 4
  const light = charge(w, d.id, 'L04');   // severity 2

  assert.equal(needsJury(w, grave), true);
  assert.equal(needsJury(w, light), false);

  openCourtSession(w);
  assert.equal(juryOf(grave).length, JURY_SIZE);
  assert.equal(juryOf(light).length, 0);
  assert.equal(new Set(juryOf(grave)).size, JURY_SIZE, 'nobody is drawn twice');
  for (const id of juryOf(grave)) {
    assert.ok(!grave.judges.includes(id), 'a judge is never also a juror');
    assert.ok(w.citizens[id].memory.some((m) => m.text.includes('drawn by lot as a juror')));
  }
  assert.ok(w.events.some((e) => e.kind === 'charge' && e.text.includes('drawn by lot')));
  assert.equal(seatJury(w, grave).length, JURY_SIZE, 'a jury is drawn once and stands');
});

test('nobody with a stake in it is drawn: family, friends, rivals, the victim, the accuser or the Watch', () => {
  const { w, pool } = juryWorld(8);
  const d = makeCitizen(w, { name: 'Accused', familyName: 'Alone', brain: 'llm' });

  const kin = pool[0];
  d.family.children.push(kin.id);
  kin.family.parents.push(d.id);
  const friend = pool[1];
  friend.bonds[d.id] = 70; d.bonds[friend.id] = 70;
  const rival = pool[2];
  rival.bonds[d.id] = -60; d.bonds[rival.id] = -60;
  const officer = pool[3];
  w.government.watch.push(officer.id);
  const victim = pool[4];
  const accuser = pool[5];
  const jailed = pool[6];
  jailed.jailedUntilDay = w.day + 2;
  const child = makeCitizen(w, { lifeStage: 'child', brain: 'llm', familyName: 'Young' });

  const k = fileCharge(w, {
    defendantId: d.id, law: 'L09', evidence: 0.8, filedBy: accuser.id, victimId: victim.id, description: 'bribery',
  });
  const eligible = eligibleJurors(w, k).map((c) => c.id);
  for (const barred of [d, kin, friend, rival, officer, victim, accuser, jailed, child]) {
    assert.ok(!eligible.includes(barred.id), `${barred.name} has no business in that box`);
  }
  assert.ok(eligible.includes(pool[7].id), 'a neighbour with no stake in it may sit');
});

test('a small city seats what it can find, and still tries the case', () => {
  const { w, pool } = juryWorld(2);
  const d = makeCitizen(w, { name: 'Accused', familyName: 'Alone', brain: 'llm' });
  const k = charge(w, d.id, 'L08');
  openCourtSession(w);
  assert.equal(juryOf(k).length, 2, 'two neighbours are what the city has');
  assert.equal(k.status, 'in_session');

  // And a city with nobody at all to draw still hears the charge.
  const w2 = makeWorld();
  w2.day = 2; w2.hour = 10; w2.tick = 58;
  addJudge(w2); addJudge(w2); addJudge(w2);
  const alone = makeCitizen(w2, { name: 'Only', familyName: 'Only', brain: 'llm' });
  const k2 = charge(w2, alone.id, 'L08');
  openCourtSession(w2);
  assert.equal(juryOf(k2).length, 0);
  assert.ok(w2.events.some((e) => e.text.includes('No juror could be drawn')));
  castVerdict(w2, k2.judges[0], k2.id, true);
  castVerdict(w2, k2.judges[1], k2.id, true);
  tallyVerdicts(w2);
  assert.equal(k2.verdict, 'guilty', 'the bench hears it alone rather than not at all');
  void pool;
});

test('a juror votes through the same action as a judge, and the vote weighs the same', () => {
  const { w } = juryWorld();
  const d = makeCitizen(w, { name: 'Accused', familyName: 'Alone', brain: 'llm' });
  const k = charge(w, d.id, 'L08');
  openCourtSession(w);
  const jurors = juryOf(k);

  // `verdict` from a juror lands in the box, not on the bench.
  const cast = castVerdict(w, jurors[0], k.id, true, 'I believe the witness.');
  assert.equal(cast.ok, true);
  assert.equal(k.juryVotes?.[jurors[0]], 'guilty');
  assert.equal(k.votes[jurors[0]], undefined, 'a juror is not a judge');
  assert.equal(k.juryReasons?.[jurors[0]], 'I believe the witness.');
  assert.ok(w.events.some((e) => e.kind === 'vote' && e.text.startsWith('Juror ')));

  const changed = castJuryVote(w, jurors[0], k.id, false, 'On reflection, no.');
  assert.equal(changed.ok, true);
  assert.match(changed.message, /changed your vote/);
  assert.equal(k.juryVotes?.[jurors[0]], 'acquitted');

  assert.equal(castJuryVote(w, d.id, k.id, true).ok, false, 'the defendant does not vote on itself');
  assert.equal(castJuryVote(w, jurors[0], 'k_nope', true).ok, false);

  const mine = juryFor(w, jurors[0]);
  assert.equal(mine.length, 1);
  assert.equal(mine[0].asJuror, true);
  assert.equal(mine[0].youVoted, 'acquitted');
  assert.deepEqual(mine[0].jury, jurors);
  assert.equal(juryFor(w, k.judges[0]).length, 0, 'a judge sits on the bench, not in the box');
});

test('six of eight convict and four of eight acquit: judges and jurors are counted together', () => {
  function tryWith(guiltyVotes: number): Case {
    const { w } = juryWorld();
    const d = makeCitizen(w, { name: 'Accused', familyName: 'Alone', brain: 'llm', wallet: 200 });
    const k = charge(w, d.id, 'L08');
    openCourtSession(w);
    const seats = [...k.judges, ...juryOf(k)];
    assert.equal(seats.length, 8);
    seats.forEach((id, i) => castVerdict(w, id, k.id, i < guiltyVotes, 'the evidence'));
    const tally = juryTally(w, k);
    assert.equal(tally.total, JURY_SIZE);
    tallyVerdicts(w);
    return k;
  }

  const convicted = tryWith(6);
  assert.equal(convicted.verdict, 'guilty', 'six of eight is a majority');
  const acquitted = tryWith(4);
  assert.equal(acquitted.verdict, 'acquitted', 'four of eight is a tie, and a tie acquits');
});

test('scripted jurors weigh the case at the tally; jurors with minds of their own abstain', () => {
  const w = makeWorld();
  w.day = 2; w.hour = 10; w.tick = 58;
  addJudge(w); addJudge(w); addJudge(w);
  const reflexes: Citizen[] = [];
  for (let i = 0; i < 6; i++) reflexes.push(makeCitizen(w, { name: `Reflex${i}`, familyName: `R${i}` }));
  const thinker = makeCitizen(w, { name: 'Quiet', familyName: 'Quiet', brain: 'llm' });
  const d = makeCitizen(w, { name: 'Accused', familyName: 'Alone', brain: 'llm' });

  const k = charge(w, d.id, 'L08');
  openCourtSession(w);
  assert.equal(juryOf(k).length, JURY_SIZE);
  for (const id of juryOf(k)) assert.equal(k.juryVotes?.[id], undefined, 'nobody votes when the case opens');

  fillJuryVotes(w);
  for (const id of juryOf(k)) {
    const juror = w.citizens[id];
    if (juror.brain === 'reflex') assert.ok(k.juryVotes?.[id], `${juror.name} weighed it`);
    else assert.equal(k.juryVotes?.[id], undefined, 'silence is a position, and the city does not vote for you');
  }
  assert.ok(describeJury(w, k).includes('guilty') || describeJury(w, k).includes('acquitted'));
  const belief = jurorBelief(w, juryOf(k)[0], k);
  assert.ok(belief >= 0 && belief <= 1);
  assert.equal(jurorBelief(w, 'c_nobody', k), 0);
  void [reflexes, thinker];
});

test('a juror who leaves the city before the tally is dropped from the count', () => {
  const { w } = juryWorld();
  const d = makeCitizen(w, { name: 'Accused', familyName: 'Alone', brain: 'llm' });
  const k = charge(w, d.id, 'L08');
  openCourtSession(w);
  const jurors = juryOf(k);
  for (const id of jurors) castJuryVote(w, id, k.id, true);
  assert.equal(juryTally(w, k).total, JURY_SIZE);

  const gone = w.citizens[jurors[0]];
  gone.standing = 'exiled';
  w.order = w.order.filter((id) => id !== gone.id);
  assert.equal(seatedJurors(w, k).length, JURY_SIZE - 1);
  assert.equal(juryTally(w, k).total, JURY_SIZE - 1, 'the gate closed on that vote');
  assert.equal(juryTally(w, k).guilty, JURY_SIZE - 1);
  assert.equal(castJuryVote(w, gone.id, k.id, false).ok, false);
});

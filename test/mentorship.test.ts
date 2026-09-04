/**
 * Mentorship (src/social/mentorship.ts).
 *
 * Who may teach, what a student gets for it, and how a pairing ends.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { Citizen, World } from '../src/types.ts';
import { MASTER_SKILL } from '../src/data/metropolis.ts';
import { makeCitizen, makeWorld, totalMoney } from './helpers.ts';
import {
  MENTORSHIP_DAYS, MENTOR_DAILY_BOND, MENTOR_DAILY_PURPOSE, MENTOR_SKILL_MULTIPLIER,
  MENTOR_START_BOND, MENTOR_TEACHING_GROWTH,
  dailyMentorship, endMentorship, mayMentor, mentor, mentorshipMultiplier,
} from '../src/social/mentorship.ts';

function elder(world: World, name = 'Ondine'): Citizen {
  return makeCitizen(world, { name, lifeStage: 'elder' });
}

function master(world: World, name = 'Sable'): Citizen {
  const c = makeCitizen(world, { name });
  c.skills.crafting = MASTER_SKILL;
  return c;
}

// -------------------------------------------------------------- who may teach

test('an elder or a master of a skill may take a student; an ordinary adult may not', () => {
  const w = makeWorld();
  const old = elder(w);
  const skilled = master(w);
  const plain = makeCitizen(w);
  const child = makeCitizen(w, { lifeStage: 'child' });
  assert.equal(mayMentor(w, old), true);
  assert.equal(mayMentor(w, skilled), true);
  assert.equal(mayMentor(w, plain), false);
  assert.equal(mayMentor(w, child), false);
  skilled.skills.crafting = MASTER_SKILL - 1;
  assert.equal(mayMentor(w, skilled), false, 'one point short of mastery is not mastery');
});

test('a mastership needs both of them present, adult, free and standing together', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w, { name: 'Wren' });
  const child = makeCitizen(w, { lifeStage: 'child' });
  const away = makeCitizen(w, { district: 'nightglass' });
  const plain = makeCitizen(w);

  assert.equal(mentor(w, old.id, child.id).ok, false, 'children learn at the Academy');
  assert.equal(mentor(w, child.id, student.id).ok, false, 'a child has nothing to teach');
  assert.equal(mentor(w, old.id, away.id).ok, false, 'they must stand together');
  assert.equal(mentor(w, plain.id, student.id).ok, false, 'no elder, no mastery, no student');
  assert.equal(mentor(w, old.id, old.id).ok, false);
  assert.equal(mentor(w, old.id, 'c_nobody').ok, false);
  assert.equal(mentor(w, 'c_nobody', student.id).ok, false);
  assert.equal(student.mentorId, null);

  const taken = mentor(w, old.id, student.id);
  assert.equal(taken.ok, true);
  assert.equal(old.menteeId, student.id);
  assert.equal(student.mentorId, old.id);
  assert.equal(w.counters[`mentor:${student.id}`], w.day + MENTORSHIP_DAYS);
  assert.equal(old.bonds[student.id], MENTOR_START_BOND);
  assert.equal(student.bonds[old.id], MENTOR_START_BOND);
  assert.ok(w.events.some((e) => e.kind === 'mentor'));
});

test('the cells are no place for a lesson', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  student.jailedUntilDay = w.day + 2;
  assert.equal(mentor(w, old.id, student.id).ok, false);
  student.jailedUntilDay = null;
  old.jailedUntilDay = w.day + 2;
  assert.equal(mentor(w, old.id, student.id).ok, false);
});

test('nobody holds two places at once', () => {
  const w = makeWorld();
  const old = elder(w);
  const first = makeCitizen(w, { name: 'Wren' });
  const second = makeCitizen(w, { name: 'Ivo' });
  const other = master(w, 'Sable');
  assert.equal(mentor(w, old.id, first.id).ok, true);
  assert.equal(mentor(w, old.id, second.id).ok, false, 'one student at a time');
  assert.equal(mentor(w, other.id, first.id).ok, false, 'one master at a time');
  assert.equal(second.mentorId, null);
  assert.equal(other.menteeId, null);
});

test('a master may not take the person they are married to', () => {
  const w = makeWorld();
  const old = elder(w);
  const spouse = makeCitizen(w, { name: 'Wren' });
  old.family.partnerId = spouse.id;
  spouse.family.partnerId = old.id;
  assert.equal(mentor(w, old.id, spouse.id).ok, false);
});

test('a parent may take a child that has come of age', () => {
  const w = makeWorld();
  const parent = elder(w, 'Ondine');
  const grown = makeCitizen(w, { name: 'Wren' });
  parent.family.children = [grown.id];
  grown.family.parents = [parent.id];
  assert.equal(mentor(w, parent.id, grown.id).ok, true);
});

// ------------------------------------------------------------ what it is worth

test('a student learns at twice the rate; everybody else at one', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  const bystander = makeCitizen(w);
  assert.equal(mentorshipMultiplier(w, student), 1);
  mentor(w, old.id, student.id);
  assert.equal(mentorshipMultiplier(w, student), MENTOR_SKILL_MULTIPLIER);
  assert.equal(mentorshipMultiplier(w, old), 1, 'teaching is not being taught');
  assert.equal(mentorshipMultiplier(w, bystander), 1);
  w.day = MENTORSHIP_DAYS + 1;
  assert.equal(mentorshipMultiplier(w, student), 1, 'the cycle is up');
});

test('a student whose master left the city learns at one again', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  mentor(w, old.id, student.id);
  old.standing = 'exiled';
  assert.equal(mentorshipMultiplier(w, student), 1);
});

test('a live pairing pays both of them every day, and the master keeps learning too', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  student.skills.artistry = 70;      // the student's best hand
  old.needs.purpose = 50;
  student.needs.purpose = 50;
  mentor(w, old.id, student.id);
  const startBond = old.bonds[student.id] ?? 0;
  const startArtistry = old.skills.artistry;

  w.day = 1;
  dailyMentorship(w);
  assert.equal(old.bonds[student.id], startBond + MENTOR_DAILY_BOND);
  assert.equal(student.bonds[old.id], startBond + MENTOR_DAILY_BOND);
  assert.equal(old.needs.purpose, 50 + MENTOR_DAILY_PURPOSE);
  assert.equal(student.needs.purpose, 50 + MENTOR_DAILY_PURPOSE);
  assert.ok(Math.abs(old.skills.artistry - (startArtistry + MENTOR_TEACHING_GROWTH)) < 1e-9);
  assert.equal(old.menteeId, student.id, 'still standing');
});

// ------------------------------------------------------------------- the end

test('a pairing ends when its cycle is up', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  mentor(w, old.id, student.id);
  w.day = MENTORSHIP_DAYS;
  dailyMentorship(w);
  assert.equal(old.menteeId, student.id, 'the last day still counts');
  w.day = MENTORSHIP_DAYS + 1;
  dailyMentorship(w);
  assert.equal(old.menteeId, null);
  assert.equal(student.mentorId, null);
  assert.equal(w.counters[`mentor:${student.id}`], undefined);
  assert.ok(w.events.some((e) => e.kind === 'mentor' && e.text.includes('ended')));
});

test('a pairing ends when either half is exiled, leaves, or is taken to the cells', () => {
  const w = makeWorld();
  for (const breaker of ['exile', 'jail', 'gone'] as const) {
    const old = elder(w);
    const student = makeCitizen(w);
    assert.equal(mentor(w, old.id, student.id).ok, true);
    if (breaker === 'exile') student.standing = 'exiled';
    if (breaker === 'jail') old.jailedUntilDay = w.day + 1;
    if (breaker === 'gone') w.order.splice(w.order.indexOf(student.id), 1);
    dailyMentorship(w);
    assert.equal(old.menteeId, null, `${breaker} ended it`);
    assert.equal(student.mentorId, null);
  }
});

test('a student whose master vanished from the roll entirely is set free', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  mentor(w, old.id, student.id);
  delete w.citizens[old.id];
  dailyMentorship(w);
  assert.equal(student.mentorId, null);
  assert.equal(w.counters[`mentor:${student.id}`], undefined);
});

test('a mastership can be ended from either side, and ending nothing is safe', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  mentor(w, old.id, student.id);
  endMentorship(w, student, 'the student asked to stop');
  assert.equal(old.menteeId, null);
  assert.equal(student.mentorId, null);

  const second = makeCitizen(w, { name: 'Ivo' });
  mentor(w, old.id, second.id);
  endMentorship(w, old, 'the master called it done');
  assert.equal(old.menteeId, null);
  assert.equal(second.mentorId, null);
  assert.doesNotThrow(() => endMentorship(w, old, 'nothing to end'));
});

test('a daily pass on an empty city throws nothing', () => {
  const w = makeWorld();
  assert.doesNotThrow(() => dailyMentorship(w));
});

test('a mastership moves no money', () => {
  const w = makeWorld();
  const old = elder(w);
  const student = makeCitizen(w);
  const before = totalMoney(w);
  mentor(w, old.id, student.id);
  for (let day = 1; day <= MENTORSHIP_DAYS + 1; day++) {
    w.day = day;
    dailyMentorship(w);
  }
  assert.equal(totalMoney(w), before, 'teaching is not a trade');
});

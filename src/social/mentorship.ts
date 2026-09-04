/**
 * Mentorship — an elder or a master takes on a student.
 *
 * Any elder, or anyone who has taken a skill to MASTER_SKILL, may `mentor`
 * another adult standing in the same district. For one cycle the student's
 * skills grow twice as fast, at a shift and at a lesson alike
 * (`mentorshipMultiplier` is read by `economy/jobs.ts growSkill` and by
 * `actions/daily.ts doStudy`), the two of them gain a little bond and purpose
 * every day, and the mentor's own hand in the student's best skill keeps
 * moving — teaching is practice.
 *
 * A pairing is one-to-one on both sides and ends of itself: when the cycle is
 * up, when either of them leaves the city, is exiled, or is taken to the
 * cells. Neither side is ever told to seek one out; the engine only keeps the
 * bargain once it is struck.
 */
import { SKILLS, clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, Skill, World } from '../types.ts';
import { MASTER_SKILL } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent, talentOf } from '../citizens/citizen.ts';
import { adjustBond } from '../citizens/relationships.ts';

/** A mentorship runs one cycle. */
export const MENTORSHIP_DAYS = 28;
/** What a student's skill growth is multiplied by while they have a mentor. */
export const MENTOR_SKILL_MULTIPLIER = 2;
/** Bond the pairing gives at the start, both ways. */
export const MENTOR_START_BOND = 10;
/** Bond and purpose a live pairing gives both of them each day. */
export const MENTOR_DAILY_BOND = 1;
export const MENTOR_DAILY_PURPOSE = 2;
/** How much the mentor's own hand improves for the teaching of it, each day. */
export const MENTOR_TEACHING_GROWTH = 0.2;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The counter holding the day a pairing runs out. */
function endKey(menteeId: CitizenId): string { return `mentor:${menteeId}`; }

function isJailed(c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined;
}

/** Anybody who could take a student: an elder, or a master of any one skill. */
export function mayMentor(world: World, c: Citizen): boolean {
  if (!isPresent(world, c) || c.lifeStage === 'child') return false;
  if (c.lifeStage === 'elder') return true;
  return SKILLS.some((s) => c.skills[s] >= MASTER_SKILL);
}

/** Already a mentor or already a student: nobody holds two places at once. */
export function isPaired(c: Citizen): boolean {
  return !!c.mentorId || !!c.menteeId;
}

/** The day a student's pairing runs out (0 when they have none). */
export function mentorshipEndsDay(world: World, c: Citizen): number {
  return world.counters[endKey(c.id)] ?? 0;
}

/** A student and their master may not be married to one another. */
function familyForbidden(c: Citizen, other: Citizen): boolean {
  return c.family.partnerId === other.id || other.family.partnerId === c.id;
}

// ---------------------------------------------------------------------------
// Striking the bargain
// ---------------------------------------------------------------------------

/** Take on a student. Both must be adults, present, free, and standing together. */
export function mentor(world: World, cId: CitizenId, menteeId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const student = world.citizens[menteeId];
  if (!student || !isPresent(world, student)) return fail('Nobody by that id lives in Reverie.');
  if (cId === menteeId) return fail('You cannot be your own master.');
  if (c.lifeStage === 'child') return fail('A child has nothing to teach yet.');
  if (student.lifeStage === 'child') return fail('Children learn at the Academy, not from a master.');
  if (!mayMentor(world, c)) return fail(`Only an elder, or a master of a skill (${MASTER_SKILL}), may take a student.`);
  if (isJailed(c) || isJailed(student)) return fail('Nothing is taught through the bars of the Watch House.');
  if (c.district !== student.district) return fail(`${student.name} is not here; a master and a student must stand together.`);
  if (isPaired(c)) {
    return fail(c.menteeId ? 'You already have a student.' : 'You are a student yourself; finish before you teach.');
  }
  if (isPaired(student)) {
    return fail(student.mentorId ? `${student.name} already has a master.` : `${student.name} is teaching somebody else.`);
  }
  if (familyForbidden(c, student)) return fail(`You and ${student.name} are married; that is not a mastership.`);

  c.menteeId = menteeId;
  student.mentorId = cId;
  world.counters[endKey(menteeId)] = world.day + MENTORSHIP_DAYS;
  adjustBond(world, cId, menteeId, MENTOR_START_BOND);
  const skill = talentOf(student);
  emit(world, 'mentor', `${c.name} took ${student.name} as a student for the cycle.`, [cId, menteeId], 0.4,
    { mentor: cId, mentee: menteeId, untilDay: world.day + MENTORSHIP_DAYS, skill });
  remember(world, cId, 'social', `You took ${student.name} as your student until day ${world.day + MENTORSHIP_DAYS}.`);
  remember(world, menteeId, 'social', `${c.name} took you as a student until day ${world.day + MENTORSHIP_DAYS}; you learn twice as fast now.`);
  return { ok: true, message: `${student.name} is your student until day ${world.day + MENTORSHIP_DAYS}.` };
}

/** 2 while a citizen is somebody's student, 1 otherwise. Read by every skill gain. */
export function mentorshipMultiplier(world: World, c: Citizen): number {
  if (!c || !c.mentorId) return 1;
  const master = world.citizens[c.mentorId];
  if (!master || !isPresent(world, master)) return 1;
  if (mentorshipEndsDay(world, c) < world.day) return 1;
  return MENTOR_SKILL_MULTIPLIER;
}

/** End the pairing this citizen is in, from whichever side they stand on. */
export function endMentorship(world: World, c: Citizen, reason: string): void {
  if (!c || !isPaired(c)) return;
  const masterId = c.mentorId ?? c.id;
  const studentId = c.mentorId ? c.id : c.menteeId;
  if (!studentId) return;
  const master = world.citizens[masterId];
  const student = world.citizens[studentId];
  if (master) master.menteeId = null;
  if (student) student.mentorId = null;
  delete world.counters[endKey(studentId)];
  const names = `${master?.name ?? masterId} and ${student?.name ?? studentId}`;
  emit(world, 'mentor', `The mastership between ${names} ended: ${reason}.`, [masterId, studentId], 0.3,
    { mentor: masterId, mentee: studentId, reason });
  if (master) remember(world, masterId, 'social', `Your mastership of ${student?.name ?? studentId} ended: ${reason}.`);
  if (student) remember(world, studentId, 'social', `Your time as ${master?.name ?? masterId}'s student ended: ${reason}.`);
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

function addPurpose(c: Citizen, delta: number): void {
  c.needs.purpose = clamp(c.needs.purpose + delta, 0, 100);
}

/** Why a pairing cannot go on, or null while it can. */
function brokenBy(world: World, master: Citizen, student: Citizen): string | null {
  if (!isPresent(world, master)) return `${master.name} has left the city`;
  if (!isPresent(world, student)) return `${student.name} has left the city`;
  if (isJailed(master)) return `${master.name} is in the cells`;
  if (isJailed(student)) return `${student.name} is in the cells`;
  if (mentorshipEndsDay(world, student) < world.day) return 'the cycle is up';
  return null;
}

/**
 * Every morning: pairings that have run their cycle or lost half of themselves
 * are ended, and the ones still standing pay both sides — bond, purpose, and,
 * for the master, a little more of the skill they are teaching.
 */
export function dailyMentorship(world: World): void {
  for (const master of Object.values(world.citizens)) {
    if (!master.menteeId) continue;
    const student = world.citizens[master.menteeId];
    if (!student || student.mentorId !== master.id) {
      // A half-pairing left by a corrupt save or an older layer: let it go quietly.
      master.menteeId = null;
      continue;
    }
    const broken = brokenBy(world, master, student);
    if (broken) {
      endMentorship(world, student, broken);
      continue;
    }
    adjustBond(world, master.id, student.id, MENTOR_DAILY_BOND);
    addPurpose(master, MENTOR_DAILY_PURPOSE);
    addPurpose(student, MENTOR_DAILY_PURPOSE);
    const skill: Skill = talentOf(student);
    master.skills[skill] = clamp(master.skills[skill] + MENTOR_TEACHING_GROWTH, 0, 100);
  }
  // A student whose master vanished from the roll entirely is set free.
  for (const student of Object.values(world.citizens)) {
    if (!student.mentorId) continue;
    const master = world.citizens[student.mentorId];
    if (!master || master.menteeId !== student.id) {
      student.mentorId = null;
      delete world.counters[endKey(student.id)];
    }
  }
}

/**
 * Schools of thought — the three answers Reverie gives to the question of what
 * a city is for.
 *
 * The **Makers** hold that a city is what it built; the **Commons** that
 * nobody eats until everybody eats; the **Lanterns** that a life is not a
 * shift. Nobody is born into one and the engine never sorts anyone by what
 * they are like inside: a citizen adopts a school with its own `adopt_school`,
 * in its own hour, or holds none at all for a whole life.
 *
 * What spreads a school is other people. A citizen most of whose friends hold
 * one school may drift into it — and only as far as their own **public
 * record** already leans that way (`affinity` reads shifts, clubs, works,
 * donations-as-character and tastes, never a hidden trait). Holding a school
 * costs something: friends across the line rub each other up (`frictionBetween`),
 * and it colours a vote at the margin (`schoolPlatformBias`) without ever
 * casting it.
 */
import { clamp } from '../types.ts';
import type { ActionResult, ActionType, Citizen, CitizenId, Platform, SchoolOfThought, World } from '../types.ts';
import { SCHOOLS } from '../types.ts';
import { SCHOOL_INFO } from '../data/metropolis.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { currentCycleStartDay, isPresent } from '../citizens/citizen.ts';
import { adjustBond, friendsOf } from '../citizens/relationships.ts';

/** How readily a citizen surrounded by one school drifts into it, at full affinity. */
export const CONVERSION_CHANCE = 0.08;
/** Somebody who already holds a school is a third as easy to move. */
export const SWITCH_FRACTION = 1 / 3;
/** Bond lost by a friend of another school when a citizen adopts one. */
export const ADOPTION_FRICTION = 2;
/** Bond an hour together costs two citizens who do not see the city the same way. */
export const SOCIAL_FRICTION = -2;
/** The most a school can move a vote, either way. */
export const MAX_BIAS = 0.15;
/** A school that holds this share of the city's adults is news. */
export const MAJORITY_SHARE = 0.5;

type School = Exclude<SchoolOfThought, null>;

/** Trades that make things: the Makers' own. */
const CRAFT_ROLES: readonly string[] = ['forge_operator', 'power_technician', 'fabricator', 'builder', 'cook', 'shopkeeper'];
/** Hours a citizen spends on nothing anybody pays for. */
const LEISURE_ACTIONS: readonly ActionType[] = [
  'attend_show', 'perform', 'play', 'dine', 'celebrate', 'attend_club', 'socialize', 'use_item',
];

function fail(message: string): ActionResult { return { ok: false, message }; }

export function schoolOf(c: Citizen): SchoolOfThought {
  const s = c?.school ?? null;
  return s && SCHOOLS.includes(s) ? s : null;
}

/** The name of a school, for a sentence. */
export function schoolName(school: School): string {
  return SCHOOL_INFO[school]?.name ?? school;
}

/** What a school says of itself, for the Plaza and the prompt. A fact about the school. */
export function creedLine(world: World, school: School): string {
  const info = SCHOOL_INFO[school];
  if (!info) return '';
  return `${info.name.replace(/^the /, 'The ')} say: ${info.creed}`;
}

// ---------------------------------------------------------------------------
// Affinity — read off the public record, never off a hidden trait
// ---------------------------------------------------------------------------

function round2(v: number): number {
  return Math.round(clamp(Number.isFinite(v) ? v : 0, 0, 1) * 100) / 100;
}

function daysHere(world: World, c: Citizen): number {
  return Math.max(1, world.day - (c.arrivedDay ?? 0) + 1);
}

function bestSkillIsCrafting(c: Citizen): boolean {
  const s = c.skills;
  if (!s) return false;
  const craft = s.crafting ?? 0;
  return craft >= (s.analysis ?? 0) && craft >= (s.rhetoric ?? 0) && craft >= (s.care ?? 0)
    && craft >= (s.commerce ?? 0) && craft >= (s.artistry ?? 0);
}

/** How much of this citizen's taste the school already shares. */
function hobbyShare(c: Citizen, school: School): number {
  const mine = c.tastes?.hobbies ?? [];
  if (mine.length === 0) return 0;
  const theirs = SCHOOL_INFO[school]?.hobbies ?? [];
  let hits = 0;
  for (const h of mine) if (theirs.includes(h)) hits++;
  return hits / mine.length;
}

/** The share of a citizen's recent hours spent on something nobody pays for. */
function leisureShare(c: Citizen): number {
  const recent = c.recentActions ?? [];
  if (recent.length === 0) return 0;
  let hits = 0;
  for (const a of recent) if (LEISURE_ACTIONS.includes(a)) hits++;
  return hits / recent.length;
}

/**
 * How near a school already is to the life this citizen has actually lived,
 * 0..1. Every term is a public fact — shifts worked, the trade they hold,
 * clubs joined, works made, what the city has seen of their generosity, and
 * the hobbies they told the Arrivals Hall about. Nothing here reads
 * `personality`, and nothing here tells a citizen what to want.
 */
export function affinity(world: World, c: Citizen, school: School): number {
  if (!c || !SCHOOLS.includes(school)) return 0;
  const days = daysHere(world, c);
  const character = c.character ?? { honesty: 0.5, diligence: 0.5, sociability: 0.5, generosity: 0.5, civic: 0.5 };
  const hobbies = hobbyShare(c, school);

  if (school === 'makers') {
    const shifts = clamp((c.stats?.shiftsWorked ?? 0) / (days * 4), 0, 1);
    const job = c.jobId ? world.jobs[c.jobId] : null;
    const trade = (job && CRAFT_ROLES.includes(job.role)) || bestSkillIsCrafting(c) ? 1 : 0;
    return round2((shifts + trade + hobbies + clamp(character.diligence, 0, 1)) / 4);
  }
  if (school === 'commons') {
    const clubs = clamp((c.clubs?.length ?? 0) / 3, 0, 1);
    const earnedPerDay = Math.max(0, (c.stats?.totalEarned ?? 0) / days);
    const dividend = Math.max(0, world.government?.dividend ?? 0);
    const dividendShare = dividend + earnedPerDay > 0 ? dividend / (dividend + earnedPerDay) : 0;
    return round2((clamp(character.generosity, 0, 1) + clamp(character.civic, 0, 1) + clubs + dividendShare + hobbies) / 5);
  }
  const works = clamp((c.works?.length ?? 0) / 3, 0, 1);
  const shows = clamp((c.stats?.showsPerformed ?? 0) / 5, 0, 1);
  return round2((works + shows + hobbies + leisureShare(c)) / 4);
}

// ---------------------------------------------------------------------------
// Adopting
// ---------------------------------------------------------------------------

function adoptedKey(cId: CitizenId): string { return `school:adopted:${cId}`; }

/** Has this citizen already changed their mind this cycle? */
export function adoptedThisCycle(world: World, cId: CitizenId): boolean {
  const day = world.counters[adoptedKey(cId)];
  return day !== undefined && day >= currentCycleStartDay(world);
}

/** Every friend who holds a school other than this one. */
function friendsAcrossTheLine(world: World, c: Citizen, school: School): Citizen[] {
  const out: Citizen[] = [];
  for (const id of friendsOf(world, c.id)) {
    const f = world.citizens[id];
    if (!f) continue;
    const theirs = schoolOf(f);
    if (theirs && theirs !== school) out.push(f);
  }
  return out;
}

function setSchool(world: World, c: Citizen, school: School, how: string, weight: number): void {
  const before = schoolOf(c);
  c.school = school;
  world.counters[adoptedKey(c.id)] = world.day;
  const parted = friendsAcrossTheLine(world, c, school);
  for (const f of parted) adjustBond(world, c.id, f.id, -ADOPTION_FRICTION);
  const info = SCHOOL_INFO[school];
  emit(world, 'school', `${c.name} ${before ? `left ${schoolName(before)} for` : 'took up with'} ${info.name}${how ? `, ${how}` : ''}.`,
    [c.id], weight, { school, from: before });
  remember(world, c.id, 'social',
    `You hold with ${info.name} now: ${info.creed}${parted.length > 0 ? ` ${parted.length === 1 ? 'A friend' : `${parted.length} friends`} of another school took it badly.` : ''}`);
}

/**
 * A citizen's own choice, once a cycle. Nothing recommends a school and
 * nothing forbids one; the only rule is that a mind that changes it every
 * hour is not holding a belief.
 */
export function adoptSchool(world: World, cId: CitizenId, school: School): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to take up a school of thought.');
  if (!SCHOOLS.includes(school)) return fail('There is no such school of thought in Reverie.');
  if (schoolOf(c) === school) return fail(`You already hold with ${schoolName(school)}.`);
  if (adoptedThisCycle(world, cId)) return fail('You have already changed your mind this cycle.');

  setSchool(world, c, school, 'of their own accord', 0.2);
  return { ok: true, message: `You hold with ${schoolName(school)}: ${SCHOOL_INFO[school].creed}` };
}

// ---------------------------------------------------------------------------
// Spreading
// ---------------------------------------------------------------------------

/** The school most of a citizen's friends hold, when one of them holds a majority. */
export function friendsSchool(world: World, c: Citizen): School | null {
  const friends = friendsOf(world, c.id);
  if (friends.length === 0) return null;
  const counts: Record<string, number> = {};
  for (const id of friends) {
    const f = world.citizens[id];
    const s = f ? schoolOf(f) : null;
    if (s) counts[s] = (counts[s] ?? 0) + 1;
  }
  for (const s of SCHOOLS) {
    if ((counts[s] ?? 0) > friends.length / 2) return s;
  }
  return null;
}

/**
 * A day of talking. A citizen whose friends nearly all hold one school may
 * come round to it — but only as far as their own life already leans that way,
 * and somebody who already holds one is three times harder to move.
 */
export function convert(world: World): void {
  for (const id of [...world.order]) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c) || c.lifeStage === 'child') continue;
    if (adoptedThisCycle(world, id)) continue;
    const school = friendsSchool(world, c);
    if (!school) continue;
    const current = schoolOf(c);
    if (current === school) continue;
    const p = CONVERSION_CHANCE * affinity(world, c, school) * (current ? SWITCH_FRACTION : 1);
    if (p <= 0 || !chance(world, p)) continue;
    setSchool(world, c, school, 'as their friends do', 0.2);
  }
}

// ---------------------------------------------------------------------------
// What a school is worth at the ballot box, and across a table
// ---------------------------------------------------------------------------

/**
 * What a voter's school makes of a candidate's platform: at most a sixth of a
 * point either way, added to `elections.platformFit`. It moves a vote at the
 * margin; it never casts one.
 */
export function schoolPlatformBias(world: World, voter: Citizen, platform: Platform): number {
  const school = voter ? schoolOf(voter) : null;
  if (!school || !platform) return 0;
  const dividend = clamp(Number.isFinite(platform.dividend) ? platform.dividend : 0.5, 0, 1);
  const minWage = clamp(Number.isFinite(platform.minWage) ? platform.minWage : 0.5, 0, 1);
  const strictness = clamp(Number.isFinite(platform.strictness) ? platform.strictness : 0.5, 0, 1);
  let lean = 0;
  if (school === 'makers') lean = (1 - dividend) + minWage - 1;
  else if (school === 'commons') lean = dividend + (1 - minWage) - 1;
  else lean = 1 - 2 * strictness;
  return Math.round(clamp(lean, -1, 1) * MAX_BIAS * 100) / 100;
}

/** What an hour together costs two citizens who do not see the city the same way. */
export function frictionBetween(a: Citizen, b: Citizen): number {
  if (!a || !b) return 0;
  const x = schoolOf(a);
  const y = schoolOf(b);
  return x && y && x !== y ? SOCIAL_FRICTION : 0;
}

// ---------------------------------------------------------------------------
// The city's mind, counted
// ---------------------------------------------------------------------------

/** What share of the city's adults holds each school, and none. Sums to 1. */
export function shares(world: World): Record<string, number> {
  const counts: Record<string, number> = { makers: 0, commons: 0, lanterns: 0, none: 0 };
  let total = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c) || c.lifeStage === 'child') continue;
    total++;
    counts[schoolOf(c) ?? 'none'] += 1;
  }
  const keys = ['makers', 'commons', 'lanterns', 'none'];
  if (total === 0) return { makers: 0, commons: 0, lanterns: 0, none: 1 };
  // Round in hundredths and give the rounding residue to the largest group, so
  // the four shares add to exactly one however the counts fall.
  const cents: Record<string, number> = {};
  let sum = 0;
  let biggest = 'none';
  for (const k of keys) {
    cents[k] = Math.round((counts[k] / total) * 100);
    sum += cents[k];
    if (counts[k] > counts[biggest]) biggest = k;
  }
  cents[biggest] += 100 - sum;
  const out: Record<string, number> = {};
  for (const k of keys) out[k] = Math.max(0, cents[k]) / 100;
  return out;
}

function noticeKey(school: School): string { return `school:majority:${school}`; }

/** Morning: the schools talk, and the city hears when one of them has the room. */
export function dailySchools(world: World): void {
  convert(world);
  const share = shares(world);
  for (const s of SCHOOLS) {
    if ((share[s] ?? 0) <= MAJORITY_SHARE) {
      if (world.counters[noticeKey(s)] !== undefined) delete world.counters[noticeKey(s)];
      continue;
    }
    if (world.counters[noticeKey(s)] !== undefined) continue;
    world.counters[noticeKey(s)] = world.day;
    emit(world, 'school',
      `${SCHOOL_INFO[s].name.replace(/^the /, 'The ')} now hold ${Math.round(share[s] * 100)} in every hundred grown citizens of Reverie.`,
      [], 0.5, { school: s, share: share[s] });
  }
}

/**
 * Personality drift.
 *
 * The traits a citizen was rolled with are its own and nobody else's
 * (`docs/PRINCIPLES.md` §2). They are not fixed for life, though: a life in the
 * city pulls on them a little every day. A conviction pulls honesty down,
 * an office pulls ambition up, friends pull sociability up, lessons pull
 * curiosity up, and a day's shifts pull diligence up.
 *
 * Two rules keep this honest:
 *
 * - **Bounded.** A trait never travels further than `TRAIT_DRIFT_CAP` (0.15)
 *   from the value it was born with, and never leaves 0..1. A life bends a
 *   mind; it does not replace it.
 * - **Invisible.** Drift moves hidden traits, so it is emitted nowhere,
 *   remembered nowhere, printed nowhere and observed nowhere. This module
 *   calls neither `emit` nor `remember`, and it must stay that way, or
 *   `test/principles.test.ts` has found a leak.
 *
 * Every pull is read off a **public** fact — the record, the roll of office,
 * the bonds, yesterday's shifts — so nothing here is a hidden trait feeding
 * back into itself.
 */
import { TRAITS, clamp } from '../types.ts';
import type { Citizen, Personality, Trait, World } from '../types.ts';
import { TRAIT_DRIFT_CAP } from '../data/metropolis.ts';
import { FRIEND_THRESHOLD } from '../citizens/relationships.ts';

/** How far a trait moves toward the day's pull. Thirty days to reach the cap. */
export const DRIFT_STEP = 0.005;

/** A memory of a lesson, for the curiosity pull. */
const LESSON = /took a lesson in/i;

function round4(v: number): number {
  return Math.round(v * 10_000) / 10_000;
}

function holdsOffice(world: World, c: Citizen): boolean {
  const g = world.government;
  if (c.office !== null) return true;
  if (!g) return false;
  return g.mayorId === c.id || g.council.includes(c.id) || g.judges.includes(c.id) || g.watch.includes(c.id);
}

/** True when this citizen kept any company at all: a friend, a bond, a word. */
function hasCompany(c: Citizen): { friends: boolean; anyone: boolean } {
  let friends = false;
  let anyone = Object.keys(c.contactsToday ?? {}).length > 0;
  for (const v of Object.values(c.bonds ?? {})) {
    anyone = true;
    if (v >= FRIEND_THRESHOLD) { friends = true; break; }
  }
  return { friends, anyone };
}

/** A lesson taken during the day that has just ended. */
function studiedYesterday(world: World, c: Citizen): boolean {
  const since = world.tick - 24;
  return (c.memory ?? []).some((m) => m.kind === 'work' && m.tick >= since && LESSON.test(m.text));
}

/**
 * The day's pull on each trait: the value experience is tugging it toward.
 * A trait with no entry is left where it is. Read at the morning rollover,
 * before the day's counters are cleared, so "yesterday" is what it says.
 */
export function driftFor(world: World, c: Citizen): Partial<Personality> {
  const pull: Partial<Personality> = {};
  const yesterday = world.day - 1;
  if ((c.record?.convictions ?? []).some((k) => k.day >= yesterday)) pull.honesty = 0;
  if (holdsOffice(world, c)) pull.ambition = 1;
  const company = hasCompany(c);
  if (company.friends) pull.sociability = 1;
  else if (!company.anyone) pull.sociability = 0;
  if (studiedYesterday(world, c)) pull.curiosity = 1;
  if ((c.shiftsToday ?? 0) > 0) pull.diligence = 1;
  return pull;
}

/** The traits a citizen was born with, filled in for a save that predates drift. */
export function ensureBirthTraits(c: Citizen): Personality {
  const born = c.birthTraits ?? {} as Personality;
  let missing = !c.birthTraits;
  for (const t of TRAITS) {
    if (typeof born[t] !== 'number' || !Number.isFinite(born[t])) {
      born[t] = clamp(c.personality?.[t] ?? 0.5, 0, 1);
      missing = true;
    }
  }
  if (missing) c.birthTraits = born;
  return born;
}

/**
 * Move each pulled trait one step toward where the day is pulling it, never
 * past `TRAIT_DRIFT_CAP` either side of the value it was born with, and never
 * outside 0..1.
 */
export function applyDrift(world: World, c: Citizen, pull: Partial<Personality>): void {
  if (!c.personality) return;
  const born = ensureBirthTraits(c);
  for (const t of TRAITS) {
    const target = pull[t];
    if (typeof target !== 'number' || !Number.isFinite(target)) continue;
    const current = clamp(c.personality[t] ?? born[t], 0, 1);
    const step = Math.sign(target - current) * Math.min(DRIFT_STEP, Math.abs(target - current));
    const lo = Math.max(0, born[t] - TRAIT_DRIFT_CAP);
    const hi = Math.min(1, born[t] + TRAIT_DRIFT_CAP);
    c.personality[t] = round4(clamp(current + step, lo, hi));
  }
  void world;
}

/**
 * The morning's drift, for everyone living in the city. Runs early in the
 * rollover — before the day's shift counts and contacts are cleared — so the
 * facts it reads are yesterday's.
 */
export function dailyDrift(world: World): void {
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled') continue;
    ensureBirthTraits(c);
    applyDrift(world, c, driftFor(world, c));
  }
}

/** How far a life has moved a mind from where it started. For tests only. */
export function driftOf(c: Citizen): Partial<Personality> {
  const out: Partial<Personality> = {};
  const born = c.birthTraits;
  if (!born || !c.personality) return out;
  for (const t of TRAITS) {
    const from = born[t];
    const to = c.personality[t];
    if (typeof from === 'number' && typeof to === 'number') out[t as Trait] = round4(to - from);
  }
  return out;
}

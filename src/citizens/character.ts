/**
 * Character: what the city can see of a citizen, inferred from what that
 * citizen has done.
 *
 * Nobody in Reverie is given a personality to live up to. The hidden traits a
 * citizen is rolled with belong to its own mind; everyone else — judges,
 * voters, councillors, neighbours — reads the public record instead: shifts
 * worked, charges that stuck, gifts given, ballots cast, the company kept.
 * `inferCharacter` is that reading, `dailyCharacter` refreshes it once a day,
 * and `characterOf` hands out the reading the city currently holds.
 *
 * Only public facts go in. An offence nobody detected is not part of anyone's
 * reputation — that is what the Watch is for — so honesty counts detected
 * offences and convictions, never the secret ones.
 */
import { CHARACTER_TRAITS, clamp, neutralCharacter } from '../types.ts';
import type { Character, Citizen, CitizenId, World } from '../types.ts';

/** A day's honest work, for the diligence scale (shifts per resident day). */
export const DILIGENT_SHIFTS_PER_DAY = 8;
/** Acquaintances at which sociability reads 1. */
export const SOCIABLE_ACQUAINTANCES = 10;
/** Gifts at which generosity reads 0.5 (it approaches 1 and never arrives). */
export const GENEROUS_GIFTS = 10;
/** Civic acts at which civic reads 0.5. */
export const CIVIC_ACTS = 4;
/** A conviction costs this much honesty, on top of the offences behind it. */
export const CONVICTION_HONESTY_COST = 0.15;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A tally from the record: never negative, never a number that is not one. */
function count(v: number): number {
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : 0;
}

/** Days this citizen has lived here, at least one (their first day counts). */
export function daysResident(world: World, c: Citizen): number {
  return Math.max(1, world.day - c.arrivedDay + 1);
}

/**
 * Everyone this citizen has dealt with lately: bonds are made by dealing with
 * people and decay to nothing when they are not, and affection likewise, so
 * the size of those maps is a fair reading of a week's company.
 */
export function acquaintanceCount(c: Citizen): number {
  const seen = new Set<string>();
  for (const id of Object.keys(c.bonds)) seen.add(id);
  for (const id of Object.keys(c.affection ?? {})) seen.add(id);
  for (const id of Object.keys(c.contactsToday ?? {})) seen.add(id);
  seen.delete(c.id);
  return seen.size;
}

/** Proposals and petitions this citizen has put before the Council. */
export function proposalsTabled(world: World, c: Citizen): number {
  return world.government.proposals.filter((p) => p.proposerId === c.id).length;
}

/**
 * The public reading of a citizen:
 *
 * - `honesty` 1 − detected offences / (shifts + detected + 1) − 0.15 × convictions
 * - `diligence` shifts worked per resident day, over eight
 * - `sociability` distinct citizens dealt with lately, over ten
 * - `generosity` gifts given / (gifts given + 10)
 * - `civic` (ballots + proposals + clubs) / (that + 4)
 *
 * Each is clamped to 0..1 and rounded to two places, so the reading is stable
 * in a saved world and identical for a given seed.
 */
export function inferCharacter(world: World, c: Citizen): Character {
  const s = c.stats;
  const caught = count(s.offencesDetected);
  const shifts = count(s.shiftsWorked);
  const convictions = c.record.convictions.length;
  const gifts = count(s.giftsGiven);
  const civicActs = count(s.votesCast) + proposalsTabled(world, c) + c.clubs.length;
  return {
    honesty: round2(clamp(1 - caught / (shifts + caught + 1) - CONVICTION_HONESTY_COST * convictions, 0, 1)),
    diligence: round2(clamp(shifts / daysResident(world, c) / DILIGENT_SHIFTS_PER_DAY, 0, 1)),
    sociability: round2(clamp(acquaintanceCount(c) / SOCIABLE_ACQUAINTANCES, 0, 1)),
    generosity: round2(gifts / (gifts + GENEROUS_GIFTS)),
    civic: round2(civicActs / (civicActs + CIVIC_ACTS)),
  };
}

/**
 * The reading the city holds of this citizen right now. Citizens carry it on
 * the record so every observer sees the same profile between refreshes; a
 * citizen the city has not read yet (a world saved before characters, a raw
 * test fixture) reads neutral rather than blank.
 */
export function characterOf(c: Citizen | undefined | null): Character {
  const ch = c?.character;
  if (!ch) return neutralCharacter();
  const out = neutralCharacter();
  for (const t of CHARACTER_TRAITS) {
    const v = ch[t];
    if (typeof v === 'number' && Number.isFinite(v)) out[t] = clamp(v, 0, 1);
  }
  return out;
}

/** 1 − the mean distance between two readings, 0..1 (1 = two of a kind). */
export function characterAffinity(a: Character, b: Character): number {
  let diff = 0;
  for (const t of CHARACTER_TRAITS) diff += Math.abs(a[t] - b[t]);
  return clamp(1 - diff / CHARACTER_TRAITS.length, 0, 1);
}

/** How alike two citizens look to each other, from their public readings alone. */
export function characterCompatibility(world: World, a: CitizenId, b: CitizenId): number {
  const ca = world.citizens[a];
  const cb = world.citizens[b];
  if (!ca || !cb) return 0;
  if (a === b) return 1;
  return characterAffinity(characterOf(ca), characterOf(cb));
}

/**
 * The daily reading. Exiles keep the character they left with: their record
 * is closed, and the registry keeps it as it was.
 */
export function dailyCharacter(world: World): void {
  for (const c of Object.values(world.citizens)) {
    if (c.standing === 'exiled') continue;
    c.character = inferCharacter(world, c);
  }
}

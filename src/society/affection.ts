/**
 * Affection: the second thing citizens feel for each other, next to the bond.
 * It is kept per pair, only between adults, and it comes from one thing only —
 * hours actually spent together. Every action that puts two citizens in the
 * same room for an hour (socialise, dine, play, date, a club meeting, a show,
 * a party) calls recordContact; dailyAffection turns yesterday's tallies into
 * feeling each morning and lets the rest fade.
 *
 * society/romance.ts re-exports all of this: this file is its arithmetic half.
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, World } from '../types.ts';
import { residentIds } from '../economy/treasury.ts';
import { bondBetween, socialCompatibility } from '../citizens/relationships.ts';

/** Affection a day of contact is worth: a base, a compatibility term and a share of the bond. */
export const AFFECTION_BASE = 2;
export const AFFECTION_COMPATIBILITY = 4;
export const AFFECTION_BOND_DIVISOR = 50;
/** No pair gains more than this in a day, however many hours they spend together. */
export const AFFECTION_DAILY_CAP = 12;
/** Affection lost in a day with no contact at all. */
export const AFFECTION_DECAY = 1;
/** A partnered citizen only looks elsewhere once their own bond has fallen below this. */
export const COLLAPSED_BOND = 20;

/** Adults and elders only: children have no part in any of this. */
export function isAdult(c: Citizen): boolean {
  return c.lifeStage !== 'child';
}

/** What `a` feels for `b`, 0..100 (0 when there is nothing there). */
export function affectionBetween(world: World, a: CitizenId, b: CitizenId): number {
  if (a === b) return 0;
  return world.citizens[a]?.affection[b] ?? 0;
}

/** Affection is 0..100 and sparse: a feeling that has faded to nothing is forgotten. */
export function addAffection(c: Citizen, other: CitizenId, delta: number): void {
  if (c.id === other || !Number.isFinite(delta) || delta === 0) return;
  const v = clamp(Math.round(((c.affection[other] ?? 0) + delta) * 100) / 100, 0, 100);
  if (v <= 0) delete c.affection[other];
  else c.affection[other] = v;
}

/**
 * An hour spent together, counted for both: socialising, dining, playing,
 * dating, a club meeting, a show or a party. dailyAffection reads and clears
 * the tally every morning.
 */
export function recordContact(world: World, a: CitizenId, b: CitizenId): void {
  if (a === b) return;
  const ca = world.citizens[a];
  const cb = world.citizens[b];
  if (!ca || !cb) return;
  ca.contactsToday[b] = (ca.contactsToday[b] ?? 0) + 1;
  cb.contactsToday[a] = (cb.contactsToday[a] ?? 0) + 1;
}

/**
 * Whether `c` can grow fond of `other`: anyone who is single may; a partnered
 * citizen only feels the pull of someone else once the bond with their own
 * partner has collapsed below COLLAPSED_BOND.
 */
export function openToAffection(world: World, c: Citizen, other: CitizenId): boolean {
  const partnerId = c.family.partnerId;
  if (partnerId === null || partnerId === other) return true;
  return bondBetween(world, c.id, partnerId) < COLLAPSED_BOND;
}

/**
 * Morning: affection grows for every adult pair who spent time together
 * yesterday — compatibility and warmth decide how fast, up to
 * AFFECTION_DAILY_CAP — and fades by AFFECTION_DECAY where nobody called.
 * The day's contact tallies are cleared, for everyone, at the end.
 */
export function dailyAffection(world: World): void {
  const residents = residentIds(world);
  for (const id of residents) {
    const c = world.citizens[id];
    if (!c) continue;
    if (isAdult(c)) {
      for (const [otherId, hours] of Object.entries(c.contactsToday)) {
        if (hours <= 0 || !residents.has(otherId)) continue;
        const other = world.citizens[otherId];
        if (!other || !isAdult(other) || !openToAffection(world, c, otherId)) continue;
        const per = AFFECTION_BASE
          + AFFECTION_COMPATIBILITY * socialCompatibility(world, id, otherId)
          + bondBetween(world, id, otherId) / AFFECTION_BOND_DIVISOR;
        addAffection(c, otherId, Math.min(AFFECTION_DAILY_CAP, Math.max(0, per * hours)));
      }
    }
    for (const otherId of Object.keys(c.affection)) {
      if ((c.contactsToday[otherId] ?? 0) > 0) continue;
      addAffection(c, otherId, -AFFECTION_DECAY);
    }
  }
  for (const c of Object.values(world.citizens)) c.contactsToday = {};
}

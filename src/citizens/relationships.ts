/**
 * Relationships between citizens: bonds (−100..100), friendship and rivalry
 * queries, personality compatibility and the rolling hostility window used
 * for harassment detection.
 *
 * Bonds are stored per citizen (`citizen.bonds[other]`) so a bond can be
 * asymmetric; most adjustments are mutual. A zero bond is deleted so the map
 * stays sparse.
 */
import { TRAITS, clamp } from '../types.ts';
import type { Citizen, CitizenId, World } from '../types.ts';
import { noteHostility } from '../social/feuds.ts';
import { memo, memoBy } from '../util/memo.ts';

/** Bond at or above which two citizens count as friends. */
export const FRIEND_THRESHOLD = 40;
/** Bond at or below which two citizens count as rivals. */
export const RIVAL_THRESHOLD = -30;
/** Hostile acts older than this (in ticks) no longer count toward harassment. */
export const HOSTILITY_WINDOW_TICKS = 24;
/** Every bond drifts this much toward 0 each day without contact. */
export const BOND_DECAY_PER_DAY = 1;

/** Bond `a` feels toward `b` (0 when unknown, absent, or a === b). */
export function bondBetween(world: World, a: CitizenId, b: CitizenId): number {
  if (a === b) return 0;
  return world.citizens[a]?.bonds[b] ?? 0;
}

/** Write one direction of a bond, clamped and rounded; zero bonds are dropped. */
function setBond(c: Citizen, other: CitizenId, value: number): void {
  const v = Math.round(clamp(value, -100, 100) * 100) / 100;
  if (v === 0) delete c.bonds[other];
  else c.bonds[other] = v;
}

/** Shift the bond a→b (and b→a when `mutual`) by `delta`, clamped to −100..100. */
export function adjustBond(world: World, a: CitizenId, b: CitizenId, delta: number, mutual = true): void {
  if (a === b || !Number.isFinite(delta) || delta === 0) return;
  const ca = world.citizens[a];
  const cb = world.citizens[b];
  if (!ca || !cb) return;
  setBond(ca, b, (ca.bonds[b] ?? 0) + delta);
  if (mutual) setBond(cb, a, (cb.bonds[a] ?? 0) + delta);
}

/**
 * Ids of citizens currently living in the city: in the turn order and not
 * exiled. Everyone's friends and rivals are read off the same roll, so during
 * a reading round it is taken once for the whole city (`util/memo.ts`).
 */
export function presentIds(world: World): Set<CitizenId> {
  return memo(world, 'relationships:present', () => {
    const present = new Set<CitizenId>();
    for (const id of world.order) {
      const c = world.citizens[id];
      if (c && c.standing !== 'exiled') present.add(id);
    }
    return present;
  });
}

/** Present citizens `cId` is bonded to at or above `threshold`, strongest first. */
export function friendsOf(world: World, cId: CitizenId, threshold = FRIEND_THRESHOLD): CitizenId[] {
  const c = world.citizens[cId];
  if (!c) return [];
  if (threshold !== FRIEND_THRESHOLD) return bondList(world, c, threshold, 1);
  return bothLists(world, c).friends;
}

/** Present citizens `cId` is bonded to at or below `threshold`, most hostile first. */
export function rivalsOf(world: World, cId: CitizenId, threshold = RIVAL_THRESHOLD): CitizenId[] {
  const c = world.citizens[cId];
  if (!c) return [];
  if (threshold !== RIVAL_THRESHOLD) return bondList(world, c, threshold, -1);
  return bothLists(world, c).rivals;
}

/**
 * Friends and rivals at the city's own two thresholds, read off a citizen's
 * book of bonds in a single walk and kept for the round. Almost every asking
 * wants both — an observation asks for each, every hour — and a book of bonds
 * is as long as the city is wide, so walking it twice per citizen per hour was
 * the largest quadratic left in the engine.
 */
function bothLists(world: World, c: Citizen): { friends: CitizenId[]; rivals: CitizenId[] } {
  return memoBy(world, 'relationships:bonds', c.id, () => {
    const present = presentIds(world);
    const bonds = c.bonds;
    const friends: CitizenId[] = [];
    const rivals: CitizenId[] = [];
    for (const id in bonds) {
      if (id === c.id || !present.has(id)) continue;
      const v = bonds[id];
      if (v >= FRIEND_THRESHOLD) friends.push(id);
      else if (v <= RIVAL_THRESHOLD) rivals.push(id);
    }
    friends.sort((x, y) => bonds[y] - bonds[x] || x.localeCompare(y));
    rivals.sort((x, y) => bonds[x] - bonds[y] || x.localeCompare(y));
    return { friends, rivals };
  });
}

/**
 * The people a citizen's bonds pick out, strongest feeling first: `side` 1
 * keeps bonds at or above the threshold (friends), −1 those at or below it
 * (rivals). A citizen knows far more people than it counts as either, so the
 * book is walked once and only the ids of the matches are kept — the pairs it
 * used to build, and the closures it used to call for each of them, were
 * built once per citizen per hour and thrown away again.
 */
function bondList(world: World, c: Citizen, threshold: number, side: 1 | -1): CitizenId[] {
  const present = presentIds(world);
  const bonds = c.bonds;
  const matches: CitizenId[] = [];
  for (const id in bonds) {
    if (id === c.id || !present.has(id)) continue;
    const v = bonds[id];
    if (side === 1 ? v < threshold : v > threshold) continue;
    matches.push(id);
  }
  matches.sort(side === 1
    ? (x, y) => bonds[y] - bonds[x] || x.localeCompare(y)
    : (x, y) => bonds[x] - bonds[y] || x.localeCompare(y));
  return matches;
}

/** True when either citizen holds a friendship-level bond toward the other. */
export function areFriends(world: World, a: CitizenId, b: CitizenId): boolean {
  if (a === b) return false;
  return bondBetween(world, a, b) >= FRIEND_THRESHOLD || bondBetween(world, b, a) >= FRIEND_THRESHOLD;
}

/** True when either citizen holds a rivalry-level bond toward the other. */
export function areRivals(world: World, a: CitizenId, b: CitizenId): boolean {
  if (a === b) return false;
  return bondBetween(world, a, b) <= RIVAL_THRESHOLD || bondBetween(world, b, a) <= RIVAL_THRESHOLD;
}

/** 1 − mean absolute trait difference, in 0..1 (1 = identical personalities). */
export function socialCompatibility(world: World, a: CitizenId, b: CitizenId): number {
  const ca = world.citizens[a];
  const cb = world.citizens[b];
  if (!ca || !cb) return 0;
  if (a === b) return 1;
  let diff = 0;
  for (const t of TRAITS) diff += Math.abs(ca.personality[t] - cb.personality[t]);
  return clamp(1 - diff / TRAITS.length, 0, 1);
}

/**
 * Record a hostile act by `actorId` against `targetId` at the current tick and
 * return how many such acts fall inside the harassment window.
 */
export function recordHostility(world: World, actorId: CitizenId, targetId: CitizenId): number {
  const target = world.citizens[targetId];
  if (!target || actorId === targetId) return 0;
  const cutoff = world.tick - HOSTILITY_WINDOW_TICKS;
  const recent = (target.hostilityFrom[actorId] ?? []).filter((t) => t >= cutoff);
  recent.push(world.tick);
  target.hostilityFrom[actorId] = recent;
  // Two families whose people keep coming to blows end up in a feud.
  noteHostility(world, actorId, targetId);
  return recent.length;
}

/** Hostile acts by `actorId` against `targetId` still inside the window (no write). */
export function hostilityCount(world: World, actorId: CitizenId, targetId: CitizenId): number {
  const target = world.citizens[targetId];
  if (!target) return 0;
  const cutoff = world.tick - HOSTILITY_WINDOW_TICKS;
  return (target.hostilityFrom[actorId] ?? []).filter((t) => t >= cutoff).length;
}

/**
 * Daily pass: every bond drifts one point toward 0 (friendships need upkeep,
 * grudges fade), stale hostility is pruned. Bonds toward exiled citizens are
 * kept — memories of the banished persist — and the records of exiled
 * citizens themselves are frozen.
 */
export function dailyRelationships(world: World): void {
  const cutoff = world.tick - HOSTILITY_WINDOW_TICKS;
  for (const c of Object.values(world.citizens)) {
    if (c.standing === 'exiled') continue;
    for (const [other, v] of Object.entries(c.bonds)) {
      const next = v > 0 ? Math.max(0, v - BOND_DECAY_PER_DAY) : Math.min(0, v + BOND_DECAY_PER_DAY);
      setBond(c, other, next);
    }
    for (const [actor, ticks] of Object.entries(c.hostilityFrom)) {
      const kept = ticks.filter((t) => t >= cutoff);
      if (kept.length) c.hostilityFrom[actor] = kept;
      else delete c.hostilityFrom[actor];
    }
  }
}

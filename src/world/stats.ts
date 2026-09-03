/**
 * Daily statistics: one DailyStats row per city day, pushed by the world's
 * morning rollover and shown as series on the dashboard. State figures
 * (population, wallets, treasury...) are a snapshot of the moment; activity
 * figures (offences, charges, convictions, exiles) count what happened on
 * the summarised day.
 */
import type { Citizen, DailyStats, World } from '../types.ts';
import { moneySupply } from '../economy/treasury.ts';
import { activeBusinesses } from '../economy/business.ts';
import { activeCitizens } from '../citizens/citizen.ts';
import { FRIEND_THRESHOLD } from '../citizens/relationships.ts';
import { heldJob } from '../actions/execute.ts';

function round(v: number, places: number): number {
  const f = 10 ** places;
  return Math.round(v * f) / f;
}

function mean(values: number[]): number {
  if (values.length === 0) return 0;
  let sum = 0;
  for (const v of values) sum += v;
  return sum / values.length;
}

/** Gini coefficient of a distribution, 0 (equal) to 1 (one holder has everything). */
export function gini(values: number[]): number {
  const xs = values.filter((v) => Number.isFinite(v) && v >= 0).sort((a, b) => a - b);
  const n = xs.length;
  if (n === 0) return 0;
  let total = 0;
  let weighted = 0;
  xs.forEach((x, i) => { total += x; weighted += (i + 1) * x; });
  if (total <= 0) return 0;
  return round((2 * weighted) / (n * total) - (n + 1) / n, 3);
}

/** Unordered pairs of present citizens bonded at friendship level in at least one direction. */
export function countFriendships(world: World, active: Citizen[]): number {
  const present = new Set(active.map((c) => c.id));
  const pairs = new Set<string>();
  for (const c of active) {
    for (const [other, bond] of Object.entries(c.bonds)) {
      if (other === c.id || bond < FRIEND_THRESHOLD || !present.has(other)) continue;
      pairs.add(c.id < other ? `${c.id}|${other}` : `${other}|${c.id}`);
    }
  }
  return pairs.size;
}

/** Present couples, counted once each: partnered pairs and married pairs. */
export function countCouples(active: Citizen[]): { partnerships: number; marriages: number } {
  const present = new Map(active.map((c) => [c.id, c]));
  const seen = new Set<string>();
  let partnerships = 0;
  let marriages = 0;
  for (const c of active) {
    const p = c.family?.partnerId;
    if (!p || !present.has(p)) continue;
    const key = c.id < p ? `${c.id}|${p}` : `${p}|${c.id}`;
    if (seen.has(key)) continue;
    seen.add(key);
    if (c.family.married) marriages++;
    else partnerships++;
  }
  return { partnerships, marriages };
}

/** Has a job, or runs a business: a livelihood either way. */
function hasLivelihood(world: World, c: Citizen): boolean {
  if (heldJob(world, c)) return true;
  const b = c.businessId ? world.businesses[c.businessId] : null;
  return !!b && b.dissolvedDay === null && b.ownerId === c.id;
}

function dayOfTick(tick: number): number {
  return Math.floor(tick / 24);
}

/**
 * The day a stats row summarises: at the morning rollover (hour 0) the day
 * that just ended, otherwise today so far.
 */
export function summarisedDay(world: World): number {
  return Math.max(0, world.hour === 0 ? world.day - 1 : world.day);
}

/** Every DailyStats field, for `day` (defaults to the most recently completed day). */
export function computeStats(world: World, day: number = summarisedDay(world)): DailyStats {
  const active = activeCitizens(world);
  const wallets = active.map((c) => c.wallet);
  const employed = active.filter((c) => hasLivelihood(world, c)).length;

  let offences = 0;
  for (const c of Object.values(world.citizens)) {
    for (const o of c.recentOffences) if (dayOfTick(o.tick) === day) offences++;
  }
  let charges = 0;
  let convictions = 0;
  for (const k of Object.values(world.cases)) {
    if (dayOfTick(k.filedTick) === day) charges++;
    if (k.verdict === 'guilty' && k.triedDay === day) convictions++;
  }
  const exiles = world.bans.filter((b) => b.day === day).length;
  const { partnerships, marriages } = countCouples(active);
  let possessions = 0;
  for (const c of active) possessions += c.possessions?.length ?? 0;

  return {
    day,
    population: active.length,
    employed,
    unemployed: active.length - employed,
    homeless: active.filter((c) => c.homeTier === 0).length,
    avgMood: round(mean(active.map((c) => c.mood)), 1),
    avgWallet: round(mean(wallets), 1),
    giniWealth: gini(wallets),
    priceIndex: world.market.priceIndex,
    treasury: world.treasury.balance,
    moneySupply: moneySupply(world),
    offences,
    charges,
    convictions,
    exiles,
    businesses: activeBusinesses(world).length,
    friendships: countFriendships(world, active),
    partnerships,
    marriages,
    children: active.filter((c) => c.lifeStage === 'child').length,
    clubs: Object.values(world.clubs ?? {}).filter((k) => k.members.length > 0).length,
    chest: world.treasury.chest ?? 0,
    possessions,
  };
}

/**
 * Approval — what each citizen makes of the people running the city.
 *
 * Nobody is told whether the Mayor is any good. A citizen's approval is read
 * off their **own situation**, from public facts only: whether they have work,
 * whether their purse has grown or shrunk over three days, whether the city
 * kept them safe, what the Bazaar charges, whether the promises the office
 * holders made have been kept, and how far the way the city is actually run
 * sits from the school of thought they hold and the paper they read.
 *
 * That is the whole of it. There is no ideology term, no "citizens like a low
 * tax", no hidden trait: two citizens in the same position read the city the
 * same way, and they differ because their positions differ. The number is
 * public — anybody may see it, it is printed in the aggregate, and it moves
 * votes at the next election through `approvalBonus` — but nothing in the
 * engine ever tells a citizen to act on it.
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, Platform, World } from '../types.ts';
import { isPresent } from '../citizens/citizen.ts';
import { SCHOOL_INFO, PAPER_INFO } from '../data/metropolis.ts';
import { PLATFORM_FIELDS, keptShare, positionOf } from './promises.ts';
import { memo } from '../util/memo.ts';

/** Days between the readings of a citizen's purse that make a trend. */
export const WALLET_TREND_DAYS = 3;
/** How recently a citizen must have been wronged for it to weigh on their reading. */
export const VICTIM_MEMORY_DAYS = 7;
/** The price index above which the Bazaar itself is an argument against the Council. */
export const DEAR_PRICE_INDEX = 1.3;
/** A citizen with no reading yet holds no opinion either way. */
export const NEUTRAL = 0.5;

const HOURS_PER_DAY = 24;

function walletKey(cId: CitizenId): string { return `wallet3:${cId}`; }
function walletDayKey(cId: CitizenId): string { return `wallet3Day:${cId}`; }

/** The way the city is actually run, read as a platform (`politics/promises.ts`). */
function sittingPlatform(world: World): Platform {
  return {
    tax: positionOf(world, 'tax'),
    dividend: positionOf(world, 'dividend'),
    minWage: positionOf(world, 'minWage'),
    strictness: positionOf(world, 'strictness'),
  };
}

/** 1 when two platforms say the same thing, 0 when they are opposites. */
function platformFit(a: Platform, b: Platform): number {
  let diff = 0;
  for (const field of PLATFORM_FIELDS) diff += Math.abs(clamp(a[field], 0, 1) - clamp(b[field], 0, 1));
  return 1 - diff / PLATFORM_FIELDS.length;
}

/**
 * −1, 0 or +1: which way this citizen's purse has gone since the mark the
 * daily pass leaves, which is never more than three days old.
 */
function walletTrend(world: World, c: Citizen): number {
  const then = world.counters[walletKey(c.id)];
  const day = world.counters[walletDayKey(c.id)];
  if (then === undefined || day === undefined || world.day <= day) return 0;
  return Math.sign(c.wallet - then);
}

/** Everybody the city failed to keep safe this week, from the Court's own book. */
function victimsOfTheWeek(world: World): Set<CitizenId> {
  const out = new Set<CitizenId>();
  const since = world.day - VICTIM_MEMORY_DAYS;
  for (const k of Object.values(world.cases)) {
    if (!k.victimId) continue;
    if (Math.floor(k.filedTick / HOURS_PER_DAY) >= since) out.add(k.victimId);
  }
  return out;
}

/** The share of promises kept by whoever holds the office being judged. */
function officeKeptShare(world: World, of: 'mayor' | 'council'): number {
  const g = world.government;
  if (of === 'mayor') return g.mayorId ? keptShare(world, g.mayorId) : NEUTRAL;
  const ids = g.council.filter((id) => world.citizens[id]);
  if (ids.length === 0) return NEUTRAL;
  let sum = 0;
  for (const id of ids) sum += keptShare(world, id);
  return sum / ids.length;
}

/** Is there anybody in the office at all? An empty chair is neither approved of nor blamed. */
function officeFilled(world: World, of: 'mayor' | 'council'): boolean {
  const g = world.government;
  return of === 'mayor' ? g.mayorId !== null && world.citizens[g.mayorId] !== undefined : g.council.length > 0;
}

/**
 * The half of a reading that is the same for everybody: what the city is like
 * this morning. Read once and handed to every citizen, so a city of hundreds
 * walks the Court's book once a day rather than once a citizen.
 */
interface CityReading {
  victims: Set<CitizenId>;
  kept: { mayor: number; council: number };
  filled: { mayor: boolean; council: boolean };
  sitting: Platform;
  dear: boolean;
}

function cityReading(world: World): CityReading {
  return {
    victims: victimsOfTheWeek(world),
    kept: { mayor: officeKeptShare(world, 'mayor'), council: officeKeptShare(world, 'council') },
    filled: { mayor: officeFilled(world, 'mayor'), council: officeFilled(world, 'council') },
    sitting: sittingPlatform(world),
    dear: world.market.priceIndex > DEAR_PRICE_INDEX,
  };
}

function readingOf(world: World, c: Citizen, of: 'mayor' | 'council', city: CityReading): number {
  if (!c) return NEUTRAL;
  if (!city.filled[of]) return NEUTRAL;
  let score = NEUTRAL;

  // Work, and what the week has done to the purse.
  if (c.lifeStage !== 'child') {
    const working = c.jobId !== null || c.businessId !== null;
    score += working ? 0.1 : -0.15;
  }
  score += walletTrend(world, c) * 0.1;

  // Safety, and the price of a day's living.
  if (city.victims.has(c.id)) score -= 0.1;
  if (city.dear) score -= 0.1;

  // What they were promised, and what the city looks like from where they stand.
  score += (city.kept[of] - NEUTRAL) * 0.2;
  const school = c.school ?? null;
  if (school) score += (platformFit(SCHOOL_INFO[school].platform, city.sitting) - NEUTRAL) * 0.1;
  const paper = PAPER_INFO[c.paper ?? 'chronicle'] ?? PAPER_INFO.chronicle;
  score += (platformFit(paper.line, city.sitting) - NEUTRAL) * 0.1;

  const value = Math.round(clamp(score, 0, 1) * 100) / 100;
  return Number.isFinite(value) ? value : NEUTRAL;
}

/**
 * This citizen's reading of the Mayor or of the Council, 0..1, from their own
 * public situation. Never NaN: a child, a citizen with no home, no job, no
 * money and no family, and a city with nobody in office all read as a number.
 */
export function approvalOf(world: World, c: Citizen, of: 'mayor' | 'council'): number {
  return readingOf(world, c, of, cityReading(world));
}

/**
 * Morning: every citizen still in the city forms its reading of both offices,
 * and the purse each of them will be compared against in three days' time is
 * written down. Exiles and emigrants keep whatever they last thought.
 */
export function dailyApproval(world: World): void {
  const city = cityReading(world);
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c)) continue;
    c.approval = { mayor: readingOf(world, c, 'mayor', city), council: readingOf(world, c, 'council', city) };
    const day = world.counters[walletDayKey(id)];
    if (day === undefined || world.day - day >= WALLET_TREND_DAYS) {
      world.counters[walletKey(id)] = Math.round(c.wallet);
      world.counters[walletDayKey(id)] = world.day;
    }
  }
  // Nobody left in the city keeps a snapshot: the counters are not a graveyard.
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('wallet3:') && !key.startsWith('wallet3Day:')) continue;
    const id = key.slice(key.indexOf(':') + 1);
    const c = world.citizens[id];
    if (!c || !isPresent(world, c)) delete world.counters[key];
  }
}

/** The city's own reading: the mean of what its citizens think, rounded to 2. */
export function cityApproval(world: World): { mayor: number; council: number } {
  return memo(world, 'approval:city', () => cityApprovalNow(world));
}

function cityApprovalNow(world: World): { mayor: number; council: number } {
  let mayor = 0;
  let council = 0;
  let n = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c)) continue;
    const a = c.approval ?? { mayor: NEUTRAL, council: NEUTRAL };
    mayor += Number.isFinite(a.mayor) ? a.mayor : NEUTRAL;
    council += Number.isFinite(a.council) ? a.council : NEUTRAL;
    n++;
  }
  if (n === 0) return { mayor: NEUTRAL, council: NEUTRAL };
  return { mayor: Math.round((mayor / n) * 100) / 100, council: Math.round((council / n) * 100) / 100 };
}

/**
 * What a voter's opinion of an incumbent is worth at the ballot box: a fifth
 * of a point either way, and nothing at all for a candidate who has never held
 * the office being judged.
 */
export function approvalBonus(world: World, voter: Citizen, candidateId: CitizenId): number {
  if (!voter) return 0;
  const g = world.government;
  const isMayor = g.mayorId === candidateId;
  if (!isMayor && !g.council.includes(candidateId)) return 0;
  const reading = voter.approval ?? { mayor: NEUTRAL, council: NEUTRAL };
  const value = isMayor ? reading.mayor : reading.council;
  if (!Number.isFinite(value)) return 0;
  if (value < 0.35) return -0.2;
  if (value > 0.65) return 0.2;
  return 0;
}

/** How the city reads the office this citizen holds; NEUTRAL for a citizen who holds none. */
export function approvalOfOffice(world: World, holderId: CitizenId): number {
  const g = world.government;
  const city = cityApproval(world);
  if (g.mayorId === holderId) return city.mayor;
  if (g.council.includes(holderId)) return city.council;
  return NEUTRAL;
}

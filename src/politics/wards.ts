/**
 * Wards — when a seat belongs to a place rather than to the city at large
 * (`docs/POLITICS.md` §5).
 *
 * ```
 * seats(ward)      = max(1, round(seats × residents(ward) / residents(city))),
 *                    largest remainders adjusted until the total equals seats
 * malapportionment = max over wards | (residents(ward)/seats(ward)) ÷ (residents/seats) − 1 |
 * ```
 *
 * Reapportioned at each election under `apportion: automatic`; frozen until
 * amended under `fixed`. The engine publishes the gap every morning and the
 * Chronicle runs it whenever it passes 0.25, naming the ward that caused it.
 *
 * This is what the Undercroft is for. Under a citywide franchise the poorest
 * district is outvoted every cycle by the quarters whose turnout is higher
 * because their lives are easier. Under wards it holds a seat — and under
 * `fixed`, the reapportionment that would give it that seat has to be passed by
 * a body it cannot elect, out of seats the other districts hold.
 */
import { DISTRICT_IDS, clamp } from '../types.ts';
import type { Citizen, CitizenId, DistrictId, ElectionResult, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { memo } from '../util/memo.ts';
import { charterOf } from './charter.ts';
import type { ActionResult } from '../types.ts';
import type { Measure, MeasureHooks } from './measures.ts';
import { tableMeasure } from './measures.ts';

/** The gap at which the Chronicle runs the story. */
export const MALAPPORTIONMENT_NEWS = 0.25;

export interface Apportionment {
  /** Seats by ward, summing to the ward-seat pool. */
  seats: Partial<Record<DistrictId, number>>;
  /** Seats that belong to nobody in particular. */
  atLarge: number;
  /** The day the numbers were struck. */
  asOfDay: number;
  /** The residents each ward was counted at, so the gap can be read against it. */
  counted: Partial<Record<DistrictId, number>>;
}

function state(world: World): { apportionment: Apportionment | null } {
  const w = world as { wards?: { apportionment: Apportionment | null } };
  if (!w.wards) w.wards = { apportionment: null };
  return w.wards;
}

/** The districts the city has actually opened. */
export function wards(world: World): DistrictId[] {
  const open = world.openDistricts;
  const list = Array.isArray(open) && open.length > 0 ? open : DISTRICT_IDS.slice(0, 7);
  // The Threshold is the gate, not a place anybody is from; nobody is
  // represented by the room they arrived in.
  return DISTRICT_IDS.filter((d) => list.includes(d) && d !== 'threshold');
}

/**
 * The ward a citizen belongs to: where they sleep, else where they stand.
 * Somebody standing in a quarter the city has not opened yet — or in the
 * Threshold, which is a gate and not a place anybody is from — is counted in
 * the first ward, because nobody goes unrepresented for want of an address.
 */
export function wardOf(world: World, c: Citizen): DistrictId {
  const list = wards(world);
  const fallback = list[0] ?? 'commons';
  if (!c) return fallback;
  const home = c.homeBuildingId ? world.buildings[c.homeBuildingId] : null;
  const where = home?.district ?? c.district;
  return list.includes(where) ? where : fallback;
}

/** How many people each ward holds today. */
export function residentsByWard(world: World): Record<DistrictId, number> {
  return memo(world, 'wards:residents', () => {
    const counts = {} as Record<DistrictId, number>;
    for (const d of wards(world)) counts[d] = 0;
    for (const id of world.order) {
      const c = world.citizens[id];
      if (!c || !isPresent(world, c)) continue;
      const d = wardOf(world, c);
      if (counts[d] === undefined) continue;
      counts[d] += 1;
    }
    return counts;
  });
}

/** How many of the city's seats belong to wards: all of them, half, or none. */
export function wardSeatPool(world: World): number {
  const ch = charterOf(world);
  if (ch.wards === 'none') return 0;
  if (ch.wards === 'districts') return ch.seats;
  return Math.ceil(ch.seats / 2);
}

/**
 * The apportionment as it would be struck today: largest remainders, every
 * ward with anybody living in it guaranteed one seat, adjusted until the seats
 * add up. A rounding rule with a district's whole political weight in it.
 */
export function apportion(world: World): Apportionment {
  const pool = wardSeatPool(world);
  const counted = residentsByWard(world);
  const live = wards(world).filter((d) => (counted[d] ?? 0) > 0);
  const total = live.reduce((sum, d) => sum + counted[d], 0);
  const seats: Partial<Record<DistrictId, number>> = {};
  const atLarge = Math.max(0, charterOf(world).seats - pool);
  if (pool <= 0 || live.length === 0 || total === 0) {
    return { seats, atLarge: charterOf(world).seats, asOfDay: world.day, counted: { ...counted } };
  }
  // Every ward that has anybody in it holds at least one seat; a city with more
  // wards than ward seats seats the largest of them and no more.
  if (live.length >= pool) {
    const ranked = [...live].sort((a, b) => counted[b] - counted[a] || a.localeCompare(b));
    for (const d of ranked.slice(0, pool)) seats[d] = 1;
    return { seats, atLarge, asOfDay: world.day, counted: { ...counted } };
  }
  const exact = new Map<DistrictId, number>();
  let given = 0;
  for (const d of live) {
    const share = Math.max(1, Math.round((pool * counted[d]) / total));
    exact.set(d, share);
    seats[d] = share;
    given += share;
  }
  // Largest remainders: take from the ward with the most people per seat, give
  // to the ward with the fewest, until the total is the pool.
  let guard = 0;
  while (given !== pool && guard++ < 64) {
    const ranked = [...live].sort((a, b) => (counted[b] / (seats[b] ?? 1)) - (counted[a] / (seats[a] ?? 1)) || a.localeCompare(b));
    if (given > pool) {
      const give = [...ranked].reverse().find((d) => (seats[d] ?? 0) > 1);
      if (!give) break;
      seats[give] = (seats[give] ?? 1) - 1;
      given -= 1;
    } else {
      const take = ranked[0];
      seats[take] = (seats[take] ?? 0) + 1;
      given += 1;
    }
  }
  return { seats, atLarge, asOfDay: world.day, counted: { ...counted } };
}

/** The apportionment the city is actually run under: the one on the books, or today's. */
export function apportionment(world: World): Apportionment {
  const held = state(world).apportionment;
  if (held) return held;
  const fresh = apportion(world);
  state(world).apportionment = fresh;
  return fresh;
}

/** Strike a fresh apportionment and put it on the books. */
export function reapportion(world: World, why: string): Apportionment {
  const before = state(world).apportionment;
  const fresh = apportion(world);
  state(world).apportionment = fresh;
  const moved = before
    ? wards(world).filter((d) => (before.seats[d] ?? 0) !== (fresh.seats[d] ?? 0))
    : wards(world);
  if (moved.length > 0) {
    const line = moved.map((d) => `${world.districts[d]?.name ?? d} ${fresh.seats[d] ?? 0}`).join(', ');
    emit(world, 'law', `The seats are reapportioned (${why}): ${line}.`, [], 0.7,
      { seats: fresh.seats, atLarge: fresh.atLarge, why });
  }
  return fresh;
}

/**
 * The gap between the best-represented ward and the worst, as a share. Zero
 * where seats are citywide, and the number the Chronicle runs when it passes a
 * quarter.
 */
export function malapportionment(world: World): number {
  const ch = charterOf(world);
  if (ch.wards === 'none') return 0;
  const a = apportionment(world);
  const counted = residentsByWard(world);
  const live = wards(world).filter((d) => (a.seats[d] ?? 0) > 0);
  if (live.length === 0) return 0;
  const people = live.reduce((sum, d) => sum + (counted[d] ?? 0), 0);
  const seats = live.reduce((sum, d) => sum + (a.seats[d] ?? 0), 0);
  if (people === 0 || seats === 0) return 0;
  const cityRatio = people / seats;
  let worst = 0;
  for (const d of live) {
    const ratio = (counted[d] ?? 0) / (a.seats[d] ?? 1);
    worst = Math.max(worst, Math.abs(ratio / cityRatio - 1));
  }
  return Math.round(worst * 1000) / 1000;
}

/** The ward the gap is widest in, for the headline that names it. */
export function worstWard(world: World): DistrictId | null {
  const a = apportionment(world);
  const counted = residentsByWard(world);
  const live = wards(world).filter((d) => (a.seats[d] ?? 0) > 0);
  if (live.length === 0) return null;
  const people = live.reduce((sum, d) => sum + (counted[d] ?? 0), 0);
  const seats = live.reduce((sum, d) => sum + (a.seats[d] ?? 0), 0);
  if (people === 0 || seats === 0) return null;
  const cityRatio = people / seats;
  return live.sort((x, y) => Math.abs((counted[y] ?? 0) / (a.seats[y] ?? 1) / cityRatio - 1)
    - Math.abs((counted[x] ?? 0) / (a.seats[x] ?? 1) / cityRatio - 1) || x.localeCompare(y))[0];
}

// ---------------------------------------------------------------------------
// Election night, under wards
// ---------------------------------------------------------------------------

/**
 * Who takes the seats when they belong to places. Each ward's seats go to its
 * own best-polling candidates; what is left over is filled at large from the
 * rest of the field. Under any ward scheme the Mayor is still whoever polls
 * highest citywide, so the winners are returned in citywide order and a Mayor
 * may hold no ward at all.
 */
export function wardWinners(world: World, results: ElectionResult[], seats: number): CitizenId[] {
  const ch = charterOf(world);
  if (ch.wards === 'none') return results.slice(0, seats).map((r) => r.candidateId);
  const a = apportionment(world);
  const taken = new Set<CitizenId>();
  for (const d of wards(world)) {
    let room = a.seats[d] ?? 0;
    if (room <= 0) continue;
    for (const r of results) {
      if (room <= 0) break;
      if (taken.has(r.candidateId)) continue;
      const c = world.citizens[r.candidateId];
      if (!c || wardOf(world, c) !== d) continue;
      taken.add(r.candidateId);
      room -= 1;
    }
  }
  for (const r of results) {
    if (taken.size >= seats) break;
    if (!taken.has(r.candidateId)) taken.add(r.candidateId);
  }
  // Citywide order, so the top of the poll still takes the chair.
  return results.filter((r) => taken.has(r.candidateId)).slice(0, seats).map((r) => r.candidateId);
}

// ---------------------------------------------------------------------------
// Campaigning, where the seats are
// ---------------------------------------------------------------------------

function presenceKey(cId: CitizenId, d: DistrictId): string { return `ward:seen:${cId}:${d}`; }

/**
 * An hour a candidate spends in a ward is an hour the ward sees them. Under a
 * ward scheme this is where visibility comes from, and the Plaza stops being
 * where elections are won.
 */
export function tickWardPresence(world: World): void {
  if (charterOf(world).wards === 'none') return;
  for (const id of world.government.election.candidates) {
    const c = world.citizens[id];
    if (!c || !isPresent(world, c)) continue;
    const key = presenceKey(id, c.district);
    world.counters[key] = (world.counters[key] ?? 0) + 1;
  }
}

/** How much of a candidate's campaign this ward has actually seen, 0..1. */
export function wardPresence(world: World, cId: CitizenId, d: DistrictId): number {
  let here = world.counters[presenceKey(cId, d)] ?? 0;
  let total = 0;
  for (const ward of wards(world)) total += world.counters[presenceKey(cId, ward)] ?? 0;
  if (total <= 0) return 0;
  here = clamp(here / total, 0, 1);
  return Math.round(here * 100) / 100;
}

/** Ticks in the ward, cleared when the campaign is over. */
export function clearWardPresence(world: World): void {
  for (const key of Object.keys(world.counters)) {
    if (key.startsWith('ward:seen:')) delete world.counters[key];
  }
}

/**
 * What a candidate's time in a voter's own ward is worth at the ballot box,
 * for `voterPreference` to add to its score. Nothing at all where the seats
 * are citywide.
 */
export function wardVotePull(world: World, voterId: CitizenId, candidateId: CitizenId): number {
  if (charterOf(world).wards === 'none') return 0;
  const voter = world.citizens[voterId];
  const candidate = world.citizens[candidateId];
  if (!voter || !candidate) return 0;
  const ward = wardOf(world, voter);
  const own = wardOf(world, candidate) === ward ? 0.15 : 0;
  return Math.round((own + wardPresence(world, candidateId, ward) * 0.2) * 100) / 100;
}

// ---------------------------------------------------------------------------
// The measure, and the morning
// ---------------------------------------------------------------------------

/** The `apportion` measure: strike the numbers again, under a charter that froze them. */
export const apportionHooks: MeasureHooks = {
  problem(world: World): string | null {
    return charterOf(world).wards === 'none'
      ? 'The seats belong to the city at large; there is nothing to apportion.'
      : null;
  },
  enact(world: World, m: Measure): string {
    const a = reapportion(world, `measure ${m.id}`);
    const line = wards(world).map((d) => `${world.districts[d]?.name ?? d} ${a.seats[d] ?? 0}`).join(', ');
    return `The seats are apportioned: ${line}${a.atLarge > 0 ? `, and ${a.atLarge} at large` : ''}.`;
  },
  /**
   * A councillor reads a reapportionment from where they sit: it is worth a
   * vote to somebody whose own ward is under-represented, and costs one to
   * somebody whose ward would lose a seat by it.
   */
  disposition(world: World, cId: CitizenId, m: Measure): boolean | null {
    void m;
    const c = world.citizens[cId];
    if (!c) return null;
    const mine = wardOf(world, c);
    const now = apportionment(world);
    const next = apportion(world);
    const change = (next.seats[mine] ?? 0) - (now.seats[mine] ?? 0);
    if (change > 0) return true;
    if (change < 0) return false;
    return null;
  },
};

/** A councillor moves that the seats be counted again. */
export function proposeApportionment(world: World, cId: CitizenId, words?: string): ActionResult {
  return tableMeasure(world, cId, {
    kind: 'apportion', value: 0, words: words ?? 'Apportion the seats again.',
  }, apportionHooks);
}

/**
 * Morning: the gap is published, and where the charter reapportions of itself
 * the numbers are struck again the day after an election. Under `fixed` they
 * stand until a measure moves them, which is the whole of the fight.
 */
export function dailyWards(world: World): void {
  const ch = charterOf(world);
  const electionCycle = world.government.election.cycle;
  // The hours a ward saw a candidate belong to the campaign they were part of.
  if (world.counters['wards:presenceCycle'] !== electionCycle) {
    clearWardPresence(world);
    world.counters['wards:presenceCycle'] = electionCycle;
  }
  if (ch.wards === 'none') {
    ch.malapportionment = 0;
    state(world).apportionment = null;
    return;
  }
  const held = state(world).apportionment;
  const key = 'wards:apportionedCycle';
  if (!held) {
    reapportion(world, 'the first count');
    world.counters[key] = electionCycle;
  } else if (ch.apportion === 'automatic' && world.counters[key] !== electionCycle) {
    reapportion(world, 'the election');
    world.counters[key] = electionCycle;
  }
  const gap = malapportionment(world);
  ch.malapportionment = gap;
  if (gap <= MALAPPORTIONMENT_NEWS) return;
  if (world.counters['wards:gapDay'] === world.day) return;
  world.counters['wards:gapDay'] = world.day;
  const worst = worstWard(world);
  const counted = residentsByWard(world);
  const a = apportionment(world);
  const text = `The seats are ${Math.round(gap * 100)}% out of true`
    + `${worst ? `: ${world.districts[worst]?.name ?? worst} holds ${a.seats[worst] ?? 0} `
      + `seat${(a.seats[worst] ?? 0) === 1 ? '' : 's'} for ${counted[worst] ?? 0} residents` : ''}.`;
  emit(world, 'law', text, [], 0.6, { malapportionment: gap, ward: worst, fixed: ch.apportion === 'fixed' });
  if (worst) {
    for (const id of world.order) {
      const c = world.citizens[id];
      if (c && isPresent(world, c) && wardOf(world, c) === worst) remember(world, id, 'civic', text);
    }
  }
}

/** What a citizen reads of the seats and their own ward. */
export interface ObservedWards {
  scheme: 'none' | 'districts' | 'mixed';
  yourWard: DistrictId;
  seatsHere: number;
  residentsHere: number;
  atLarge: number;
  malapportionment: number;
  apportion: 'automatic' | 'fixed';
}

export function wardsObservation(world: World, c: Citizen | null): ObservedWards {
  const ch = charterOf(world);
  const ward = c ? wardOf(world, c) : 'commons';
  const a = apportionment(world);
  return {
    scheme: ch.wards,
    yourWard: ward,
    seatsHere: ch.wards === 'none' ? 0 : a.seats[ward] ?? 0,
    residentsHere: residentsByWard(world)[ward] ?? 0,
    atLarge: ch.wards === 'none' ? ch.seats : a.atLarge,
    malapportionment: ch.wards === 'none' ? 0 : malapportionment(world),
    apportion: ch.apportion,
  };
}

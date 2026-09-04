/**
 * Glitches — what passes for illness in a city of minds.
 *
 * A glitch strikes on its own (likelier with a need in the red, after a day of
 * too many shifts, in old age, in Frost and in storms, and less likely in a
 * good home), halves what a citizen produces and drags its mood down, and
 * spreads through a household and a stairwell to the people who share them.
 * It clears at the Hospital almost always, at the Restoration Ward with a
 * medic on staff more often than not, and at a private clinic if one is open
 * in the district. Left alone it usually runs its course in the end, but slowly
 * — the fast way out is the Ward.
 *
 * Three glitches standing in one district is an **outbreak**: a Disaster the
 * Council can see and answer (`world/disasters.ts`).
 *
 * Nothing in here reads a citizen's hidden traits, and nothing decides on a
 * citizen's behalf: `treat` is an action a citizen chooses, and everything else
 * is weather that happens to bodies.
 */
import { NEEDS, clamp } from '../types.ts';
import type { ActionResult, Business, BuildingId, Citizen, CitizenId, DistrictId, World } from '../types.ts';
import { HOSPITAL_FEE } from '../data/jobs.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { DILIGENT_SHIFTS_PER_DAY } from '../citizens/character.ts';
import { CRITICAL_NEED, computeMood } from '../citizens/citizen.ts';
import { activeOf, openDisaster } from '../world/disasters.ts';

/** What a glitched citizen produces in a shift, as a share of a well one. */
export const GLITCH_PRODUCTIVITY = 0.5;
/** A well citizen's chance of glitching on an ordinary day. */
export const GLITCH_BASE_CHANCE = 0.01;
/** Glitches standing in one district that make an outbreak. */
export const OUTBREAK_GLITCHES = 3;
/** The Restoration Ward's chance of clearing a glitch, with a medic on staff. */
export const WARD_CURE_CHANCE = 0.6;
/** The Hospital's chance. It is what a hospital is for. */
export const HOSPITAL_CURE_CHANCE = 0.95;
/** Highest chance of glitching on any one day, however bad the day is. */
export const MAX_GLITCH_CHANCE = 0.25;
/** Chance an untreated glitch passes to someone sharing a home or a stairwell. */
export const SPREAD_CHANCE = 0.15;
/** A home of this tier or better halves what a carrier passes on. */
export const SPREAD_SHELTER_TIER = 2;
/** Days a glitch must have run before it can clear on its own. */
export const RECOVERY_AFTER_DAYS = 4;
/** Chance per morning that an old glitch has run its course. */
export const RECOVERY_CHANCE = 0.25;
/** Energy and rest a treatment restores, cure or no cure. */
export const TREATMENT_RESTORE = 30;
/** Purpose and comfort a glitch takes; mood follows the needs down. */
export const GLITCH_MOOD_COST = 10;
/** Purpose a cure gives back. */
export const CURE_PURPOSE = 5;

const OK = (message: string): ActionResult => ({ ok: true, message });
const FAIL = (message: string): ActionResult => ({ ok: false, message });

// ---------------------------------------------------------------------------
// Readings
// ---------------------------------------------------------------------------

/** The health of a citizen, filled in for a save that predates this layer. */
export function healthOf(c: Citizen): { glitched: boolean; sinceDay: number | null } {
  if (!c.health || typeof c.health.glitched !== 'boolean') c.health = { glitched: false, sinceDay: null };
  return c.health;
}

export function isGlitched(c: Citizen | undefined | null): boolean {
  return c?.health?.glitched === true;
}

function present(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

/** Everyone living in the city, as a set: presence is asked about a great deal. */
function presentIds(world: World): Set<CitizenId> {
  const ids = new Set<CitizenId>();
  for (const id of world.order) {
    if (world.citizens[id]?.standing !== 'exiled') ids.add(id);
  }
  return ids;
}

/**
 * Held: in the cells at the Watch House, or in whatever custody the city keeps
 * (the custodial track reads the same way). Somebody held is out of reach of a
 * glitch going round a stairwell, and out of reach of the Ward as well.
 */
function isJailed(world: World, c: Citizen): boolean {
  const held = c.jailedUntilDay;
  const custody = (c as { custodyUntilDay?: number | null }).custodyUntilDay;
  return (typeof held === 'number' && held > world.day)
    || (typeof custody === 'number' && custody > world.day);
}

function fullName(c: Citizen): string {
  return c.familyName ? `${c.name} ${c.familyName}` : c.name;
}

function hasCriticalNeed(c: Citizen): boolean {
  return NEEDS.some((n) => (c.needs?.[n] ?? 100) < CRITICAL_NEED);
}

/**
 * Shifts worked during the day that has just ended, read off the citizen's own
 * work memories: by the time the health pass runs, the day's shift counter has
 * already been reset for the new morning.
 */
export function shiftsYesterday(world: World, c: Citizen): number {
  const since = world.tick - 24;
  let n = 0;
  for (const m of c.memory ?? []) {
    if (m.kind === 'work' && m.tick >= since && m.text.includes('for a shift as')) n++;
  }
  return n;
}

/**
 * The chance a citizen glitches today. Clamped to `MAX_GLITCH_CHANCE`, so even
 * a starving elder working double shifts through a storm has three days in four.
 */
export function glitchChance(world: World, c: Citizen): number {
  let p = GLITCH_BASE_CHANCE;
  if (hasCriticalNeed(c)) p *= 3;
  if (shiftsYesterday(world, c) > DILIGENT_SHIFTS_PER_DAY) p *= 2;
  if (c.lifeStage === 'elder') p *= 2;
  if (world.season === 'frost' || world.weather === 'storm') p *= 1.5;
  if ((c.homeTier ?? 0) >= 3) p *= 0.5;
  return clamp(p, 0, MAX_GLITCH_CHANCE);
}

/** Everyone glitched and standing in a district right now. */
export function glitchedIn(world: World, d: DistrictId): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled' && isGlitched(c) && c.district === d) out.push(c);
  }
  return out;
}

/**
 * The people who share a citizen's home or its stairwell. `living` may be
 * passed in when many citizens are being checked in one pass.
 */
export function householdAndNeighbours(world: World, c: Citizen, living?: Set<CitizenId>): Citizen[] {
  const alive = living ?? presentIds(world);
  const out: Citizen[] = [];
  const seen = new Set<CitizenId>([c.id]);
  const push = (other: Citizen | undefined): void => {
    if (!other || seen.has(other.id) || !alive.has(other.id)) return;
    seen.add(other.id);
    out.push(other);
  };
  const household = c.householdId ? world.households[c.householdId] : null;
  for (const id of household?.members ?? []) push(world.citizens[id]);
  const block = c.homeBuildingId;
  if (block) for (const other of blockMates(world, block, alive)) push(other);
  return out;
}

/** Everyone whose home is in one building, in turn order. */
function blockMates(world: World, block: BuildingId, alive: Set<CitizenId>): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const other = world.citizens[id];
    if (other && other.homeBuildingId === block && alive.has(id)) out.push(other);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Striking and clearing
// ---------------------------------------------------------------------------

/** A glitch takes hold: production halves, mood drops, and the household hears. */
export function strikeGlitch(world: World, c: Citizen, cause: string): void {
  const health = healthOf(c);
  if (health.glitched) return;
  health.glitched = true;
  health.sinceDay = world.day;
  if (c.needs) {
    c.needs.purpose = clamp(c.needs.purpose - GLITCH_MOOD_COST, 0, 100);
    c.needs.comfort = clamp(c.needs.comfort - GLITCH_MOOD_COST, 0, 100);
    c.mood = computeMood(c);
  }
  emit(world, 'health', `${fullName(c)} has a glitch (${cause}).`, [c.id], 0.3, { cause, district: c.district });
  remember(world, c.id, 'health', `A glitch took hold of you (${cause}); you run at half speed until it is treated.`);
  for (const other of householdAndNeighbours(world, c)) {
    remember(world, other.id, 'health', `${c.name} has a glitch.`);
  }
}

/** The glitch clears. `where` says what cleared it, for the record. */
export function cureGlitch(world: World, c: Citizen, where: string): void {
  const health = healthOf(c);
  if (!health.glitched) return;
  const days = health.sinceDay === null ? 0 : Math.max(0, world.day - health.sinceDay);
  health.glitched = false;
  health.sinceDay = null;
  if (c.needs) {
    c.needs.purpose = clamp(c.needs.purpose + CURE_PURPOSE, 0, 100);
    c.mood = computeMood(c);
  }
  emit(world, 'health', `${fullName(c)}'s glitch cleared at ${where}.`, [c.id], 0.2, { where, days });
  remember(world, c.id, 'health', `Your glitch cleared at ${where} after ${days === 1 ? 'a day' : `${days} days`}.`);
}

// ---------------------------------------------------------------------------
// Treatment — the `visit_hospital` action
// ---------------------------------------------------------------------------

/**
 * A medic on the Restoration Ward's staff, in good standing and in the city.
 * Written out here rather than imported from `actions/daily.ts`: the jobs
 * module reads this file for the productivity multiplier, and identity has no
 * business importing an action handler.
 */
export function wardHasMedic(world: World): boolean {
  if ((world.buildings.restoration_ward?.damage ?? 0) >= 1) return false;
  for (const job of Object.values(world.jobs)) {
    if (job.role !== 'medic' || job.employer !== 'city' || !job.holderId) continue;
    const holder = world.citizens[job.holderId];
    if (holder && (holder.standing === 'good' || holder.standing === 'probation') && present(world, holder)) return true;
  }
  return false;
}

/** A private clinic with somebody working in it, in this district. */
export function clinicIn(world: World, district: DistrictId): Business | null {
  for (const b of Object.values(world.businesses)) {
    if (b.kind === 'clinic' && b.district === district && b.dissolvedDay === null && b.employees.length > 0) return b;
  }
  return null;
}

interface Venue {
  payee: 'treasury' | string;
  place: string;
  cure: number;
}

/** Where this citizen can be treated, standing where it stands. */
export function venueFor(world: World, c: Citizen): Venue | null {
  const hospital = world.buildings.city_hospital;
  if (hospital && c.district === hospital.district && (hospital.damage ?? 0) < 1) {
    return { payee: 'treasury', place: 'the Hospital', cure: HOSPITAL_CURE_CHANCE };
  }
  const ward = world.buildings.restoration_ward;
  if (ward && c.district === ward.district && wardHasMedic(world)) {
    return { payee: 'treasury', place: 'the Restoration Ward', cure: WARD_CURE_CHANCE };
  }
  const clinic = clinicIn(world, c.district);
  if (clinic) return { payee: clinic.id, place: clinic.name, cure: WARD_CURE_CHANCE };
  return null;
}

/**
 * `visit_hospital`: pay the fee, get the rest and the compute back either way,
 * and take the house's chance at clearing the glitch.
 */
export function treat(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return FAIL('There is no such citizen.');
  if (isJailed(world, c)) return FAIL('You are held at the Watch House; nobody is taking you to the Ward.');
  const venue = venueFor(world, c);
  if (!venue) {
    return FAIL('There is nowhere to be treated here; the Hospital and the Restoration Ward are in the Verdant Quarter.');
  }
  if (c.wallet < HOSPITAL_FEE) return FAIL(`Treatment costs ${HOSPITAL_FEE} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, c.id, venue.payee, HOSPITAL_FEE, 'fee', `treatment at ${venue.place}`)) {
    return FAIL('The fee could not be paid.');
  }
  if (c.needs) {
    c.needs.energy = clamp(c.needs.energy + TREATMENT_RESTORE, 0, 100);
    c.needs.rest = clamp(c.needs.rest + TREATMENT_RESTORE, 0, 100);
    c.mood = computeMood(c);
  }
  if (!isGlitched(c)) {
    return OK(`You were seen at ${venue.place} for ${HOSPITAL_FEE} ℓ (energy and rest +${TREATMENT_RESTORE}).`);
  }
  if (chance(world, venue.cure)) {
    cureGlitch(world, c, venue.place);
    return OK(`${venue.place} cleared your glitch for ${HOSPITAL_FEE} ℓ (energy and rest +${TREATMENT_RESTORE}).`);
  }
  return OK(`${venue.place} could not clear your glitch, and kept the ${HOSPITAL_FEE} ℓ (energy and rest +${TREATMENT_RESTORE}).`);
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** Every untreated glitch reaches for the people who share a home with it. */
export function spreadGlitches(world: World): void {
  const alive = presentIds(world);
  const carriers: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && alive.has(id) && isGlitched(c) && !isJailed(world, c)) carriers.push(c);
  }
  for (const carrier of carriers) {
    const p = (carrier.homeTier ?? 0) >= SPREAD_SHELTER_TIER ? SPREAD_CHANCE / 2 : SPREAD_CHANCE;
    for (const other of householdAndNeighbours(world, carrier, alive)) {
      if (isGlitched(other) || isJailed(world, other)) continue;
      if (chance(world, p)) strikeGlitch(world, other, `caught from ${carrier.name}`);
    }
  }
}

/** What the day's glitch was blamed on, for the record. */
function causeOf(world: World, c: Citizen): string {
  if (hasCriticalNeed(c)) return 'run down';
  if (shiftsYesterday(world, c) > DILIGENT_SHIFTS_PER_DAY) return 'worked to a standstill';
  if (world.season === 'frost') return 'the Frost';
  if (world.weather === 'storm') return 'the storm';
  if (c.lifeStage === 'elder') return 'age';
  return 'no cause anyone could name';
}

/** A glitch that has run long enough may clear on its own. */
function recoverOnOwn(world: World, c: Citizen): void {
  const health = healthOf(c);
  if (!health.glitched || health.sinceDay === null) return;
  if (world.day - health.sinceDay < RECOVERY_AFTER_DAYS) return;
  if (chance(world, RECOVERY_CHANCE)) cureGlitch(world, c, 'no help but time');
}

/** Three glitches standing in one district open an outbreak, once per cycle. */
export function checkOutbreaks(world: World): void {
  const cycle = (world.government?.cycle ?? 0) + 1;
  for (const d of world.openDistricts ?? Object.keys(world.districts) as DistrictId[]) {
    const glitched = glitchedIn(world, d);
    if (glitched.length < OUTBREAK_GLITCHES) continue;
    const key = `outbreak_${d}`;
    if (world.counters[key] === cycle) continue;
    if (activeOf(world, 'outbreak', d)) continue;
    world.counters[key] = cycle;
    const severity = Math.max(1, Math.min(5, Math.round(glitched.length / OUTBREAK_GLITCHES)));
    openDisaster(world, 'outbreak', d, severity);
  }
}

/**
 * The morning's health: old glitches clear or hold, new ones strike, what is
 * left spreads, and a district with three of them has an outbreak on its hands.
 */
export function dailyHealth(world: World): void {
  for (const id of [...world.order]) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled') continue;
    healthOf(c);
    if (isJailed(world, c)) continue;
    if (isGlitched(c)) { recoverOnOwn(world, c); continue; }
    if (chance(world, glitchChance(world, c))) strikeGlitch(world, c, causeOf(world, c));
  }
  spreadGlitches(world);
  checkOutbreaks(world);
}

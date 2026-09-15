/**
 * What the air and the water actually do, and the shifts somebody spends
 * proving it (`docs/ENVIRONMENT.md` §§2, 7, 9).
 *
 * Air, water and greenery are public everywhere — they are the air, and
 * `PRINCIPLES.md` §5 keeps nothing from anyone. A **reading** is a different
 * thing: dated, attributed, admissible, and somebody spent a shift on it. It is
 * the evidence a river compact is made of, and it is what turns a bypass
 * downstream from a rumour into a case.
 *
 * The four effects are all read from the same burden — the air over a district
 * plus 0.6 of the river through it — except the hinterland's yield, where the
 * water counts for 1.4 because the fields are irrigated.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CitizenId, DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { districtName, fail, isPresent, ok } from '../actions/common.ts';
import { isOpen, openDistricts } from '../world/growth.ts';
import { PERMIT_PREMIUM, airLevel, districtEnvironment, environmentState, permitOf, waterLevel } from './state.ts';
import type { Reading } from './state.ts';

// ---------------------------------------------------------------------------
// What it does (`ENVIRONMENT.md` §2)
// ---------------------------------------------------------------------------

/** What the river counts for beside the air, in everything but the fields. */
export const WATER_WEIGHT = 0.6;
/** And in the fields, which are irrigated out of it. */
export const HINTERLAND_WATER_WEIGHT = 1.4;

/** `identity/health.ts glitchChance` gains this multiplier: × (1 + 1.2 × burden). */
export const GLITCH_AIR = 1.2;
/** Rest at home restores `15 × (1 − 0.4 × burden)` a tick instead of a flat 15. */
export const REST_AIR = 0.4;
/** The amenity term of `PROPERTY.md` §1 loses this much per point of burden. */
export const AMENITY_AIR = 0.45;
/** Greenery lifts the same term (`ENVIRONMENT.md` §8). */
export const AMENITY_GREENERY = 0.30;
/** Compute per Forge Operator shift takes × (1 − 0.35 × hinterland burden). */
export const YIELD_AIR = 0.35;

/** Trees standing in a district, 0..1, memorials in the Garden included. */
export function greeneryOf(world: World, d: DistrictId): number {
  const row = districtEnvironment(world, d);
  const garden = world.buildings?.community_garden?.district ?? 'verdant_quarter';
  const memorials = d === garden ? (world.memorials?.length ?? 0) * MEMORIAL_GREENERY : 0;
  return clamp(row.greenery + memorials, 0, 1);
}

/** Each memorial in the Community Garden is a tree that stays (`ENVIRONMENT.md` §8). */
export const MEMORIAL_GREENERY = 0.01;

/**
 * What a district's people are breathing and drinking, as one number: the air,
 * and 0.6 of the river.
 */
export function pollutionBurden(world: World, d: DistrictId): number {
  return clamp(airLevel(world, d) + WATER_WEIGHT * waterLevel(world, d), 0, 1);
}

/**
 * What this layer adds to the amenity term of `PROPERTY.md` §1: what the
 * district may be built for, what grows in it, and what its own shifts emit.
 * **This replaces the founding line asserting that the Forge subtracts** — it
 * subtracts because of what it emits, so a scrubbed forge subtracts less and an
 * idle one subtracts nothing (`REGISTRY.md` §7).
 */
export function amenityAdjustment(world: World, d: DistrictId): number {
  return PERMIT_PREMIUM[permitOf(world, d)]
    + AMENITY_GREENERY * greeneryOf(world, d)
    - AMENITY_AIR * pollutionBurden(world, d);
}

/** What the air does to the chance of a glitch (`identity/health.ts`). */
export function glitchAirFactor(world: World, d: DistrictId): number {
  return 1 + GLITCH_AIR * pollutionBurden(world, d);
}

/** What it does to an hour's sleep: a cheap room by the forge costs hours of it. */
export function restAirFactor(world: World, d: DistrictId): number {
  return clamp(1 - REST_AIR * pollutionBurden(world, d), 0, 1);
}

/** The mean reading over the districts, which is what the fields downwind breathe. */
export function hinterlandAir(world: World): number {
  const list = openDistricts(world);
  if (list.length === 0) return 0;
  const mean = list.reduce((sum, d) => sum + airLevel(world, d), 0) / list.length;
  return clamp(mean + environmentState(world).hinterlandAir, 0, 1);
}

/** And the same for the water it irrigates out of. */
export function hinterlandWater(world: World): number {
  const list = openDistricts(world);
  if (list.length === 0) return 0;
  const mean = list.reduce((sum, d) => sum + waterLevel(world, d), 0) / list.length;
  return clamp(mean + environmentState(world).hinterlandWater, 0, 1);
}

/**
 * What a Forge Operator's shift yields against what it would in clean air.
 * This is the term that closes the loop: the Forge's own smoke cuts the Forge's
 * own yield, so a Council with no green politics whatever still has an
 * arithmetic reason to fund a scrubber.
 */
export function hinterlandYieldFactor(world: World): number {
  const burden = clamp(hinterlandAir(world) + HINTERLAND_WATER_WEIGHT * hinterlandWater(world), 0, 1);
  return clamp(1 - YIELD_AIR * burden, 0, 1);
}

// ---------------------------------------------------------------------------
// Readings (`survey_air`, `survey_water`)
// ---------------------------------------------------------------------------

/** The freshest reading of a kind for a district, inside `withinDays`. */
export function recentReading(world: World, d: DistrictId, kind: 'air' | 'water', withinDays: number): Reading | null {
  const list = environmentState(world).readings
    .filter((r) => r.district === d && r.kind === kind && world.day - r.day <= withinDays)
    .sort((a, b) => b.day - a.day);
  return list[0] ?? null;
}

/** Every reading filed for a district, newest first. */
export function readingsFor(world: World, d: DistrictId): Reading[] {
  return environmentState(world).readings
    .filter((r) => r.district === d)
    .sort((a, b) => b.day - a.day);
}

function survey(world: World, cId: CitizenId, d: DistrictId, kind: 'air' | 'water'): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('A reading is a shift, and children do not work shifts.');
  if (!isOpen(world, d)) return fail('The city has not opened that district.');
  if (c.district !== d) return fail(`You must stand in ${districtName(world, d)} to read its ${kind}.`);
  if (c.shiftsToday >= world.config.maxShiftsPerDay) return fail('You have done enough work for one day.');
  const value = kind === 'air' ? airLevel(world, d) : waterLevel(world, d);
  const reading: Reading = { district: d, kind, value: Math.round(value * 1000) / 1000, day: world.day, byId: cId };
  environmentState(world).readings.push(reading);
  c.shiftsToday += 1;
  c.needs.purpose = clamp(c.needs.purpose + 5, 0, 100);
  const where = districtName(world, d);
  emit(world, 'system',
    `${c.name} filed a reading in the Hall of Records: the ${kind} over ${where} stands at ${reading.value.toFixed(2)}.`,
    [cId], 0.3, { district: d, kind, value: reading.value, by: cId });
  remember(world, cId, 'work', `You read the ${kind} of ${where}: ${reading.value.toFixed(2)}. The reading is dated and public.`);
  return ok(`The ${kind} over ${where} stands at ${reading.value.toFixed(2)}; your reading is filed in the Hall of Records.`);
}

/** An analyst's shift files a dated public reading of the air. */
export function surveyAir(world: World, cId: CitizenId, d: DistrictId): ActionResult {
  return survey(world, cId, d, 'air');
}

/** The same for the river: the evidence a compact is made of. */
export function surveyWater(world: World, cId: CitizenId, d: DistrictId): ActionResult {
  return survey(world, cId, d, 'water');
}

/** Readings older than this many days are cleared out of the Hall of Records. */
export const READINGS_KEPT_DAYS = 90;

/** The Hall of Records keeps a cycle of readings and lets the rest go. */
export function pruneReadings(world: World): void {
  const s = environmentState(world);
  s.readings = s.readings.filter((r) => world.day - r.day <= READINGS_KEPT_DAYS);
}

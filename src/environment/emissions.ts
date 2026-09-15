/**
 * What a shift puts into the air (`docs/ENVIRONMENT.md` §1).
 *
 * **Emission comes from work, not from buildings standing there.** A closed
 * post emits nothing — the Compute Forge with nobody at it is a cold building —
 * and a forge driven through a shortage emits double, because that is what
 * running a plant hard means. The counter is per workplace and per day, and it
 * resolves on the rollover in `daily.ts`.
 *
 * Nothing here moves a lumen and nothing here punishes anybody. It counts.
 */
import type { BuildingId, BuildingKind, BusinessKind, DistrictId, Job, World } from '../types.ts';
import { BUILDINGS } from '../data/city.ts';
import {
  FITTING_SPECS, bypassedToday, emitterKey, environmentState, fittingOn, isBoughtOut, isRelocated,
} from './state.ts';
import type { EmitterDay } from './state.ts';
import { DRIFT_SHARE } from './wind.ts';
// The one thing this layer reads from the other: what the city has built for
// (`PROGRESS.md` §2's Flue Scrubbing, and the four subjects that cut a mote
// without meaning to). It answers 1 until somebody digs for it.
import { emissionMultiplier } from '../progress/effects.ts';

/**
 * Motes a shift makes, by where it is worked (`ENVIRONMENT.md` §1). The Forge
 * burns a cell of energy to make the city's food; the Power Station makes the
 * cell; a library emits nothing at all.
 */
export const BUILDING_MOTES: Partial<Record<BuildingKind, number>> = {
  forge: 1.00,
  power: 0.70,
  fabrication: 0.40,
  builders: 0.25,
  clinic: 0.05,
  hospital: 0.05,
};

/** And by what trade a private business plies: a bench, or a stove and a lamp. */
export const BUSINESS_MOTES: Record<BusinessKind, number> = {
  workshop: 0.30, cafe: 0.05, clinic: 0.05, studio: 0.05, shop: 0.05, courier: 0,
};

/** A shift driven through a shortage of what it makes emits this much more. */
export const SHORTAGE_MULTIPLIER = 2;

/**
 * What the city's technologies take off a mote per unit made. **Flue Scrubbing**
 * (`PROGRESS.md`, materials, tier 2) is 0.55 at every producing building once
 * the works are built and hands are trained to them, and `progress/effects.ts`
 * folds the readiness and the uptake in — so a city that has discovered it and
 * dug nothing for it still pays what it always paid.
 */
export function technologyFactor(world: World): number {
  return emissionMultiplier(world);
}

/**
 * What a building's fitting multiplies its shifts by: the rated effect, worn
 * down by however many days nobody has maintained it. A bypassed fitting
 * (`discharge`, L45) multiplies by nothing at all — that is what bypassing it
 * means.
 */
export function abatementFactor(world: World, buildingId: BuildingId): number {
  if (bypassedToday(world, buildingId)) return 1;
  const fitted = fittingOn(world, buildingId);
  if (!fitted) return 1;
  const spec = FITTING_SPECS[fitted.fitting];
  const effect = Math.max(0, Math.min(1, fitted.effect));
  return 1 - effect * (1 - spec.emission);
}

/** The share of a district's load that leaves it: more of it where a stack was raised. */
export function driftShareOf(world: World, d: DistrictId): number {
  const s = environmentState(world);
  let share = DRIFT_SHARE;
  for (const fitted of Object.values(s.abatement)) {
    const spec = FITTING_SPECS[fitted.fitting];
    if (spec.drift === null) continue;
    if ((BUILDINGS[fitted.building]?.district ?? world.buildings[fitted.building]?.district) !== d) continue;
    if (fitted.effect <= 0) continue;
    share = Math.max(share, spec.drift);
  }
  return share;
}

/** The kind of premises a trade works out of, for the motes table and the permits. */
export function businessMotes(kind: BusinessKind): number {
  return BUSINESS_MOTES[kind] ?? 0;
}

/**
 * The motes one shift at this post would make, before its fitting: the trade
 * for a private business, the building for a city post, and double where the
 * Bazaar has run out of what the shift makes.
 */
export function motesForShift(world: World, job: Job): number {
  if (isBoughtOut(world, job.buildingId)) return 0;
  const biz = job.employer === 'city' ? null : world.businesses[job.employer] ?? null;
  const kind = world.buildings[job.buildingId]?.kind ?? BUILDINGS[job.buildingId]?.kind ?? null;
  let motes = biz ? businessMotes(biz.kind) : (kind ? BUILDING_MOTES[kind] ?? 0 : 0);
  if (motes <= 0) return 0;
  const good = job.output?.good;
  if (good && (world.market?.shortages ?? []).includes(good)) motes *= SHORTAGE_MULTIPLIER;
  return motes * technologyFactor(world);
}

/**
 * Count one worked shift against the day. Called from `economy/jobs.ts` once a
 * shift has actually been worked and paid for, where the energy input is
 * already accounted. Returns the motes that left the stack.
 */
export function recordShiftEmission(world: World, job: Job): number {
  const raw = motesForShift(world, job);
  const bypassed = bypassedToday(world, job.buildingId);
  const motes = raw * abatementFactor(world, job.buildingId);
  const s = environmentState(world);
  const key = emitterKey(job.employer, job.buildingId);
  const row: EmitterDay = s.today[key] ?? {
    building: job.buildingId, district: job.district, owner: job.employer, motes: 0, bypassed: 0, shifts: 0,
  };
  row.motes += motes;
  if (bypassed) row.bypassed += motes;
  row.shifts += 1;
  s.today[key] = row;
  return motes;
}

/** Every workplace that was worked today. */
export function emittersToday(world: World): EmitterDay[] {
  return Object.values(environmentState(world).today);
}

/** What one district's shifts have put into the air today, after abatement. */
export function loadOf(world: World, d: DistrictId): number {
  let load = 0;
  for (const row of emittersToday(world)) {
    if (row.district !== d || isRelocated(world, row.building)) continue;
    load += row.motes;
  }
  return load;
}

/** Of that, what was worked with the fitting bypassed — which the river takes whole. */
export function bypassedLoadOf(world: World, d: DistrictId): number {
  let load = 0;
  for (const row of emittersToday(world)) {
    if (row.district !== d || isRelocated(world, row.building)) continue;
    load += row.bypassed;
  }
  return load;
}

/** What the works the city moved out of town are putting over the fields. */
export function hinterlandLoad(world: World): number {
  let load = 0;
  for (const row of emittersToday(world)) {
    if (isRelocated(world, row.building)) load += row.motes;
  }
  return load;
}

/** Shifts worked under a building's fitting today, which is what a scrubber burns for. */
export function shiftsUnder(world: World, buildingId: BuildingId): number {
  let shifts = 0;
  for (const row of emittersToday(world)) {
    if (row.building === buildingId) shifts += row.shifts;
  }
  return shifts;
}

/** What each workplace owes the day's emission charge on, owner by owner. */
export function chargeableToday(world: World): EmitterDay[] {
  return emittersToday(world).filter((row) => row.motes > 0);
}

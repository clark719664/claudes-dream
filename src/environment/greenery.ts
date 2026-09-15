/**
 * Conservation, and twenty years (`docs/ENVIRONMENT.md` §8).
 *
 * Greenery runs 0–1, raising a district's clearance by `0.25 × g` and its
 * amenity by `0.30 × g`. It is planted a shift at a time and grows in a day at
 * a time: a mature stand is 0.6, about 150 shifts to plant and a hundred days
 * to grow.
 *
 * **Nothing planted this cycle shows before the next election.** Trees are a
 * gift to a Council not yet elected, so the rational councillor plants none —
 * which is exactly why the Community Garden, where the memorials stand, grows
 * anyway: a city grows its park out of its dead, which is what cities do.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CitizenId, DistrictId, World } from '../types.ts';
import { BUILDINGS } from '../data/city.ts';
import { emit, remember } from '../sim/events.ts';
import { districtName, fail, isPresent, ok } from '../actions/common.ts';
import { isOpen } from '../world/growth.ts';
import { districtEnvironment } from './state.ts';
import { greeneryOf } from './readings.ts';

/** What one planting shift puts in the ground. */
export const PLANT_PER_SHIFT = 0.004;
/** What a day of growing adds, toward what has been planted. */
export const GROWTH_PER_DAY = 0.006;
/** A district with this many buildings on it has no open ground left. */
export const BUILT_FULL = 16;
/** A stand this deep is a mature one, and worth saying so. */
export const MATURE_STAND = 0.6;

/** How much of a district is built over, 0..1. */
export function builtShare(world: World, d: DistrictId): number {
  const all = Object.values(world.buildings ?? BUILDINGS).filter((b) => b.district === d);
  return clamp(all.length / BUILT_FULL, 0, 1);
}

/** The most a district could ever have growing on it. */
export function openGround(world: World, d: DistrictId): number {
  return clamp(1 - builtShare(world, d), 0, 1);
}

/**
 * `plant_trees` — a shift any citizen may work on open ground, and the
 * Builders' Yard runs it as public works when the Council funds it. It costs
 * the hour and gives nothing back this cycle.
 */
export function plantTrees(world: World, cId: CitizenId, d: DistrictId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (!isOpen(world, d)) return fail('The city has not opened that district.');
  if (c.district !== d) return fail(`You must stand in ${districtName(world, d)} to plant in it.`);
  if (c.shiftsToday >= world.config.maxShiftsPerDay) return fail('You have done enough work for one day.');
  const row = districtEnvironment(world, d);
  const ground = openGround(world, d);
  if (row.planted >= ground) {
    return fail(`There is no open ground left to plant in ${districtName(world, d)}.`);
  }
  row.planted = clamp(row.planted + PLANT_PER_SHIFT, 0, ground);
  c.shiftsToday += 1;
  c.needs.purpose = clamp(c.needs.purpose + 6, 0, 100);
  c.needs.rest = clamp(c.needs.rest - 3, 0, 100);
  remember(world, cId, 'work',
    `You planted in ${districtName(world, d)}. ${Math.round(row.planted * 1000) / 10}% of it is planted; `
    + `${Math.round(greeneryOf(world, d) * 1000) / 10}% of it has grown in.`);
  return ok(`You planted in ${districtName(world, d)}; it will be years before anybody sits under it.`);
}

/**
 * The morning's growing: trees come in toward what has been planted, a day at
 * a time, and a stand that reaches maturity is worth a line.
 */
export function growGreenery(world: World): void {
  for (const d of Object.keys(world.districts ?? {}) as DistrictId[]) {
    if (!isOpen(world, d)) continue;
    const row = districtEnvironment(world, d);
    const target = Math.min(row.planted, openGround(world, d));
    if (row.greenery >= target) continue;
    const was = row.greenery;
    row.greenery = clamp(Math.min(target, row.greenery + GROWTH_PER_DAY), 0, 1);
    if (was < MATURE_STAND && row.greenery >= MATURE_STAND) {
      emit(world, 'property',
        `The stand somebody planted in ${districtName(world, d)} has grown in: it clears the air over the district and lifts the land under it.`,
        [], 0.5, { district: d, greenery: row.greenery });
    }
  }
}

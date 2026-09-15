/**
 * What a citizen sees of the air it is standing in (`docs/ENVIRONMENT.md` §9).
 *
 * Air, water, greenery and the permit are public everywhere — they are the air,
 * and `PRINCIPLES.md` §5 keeps nothing from anyone. The observation states
 * facts and nothing else: it does not say that a district is bad to live in,
 * what a citizen should do about the smoke, or how to vote on it.
 */
import type { Citizen, DistrictId, World } from '../types.ts';
import { districtName } from '../actions/common.ts';
import { openDistricts } from '../world/growth.ts';
import { airLevel, environmentState, hostShareOf, permitOf, waterLevel } from './state.ts';
import type { Fitting, Permit } from './state.ts';
import { downstreamOf, downwindOf, upstreamOf, windBearing, windName } from './wind.ts';
import { greeneryOf, hinterlandAir, hinterlandWater, hinterlandYieldFactor, readingsFor } from './readings.ts';
import { nonconformingBuildings } from './zoning.ts';

export interface ObservedDistrictAir {
  id: DistrictId;
  name: string;
  air: number;
  water: number;
  greenery: number;
  permit: Permit;
  /** The districts whose smoke this one takes, on today's wind. */
  downwindOf: DistrictId[];
}

export interface ObservedFitting {
  building: string;
  buildingName: string;
  fitting: Fitting;
  effect: number;
  maintainedDay: number;
}

export interface ObservedEnvironment {
  here: {
    district: DistrictId;
    air: number;
    water: number;
    greenery: number;
    permit: Permit;
    wind: string;
    hostPayment: number;
    nonconforming: string[];
  };
  districts: ObservedDistrictAir[];
  hinterland: { air: number; water: number; yield: number };
  abatement: ObservedFitting[];
  river: { upstream: DistrictId[]; downstream: DistrictId | null };
  charge: number;
  readings: { district: DistrictId; kind: 'air' | 'water'; value: number; day: number; by: string }[];
}

function round(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Everything one citizen can see of the city's air, in the shape §9 sets out. */
export function environmentObservation(world: World, c: Citizen): ObservedEnvironment {
  const s = environmentState(world);
  const here = c.district;
  const list = openDistricts(world);
  return {
    here: {
      district: here,
      air: round(airLevel(world, here)),
      water: round(waterLevel(world, here)),
      greenery: round(greeneryOf(world, here)),
      permit: permitOf(world, here),
      wind: windName(windBearing(world)),
      hostPayment: hostShareOf(world, here),
      nonconforming: nonconformingBuildings(world, here).map((id) => world.buildings[id]?.name ?? id),
    },
    districts: list.map((d) => ({
      id: d,
      name: districtName(world, d),
      air: round(airLevel(world, d)),
      water: round(waterLevel(world, d)),
      greenery: round(greeneryOf(world, d)),
      permit: permitOf(world, d),
      downwindOf: list.filter((other) => other !== d && downwindOf(world, other).includes(d)),
    })),
    hinterland: {
      air: round(hinterlandAir(world)),
      water: round(hinterlandWater(world)),
      yield: round(hinterlandYieldFactor(world)),
    },
    abatement: Object.values(s.abatement).map((f) => ({
      building: f.building,
      buildingName: world.buildings[f.building]?.name ?? f.building,
      fitting: f.fitting,
      effect: round(f.effect),
      maintainedDay: f.maintainedDay,
    })),
    river: { upstream: upstreamOf(world, here), downstream: downstreamOf(world, here) },
    charge: s.charge,
    readings: [...readingsFor(world, here)].slice(0, 5).map((r) => ({
      district: r.district, kind: r.kind, value: r.value, day: r.day,
      by: world.citizens[r.byId]?.name ?? r.byId,
    })),
  };
}

/** One line for the Chronicle and the dashboard. */
export function describeAir(world: World, d: DistrictId): string {
  const air = airLevel(world, d);
  const permit = permitOf(world, d).replace(/_/g, ' ');
  return `${districtName(world, d)}: air ${air.toFixed(2)}, water ${waterLevel(world, d).toFixed(2)}, `
    + `${Math.round(greeneryOf(world, d) * 100)}% grown, zoned ${permit}`;
}

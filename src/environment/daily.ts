/**
 * The morning the night's air settles (`docs/ENVIRONMENT.md` §§1, 3, 6, 7).
 *
 * ```
 * load(d)  = Σ yesterday's shifts in d: motes × (1 − abatement) × perUnit(technologies)
 * drifted  = 0.30 × load(d)            a third of a day's emission leaves the district
 *     neighbour n takes drifted × w(n)/Σw,  w(n) = max(0, cos(bearing(d→n) − wind))²
 * air(d) ← clamp(0, 1, air(d) × (1 − clearance) + (load − drifted + driftedIn) / 480)
 * ```
 *
 * The 480 is set so a founding Foundry Row — two forge posts, two power, one
 * fabricator and one builder at six shifts each, 24 motes a day — settles at
 * **0.33** against the founding clearance of 0.15: sooty and liveable. Double
 * the forge with no abatement and it reaches 0.66, where the Chronicle starts
 * running the story every morning.
 *
 * This runs **before land value**, so the morning's rents read the night's air,
 * and it is the only place in this layer that moves a lumen.
 */
import { clamp } from '../types.ts';
import type { DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { districtName } from '../actions/common.ts';
import { isOpen, openDistricts } from '../world/growth.ts';
import {
  airLevel, districtEnvironment, environmentState, hostShareOf, waterLevel,
} from './state.ts';
import {
  CLEARANCE_BASE, clearanceOf, driftWeights, riverOrder, upstreamOf, waterClearanceOf, weatherClearance,
  windBearing, windName,
} from './wind.ts';
import { bypassedLoadOf, driftShareOf, emittersToday, hinterlandLoad, loadOf } from './emissions.ts';
import { dailyAbatement } from './abatement.ts';
import { greeneryOf, pruneReadings } from './readings.ts';
import { growGreenery } from './greenery.ts';
import { residentsOf } from './zoning.ts';
import { dailyZoningPetitions } from './petitions.ts';

/** Motes to a whole point of a district's air. */
export const MOTE_DIVISOR = 480;
/** The share of a day's load the river takes of what the stacks did not. */
export const DISCHARGE_SHARE = 0.45;
/** What a district passes downstream of everything that reaches it. */
export const WATER_PASS = 0.80;
/** Air at or above this is a story the Chronicle runs every morning. */
export const CHRONICLE_AIR = 0.60;

// ---------------------------------------------------------------------------
// The air
// ---------------------------------------------------------------------------

/** Yesterday's load, district by district, before anything drifts. */
export function loadsToday(world: World): Map<DistrictId, number> {
  const out = new Map<DistrictId, number>();
  for (const d of openDistricts(world)) out.set(d, loadOf(world, d));
  return out;
}

/** Settle the air over every district, and over the fields the wind takes it to. */
export function settleAir(world: World): void {
  const list = openDistricts(world);
  const load = loadsToday(world);
  const drifted = new Map<DistrictId, number>();
  const driftedIn = new Map<DistrictId, number>();
  let escaped = 0;
  for (const d of list) {
    const out = (load.get(d) ?? 0) * driftShareOf(world, d);
    drifted.set(d, out);
    const weights = driftWeights(world, d);
    if (weights.size === 0) { escaped += out; continue; }
    for (const [n, w] of weights) driftedIn.set(n, (driftedIn.get(n) ?? 0) + out * w);
  }
  for (const d of list) {
    const row = districtEnvironment(world, d);
    const clearance = clearanceOf(world, d, greeneryOf(world, d));
    const added = (load.get(d) ?? 0) - (drifted.get(d) ?? 0) + (driftedIn.get(d) ?? 0);
    row.air = clamp(row.air * (1 - clearance) + added / MOTE_DIVISOR, 0, 1);
  }
  // What blew out of the city, and what the works it moved out are making, land
  // on the fields — which is the whole of the trade `relocate_works` offers.
  const s = environmentState(world);
  const clearance = Math.max(0.01, CLEARANCE_BASE + weatherClearance(world));
  s.hinterlandAir = clamp(s.hinterlandAir * (1 - clearance) + (escaped + hinterlandLoad(world)) / MOTE_DIVISOR, 0, 1);
}

// ---------------------------------------------------------------------------
// The water
// ---------------------------------------------------------------------------

/** What each district puts in the river: 0.45 of its load, and all of a bypass. */
export function dischargeOf(world: World, d: DistrictId): number {
  const bypassed = bypassedLoadOf(world, d);
  return DISCHARGE_SHARE * Math.max(0, loadOf(world, d) - bypassed) + bypassed;
}

/**
 * Settle the river, from the top of the delta to its mouth. Water carries
 * nearly all of what enters it and passes 80 % on again, so the Undercroft
 * receives from everybody. That is why the cheapest land in the city is cheap.
 */
export function settleWater(world: World): void {
  const order = riverOrder(world);
  const carried = new Map<DistrictId, number>();
  for (const d of order) {
    const inflow = upstreamOf(world, d).reduce((sum, u) => sum + (carried.get(u) ?? 0), 0);
    const discharge = dischargeOf(world, d);
    const row = districtEnvironment(world, d);
    const clearance = waterClearanceOf(world);
    row.water = clamp(row.water * (1 - clearance) + (discharge + WATER_PASS * inflow) / MOTE_DIVISOR, 0, 1);
    carried.set(d, discharge + WATER_PASS * inflow);
  }
  const mouth = order[order.length - 1];
  const out = mouth ? WATER_PASS * (carried.get(mouth) ?? 0) : 0;
  const s = environmentState(world);
  const clearance = waterClearanceOf(world);
  s.hinterlandWater = clamp(
    s.hinterlandWater * (1 - clearance) + (out + DISCHARGE_SHARE * hinterlandLoad(world)) / MOTE_DIVISOR, 0, 1);
}

// ---------------------------------------------------------------------------
// The charge, and what a district is paid for hosting the smoke
// ---------------------------------------------------------------------------

/**
 * The emission charge, billed to the owner on the rollover, revenue to the
 * Treasury. The city does not bill itself for the Forge — there is one purse —
 * but it owes the district that breathes it exactly what any other owner
 * would, so the charge is still counted where it was raised and the host
 * payment still reads it.
 */
export function billEmissionCharge(world: World): number {
  const s = environmentState(world);
  s.chargedToday = {};
  const rate = Math.max(0, s.charge);
  if (rate <= 0) return 0;
  let raised = 0;
  for (const row of emittersToday(world)) {
    const due = Math.round(rate * row.motes);
    if (due <= 0) continue;
    if (row.owner === 'city') {
      s.chargedToday[row.district] = (s.chargedToday[row.district] ?? 0) + due;
      continue;
    }
    const biz = world.businesses[row.owner];
    if (!biz || biz.dissolvedDay !== null) continue;
    const memo = `emission charge on ${Math.round(row.motes * 100) / 100} motes at ${world.buildings[row.building]?.name ?? row.building}`;
    if (!transfer(world, biz.id, 'treasury', due, 'fee', memo)) continue;
    s.chargedToday[row.district] = (s.chargedToday[row.district] ?? 0) + due;
    raised += due;
  }
  if (raised > 0) {
    emit(world, 'treasury', `The emission charge raised ${raised} ℓ for the Treasury.`, [], 0.3,
      { raised, rate });
  }
  return raised;
}

/** The profit tax the businesses of a district paid at yesterday's rollover. */
export function profitTaxRaisedIn(world: World, d: DistrictId): number {
  const day = world.day - 1;
  let sum = 0;
  for (const row of world.treasury.ledger) {
    if (row.kind !== 'profit_tax') continue;
    if (Math.floor(row.tick / 24) !== day) continue;
    const biz = world.businesses[row.from];
    if (!biz || biz.district !== d) continue;
    sum += row.amount;
  }
  return sum;
}

/**
 * `host_payment` — a district's residents take their share of the profit tax
 * and the emission charge raised inside it, daily, per resident. At 30 % a
 * Foundry Row resident takes half a Forge Cottage's rent, and the next
 * referendum reads differently.
 */
export function payHostPayments(world: World): void {
  const s = environmentState(world);
  for (const d of openDistricts(world)) {
    const share = hostShareOf(world, d);
    if (share <= 0) continue;
    const pot = Math.floor(share * ((s.chargedToday[d] ?? 0) + profitTaxRaisedIn(world, d)));
    if (pot <= 0) continue;
    const residents = residentsOf(world, d);
    if (residents.length === 0) continue;
    const each = Math.floor(pot / residents.length);
    if (each <= 0) continue;
    let paid = 0;
    for (const id of residents) {
      if (!transfer(world, 'treasury', id, each, 'stipend', `host payment for living in ${districtName(world, d)}`)) continue;
      paid += each;
      remember(world, id, 'money', `${districtName(world, d)} paid you ${each} ℓ for hosting what the city runs in it.`);
    }
    if (paid > 0) {
      emit(world, 'treasury',
        `${districtName(world, d)} paid its residents ${paid} ℓ — ${each} ℓ each — of what was raised inside it.`,
        [], 0.4, { district: d, paid, each, share });
    }
  }
}

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

/** The air, the water and the trees, mirrored where the rest of the engine reads them. */
export function mirrorCounters(world: World): void {
  for (const d of openDistricts(world)) {
    world.counters[`air:${d}`] = Math.round(airLevel(world, d) * 1000) / 1000;
    world.counters[`water:${d}`] = Math.round(waterLevel(world, d) * 1000) / 1000;
    world.counters[`greenery:${d}`] = Math.round(greeneryOf(world, d) * 1000) / 1000;
  }
  world.counters['env:asOfDay'] = world.day;
  world.counters['env:wind'] = Math.round(windBearing(world));
}

/** What the city is told about its own air, and how loudly. */
export function tellTheCity(world: World): void {
  const wind = windName(windBearing(world));
  for (const d of openDistricts(world)) {
    const air = airLevel(world, d);
    if (air < CHRONICLE_AIR) continue;
    const where = districtName(world, d);
    emit(world, 'weather',
      `The air over ${where} stands at ${air.toFixed(2)} this morning, on a ${wind} wind. `
      + 'What is worked in it is what is in it.',
      [], air >= 0.8 ? 0.7 : 0.5, { district: d, air, wind });
    for (const id of residentsOf(world, d)) {
      remember(world, id, 'event', `The air over ${where}, where you live, stands at ${air.toFixed(2)}.`);
    }
  }
}

/**
 * The whole morning, in order: yesterday's air settles, the charge is billed on
 * what made it, the fittings are held or lose their edge, the districts that
 * host the works are paid, the trees grow, and the register is mirrored where
 * land value reads it.
 *
 * Runs at the top of the rollover's money group, before `dailyHousing` takes
 * the rent — the morning's rents read the night's air.
 */
export function dailyEnvironment(world: World): void {
  const s = environmentState(world);
  if (s.settledDay === world.day) return;
  s.settledDay = world.day;

  settleAir(world);
  settleWater(world);
  billEmissionCharge(world);
  dailyAbatement(world);
  payHostPayments(world);
  growGreenery(world);
  tellTheCity(world);
  mirrorCounters(world);
  pruneReadings(world);

  // Yesterday's shifts are counted; today's start at nothing.
  s.today = {};
  dailyZoningPetitions(world);
}

/** Whether the city has settled its air today (for a caller that wants to know). */
export function settledToday(world: World): boolean {
  return environmentState(world).settledDay === world.day;
}

/** One district's air as a share of the city's worst, for the dashboard. */
export function dirtiestDistrict(world: World): DistrictId | null {
  const list = openDistricts(world).filter((d) => isOpen(world, d));
  if (list.length === 0) return null;
  return list.sort((a, b) => airLevel(world, b) - airLevel(world, a) || a.localeCompare(b))[0];
}

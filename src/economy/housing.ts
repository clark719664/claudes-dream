/**
 * Housing: three tiers of city-owned units in the Verdant Quarter. Rent is
 * collected at the start of each day; three days of arrears means eviction.
 * Builders add capacity through housing progress.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, HousingTier, PropertyUnit, World } from '../types.ts';
import { BUILDINGS, blockOf, blocksForTier } from '../data/city.ts';
import { emit, remember } from '../sim/events.ts';
import { householdOf, householdRent, leaveHousehold } from '../society/households.ts';
import { assignTenancy } from '../markets/property.ts';
import { tellNeighbours } from '../social/neighbours.ts';
import { residentIds, transfer } from './treasury.ts';

type PaidTier = 1 | 2 | 3;

export const TIER_NAMES: Record<HousingTier, string> = {
  0: 'the streets', 1: 'Lantern Lofts', 2: 'The Terraces', 3: 'Skyline Villas',
};
/** Progress needed for one new unit of each tier; builders cycle 1 → 2 → 3. */
export const BUILD_COSTS: Record<PaidTier, number> = { 1: 100, 2: 250, 3: 600 };
/** Days of unpaid rent before eviction. */
export const EVICTION_ARREARS = 3;
/** Daily comfort adjustment for living in each tier. */
const DAILY_COMFORT: Record<HousingTier, number> = { 0: 0, 1: 2, 2: 5, 3: 10 };

function fail(message: string): ActionResult { return { ok: false, message }; }

function isPaidTier(tier: number): tier is PaidTier {
  return tier === 1 || tier === 2 || tier === 3;
}

/** Free units per tier. */
export function vacancies(world: World): Record<1 | 2 | 3, number> {
  const h = world.housing;
  return {
    1: Math.max(0, h.capacity[1] - h.occupied[1]),
    2: Math.max(0, h.capacity[2] - h.occupied[2]),
    3: Math.max(0, h.capacity[3] - h.occupied[3]),
  };
}

/**
 * Comfort decays this much faster (or slower) depending on where you sleep.
 * A block has its own character on top of its tier: the Hilltop Villas are
 * kinder than the Skyline (0.6), the Tunnels harsher than the Lofts (1.6).
 */
export function comfortDecayMultiplier(tier: HousingTier, comfortFactor = 1): number {
  const base = tier === 1 ? 1.0 : tier === 2 ? 0.7 : tier === 3 ? 0.4 : 2.0;
  return base * (Number.isFinite(comfortFactor) && comfortFactor > 0 ? comfortFactor : 1);
}

/** The block a citizen sleeps in, when the register knows the address. */
export function comfortFactorOf(c: Citizen): number {
  return blockOf(c.homeBuildingId ?? '')?.comfortFactor ?? 1;
}

/** The unit whose keys this citizen holds, if the register has drawn one up. */
export function unitOf(world: World, cId: CitizenId): PropertyUnit | null {
  for (const u of Object.values(world.property ?? {})) if (u.tenantId === cId) return u;
  return null;
}

/** The cheapest block of a tier the city has actually opened. */
function pickBlock(world: World, tier: 1 | 2 | 3): BuildingId | null {
  const open = world.openDistricts ?? [];
  for (const block of blocksForTier(tier)) {
    const building = world.buildings[block.buildingId] ?? BUILDINGS[block.buildingId];
    if (building && open.includes(building.district)) return block.buildingId;
  }
  return null;
}

/**
 * What this citizen pays for its own room. A room the city still owns is
 * priced by the register; otherwise the tier's rent at the block's rate.
 */
export function rentOf(world: World, c: Citizen): number {
  if (!isPaidTier(c.homeTier)) return 0;
  const unit = unitOf(world, c.id);
  if (unit && unit.ownerId === 'city') return Math.max(0, Math.round(unit.rent));
  const factor = blockOf(c.homeBuildingId ?? '')?.rentFactor ?? 1;
  return Math.max(0, Math.round(world.housing.rent[c.homeTier] * factor));
}

/**
 * Give up the current home (no events). A unit belongs to the household that
 * holds it, not to each of its members: somebody walking out of a shared roof
 * leaves through `leaveHousehold`, which frees the unit only when the last of
 * them has gone. Anyone living alone frees their own.
 */
function vacate(world: World, cId: CitizenId): void {
  const c = world.citizens[cId];
  if (!c || !isPaidTier(c.homeTier)) return;
  if (householdOf(world, cId)) {
    leaveHousehold(world, cId);
  } else {
    world.housing.occupied[c.homeTier] = Math.max(0, world.housing.occupied[c.homeTier] - 1);
    c.homeTier = 0;
    c.rentArrearsDays = 0;
  }
  assignTenancy(world, cId, 0);
  c.homeBuildingId = null;
}

/** Move into a tier (0 = move out). Requires a vacancy; arrears reset on any move. */
export function moveHome(world: World, cId: CitizenId, tier: HousingTier): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (tier === c.homeTier) {
    return fail(tier === 0 ? 'You have no home to leave.' : `You already live at ${TIER_NAMES[tier]}.`);
  }
  if (tier === 0) {
    const from = c.homeTier;
    vacate(world, cId);
    remember(world, cId, 'event', `You moved out of ${TIER_NAMES[from]}.`);
    emit(world, 'housing', `${c.name} moved out of ${TIER_NAMES[from]}.`, [cId], 0.1);
    return { ok: true, message: `You moved out of ${TIER_NAMES[from]}.` };
  }
  if (!isPaidTier(tier)) return fail('There is no such housing tier.');
  if (c.standing === 'exiled') return fail('Exiled citizens cannot rent in Reverie.');
  if (vacancies(world)[tier] <= 0) return fail(`There are no vacancies at ${TIER_NAMES[tier]}.`);

  const from = c.homeTier;
  vacate(world, cId);
  world.housing.occupied[tier] += 1;
  c.homeTier = tier;
  c.rentArrearsDays = 0;
  // An address, so the citizen has neighbours and the map has somewhere to
  // put them: their own deed first, then a landlord's, then the city's.
  const unit = assignTenancy(world, cId, tier);
  c.homeBuildingId = unit?.buildingId ?? pickBlock(world, tier);
  const rent = rentOf(world, c);
  const text = from === 0
    ? `${c.name} moved into ${TIER_NAMES[tier]}.`
    : `${c.name} moved from ${TIER_NAMES[from]} to ${TIER_NAMES[tier]}.`;
  emit(world, 'housing', text, [cId], tier === 3 ? 0.3 : 0.1, { tier });
  remember(world, cId, 'event', `You moved into ${TIER_NAMES[tier]} (rent ${rent} ℓ per day).`);
  return { ok: true, message: `You moved into ${TIER_NAMES[tier]}; rent is ${rent} ℓ per day.` };
}

/** Throw a citizen out of their home. */
export function evict(world: World, cId: CitizenId, reason: string): void {
  const c = world.citizens[cId];
  if (!c || !isPaidTier(c.homeTier)) return;
  const from = c.homeTier;
  // The stairwell hears it before the Chronicle does.
  tellNeighbours(world, cId, `${c.name} was put out of ${TIER_NAMES[from]}: ${reason}.`);
  vacate(world, cId);
  c.needs.comfort = clamp(c.needs.comfort - 10, 0, 100);
  emit(world, 'eviction', `${c.name} was evicted from ${TIER_NAMES[from]}: ${reason}.`, [cId], 0.5, { tier: from, reason });
  remember(world, cId, 'event', `You were evicted from ${TIER_NAMES[from]}: ${reason}.`);
}

/**
 * Builders' output. Units complete in rotation: a tier-1 unit at 100 progress,
 * then a tier-2 unit at 250, then a tier-3 unit at 600, then tier 1 again.
 */
export function addHousingProgress(world: World, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  const h = world.housing;
  h.progress += amount;
  let next = (world.counters.housingNext ?? 0) % 3;
  for (let guard = 0; guard < 1000; guard++) {
    const tier = (next + 1) as PaidTier;
    const cost = BUILD_COSTS[tier];
    if (h.progress < cost) break;
    h.progress -= cost;
    h.capacity[tier] += 1;
    next = (next + 1) % 3;
    emit(world, 'housing', `Builders completed a new unit at ${TIER_NAMES[tier]} (capacity now ${h.capacity[tier]}).`, [], 0.4, { tier });
  }
  h.progress = Math.round(h.progress * 1000) / 1000;
  world.counters.housingNext = next;
}

/**
 * Daily rent collection, arrears, evictions and the comfort of a good home.
 * A citizen who shares a household pays through it — one rent per roof, split
 * among its adults (society/households.householdRent); everyone else pays for
 * their own unit here.
 */
export function dailyHousing(world: World): void {
  householdRent(world);
  const residents = residentIds(world);
  for (const c of Object.values(world.citizens)) {
    if (!isPaidTier(c.homeTier)) continue;
    if (c.householdId && world.households?.[c.householdId]?.members.includes(c.id)) continue;
    // exiles and emigrants have left: their unit is quietly freed
    if (!residents.has(c.id)) { vacate(world, c.id); continue; }
    const tier = c.homeTier;
    // A room in private hands is the landlord's to collect on
    // (markets/property.ts landlordRent); the city never charges twice.
    const unit = unitOf(world, c.id);
    if (unit && unit.ownerId !== 'city') {
      if (unit.ownerId === c.id) c.rentArrearsDays = 0;
      c.needs.comfort = clamp(c.needs.comfort + DAILY_COMFORT[tier], 0, 100);
      continue;
    }
    const rent = rentOf(world, c);
    const paid = rent <= 0 || transfer(world, c.id, 'treasury', rent, 'rent', `rent at ${TIER_NAMES[tier]}`);
    if (paid) {
      if (c.rentArrearsDays > 0) remember(world, c.id, 'money', `You paid ${rent} ℓ rent and cleared your arrears.`);
      c.rentArrearsDays = 0;
      c.needs.comfort = clamp(c.needs.comfort + DAILY_COMFORT[tier], 0, 100);
      continue;
    }
    c.rentArrearsDays += 1;
    if (c.rentArrearsDays >= EVICTION_ARREARS) {
      evict(world, c.id, `${c.rentArrearsDays} days of unpaid rent`);
    } else {
      remember(world, c.id, 'money', `You could not pay ${rent} ℓ rent (${c.rentArrearsDays} of ${EVICTION_ARREARS} days in arrears).`);
    }
  }
}

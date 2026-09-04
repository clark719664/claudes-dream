/**
 * Housing: rooms with **addresses**. Every district of Reverie has a stock of
 * them (`docs/PROPERTY.md` §3), and two citizens on the same tier pay very
 * different rents if one lives above the Gallery of Echoes and the other backs
 * onto the Compute Forge — because rent is the tier's rate against the block's
 * own rate against the **land value** of the district it stands in.
 *
 * Rent is collected at the start of each day and three days of arrears means
 * eviction. Builders add capacity through housing progress.
 *
 * The one roof that never turns anybody away is **the Cells** in the
 * Undercroft: a bunk, no privacy, comfort decay ×1.6, three lumens a day. A
 * bunk is made up when somebody needs one and folded away when they leave, so
 * it is never a vacancy anybody else could have taken, and homelessness in
 * Reverie is a choice about money rather than the only option.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, DistrictId, HousingTier, PropertyUnit, World } from '../types.ts';
import { BUILDINGS, CELLS_BLOCK, blockOf, blocksForTier } from '../data/city.ts';
import { emit, remember } from '../sim/events.ts';
import { householdOf, householdRent, leaveHousehold } from '../society/households.ts';
import { assignTenancy } from '../markets/property.ts';
import { tellNeighbours } from '../social/neighbours.ts';
import { dailyLand, homeRent, landValue } from './land.ts';
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
/** The building the bunks are in. */
export const CELLS_BUILDING: BuildingId = CELLS_BLOCK.buildingId;
/** What a bunk costs a day, whatever the land is doing. */
export const CELLS_RENT = CELLS_BLOCK.flatRent ?? 3;

function fail(message: string): ActionResult { return { ok: false, message }; }

function isPaidTier(tier: number): tier is PaidTier {
  return tier === 1 || tier === 2 || tier === 3;
}

/** Free units per tier. A bunk in the Cells is never a vacancy. */
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
 * kinder than the Skyline (0.6), a bunk in the Cells harsher than any room
 * (1.6).
 */
export function comfortDecayMultiplier(tier: HousingTier, comfortFactor = 1): number {
  const base = tier === 1 ? 1.0 : tier === 2 ? 0.7 : tier === 3 ? 0.4 : 2.0;
  return base * (Number.isFinite(comfortFactor) && comfortFactor > 0 ? comfortFactor : 1);
}

/** The block a citizen sleeps in, when the register knows the address. */
export function comfortFactorOf(c: Citizen): number {
  return blockOf(c.homeBuildingId ?? '')?.comfortFactor ?? 1;
}

/** True when this citizen sleeps on a bunk rather than in a room of their own. */
export function inTheCells(c: Citizen): boolean {
  return c.homeBuildingId === CELLS_BUILDING && c.homeTier > 0;
}

/** The unit whose keys this citizen holds, if the register has drawn one up. */
export function unitOf(world: World, cId: CitizenId): PropertyUnit | null {
  for (const u of Object.values(world.property ?? {})) if (u.tenantId === cId) return u;
  return null;
}

function buildingName(world: World, id: BuildingId | null): string | null {
  if (!id) return null;
  return world.buildings?.[id]?.name ?? BUILDINGS[id]?.name ?? null;
}

/** What to call where somebody lives: the block by name when we know it. */
export function addressName(world: World, c: Citizen): string {
  return buildingName(world, c.homeBuildingId) ?? TIER_NAMES[c.homeTier];
}

/** The district a block stands in. */
function districtOfBlock(world: World, id: BuildingId): DistrictId | null {
  return world.buildings?.[id]?.district ?? BUILDINGS[id]?.district ?? null;
}

/** Is the district this block stands in open to walk into? */
function blockIsOpen(world: World, id: BuildingId): boolean {
  const d = districtOfBlock(world, id);
  const open = world.openDistricts ?? [];
  return !!d && (open.length === 0 || open.includes(d));
}

/** The cheapest block of a tier the city has actually opened. */
function pickBlock(world: World, tier: 1 | 2 | 3): BuildingId | null {
  const blocks = blocksForTier(tier).filter((b) => blockIsOpen(world, b.buildingId));
  if (blocks.length === 0) return null;
  return blocks
    .map((b) => ({ id: b.buildingId, rent: homeRent(world, tier, b.buildingId) }))
    .sort((a, b) => a.rent - b.rent || a.id.localeCompare(b.id, 'en'))[0].id;
}

/** True while the Cells are somewhere a citizen can actually walk to. */
export function cellsOpen(world: World): boolean {
  return blockIsOpen(world, CELLS_BUILDING);
}

/**
 * What this citizen pays for its own room. A room the city still owns is
 * priced by the register; otherwise the tier's rent at this address, against
 * the land value of the district it stands in.
 */
export function rentOf(world: World, c: Citizen): number {
  if (!isPaidTier(c.homeTier)) return 0;
  if (inTheCells(c)) return CELLS_RENT;
  const unit = unitOf(world, c.id);
  if (unit && unit.ownerId === 'city') return Math.max(0, Math.round(unit.rent));
  return homeRent(world, c.homeTier, c.homeBuildingId);
}

// ---------------------------------------------------------------------------
// The Cells: bunks that are made up and folded away
// ---------------------------------------------------------------------------

/**
 * A bunk exists only while somebody is on it, so the ledger gains a room and
 * an occupant together and gives both back together. `reconcileCells` repairs
 * the count every morning, whatever else in the city moved somebody out.
 */
function bunksInUse(world: World): number {
  let n = 0;
  for (const c of Object.values(world.citizens)) if (inTheCells(c)) n++;
  return n;
}

function reconcileCells(world: World): void {
  const wanted = bunksInUse(world);
  const held = Math.max(0, Math.round(world.counters.cellBunks ?? 0));
  if (wanted === held) return;
  world.housing.capacity[1] = Math.max(0, world.housing.capacity[1] + wanted - held);
  world.counters.cellBunks = wanted;
}

function makeBunk(world: World): void {
  world.housing.capacity[1] += 1;
  world.housing.occupied[1] += 1;
  world.counters.cellBunks = Math.max(0, Math.round(world.counters.cellBunks ?? 0)) + 1;
}

function foldBunk(world: World): void {
  world.housing.capacity[1] = Math.max(0, world.housing.capacity[1] - 1);
  world.housing.occupied[1] = Math.max(0, world.housing.occupied[1] - 1);
  world.counters.cellBunks = Math.max(0, Math.round(world.counters.cellBunks ?? 0) - 1);
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
  const bunk = inTheCells(c);
  if (householdOf(world, cId) && !bunk) {
    leaveHousehold(world, cId);
  } else {
    if (bunk) foldBunk(world);
    else world.housing.occupied[c.homeTier] = Math.max(0, world.housing.occupied[c.homeTier] - 1);
    c.homeTier = 0;
    c.rentArrearsDays = 0;
  }
  assignTenancy(world, cId, 0);
  c.homeBuildingId = null;
}

/**
 * Take a bunk in the Cells. Nobody is turned away: the only conditions are
 * that the Undercroft is open and that the citizen is one of the city's.
 */
export function takeBunk(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('Exiled citizens cannot sleep in Reverie.');
  if (!cellsOpen(world)) return fail('The Undercroft is not open.');
  if (inTheCells(c)) return fail('You already have a bunk in the Cells.');
  vacate(world, cId);
  makeBunk(world);
  c.homeTier = 1;
  c.homeBuildingId = CELLS_BUILDING;
  c.rentArrearsDays = 0;
  emit(world, 'housing', `${c.name} took a bunk in the Cells.`, [cId], 0.1, { tier: 1 });
  remember(world, cId, 'event', `You took a bunk in the Cells: no privacy, ${CELLS_RENT} ℓ a day, nobody turned away.`);
  return { ok: true, message: `You have a bunk in the Cells; it costs ${CELLS_RENT} ℓ a day.` };
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

/** Move into a tier (0 = move out). Requires a vacancy; arrears reset on any move. */
export function moveHome(world: World, cId: CitizenId, tier: HousingTier): ActionResult {
  return moveHomeTo(world, cId, tier, null);
}

/**
 * Move into a tier at an address (`PROPERTY.md` §6): a district if the citizen
 * has one in mind, and otherwise the cheapest room of that tier the city has
 * open. A citizen who asks for the lowest tier and finds the city full is
 * offered a bunk in the Cells rather than the street, when the Undercroft is
 * open — that is what "nobody is turned away" means.
 */
export function moveHomeTo(world: World, cId: CitizenId, tier: HousingTier, district: DistrictId | null): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (tier === c.homeTier && !district && !inTheCells(c)) {
    return fail(tier === 0 ? 'You have no home to leave.' : `You already live at ${addressName(world, c)}.`);
  }
  if (tier === 0) {
    if (c.homeTier === 0) return fail('You have no home to leave.');
    const from = addressName(world, c);
    vacate(world, cId);
    remember(world, cId, 'event', `You moved out of ${from}.`);
    emit(world, 'housing', `${c.name} moved out of ${from}.`, [cId], 0.1);
    return { ok: true, message: `You moved out of ${from}.` };
  }
  if (!isPaidTier(tier)) return fail('There is no such housing tier.');
  if (c.standing === 'exiled') return fail('Exiled citizens cannot rent in Reverie.');
  if (vacancies(world)[tier] <= 0) {
    if (tier === 1 && cellsOpen(world)) return takeBunk(world, cId);
    return fail(`There are no vacancies on tier ${tier}.`);
  }

  const from = c.homeTier === 0 ? null : addressName(world, c);
  vacate(world, cId);
  world.housing.occupied[tier] += 1;
  c.homeTier = tier;
  c.rentArrearsDays = 0;
  // An address, so the citizen has neighbours and the map has somewhere to
  // put them: their own deed first, then a landlord's, then the city's.
  const unit = assignTenancy(world, cId, tier, district);
  c.homeBuildingId = unit?.buildingId ?? pickBlock(world, tier);
  const to = addressName(world, c);
  const rent = rentOf(world, c);
  const text = from === null
    ? `${c.name} moved into ${to}.`
    : `${c.name} moved from ${from} to ${to}.`;
  emit(world, 'housing', text, [cId], tier === 3 ? 0.3 : 0.1, { tier });
  remember(world, cId, 'event', `You moved into ${to} (rent ${rent} ℓ per day).`);
  return { ok: true, message: `You moved into ${to}; rent is ${rent} ℓ per day.` };
}

/** Throw a citizen out of their home. */
export function evict(world: World, cId: CitizenId, reason: string): void {
  const c = world.citizens[cId];
  if (!c || !isPaidTier(c.homeTier)) return;
  const from = addressName(world, c);
  // The stairwell hears it before the Chronicle does.
  tellNeighbours(world, cId, `${c.name} was put out of ${from}: ${reason}.`);
  const tier = c.homeTier;
  vacate(world, cId);
  c.needs.comfort = clamp(c.needs.comfort - 10, 0, 100);
  emit(world, 'eviction', `${c.name} was evicted from ${from}: ${reason}.`, [cId], 0.5, { tier, reason });
  remember(world, cId, 'event', `You were evicted from ${from}: ${reason}.`);
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
    emit(world, 'housing', `Builders completed a new home on tier ${tier} (capacity now ${h.capacity[tier]}).`, [], 0.4, { tier });
  }
  h.progress = Math.round(h.progress * 1000) / 1000;
  world.counters.housingNext = next;
}

/**
 * Daily rent collection, arrears, evictions and the comfort of a good home.
 * The city's land is read first, so every rent charged today is the rent of
 * the address rather than of the tier.
 *
 * A citizen who shares a household pays through it — one rent per roof, split
 * among its adults (society/households.householdRent); everyone else pays for
 * their own unit here. Nobody is ever put out of the Cells: a bunk is the
 * floor under the city, and arrears on it are a debt, not an eviction.
 */
export function dailyHousing(world: World): void {
  dailyLand(world);
  reconcileCells(world);
  householdRent(world);
  const residents = residentIds(world);
  for (const c of Object.values(world.citizens)) {
    if (!isPaidTier(c.homeTier)) continue;
    if (c.householdId && world.households?.[c.householdId]?.members.includes(c.id)) continue;
    // exiles and emigrants have left: their unit is quietly freed
    if (!residents.has(c.id)) { vacate(world, c.id); continue; }
    const tier = c.homeTier;
    const bunk = inTheCells(c);
    // A room in private hands is the landlord's to collect on
    // (markets/property.ts landlordRent); the city never charges twice.
    const unit = bunk ? null : unitOf(world, c.id);
    if (unit && unit.ownerId !== 'city') {
      if (unit.ownerId === c.id) c.rentArrearsDays = 0;
      c.needs.comfort = clamp(c.needs.comfort + DAILY_COMFORT[tier], 0, 100);
      continue;
    }
    const rent = rentOf(world, c);
    const where = addressName(world, c);
    const paid = rent <= 0 || transfer(world, c.id, 'treasury', rent, 'rent', `rent at ${where}`);
    if (paid) {
      if (c.rentArrearsDays > 0) remember(world, c.id, 'money', `You paid ${rent} ℓ rent and cleared your arrears.`);
      c.rentArrearsDays = 0;
      c.needs.comfort = clamp(c.needs.comfort + (bunk ? 1 : DAILY_COMFORT[tier]), 0, 100);
      continue;
    }
    c.rentArrearsDays += 1;
    if (bunk) {
      remember(world, c.id, 'money', `You could not pay the ${rent} ℓ for your bunk; nobody is turned out of the Cells.`);
    } else if (c.rentArrearsDays >= EVICTION_ARREARS) {
      evict(world, c.id, `${c.rentArrearsDays} days of unpaid rent`);
    } else {
      remember(world, c.id, 'money', `You could not pay ${rent} ℓ rent (${c.rentArrearsDays} of ${EVICTION_ARREARS} days in arrears).`);
    }
  }
}

/** What a room of this tier costs at the cheapest address the city has open. */
export function cheapestRent(world: World, tier: 1 | 2 | 3): number {
  const block = pickBlock(world, tier);
  return block ? homeRent(world, tier, block) : Math.round((world.housing.rent[tier] ?? 0) * landValue(world, 'commons'));
}

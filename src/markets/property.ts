/**
 * Property — the deeds under the city.
 *
 * Every room the city built and every shopfront on the row is a **unit** with
 * an address, a rent and an owner. At the founding the owner is the city; after
 * that a citizen standing at the Exchange may buy one, live in it rent-free,
 * let it at a rent they name, and pay the Council's property tax on what they
 * collect. They may also put a tenant out, which is legal, and which the block
 * remembers. Nothing here decides anything for anybody: the Exchange keeps a
 * board and a price, and who buys, lets, evicts or stays put is theirs.
 *
 * **Two rules of the board.** A unit somebody lives in is never on sale over
 * their head; a unit nobody lives in and nobody has offered to let is idle
 * stock and trades at the posted price. Owning, letting or living in a unit
 * are three ways to keep it — sitting on it is not.
 *
 * **Money.** Every lumen moves through `treasury.transfer`. A purchase pays the
 * seller (the city, or the citizen whose deed it was); a tenant's rent pays the
 * landlord as `lease` instead of paying the Treasury as `rent`; the landlord
 * then pays `property_tax` on it. Nothing is minted and nothing is burned.
 */
import type {
  ActionResult, Building, BuildingId, Business, Citizen, CitizenId, DistrictId,
  HousingTier, PropertyUnit, World,
} from '../types.ts';
import { BUILDINGS, HOUSING_BLOCKS } from '../data/city.ts';
import type { HousingBlock } from '../data/city.ts';
import { BUSINESS_RENT } from '../data/jobs.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { residentIds, transfer } from '../economy/treasury.ts';
import { EVICTION_ARREARS, evict } from '../economy/housing.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { tellNeighbours } from '../social/neighbours.ts';
import { isOpen } from '../world/growth.ts';
import { propertyTaxRate } from './levers.ts';

/** A unit's price is this many days of its rent. */
export const PRICE_MULTIPLE = 60;
/** What the city pays for a unit sold back to it, as a share of the price. */
export const SELL_SHARE = 0.8;
/** The dearest a landlord may let, as a multiple of the city's own rent for the tier. */
export const LET_RENT_CAP = 4;
/** No unit is ever worth less than this. */
export const MIN_PRICE = 60;
/** The going rent for premises, and so the rent of a shopfront unit. */
export const SHOPFRONT_RENT = BUSINESS_RENT.shop;
/** Reputation a landlord loses for putting a tenant out. */
export const EVICTION_REPUTATION = 4;
/** The Exchange is in Harbor Market; deeds change hands there and nowhere else. */
export const EXCHANGE_DISTRICT: DistrictId = 'harbor_market';
/** The rows of shopfronts: one unit each, whoever trades out of them. */
export const SHOPFRONT_BUILDINGS: readonly BuildingId[] = ['shopfronts_harbor', 'shopfronts_nightglass', 'night_market'];

/** What a citizen sees of a unit, on the board or in their own deeds. */
export interface ObservedUnit {
  id: string;
  kind: PropertyUnit['kind'];
  tier: HousingTier;
  building: string;
  district: DistrictId;
  price: number;
  rent: number;
  owner: string | 'city';
  tenant: string | null;
  yours: boolean;
}

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The register of deeds. A world saved before this layer has none. */
function register(world: World): Record<string, PropertyUnit> {
  const w = world as { property?: Record<string, PropertyUnit> };
  if (!w.property) w.property = {};
  return w.property;
}

/** Every unit, in a stable order (the id counter is monotonic). */
export function allUnits(world: World): PropertyUnit[] {
  return Object.values(register(world)).sort((a, b) => a.id.localeCompare(b.id, 'en'));
}

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

function buildingOf(world: World, id: BuildingId): Building | null {
  return world.buildings?.[id] ?? BUILDINGS[id] ?? null;
}

function districtOf(world: World, u: PropertyUnit): DistrictId {
  return buildingOf(world, u.buildingId)?.district ?? EXCHANGE_DISTRICT;
}

function buildingName(world: World, id: BuildingId): string {
  return buildingOf(world, id)?.name ?? String(id);
}

function ownerName(world: World, u: PropertyUnit): string | 'city' {
  if (u.ownerId === 'city') return 'city';
  return world.citizens[u.ownerId]?.name ?? 'city';
}

function tenantName(world: World, u: PropertyUnit): string | null {
  if (!u.tenantId) return null;
  return world.citizens[u.tenantId]?.name ?? world.businesses[u.tenantId]?.name ?? null;
}

/** True while the owner has offered this unit to let. Kept in counters so it survives a save. */
export function isOfferedToLet(world: World, u: PropertyUnit): boolean {
  return (world.counters[`let:${u.id}`] ?? 0) > 0;
}

function setOfferedToLet(world: World, u: PropertyUnit, offered: boolean): void {
  if (offered) world.counters[`let:${u.id}`] = 1;
  else delete world.counters[`let:${u.id}`];
}

// ---------------------------------------------------------------------------
// Keeping the register in step with the city
// ---------------------------------------------------------------------------

/** The rent the city itself asks for a unit of this block. */
function cityRent(world: World, block: HousingBlock | null): number {
  if (!block) return SHOPFRONT_RENT;
  const base = world.housing?.rent?.[block.tier] ?? 0;
  return Math.max(1, Math.round(base * block.rentFactor));
}

/**
 * How a tier's capacity is spread across its blocks: a block that came with a
 * district takes its own rooms, and whatever the builders added on top belongs
 * to the tier's founding block.
 */
function allocation(world: World, tier: 1 | 2 | 3): { block: HousingBlock; units: number }[] {
  const open = HOUSING_BLOCKS.filter((b) => b.tier === tier && isOpen(world, BUILDINGS[b.buildingId].district));
  if (open.length === 0) return [];
  const base = open.find((b) => b.rentFactor === 1) ?? open[open.length - 1];
  let remaining = Math.max(0, Math.round(world.housing?.capacity?.[tier] ?? 0));
  const out: { block: HousingBlock; units: number }[] = [];
  for (const b of open) {
    if (b === base) continue;
    const n = Math.min(b.units, remaining);
    remaining -= n;
    out.push({ block: b, units: n });
  }
  out.push({ block: base, units: remaining });
  return out;
}

function unitsIn(world: World, buildingId: BuildingId): PropertyUnit[] {
  return allUnits(world).filter((u) => u.buildingId === buildingId);
}

function createUnit(world: World, spec: Omit<PropertyUnit, 'id'>): PropertyUnit {
  const u: PropertyUnit = { id: nextId(world, 'y'), ...spec };
  register(world)[u.id] = u;
  return u;
}

/**
 * Draw up the deeds the city implies: one per room in its housing ledger, one
 * per opened row of shopfronts. Idempotent — it refreshes the rents of what the
 * city still owns, adds what the builders finished, and never touches a deed
 * somebody bought.
 */
export function syncProperty(world: World): void {
  for (const tier of [1, 2, 3] as const) {
    for (const { block, units } of allocation(world, tier)) {
      const existing = unitsIn(world, block.buildingId);
      const rent = cityRent(world, block);
      for (const u of existing) {
        if (u.ownerId === 'city') u.rent = rent;
      }
      for (let i = existing.length; i < units; i++) {
        createUnit(world, {
          kind: 'home', tier, buildingId: block.buildingId, ownerId: 'city', tenantId: null, rent,
        });
      }
      // the ledger shrank (a block was written down): give up empty city rooms first
      let surplus = existing.length - units;
      for (let i = existing.length - 1; i >= 0 && surplus > 0; i--) {
        const u = existing[i];
        if (u.ownerId !== 'city' || u.tenantId !== null) continue;
        delete register(world)[u.id];
        setOfferedToLet(world, u, false);
        surplus--;
      }
    }
  }
  for (const buildingId of SHOPFRONT_BUILDINGS) {
    const building = BUILDINGS[buildingId];
    if (!building || !isOpen(world, building.district)) continue;
    const existing = unitsIn(world, buildingId);
    if (existing.length === 0) {
      createUnit(world, {
        kind: 'shopfront', tier: 0, buildingId, ownerId: 'city', tenantId: null, rent: SHOPFRONT_RENT,
      });
    } else {
      for (const u of existing) if (u.ownerId === 'city') u.rent = SHOPFRONT_RENT;
    }
  }
}

// ---------------------------------------------------------------------------
// Prices and the board
// ---------------------------------------------------------------------------

/** Sixty days of rent, never less than the floor. (`docs/PROPERTY.md` §2's land premium slots in here.) */
export function unitPrice(world: World, u: PropertyUnit): number {
  const rent = Math.max(0, Math.round(u.rent));
  return Math.max(MIN_PRICE, Math.round(PRICE_MULTIPLE * rent));
}

export function unitsFor(world: World, ownerId: CitizenId | 'city'): PropertyUnit[] {
  return allUnits(world).filter((u) => u.ownerId === ownerId);
}

/** The business trading out of a shopfront, longest-standing first. */
export function occupantOf(world: World, u: PropertyUnit): Business | null {
  if (u.kind !== 'shopfront') return null;
  return Object.values(world.businesses)
    .filter((b) => b.dissolvedDay === null && b.buildingId === u.buildingId)
    .sort((a, b) => a.foundedDay - b.foundedDay || a.id.localeCompare(b.id, 'en'))[0] ?? null;
}

/** Somebody is in it: a tenant on the register, or a business trading out of the row. */
function occupied(world: World, u: PropertyUnit): boolean {
  return u.tenantId !== null || occupantOf(world, u) !== null;
}

/** A unit is on the board when the city holds it, or when its owner holds it idle. */
export function onSale(world: World, u: PropertyUnit): boolean {
  if (!isOpen(world, districtOf(world, u))) return false;
  if (u.ownerId === 'city') return true;
  return !occupied(world, u) && !isOfferedToLet(world, u);
}

export function unitsOnSale(world: World): PropertyUnit[] {
  return allUnits(world).filter((u) => onSale(world, u));
}

// ---------------------------------------------------------------------------
// Buying, selling and letting
// ---------------------------------------------------------------------------

/** Everything a citizen must be to deal at the Exchange. */
function atTheExchange(world: World, cId: CitizenId): Citizen | ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  if (c.lifeStage === 'child') return fail('You must be grown to hold a deed.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot deal in property while ${c.standing}.`);
  if (isJailed(world, c)) return fail('You cannot deal in property from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot deal in property while detained.');
  if (c.district !== EXCHANGE_DISTRICT) return fail('Deeds change hands at the Exchange, in Harbor Market.');
  return c;
}

function refused(r: Citizen | ActionResult): r is ActionResult {
  return (r as ActionResult).ok !== undefined;
}

function addDeed(c: Citizen, unitId: string): void {
  c.ownedUnits ??= [];
  if (!c.ownedUnits.includes(unitId)) c.ownedUnits.push(unitId);
}

function dropDeed(c: Citizen | null | undefined, unitId: string): void {
  if (!c || !Array.isArray(c.ownedUnits)) return;
  c.ownedUnits = c.ownedUnits.filter((id) => id !== unitId);
}

function describe(world: World, u: PropertyUnit): string {
  return `${u.kind === 'shopfront' ? 'the shopfront at' : 'a unit at'} ${buildingName(world, u.buildingId)}`;
}

export function buyProperty(world: World, cId: CitizenId, unitId: string): ActionResult {
  const checked = atTheExchange(world, cId);
  if (refused(checked)) return checked;
  const c = checked;
  const u = register(world)[unitId];
  if (!u) return fail('There is no such unit on the Exchange board.');
  if (u.ownerId === cId) return fail('You already hold that deed.');
  if (!onSale(world, u)) return fail(`${describe(world, u)} is not on the board.`);

  const price = unitPrice(world, u);
  if (c.wallet < price) return fail(`${describe(world, u)} costs ${price} ℓ; you have ${c.wallet} ℓ.`);
  const sellerId = u.ownerId;
  const seller = sellerId === 'city' ? null : world.citizens[sellerId] ?? null;
  const payee = seller ? seller.id : 'treasury';
  if (!transfer(world, cId, payee, price, 'property', `purchase of ${describe(world, u)}`)) {
    return fail('The purchase could not be paid for.');
  }

  dropDeed(seller, u.id);
  u.ownerId = cId;
  addDeed(c, u.id);
  setOfferedToLet(world, u, false);
  // a buyer who already lives there becomes an owner-occupier and pays no more rent
  if (u.tenantId === cId) c.homeBuildingId = u.buildingId;

  const from = seller ? seller.name : 'the city';
  emit(world, 'property', `${c.name} bought ${describe(world, u)} from ${from} for ${price} ℓ.`,
    seller ? [cId, seller.id] : [cId], 0.5, { unitId: u.id, price, buyer: cId, seller: sellerId });
  remember(world, cId, 'money', `You bought ${describe(world, u)} for ${price} ℓ; its rent is ${u.rent} ℓ a day.`);
  if (seller) remember(world, seller.id, 'money', `${c.name} bought ${describe(world, u)} from you for ${price} ℓ.`);
  return ok(`You hold the deed to ${describe(world, u)}; you paid ${price} ℓ.`);
}

export function sellProperty(world: World, cId: CitizenId, unitId: string): ActionResult {
  const checked = atTheExchange(world, cId);
  if (refused(checked)) return checked;
  const c = checked;
  const u = register(world)[unitId];
  if (!u) return fail('There is no such unit.');
  if (u.ownerId !== cId) return fail('That deed is not yours to sell.');

  const price = Math.max(1, Math.round(unitPrice(world, u) * SELL_SHARE));
  if (world.treasury.balance < price) return fail(`The Treasury cannot find ${price} ℓ for it today.`);
  if (!transfer(world, 'treasury', cId, price, 'property', `the city bought back ${describe(world, u)}`)) {
    return fail('The city could not settle the sale.');
  }
  dropDeed(c, u.id);
  u.ownerId = 'city';
  setOfferedToLet(world, u, false);
  const tenant = u.tenantId ? world.citizens[u.tenantId] : null;
  emit(world, 'property', `${c.name} sold ${describe(world, u)} back to the city for ${price} ℓ.`,
    [cId], 0.4, { unitId: u.id, price, seller: cId });
  remember(world, cId, 'money', `You sold ${describe(world, u)} back to the city for ${price} ℓ.`);
  if (tenant) remember(world, tenant.id, 'event', `Your landlord sold ${describe(world, u)}; the city is your landlord now.`);
  return ok(`The city bought ${describe(world, u)} back for ${price} ℓ.`);
}

/** The dearest rent a landlord may ask for this unit. */
export function rentCap(world: World, u: PropertyUnit): number {
  const block = HOUSING_BLOCKS.find((b) => b.buildingId === u.buildingId) ?? null;
  return Math.max(1, Math.round(cityRent(world, block) * LET_RENT_CAP));
}

export function letProperty(world: World, cId: CitizenId, unitId: string, rent: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  const u = register(world)[unitId];
  if (!u) return fail('There is no such unit.');
  if (u.ownerId !== cId) return fail('That deed is not yours to let.');
  const wanted = Number.isFinite(rent) ? Math.round(rent) : 0;
  const cap = rentCap(world, u);
  if (wanted < 1) return fail('A let has to name a rent of at least 1 ℓ.');
  if (wanted > cap) return fail(`The Charter caps the rent on ${describe(world, u)} at ${cap} ℓ a day.`);

  const was = u.rent;
  u.rent = wanted;
  setOfferedToLet(world, u, true);
  const tenant = u.tenantId ? world.citizens[u.tenantId] ?? null : null;
  emit(world, 'property', `${c.name} offered ${describe(world, u)} to let at ${wanted} ℓ a day.`,
    [cId], 0.2, { unitId: u.id, rent: wanted, was });
  remember(world, cId, 'money', `You offered ${describe(world, u)} to let at ${wanted} ℓ a day.`);
  if (tenant) remember(world, tenant.id, 'money', `Your landlord set the rent on your home to ${wanted} ℓ a day from tomorrow.`);
  return ok(`${describe(world, u)} is on the board to let at ${wanted} ℓ a day.`);
}

// ---------------------------------------------------------------------------
// Tenancies
// ---------------------------------------------------------------------------

export function tenancyOf(world: World, cId: CitizenId): PropertyUnit | null {
  return allUnits(world).find((u) => u.tenantId === cId) ?? null;
}

function releaseTenancy(world: World, cId: CitizenId): void {
  for (const u of allUnits(world)) if (u.tenantId === cId) u.tenantId = null;
}

/**
 * An address for the tier a citizen has just moved into: their own unit first,
 * then the cheapest a landlord has offered, then a room the city still holds.
 * Called by `economy/housing.ts moveHome`; tier 0 gives the address up.
 */
export function assignTenancy(world: World, cId: CitizenId, tier: HousingTier): PropertyUnit | null {
  const c = world.citizens[cId];
  if (!c) return null;
  releaseTenancy(world, cId);
  if (tier === 0) { c.homeBuildingId = null; return null; }

  const candidates = allUnits(world).filter((u) => (
    u.kind === 'home' && u.tier === tier && u.tenantId === null && isOpen(world, districtOf(world, u))
  ));
  const own = candidates.find((u) => u.ownerId === cId) ?? null;
  const let_ = candidates
    .filter((u) => u.ownerId !== 'city' && u.ownerId !== cId && isOfferedToLet(world, u))
    .sort((a, b) => a.rent - b.rent || a.id.localeCompare(b.id, 'en'))[0] ?? null;
  const city = candidates
    .filter((u) => u.ownerId === 'city')
    .sort((a, b) => a.rent - b.rent || a.id.localeCompare(b.id, 'en'))[0] ?? null;
  const unit = own ?? let_ ?? city;
  if (!unit) { c.homeBuildingId = null; return null; }
  unit.tenantId = cId;
  c.homeBuildingId = unit.buildingId;
  return unit;
}

// ---------------------------------------------------------------------------
// The landlord's day
// ---------------------------------------------------------------------------

/**
 * A shopfront in private hands takes the premises rent that would have gone to
 * the Treasury: the business pays its landlord instead, and pays it once. The
 * rate goes back the moment the deed returns to the city.
 */
function setPremisesRent(world: World, biz: Business, leased: boolean): void {
  const key = `leased:${biz.id}`;
  if (leased) {
    if (biz.rentPerDay !== 0) world.counters[key] = 1;
    biz.rentPerDay = 0;
  } else if ((world.counters[key] ?? 0) > 0) {
    biz.rentPerDay = BUSINESS_RENT[biz.kind] ?? biz.rentPerDay;
    delete world.counters[key];
  }
}

function collectTax(world: World, u: PropertyUnit, rent: number): number {
  const rate = propertyTaxRate(world);
  const due = Math.round(rent * rate);
  if (due <= 0 || u.ownerId === 'city') return 0;
  return transfer(world, u.ownerId, 'treasury', due, 'property_tax', `property tax on ${describe(world, u)}`) ? due : 0;
}

/**
 * Daily, after the city has taken its own rents: every let unit with a citizen
 * owner collects its rent from the tenant, and the owner pays the Council's
 * property tax on it. A tenant who cannot pay falls into arrears exactly as
 * they would with the city, and is put out on the third day. Returns the rent
 * moved.
 */
export function landlordRent(world: World): number {
  let moved = 0;
  const leasedBusinesses = new Set<string>();
  for (const u of allUnits(world)) {
    if (u.ownerId === 'city') continue;
    const owner = world.citizens[u.ownerId];
    if (!owner || !isPresent(world, owner)) continue;

    if (u.kind === 'shopfront') {
      const biz = occupantOf(world, u);
      u.tenantId = biz ? biz.id : null;
      if (!biz) continue;
      leasedBusinesses.add(biz.id);
      setPremisesRent(world, biz, true);
      const rent = Math.max(0, Math.round(u.rent));
      if (rent <= 0) continue;
      if (transfer(world, biz.id, owner.id, rent, 'lease', `rent for ${describe(world, u)}`)) {
        moved += rent;
        collectTax(world, u, rent);
        remember(world, owner.id, 'money', `${biz.name} paid you ${rent} ℓ for ${describe(world, u)}.`);
      } else {
        remember(world, owner.id, 'money', `${biz.name} could not pay the ${rent} ℓ rent for ${describe(world, u)}.`);
      }
      continue;
    }

    const tenantId = u.tenantId;
    if (!tenantId || tenantId === owner.id) continue;
    const tenant = world.citizens[tenantId];
    if (!tenant || !isPresent(world, tenant)) { u.tenantId = null; continue; }
    const rent = Math.max(0, Math.round(u.rent));
    if (rent <= 0) continue;
    if (transfer(world, tenant.id, owner.id, rent, 'lease', `rent at ${buildingName(world, u.buildingId)}`)) {
      moved += rent;
      collectTax(world, u, rent);
      tenant.rentArrearsDays = 0;
      remember(world, tenant.id, 'money', `You paid ${rent} ℓ of rent to ${owner.name}.`);
      remember(world, owner.id, 'money', `${tenant.name} paid you ${rent} ℓ of rent for ${describe(world, u)}.`);
      continue;
    }
    tenant.rentArrearsDays += 1;
    remember(world, tenant.id, 'money',
      `You could not pay ${owner.name} ${rent} ℓ of rent (${tenant.rentArrearsDays} of ${EVICTION_ARREARS} days in arrears).`);
    if (tenant.rentArrearsDays >= EVICTION_ARREARS) {
      u.tenantId = null;
      evict(world, tenant.id, `${tenant.rentArrearsDays} days of rent unpaid to ${owner.name}`);
      tenant.homeBuildingId = null;
    }
  }
  // premises the city holds again pay the city again
  for (const biz of Object.values(world.businesses)) {
    if (biz.dissolvedDay === null && !leasedBusinesses.has(biz.id)) setPremisesRent(world, biz, false);
  }
  return moved;
}

/** Put a tenant out. Legal, and the whole block hears about it. */
export function evictTenant(world: World, ownerId: CitizenId, unitId: string): ActionResult {
  const owner = world.citizens[ownerId];
  if (!owner) return fail('Unknown citizen.');
  const u = register(world)[unitId];
  if (!u) return fail('There is no such unit.');
  if (u.ownerId !== ownerId) return fail('That deed is not yours.');
  if (u.kind === 'shopfront') return fail("A row's tenant is whoever trades there; you cannot put a business off the street.");
  if (!u.tenantId) return fail('Nobody is living there.');
  if (u.tenantId === ownerId) return fail('You cannot evict yourself.');
  const tenant = world.citizens[u.tenantId] ?? null;
  if (!tenant) { u.tenantId = null; return fail('Nobody is living there.'); }

  u.tenantId = null;
  setOfferedToLet(world, u, false);
  adjustReputation(world, owner, -EVICTION_REPUTATION, 'you put a tenant out');
  tellNeighbours(world, tenant.id, `${owner.name} put ${tenant.name} out of ${describe(world, u)}.`);
  evict(world, tenant.id, `${owner.name} ended the tenancy`);
  tenant.homeBuildingId = null;
  remember(world, tenant.id, 'event', `${owner.name} put you out of ${describe(world, u)}.`);
  remember(world, ownerId, 'event', `You put ${tenant.name} out of ${describe(world, u)}.`);
  return ok(`You put ${tenant.name} out of ${describe(world, u)}.`);
}

// ---------------------------------------------------------------------------
// The daily pass and the observation
// ---------------------------------------------------------------------------

/** Deeds held by people the city no longer has go back to the city. */
function sweep(world: World): void {
  const residents = residentIds(world);
  for (const u of allUnits(world)) {
    if (u.ownerId !== 'city' && !residents.has(u.ownerId)) {
      const gone = world.citizens[u.ownerId] ?? null;
      dropDeed(gone, u.id);
      u.ownerId = 'city';
      setOfferedToLet(world, u, false);
      const block = HOUSING_BLOCKS.find((b) => b.buildingId === u.buildingId) ?? null;
      u.rent = u.kind === 'shopfront' ? SHOPFRONT_RENT : cityRent(world, block);
      emit(world, 'property', `${describe(world, u)} came back to the city: its owner has gone.`, [], 0.2, { unitId: u.id });
    }
    if (u.tenantId && !world.citizens[u.tenantId] && !world.businesses[u.tenantId]) u.tenantId = null;
    if (u.tenantId && world.citizens[u.tenantId] && !residents.has(u.tenantId)) u.tenantId = null;
  }
}

export function dailyProperty(world: World): void {
  syncProperty(world);
  landlordRent(world);
  sweep(world);
}

function observe(world: World, u: PropertyUnit, c: Citizen): ObservedUnit {
  return {
    id: u.id,
    kind: u.kind,
    tier: u.tier,
    building: buildingName(world, u.buildingId),
    district: districtOf(world, u),
    price: unitPrice(world, u),
    rent: Math.round(u.rent),
    owner: ownerName(world, u),
    tenant: tenantName(world, u),
    yours: u.ownerId === c.id,
  };
}

/** A citizen's own deeds, and the Exchange's board when they stand in front of it. */
export function propertyObservation(world: World, c: Citizen): { self: ObservedUnit[]; here: ObservedUnit[] } {
  const self = unitsFor(world, c.id).map((u) => observe(world, u, c));
  const here = c.district === EXCHANGE_DISTRICT
    ? unitsOnSale(world).slice(0, 12).map((u) => observe(world, u, c))
    : [];
  return { self, here };
}

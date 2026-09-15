/**
 * Zoning — the most valuable power the Council has (`docs/ENVIRONMENT.md` §4).
 *
 * A permit says what may be built, extended or newly operated in a district,
 * and the premium it carries enters the amenity term **the morning the vote
 * passes**, before a building moves, because what a district may become is what
 * a buyer pays for. A swing from `heavy_industry` to `residential` is 0.32 of
 * amenity — the largest number any Council motion moves, and it moves it into
 * named pockets. That is why §5 exists, and why `interests.ts` reads the
 * property register against the roll of votes every time one passes.
 *
 * **Zoning never demolishes.** A building outside its district's new permit
 * becomes nonconforming: it may operate, be repaired and keep its posts, but it
 * may not be extended, raise its post count, or be rebuilt if destroyed. The
 * city may buy it out at sixty days of what it makes, out of public works —
 * expensive, and the only clean way anyone has actually moved a forge.
 */
import type { BuildingId, BuildingKind, BusinessKind, DistrictId, World } from '../types.ts';
import { BUILDINGS } from '../data/city.ts';
import { CITY_SHIFTS_PER_DAY } from '../data/jobs.ts';
import { emit, remember } from '../sim/events.ts';
import { marketPrice } from '../economy/market.ts';
import { closeJob } from '../economy/jobs.ts';
import { districtName } from '../actions/common.ts';
import { isOpen } from '../world/growth.ts';
import { PERMITS, PERMIT_PREMIUM, districtEnvironment, environmentState, isBoughtOut, isRelocated, permitOf } from './state.ts';
import type { Permit } from './state.ts';

/** A trade works out of premises; a workshop bench is not a building kind. */
export type PremisesKind = BuildingKind | 'workshop';

/** What each permit admits (`ENVIRONMENT.md` §4). `open` admits everything. */
export const PERMIT_ADMITS: Record<Permit, readonly PremisesKind[]> = {
  conserved: [],
  residential: ['housing', 'garden', 'clinic', 'venue'],
  civic: ['civic', 'court', 'watch', 'treasury', 'plaza', 'library', 'academy', 'records', 'university'],
  commercial: ['bazaar', 'exchange', 'bank', 'shopfront', 'tavern', 'theatre', 'gallery'],
  open: [],
  light_industry: ['fabrication', 'builders', 'workshop', 'shopfront'],
  heavy_industry: ['forge', 'power', 'fabrication', 'builders'],
};

/** The premises each trade takes, for the table above. */
export const BUSINESS_PREMISES: Record<BusinessKind, PremisesKind> = {
  shop: 'shopfront', cafe: 'tavern', clinic: 'clinic', studio: 'gallery', workshop: 'workshop', courier: 'workshop',
};

/** What a district's permit is worth to its amenity, on the 0..1 scale. */
export function permitPremium(world: World, d: DistrictId): number {
  return PERMIT_PREMIUM[permitOf(world, d)];
}

/** Whether a permit admits a kind of premises at all. */
export function admits(permit: Permit, kind: PremisesKind): boolean {
  if (permit === 'open') return true;
  if (permit === 'conserved') return false;
  return PERMIT_ADMITS[permit].includes(kind);
}

/**
 * Whether something new may be operated here, and why not. Founding a business
 * or renting premises in breach is **refused at the Exchange** — a refusal, not
 * an offence (`ENVIRONMENT.md` §4).
 */
export function mayOperate(world: World, kind: PremisesKind, d: DistrictId): string | null {
  const permit = permitOf(world, d);
  if (admits(permit, kind)) return null;
  const where = districtName(world, d);
  if (permit === 'conserved') return `${where} is conserved: nothing new may be built or opened in it.`;
  return `${where} is zoned ${permit.replace(/_/g, ' ')}, which does not admit ${String(kind).replace(/_/g, ' ')} premises.`;
}

/** The same question for a trade about to take premises. */
export function mayTrade(world: World, kind: BusinessKind, d: DistrictId): string | null {
  return mayOperate(world, BUSINESS_PREMISES[kind] ?? 'workshop', d);
}

// ---------------------------------------------------------------------------
// Nonconforming
// ---------------------------------------------------------------------------

/** A building standing outside what its district now admits. */
export function isNonconforming(world: World, buildingId: BuildingId): boolean {
  const b = world.buildings[buildingId] ?? BUILDINGS[buildingId];
  if (!b) return false;
  return !admits(permitOf(world, b.district), b.kind);
}

/** Every one of them, for the Chronicle and the dashboard. */
export function nonconformingBuildings(world: World, d?: DistrictId): BuildingId[] {
  const all = Object.values(world.buildings ?? BUILDINGS);
  return all
    .filter((b) => (d === undefined || b.district === d) && isOpen(world, b.district) && isNonconforming(world, b.id))
    .map((b) => b.id)
    .sort();
}

/**
 * A nonconforming building may operate, be repaired and keep the posts it has.
 * It may not be extended, take another post, or be rebuilt if it is destroyed.
 */
export function mayExtend(world: World, buildingId: BuildingId): string | null {
  if (!isNonconforming(world, buildingId)) return null;
  const b = world.buildings[buildingId] ?? BUILDINGS[buildingId];
  return `${b?.name ?? buildingId} is nonconforming in ${districtName(world, b?.district ?? 'commons')}: it may operate and be repaired, but not extended.`;
}

/** What sixty days of a building's output fetches at today's Bazaar prices. */
export function buyOutCost(world: World, buildingId: BuildingId): number {
  const jobs = Object.values(world.jobs).filter((j) => j.buildingId === buildingId);
  let perDay = 0;
  for (const j of jobs) {
    const good = j.output?.good;
    const qty = j.output?.qty ?? 0;
    if (!good || qty <= 0) continue;
    perDay += qty * marketPrice(world, good) * CITY_SHIFTS_PER_DAY;
  }
  return Math.max(1, Math.round(60 * perDay));
}

/**
 * The city buys out a nonconforming building at sixty times the daily Bazaar
 * value of its output, from public works. Its posts close, and it emits
 * nothing ever again — expensive, and the only clean way anyone has actually
 * moved a forge.
 */
export function buyOutBuilding(world: World, buildingId: BuildingId): { ok: boolean; message: string; cost: number } {
  const b = world.buildings[buildingId] ?? BUILDINGS[buildingId];
  if (!b) return { ok: false, message: 'There is no such building.', cost: 0 };
  if (isBoughtOut(world, buildingId)) return { ok: false, message: `${b.name} has already been bought out.`, cost: 0 };
  if (!isNonconforming(world, buildingId)) {
    return { ok: false, message: `${b.name} conforms to ${districtName(world, b.district)}'s permit; there is nothing to buy out.`, cost: 0 };
  }
  const cost = buyOutCost(world, buildingId);
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  if (fund < cost) {
    return { ok: false, message: `Buying out ${b.name} costs ${cost} ℓ and the public works fund holds ${fund} ℓ.`, cost };
  }
  world.government.publicWorksFund = fund - cost;
  environmentState(world).boughtOut.push(buildingId);
  for (const j of Object.values(world.jobs)) {
    if (j.buildingId === buildingId) closeJob(world, j.id, `the city bought out ${b.name}`);
  }
  emit(world, 'property', `The city bought out ${b.name} for ${cost} ℓ; its posts are closed and it emits nothing more.`,
    [], 0.8, { buildingId, cost, boughtOut: true });
  return { ok: true, message: `${b.name} is bought out for ${cost} ℓ.`, cost };
}

// ---------------------------------------------------------------------------
// Moving out
// ---------------------------------------------------------------------------

/** What moving a producing building to a hinterland site costs the public works. */
export const RELOCATION_COST = 1200;
/** What every unit hauled back in costs off the piece rate. */
export const HAULAGE_FEE = 1;

/**
 * `relocate_works`: the city puts a producing building on a hinterland site.
 * Health and land value recover, the hinterland yield loss gets *worse*, and
 * every shift costs the worker a tick of travel each way and every unit a
 * lumen of haulage off the piece rate. It is a trade, and the workers pay for
 * it.
 */
export function relocateWorks(world: World, buildingId: BuildingId): { ok: boolean; message: string } {
  const b = world.buildings[buildingId] ?? BUILDINGS[buildingId];
  if (!b) return { ok: false, message: 'There is no such building.' };
  if (isRelocated(world, buildingId)) return { ok: false, message: `${b.name} already stands outside the city.` };
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  if (fund < RELOCATION_COST) {
    return { ok: false, message: `Moving ${b.name} costs ${RELOCATION_COST} ℓ and the public works fund holds ${fund} ℓ.` };
  }
  world.government.publicWorksFund = fund - RELOCATION_COST;
  environmentState(world).relocated.push(buildingId);
  emit(world, 'property',
    `${b.name} has been moved to a hinterland site for ${RELOCATION_COST} ℓ: ${districtName(world, b.district)} keeps the wages and loses the smoke, and the fields take it instead.`,
    [], 0.8, { buildingId, cost: RELOCATION_COST, relocated: true });
  for (const j of Object.values(world.jobs)) {
    if (j.buildingId !== buildingId || !j.holderId) continue;
    remember(world, j.holderId, 'work',
      `${b.name} has moved out of the city: your shift now costs an hour's travel each way and ${HAULAGE_FEE} ℓ a unit in haulage.`);
  }
  return { ok: true, message: `${b.name} now stands on a hinterland site.` };
}

/** What a shift at a relocated works loses to haulage, per unit made. */
export function haulageFee(world: World, buildingId: BuildingId): number {
  return isRelocated(world, buildingId) ? HAULAGE_FEE : 0;
}

// ---------------------------------------------------------------------------
// Setting a permit
// ---------------------------------------------------------------------------

/** Everyone who sleeps in a district, whoever they are. */
export function residentsOf(world: World, d: DistrictId): string[] {
  const out: string[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled') continue;
    const home = c.homeBuildingId ? world.buildings[c.homeBuildingId]?.district ?? null : null;
    if ((home ?? c.district) === d) out.push(c.id);
  }
  return out;
}

/**
 * The permit changes, and the city is told. The premium moves with it: the
 * morning's land value reads the new permit, not the old one.
 */
export function setPermit(world: World, d: DistrictId, permit: Permit, why: string): void {
  const row = districtEnvironment(world, d);
  const was = row.permit;
  if (was === permit) return;
  row.permit = permit;
  if (permit === 'conserved') row.conservedDay = world.day;
  else if (was === 'conserved') row.conservedDay = null;
  const where = districtName(world, d);
  const swing = PERMIT_PREMIUM[permit] - PERMIT_PREMIUM[was];
  emit(world, 'property',
    `${where} is zoned ${permit.replace(/_/g, ' ')} (it was ${was.replace(/_/g, ' ')}): ${why}. `
    + `${swing >= 0 ? 'It is worth' : 'It costs'} ${Math.abs(swing).toFixed(2)} of amenity from this morning.`,
    [], 0.9, { district: d, permit, was, swing });
  for (const id of residentsOf(world, d)) {
    remember(world, id, 'civic', `${where}, where you live, is now zoned ${permit.replace(/_/g, ' ')} (it was ${was.replace(/_/g, ' ')}).`);
  }
  const outside = nonconformingBuildings(world, d);
  if (outside.length > 0) {
    const names = outside.map((id) => world.buildings[id]?.name ?? id).join(', ');
    emit(world, 'property',
      `${names} ${outside.length > 1 ? 'stand' : 'stands'} nonconforming in ${where}: ${outside.length > 1 ? 'they' : 'it'} may operate and be repaired, but not extended or rebuilt.`,
      [], 0.5, { district: d, nonconforming: outside });
  }
}

/** True while a district is conserved, which four of five votes are needed to undo. */
export function isConserved(world: World, d: DistrictId): boolean {
  return permitOf(world, d) === 'conserved';
}

/** A permit named in a proposal, or null where it names nothing the city knows. */
export function readPermit(value: unknown): Permit | null {
  return PERMITS.includes(value as Permit) ? value as Permit : null;
}

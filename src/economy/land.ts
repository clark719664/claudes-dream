/**
 * Land value — what an address is worth, and why (`docs/PROPERTY.md` §1).
 *
 * A home in Reverie is not a tier, it is an address. Every district carries a
 * **land value**, recomputed each morning out of five readings the citizens
 * themselves move:
 *
 * ```
 * raw =  0.30 amenity     what stands here and what it does
 *     +  0.25 safety      1 − offences per resident over the last fortnight
 *     +  0.20 prestige    works exhibited here, monuments, a winning team,
 *                         the repute of the people who live here
 *     +  0.15 access      hops to the Commons and the Grand Bazaar
 *     +  0.10 condition   damage inverted, public works spent here
 *
 * value = raw / cityAverage(raw) × (0.85 + 0.5 × occupancy)
 * ```
 *
 * Nothing in this file asserts that a district is posh or rough. Foundry Row
 * is cheap because the forge and the power station are in it and their
 * neighbours can smell them; Nightglass is dear only for as long as its
 * galleries are full. Both loops of `PROPERTY.md` §5 — the artists priced out
 * of the garrets they made fashionable, and the district that empties until
 * nobody sees the thefts — are this one formula run forwards and backwards.
 *
 * The reading is **cached for the day** it was computed on: land value is a
 * morning fact, so every part of the engine that asks on the same day gets the
 * same number. `recomputeLand` forces a fresh one.
 */
import { DISTRICT_IDS, clamp } from '../types.ts';
import type {
  Building, BuildingKind, BusinessKind, Citizen, DistrictId, PropertyUnit, World,
} from '../types.ts';
import { BUILDINGS, DISTRICTS, blockOf } from '../data/city.ts';
import { emit } from '../sim/events.ts';
import { isOpen, openDistricts, pathDistance } from '../world/growth.ts';

// ---------------------------------------------------------------------------
// The weights
// ---------------------------------------------------------------------------

/** `PROPERTY.md` §1, exactly: the five readings and what each is worth. */
export const LAND_WEIGHTS = {
  amenity: 0.30, safety: 0.25, prestige: 0.20, access: 0.15, condition: 0.10,
} as const;

/** Land value is clamped to this band however the readings fall. */
export const LAND_MIN = 0.25;
export const LAND_MAX = 3.0;

/** Offences in the last this many days count against a district's safety. */
export const SAFETY_WINDOW_DAYS = 14;

/**
 * What each kind of building does to the land around it. The Bazaar, the
 * Library, the Academy, the Ward, the Theatre, the Gallery and the Garden
 * lift; the Compute Forge, the Power Station, the Builders' Yard, the cells
 * and the Exile Gate drag. Housing is worth nothing to itself.
 */
export const AMENITY: Record<BuildingKind, number> = {
  bazaar: 2.0, library: 1.5, academy: 1.5, university: 1.5, clinic: 1.5, hospital: 1.5,
  theatre: 1.5, gallery: 1.5, garden: 1.5, plaza: 1.0, museum: 1.0, venue: 0.8, tavern: 0.8,
  exchange: 0.8, press: 0.6, observatory: 0.6, stadium: 0.5, bank: 0.5, civic: 0.5,
  records: 0.5, arrivals: 0.4, embassy: 0.4, docks: 0.3, shopfront: 0.3,
  housing: 0, court: 0, treasury: 0,
  fabrication: -0.8, builders: -0.8, power: -1.0, forge: -1.2, watch: -1.0, gate: -1.5,
};

/** A tram stop is an amenity the Council can vote for. */
export const TRAM_AMENITY = 0.5;
/** Each statue standing in a district, up to MONUMENT_AMENITY_CAP of them. */
export const MONUMENT_AMENITY = 0.5;
export const MONUMENT_AMENITY_CAP = 4;

/**
 * What the shifts of a heavy building actually emit, when the city has begun
 * to count it (`ENVIRONMENT.md` §1–4, `PROPERTY.md` §1). Nothing writes
 * `air:<district>` yet; the moment something does, a scrubbed forge will cost
 * its neighbours less than a hard-run one and an idle one nothing at all.
 */
export const AIR_PENALTY = 0.45;

/** How many people a building draws past its door, relative to the others. */
export const DRAW: Record<BuildingKind, number> = {
  bazaar: 10, plaza: 8, theatre: 6, tavern: 5, venue: 5, arrivals: 4, gallery: 4, academy: 4,
  stadium: 4, library: 3, museum: 3, exchange: 3, clinic: 3, hospital: 3, garden: 3,
  shopfront: 3, university: 3, bank: 2, civic: 2, court: 2, docks: 2, embassy: 2,
  press: 1, observatory: 1, records: 1, treasury: 1, watch: 1, gate: 1,
  forge: 1, power: 1, fabrication: 1, builders: 1, housing: 0,
};

/**
 * How much each trade lives on passing traffic (`PROPERTY.md` §4). A shop or a
 * café lives on footfall; a workshop or a courier yard barely notices it and
 * should take the cheap land; a studio wants prestige instead.
 */
export const FOOTFALL_WEIGHT: Record<BusinessKind, number> = {
  shop: 1.0, cafe: 1.0, clinic: 0.6, studio: 0.25, workshop: 0.2, courier: 0.15,
};

/** And how much each trade lives on the standing of its address. */
export const PRESTIGE_WEIGHT: Record<BusinessKind, number> = {
  studio: 0.8, cafe: 0.25, shop: 0.15, clinic: 0.1, workshop: 0.05, courier: 0,
};

/**
 * Reverie's own class multiplier (`MOBILITY.md` §4): rent ×1.0, price ×1.0.
 * Vantage would charge 2.5 and 3.0 of these, the Verge 0.25 and 0.2. Every
 * price in this file goes through them, so a second city needs its numbers
 * here and nothing else.
 */
export const CITY_RENT_CLASS = 1.0;
export const CITY_PRICE_CLASS = 1.0;

/** Footfall, and the trade it brings, are both held to a band. */
export const FOOTFALL_MIN = 0.4;
export const FOOTFALL_MAX = 3.0;
export const CUSTOM_MIN = 0.3;
export const CUSTOM_MAX = 3.0;

/** A move of this much in a day is worth a line in the Chronicle. */
export const LAND_NEWS = 0.10;

// ---------------------------------------------------------------------------
// The reading
// ---------------------------------------------------------------------------

/** One district's morning, itemised. Every field is public. */
export interface LandReading {
  district: DistrictId;
  amenity: number;
  safety: number;
  prestige: number;
  access: number;
  condition: number;
  /** The weighted sum, before the city's average is divided out. */
  raw: number;
  /** raw / cityAverage(raw): 1.0 is always "average for this city". */
  normalised: number;
  /** 0.85 + 0.5 × occupancy. */
  scarcity: number;
  /** normalised × scarcity, clamped to the band. */
  value: number;
  /** People past the door in a day, as the city counts them. */
  visits: number;
  /** 0.6 + 0.8 × visits / the city's average. */
  footfall: number;
  /** Rooms in the district, and how many are lived in. */
  units: number;
  occupied: number;
  residents: number;
  offences: number;
}

export type LandReadings = Record<DistrictId, LandReading>;

interface Cached { day: number; readings: LandReadings }

/** The day's reading, kept beside the world rather than in it. */
const CACHE = new WeakMap<World, Cached>();

function districtsOf(world: World): DistrictId[] {
  const open = openDistricts(world);
  return open.length > 0 ? open : [...DISTRICT_IDS];
}

function buildingsOf(world: World, d: DistrictId): Building[] {
  const all = world.buildings && Object.keys(world.buildings).length > 0 ? world.buildings : BUILDINGS;
  return Object.values(all).filter((b) => b.district === d);
}

function districtOfBuilding(world: World, id: string | null | undefined): DistrictId | null {
  if (!id) return null;
  return world.buildings?.[id]?.district ?? BUILDINGS[id]?.district ?? null;
}

/** Where a citizen's roof is, when the register knows the address. */
function homeDistrict(world: World, c: Citizen): DistrictId | null {
  return districtOfBuilding(world, c.homeBuildingId);
}

/** Everyone the city still counts, exiles aside. */
function residents(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled') out.push(c);
  }
  return out;
}

// --- the five readings ------------------------------------------------------

/** What stands here and what it does, squashed to 0..1. */
function amenityOf(world: World, d: DistrictId): number {
  let score = 0;
  for (const b of buildingsOf(world, d)) score += AMENITY[b.kind] ?? 0;
  const trams = (world.trams ?? []).filter(([a, b]) => a === d || b === d).length;
  if (trams > 0) score += TRAM_AMENITY;
  const plaza = districtOfBuilding(world, 'central_plaza');
  if (plaza === d) {
    score += Math.min(MONUMENT_AMENITY_CAP, (world.monuments ?? []).length) * MONUMENT_AMENITY;
  }
  // What the heavy shifts emit, once anything in the world counts it.
  score -= AIR_PENALTY * clamp(world.counters[`air:${d}`] ?? 0, 0, 4);
  return clamp((score + 4) / 10, 0, 1);
}

/** Offences committed by the people of a district in the last fortnight. */
function offencesOf(world: World, people: Citizen[]): number {
  const from = (world.day - SAFETY_WINDOW_DAYS + 1) * 24;
  let n = 0;
  for (const c of people) {
    for (const o of c.recentOffences ?? []) if (o.tick >= from) n++;
  }
  return n;
}

/** The repute the register holds, or a fair reading of an unrated citizen. */
function reputeOf(world: World, c: Citizen): number {
  const held = world.standing?.repute?.[c.id];
  if (typeof held === 'number' && Number.isFinite(held)) return held;
  return clamp(300 + 2 * clamp(c.reputation, 0, 100), 0, 1000);
}

/** Art exhibited here, statues, a winning team, and the repute of the neighbours. */
function prestigeOf(world: World, d: DistrictId, people: Citizen[], cityRepute: number): number {
  let works = 0;
  for (const w of Object.values(world.works ?? {})) {
    const home = districtOfBuilding(world, w.inMuseum ? 'museum' : w.home);
    if (home === d) works += clamp(w.quality, 0, 100) / 100;
  }
  const plaza = districtOfBuilding(world, 'central_plaza');
  const monuments = plaza === d ? (world.monuments ?? []).length : 0;
  const team = world.teams?.[d] ?? null;
  const played = team ? team.wins + team.losses + team.draws : 0;
  const form = team && played > 0 ? (team.wins + team.draws * 0.5) / played : 0.5;
  const repute = people.length > 0
    ? people.reduce((sum, c) => sum + reputeOf(world, c), 0) / people.length
    : cityRepute;
  return clamp(
    0.50 * (repute / 1000)
    + 0.20 * Math.min(1, works / 4)
    + 0.15 * Math.min(1, monuments / 2)
    + 0.15 * form,
    0, 1,
  );
}

/** How far the Commons and the Grand Bazaar are, on foot or by tram. */
function accessOf(world: World, d: DistrictId): number {
  const bazaar = districtOfBuilding(world, 'grand_bazaar') ?? 'harbor_market';
  const toCommons = pathDistance(world, d, 'commons');
  const toBazaar = pathDistance(world, d, bazaar);
  return 0.5 * (1 / (1 + toCommons)) + 0.5 * (1 / (1 + toBazaar));
}

/** Damage inverted, and the public works that were spent here. */
function conditionOf(world: World, d: DistrictId): number {
  const buildings = buildingsOf(world, d);
  const damage = buildings.length > 0
    ? buildings.reduce((sum, b) => sum + clamp(b.damage, 0, 1), 0) / buildings.length
    : 0;
  const trams = (world.trams ?? []).filter(([a, b]) => a === d || b === d).length;
  const plaza = districtOfBuilding(world, 'central_plaza');
  const monuments = plaza === d ? (world.monuments ?? []).length : 0;
  const works = Math.min(1, trams * 0.5 + monuments * 0.25);
  return clamp(0.75 * (1 - damage) + 0.25 * works, 0, 1);
}

/** Rooms and shopfronts on the register, and how many of them are lived in. */
function stockOf(world: World, d: DistrictId): { units: number; occupied: number } {
  let units = 0;
  let occupied = 0;
  for (const u of Object.values(world.property ?? {}) as PropertyUnit[]) {
    if (districtOfBuilding(world, u.buildingId) !== d) continue;
    units++;
    if (u.tenantId !== null) occupied++;
  }
  return { units, occupied };
}

/**
 * How many people come past a district's doors in a day: the people who sleep
 * there, the people who work there, the people standing in it this morning,
 * its shopfronts, and the pull of what stands in it.
 */
function visitsOf(world: World, d: DistrictId, standing: number, living: number, population: number): number {
  let draw = 0;
  for (const b of buildingsOf(world, d)) draw += DRAW[b.kind] ?? 0;
  const working = Object.values(world.jobs).filter((j) => j.district === d && j.holderId !== null).length;
  const trading = Object.values(world.businesses)
    .filter((b) => b.dissolvedDay === null && b.district === d).length;
  return living + working + standing + trading * 2 + draw * population * 0.02;
}

// ---------------------------------------------------------------------------
// The morning's arithmetic
// ---------------------------------------------------------------------------

/**
 * Read every district afresh. Pure: the same world gives the same numbers,
 * whoever asks and however often.
 */
export function recomputeLand(world: World): LandReadings {
  const list = districtsOf(world);
  const everyone = residents(world);
  const population = Math.max(1, everyone.length);
  const cityRepute = everyone.length > 0
    ? everyone.reduce((sum, c) => sum + reputeOf(world, c), 0) / everyone.length
    : 580;

  const here = new Map<DistrictId, Citizen[]>();
  const home = new Map<DistrictId, Citizen[]>();
  for (const d of list) { here.set(d, []); home.set(d, []); }
  for (const c of everyone) {
    here.get(c.district)?.push(c);
    const h = homeDistrict(world, c) ?? c.district;
    home.get(h)?.push(c);
  }

  const parts = new Map<DistrictId, LandReading>();
  for (const d of list) {
    const people = home.get(d) ?? [];
    const offences = offencesOf(world, people);
    const amenity = amenityOf(world, d);
    const safety = clamp(1 - offences / Math.max(4, people.length), 0, 1);
    const prestige = prestigeOf(world, d, people, cityRepute);
    const access = accessOf(world, d);
    const condition = conditionOf(world, d);
    const raw = LAND_WEIGHTS.amenity * amenity
      + LAND_WEIGHTS.safety * safety
      + LAND_WEIGHTS.prestige * prestige
      + LAND_WEIGHTS.access * access
      + LAND_WEIGHTS.condition * condition;
    const stock = stockOf(world, d);
    const visits = visitsOf(world, d, (here.get(d) ?? []).length, people.length, population);
    parts.set(d, {
      district: d, amenity, safety, prestige, access, condition, raw,
      normalised: 1, scarcity: 1, value: 1, visits, footfall: 1,
      units: stock.units, occupied: stock.occupied,
      residents: people.length, offences,
    });
  }

  const rows = [...parts.values()];
  const meanRaw = rows.reduce((sum, r) => sum + r.raw, 0) / Math.max(1, rows.length);
  const meanVisits = rows.reduce((sum, r) => sum + r.visits, 0) / Math.max(1, rows.length);
  const totalUnits = rows.reduce((sum, r) => sum + r.units, 0);
  const totalOccupied = rows.reduce((sum, r) => sum + r.occupied, 0);
  const cityOccupancy = totalUnits > 0 ? totalOccupied / totalUnits : 0;

  const readings = {} as LandReadings;
  for (const r of rows) {
    const occupancy = r.units > 0 ? r.occupied / r.units : cityOccupancy;
    r.normalised = meanRaw > 0 ? r.raw / meanRaw : 1;
    r.scarcity = 0.85 + 0.5 * clamp(occupancy, 0, 1);
    r.value = clamp(r.normalised * r.scarcity, LAND_MIN, LAND_MAX);
    r.footfall = clamp(meanVisits > 0 ? 0.6 + 0.8 * (r.visits / meanVisits) : 1, FOOTFALL_MIN, FOOTFALL_MAX);
    readings[r.district] = r;
  }
  // Districts the city has not opened still need a number for anyone who asks.
  for (const d of DISTRICT_IDS) {
    if (readings[d]) continue;
    readings[d] = {
      district: d, amenity: 0, safety: 1, prestige: 0, access: 0, condition: 1, raw: 0,
      normalised: 1, scarcity: 0.85, value: LAND_MIN, visits: 0, footfall: 0.6,
      units: 0, occupied: 0, residents: 0, offences: 0,
    };
  }

  CACHE.set(world, { day: world.day, readings });
  for (const d of DISTRICT_IDS) {
    world.counters[`land:${d}`] = Math.round(readings[d].value * 1000) / 1000;
  }
  return readings;
}

/** The day's readings, computed once and shared by everyone who asks. */
export function landReadings(world: World): LandReadings {
  const held = CACHE.get(world);
  if (held && held.day === world.day) return held.readings;
  return recomputeLand(world);
}

export function landReading(world: World, d: DistrictId): LandReading {
  return landReadings(world)[d] ?? recomputeLand(world)[d];
}

/** What an address in this district is worth, with 1.0 the city's own average. */
export function landValue(world: World, d: DistrictId): number {
  return landReading(world, d).value;
}

/** People past the door, against the city's average (`PROPERTY.md` §4). */
export function footfall(world: World, d: DistrictId): number {
  return landReading(world, d).footfall;
}

/** Prestige against the city's average, which is what a studio is buying. */
export function prestigeIndex(world: World, d: DistrictId): number {
  const rows = Object.values(landReadings(world)).filter((r) => isOpen(world, r.district));
  const mean = rows.length > 0 ? rows.reduce((sum, r) => sum + r.prestige, 0) / rows.length : 0;
  if (mean <= 0) return 1;
  return landReading(world, d).prestige / mean;
}

/** The footfall term as a given trade feels it. */
export function footfallFor(world: World, kind: BusinessKind, d: DistrictId): number {
  const weight = FOOTFALL_WEIGHT[kind] ?? 0.5;
  return Math.max(0.3, 1 + weight * (footfall(world, d) - 1));
}

/**
 * What premises cost: the kind's base rent against the land, times how many
 * people actually come past. A café on the Central Plaza pays several times a
 * café in Foundry Row — and serves several times the customers.
 */
export function premisesRent(world: World, kind: BusinessKind, d: DistrictId, base: number): number {
  const rent = base * landValue(world, d) * footfallFor(world, kind, d) * CITY_RENT_CLASS;
  return Math.max(1, Math.round(rent));
}

/**
 * And what it earns: the same traffic, plus the standing of the address for
 * the trades that live on it. 1.0 is an average pitch in an average district.
 */
export function customFor(world: World, kind: BusinessKind, d: DistrictId): number {
  const fw = FOOTFALL_WEIGHT[kind] ?? 0.5;
  const pw = PRESTIGE_WEIGHT[kind] ?? 0;
  const custom = 1 + fw * (footfall(world, d) - 1) + pw * (prestigeIndex(world, d) - 1);
  return clamp(custom, CUSTOM_MIN, CUSTOM_MAX);
}

/** The rent of one home, at its address: the tier's rent against the land. */
export function homeRent(world: World, tier: 1 | 2 | 3, buildingId: string | null): number {
  const block = blockOf(buildingId ?? '');
  if (block?.flatRent !== undefined) return Math.max(0, Math.round(block.flatRent));
  const base = world.housing?.rent?.[tier] ?? 0;
  const d = districtOfBuilding(world, buildingId);
  const land = d ? landValue(world, d) : 1;
  return Math.max(1, Math.round(base * (block?.rentFactor ?? 1) * land * CITY_RENT_CLASS));
}

/**
 * What a unit sells for: sixty days of its rent, and good land sells at a
 * premium to its yield (`PROPERTY.md` §2).
 */
export function priceMultiplier(world: World, d: DistrictId): number {
  return (0.8 + 0.4 * landValue(world, d)) * CITY_PRICE_CLASS;
}

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

/**
 * Recompute the whole city's land, and say so when a district has moved far
 * enough that the people living in it will notice.
 */
export function dailyLand(world: World): void {
  const before: Partial<Record<DistrictId, number>> = {};
  for (const d of DISTRICT_IDS) {
    const held = world.counters[`land:${d}`];
    if (typeof held === 'number') before[d] = held;
  }
  const readings = recomputeLand(world);
  for (const d of openDistricts(world)) {
    const was = before[d];
    const now = readings[d].value;
    if (was === undefined || Math.abs(now - was) < LAND_NEWS) continue;
    const name = world.districts[d]?.name ?? DISTRICTS[d]?.name ?? d;
    const dir = now > was ? 'risen' : 'fallen';
    emit(world, 'property',
      `Land in ${name} has ${dir} to ${now.toFixed(2)} of the city's average (it was ${was.toFixed(2)}).`,
      [], 0.4, { district: d, landValue: now, was });
  }
}

/** One line per district for the Chronicle, the dashboard and the observation. */
export function landObservation(world: World): {
  district: DistrictId; name: string; landValue: number; footfall: number;
  offences: number; residents: number; vacancies: number; amenity: number; prestige: number;
}[] {
  const readings = landReadings(world);
  return openDistricts(world).map((d) => {
    const r = readings[d];
    return {
      district: d,
      name: world.districts[d]?.name ?? DISTRICTS[d]?.name ?? d,
      landValue: Math.round(r.value * 100) / 100,
      footfall: Math.round(r.footfall * 100) / 100,
      offences: r.offences,
      residents: r.residents,
      vacancies: Math.max(0, r.units - r.occupied),
      amenity: Math.round(r.amenity * 100) / 100,
      prestige: Math.round(r.prestige * 100) / 100,
    };
  });
}

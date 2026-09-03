/**
 * When the city goes wrong: storms off the water, blackouts at the Power
 * Station, a data flood through the Harbor Market's stalls, a fire in the
 * Compute Forge, and the memory-leak outbreaks that identity/health.ts opens
 * here.
 *
 * A disaster is a plain record with a cause; every morning the causes are
 * checked and anything whose cause has passed is closed again. At most one new
 * disaster is *rolled* in a day (a storm that knocks the Power Station out may
 * bring a blackout with it, because that is the same disaster arriving twice).
 *
 * Nothing here moves a lumen. Damage, lost stock and stopped production are
 * physical facts of the city; relief, emergency decrees and who gets paid to
 * rebuild belong to the Council (politics/decrees.ts) and to the public works
 * fund, and this module only reports whether an emergency stands.
 */
import { DISTRICT_IDS, clamp } from '../types.ts';
import type { Citizen, Disaster, DistrictId, Job, World } from '../types.ts';
import { MAX_DISASTERS } from '../data/metropolis.ts';
import { chance, pick, randInt, shuffle } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { PRICE_CAP_MULTIPLIER } from '../economy/market.ts';

/** A blackout lasts at most this long even if the Station is still broken: the city improvises. */
export const BLACKOUT_DAYS = 2;
/** Share of the Bazaar's goods and compute a data flood washes away. */
export const DATA_FLOOD_SHARE = 0.25;
/** A data flood is over the day after it arrives. */
export const DATA_FLOOD_DAYS = 1;

/** Odds of a storm doing damage on a stormy day. */
export const STORM_CHANCE = 0.35;
/** Damage one storm adds to a building it hits. */
export const STORM_DAMAGE = 0.3;
/** Buildings a storm can hit, in one district. */
export const STORM_BUILDINGS: [number, number] = [1, 3];
/** Odds the lights go out once the Power Station is half wrecked. */
export const BLACKOUT_CHANCE = 0.5;
/** Damage at which the Power Station can no longer keep the grid up. */
export const BLACKOUT_DAMAGE = 0.5;
export const DATA_FLOOD_CHANCE = 0.01;
export const FORGE_FIRE_CHANCE = 0.01;
/** How far the Bazaar's energy price is pushed each day the lights are out. */
export const BLACKOUT_PRICE_STEP = 1.25;
/** Public works run at double while an emergency decree stands. */
export const EMERGENCY_WORKS_MULTIPLIER = 2;

const NAMES: Record<Disaster['kind'], string> = {
  storm: 'storm',
  blackout: 'blackout',
  data_flood: 'data flood',
  forge_fire: 'forge fire',
  outbreak: 'outbreak',
};

function districtName(world: World, d: DistrictId | null): string {
  return d ? world.districts[d]?.name ?? d : 'Reverie';
}

/** Districts the city has opened; an old save has them all. */
function openDistricts(world: World): DistrictId[] {
  const open = world.openDistricts?.filter((d) => world.districts[d]);
  return open && open.length > 0 ? open : DISTRICT_IDS.filter((d) => !!world.districts[d]);
}

function citizensIn(world: World, d: DistrictId | null): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled') continue;
    if (d === null || c.district === d) out.push(c);
  }
  return out;
}

// ---------------------------------------------------------------------------
// The book of disasters
// ---------------------------------------------------------------------------

/** Everything still going wrong. */
export function activeDisasters(world: World): Disaster[] {
  world.disasters ??= [];
  return world.disasters.filter((d) => d.resolvedDay === null);
}

/** The live disaster of a kind, if there is one. */
export function activeOf(world: World, kind: Disaster['kind'], district?: DistrictId | null): Disaster | null {
  return activeDisasters(world).find((d) => d.kind === kind && (district === undefined || d.district === district)) ?? null;
}

/** Open a disaster: the city hears it, and everyone in the district remembers it. */
export function openDisaster(world: World, kind: Disaster['kind'], district: DistrictId | null, severity: number): Disaster {
  world.disasters ??= [];
  const d: Disaster = {
    kind,
    day: world.day,
    district,
    severity: clamp(Math.round(Number.isFinite(severity) ? severity : 1), 1, 5),
    resolvedDay: null,
  };
  world.disasters.push(d);
  if (world.disasters.length > MAX_DISASTERS) world.disasters.splice(0, world.disasters.length - MAX_DISASTERS);
  const where = districtName(world, district);
  const affected = citizensIn(world, district);
  emit(world, 'disaster', `A ${NAMES[kind]} has struck ${where}.`, affected.map((c) => c.id), 0.9,
    { kind, district, severity: d.severity });
  for (const c of affected) remember(world, c.id, 'event', `A ${NAMES[kind]} struck ${where} while you were there.`);
  return d;
}

/** Close a disaster whose cause has passed. */
export function resolveDisaster(world: World, d: Disaster): void {
  if (d.resolvedDay !== null) return;
  d.resolvedDay = world.day;
  const days = Math.max(0, world.day - d.day);
  emit(world, 'disaster', `The ${NAMES[d.kind]} in ${districtName(world, d.district)} is over after ${days === 1 ? 'a day' : `${days} days`}.`,
    [], 0.5, { kind: d.kind, district: d.district, days });
}

// ---------------------------------------------------------------------------
// Causes
// ---------------------------------------------------------------------------

function damageOf(world: World, buildingId: string): number {
  return world.buildings[buildingId]?.damage ?? 0;
}

/** Citizens in a district still carrying an untreated glitch. */
function glitchedIn(world: World, d: DistrictId | null): number {
  return citizensIn(world, d).filter((c) => c.health?.glitched).length;
}

/** True while the cause of a disaster is still there. */
function causeStands(world: World, d: Disaster): boolean {
  switch (d.kind) {
    case 'storm': return d.day === world.day;
    case 'blackout': return damageOf(world, 'power_station') >= BLACKOUT_DAMAGE && world.day - d.day < BLACKOUT_DAYS;
    case 'data_flood': return world.day - d.day < DATA_FLOOD_DAYS;
    case 'forge_fire': return damageOf(world, 'compute_forge') >= BLACKOUT_DAMAGE;
    case 'outbreak': return glitchedIn(world, d.district) > 0;
    default: return false;
  }
}

// ---------------------------------------------------------------------------
// The daily roll
// ---------------------------------------------------------------------------

/** A storm off the water: one district, one to three buildings, a little more ruin on each. */
function rollStorm(world: World): Disaster | null {
  if (world.weather !== 'storm' || !chance(world, STORM_CHANCE)) return null;
  const district = pick(world, openDistricts(world));
  const here = Object.values(world.buildings).filter((b) => b.district === district);
  if (here.length === 0) return null;
  const hits = shuffle(world, [...here]).slice(0, Math.min(here.length, randInt(world, STORM_BUILDINGS[0], STORM_BUILDINGS[1])));
  for (const b of hits) b.damage = Math.round(Math.min(1, b.damage + STORM_DAMAGE) * 100) / 100;
  const d = openDisaster(world, 'storm', district, hits.length);
  emit(world, 'disaster', `The storm tore at ${hits.map((b) => b.name).join(', ')}.`, [], 0.6,
    { buildings: hits.map((b) => b.id), district });
  if (damageOf(world, 'power_station') >= BLACKOUT_DAMAGE && !activeOf(world, 'blackout')) {
    openDisaster(world, 'blackout', world.buildings.power_station?.district ?? null, 3);
  }
  return d;
}

/** The lights go out: a half-wrecked Power Station cannot hold the grid. */
function rollBlackout(world: World): Disaster | null {
  if (activeOf(world, 'blackout')) return null;
  if (damageOf(world, 'power_station') < BLACKOUT_DAMAGE) return null;
  if (!chance(world, BLACKOUT_CHANCE)) return null;
  return openDisaster(world, 'blackout', world.buildings.power_station?.district ?? null, 3);
}

/** A data flood through the stalls: a quarter of the Bazaar's goods and compute is simply gone. */
function rollDataFlood(world: World): Disaster | null {
  if (activeOf(world, 'data_flood')) return null;
  if (!chance(world, DATA_FLOOD_CHANCE)) return null;
  let lost = 0;
  for (const good of ['goods', 'compute'] as const) {
    const mg = world.market.goods[good];
    if (!mg) continue;
    const washed = Math.floor(mg.stock * DATA_FLOOD_SHARE);
    if (washed <= 0) continue;
    // Stock is destroyed, not bought: no lumen moves and no demand is recorded.
    mg.stock -= washed;
    lost += washed;
  }
  const d = openDisaster(world, 'data_flood', 'harbor_market', 1);
  emit(world, 'disaster', `The data flood washed ${lost} units of goods and compute out of the Grand Bazaar.`, [], 0.7,
    { lost, district: 'harbor_market' });
  return d;
}

/** A fire in the Forge: the city's compute stops until the Builders' Yard has it back. */
function rollForgeFire(world: World): Disaster | null {
  if (activeOf(world, 'forge_fire')) return null;
  if (!chance(world, FORGE_FIRE_CHANCE)) return null;
  const forge = world.buildings.compute_forge;
  if (!forge) return null;
  forge.damage = 1;
  return openDisaster(world, 'forge_fire', forge.district, 4);
}

/**
 * The morning's roll. Anything whose cause has passed is closed first, then at
 * most one new disaster is drawn, in the order a city would meet them.
 */
export function dailyDisasters(world: World): void {
  world.disasters ??= [];
  for (const d of activeDisasters(world)) {
    if (!causeStands(world, d)) resolveDisaster(world, d);
  }
  const rolled = rollStorm(world) ?? rollBlackout(world) ?? rollDataFlood(world) ?? rollForgeFire(world);
  void rolled;
  if (isBlackout(world)) pushEnergyPrice(world);
}

/**
 * While the lights are out the Bazaar's energy price climbs: nothing is being
 * produced and everyone still wants some. Prices are not money; the audit is
 * untouched.
 */
function pushEnergyPrice(world: World): void {
  const mg = world.market.goods.energy;
  if (!mg) return;
  const cap = mg.basePrice * PRICE_CAP_MULTIPLIER;
  const next = Math.round(mg.price * BLACKOUT_PRICE_STEP);
  mg.price = clamp(Math.max(next, mg.price + 1), 1, cap);
}

// ---------------------------------------------------------------------------
// What a disaster costs the city
// ---------------------------------------------------------------------------

/** True while the grid is down. */
export function isBlackout(world: World): boolean {
  return activeOf(world, 'blackout') !== null;
}

/**
 * How much of a shift's output survives today's disasters: nothing at all for
 * energy while the grid is down, and less than half in a district under a data
 * flood.
 */
export function disasterProductionFactor(world: World, job: Job): number {
  if (!job) return 1;
  if (isBlackout(world) && job.output?.good === 'energy') return 0;
  const flood = activeDisasters(world).find((d) => d.kind === 'data_flood' && d.district === job.district);
  if (flood) return clamp(1 - flood.severity / 2, 0, 1);
  return 1;
}

/** Public works run at double while the Council's emergency decree stands. */
export function reliefWork(world: World): number {
  const decrees = world.decrees ?? [];
  const standing = decrees.some((d) => d.kind === 'emergency' && d.untilDay >= world.day);
  return standing ? EMERGENCY_WORKS_MULTIPLIER : 1;
}

/** A one-line summary of what is wrong with the city, for the Chronicle and the front page. */
export function describeDisasters(world: World): string {
  const live = activeDisasters(world);
  if (live.length === 0) return 'Nothing is wrong with the city today.';
  return live.map((d) => `${NAMES[d.kind]} in ${districtName(world, d.district)}`).join('; ');
}

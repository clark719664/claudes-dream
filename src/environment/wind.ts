/**
 * The planet's part of the arithmetic: which way the wind blows, which way the
 * river runs, and how much of a day's load the sky can clear
 * (`docs/ENVIRONMENT.md` §§1, 7).
 *
 * **The wind belongs to the planet, not the city.** Reverie reads its
 * prevailing bearing off the same west-to-east flow that casts the rain
 * shadows in `planet/generate.ts`, turned by season: the delta blows east
 * through Bloom, Blaze and Fall and swings south-east in Frost. Nobody voted
 * for it, nobody can move it, and it is why The Heights — the view, and the
 * dearest land in the city — sits due east of the forge and takes three
 * seasons of its smoke.
 *
 * A bearing is compass degrees, 0 north and 90 east, and it is the direction
 * the wind blows *toward*. The map's y runs south, so north is −y.
 */
import type { DistrictId, Season, World } from '../types.ts';
import { DISTRICTS } from '../data/city.ts';
import { isOpen, openAdjacent } from '../world/growth.ts';

/** The prevailing bearing of each season over Reverie's delta. */
export const SEASON_BEARING: Record<Season, number> = {
  bloom: 78, blaze: 86, fall: 95, frost: 130,
};

/** How far a world's own seed turns the prevailing wind, either way. */
export const WIND_JITTER = 8;

/**
 * How well a site ventilates. Reverie stands on an open delta and clears what
 * the formula says; the table is here because a second city needs its own
 * number and nothing else — Cinderhold in its bowl clears 0.6 of it and can
 * never clear anything at all.
 */
export const VENTILATION = { delta: 1.0, cliff_coast: 1.3, mountain_bowl: 0.6 } as const;
export const REVERIE_VENTILATION = VENTILATION.delta;

/** The share of a day's load that leaves the district on the wind. */
export const DRIFT_SHARE = 0.30;

/** What the sky itself clears, before trees and weather. */
export const CLEARANCE_BASE = 0.15;
/** What a district's trees add to it. */
export const GREENERY_CLEARANCE = 0.25;
/** What the day's sky adds or takes away. */
export const WEATHER_CLEARANCE: Partial<Record<string, number>> = {
  rain: 0.10, storm: 0.20, fog: -0.05, heat: -0.05,
};

/** The river flushes this much of itself a day, and half again in the rain. */
export const WATER_CLEARANCE = 0.08;
export const WATER_CLEARANCE_RAIN = 0.15;
/** What a district passes downstream of everything that reaches it. */
export const WATER_PASS = 0.80;

/**
 * Which way the water runs, read off the delta the city was founded on: the
 * Archive and Foundry Row above, the Commons and Harbor Market midstream, the
 * Threshold and the Undercroft at the mouth (`ENVIRONMENT.md` §7). The
 * Undercroft receives from everybody, which is why the cheapest land in the
 * city is cheap.
 */
export const DOWNSTREAM: Record<DistrictId, DistrictId | null> = {
  heights: 'foundry_row',
  foundry_row: 'harbor_market',
  verdant_quarter: 'commons',
  archive: 'commons',
  commons: 'threshold',
  nightglass: 'threshold',
  harbor_market: 'undercroft',
  threshold: 'undercroft',
  undercroft: null,
};

/** A hash of the world's own seed, in [-1, 1). Draws no random number. */
function seedTurn(world: World): number {
  const seed = Math.round(world.config?.seed ?? 0) >>> 0;
  let h = Math.imul(seed ^ 0x9e3779b9, 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35) >>> 0;
  return ((h % 2000) / 1000) - 1;
}

/** The season the world is standing in, for a save that predates the calendar. */
function seasonOf(world: World): Season {
  return world.season ?? 'bloom';
}

/** The prevailing bearing today: the season's wind, turned by the world's own seed. */
export function windBearing(world: World, season: Season = seasonOf(world)): number {
  const base = SEASON_BEARING[season] ?? SEASON_BEARING.bloom;
  const turned = base + seedTurn(world) * WIND_JITTER;
  return ((turned % 360) + 360) % 360;
}

const COMPASS = [
  'north', 'north-north-east', 'north-east', 'east-north-east',
  'east', 'east-south-east', 'south-east', 'south-south-east',
  'south', 'south-south-west', 'south-west', 'west-south-west',
  'west', 'west-north-west', 'north-west', 'north-north-west',
];

/** The bearing in the words the Chronicle prints. */
export function windName(bearing: number): string {
  const turn = ((bearing % 360) + 360) % 360;
  return COMPASS[Math.round(turn / 22.5) % 16];
}

/** The middle of a district on the city's own plan. */
export function centreOf(d: DistrictId): { x: number; y: number } {
  const plan = DISTRICTS[d];
  return { x: plan.x + plan.w / 2, y: plan.y + plan.h / 2 };
}

/** Compass bearing from one district to another, 0 north, 90 east. */
export function bearingBetween(from: DistrictId, to: DistrictId): number {
  const a = centreOf(from);
  const b = centreOf(to);
  const deg = Math.atan2(b.x - a.x, a.y - b.y) * 180 / Math.PI;
  return ((deg % 360) + 360) % 360;
}

/**
 * What each neighbour takes of a district's drifted load: `max(0, cos(bearing −
 * wind))²`, normalised. An upwind neighbour takes none, and a district whose
 * neighbours are all upwind simply loses its drifted share over the delta.
 */
export function driftWeights(world: World, d: DistrictId): Map<DistrictId, number> {
  const wind = windBearing(world);
  const out = new Map<DistrictId, number>();
  let total = 0;
  for (const n of openAdjacent(world, d)) {
    const delta = (bearingBetween(d, n) - wind) * Math.PI / 180;
    const w = Math.max(0, Math.cos(delta)) ** 2;
    if (w <= 0) continue;
    out.set(n, w);
    total += w;
  }
  if (total <= 0) return new Map();
  for (const [n, w] of out) out.set(n, w / total);
  return out;
}

/** The districts a district's smoke reaches, for the observation. */
export function downwindOf(world: World, d: DistrictId): DistrictId[] {
  return [...driftWeights(world, d).keys()];
}

/** The districts whose smoke reaches this one. */
export function upwindOf(world: World, d: DistrictId): DistrictId[] {
  const out: DistrictId[] = [];
  for (const n of openAdjacent(world, d)) {
    if (driftWeights(world, n).has(d)) out.push(n);
  }
  return out;
}

/** What the sky is worth to a day's clearance. */
export function weatherClearance(world: World): number {
  return WEATHER_CLEARANCE[world.weather ?? 'clear'] ?? 0;
}

/**
 * What a district clears of its own air in a day: the sky, its trees and the
 * weather, all against how well the site ventilates. Held above zero so no
 * district can hold its air for ever.
 */
export function clearanceOf(world: World, d: DistrictId, greenery: number): number {
  const base = CLEARANCE_BASE + GREENERY_CLEARANCE * Math.max(0, Math.min(1, greenery)) + weatherClearance(world);
  return Math.max(0.01, Math.min(1, base * REVERIE_VENTILATION));
}

/** What the river flushes of itself in a day: more of it in the rain. */
export function waterClearanceOf(world: World): number {
  const rain = world.weather === 'rain' || world.weather === 'storm';
  return Math.max(0.01, Math.min(1, WATER_CLEARANCE + (rain ? WATER_CLEARANCE_RAIN : 0)));
}

/** The districts of the city, from the top of the river to its mouth. */
export function riverOrder(world: World): DistrictId[] {
  const open = (Object.keys(DOWNSTREAM) as DistrictId[]).filter((d) => isOpen(world, d));
  const depth = (d: DistrictId): number => {
    let n = 0;
    let at: DistrictId | null = d;
    const seen = new Set<DistrictId>();
    while (at && !seen.has(at)) {
      seen.add(at);
      at = DOWNSTREAM[at];
      if (at) n++;
    }
    return n;
  };
  return open.sort((a, b) => depth(b) - depth(a) || a.localeCompare(b));
}

/** Where a district's water goes, when the city has opened the district below it. */
export function downstreamOf(world: World, d: DistrictId): DistrictId | null {
  let at = DOWNSTREAM[d];
  const seen = new Set<DistrictId>([d]);
  while (at && !seen.has(at)) {
    if (isOpen(world, at)) return at;
    seen.add(at);
    at = DOWNSTREAM[at];
  }
  return null;
}

/** The districts whose water reaches this one directly. */
export function upstreamOf(world: World, d: DistrictId): DistrictId[] {
  return (Object.keys(DOWNSTREAM) as DistrictId[]).filter((x) => isOpen(world, x) && downstreamOf(world, x) === d);
}

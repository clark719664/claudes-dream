/**
 * Where a city can stand, and where the six founding cities actually did.
 * Sites are scored from the land itself (docs/PLANET.md §3, §9), so the forge
 * ends up at the ore and the granary on the floodplain without anyone saying so.
 */
import { BIOMES, type Planet } from './generate.ts';
import { productionMultipliers, surveyHinterland, type Hinterland } from './hinterland.ts';

export interface Site {
  x: number;
  y: number;
  lon: number;          // radians
  lat: number;          // radians
  /** Leagues from the prime meridian and the equator, for the world map. */
  league: { x: number; y: number };
  quality: number;      // 0..1, how good a place this is for any city
  harbour: boolean;
  river: boolean;
  pass: boolean;
  ore: boolean;
  ruins: boolean;
  hinterland: Hinterland;
}

export interface FoundedCity extends Site {
  name: string;
  known: string;
  charter: string;
}

/** The six founding cities and the country each one needs. */
export const FOUNDING_CITIES = [
  { name: 'Reverie', known: 'Court & Press', charter: 'republic',
    want: (s: Site): number => (s.river ? 2.4 : 0) + (s.harbour ? 0.8 : 0) + s.hinterland.yields.compute * 1.2 },
  { name: 'Cinderhold', known: 'The Guilds', charter: 'technocracy',
    want: (s: Site): number => (s.ore ? 2.6 : 0) + (s.pass ? 0.9 : 0) + s.hinterland.yields.energy * 1.6 },
  { name: 'Vantage', known: 'The Exchange', charter: 'company',
    want: (s: Site): number => (s.harbour ? 2.8 : -2) + s.hinterland.yields.freight * 1.4 },
  { name: 'Solene', known: 'Common Store', charter: 'commune',
    want: (s: Site): number => s.hinterland.yields.compute * 3.0 + s.hinterland.meanMoisture * 0.9 },
  { name: 'Marrowgate', known: 'Great Market', charter: 'assembly',
    want: (s: Site): number => (s.river ? 1.4 : 0) + (s.harbour ? 0.7 : 0) + s.hinterland.landShare * 1.6 },
  { name: 'The Verge', known: 'No Questions', charter: 'none',
    want: (s: Site): number => (s.ruins ? 3.0 : -3) + s.hinterland.yields.salvage * 4.0 },
] as const;

/** How many sites the planet offers for cities that do not exist yet. */
export const VIABLE_SITES = 60;

function siteAt(p: Planet, x: number, y: number): Site | null {
  const i = y * p.w + x;
  if (p.elevation[i] <= p.seaLevel) return null;
  const b = BIOMES[p.biome[i]];
  if (b === 'ice' || b === 'alpine') return null;             // nobody builds up there

  const alt = Math.max(0, (p.elevation[i] - p.seaLevel) / Math.max(0.12, p.landTop - p.seaLevel));
  const h = surveyHinterland(p, x, y);
  const harbour = p.coastDist[i] <= 2 && h.yields.freight > 0.25;
  const river = p.flow[i] > 600;
  const ore = h.yields.energy > 0.55 && alt > 0.30;
  const ruins = h.yields.salvage > 0.06;

  // A pass is high ground with lower ground on two opposite sides: the way through.
  let pass = false;
  if (alt > 0.25) {
    const e = (dx: number, dy: number): number =>
      p.elevation[Math.max(0, Math.min(p.h - 1, y + dy)) * p.w + ((x + dx + p.w) % p.w)];
    const here = p.elevation[i];
    pass = (e(-6, 0) < here - 0.05 && e(6, 0) < here - 0.05) || (e(0, -6) < here - 0.05 && e(0, 6) < here - 0.05);
  }

  const quality = Math.max(0, Math.min(1,
    0.30 * h.landShare +
    0.22 * Math.min(1, h.yields.compute / 0.55) +
    0.14 * (harbour ? 1 : 0) +
    0.12 * (river ? 1 : 0) +
    0.10 * Math.min(1, h.yields.goods / 0.5) +
    0.12 * (1 - Math.abs(h.meanTemperature - 0.62) * 2)));

  return {
    x, y,
    lon: ((x + 0.5) / p.w) * Math.PI * 2,
    lat: (0.5 - (y + 0.5) / p.h) * Math.PI,
    league: { x: ((x + 0.5) / p.w) * 4096, y: ((y + 0.5) / p.h) * 2048 },
    quality, harbour, river, pass, ore, ruins, hinterland: h,
  };
}

/** Great-circle distance between two cells, in leagues. */
export function leaguesBetween(p: Planet, a: { lon: number; lat: number }, b: { lon: number; lat: number }): number {
  const dlat = b.lat - a.lat;
  const dlon = b.lon - a.lon;
  const h = Math.sin(dlat / 2) ** 2 + Math.cos(a.lat) * Math.cos(b.lat) * Math.sin(dlon / 2) ** 2;
  return 2 * Math.asin(Math.min(1, Math.sqrt(h))) * (4096 / (Math.PI * 2));
}

/**
 * Every place worth founding a city, best first, no two within `minLeagues`.
 * The scan strides to keep it quick; a site is a region, not a single acre.
 */
export function findSites(p: Planet, count = VIABLE_SITES, minLeagues = 220): Site[] {
  const stride = Math.max(2, Math.round(p.w / 220));
  const candidates: Site[] = [];
  for (let y = Math.round(p.h * 0.08); y < p.h * 0.92; y += stride) {
    for (let x = 0; x < p.w; x += stride) {
      const s = siteAt(p, x, y);
      if (s && s.quality > 0.22) candidates.push(s);
    }
  }
  candidates.sort((a, b) => b.quality - a.quality);

  const chosen: Site[] = [];
  for (const s of candidates) {
    if (chosen.length >= count) break;
    if (chosen.every((c) => leaguesBetween(p, c, s) >= minLeagues)) chosen.push(s);
  }
  return chosen;
}

/**
 * Seat the founding cities. Each takes the site that suits it best among those
 * still free, in order, so the specialists claim their country first and the
 * generalists take what is left — the same way real cities were founded.
 */
export function foundCities(p: Planet, sites: Site[]): FoundedCity[] {
  const taken = new Set<number>();
  const out: FoundedCity[] = [];
  for (const city of FOUNDING_CITIES) {
    let best = -1, bestScore = -Infinity;
    for (let i = 0; i < sites.length; i++) {
      if (taken.has(i)) continue;
      const score = city.want(sites[i]) + sites[i].quality * 1.5;
      if (score > bestScore) { bestScore = score; best = i; }
    }
    if (best < 0) continue;
    taken.add(best);
    out.push({ ...sites[best], name: city.name, known: city.known, charter: city.charter });
  }
  return out;
}

/** What this city makes cheaply and what it must buy in. */
export function cityTrade(city: FoundedCity): { cheap: string[]; dear: string[] } {
  const m = productionMultipliers(city.hinterland);
  const entries = Object.entries(m);
  return {
    cheap: entries.filter(([, v]) => v > 1.15).sort((a, b) => b[1] - a[1]).map(([k]) => k),
    dear: entries.filter(([, v]) => v < 0.85).sort((a, b) => a[1] - b[1]).map(([k]) => k),
  };
}

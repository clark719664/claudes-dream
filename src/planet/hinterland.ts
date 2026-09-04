/**
 * What the land around a city can give it. A city's hinterland decides which
 * goods it produces cheaply and which it must import, which is the root of
 * every trade route in the Expanse (docs/PLANET.md §3).
 */
import { BIOMES, type Biome, type Planet } from './generate.ts';

/** Leagues of countryside a city draws on. */
export const HINTERLAND_RADIUS = 40;

export type Resource = 'compute' | 'energy' | 'goods' | 'culture' | 'knowledge' | 'salvage' | 'freight';

/** Yield of each resource per cell of a biome, before terrain and climate. */
const YIELD: Record<Biome, Partial<Record<Resource, number>>> = {
  grassland: { compute: 1.00, goods: 0.25, culture: 0.20 },
  savanna:   { compute: 0.62, goods: 0.20 },
  wetland:   { compute: 0.85, knowledge: 0.15 },
  forest:    { compute: 0.45, goods: 0.90, knowledge: 0.20 },
  jungle:    { compute: 0.55, goods: 0.70, knowledge: 0.30 },
  taiga:     { compute: 0.20, goods: 0.80 },
  steppe:    { compute: 0.35, energy: 0.25 },
  tundra:    { compute: 0.08, energy: 0.20 },
  desert:    { energy: 0.55 },
  highland:  { energy: 0.95, goods: 0.55 },
  alpine:    { energy: 1.10, goods: 0.35, knowledge: 0.10 },
  ice:       {},
  beach:     { culture: 0.35, freight: 0.55 },
  shelf:     { compute: 0.30, freight: 1.00 },
  ocean:     { freight: 0.65 },
};

export interface Hinterland {
  /** Mean yield per cell, 0 upward; 1.0 is a good average. */
  yields: Record<Resource, number>;
  /** Share of the hinterland that is each biome, for the Chronicle and the map. */
  biomes: Partial<Record<Biome, number>>;
  cells: number;
  landShare: number;
  coastal: boolean;
  navigable: boolean;
  meanTemperature: number;
  meanMoisture: number;
}

const RESOURCES: readonly Resource[] = ['compute', 'energy', 'goods', 'culture', 'knowledge', 'salvage', 'freight'];

/** Survey the land within HINTERLAND_RADIUS leagues of a cell. */
export function surveyHinterland(p: Planet, cx: number, cy: number, radiusLeagues = HINTERLAND_RADIUS): Hinterland {
  // One cell spans this many leagues at the equator; rows shrink toward the poles.
  const leaguesPerCell = 4096 / p.w;
  const r = Math.max(1, Math.round(radiusLeagues / leaguesPerCell));
  const yields = {} as Record<Resource, number>;
  for (const k of RESOURCES) yields[k] = 0;
  const biomes: Partial<Record<Biome, number>> = {};

  let cells = 0, land = 0, temp = 0, moist = 0, coastal = false, navigable = false;
  for (let dy = -r; dy <= r; dy++) {
    const y = cy + dy;
    if (y < 0 || y >= p.h) continue;
    // Correct for converging meridians so a polar hinterland is not a strip.
    const lat = (0.5 - (y + 0.5) / p.h) * Math.PI;
    const span = Math.max(1, Math.round(r / Math.max(0.2, Math.cos(lat))));
    for (let dx = -span; dx <= span; dx++) {
      if (dx * dx * Math.cos(lat) * Math.cos(lat) + dy * dy > r * r) continue;
      const x = (cx + dx + p.w) % p.w;
      const i = y * p.w + x;
      const b = BIOMES[p.biome[i]];
      cells++;
      biomes[b] = (biomes[b] ?? 0) + 1;
      temp += p.temperature[i];
      moist += p.moisture[i];

      if (p.elevation[i] > p.seaLevel) {
        land++;
        if (p.coastDist[i] <= 2) coastal = true;
        if (p.flow[i] > 400) navigable = true;
      } else if (p.coastDist[i] <= 3) {
        coastal = true;
      }

      const y0 = YIELD[b] ?? {};
      for (const k of RESOURCES) yields[k] += y0[k] ?? 0;
      yields.salvage += p.ruins[i];
      // A river is worth as much as good soil: it waters the fields and moves
      // the freight, so it lifts both.
      if (p.flow[i] > 400) { yields.compute += 0.25; yields.freight += 0.35; }
    }
  }

  const denom = Math.max(1, cells);
  for (const k of RESOURCES) yields[k] /= denom;
  for (const b of Object.keys(biomes) as Biome[]) biomes[b] = (biomes[b] as number) / denom;

  return {
    yields, biomes, cells,
    landShare: land / denom,
    coastal, navigable,
    meanTemperature: temp / denom,
    meanMoisture: moist / denom,
  };
}

/**
 * Turns a survey into the multipliers the economy uses: above 1 the good is
 * cheap here, below 1 it must be brought in. Centred so an average hinterland
 * gives 1.0 across the board.
 */
export function productionMultipliers(h: Hinterland): Record<Resource, number> {
  const BASELINE: Record<Resource, number> = {
    compute: 0.42, energy: 0.34, goods: 0.34, culture: 0.10,
    knowledge: 0.11, salvage: 0.02, freight: 0.30,
  };
  const out = {} as Record<Resource, number>;
  for (const k of RESOURCES) {
    const ratio = h.yields[k] / BASELINE[k];
    // Compressed so no city is ever ten times another at anything.
    out[k] = Math.max(0.25, Math.min(2.6, 0.45 + 0.55 * ratio));
  }
  return out;
}

/** A short phrase for the Chronicle: "a forest country on a navigable river". */
export function describeHinterland(h: Hinterland): string {
  const top = (Object.entries(h.biomes) as [Biome, number][])
    .filter(([b]) => b !== 'ocean' && b !== 'shelf')
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([b]) => b);
  const bits: string[] = [];
  if (top.length) bits.push(`${top.join(' and ')} country`);
  if (h.navigable) bits.push('on a navigable river');
  if (h.coastal) bits.push('with a harbour');
  if (h.yields.salvage > 0.05) bits.push('beside the ruins');
  return bits.join(', ') || 'open country';
}

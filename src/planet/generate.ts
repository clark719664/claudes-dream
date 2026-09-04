/**
 * Planet generation, per docs/PLANET.md: plates, elevation, climate, rivers
 * and biomes, all deterministic from the world seed.
 */
import { dot, fbm, fibonacciSphere, ridged, toSphere, type Vec3 } from './noise.ts';

export const PLANET_W = 4096;   // leagues around the equator
export const PLANET_H = 2048;   // leagues pole to pole
export const LAND_FRACTION = 0.34;

export type Biome =
  | 'ocean' | 'shelf' | 'ice' | 'tundra' | 'taiga' | 'forest' | 'grassland'
  | 'steppe' | 'desert' | 'savanna' | 'jungle' | 'wetland' | 'highland' | 'alpine' | 'beach';

export interface Planet {
  seed: number;
  w: number;
  h: number;
  /** Elevation, −1 (deep ocean) to 1 (peak). */
  elevation: Float32Array;
  /** Mean temperature, 0 (polar) to 1 (equatorial lowland). */
  temperature: Float32Array;
  /** Moisture, 0 (arid) to 1 (saturated). */
  moisture: Float32Array;
  /** Flow accumulation; cells above the river threshold carry water. */
  flow: Float32Array;
  /** Distance to the nearest coast in cells: 0 on the shore, rising out to sea. */
  coastDist: Float32Array;
  biome: Uint8Array;
  /** Density of the old ruins, 0-1. Salvage is found nowhere else. */
  ruins: Float32Array;
  seaLevel: number;
  /** Elevation of the highest ordinary land, used to normalise altitude. */
  landTop: number;
}

export const BIOMES: Biome[] = [
  'ocean', 'shelf', 'ice', 'tundra', 'taiga', 'forest', 'grassland',
  'steppe', 'desert', 'savanna', 'jungle', 'wetland', 'highland', 'alpine', 'beach',
];
const B = (b: Biome): number => BIOMES.indexOf(b);

interface Plate { site: Vec3; drift: Vec3; oceanic: boolean }

function makePlates(seed: number, n: number): Plate[] {
  const sites = fibonacciSphere(n, seed ^ 0x51ed);
  return sites.map((site, i) => {
    const a = fbm(site.x * 2 + 11, site.y * 2, site.z * 2, seed + i) * Math.PI * 2;
    const b = fbm(site.x * 2, site.y * 2 + 7, site.z * 2, seed + i * 3) * Math.PI;
    return {
      site,
      drift: { x: Math.cos(a) * Math.sin(b), y: Math.cos(b), z: Math.sin(a) * Math.sin(b) },
      oceanic: fbm(site.x * 3, site.y * 3, site.z * 3, seed + 991 + i) < 0.52,
    };
  });
}

/** Nearest and second-nearest plate, for boundary detection. */
function classify(p: Vec3, plates: Plate[]): { a: number; b: number; edge: number } {
  let a = 0, b = 0, da = -2, db = -2;
  for (let i = 0; i < plates.length; i++) {
    const d = dot(p, plates[i].site);
    if (d > da) { db = da; b = a; da = d; a = i; }
    else if (d > db) { db = d; b = i; }
  }
  return { a, b, edge: da - db };   // small edge = near a boundary
}

export function generatePlanet(seed: number, w = 1024, h = 512): Planet {
  const n = w * h;
  const elevation = new Float32Array(n);
  const temperature = new Float32Array(n);
  const moisture = new Float32Array(n);
  const flow = new Float32Array(n);
  const coastDist = new Float32Array(n);
  const ruins = new Float32Array(n);
  const biome = new Uint8Array(n);
  const plates = makePlates(seed, 17);

  // --- elevation: plate interiors, boundary uplift, and fractal detail ------
  // The sample point is warped by its own noise field before the plates are
  // consulted, so plate boundaries never show as straight edges.
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;          // +pi/2 north .. -pi/2 south
    for (let x = 0; x < w; x++) {
      const lon = ((x + 0.5) / w) * Math.PI * 2;
      const s0 = toSphere(lon, lat);

      // Domain warp: displace the lookup by a low-frequency vector field.
      const wx = (fbm(s0.x * 1.4, s0.y * 1.4, s0.z * 1.4, seed + 5501, 4) - 0.5) * 0.55;
      const wy = (fbm(s0.x * 1.4 + 9, s0.y * 1.4, s0.z * 1.4, seed + 5502, 4) - 0.5) * 0.55;
      const wz = (fbm(s0.x * 1.4, s0.y * 1.4 + 9, s0.z * 1.4, seed + 5503, 4) - 0.5) * 0.55;
      const wl = Math.hypot(s0.x + wx, s0.y + wy, s0.z + wz) || 1;
      const p = { x: (s0.x + wx) / wl, y: (s0.y + wy) / wl, z: (s0.z + wz) / wl };

      const { a, b, edge } = classify(p, plates);
      const pa = plates[a], pb = plates[b];

      // Continentalness: a broad multi-centre field that decides where land is
      // at all. Plates then supply relief, rather than deciding the coastline
      // themselves — that is what produced one huge continent and an empty sea.
      const cont = fbm(p.x * 1.30, p.y * 1.30, p.z * 1.30, seed + 771, 2);
      const cont2 = fbm(p.x * 2.60, p.y * 2.60, p.z * 2.60, seed + 772, 2);
      let e = (cont - 0.47) * 4.2 + (cont2 - 0.5) * 0.9;
      e += pa.oceanic ? -0.14 : 0.14;
      // Lesser landmasses: a mid-frequency field that clears the water only at
      // its peaks, giving a couple of small continents away from the main ones.
      const cont3 = fbm(p.x * 4.1, p.y * 4.1, p.z * 4.1, seed + 773, 3);
      e += Math.max(0, cont3 - 0.585) * 3.4;

      // Boundaries: convergence lifts mountains, divergence opens rifts.
      const rel = { x: pa.drift.x - pb.drift.x, y: pa.drift.y - pb.drift.y, z: pa.drift.z - pb.drift.z };
      const towards = -dot(rel, { x: pa.site.x - pb.site.x, y: pa.site.y - pb.site.y, z: pa.site.z - pb.site.z });
      const nearness = Math.exp(-edge * 55);              // 1 at the seam, ~0 inland
      const orogeny = ridged(p.x * 4.4, p.y * 4.4, p.z * 4.4, seed + 4241);
      e += nearness * towards * 1.9 * (0.35 + 0.65 * orogeny);

      // Fractal relief everywhere, plus a ridged component so ranges have crests.
      e += (fbm(p.x * 2.6, p.y * 2.6, p.z * 2.6, seed + 17, 6) - 0.5) * 0.40;
      e += (ridged(p.x * 3.2, p.y * 3.2, p.z * 3.2, seed + 331, 5) - 0.42) * 0.40;
      e += (fbm(p.x * 7.5, p.y * 7.5, p.z * 7.5, seed + 88, 4) - 0.5) * 0.14;
      // Island arcs form where an oceanic plate is driven under another, so
      // they follow convergent boundaries in chains rather than scattering.
      if (pa.oceanic) {
        const arc = ridged(p.x * 7.5, p.y * 7.5, p.z * 7.5, seed + 1777, 3);
        e += nearness * Math.max(0, towards) * Math.max(0, arc - 0.52) * 3.2;
      }
      // Hotspots: rare isolated peaks far from any boundary, in short chains.
      const hot = fbm(p.x * 2.9, p.y * 2.9, p.z * 2.9, seed + 2311, 2);
      if (hot > 0.795) {
        e += (hot - 0.795) * 4.0 * ridged(p.x * 9.5, p.y * 9.5, p.z * 9.5, seed + 2312, 2);
      }

      elevation[y * w + x] = e;
    }
  }

  // --- sea level chosen so the land fraction comes out right ---------------
  const sorted = Float32Array.from(elevation).sort();
  const seaLevel = sorted[Math.floor(n * (1 - LAND_FRACTION))];
  // Altitude is measured against this world's own relief, not the noise range,
  // so the same thresholds mean the same thing on every seed.
  const landTop = sorted[Math.min(n - 1, Math.floor(n * (1 - LAND_FRACTION * 0.012)))];
  const relief = Math.max(0.12, landTop - seaLevel);

  // --- climate --------------------------------------------------------------
  const isLand = (i: number): boolean => elevation[i] > seaLevel;
  const altOf = (i: number): number => Math.max(0, Math.min(1.4, (elevation[i] - seaLevel) / relief));

  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    // Insolation falls off faster than cosine so the caps are genuinely cold.
    const solar = Math.pow(Math.max(0, Math.cos(lat)), 1.45);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = toSphere(((x + 0.5) / w) * Math.PI * 2, lat);
      const alt = altOf(i);

      let t = solar * 1.28 - 0.14 - alt * 0.40 + (isLand(i) ? -0.04 : 0.06);
      t += (fbm(p.x * 3, p.y * 3, p.z * 3, seed + 601, 4) - 0.5) * 0.10;
      temperature[i] = Math.max(0, Math.min(1, t));

      // Moisture: nearness to water in every direction, minus the rain shadow
      // cast by high ground upwind (winds run west to east).
      let m: number;
      if (!isLand(i)) m = 1;
      else {
        let water = 0;
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1], [-1, -1], [1, 1], [-1, 1], [1, -1]] as const) {
          for (let k = 1; k <= 18; k++) {
            const yy = y + dy * k;
            if (yy < 0 || yy >= h) break;
            if (!isLand(yy * w + ((x + dx * k + w) % w))) { water += (19 - k) / 18; break; }
          }
        }
        water = Math.min(1, water / 3.2);

        let shadow = 0;
        for (let k = 1; k <= 20; k++) {
          const j = y * w + ((x - k + w) % w);
          if (!isLand(j)) break;
          shadow = Math.max(shadow, altOf(j) - alt * 0.5);
        }

        const base = fbm(p.x * 2.4, p.y * 2.4, p.z * 2.4, seed + 313, 5);
        m = 0.30 + base * 0.34 + water * 0.46 - Math.max(0, shadow) * 0.85;
        // The tropics are wet and the horse latitudes are dry.
        m += 0.16 * Math.cos(lat * 6.0) * Math.pow(Math.max(0, Math.cos(lat)), 0.5);
      }
      moisture[i] = Math.max(0, Math.min(1, m));
    }
  }

  // --- rivers: route rain downhill and accumulate flow ----------------------
  const order = Array.from({ length: n }, (_, i) => i)
    .filter((i) => elevation[i] > seaLevel)
    .sort((p, q) => elevation[q] - elevation[p]);          // highest first
  for (const i of order) flow[i] += 0.02 + moisture[i] * 0.98;
  for (const i of order) {
    const x = i % w, y = (i / w) | 0;
    let best = -1, bestE = elevation[i];
    for (let dy = -1; dy <= 1; dy++) {
      const yy = y + dy;
      if (yy < 0 || yy >= h) continue;
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const j = yy * w + ((x + dx + w) % w);
        if (elevation[j] < bestE) { bestE = elevation[j]; best = j; }
      }
    }
    if (best >= 0 && elevation[best] > seaLevel) flow[best] += flow[i];
  }

  // --- distance to the coast, by a two-pass chamfer transform ---------------
  // Water gets its distance from the shore, which is what sets the depth of
  // the sea; land gets its distance from the water, which is what makes beaches
  // hug the coast instead of tracking an elevation contour.
  {
    const BIG = 1e6;
    for (let i = 0; i < n; i++) coastDist[i] = BIG;
    const water = (i: number): boolean => elevation[i] <= seaLevel;
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const i = y * w + x;
        const here = water(i);
        for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]] as const) {
          const yy = y + dy;
          if (yy < 0 || yy >= h) continue;
          if (water(yy * w + ((x + dx + w) % w)) !== here) { coastDist[i] = 0; break; }
        }
      }
    }
    const relax = (order: 'fwd' | 'rev'): void => {
      const ys = order === 'fwd' ? [...Array(h).keys()] : [...Array(h).keys()].reverse();
      for (const y of ys) {
        const xs = order === 'fwd' ? [...Array(w).keys()] : [...Array(w).keys()].reverse();
        for (const x of xs) {
          const i = y * w + x;
          let best = coastDist[i];
          for (const [dx, dy, cost] of [[-1, 0, 1], [1, 0, 1], [0, -1, 1], [0, 1, 1],
                                        [-1, -1, 1.414], [1, 1, 1.414], [-1, 1, 1.414], [1, -1, 1.414]] as const) {
            const yy = y + dy;
            if (yy < 0 || yy >= h) continue;
            const v = coastDist[yy * w + ((x + dx + w) % w)] + cost;
            if (v < best) best = v;
          }
          coastDist[i] = best;
        }
      }
    };
    relax('fwd'); relax('rev'); relax('fwd');
  }

  // --- biomes ---------------------------------------------------------------
  const riverAt = (i: number): boolean => flow[i] > 140 && elevation[i] > seaLevel;
  for (let i = 0; i < n; i++) {
    const e = elevation[i], t = temperature[i], m = moisture[i];
    if (e <= seaLevel) {
      // The shelf is defined by nearness to land, not by a depth contour.
      biome[i] = coastDist[i] <= 4 ? B('shelf') : B('ocean');
      continue;
    }
    const alt = Math.max(0, (e - seaLevel) / relief);
    // A beach is low ground within a cell or two of the water.
    if (coastDist[i] <= 1.5 && alt < 0.07) { biome[i] = B('beach'); continue; }
    if (alt > 0.72 && t < 0.30) { biome[i] = B('alpine'); continue; }
    if (alt > 0.86) { biome[i] = B('alpine'); continue; }
    if (alt > 0.58) { biome[i] = B('highland'); continue; }
    if (t < 0.15) { biome[i] = B('ice'); continue; }
    if (t < 0.27) { biome[i] = B('tundra'); continue; }
    if (riverAt(i) && m > 0.55) { biome[i] = B('wetland'); continue; }
    if (t < 0.48) { biome[i] = m > 0.38 ? B('taiga') : B('steppe'); continue; }
    if (t < 0.74) {
      if (m > 0.56) biome[i] = B('forest');
      else if (m > 0.36) biome[i] = B('grassland');
      else if (m > 0.20) biome[i] = B('steppe');
      else biome[i] = B('desert');
      continue;
    }
    if (m > 0.62) biome[i] = B('jungle');
    else if (m > 0.44) biome[i] = B('forest');
    else if (m > 0.26) biome[i] = B('savanna');
    else biome[i] = B('desert');
  }

  // --- the ruins ------------------------------------------------------------
  // Whatever stood here before is buried in a handful of dry fields. Salvage
  // comes from these and nowhere else, which is why the Verge is where it is.
  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      if (elevation[i] <= seaLevel) continue;
      const p = toSphere(((x + 0.5) / w) * Math.PI * 2, lat);
      const field = fbm(p.x * 3.6, p.y * 3.6, p.z * 3.6, seed + 8081, 3);
      if (field <= 0.66) continue;
      const dryness = Math.max(0, 0.55 - moisture[i]) * 1.8;
      ruins[i] = Math.min(1, (field - 0.66) * 5.2 * (0.35 + dryness));
    }
  }

  return { seed, w, h, elevation, temperature, moisture, flow, coastDist, biome, ruins, seaLevel, landTop };
}

/** Palette used by every renderer, so the planet looks the same everywhere. */
export const BIOME_COLOUR: Record<Biome, [number, number, number]> = {
  ocean: [14, 34, 64], shelf: [26, 66, 104], beach: [196, 178, 132],
  ice: [232, 238, 244], tundra: [150, 158, 148], taiga: [58, 88, 70],
  forest: [46, 92, 56], grassland: [110, 138, 74], steppe: [156, 152, 96],
  desert: [198, 172, 112], savanna: [166, 154, 84], jungle: [32, 84, 48],
  wetland: [72, 104, 88], highland: [124, 116, 100], alpine: [206, 206, 206],
};

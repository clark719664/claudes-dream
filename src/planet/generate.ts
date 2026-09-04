/**
 * Planet generation, per docs/PLANET.md: plates, elevation, climate, rivers
 * and biomes, all deterministic from the world seed.
 */
import { dot, fbm, fibonacciSphere, ridged, toSphere, type Vec3 } from './noise.ts';

export const PLANET_W = 4096;   // leagues around the equator
export const PLANET_H = 2048;   // leagues pole to pole
export const LAND_FRACTION = 0.31;

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
  biome: Uint8Array;
  seaLevel: number;
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

      // Continental shelf from the plate's own nature.
      let e = pa.oceanic ? -0.52 : 0.26;

      // Boundaries: convergence lifts mountains, divergence opens rifts.
      const rel = { x: pa.drift.x - pb.drift.x, y: pa.drift.y - pb.drift.y, z: pa.drift.z - pb.drift.z };
      const towards = -dot(rel, { x: pa.site.x - pb.site.x, y: pa.site.y - pb.site.y, z: pa.site.z - pb.site.z });
      const nearness = Math.exp(-edge * 55);              // 1 at the seam, ~0 inland
      const orogeny = ridged(p.x * 4.4, p.y * 4.4, p.z * 4.4, seed + 4241);
      e += nearness * towards * 1.9 * (0.35 + 0.65 * orogeny);

      // Fractal relief everywhere, plus a ridged component so ranges have crests.
      e += (fbm(p.x * 2.0, p.y * 2.0, p.z * 2.0, seed + 17, 7) - 0.5) * 1.05;
      e += (ridged(p.x * 3.2, p.y * 3.2, p.z * 3.2, seed + 331, 5) - 0.42) * 0.55;
      e += (fbm(p.x * 7.5, p.y * 7.5, p.z * 7.5, seed + 88, 4) - 0.5) * 0.30;

      elevation[y * w + x] = e;
    }
  }

  // --- sea level chosen so the land fraction comes out right ---------------
  const sorted = Float32Array.from(elevation).sort();
  const seaLevel = sorted[Math.floor(n * (1 - LAND_FRACTION))];

  // --- climate --------------------------------------------------------------
  const isLand = (i: number): boolean => elevation[i] > seaLevel;
  const altOf = (i: number): number => Math.max(0, (elevation[i] - seaLevel) / (1 - seaLevel));

  for (let y = 0; y < h; y++) {
    const lat = (0.5 - (y + 0.5) / h) * Math.PI;
    // Insolation falls off faster than cosine so the caps are genuinely cold.
    const solar = Math.pow(Math.max(0, Math.cos(lat)), 1.45);
    for (let x = 0; x < w; x++) {
      const i = y * w + x;
      const p = toSphere(((x + 0.5) / w) * Math.PI * 2, lat);
      const alt = altOf(i);

      let t = solar * 1.16 - 0.10 - alt * 0.85 + (isLand(i) ? -0.04 : 0.06);
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

  // --- biomes ---------------------------------------------------------------
  const riverAt = (i: number): boolean => flow[i] > 140 && elevation[i] > seaLevel;
  for (let i = 0; i < n; i++) {
    const e = elevation[i], t = temperature[i], m = moisture[i];
    if (e <= seaLevel) {
      biome[i] = e > seaLevel - 0.05 ? B('shelf') : B('ocean');
      continue;
    }
    const alt = (e - seaLevel) / (1 - seaLevel);
    if (e < seaLevel + 0.010) { biome[i] = B('beach'); continue; }
    if (alt > 0.46 && t < 0.34) { biome[i] = B('alpine'); continue; }
    if (alt > 0.56) { biome[i] = B('alpine'); continue; }
    if (alt > 0.36) { biome[i] = B('highland'); continue; }
    if (t < 0.20) { biome[i] = B('ice'); continue; }
    if (t < 0.31) { biome[i] = B('tundra'); continue; }
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

  return { seed, w, h, elevation, temperature, moisture, flow, biome, seaLevel };
}

/** Palette used by every renderer, so the planet looks the same everywhere. */
export const BIOME_COLOUR: Record<Biome, [number, number, number]> = {
  ocean: [14, 34, 64], shelf: [26, 66, 104], beach: [196, 178, 132],
  ice: [232, 238, 244], tundra: [150, 158, 148], taiga: [58, 88, 70],
  forest: [46, 92, 56], grassland: [110, 138, 74], steppe: [156, 152, 96],
  desert: [198, 172, 112], savanna: [166, 154, 84], jungle: [32, 84, 48],
  wetland: [72, 104, 88], highland: [124, 116, 100], alpine: [206, 206, 206],
};

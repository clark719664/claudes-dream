// Procedural heightfield shared by rendering (uploaded as a GPU heightmap)
// and physics (queried on the CPU with the exact same triangulation).

import { createNoise2D, fbm, ridged } from '../../shared/noise.js';

const CHUNK_QUADS = 32;
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

export class Heightfield {
  /**
   * @param {object} terrain normalized spec.terrain
   * @param {number} seed
   * @param {number[]} spawn [x, z] kept flat and walkable
   */
  constructor(terrain, seed, spawn = [0, 0]) {
    this.style = terrain.style;
    this.playSize = terrain.size;
    this.renderSize = terrain.size * 1.7;
    this.spacing = Math.max(1, this.renderSize / 544);
    this.chunks = Math.ceil(this.renderSize / this.spacing / CHUNK_QUADS);
    this.res = this.chunks * CHUNK_QUADS + 1;
    this.worldSize = (this.res - 1) * this.spacing;
    this.origin = -this.worldSize / 2;
    this.heights = new Float32Array(this.res * this.res);
    this.#generate(terrain, seed, spawn);
  }

  #generate(t, seed, spawn) {
    const n1 = createNoise2D(seed);
    const n2 = createNoise2D(seed + 17);
    const n3 = createNoise2D(seed + 91);
    const H = t.height;
    const rough = t.roughness;
    const half = this.playSize / 2;
    const octaves = 3 + Math.round(rough * 4);
    const gain = 0.35 + rough * 0.25;
    const f = 1 / 90;

    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        const x = this.origin + i * this.spacing;
        const z = this.origin + j * this.spacing;
        let h = 0;
        const base = fbm(n1, x * f, z * f, octaves, 2.0, gain);
        switch (this.style) {
          case 'mountains': {
            const r = ridged(n2, x * f * 0.8, z * f * 0.8, octaves, 2.1, 0.5);
            h = (r * 0.8 + (base * 0.5 + 0.5) * 0.4) * H;
            break;
          }
          case 'islands': {
            const d = Math.hypot(x, z) / half;
            h = Math.max(((base * 0.5 + 0.5) * 1.1 - d * d * 0.9 + 0.25) * H, -0.3 * H);
            break;
          }
          case 'canyon': {
            const mesa = Math.floor((base * 0.5 + 0.5) * 4) / 4;
            const soft = (base * 0.5 + 0.5);
            const river = Math.abs(fbm(n3, x * f * 0.6, z * f * 0.6, 3));
            const channel = smooth(0.02, 0.14, river);
            h = (mix(soft, mesa, 0.75) * channel + (1 - channel) * 0.05) * H;
            break;
          }
          case 'dunes': {
            const warp = fbm(n2, x * f * 0.7, z * f * 0.7, 3) * 30;
            const ridge = 1 - Math.abs(Math.sin((x * 0.8 + z * 0.35 + warp) * 0.045));
            h = (ridge * ridge * 0.6 + (base * 0.5 + 0.5) * 0.5) * H;
            break;
          }
          case 'terraces': {
            const v = (base * 0.5 + 0.5) * 6;
            const step = Math.floor(v);
            const frac = v - step;
            h = ((step + smooth(0.7, 1.0, frac)) / 6) * H;
            break;
          }
          case 'flat':
            h = (base * 0.5 + 0.5) * Math.min(H, 2) * 0.5;
            break;
          default: // hills
            h = (base * 0.5 + 0.5) * H + fbm(n3, x * f * 4, z * f * 4, 3) * H * 0.04;
        }
        // Frame the world: land rises outside the playable area (islands sink into the sea).
        const edge = Math.max(Math.abs(x), Math.abs(z)) / half;
        if (this.style === 'islands') h = Math.max(h - smooth(0.95, 1.5, edge) * H * 0.8, -0.3 * H);
        else h += smooth(0.92, 1.6, edge) * (8 + H * 0.9) * (0.7 + 0.3 * (fbm(n2, x * 0.01, z * 0.01, 3) + 1));
        this.heights[j * this.res + i] = h;
      }
    }

    // Flatten a comfortable start area around the spawn point.
    // The target is the average height around the spawn, and the blend is wide
    // and gentle so mountains don't turn into a flat-topped mesa.
    const [sx, sz] = spawn;
    const radius = 7, falloff = radius * 4;
    let sum = 0, n = 0;
    for (let a = 0; a < 16; a++) {
      for (const r of [0, radius * 0.5, radius, radius * 2]) {
        sum += this.#bilinear(sx + Math.cos((a / 16) * Math.PI * 2) * r, sz + Math.sin((a / 16) * Math.PI * 2) * r);
        n++;
      }
    }
    const target = sum / n;
    for (let j = 0; j < this.res; j++) {
      for (let i = 0; i < this.res; i++) {
        const x = this.origin + i * this.spacing, z = this.origin + j * this.spacing;
        const d = Math.hypot(x - sx, z - sz);
        if (d < falloff) {
          const k = 1 - smooth(radius, falloff, d);
          const idx = j * this.res + i;
          this.heights[idx] = this.heights[idx] * (1 - k) + target * k;
        }
      }
    }

    let min = Infinity, max = -Infinity;
    for (const h of this.heights) { if (h < min) min = h; if (h > max) max = h; }
    for (let k = 0; k < this.heights.length; k++) this.heights[k] -= min;
    this.minHeight = 0;
    this.maxHeight = max - min;
  }

  #bilinear(x, z) {
    const fx = (x - this.origin) / this.spacing, fz = (z - this.origin) / this.spacing;
    const i = Math.max(0, Math.min(this.res - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.res - 2, Math.floor(fz)));
    const tx = fx - i, tz = fz - j;
    const h = (a, b) => this.heights[b * this.res + a];
    return (h(i, j) * (1 - tx) + h(i + 1, j) * tx) * (1 - tz) + (h(i, j + 1) * (1 - tx) + h(i + 1, j + 1) * tx) * tz;
  }

  /** Height at world (x, z) using the same triangle split as the rendered mesh. */
  heightAt(x, z) {
    const fx = (x - this.origin) / this.spacing, fz = (z - this.origin) / this.spacing;
    const i = Math.max(0, Math.min(this.res - 2, Math.floor(fx)));
    const j = Math.max(0, Math.min(this.res - 2, Math.floor(fz)));
    const tx = Math.min(1, Math.max(0, fx - i)), tz = Math.min(1, Math.max(0, fz - j));
    const r = this.res;
    const a = this.heights[j * r + i], b = this.heights[j * r + i + 1];
    const c = this.heights[(j + 1) * r + i + 1], d = this.heights[(j + 1) * r + i];
    // triangles (a, c, b) when tx >= tz, (a, d, c) otherwise
    if (tx >= tz) return a + (b - a) * tx + (c - b) * tz;
    return a + (d - a) * tz + (c - d) * tx;
  }

  normalAt(x, z, out = [0, 1, 0]) {
    const e = this.spacing;
    const hx = this.heightAt(x + e, z) - this.heightAt(x - e, z);
    const hz = this.heightAt(x, z + e) - this.heightAt(x, z - e);
    const l = Math.hypot(hx, 2 * e, hz);
    out[0] = -hx / l; out[1] = (2 * e) / l; out[2] = -hz / l;
    return out;
  }

  /** Chunk descriptors for rendering: texel origin + world bounds. */
  chunkList() {
    const list = [];
    for (let cz = 0; cz < this.chunks; cz++) {
      for (let cx = 0; cx < this.chunks; cx++) {
        const i0 = cx * CHUNK_QUADS, j0 = cz * CHUNK_QUADS;
        let lo = Infinity, hi = -Infinity;
        for (let j = j0; j <= j0 + CHUNK_QUADS; j++) for (let i = i0; i <= i0 + CHUNK_QUADS; i++) {
          const h = this.heights[j * this.res + i];
          if (h < lo) lo = h; if (h > hi) hi = h;
        }
        const size = CHUNK_QUADS * this.spacing;
        const center = [this.origin + (i0 + CHUNK_QUADS / 2) * this.spacing, (lo + hi) / 2, this.origin + (j0 + CHUNK_QUADS / 2) * this.spacing];
        list.push({ i0, j0, center, radius: Math.hypot(size / 2, size / 2, (hi - lo) / 2) + 2 });
      }
    }
    return list;
  }

  contains(x, z, margin = 0) {
    const h = this.playSize / 2 - margin;
    return Math.abs(x) <= h && Math.abs(z) <= h;
  }
}

function mix(a, b, t) { return a + (b - a) * t; }
export { CHUNK_QUADS };

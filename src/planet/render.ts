/**
 * Renders a generated planet to PNG, with no image library: a minimal
 * encoder over node:zlib. Two views — the equirectangular field, and the
 * orthographic globe the aerial view opens on.
 */
import { deflateSync } from 'node:zlib';
import { BIOME_COLOUR, BIOMES, type Planet } from './generate.ts';

// ---------------------------------------------------------------- PNG ------

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function crc32(buf: Uint8Array): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

function chunk(type: string, data: Uint8Array): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'latin1'), Buffer.from(data)]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}

/** Encode RGB bytes (w*h*3) as a PNG. */
export function encodePng(rgb: Uint8Array, w: number, h: number): Buffer {
  const raw = Buffer.alloc(h * (w * 3 + 1));
  for (let y = 0; y < h; y++) {
    raw[y * (w * 3 + 1)] = 0;                                  // filter: none
    Buffer.from(rgb.buffer, rgb.byteOffset + y * w * 3, w * 3)
      .copy(raw, y * (w * 3 + 1) + 1);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0);
  ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8;    // bit depth
  ihdr[9] = 2;    // colour type: truecolour
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', new Uint8Array(0)),
  ]);
}

// ------------------------------------------------------------- shading -----

/** Bilinear blend of the shaded surface, so the globe is smooth at any size. */
export function sampleShaded(p: Planet, fx: number, fy: number, sun: { x: number; y: number; z: number }): [number, number, number] {
  const x0 = Math.floor(fx), y0 = Math.max(0, Math.min(p.h - 1, Math.floor(fy)));
  const x1 = (x0 + 1) % p.w, y1 = Math.max(0, Math.min(p.h - 1, y0 + 1));
  const tx = fx - x0, ty = fy - y0;
  const a = shade(p, (x0 % p.w + p.w) % p.w, y0, sun);
  const b = shade(p, x1, y0, sun);
  const c = shade(p, (x0 % p.w + p.w) % p.w, y1, sun);
  const d = shade(p, x1, y1, sun);
  const out: [number, number, number] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const top = a[k] * (1 - tx) + b[k] * tx;
    const bot = c[k] * (1 - tx) + d[k] * tx;
    out[k] = top * (1 - ty) + bot * ty;
  }
  return out;
}

/** Surface colour at a cell: biome, rivers, ocean depth, and hillshading. */
export function shade(p: Planet, x: number, y: number, sun = { x: -0.6, y: 0.55, z: 0.58 }): [number, number, number] {
  const i = y * p.w + x;
  const b = BIOMES[p.biome[i]];
  let [r, g, bl] = BIOME_COLOUR[b];

  // Within a biome, dry ground is browner and wet ground greener, and high
  // cold ground takes snow. Without this, whole regions read as flat colour.
  if (b !== 'ocean' && b !== 'shelf' && b !== 'ice') {
    const m = p.moisture[i], t = p.temperature[i];
    const dry = Math.max(0, 0.5 - m) * 1.6;
    r += dry * 46; g += dry * 24; bl -= dry * 20;
    const wet = Math.max(0, m - 0.55) * 1.4;
    r -= wet * 26; g += wet * 14; bl -= wet * 6;
    const snow = Math.max(0, (0.27 - t) * (b === 'alpine' || b === 'highland' ? 4.0 : 1.6));
    const sn = Math.min(1, snow * (b === 'alpine' ? 1 : 0.55));
    r = r * (1 - sn) + 236 * sn; g = g * (1 - sn) + 240 * sn; bl = bl * (1 - sn) + 246 * sn;
  }

  if (b === 'ocean' || b === 'shelf') {
    // Depth is governed by distance from the shore, which is how real seas
    // look from orbit: a bright shelf hugging the land, a slope, then abyss.
    // Two things decide how shallow water looks: how far it is from land, and
    // how high the sea floor actually stands. A steep margin drops away at
    // once; a shallow one carries a wide shelf. Using only distance produced a
    // uniform bright ring around every island, which is not what seas do.
    const dist = p.coastDist[i];
    const floorHeight = Math.max(0, Math.min(1, (p.elevation[i] - (p.seaLevel - 0.16)) / 0.16));
    const near = Math.max(0, 1 - dist / 5) * floorHeight;      // shallow water
    const shelf = 1 - near;
    const slope = Math.min(1, Math.max(0, (dist - 4) / 12)) * (1 - floorHeight * 0.5);
    const abyss = Math.min(1, Math.max(0, (dist - 15) / 38)) * (1 - floorHeight);
    const stops: [number, number, number][] = [
      [48, 116, 136],   // shore — green-blue over sand
      [26, 76, 120],    // shelf
      [14, 46, 88],     // slope
      [6, 18, 44],      // abyssal plain
    ];
    const mix = (a: [number, number, number], c: [number, number, number], t: number): [number, number, number] =>
      [a[0] + (c[0] - a[0]) * t, a[1] + (c[1] - a[1]) * t, a[2] + (c[2] - a[2]) * t];
    let col = mix(stops[0], stops[1], shelf);
    col = mix(col, stops[2], slope);
    col = mix(col, stops[3], abyss);
    // A little relief on the sea floor so it is not a flat wash.
    const floorRelief = 1 + (p.elevation[i] - p.seaLevel + 0.4) * 0.12;
    return [Math.round(col[0] * floorRelief), Math.round(col[1] * floorRelief), Math.round(col[2] * floorRelief)];
  }

  // Rivers drawn over the land they cut through.
  if (p.flow[i] > 90) {
    const t = Math.min(1, (p.flow[i] - 90) / 900);
    r = Math.round(r * (1 - t) + 40 * t);
    g = Math.round(g * (1 - t) + 92 * t);
    bl = Math.round(bl * (1 - t) + 138 * t);
  }

  // Hillshade from the elevation gradient.
  const xl = (x - 1 + p.w) % p.w, xr = (x + 1) % p.w;
  const yu = Math.max(0, y - 1), yd = Math.min(p.h - 1, y + 1);
  const dzdx = (p.elevation[y * p.w + xr] - p.elevation[y * p.w + xl]) * 42;
  const dzdy = (p.elevation[yd * p.w + x] - p.elevation[yu * p.w + x]) * 42;
  const len = Math.hypot(dzdx, dzdy, 1);
  const light = Math.max(0.25, Math.min(1.35, (-dzdx * sun.x + -dzdy * sun.y + sun.z) / len + 0.34));
  return [
    Math.max(0, Math.min(255, Math.round(r * light))),
    Math.max(0, Math.min(255, Math.round(g * light))),
    Math.max(0, Math.min(255, Math.round(bl * light))),
  ];
}

/** The whole planet as an equirectangular sheet. */
export function renderEquirect(p: Planet): Buffer {
  const rgb = new Uint8Array(p.w * p.h * 3);
  for (let y = 0; y < p.h; y++) {
    for (let x = 0; x < p.w; x++) {
      const [r, g, b] = shade(p, x, y);
      const o = (y * p.w + x) * 3;
      rgb[o] = r; rgb[o + 1] = g; rgb[o + 2] = b;
    }
  }
  return encodePng(rgb, p.w, p.h);
}

export interface City { name: string; lon: number; lat: number }

/**
 * The globe as the aerial view opens on it: orthographic, lit from one side,
 * with an atmospheric limb. `spin` turns the planet, `tilt` raises the pole.
 */
export function renderGlobe(
  p: Planet,
  size = 900,
  spin = 0,
  tilt = 0.32,
  cities: City[] = [],
): Buffer {
  const rgb = new Uint8Array(size * size * 3);
  const R = size * 0.44;
  const cx = size / 2, cy = size / 2;
  const st = Math.sin(tilt), ct = Math.cos(tilt);
  const sun = { x: -0.78, y: 0.30, z: 0.55 };

  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      const o = (py * size + px) * 3;
      const dx = (px + 0.5 - cx) / R;
      const dyUp = (cy - (py + 0.5)) / R;               // screen y is down; make it up
      const r2 = dx * dx + dyUp * dyUp;

      if (r2 > 1) {
        // Space, with a faint halo just outside the limb.
        const glow = Math.max(0, 1 - (Math.sqrt(r2) - 1) * 7);
        const a = glow * glow * 0.5;
        rgb[o] = Math.round(6 + 30 * a);
        rgb[o + 1] = Math.round(8 + 52 * a);
        rgb[o + 2] = Math.round(14 + 96 * a);
        continue;
      }

      // Unproject the disc onto the sphere in view space, then rotate by the
      // tilt to get world coordinates, and read off latitude and longitude.
      const vz = Math.sqrt(1 - r2);                      // toward the viewer
      const wy = dyUp * ct + vz * st;
      const wz = -dyUp * st + vz * ct;
      const lat = Math.asin(Math.max(-1, Math.min(1, wy)));
      const lon = (Math.atan2(dx, wz) + spin + Math.PI * 8) % (Math.PI * 2);

      const fx = (lon / (Math.PI * 2)) * p.w;
      const fy = (0.5 - lat / Math.PI) * p.h;
      let [r, g, b] = sampleShaded(p, fx, fy, { x: -0.6, y: 0.55, z: 0.58 });

      // Day and night. The surface normal in view space is (dx, dyUp, vz);
      // the sun is fixed in view space so the terminator sweeps as the planet turns.
      const daylight = dx * sun.x + dyUp * sun.y + vz * sun.z;
      const lit = Math.max(0, Math.min(1, (daylight + 0.30) / 0.42));
      const night = 0.10 + 0.90 * lit;
      r *= night; g *= night; b *= night;
      if (lit < 0.30) {                                  // city lights on the dark side
        const glowB = (1 - lit / 0.30) * 12;
        b += glowB; g += glowB * 0.35;
      }

      // Atmosphere thickens toward the limb.
      const limb = Math.pow(r2, 5.0) * (0.35 + 0.65 * lit);
      r = r * (1 - limb) + 92 * limb;
      g = g * (1 - limb) + 146 * limb;
      b = b * (1 - limb) + 214 * limb;

      rgb[o] = Math.max(0, Math.min(255, Math.round(r)));
      rgb[o + 1] = Math.max(0, Math.min(255, Math.round(g)));
      rgb[o + 2] = Math.max(0, Math.min(255, Math.round(b)));
    }
  }

  // City markers, drawn only where they face us.
  for (const c of cities) {
    const v = { x: Math.cos(c.lat) * Math.sin(c.lon - spin), y: Math.sin(c.lat), z: Math.cos(c.lat) * Math.cos(c.lon - spin) };
    const dyUp = v.y * ct - v.z * st;
    const vz = v.y * st + v.z * ct;
    if (vz <= 0.02) continue;
    const px = Math.round(cx + v.x * R), py = Math.round(cy - dyUp * R);
    for (let ry = -3; ry <= 3; ry++) {
      for (let rx = -3; rx <= 3; rx++) {
        const d = Math.hypot(rx, ry);
        if (d > 3) continue;
        const qx = px + rx, qy = py + ry;
        if (qx < 0 || qy < 0 || qx >= size || qy >= size) continue;
        const o = (qy * size + qx) * 3;
        const a = d < 1.4 ? 1 : Math.max(0, 1 - (d - 1.4) / 1.6);
        rgb[o] = Math.round(rgb[o] * (1 - a) + 255 * a);
        rgb[o + 1] = Math.round(rgb[o + 1] * (1 - a) + 214 * a);
        rgb[o + 2] = Math.round(rgb[o + 2] * (1 - a) + 128 * a);
      }
    }
  }

  return encodePng(rgb, size, size);
}

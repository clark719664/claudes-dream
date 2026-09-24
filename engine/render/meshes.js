// Procedural geometry. Every asset in Reverie is generated from code, so a
// whole game ships as a few KB of JSON: no downloads, no asset pipeline.
//
// Conventions: primitives fit the unit cube [-0.5, 0.5]^3 so a prefab's
// `size` maps directly onto its bounding box. Scatter props stand on y = 0.
// Vertex color alpha: 1 = tinted by the instance color, 0 = fixed color.

import { Rng } from '../../shared/rng.js';
import { createNoise2D } from '../../shared/noise.js';

const TINT = [1, 1, 1, 1];
export const VERTEX_STRIDE = 32; // position f32x3, normal f32x3, color unorm8x4, uv unorm16x2

export class Geo {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.uvs = []; this.indices = []; }
  get vertexCount() { return this.positions.length / 3; }

  vertex(x, y, z, nx, ny, nz, c = TINT, u = 0, v = 0) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(c[0], c[1], c[2], c[3] ?? 1);
    this.uvs.push(u, v);
    return this.vertexCount - 1;
  }
  tri(a, b, c) { this.indices.push(a, b, c); }
  quad(a, b, c, d) { this.indices.push(a, b, c, a, c, d); }

  /** Append another Geo, transformed by fn(p, n) which mutates the arrays in place. */
  merge(g, transform = null, color = null) {
    const base = this.vertexCount;
    const p = [0, 0, 0], n = [0, 0, 0];
    for (let i = 0; i < g.vertexCount; i++) {
      p[0] = g.positions[i * 3]; p[1] = g.positions[i * 3 + 1]; p[2] = g.positions[i * 3 + 2];
      n[0] = g.normals[i * 3]; n[1] = g.normals[i * 3 + 1]; n[2] = g.normals[i * 3 + 2];
      if (transform) transform(p, n);
      const l = Math.hypot(n[0], n[1], n[2]) || 1;
      const c = color ?? g.colors.slice(i * 4, i * 4 + 4);
      this.vertex(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, c, g.uvs[i * 2], g.uvs[i * 2 + 1]);
    }
    for (const idx of g.indices) this.indices.push(idx + base);
    return this;
  }

  /** Make every triangle's winding agree with its vertex normals (CCW = front). */
  fixWinding() {
    const P = this.positions, N = this.normals, I = this.indices;
    for (let t = 0; t < I.length; t += 3) {
      const a = I[t] * 3, b = I[t + 1] * 3, c = I[t + 2] * 3;
      const e1x = P[b] - P[a], e1y = P[b + 1] - P[a + 1], e1z = P[b + 2] - P[a + 2];
      const e2x = P[c] - P[a], e2y = P[c + 1] - P[a + 1], e2z = P[c + 2] - P[a + 2];
      const fx = e1y * e2z - e1z * e2y, fy = e1z * e2x - e1x * e2z, fz = e1x * e2y - e1y * e2x;
      const nx = N[a] + N[b] + N[c], ny = N[a + 1] + N[b + 1] + N[c + 1], nz = N[a + 2] + N[b + 2] + N[c + 2];
      if (fx * nx + fy * ny + fz * nz < 0) { const tmp = I[t + 1]; I[t + 1] = I[t + 2]; I[t + 2] = tmp; }
    }
    return this;
  }

  /** Convert to flat shading (faceted, stylised look). */
  flat() {
    this.fixWinding();
    const out = new Geo();
    const P = this.positions, C = this.colors, I = this.indices;
    for (let t = 0; t < I.length; t += 3) {
      const ids = [I[t], I[t + 1], I[t + 2]];
      const [a, b, c] = ids.map((i) => [P[i * 3], P[i * 3 + 1], P[i * 3 + 2]]);
      const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
      const e2 = [c[0] - a[0], c[1] - a[1], c[2] - a[2]];
      let n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
      const l = Math.hypot(n[0], n[1], n[2]);
      if (l < 1e-12) continue;
      n = n.map((v) => v / l);
      const v = ids.map((i, k) => out.vertex(...[a, b, c][k], ...n, C.slice(i * 4, i * 4 + 4), this.uvs[i * 2], this.uvs[i * 2 + 1]));
      out.tri(v[0], v[1], v[2]);
    }
    return out;
  }

  /** Pack into the GPU vertex format. */
  finish() {
    this.fixWinding();
    const n = this.vertexCount;
    const buf = new ArrayBuffer(n * VERTEX_STRIDE);
    const f = new Float32Array(buf);
    const u8 = new Uint8Array(buf);
    const u16 = new Uint16Array(buf);
    let radius = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 8;
      const x = this.positions[i * 3], y = this.positions[i * 3 + 1], z = this.positions[i * 3 + 2];
      f[o] = x; f[o + 1] = y; f[o + 2] = z;
      f[o + 3] = this.normals[i * 3]; f[o + 4] = this.normals[i * 3 + 1]; f[o + 5] = this.normals[i * 3 + 2];
      for (let k = 0; k < 4; k++) u8[i * VERTEX_STRIDE + 24 + k] = Math.round(Math.min(1, Math.max(0, this.colors[i * 4 + k])) * 255);
      u16[i * 16 + 14] = Math.round(Math.min(1, Math.max(0, this.uvs[i * 2] ?? 0)) * 65535);
      u16[i * 16 + 15] = Math.round(Math.min(1, Math.max(0, this.uvs[i * 2 + 1] ?? 0)) * 65535);
      radius = Math.max(radius, Math.hypot(x, y, z));
    }
    return { vertices: buf, indices: n > 65535 ? new Uint32Array(this.indices) : new Uint16Array(this.indices), vertexCount: n, radius };
  }
}

// ---------------------------------------------------------------- transforms

export const T = {
  translate: (x, y, z) => (p) => { p[0] += x; p[1] += y; p[2] += z; },
  scale: (x, y, z) => (p, n) => { p[0] *= x; p[1] *= y; p[2] *= z; n[0] /= x; n[1] /= y; n[2] /= z; },
  rotX: (a) => (p, n) => { rot(p, 1, 2, a); rot(n, 1, 2, a); },
  rotY: (a) => (p, n) => { rot(p, 2, 0, a); rot(n, 2, 0, a); },
  rotZ: (a) => (p, n) => { rot(p, 0, 1, a); rot(n, 0, 1, a); },
  chain: (...fns) => (p, n) => { for (const f of fns) f(p, n); },
};
function rot(v, i, j, a) {
  const c = Math.cos(a), s = Math.sin(a);
  const x = v[i], y = v[j];
  v[i] = x * c - y * s;
  v[j] = x * s + y * c;
}

// ---------------------------------------------------------------- primitives

/** Revolve a profile [[r, y], ...] (bottom to top) around Y. Repeat a point for a hard edge. */
export function lathe(profile, segments = 24, color = TINT, phase = 0) {
  const g = new Geo();
  const rows = profile.length;
  const normals2d = profile.map((pt, i) => {
    const prev = profile[i - 1], next = profile[i + 1];
    const same = (a, b) => a && b && a[0] === b[0] && a[1] === b[1];
    let a = prev ?? pt, b = next ?? pt;
    if (same(pt, next)) b = pt;
    if (same(pt, prev)) a = pt;
    const dr = b[0] - a[0], dy = b[1] - a[1];
    const l = Math.hypot(dr, dy) || 1;
    return [dy / l, -dr / l];
  });
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j <= segments; j++) {
      const a = phase + (j / segments) * Math.PI * 2;
      const c = Math.cos(a), s = Math.sin(a);
      const [r, y] = profile[i];
      const [nr, ny] = normals2d[i];
      g.vertex(r * c, y, r * s, nr * c, ny, nr * s, color);
    }
  }
  for (let i = 0; i < rows - 1; i++) {
    for (let j = 0; j < segments; j++) {
      const a = i * (segments + 1) + j, b = a + 1, c = a + segments + 2, d = a + segments + 1;
      g.quad(a, b, c, d);
    }
  }
  return g;
}

export function box(color = TINT) {
  const g = new Geo();
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const idx = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, b]) => g.vertex(
      (n[0] + u[0] * a + v[0] * b) * 0.5, (n[1] + u[1] * a + v[1] * b) * 0.5, (n[2] + u[2] * a + v[2] * b) * 0.5,
      n[0], n[1], n[2], color));
    g.quad(idx[0], idx[1], idx[2], idx[3]);
  }
  return g;
}

/** Box with bevelled edges: catches highlights like real manufactured objects. */
export function roundedBox(color = TINT, bevel = 0.06) {
  const g = new Geo();
  const b = bevel, h = 0.5 - bevel;
  // 3x3x3 lattice of sphere-like normals, collapsed into a cube with chamfered edges
  const steps = [-1, 1];
  const corner = [];
  for (const x of steps) for (const y of steps) for (const z of steps) corner.push([x, y, z]);
  const faces = [
    [[1, 0, 0], [0, 1, 0], [0, 0, 1]], [[-1, 0, 0], [0, 1, 0], [0, 0, -1]],
    [[0, 1, 0], [0, 0, 1], [1, 0, 0]], [[0, -1, 0], [0, 0, -1], [1, 0, 0]],
    [[0, 0, 1], [1, 0, 0], [0, 1, 0]], [[0, 0, -1], [-1, 0, 0], [0, 1, 0]],
  ];
  for (const [n, u, v] of faces) {
    const idx = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([a, c]) => g.vertex(
      n[0] * 0.5 + (u[0] * a + v[0] * c) * h, n[1] * 0.5 + (u[1] * a + v[1] * c) * h, n[2] * 0.5 + (u[2] * a + v[2] * c) * h,
      n[0], n[1], n[2], color));
    g.quad(idx[0], idx[1], idx[2], idx[3]);
  }
  // edge chamfers
  const axes = [[1, 0, 0], [0, 1, 0], [0, 0, 1]];
  for (let ax = 0; ax < 3; ax++) {
    const o1 = (ax + 1) % 3, o2 = (ax + 2) % 3;
    for (const s1 of steps) for (const s2 of steps) {
      const quad = [];
      for (const [e, which] of [[-1, 0], [1, 0], [1, 1], [-1, 1]]) {
        const p = [0, 0, 0];
        p[ax] = e * h;
        if (which === 0) { p[o1] = s1 * 0.5; p[o2] = s2 * h; } else { p[o1] = s1 * h; p[o2] = s2 * 0.5; }
        const n = [0, 0, 0]; n[o1] = s1; n[o2] = s2;
        const l = Math.SQRT2;
        quad.push(g.vertex(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, color));
      }
      g.quad(quad[0], quad[1], quad[2], quad[3]);
    }
  }
  // corner triangles
  for (const [x, y, z] of corner) {
    const n = [x, y, z].map((c) => c / Math.sqrt(3));
    const a = g.vertex(x * 0.5, y * h, z * h, ...n, color);
    const c2 = g.vertex(x * h, y * 0.5, z * h, ...n, color);
    const c3 = g.vertex(x * h, y * h, z * 0.5, ...n, color);
    g.tri(a, c2, c3);
  }
  void b; void axes;
  return g;
}

export function sphere(color = TINT, seg = 28, rings = 18) {
  const prof = [];
  for (let i = 0; i <= rings; i++) {
    const a = -Math.PI / 2 + (i / rings) * Math.PI;
    prof.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5]);
  }
  prof[0][0] = 0; prof[rings][0] = 0;
  return lathe(prof, seg, color);
}

export function icosphere(detail = 1, color = TINT) {
  const t = (1 + Math.sqrt(5)) / 2;
  const verts = [[-1, t, 0], [1, t, 0], [-1, -t, 0], [1, -t, 0], [0, -1, t], [0, 1, t], [0, -1, -t], [0, 1, -t], [t, 0, -1], [t, 0, 1], [-t, 0, -1], [-t, 0, 1]]
    .map((v) => { const l = Math.hypot(...v); return v.map((x) => x / l); });
  let faces = [[0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11], [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8], [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9], [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1]];
  for (let d = 0; d < detail; d++) {
    const cache = new Map();
    const mid = (a, b) => {
      const key = a < b ? `${a}_${b}` : `${b}_${a}`;
      if (cache.has(key)) return cache.get(key);
      const m = verts[a].map((v, i) => (v + verts[b][i]) / 2);
      const l = Math.hypot(...m);
      verts.push(m.map((x) => x / l));
      cache.set(key, verts.length - 1);
      return verts.length - 1;
    };
    faces = faces.flatMap(([a, b, c]) => {
      const ab = mid(a, b), bc = mid(b, c), ca = mid(c, a);
      return [[a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]];
    });
  }
  const g = new Geo();
  for (const v of verts) g.vertex(v[0] * 0.5, v[1] * 0.5, v[2] * 0.5, v[0], v[1], v[2], color);
  for (const f of faces) g.tri(f[0], f[1], f[2]);
  return g;
}

export const cylinder = (color = TINT, seg = 24) => lathe([[0, -0.5], [0.5, -0.5], [0.5, -0.5], [0.5, 0.5], [0.5, 0.5], [0, 0.5]], seg, color);
export const cone = (color = TINT, seg = 24) => lathe([[0, -0.5], [0.5, -0.5], [0.5, -0.5], [0, 0.5]], seg, color);

export function capsule(aspect = 2, color = TINT) {
  const half = Math.max(0, aspect - 1) / 2;
  const prof = [];
  for (let i = 0; i <= 8; i++) { const a = -Math.PI / 2 + (i / 8) * (Math.PI / 2); prof.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5 - half]); }
  for (let i = 0; i <= 8; i++) { const a = (i / 8) * (Math.PI / 2); prof.push([Math.cos(a) * 0.5, Math.sin(a) * 0.5 + half]); }
  prof[0][0] = 0; prof[prof.length - 1][0] = 0;
  return lathe(prof, 24, color);
}

export function torus(color = TINT, seg = 40, tube = 14) {
  const g = new Geo();
  const R = 0.38, r = 0.12, zs = 0.5 / r;
  for (let i = 0; i <= seg; i++) {
    const u = (i / seg) * Math.PI * 2;
    for (let j = 0; j <= tube; j++) {
      const v = (j / tube) * Math.PI * 2;
      const nx = Math.cos(v) * Math.cos(u), ny = Math.cos(v) * Math.sin(u), nz = Math.sin(v) / zs;
      const l = Math.hypot(nx, ny, nz);
      g.vertex((R + r * Math.cos(v)) * Math.cos(u), (R + r * Math.cos(v)) * Math.sin(u), r * Math.sin(v) * zs, nx / l, ny / l, nz / l, color);
    }
  }
  for (let i = 0; i < seg; i++) {
    for (let j = 0; j < tube; j++) {
      const a = i * (tube + 1) + j, b = a + tube + 1;
      g.quad(a, b, b + 1, a + 1);
    }
  }
  return g;
}

export function coin(color = TINT) {
  const g = lathe([[0, -0.5], [0.4, -0.5], [0.4, -0.5], [0.44, -0.36], [0.5, -0.3], [0.5, 0.3], [0.44, 0.36], [0.4, 0.5], [0.4, 0.5], [0, 0.5]], 36, color);
  return new Geo().merge(g, T.rotX(Math.PI / 2));
}

export function star(color = TINT, points = 5) {
  const g = new Geo();
  const outline = [];
  for (let i = 0; i < points * 2; i++) {
    const a = Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const r = i % 2 === 0 ? 0.5 : 0.22;
    outline.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  for (const side of [1, -1]) {
    const c = g.vertex(0, 0, 0.5 * side, 0, 0, side, color);
    const ring = outline.map(([x, y]) => g.vertex(x, y, 0.15 * side, 0, 0, side, color));
    for (let i = 0; i < ring.length; i++) g.tri(c, ring[i], ring[(i + 1) % ring.length]);
  }
  for (let i = 0; i < outline.length; i++) {
    const [x0, y0] = outline[i], [x1, y1] = outline[(i + 1) % outline.length];
    const nx = y1 - y0, ny = -(x1 - x0), l = Math.hypot(nx, ny);
    const a = g.vertex(x0, y0, 0.15, nx / l, ny / l, 0, color), b = g.vertex(x1, y1, 0.15, nx / l, ny / l, 0, color);
    const c = g.vertex(x1, y1, -0.15, nx / l, ny / l, 0, color), d = g.vertex(x0, y0, -0.15, nx / l, ny / l, 0, color);
    g.quad(a, b, c, d);
  }
  return g.flat();
}

export const pyramid = (color = TINT) => lathe([[0, -0.5], [0.7071, -0.5], [0.7071, -0.5], [0, 0.5]], 4, color, Math.PI / 4).flat();
export const gem = (color = TINT) => lathe([[0, -0.5], [0.5, 0.12], [0.5, 0.12], [0.32, 0.5], [0.32, 0.5], [0, 0.5]], 10, color).flat();
export const crystal = (color = TINT) => lathe([[0, -0.5], [0.36, -0.5], [0.36, -0.5], [0.5, 0.18], [0.5, 0.18], [0, 0.5]], 6, color).flat();

/** Subdivided plane in XZ, centered, size 1. */
export function grid(res = 64) {
  const g = new Geo();
  for (let z = 0; z <= res; z++) for (let x = 0; x <= res; x++) g.vertex(x / res - 0.5, 0, z / res - 0.5, 0, 1, 0);
  for (let z = 0; z < res; z++) for (let x = 0; x < res; x++) {
    const a = z * (res + 1) + x;
    g.quad(a, a + res + 1, a + res + 2, a + 1);
  }
  return g;
}

/**
 * Terrain chunk: a (quads x quads) grid in texel units, displaced on the GPU
 * from the heightmap. `step` skips texels for distant LODs. Skirts (y = -1)
 * hide cracks between chunks of different LOD.
 */
export function terrainChunk(quads = 32, step = 1) {
  const g = new Geo();
  const n = quads / step;
  const idx = (x, z) => z * (n + 1) + x;
  for (let z = 0; z <= n; z++) for (let x = 0; x <= n; x++) g.vertex(x * step, 0, z * step, 0, 1, 0);
  for (let z = 0; z < n; z++) for (let x = 0; x < n; x++) {
    // consistent diagonal so the CPU collision surface matches the rendered one exactly
    const a = idx(x, z), b = idx(x + 1, z), c = idx(x + 1, z + 1), d = idx(x, z + 1);
    g.indices.push(a, c, b, a, d, c);
  }
  const edge = (pts) => {
    const base = g.vertexCount;
    for (const [x, z] of pts) { g.vertex(x * step, 0, z * step, 0, 1, 0); g.vertex(x * step, -1, z * step, 0, 1, 0); }
    for (let i = 0; i < pts.length - 1; i++) {
      const a = base + i * 2, b = base + i * 2 + 1, c = base + i * 2 + 3, d = base + i * 2 + 2;
      g.indices.push(a, b, c, a, c, d, a, c, b, a, d, c); // double sided
    }
  };
  const line = (fn) => Array.from({ length: n + 1 }, (_, i) => fn(i));
  edge(line((i) => [i, 0])); edge(line((i) => [i, n])); edge(line((i) => [0, i])); edge(line((i) => [n, i]));
  // Skip fixWinding (normals are placeholders; the GPU recomputes them).
  const buf = g;
  buf.fixWinding = () => buf;
  return buf.finish();
}

// ---------------------------------------------------------------- scatter props (stand on y = 0)

const BARK = [0.24, 0.17, 0.11, 0];
const STEM = [0.22, 0.42, 0.14, 0];
const ATLAS = { broadleaf: [0, 0], needles: [0.5, 0], palm: [0, 0.5], shrub: [0.5, 0.5] };

const vAdd = (a, b) => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
const vSub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const vScale = (a, s) => [a[0] * s, a[1] * s, a[2] * s];
const vNorm = (a) => { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; };
const vCross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const vMix = (a, b, t) => [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t];

/** Tapered branch/trunk segment from p0 to p1 (smooth, bark coloured). */
function limb(g, p0, p1, r0, r1, sides = 7, color = BARK) {
  const axis = vNorm(vSub(p1, p0));
  const ref = Math.abs(axis[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0];
  const t1 = vNorm(vCross(axis, ref));
  const t2 = vCross(axis, t1);
  const base = g.vertexCount;
  for (const [p, r] of [[p0, r0], [p1, r1]]) {
    for (let i = 0; i <= sides; i++) {
      const a = (i / sides) * Math.PI * 2;
      const n = vAdd(vScale(t1, Math.cos(a)), vScale(t2, Math.sin(a)));
      const q = vAdd(p, vScale(n, r));
      g.vertex(q[0], q[1], q[2], n[0], n[1], n[2], color, 0, 0);
    }
  }
  for (let i = 0; i < sides; i++) g.quad(base + i, base + i + 1, base + sides + 2 + i, base + sides + 1 + i);
}

/**
 * Alpha-tested foliage card. `normalFrom` is the crown centre: card normals are
 * bent away from it so the whole canopy shades like one soft volume.
 */
function card(g, center, uAxis, vAxis, halfU, halfV, tile, normalFrom, bend = 0.75, segments = 1, droop = 0) {
  const [tu, tv] = ATLAS[tile];
  const face = vNorm(vCross(uAxis, vAxis));
  const base = g.vertexCount;
  for (let s = 0; s <= segments; s++) {
    const f = segments === 1 ? s : s / segments;
    const along = (f * 2 - 1) * halfU;
    const sag = droop * f * f;
    for (const side of [-1, 1]) {
      const p = vAdd(vAdd(center, vScale(uAxis, along)), vAdd(vScale(vAxis, side * halfV), [0, -sag, 0]));
      const radial = vNorm(vSub(p, normalFrom));
      const n = vNorm(vMix(face, radial, bend));
      g.vertex(p[0], p[1], p[2], n[0], n[1], n[2], [1, 1, 1, 1], tu + f * 0.5, tv + (side < 0 ? 0 : 0.5));
    }
  }
  for (let s = 0; s < segments; s++) {
    const i = base + s * 2;
    g.indices.push(i, i + 2, i + 3, i, i + 3, i + 1);
  }
}

function randomUnit(rng) {
  const z = rng.range(-1, 1), a = rng.range(0, Math.PI * 2), r = Math.sqrt(1 - z * z);
  return [r * Math.cos(a), z, r * Math.sin(a)];
}

function broadleafTree(rng, lod) {
  const g = new Geo();
  const H = rng.range(4.2, 5.6);
  const lean = [rng.range(-0.25, 0.25), 1, rng.range(-0.25, 0.25)];
  const top = vScale(vNorm(lean), H);
  limb(g, [0, -0.3, 0], [top[0] * 0.5, H * 0.5, top[2] * 0.5], 0.36, 0.27, 9);
  limb(g, [top[0] * 0.5, H * 0.5, top[2] * 0.5], top, 0.27, 0.16, 8);
  const crown = [top[0], H + 1.7, top[2]];
  const clusters = [];
  const branches = 6 + rng.int(0, 2);
  for (let b = 0; b < branches; b++) {
    const a = (b / branches) * Math.PI * 2 + rng.range(-0.3, 0.3);
    const elev = rng.range(0.45, 1.0);
    const dir = vNorm([Math.cos(a) * Math.cos(elev), Math.sin(elev), Math.sin(a) * Math.cos(elev)]);
    const start = vMix([0, 0, 0], top, rng.range(0.6, 0.95));
    const len = rng.range(2.0, 2.9);
    const end = vAdd(start, vScale(dir, len));
    limb(g, start, end, 0.13, 0.05, 6);
    clusters.push(end, vMix(start, end, 0.6));
    for (let k = 0; k < 2; k++) {
      const sub = vNorm(vAdd(dir, vScale(randomUnit(rng), 0.8)));
      const s0 = vMix(start, end, rng.range(0.45, 0.8));
      const s1 = vAdd(s0, vScale(sub, rng.range(0.9, 1.5)));
      if (lod === 0) limb(g, s0, s1, 0.05, 0.02, 5);
      clusters.push(s1);
    }
  }
  clusters.push(vAdd(crown, [0, 1.2, 0]), crown);
  const perCluster = lod === 0 ? 7 : 3;
  const size = lod === 0 ? 1.0 : 1.45;
  for (const c of clusters) {
    for (let k = 0; k < perCluster; k++) {
      const p = vAdd(c, vScale(randomUnit(rng), 0.55));
      const n = vNorm(vAdd(vNorm(vSub(p, crown)), vScale(randomUnit(rng), 0.9)));
      const u = vNorm(vCross(n, Math.abs(n[1]) > 0.9 ? [1, 0, 0] : [0, 1, 0]));
      const v = vCross(n, u);
      const sc = size * rng.range(0.8, 1.2);
      card(g, p, u, v, sc, sc, 'broadleaf', crown);
    }
  }
  return g;
}

function conifer(rng, lod) {
  const g = new Geo();
  const H = rng.range(8.5, 11.5);
  const bark = [0.2, 0.14, 0.1, 0];
  limb(g, [0, -0.3, 0], [0, H * 0.55, 0], 0.32, 0.2, 8, bark);
  limb(g, [0, H * 0.55, 0], [0, H, 0], 0.2, 0.04, 7, bark);
  const start = 1.1;
  const step = lod === 0 ? 0.4 : 0.62;
  let whorl = 0;
  for (let y = start; y < H - 0.3; y += step * rng.range(0.85, 1.15)) {
    const f = (y - start) / (H - start);
    const len = Math.pow(1 - f, 0.9) * 3.1 + 0.35;
    const n = lod === 0 ? 6 : 4;
    for (let b = 0; b < n; b++) {
      const a = (b / n) * Math.PI * 2 + whorl * 0.7 + rng.range(-0.25, 0.25);
      const droop = rng.range(0.12, 0.35);
      const dir = vNorm([Math.cos(a), -droop, Math.sin(a)]);
      const center = vAdd([0, y, 0], vScale(dir, len * 0.5));
      const across = vNorm(vCross(dir, [0, 1, 0]));
      const up = vNorm(vCross(across, dir));
      const tilt = vNorm(vAdd(across, vScale(up, rng.range(-0.25, 0.35))));
      const axis = [0, y + 0.8, 0];
      card(g, center, dir, tilt, len * 0.55, len * 0.42 + 0.3, 'needles', axis, 0.6, 2, len * 0.12);
      if (f < 0.8) card(g, center, dir, vNorm(vAdd(up, vScale(across, 0.3))), len * 0.52, len * 0.24 + 0.2, 'needles', axis, 0.6, 1);
    }
    whorl++;
  }
  for (let k = 0; k < 3; k++) {
    const a = (k / 3) * Math.PI;
    card(g, [0, H - 0.2, 0], [0, 1, 0], [Math.cos(a), 0, Math.sin(a)], 0.7, 0.35, 'needles', [0, H - 1, 0], 0.4);
  }
  return g;
}

function palmTree(rng, lod) {
  const g = new Geo();
  let x = 0, y = 0;
  const lean = rng.range(0.15, 0.4);
  const segs = 7;
  let prev = [0, -0.3, 0];
  for (let i = 0; i < segs; i++) {
    const h = 0.95;
    x += Math.sin(lean * (i / segs)) * h;
    y += Math.cos(lean * (i / segs)) * h * 0.97;
    const shade = i % 2 ? 1 : 0.85;
    limb(g, prev, [x, y, 0], 0.26 - i * 0.012, 0.24 - i * 0.012, 8, [0.42 * shade, 0.33 * shade, 0.22 * shade, 0]);
    prev = [x, y, 0];
  }
  const crown = [x, y + 0.3, 0];
  const fronds = lod === 0 ? 11 : 7;
  for (let i = 0; i < fronds; i++) {
    const a = (i / fronds) * Math.PI * 2 + rng.range(-0.2, 0.2);
    const up = rng.range(0.05, 0.45);
    const dir = vNorm([Math.cos(a), up, Math.sin(a)]);
    const len = rng.range(2.6, 3.4);
    const center = vAdd(crown, vScale(dir, len * 0.5));
    const across = vNorm(vCross(dir, [0, 1, 0]));
    const flat = vNorm(vAdd(across, [0, 0.15, 0]));
    card(g, center, dir, flat, len * 0.5, 0.75, 'palm', vAdd(crown, [0, -0.6, 0]), 0.5, 4, len * 0.45);
  }
  return g;
}

function shrub(rng, lod) {
  const g = new Geo();
  const center = [0, 0.55, 0];
  const n = lod === 0 ? 14 : 6;
  for (let k = 0; k < n; k++) {
    const d = randomUnit(rng);
    const p = vAdd(center, [d[0] * 0.45, Math.abs(d[1]) * 0.35, d[2] * 0.45]);
    const nrm = vNorm(vAdd(vNorm(vSub(p, [0, 0, 0])), vScale(randomUnit(rng), 0.6)));
    const u = vNorm(vCross(nrm, [0, 1, 0]));
    const v = vCross(nrm, u);
    const sc = rng.range(0.45, 0.65) * (lod === 0 ? 1 : 1.4);
    card(g, p, u, v, sc, sc, 'shrub', [0, 0.2, 0], 0.7);
  }
  return g;
}

function rock(rng, _lod, noise) {
  const g = icosphere(3);
  const sx = rng.range(0.8, 1.3), sy = rng.range(0.5, 0.9), sz = rng.range(0.8, 1.3);
  const off = rng.range(0, 100);
  const shaped = new Geo().merge(g, (p) => {
    const d = 1 + noise(p[0] * 2.2 + off, p[2] * 2.2 + p[1] * 1.7) * 0.25 + noise(p[0] * 7 + off, p[1] * 7 - p[2] * 3) * 0.06;
    p[0] *= sx * d * 2; p[1] = Math.max(p[1] * sy * d * 2, -0.25); p[2] *= sz * d * 2;
    p[1] += 0.2;
  });
  // recompute smooth normals from the displaced surface
  const N = new Array(shaped.normals.length).fill(0);
  const P = shaped.positions, I = shaped.indices;
  for (let t = 0; t < I.length; t += 3) {
    const [a, b, c] = [I[t], I[t + 1], I[t + 2]];
    const e1 = [P[b * 3] - P[a * 3], P[b * 3 + 1] - P[a * 3 + 1], P[b * 3 + 2] - P[a * 3 + 2]];
    const e2 = [P[c * 3] - P[a * 3], P[c * 3 + 1] - P[a * 3 + 1], P[c * 3 + 2] - P[a * 3 + 2]];
    let fn = vCross(e1, e2);
    const outward = [P[a * 3], P[a * 3 + 1] - 0.2, P[a * 3 + 2]];
    if (fn[0] * outward[0] + fn[1] * outward[1] + fn[2] * outward[2] < 0) fn = vScale(fn, -1);
    for (const v of [a, b, c]) { N[v * 3] += fn[0]; N[v * 3 + 1] += fn[1]; N[v * 3 + 2] += fn[2]; }
  }
  for (let v = 0; v < N.length; v += 3) {
    const l = Math.hypot(N[v], N[v + 1], N[v + 2]) || 1;
    shaped.normals[v] = N[v] / l; shaped.normals[v + 1] = N[v + 1] / l; shaped.normals[v + 2] = N[v + 2] / l;
  }
  return shaped;
}

function crystalCluster(rng) {
  const g = new Geo();
  const n = rng.int(3, 6);
  for (let i = 0; i < n; i++) {
    const h = i === 0 ? rng.range(1.6, 2.4) : rng.range(0.7, 1.5);
    const w = h * 0.3;
    const a = rng.range(0, Math.PI * 2);
    const tilt = i === 0 ? rng.range(-0.1, 0.1) : rng.range(0.3, 0.75);
    g.merge(crystal(), T.chain(T.scale(w, h, w), T.translate(0, h / 2 - 0.1, 0), T.rotZ(tilt), T.rotY(a)));
  }
  return g;
}

function cactus(rng) {
  const g = new Geo();
  const h = rng.range(2.2, 3.2);
  const ribbed = (aspect) => {
    const c = capsule(aspect);
    return new Geo().merge(c, (p) => { const a = Math.atan2(p[2], p[0]); const k = 1 + Math.cos(a * 10) * 0.05; p[0] *= k; p[2] *= k; });
  };
  g.merge(ribbed(h / 0.55), T.chain(T.scale(0.55, 0.55, 0.55), T.translate(0, h / 2, 0)));
  for (const side of [1, -1]) {
    if (rng.float() < 0.25) continue;
    const ay = rng.range(0.9, 1.6), ah = rng.range(0.7, 1.1);
    g.merge(capsule(2), T.chain(T.scale(0.32, 0.32, 0.32), T.rotZ(Math.PI / 2), T.translate(side * 0.45, ay, 0)));
    g.merge(ribbed(ah / 0.34), T.chain(T.scale(0.34, 0.34, 0.34), T.translate(side * 0.75, ay + ah / 2, 0)));
  }
  return g;
}

function mushroom(rng) {
  const g = new Geo();
  const h = rng.range(0.6, 1.2);
  const cream = [0.9, 0.86, 0.76, 0];
  g.merge(lathe([[0, 0], [0.14, 0], [0.14, 0], [0.1, h], [0.1, h], [0, h]], 12, cream));
  g.merge(lathe([[0, h - 0.05], [0.56, h - 0.05], [0.56, h - 0.05], [0.52, h + 0.12], [0.38, h + 0.3], [0.17, h + 0.41], [0, h + 0.43]], 20));
  for (let i = 0; i < 7; i++) {
    const a = rng.range(0, Math.PI * 2), r = rng.range(0.16, 0.4);
    g.merge(icosphere(1, [1, 1, 0.95, 0]), T.chain(T.scale(0.09, 0.05, 0.09), T.translate(Math.cos(a) * r, h + 0.37 - r * 0.45, Math.sin(a) * r)));
  }
  return g;
}

function pillar(rng) {
  const g = new Geo();
  const h = rng.range(3, 5.5);
  const broken = rng.float() < 0.4;
  const top = broken ? h * rng.range(0.4, 0.8) : h;
  g.merge(roundedBox(TINT, 0.05), T.chain(T.scale(1.3, 0.35, 1.3), T.translate(0, 0.175, 0)));
  const fluted = lathe([[0, 0], [0.42, 0], [0.42, 0], [0.37, top], [0.37, top], [0, top]], 20);
  g.merge(new Geo().merge(fluted, (p) => { const a = Math.atan2(p[2], p[0]); const k = 1 - Math.pow(Math.abs(Math.cos(a * 8)), 3) * 0.06; if (p[1] > 0.01 && p[1] < top - 0.01) { p[0] *= k; p[2] *= k; } }), T.translate(0, 0.35, 0));
  if (!broken) g.merge(roundedBox(TINT, 0.05), T.chain(T.scale(1.15, 0.3, 1.15), T.translate(0, top + 0.5, 0)));
  return g;
}

/**
 * Scatter catalogue. `kind` is the shading model (see mesh.js), `lods` lists
 * distance bands, `alpha` marks alpha-tested double-sided foliage cards.
 */
export const SCATTER = {
  oak: { variants: 3, lods: [0, 55], kind: 4, alpha: true, wind: 1, scale: [0.85, 1.25], build: broadleafTree },
  pine: { variants: 3, lods: [0, 60], kind: 4, alpha: true, wind: 0.7, scale: [0.8, 1.3], build: conifer },
  palm: { variants: 3, lods: [0, 60], kind: 4, alpha: true, wind: 1.2, scale: [0.85, 1.2], build: palmTree },
  flower: { variants: 2, lods: [0, 30], kind: 4, alpha: true, wind: 1.5, scale: [0.7, 1.3], build: shrub },
  rock: { variants: 4, lods: [0], kind: 5, alpha: false, wind: 0, scale: [0.5, 1.9], build: rock },
  crystal: { variants: 3, lods: [0], kind: 0, alpha: false, wind: 0, scale: [0.7, 1.4], build: crystalCluster },
  cactus: { variants: 3, lods: [0], kind: 3, alpha: false, wind: 0.15, scale: [0.8, 1.3], build: cactus },
  mushroom: { variants: 3, lods: [0], kind: 3, alpha: false, wind: 0.2, scale: [0.6, 1.8], build: mushroom },
  pillar: { variants: 3, lods: [0], kind: 5, alpha: false, wind: 0, scale: [0.8, 1.2], build: pillar },
};
export const SCATTER_VARIANTS = Object.fromEntries(Object.entries(SCATTER).map(([k, v]) => [k, v.variants]));

export function scatterMesh(kind, variant, lod = 0) {
  const rng = new Rng(1000 + variant * 7919 + kind.length * 31);
  const noise = createNoise2D(77 + variant);
  const g = SCATTER[kind].build(rng, lod, noise);
  return g.finish();
}

// ---------------------------------------------------------------- shapes for prefabs

const SHAPE_BUILDERS = {
  box: () => roundedBox(TINT, 0.03), sphere: () => sphere(), cylinder: () => cylinder(), cone: () => cone(),
  torus: () => torus(), gem: () => gem(), coin: () => coin(), star: () => star(), pyramid: () => pyramid(),
  crystal: () => crystal(),
};

/**
 * Resolve a prefab shape + size to a mesh key, builder and instance scale.
 * Capsules get aspect-specific meshes so their caps stay round.
 */
export function shapeMesh(shape, size) {
  if (shape === 'capsule') {
    const aspect = Math.max(1, Math.round((size[1] / Math.max(size[0], size[2], 0.01)) * 5) / 5);
    return { key: `capsule:${aspect}`, build: () => capsule(aspect).finish(), scale: [size[0], size[1] / aspect, size[2]] };
  }
  const build = SHAPE_BUILDERS[shape] ?? SHAPE_BUILDERS.box;
  return { key: `shape:${shape}`, build: () => build().finish(), scale: size };
}

/** The player avatar: a friendly capsule with a glowing visor. Stands on y = 0. */
export function avatarMesh() {
  const g = new Geo();
  g.merge(capsule(1.8), T.chain(T.scale(0.8, 1, 0.8), T.translate(0, 0.9, 0)));
  const visor = [0.02, 0.05, 0.08, 0];
  g.merge(capsule(2.2, visor), T.chain(T.scale(0.22, 0.26, 0.3), T.rotZ(Math.PI / 2), T.translate(0, 1.3, 0.3)));
  g.merge(roundedBox([0.85, 0.85, 0.85, 1], 0.1), T.chain(T.scale(0.5, 0.55, 0.22), T.translate(0, 0.95, -0.42)));
  return g.finish();
}

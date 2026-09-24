// Procedural geometry. Every asset in Reverie is generated from code, so a
// whole game ships as a few KB of JSON: no downloads, no asset pipeline.
//
// Conventions: primitives fit the unit cube [-0.5, 0.5]^3 so a prefab's
// `size` maps directly onto its bounding box. Scatter props stand on y = 0.
// Vertex color alpha: 1 = tinted by the instance color, 0 = fixed color.

import { Rng } from '../../shared/rng.js';
import { createNoise2D } from '../../shared/noise.js';

const TINT = [1, 1, 1, 1];
export const VERTEX_STRIDE = 28; // position f32x3, normal f32x3, color unorm8x4

export class Geo {
  constructor() { this.positions = []; this.normals = []; this.colors = []; this.indices = []; }
  get vertexCount() { return this.positions.length / 3; }

  vertex(x, y, z, nx, ny, nz, c = TINT) {
    this.positions.push(x, y, z);
    this.normals.push(nx, ny, nz);
    this.colors.push(c[0], c[1], c[2], c[3] ?? 1);
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
      this.vertex(p[0], p[1], p[2], n[0] / l, n[1] / l, n[2] / l, c);
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
      const v = ids.map((i, k) => out.vertex(...[a, b, c][k], ...n, C.slice(i * 4, i * 4 + 4)));
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
    let radius = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 7;
      const x = this.positions[i * 3], y = this.positions[i * 3 + 1], z = this.positions[i * 3 + 2];
      f[o] = x; f[o + 1] = y; f[o + 2] = z;
      f[o + 3] = this.normals[i * 3]; f[o + 4] = this.normals[i * 3 + 1]; f[o + 5] = this.normals[i * 3 + 2];
      for (let k = 0; k < 4; k++) u8[i * VERTEX_STRIDE + 24 + k] = Math.round(Math.min(1, Math.max(0, this.colors[i * 4 + k])) * 255);
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

const BARK = [0.26, 0.17, 0.1, 0];
const STEM = [0.22, 0.42, 0.14, 0];

function pine(rng) {
  const g = new Geo();
  g.merge(cylinder(BARK, 8), T.chain(T.scale(0.26, 1.0, 0.26), T.translate(0, 0.5, 0)));
  const tiers = 4 + (rng.float() < 0.5 ? 1 : 0);
  for (let i = 0; i < tiers; i++) {
    const r = 2.0 - i * 0.36, h = 1.5 - i * 0.12, y = 0.8 + i * 0.8;
    const shade = 0.7 + i * 0.07;
    const skirt = lathe([[0, 0], [0.5, 0], [0.5, 0], [0.42, 0.12], [0.2, 0.55], [0, 1]], 11, [shade, shade, shade, 1], rng.range(0, 6));
    g.merge(skirt, T.chain(T.scale(r, h, r), T.translate(0, y, 0)));
  }
  return g.flat();
}

function oak(rng, noise) {
  const g = new Geo();
  g.merge(cylinder(BARK, 9), T.chain(T.scale(0.34, 2.2, 0.34), T.translate(0, 1.1, 0)));
  g.merge(cylinder(BARK, 7), T.chain(T.scale(0.16, 1.2, 0.16), T.rotZ(0.7), T.translate(0.38, 2.0, 0)));
  g.merge(cylinder(BARK, 7), T.chain(T.scale(0.14, 1.1, 0.14), T.rotZ(-0.6), T.rotY(2.2), T.translate(-0.25, 2.1, 0.2)));
  const blobs = [[0, 3.1, 0, 1.45], [0.9, 2.7, 0.3, 1.0], [-0.8, 2.8, -0.2, 1.05], [0.1, 3.8, -0.5, 0.95], [0.2, 2.8, 0.9, 0.9], [-0.4, 3.4, 0.6, 0.85]];
  for (const [x, y, z, r] of blobs) {
    const shade = 0.75 + rng.range(0, 0.25);
    g.merge(icosphere(2, [shade, shade, shade, 1]), (p) => {
      const d = 1 + noise(p[0] * 3 + x, p[2] * 3 + y + p[1]) * 0.22;
      p[0] = p[0] * 2 * r * d + x; p[1] = p[1] * 2 * r * d * 0.85 + y; p[2] = p[2] * 2 * r * d + z;
    });
  }
  return g.flat();
}

function palm(rng) {
  const g = new Geo();
  let x = 0, y = 0;
  const lean = rng.range(0.15, 0.35);
  const segs = 7;
  for (let i = 0; i < segs; i++) {
    const h = 0.7;
    const r = 0.22 - i * 0.012;
    const shade = i % 2 ? 1 : 0.82;
    g.merge(lathe([[0, 0], [r * 1.15, 0], [r * 1.15, 0], [r, h], [r, h], [0, h]], 8, [BARK[0] * 1.6 * shade, BARK[1] * 1.6 * shade, BARK[2] * 1.5 * shade, 0]),
      T.chain(T.rotZ(-lean * (i / segs)), T.translate(x, y, 0)));
    x += Math.sin(lean * (i / segs)) * h;
    y += Math.cos(lean * (i / segs)) * h * 0.97;
  }
  const leaves = 8;
  for (let i = 0; i < leaves; i++) {
    const a = (i / leaves) * Math.PI * 2 + rng.range(0, 0.4);
    const leaf = new Geo();
    const len = rng.range(2.0, 2.6);
    const pts = 8;
    for (let k = 0; k <= pts; k++) {
      const t = k / pts;
      const w = Math.sin(t * Math.PI) * 0.38 + 0.02;
      const ly = 0.45 * Math.sin(t * Math.PI * 0.8) - t * t * 1.2;
      const shade = 0.72 + 0.28 * t;
      leaf.vertex(t * len, ly, w, 0, 1, 0, [shade, shade, shade, 1]);
      leaf.vertex(t * len, ly + 0.08, 0, 0, 1, 0, [shade, shade, shade, 1]);
      leaf.vertex(t * len, ly, -w, 0, 1, 0, [shade, shade, shade, 1]);
    }
    for (let k = 0; k < pts; k++) {
      const a0 = k * 3;
      leaf.quad(a0, a0 + 1, a0 + 4, a0 + 3);
      leaf.quad(a0 + 1, a0 + 2, a0 + 5, a0 + 4);
    }
    const back = new Geo().merge(leaf, (p, n) => { n[1] = -1; });
    leaf.merge(back);
    g.merge(leaf, T.chain(T.rotY(a), T.translate(x, y, 0)));
  }
  return g.flat();
}

function rock(rng, noise) {
  const g = icosphere(3);
  const sx = rng.range(0.8, 1.3), sy = rng.range(0.5, 0.9), sz = rng.range(0.8, 1.3);
  const off = rng.range(0, 100);
  const out = new Geo().merge(g, (p) => {
    const d = 1 + noise(p[0] * 2.2 + off, p[2] * 2.2 + p[1] * 1.7) * 0.25 + noise(p[0] * 7 + off, p[1] * 7 - p[2] * 3) * 0.06;
    p[0] *= sx * d * 2; p[1] = Math.max(p[1] * sy * d * 2, -0.25); p[2] *= sz * d * 2;
    p[1] += 0.2;
  });
  return out.flat();
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

function flower(rng) {
  const g = new Geo();
  const h = rng.range(0.35, 0.6);
  g.merge(cylinder(STEM, 5), T.chain(T.scale(0.04, h, 0.04), T.translate(0, h / 2, 0)));
  const petals = 6;
  for (let i = 0; i < petals; i++) {
    const a = (i / petals) * Math.PI * 2;
    g.merge(sphere(TINT, 8, 5), T.chain(T.scale(0.17, 0.04, 0.09), T.translate(0.1, 0, 0), T.rotZ(0.25), T.rotY(a), T.translate(0, h, 0)));
  }
  g.merge(sphere([1, 0.82, 0.2, 0], 8, 5), T.chain(T.scale(0.09, 0.07, 0.09), T.translate(0, h + 0.02, 0)));
  return g;
}

const SCATTER_BUILDERS = { pine, oak, palm, rock, crystal: crystalCluster, cactus, mushroom, pillar, flower };
/** Visual variations built per scatter kind (grass is rendered by the GPU grass system). */
export const SCATTER_VARIANTS = { pine: 3, oak: 3, palm: 3, rock: 4, crystal: 3, cactus: 3, mushroom: 3, pillar: 3, flower: 2 };

export function scatterMesh(kind, variant) {
  const rng = new Rng(1000 + variant * 7919 + kind.length * 31);
  const noise = createNoise2D(77 + variant);
  return SCATTER_BUILDERS[kind](rng, noise).finish();
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

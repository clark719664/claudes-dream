/**
 * Deterministic 3D value noise, sampled on the unit sphere so the planet has
 * no seam at the antimeridian and no distortion at the poles. Dependency-free
 * and reproducible from a seed alone.
 */

/** Hash three integer lattice coordinates and a seed into [0, 1). */
function hash3(x: number, y: number, z: number, seed: number): number {
  let h = seed >>> 0;
  h = Math.imul(h ^ (x | 0), 0x27d4eb2d);
  h = Math.imul(h ^ (y | 0), 0x165667b1);
  h = Math.imul(h ^ (z | 0), 0x9e3779b1);
  h ^= h >>> 15;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}

/** Smoothstep interpolant — C1 continuous, so no lattice creases. */
function fade(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Value noise in three dimensions. */
export function value3(x: number, y: number, z: number, seed: number): number {
  const xi = Math.floor(x), yi = Math.floor(y), zi = Math.floor(z);
  const xf = fade(x - xi), yf = fade(y - yi), zf = fade(z - zi);
  let acc = 0;
  for (let dz = 0; dz < 2; dz++) {
    const wz = dz ? zf : 1 - zf;
    for (let dy = 0; dy < 2; dy++) {
      const wy = dy ? yf : 1 - yf;
      for (let dx = 0; dx < 2; dx++) {
        const wx = dx ? xf : 1 - xf;
        acc += wx * wy * wz * hash3(xi + dx, yi + dy, zi + dz, seed);
      }
    }
  }
  return acc;
}

/** Fractal Brownian motion: octaves of value noise at halving amplitude. */
export function fbm(x: number, y: number, z: number, seed: number, octaves = 6, lacunarity = 2.0, gain = 0.5): number {
  let f = 1, a = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    sum += a * value3(x * f, y * f, z * f, seed + i * 1013);
    norm += a;
    f *= lacunarity;
    a *= gain;
  }
  return sum / norm;
}

/** Ridged noise — sharp crests, for mountain chains. */
export function ridged(x: number, y: number, z: number, seed: number, octaves = 5): number {
  let f = 1, a = 1, sum = 0, norm = 0;
  for (let i = 0; i < octaves; i++) {
    const n = 1 - Math.abs(value3(x * f, y * f, z * f, seed + i * 7919) * 2 - 1);
    sum += a * n * n;
    norm += a;
    f *= 2;
    a *= 0.5;
  }
  return sum / norm;
}

export interface Vec3 { x: number; y: number; z: number }

/** Longitude/latitude in radians to a point on the unit sphere. */
export function toSphere(lon: number, lat: number): Vec3 {
  const cl = Math.cos(lat);
  return { x: cl * Math.cos(lon), y: Math.sin(lat), z: cl * Math.sin(lon) };
}

export function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Points spread evenly over a sphere by the Fibonacci lattice. */
export function fibonacciSphere(n: number, jitterSeed: number): Vec3[] {
  const pts: Vec3[] = [];
  const golden = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < n; i++) {
    const y = 1 - (i / (n - 1)) * 2;
    const r = Math.sqrt(Math.max(0, 1 - y * y));
    const th = golden * i;
    const j = hash3(i, 7, 13, jitterSeed) * 0.18 - 0.09;
    pts.push({ x: Math.cos(th + j) * r, y, z: Math.sin(th + j) * r });
  }
  return pts;
}

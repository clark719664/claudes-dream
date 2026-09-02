/**
 * Deterministic PRNG (mulberry32). State lives in the World so a saved world
 * resumes with the same random stream.
 */
import type { World } from '../types.ts';

export interface RngState { s: number }

export function seedState(seed: number): RngState {
  return { s: (seed >>> 0) || 0x9e3779b9 };
}

/** Uniform float in [0, 1). */
export function rand(world: World): number {
  const st = world.rng;
  st.s = (st.s + 0x6d2b79f5) >>> 0;
  let t = st.s;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [lo, hi] inclusive. */
export function randInt(world: World, lo: number, hi: number): number {
  return lo + Math.floor(rand(world) * (hi - lo + 1));
}

export function chance(world: World, p: number): boolean {
  return rand(world) < p;
}

export function pick<T>(world: World, arr: readonly T[]): T {
  return arr[Math.floor(rand(world) * arr.length)];
}

/** Approximately normal via sum of uniforms, mean 0, sd 1. */
export function normal(world: World): number {
  let s = 0;
  for (let i = 0; i < 6; i++) s += rand(world);
  return (s - 3) / Math.sqrt(0.5);
}

export function shuffle<T>(world: World, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(world) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

/** Poisson-distributed count with the given mean (small means only). */
export function poisson(world: World, mean: number): number {
  const L = Math.exp(-mean);
  let k = 0;
  let p = 1;
  do {
    k++;
    p *= rand(world);
  } while (p > L);
  return k - 1;
}

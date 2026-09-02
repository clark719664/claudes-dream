import type { World } from '../types.ts';

/** Monotonic ids per prefix, stored in world.counters so they survive save/load. */
export function nextId(world: World, prefix: 'c' | 'b' | 'j' | 'k' | 'p' | 'l'): string {
  const n = (world.counters[prefix] ?? 0) + 1;
  world.counters[prefix] = n;
  return `${prefix}_${n}`;
}

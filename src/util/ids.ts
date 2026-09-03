import type { World } from '../types.ts';

/** Id prefixes: citizen, business, job, case, Watch report, proposal, loan, club, household, item, happening. */
export type IdPrefix = 'c' | 'b' | 'j' | 'k' | 'r' | 'p' | 'l' | 'u' | 'h' | 'i' | 'e';

/** Monotonic ids per prefix, stored in world.counters so they survive save/load. */
export function nextId(world: World, prefix: IdPrefix): string {
  const n = (world.counters[prefix] ?? 0) + 1;
  world.counters[prefix] = n;
  return `${prefix}_${n}`;
}

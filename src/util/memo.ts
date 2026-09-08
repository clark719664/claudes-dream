/**
 * The reading round.
 *
 * Once an hour the engine builds an observation for every citizen who can act
 * (`world/world.ts collectTurns`), and it does that before anybody acts: for
 * the length of that loop the city is only ever *read*. The same handful of
 * public facts — the job board, the register of deeds, the wall's loudest
 * posts, who is standing in each district — were being rebuilt from scratch
 * once per citizen, which is how a city of a hundred minds came to spend most
 * of its hour re-sorting the same lists a hundred times.
 *
 * `frozenRound` opens a stretch of engine time in which nothing changes, and
 * `memo` remembers a value for exactly that stretch. Outside a round — in a
 * test, over the HTTP API, in the middle of an action — `memo` computes every
 * time, so nothing is ever cached across a change to the city. The engine
 * opens exactly one round, around the observation loop, and closes it
 * synchronously before the first citizen acts.
 *
 * Rules for anything memoised here:
 *   - it must be a pure read of the world (no writes, no `rng`, no ids);
 *   - the value it returns must not be mutated by its callers.
 */
import type { World } from '../types.ts';

/** The open round's memory, or null when the city is not frozen. */
let cache: Map<string, unknown> | null = null;
/** Whose round it is: a memo for one world is never served to another. */
let owner: World | null = null;
/** Rounds nest (a round inside a round is the same round). */
let depth = 0;

/**
 * Run `fn` with the city frozen: every `memo` inside it computes once and is
 * remembered until it returns. The caller promises not to change the world
 * inside, and the round is closed however `fn` ends.
 */
export function frozenRound<T>(world: World, fn: () => T): T {
  if (depth === 0) {
    cache = new Map();
    owner = world;
  }
  depth += 1;
  try {
    return fn();
  } finally {
    depth -= 1;
    if (depth === 0) {
      cache = null;
      owner = null;
    }
  }
}

/** True while a reading round is open for this world. */
export function isFrozen(world: World): boolean {
  return cache !== null && owner === world;
}

/**
 * The value of `compute()` for this round, computed once. Outside a round it
 * is simply `compute()`: nothing is ever remembered across a change.
 */
export function memo<T>(world: World, key: string, compute: () => T): T {
  if (cache === null || owner !== world) return compute();
  const found = cache.get(key);
  if (found !== undefined || cache.has(key)) return found as T;
  const value = compute();
  cache.set(key, value);
  return value;
}

/**
 * The value of `compute()` for one subject, computed once a round. The same
 * question asked about a hundred citizens is one table with a hundred rows
 * rather than a hundred keys built out of string pieces: building the key was
 * itself among the costlier things the engine did every hour.
 */
export function memoBy<T>(world: World, table: string, subject: string, compute: () => T): T {
  const rows = memo(world, table, () => new Map<string, T>());
  const found = rows.get(subject);
  if (found !== undefined || rows.has(subject)) return found as T;
  const value = compute();
  rows.set(subject, value);
  return value;
}

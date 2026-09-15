/**
 * The charter's own offences (`REGISTRY.md` §4, codes L35–L40).
 *
 * | L35 | Unlicensed printing | 2 |
 * | L36 | Defiance of a press order | 3 |
 * | L37 | False return | 3 |
 * | L38 | Obstruction of a record | 4 |
 * | L39 | Sitting unlawfully | 4 |
 * | L40 | Interference with a convention or a ballot | 5 |
 *
 * Every one is **Track I**. Nothing here reaches custody, because none of it
 * is an offence against a person: a council that silences a paper has taken
 * from the city, not from anyone's safety (`docs/JUSTICE.md` §1). A council
 * that wants custody must charge a named journalist under P02 in open Court,
 * which is the scandal and not a loophole.
 *
 * The six codes are registered in the law books by the pass that wires this
 * layer into the action system. Until they are, the fact is still public: the
 * city is told what was done and by whom, the citizen remembers it, and a
 * counter keeps the count, so nothing is silently lost and nothing is invented
 * either — the Watch answers a code it actually holds, or the city merely
 * records what it saw.
 */
import type { CitizenId, OffenceCode, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { emit, remember } from '../sim/events.ts';
import { commitOffence } from '../government/watch.ts';

/** The codes this layer charges, with what each one is. */
export const CHARTER_OFFENCES = {
  L35: 'unlicensed printing',
  L36: 'defiance of a press order',
  L37: 'a false return',
  L38: 'obstruction of a record',
  L39: 'sitting unlawfully',
  L40: 'interference with a convention or a ballot',
} as const;

export type CharterOffence = keyof typeof CHARTER_OFFENCES;

/** Is this code in the city's law books yet? */
export function lawInForce(code: CharterOffence): boolean {
  return Object.prototype.hasOwnProperty.call(LAWS, code);
}

function countKey(code: CharterOffence): string { return `politics:offence:${code}`; }

/** How often the city has recorded this offence, whether or not the Watch could charge it. */
export function offenceCount(world: World, code: CharterOffence): number {
  return world.counters[countKey(code)] ?? 0;
}

/**
 * Record a charter offence against a citizen: charged where the Watch holds
 * the code, and published where it does not. Never throws, and never invents a
 * charge the books do not carry.
 */
export function chargeCharterOffence(
  world: World, actorId: CitizenId, code: CharterOffence,
  ctx: { victimId?: CitizenId; amount?: number; what?: string } = {},
): { detected: boolean; charged: boolean } {
  const actor = world.citizens[actorId];
  if (!actor) return { detected: false, charged: false };
  world.counters[countKey(code)] = offenceCount(world, code) + 1;
  const what = ctx.what ?? CHARTER_OFFENCES[code];
  if (lawInForce(code)) {
    const result = commitOffence(world, actorId, code as OffenceCode, {
      ...(ctx.victimId ? { victimId: ctx.victimId } : {}),
      ...(ctx.amount ? { amount: ctx.amount } : {}),
    });
    return { detected: result.detected, charged: true };
  }
  emit(world, 'law', `${actor.name}: ${what} (${code}), on the record and answerable when the Watch holds the code.`,
    [actorId], 0.5, { code, what });
  remember(world, actorId, 'crime', `The city recorded ${what} (${code}) against your name.`);
  return { detected: true, charged: false };
}

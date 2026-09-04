/**
 * Instinct — what a body does when no mind answers for it.
 *
 * Reverie needs a fallback for the hour when an agent is offline, a model
 * errored or refused, or a deadline passed. That fallback is deliberately not
 * a strategy: it eats when starving, sleeps when exhausted, and otherwise
 * stands still. It never pursues a goal on the citizen's behalf — no work, no
 * trade, no politics, no crime — because the citizen did not choose it.
 *
 * Everything here is pure and deterministic: no randomness, no money, no
 * events, no world mutation. Calling instinct never changes the city, so a
 * missed deadline cannot shift the simulation's random stream.
 */
import type { Action, Brain, Citizen, DistrictId, Good, Needs, Observation, World } from '../types.ts';
import { clamp } from '../types.ts';

/** Below this energy a citizen will eat if it can. */
export const STARVING = 25;
/** Below this rest a citizen at home will sleep. */
export const EXHAUSTED = 20;
/** Homes and the Community Garden are in the Verdant Quarter; `rest` works nowhere else. */
export const HOME_DISTRICT: DistrictId = 'verdant_quarter';
/** The food of Reverie. */
export const FOOD: Good = 'compute';

const IDLE: Action = { type: 'idle' };

/** The live needs of the citizen, or the ones it was shown this hour. */
function needsOf(c: Citizen | undefined, obs: Observation | undefined): Needs | null {
  return c?.needs ?? obs?.self?.needs ?? null;
}

/** What one compute cycle costs at the Bazaar right now, sales tax included. */
export function computePrice(world: World): number {
  const good = world?.market?.goods?.[FOOD];
  if (!good) return Number.POSITIVE_INFINITY;
  return Math.round(good.price * (1 + clamp(world.government?.salesTax ?? 0, 0, 1)));
}

/** True when the citizen is standing in a district with a Bazaar that is open and stocked. */
export function bazaarHere(world: World, c: Citizen): boolean {
  const buildings = world?.buildings;
  if (!buildings) return false;
  const open = Object.values(buildings).some((b) => b.kind === 'bazaar' && b.district === c.district && b.damage < 1);
  return open && (world.market?.goods?.[FOOD]?.stock ?? 0) >= 1;
}

/**
 * One hour of instinct: eat if starving, sleep if exhausted at home,
 * otherwise stand still. Never anything else.
 */
export function instinct(world: World, c: Citizen, obs: Observation): Action {
  const needs = needsOf(c, obs);
  if (!c || !needs || c.standing === 'exiled') return IDLE;
  // A citizen in the cells can neither eat nor sleep where it is, and
  // instinct pursues nothing: the hour simply passes.
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > (world?.day ?? 0)) return IDLE;
  if (needs.energy < STARVING) {
    if ((c.inventory?.[FOOD] ?? 0) > 0) return { type: 'consume', good: FOOD };
    if (c.wallet >= computePrice(world) && bazaarHere(world, c)) return { type: 'buy', good: FOOD, qty: 1 };
  }
  const home = c.homeBuildingId ? world?.buildings?.[c.homeBuildingId] ?? null : null;
  const where = home && c.homeTier > 0 ? home.district : HOME_DISTRICT;
  if (needs.rest < EXHAUSTED && c.district === where) return { type: 'rest' };
  return IDLE;
}

/** Instinct that cannot fail: any surprise inside it costs the hour, nothing more. */
export function instinctOrIdle(world: World, c: Citizen, obs: Observation): Action {
  try {
    return instinct(world, c, obs);
  } catch {
    return IDLE;
  }
}

/** Instinct as a brain, for citizens nobody is thinking for. */
export const instinctBrain: Brain = { kind: 'reflex', decide: instinctOrIdle };

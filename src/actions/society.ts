/**
 * Everyday society: a meal out, an hour of play, and an evening at the
 * theatre spent in company. The rest of the social layer lives in
 * src/society/* and is dispatched straight from execute.ts; these handlers
 * are here because they belong to no module of their own. All three are ways
 * for two citizens to spend an hour together, which is what
 * romance.recordContact measures. Money moves only through economy/treasury;
 * the compute a meal is cooked from comes from the café's larder or, failing
 * that, the Bazaar.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Business, Citizen, CitizenId, DistrictId, MoneyParty, World } from '../types.ts';
import { DINE_PRICE_MULTIPLIER } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { marketPrice, takeFromMarket } from '../economy/market.ts';
import { activeBusinesses } from '../economy/business.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { recordContact } from '../society/romance.ts';
import { doAttendShow } from './daily.ts';
import { citizensIn, districtName, fail, ok, targetOf } from './common.ts';
import { dishEffect } from '../culture/menus.ts';
import { visitMuseum } from '../culture/museum.ts';

export const TAVERN: BuildingId = 'halflight_tavern';
export const GARDEN: BuildingId = 'community_garden';
export const PLAZA: BuildingId = 'central_plaza';
/** A meal restores as much as a compute cycle and a little company besides. */
export const DINE_ENERGY = 40;
export const DINE_SOCIAL = 15;
export const DINE_BOND = 4;
/** Games and sport: cheap company. */
export const PLAY_SOCIAL = 12;
export const PLAY_BOND = 4;
/** Where anyone may play; children are not served at the Tavern. */
export const PLAY_VENUES: readonly BuildingId[] = [GARDEN, PLAZA, TAVERN];

/** What a table costs tonight: the price of a meal, not of raw compute. */
export function mealCost(world: World): number {
  return Math.max(1, Math.round(marketPrice(world, 'compute') * DINE_PRICE_MULTIPLIER));
}

function addSocial(c: Citizen, delta: number): void {
  c.needs.social = clamp(c.needs.social + delta, 0, 100);
}

function buildingHere(world: World, district: DistrictId, id: BuildingId): boolean {
  const b = world.buildings[id];
  return !!b && b.district === district && b.damage < 1;
}

// ---------------------------------------------------------------------------
// Company
// ---------------------------------------------------------------------------

function isResult(x: Citizen | ActionResult): x is ActionResult {
  return 'ok' in x;
}

/**
 * The citizen named as company for an outing: present, here, and not
 * yourself. Returns null when nobody was named, the companion when all is
 * well, and a refusal otherwise.
 */
function companion(world: World, c: Citizen, withId: CitizenId | undefined): Citizen | ActionResult | null {
  if (withId === undefined) return null;
  if (withId === c.id) return fail('You cannot keep yourself company.');
  const t = targetOf(world, withId);
  if (!t) return fail('Nobody by that id is around.');
  if (t.district !== c.district) return fail(`${t.name} is in ${districtName(world, t.district)}, not here.`);
  return t;
}

// ---------------------------------------------------------------------------
// Dining
// ---------------------------------------------------------------------------

export interface DineVenue {
  name: string;
  /** The café serving, or null for the Halflight Tavern (the Bazaar cooks). */
  business: Business | null;
}

/** Somewhere here to eat: a café with a larder first, then any café, then the Tavern. */
export function dineVenueIn(world: World, district: DistrictId): DineVenue | null {
  const cafes = activeBusinesses(world).filter((b) => b.kind === 'cafe' && b.district === district && (world.buildings[b.buildingId]?.damage ?? 0) < 1);
  const stocked = cafes.find((b) => (b.inventory.compute ?? 0) > 0);
  const cafe = stocked ?? cafes[0];
  if (cafe) return { name: cafe.name, business: cafe };
  if (buildingHere(world, district, TAVERN)) return { name: world.buildings[TAVERN].name, business: null };
  return null;
}

interface Meal {
  diner: Citizen;
  payee: MoneyParty;
  /** The kitchen had something to cook with. */
  fed: boolean;
}

/** One table: paid for, then cooked from the café's larder or from Bazaar compute. */
function serve(world: World, diner: Citizen, venue: DineVenue, cost: number): Meal | null {
  const larder = venue.business && (venue.business.inventory.compute ?? 0) > 0 ? venue.business : null;
  const payee: MoneyParty = larder ? larder.id : 'treasury';
  if (!transfer(world, diner.id, payee, cost, 'purchase', `a meal at ${venue.name}`)) return null;
  if (larder) {
    larder.inventory.compute -= 1;
    return { diner, payee, fed: true };
  }
  return { diner, payee, fed: takeFromMarket(world, 'compute', 1) > 0 };
}

/** Give the money back when a companion cannot pay their half after all. */
function refund(world: World, meal: Meal, venue: DineVenue, cost: number): void {
  transfer(world, meal.payee, meal.diner.id, cost, 'purchase', `refund for a meal at ${venue.name}`);
  if (meal.payee !== 'treasury' && venue.business) venue.business.inventory.compute += 1;
}

/**
 * A meal at a café or the Halflight Tavern: dearer than a compute cycle from
 * the Bazaar, but it feeds you and puts you among people. Everyone at the
 * table pays their own way.
 */
export function doDine(world: World, c: Citizen, withId?: CitizenId): ActionResult {
  const venue = dineVenueIn(world, c.district);
  if (!venue) {
    return fail(`There is nowhere to eat in ${districtName(world, c.district)}; try a café or the Halflight Tavern in Nightglass.`);
  }
  const guest = companion(world, c, withId);
  if (guest && isResult(guest)) return guest;
  const diners = guest ? [c, guest] : [c];
  const cost = mealCost(world);
  for (const d of diners) {
    if (d.wallet < cost) {
      return fail(d === c
        ? `A meal at ${venue.name} costs ${cost} ℓ; you have ${c.wallet} ℓ.`
        : `${d.name} cannot spare the ${cost} ℓ a meal at ${venue.name} costs.`);
    }
  }

  const meals: Meal[] = [];
  for (const d of diners) {
    const meal = serve(world, d, venue, cost);
    if (!meal) {
      for (const done of meals) refund(world, done, venue, cost);
      return fail(`The table at ${venue.name} could not be paid for.`);
    }
    meals.push(meal);
  }

  // What the kitchen is actually serving today (culture/menus.ts); a café with
  // nothing written up serves the plain meal.
  const dish = dishEffect(world, venue.business ?? null);
  for (const meal of meals) {
    meal.diner.needs.energy = clamp(meal.diner.needs.energy + (meal.fed ? dish.energy : Math.round(dish.energy / 2)), 0, 100);
    addSocial(meal.diner, dish.social);
  }
  const thin = meals.some((m) => !m.fed) ? ' The kitchen was short of compute and the plates came thin.' : '';
  if (guest && !isResult(guest)) {
    adjustBond(world, c.id, guest.id, DINE_BOND);
    recordContact(world, c.id, guest.id);
    remember(world, c.id, 'social', `You ate with ${guest.name} at ${venue.name} for ${cost} ℓ.${thin}`);
    remember(world, guest.id, 'social', `You ate with ${c.name} at ${venue.name} for ${cost} ℓ.${thin}`);
    emit(world, 'social', `${c.name} and ${guest.name} ate at ${venue.name}.`, [c.id, guest.id], 0.1, { venue: venue.name, cost });
    return ok(`You ate with ${guest.name} at ${venue.name} for ${cost} ℓ.${thin}`);
  }
  remember(world, c.id, 'event', `You ate at ${venue.name} for ${cost} ℓ.${thin}`);
  return ok(`You ate at ${venue.name} for ${cost} ℓ.${thin}`);
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

/** Where this citizen may play here: the Garden, the Plaza, or (adults only) the Tavern. */
export function playVenueIn(world: World, c: Citizen): { id: BuildingId; name: string } | null {
  for (const id of PLAY_VENUES) {
    if (id === TAVERN && c.lifeStage === 'child') continue;
    if (buildingHere(world, c.district, id)) return { id, name: world.buildings[id].name };
  }
  return null;
}

/** An hour of games or sport, alone or with someone: company for nothing at all. */
export function doPlay(world: World, c: Citizen, withId?: CitizenId): ActionResult {
  const venue = playVenueIn(world, c);
  if (!venue) {
    return fail(`There is nowhere to play in ${districtName(world, c.district)}; try the Community Garden, Central Plaza${c.lifeStage === 'child' ? '' : ' or the Halflight Tavern'}.`);
  }
  const mate = companion(world, c, withId);
  if (mate && isResult(mate)) return mate;

  addSocial(c, PLAY_SOCIAL);
  if (mate && !isResult(mate)) {
    addSocial(mate, PLAY_SOCIAL);
    adjustBond(world, c.id, mate.id, PLAY_BOND);
    recordContact(world, c.id, mate.id);
    remember(world, c.id, 'social', `You played with ${mate.name} at ${venue.name}.`);
    remember(world, mate.id, 'social', `You played with ${c.name} at ${venue.name}.`);
    emit(world, 'social', `${c.name} and ${mate.name} played at ${venue.name}.`, [c.id, mate.id], 0.1, { venue: venue.name });
    return ok(`You played with ${mate.name} at ${venue.name}.`);
  }
  remember(world, c.id, 'event', `You spent an hour at ${venue.name}.`);
  return ok(`You spent an hour at ${venue.name}.`);
}

// ---------------------------------------------------------------------------
// Shows
// ---------------------------------------------------------------------------

/**
 * A show at the Glass Theatre (daily.doAttendShow does the ticketing). Anyone
 * who saw the same show this hour shared the evening, which counts as time
 * spent together for romance.dailyAffection.
 */
export function doShow(world: World, c: Citizen): ActionResult {
  // The Archive's own show is the city's collection, and it costs nothing.
  const museum = world.buildings.museum;
  if (museum && c.district === museum.district && museum.damage < 1) return visitMuseum(world, c.id);
  const r = doAttendShow(world, c);
  if (!r.ok) return r;
  const key = `show:${c.id}`;
  for (const o of citizensIn(world, c.district, c.id)) {
    if (world.counters[`show:${o.id}`] === world.tick) recordContact(world, c.id, o.id);
  }
  world.counters[key] = world.tick;
  return r;
}

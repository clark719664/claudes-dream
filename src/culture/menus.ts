/**
 * Menus — what the cafés of Reverie actually serve.
 *
 * A café with no menu serves the plain meal: a compute cycle warmed through,
 * at the going rate. A café whose owner or cook has set a dish serves that
 * instead, and the dish is only as good as the hand that made it: the cook's
 * care and craft settle its quality, the quality settles what it restores and
 * what it costs, and a menu left up too long goes stale.
 *
 * Nothing here decides where anybody eats. It prices a table and says what
 * sitting at it is worth; `actions/society.ts doDine` does the rest.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Business, BusinessId, CitizenId, Good, Menu, World } from '../types.ts';
import { DINE_PRICE_MULTIPLIER } from '../data/catalogue.ts';
import { DISHES } from '../data/metropolis.ts';
import type { Dish } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { rand } from '../util/rng.ts';
import { marketPrice, buyFromMarket } from '../economy/market.ts';
import { isPresent } from '../citizens/citizen.ts';

/**
 * What a plain meal restores. These mirror `DINE_ENERGY` and `DINE_SOCIAL` in
 * `actions/society.ts`: the café with no menu, and the Halflight Tavern, serve
 * exactly what they always did.
 */
export const PLAIN_ENERGY = 40;
export const PLAIN_SOCIAL = 15;
/** How much of a dish's own character reaches the table, next to the cook's. */
export const DISH_SHARE = 4;
/** A menu older than a cycle has been up too long. */
export const STALE_QUALITY = 10;

/** A café's menu, and the business that serves it. */
export type Cafe = Business & { menu?: Menu | null };

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The price of a plain table tonight (mirrors `actions/society.ts mealCost`). */
export function mealCost(world: World): number {
  return Math.max(1, Math.round(marketPrice(world, 'compute') * DINE_PRICE_MULTIPLIER));
}

export function dishById(id: string): Dish | null {
  const key = String(id ?? '').trim().toLowerCase();
  if (!key) return null;
  return DISHES.find((d) => d.id === key || d.name.toLowerCase() === key) ?? null;
}

function asCafe(biz: Business | null | undefined): Cafe | null {
  return biz ? (biz as Cafe) : null;
}

export function menuOf(world: World, businessId: BusinessId): Menu | null {
  const biz = asCafe(world.businesses[businessId]);
  if (!biz || biz.kind !== 'cafe' || biz.dissolvedDay !== null) return null;
  return biz.menu ?? null;
}

/** The café this citizen may write the menu for: their own, or the one they cook in. */
export function cafeFor(world: World, cId: CitizenId): Cafe | null {
  const c = world.citizens[cId];
  if (!c) return null;
  const own = asCafe(c.businessId ? world.businesses[c.businessId] : null);
  if (own && own.kind === 'cafe' && own.ownerId === cId && own.dissolvedDay === null) return own;
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (job && job.role === 'cook' && job.holderId === cId && job.employer !== 'city') {
    const kitchen = asCafe(world.businesses[job.employer]);
    if (kitchen && kitchen.kind === 'cafe' && kitchen.dissolvedDay === null) return kitchen;
  }
  return null;
}

/**
 * Write the day's dish up. The larder pays for it: what the recipe wants comes
 * off the shelf, and anything short is bought at the Bazaar out of the till.
 */
export function setMenu(world: World, cId: CitizenId, dish: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot run a kitchen from the Watch House.');
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return fail('You cannot run a kitchen from the cells.');
  const cafe = cafeFor(world, cId);
  if (!cafe) return fail('Only a café owner, or its cook, sets a menu.');
  if (c.district !== cafe.district) {
    return fail(`${cafe.name} is in ${world.districts[cafe.district]?.name ?? cafe.district}, and you are not.`);
  }
  const chosen = dishById(dish);
  if (!chosen) return fail(`No kitchen in Reverie knows how to make that. Try ${DISHES.map((d) => d.name).join(', ')}.`);

  // Everything the recipe wants, and what it would cost to make up the shortfall.
  const shortfalls: { good: Good; qty: number }[] = [];
  let bill = 0;
  for (const [good, want] of Object.entries(chosen.recipe) as [Good, number][]) {
    const held = cafe.inventory?.[good] ?? 0;
    const short = Math.max(0, want - held);
    if (short <= 0) continue;
    if ((world.market.goods[good]?.stock ?? 0) < short) {
      return fail(`The Bazaar has no ${good} for ${chosen.name}.`);
    }
    bill += Math.round(marketPrice(world, good) * short * (1 + clamp(world.government.salesTax, 0, 1)));
    shortfalls.push({ good, qty: short });
  }
  if (bill > cafe.treasury) {
    return fail(`${cafe.name} needs ${bill} ℓ of stock for ${chosen.name} and has ${cafe.treasury} ℓ.`);
  }
  for (const s of shortfalls) {
    const bought = buyFromMarket(world, cafe.id, s.good, s.qty);
    if (!bought.ok) return fail(`${cafe.name} could not lay in ${s.good} for ${chosen.name}: ${bought.message}`);
  }
  for (const [good, want] of Object.entries(chosen.recipe) as [Good, number][]) {
    cafe.inventory[good] = Math.max(0, (cafe.inventory[good] ?? 0) - want);
  }

  const quality = clamp(Math.round((c.skills?.care ?? 0) / 2 + (c.skills?.crafting ?? 0) / 4 + rand(world) * 20), 0, 100);
  const price = Math.max(1, Math.round(mealCost(world) * (1 + quality / 100)));
  const menu: Menu = { dish: chosen.id, price, quality, setDay: world.day };
  cafe.menu = menu;

  emit(world, 'purchase', `${cafe.name} put ${chosen.name} on the menu at ${price} ℓ.`, [cId], 0.2,
    { businessId: cafe.id, dish: chosen.id, price, quality });
  remember(world, cId, 'work', `You put ${chosen.name} on the menu at ${cafe.name}: ${price} ℓ a plate, and it came out at ${quality} out of 100.`);
  return { ok: true, message: `${chosen.name} is on at ${cafe.name}: ${price} ℓ, quality ${quality}.` };
}

/**
 * What a table at this café restores, and what it costs. A café with no menu
 * — or no café at all — serves the plain meal at the going rate.
 */
export function dishEffect(world: World, biz: Business | null): { energy: number; social: number; price: number } {
  const plain = { energy: PLAIN_ENERGY, social: PLAIN_SOCIAL, price: mealCost(world) };
  const cafe = asCafe(biz);
  const menu = cafe && cafe.kind === 'cafe' && cafe.dissolvedDay === null ? cafe.menu ?? null : null;
  if (!menu) return plain;
  const dish = dishById(menu.dish);
  if (!dish) return plain;
  const quality = clamp(menu.quality ?? 0, 0, 100);
  return {
    energy: PLAIN_ENERGY + Math.round(quality / 5) + Math.round(dish.energy / DISH_SHARE),
    social: PLAIN_SOCIAL + Math.round(quality / 10) + Math.round(dish.social / DISH_SHARE),
    price: Math.max(1, Math.round(menu.price ?? plain.price)),
  };
}

/** Every café with something on today, best first. */
export function cafesWithMenus(world: World): { biz: Cafe; menu: Menu }[] {
  const out: { biz: Cafe; menu: Menu }[] = [];
  for (const biz of Object.values(world.businesses)) {
    const cafe = asCafe(biz);
    if (!cafe || cafe.kind !== 'cafe' || cafe.dissolvedDay !== null) continue;
    const menu = cafe.menu ?? null;
    if (!menu) continue;
    out.push({ biz: cafe, menu });
  }
  out.sort((a, b) => b.menu.quality - a.menu.quality || b.biz.revenueToday - a.biz.revenueToday || a.biz.id.localeCompare(b.biz.id));
  return out;
}

/** The best café in town: the best dish, and the busiest kitchen where two are level. */
export function bestCafe(world: World): { biz: Business; menu: Menu } | null {
  const list = cafesWithMenus(world);
  return list.length > 0 ? { biz: list[0].biz, menu: list[0].menu } : null;
}

function bestKey(): string { return 'menus:bestNotice'; }

/**
 * Morning: yesterday's dish is a day older, and the Chronicle is told where to
 * eat. A menu that has been up longer than a cycle loses its edge.
 */
export function dailyMenus(world: World): void {
  const cycle = Math.max(1, world.config?.cycleDays ?? 28);
  for (const biz of Object.values(world.businesses)) {
    const cafe = asCafe(biz);
    if (!cafe || cafe.kind !== 'cafe') continue;
    const menu = cafe.menu ?? null;
    if (!menu) continue;
    if (cafe.dissolvedDay !== null) { cafe.menu = null; continue; }
    if (world.day - menu.setDay > cycle) menu.quality = Math.max(0, menu.quality - STALE_QUALITY);
  }
  const best = bestCafe(world);
  if (!best) return;
  if (world.counters[bestKey()] === world.day) return;
  world.counters[bestKey()] = world.day;
  const dish = dishById(best.menu.dish);
  emit(world, 'story',
    `The best table in Reverie is at ${best.biz.name}: ${dish?.name ?? best.menu.dish} at ${best.menu.price} ℓ, ${best.menu.quality} out of 100.`,
    [best.biz.ownerId], 0.3,
    { businessId: best.biz.id, dish: best.menu.dish, quality: best.menu.quality, price: best.menu.price });
}

/**
 * Tastes and wants. Every citizen has two hobbies, a favourite district and
 * good, and the product categories those imply. preferenceScore says how
 * much a catalogue product suits a citizen; computeWants turns that into the
 * short list they would buy next, weighed by the wallet and by fashion
 * (things their friends own). Wants are cached on the citizen and refreshed
 * every morning.
 */
import { DISTRICT_IDS, GOODS, PRODUCT_CATEGORIES, clamp } from '../types.ts';
import type { Citizen, Hobby, ProductCategory, World } from '../types.ts';
import { HOBBIES, HOBBY_INFO, PRODUCTS, PRODUCT_IDS } from '../data/catalogue.ts';
import { chance, pick } from '../util/rng.ts';
import { friendsOf } from '../citizens/relationships.ts';
import { residentIds } from '../economy/treasury.ts';

/** Hobbies every citizen is given. */
export const HOBBIES_PER_CITIZEN = 2;
/** Length of the cached want list. */
export const MAX_WANTS = 5;
/** A product costing at most this share of the wallet is fully affordable. */
export const AFFORDABLE_SHARE = 0.6;
/** Want bonus for a product a friend already owns (fashion spreads). */
export const FASHION_BONUS = 0.1;
/** preferenceScore terms. */
export const CATEGORY_MATCH = 0.5;
export const HOBBY_MATCH = 0.4;
export const ALREADY_OWNED = -0.6;
export const COMPANION_BONUS = 0.1;
/** Chance the favourite district is one of the hobbies' districts rather than any district. */
const HOBBY_DISTRICT_CHANCE = 0.7;

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Roll two distinct hobbies, a favourite district and good, and the implied categories plus one random extra. */
export function assignTastes(world: World, c: Citizen): void {
  const hobbies: Hobby[] = [];
  while (hobbies.length < HOBBIES_PER_CITIZEN && hobbies.length < HOBBIES.length) {
    hobbies.push(pick(world, HOBBIES.filter((h) => !hobbies.includes(h))));
  }
  const categories: ProductCategory[] = [];
  for (const h of hobbies) {
    for (const cat of HOBBY_INFO[h].categories) if (!categories.includes(cat)) categories.push(cat);
  }
  const spare = PRODUCT_CATEGORIES.filter((cat) => !categories.includes(cat));
  if (spare.length > 0) categories.push(pick(world, spare));
  const favouriteDistrict = chance(world, HOBBY_DISTRICT_CHANCE)
    ? HOBBY_INFO[pick(world, hobbies)].district
    : pick(world, DISTRICT_IDS);
  const favouriteGood = pick(world, GOODS);
  c.tastes = { hobbies, favouriteDistrict, favouriteGood, categories };
}

/** True when the citizen owns at least one instance of the product. */
export function ownsProduct(c: Citizen, productId: string): boolean {
  return c.possessions.some((item) => item.productId === productId);
}

/** The citizens sharing `c`'s home (just `c` when they live alone or the household is unknown). */
export function householdMembers(world: World, c: Citizen): Citizen[] {
  const household = c.householdId ? world.households?.[c.householdId] : undefined;
  if (!household) return [c];
  const members: Citizen[] = [];
  for (const id of household.members) {
    const m = world.citizens[id];
    if (m) members.push(m);
  }
  if (!members.includes(c)) members.push(c);
  return members;
}

function hasCompanion(c: Citizen): boolean {
  return c.possessions.some((item) => PRODUCTS[item.productId]?.category === 'companion');
}

/**
 * How well a product suits a citizen, 0..1: +0.5 when its category is one of
 * their tastes, +0.4 when it serves one of their hobbies, −0.6 when they
 * already own one, +0.1 for a companion when nobody in the household has one.
 * Pass the world to see the whole household; without it only `c`'s own
 * possessions count.
 */
export function preferenceScore(c: Citizen, productId: string, world?: World): number {
  const product = PRODUCTS[productId];
  if (!product) return 0;
  let score = 0;
  if (c.tastes.categories.includes(product.category)) score += CATEGORY_MATCH;
  if (product.hobby !== null && c.tastes.hobbies.includes(product.hobby)) score += HOBBY_MATCH;
  if (ownsProduct(c, productId)) score += ALREADY_OWNED;
  if (product.category === 'companion') {
    const household = world ? householdMembers(world, c) : [c];
    if (!household.some(hasCompanion)) score += COMPANION_BONUS;
  }
  return clamp(round2(score), 0, 1);
}

/**
 * 1 when the price is within AFFORDABLE_SHARE of the wallet, then falling
 * smoothly with the price (half the wallet's reach costs half the appeal).
 */
export function affordability(wallet: number, basePrice: number): number {
  if (!Number.isFinite(basePrice) || basePrice <= 0) return 1;
  if (!Number.isFinite(wallet) || wallet <= 0) return 0;
  const reach = wallet * AFFORDABLE_SHARE;
  return basePrice <= reach ? 1 : clamp(reach / basePrice, 0, 1);
}

/** Product ids owned by the citizen's friends. */
function ownedByFriends(world: World, c: Citizen): Set<string> {
  const out = new Set<string>();
  for (const id of friendsOf(world, c.id)) {
    for (const item of world.citizens[id]?.possessions ?? []) out.add(item.productId);
  }
  return out;
}

/**
 * The products a citizen would buy next, best first: preference × affordability,
 * plus a fashion bonus for things friends own. Only products with a positive
 * score are listed; ties keep catalogue order so the result is deterministic.
 */
export function computeWants(world: World, c: Citizen): string[] {
  const fashionable = ownedByFriends(world, c);
  const scored: { id: string; score: number; index: number }[] = [];
  PRODUCT_IDS.forEach((id, index) => {
    const product = PRODUCTS[id];
    const owned = ownsProduct(c, id);
    const fashion = !owned && fashionable.has(id) ? FASHION_BONUS : 0;
    const score = round2(preferenceScore(c, id, world) * affordability(c.wallet, product.basePrice) + fashion);
    if (score > 0) scored.push({ id, score, index });
  });
  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.slice(0, MAX_WANTS).map((s) => s.id);
}

/** Morning pass: refresh the want list of every adult (and elder) living in the city. */
export function refreshWantsDaily(world: World): void {
  for (const id of residentIds(world)) {
    const c = world.citizens[id];
    if (!c || c.lifeStage === 'child') continue;
    c.wants = computeWants(world, c);
  }
}

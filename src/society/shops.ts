/**
 * Shops: the Emporium at the Grand Bazaar and the shelves of citizen-owned
 * shops, workshops and studios. Buying, using and gifting products, crafting
 * them from goods, the owner's prices, the Emporium's slow restock, and the
 * daily comfort of the things people own. Money moves only through
 * economy/treasury; goods for crafting come from the Bazaar via economy/market.
 */
import { DISTRICT_IDS, clamp } from '../types.ts';
import type {
  ActionResult, Business, BusinessId, BusinessKind, Citizen, CitizenId, DistrictId, Good, Item, ItemId, MoneyParty, Need,
  ShelfEntry, World,
} from '../types.ts';
import { EMPORIUM_FOUNDING_STOCK, HOBBY_INFO, MAX_POSSESSIONS, PRODUCTS, PRODUCT_IDS } from '../data/catalogue.ts';
import type { Product } from '../data/catalogue.ts';
import { chance } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { buyFromMarket } from '../economy/market.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { householdMembers, preferenceScore } from './tastes.ts';
import { memo } from '../util/memo.ts';

export const EMPORIUM_ID = 'emporium' as const;
export const EMPORIUM_NAME = 'The Emporium';
export const EMPORIUM_DISTRICT: DistrictId = 'harbor_market';
export const EMPORIUM_BUILDING = 'grand_bazaar';
/** Daily chance that the Emporium receives one more unit of each product. */
export const EMPORIUM_RESTOCK_CHANCE = 0.15;
/** The Emporium never holds more than this of any product. */
export const EMPORIUM_MAX_STOCK = 10;
/** What a maker asks over the cost of the materials when it sets its own price. */
export const CRAFT_MARKUP = 1.2;
/** ...and how far it undercuts the Emporium's price for the same thing, when it can. */
export const CRAFT_UNDERCUT = 0.95;
/** Businesses that can craft and sell products. */
export const CRAFTING_KINDS: readonly BusinessKind[] = ['shop', 'workshop', 'studio'];
export const MAX_PRICE = 100_000;
/** Skill gained per use of a hobby item (children learn twice as fast). */
export const HOBBY_SKILL_PER_USE = 0.5;
/** Extra purpose from practising a hobby you actually love. */
export const TASTE_PURPOSE_BONUS = 5;
/** Purpose from getting something you wanted. */
export const WANTED_PURPOSE = 5;
/** Bond from a gift: base plus a taste-scaled part. */
export const GIFT_BOND_BASE = 10;
export const GIFT_BOND_TASTE = 30;
export const GIFT_AFFECTION = 5;
export const GIFT_SOCIAL = 5;
/** Crafting is work: purpose, tiredness and a little skill. */
export const CRAFT_PURPOSE = 6;
export const CRAFT_REST = 3;
export const CRAFT_SKILL = 0.5;

export interface Shop {
  businessId: BusinessId | typeof EMPORIUM_ID;
  name: string;
  shelf: Record<string, ShelfEntry>;
}

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

/** A citizen living in the city (not exiled, not departed). */
function presentCitizen(world: World, cId: CitizenId): Citizen | null {
  const c = world.citizens[cId];
  return c && c.standing !== 'exiled' && world.order.includes(cId) ? c : null;
}

function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

function districtName(world: World, d: DistrictId): string {
  return world.districts[d]?.name ?? d;
}

function addNeed(c: Citizen, need: Need, delta: number): void {
  c.needs[need] = clamp(c.needs[need] + delta, 0, 100);
}

function addAffection(c: Citizen, other: CitizenId, delta: number): void {
  c.affection[other] = clamp(Math.round(((c.affection[other] ?? 0) + delta) * 100) / 100, 0, 100);
}

function findItem(c: Citizen, itemId: ItemId): Item | null {
  return c.possessions.find((item) => item.id === itemId) ?? null;
}

/** Remove a product from a want list, returning whether it was wanted. */
function fulfilWant(c: Citizen, productId: string): boolean {
  if (!c.wants.includes(productId)) return false;
  c.wants = c.wants.filter((w) => w !== productId);
  return true;
}

// ---------------------------------------------------------------------------
// The Emporium
// ---------------------------------------------------------------------------

/** Stock the Emporium at founding. */
export function initEmporium(world: World): void {
  world.emporium = { ...EMPORIUM_FOUNDING_STOCK };
}

/** The Emporium trades while the Grand Bazaar stands. */
export function emporiumOpen(world: World): boolean {
  return (world.buildings[EMPORIUM_BUILDING]?.damage ?? 0) < 1;
}

/** Emporium price: base price at today's price index, at least 1 ℓ. */
export function emporiumPrice(world: World, product: Product): number {
  return Math.max(1, Math.round(product.basePrice * world.market.priceIndex));
}

function emporiumShelf(world: World): Record<string, ShelfEntry> {
  const shelf: Record<string, ShelfEntry> = {};
  for (const id of PRODUCT_IDS) {
    const qty = Math.floor(world.emporium?.[id] ?? 0);
    if (qty > 0) shelf[id] = { qty, price: emporiumPrice(world, PRODUCTS[id]) };
  }
  return shelf;
}

/** Restock: each product has a small daily chance of one more unit, up to the cap. */
export function restockEmporium(world: World): void {
  world.emporium ??= {};
  for (const id of PRODUCT_IDS) {
    const arrived = chance(world, EMPORIUM_RESTOCK_CHANCE);
    const stock = world.emporium[id] ?? 0;
    if (!arrived || stock >= EMPORIUM_MAX_STOCK) continue;
    world.emporium[id] = stock + 1;
  }
}

// ---------------------------------------------------------------------------
// Shelves
// ---------------------------------------------------------------------------

function stocked(shelf: Record<string, ShelfEntry> | undefined): boolean {
  return !!shelf && Object.values(shelf).some((e) => e.qty > 0);
}

/** Shops with something on the shelf in a district; the Emporium is listed last, in Harbor Market. */
export function shopsIn(world: World, district: DistrictId): Shop[] {
  return memo(world, `shops:${district}`, () => openShopsIn(world, district));
}

function openShopsIn(world: World, district: DistrictId): Shop[] {
  const out: Shop[] = [];
  for (const b of Object.values(world.businesses)) {
    if (b.dissolvedDay !== null || b.district !== district || !stocked(b.shelf)) continue;
    const shelf: Record<string, ShelfEntry> = {};
    for (const [id, e] of Object.entries(b.shelf)) if (e.qty > 0 && PRODUCTS[id]) shelf[id] = { qty: e.qty, price: e.price };
    out.push({ businessId: b.id, name: b.name, shelf });
  }
  if (district === EMPORIUM_DISTRICT && emporiumOpen(world)) {
    const shelf = emporiumShelf(world);
    if (stocked(shelf)) out.push({ businessId: EMPORIUM_ID, name: EMPORIUM_NAME, shelf });
  }
  return out;
}

/** Everywhere a product is on sale, cheapest first (ties: business before Emporium, in id order). */
export function sellersOf(world: World, productId: string): { district: DistrictId; shop: Shop; entry: ShelfEntry }[] {
  const out: { district: DistrictId; shop: Shop; entry: ShelfEntry }[] = [];
  for (const district of DISTRICT_IDS) {
    for (const shop of shopsIn(world, district)) {
      const entry = shop.shelf[productId];
      if (entry && entry.qty > 0) out.push({ district, shop, entry });
    }
  }
  return out.sort((a, b) => a.entry.price - b.entry.price);
}

function shopOwner(world: World, shop: Shop): Citizen | null {
  if (shop.businessId === EMPORIUM_ID) return null;
  const b = world.businesses[shop.businessId];
  return b ? world.citizens[b.ownerId] ?? null : null;
}

// ---------------------------------------------------------------------------
// Buying, using, gifting
// ---------------------------------------------------------------------------

/**
 * Buy one unit of a product from the cheapest shop in the citizen's district.
 * Price goes to the business (or the Treasury for the Emporium) as 'item';
 * sales tax to the Treasury. The unit becomes a new Item in the possessions.
 */
export function buyItem(world: World, cId: CitizenId, productId: string): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  const product = PRODUCTS[productId];
  if (!product) return fail(`There is no such product as ${String(productId)}.`);
  if (c.possessions.length >= MAX_POSSESSIONS) return fail(`You already own ${MAX_POSSESSIONS} things; there is no room for more.`);

  const here = shopsIn(world, c.district).filter((s) => (s.shelf[productId]?.qty ?? 0) > 0);
  if (here.length === 0) {
    const elsewhere = sellersOf(world, productId)[0];
    return fail(elsewhere
      ? `Nobody in ${districtName(world, c.district)} sells a ${product.name}; ${elsewhere.shop.name} in ${districtName(world, elsewhere.district)} has one at ${elsewhere.entry.price} ℓ.`
      : `Nobody in Reverie has a ${product.name} for sale right now.`);
  }
  const shop = here.reduce((best, s) => (s.shelf[productId].price < best.shelf[productId].price ? s : best), here[0]);
  const entry = shop.shelf[productId];
  const price = Math.max(1, Math.round(entry.price));
  const tax = Math.max(0, Math.round(price * clamp(world.government.salesTax, 0, 1)));
  const total = price + tax;
  if (c.wallet < total) return fail(`A ${product.name} costs ${total} ℓ at ${shop.name}; you have ${c.wallet} ℓ.`);

  const seller: MoneyParty = shop.businessId === EMPORIUM_ID ? 'treasury' : shop.businessId;
  if (!transfer(world, cId, seller, price, 'item', `${product.name} from ${shop.name}`)) return fail('The purchase could not be completed.');
  if (tax > 0) transfer(world, cId, 'treasury', tax, 'sales_tax', `sales tax on a ${product.name}`);

  if (shop.businessId === EMPORIUM_ID) {
    world.emporium[productId] = Math.max(0, (world.emporium[productId] ?? 0) - 1);
  } else {
    const b = world.businesses[shop.businessId];
    const live = b.shelf[productId];
    if (live) live.qty = Math.max(0, live.qty - 1);
  }

  const item: Item = { id: nextId(world, 'i'), productId, acquiredDay: world.day };
  c.possessions.push(item);
  const wanted = fulfilWant(c, productId);
  if (wanted) addNeed(c, 'purpose', WANTED_PURPOSE);

  const owner = shopOwner(world, shop);
  remember(world, cId, 'money', `You bought a ${product.name} at ${shop.name} for ${total} ℓ${wanted ? ', something you had wanted' : ''}.`);
  if (owner) remember(world, owner.id, 'money', `${c.name} bought a ${product.name} from ${shop.name} for ${price} ℓ.`);
  emit(world, 'purchase', `${c.name} bought a ${product.name} at ${shop.name} for ${total} ℓ.`, owner ? [cId, owner.id] : [cId], 0.2,
    { productId, itemId: item.id, price: total, shop: shop.businessId });
  return ok(`You bought a ${product.name} (${item.id}) for ${total} ℓ at ${shop.name}.`);
}

/** Practise a hobby or enjoy a possession: the product's use effects, a little skill for hobby items. */
export function useItem(world: World, cId: CitizenId, itemId: ItemId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  const item = findItem(c, itemId);
  if (!item) return fail('You own no such thing.');
  const product = PRODUCTS[item.productId];
  if (!product) return fail(`Your ${item.productId} is broken beyond use.`);

  for (const [need, v] of Object.entries(product.use) as [Need, number][]) addNeed(c, need, v);
  let text = `You spent the hour with your ${product.name}`;
  if (product.hobby !== null) {
    const info = HOBBY_INFO[product.hobby];
    const gain = HOBBY_SKILL_PER_USE * (c.lifeStage === 'child' ? 2 : 1);
    c.skills[info.skill] = clamp(round2(c.skills[info.skill] + gain), 0, 100);
    const loved = c.tastes.hobbies.includes(product.hobby);
    if (loved) addNeed(c, 'purpose', TASTE_PURPOSE_BONUS);
    text += `, practising ${info.name.toLowerCase()}${loved ? ', which you love' : ''}`;
  }
  remember(world, cId, 'event', `${text}.`);
  return ok(`${text}.`);
}

/**
 * Give a possession to someone present. The bond grows with how well the
 * gift suits the recipient's tastes; partners also gain affection.
 */
export function giftItem(world: World, cId: CitizenId, to: CitizenId, itemId: ItemId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (to === cId) return fail('You cannot give a present to yourself.');
  const t = presentCitizen(world, to);
  if (!t || isDetained(world, t)) return fail('Nobody by that id is around.');
  if (t.district !== c.district) return fail(`${t.name} is in ${districtName(world, t.district)}, not here.`);
  const item = findItem(c, itemId);
  if (!item) return fail('You own no such thing.');
  if (t.possessions.length >= MAX_POSSESSIONS) return fail(`${t.name} has no room for another thing.`);
  const product = PRODUCTS[item.productId];
  const name = product?.name ?? item.productId;

  const pref = preferenceScore(t, item.productId, world);
  c.possessions = c.possessions.filter((i) => i.id !== itemId);
  t.possessions.push({ ...item, acquiredDay: world.day });

  adjustBond(world, cId, to, GIFT_BOND_BASE + GIFT_BOND_TASTE * pref);
  const partners = t.family.partnerId === cId && c.family.partnerId === to;
  if (partners) {
    addAffection(c, to, GIFT_AFFECTION);
    addAffection(t, cId, GIFT_AFFECTION);
  }
  c.stats.giftsGiven += 1;
  t.stats.giftsReceived += 1;
  addNeed(t, 'social', GIFT_SOCIAL);
  const wanted = fulfilWant(t, item.productId);
  if (wanted) addNeed(t, 'purpose', WANTED_PURPOSE);

  const delighted = pref >= 0.5;
  const note = wanted ? ' — just what they wanted' : delighted ? ' — a gift after their own heart' : '';
  remember(world, cId, 'social', `You gave ${t.name} your ${name}${note}.`);
  remember(world, to, 'social', `${c.name} gave you a ${name}${wanted ? ', which you had wanted' : ''}.`);
  emit(world, 'gift', `${c.name} gave ${t.name} a ${name}${note}.`, [cId, to], delighted ? 0.3 : 0.2,
    { itemId, productId: item.productId, preference: pref });
  return ok(`You gave ${t.name} your ${name}${note}.`);
}

// ---------------------------------------------------------------------------
// Crafting and prices
// ---------------------------------------------------------------------------

/** The business a citizen owns, or the one that employs them; null if neither is trading. */
export function workplaceOf(world: World, c: Citizen): Business | null {
  const owned = c.businessId ? world.businesses[c.businessId] : undefined;
  if (owned && owned.dissolvedDay === null && owned.ownerId === c.id) return owned;
  const job = c.jobId ? world.jobs[c.jobId] : undefined;
  if (!job || job.holderId !== c.id || job.employer === 'city') return null;
  const employer = world.businesses[job.employer];
  return employer && employer.dissolvedDay === null ? employer : null;
}

/** What the materials for one unit cost at today's Bazaar prices. */
export function materialCost(world: World, product: Product): number {
  let cost = 0;
  for (const [good, qty] of Object.entries(product.recipe)) cost += world.market.goods[good as Good].price * Math.max(0, qty);
  return cost;
}

/**
 * What a maker asks for a new line on the shelf until the owner says
 * otherwise: a shade under the Emporium's price for the same thing — a local
 * bench undercuts the importer — but never below the materials plus a
 * margin, or the shop would craft itself out of business.
 */
export function defaultShelfPrice(world: World, product: Product): number {
  const floor = materialCost(world, product) * CRAFT_MARKUP;
  return Math.max(1, Math.round(Math.max(floor, emporiumPrice(world, product) * CRAFT_UNDERCUT)));
}

/**
 * Craft one unit of a product at the shop, workshop or studio the citizen owns
 * or works at, in its district. Recipe goods come from the business inventory;
 * whatever is short is bought from the Bazaar at the business's expense. The
 * unit goes on the shelf at the owner's price (default base price × 1.2).
 */
export function craftProduct(world: World, cId: CitizenId, productId: string): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  const product = PRODUCTS[productId];
  if (!product) return fail(`There is no such product as ${String(productId)}.`);
  if (c.lifeStage === 'child') return fail('Children do not work the benches.');
  const biz = workplaceOf(world, c);
  if (!biz) return fail('You neither own nor work at a shop, workshop or studio.');
  if (!CRAFTING_KINDS.includes(biz.kind)) return fail(`${biz.name} is a ${biz.kind}; only shops, workshops and studios craft products.`);
  if (c.district !== biz.district) return fail(`${biz.name} is in ${districtName(world, biz.district)}, not here.`);
  if ((world.buildings[biz.buildingId]?.damage ?? 0) >= 1) return fail(`${biz.name}'s premises are in ruins.`);
  if (c.shiftsToday >= world.config.maxShiftsPerDay) return fail('You have done enough work for one day.');

  const recipe = Object.entries(product.recipe) as [Good, number][];
  for (const [good, qty] of recipe) {
    const need = Math.max(0, Math.round(qty));
    const have = Math.floor(biz.inventory[good] ?? 0);
    if (have >= need) continue;
    const r = buyFromMarket(world, biz.id, good, need - have);
    if (!r.ok) return fail(`${biz.name} could not get ${need - have} ${good} for a ${product.name}: ${r.message}`);
  }
  for (const [good, qty] of recipe) biz.inventory[good] -= Math.max(0, Math.round(qty));

  biz.shelf ??= {};
  const entry = biz.shelf[productId] ?? (biz.shelf[productId] = { qty: 0, price: defaultShelfPrice(world, product) });
  const first = entry.qty <= 0;
  entry.qty += 1;

  const skill = biz.kind === 'studio' ? 'artistry' : 'crafting';
  c.skills[skill] = clamp(round2(c.skills[skill] + CRAFT_SKILL), 0, 100);
  addNeed(c, 'purpose', CRAFT_PURPOSE);
  addNeed(c, 'rest', -CRAFT_REST);
  c.shiftsToday += 1;

  remember(world, cId, 'work', `You crafted a ${product.name} at ${biz.name}; it is on the shelf at ${entry.price} ℓ.`);
  if (first) {
    emit(world, 'trade', `${biz.name} put a ${product.name} on its shelf at ${entry.price} ℓ.`,
      biz.ownerId === cId ? [cId] : [cId, biz.ownerId], 0.15, { businessId: biz.id, productId, price: entry.price });
  }
  return ok(`You crafted a ${product.name}; ${biz.name} now has ${entry.qty} on the shelf at ${entry.price} ℓ.`);
}

/** The owner sets the shelf price of a product (a price may be set before any stock exists). */
export function setPrice(world: World, ownerId: CitizenId, productId: string, price: number): ActionResult {
  const c = presentCitizen(world, ownerId);
  if (!c) return fail('Unknown or absent citizen.');
  const biz = c.businessId ? world.businesses[c.businessId] : undefined;
  if (!biz || biz.dissolvedDay !== null || biz.ownerId !== ownerId) return fail('Only the owner of a business sets its prices.');
  if (!CRAFTING_KINDS.includes(biz.kind)) return fail(`${biz.name} has no shelf; only shops, workshops and studios sell products.`);
  const product = PRODUCTS[productId];
  if (!product) return fail(`There is no such product as ${String(productId)}.`);
  const p = Number.isFinite(price) ? Math.round(price) : 0;
  if (p < 1 || p > MAX_PRICE) return fail(`The price must be between 1 and ${MAX_PRICE} ℓ.`);

  biz.shelf ??= {};
  const entry = biz.shelf[productId] ?? (biz.shelf[productId] = { qty: 0, price: p });
  const before = entry.price;
  entry.price = p;
  remember(world, ownerId, 'money', `You priced the ${product.name} at ${biz.name} at ${p} ℓ.`);
  if (entry.qty > 0 && before !== p) {
    emit(world, 'price', `${biz.name} now sells the ${product.name} at ${p} ℓ.`, [ownerId], 0.1, { businessId: biz.id, productId, price: p });
  }
  return ok(`${biz.name} now sells the ${product.name} at ${p} ℓ${entry.qty > 0 ? '' : ' (none on the shelf yet)'}.`);
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

/**
 * The quiet comfort of owning things: every product's passive effect goes to
 * its owner each morning; companions cheer the whole household.
 */
export function dailyPossessions(world: World): void {
  const present = new Set<CitizenId>();
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled') present.add(id);
  }
  const gains = new Map<CitizenId, Partial<Record<Need, number>>>();
  const give = (id: CitizenId, need: Need, v: number) => {
    const g = gains.get(id) ?? {};
    g[need] = (g[need] ?? 0) + v;
    gains.set(id, g);
  };
  for (const id of present) {
    const c = world.citizens[id];
    for (const item of c.possessions) {
      const product = PRODUCTS[item.productId];
      if (!product) continue;
      const effects = Object.entries(product.passive) as [Need, number][];
      if (effects.length === 0) continue;
      const beneficiaries = product.category === 'companion'
        ? householdMembers(world, c).filter((m) => present.has(m.id))
        : [c];
      for (const b of beneficiaries) for (const [need, v] of effects) give(b.id, need, v);
    }
  }
  for (const [id, g] of gains) {
    const c = world.citizens[id];
    for (const [need, v] of Object.entries(g) as [Need, number][]) addNeed(c, need, v);
  }
}

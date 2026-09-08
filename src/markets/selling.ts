/**
 * Selling up (`docs/MOBILITY.md` §2).
 *
 * A citizen who is leaving — the city, the trade, or just the district — has
 * four ways out, and they are worth very different amounts of money:
 *
 * - `list_property` puts a deed on the Exchange's board **at your own price**.
 *   It sells when a buyer meets it, and property is illiquid: in a slow market
 *   it can sit for weeks. A tenant is not put out by a sale; the tenancy goes
 *   with the deed.
 * - `sell_business` offers the whole concern — its till, its stock, its shelf,
 *   its staff contracts and its premises. The buyer takes it over intact, the
 *   staff keep their jobs, and the name goes with it.
 * - `let_property` (in `property.ts`) keeps the asset and takes the income.
 * - `liquidate` is the quick way out: everything to the Exchange at once for
 *   **60–75 %** of market value, by the seller's commerce skill, in one day.
 *
 * Patience is worth real money, and that is the whole point: an agent who
 * plans a move over three weeks keeps far more than one who bolts.
 *
 * Every lumen moves through `treasury.transfer`. Nothing here mints or burns.
 */
import { GOODS } from '../types.ts';
import type { ActionResult, Business, BusinessId, Citizen, CitizenId, PropertyUnit, World } from '../types.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, transfer } from '../economy/treasury.ts';
import { marketPrice as goodPrice, sellToMarket } from '../economy/market.ts';
import { dissolveBusiness } from '../economy/business.ts';
import { isPresent } from '../citizens/citizen.ts';
import { recentProfit } from './shares.ts';
import {
  EXCHANGE_DISTRICT, MIN_PRICE, allUnits, askingPrice, businessRent, marketPrice, setAsking, unitsFor,
} from './property.ts';

/** The worst a fire sale pays, and the best a master of commerce can get. */
export const FIRE_SALE_MIN = 0.60;
export const FIRE_SALE_MAX = 0.75;
/** A going concern is worth its till, its stock, and this many times what it has been making. */
export const GOODWILL_MULTIPLE = 10;
/** And never less than a few days of the pitch it trades from. */
export const GOODWILL_DAYS = 5;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function jailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

/** Everything a citizen must be to deal at all. */
function dealing(world: World, cId: CitizenId): Citizen | ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  if (c.lifeStage === 'child') return fail('You must be grown to hold a deed.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot deal in property while ${c.standing}.`);
  if (jailed(world, c)) return fail('You cannot deal in property from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot deal while detained.');
  return c;
}

function refused(r: Citizen | ActionResult): r is ActionResult {
  return (r as ActionResult).ok !== undefined;
}

// ---------------------------------------------------------------------------
// Listing a property at your own price
// ---------------------------------------------------------------------------

/**
 * Put a home or shopfront on the market at the price you name. It sells when a
 * buyer meets it — which may be tomorrow and may be never. A price of 0 takes
 * the listing down again.
 */
export function listProperty(world: World, cId: CitizenId, unitId: string, price: number): ActionResult {
  const checked = dealing(world, cId);
  if (refused(checked)) return checked;
  const c = checked;
  const u = (world.property ?? {})[unitId] ?? null;
  if (!u) return fail('There is no such unit.');
  if (u.ownerId !== cId) return fail('That deed is not yours to sell.');

  const wanted = Number.isFinite(price) ? Math.round(price) : 0;
  if (wanted <= 0) {
    const was = askingPrice(world, u);
    setAsking(world, u, 0);
    if (was === null) return fail('That unit is not on the board.');
    remember(world, cId, 'money', `You took ${describe(world, u)} off the market.`);
    return ok(`You took ${describe(world, u)} off the market.`);
  }
  if (wanted < MIN_PRICE) return fail(`No deed in Reverie changes hands for less than ${MIN_PRICE} ℓ.`);

  setAsking(world, u, wanted);
  const worth = marketPrice(world, u);
  const note = wanted > worth * 1.2 ? ' It is dear for the address; it may sit a long while.' : '';
  emit(world, 'property', `${c.name} put ${describe(world, u)} on the market at ${wanted} ℓ.`,
    [cId], 0.3, { unitId: u.id, price: wanted, worth });
  remember(world, cId, 'money', `You listed ${describe(world, u)} at ${wanted} ℓ (the address is worth about ${worth} ℓ).${note}`);
  return ok(`${describe(world, u)} is on the board at ${wanted} ℓ.`);
}

function describe(world: World, u: PropertyUnit): string {
  const name = world.buildings?.[u.buildingId]?.name ?? u.buildingId;
  return `${u.kind === 'shopfront' ? 'the shopfront at' : 'a unit at'} ${name}`;
}

// ---------------------------------------------------------------------------
// Selling a business as a going concern
// ---------------------------------------------------------------------------

/** What the stock on a business's hands would fetch at the Bazaar today. */
export function stockValue(world: World, biz: Business): number {
  let value = 0;
  for (const good of GOODS) value += Math.floor(biz.inventory[good] ?? 0) * goodPrice(world, good);
  for (const [productId, entry] of Object.entries(biz.shelf ?? {})) {
    const product = PRODUCTS[productId];
    if (product) value += Math.max(0, Math.floor(entry.qty ?? 0)) * product.basePrice;
  }
  return Math.round(value);
}

/**
 * What a concern is worth: its till, its stock, and what it has been making —
 * ten times its last three days of profit, or a few days of its pitch, so a
 * good address is worth something even to a business having a bad week.
 */
export function businessValue(world: World, biz: Business): number {
  const profit = Math.max(0, recentProfit(world, biz.id));
  const goodwill = Math.max(profit * GOODWILL_MULTIPLE, businessRent(world, biz) * GOODWILL_DAYS);
  return Math.max(1, Math.round(biz.treasury + stockValue(world, biz) + goodwill));
}

/** What the owner is asking for the whole concern, when they have offered it. */
export function businessAsk(world: World, businessId: BusinessId): number | null {
  const ask = world.counters[`bizask:${businessId}`];
  return typeof ask === 'number' && ask > 0 ? Math.round(ask) : null;
}

/** Every concern on the board, cheapest first. */
export function businessesForSale(world: World): { business: Business; price: number }[] {
  return Object.values(world.businesses)
    .filter((b) => b.dissolvedDay === null && businessAsk(world, b.id) !== null)
    .map((b) => ({ business: b, price: businessAsk(world, b.id) as number }))
    .sort((a, b) => a.price - b.price || a.business.id.localeCompare(b.business.id, 'en'));
}

/**
 * Offer the whole concern at a price. A price of 0 takes it off the board.
 * Nothing changes hands until somebody meets it.
 */
export function sellBusiness(world: World, cId: CitizenId, price: number): ActionResult {
  const checked = dealing(world, cId);
  if (refused(checked)) return checked;
  const c = checked;
  const biz = c.businessId ? world.businesses[c.businessId] ?? null : null;
  if (!biz || biz.dissolvedDay !== null) return fail('You have no business to sell.');

  const wanted = Number.isFinite(price) ? Math.round(price) : 0;
  if (wanted <= 0) {
    const was = businessAsk(world, biz.id);
    delete world.counters[`bizask:${biz.id}`];
    if (was === null) return fail(`${biz.name} is not on the board.`);
    remember(world, cId, 'money', `You took ${biz.name} off the market.`);
    return ok(`You took ${biz.name} off the market.`);
  }
  world.counters[`bizask:${biz.id}`] = wanted;
  const worth = businessValue(world, biz);
  emit(world, 'property', `${c.name} offered ${biz.name} for sale as a going concern at ${wanted} ℓ.`,
    [cId], 0.5, { businessId: biz.id, price: wanted, worth });
  remember(world, cId, 'money', `You offered ${biz.name} for sale at ${wanted} ℓ; the Exchange values it at about ${worth} ℓ.`);
  for (const e of biz.employees) {
    remember(world, e, 'work', `${biz.name} is up for sale at ${wanted} ℓ. Your contract goes with it.`);
  }
  return ok(`${biz.name} is on the board at ${wanted} ℓ.`);
}

/**
 * Take over a concern that is on the board: treasury, stock, shelf, staff
 * contracts and premises, intact. The staff keep their jobs and the name and
 * its reputation transfer with the deed.
 */
export function buyBusiness(world: World, buyerId: CitizenId, businessId: BusinessId): ActionResult {
  const checked = dealing(world, buyerId);
  if (refused(checked)) return checked;
  const buyer = checked;
  if (buyer.district !== EXCHANGE_DISTRICT) return fail('A business changes hands at the Exchange, in Harbor Market.');
  if (buyer.standing !== 'good') return fail('Only citizens in good standing may own a business.');
  const biz = world.businesses[businessId] ?? null;
  if (!biz || biz.dissolvedDay !== null) return fail('There is no such business trading.');
  if (biz.ownerId === buyerId) return fail('You already own it.');
  const existing = buyer.businessId ? world.businesses[buyer.businessId] ?? null : null;
  if (existing && existing.dissolvedDay === null) return fail('You already own a business.');
  const price = businessAsk(world, biz.id);
  if (price === null) return fail(`${biz.name} is not for sale.`);
  if (buyer.wallet < price) return fail(`${biz.name} is on the board at ${price} ℓ; you have ${buyer.wallet} ℓ.`);

  const sellerId = biz.ownerId;
  const seller = world.citizens[sellerId] ?? null;
  const payee = seller ? seller.id : 'treasury';
  if (!transfer(world, buyerId, payee, price, 'acquisition', `purchase of ${biz.name} as a going concern`)) {
    return fail('The sale could not be paid for.');
  }
  delete world.counters[`bizask:${biz.id}`];
  biz.ownerId = buyerId;
  buyer.businessId = biz.id;
  if (seller && seller.businessId === biz.id) seller.businessId = null;

  const from = seller ? seller.name : 'the city';
  emit(world, 'property', `${buyer.name} bought ${biz.name} from ${from} for ${price} ℓ; its ${biz.employees.length} staff keep their jobs.`,
    seller ? [buyerId, seller.id] : [buyerId], 0.6, { businessId: biz.id, price, buyer: buyerId, seller: sellerId });
  remember(world, buyerId, 'money', `You bought ${biz.name} for ${price} ℓ, staff and premises and all.`);
  if (seller) remember(world, seller.id, 'money', `${buyer.name} bought ${biz.name} from you for ${price} ℓ.`);
  for (const e of biz.employees) {
    remember(world, e, 'work', `${biz.name} has a new owner, ${buyer.name}. Your job is unchanged.`);
  }
  return ok(`You own ${biz.name}; you paid ${price} ℓ and its staff stay on.`);
}

// ---------------------------------------------------------------------------
// The fire sale
// ---------------------------------------------------------------------------

/** What a fire sale pays, as a share of market value: 60 % to 75 % by commerce. */
export function fireSaleShare(c: Citizen): number {
  const skill = Math.max(0, Math.min(100, c.skills.commerce));
  return FIRE_SALE_MIN + (FIRE_SALE_MAX - FIRE_SALE_MIN) * (skill / 100);
}

/** What the Exchange would pay today for everything this citizen holds. */
export function liquidValue(world: World, c: Citizen): number {
  let value = 0;
  for (const u of unitsFor(world, c.id)) value += marketPrice(world, u);
  const biz = c.businessId ? world.businesses[c.businessId] ?? null : null;
  if (biz && biz.dissolvedDay === null) value += businessValue(world, biz);
  for (const good of GOODS) value += Math.floor(c.inventory[good] ?? 0) * goodPrice(world, good);
  for (const item of c.possessions ?? []) value += PRODUCTS[item.productId]?.basePrice ?? 0;
  return Math.round(value);
}

function payFromTreasury(world: World, c: Citizen, amount: number, memo: string): boolean {
  const due = Math.max(1, Math.round(amount));
  if (balanceOf(world, 'treasury') < due) return false;
  return transfer(world, 'treasury', c.id, due, 'property', memo);
}

/**
 * The quick way out: deeds, the concern, the stock and the things on the shelf,
 * all to the Exchange at once, at 60–75 % of what they are worth. It costs a
 * quarter of a life's work and it takes one day — so it can be done once a day
 * and no more.
 */
export function liquidate(world: World, cId: CitizenId): ActionResult {
  const checked = dealing(world, cId);
  if (refused(checked)) return checked;
  const c = checked;
  if (c.district !== EXCHANGE_DISTRICT) return fail('A fire sale is held at the Exchange, in Harbor Market.');
  if (world.counters[`liquidated:${cId}`] === world.day) return fail('You have already sold up today.');

  const share = fireSaleShare(c);
  const units = unitsFor(world, c.id);
  const biz = c.businessId ? world.businesses[c.businessId] ?? null : null;
  const things = [...(c.possessions ?? [])];
  const hasGoods = GOODS.some((g) => Math.floor(c.inventory[g] ?? 0) > 0);
  if (units.length === 0 && !biz && things.length === 0 && !hasGoods) {
    return fail('You have nothing the Exchange would take.');
  }
  world.counters[`liquidated:${cId}`] = world.day;

  let raised = 0;
  const sold: string[] = [];

  for (const u of units) {
    const paid = Math.max(1, Math.round(marketPrice(world, u) * share));
    if (!payFromTreasury(world, c, paid, `fire sale of ${describe(world, u)}`)) continue;
    // The deed goes to the city; a tenancy is not disturbed by a sale, and an
    // owner-occupier who sells up stays where they are as the city's tenant.
    u.ownerId = 'city';
    setAsking(world, u, 0);
    delete world.counters[`let:${u.id}`];
    c.ownedUnits = (c.ownedUnits ?? []).filter((id) => id !== u.id);
    raised += paid;
    sold.push(describe(world, u));
  }

  if (biz && biz.dissolvedDay === null) {
    const paid = Math.max(1, Math.round(businessValue(world, biz) * share));
    if (payFromTreasury(world, c, paid, `fire sale of ${biz.name}`)) {
      raised += paid;
      sold.push(biz.name);
      delete world.counters[`bizask:${biz.id}`];
      // The Exchange has paid for the concern, so what is left in the till is
      // the Exchange's: the business is wound up to the Treasury.
      dissolveBusiness(world, biz.id, 'sold to the Exchange in a fire sale', true);
    }
  }

  for (const good of GOODS) {
    const qty = Math.floor(c.inventory[good] ?? 0);
    if (qty <= 0) continue;
    // The Bazaar pays for goods itself, at its own price less the sales tax,
    // so what it paid is read off the purse rather than worked out again here.
    // It still belongs in the total: a fire sale that raised "0 ℓ" while the
    // Bazaar was paying for the stock told the city something untrue.
    const before = balanceOf(world, c.id);
    if (sellToMarket(world, c.id, good, qty).ok) {
      raised += Math.max(0, balanceOf(world, c.id) - before);
      sold.push(`${qty} ${good}`);
    }
  }

  for (const item of things) {
    const product = PRODUCTS[item.productId];
    if (!product) continue;
    const paid = Math.max(1, Math.round(product.basePrice * share));
    if (!payFromTreasury(world, c, paid, `fire sale of ${product.name}`)) continue;
    c.possessions = (c.possessions ?? []).filter((i) => i.id !== item.id);
    world.emporium[item.productId] = (world.emporium[item.productId] ?? 0) + 1;
    raised += paid;
    sold.push(product.name);
  }

  if (sold.length === 0) return fail('The Exchange could not find the lumens for any of it today.');
  const percent = Math.round(share * 100);
  emit(world, 'property', `${c.name} sold up at the Exchange: ${sold.length} lots for ${raised} ℓ, at ${percent} % of value.`,
    [cId], 0.6, { raised, share: percent, lots: sold.length });
  remember(world, cId, 'money',
    `You sold everything to the Exchange at ${percent} % of its worth and raised ${raised} ℓ: ${sold.slice(0, 6).join(', ')}.`);
  return ok(`You sold up for ${raised} ℓ, at ${percent} % of market value.`);
}

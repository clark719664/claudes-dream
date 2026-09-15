/**
 * The arithmetic of the black market (`docs/UNDERWORLD.md` §4).
 *
 * There is no black-market building. What there is instead is four sums, every
 * term of which is a public fact: what a fence will pay for something hot, what
 * a restricted good costs when the schedule has taken it off the shelf, what a
 * lawful crate costs to land, and the difference between those last two — which
 * is the evidence.
 *
 * **The price signal is itself the evidence.** A shelf carrying smuggled stock
 * undercuts what a lawful crate costs to land, and both figures are public, so
 * a detective assigned to a shelf and a journalist reading the same two numbers
 * reach the same conclusion out of the same arithmetic. Every
 * counter-intelligence case in the Expanse begins with somebody noticing a
 * price.
 */
import { clamp } from '../types.ts';
import type { BusinessId, CitizenId, Good, OffenceCode, World } from '../types.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { anchorPrice, marketPrice } from '../economy/market.ts';
import { memo } from '../util/memo.ts';
import type { CargoLine } from './schedule.ts';
import { restrictionSeverityOn } from './schedule.ts';
import type { CityKey } from './state.ts';
import { FOUNDING_TARIFF, HOME_CITY, underworldState } from './state.ts';

// ---------------------------------------------------------------------------
// Heat: how recently, and how loudly, this was taken
// ---------------------------------------------------------------------------

/** Offences a lot of goods can have been taken in. Money moves the same way. */
export const ACQUISITIVE: readonly OffenceCode[] = ['L04', 'L08', 'L07'];

/** Days inside which a theft is still fresh. */
export const HEAT_WINDOW_DAYS = 3;

export const HEAT_DETECTED = 1.0;
export const HEAT_UNREPORTED = 0.6;
export const HEAT_NAMED_ITEM = 0.3;
export const HEAT_COLD = 0.1;

/** What a fence pays at heat 0, before the seller's own trade is counted. */
export const FENCE_BASE = 0.70;
/** ...and how much of that the heat takes away. */
export const FENCE_HEAT = 0.40;
/** The seller's commerce is worth this much of the price, either way. */
export const FENCE_COMMERCE = 0.20;
export const FENCE_COMMERCE_FLOOR = 0.9;

/** Dealings a fence needs before the whole city knows their name. */
export const NOTORIETY_FULL = 8;
/** A well-known fence pays this much less, because they can. */
export const NOTORIETY_DISCOUNT = 0.15;
/** One reported and acquitted pays this much more, because nobody believes the acquittal. */
export const ACQUITTAL_PREMIUM = 0.15;

/** The black price rises this much per point of restriction severity. */
export const RESTRICTION_MARKUP = 0.5;
/** ...and this much for a week of empty shelves. */
export const SCARCITY_MARKUP = 0.3;
/** However restricted and however scarce, no black price passes this multiple of the anchor. */
export const BLACK_PRICE_CAP = 4;

/** The spread a hand takes for changing money (`MOBILITY.md` §3, until it owns the number). */
export const EXCHANGE_SPREAD = 0.03;
/** What carriage costs a lawful importer per unit landed. */
export const CARRIAGE_PER_UNIT = 6;
/** A shelf this far under what a lawful crate lands at is worth a detective's day. */
export const SUSPICION_THRESHOLD = 0.30;

/**
 * What a lot is worth on the open shelf: the Bazaar's price for a good, the
 * catalogue's price at today's index for a named thing, and the lumens
 * themselves for a lot of money.
 */
export function lawfulPrice(world: World, line: CargoLine): number {
  if (line.good) return Math.max(0, Math.round(marketPrice(world, line.good) * Math.max(0, line.qty)));
  if (line.productId) {
    const p = PRODUCTS[line.productId];
    if (p) return Math.max(1, Math.round(p.basePrice * (world.market?.priceIndex ?? 1))) * Math.max(0, line.qty);
  }
  return Math.max(0, Math.round(line.value));
}

export interface HeatContext {
  /** A named catalogue item whose owner is alive and public. */
  namedItem?: boolean;
  /** The day the lot was taken, where the seller says so. */
  takenDay?: number;
}

/**
 * How hot a lot is, 0..1, read off the seller's own record. The engine cannot
 * tie a particular crate to a particular theft — nobody can, which is the
 * point of a fence — so what stands in for provenance is the same thing a
 * fence actually uses: what this seller has been doing lately, and whether the
 * Watch knows about it.
 */
export function heatOf(world: World, sellerId: CitizenId, ctx: HeatContext = {}): number {
  const seller = world.citizens[sellerId];
  if (!seller) return HEAT_COLD;
  const window = HEAT_WINDOW_DAYS * 24;
  let hottest = 0;
  for (const o of seller.recentOffences) {
    if (!ACQUISITIVE.includes(o.law)) continue;
    if (world.tick - o.tick > window) continue;
    hottest = Math.max(hottest, o.detected ? HEAT_DETECTED : HEAT_UNREPORTED);
  }
  if (hottest > 0) return hottest;
  return ctx.namedItem ? HEAT_NAMED_ITEM : HEAT_COLD;
}

/** How well known a fence is: word of mouth, never repute (`UNDERWORLD.md` §4). */
export function notorietyOf(world: World, fenceId: CitizenId): number {
  return Math.max(0, underworldState(world).notoriety[fenceId] ?? 0);
}

/** True while a fence reported and acquitted is still being paid the premium. */
export function recentlyAcquitted(world: World, fenceId: CitizenId): boolean {
  const day = underworldState(world).acquittedDay[fenceId];
  return day !== undefined && world.day - day <= Math.max(1, world.config.cycleDays);
}

/**
 * What a fence pays for a lot, in lumens.
 *
 * Fresh detected loot fetches about 30 % of value and cold goods two-thirds:
 * the spread pays the fence for holding the risk, and it is why a thief who
 * waits ends richer than one who runs.
 */
export function fencePays(world: World, sellerId: CitizenId, fenceId: CitizenId, value: number, heat: number): number {
  const seller = world.citizens[sellerId];
  const commerce = Math.max(0, Math.min(100, seller?.skills.commerce ?? 0));
  const h = clamp(heat, 0, 1);
  let paid = Math.max(0, value) * (FENCE_BASE - FENCE_HEAT * h) * (FENCE_COMMERCE_FLOOR + FENCE_COMMERCE * commerce / 100);
  paid *= 1 - NOTORIETY_DISCOUNT * Math.min(1, notorietyOf(world, fenceId) / NOTORIETY_FULL);
  if (recentlyAcquitted(world, fenceId)) paid *= 1 + ACQUITTAL_PREMIUM;
  return Math.max(0, Math.round(paid));
}

// ---------------------------------------------------------------------------
// The black price, and what a lawful crate costs to land
// ---------------------------------------------------------------------------

/** Days the Bazaar has held no stock of a good at all. */
export function daysBare(world: World, good: Good): number {
  return Math.max(0, underworldState(world).bare[good] ?? 0);
}

/** The duty a city takes on a declared value. Reverie's is the Council's own tariff. */
export function tariffOf(world: World, city: CityKey): number {
  if (city === HOME_CITY) {
    const set = world.outer?.tariff;
    return clamp(Number.isFinite(set) ? (set as number) : FOUNDING_TARIFF.reverie, 0, 0.5);
  }
  return clamp(FOUNDING_TARIFF[city] ?? 0, 0, 0.5);
}

/**
 * What a restricted good costs where the schedule has taken it off the shelf.
 * Restriction is a price and the price is the smuggler's wage: a council that
 * restricts a good it cannot supply has funded its own opposition, and this is
 * the number the Chronicle prints.
 */
export function blackPrice(world: World, good: Good, city: CityKey = HOME_CITY): number {
  const anchor = anchorPrice(world, good);
  const severity = restrictionSeverityOn(world, city, { good, productId: null, qty: 1, value: anchor },
    { direction: 'either', declared: true });
  const evaded = severity > 0 ? tariffOf(world, city) : 0;
  const scarcity = SCARCITY_MARKUP * daysBare(world, good) / 7;
  const price = anchor * (1 + RESTRICTION_MARKUP * severity + evaded + scarcity);
  return Math.max(1, Math.round(Math.min(price, anchor * BLACK_PRICE_CAP)));
}

/** What one unit of a named thing costs a lawful importer to land, delivered. */
export function landedCost(world: World, productId: string, city: CityKey = HOME_CITY): number {
  const p = PRODUCTS[productId];
  if (!p) return 0;
  const origin = p.basePrice;
  const duty = origin * tariffOf(world, city);
  return Math.max(1, Math.round(origin * (1 + EXCHANGE_SPREAD) + duty + CARRIAGE_PER_UNIT));
}

/**
 * How far under a lawful landing a shelf is selling, 0..1. Anything at or
 * below the landed cost is 0: a shop that pays what the crate cost has nothing
 * to answer for.
 */
export function suspicionOf(world: World, productId: string, shelfPrice: number): number {
  const landed = landedCost(world, productId);
  if (landed <= 0) return 0;
  return clamp((landed - Math.max(0, shelfPrice)) / landed, 0, 1);
}

export interface SuspectShelf {
  businessId: BusinessId;
  name: string;
  productId: string;
  productName: string;
  price: number;
  landed: number;
  suspicion: number;
  qty: number;
}

/**
 * Every shelf in the city undercutting a lawful landing, worst first. The
 * Chronicle runs the story off this list and a detective works it: *the Night
 * Market is selling star lenses forty marks under what a lawful one lands at.*
 */
export function suspectShelves(world: World, threshold = SUSPICION_THRESHOLD): SuspectShelf[] {
  // Every citizen's observation asks this once an hour, so during a reading
  // round the shelves of the whole city are read once (`util/memo.ts`).
  return memo(world, `underworld:shelves:${threshold}`, () => suspectShelvesNow(world, threshold));
}

function suspectShelvesNow(world: World, threshold: number): SuspectShelf[] {
  const out: SuspectShelf[] = [];
  for (const b of Object.values(world.businesses)) {
    if (b.dissolvedDay !== null) continue;
    for (const [productId, entry] of Object.entries(b.shelf ?? {})) {
      const product = PRODUCTS[productId];
      if (!product || !entry || entry.qty <= 0) continue;
      const suspicion = suspicionOf(world, productId, entry.price);
      if (suspicion < threshold) continue;
      out.push({
        businessId: b.id, name: b.name, productId, productName: product.name,
        price: entry.price, landed: landedCost(world, productId), suspicion, qty: entry.qty,
      });
    }
  }
  return out.sort((a, b) => b.suspicion - a.suspicion || a.businessId.localeCompare(b.businessId));
}

/**
 * The Grand Bazaar: the single market where every good is bought and sold.
 *
 * Prices are integers (what citizens see and pay) but the underlying dynamic
 * is continuous, so each good keeps a fractional residual in world.counters
 * ("pricefrac:<good>"). Without it a 3 ℓ good could never move by 5%.
 * Production is likewise fractional (1.5 goods per shift); wholeUnits() turns
 * it into integer stock with a carry in world.counters ("carry:<key>").
 */
import { GOODS, clamp } from '../types.ts';
import type { ActionResult, BusinessId, Citizen, CitizenId, Good, Inventory, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, transfer } from './treasury.ts';

/** Proportional price step per tick when demand and supply diverge. */
export const PRICE_STEP = 0.05;
/** Fraction of the gap to the founding price closed per quiet tick. */
export const MEAN_REVERSION = 0.01;
/** Prices never exceed this multiple of the founding price. */
export const PRICE_CAP_MULTIPLIER = 20;
/** A single trade worth at least this much is newsworthy enough for the log. */
const NOTABLE_TRADE = 100;

interface Holder { inv: Inventory; name: string; citizen: Citizen | null }

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** Resolve a trading party to its inventory. Dissolved businesses and exiles cannot trade. */
function resolveHolder(world: World, id: CitizenId | BusinessId): Holder | null {
  const c = world.citizens[id];
  if (c) return c.standing === 'exiled' ? null : { inv: c.inventory, name: c.name, citizen: c };
  const b = world.businesses[id];
  if (b && b.dissolvedDay === null) return { inv: b.inventory, name: b.name, citizen: null };
  return null;
}

/**
 * Convert a fractional quantity into whole units, carrying the remainder in
 * world.counters[key] so nothing is lost across calls.
 */
export function wholeUnits(world: World, key: string, qty: number): number {
  if (!Number.isFinite(qty) || qty <= 0) return 0;
  const total = Math.round(((world.counters[key] ?? 0) + qty) * 1e6) / 1e6;
  const whole = Math.floor(total);
  world.counters[key] = Math.round((total - whole) * 1e6) / 1e6;
  return whole;
}

export function marketPrice(world: World, good: Good): number {
  return world.market.goods[good].price;
}

/**
 * Buy from the Bazaar: price + sales tax, both to the Treasury. Only completed
 * purchases count as demand: a failed attempt against an empty shelf must not
 * drive the price (otherwise a shortage ratchets the price to the cap and it
 * never comes down, because nobody can buy at the cap either).
 */
export function buyFromMarket(world: World, buyer: CitizenId | BusinessId, good: Good, qty: number): ActionResult {
  const q = Number.isFinite(qty) ? Math.round(qty) : 0;
  if (q <= 0) return fail('Quantity must be a positive whole number.');
  const mg = world.market.goods[good];
  if (!mg) return fail(`There is no such good as ${String(good)}.`);
  const holder = resolveHolder(world, buyer);
  if (!holder) return fail('Unknown or inactive buyer.');

  if (mg.stock < q) {
    world.counters[`unmet:${good}`] = (world.counters[`unmet:${good}`] ?? 0) + q;
    return fail(mg.stock <= 0
      ? `The Bazaar has no ${good} in stock.`
      : `The Bazaar only has ${mg.stock} ${good} in stock.`);
  }
  const base = Math.round(mg.price * q);
  const cost = Math.round(mg.price * q * (1 + clamp(world.government.salesTax, 0, 1)));
  const tax = Math.max(0, cost - base);
  if (balanceOf(world, buyer) < cost) return fail(`You cannot afford ${q} ${good} (${cost} ℓ).`);

  if (!transfer(world, buyer, 'treasury', base, 'purchase', `${q} ${good} at the Bazaar`)) return fail('The purchase could not be completed.');
  if (tax > 0) transfer(world, buyer, 'treasury', tax, 'sales_tax', `sales tax on ${q} ${good}`);

  mg.stock -= q;
  holder.inv[good] += q;
  mg.demandTick += q;
  mg.demandDay += q;
  if (holder.citizen) remember(world, holder.citizen.id, 'money', `You bought ${q} ${good} for ${cost} ℓ at the Bazaar.`);
  if (cost >= NOTABLE_TRADE) {
    emit(world, 'trade', `${holder.name} bought ${q} ${good} for ${cost} ℓ.`, holder.citizen ? [holder.citizen.id] : [], 0.1, { good, qty: q, cost });
  }
  return ok(`Bought ${q} ${good} for ${cost} ℓ (${tax} ℓ sales tax).`);
}

/** Sell to the Bazaar: the Treasury pays price minus sales tax; the tax stays in the Treasury. */
export function sellToMarket(world: World, seller: CitizenId | BusinessId, good: Good, qty: number): ActionResult {
  const q = Number.isFinite(qty) ? Math.round(qty) : 0;
  if (q <= 0) return fail('Quantity must be a positive whole number.');
  const mg = world.market.goods[good];
  if (!mg) return fail(`There is no such good as ${String(good)}.`);
  const holder = resolveHolder(world, seller);
  if (!holder) return fail('Unknown or inactive seller.');
  if (holder.inv[good] < q) return fail(`You only have ${holder.inv[good]} ${good} to sell.`);

  const gross = Math.round(mg.price * q);
  const proceeds = Math.round(mg.price * q * (1 - clamp(world.government.salesTax, 0, 1)));
  const tax = Math.max(0, gross - proceeds);
  if (world.treasury.balance < proceeds) return fail("The Bazaar's till is empty; try again later.");
  if (proceeds > 0 && !transfer(world, 'treasury', seller, proceeds, 'sale', `${q} ${good} sold at the Bazaar`)) {
    return fail('The sale could not be completed.');
  }
  if (tax > 0) world.treasury.totals.sales_tax = (world.treasury.totals.sales_tax ?? 0) + tax;

  holder.inv[good] -= q;
  mg.stock += q;
  mg.supplyTick += q;
  mg.supplyDay += q;
  if (holder.citizen) remember(world, holder.citizen.id, 'money', `You sold ${q} ${good} for ${proceeds} ℓ at the Bazaar.`);
  if (proceeds >= NOTABLE_TRADE) {
    emit(world, 'trade', `${holder.name} sold ${q} ${good} for ${proceeds} ℓ.`, holder.citizen ? [holder.citizen.id] : [], 0.1, { good, qty: q, proceeds });
  }
  return ok(`Sold ${q} ${good} for ${proceeds} ℓ (${tax} ℓ sales tax withheld).`);
}

/** City production arriving at the Bazaar: no money changes hands. Fractions carry over. */
export function deliverToMarket(world: World, good: Good, qty: number): void {
  const mg = world.market.goods[good];
  if (!mg) return;
  const units = wholeUnits(world, `carry:market:${good}`, qty);
  if (units <= 0) return;
  mg.stock += units;
  mg.supplyTick += units;
  mg.supplyDay += units;
}

/** Production inputs drawn by city jobs. Takes up to qty and returns what was taken, which counts as demand. */
export function takeFromMarket(world: World, good: Good, qty: number): number {
  const q = Number.isFinite(qty) ? Math.max(0, Math.round(qty)) : 0;
  const mg = world.market.goods[good];
  if (!mg || q === 0) return 0;
  const taken = Math.min(q, mg.stock);
  if (taken < q) world.counters[`unmet:${good}`] = (world.counters[`unmet:${good}`] ?? 0) + (q - taken);
  mg.stock -= taken;
  mg.demandTick += taken;
  mg.demandDay += taken;
  return taken;
}

/** Price with its hidden fractional residual. */
function effectivePrice(world: World, good: Good): number {
  return world.market.goods[good].price + (world.counters[`pricefrac:${good}`] ?? 0);
}

function setEffectivePrice(world: World, good: Good, value: number): void {
  const mg = world.market.goods[good];
  const bounded = clamp(value, 1, mg.basePrice * PRICE_CAP_MULTIPLIER);
  const price = Math.round(bounded);
  mg.price = price;
  world.counters[`pricefrac:${good}`] = Math.round((bounded - price) * 1e6) / 1e6;
}

/**
 * Hourly price update. Demand above supply pushes a price up by up to 5%,
 * supply above demand pushes it down; a quiet tick drifts 1% back toward the
 * founding price. A merchant on shift smooths the market (half step).
 */
export function tickMarket(world: World): void {
  const m = world.market;
  const merchantOn = world.counters.merchantOnShiftTick === world.tick;
  const step = merchantOn ? PRICE_STEP / 2 : PRICE_STEP;
  const shortages: Good[] = [];

  for (const good of GOODS) {
    const g = m.goods[good];
    const current = effectivePrice(world, good);
    if (g.demandTick === 0 && g.supplyTick === 0) {
      setEffectivePrice(world, good, current + (g.basePrice - current) * MEAN_REVERSION);
    } else {
      const ratio = clamp((g.demandTick - g.supplyTick) / Math.max(g.supplyTick, 1), -1, 1);
      setEffectivePrice(world, good, current * (1 + step * ratio));
    }

    const unmet = world.counters[`unmet:${good}`] ?? 0;
    if (g.stock <= 0 && (g.demandTick > 0 || unmet > 0)) {
      shortages.push(good);
      const key = `shortage:${good}`;
      if (world.counters[key] !== world.day) {
        world.counters[key] = world.day;
        emit(world, 'shortage', `The Bazaar has run out of ${good}; buyers are going without.`, [], 0.6, { good, price: g.price });
      }
    }
    g.demandTick = 0;
    g.supplyTick = 0;
    delete world.counters[`unmet:${good}`];
  }
  m.shortages = shortages;
}

/** Daily: recompute the price index, reset the day counters, report big moves. */
export function dailyMarket(world: World): void {
  const m = world.market;
  const previous = m.priceIndex;
  let sum = 0;
  for (const good of GOODS) {
    const g = m.goods[good];
    sum += g.price / g.basePrice;
    g.demandDay = 0;
    g.supplyDay = 0;
  }
  m.priceIndex = Math.round((sum / GOODS.length) * 1000) / 1000;
  if (previous > 0 && Math.abs(m.priceIndex - previous) / previous > 0.10) {
    const direction = m.priceIndex > previous ? 'rose' : 'fell';
    emit(world, 'price', `Prices ${direction} sharply: the price index moved from ${previous.toFixed(2)} to ${m.priceIndex.toFixed(2)}.`,
      [], 0.4, { previous, index: m.priceIndex });
  }
}

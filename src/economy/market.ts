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
import { CITY_JOBS, PIECE_RATE_ROLES, PIECE_RATE_SHARE, POSTED_RATE_PRODUCTIVITY } from '../data/jobs.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, transfer } from './treasury.ts';
import { salesTaxToday } from '../politics/decrees.ts';

/** Proportional price step per tick when demand and supply diverge. */
export const PRICE_STEP = 0.05;
/**
 * Fraction of the gap to the anchor price closed every tick. The anchor is
 * the founding price, or the cost of making the good at the current minimum
 * wage if that is higher (see anchorPrice); flows push a price away from it
 * and this pulls it back, so a moderate imbalance settles in a band instead
 * of walking to a bound.
 */
export const MEAN_REVERSION = 0.02;
/** Prices never exceed this multiple of the founding price. */
export const PRICE_CAP_MULTIPLIER = 20;
/**
 * Ticks over which the demand and supply rates that drive prices are
 * averaged: one city day. Production happens only in working hours while
 * consumption runs around the clock, so comparing a single tick's flows would
 * read every night-time purchase as a shortage (demand 1, supply 0) and walk a
 * perfectly balanced market up to the price cap within days.
 */
export const FLOW_WINDOW_TICKS = 24;
/**
 * Days of demand the Bazaar likes to hold. A shelf with this much cover feels
 * no upward pressure however brisk the trade; an empty one feels no downward
 * pressure. Without this the price would react to flows alone and walk to the
 * cap while hundreds of units sat unsold.
 */
export const COMFORT_COVER_DAYS = 3;
/**
 * Least upward pressure (as a share of a full step) while the shelf is bare
 * and buyers are going without. Against the 2% pull toward the anchor price
 * it settles a lasting famine at about 1.6× that price: a real scarcity
 * signal that can never walk to the cap on its own.
 */
export const SHORTAGE_PRESSURE = 0.15;
/**
 * Days of demand the Bazaar will hold before it stops buying a good from
 * citizens and businesses. Without this the Treasury would pay for every
 * crate a private workshop turns out whether or not anyone wants it; with it
 * a glut stops at the producer's door and the Treasury's exposure to private
 * overproduction is bounded. City production is not bought and is managed
 * by the labour plan instead (economy/planning.ts).
 */
export const BAZAAR_MAX_COVER_DAYS = 6;
/** Supply rate (units per tick) below which the ratio treats supply as "about one unit a day". */
const MIN_SUPPLY_RATE = 1 / FLOW_WINDOW_TICKS;
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
 * What a unit of a city-made good costs to make at the current minimum wage:
 * the wage of a typical shift divided by the share of its output the wage
 * covers (data/jobs.ts piece rates), for the most productive post making the
 * good. Null for goods no piece-rate post makes.
 */
export function costPrice(world: World, good: Good): number | null {
  let unitsPerWage = 0;
  for (const t of CITY_JOBS) {
    if (t.output.good !== good || !PIECE_RATE_ROLES.includes(t.role)) continue;
    unitsPerWage = Math.max(unitsPerWage, (t.output.qty ?? 0) * POSTED_RATE_PRODUCTIVITY * PIECE_RATE_SHARE);
  }
  if (unitsPerWage <= 0) return null;
  return Math.max(0, world.government.minWage) / unitsPerWage;
}

/**
 * The price a good drifts back toward: its founding price, or its cost at
 * the current minimum wage when the Council has set that higher. A higher
 * minimum wage therefore passes through to prices rather than bankrupting
 * every producer, and at the founding minimum wage the anchor is the
 * founding price by construction.
 */
export function anchorPrice(world: World, good: Good): number {
  const base = world.market.goods[good].basePrice;
  const cost = costPrice(world, good);
  return cost === null ? base : Math.max(base, cost);
}

/** Price relative to its anchor (1 = where it would settle with supply and demand balanced). */
export function priceVsAnchor(world: World, good: Good): number {
  const anchor = anchorPrice(world, good);
  return anchor > 0 ? world.market.goods[good].price / anchor : 1;
}

/** Units buyers asked for this tick that the shelf could not provide (cleared by tickMarket). */
export function unmetDemand(world: World, good: Good): number {
  return world.counters[`unmet:${good}`] ?? 0;
}

function noteUnmetDemand(world: World, good: Good, qty: number): void {
  if (qty > 0) world.counters[`unmet:${good}`] = unmetDemand(world, good) + qty;
}

function rateKey(kind: 'demand' | 'supply', good: Good): string {
  return `flow:${kind}:${good}`;
}

/** Smoothed demand and supply in units per tick (exponential average over FLOW_WINDOW_TICKS). */
export function flowRates(world: World, good: Good): { demand: number; supply: number } {
  return {
    demand: world.counters[rateKey('demand', good)] ?? 0,
    supply: world.counters[rateKey('supply', good)] ?? 0,
  };
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

/** Days the current stock would last at the smoothed demand rate (units when nobody is buying). */
export function daysOfCover(world: World, good: Good): number {
  const stock = Math.max(0, world.market.goods[good].stock);
  return stock / Math.max(1, flowRates(world, good).demand * 24);
}

/** Smoothed demand in units per day. */
export function demandPerDay(world: World, good: Good): number {
  return flowRates(world, good).demand * 24;
}

/**
 * Is the Bazaar taking this good from sellers today? Not while it holds
 * BAZAAR_MAX_COVER_DAYS of demand for it. A good nobody has bought yet (no
 * demand history, as at founding) is always taken.
 */
export function bazaarBuying(world: World, good: Good): boolean {
  if (demandPerDay(world, good) < 1) return true;
  return daysOfCover(world, good) < BAZAAR_MAX_COVER_DAYS;
}

/**
 * How much of a flow-driven step applies given the shelf: rises are damped by
 * cover (none at COMFORT_COVER_DAYS or more), falls by scarcity (none when empty).
 */
function coverGate(cover: number, rising: boolean): number {
  const share = clamp(cover / COMFORT_COVER_DAYS, 0, 1);
  return rising ? 1 - share : share;
}

/** Fold this tick's flows into the smoothed rates and return them. */
function updateFlowRates(world: World, good: Good, demandTick: number, supplyTick: number): { demand: number; supply: number } {
  const alpha = 1 / FLOW_WINDOW_TICKS;
  const prev = flowRates(world, good);
  const next = {
    demand: round6(prev.demand * (1 - alpha) + demandTick * alpha),
    supply: round6(prev.supply * (1 - alpha) + supplyTick * alpha),
  };
  world.counters[rateKey('demand', good)] = next.demand;
  world.counters[rateKey('supply', good)] = next.supply;
  return next;
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
    noteUnmetDemand(world, good, q);
    return fail(mg.stock <= 0
      ? `The Bazaar has no ${good} in stock.`
      : `The Bazaar only has ${mg.stock} ${good} in stock.`);
  }
  const base = Math.round(mg.price * q);
  const cost = Math.round(mg.price * q * (1 + clamp(salesTaxToday(world), 0, 1)));
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

/** Sell to the Bazaar: the Treasury pays price minus sales tax; the tax stays in the Treasury. Refused while the shelf is overstocked. */
export function sellToMarket(world: World, seller: CitizenId | BusinessId, good: Good, qty: number): ActionResult {
  const q = Number.isFinite(qty) ? Math.round(qty) : 0;
  if (q <= 0) return fail('Quantity must be a positive whole number.');
  const mg = world.market.goods[good];
  if (!mg) return fail(`There is no such good as ${String(good)}.`);
  const holder = resolveHolder(world, seller);
  if (!holder) return fail('Unknown or inactive seller.');
  if (holder.inv[good] < q) return fail(`You only have ${holder.inv[good]} ${good} to sell.`);
  if (!bazaarBuying(world, good)) {
    return fail(`The Bazaar is not buying ${good} today: its shelves already hold ${Math.round(daysOfCover(world, good))} days of it.`);
  }

  const gross = Math.round(mg.price * q);
  const proceeds = Math.round(mg.price * q * (1 - clamp(salesTaxToday(world), 0, 1)));
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
  noteUnmetDemand(world, good, q - taken);
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
 * Hourly price update. On a tick with any trading, the price moves by up to
 * 5% toward the ratio of demand to supply, both measured as rates smoothed
 * over the last day (see FLOW_WINDOW_TICKS), and damped by the state of the
 * shelf (see COMFORT_COVER_DAYS): a well-stocked good does not get dearer
 * however brisk the trade, an empty one does not get cheaper. Only completed
 * trades drive the ratio: buyers turned away by an empty shelf are reported
 * as a shortage and add a small fixed pressure (SHORTAGE_PRESSURE), because
 * in a city where the Bazaar pays fixed wages and keeps the takings a full
 * rationing price would only starve the poor. Every tick the price also
 * drifts 2% of the way back toward its anchor (the founding price, or the
 * cost of production at the minimum wage), so a glut settles at a discount
 * and a squeeze at a premium rather than at the floor or the cap. A merchant
 * on shift smooths the market (half step).
 */
export function tickMarket(world: World): void {
  const m = world.market;
  const merchantOn = world.counters.merchantOnShiftTick === world.tick;
  const step = merchantOn ? PRICE_STEP / 2 : PRICE_STEP;
  const shortages: Good[] = [];

  for (const good of GOODS) {
    const g = m.goods[good];
    const rates = updateFlowRates(world, good, g.demandTick, g.supplyTick);
    const unmet = unmetDemand(world, good);
    const short = g.stock <= 0 && (g.demandTick > 0 || unmet > 0);
    const current = effectivePrice(world, good);
    let next = current + (anchorPrice(world, good) - current) * MEAN_REVERSION;
    if (g.demandTick > 0 || g.supplyTick > 0 || unmet > 0) {
      const flow = clamp((rates.demand - rates.supply) / Math.max(rates.supply, MIN_SUPPLY_RATE), -1, 1);
      let ratio = flow * coverGate(daysOfCover(world, good), flow > 0);
      if (short) ratio = Math.max(ratio, SHORTAGE_PRESSURE);
      next += current * step * ratio;
    }
    setEffectivePrice(world, good, next);

    if (short) {
      shortages.push(good);
      const key = `shortage:${good}`;
      if (world.counters[key] !== world.day) {
        world.counters[key] = world.day;
        emit(world, 'shortage', `The Bazaar has run out of ${good}; buyers are going without.`, [], 0.6, { good, price: g.price, unmet });
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

/**
 * The Outer Cities — everything that is not Reverie.
 *
 * The Harbor's Docks look out on a market the city does not run: prices there
 * drift on their own, so some days it is worth buying abroad and some days it
 * is worth selling. Merchants carry goods either way and the Council's tariff
 * takes its cut of both. On Lantern Night visitors come in on the tide and
 * spend at the shops and the Bazaar before they go home again.
 *
 * **Money.** The Outer Cities are outside Reverie's money supply, so trade with
 * them uses the mint and the burn, which the Treasury already counts: an import
 * burns lumens (they leave with the ship), an export and a visitor's purse mint
 * them. `auditMoneySupply` stays exact — `founding + minted − burned` — and a
 * trade surplus is genuinely inflationary, which is the point.
 */
import { GOODS, clamp } from '../types.ts';
import type { ActionResult, Business, Citizen, CitizenId, Good, World } from '../types.ts';
import { OUTER_GOODS_DRIFT } from '../data/metropolis.ts';
import { normal, pick } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { marketPrice, takeFromMarket } from '../economy/market.ts';
import { isLanternNight } from '../society/calendar.ts';
import { memo } from '../util/memo.ts';

/** What one visitor spends in Reverie before the tide turns. */
export const TOURIST_SPEND = 12;
/** Visitors on a Lantern Night, before the weather is taken into account. */
export const TOURIST_BASE = 5;
/** One more visitor for every this many citizens. */
export const TOURISTS_PER_CITIZENS = 10;
/** The most a single crossing may carry, either way. */
export const MAX_TRADE_QTY = 200;
/** No Outer price ever falls below this. */
export const OUTER_PRICE_FLOOR = 1;
/** No Outer price ever rises above this multiple of the good's founding price. */
export const OUTER_PRICE_CEILING = 8;
/** The district the Docks stand in: trade happens at the water. */
export const DOCKS_DISTRICT = 'harbor_market' as const;
/** Businesses whose trade is carrying and selling, and so may deal across the water. */
export const TRADING_KINDS: readonly Business['kind'][] = ['shop', 'courier'];
/** Where a visitor spends the half of their purse that does not go to the Bazaar. */
export const VISITOR_KINDS: readonly Business['kind'][] = ['shop', 'cafe'];

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The Outer market. A world saved before this layer gets one at the founding prices. */
export function outerMarket(world: World): World['outer'] & object {
  if (!world.outer) {
    const prices = {} as Record<Good, number>;
    for (const g of GOODS) prices[g] = Math.max(OUTER_PRICE_FLOOR, Math.round(world.market.goods[g].basePrice * 1.1));
    world.outer = { prices, tariff: 0, touristsToday: 0 };
  }
  return world.outer;
}

export function outerPrice(world: World, good: Good): number {
  const p = outerMarket(world).prices[good];
  return Number.isFinite(p) ? Math.max(OUTER_PRICE_FLOOR, Math.round(p)) : OUTER_PRICE_FLOOR;
}

/** The Council's tariff, 0..0.5, taken on both what comes in and what goes out. */
export function tariff(world: World): number {
  const t = outerMarket(world).tariff;
  return Number.isFinite(t) ? clamp(t, 0, 0.5) : 0;
}

/** `enactProposal` sets the tariff here, clamped to what the Charter allows. */
export function setTariff(world: World, value: number): void {
  outerMarket(world).tariff = clamp(Number.isFinite(value) ? value : 0, 0, 0.5);
}

// ---------------------------------------------------------------------------
// The drift
// ---------------------------------------------------------------------------

/**
 * Each Outer price takes a small random step of its own every morning — never
 * more than OUTER_GOODS_DRIFT of itself, floored at a lumen and capped at eight
 * times the good's founding price. The fractional part of the step is carried
 * in `world.counters` so a cheap good can move at all.
 */
export function driftOuterPrices(world: World): void {
  const outer = outerMarket(world);
  for (const good of GOODS) {
    const base = world.market.goods[good].basePrice;
    const key = `outerfrac:${good}`;
    const carry = world.counters[key] ?? 0;
    const step = clamp(normal(world) / 3, -1, 1) * OUTER_GOODS_DRIFT;
    const moved = clamp((outerPrice(world, good) + carry) * (1 + step), OUTER_PRICE_FLOOR, base * OUTER_PRICE_CEILING);
    const rounded = Math.max(OUTER_PRICE_FLOOR, Math.round(moved));
    outer.prices[good] = rounded;
    world.counters[key] = Math.round((moved - rounded) * 1e6) / 1e6;
  }
}

// ---------------------------------------------------------------------------
// Who may trade
// ---------------------------------------------------------------------------

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

/** The active business a citizen owns, if any. */
function ownedBusiness(world: World, c: Citizen): Business | null {
  if (!c.businessId) return null;
  const b = world.businesses[c.businessId];
  return b && b.dissolvedDay === null ? b : null;
}

/**
 * A citizen may deal across the water if the city pays them to trade — a
 * merchant's post — or if they own a shop or a courier yard of their own.
 */
export function mayTrade(world: World, c: Citizen): boolean {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (job && job.holderId === c.id && job.role === 'merchant') return true;
  const biz = ownedBusiness(world, c);
  return !!biz && TRADING_KINDS.includes(biz.kind);
}

/** Everything both sides of a crossing must be true of. */
function checkTrader(world: World, cId: CitizenId, qty: number): { c: Citizen; q: number } | ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('Exiles do not trade through the Docks.');
  if (c.standing === 'suspended') return fail('You cannot trade while suspended.');
  if (c.lifeStage === 'child') return fail('You must be grown to trade across the water.');
  if (isJailed(world, c)) return fail('You cannot trade from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot trade while detained.');
  if (c.district !== DOCKS_DISTRICT) return fail('The Docks are in Harbor Market; you must be there to trade.');
  const docks = world.buildings.docks;
  if (docks && docks.damage >= 1) return fail('The Docks are in ruins; nothing is landing until they are repaired.');
  if (!mayTrade(world, c)) {
    return fail('Only a merchant of the city, or the owner of a shop or a courier yard, may deal with the Outer Cities.');
  }
  const q = Number.isFinite(qty) ? Math.round(qty) : 0;
  if (q <= 0) return fail('Quantity must be a positive whole number.');
  if (q > MAX_TRADE_QTY) return fail(`No crossing carries more than ${MAX_TRADE_QTY} at a time.`);
  return { c, q };
}

function isFailure(r: { c: Citizen; q: number } | ActionResult): r is ActionResult {
  return (r as ActionResult).ok !== undefined;
}

// ---------------------------------------------------------------------------
// Importing and exporting
// ---------------------------------------------------------------------------

/**
 * Buy abroad and land it here. The goods' price leaves the city altogether
 * (it is burned — it went with the ship) and the tariff on top of it stays in
 * the Treasury.
 */
export function importGoods(world: World, cId: CitizenId, good: Good, qty: number): ActionResult {
  if (!GOODS.includes(good)) return fail(`There is no such good as ${String(good)}.`);
  const checked = checkTrader(world, cId, qty);
  if (isFailure(checked)) return checked;
  const { c, q } = checked;

  const price = outerPrice(world, good);
  const goodsCost = Math.round(price * q);
  const total = Math.round(price * q * (1 + tariff(world)));
  const duty = Math.max(0, total - goodsCost);
  if (c.wallet < total) return fail(`Landing ${q} ${good} costs ${total} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, cId, 'burn', goodsCost, 'import', `${q} ${good} bought in the Outer Cities`)) {
    return fail('The purchase could not be paid for.');
  }
  if (duty > 0) transfer(world, cId, 'treasury', duty, 'tariff', `tariff on ${q} ${good} landed at the Docks`);

  c.inventory[good] += q;
  emit(world, 'outer', `${c.name} landed ${q} ${good} at the Docks for ${total} ℓ${duty > 0 ? ` (${duty} ℓ of tariff)` : ''}.`,
    [cId], 0.3, { good, qty: q, cost: total, tariff: duty });
  remember(world, cId, 'money', `You imported ${q} ${good} for ${total} ℓ${duty > 0 ? `, of which ${duty} ℓ was tariff` : ''}.`);
  return ok(`You landed ${q} ${good} for ${total} ℓ${duty > 0 ? ` (${duty} ℓ tariff)` : ''}.`);
}

/**
 * Sell abroad. The proceeds are minted — they come from outside — and the
 * tariff is the difference between what the Outer Cities paid and what the
 * seller keeps, which the Treasury takes.
 */
export function exportGoods(world: World, cId: CitizenId, good: Good, qty: number): ActionResult {
  if (!GOODS.includes(good)) return fail(`There is no such good as ${String(good)}.`);
  const checked = checkTrader(world, cId, qty);
  if (isFailure(checked)) return checked;
  const { c, q } = checked;
  if (c.inventory[good] < q) return fail(`You only have ${c.inventory[good]} ${good} to send out.`);

  const price = outerPrice(world, good);
  const gross = Math.round(price * q);
  const proceeds = Math.round(price * q * (1 - tariff(world)));
  const duty = Math.max(0, gross - proceeds);
  c.inventory[good] -= q;
  if (proceeds > 0 && !transfer(world, 'mint', cId, proceeds, 'export', `${q} ${good} sold to the Outer Cities`)) {
    c.inventory[good] += q;
    return fail('The sale could not be settled.');
  }
  if (duty > 0) transfer(world, 'mint', 'treasury', duty, 'tariff', `tariff on ${q} ${good} shipped from the Docks`);

  emit(world, 'outer', `${c.name} shipped ${q} ${good} out through the Docks for ${proceeds} ℓ${duty > 0 ? ` (${duty} ℓ of tariff)` : ''}.`,
    [cId], 0.3, { good, qty: q, proceeds, tariff: duty });
  remember(world, cId, 'money', `You exported ${q} ${good} for ${proceeds} ℓ${duty > 0 ? `, after ${duty} ℓ of tariff` : ''}.`);
  return ok(`You shipped ${q} ${good} out for ${proceeds} ℓ${duty > 0 ? ` (${duty} ℓ tariff)` : ''}.`);
}

// ---------------------------------------------------------------------------
// Lantern Night, and the visitors it brings
// ---------------------------------------------------------------------------

/** Citizens living in the city right now. */
function population(world: World): number {
  let n = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled') n++;
  }
  return n;
}

/**
 * Visitors come for Lantern Night and for nothing else: more of them the
 * bigger the city, twice as many under a clear sky, half as many in a storm,
 * and none at all on an ordinary day.
 */
export function touristsToday(world: World): number {
  if (!isLanternNight(world)) return 0;
  const base = TOURIST_BASE + Math.floor(population(world) / TOURISTS_PER_CITIZENS);
  const weather = world.weather ?? 'clear';
  if (weather === 'clear') return base * 2;
  if (weather === 'storm') return Math.floor(base / 2);
  return base;
}

/** Businesses a visitor would walk into. */
function visitorBusinesses(world: World): Business[] {
  return Object.values(world.businesses)
    .filter((b) => b.dissolvedDay === null && VISITOR_KINDS.includes(b.kind))
    .sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Every visitor spends TOURIST_SPEND: half over a shop or café counter, half
 * on culture at the Bazaar. Their money is minted — it came from outside — and
 * the culture they carry away leaves the city's shelves.
 */
export function spendTourists(world: World): void {
  const outer = outerMarket(world);
  const visitors = outer.touristsToday;
  if (visitors <= 0) return;
  const purse = visitors * TOURIST_SPEND;
  const half = Math.floor(purse / 2);
  const shops = visitorBusinesses(world);

  let toShops = 0;
  if (half > 0 && shops.length > 0) {
    // each visitor picks a counter of their own, so a busy street shares the trade
    const perVisitor = Math.floor(half / visitors);
    const remainder = half - perVisitor * visitors;
    for (let i = 0; i < visitors; i++) {
      const spend = perVisitor + (i === 0 ? remainder : 0);
      if (spend <= 0) continue;
      const shop = pick(world, shops);
      if (transfer(world, 'mint', shop.id, spend, 'export', 'a visitor from the Outer Cities')) toShops += spend;
    }
  }

  const bazaarPurse = purse - toShops;
  const price = Math.max(1, marketPrice(world, 'culture'));
  const wanted = Math.floor(bazaarPurse / price);
  const bought = wanted > 0 ? takeFromMarket(world, 'culture', wanted) : 0;
  const toBazaar = bought * price;
  if (toBazaar > 0) transfer(world, 'mint', 'treasury', toBazaar, 'export', `${visitors} visitors bought ${bought} culture at the Bazaar`);

  emit(world, 'outer', `${visitors} visitors came in on the tide for Lantern Night and spent ${toShops + toBazaar} ℓ in the city.`,
    [], 0.5, { visitors, shops: toShops, bazaar: toBazaar, culture: bought });
}

// ---------------------------------------------------------------------------
// The daily pass and the observation
// ---------------------------------------------------------------------------

export function dailyOuter(world: World): void {
  const outer = outerMarket(world);
  driftOuterPrices(world);
  outer.touristsToday = touristsToday(world);
  spendTourists(world);
}

export function outerObservation(world: World): { prices: Record<Good, number>; tariff: number; tourists: number } {
  return memo(world, 'outer:observation', () => outerObservationNow(world));
}

function outerObservationNow(world: World): { prices: Record<Good, number>; tariff: number; tourists: number } {
  const outer = outerMarket(world);
  const prices = {} as Record<Good, number>;
  for (const g of GOODS) prices[g] = outerPrice(world, g);
  return { prices, tariff: tariff(world), tourists: outer.touristsToday };
}

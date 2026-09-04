/**
 * Shares — a business, cut into a hundred pieces.
 *
 * An owner standing at the Exchange may **list** their business: a hundred
 * shares, fifty-one of which stay in their hands and forty-nine of which go on
 * the float for anybody to buy. Money paid for float shares is capital and goes
 * into the business; money paid for somebody else's shares goes to them. Each
 * day the price walks toward what the business is worth — three days of profit
 * and the cash in its till — and each payout is split across the holders.
 *
 * Nothing here judges a business or advises a buyer. The price is arithmetic on
 * public numbers, the dividend is arithmetic on a payout, and every decision to
 * buy, to sell or to list is a citizen's own.
 *
 * **Resolved ambiguity — "the largest holder willing to sell".** A holder is
 * never made to sell. `sellShares` asks the business to buy the shares back;
 * when the till cannot cover it the shares are **posted on the Exchange's
 * book** instead — the holder keeps them until a buyer comes — and it is those
 * standing offers, largest first, that a buyer takes once the float is gone.
 * Willingness is a thing a citizen showed, not a thing the engine assumed.
 *
 * **Insider trading (L17).** A councillor or the Mayor trading while a tax,
 * tariff, reserve or public-works proposal is open knew before the city did.
 * The trade goes through — the Exchange does not police itself — and the Watch
 * is given its chance at it.
 */
import type {
  ActionResult, Business, BusinessId, Citizen, CitizenId, DistrictId, MoneyParty,
  Proposal, ShareListing, World,
} from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer, withholdingPay } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { commitOffence } from '../government/watch.ts';

/** Every business is cut into this many shares. */
export const TOTAL_SHARES = 100;
/** What the owner keeps when they list. */
export const OWNER_SHARE = 51;
/** Shares a listing puts on the float on its first day. */
export const FLOAT_SHARES = TOTAL_SHARES - OWNER_SHARE;
/** Deeds and shares change hands at the Exchange, in Harbor Market. */
export const EXCHANGE_DISTRICT: DistrictId = 'harbor_market';
/** How much a lumen of daily profit is worth in the price. */
export const PROFIT_WEIGHT = 8;
/** How much of the till shows up in the price. */
export const TREASURY_DIVISOR = 20;
/** The furthest a price may walk in a day, either way. */
export const PRICE_STEP = 0.1;
/** Days of profit the price looks back over. */
export const PROFIT_WINDOW = 3;
/** Extra visibility a trade by somebody who knew first carries. */
export const INSIDER_VISIBILITY = 0.1;
/** Proposals whose outcome an office learns before the city does. */
export const INSIDER_PROPOSALS: readonly string[] = [
  'income_tax', 'sales_tax', 'profit_tax', 'property_tax', 'tariff', 'public_works', 'reserve',
];

/**
 * `withholdingPay`'s `kind` widens to `'gig'` and `'share_dividend'` in this
 * layer (`docs/MODULES_METROPOLIS_FULL.md` §7.4). Until `economy/treasury.ts`
 * carries the wider union, the ledger kind is passed through unchanged — it is
 * a `LedgerKind` either way, and the money funnel is untouched.
 */
type PayKind = 'wage' | 'salary' | 'payout' | 'gig' | 'share_dividend';
const pay = withholdingPay as unknown as (
  world: World, payer: MoneyParty, payee: CitizenId, gross: number,
  kind: PayKind, memo: string, opts?: { taxRate?: number },
) => { net: number; tax: number };

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** The Exchange's book of listings. A world saved before this layer has none. */
function book(world: World): Record<BusinessId, ShareListing> {
  const w = world as { shares?: Record<BusinessId, ShareListing> };
  if (!w.shares) w.shares = {};
  return w.shares;
}

export function listings(world: World): ShareListing[] {
  return Object.values(book(world)).sort((a, b) => a.businessId.localeCompare(b.businessId, 'en'));
}

export function listingOf(world: World, businessId: BusinessId): ShareListing | null {
  return book(world)[businessId] ?? null;
}

function activeBusiness(world: World, businessId: BusinessId): Business | null {
  const b = world.businesses[businessId];
  return b && b.dissolvedDay === null ? b : null;
}

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

function held(listing: ShareListing, cId: CitizenId): number {
  return Math.max(0, Math.round(listing.holders[cId] ?? 0));
}

function setHolding(world: World, listing: ShareListing, cId: CitizenId, qty: number): void {
  const n = Math.max(0, Math.round(qty));
  if (n <= 0) delete listing.holders[cId];
  else listing.holders[cId] = n;
  const c = world.citizens[cId];
  if (!c) return;
  c.shares ??= {};
  if (n <= 0) delete c.shares[listing.businessId];
  else c.shares[listing.businessId] = n;
}

// ---------------------------------------------------------------------------
// The book of standing offers
// ---------------------------------------------------------------------------

function offerKey(businessId: BusinessId, cId: CitizenId): string {
  return `offer:${businessId}:${cId}`;
}

/** Shares a holder has asked the Exchange to sell for them. */
export function offerOf(world: World, businessId: BusinessId, cId: CitizenId): number {
  return Math.max(0, Math.round(world.counters[offerKey(businessId, cId)] ?? 0));
}

function setOffer(world: World, businessId: BusinessId, cId: CitizenId, qty: number): void {
  const key = offerKey(businessId, cId);
  if (qty <= 0) delete world.counters[key];
  else world.counters[key] = Math.round(qty);
}

/** Standing offers from holders who are not the owner, largest first. */
function standingOffers(world: World, listing: ShareListing): { cId: CitizenId; qty: number }[] {
  const biz = world.businesses[listing.businessId];
  const out: { cId: CitizenId; qty: number }[] = [];
  for (const cId of Object.keys(listing.holders).sort((a, b) => a.localeCompare(b, 'en'))) {
    if (biz && cId === biz.ownerId) continue;
    const qty = Math.min(offerOf(world, listing.businessId, cId), held(listing, cId));
    if (qty > 0) out.push({ cId, qty });
  }
  return out.sort((a, b) => b.qty - a.qty || a.cId.localeCompare(b.cId, 'en'));
}

/** Shares a buyer could actually get today: the float plus every standing offer. */
export function availableShares(world: World, listing: ShareListing): number {
  const offers = standingOffers(world, listing).reduce((n, o) => n + o.qty, 0);
  return Math.max(0, Math.round(listing.float)) + offers;
}

// ---------------------------------------------------------------------------
// Listing
// ---------------------------------------------------------------------------

function atTheExchange(world: World, cId: CitizenId): Citizen | ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  if (c.lifeStage === 'child') return fail('You must be grown to trade shares.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot trade shares while ${c.standing}.`);
  if (isJailed(world, c)) return fail('You cannot trade shares from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot trade shares while detained.');
  if (c.district !== EXCHANGE_DISTRICT) return fail('Shares are traded at the Exchange, in Harbor Market.');
  return c;
}

function refused(r: Citizen | ActionResult): r is ActionResult {
  return (r as ActionResult).ok !== undefined;
}

/** The opening price: a twentieth of what the business has in its till. */
export function openingPrice(biz: Business): number {
  return Math.max(1, Math.round(biz.treasury / TREASURY_DIVISOR));
}

export function listShares(world: World, ownerId: CitizenId): ActionResult {
  const checked = atTheExchange(world, ownerId);
  if (refused(checked)) return checked;
  const c = checked;
  const biz = c.businessId ? activeBusiness(world, c.businessId) : null;
  if (!biz) return fail('You have no business trading to list.');
  if (biz.ownerId !== ownerId) return fail('Only the owner may list a business.');
  if (listingOf(world, biz.id)) return fail(`${biz.name} is already listed on the Exchange.`);

  const listing: ShareListing = {
    businessId: biz.id, price: openingPrice(biz), holders: {}, float: FLOAT_SHARES, lastDividendDay: null,
  };
  book(world)[biz.id] = listing;
  setHolding(world, listing, ownerId, OWNER_SHARE);
  emit(world, 'shares', `${c.name} listed ${biz.name} on the Exchange: ${FLOAT_SHARES} of ${TOTAL_SHARES} shares on the float at ${listing.price} ℓ.`,
    [ownerId], 0.6, { businessId: biz.id, price: listing.price, float: listing.float });
  remember(world, ownerId, 'money', `You listed ${biz.name}; you keep ${OWNER_SHARE} shares and ${FLOAT_SHARES} are on the float at ${listing.price} ℓ.`);
  return ok(`${biz.name} is listed: ${FLOAT_SHARES} shares on the float at ${listing.price} ℓ each.`);
}

export function sharePrice(world: World, businessId: BusinessId): number {
  const listing = listingOf(world, businessId);
  return listing ? Math.max(1, Math.round(listing.price)) : 0;
}

// ---------------------------------------------------------------------------
// Who knew first
// ---------------------------------------------------------------------------

function openProposals(world: World): Proposal[] {
  return (world.government?.proposals ?? []).filter((p) => p.status === 'open');
}

/**
 * A councillor or the Mayor, while a proposal that moves money is on the table.
 * The office reads the city's ledger before the city does, and the Charter
 * calls trading on that insider trading.
 */
export function isInsider(world: World, c: Citizen, businessId: BusinessId): boolean {
  const g = world.government;
  if (!g) return false;
  const inOffice = g.mayorId === c.id || g.council.includes(c.id);
  if (!inOffice) return false;
  void businessId;
  return openProposals(world).some((p) => INSIDER_PROPOSALS.includes(String(p.kind)));
}

function reportInsider(world: World, c: Citizen, biz: Business, amount: number, what: string): void {
  remember(world, c.id, 'crime', `You ${what} ${biz.name} while the Council still had a money proposal open.`);
  commitOffence(world, c.id, 'L17', { amount, visibilityMod: INSIDER_VISIBILITY });
}

// ---------------------------------------------------------------------------
// Buying and selling
// ---------------------------------------------------------------------------

export function buyShares(world: World, cId: CitizenId, businessId: BusinessId, qty: number): ActionResult {
  const checked = atTheExchange(world, cId);
  if (refused(checked)) return checked;
  const c = checked;
  const listing = listingOf(world, businessId);
  const biz = activeBusiness(world, businessId);
  if (!listing || !biz) return fail('No such business is listed on the Exchange.');

  const want = Number.isFinite(qty) ? Math.round(qty) : 0;
  if (want <= 0) return fail('You must buy at least one share.');
  // your own shares on the book are not for sale to you
  const mineOnBook = biz.ownerId === cId ? 0 : Math.min(offerOf(world, businessId, cId), held(listing, cId));
  const available = availableShares(world, listing) - mineOnBook;
  if (available <= 0) return fail(`There are no ${biz.name} shares to be had today.`);
  if (want > available) return fail(`Only ${available} ${biz.name} ${available === 1 ? 'share is' : 'shares are'} for sale today.`);

  const price = sharePrice(world, businessId);
  const total = price * want;
  if (c.wallet < total) return fail(`${want} ${biz.name} shares cost ${total} ℓ; you have ${c.wallet} ℓ.`);

  let remaining = want;
  let spent = 0;
  const fromFloat = Math.min(remaining, Math.max(0, Math.round(listing.float)));
  if (fromFloat > 0) {
    const cost = fromFloat * price;
    if (!transfer(world, cId, biz.id, cost, 'capital', `${fromFloat} new shares in ${biz.name}`)) {
      return fail('The purchase could not be paid for.');
    }
    listing.float -= fromFloat;
    setHolding(world, listing, cId, held(listing, cId) + fromFloat);
    remaining -= fromFloat;
    spent += cost;
  }
  for (const offer of standingOffers(world, listing)) {
    if (remaining <= 0) break;
    if (offer.cId === cId) continue;
    const take = Math.min(remaining, offer.qty);
    const cost = take * price;
    if (!transfer(world, cId, offer.cId, cost, 'share', `${take} shares in ${biz.name}`)) continue;
    setHolding(world, listing, offer.cId, held(listing, offer.cId) - take);
    setOffer(world, businessId, offer.cId, offerOf(world, businessId, offer.cId) - take);
    setHolding(world, listing, cId, held(listing, cId) + take);
    remaining -= take;
    spent += cost;
    remember(world, offer.cId, 'money', `${c.name} took ${take} of your ${biz.name} shares off the book for ${cost} ℓ.`);
  }
  const bought = want - remaining;
  if (bought <= 0) return fail(`The ${biz.name} shares could not be found after all.`);

  emit(world, 'shares', `${c.name} bought ${bought} ${bought === 1 ? 'share' : 'shares'} in ${biz.name} at ${price} ℓ.`,
    [cId], 0.3, { businessId, qty: bought, price, spent });
  remember(world, cId, 'money', `You bought ${bought} ${biz.name} shares for ${spent} ℓ; you hold ${held(listing, cId)} of ${TOTAL_SHARES}.`);
  if (isInsider(world, c, businessId)) reportInsider(world, c, biz, spent, 'bought into');
  return ok(`You hold ${held(listing, cId)} shares in ${biz.name}; you paid ${spent} ℓ.`);
}

export function sellShares(world: World, cId: CitizenId, businessId: BusinessId, qty: number): ActionResult {
  const checked = atTheExchange(world, cId);
  if (refused(checked)) return checked;
  const c = checked;
  const listing = listingOf(world, businessId);
  const biz = activeBusiness(world, businessId);
  if (!listing || !biz) return fail('No such business is listed on the Exchange.');

  const mine = held(listing, cId);
  const want = Number.isFinite(qty) ? Math.round(qty) : 0;
  if (want <= 0) return fail('You must sell at least one share.');
  if (want > mine) return fail(`You hold ${mine} ${biz.name} ${mine === 1 ? 'share' : 'shares'}.`);

  const price = sharePrice(world, businessId);
  const proceeds = price * want;
  const isOwner = biz.ownerId === cId;
  if (biz.treasury >= proceeds && transfer(world, biz.id, cId, proceeds, 'share', `${want} shares in ${biz.name} bought back`)) {
    setHolding(world, listing, cId, mine - want);
    setOffer(world, businessId, cId, Math.min(offerOf(world, businessId, cId), held(listing, cId)));
    listing.float = Math.min(TOTAL_SHARES, Math.round(listing.float) + want);
    emit(world, 'shares', `${c.name} sold ${want} ${want === 1 ? 'share' : 'shares'} in ${biz.name} back at ${price} ℓ.`,
      [cId], 0.3, { businessId, qty: want, price, proceeds });
    remember(world, cId, 'money', `You sold ${want} ${biz.name} shares for ${proceeds} ℓ.`);
    if (isInsider(world, c, businessId)) reportInsider(world, c, biz, proceeds, 'sold out of');
    return ok(`You sold ${want} ${biz.name} shares for ${proceeds} ℓ.`);
  }
  if (isOwner) {
    return fail(`${biz.name} has ${biz.treasury} ℓ in the till and cannot buy back ${want} shares at ${price} ℓ.`);
  }
  setOffer(world, businessId, cId, want);
  emit(world, 'shares', `${c.name} put ${want} ${biz.name} ${want === 1 ? 'share' : 'shares'} on the Exchange's book at ${price} ℓ.`,
    [cId], 0.2, { businessId, qty: want, price });
  remember(world, cId, 'money',
    `${biz.name} could not buy your ${want} shares back, so they are on the Exchange's book at ${price} ℓ until somebody takes them.`);
  return ok(`${biz.name} could not buy them back; your ${want} shares are on the book at ${price} ℓ.`);
}

// ---------------------------------------------------------------------------
// Dividends
// ---------------------------------------------------------------------------

/**
 * A listed business pays its day's payout across its holders instead of into
 * the owner's hands alone: each share is worth the same fraction of it, and
 * what the float still holds stays in the till. Called from
 * `economy/business.ts settleDay`. Returns what actually left the business.
 */
export function payShareDividends(world: World, biz: Business, payout: number): number {
  const listing = listingOf(world, biz.id);
  if (!listing || !Number.isFinite(payout)) return 0;
  const budget = Math.min(Math.max(0, Math.round(payout)), Math.max(0, Math.floor(biz.treasury)));
  if (budget <= 0) return 0;

  const holderIds = Object.keys(listing.holders).sort((a, b) => (
    (a === biz.ownerId ? 0 : 1) - (b === biz.ownerId ? 0 : 1) || a.localeCompare(b, 'en')
  ));
  let left = budget;
  let paid = 0;
  let count = 0;
  for (const holderId of holderIds) {
    if (left <= 0) break;
    const shares = held(listing, holderId);
    if (shares <= 0 || !world.citizens[holderId]) continue;
    const gross = Math.min(left, Math.round(budget * shares / TOTAL_SHARES));
    if (gross <= 0) continue;
    const kind: PayKind = holderId === biz.ownerId ? 'payout' : 'share_dividend';
    const { net, tax } = pay(world, biz.id, holderId, gross, kind, `dividend on ${shares} shares in ${biz.name}`);
    const moved = net + tax;
    if (moved <= 0) continue;
    left -= moved;
    paid += moved;
    count++;
    remember(world, holderId, 'money', `${biz.name} paid you ${net} ℓ on ${shares} ${shares === 1 ? 'share' : 'shares'}.`);
  }
  if (paid > 0) {
    listing.lastDividendDay = world.day;
    emit(world, 'shares', `${biz.name} paid ${paid} ℓ of dividends to ${count} ${count === 1 ? 'holder' : 'holders'}.`,
      [], 0.3, { businessId: biz.id, paid, holders: count });
  }
  return paid;
}

// ---------------------------------------------------------------------------
// The price, day by day
// ---------------------------------------------------------------------------

function profitKey(businessId: BusinessId, day: number): string {
  return `shprofit:${businessId}:${day % PROFIT_WINDOW}`;
}

/** Write down what a business made today, once, whoever asks first. */
export function noteBusinessProfit(world: World, biz: Business): void {
  const stamp = `shprofitday:${biz.id}`;
  if (world.counters[stamp] === world.day) return;
  world.counters[stamp] = world.day;
  world.counters[profitKey(biz.id, world.day)] = Math.round(biz.revenueToday - biz.costsToday);
}

/** What a business has made over the last three days, as the Exchange has it. */
export function recentProfit(world: World, businessId: BusinessId): number {
  let sum = 0;
  for (let d = 0; d < PROFIT_WINDOW; d++) sum += world.counters[`shprofit:${businessId}:${d}`] ?? 0;
  return Math.round(sum);
}

/** What the Exchange thinks a share is worth: three days of profit, and the till. */
export function fairPrice(world: World, biz: Business): number {
  return Math.max(1, Math.round(recentProfit(world, biz.id) * PROFIT_WEIGHT + biz.treasury / TREASURY_DIVISOR));
}

/** Each price walks at most a tenth of itself toward what the business is worth. */
export function movePrices(world: World): void {
  for (const listing of listings(world)) {
    const biz = activeBusiness(world, listing.businessId);
    if (!biz) continue;
    noteBusinessProfit(world, biz);
    const price = Math.max(1, Math.round(listing.price));
    const target = fairPrice(world, biz);
    if (target === price) continue;
    const bound = Math.max(1, Math.round(price * PRICE_STEP));
    const step = Math.min(bound, Math.abs(target - price));
    listing.price = Math.max(1, price + (target > price ? step : -step));
  }
}

/** A business that has closed its doors is struck off; its shares are worth nothing. */
function delistDissolved(world: World): void {
  for (const listing of listings(world)) {
    const biz = world.businesses[listing.businessId];
    if (biz && biz.dissolvedDay === null) continue;
    for (const holderId of Object.keys(listing.holders)) {
      setOffer(world, listing.businessId, holderId, 0);
      setHolding(world, listing, holderId, 0);
    }
    delete book(world)[listing.businessId];
    const name = biz?.name ?? listing.businessId;
    emit(world, 'shares', `${name} was struck off the Exchange; its shares are worth nothing.`, [], 0.5,
      { businessId: listing.businessId });
  }
}

/** Holdings of nobody, offers larger than the holding, shares of the struck off. */
function prune(world: World): void {
  for (const listing of listings(world)) {
    for (const holderId of Object.keys(listing.holders)) {
      const c = world.citizens[holderId];
      if (!c) { delete listing.holders[holderId]; setOffer(world, listing.businessId, holderId, 0); continue; }
      const shares = held(listing, holderId);
      if (shares <= 0) { setHolding(world, listing, holderId, 0); setOffer(world, listing.businessId, holderId, 0); continue; }
      c.shares ??= {};
      c.shares[listing.businessId] = shares;
      const offer = offerOf(world, listing.businessId, holderId);
      if (offer > shares) setOffer(world, listing.businessId, holderId, shares);
    }
  }
  for (const c of Object.values(world.citizens)) {
    if (!c.shares) continue;
    for (const businessId of Object.keys(c.shares)) {
      const listing = listingOf(world, businessId);
      if (!listing || held(listing, c.id) <= 0) delete c.shares[businessId];
    }
  }
}

export function dailyShares(world: World): void {
  movePrices(world);
  delistDissolved(world);
  prune(world);
}

/** What a citizen holds, and what it is worth today. */
export function sharesObservation(
  world: World, c: Citizen,
): { businessId: BusinessId; name: string; qty: number; price: number }[] {
  const out: { businessId: BusinessId; name: string; qty: number; price: number }[] = [];
  for (const listing of listings(world)) {
    const qty = held(listing, c.id);
    if (qty <= 0) continue;
    const biz = world.businesses[listing.businessId];
    out.push({ businessId: listing.businessId, name: biz?.name ?? listing.businessId, qty, price: sharePrice(world, listing.businessId) });
  }
  return out;
}

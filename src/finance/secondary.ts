/**
 * The secondary market in the city's paper (`FINANCE.md` §2).
 *
 * After the auction, `sell_bond` and `buy_bond` move holdings at whatever two
 * citizens agree, and **the last traded price is the live rating** — it moves
 * the hour a scandal breaks, and it is the number every bidder reads before
 * the next auction. Holdings pass by inheritance and on a sunset, and are
 * seized on exile like any other asset.
 *
 * Nothing here mints anything either: a trade moves lumens from the buyer to
 * the seller and moves a row from one name to another.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens, transfer } from '../economy/treasury.ts';
import type { BondOffer, Holder } from './state.ts';
import { financeId, financeKind, financeState } from './state.ts';
import {
  BOND_FACE, PRICE_MAX, PRICE_MIN, addHolding, holdingOf, holdingsOf, issueOf, mayTrade, nameOfHolder,
  setLivePrice,
} from './bonds.ts';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** Offers on the secondary market. */
export function openOffers(world: World): BondOffer[] {
  return Object.values(financeState(world).offers).filter((o) => o.status === 'open');
}

export function offerOf(world: World, offerId: string): BondOffer | null {
  return financeState(world).offers[offerId] ?? null;
}

/** Offer a holding on the secondary market at whatever price you like. */
export function sellBond(world: World, sellerId: Holder, holdingId: string, price: number, qty?: number): ActionResult {
  const holding = holdingOf(world, holdingId);
  if (!holding || holding.holderId !== sellerId || holding.qty <= 0) return fail('You hold no such bonds.');
  const issue = issueOf(world, holding.issueId);
  if (!issue || (issue.status !== 'outstanding' && issue.status !== 'defaulted')) return fail('That paper is not trading.');
  const p = Math.round(price);
  if (!Number.isFinite(p) || p < PRICE_MIN || p > PRICE_MAX) return fail(`A price is between ${PRICE_MIN} and ${PRICE_MAX} ℓ a bond.`);
  const want = qty === undefined ? holding.qty : Math.round(qty);
  if (!Number.isFinite(want) || want < 1 || want > holding.qty) return fail(`You hold ${holding.qty} bonds of that issue.`);
  const s = financeState(world);
  const already = Object.values(s.offers).filter((o) => o.status === 'open' && o.holdingId === holdingId)
    .reduce((sum, o) => sum + o.qty, 0);
  if (already + want > holding.qty) return fail('You have already offered those bonds.');

  const offer: BondOffer = {
    id: financeId(world, 'offer'), holdingId, issueId: holding.issueId, sellerId,
    price: p, qty: want, day: world.day, status: 'open',
  };
  s.offers[offer.id] = offer;
  emit(world, 'trade', `${nameOfHolder(world, sellerId)} offered ${want} city bonds at ${p} ℓ.`, citizensIn(world, [sellerId]), 0.2,
    { offerId: offer.id, issueId: issue.id, price: p, qty: want });
  return ok(`You offered ${want} bonds at ${p} ℓ each.`);
}

function citizensIn(world: World, holders: Holder[]): CitizenId[] {
  return holders.filter((h) => !!world.citizens[h]);
}

/** Withdraw your own offer. */
export function withdrawOffer(world: World, sellerId: Holder, offerId: string): ActionResult {
  const offer = offerOf(world, offerId);
  if (!offer || offer.sellerId !== sellerId || offer.status !== 'open') return fail('You have no such offer standing.');
  offer.status = 'withdrawn';
  return ok('Your offer is withdrawn.');
}

/**
 * Take an offer. The price the two of them agreed becomes the city's live
 * rating, which is why a scandal moves it the hour it breaks.
 */
export function buyBond(world: World, buyerId: Holder, offerId: string): ActionResult {
  const offer = offerOf(world, offerId);
  if (!offer || offer.status !== 'open') return fail('There is no such offer.');
  if (offer.sellerId === buyerId) return fail('You cannot buy your own bonds.');
  if (!mayTrade(world, buyerId)) return fail('Your standing does not allow you to trade.');
  const holding = holdingOf(world, offer.holdingId);
  const issue = issueOf(world, offer.issueId);
  if (!holding || !issue || holding.qty < offer.qty) { offer.status = 'withdrawn'; return fail('Those bonds are no longer held.'); }
  const cost = offer.price * offer.qty;
  if (balanceOf(world, buyerId) < cost) return fail(`That would cost ${formatLumens(cost)} and you hold ${formatLumens(balanceOf(world, buyerId))}.`);
  if (!transfer(world, buyerId, offer.sellerId, cost, financeKind('bond'), `${offer.qty} bonds of issue ${issue.id} at ${offer.price} ℓ`)) {
    return fail('The payment could not be made.');
  }

  holding.qty -= offer.qty;
  if (holding.qty <= 0) delete financeState(world).holdings[holding.id];
  addHolding(world, issue.id, buyerId, offer.qty, offer.price);
  offer.status = 'taken';
  setLivePrice(world, issue.id, offer.price);
  const actors = citizensIn(world, [buyerId, offer.sellerId]);
  emit(world, 'trade',
    `${nameOfHolder(world, buyerId)} bought ${offer.qty} city bonds from ${nameOfHolder(world, offer.sellerId)} at ${offer.price} ℓ; `
    + `the city's paper now trades at ${offer.price}.`,
    actors, 0.3, { issueId: issue.id, price: offer.price, qty: offer.qty });
  for (const id of actors) remember(world, id, 'money', `City bonds changed hands at ${offer.price} ℓ (face ${BOND_FACE} ℓ).`);
  return ok(`You bought ${offer.qty} bonds at ${offer.price} ℓ each.`);
}

// ---------------------------------------------------------------------------
// Holdings when a holder leaves
// ---------------------------------------------------------------------------

/** Move every holding from one party to another (inheritance, a sunset, a sale of a concern). */
export function transferHoldings(world: World, from: Holder, to: Holder): number {
  if (from === to) return 0;
  let moved = 0;
  for (const holding of holdingsOf(world, from)) {
    moved += holding.qty;
    addHolding(world, holding.issueId, to, holding.qty, holding.paid);
    delete financeState(world).holdings[holding.id];
  }
  for (const offer of openOffers(world)) if (offer.sellerId === from) offer.status = 'withdrawn';
  return moved;
}

/**
 * Seize every holding on exile, like any other asset: the paper goes to the
 * Treasury, which then owes the coupons to itself and pays nothing.
 */
export function seizeHoldings(world: World, holderId: Holder): number {
  const held = holdingsOf(world, holderId);
  let face = 0;
  for (const holding of held) {
    const issue = issueOf(world, holding.issueId);
    face += holding.qty * BOND_FACE * (1 - (issue?.haircut ?? 0));
    delete financeState(world).holdings[holding.id];
  }
  for (const offer of openOffers(world)) if (offer.sellerId === holderId) offer.status = 'withdrawn';
  return Math.round(face);
}

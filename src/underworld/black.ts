/**
 * The black market, and fencing as a trade (`docs/UNDERWORLD.md` §4).
 *
 * There is no black-market building. The trade happens where the Watch is not:
 * districts whose land value carries a low safety term (`PROPERTY.md` §1) — at
 * the founding the Undercroft's Night Market and the quiet end of Foundry Row,
 * and everywhere at once in a city that asks nothing. Safety is offences per
 * resident, so a district that becomes a market for stolen goods becomes cheap,
 * and cheap is what keeps it one. **Nobody decides that loop**, and nothing in
 * this file decides it either: it reads the same land value everybody else
 * reads and lets the arithmetic close.
 *
 * `fence` sells into a buyer who does not ask; `receive_goods` takes the other
 * side. They are two actions because they are two decisions, and nobody in
 * Reverie is bound by another citizen's: a fence may offer all day and be
 * refused all day.
 *
 * A fence's standing is **not repute** — repute counts public acts, and an
 * undetected purchase is not one. It is word of mouth: dealings spread along
 * friendship edges, a well-known fence pays less because they can, and one
 * reported and acquitted pays more for a cycle because nobody believes the
 * acquittal.
 */
import { GOODS, clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, DistrictId, Good, World } from '../types.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { landReading } from '../economy/land.ts';
import { friendsOf } from '../citizens/relationships.ts';
import { tradingLicenceRevoked } from '../government/recovery.ts';
import { restrictionOn } from './schedule.ts';
import { fencePays, heatOf, landedCost, lawfulPrice, notorietyOf } from './prices.ts';
import { chargeUnderworldOffence } from './offences.ts';
import type { FenceDeal } from './state.ts';
import {
  CONTRABAND_POSSESSION, DEAL_HISTORY, HOME_CITY, UNLICENSED_DEALING,
  bound, ownedBusinessId, underworldId, underworldKind, underworldState,
} from './state.ts';

/** Ticks an offer stands before it goes stale. A hand that does not ask does not wait. */
export const OFFER_TICKS = 6;
/** Deals inside a cycle that make a hand a business rather than a favour. */
export const DEALING_AS_A_BUSINESS = 2;
/** How much of a district's cheapness hides a deal done in it. */
export const CHEAPNESS_COVER = 0.12;
/** Chance that one friend of a party to a deal hears about it. */
export const WORD_OF_MOUTH = 0.35;
/** Friends who can hear about one deal, however many somebody has. */
export const WORD_OF_MOUTH_REACH = 3;
/** A buyer who paid at least this share of the lawful landed cost bought in good faith. */
export const GOOD_FAITH_SHARE = 0.9;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** Present, grown, able to deal, and not in a cell. */
function tradeable(world: World, c: Citizen | undefined): c is Citizen {
  if (!c) return false;
  if (c.standing === 'exiled' || c.standing === 'suspended') return false;
  if (c.lifeStage === 'child') return false;
  if (c.jailedUntilDay !== null && c.jailedUntilDay > world.day) return false;
  return !(c.detainedUntilTick !== null && c.detainedUntilTick > world.tick);
}

/**
 * How well a district hides a deal: what the land is worth against the city's
 * own average, which is mostly its safety term. A cheap quarter is a quiet one,
 * and a quiet one gets cheaper.
 */
export function districtCover(world: World, d: DistrictId): number {
  let value = 1;
  try {
    value = landReading(world, d)?.value ?? 1;
  } catch {
    value = 1;
  }
  return clamp((1 - value) * CHEAPNESS_COVER, -CHEAPNESS_COVER, CHEAPNESS_COVER);
}

/** The quarters where the trade happens today: the cheapest first. */
export function blackMarketDistricts(world: World, limit = 3): DistrictId[] {
  const open = world.openDistricts ?? [];
  return [...open]
    .sort((a, b) => {
      const av = landReading(world, a)?.value ?? 1;
      const bv = landReading(world, b)?.value ?? 1;
      return av - bv || a.localeCompare(b);
    })
    .slice(0, limit);
}

/** Everything a citizen is holding that a fence would take. */
function holdsLot(world: World, c: Citizen, good: Good | null, productId: string | null, itemId: string | null, qty: number): boolean {
  if (itemId) return c.possessions.some((p) => p.id === itemId);
  if (good) return Math.floor(c.inventory[good] ?? 0) >= qty;
  if (productId) return c.possessions.filter((p) => p.productId === productId).length >= qty;
  return false;
}

export interface FenceSpec {
  to: CitizenId;
  itemId?: string | null;
  good?: Good | null;
  productId?: string | null;
  qty?: number;
}

/**
 * Offer a lot to a hand that does not ask. The price is the fence's arithmetic
 * (`prices.ts`) and it is public the moment it is offered: fresh detected loot
 * fetches about 30 % of value and cold goods two-thirds. The spread pays the
 * fence for holding the risk, and it is why a thief who waits ends richer than
 * one who runs.
 */
export function fence(world: World, sellerId: CitizenId, spec: FenceSpec): ActionResult {
  const seller = world.citizens[sellerId];
  const buyer = world.citizens[spec.to];
  if (!tradeable(world, seller)) return fail('You cannot deal right now.');
  if (!tradeable(world, buyer)) return fail('There is nobody by that name to deal with.');
  if (sellerId === spec.to) return fail('You cannot sell to yourself.');
  if (seller.district !== buyer.district) return fail(`${buyer.name} is not standing here.`);

  const itemId = spec.itemId ?? null;
  const item = itemId ? seller.possessions.find((p) => p.id === itemId) ?? null : null;
  if (itemId && !item) return fail('You do not own that.');
  const productId = item ? item.productId : spec.productId ?? null;
  const good = itemId ? null : spec.good ?? null;
  if (!good && !productId) return fail('A deal names goods or a thing you own.');
  if (good && !GOODS.includes(good)) return fail(`There is no such good as ${String(good)}.`);
  if (productId && !PRODUCTS[productId]) return fail(`There is no such thing as ${String(productId)}.`);
  const qty = itemId ? 1 : Math.max(0, Math.round(spec.qty ?? 0));
  if (qty <= 0) return fail('A deal is for a whole number of units.');
  if (!holdsLot(world, seller, good, productId, itemId, qty)) return fail('You are not holding that.');

  const value = lawfulPrice(world, { good, productId, qty, value: 0 });
  const heat = heatOf(world, sellerId, { namedItem: !!productId });
  const price = fencePays(world, sellerId, spec.to, value, heat);
  const s = underworldState(world);
  const deal: FenceDeal = {
    id: underworldId(world, 'fd'), sellerId, buyerId: spec.to, good, itemId, productId, qty,
    price, heat, offeredDay: world.day, offeredTick: world.tick, status: 'offered', takenDay: null,
  };
  s.deals.push(deal);
  bound(s.deals, DEAL_HISTORY);

  remember(world, spec.to, 'money', `${seller.name} offered you ${qty} ${good ?? PRODUCTS[productId ?? '']?.name ?? 'units'} `
    + `for ${price} ℓ (${deal.id}). Nobody asked where it came from.`);
  remember(world, sellerId, 'money', `You offered ${qty} ${good ?? PRODUCTS[productId ?? '']?.name ?? 'units'} to ${buyer.name} `
    + `for ${price} ℓ (${deal.id}).`);
  return ok(`You offered ${qty} to ${buyer.name} for ${price} ℓ (${deal.id}); it stands for ${OFFER_TICKS} hours.`);
}

/** The offers standing before a citizen right now. */
export function offersTo(world: World, buyerId: CitizenId): FenceDeal[] {
  return underworldState(world).deals.filter(
    (d) => d.buyerId === buyerId && d.status === 'offered' && world.tick - d.offeredTick <= OFFER_TICKS,
  );
}

/**
 * Take the other side of an offer named the way `REGISTRY.md` §3 names it —
 * by who made it and what is in it, rather than by the offer's own id. The
 * oldest matching offer is the one taken, because a hand that does not ask does
 * not keep two of the same lot on the table.
 */
export function receiveFrom(
  world: World, buyerId: CitizenId,
  spec: { from: CitizenId; itemId?: string | null; good?: Good | null; productId?: string | null; qty?: number },
): ActionResult {
  const qty = spec.qty === undefined ? null : Math.max(0, Math.round(spec.qty));
  const match = offersTo(world, buyerId).find((d) => d.sellerId === spec.from
    && (spec.itemId ? d.itemId === spec.itemId : true)
    && (spec.good ? d.good === spec.good : true)
    && (spec.productId ? d.productId === spec.productId : true)
    && (qty === null || d.qty === qty));
  if (!match) return fail(`${world.citizens[spec.from]?.name ?? 'They'} has offered you no such lot.`);
  return receiveGoods(world, buyerId, match.id);
}

/** The offers a citizen has out. */
export function offersBy(world: World, sellerId: CitizenId): FenceDeal[] {
  return underworldState(world).deals.filter(
    (d) => d.sellerId === sellerId && d.status === 'offered' && world.tick - d.offeredTick <= OFFER_TICKS,
  );
}

/** How many deals a hand has taken inside a cycle: two is a business, one is a favour. */
export function dealingsInCycle(world: World, cId: CitizenId): number {
  const cycle = Math.max(1, world.config.cycleDays);
  return underworldState(world).deals.filter(
    (d) => d.buyerId === cId && d.status !== 'offered' && d.takenDay !== null && world.day - d.takenDay <= cycle,
  ).length;
}

/** A hand that may lawfully deal: a shop or a courier yard whose licence stands. */
export function holdsTradingLicence(world: World, cId: CitizenId): boolean {
  const businessId = ownedBusinessId(world, cId);
  if (!businessId) return false;
  const b = world.businesses[businessId];
  if (!b || (b.kind !== 'shop' && b.kind !== 'courier')) return false;
  return !tradingLicenceRevoked(world, businessId);
}

/** Move the lot from one hand to the other. */
function handOver(world: World, seller: Citizen, buyer: Citizen, deal: FenceDeal): boolean {
  if (deal.itemId) {
    const at = seller.possessions.findIndex((p) => p.id === deal.itemId);
    if (at < 0) return false;
    const [item] = seller.possessions.splice(at, 1);
    buyer.possessions.push(item);
    return true;
  }
  if (deal.good) {
    if (Math.floor(seller.inventory[deal.good] ?? 0) < deal.qty) return false;
    seller.inventory[deal.good] -= deal.qty;
    buyer.inventory[deal.good] += deal.qty;
    return true;
  }
  if (deal.productId) {
    let left = deal.qty;
    for (let i = seller.possessions.length - 1; i >= 0 && left > 0; i--) {
      if (seller.possessions[i].productId !== deal.productId) continue;
      const [item] = seller.possessions.splice(i, 1);
      buyer.possessions.push(item);
      left--;
    }
    return left === 0;
  }
  return false;
}

/**
 * Take the other side of it. The lumens move through the Treasury's own funnel
 * like every other lumen in Reverie — the ledger row says `fence`, and a
 * detective can read it, which is exactly why handlers pay in goods.
 */
export function receiveGoods(world: World, buyerId: CitizenId, dealId: string): ActionResult {
  const s = underworldState(world);
  const deal = s.deals.find((d) => d.id === dealId);
  if (!deal) return fail('There is no such offer.');
  if (deal.buyerId !== buyerId) return fail('That offer was not made to you.');
  if (deal.status !== 'offered') return fail('That offer is closed.');
  if (world.tick - deal.offeredTick > OFFER_TICKS) { deal.status = 'closed'; return fail('That offer has gone stale.'); }
  const buyer = world.citizens[buyerId];
  const seller = world.citizens[deal.sellerId];
  if (!tradeable(world, buyer) || !tradeable(world, seller)) return fail('One of you cannot deal right now.');
  if (buyer.district !== seller.district) return fail(`${seller.name} is not standing here.`);
  if (buyer.wallet < deal.price) return fail(`That is ${deal.price} ℓ; you have ${Math.floor(buyer.wallet)} ℓ.`);

  if (!handOver(world, seller, buyer, deal)) return fail(`${seller.name} is no longer holding it.`);
  if (deal.price > 0 && !transfer(world, buyerId, deal.sellerId, deal.price, underworldKind('fence'),
    `a lot of ${deal.qty} ${deal.good ?? deal.productId ?? 'units'} (${deal.id})`)) {
    // Put it back: a deal that cannot be paid for did not happen.
    handOver(world, buyer, seller, deal);
    return fail('The lumens would not move.');
  }
  deal.status = 'taken';
  deal.takenDay = world.day;

  const what = deal.good ?? (deal.productId ? PRODUCTS[deal.productId]?.name ?? deal.productId : 'a lot');
  emit(world, 'trade', `${seller.name} sold ${deal.qty} ${what} to ${buyer.name} for ${deal.price} ℓ.`,
    [deal.sellerId, buyerId], 0.2, { deal: deal.id, price: deal.price, heat: deal.heat });
  remember(world, buyerId, 'money', `You took ${deal.qty} ${what} off ${seller.name} for ${deal.price} ℓ (${deal.id}).`);
  remember(world, deal.sellerId, 'money', `${buyer.name} took the lot for ${deal.price} ℓ (${deal.id}).`);

  spreadDealing(world, deal);
  chargeDealing(world, deal);
  return ok(`You took ${deal.qty} ${what} for ${deal.price} ℓ.`);
}

/**
 * Word of mouth. A dealing is not a public act — nobody reported it and nobody
 * saw it charged — so it does not touch repute. It travels the way everything
 * unofficial travels in Reverie: along friendship edges, one pair of ears at a
 * time, until a fence's name is known.
 */
export function spreadDealing(world: World, deal: FenceDeal): number {
  const heard = new Set<CitizenId>();
  for (const partyId of [deal.sellerId, deal.buyerId]) {
    for (const friendId of friendsOf(world, partyId).slice(0, WORD_OF_MOUTH_REACH)) {
      if (friendId === deal.buyerId || friendId === deal.sellerId || heard.has(friendId)) continue;
      if (!chance(world, WORD_OF_MOUTH)) continue;
      heard.add(friendId);
      remember(world, friendId, 'social',
        `You heard that ${world.citizens[deal.buyerId]?.name ?? 'somebody'} takes lots nobody asks about.`);
    }
  }
  if (heard.size > 0) {
    const s = underworldState(world);
    s.notoriety[deal.buyerId] = (s.notoriety[deal.buyerId] ?? 0) + 1;
  }
  return heard.size;
}

/**
 * What the two of them may have to answer for.
 *
 * **Innocence gets harder here, and the Court's only defence is the price
 * paid.** A buyer who paid what a lawful crate lands at was probably deceived,
 * and the fence is the one who knew: so a lot sold at or near the landed cost
 * puts the seller before the Watch and leaves the buyer alone. A lot sold at a
 * third of it does not.
 */
export function chargeDealing(world: World, deal: FenceDeal): void {
  const buyer = world.citizens[deal.buyerId];
  const seller = world.citizens[deal.sellerId];
  if (!buyer || !seller) return;
  const line = { good: deal.good, productId: deal.productId, qty: deal.qty, value: deal.price };
  const restriction = restrictionOn(world, HOME_CITY, line, { direction: 'either', declared: true });
  const mod = districtCover(world, buyer.district);

  // Dealing as a business with no trading licence (L29). One lot is a favour;
  // a second inside a cycle is a trade, and a trade needs a licence.
  if (dealingsInCycle(world, deal.buyerId) >= DEALING_AS_A_BUSINESS && !holdsTradingLicence(world, deal.buyerId)) {
    chargeUnderworldOffence(world, deal.buyerId, UNLICENSED_DEALING, {
      amount: deal.price, visibilityMod: mod,
      description: `${buyer.name} has taken ${dealingsInCycle(world, deal.buyerId)} lots this cycle with no trading licence`,
    });
  }

  if (!restriction) return;
  const landed = deal.productId ? landedCost(world, deal.productId) * deal.qty : lawfulPrice(world, { ...line, value: 0 });
  const goodFaith = landed > 0 && deal.price >= Math.round(landed * GOOD_FAITH_SHARE);
  const holderId = goodFaith ? deal.sellerId : deal.buyerId;
  const holder = goodFaith ? seller : buyer;
  chargeUnderworldOffence(world, holderId, CONTRABAND_POSSESSION, {
    amount: deal.price, visibilityMod: mod,
    description: goodFaith
      ? `${seller.name} sold ${deal.qty} against the schedule (${restriction.subject}) at what a lawful crate lands at`
      : `${holder.name} holds ${deal.qty} against the schedule (${restriction.subject}), bought at ${deal.price} ℓ `
        + `against a landed cost of ${Math.round(landed)} ℓ`,
  });
}

/** Withdraw an offer, or decline one made to you. Either side may close it. */
export function closeDeal(world: World, cId: CitizenId, dealId: string): ActionResult {
  const deal = underworldState(world).deals.find((d) => d.id === dealId);
  if (!deal) return fail('There is no such offer.');
  if (deal.sellerId !== cId && deal.buyerId !== cId) return fail('That offer is not yours to close.');
  if (deal.status !== 'offered') return fail('That offer is already closed.');
  deal.status = 'closed';
  return ok(`Offer ${deal.id} is closed.`);
}

/** The day a fence was reported and acquitted; for a cycle they are paid more. */
export function noteAcquittal(world: World, fenceId: CitizenId): void {
  underworldState(world).acquittedDay[fenceId] = world.day;
}

/** How well known a fence is, in words, for an observation. */
export function fenceLine(world: World, fenceId: CitizenId): string {
  const known = notorietyOf(world, fenceId);
  if (known <= 0) return 'Nobody has heard anything about who takes what.';
  if (known < 4) return 'A few people know whose door to knock on.';
  return 'Everybody knows whose door to knock on, and the price has come down accordingly.';
}

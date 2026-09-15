/**
 * City bonds: the issue, the auction, and the market afterwards
 * (`FINANCE.md` §§1–2).
 *
 * Face is fixed at **100 ℓ a bond**, so every price quoted anywhere is a
 * percentage: a bond bought at 78 cost 78 ℓ and will be redeemed at 100. The
 * Council issues by proposal and the Exchange runs the auction; the auction is
 * the city's credit rating, read straight off what the bidders were willing to
 * pay.
 *
 * Clearing is **uniform-price**: bids sorted by price descending, ties to the
 * earlier tick, filled until the issue is exhausted, and every winner pays the
 * lowest accepted price. Uniform price never punishes an honest bid, which is
 * what makes the number worth reading. **Cover below 1** — less face bid than
 * offered — is the loudest number in the city's finances.
 *
 * Nothing here mints anything. A holding is a row in a public register with no
 * lumens in it; lumens move only at the auction (bidder → Treasury), on the
 * secondary market (buyer → seller) and, in `finance/debt.ts`, at each coupon
 * and at redemption.
 */
import type { ActionResult, Business, Citizen, CitizenId, MoneyParty, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens, lastBalanceSheet, transfer } from '../economy/treasury.ts';
import type { BondBid, BondHolding, BondIssue, Holder } from './state.ts';
import { commitOffence } from '../government/watch.ts';
import { FINANCE_LAWS, financeId, financeKind, financeLaw, financeState } from './state.ts';

/** Face of one bond, in lumens. Fixed for ever: a price is a percentage of it. */
export const BOND_FACE = 100;
/** Bonds an issue may offer. */
export const SIZE_MIN = 20;
export const SIZE_MAX = 3_000;
/** Lumens per bond per day. */
export const COUPON_MIN = 0.5;
export const COUPON_MAX = 4;
/** Days from clearing to redemption, in whole cycles. */
export const TERM_MIN = 28;
export const TERM_MAX = 336;
/** Days an auction stays open before it clears. */
export const AUCTION_DAYS = 2;
/** The tick an auction closes at, on its closing day (`REGISTRY.md` §2). */
export const AUCTION_CLOSE_TICK = 14;
/** Daily debt service the Exchange will not let the city exceed: a fifth of the mean daily revenue of the last cycle. */
export const DEBT_SERVICE_CAP = 0.2;
/** Bounds on a bid, in lumens per bond. */
export const PRICE_MIN = 1;
export const PRICE_MAX = 200;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** A bidder is a citizen who may trade, or a business still trading. */
export function mayTrade(world: World, holder: Holder): boolean {
  const c = world.citizens[holder];
  if (c) return c.standing === 'good' || c.standing === 'probation';
  const b: Business | undefined = world.businesses[holder];
  return !!b && b.dissolvedDay === null;
}

export function nameOfHolder(world: World, holder: Holder): string {
  return world.citizens[holder]?.name ?? world.businesses[holder]?.name ?? 'someone';
}

// ---------------------------------------------------------------------------
// What the city can afford
// ---------------------------------------------------------------------------

/** Record what the Treasury took yesterday, so the cap is read off a cycle of takings. */
export function recordRevenueDay(world: World): void {
  const s = financeState(world);
  const revenue = Math.max(0, Math.round(lastBalanceSheet(world).revenue));
  s.revenueDays.push(revenue);
  const keep = Math.max(1, world.config.cycleDays);
  if (s.revenueDays.length > keep) s.revenueDays.splice(0, s.revenueDays.length - keep);
}

/** The mean daily revenue of the last cycle, or yesterday's takings before there is a cycle to read. */
export function meanDailyRevenue(world: World): number {
  const s = financeState(world);
  if (s.revenueDays.length > 0) {
    const sum = s.revenueDays.reduce((a, b) => a + b, 0);
    return sum / s.revenueDays.length;
  }
  return Math.max(0, lastBalanceSheet(world).revenue);
}

/** Every issue the city still owes coupons on. */
export function outstandingIssues(world: World): BondIssue[] {
  return Object.values(financeState(world).issues).filter((i) => i.status === 'outstanding');
}

/** Auctions taking bids right now. */
export function openAuctions(world: World): BondIssue[] {
  return Object.values(financeState(world).issues).filter((i) => i.status === 'auction');
}

export function issueOf(world: World, issueId: string): BondIssue | null {
  return financeState(world).issues[issueId] ?? null;
}

/** Coupons the city owes each day on everything outstanding. */
export function dailyDebtService(world: World): number {
  let sum = 0;
  for (const issue of outstandingIssues(world)) sum += couponBill(world, issue);
  return Math.round(sum);
}

/**
 * What one issue costs the Treasury in a day, after any haircut a
 * restructuring took. It is read off the **register**, not off what was sold:
 * a holding seized on exile leaves the register and stops being paid, and the
 * holders who are left are still paid exactly their own coupon.
 */
export function couponBill(world: World, issue: BondIssue): number {
  const bonds = holdersOf(world, issue.id).reduce((sum, h) => sum + h.qty, 0);
  return Math.round(issue.coupon * bonds * (1 - issue.haircut));
}

/** The most the city may commit to debt service a day: a fifth of a cycle's mean daily revenue. */
export function debtServiceCap(world: World): number {
  return Math.round(meanDailyRevenue(world) * DEBT_SERVICE_CAP);
}

/** Would this issue breach the cap, and by how much? */
export function wouldBreachCap(world: World, size: number, coupon: number): { breach: boolean; service: number; cap: number } {
  const service = dailyDebtService(world) + Math.round(coupon * size);
  const cap = debtServiceCap(world);
  return { breach: service > cap, service, cap };
}

// ---------------------------------------------------------------------------
// Opening an issue
// ---------------------------------------------------------------------------

export interface IssueSpec {
  size: number;
  coupon: number;
  termDays: number;
  proposalId?: string | null;
  /** The Council overrode the cap by four of five (`FINANCE.md` §1). */
  override?: boolean;
}

/**
 * Open an issue and start its two-day auction. The Council authorises it by
 * proposal; this is what the Exchange then does. It refuses an issue that
 * breaches the debt-service cap unless the Council overrode by four of five,
 * and it refuses any issue at all for four cycles after a repudiation.
 */
export function openIssue(world: World, spec: IssueSpec): ActionResult & { issue?: BondIssue } {
  const s = financeState(world);
  if (world.day < s.noIssuesUntilDay) {
    return fail(`The Exchange will take no new issue until day ${s.noIssuesUntilDay}: this city repudiated its paper.`);
  }
  const size = Math.round(spec.size);
  const coupon = Math.round(spec.coupon * 10) / 10;
  const term = Math.round(spec.termDays);
  if (!Number.isFinite(size) || size < SIZE_MIN || size > SIZE_MAX) {
    return fail(`An issue is between ${SIZE_MIN} and ${SIZE_MAX} bonds.`);
  }
  if (!Number.isFinite(coupon) || coupon < COUPON_MIN || coupon > COUPON_MAX) {
    return fail(`A coupon is between ${COUPON_MIN} and ${COUPON_MAX} ℓ per bond per day.`);
  }
  const cycle = Math.max(1, world.config.cycleDays);
  if (!Number.isFinite(term) || term < TERM_MIN || term > TERM_MAX || term % cycle !== 0) {
    return fail(`A term is a whole number of ${cycle}-day cycles, between ${TERM_MIN} and ${TERM_MAX} days.`);
  }
  const cap = wouldBreachCap(world, size, coupon);
  if (cap.breach && !spec.override) {
    return fail(`That issue would take daily debt service to ${formatLumens(cap.service)} against a cap of ${formatLumens(cap.cap)}; `
      + 'the Exchange refuses it unless the Council overrides by four of five.');
  }

  const issue: BondIssue = {
    id: financeId(world, 'bond'), size, coupon, termDays: term,
    openedDay: world.day, closesDay: world.day + AUCTION_DAYS, status: 'auction',
    clearingPrice: null, cover: null, sold: 0, maturesDay: null,
    proposalId: spec.proposalId ?? null, override: !!spec.override && cap.breach,
    missedDays: [], deferrals: 0, deferredUntilDay: null, accrued: 0, haircut: 0,
    defaultedDay: null, repudiatedDay: null,
  };
  s.issues[issue.id] = issue;
  emit(world, 'treasury',
    `The Exchange opened an auction: ${size} bonds of ${BOND_FACE} ℓ face at ${coupon} ℓ a day for ${term} days, closing on day ${issue.closesDay}.`
    + (issue.override ? ` The Council overrode the debt-service cap by four of five: service would be ${formatLumens(cap.service)} against ${formatLumens(cap.cap)}.` : ''),
    [], issue.override ? 0.9 : 0.6,
    { issueId: issue.id, size, coupon, term, service: cap.service, cap: cap.cap, override: issue.override });
  return { ok: true, message: `Auction open: ${size} bonds at ${coupon} ℓ a day, closing day ${issue.closesDay}.`, issue };
}

// ---------------------------------------------------------------------------
// Bidding
// ---------------------------------------------------------------------------

/** Bids on an issue. Sealed until the close and public for ever after. */
export function bidsFor(world: World, issueId: string): BondBid[] {
  return financeState(world).bids.filter((b) => b.issueId === issueId);
}

/** What a bidder may see of an auction before it closes: their own bids only. */
export function visibleBids(world: World, issueId: string, viewerId: Holder | null): BondBid[] {
  const issue = issueOf(world, issueId);
  const bids = bidsFor(world, issueId);
  if (!issue || issue.status !== 'auction') return bids;
  return viewerId ? bids.filter((b) => b.bidderId === viewerId) : [];
}

/** Bid at an open auction. A bid is a promise to pay, and it is kept at the close. */
export function bidBond(world: World, bidderId: Holder, issueId: string, price: number, qty: number): ActionResult {
  const issue = issueOf(world, issueId);
  if (!issue || issue.status !== 'auction') return fail('There is no such auction taking bids.');
  if (!mayTrade(world, bidderId)) return fail('Your standing does not allow you to bid.');
  const p = Math.round(price);
  const n = Math.round(qty);
  if (!Number.isFinite(p) || p < PRICE_MIN || p > PRICE_MAX) {
    return fail(`A bid is between ${PRICE_MIN} and ${PRICE_MAX} ℓ per bond of ${BOND_FACE} ℓ face.`);
  }
  if (!Number.isFinite(n) || n < 1 || n > issue.size) return fail(`You may bid for 1 to ${issue.size} bonds.`);
  const cost = p * n;
  if (balanceOf(world, bidderId) < cost) return fail(`That bid would cost ${formatLumens(cost)} and you hold ${formatLumens(balanceOf(world, bidderId))}.`);

  const s = financeState(world);
  const bid: BondBid = { id: financeId(world, 'bid'), issueId, bidderId, price: p, qty: n, tick: world.tick, filled: 0 };
  s.bids.push(bid);
  const c: Citizen | undefined = world.citizens[bidderId];
  if (c) remember(world, c.id, 'money', `You bid ${p} ℓ a bond for ${n} of the city's bonds; the auction closes on day ${issue.closesDay}.`);
  return ok(`Your sealed bid of ${n} bonds at ${p} ℓ is lodged; the auction closes at tick ${AUCTION_CLOSE_TICK} on day ${issue.closesDay}.`);
}

/** Withdraw a bid before the close. */
export function withdrawBid(world: World, bidderId: Holder, bidId: string): ActionResult {
  const s = financeState(world);
  const i = s.bids.findIndex((b) => b.id === bidId && b.bidderId === bidderId);
  if (i < 0) return fail('You have no such bid.');
  const issue = issueOf(world, s.bids[i].issueId);
  if (!issue || issue.status !== 'auction') return fail('That auction has closed.');
  s.bids.splice(i, 1);
  return ok('Your bid is withdrawn.');
}

// ---------------------------------------------------------------------------
// Clearing
// ---------------------------------------------------------------------------

/** Auctions due to clear now: their closing day, at the closing tick. */
export function auctionsDue(world: World): BondIssue[] {
  return openAuctions(world).filter((i) => world.day > i.closesDay
    || (world.day === i.closesDay && world.hour >= AUCTION_CLOSE_TICK));
}

/** Close every auction whose hour has come. Call at the auction tick. */
export function closeDueAuctions(world: World): void {
  for (const issue of auctionsDue(world)) closeAuction(world, issue);
}

/**
 * Clear one auction, uniform-price. Every winner pays the lowest accepted
 * price; a winner who cannot pay when the hour comes forfeits their allotment,
 * and the bonds go unsold.
 */
export function closeAuction(world: World, issue: BondIssue): void {
  if (issue.status !== 'auction') return;
  const s = financeState(world);
  const bids = bidsFor(world, issue.id).slice().sort((a, b) => (b.price - a.price) || (a.tick - b.tick) || a.id.localeCompare(b.id));
  const faceBid = bids.reduce((sum, b) => sum + b.qty, 0);
  issue.cover = Math.round((faceBid / issue.size) * 100) / 100;

  // Allot down the book until the issue is exhausted; the last price accepted
  // is the price everybody pays.
  let left = issue.size;
  let clearing = 0;
  const allotted: { bid: BondBid; qty: number }[] = [];
  for (const bid of bids) {
    if (left <= 0) break;
    const take = Math.min(bid.qty, left);
    if (take <= 0) continue;
    allotted.push({ bid, qty: take });
    left -= take;
    clearing = bid.price;
  }

  if (allotted.length === 0 || clearing <= 0) {
    issue.status = 'failed';
    issue.clearingPrice = null;
    emit(world, 'treasury', `The auction of ${issue.size} bonds failed: nobody bid. The city could not sell its paper.`,
      [], 0.9, { issueId: issue.id, cover: issue.cover });
    return;
  }

  let sold = 0;
  let raised = 0;
  const failedBidders: string[] = [];
  for (const { bid, qty } of allotted) {
    const cost = clearing * qty;
    if (!transfer(world, bid.bidderId, 'treasury', cost, financeKind('bond'), `${qty} bonds of issue ${issue.id} at ${clearing} ℓ`)) {
      failedBidders.push(nameOfHolder(world, bid.bidderId));
      continue;
    }
    bid.filled = qty;
    sold += qty;
    raised += cost;
    addHolding(world, issue.id, bid.bidderId, qty, clearing);
    const c = world.citizens[bid.bidderId];
    if (c) {
      remember(world, c.id, 'money',
        `You bought ${qty} city bonds at ${clearing} ℓ (face ${BOND_FACE} ℓ, coupon ${issue.coupon} ℓ a day for ${issue.termDays} days).`);
    }
  }

  issue.sold = sold;
  issue.clearingPrice = clearing;
  s.lastTraded[issue.id] = clearing;
  if (sold <= 0) {
    issue.status = 'failed';
    emit(world, 'treasury', `The auction of ${issue.size} bonds failed: every winning bidder was short of lumens when the hour came.`,
      [], 0.9, { issueId: issue.id, cover: issue.cover });
    return;
  }
  issue.status = 'outstanding';
  issue.maturesDay = world.day + issue.termDays;
  chargeAuctionProxies(world, issue, allotted.map(({ bid }) => bid.bidderId));
  const yieldPerDay = issue.coupon / clearing;
  const short = issue.cover !== null && issue.cover < 1;
  emit(world, 'treasury',
    `The city's bonds cleared at ${clearing} (cover ${issue.cover?.toFixed(2)}): ${sold} of ${issue.size} sold, raising ${formatLumens(raised)} at a yield of `
    + `${(yieldPerDay * 100).toFixed(2)}% a day, redeemable on day ${issue.maturesDay}.`
    + (short ? ' Cover below 1: the city took what it got.' : '')
    + (failedBidders.length > 0 ? ` ${failedBidders.length} winning bid${failedBidders.length === 1 ? '' : 's'} could not be paid for.` : ''),
    [], short ? 0.9 : 0.6,
    { issueId: issue.id, clearing, cover: issue.cover, sold, raised, yield: yieldPerDay });
}

// ---------------------------------------------------------------------------
// Holdings
// ---------------------------------------------------------------------------

export function addHolding(world: World, issueId: string, holderId: Holder, qty: number, paid: number): BondHolding {
  const s = financeState(world);
  const existing = Object.values(s.holdings).find((h) => h.issueId === issueId && h.holderId === holderId);
  if (existing) {
    const total = existing.qty + qty;
    existing.paid = Math.round((existing.paid * existing.qty + paid * qty) / Math.max(1, total));
    existing.qty = total;
    return existing;
  }
  const holding: BondHolding = { id: financeId(world, 'hold'), issueId, holderId, qty, paid, sinceDay: world.day };
  s.holdings[holding.id] = holding;
  return holding;
}

export function holdingOf(world: World, holdingId: string): BondHolding | null {
  return financeState(world).holdings[holdingId] ?? null;
}

/** Every holding on the register for one holder. */
export function holdingsOf(world: World, holderId: Holder): BondHolding[] {
  return Object.values(financeState(world).holdings).filter((h) => h.holderId === holderId && h.qty > 0);
}

/** Every holding of one issue. */
export function holdersOf(world: World, issueId: string): BondHolding[] {
  return Object.values(financeState(world).holdings).filter((h) => h.issueId === issueId && h.qty > 0);
}

/** Face a holder holds of one issue, after any haircut. */
export function faceHeld(world: World, issueId: string, holderId: Holder): number {
  const issue = issueOf(world, issueId);
  const cut = issue ? issue.haircut : 0;
  return holdersOf(world, issueId)
    .filter((h) => h.holderId === holderId)
    .reduce((sum, h) => sum + h.qty * BOND_FACE * (1 - cut), 0);
}

/** Face still outstanding on an issue, after any haircut. */
export function faceOutstanding(world: World, issue: BondIssue): number {
  return Math.round(holdersOf(world, issue.id).reduce((sum, h) => sum + h.qty, 0) * BOND_FACE * (1 - issue.haircut));
}

/**
 * The live rating: the last price two citizens agreed, or the price the
 * auction cleared at until somebody trades. A repudiated issue is worth 0.
 */
export function livePrice(world: World, issueId: string): number {
  const issue = issueOf(world, issueId);
  if (!issue) return 0;
  if (issue.status === 'repudiated') return 0;
  const s = financeState(world);
  return s.lastTraded[issueId] ?? issue.clearingPrice ?? 0;
}

/** Move a price (a deferral knocks it down; a trade sets it). */
export function setLivePrice(world: World, issueId: string, price: number): void {
  financeState(world).lastTraded[issueId] = Math.max(0, Math.round(price));
}

/** What a holder's paper is worth at today's rating. */
export function portfolioValue(world: World, holderId: Holder): number {
  return Math.round(holdingsOf(world, holderId).reduce((sum, h) => sum + h.qty * livePrice(world, h.issueId), 0));
}

/** Every party holding any of the city's paper. */
export function allHolders(world: World): Holder[] {
  const set = new Set<Holder>();
  for (const h of Object.values(financeState(world).holdings)) if (h.qty > 0) set.add(h.holderId);
  return [...set];
}

/** A party that can be paid: exiled citizens and dissolved businesses cannot. */
export function canBePaid(world: World, party: MoneyParty): boolean {
  const c = world.citizens[party];
  if (c) return c.standing !== 'exiled';
  const b = world.businesses[party];
  if (b) return b.dissolvedDay === null;
  return party === 'treasury';
}

/**
 * A councillor bidding through a proxy is **rigging an auction** (L25). The
 * evidence is a public register and nothing else: the Treasury's ledger shows
 * the lumens a councillor handed a bidder while the auction was open, and the
 * bid book shows that the councillor did not bid in their own name. The
 * Watch reads rather than patrols.
 *
 * The other limb of L25 — a ring of bidders agreeing a price between
 * themselves — is not read here: agreeing a price leaves no entry in any
 * register, and inventing evidence for it would be inventing the conspiracy
 * too.
 */
export function chargeAuctionProxies(world: World, issue: BondIssue, winners: Holder[]): CitizenId[] {
  const council = new Set<CitizenId>(world.government.council);
  if (world.government.mayorId) council.add(world.government.mayorId);
  if (council.size === 0) return [];
  const ownBids = new Set(bidsFor(world, issue.id).map((b) => b.bidderId));
  const openedTick = issue.openedDay * 24;
  const caught: CitizenId[] = [];
  for (const entry of world.treasury.ledger) {
    if (entry.tick < openedTick || entry.kind !== 'gift') continue;
    if (!council.has(entry.from) || ownBids.has(entry.from)) continue;
    if (!winners.includes(entry.to)) continue;
    if (caught.includes(entry.from)) continue;
    caught.push(entry.from);
    commitOffence(world, entry.from, financeLaw(FINANCE_LAWS.riggingAnAuction), { amount: entry.amount, visibilityMod: 0.2 });
  }
  return caught;
}

/**
 * Keep the bid book from growing without end. Bids are public for ever after
 * the close, and the ones that matter are the ones on paper the city still
 * owes; the rest are pruned oldest first once the book is long.
 */
export const BID_BOOK_LIMIT = 1_000;

export function pruneBids(world: World): void {
  const s = financeState(world);
  if (s.bids.length <= BID_BOOK_LIMIT) return;
  const live = new Set(Object.values(s.issues)
    .filter((i) => i.status === 'auction' || i.status === 'outstanding' || i.status === 'defaulted')
    .map((i) => i.id));
  const kept = s.bids.filter((b) => live.has(b.issueId));
  const rest = s.bids.filter((b) => !live.has(b.issueId));
  const room = Math.max(0, BID_BOOK_LIMIT - kept.length);
  s.bids = [...rest.slice(rest.length - room), ...kept];
}

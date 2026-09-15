/**
 * Servicing the debt: coupons, redemption, and the three doors out of a
 * missed coupon (`FINANCE.md` §§3, 7).
 *
 * A coupon the Treasury cannot pay is **missed**, announced that morning, and
 * uncured after two days is a **default**. Between the miss and the default
 * the Council has three doors, and taking none is taking the third:
 *
 * - **Deferral** — simple majority. Coupons accrue at ×1.25 and are paid at
 *   redemption; five days at most, twice in an issue's life. The traded price
 *   falls 10–20 and the paper still trades.
 * - **Restructuring** — the holders of two thirds of the face agree a new
 *   coupon, a new term and a haircut, and it binds the holdouts.
 * - **Repudiation** — four of five councillors write every holding to zero.
 *
 * **A default moves no lumens at all.** It deletes rows from a register, so
 * the audit does not blink — which is exactly why it is the cheapest act
 * available to a council in lumens and the dearest in everything else. No code
 * punishes it: the punishment is the electorate, the auction and the
 * neighbours. What this file does about it is make all of that visible —
 * holders remember who voted for it, the Exchange refuses the city new paper
 * for four cycles, and a councillor who sold before the vote is charged with
 * insider trading like anybody else.
 *
 * Minting lives here too, because it is the other way a city pays a coupon it
 * cannot afford, and the difference between the two is the whole of §7: a
 * deferral is honest and costs 10–20 of price, while minting the coupon costs
 * more, because a city that will print once will print again.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, lastBalanceSheet, moneySupply, transfer } from '../economy/treasury.ts';
import { randInt } from '../util/rng.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { commitOffence } from '../government/watch.ts';
import type { BondIssue, Holder, RestructureOffer } from './state.ts';
import { financeKind, financeState } from './state.ts';
import {
  BOND_FACE, COUPON_MAX, COUPON_MIN, TERM_MAX, TERM_MIN, canBePaid, couponBill, faceHeld, faceOutstanding,
  holdersOf, issueOf, livePrice, nameOfHolder, outstandingIssues, setLivePrice,
} from './bonds.ts';
import { openOffers } from './secondary.ts';

/** Days a coupon may stand missed before the issue is in default. */
export const DEFAULT_AFTER_MISSED_DAYS = 2;
/** Deferred coupons accrue at this multiple. */
export const DEFERRAL_MULTIPLIER = 1.25;
/** Longest a deferral may run, and how many an issue may take in its life. */
export const DEFERRAL_MAX_DAYS = 5;
export const DEFERRALS_PER_ISSUE = 2;
/** What a deferral does to the traded price. */
export const DEFERRAL_PRICE_FALL: [number, number] = [10, 20];
/** Share of face that carries a restructuring and binds the rest. */
export const RESTRUCTURE_THRESHOLD = 2 / 3;
/** Days a restructuring stays before the holders who did not vote are taken to have refused. */
export const RESTRUCTURE_DAYS = 3;
/** Cycles the Exchange refuses a repudiating city new paper. */
export const REPUDIATION_BAR_DAYS = 112;
/** Days back the Exchange's transfer register is read for a councillor's sale before a repudiation. */
export const INSIDER_WINDOW_DAYS = 3;
/** How much of a bond holder's regard a councillor loses per share of their paper written off. */
export const REPUDIATION_BOND_COST = 60;
/** Days of revenue the city's coverage is read over: one cycle. */
export const COVERAGE_DAYS = 28;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// Coupons
// ---------------------------------------------------------------------------

/** Coupons owed on an issue today, arrears included. */
function owedToday(world: World, issue: BondIssue): number {
  return couponBill(world, issue) * (1 + issue.missedDays.length);
}

/**
 * Pay the day's coupons on every issue outstanding. Called at the morning
 * rollover as part of today's fixed spend, ahead of any salaried shift: the
 * city's creditors are paid before the city's workers, which is what makes the
 * twenty per cent cap the line it is.
 */
export function payCoupons(world: World): void {
  for (const issue of outstandingIssues(world)) {
    if (issue.deferredUntilDay !== null && world.day < issue.deferredUntilDay) {
      // A deferral: the coupon is not paid, it accrues at ×1.25 and is owed at redemption.
      issue.accrued += Math.round(couponBill(world, issue) * DEFERRAL_MULTIPLIER);
      continue;
    }
    if (issue.deferredUntilDay !== null && world.day >= issue.deferredUntilDay) issue.deferredUntilDay = null;
    const bill = owedToday(world, issue);
    if (bill <= 0) continue;
    if (world.treasury.balance < bill) {
      missCoupon(world, issue, bill);
      continue;
    }
    payHolders(world, issue, bill, 'coupon');
    if (issue.missedDays.length > 0) {
      emit(world, 'treasury', `The city caught up the coupons it missed on issue ${issue.id}.`, [], 0.5, { issueId: issue.id });
      issue.missedDays = [];
    }
  }
}

/** Share a sum among the holders of an issue, by the bonds each holds. */
function payHolders(world: World, issue: BondIssue, total: number, kind: 'coupon' | 'redemption'): number {
  const holders = holdersOf(world, issue.id);
  const bonds = holders.reduce((sum, h) => sum + h.qty, 0);
  if (bonds <= 0 || total <= 0) return 0;
  let paid = 0;
  for (const holding of holders) {
    if (!canBePaid(world, holding.holderId)) continue;
    const share = Math.round((total * holding.qty) / bonds);
    if (share <= 0) continue;
    if (!transfer(world, 'treasury', holding.holderId, share, financeKind(kind),
      `${kind === 'coupon' ? 'coupon on' : 'redemption of'} ${holding.qty} bonds of issue ${issue.id}`)) continue;
    paid += share;
    const c = world.citizens[holding.holderId];
    if (c) {
      remember(world, c.id, 'money', kind === 'coupon'
        ? `The city paid you ${formatLumens(share)} of coupon on ${holding.qty} bonds.`
        : `The city redeemed ${holding.qty} bonds and paid you ${formatLumens(share)}.`);
    }
  }
  return paid;
}

function missCoupon(world: World, issue: BondIssue, bill: number): void {
  if (!issue.missedDays.includes(world.day)) issue.missedDays.push(world.day);
  emit(world, 'treasury',
    `The city missed a coupon: ${formatLumens(bill)} was due on issue ${issue.id} and the Treasury holds ${formatLumens(world.treasury.balance)}. `
    + `Uncured after ${DEFAULT_AFTER_MISSED_DAYS} days it is a default.`,
    [], 0.9, { issueId: issue.id, bill, missed: issue.missedDays.length });
  const fall = Math.max(0, livePrice(world, issue.id) - randInt(world, ...DEFERRAL_PRICE_FALL));
  setLivePrice(world, issue.id, fall);
  if (issue.missedDays.length >= DEFAULT_AFTER_MISSED_DAYS) declareDefault(world, issue);
}

/**
 * A default: the paper stays on the register and stays tradable, the coupons
 * stop being paid on time, and the city's rating is whatever anybody will now
 * give for it. Nobody is charged with anything — an unpaid coupon is a debt,
 * and debt is never a crime (`REGISTRY.md` §4).
 */
export function declareDefault(world: World, issue: BondIssue): void {
  if (issue.status !== 'outstanding') return;
  issue.status = 'defaulted';
  issue.defaultedDay = world.day;
  emit(world, 'treasury',
    `The city is in default on issue ${issue.id}: ${formatLumens(faceOutstanding(world, issue))} of face, coupons unpaid for ${issue.missedDays.length} days.`,
    [], 1, { issueId: issue.id });
  for (const holding of holdersOf(world, issue.id)) {
    const c = world.citizens[holding.holderId];
    if (c) remember(world, c.id, 'money', `The city defaulted on the bonds you hold (${holding.qty} of them).`);
  }
}

/** Redeem every issue that has come to term: face, plus whatever a deferral left accrued. */
export function redeemMatured(world: World): void {
  for (const issue of outstandingIssues(world)) {
    if (issue.maturesDay === null || world.day < issue.maturesDay) continue;
    const face = faceOutstanding(world, issue);
    const due = face + Math.round(issue.accrued);
    if (world.treasury.balance < due) {
      missCoupon(world, issue, due);
      continue;
    }
    payHolders(world, issue, due, 'redemption');
    issue.status = 'redeemed';
    issue.accrued = 0;
    emit(world, 'treasury', `The city redeemed issue ${issue.id} in full: ${formatLumens(due)} to its holders.`, [], 0.6,
      { issueId: issue.id, paid: due });
    for (const holding of holdersOf(world, issue.id)) delete financeState(world).holdings[holding.id];
  }
}

// ---------------------------------------------------------------------------
// Door one: deferral
// ---------------------------------------------------------------------------

/**
 * Defer an issue's coupons (`bond_defer`, simple majority). They accrue at
 * ×1.25 and are paid at redemption; the price falls 10–20 and the paper still
 * trades.
 */
export function deferIssue(world: World, issueId: string, days = DEFERRAL_MAX_DAYS): ActionResult {
  const issue = issueOf(world, issueId);
  if (!issue) return fail('There is no such issue.');
  if (issue.status !== 'outstanding') return fail('That paper is not being serviced.');
  if (issue.deferrals >= DEFERRALS_PER_ISSUE) {
    return fail(`Issue ${issue.id} has already been deferred ${DEFERRALS_PER_ISSUE} times; the Council must restructure or default.`);
  }
  const run = clamp(Math.round(days), 1, DEFERRAL_MAX_DAYS);
  issue.deferrals += 1;
  issue.deferredUntilDay = world.day + run;
  issue.missedDays = [];
  const before = livePrice(world, issue.id);
  const fall = randInt(world, ...DEFERRAL_PRICE_FALL);
  setLivePrice(world, issue.id, Math.max(0, before - fall));
  emit(world, 'treasury',
    `The Council deferred the coupons on issue ${issue.id} for ${run} days; they accrue at ×${DEFERRAL_MULTIPLIER} and are paid at redemption. `
    + `The paper fell from ${before} to ${Math.max(0, before - fall)}.`,
    [], 0.8, { issueId: issue.id, days: run, price: Math.max(0, before - fall) });
  for (const holding of holdersOf(world, issue.id)) {
    const c = world.citizens[holding.holderId];
    if (c) remember(world, c.id, 'money', `The city deferred the coupons on your ${holding.qty} bonds for ${run} days.`);
  }
  return ok(`Coupons on issue ${issue.id} are deferred for ${run} days.`);
}

// ---------------------------------------------------------------------------
// Door two: restructuring
// ---------------------------------------------------------------------------

export function restructureOf(world: World, issueId: string): RestructureOffer | null {
  const r = financeState(world).restructures[issueId];
  return r && r.status === 'open' ? r : null;
}

/** Put new terms to the holders. The Mayor or any councillor may, and only they. */
export function offerRestructure(
  world: World, proposerId: CitizenId, issueId: string,
  terms: { coupon: number; termDays: number; haircut: number },
): ActionResult {
  const c = world.citizens[proposerId];
  if (!c) return fail('Unknown citizen.');
  if (c.office !== 'councillor' && c.office !== 'mayor') return fail('Only the Mayor or a councillor may put terms to the holders.');
  const issue = issueOf(world, issueId);
  if (!issue) return fail('There is no such issue.');
  if (issue.status !== 'outstanding' && issue.status !== 'defaulted') return fail('That paper is not restructurable.');
  if (restructureOf(world, issueId)) return fail('Terms are already before the holders.');
  const coupon = Math.round(terms.coupon * 10) / 10;
  const term = Math.round(terms.termDays);
  const haircut = Math.round(clamp(terms.haircut, 0, 0.9) * 100) / 100;
  if (!Number.isFinite(coupon) || coupon < 0 || coupon > COUPON_MAX) return fail(`A coupon is between 0 and ${COUPON_MAX} ℓ a bond a day.`);
  if (!Number.isFinite(term) || term < TERM_MIN || term > TERM_MAX) return fail(`A term is between ${TERM_MIN} and ${TERM_MAX} days.`);

  const offer: RestructureOffer = {
    issueId, proposerId, coupon: Math.max(COUPON_MIN, coupon), termDays: term, haircut,
    day: world.day, votes: {}, status: 'open', decidedDay: null,
  };
  financeState(world).restructures[issueId] = offer;
  emit(world, 'treasury',
    `${c.name} put new terms to the holders of issue ${issue.id}: ${offer.coupon} ℓ a day, ${term} days, and ${Math.round(haircut * 100)}% off the face. `
    + 'Two thirds of the face carries and binds the rest.',
    [proposerId], 0.8, { issueId, coupon: offer.coupon, termDays: term, haircut });
  for (const holding of holdersOf(world, issueId)) {
    const h = world.citizens[holding.holderId];
    if (h) remember(world, h.id, 'money', `The city offered to restructure the bonds you hold: ${offer.coupon} ℓ a day, ${term} days, ${Math.round(haircut * 100)}% off the face.`);
  }
  return ok('The terms are before the holders.');
}

/** Vote your face. Two thirds carries and binds the holdouts. */
export function voteRestructure(world: World, issueId: string, holderId: Holder, accept: boolean): ActionResult {
  const offer = restructureOf(world, issueId);
  if (!offer) return fail('There are no terms before the holders.');
  if (faceHeld(world, issueId, holderId) <= 0) return fail('You hold none of that paper.');
  offer.votes[holderId] = accept;
  const tally = tallyRestructure(world, offer);
  emit(world, 'vote', `${nameOfHolder(world, holderId)} voted ${accept ? 'for' : 'against'} the restructuring of issue ${issueId}.`,
    world.citizens[holderId] ? [holderId] : [], 0.2, { issueId, accept, share: tally.share });
  return ok(`You voted ${accept ? 'for' : 'against'}; ${Math.round(tally.share * 100)}% of the face has accepted.`);
}

function tallyRestructure(world: World, offer: RestructureOffer): { share: number; face: number; accepted: number } {
  const issue = issueOf(world, offer.issueId);
  const face = issue ? faceOutstanding(world, issue) : 0;
  let accepted = 0;
  for (const [holderId, aye] of Object.entries(offer.votes)) {
    if (aye) accepted += faceHeld(world, offer.issueId, holderId);
  }
  return { share: face > 0 ? accepted / face : 0, face, accepted };
}

/**
 * Decide the terms before the holders: two thirds of the face carries at once,
 * and after three days the holders who did not vote are taken to have refused.
 * A holder who thinks the city is bluffing may vote it down and take the
 * default instead.
 */
export function resolveRestructures(world: World): void {
  const s = financeState(world);
  for (const offer of Object.values(s.restructures)) {
    if (offer.status !== 'open') continue;
    const issue = issueOf(world, offer.issueId);
    if (!issue) { offer.status = 'rejected'; offer.decidedDay = world.day; continue; }
    const tally = tallyRestructure(world, offer);
    const carried = tally.share >= RESTRUCTURE_THRESHOLD;
    if (!carried && world.day - offer.day < RESTRUCTURE_DAYS) continue;
    offer.decidedDay = world.day;
    if (!carried) {
      offer.status = 'rejected';
      emit(world, 'treasury', `The holders refused to restructure issue ${issue.id}: ${Math.round(tally.share * 100)}% of the face accepted, and two thirds was needed.`,
        [], 0.7, { issueId: issue.id, share: tally.share });
      continue;
    }
    offer.status = 'carried';
    applyRestructure(world, issue, offer);
  }
}

function applyRestructure(world: World, issue: BondIssue, offer: RestructureOffer): void {
  const before = faceOutstanding(world, issue);
  issue.coupon = offer.coupon;
  issue.haircut = Math.min(0.9, Math.round((issue.haircut + offer.haircut * (1 - issue.haircut)) * 100) / 100);
  issue.termDays = offer.termDays;
  issue.maturesDay = world.day + offer.termDays;
  issue.missedDays = [];
  issue.status = 'outstanding';
  const after = faceOutstanding(world, issue);
  emit(world, 'treasury',
    `Issue ${issue.id} is restructured: ${issue.coupon} ℓ a day to day ${issue.maturesDay}, and the face falls from ${formatLumens(before)} to ${formatLumens(after)}. `
    + 'It binds every holder, including those who voted against.',
    [], 0.8, { issueId: issue.id, coupon: issue.coupon, maturesDay: issue.maturesDay, face: after });
  for (const holding of holdersOf(world, issue.id)) {
    const c = world.citizens[holding.holderId];
    if (c) remember(world, c.id, 'money', `Your bonds were restructured: ${issue.coupon} ℓ a day, ${Math.round(issue.haircut * 100)}% off the face.`);
  }
}

// ---------------------------------------------------------------------------
// Door three: repudiation
// ---------------------------------------------------------------------------

/**
 * Write every holding of an issue to zero (`repudiate`, Council, four of
 * five). It is lawful and no code punishes it. **It moves no lumens at all**:
 * it deletes rows from a register, and the money supply does not change by a
 * lumen. What it costs is everything else — the savings of citizens who did
 * nothing worse than trust their own city, four cycles without access to the
 * auction, and every councillor who voted for it answering to every voter
 * whose paper they burned.
 */
export function repudiate(world: World, issueId: string, spec: { votedFor?: CitizenId[] } = {}): ActionResult {
  const issue = issueOf(world, issueId);
  if (!issue) return fail('There is no such issue.');
  if (issue.status === 'repudiated') return fail('That issue is already repudiated.');
  if (issue.status !== 'outstanding' && issue.status !== 'defaulted') return fail('That paper is not outstanding.');
  const s = financeState(world);
  const holders = holdersOf(world, issue.id);
  const face = faceOutstanding(world, issue);
  const votedFor = (spec.votedFor ?? []).filter((id) => !!world.citizens[id]);

  chargeInsiderSellers(world, issue.id, votedFor);

  for (const holding of holders) {
    const lost = Math.round(holding.qty * BOND_FACE * (1 - issue.haircut));
    const c = world.citizens[holding.holderId];
    if (c) {
      const wealth = Math.max(1, c.wallet + lost);
      const share = clamp(lost / wealth, 0, 1);
      remember(world, c.id, 'money',
        `The Council repudiated the city's bonds: ${formatLumens(lost)} of your savings is gone, and no court will hear it.`);
      for (const councillorId of votedFor) {
        if (councillorId === c.id) continue;
        adjustBond(world, c.id, councillorId, -Math.round(REPUDIATION_BOND_COST * share), false);
      }
      if (c.approval) c.approval.council = clamp(c.approval.council - share * 0.5, 0, 1);
    }
    delete s.holdings[holding.id];
  }
  for (const offer of openOffers(world)) if (offer.issueId === issue.id) offer.status = 'withdrawn';

  issue.status = 'repudiated';
  issue.repudiatedDay = world.day;
  setLivePrice(world, issue.id, 0);
  s.noIssuesUntilDay = Math.max(s.noIssuesUntilDay, world.day + REPUDIATION_BAR_DAYS);
  emit(world, 'treasury',
    `The Council repudiated issue ${issue.id}: ${formatLumens(face)} of the city's paper, held by ${holders.length} holders, is written to zero. `
    + `No lumen moved. The Exchange will take no new issue from Reverie until day ${s.noIssuesUntilDay}.`,
    votedFor, 1, { issueId: issue.id, face, holders: holders.length, until: s.noIssuesUntilDay });
  return ok(`Issue ${issue.id} is repudiated; ${formatLumens(face)} of face is written to zero.`);
}

/**
 * A councillor who sold their holding before the vote is insider trading
 * (L17). The Exchange's transfer register is the evidence, so the Watch reads
 * rather than patrols.
 */
export function chargeInsiderSellers(world: World, issueId: string, councillors: CitizenId[]): CitizenId[] {
  const caught: CitizenId[] = [];
  const since = world.day - INSIDER_WINDOW_DAYS;
  const council = new Set<CitizenId>([...councillors, ...world.government.council]);
  for (const offer of Object.values(financeState(world).offers)) {
    if (offer.issueId !== issueId || offer.status !== 'taken' || offer.day < since) continue;
    if (!council.has(offer.sellerId) || caught.includes(offer.sellerId)) continue;
    caught.push(offer.sellerId);
    commitOffence(world, offer.sellerId, 'L17', { amount: offer.price * offer.qty, visibilityMod: 0.3 });
  }
  return caught;
}

// ---------------------------------------------------------------------------
// What backs a lumen
// ---------------------------------------------------------------------------

/**
 * What the city could retire within a cycle against everything it owes
 * (`FINANCE.md` §7). Above 1 the city could pay off the lot; below 0.4 its
 * auctions stop clearing near par, because that is the number every bidder
 * reads first.
 */
export function currencyCoverage(world: World, depositsHeld = 0): number {
  const revenue = Math.max(0, lastBalanceSheet(world).revenue);
  const assets = world.treasury.balance + revenue * COVERAGE_DAYS;
  let claims = Math.max(0, moneySupply(world) - world.treasury.balance) + Math.max(0, depositsHeld);
  for (const issue of Object.values(financeState(world).issues)) {
    if (issue.status === 'outstanding' || issue.status === 'defaulted') claims += faceOutstanding(world, issue);
  }
  if (claims <= 0) return 1;
  return Math.round((assets / claims) * 100) / 100;
}

/**
 * The Council prints (`mint`, four of five). Money enters through the same
 * funnel as everything else, from the `mint` party, which raises
 * `treasury.minted` in the same call — so the audit balances to the lumen and
 * the price index prints the decision back inside a week.
 */
export function mintLumens(world: World, amount: number, why = 'the Council voted to mint'): ActionResult {
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('That is not an amount to mint.');
  const supply = moneySupply(world);
  if (!transfer(world, 'mint', 'treasury', amt, 'mint', why)) return fail('The mint refused.');
  const share = supply > 0 ? amt / supply : 1;
  emit(world, 'treasury',
    `The Council minted ${formatLumens(amt)} — ${(share * 100).toFixed(1)}% of the money in the city. Prices will read it back within a week.`,
    [], 1, { amount: amt, supply, share });
  return ok(`${formatLumens(amt)} minted; the money supply rises by ${(share * 100).toFixed(1)}%.`);
}

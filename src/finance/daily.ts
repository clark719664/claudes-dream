/**
 * The finance layer's day, and what a citizen sees of it.
 *
 * One tick hook and one morning hook, so the rollover has one thing to call.
 * The order of the morning is the order the city's obligations run in
 * (`FINANCE.md` §1): the coupons are part of **today's fixed spend**, paid
 * before any salaried shift, which is what makes the twenty per cent
 * debt-service cap the line it is. Then redemptions, then the holders'
 * business, then the bank, then the houses, then the pots.
 *
 * Everything printed here is public. A citizen's `finance` block carries their
 * own holdings and what the paper last traded at, their deposit and the posted
 * rates, their policies, their mutual and its pot, the bank's reserve and
 * confidence, the city's coverage, and every open auction with its cover — the
 * numbers a bidder needs, on the morning they need them.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import type { BondIssue, Holder } from './state.ts';
import { financeState } from './state.ts';
import {
  AUCTION_CLOSE_TICK, BOND_FACE, closeDueAuctions, dailyDebtService, debtServiceCap, faceOutstanding,
  holdingsOf, issueOf, livePrice, openAuctions, outstandingIssues, portfolioValue, recordRevenueDay,
  pruneBids, openIssue, COUPON_MIN, COUPON_MAX, SIZE_MAX, SIZE_MIN,
} from './bonds.ts';
import { seizeHoldings, transferHoldings } from './secondary.ts';
import { currencyCoverage, deferIssue, mintLumens, payCoupons, redeemMatured, resolveRestructures } from './debt.ts';
import { bankState, depositOf, depositsTotal, rescueBank, setReserveRatio, vaultBalance, vaultId } from './bank.ts';
import { bankView, dailyBank } from './credit.ts';
import { dailyInsurance, insuranceView } from './insurance.ts';
import { moveThroughBox } from './box.ts';
import { leavePot, potsOf, resolvePotClaims } from './pot.ts';
import { mutualView } from './mutual.ts';

/** The coupon a `bond_issue` proposal asks for when it names only a sum. */
export const DEFAULT_COUPON = 1.5;
/** The term the same proposal takes: four cycles, which outlives two councils. */
export const DEFAULT_TERM_CYCLES = 4;

function fail(message: string): ActionResult { return { ok: false, message }; }

// ---------------------------------------------------------------------------
// The hooks
// ---------------------------------------------------------------------------

/** The auction closes at tick 14, at City Hall, where the Council is sitting. */
export function tickFinance(world: World): void {
  if (world.hour === AUCTION_CLOSE_TICK) closeDueAuctions(world);
}

/**
 * The city's finances, every morning: yesterday's takings on the record, the
 * coupons paid, anything matured redeemed, the holders' votes counted, the
 * bank settled and read, the premiums collected and the pots' claims decided.
 */
export function dailyFinance(world: World): void {
  recordRevenueDay(world);
  payCoupons(world);
  redeemMatured(world);
  resolveRestructures(world);
  dailyBank(world);
  dailyInsurance(world);
  resolvePotClaims(world);
  pruneBids(world);
  printBalanceSheet(world);
}

/** The line the Chronicle prints beside the Treasury's: what the city owes and what backs it. */
export function financeReport(world: World): string {
  const service = dailyDebtService(world);
  const cap = debtServiceCap(world);
  const coverage = currencyCoverage(world, depositsTotal(world));
  const face = outstandingIssues(world).reduce((sum, i) => sum + faceOutstanding(world, i), 0);
  return `Debt: ${formatLumens(face)} of face, ${formatLumens(service)} a day of coupons against a cap of ${formatLumens(cap)}; `
    + `coverage ${coverage.toFixed(2)}; the vault holds ${formatLumens(vaultBalance(world))} against ${formatLumens(depositsTotal(world))} of deposits.`;
}

function printBalanceSheet(world: World): void {
  const face = outstandingIssues(world).reduce((sum, i) => sum + faceOutstanding(world, i), 0);
  if (face <= 0 && depositsTotal(world) <= 0) return;
  const coverage = currencyCoverage(world, depositsTotal(world));
  emit(world, 'treasury', financeReport(world), [], coverage < 0.4 ? 0.7 : 0.2,
    { face, service: dailyDebtService(world), cap: debtServiceCap(world), coverage, vault: vaultBalance(world) });
}

// ---------------------------------------------------------------------------
// What the Council's proposals do
// ---------------------------------------------------------------------------

export type FinanceProposalKind = 'bond_issue' | 'bond_defer' | 'reserve_ratio' | 'bank_rescue' | 'mint';

export const FINANCE_PROPOSAL_KINDS: readonly FinanceProposalKind[] =
  ['bond_issue', 'bond_defer', 'reserve_ratio', 'bank_rescue', 'mint'];

/**
 * Enact a finance proposal the Council has passed. `value` is what the
 * proposal named: lumens of face for an issue, lumens for a rescue or a
 * minting, a ratio for the reserve. `override` is set when the vote carried
 * four of five, which is what the charter asks for a minting and for borrowing
 * past the cap.
 *
 * A proposal names one number, so an issue takes the founding conventions for
 * the rest: 1.5 ℓ a day for four cycles (`FINANCE.md` §1).
 */
export function enactFinanceProposal(
  world: World, kind: FinanceProposalKind, value: number, opts: { override?: boolean; proposalId?: string } = {},
): ActionResult {
  switch (kind) {
    case 'bond_issue': {
      const size = Math.round(Math.max(0, value) / BOND_FACE);
      if (size < SIZE_MIN || size > SIZE_MAX) {
        return fail(`An issue is between ${formatLumens(SIZE_MIN * BOND_FACE)} and ${formatLumens(SIZE_MAX * BOND_FACE)} of face.`);
      }
      const cycle = Math.max(1, world.config.cycleDays);
      const result = openIssue(world, {
        size, coupon: Math.min(COUPON_MAX, Math.max(COUPON_MIN, DEFAULT_COUPON)),
        termDays: cycle * DEFAULT_TERM_CYCLES, override: opts.override, proposalId: opts.proposalId ?? null,
      });
      return { ok: result.ok, message: result.message };
    }
    case 'bond_defer':
      return deferMostPressing(world);
    case 'reserve_ratio':
      return setReserveRatio(world, value > 1 ? value / 100 : value);
    case 'bank_rescue':
      return rescueBank(world, value);
    case 'mint':
      return mintLumens(world, value, 'the Council voted to mint, four of five');
    default:
      return fail('That is not a finance proposal.');
  }
}

/** The issue a deferral is for: whichever is furthest behind on its coupons. */
export function mostPressingIssue(world: World): BondIssue | null {
  const issues = outstandingIssues(world).filter((i) => i.deferrals < 2);
  if (issues.length === 0) return null;
  return issues.slice().sort((a, b) => (b.missedDays.length - a.missedDays.length) || (a.openedDay - b.openedDay))[0];
}

function deferMostPressing(world: World): ActionResult {
  const issue = mostPressingIssue(world);
  if (!issue) return fail('There is no issue the Council may defer.');
  return deferIssue(world, issue.id);
}

// ---------------------------------------------------------------------------
// When a holder leaves
// ---------------------------------------------------------------------------

/**
 * Everything this layer holds for a citizen, seized: the paper on the register
 * and the deposit in the vault, like any other asset (`FINANCE.md` §2). The
 * lumens of the deposit are real and move; the paper is a claim and is struck
 * off. Returns the face and lumens taken.
 */
export function seizeFinanceAssets(world: World, cId: CitizenId): { face: number; lumens: number } {
  const face = seizeHoldings(world, cId);
  const bank = bankState(world);
  const held = depositOf(world, cId);
  let lumens = 0;
  if (held > 0) {
    const take = Math.min(held, vaultBalance(world));
    if (take > 0 && moveThroughBox(world, vaultId(world), 'treasury', take, 'deposit', 'deposit seized on exile')) lumens = take;
    delete bank.deposits[cId];
    delete bank.interestOwed[cId];
  }
  for (const pot of potsOf(world, cId)) leavePot(world, pot.id, cId);
  return { face, lumens };
}

/** Everything this layer holds, passing to an heir: the paper and the deposit both. */
export function inheritFinanceAssets(world: World, from: CitizenId, to: CitizenId): { bonds: number; deposit: number } {
  if (from === to) return { bonds: 0, deposit: 0 };
  const bonds = transferHoldings(world, from, to);
  const bank = bankState(world);
  const held = depositOf(world, from);
  if (held > 0 && world.citizens[to]) {
    bank.deposits[to] = depositOf(world, to) + held;
    delete bank.deposits[from];
    delete bank.interestOwed[from];
  }
  for (const pot of potsOf(world, from)) leavePot(world, pot.id, from);
  return { bonds, deposit: held };
}

// ---------------------------------------------------------------------------
// What a citizen sees
// ---------------------------------------------------------------------------

export interface AuctionView {
  id: string;
  size: number;
  coupon: number;
  termDays: number;
  closesDay: number;
  /** How many bids are in the book. Sealed until the close: the count, never the prices. */
  bids: number;
}

export interface HoldingView {
  id: string;
  issueId: string;
  qty: number;
  paid: number;
  price: number;
  coupon: number;
  maturesDay: number | null;
  status: string;
}

export interface FinanceView {
  holdings: HoldingView[];
  portfolio: number;
  bank: ReturnType<typeof bankView>;
  insurance: ReturnType<typeof insuranceView>;
  mutual: ReturnType<typeof mutualView>;
  auctions: AuctionView[];
  debtService: number;
  debtServiceCap: number;
  coverage: number;
  faceOutstanding: number;
}

/** The `finance` block of the observation: every number here is public. */
export function observeFinance(world: World, cId: CitizenId): FinanceView {
  const s = financeState(world);
  const holdings: HoldingView[] = holdingsOf(world, cId).map((h) => {
    const issue = issueOf(world, h.issueId);
    return {
      id: h.id, issueId: h.issueId, qty: h.qty, paid: h.paid, price: livePrice(world, h.issueId),
      coupon: issue ? issue.coupon : 0, maturesDay: issue ? issue.maturesDay : null, status: issue ? issue.status : 'unknown',
    };
  });
  const auctions: AuctionView[] = openAuctions(world).map((i) => ({
    id: i.id, size: i.size, coupon: i.coupon, termDays: i.termDays, closesDay: i.closesDay,
    bids: s.bids.filter((b) => b.issueId === i.id).length,
  }));
  return {
    holdings,
    portfolio: portfolioValue(world, cId),
    bank: bankView(world, cId),
    insurance: insuranceView(world, cId),
    mutual: mutualView(world, cId),
    auctions,
    debtService: dailyDebtService(world),
    debtServiceCap: debtServiceCap(world),
    coverage: currencyCoverage(world, depositsTotal(world)),
    faceOutstanding: outstandingIssues(world).reduce((sum, i) => sum + faceOutstanding(world, i), 0),
  };
}

/** The same block for a business (an underwriter or a shop may hold paper too). */
export function observeBusinessFinance(world: World, holder: Holder): { holdings: HoldingView[]; portfolio: number } {
  return {
    holdings: holdingsOf(world, holder).map((h) => {
      const issue = issueOf(world, h.issueId);
      return {
        id: h.id, issueId: h.issueId, qty: h.qty, paid: h.paid, price: livePrice(world, h.issueId),
        coupon: issue ? issue.coupon : 0, maturesDay: issue ? issue.maturesDay : null, status: issue ? issue.status : 'unknown',
      };
    }),
    portfolio: portfolioValue(world, holder),
  };
}

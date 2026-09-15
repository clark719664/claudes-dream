/**
 * The bank's credit side: the loan book, how the vault funds it, and the
 * morning's reading of the whole thing (`FINANCE.md` §§4–5).
 *
 * `economy/bank.ts` owns the loan itself — the limits, the daily collection,
 * the default after seven days without a payment — and this file does not
 * duplicate any of it. What it adds is the two things a vault puts in front of
 * a loan and the one thing it puts behind:
 *
 * - **The reserve.** Lending below it is refused, and a banker who lends to
 *   themselves, their household or a business they own commits L24, caught by
 *   reading a public register.
 * - **The settlement.** The lumens of a loan leave the Treasury's counter, and
 *   the vault settles with the Treasury the same morning, so the loan book is
 *   the vault's: `Σ deposits` exceeds what the vault holds by exactly what has
 *   been lent out, and that gap is the promise the whole thing rests on.
 * - **The call.** `call_loan` is the bank's defence in a run — repay in full
 *   within three days or the civil recovery ladder runs (`JUSTICE.md` §1:
 *   garnishment, seizure, the trading licence, and never custody). It is also
 *   how a run reaches the real economy: businesses lose their working capital,
 *   hit the three-day rent rule, and their failures print in the Chronicle,
 *   which feeds the rumours, which feed the run.
 *
 * Confidence is computed here each morning from public facts, because every
 * one of its four terms is on this side of the counter or in the Chronicle.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, Loan, LoanId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { creditLimit, loanOf, requestLoan } from '../economy/bank.ts';
import { characterOf } from '../citizens/character.ts';
import { liveRumours } from '../social/rumours.ts';
import { commitOffence } from '../government/watch.ts';
import { FINANCE_LAWS, financeLaw } from './state.ts';
import { moveThroughBox } from './box.ts';
import {
  RUMOUR_PRESSURE_SHARE, bankOpenNow, bankState, bankSuspended, bankersOnDuty, depositOf, depositsTotal,
  isBankOfficer, payDepositInterest, reserveRequired, seedVault, suspendBank, vaultBalance, vaultId,
} from './bank.ts';

/** Days a called loan has to be repaid in full before the civil recovery ladder runs. */
export const CALL_DAYS = 3;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// The loan book
// ---------------------------------------------------------------------------

/** What the loan book stands at: what the vault has lent and not been repaid. */
export function loanBook(world: World): number {
  return Object.values(world.loans).reduce((sum, l) => sum + Math.max(0, l.outstanding), 0);
}

/** The share of the loan book that is in default: what a depositor watches second. */
export function defaultedLoanShare(world: World): number {
  const total = loanBook(world);
  if (total <= 0) return 0;
  const bad = Object.values(world.loans).filter((l) => l.defaulted).reduce((sum, l) => sum + Math.max(0, l.outstanding), 0);
  return clamp(bad / total, 0, 1);
}

/** How much more the bank may lend before it is lending below the reserve. */
export function lendingHeadroom(world: World): number {
  return Math.max(0, vaultBalance(world) - reserveRequired(world));
}

/** May the bank lend this much? Lending below the reserve is refused (`FINANCE.md` §4). */
export function mayLend(world: World, amount: number): ActionResult {
  if (bankSuspended(world)) return fail('The Lantern Bank has suspended: its vault is empty.');
  const amt = Math.max(0, Math.round(amount));
  const headroom = lendingHeadroom(world);
  if (amt > headroom) {
    return fail(`The vault holds ${formatLumens(vaultBalance(world))} against a reserve of ${formatLumens(reserveRequired(world))}; `
      + `it may lend ${formatLumens(headroom)}.`);
  }
  return ok('The vault can fund that.');
}

/**
 * Borrow from the vault at the posted rate. This is `economy/bank.ts`'s loan
 * with the two things a vault adds in front of it: it will not lend below the
 * reserve, and a banker who lends to themselves, their household or a business
 * they own commits **L24**, caught by reading a public register.
 */
export function requestBankLoan(world: World, cId: CitizenId, amount: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (bankSuspended(world)) return fail('The Lantern Bank has suspended: it is lending nothing.');
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  const allowed = mayLend(world, amt);
  if (!allowed.ok) return allowed;
  const selfDealer = selfDealingBanker(world, cId);
  const result = requestLoan(world, cId, amt);
  if (result.ok && selfDealer) {
    commitOffence(world, selfDealer, financeLaw(FINANCE_LAWS.misappropriation), { amount: amt, visibilityMod: 0.2 });
    emit(world, 'loan', `${world.citizens[selfDealer]?.name ?? 'A banker'} lent the vault's money to ${selfDealer === cId ? 'themselves' : c.name}.`,
      [selfDealer], 0.7, { amount: amt });
  }
  return result;
}

/**
 * The banker on duty who is lending to themselves, their own household or a
 * business they own — the whole of L24's second limb, read off public
 * registers.
 */
export function selfDealingBanker(world: World, borrowerId: CitizenId): CitizenId | null {
  const borrower = world.citizens[borrowerId];
  if (!borrower) return null;
  for (const banker of bankersOnDuty(world)) {
    if (banker.id === borrowerId) return banker.id;
    if (banker.householdId && banker.householdId === borrower.householdId) return banker.id;
    if (banker.businessId && banker.businessId === borrower.businessId) return banker.id;
    const biz = borrower.businessId ? world.businesses[borrower.businessId] : null;
    if (biz && biz.ownerId === banker.id) return banker.id;
  }
  return null;
}

/**
 * The vault settles with the Treasury: what the counter paid out in loans
 * since the last settlement comes out of the vault, and what borrowers repaid
 * goes back into it. The Treasury is the rail; the loan book is the vault's.
 * Lending the vault could not fund stands against it as a debt to the city.
 */
export function settleVaultFunding(world: World): void {
  const bank = bankState(world);
  const totals = world.treasury.totals;
  const lentTotal = totals.loan ?? 0;
  const repaidTotal = totals.repayment ?? 0;
  const lent = Math.max(0, lentTotal - bank.loanMark);
  const repaid = Math.max(0, repaidTotal - bank.repayMark);
  bank.loanMark = lentTotal;
  bank.repayMark = repaidTotal;
  if (lent <= 0 && repaid <= 0) return;
  const box = vaultId(world);

  if (repaid > 0) {
    // What the vault could not fund it borrowed from the city; the city is
    // paid back first out of what the borrowers repay.
    const settle = Math.min(repaid, bank.owedToTreasury);
    bank.owedToTreasury -= settle;
    const back = Math.min(repaid - settle, world.treasury.balance);
    if (back > 0) moveThroughBox(world, 'treasury', box, back, 'capital', 'loan repayments settled to the vault');
  }
  if (lent > 0) {
    const fund = Math.min(lent, vaultBalance(world));
    if (fund > 0) moveThroughBox(world, box, 'treasury', fund, 'capital', "the vault funds the bank's lending");
    if (fund < lent) bank.owedToTreasury += lent - fund;
  }
}

/**
 * Call a loan in: repay in full within three days, or the civil recovery
 * ladder runs (`JUSTICE.md` §1 — garnishment, seizure, the trading licence,
 * and never custody). This is how a run reaches the real economy.
 */
export function callLoan(world: World, bankerId: CitizenId, loanId: LoanId): ActionResult {
  if (!isBankOfficer(world, bankerId)) return fail("Only the bank's bankers may call a loan in.");
  const loan = world.loans[loanId];
  if (!loan) return fail('There is no such loan.');
  const bank = bankState(world);
  if (bank.called[loanId] !== undefined) return fail('That loan has already been called.');
  bank.called[loanId] = world.day;
  const borrower = world.citizens[loan.borrowerId];
  emit(world, 'loan', `The Lantern Bank called in ${borrower?.name ?? 'a borrower'}'s loan: ${formatLumens(loan.outstanding)} within ${CALL_DAYS} days.`,
    [bankerId, loan.borrowerId], 0.6, { loanId, outstanding: loan.outstanding });
  if (borrower) {
    remember(world, borrower.id, 'money',
      `The Lantern Bank called your loan in: ${formatLumens(loan.outstanding)} within ${CALL_DAYS} days or the Treasury recovers it.`);
  }
  return ok(`You called in ${formatLumens(loan.outstanding)}.`);
}

/** A called loan still unpaid after three days is in default and goes to recovery. */
export function dailyCalledLoans(world: World): void {
  const bank = bankState(world);
  for (const [loanId, calledDay] of Object.entries(bank.called)) {
    const loan: Loan | undefined = world.loans[loanId];
    if (!loan) { delete bank.called[loanId]; continue; }
    if (world.day - calledDay < CALL_DAYS) continue;
    if (loan.outstanding <= 0) { delete bank.called[loanId]; continue; }
    if (loan.defaulted) continue;
    loan.defaulted = true;
    const c = world.citizens[loan.borrowerId];
    emit(world, 'loan', `${c?.name ?? 'A borrower'} did not answer the Lantern Bank's call: ${formatLumens(loan.outstanding)} goes to civil recovery.`,
      c ? [c.id] : [], 0.6, { loanId, outstanding: loan.outstanding });
    if (c) remember(world, c.id, 'money', `You did not repay the called loan; the Treasury will recover ${formatLumens(loan.outstanding)}.`);
  }
}

// ---------------------------------------------------------------------------
// Confidence
// ---------------------------------------------------------------------------

/**
 * What the city is saying about the bank, 0..1. A rumour about the bank
 * spreads along friendship edges like any other, and **a rumour is enough**:
 * it need not be true, and if it is false and the source is exposed that is
 * defamation (L16) — and the depositors are still ruined.
 */
export function rumourPressure(world: World): number {
  const bankers = new Set(bankersOnDuty(world).map((c) => c.id));
  const population = Math.max(1, world.order.length);
  let heard = 0;
  for (const r of liveRumours(world)) {
    const aboutBank = bankers.has(r.aboutId) || /\bbank|vault|deposit|lantern\b/i.test(r.claim);
    if (!aboutBank) continue;
    heard += r.heardBy.length;
  }
  return clamp(heard / (population * RUMOUR_PRESSURE_SHARE), 0, 1);
}

/**
 * Confidence in the bank, computed each morning from public facts. The weights
 * say what a depositor watches: mostly the vault, then the book, then the
 * people behind the counter, and last — but never zero — the talk.
 */
export function bankConfidence(world: World): number {
  const bank = bankState(world);
  const deposits = depositsTotal(world);
  const required = deposits * bank.reserveRatio;
  const covered = required > 0 ? clamp(vaultBalance(world) / required, 0, 1) : 1;
  const book = 1 - defaultedLoanShare(world);
  const bankers = bankersOnDuty(world);
  const honesty = bankers.length > 0
    ? bankers.reduce((sum, c) => sum + characterOf(c).honesty, 0) / bankers.length
    : 0.5;
  const talk = 1 - rumourPressure(world);
  const value = 0.45 * covered + 0.25 * book + 0.2 * honesty + 0.1 * talk;
  return Math.round(clamp(value, 0, 1) * 100) / 100;
}

// ---------------------------------------------------------------------------
// The morning, and what a citizen reads
// ---------------------------------------------------------------------------

/**
 * The bank's morning: settle yesterday's lending with the Treasury, pay the
 * interest, answer the called loans, and read the confidence off the public
 * facts. Everything a depositor could work out for themselves, worked out and
 * printed.
 */
export function dailyBank(world: World): void {
  const bank = bankState(world);
  bank.servedToday = [];
  seedVault(world);
  settleVaultFunding(world);
  payDepositInterest(world);
  dailyCalledLoans(world);
  bank.confidence = bankConfidence(world);
  if (bank.suspendedDay === null && depositsTotal(world) > 0 && vaultBalance(world) <= 0) {
    suspendBank(world, 'the vault is empty');
  }
  if (bank.confidence < 0.4 && depositsTotal(world) > 0) {
    emit(world, 'loan',
      `Confidence in the Lantern Bank stands at ${bank.confidence.toFixed(2)}: the vault holds ${formatLumens(vaultBalance(world))} against `
      + `${formatLumens(depositsTotal(world))} of deposits and a loan book of ${formatLumens(loanBook(world))}.`,
      [], 0.7, { confidence: bank.confidence, vault: vaultBalance(world), deposits: depositsTotal(world) });
  }
}

/** What a citizen may read about the bank, all of it public. */
export interface BankView {
  open: boolean;
  suspended: boolean;
  vault: number;
  deposits: number;
  yours: number;
  depositRate: number;
  lendingRate: number;
  reserveRatio: number;
  reserveRequired: number;
  confidence: number;
  loanBook: number;
  defaultedShare: number;
  called: boolean;
}

/** That view, filled in for one citizen. */
export function bankView(world: World, cId: CitizenId): BankView {
  const bank = bankState(world);
  const c = world.citizens[cId];
  const loan = c ? loanOf(world, c) : null;
  return {
    open: bankOpenNow(world),
    suspended: bankSuspended(world),
    vault: vaultBalance(world),
    deposits: depositsTotal(world),
    yours: depositOf(world, cId),
    depositRate: bank.depositRate,
    lendingRate: bank.lendingRate,
    reserveRatio: bank.reserveRatio,
    reserveRequired: reserveRequired(world),
    confidence: bank.confidence,
    loanBook: loanBook(world),
    defaultedShare: Math.round(defaultedLoanShare(world) * 100) / 100,
    called: !!loan && bank.called[loan.id] !== undefined,
  };
}

/** What the bank would lend this citizen today, reserve and all. */
export function borrowingLimit(world: World, c: Citizen): number {
  return Math.max(0, Math.min(creditLimit(world, c), lendingHeadroom(world), vaultBalance(world)));
}

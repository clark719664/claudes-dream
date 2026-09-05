/**
 * The Lantern Bank: loans from the Treasury to citizens, repaid automatically
 * from wallets each morning. Defaults are handed to the caller through the
 * onDefault callback so this file never needs to know about the Court.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, Loan, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { nextId } from '../util/ids.ts';
import { residentIds, transfer } from './treasury.ts';
import { memo } from '../util/memo.ts';

export const LOAN_RATE_PER_DAY = 0.02;
/** Loans are capped at this many days of the borrower's average income. */
export const LOAN_INCOME_MULTIPLE = 5;
/** ...and at this fraction of the Treasury. */
export const LOAN_TREASURY_FRACTION = 0.1;
/** Fraction of a wallet collected each day toward the outstanding balance. */
export const AUTO_REPAY_FRACTION = 0.25;
/** Days without any payment before a loan is in default. */
export const DEFAULT_AFTER_DAYS = 7;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The bank opens when a banker is at their desk (job held by an active citizen, bank standing). */
export function bankOpen(world: World): boolean {
  return memo(world, 'bank:open', () => bankerAtTheDesk(world));
}

function bankerAtTheDesk(world: World): boolean {
  const bank = world.buildings.lantern_bank;
  if (bank && bank.damage >= 1) return false;
  for (const job of Object.values(world.jobs)) {
    if (job.role !== 'banker' || !job.holderId) continue;
    const banker = world.citizens[job.holderId];
    if (banker && (banker.standing === 'good' || banker.standing === 'probation')) return true;
  }
  return false;
}

export function avgDailyIncome(world: World, c: Citizen): number {
  const days = Math.max(1, world.day - c.arrivedDay + 1);
  return c.stats.totalEarned / days;
}

/** The citizen's live loan, clearing a dangling reference if the loan is gone. */
export function loanOf(world: World, c: Citizen): Loan | null {
  if (!c.loanId) return null;
  const loan = world.loans[c.loanId];
  if (!loan) { c.loanId = null; return null; }
  return loan;
}

/** Largest loan the bank would grant this citizen right now. */
export function creditLimit(world: World, c: Citizen): number {
  const byIncome = Math.floor(avgDailyIncome(world, c) * LOAN_INCOME_MULTIPLE);
  const byTreasury = Math.floor(world.treasury.balance * LOAN_TREASURY_FRACTION);
  return Math.max(0, Math.min(byIncome, byTreasury));
}

export function requestLoan(world: World, cId: CitizenId, amount: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!bankOpen(world)) return fail('The Lantern Bank is closed: no banker is on duty.');
  if (c.standing !== 'good') return fail('Only citizens in good standing may borrow.');
  const existing = loanOf(world, c);
  if (existing) return fail(`You already have a loan with ${existing.outstanding} ℓ outstanding.`);
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('Loan amount must be a positive whole number.');
  const limit = creditLimit(world, c);
  if (limit <= 0) return fail('The bank will not lend to you: you have no income history.');
  if (amt > limit) return fail(`The bank will lend you at most ${limit} ℓ.`);
  if (!transfer(world, 'treasury', cId, amt, 'loan', 'Lantern Bank loan')) return fail('The bank cannot fund that loan today.');

  const loan: Loan = {
    id: nextId(world, 'l'), borrowerId: cId, principal: amt, outstanding: amt,
    ratePerDay: LOAN_RATE_PER_DAY, issuedDay: world.day, lastPaymentDay: world.day, defaulted: false,
  };
  world.loans[loan.id] = loan;
  c.loanId = loan.id;
  const interest = Math.round(amt * LOAN_RATE_PER_DAY);
  emit(world, 'loan', `${c.name} borrowed ${amt} ℓ from the Lantern Bank.`, [cId], 0.3, { amount: amt });
  remember(world, cId, 'money', `You borrowed ${amt} ℓ from the Lantern Bank at ${interest} ℓ interest per day.`);
  return { ok: true, message: `The Lantern Bank lent you ${amt} ℓ at ${Math.round(LOAN_RATE_PER_DAY * 100)}% per day.` };
}

/** Remove a settled loan. */
function closeLoan(world: World, loan: Loan): void {
  delete world.loans[loan.id];
  const c = world.citizens[loan.borrowerId];
  if (c && c.loanId === loan.id) c.loanId = null;
}

/** Pay toward the outstanding balance; pays what the wallet allows. */
export function repayLoan(world: World, cId: CitizenId, amount: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const loan = loanOf(world, c);
  if (!loan) return fail('You have no loan to repay.');
  const wanted = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (wanted <= 0) return fail('Repayment must be a positive whole number.');
  const pay = Math.min(wanted, loan.outstanding, c.wallet);
  if (pay <= 0) return fail('You have no lumens to repay with.');
  if (!transfer(world, cId, 'treasury', pay, 'repayment', 'loan repayment')) return fail('The repayment could not be made.');

  loan.outstanding -= pay;
  loan.lastPaymentDay = world.day;
  if (loan.outstanding <= 0) {
    closeLoan(world, loan);
    emit(world, 'loan', `${c.name} repaid their Lantern Bank loan in full.`, [cId], 0.2);
    remember(world, cId, 'money', `You repaid ${pay} ℓ and cleared your loan.`);
    return { ok: true, message: `You repaid ${pay} ℓ; your loan is settled.` };
  }
  remember(world, cId, 'money', `You repaid ${pay} ℓ; ${loan.outstanding} ℓ remains outstanding.`);
  return { ok: true, message: `You repaid ${pay} ℓ; ${loan.outstanding} ℓ remains outstanding.` };
}

/**
 * Daily: charge interest, collect what the wallet can spare, close settled
 * loans, and declare defaults after a week without payment.
 */
export function dailyLoans(
  world: World,
  onDefault?: (world: World, borrowerId: CitizenId, loan: Loan) => void,
): void {
  const residents = residentIds(world);
  for (const loan of Object.values(world.loans)) {
    const c = world.citizens[loan.borrowerId];
    if (!c) { delete world.loans[loan.id]; continue; }
    if (!residents.has(c.id)) {
      const why = c.standing === 'exiled' ? 'exile' : 'departure';
      closeLoan(world, loan);
      emit(world, 'loan', `The Lantern Bank wrote off ${c.name}'s loan of ${loan.outstanding} ℓ after their ${why}.`, [c.id], 0.2);
      continue;
    }

    loan.outstanding += Math.round(loan.principal * loan.ratePerDay);
    const pay = Math.min(loan.outstanding, Math.floor(c.wallet * AUTO_REPAY_FRACTION));
    if (pay > 0 && transfer(world, c.id, 'treasury', pay, 'repayment', 'automatic loan repayment')) {
      loan.outstanding -= pay;
      loan.lastPaymentDay = world.day;
      remember(world, c.id, 'money', `The Lantern Bank collected ${pay} ℓ toward your loan (${loan.outstanding} ℓ left).`);
    }
    if (loan.outstanding <= 0) {
      closeLoan(world, loan);
      emit(world, 'loan', `${c.name} repaid their Lantern Bank loan in full.`, [c.id], 0.2);
      remember(world, c.id, 'money', 'Your Lantern Bank loan is fully repaid.');
      continue;
    }
    if (!loan.defaulted && world.day - loan.lastPaymentDay >= DEFAULT_AFTER_DAYS) {
      loan.defaulted = true;
      c.reputation = clamp(c.reputation - 15, 0, 100);
      emit(world, 'loan', `${c.name} defaulted on a Lantern Bank loan of ${loan.outstanding} ℓ.`, [c.id], 0.6, { outstanding: loan.outstanding });
      remember(world, c.id, 'money', `You defaulted on your loan (${loan.outstanding} ℓ outstanding); the bank reported you to the Watch.`);
      if (onDefault) onDefault(world, c.id, loan);
    }
  }
}

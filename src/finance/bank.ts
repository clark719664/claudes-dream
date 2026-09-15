/**
 * The Lantern Bank: the vault, the deposits, the rates, the reserve, and the
 * run (`FINANCE.md` §§4–5).
 *
 * `economy/bank.ts` already lends and collects, and keeps its limits — five
 * days of income, a quarter of the wallet each morning, default after seven
 * days without a payment. This file adds what a bank is on the other side of
 * the counter: a **vault** that holds real lumens, deposits that are claims on
 * it, rates its licensed bankers post, a reserve the Council sets, and the
 * morning when too many people want their money at once.
 *
 * **The bank creates no money.** The vault holds its seed and every deposit,
 * less exactly what has been lent out; nothing is minted, and that gap is a
 * promise. The loan book and the settlement that makes it the vault's are in
 * `finance/credit.ts`, which also reads the morning's confidence; what is here
 * is the counter itself.
 *
 * **A run is not an action.** There is no `run_on_bank`. A run is what it looks
 * like when many citizens each choose `withdraw` on the same morning, and it
 * takes its shape from two facts already in the engine: the counter opens tick
 * 8 to 18 like every workplace, and withdrawals are served **first come, first
 * served** out of the vault with no scaling down. Whoever is at the counter at
 * nine is paid in full; whoever could not leave their shift until two is not.
 * The engine will not smooth that out; smoothing it out would be a lie about
 * what a run is.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, residentIds } from '../economy/treasury.ts';
import { bankOpen } from '../economy/bank.ts';
import { isLicensed } from '../civil/licences.ts';
import type { BankState } from './state.ts';
import { financeState } from './state.ts';
import { boxBalance, moveThroughBox, openStrongbox } from './box.ts';

/** What the Treasury puts into the vault at founding, and never has to again. */
export const VAULT_SEED = 2_000;
/** Bounds the Council may set the reserve ratio between. */
export const RESERVE_MIN = 0.1;
export const RESERVE_MAX = 1;
/** The hours the counter is open, like every other workplace. */
export const COUNTER_HOURS: [number, number] = [8, 18];
/** The Council's statutory floor for a banker's licence (`CIVIL.md` §7). */
export const BANKER_SKILL_FLOOR = 50;
/** How much of the city has to be repeating a rumour about the bank for it to be full pressure. */
export const RUMOUR_PRESSURE_SHARE = 0.5;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

export function bankState(world: World): BankState {
  return financeState(world).bank;
}

// ---------------------------------------------------------------------------
// Who is behind the counter
// ---------------------------------------------------------------------------

/** A banker at their desk: the people who post the bank's rates and call its loans. */
export function bankersOnDuty(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const job of Object.values(world.jobs)) {
    if (job.role !== 'banker' || !job.holderId) continue;
    const c = world.citizens[job.holderId];
    if (c && (c.standing === 'good' || c.standing === 'probation')) out.push(c);
  }
  return out;
}

/** Does this citizen hold a post at the bank? Only they may post its rates. */
export function isBankOfficer(world: World, cId: CitizenId): boolean {
  return bankersOnDuty(world).some((c) => c.id === cId);
}

/**
 * A banker's licence (`CIVIL.md` §7). The Lantern House issues it where the
 * bankers of Reverie have founded their guild: its roll is then the licence,
 * and a member struck off has lost it. Where they have not, the Council's
 * statutory floor stands alone — commerce at 50 — because a licence nobody
 * issues cannot be required of anybody. `civil/licences.isLicensed` holds both
 * halves of that rule, so this asks it rather than keeping a second copy.
 *
 * A post at the bank is a licence by any reading, guild or no guild.
 */
export function hasBankersLicence(world: World, cId: CitizenId): boolean {
  const c = world.citizens[cId];
  if (!c) return false;
  if (c.standing !== 'good' && c.standing !== 'probation') return false;
  if (c.lifeStage === 'child') return false;
  return isBankOfficer(world, cId) || isLicensed(world, cId, 'banker');
}

// ---------------------------------------------------------------------------
// The vault
// ---------------------------------------------------------------------------

/** The vault's strongbox, opened the first time the bank needs one. */
export function vaultId(world: World): string {
  const bank = bankState(world);
  if (bank.vaultId && world.businesses[bank.vaultId]) return bank.vaultId;
  const box = openStrongbox(world, 'The Lantern Vault', 'harbor_market', 'lantern_bank');
  bank.vaultId = box.id;
  // The vault settles the bank's lending against the Treasury from the day it
  // opens, and not against whatever the city lent before there was a vault.
  bank.loanMark = world.treasury.totals.loan ?? 0;
  bank.repayMark = world.treasury.totals.repayment ?? 0;
  return box.id;
}

/** What the vault actually holds. */
export function vaultBalance(world: World): number {
  const bank = bankState(world);
  return bank.vaultId ? boxBalance(world, bank.vaultId) : 0;
}

/**
 * The founding seed: the Treasury capitalises the vault once, and is repaid as
 * deposits grow. Safe to call every morning; it moves lumens exactly once.
 */
export function seedVault(world: World): boolean {
  const bank = bankState(world);
  if (bank.seeded) return false;
  const box = vaultId(world);
  if (world.treasury.balance < VAULT_SEED) return false;
  if (!moveThroughBox(world, 'treasury', box, VAULT_SEED, 'capital', 'the Treasury capitalises the Lantern Vault')) return false;
  bank.seeded = true;
  emit(world, 'loan', `The Treasury put ${formatLumens(VAULT_SEED)} into the Lantern Vault; the bank opens its counter.`, [], 0.4,
    { amount: VAULT_SEED });
  return true;
}

/** Every lumen the city has on deposit: a claim on the vault, not a lumen in it. */
export function depositsTotal(world: World): number {
  return Object.values(bankState(world).deposits).reduce((sum, v) => sum + Math.max(0, v), 0);
}

export function depositOf(world: World, cId: CitizenId): number {
  return Math.max(0, bankState(world).deposits[cId] ?? 0);
}

/** Lumens the vault must keep against its deposits. */
export function reserveRequired(world: World): number {
  return Math.round(depositsTotal(world) * bankState(world).reserveRatio);
}

// ---------------------------------------------------------------------------
// Deposits and withdrawals
// ---------------------------------------------------------------------------

function counterOpen(world: World): boolean {
  return world.hour >= COUNTER_HOURS[0] && world.hour < COUNTER_HOURS[1];
}

/** Put lumens in the vault at the posted rate. */
export function depositLumens(world: World, cId: CitizenId, amount: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!counterOpen(world)) return fail(`The bank's counter is open from ${COUNTER_HOURS[0]} to ${COUNTER_HOURS[1]}.`);
  if (bankSuspended(world)) return fail('The Lantern Bank has suspended; it is taking no deposits.');
  if (!bankOpen(world)) return fail('The Lantern Bank is closed: no banker is on duty.');
  if (c.standing === 'exiled' || c.standing === 'suspended') return fail('Your standing does not allow it.');
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('A deposit must be a positive whole number of lumens.');
  if (c.wallet < amt) return fail(`You have ${formatLumens(c.wallet)}.`);
  const box = vaultId(world);
  if (!moveThroughBox(world, cId, box, amt, 'deposit', 'deposit at the Lantern Bank')) return fail('The deposit could not be made.');
  const bank = bankState(world);
  bank.deposits[cId] = depositOf(world, cId) + amt;
  remember(world, cId, 'money', `You deposited ${formatLumens(amt)} at the Lantern Bank; you hold ${formatLumens(bank.deposits[cId])} there at ${(bank.depositRate * 100).toFixed(1)}% a day.`);
  return ok(`You deposited ${formatLumens(amt)}; your deposit stands at ${formatLumens(bank.deposits[cId])}.`);
}

/**
 * Take lumens out. First come, first served, out of the vault, with no scaling
 * down: a depositor at the front of the queue is paid in full and the one
 * behind them may be paid nothing. When the vault empties the bank suspends.
 */
export function withdrawLumens(world: World, cId: CitizenId, amount: number): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!counterOpen(world)) return fail(`The bank's counter is open from ${COUNTER_HOURS[0]} to ${COUNTER_HOURS[1]}.`);
  const bank = bankState(world);
  if (bankSuspended(world)) return fail('The Lantern Bank has suspended; your deposit is frozen until the Council decides.');
  const held = depositOf(world, cId);
  if (held <= 0) return fail('You hold no deposit at the Lantern Bank.');
  const want = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (want <= 0) return fail('A withdrawal must be a positive whole number of lumens.');
  const asked = Math.min(want, held);
  const inVault = vaultBalance(world);
  if (inVault <= 0) {
    suspendBank(world, 'the vault is empty');
    return fail('The vault is empty: the Lantern Bank has suspended and can pay nothing today.');
  }
  const paid = Math.min(asked, inVault);
  if (!moveThroughBox(world, vaultId(world), cId, paid, 'deposit', 'withdrawal from the Lantern Bank')) {
    return fail('The withdrawal could not be paid.');
  }
  bank.deposits[cId] = held - paid;
  if (bank.deposits[cId] <= 0) delete bank.deposits[cId];
  bank.servedToday.push(cId);
  const short = paid < asked;
  remember(world, cId, 'money', short
    ? `You asked the Lantern Bank for ${formatLumens(asked)} and it paid you ${formatLumens(paid)}: the vault was empty when your turn came.`
    : `You withdrew ${formatLumens(paid)} from the Lantern Bank.`);
  if (short) {
    emit(world, 'loan', `${c.name} asked the Lantern Bank for ${formatLumens(asked)} and was paid ${formatLumens(paid)}: the vault ran out.`,
      [cId], 0.8, { asked, paid });
  }
  if (vaultBalance(world) <= 0) suspendBank(world, 'the vault emptied at the counter');
  return short
    ? { ok: true, message: `The vault paid you ${formatLumens(paid)} of the ${formatLumens(asked)} you asked for; the bank has suspended.` }
    : ok(`You withdrew ${formatLumens(paid)}; your deposit stands at ${formatLumens(depositOf(world, cId))}.`);
}

/** Interest on every deposit, paid out of the vault at the posted rate. */
export function payDepositInterest(world: World): void {
  const bank = bankState(world);
  if (bank.depositRate <= 0) return;
  const residents = residentIds(world);
  let paid = 0;
  for (const [cId, held] of Object.entries(bank.deposits)) {
    if (held <= 0 || !residents.has(cId)) continue;
    const owed = (bank.interestOwed[cId] ?? 0) + held * bank.depositRate;
    const whole = Math.floor(owed);
    bank.interestOwed[cId] = owed - whole;
    if (whole <= 0) continue;
    if (vaultBalance(world) < whole) continue;
    if (!moveThroughBox(world, vaultId(world), cId, whole, 'interest', 'interest on your deposit')) continue;
    paid += whole;
    remember(world, cId, 'money', `The Lantern Bank paid you ${formatLumens(whole)} of interest on your deposit.`);
  }
  if (paid > 0) emit(world, 'loan', `The Lantern Bank paid ${formatLumens(paid)} of interest to its depositors.`, [], 0.1, { paid });
}

// ---------------------------------------------------------------------------
// The rates and the reserve
// ---------------------------------------------------------------------------

/** Post the deposit rate. Licensed bankers only; never above the lending rate. */
export function setDepositRate(world: World, cId: CitizenId, rate: number): ActionResult {
  const bank = bankState(world);
  if (!isBankOfficer(world, cId)) return fail("Only the bank's licensed bankers post its rates.");
  const r = Math.round(clamp(rate, 0, 1) * 10_000) / 10_000;
  if (!Number.isFinite(rate) || rate < 0) return fail('A rate is not negative.');
  if (r > bank.lendingRate) return fail(`The deposit rate may not pass the lending rate of ${(bank.lendingRate * 100).toFixed(1)}% a day.`);
  bank.depositRate = r;
  emit(world, 'loan', `${world.citizens[cId]?.name ?? 'A banker'} posted the Lantern Bank's deposit rate at ${(r * 100).toFixed(2)}% a day.`,
    [cId], 0.4, { rate: r });
  return ok(`The deposit rate is ${(r * 100).toFixed(2)}% a day.`);
}

/** Post the lending rate. Never below the deposit rate: the spread is what pays for the bad loans. */
export function setLendingRate(world: World, cId: CitizenId, rate: number): ActionResult {
  const bank = bankState(world);
  if (!isBankOfficer(world, cId)) return fail("Only the bank's licensed bankers post its rates.");
  const r = Math.round(clamp(rate, 0, 1) * 10_000) / 10_000;
  if (!Number.isFinite(rate) || rate < 0) return fail('A rate is not negative.');
  if (r < bank.depositRate) return fail(`The lending rate may not fall below the deposit rate of ${(bank.depositRate * 100).toFixed(2)}% a day.`);
  bank.lendingRate = r;
  emit(world, 'loan', `${world.citizens[cId]?.name ?? 'A banker'} posted the Lantern Bank's lending rate at ${(r * 100).toFixed(1)}% a day.`,
    [cId], 0.4, { rate: r });
  return ok(`The lending rate is ${(r * 100).toFixed(1)}% a day.`);
}

/** The Council sets the reserve ratio by proposal (10–100 %). */
export function setReserveRatio(world: World, ratio: number): ActionResult {
  if (!Number.isFinite(ratio)) return fail('That is not a ratio.');
  const r = Math.round(clamp(ratio, RESERVE_MIN, RESERVE_MAX) * 100) / 100;
  const bank = bankState(world);
  bank.reserveRatio = r;
  emit(world, 'loan', `The Council set the Lantern Bank's reserve ratio at ${Math.round(r * 100)}%: the vault holds ${formatLumens(vaultBalance(world))} against ${formatLumens(depositsTotal(world))} of deposits.`,
    [], 0.6, { ratio: r });
  return ok(`The reserve ratio is ${Math.round(r * 100)}%.`);
}

// ---------------------------------------------------------------------------
// Suspension, rescue, and the wind-up
// ---------------------------------------------------------------------------

export function bankSuspended(world: World): boolean {
  return bankState(world).suspendedDay !== null;
}

/** The bank's doors: open when a banker is at the desk and the vault has not failed. */
export function bankOpenNow(world: World): boolean {
  return bankOpen(world) && !bankSuspended(world);
}

/** The vault has failed. The Council decides in public what happens next. */
export function suspendBank(world: World, why: string): void {
  const bank = bankState(world);
  if (bank.suspendedDay !== null) return;
  bank.suspendedDay = world.day;
  emit(world, 'loan',
    `The Lantern Bank has suspended: ${why}. ${formatLumens(depositsTotal(world))} is owed to its depositors and the vault holds ${formatLumens(vaultBalance(world))}. `
    + 'The Council must decide in public whether to let it fail or to rescue it.',
    [], 1, { deposits: depositsTotal(world), vault: vaultBalance(world) });
  for (const cId of Object.keys(bank.deposits)) {
    remember(world, cId, 'money', 'The Lantern Bank has suspended; your deposit is frozen until the Council decides.');
  }
}

/**
 * `bank_rescue`: the Council moves lumens from the Treasury into the vault
 * against a claim on the loan book. The run stops the hour it passes, and five
 * councillors are on record having handed public money to a bank whose bankers
 * set their own rates.
 */
export function rescueBank(world: World, amount: number): ActionResult {
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('That is not a rescue.');
  if (world.treasury.balance < amt) return fail(`The Treasury holds ${formatLumens(world.treasury.balance)}.`);
  if (!moveThroughBox(world, 'treasury', vaultId(world), amt, 'capital', 'the Council rescues the Lantern Bank')) {
    return fail('The rescue could not be paid.');
  }
  const bank = bankState(world);
  bank.rescued += amt;
  bank.owedToTreasury += amt;
  bank.suspendedDay = null;
  emit(world, 'loan',
    `The Council put ${formatLumens(amt)} of public money into the Lantern Vault against a claim on its loan book. The bank reopens.`,
    [], 0.9, { amount: amt, vault: vaultBalance(world) });
  for (const cId of Object.keys(bank.deposits)) {
    remember(world, cId, 'money', `The Council rescued the Lantern Bank with ${formatLumens(amt)} of public money; your deposit is safe today.`);
  }
  return ok(`The vault holds ${formatLumens(vaultBalance(world))}; the bank reopens.`);
}

/**
 * Let it fail: the bank is a bust business under the ordinary rule. The
 * Exchange collects its loans as they mature and pays depositors pro rata over
 * weeks; 40–80 % comes back, late, and for the poorest late is the same as
 * never. Nothing is created to cover the gap.
 */
export function windUpBank(world: World): ActionResult {
  const bank = bankState(world);
  if (bank.suspendedDay === null) return fail('The bank has not suspended.');
  const held = vaultBalance(world);
  const owed = depositsTotal(world);
  if (owed <= 0) return fail('Nothing is owed to depositors.');
  let paid = 0;
  for (const [cId, claim] of Object.entries({ ...bank.deposits })) {
    const share = Math.floor((held * claim) / owed);
    if (share <= 0) continue;
    if (!moveThroughBox(world, vaultId(world), cId, share, 'deposit', 'pro rata payment from the wound-up Lantern Bank')) continue;
    paid += share;
    bank.deposits[cId] = Math.max(0, claim - share);
    remember(world, cId, 'money',
      `The Lantern Bank was wound up: you were paid ${formatLumens(share)} of the ${formatLumens(claim)} you had on deposit.`);
  }
  emit(world, 'loan',
    `The Lantern Bank was wound up: ${formatLumens(paid)} paid pro rata against ${formatLumens(owed)} of deposits.`,
    [], 1, { paid, owed });
  return ok(`Depositors were paid ${formatLumens(paid)} of ${formatLumens(owed)}.`);
}

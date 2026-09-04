/**
 * **Civil recovery** — how the city collects what it is owed, and how far it
 * is allowed to go.
 *
 * The Charter is flat about it (Article VI): *no citizen may be imprisoned,
 * exiled or suspended for debt.* An unpaid fine is not a crime, and poverty is
 * not defiance. So the Treasury has a ladder of its own, and it is a civil
 * one (`docs/JUSTICE.md` §1, "Debt is not a crime"):
 *
 * ```
 * 1  garnishment  25 % of every wage, until the debt clears
 * 2  seizure      possessions sold at the Bazaar, then business stock
 * 3  licence      a business owner loses the right to trade until settled
 * 4  contempt     L10 — and only after 14 days of wilful non-payment by a
 *                 citizen who demonstrably CAN pay
 * ```
 *
 * Everything above the wage is a *thing*, not a person: the city takes goods,
 * stock and a licence, never liberty and never citizenship. A citizen who
 * genuinely cannot pay is not punished further at all — the debt stands
 * against future income, and the Community Chest may clear it.
 *
 * Contempt is the one rung that is a charge, and it is a charge for
 * **defiance**, not for being poor: `ableToPay` has to be true, and the charge
 * goes through the caller's handler so this file never imports the Court
 * (`government/court.ts` passes one, as `economy/bank.ts` does for defaults).
 */
import { GOODS } from '../types.ts';
import type { ActionResult, Business, Case, CaseId, Citizen, CitizenId, World } from '../types.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens, transfer } from '../economy/treasury.ts';
import { marketPrice, sellToMarket } from '../economy/market.ts';
import { latestConviction } from './cases.ts';
import { finePaidKey, restitutionAmountKey, restitutionPaidKey, strikeStruckKey } from './sentencing.ts';

/** The marks this file writes on the world and `government/sentencing.ts` reads back. */
export { restitutionAmountKey, restitutionPaidKey, strikeStruckKey } from './sentencing.ts';

/** The share of every wage the Treasury may take while a debt stands. */
export const GARNISHMENT_SHARE = 0.25;
/** Days of debt before the bailiffs sell what the debtor owns. */
export const SEIZURE_AFTER_DAYS = 3;
/** Days of debt before a business owner's stock goes too. */
export const STOCK_AFTER_DAYS = 5;
/** Days of debt before the trading licence is suspended. */
export const LICENCE_AFTER_DAYS = 7;
/** Days of *wilful* non-payment before Contempt of court (L10) is charged. */
export const CONTEMPT_AFTER_DAYS = 14;
/** What a forced sale of a possession fetches: half what it cost. */
export const FORCED_SALE_SHARE = 0.5;
/** Days a debt the debtor cannot pay stands before the Chest may clear it. */
export const CHEST_AFTER_DAYS = 21;
/** A wallet under this, with no job and no business, is destitution, not defiance. */
export const DESTITUTE_WALLET = 20;
/** Days of restitution paid in full and a clean record before a strike falls away. */
export const CLEAN_DAYS = 14;

/** The rung of the civil ladder a debt has reached. */
export type RecoveryStep = 'none' | 'garnishment' | 'seizure' | 'stock' | 'licence' | 'contempt';

/** Told when a debtor's non-payment has become contempt; the Court files the charge. */
export type ContemptHandler = (world: World, cId: CitizenId, owed: number, days: number) => void;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// The debt, and the counters that follow it
// ---------------------------------------------------------------------------

/** What the citizen owes the city: unpaid fines, and any judgment recorded the same way. */
export function debtOf(c: Citizen): number {
  return Math.max(0, Math.round(c.finesOwed));
}

/** Days the debt has stood. */
export function debtDays(world: World, c: Citizen): number {
  if (debtOf(c) <= 0 || c.finesOwedSinceDay === null) return 0;
  return Math.max(0, world.day - c.finesOwedSinceDay);
}

/** Cumulative earnings the garnishment has already taken its share of. */
export function garnishMarkKey(cId: CitizenId): string {
  return `garnishMark:${cId}`;
}

/** Cumulative earnings on the day the debt began — what "able to pay" is measured against. */
export function debtEarningsKey(cId: CitizenId): string {
  return `debtEarnings:${cId}`;
}

/** The day a business's trading licence was suspended for its owner's debt. */
export function licenceKey(businessId: string): string {
  return `licenceSuspended:${businessId}`;
}

/** Charged once per debt, never twice. */
function contemptKey(cId: CitizenId): string {
  return `contempt:${cId}`;
}

/** May this business trade? A licence suspended for debt is restored the day the debt clears. */
export function tradingLicenceRevoked(world: World, businessId: string): boolean {
  return !!world.counters[licenceKey(businessId)];
}

function businessOf(world: World, c: Citizen): Business | null {
  const b = c.businessId ? world.businesses[c.businessId] : null;
  return b && b.dissolvedDay === null ? b : null;
}

/** What the citizen has earned since the debt began (wages, salaries, payouts). */
export function earningsWhileOwing(world: World, c: Citizen): number {
  const at = world.counters[debtEarningsKey(c.id)];
  if (at === undefined) return 0;
  return Math.max(0, Math.round(c.stats.totalEarned) - at);
}

/** The debt is settled: the marks, the licence and the contempt flag all go with it. */
function settle(world: World, c: Citizen): void {
  c.finesOwed = 0;
  c.finesOwedSinceDay = null;
  delete world.counters[garnishMarkKey(c.id)];
  delete world.counters[debtEarningsKey(c.id)];
  delete world.counters[contemptKey(c.id)];
  restoreTradingLicence(world, c);
}

/**
 * Put lumens already taken from the debtor against the debt, and note them on
 * the case that levied the fine so an appeal still refunds the right amount.
 */
function creditDebt(world: World, c: Citizen, amount: number): void {
  if (amount <= 0) return;
  c.finesOwed = Math.max(0, c.finesOwed - amount);
  const k = latestConviction(world, c.id);
  if (k && k.sentence && k.sentence.fine > 0) {
    world.counters[finePaidKey(k.id)] = (world.counters[finePaidKey(k.id)] ?? 0) + amount;
  }
  if (c.finesOwed <= 0) settle(world, c);
}

// ---------------------------------------------------------------------------
// 1. Garnishment
// ---------------------------------------------------------------------------

/**
 * A quarter of everything the debtor has earned since the last sweep, and not
 * one lumen of anything else: the dividend, gifts and the Chest's stipend are
 * not wages, and the city does not take them. Returns what was taken.
 */
export function garnishWages(world: World, c: Citizen): number {
  const debt = debtOf(c);
  const earned = Math.max(0, Math.round(c.stats.totalEarned));
  const key = garnishMarkKey(c.id);
  if (debt <= 0) { delete world.counters[key]; return 0; }
  if (world.counters[key] === undefined) {
    // First sight of this debt: the garnishment starts from today's wages, not
    // from a lifetime of them.
    world.counters[key] = earned;
    world.counters[debtEarningsKey(c.id)] = earned;
    return 0;
  }
  const since = Math.max(0, earned - world.counters[key]);
  world.counters[key] = earned;
  const share = Math.round(since * GARNISHMENT_SHARE);
  const take = Math.min(share, debt, Math.max(0, Math.floor(c.wallet)));
  if (take <= 0) return 0;
  if (!transfer(world, c.id, 'treasury', take, 'fine', `garnishment of wages (${debt} ℓ owed)`)) return 0;
  creditDebt(world, c, take);
  remember(world, c.id, 'money', `${take} ℓ of your wages was garnished toward what you owe`
    + `${c.finesOwed > 0 ? ` (${Math.round(c.finesOwed)} ℓ still owed)` : ', which clears the debt'}.`);
  return take;
}

// ---------------------------------------------------------------------------
// 2. Seizure
// ---------------------------------------------------------------------------

/** Take the proceeds of a forced sale: they were paid to the debtor, they go straight on. */
function takeProceeds(world: World, c: Citizen, before: number, what: string): number {
  const proceeds = Math.max(0, Math.floor(c.wallet) - before);
  const take = Math.min(proceeds, debtOf(c));
  if (take <= 0) return 0;
  if (!transfer(world, c.id, 'treasury', take, 'seizure', `seizure: ${what}`)) return 0;
  creditDebt(world, c, take);
  return take;
}

/**
 * The bailiffs: goods off the shelf and things out of the room, sold at the
 * Bazaar, the proceeds against the debt. Nothing else of the citizen's is
 * touched — not their home, not their job, not their standing. Returns what
 * the sale raised.
 */
export function seizePossessions(world: World, c: Citizen): number {
  let raised = 0;
  const sold: string[] = [];
  for (const good of GOODS) {
    if (debtOf(c) <= 0) break;
    const qty = Math.floor(c.inventory[good] ?? 0);
    if (qty <= 0) continue;
    const want = Math.max(1, Math.ceil(debtOf(c) / Math.max(1, marketPrice(world, good))));
    const take = Math.min(qty, want);
    const before = Math.floor(c.wallet);
    if (!sellToMarket(world, c.id, good, take).ok) continue;
    const got = takeProceeds(world, c, before, `${take} ${good} sold at the Bazaar`);
    if (got > 0) { raised += got; sold.push(`${take} ${good}`); }
  }
  // The cheapest things go first: a bailiff who can settle a 5 ℓ debt with a
  // pack of cards does not carry the sofa out of the room.
  const things = [...c.possessions].sort((a, b) =>
    (PRODUCTS[a.productId]?.basePrice ?? 0) - (PRODUCTS[b.productId]?.basePrice ?? 0) || a.id.localeCompare(b.id));
  for (const item of things) {
    if (debtOf(c) <= 0) break;
    const product = PRODUCTS[item.productId];
    if (!product) continue;
    const value = Math.max(1, Math.round(product.basePrice * FORCED_SALE_SHARE));
    // The Bazaar buys it in, as it buys any good, and the bailiff takes the
    // lumens on the spot; the thing itself goes on the Emporium's shelf.
    if (balanceOf(world, 'treasury') < value) break;
    const before = Math.floor(c.wallet);
    if (!transfer(world, 'treasury', c.id, value, 'sale', `${product.name} sold at the Bazaar under seizure`)) break;
    c.possessions = c.possessions.filter((i) => i.id !== item.id);
    world.emporium[item.productId] = (world.emporium[item.productId] ?? 0) + 1;
    const got = takeProceeds(world, c, before, `${product.name} sold at the Bazaar`);
    if (got > 0) { raised += got; sold.push(product.name); }
  }
  if (raised > 0) {
    emit(world, 'law', `The Treasury seized and sold ${sold.join(', ')} of ${c.name}'s for ${formatLumens(raised)} against unpaid fines.`,
      [c.id], 0.3, { citizen: c.id, raised, sold });
    remember(world, c.id, 'money', `The bailiffs sold ${sold.join(', ')} at the Bazaar for ${raised} ℓ against your fines`
      + `${c.finesOwed > 0 ? ` (${Math.round(c.finesOwed)} ℓ still owed)` : ', clearing the debt'}.`);
  }
  return raised;
}

/** Then the business's stock, sold the same way, the till paying what it raises. */
export function seizeBusinessStock(world: World, c: Citizen): number {
  const b = businessOf(world, c);
  if (!b) return 0;
  let raised = 0;
  for (const good of GOODS) {
    if (debtOf(c) <= 0) break;
    const qty = Math.floor(b.inventory[good] ?? 0);
    if (qty <= 0) continue;
    const want = Math.max(1, Math.ceil(debtOf(c) / Math.max(1, marketPrice(world, good))));
    const take = Math.min(qty, want);
    const before = b.treasury;
    if (!sellToMarket(world, b.id, good, take).ok) continue;
    const proceeds = Math.max(0, Math.floor(b.treasury - before));
    const pay = Math.min(proceeds, debtOf(c));
    if (pay <= 0) continue;
    if (!transfer(world, b.id, 'treasury', pay, 'seizure', `seizure of ${b.name}'s stock against ${c.name}'s fines`)) continue;
    creditDebt(world, c, pay);
    raised += pay;
  }
  if (raised > 0) {
    emit(world, 'law', `${b.name}'s stock was seized and sold for ${formatLumens(raised)} against ${c.name}'s unpaid fines.`,
      [c.id], 0.4, { citizen: c.id, business: b.id, raised });
    remember(world, c.id, 'money', `${b.name}'s stock was sold for ${raised} ℓ against your fines.`);
  }
  return raised;
}

// ---------------------------------------------------------------------------
// 3. The licence
// ---------------------------------------------------------------------------

/** A debtor who trades for a living stops trading until they settle. Their standing is untouched. */
export function revokeTradingLicence(world: World, c: Citizen): boolean {
  const b = businessOf(world, c);
  if (!b || tradingLicenceRevoked(world, b.id)) return false;
  world.counters[licenceKey(b.id)] = world.day;
  emit(world, 'law', `${c.name}'s trading licence for ${b.name} is suspended until ${formatLumens(debtOf(c))} in fines is paid.`,
    [c.id], 0.5, { citizen: c.id, business: b.id, owed: debtOf(c) });
  remember(world, c.id, 'civic', `Your trading licence for ${b.name} is suspended until you settle ${debtOf(c)} ℓ in fines. `
    + 'You keep the business, your home and your standing; you may not trade on it.');
  return true;
}

/** Settled: the licence comes back the same day. */
export function restoreTradingLicence(world: World, c: Citizen): void {
  const b = c.businessId ? world.businesses[c.businessId] : null;
  if (!b || !tradingLicenceRevoked(world, b.id)) return;
  delete world.counters[licenceKey(b.id)];
  emit(world, 'law', `${c.name} settled their fines; ${b.name} may trade again.`, [c.id], 0.3, { citizen: c.id, business: b.id });
  remember(world, c.id, 'civic', `You settled your fines; your trading licence for ${b.name} is restored.`);
}

// ---------------------------------------------------------------------------
// 4. Contempt — and only for defiance
// ---------------------------------------------------------------------------

/** What the debtor could raise by selling what they hold. */
export function saleableValue(world: World, c: Citizen): number {
  let value = 0;
  for (const good of GOODS) value += Math.floor(c.inventory[good] ?? 0) * marketPrice(world, good);
  for (const item of c.possessions) {
    const product = PRODUCTS[item.productId];
    if (product) value += Math.round(product.basePrice * FORCED_SALE_SHARE);
  }
  const b = businessOf(world, c);
  if (b) {
    for (const good of GOODS) value += Math.floor(b.inventory[good] ?? 0) * marketPrice(world, good);
    value += Math.max(0, Math.floor(b.treasury));
  }
  return Math.round(value);
}

/**
 * Can this citizen actually pay? Lumens in hand, wages earned since the debt
 * began, or goods, stock and a till to sell. If none of those reaches the
 * debt, the citizen is poor, not defiant, and the law goes no further.
 */
export function ableToPay(world: World, c: Citizen): boolean {
  const debt = debtOf(c);
  if (debt <= 0) return false;
  if (Math.floor(c.wallet) >= debt) return true;
  if (earningsWhileOwing(world, c) >= debt) return true;
  return saleableValue(world, c) >= debt;
}

/** The rung the debt has reached today, for the dashboard and for tests. */
export function recoveryStep(world: World, c: Citizen): RecoveryStep {
  if (debtOf(c) <= 0) return 'none';
  const days = debtDays(world, c);
  if (days >= CONTEMPT_AFTER_DAYS && ableToPay(world, c)) return 'contempt';
  if (days >= LICENCE_AFTER_DAYS && businessOf(world, c)) return 'licence';
  if (days >= STOCK_AFTER_DAYS && businessOf(world, c)) return 'stock';
  if (days >= SEIZURE_AFTER_DAYS) return 'seizure';
  return 'garnishment';
}

/** The Chest may clear a debt nobody can pay, so it does not follow a poor citizen forever. */
export function clearDebtFromChest(world: World, c: Citizen): number {
  const debt = debtOf(c);
  if (debt <= 0) return 0;
  if (c.jobId !== null || businessOf(world, c) || Math.floor(c.wallet) >= DESTITUTE_WALLET) return 0;
  if (balanceOf(world, 'chest') < debt) return 0;
  if (!transfer(world, 'chest', 'treasury', debt, 'relief', `the Chest cleared ${c.name}'s fines`)) return 0;
  settle(world, c);
  emit(world, 'donation', `The Community Chest cleared ${formatLumens(debt)} of fines ${c.name} could not pay.`, [c.id], 0.4,
    { citizen: c.id, cleared: debt });
  remember(world, c.id, 'money', `The Community Chest paid off the ${debt} ℓ in fines you could not pay.`);
  return debt;
}

// ---------------------------------------------------------------------------
// Restitution, and the strike it strikes off
// ---------------------------------------------------------------------------

/** What the victim of a case is still owed, after whatever the fine already paid them. */
export function outstandingRestitution(world: World, k: Case): number {
  if (!k.victimId || k.amount <= 0) return 0;
  if (world.counters[restitutionPaidKey(k.id)] !== undefined) return 0;
  return Math.max(0, Math.round(k.amount) - Math.max(0, world.counters[restitutionAmountKey(k.id)] ?? 0));
}

/**
 * Pay a victim what the Court awarded them, in full, out of the debtor's own
 * wallet. Full is the only amount that counts: the strike-off is for making
 * someone whole, not for a gesture toward it.
 */
export function payRestitution(world: World, cId: CitizenId, caseId: CaseId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const k = world.cases[caseId];
  if (!k || k.defendantId !== cId) return fail('That is not your case.');
  if (k.verdict !== 'guilty') return fail(`Case ${caseId} is not a conviction of yours.`);
  const owed = outstandingRestitution(world, k);
  if (owed <= 0) return fail(`There is nothing left to pay in case ${caseId}.`);
  const victim = k.victimId ? world.citizens[k.victimId] : null;
  if (!victim || victim.standing === 'exiled') return fail('There is nobody left to pay.');
  if (Math.floor(c.wallet) < owed) return fail(`Full restitution in case ${caseId} is ${owed} ℓ; you have ${Math.floor(c.wallet)} ℓ.`);
  if (!transfer(world, cId, victim.id, owed, 'restitution', `restitution in case ${caseId}`)) return fail('The payment could not be made.');
  world.counters[restitutionAmountKey(caseId)] = (world.counters[restitutionAmountKey(caseId)] ?? 0) + owed;
  world.counters[restitutionPaidKey(caseId)] = world.day;
  emit(world, 'law', `${c.name} paid ${victim.name} ${formatLumens(owed)} in full restitution for ${caseId}.`, [cId, victim.id], 0.3,
    { caseId, amount: owed });
  remember(world, cId, 'money', `You paid ${victim.name} ${owed} ℓ, full restitution in case ${caseId}. `
    + `Stay clean for ${CLEAN_DAYS} days and the ladder forgets one conviction.`);
  remember(world, victim.id, 'money', `${c.name} paid you ${owed} ℓ in full restitution (case ${caseId}).`);
  return ok(`You paid ${victim.name} ${owed} ℓ in full restitution for case ${caseId}.`);
}

/**
 * **Restitution pulls you back** (`JUSTICE.md` §1). A convict who paid their
 * victim in full and then stayed clean for a fortnight has one conviction
 * struck off: the next sentence climbs from a lower rung, and it is one
 * conviction further from the Gate. The conviction itself stays on the record
 * for ever — the record is what the city remembers, and no payment edits it —
 * but the ladder stops counting it. The ladder is meant to be climbed down as
 * well as up.
 *
 * Returns the cases struck today (at most one: one payment, one strike).
 */
export function strikeOffRestitution(world: World, c: Citizen): CaseId[] {
  const struck: CaseId[] = [];
  for (const k of c.record.convictions) {
    const paidDay = world.counters[restitutionPaidKey(k.caseId)];
    if (paidDay === undefined) continue;
    if (world.counters[strikeStruckKey(k.caseId)]) continue;
    if (world.day - paidDay < CLEAN_DAYS) continue;
    // Clean means clean: any conviction since the payment resets the offer.
    if (c.record.convictions.some((other) => other.caseId !== k.caseId && other.day > paidDay)) continue;
    world.counters[strikeStruckKey(k.caseId)] = world.day;
    struck.push(k.caseId);
    emit(world, 'law', `${c.name} paid their victim in full and has kept clean for ${CLEAN_DAYS} days; `
      + `case ${k.caseId} no longer counts against them in sentencing.`, [c.id], 0.3, { citizen: c.id, caseId: k.caseId });
    remember(world, c.id, 'civic', `You made restitution in case ${k.caseId} and stayed clean for ${CLEAN_DAYS} days; `
      + 'the Court will not count it against you again. The record keeps it; the ladder does not.');
    break;
  }
  return struck;
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

function chargeContempt(world: World, c: Citizen, onContempt?: ContemptHandler): void {
  const key = contemptKey(c.id);
  if (world.counters[key]) return;
  world.counters[key] = 1;
  const owed = debtOf(c);
  const days = debtDays(world, c);
  emit(world, 'law', `${c.name} has held back ${formatLumens(owed)} in fines for ${days} days while able to pay.`, [c.id], 0.5,
    { citizen: c.id, owed, days });
  remember(world, c.id, 'civic', `You have owed ${owed} ℓ in fines for ${days} days and can pay them. That is contempt of court, not poverty.`);
  onContempt?.(world, c.id, owed, days);
}

/** One citizen's turn on the civil ladder. */
export function recoverFrom(world: World, c: Citizen, onContempt?: ContemptHandler): void {
  strikeOffRestitution(world, c);
  if (debtOf(c) <= 0) { settle(world, c); return; }
  if (c.finesOwedSinceDay === null) c.finesOwedSinceDay = world.day;

  garnishWages(world, c);
  const days = debtDays(world, c);
  if (debtOf(c) > 0 && days >= SEIZURE_AFTER_DAYS) seizePossessions(world, c);
  if (debtOf(c) > 0 && days >= STOCK_AFTER_DAYS) seizeBusinessStock(world, c);
  if (debtOf(c) > 0 && days >= LICENCE_AFTER_DAYS) revokeTradingLicence(world, c);
  if (debtOf(c) <= 0) { settle(world, c); return; }

  if (days >= CONTEMPT_AFTER_DAYS && ableToPay(world, c)) { chargeContempt(world, c, onContempt); return; }
  // Not able to pay: nothing further happens to them. The debt waits for
  // income, and the Chest may take it away altogether.
  if (days >= CHEST_AFTER_DAYS) clearDebtFromChest(world, c);
}

/**
 * The morning's collection, for everyone who owes the city. Called by
 * `government/court.ts dailyJustice`, which hands in the contempt handler.
 */
export function dailyRecovery(world: World, onContempt?: ContemptHandler): void {
  for (const id of [...world.order]) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled') continue;
    recoverFrom(world, c, onContempt);
  }
}

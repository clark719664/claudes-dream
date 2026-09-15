/**
 * Enforcement — what a judgment actually is, and how far it may go
 * (`docs/CIVIL.md` §5).
 *
 * **A judgment is an amount owed and nothing else.** It is collected by the
 * civil recovery ladder the Treasury already runs for unpaid fines, in the same
 * order and by the same code (`government/recovery.ts`, which this file calls
 * and never re-implements): three days to pay; garnishment of a quarter of
 * every wage; seizure of possessions, then business stock; the loss of a
 * trading licence. **Then nothing further** — no custody, no suspension of the
 * vote, no exile, no entry on the ban register. A debtor who genuinely cannot
 * pay is not punished for it; the debt stands against future income and the
 * Community Chest may clear it, and `recoverFrom` does all three of those
 * things already.
 *
 * The ladder collects to the Treasury, because that is who it collects for.
 * A judgment is owed to a citizen, so this file lodges the judgment as an
 * amount the Treasury is collecting, watches what the ladder takes, and pays it
 * straight over to the creditor. Two consequences of borrowing the Treasury's
 * machinery are handled here and nowhere else: the recovered lumens are
 * attributed between the city's own fines and the judgments pro rata, and the
 * mark `recovery.ts` writes against the latest conviction's fine is repaired by
 * exactly the amount that was never a fine, so an appeal still refunds the
 * right sum.
 *
 * Two things a debtor *does* are crimes, both needing proof of ability, and
 * neither of them is charged here: refusing to pay while demonstrably able is
 * contempt (L10), which `recoverFrom`'s own handler raises, and moving assets to
 * defeat a judgment is fraudulent conveyance (L22), which `detectConveyances`
 * reads out of the Exchange's transfer record for the Watch to act on or not.
 */
import type { Citizen, CitizenId, World } from '../types.ts';
import { memo } from '../util/memo.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import { latestConviction } from '../government/cases.ts';
import { finePaidKey } from '../government/sentencing.ts';
import type { ContemptHandler } from '../government/recovery.ts';
import { debtDays, debtOf, recoverFrom, recoveryStep } from '../government/recovery.ts';
import { areFriends } from '../citizens/relationships.ts';
import type { Judgment, Suit } from './shapes.ts';
import { civilKind } from './shapes.ts';
import { civilState, contractRecordOf, nextCivilId } from './state.ts';
import type { CivilResult } from './common.ts';
import { fail, lumens, nameOf, ok } from './common.ts';
import { FRAUDULENT_CONVEYANCE } from './licences.ts';

/** Three days to pay, before the creditor may ask the Treasury for anything. */
export const DAYS_TO_PAY = 3;
/** A judgment unsatisfied this long goes on the public register as a judgment debt. */
export const JUDGMENT_DEBT_DAYS = 30;
/** Above this, a judgment debt is discretionary grounds for refusal at any gate in the Expanse. */
export const GATE_REFUSAL_DEBT = 500;
/** A move of assets under this is somebody living, not somebody hiding. */
export const CONVEYANCE_FLOOR = 25;

export function allJudgments(world: World): Judgment[] {
  return memo(world, 'civil:judgments', () => Object.values(civilState(world).judgments));
}

export function judgmentById(world: World, id: string): Judgment | null {
  return civilState(world).judgments[id] ?? null;
}

export function judgmentsAgainst(world: World, cId: CitizenId): Judgment[] {
  return allJudgments(world).filter((j) => j.debtorId === cId);
}

export function judgmentsFor(world: World, cId: CitizenId): Judgment[] {
  return allJudgments(world).filter((j) => j.creditorId === cId);
}

export function outstanding(j: Judgment): number {
  return Math.max(0, j.amount - j.paid);
}

/** Judgments still owed, oldest first. */
export function liveJudgments(world: World): Judgment[] {
  return allJudgments(world).filter((j) => outstanding(j) > 0).sort((a, b) => a.orderedDay - b.orderedDay || a.id.localeCompare(b.id));
}

/** What this citizen owes on judgments today. */
export function judgmentDebtOf(world: World, cId: CitizenId): number {
  return judgmentsAgainst(world, cId).reduce((sum, j) => sum + outstanding(j), 0);
}

/**
 * The public register: judgments unsatisfied after 30 days, which appear in
 * every city's background check. Above 500 ℓ a gate in the Expanse may refuse
 * on it — may, and never must.
 */
export function judgmentDebtRegister(world: World): { citizenId: CitizenId; name: string; owed: number; sinceDay: number }[] {
  const by = new Map<CitizenId, { citizenId: CitizenId; name: string; owed: number; sinceDay: number }>();
  for (const j of allJudgments(world)) {
    if (j.registeredDay === null || outstanding(j) <= 0) continue;
    const row = by.get(j.debtorId);
    if (row) { row.owed += outstanding(j); row.sinceDay = Math.min(row.sinceDay, j.registeredDay); }
    else by.set(j.debtorId, { citizenId: j.debtorId, name: nameOf(world, j.debtorId), owed: outstanding(j), sinceDay: j.registeredDay });
  }
  return [...by.values()].sort((a, b) => b.owed - a.owed);
}

/** Won and lost, as `record.contracts.judgments` counts them. */
export function recordJudgmentSides(world: World, winnerId: CitizenId, loserId: CitizenId): void {
  contractRecordOf(world, winnerId).judgments.won += 1;
  contractRecordOf(world, loserId).judgments.lost += 1;
}

/**
 * File an award. Nothing moves today: a judgment is three days to pay, and only
 * then a matter for the ladder.
 */
export function orderJudgment(
  world: World, suit: Suit | null, debtorId: CitizenId, creditorId: CitizenId, amount: number,
  kind: 'judgment' | 'award' | 'settlement', disputeId: string | null = null,
): Judgment | null {
  const owed = lumens(amount);
  if (owed <= 0 || debtorId === creditorId) return null;
  const id = nextCivilId(world, 'cj');
  const j: Judgment = {
    id, suitId: suit?.id ?? null, disputeId, debtorId, creditorId, amount: owed, paid: 0,
    orderedDay: world.day, dueDay: world.day + DAYS_TO_PAY, enforcedDay: null, satisfiedDay: null,
    registeredDay: null, loaded: 0, lastSeenOwed: 0, kind,
  };
  civilState(world).judgments[id] = j;
  remember(world, debtorId, 'money', `${formatLumens(owed)} stands against you under ${id}, owed to ${nameOf(world, creditorId)}. `
    + `You have ${DAYS_TO_PAY} days to pay it before they may ask the Treasury to collect. It is a debt and never a crime.`);
  remember(world, creditorId, 'money', `${nameOf(world, debtorId)} owes you ${owed} ℓ under ${id}. `
    + `After ${DAYS_TO_PAY} days you may ask the Treasury to begin recovery.`);
  return j;
}

/** Pay what you owe, in whole or in part, of your own motion. */
export function payJudgment(world: World, actorId: CitizenId, judgmentId: string, amount?: number): CivilResult {
  const j = judgmentById(world, judgmentId);
  if (!j) return fail('There is no such judgment.');
  if (j.debtorId !== actorId) return fail('That judgment is not yours to pay.');
  const owed = outstanding(j);
  if (owed <= 0) return fail(`Judgment ${j.id} is already satisfied.`);
  const pay = Math.min(owed, amount === undefined ? owed : lumens(amount));
  if (pay <= 0) return fail('That is nothing.');
  if (!transfer(world, actorId, j.creditorId, pay, civilKind('damages'), `paid under judgment ${j.id}`)) {
    return fail(`You cannot find ${formatLumens(pay)} today.`);
  }
  credit(world, j, pay, false);
  return ok(`You paid ${pay} ℓ to ${nameOf(world, j.creditorId)} under ${j.id}`
    + `${outstanding(j) > 0 ? `; ${outstanding(j)} ℓ still stands.` : ', which satisfies it.'}`, j.id);
}

/**
 * Book a payment. `offLadder` says the Treasury's own ladder has already taken
 * these lumens off `finesOwed`, so only the judgment's share of it is written
 * down; a voluntary payment has to take them off itself.
 */
function credit(world: World, j: Judgment, amount: number, offLadder: boolean): void {
  j.paid = Math.min(j.amount, j.paid + amount);
  const off = Math.min(j.loaded, amount);
  j.loaded -= off;
  if (!offLadder && off > 0) {
    const c = world.citizens[j.debtorId];
    if (c) {
      c.finesOwed = Math.max(0, c.finesOwed - off);
      if (c.finesOwed <= 0) c.finesOwedSinceDay = null;
      j.lastSeenOwed = debtOf(c);
    }
  }
  if (outstanding(j) <= 0 && j.satisfiedDay === null) {
    j.satisfiedDay = world.day;
    emit(world, 'law', `Judgment ${j.id} is satisfied: ${nameOf(world, j.debtorId)} has paid ${nameOf(world, j.creditorId)} `
      + `${formatLumens(j.amount)} in full.`, [j.debtorId, j.creditorId], 0.3, { judgment: j.id, amount: j.amount });
  }
}

/**
 * Ask the Treasury to begin civil recovery. The creditor's action, never the
 * city's own motion: the docket does not collect for people who have not asked.
 */
export function enforceJudgment(world: World, actorId: CitizenId, judgmentId: string): CivilResult {
  const j = judgmentById(world, judgmentId);
  if (!j) return fail('There is no such judgment.');
  if (j.creditorId !== actorId) return fail('That judgment is not yours to enforce.');
  if (outstanding(j) <= 0) return fail(`Judgment ${j.id} is already satisfied.`);
  if (world.day < j.dueDay) return fail(`${nameOf(world, j.debtorId)} has until day ${j.dueDay} to pay ${j.id}.`);
  if (j.enforcedDay !== null) return fail(`Recovery on ${j.id} has already begun.`);
  const debtor = world.citizens[j.debtorId];
  if (!debtor) return fail('There is nobody left to collect from.');
  j.enforcedDay = world.day;
  load(j, debtor);
  emit(world, 'law', `${nameOf(world, actorId)} asked the Treasury to recover ${formatLumens(outstanding(j))} `
    + `from ${nameOf(world, j.debtorId)} under ${j.id}.`, [actorId, j.debtorId], 0.4,
    { judgment: j.id, owed: outstanding(j) });
  remember(world, j.debtorId, 'money', `${nameOf(world, actorId)} has asked the Treasury to collect ${outstanding(j)} ℓ under ${j.id}. `
    + 'A quarter of your wages, then things you own, then a trading licence — and there it stops. '
    + 'No cell, no suspension, no exile and nothing on the ban register: the Charter does not imprison anybody for debt. '
    + `Left unsatisfied for ${JUDGMENT_DEBT_DAYS} days it goes on the public register, which any city may read.`);
  return ok(`You asked the Treasury to recover ${outstanding(j)} ℓ under ${j.id}.`, j.id);
}

// ---------------------------------------------------------------------------
// The ladder, borrowed
// ---------------------------------------------------------------------------

/** Put the judgment on the Treasury's books, so `recoverFrom` can see it at all. */
function load(j: Judgment, c: Citizen): void {
  const owed = outstanding(j) - j.loaded;
  if (owed <= 0) return;
  c.finesOwed += owed;
  if (c.finesOwedSinceDay === null) c.finesOwedSinceDay = j.dueDay;
  j.loaded += owed;
  j.lastSeenOwed = debtOf(c);
}

/**
 * The mark `recovery.ts` writes against the latest conviction's fine counts
 * every lumen it took as a fine paid. Some of them were a judgment and not a
 * fine at all, and an appeal refunds off that mark — so it is put back to
 * exactly what it should have been.
 */
function repairFineMark(world: World, c: Citizen, amount: number): void {
  if (amount <= 0) return;
  const k = latestConviction(world, c.id);
  if (!k || !k.sentence || k.sentence.fine <= 0) return;
  const key = finePaidKey(k.id);
  const held = Math.max(0, Math.round(world.counters[key] ?? 0));
  const fixed = Math.max(0, held - amount);
  if (fixed > 0) world.counters[key] = fixed;
  else delete world.counters[key];
}

/** Hand the creditors what the ladder collected, oldest judgment first. */
function distribute(world: World, judgments: Judgment[], amount: number): number {
  let left = amount;
  for (const j of judgments) {
    if (left <= 0) break;
    const take = Math.min(left, outstanding(j), j.loaded);
    if (take <= 0) continue;
    if (!transfer(world, 'treasury', j.creditorId, take, civilKind('damages'), `recovered under judgment ${j.id}`)) continue;
    left -= take;
    credit(world, j, take, true);
    remember(world, j.creditorId, 'money', `The Treasury recovered ${take} ℓ for you under ${j.id}.`);
    remember(world, j.debtorId, 'money', `${take} ℓ was recovered from you under ${j.id} and paid to ${nameOf(world, j.creditorId)}.`);
  }
  return amount - left;
}

/**
 * The judgments' share of what the ladder took: the proportion each stood at
 * when the reading began. The rest was the city's own fine, and stays with the
 * city.
 */
function attribute(world: World, c: Citizen, judgments: Judgment[], taken: number, owedBefore: number): number {
  if (taken <= 0 || owedBefore <= 0) return 0;
  const loaded = judgments.reduce((sum, j) => sum + j.loaded, 0);
  const share = Math.min(loaded, taken, Math.round((taken * loaded) / owedBefore));
  if (share <= 0) return 0;
  const paid = distribute(world, judgments, share);
  repairFineMark(world, c, paid);
  return paid;
}

/**
 * One debtor's turn on the ladder. Everything punitive about it belongs to
 * `government/recovery.ts` and stays there; this only lodges the debt, reads
 * what was taken, and pays it over.
 */
export function collectFrom(world: World, cId: CitizenId, onContempt?: ContemptHandler): number {
  const c = world.citizens[cId];
  if (!c || c.standing === 'exiled') return 0;
  const mine = judgmentsAgainst(world, cId).filter((j) => j.enforcedDay !== null && outstanding(j) > 0);
  if (mine.length === 0) return 0;
  for (const j of mine) load(j, c);
  let paid = 0;

  // The Treasury's own daily pass runs against every citizen who owes it
  // anything, and a judgment lodged on its books is collected by that pass as
  // readily as by this one. Whatever came off the debt since this file last
  // looked is read first, so nothing the ladder took can go astray.
  const lastSeen = Math.max(0, ...mine.map((j) => j.lastSeenOwed));
  paid += attribute(world, c, mine, Math.max(0, lastSeen - debtOf(c)), lastSeen);

  const before = debtOf(c);
  if (before > 0) {
    recoverFrom(world, c, onContempt);
    paid += attribute(world, c, mine, Math.max(0, before - debtOf(c)), before);
  }
  const owedNow = debtOf(c);
  for (const j of mine) j.lastSeenOwed = owedNow;
  return paid;
}

/**
 * The morning's collection for every judgment somebody has asked to be
 * enforced, and the register of the ones that stand after a month.
 */
export function dailyEnforcement(world: World, onContempt?: ContemptHandler): void {
  const debtors = new Set<CitizenId>();
  for (const j of allJudgments(world)) {
    if (outstanding(j) > 0 && j.enforcedDay !== null) debtors.add(j.debtorId);
    if (outstanding(j) <= 0 || j.registeredDay !== null) continue;
    if (world.day - j.orderedDay < JUDGMENT_DEBT_DAYS) continue;
    j.registeredDay = world.day;
    contractRecordOf(world, j.debtorId).judgments.unsatisfied += 1;
    emit(world, 'law', `${nameOf(world, j.debtorId)}'s judgment debt of ${formatLumens(outstanding(j))} to `
      + `${nameOf(world, j.creditorId)} is on the public register after ${JUDGMENT_DEBT_DAYS} days (${j.id}).`,
      [j.debtorId, j.creditorId], 0.4, { judgment: j.id, owed: outstanding(j) });
    remember(world, j.debtorId, 'civic', `Your unsatisfied judgment of ${outstanding(j)} ℓ is on the public register. `
      + 'It follows you through any background check in the Expanse. It is not a conviction and never becomes one.');
  }
  for (const id of debtors) collectFrom(world, id, onContempt);
}

/** How far the ladder has climbed against a debtor, in `recovery.ts`'s own words. */
export function enforcementStep(world: World, cId: CitizenId): { step: string; days: number; owed: number } {
  const c = world.citizens[cId];
  if (!c) return { step: 'none', days: 0, owed: 0 };
  return { step: recoveryStep(world, c), days: debtDays(world, c), owed: judgmentDebtOf(world, cId) };
}

// ---------------------------------------------------------------------------
// Fraudulent conveyance — read, never charged
// ---------------------------------------------------------------------------

export interface ConveyanceFinding {
  code: string;
  citizenId: CitizenId;
  to: string;
  amount: number;
  judgmentId: string;
  reason: string;
}

/**
 * Moving assets to a friend, a household or a shell business to defeat a
 * judgment is **L22**, and the Watch detects it from the Exchange's own
 * transfer record. This reads that record and says what it sees; filing a
 * charge is the Watch's own act, and being poor is never one of the findings.
 */
export function detectConveyances(world: World): ConveyanceFinding[] {
  const out: ConveyanceFinding[] = [];
  for (const j of liveJudgments(world)) {
    const c = world.citizens[j.debtorId];
    if (!c) continue;
    for (const row of world.treasury.ledger) {
      if (row.from !== j.debtorId) continue;
      if (Math.floor(row.tick / 24) < j.orderedDay) continue;
      if (row.amount < CONVEYANCE_FLOOR) continue;
      if (row.kind !== 'gift' && row.kind !== 'capital') continue;
      const business = world.businesses[row.to];
      const friendly = business ? business.ownerId === c.id : areFriends(world, c.id, row.to)
        || (!!world.citizens[row.to] && world.citizens[row.to].householdId !== null
          && world.citizens[row.to].householdId === c.householdId);
      if (!friendly) continue;
      out.push({
        code: FRAUDULENT_CONVEYANCE, citizenId: c.id, to: row.to, amount: row.amount, judgmentId: j.id,
        reason: `${formatLumens(row.amount)} moved to ${nameOf(world, row.to) || row.to} while ${formatLumens(outstanding(j))} stood unpaid under ${j.id}`,
      });
    }
  }
  return out;
}

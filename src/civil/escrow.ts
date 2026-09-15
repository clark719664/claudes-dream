/**
 * Escrow — the one new money party civil law adds, and it is not a new party at
 * all (`docs/CIVIL.md` §2, `REGISTRY.md` §5).
 *
 * A sum plus a 2 % holder's fee sits with a licensed banker or the Exchange,
 * **earmarked and unspendable**, until it is released or ordered released. The
 * lumens are real and they are held *inside* a party that already exists — a
 * banker's own wallet, or the Treasury — so the audit in `economy/treasury.ts`
 * balances untouched and no lumen is created or destroyed by lodging one.
 * `escrowHeldBy` is what tells the holder how much of their balance is not
 * theirs, and `spendableBalance` is the number anything asking "can they
 * afford it" should read.
 */
import type { CitizenId, MoneyParty, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens, transfer } from '../economy/treasury.ts';
import type { Escrow } from './shapes.ts';
import { civilKind } from './shapes.ts';
import { civilState, nextCivilId } from './state.ts';
import type { CivilResult } from './common.ts';
import { canPay, fail, lumens, nameOf, ok, partyName } from './common.ts';
import { isLicensed } from './licences.ts';
import { contractById, isParty } from './terms.ts';

/** The holder's fee, paid by the depositor on top of the sum. */
export const HOLDER_FEE_RATE = 0.02;

/** The Exchange itself, when nobody else holds it. */
export const EXCHANGE: MoneyParty = 'treasury';

export function allEscrows(world: World): Escrow[] {
  return Object.values(civilState(world).escrows);
}

export function escrowById(world: World, id: string): Escrow | null {
  return civilState(world).escrows[id] ?? null;
}

/** Sums still held, oldest first. */
export function liveEscrows(world: World): Escrow[] {
  return allEscrows(world).filter((e) => e.status === 'held');
}

/** Escrows lodged against one instrument. */
export function escrowsFor(world: World, contractId: string): Escrow[] {
  return allEscrows(world).filter((e) => e.contractId === contractId);
}

/** How much of this party's balance is somebody else's, earmarked and unspendable. */
export function escrowHeldBy(world: World, party: MoneyParty): number {
  return liveEscrows(world).filter((e) => e.holder === party).reduce((sum, e) => sum + e.amount, 0);
}

/** What a party may actually spend: what they hold, less what they only hold for others. */
export function spendableBalance(world: World, party: MoneyParty): number {
  return Math.max(0, balanceOf(world, party) - escrowHeldBy(world, party));
}

/** Every lumen sitting in escrow across the city, for the audit and the dashboard. */
export function totalEscrowed(world: World): number {
  return liveEscrows(world).reduce((sum, e) => sum + e.amount, 0);
}

/**
 * Lodge a sum with a licensed banker or the Exchange. The depositor must be a
 * party to the instrument it secures, and the beneficiary is the other side.
 */
export function openEscrow(
  world: World, depositorId: CitizenId, contractId: string, holder: CitizenId | 'exchange', amount: number,
): CivilResult {
  const k = contractById(world, contractId);
  if (!k) return fail('There is no such contract.');
  if (k.status !== 'active') return fail(`Contract ${k.id} is ${k.status}; there is nothing to secure.`);
  if (!isParty(k, depositorId)) return fail('You are not a party to that contract.');
  const sum = lumens(amount);
  if (sum <= 0) return fail('An escrow has to hold something.');

  const holderParty: MoneyParty = holder === 'exchange' ? EXCHANGE : holder;
  const holderId = holder === 'exchange' ? null : holder;
  if (holderId !== null) {
    if (!world.citizens[holderId]) return fail('There is no such holder.');
    if (holderId === depositorId) return fail('A holder stands outside the deal; you cannot hold your own escrow.');
    if (!isLicensed(world, holderId, 'banker')) {
      return fail(`Holding escrow is a banker's act; ${nameOf(world, holderId)} does not hold the Lantern House's mark.`);
    }
  }
  const fee = Math.round(sum * HOLDER_FEE_RATE);
  if (!canPay(world, depositorId, sum + fee)) {
    return fail(`Lodging ${formatLumens(sum)} costs ${formatLumens(sum + fee)} with the holder's fee.`);
  }
  if (!transfer(world, depositorId, holderParty, sum, civilKind('escrow'), `escrow lodged against ${k.id}`)) {
    return fail('The sum could not be lodged.');
  }
  if (fee > 0 && !transfer(world, depositorId, holderParty, fee, 'fee', `holder's fee on the escrow against ${k.id}`)) {
    // The sum is already lodged; unwind it rather than leave a half-made escrow.
    transfer(world, holderParty, depositorId, sum, civilKind('escrow'), `escrow unwound: the holder's fee could not be paid`);
    return fail('The holder’s fee could not be paid.');
  }
  const id = nextCivilId(world, 'ce');
  const e: Escrow = {
    id, contractId: k.id, depositorId, beneficiaryId: depositorId === k.offerorId ? k.offereeId : k.offerorId,
    holder: holderParty, holderId, amount: sum, fee, openedDay: world.day,
    status: 'held', closedDay: null, paidToId: null,
  };
  civilState(world).escrows[id] = e;
  emit(world, 'trade', `${nameOf(world, depositorId)} lodged ${formatLumens(sum)} in escrow with `
    + `${partyName(world, holderParty)} against ${k.id} (${id}).`, [depositorId, e.beneficiaryId], 0.3,
    { escrow: id, contract: k.id, amount: sum, fee });
  remember(world, e.beneficiaryId, 'money', `${nameOf(world, depositorId)} lodged ${sum} ℓ in escrow against ${k.id}. `
    + 'It is earmarked and unspendable until it is released.');
  return ok(`You lodged ${sum} ℓ in escrow (${id}) and paid ${fee} ℓ to hold it.`, id);
}

function close(world: World, e: Escrow, toId: CitizenId, why: string): boolean {
  if (!transfer(world, e.holder, toId, e.amount, civilKind('escrow'), `escrow ${e.id} ${why}`)) return false;
  e.status = toId === e.depositorId ? 'returned' : 'released';
  e.closedDay = world.day;
  e.paidToId = toId;
  emit(world, 'trade', `Escrow ${e.id} of ${formatLumens(e.amount)} was ${e.status} to ${nameOf(world, toId)} — ${why}.`,
    [e.depositorId, e.beneficiaryId], 0.3, { escrow: e.id, amount: e.amount, to: toId });
  remember(world, toId, 'money', `The ${e.amount} ℓ held in escrow ${e.id} came to you — ${why}.`);
  return true;
}

/** Release it to the beneficiary. Only the depositor may, of their own motion. */
export function releaseEscrow(world: World, actorId: CitizenId, escrowId: string): CivilResult {
  const e = escrowById(world, escrowId);
  if (!e) return fail('There is no such escrow.');
  if (e.status !== 'held') return fail(`Escrow ${e.id} was already ${e.status}.`);
  if (e.depositorId !== actorId) {
    return fail('An escrow is released by the one who lodged it, or by an order of the docket.');
  }
  if (!close(world, e, e.beneficiaryId, 'released by the depositor')) return fail('The escrow could not be released.');
  return ok(`You released ${e.amount} ℓ from escrow ${e.id} to ${nameOf(world, e.beneficiaryId)}.`, e.id);
}

/**
 * A judge's order, and the only way an escrow moves without its depositor:
 * released to the beneficiary, or returned to the depositor where the deal is
 * unwound. Called by the docket, never by a citizen.
 */
export function orderEscrow(world: World, escrowId: string, toId: CitizenId, why: string): boolean {
  const e = escrowById(world, escrowId);
  if (!e || e.status !== 'held') return false;
  if (toId !== e.depositorId && toId !== e.beneficiaryId) return false;
  return close(world, e, toId, why);
}

/** Every escrow against an instrument, back where it came from. Rescission does this. */
export function returnEscrows(world: World, contractId: string, why: string): number {
  let returned = 0;
  for (const e of escrowsFor(world, contractId)) {
    if (e.status !== 'held') continue;
    if (close(world, e, e.depositorId, why)) returned += e.amount;
  }
  return returned;
}

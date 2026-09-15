/**
 * The small shared vocabulary of civil law: results that can carry the id of
 * the thing they just filed, the party a citizen contracts through, and who is
 * fit to be bound at all.
 *
 * Nothing here punishes. A citizen who cannot be a party is told so and keeps
 * the hour; that is the whole of it.
 */
import type { ActionResult, BusinessId, Citizen, CitizenId, MoneyParty, World } from '../types.ts';
import { isDetained, isPresent } from '../citizens/citizen.ts';
import { isJailed } from '../government/jail.ts';
import { balanceOf } from '../economy/treasury.ts';

/**
 * An action result that also names what it filed, so the wiring pass and the
 * citizen's own memory can refer to it.
 */
export interface CivilResult extends ActionResult {
  id?: string;
}

export function fail(message: string): CivilResult { return { ok: false, message }; }
export function ok(message: string, id?: string): CivilResult {
  return id === undefined ? { ok: true, message } : { ok: true, message, id };
}

export function nameOf(world: World, id: CitizenId | null | undefined): string {
  return id ? world.citizens[id]?.name ?? id : 'nobody';
}

/** How a money party reads in the Chronicle. */
export function partyName(world: World, party: MoneyParty): string {
  if (party === 'treasury') return 'the Exchange';
  if (party === 'chest') return 'the Community Chest';
  return world.citizens[party]?.name ?? world.businesses[party]?.name ?? party;
}

/**
 * **Who may be bound.** Two or more citizens, or a citizen and a business, in
 * good standing or on probation (`CIVIL.md` §1). A suspended citizen may not
 * trade and so may not contract; an exile is not here; a child does not sign.
 * Nothing about this is a punishment — it is who the Exchange can file.
 */
export function mayContract(world: World, c: Citizen | null | undefined): boolean {
  if (!c) return false;
  if (c.standing !== 'good' && c.standing !== 'probation') return false;
  if (c.lifeStage === 'child') return false;
  // A citizen in custody may not trade (`JUSTICE.md` §2), so they cannot be
  // bound by a new instrument — and the ones they already hold stand still for
  // the term rather than falling into breach (`CIVIL.md` §3).
  if (isJailed(c)) return false;
  return isPresent(world, c) && !isDetained(world, c);
}

/** The citizen a party id names, or null when it is a business or the Exchange. */
export function citizenOf(world: World, party: MoneyParty): Citizen | null {
  return world.citizens[party] ?? null;
}

/**
 * The till a citizen contracts through. A business is only ever the purse one
 * of its owners acts with: naming a business you do not own is refused.
 */
export function tillFor(world: World, cId: CitizenId, businessId?: BusinessId | null): MoneyParty | null {
  if (!businessId) return cId;
  const b = world.businesses[businessId];
  if (!b || b.dissolvedDay !== null || b.ownerId !== cId) return null;
  return b.id;
}

/** Integer lumens, or 0 for anything that is not a number. */
export function lumens(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.round(v)) : 0;
}

/** What a party can actually find today. */
export function canPay(world: World, party: MoneyParty, amount: number): boolean {
  return balanceOf(world, party) >= amount;
}

/** Words in a pleading, for the specificity the docket weighs. */
export function wordCount(text: string): number {
  return text.trim().split(/\s+/).filter((w) => w.length > 0).length;
}

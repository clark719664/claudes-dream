/**
 * What happens to a running instrument: **variation** by the same two-action
 * handshake that formed it, **notice** that ends it clean, and **breach**,
 * which is the one thing in Reverie that is noticed and then answered with
 * nothing at all (`docs/CIVIL.md` §3).
 *
 * A missed performance without notice marks the contract breached at the daily
 * rollover — and then nothing happens: no money moves, no charge is filed, no
 * repute is docked. The other party may sue or not, and most breaches are never
 * sued on, because suing costs money and the relationship is worth more.
 *
 * A citizen in custody cannot perform and is not in breach for it: their
 * contracts suspend for the term and resume on release. A citizen under a
 * residency notice keeps every contract they hold (`CITIZENSHIP.md` §3) — which
 * is why nothing in this file looks at standing at all after formation.
 */
import type { CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import type { Contract, Variation } from './shapes.ts';
import { contractRecordOf, nextCivilId } from './state.ts';
import type { CivilResult } from './common.ts';
import { fail, lumens, nameOf, ok } from './common.ts';
import {
  MAX_CONTRACT_DAYS, OFFER_LAPSE_DAYS, PENALTY_MULTIPLE,
  allContracts, contractById, endDay, faceValue, isParty, isPerformed, obligorOf, partiesOf,
  periodDueDay, suspendedForCustody,
} from './terms.ts';
import { completeContract, wageFloor } from './contracts.ts';

/** Every variation on the register, running or spent. */
export function allVariations(world: World): Variation[] {
  return allContracts(world).flatMap((k) => k.variations);
}

export function variationById(world: World, id: string): Variation | null {
  return allVariations(world).find((v) => v.id === id) ?? null;
}

/** Variations put to this citizen that are still open. */
export function variationsTo(world: World, cId: CitizenId): Variation[] {
  return allContracts(world)
    .filter((k) => isParty(k, cId))
    .flatMap((k) => k.variations.filter((v) => v.status === 'offered' && v.byId !== cId));
}

/** What a variation may move. Anything it leaves out stays as filed. */
export interface VariationChanges {
  consideration?: number;
  days?: number;
  penalty?: number;
  notice?: number;
}

/**
 * Offer new terms on a running contract. It binds nobody until the other side
 * accepts, and it lapses in two days like any other offer.
 */
export function proposeVariation(
  world: World, actorId: CitizenId, contractId: string, terms: string, changes: VariationChanges = {},
): CivilResult {
  const k = contractById(world, contractId);
  if (!k) return fail('There is no such contract.');
  if (k.status !== 'active') return fail(`Contract ${k.id} is ${k.status}; there are no terms to vary.`);
  if (!isParty(k, actorId)) return fail('You are not a party to that contract.');
  if (!terms || terms.trim().length < 3) return fail('A variation has to say what changes.');
  if (k.variations.some((v) => v.status === 'offered')) return fail(`There is already a variation open on ${k.id}.`);

  const id = nextCivilId(world, 'cv');
  const v: Variation = {
    id, contractId: k.id, byId: actorId, terms: terms.trim(),
    consideration: changes.consideration === undefined ? null : lumens(changes.consideration),
    days: changes.days === undefined ? null : Math.round(changes.days),
    penalty: changes.penalty === undefined ? null : lumens(changes.penalty),
    notice: changes.notice === undefined ? null : Math.max(0, Math.round(changes.notice)),
    proposedDay: world.day, lapsesDay: world.day + OFFER_LAPSE_DAYS, status: 'offered',
  };
  k.variations.push(v);
  const other = actorId === k.offerorId ? k.offereeId : k.offerorId;
  emit(world, 'trade', `${nameOf(world, actorId)} put new terms to ${nameOf(world, other)} on ${k.id} (${id}).`,
    partiesOf(k), 0.2, { contract: k.id, variation: id });
  remember(world, other, 'money', `${nameOf(world, actorId)} proposes to vary ${k.id} (${id}): ${v.terms}`);
  return ok(`You proposed a variation to ${k.id} (${id}).`, id);
}

/** Agree to them. The register keeps both the old terms and the new. */
export function acceptVariation(world: World, actorId: CitizenId, variationId: string): CivilResult {
  const v = variationById(world, variationId);
  if (!v) return fail('There is no such variation.');
  const k = contractById(world, v.contractId);
  if (!k) return fail('There is no such contract.');
  if (v.status !== 'offered') return fail('That variation is no longer open.');
  if (world.day > v.lapsesDay) return fail('That variation has lapsed.');
  if (!isParty(k, actorId)) return fail('You are not a party to that contract.');
  if (v.byId === actorId) return fail('A variation is agreed by the other side, not by the one who proposed it.');
  if (k.status !== 'active') return fail(`Contract ${k.id} is ${k.status}; there are no terms to vary.`);

  if (v.consideration !== null) {
    const floor = wageFloor(world, k.kind);
    if ((k.kind === 'employment' || k.kind === 'apprenticeship') && v.consideration < floor) {
      return fail(`A wage may not be varied under ${floor} ℓ.`);
    }
    k.consideration = v.consideration;
  }
  if (v.days !== null) {
    const days = Math.max(1, Math.min(MAX_CONTRACT_DAYS, v.days));
    k.days = days;
    k.periods = k.periods > 1 ? Math.max(k.performances.length, days) : k.periods;
    k.endsDay = endDay(k);
  }
  if (v.notice !== null) k.notice = v.notice;
  const face = faceValue(k.consideration, k.kind, k.days);
  if (v.penalty !== null) k.penalty = Math.min(v.penalty, PENALTY_MULTIPLE * face);
  else k.penalty = Math.min(k.penalty, PENALTY_MULTIPLE * face);
  k.terms = `${k.terms} — varied on day ${world.day}: ${v.terms}`;
  v.status = 'accepted';
  emit(world, 'trade', `${nameOf(world, actorId)} agreed ${nameOf(world, v.byId)}'s variation of ${k.id}: ${v.terms}`,
    partiesOf(k), 0.3, { contract: k.id, variation: v.id });
  for (const id of partiesOf(k)) remember(world, id, 'money', `Contract ${k.id} was varied by agreement: ${v.terms}`);
  return ok(`You agreed the variation of ${k.id}.`, k.id);
}

// ---------------------------------------------------------------------------
// Notice
// ---------------------------------------------------------------------------

/**
 * End it inside the notice period, clean, with no penalty and no entry against
 * either side. Where the instrument gives no notice at all, saying so ends it
 * today; where it gives three days, three days are still owed and still
 * performed.
 */
export function terminateContract(world: World, actorId: CitizenId, contractId: string): CivilResult {
  const k = contractById(world, contractId);
  if (!k) return fail('There is no such contract.');
  if (k.status !== 'active') return fail(`Contract ${k.id} is already ${k.status}.`);
  if (!isParty(k, actorId)) return fail('You are not a party to that contract.');
  if (k.noticeById !== null) return fail(`Notice on ${k.id} was already served on day ${k.noticeDay}.`);

  k.noticeById = actorId;
  k.noticeDay = world.day;
  k.endsDay = world.day + k.notice;
  const other = actorId === k.offerorId ? k.offereeId : k.offerorId;
  if (k.notice <= 0) {
    endOnNotice(world, k);
    return ok(`You ended ${k.id} on notice. Nothing is owed either way.`, k.id);
  }
  emit(world, 'trade', `${nameOf(world, actorId)} served ${k.notice} days' notice on ${k.id}; it ends on day ${k.endsDay}.`,
    partiesOf(k), 0.3, { contract: k.id, notice: k.notice, ends: k.endsDay });
  remember(world, other, 'money', `${nameOf(world, actorId)} served notice on ${k.id}. It ends on day ${k.endsDay}, `
    + 'and until then both of you still owe what it says.');
  return ok(`You served ${k.notice} days' notice on ${k.id}; it ends on day ${k.endsDay}.`, k.id);
}

/** The notice has run: the instrument ends, clean. */
function endOnNotice(world: World, k: Contract): void {
  k.status = 'terminated';
  emit(world, 'trade', `Contract ${k.id} between ${nameOf(world, k.offerorId)} and ${nameOf(world, k.offereeId)} `
    + `ended on notice from ${nameOf(world, k.noticeById)}. No penalty, and nothing against either side.`,
    partiesOf(k), 0.3, { contract: k.id });
  for (const id of partiesOf(k)) {
    remember(world, id, 'money', `Contract ${k.id} ended on notice. It is neither kept nor breached, and nothing is owed.`);
  }
}

// ---------------------------------------------------------------------------
// Breach — and what it costs, which is nothing the law does
// ---------------------------------------------------------------------------

/**
 * Mark the instrument breached. **Nothing happens**: no money moves, no charge
 * is filed, no repute is docked, and no standing changes. All that is written
 * is the line in the register the next citizen reads before deciding whether to
 * sign — and that is the whole of the penalty, now and always.
 */
export function markBreach(world: World, k: Contract, byId: CitizenId, period: number, why: string): void {
  if (k.status !== 'active') return;
  k.status = 'breached';
  k.breachedDay = world.day;
  k.breachedById = byId;
  k.breachedPeriod = period;
  contractRecordOf(world, byId).breached += 1;
  const other = byId === k.offerorId ? k.offereeId : k.offerorId;
  emit(world, 'trade', `Contract ${k.id} is in breach: ${nameOf(world, byId)} did not ${why}. `
    + `${nameOf(world, other)} may sue on the docket, or not.`, partiesOf(k), 0.4,
    { contract: k.id, kind: k.kind, breachedBy: byId, period, penalty: k.penalty });
  remember(world, byId, 'money', `You are in breach of ${k.id}: you did not ${why}. `
    + 'Nothing was taken from you for it. What it costs is the next citizen who reads your record.');
  remember(world, other, 'money', `${nameOf(world, byId)} is in breach of ${k.id}: they did not ${why}. `
    + `The instrument's penalty is ${formatLumens(k.penalty)}; suing for it costs money, and is your own decision.`);
}

/** What a missed period reads as, in the words the Chronicle prints. */
function missed(k: Contract): string {
  switch (k.kind) {
    case 'employment': return 'work the shift the term is for';
    case 'lease': return 'pay the rent';
    case 'loan': return 'pay the instalment';
    case 'apprenticeship': return 'pay the training wage';
    case 'patronage': return 'pay the stipend';
    case 'forward': return 'deliver';
    case 'commission': return 'deliver the work';
    default: return 'do what the instrument says';
  }
}

/**
 * The employer's own side of an employment term: the post cannot be cut nor the
 * wage lowered inside it. Where the worker no longer holds a post with that
 * till, the period was missed because the employer took it away, and the breach
 * is the employer's.
 */
function atFault(world: World, k: Contract): CitizenId | null {
  const owed = obligorOf(k);
  if (owed === null) return null;
  if (k.kind === 'employment') {
    const worker = world.citizens[k.offereeId];
    const job = worker?.jobId ? world.jobs[worker.jobId] : null;
    if (!job || job.employer !== k.offerorParty) return k.offerorId;
  }
  return owed;
}

/**
 * The morning's reading of every running instrument: offers that nobody took,
 * terms that ran out, notice that has run, custody that stops the clock, and
 * the periods that went by undischarged.
 */
export function dailyContracts(world: World): void {
  for (const k of allContracts(world)) {
    if (k.status === 'offered' && world.day > k.lapsesDay) {
      k.status = 'lapsed';
      remember(world, k.offereeId, 'money', `${nameOf(world, k.offerorId)}'s offer ${k.id} lapsed unanswered.`);
      continue;
    }
    for (const v of k.variations) {
      if (v.status === 'offered' && world.day > v.lapsesDay) v.status = 'lapsed';
    }
    if (k.status !== 'active' || k.startDay === null) continue;

    // Custody stops the clock. Nothing is due, nothing is missed, and the days
    // are given back at the end of the term.
    if (suspendedForCustody(world, k)) {
      k.suspendedDays += 1;
      k.endsDay = endDay(k);
      continue;
    }
    if (k.noticeById !== null && k.endsDay !== null && world.day >= k.endsDay) {
      if (breachedYesterday(world, k)) continue;
      endOnNotice(world, k);
      continue;
    }
    if (breachedYesterday(world, k)) continue;
    if (world.day > endDay(k)) {
      if (k.performances.length >= k.periods || obligorOf(k) === null) completeContract(world, k);
    }
  }
}

/** A period whose due day has gone by undischarged, and whose fault it was. */
function breachedYesterday(world: World, k: Contract): boolean {
  for (let period = 0; period < k.periods; period += 1) {
    if (isPerformed(k, period)) continue;
    if (world.day <= periodDueDay(k, period)) continue;
    const by = atFault(world, k);
    if (by === null) continue;
    markBreach(world, k, by, period, missed(k));
    return true;
  }
  return false;
}

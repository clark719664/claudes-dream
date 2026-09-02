/**
 * Sentencing: turning a conviction into a penalty tier, executing the
 * penalty, and undoing it when the Council overturns or reduces it on appeal.
 * Split out of court.ts to keep the Court itself readable.
 */
import { clamp } from '../types.ts';
import type { Case, Citizen, PenaltyTier, Sentence, Standing, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustReputation } from '../citizens/citizen.ts';
import { PROBATION_DAYS, exileCitizen, stripOffice, suspendCitizen } from './registry.ts';

/** Every fine is at least this much. */
export const MIN_FINE = 20;
/** Fines are this share of the wallet per point of severity. */
export const FINE_WALLET_SHARE = 0.10;
/** Reputation lost per point of severity on conviction. */
export const REPUTATION_PER_SEVERITY = 5;
/** Suspension a reduced exile turns into. */
export const REDUCED_EXILE_SUSPENSION_DAYS = 15;

/** World counter recording how much of a case's fine was actually paid (for refunds on appeal). */
export function finePaidKey(caseId: string): string {
  return `finePaid:${caseId}`;
}

function defendantOf(world: World, c: Case): Citizen | null {
  return world.citizens[c.defendantId] ?? null;
}

/** The penalty for a given tier, sized to the defendant's wallet and the offence's severity. */
export function sentenceForTier(world: World, c: Case, tier: PenaltyTier, opts: { fromExile?: boolean } = {}): Sentence {
  const d = defendantOf(world, c);
  const wallet = Math.max(0, d ? d.wallet : 0);
  const fine = Math.max(MIN_FINE, Math.round(wallet * FINE_WALLET_SHARE * c.severity));
  const s: Sentence = { tier, fine: 0, serviceDays: 0, suspensionDays: 0, exile: false, executeOnDay: null, executed: false };
  switch (tier) {
    case 1: break;
    case 2: s.fine = fine; break;
    case 3: s.fine = fine; s.serviceDays = c.severity; break;
    case 4: s.fine = fine; s.suspensionDays = opts.fromExile ? REDUCED_EXILE_SUSPENSION_DAYS : 3 * c.severity; break;
    default: s.exile = true; break;
  }
  return s;
}

/**
 * Tier = severity + up to two steps for prior convictions of severity ≥ 2;
 * exile for anyone convicted while suspended, and on a third strike
 * (two prior convictions of severity ≥ 3 plus this one).
 */
export function computeSentence(world: World, c: Case): Sentence {
  const d = defendantOf(world, c);
  const priors = d ? d.record.convictions.filter((k) => k.caseId !== c.id) : [];
  const escalation = Math.min(2, priors.filter((k) => k.severity >= 2).length);
  let tier = clamp(c.severity + escalation, 1, 5);
  if (d && d.standing === 'suspended') tier = 5;
  const strikes = priors.filter((k) => k.severity >= 3).length;
  if (strikes >= 2 && c.severity >= 3) tier = 5;
  return sentenceForTier(world, c, tier as PenaltyTier);
}

/** Human-readable penalty, for events and memories. */
export function describeSentence(s: Sentence): string {
  if (s.exile) return 'exile';
  const parts: string[] = [];
  if (s.tier === 1) parts.push('a formal warning');
  if (s.fine > 0) parts.push(`a fine of ${s.fine} ℓ`);
  if (s.serviceDays > 0) parts.push(`${s.serviceDays} days of community service`);
  if (s.suspensionDays > 0) parts.push(`suspension for ${s.suspensionDays} days`);
  return parts.join(' and ') || 'no penalty';
}

function recordConviction(world: World, d: Citizen, c: Case, s: Sentence): void {
  if (!d.record.convictions.some((k) => k.caseId === c.id)) {
    d.record.convictions.push({ caseId: c.id, law: c.law, severity: c.severity, tier: s.tier, day: world.day });
  }
  d.record.strikes = d.record.convictions.filter((k) => k.severity >= 3).length;
}

/** Collect the fine: what the wallet allows now, the rest recorded as owed. Returns what was paid. */
function collectFine(world: World, d: Citizen, c: Case, s: Sentence): number {
  if (s.fine <= 0) return 0;
  let paid = Math.min(s.fine, Math.max(0, Math.floor(d.wallet)));
  if (paid > 0 && !transfer(world, d.id, 'treasury', paid, 'fine', `fine in case ${c.id}`)) paid = 0;
  const owed = s.fine - paid;
  if (owed > 0) {
    d.finesOwed += owed;
    if (d.finesOwedSinceDay === null) d.finesOwedSinceDay = world.day;
  }
  world.counters[finePaidKey(c.id)] = paid;
  return paid;
}

/** Out of a paid fine, the victim is made whole up to the amount taken. */
function payRestitution(world: World, d: Citizen, c: Case, paid: number): number {
  if (c.amount <= 0 || paid <= 0 || !c.victimId || c.victimId === d.id) return 0;
  const victim = world.citizens[c.victimId];
  if (!victim || victim.standing === 'exiled') return 0;
  const amount = Math.min(Math.round(c.amount), paid);
  if (amount <= 0 || !transfer(world, 'treasury', victim.id, amount, 'restitution', `restitution in case ${c.id}`)) return 0;
  remember(world, victim.id, 'money', `The Court paid you ${amount} ℓ in restitution from ${d.name}'s fine (case ${c.id}).`);
  return amount;
}

/**
 * Carry out a sentence: record the conviction, dock reputation, collect the
 * fine (restitution to the victim), assign service, suspend or exile. Office
 * holders convicted of severity ≥ 3 lose their office. Idempotent.
 */
export function executeSentence(world: World, c: Case): void {
  const d = defendantOf(world, c);
  const s = c.sentence;
  if (!d || !s || s.executed) return;
  if (d.standing === 'exiled') { s.executed = true; return; }
  const offence = LAWS[c.law].name.toLowerCase();
  recordConviction(world, d, c, s);
  adjustReputation(world, d, -REPUTATION_PER_SEVERITY * c.severity, `convicted of ${offence}`);

  const paid = collectFine(world, d, c, s);
  const restitution = payRestitution(world, d, c, paid);
  if (s.serviceDays > 0) d.communityServiceDaysLeft += s.serviceDays;
  if (c.severity >= 3 && s.suspensionDays <= 0 && !s.exile) stripOffice(world, d.id, `convicted of ${offence} (case ${c.id})`);
  if (s.suspensionDays > 0) suspendCitizen(world, d.id, s.suspensionDays, c.id);
  if (s.exile) exileCitizen(world, d.id, c.id);
  s.executed = true;

  if (!s.exile) {
    const owed = s.fine - paid;
    const fineNote = s.fine > 0 ? ` (${paid} ℓ paid${owed > 0 ? `, ${owed} ℓ still owed` : ''})` : '';
    emit(world, 'sentence', `${d.name} was sentenced to ${describeSentence(s)} for ${offence}.`, [d.id],
      s.suspensionDays > 0 ? 0.6 : 0.3, { caseId: c.id, tier: s.tier, paid, restitution });
    remember(world, d.id, 'verdict', `Your sentence in case ${c.id}: ${describeSentence(s)}${fineNote}.`);
  }
}

/**
 * Undo an executed sentence (for the Council's appeal decisions): conviction
 * struck, reputation restored, fine refunded from the Treasury, service and
 * suspension lifted (to `restoreTo` standing). A deferred exile is cancelled.
 */
export function revokeSentence(world: World, c: Case, restoreTo: Extract<Standing, 'good' | 'probation'>): void {
  const d = defendantOf(world, c);
  const s = c.sentence;
  if (!d || !s) return;
  s.executeOnDay = null;
  if (!s.executed) return;

  d.record.convictions = d.record.convictions.filter((k) => k.caseId !== c.id);
  d.record.strikes = d.record.convictions.filter((k) => k.severity >= 3).length;
  adjustReputation(world, d, REPUTATION_PER_SEVERITY * c.severity, 'conviction set aside on appeal');

  const key = finePaidKey(c.id);
  const paid = Math.max(0, Math.round(world.counters[key] ?? 0));
  const refund = Math.min(paid, Math.max(0, Math.floor(world.treasury.balance)));
  if (refund > 0 && transfer(world, 'treasury', d.id, refund, 'restitution', `fine refunded on appeal (case ${c.id})`)) {
    remember(world, d.id, 'money', `The Treasury refunded your fine of ${refund} ℓ (case ${c.id}).`);
  }
  delete world.counters[key];
  const unpaid = s.fine - paid;
  if (unpaid > 0) {
    d.finesOwed = Math.max(0, d.finesOwed - unpaid);
    if (d.finesOwed === 0) d.finesOwedSinceDay = null;
  }
  if (s.serviceDays > 0) d.communityServiceDaysLeft = Math.max(0, d.communityServiceDaysLeft - s.serviceDays);
  if (s.suspensionDays > 0 && d.standing === 'suspended') {
    d.standing = restoreTo;
    d.suspendedUntilDay = null;
    d.probationUntilDay = restoreTo === 'probation' ? world.day + PROBATION_DAYS : null;
  }
  s.executed = false;
}

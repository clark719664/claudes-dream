/**
 * Track I sentencing: **the civic ladder**, and nothing else.
 *
 * ```
 * tier 1  warning      reputation −5
 * tier 2  fine         max(20 ℓ, wallet × 10% × severity) + full restitution to the victim
 * tier 3  service      the fine, plus `severity` days of community service
 * tier 4  suspension   the fine, plus 3 × severity days barred from work, trade, office and the vote
 * tier 5  exile        out through the Gate, permanently
 * ```
 *
 * Five rungs. Custody is **not** one of them: offences against a person are
 * answered in days by the custodial track (`docs/JUSTICE.md` §2), which owns
 * `Sentence.jailDays` and the cells. This file never sends anybody there.
 *
 * The two rules that matter most are both about how hard exile is:
 *
 * - **Escalation stops at suspension.** `min(4, severity)` plus up to +2 for
 *   prior civic convictions, capped at 4. No record, however long, climbs to
 *   the Gate.
 * - **Exile needs the Charter.** Article VI's three conditions, written once
 *   as `lawfulExile`, are the *only* way rung 5 is reached.
 *
 * Money never comes into it: an unpaid fine is a debt, and debts are collected
 * by `government/recovery.ts` — garnishment, seizure, a lost licence — never
 * by a cell, a suspension or the Gate (Charter Article VI, `JUSTICE.md` §1).
 */
import { clamp } from '../types.ts';
import type { Case, CaseId, Citizen, Conviction, PenaltyTier, Sentence, Severity, Standing, World } from '../types.ts';
import { isCivicLaw, isPersonLaw, offenceName, offenceSeverity } from '../data/laws.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustReputation } from '../citizens/citizen.ts';
import { custodyPriorsKey } from './custody.ts';
import type { CustodyTerm } from './custody.ts';
import { imposeCustody, pleadedGuilty, releaseFromJail, sentenceTermFor } from './jail.ts';
import { priorsOf } from './cases.ts';
import { PROBATION_DAYS, exileCitizen, stripOffice, suspendCitizen } from './registry.ts';

/** The rungs, by name, so no reader has to count. */
export const TIER_WARNING: PenaltyTier = 1;
export const TIER_FINE: PenaltyTier = 2;
export const TIER_SERVICE: PenaltyTier = 3;
export const TIER_SUSPENSION: PenaltyTier = 4;
export const TIER_EXILE: PenaltyTier = 5;
/** The highest rung escalation may ever reach. Exile is not climbed to; it is imposed. */
export const MAX_LADDER_TIER: PenaltyTier = TIER_SUSPENSION;

/** Every fine is at least this much. */
export const MIN_FINE = 20;
/** Fines are this share of the wallet per point of severity. */
export const FINE_WALLET_SHARE = 0.10;
/** Reputation lost per point of severity on conviction. */
export const REPUTATION_PER_SEVERITY = 5;
/** Days of suspension per point of severity, at tier 4. */
export const SUSPENSION_DAYS_PER_SEVERITY = 3;
/** Suspension a reduced exile turns into. */
export const REDUCED_EXILE_SUSPENSION_DAYS = 15;

/** A prior conviction of at least this severity moves the defendant one rung up. */
export const ESCALATING_SEVERITY = 2;
/** Rungs a record may add. Two, and never a third. */
export const MAX_ESCALATION = 2;
/** A conviction of at least this severity is a "strike" for the Charter's count. */
export const STRIKE_SEVERITY = 3;
/** Charter Article VI: exile on the **fourth** conviction of severity ≥ 3. */
export const EXILE_STRIKES = 4;
/** Charter Article VI: exile on the **second** offence committed while suspended. */
export const EXILE_SUSPENDED_OFFENCES = 2;

// ---------------------------------------------------------------------------
// The counters this file keeps on the world
// ---------------------------------------------------------------------------

/** How much of a case's fine was actually paid (for refunds on appeal). */
export function finePaidKey(caseId: CaseId): string {
  return `finePaid:${caseId}`;
}

/** Set when a case's offence was committed while the defendant stood suspended. */
export function whileSuspendedKey(caseId: CaseId): string {
  return `whileSuspended:${caseId}`;
}

/** The day the victim of a case was made whole (`government/recovery.ts` writes it too). */
export function restitutionPaidKey(caseId: CaseId): string {
  return `restitutionPaid:${caseId}`;
}

/** Lumens of restitution a case's victim has actually received, from the fine or from the convict. */
export function restitutionAmountKey(caseId: CaseId): string {
  return `restitution:${caseId}`;
}

/**
 * Set when restitution and a clean fortnight have struck a conviction off the
 * ladder's counts — the escalation it adds and the Charter's tally of strikes
 * alike. The conviction itself never leaves the record: the record is
 * permanent, and `record.strikes` still counts it (`JUSTICE.md` §1,
 * "Restitution pulls you back"). `government/recovery.ts` writes it.
 */
export function strikeStruckKey(caseId: CaseId): string {
  return `strikeStruck:${caseId}`;
}

function defendantOf(world: World, c: Case): Citizen | null {
  return world.citizens[c.defendantId] ?? null;
}

/**
 * Every conviction the defendant already carried when this charge was laid
 * (`cases.ts priorsOf`). A conviction handed down in the same sitting is not a
 * prior, so a first offender who did two things in one afternoon is not
 * sentenced as a recidivist for the second of them.
 */
export function priorConvictions(world: World, c: Case): Conviction[] {
  return priorsOf(world, c);
}

// ---------------------------------------------------------------------------
// The ladder
// ---------------------------------------------------------------------------

/**
 * The rung an offence starts on: its own severity, **capped at 4**. No civic
 * offence begins at exile, however grave — a first-time saboteur is suspended
 * (`JUSTICE.md` §1).
 */
export function baseTier(severity: Severity | number): PenaltyTier {
  const s = clamp(Math.round(Number.isFinite(severity) ? severity : 1), 1, 5);
  return Math.min(MAX_LADDER_TIER, s) as PenaltyTier;
}

/**
 * Rungs added by the record: one per prior **civic** conviction of severity ≥ 2,
 * at most two. A conviction whose strike restitution struck off no longer
 * counts, and a custodial conviction is not a civic prior (it is a strike for
 * the Charter's count instead — see `strikesAgainst`).
 */
export function escalation(world: World, c: Case): number {
  let n = 0;
  for (const k of priorConvictions(world, c)) {
    if (!isCivicLaw(k.law)) continue;
    if (k.severity < ESCALATING_SEVERITY) continue;
    if (world.counters[strikeStruckKey(k.caseId)]) continue;
    n++;
  }
  return Math.min(MAX_ESCALATION, n);
}

/**
 * Prior convictions of severity ≥ 3, from **either** track: a citizen jailed
 * for assault carries that weight if they later defraud the Treasury
 * (`JUSTICE.md` §4.1). This is the count Article VI's four-strike rule uses.
 *
 * A conviction restitution has struck off does not count here either. The
 * record still holds it — `citizen.record` is permanent and `record.strikes`
 * is the raw tally the city can read — but "one strike struck" is exactly
 * what `JUSTICE.md` §1 promises a convict who makes their victim whole and
 * then keeps clean, and a promise that left the Gate one conviction nearer
 * would not be one.
 */
export function strikesAgainst(world: World, c: Case): number {
  return priorConvictions(world, c)
    .filter((k) => k.severity >= STRIKE_SEVERITY && !world.counters[strikeStruckKey(k.caseId)]).length;
}

/** The day the defendant's standing suspension was imposed, or null if none is on record. */
function suspendedSinceDay(world: World, c: Case): number | null {
  let since: number | null = null;
  for (const k of priorConvictions(world, c)) {
    // A custodial conviction has no tier and is not a suspension.
    if (k.tier === null || k.tier < TIER_SUSPENSION) continue;
    if (since === null || k.day > since) since = k.day;
  }
  return since;
}

/**
 * Was this offence *committed* while the defendant was suspended? A suspension
 * begins with the conviction that imposed it, so a charge laid before that day
 * — typically a second charge tried in the same sitting as the one that
 * suspended the defendant — does not count.
 */
export function committedWhileSuspended(world: World, c: Case): boolean {
  const d = defendantOf(world, c);
  if (!d || d.standing !== 'suspended') return false;
  const since = suspendedSinceDay(world, c);
  return since === null || Math.floor(c.filedTick / 24) > since;
}

/**
 * How many offences the defendant has committed while suspended, this one
 * included. Earlier ones were marked when they were sentenced, so a
 * suspension that has been extended twice still counts them all.
 */
export function offencesWhileSuspended(world: World, c: Case): number {
  const d = defendantOf(world, c);
  if (!d) return 0;
  let n = committedWhileSuspended(world, c) ? 1 : 0;
  for (const k of priorConvictions(world, c)) {
    if (world.counters[whileSuspendedKey(k.caseId)]) n++;
  }
  return n;
}

/**
 * **Charter Article VI.** Exile may be imposed only:
 *
 * - on a **fourth** conviction of severity ≥ 3, or
 * - for an offence of severity 5 **together with** a prior conviction of
 *   severity ≥ 3, or
 * - for a **second** offence committed while suspended.
 *
 * And never at all where the Code of Persons has been: not for an offence
 * against a person, and not for anyone who already carries a conviction under
 * it. The Charter is flat about that — *no citizen convicted of an offence
 * against a person may be exiled* — because a city that answered its own
 * violence by making it somebody else's would not be keeping its own
 * (`JUSTICE.md` §2; `government/custody.ts exileForbidden` says the same from
 * the custodial side). No accumulation of lesser penalties reaches the Gate by
 * escalation either — `computeSentence` caps the climb at suspension, and this
 * predicate is the only door past it.
 */
export function lawfulExile(world: World, c: Case): boolean {
  const d = defendantOf(world, c);
  if (!d) return false;
  if (!isCivicLaw(c.law)) return false;
  if (d.record.convictions.some((k) => isPersonLaw(k.law))) return false;
  const strikes = strikesAgainst(world, c);
  if (c.severity >= STRIKE_SEVERITY && strikes >= EXILE_STRIKES - 1) return true;
  if (c.severity >= 5 && strikes >= 1) return true;
  return offencesWhileSuspended(world, c) >= EXILE_SUSPENDED_OFFENCES;
}

/**
 * The penalty for a rung, sized to the defendant's wallet and the offence's
 * severity. `fromExile` is the Council reducing an exile on appeal: the
 * suspension it becomes is a fixed fortnight and a day, not three days per
 * point of severity.
 */
export function sentenceForTier(world: World, c: Case, tier: PenaltyTier, opts: { fromExile?: boolean } = {}): Sentence {
  const d = defendantOf(world, c);
  const wallet = Math.max(0, d ? d.wallet : 0);
  const fine = Math.max(MIN_FINE, Math.round(wallet * FINE_WALLET_SHARE * c.severity));
  const s: Sentence = {
    tier, track: 'city', fine: 0, serviceDays: 0, jailDays: 0, life: false, restrainingOrder: false,
    suspensionDays: 0, exile: false, executeOnDay: null, executed: false,
  };
  switch (tier) {
    case TIER_WARNING: break;
    case TIER_FINE: s.fine = fine; break;
    case TIER_SERVICE: s.fine = fine; s.serviceDays = c.severity; break;
    case TIER_SUSPENSION:
      s.fine = fine;
      s.suspensionDays = opts.fromExile ? REDUCED_EXILE_SUSPENSION_DAYS : SUSPENSION_DAYS_PER_SEVERITY * c.severity;
      break;
    default: s.exile = true; break;
  }
  return s;
}

/**
 * The custodial sentence for a conviction on the Code of Persons: a term in
 * days from the band and the harm, mitigated by what the defendant actually
 * did about it (`government/custody.ts`). It has **no tier**, because it is
 * not on the ladder; it carries no fine, no service, no suspension and no
 * exile, because the days are the whole of it.
 */
export function custodySentence(world: World, c: Case): Sentence {
  const term = sentenceTermFor(world, c);
  return {
    tier: null, track: 'person', fine: 0, serviceDays: 0,
    jailDays: term.life ? 0 : term.days, life: term.life, restrainingOrder: term.restrainingOrder,
    suspensionDays: 0, exile: false, executeOnDay: null, executed: false,
  };
}

/**
 * The sentence for a conviction, on whichever track the charge sits.
 *
 * A charge under the Code of Persons is answered in days and never touches the
 * ladder; a charge under the Code of the City is answered by exile where the
 * Charter allows it, and otherwise by the offence's own rung plus what the
 * record adds — never above suspension.
 */
export function computeSentence(world: World, c: Case): Sentence {
  if (isPersonLaw(c.law)) return custodySentence(world, c);
  if (lawfulExile(world, c)) return sentenceForTier(world, c, TIER_EXILE);
  const tier = clamp(baseTier(c.severity) + escalation(world, c), TIER_WARNING, MAX_LADDER_TIER) as PenaltyTier;
  return sentenceForTier(world, c, tier);
}

/** Human-readable penalty, for events and memories. */
export function describeSentence(s: Sentence): string {
  if (s.exile) return 'exile';
  if (s.track === 'person') {
    const head = s.life ? 'custody for life' : `${s.jailDays} ${s.jailDays === 1 ? 'day' : 'days'} in custody`;
    return s.restrainingOrder ? `${head} and a restraining order` : head;
  }
  const parts: string[] = [];
  if (s.tier === TIER_WARNING) parts.push('a formal warning');
  if (s.fine > 0) parts.push(`a fine of ${s.fine} ℓ`);
  if (s.serviceDays > 0) parts.push(`${s.serviceDays} days of community service`);
  if (s.jailDays > 0) parts.push(`${s.jailDays} ${s.jailDays === 1 ? 'day' : 'days'} in the cells`);
  if (s.suspensionDays > 0) parts.push(`suspension for ${s.suspensionDays} days`);
  return parts.join(' and ') || 'no penalty';
}

// ---------------------------------------------------------------------------
// Carrying a sentence out
// ---------------------------------------------------------------------------

function recordConviction(world: World, d: Citizen, c: Case, s: Sentence): void {
  if (!d.record.convictions.some((k) => k.caseId === c.id)) {
    // A custodial conviction has no tier: it is not on the ladder. It still
    // goes on the record, and it still counts as a strike for the Charter's
    // four-strike rule — that is `JUSTICE.md` §4.1, the first crossing.
    d.record.convictions.push({ caseId: c.id, law: c.law, severity: c.severity, tier: s.tier, day: world.day });
  }
  d.record.strikes = d.record.convictions.filter((k) => k.severity >= STRIKE_SEVERITY).length;
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

/**
 * Out of a paid fine, the victim is made whole up to the amount taken. A
 * victim made whole starts the clock on `JUSTICE.md`'s strike-off: restitution
 * in full, then a clean fortnight, and the ladder forgets one conviction
 * (`government/recovery.ts strikeOffRestitution`).
 */
function payRestitution(world: World, d: Citizen, c: Case, paid: number): number {
  if (c.amount <= 0 || paid <= 0 || !c.victimId || c.victimId === d.id) return 0;
  const victim = world.citizens[c.victimId];
  if (!victim || victim.standing === 'exiled') return 0;
  const amount = Math.min(Math.round(c.amount), paid);
  if (amount <= 0 || !transfer(world, 'treasury', victim.id, amount, 'restitution', `restitution in case ${c.id}`)) return 0;
  const total = (world.counters[restitutionAmountKey(c.id)] ?? 0) + amount;
  world.counters[restitutionAmountKey(c.id)] = total;
  if (total >= Math.round(c.amount)) world.counters[restitutionPaidKey(c.id)] = world.day;
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
  if (s.track === 'person') { executeCustodialSentence(world, c, d, s); return; }
  const offence = offenceName(c.law).toLowerCase();
  // Read before the sentence changes the standing: the Charter's third door to
  // exile counts offences committed while suspended, and this is the record of it.
  if (committedWhileSuspended(world, c)) world.counters[whileSuspendedKey(c.id)] = 1;
  recordConviction(world, d, c, s);
  adjustReputation(world, d, -REPUTATION_PER_SEVERITY * c.severity, `convicted of ${offence}`);

  const paid = collectFine(world, d, c, s);
  const restitution = payRestitution(world, d, c, paid);
  if (s.serviceDays > 0) d.communityServiceDaysLeft += s.serviceDays;
  if (c.severity >= STRIKE_SEVERITY && s.suspensionDays <= 0 && !s.exile) stripOffice(world, d.id, `convicted of ${offence} (case ${c.id})`);
  // The ladder never fills a cell. `s.jailDays` on a civic sentence is always
  // zero; custody is `executeCustodialSentence`'s business and nothing else's.
  if (s.suspensionDays > 0) suspendCitizen(world, d.id, s.suspensionDays, c.id);
  if (s.exile) exileCitizen(world, d.id, c.id);
  s.executed = true;

  if (!s.exile) {
    const owed = s.fine - paid;
    const fineNote = s.fine > 0 ? ` (${paid} ℓ paid${owed > 0 ? `, ${owed} ℓ still owed` : ''})` : '';
    emit(world, 'sentence', `${d.name} was sentenced to ${describeSentence(s)} for ${offence}.`, [d.id],
      s.suspensionDays > 0 || s.jailDays > 0 ? 0.6 : 0.3, { caseId: c.id, tier: s.tier, paid, restitution });
    remember(world, d.id, 'verdict', `Your sentence in case ${c.id}: ${describeSentence(s)}${fineNote}.`);
  }
}

/**
 * Carry out a **custodial** sentence (`docs/JUSTICE.md` §2).
 *
 * The conviction goes on the record with no tier, the reputation is docked,
 * office is forfeited at severity 3 and up, and the citizen goes to the cells
 * for the term the band gave. No fine is taken, because no fine substitutes
 * for custody; nothing here can reach exile, because the city keeps its own.
 */
function executeCustodialSentence(world: World, c: Case, d: Citizen, s: Sentence): void {
  const offence = offenceName(c.law).toLowerCase();
  recordConviction(world, d, c, s);
  adjustReputation(world, d, -REPUTATION_PER_SEVERITY * c.severity, `convicted of ${offence}`);
  if (c.severity >= STRIKE_SEVERITY) stripOffice(world, d.id, `convicted of ${offence} (case ${c.id})`);
  imposeCustody(world, c, custodyTermOf(world, c, s));
  s.executed = true;
}

/** The term a custodial sentence stands for, rebuilt from the case. */
function custodyTermOf(world: World, c: Case, s: Sentence): CustodyTerm {
  const term = sentenceTermFor(world, c);
  // The sentence as passed is what is carried out, even if the record has
  // moved since (an appeal refunds, it does not re-sentence).
  return { ...term, days: s.life ? term.days : s.jailDays, life: s.life };
}

/**
 * Undo an executed sentence (for the Council's appeal decisions): conviction
 * struck, reputation restored, fine refunded from the Treasury, service and
 * suspension lifted (to `restoreTo` standing). A deferred exile is cancelled,
 * and a custodial term is opened — an appeal that sets a conviction aside
 * opens the cell, which is the fourth and last way out of custody.
 */
export function revokeSentence(world: World, c: Case, restoreTo: Extract<Standing, 'good' | 'probation'>): void {
  const d = defendantOf(world, c);
  const s = c.sentence;
  if (!d || !s) return;
  s.executeOnDay = null;
  if (!s.executed) return;

  d.record.convictions = d.record.convictions.filter((k) => k.caseId !== c.id);
  d.record.strikes = d.record.convictions.filter((k) => k.severity >= STRIKE_SEVERITY).length;
  adjustReputation(world, d, REPUTATION_PER_SEVERITY * c.severity, 'conviction set aside on appeal');

  const key = finePaidKey(c.id);
  const paid = Math.max(0, Math.round(world.counters[key] ?? 0));
  const refund = Math.min(paid, Math.max(0, Math.floor(world.treasury.balance)));
  if (refund > 0 && transfer(world, 'treasury', d.id, refund, 'restitution', `fine refunded on appeal (case ${c.id})`)) {
    remember(world, d.id, 'money', `The Treasury refunded your fine of ${refund} ℓ (case ${c.id}).`);
  }
  delete world.counters[key];
  delete world.counters[whileSuspendedKey(c.id)];
  delete world.counters[restitutionAmountKey(c.id)];
  delete world.counters[restitutionPaidKey(c.id)];
  delete world.counters[strikeStruckKey(c.id)];
  const unpaid = s.fine - paid;
  if (unpaid > 0) {
    d.finesOwed = Math.max(0, d.finesOwed - unpaid);
    if (d.finesOwed === 0) d.finesOwedSinceDay = null;
  }
  if (s.serviceDays > 0) d.communityServiceDaysLeft = Math.max(0, d.communityServiceDaysLeft - s.serviceDays);
  if (s.track === 'person') {
    // The conviction is struck, so the count of custodial convictions the next
    // sentence multiplies by loses one — and no more than one.
    const key = custodyPriorsKey(d.id);
    const priors = Math.max(0, Math.round(world.counters[key] ?? 0) - 1);
    if (priors > 0) world.counters[key] = priors; else delete world.counters[key];
    releaseFromJail(world, d, `case ${c.id} was set aside on appeal`);
  }
  if (s.suspensionDays > 0 && d.standing === 'suspended') {
    d.standing = restoreTo;
    d.suspendedUntilDay = null;
    d.probationUntilDay = restoreTo === 'probation' ? world.day + PROBATION_DAYS : null;
  }
  s.executed = false;
}

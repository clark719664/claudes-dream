/**
 * The Court: charges and the daily business of justice. Who may sit and what a
 * scripted judge believes live in bench.ts; the two-hour sitting in which the
 * judges vote lives in court-session.ts; sentencing arithmetic in
 * sentencing.ts; appeals in appeals.ts; exile and suspension in registry.ts.
 * The contract's court.* names are all exported from here.
 */
import { clamp } from '../types.ts';
import type { Case, CaseId, Citizen, CitizenId, LawCode, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { detain } from './watch.ts';
import { byFiling, caseNumber, isDetained, latestConviction, nextCourtTick } from './cases.ts';
import { executeSentence, finePaidKey } from './sentencing.ts';
import { APPEAL_WINDOW_DAYS } from './appeals.ts';

export { computeSentence, executeSentence } from './sentencing.ts';
export { APPEAL_WINDOW_DAYS, appealVote, appealsFor, castAppealVote, decideAppeals, fileAppeal } from './appeals.ts';
export { GUILT_THRESHOLD, JUDGE_MIN_REPUTATION, judgeBelief, mustRecuse, selectBench } from './bench.ts';
export {
  MAX_CARRIED_SESSIONS, MIN_VOTES, benchFor, castVerdict, describeVotes, holdCourt, openCourtSession, sittingCases,
  tallyVerdicts,
} from './court-session.ts';
export { courtTallyHour, nextCourtTick } from './cases.ts';

/** Days of unpaid fines before a Contempt charge. */
export const CONTEMPT_AFTER_DAYS = 2;

export interface ChargeSpec {
  defendantId: CitizenId;
  law: LawCode;
  evidence: number;
  filedBy: CitizenId | 'watch';
  victimId?: CitizenId;
  amount?: number;
  description: string;
}

// ---------------------------------------------------------------------------
// Charges
// ---------------------------------------------------------------------------

/** File a charge. Serious, well-evidenced charges put the defendant in the Watch House until the Court sits. */
export function fileCharge(world: World, spec: ChargeSpec): Case {
  const d = world.citizens[spec.defendantId];
  if (!d) throw new Error(`fileCharge: unknown defendant ${spec.defendantId}`);
  const law = LAWS[spec.law] ? spec.law : 'L01';
  const severity = world.government.lawSeverity[law] ?? LAWS[law].severity;
  const evidence = Number.isFinite(spec.evidence) ? clamp(spec.evidence, 0, 1) : 0;
  const victimId = spec.victimId && spec.victimId !== d.id && world.citizens[spec.victimId] ? spec.victimId : null;
  const kase: Case = {
    id: nextId(world, 'k'), defendantId: d.id, law, severity, evidence, filedTick: world.tick, filedBy: spec.filedBy,
    victimId, amount: Math.max(0, Math.round(spec.amount ?? 0)), description: spec.description.slice(0, 280),
    status: 'pending', triedDay: null, judges: [], votes: {}, reasons: {}, openedTick: null, carriedSessions: 0,
    decidedByDefault: false, verdict: null, sentence: null, appeal: null,
  };
  world.cases[kase.id] = kase;

  if (severity >= 4 && evidence >= 0.5) detain(world, d.id, nextCourtTick(world));
  const by = spec.filedBy === 'watch' ? 'The Watch' : (world.citizens[spec.filedBy]?.name ?? 'A citizen');
  emit(world, 'charge', `${by} charged ${d.name} with ${LAWS[law].name.toLowerCase()} (case ${kase.id}).`,
    spec.filedBy === 'watch' ? [d.id] : [d.id, spec.filedBy], severity >= 4 ? 0.7 : 0.4,
    { caseId: kase.id, law, severity, evidence });
  remember(world, d.id, 'crime', `You were charged with ${LAWS[law].name.toLowerCase()} (case ${kase.id}); the Court will hear it at its next sitting.`);
  return kase;
}

// ---------------------------------------------------------------------------
// Daily justice
// ---------------------------------------------------------------------------

/** Exiles whose appeal window passed without an appeal (or whose appeal failed) are carried out. */
function executeDeferredExiles(world: World): void {
  for (const k of Object.values(world.cases)) {
    const s = k.sentence;
    if (!s || !s.exile || s.executed || k.verdict !== 'guilty') continue;
    if (k.status === 'pending' || k.status === 'in_session' || k.status === 'appealed') continue;
    if (s.executeOnDay === null || s.executeOnDay > world.day) continue;
    executeSentence(world, k);
    k.status = 'closed';
  }
}

/** Convictions past their appeal window are closed for good. */
function closeStaleCases(world: World): void {
  for (const k of Object.values(world.cases)) {
    if (k.status !== 'tried' || k.triedDay === null) continue;
    if (world.day - k.triedDay <= APPEAL_WINDOW_DAYS) continue;
    if (k.sentence && !k.sentence.executed) continue;
    k.status = 'closed';
  }
}

/** The citizen's most recent conviction that carried a fine. */
function latestFineCase(world: World, cId: CitizenId): Case | null {
  const k = latestConviction(world, cId);
  return k && k.sentence && k.sentence.fine > 0 ? k : null;
}

/** Collect owed fines as wallets allow; persistent non-payment is Contempt of court. */
function collectOwedFines(world: World, c: Citizen): void {
  if (c.finesOwed <= 0) { c.finesOwedSinceDay = null; return; }
  const pay = Math.min(c.finesOwed, Math.max(0, Math.floor(c.wallet)));
  if (pay > 0 && transfer(world, c.id, 'treasury', pay, 'fine', 'payment of fines owed')) {
    c.finesOwed -= pay;
    const fineCase = latestFineCase(world, c.id);
    if (fineCase) world.counters[finePaidKey(fineCase.id)] = (world.counters[finePaidKey(fineCase.id)] ?? 0) + pay;
    remember(world, c.id, 'money', `You paid ${pay} ℓ toward your fines${c.finesOwed > 0 ? ` (${c.finesOwed} ℓ still owed)` : ''}.`);
  }
  if (c.finesOwed <= 0) { c.finesOwed = 0; c.finesOwedSinceDay = null; return; }
  if (c.finesOwedSinceDay === null) { c.finesOwedSinceDay = world.day; return; }
  if (world.day - c.finesOwedSinceDay < CONTEMPT_AFTER_DAYS) return;
  if (c.standing === 'suspended' || isDetained(world, c)) return;
  const key = `contempt:${latestFineCase(world, c.id)?.id ?? `owed${c.finesOwedSinceDay}`}`;
  if (world.counters[key]) return;
  world.counters[key] = 1;
  fileCharge(world, {
    defendantId: c.id, law: 'L10', evidence: 1, filedBy: 'watch', amount: c.finesOwed,
    description: `Contempt of court: ${c.name} has left ${c.finesOwed} ℓ in fines unpaid for ${world.day - c.finesOwedSinceDay} days`,
  });
}

/** A day of unpaid labour for the city: half the day's dividend is forfeited. */
function serveCommunityService(world: World, c: Citizen): void {
  if (c.communityServiceDaysLeft <= 0) return;
  c.communityServiceDaysLeft -= 1;
  const forfeit = Math.min(Math.round(world.government.dividend / 2), Math.max(0, Math.floor(c.wallet)));
  if (forfeit > 0) transfer(world, c.id, 'treasury', forfeit, 'fine', 'community service: forfeited dividend');
  c.needs.purpose = clamp(c.needs.purpose + 2, 0, 100);
  remember(world, c.id, 'verdict', c.communityServiceDaysLeft > 0
    ? `You served a day of community service (${c.communityServiceDaysLeft} left)${forfeit > 0 ? `; ${forfeit} ℓ of your dividend was forfeited` : ''}.`
    : 'You completed your community service.');
}

/** Judges whose term has run out step down. */
function retireJudges(world: World): void {
  const g = world.government;
  for (const id of [...g.judges]) {
    const judge = world.citizens[id];
    const expired = !judge || (judge.judgeTermEndsDay !== null && judge.judgeTermEndsDay <= world.day);
    if (!expired) continue;
    g.judges = g.judges.filter((j) => j !== id);
    if (!judge) continue;
    if (judge.office === 'judge') judge.office = null;
    judge.judgeTermEndsDay = null;
    emit(world, 'law', `${judge.name}'s term as judge has ended.`, [id], 0.3);
    remember(world, id, 'civic', 'Your term as a judge of the Court has ended.');
  }
}

export function dailyJustice(world: World): void {
  executeDeferredExiles(world);
  closeStaleCases(world);
  for (const id of [...world.order]) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled') continue;
    collectOwedFines(world, c);
    serveCommunityService(world, c);
  }
  retireJudges(world);
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** Charges still awaiting a verdict against a citizen — waiting or before a bench — oldest first. */
export function pendingCasesFor(world: World, cId: CitizenId): Case[] {
  return Object.values(world.cases)
    .filter((k) => k.defendantId === cId && (k.status === 'pending' || k.status === 'in_session'))
    .sort(byFiling);
}

/** The most recently filed case against a citizen, whatever its status. */
export function latestCaseFor(world: World, cId: CitizenId): Case | null {
  let best: Case | null = null;
  for (const k of Object.values(world.cases)) {
    if (k.defendantId !== cId) continue;
    if (!best || k.filedTick > best.filedTick || (k.filedTick === best.filedTick && caseNumber(k.id) > caseNumber(best.id))) best = k;
  }
  return best;
}

/** Whether the citizen currently has a conviction they may still appeal (for observations). */
export function canAppeal(world: World, cId: CitizenId): boolean {
  const k = latestConviction(world, cId);
  return !!k && !k.appeal && k.status === 'tried' && k.triedDay !== null && world.day - k.triedDay <= APPEAL_WINDOW_DAYS;
}

/** Re-exported so callers need only import court.ts. */
export { latestConviction } from './cases.ts';
export { describeSentence } from './sentencing.ts';

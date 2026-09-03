/**
 * The Court: charges, the bench (with recusal), judges' beliefs, verdicts and
 * the daily business of justice. Sentencing arithmetic lives in sentencing.ts,
 * appeals in appeals.ts, exile and suspension in registry.ts; the contract's
 * court.* names are all exported from here.
 */
import { clamp } from '../types.ts';
import type { Case, Citizen, CitizenId, LawCode, Verdict, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { nextId } from '../util/ids.ts';
import { normal, shuffle } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustReputation } from '../citizens/citizen.ts';
import { areFriends, bondBetween } from '../citizens/relationships.ts';
import { areFamily } from '../society/family.ts';
import { detain } from './watch.ts';
import { byFiling, canSit, caseNumber, isDetained, isPresent, latestConviction, nameOf } from './cases.ts';
import { computeSentence, describeSentence, executeSentence, finePaidKey } from './sentencing.ts';
import { APPEAL_WINDOW_DAYS } from './appeals.ts';

export { computeSentence, executeSentence } from './sentencing.ts';
export { APPEAL_WINDOW_DAYS, appealVote, decideAppeals, fileAppeal } from './appeals.ts';

/** A judge votes guilty when their belief in guilt exceeds this. */
export const GUILT_THRESHOLD = 0.55;
/** Days of unpaid fines before a Contempt charge. */
export const CONTEMPT_AFTER_DAYS = 2;
/** Judges (permanent or temporary) need at least this reputation. */
export const JUDGE_MIN_REPUTATION = 60;
const BENCH_SIZE = 3;
const MIN_BENCH = 2;

export interface ChargeSpec {
  defendantId: CitizenId;
  law: LawCode;
  evidence: number;
  filedBy: CitizenId | 'watch';
  victimId?: CitizenId;
  amount?: number;
  description: string;
}

/** Tick of the next Court sitting (today's if it has not happened yet). */
export function nextCourtTick(world: World): number {
  const today = world.day * 24 + world.config.courtHour;
  return world.hour <= world.config.courtHour ? today : today + 24;
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
    status: 'pending', triedDay: null, judges: [], votes: {}, verdict: null, sentence: null, appeal: null,
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
// The bench
// ---------------------------------------------------------------------------

/** Judge and defendant are employer and employee (either way round). */
function employmentTie(world: World, judge: Citizen, defendant: Citizen): boolean {
  const judgeJob = judge.jobId ? world.jobs[judge.jobId] : null;
  const defendantJob = defendant.jobId ? world.jobs[defendant.jobId] : null;
  if (judgeJob && defendant.businessId && judgeJob.employer === defendant.businessId) return true;
  if (defendantJob && judge.businessId && defendantJob.employer === judge.businessId) return true;
  return false;
}

/** Family, friend, employer, employee, accuser, victim or the defendant themself. */
export function mustRecuse(world: World, judgeId: CitizenId, c: Case): boolean {
  const judge = world.citizens[judgeId];
  const d = world.citizens[c.defendantId];
  if (!judge || !d) return true;
  if (judgeId === d.id || judgeId === c.filedBy || judgeId === c.victimId) return true;
  if (areFamily(world, judgeId, d.id)) return true;
  if (c.victimId && areFamily(world, judgeId, c.victimId)) return true;
  if (areFriends(world, judgeId, d.id)) return true;
  return employmentTie(world, judge, d);
}

function holdsOffice(world: World, c: Citizen): boolean {
  const g = world.government;
  return c.office !== null || g.mayorId === c.id || g.council.includes(c.id) || g.judges.includes(c.id) || g.watch.includes(c.id);
}

/** Citizens fit to be drawn as temporary judges. `strict` demands reputation and a clean record. */
function temporaryJudgePool(world: World, c: Case, bench: CitizenId[], strict: boolean): CitizenId[] {
  const out: CitizenId[] = [];
  for (const id of world.order) {
    const cand = world.citizens[id];
    if (!cand || bench.includes(id) || !canSit(world, cand) || mustRecuse(world, id, c)) continue;
    if (strict) {
      if (cand.reputation < JUDGE_MIN_REPUTATION || cand.record.convictions.length > 0 || holdsOffice(world, cand)) continue;
    } else if (cand.reputation < 40 || world.government.judges.includes(id)) {
      continue;
    }
    out.push(id);
  }
  return out;
}

/**
 * The judges who may hear a case: the appointed bench minus recusals. When
 * fewer than two remain, temporary judges are drawn by lot from eligible
 * citizens (then, failing that, from any upstanding citizen) to make three.
 */
export function selectBench(world: World, c: Case): CitizenId[] {
  const bench: CitizenId[] = [];
  for (const id of world.government.judges) {
    const judge = world.citizens[id];
    if (!judge || bench.includes(id) || !canSit(world, judge) || mustRecuse(world, id, c)) continue;
    bench.push(id);
  }
  if (bench.length >= MIN_BENCH) return bench;
  for (const strict of [true, false]) {
    const pool = shuffle(world, temporaryJudgePool(world, c, bench, strict));
    for (const id of pool) {
      if (bench.length >= BENCH_SIZE) break;
      bench.push(id);
    }
    if (bench.length >= MIN_BENCH) break;
  }
  return bench;
}

/**
 * How strongly a judge believes the defendant guilty: the evidence, the
 * defendant's record and reputation, and — because judges are citizens —
 * friendship with the defendant or the victim, plus a dishonest judge's
 * thumb on the scale for friends and against rivals.
 */
export function judgeBelief(world: World, judgeId: CitizenId, c: Case): number {
  const judge = world.citizens[judgeId];
  const d = world.citizens[c.defendantId];
  if (!judge || !d) return 0;
  const bondD = bondBetween(world, judgeId, d.id);
  const bondV = c.victimId ? bondBetween(world, judgeId, c.victimId) : 0;
  const priors = d.record.convictions.filter((k) => k.caseId !== c.id).length;
  let belief = c.evidence;
  belief += priors > 0 ? 0.15 : 0;
  belief -= 0.20 * (bondD / 100);
  belief += 0.10 * (1 - d.reputation / 100);
  belief += 0.10 * (bondV / 100);
  belief += normal(world) * 0.05;
  belief -= (1 - judge.personality.honesty) * 0.1 * Math.sign(bondD);
  return belief;
}

// ---------------------------------------------------------------------------
// Trials
// ---------------------------------------------------------------------------

/** Try one pending case before its bench. */
function tryCase(world: World, k: Case): void {
  const d = world.citizens[k.defendantId];
  const offence = LAWS[k.law].name.toLowerCase();
  if (!d || !isPresent(world, d)) {
    k.status = 'closed';
    k.triedDay = world.day;
    emit(world, 'verdict', `Case ${k.id} against ${nameOf(world, k.defendantId)} was closed: the defendant has left the city.`, [], 0.2, { caseId: k.id });
    return;
  }
  const bench = selectBench(world, k);
  if (bench.length === 0) {
    if (world.counters.noBenchNoticeDay !== world.day) {
      world.counters.noBenchNoticeDay = world.day;
      emit(world, 'law', 'No judge could sit today; pending cases are held over.', [], 0.3);
    }
    return;
  }

  const votes: Record<CitizenId, Verdict> = {};
  let guilty = 0;
  for (const j of bench) {
    const g = judgeBelief(world, j, k) > GUILT_THRESHOLD;
    votes[j] = g ? 'guilty' : 'acquitted';
    if (g) guilty++;
  }
  const verdict: Verdict = guilty * 2 > bench.length ? 'guilty' : 'acquitted';
  k.judges = bench;
  k.votes = votes;
  k.verdict = verdict;
  k.triedDay = world.day;
  k.status = 'tried';
  d.detainedUntilTick = null;
  for (const j of bench) {
    const judge = world.citizens[j];
    if (judge) adjustReputation(world, judge, 1);
  }

  const tally = `${guilty}–${bench.length - guilty}`;
  if (verdict === 'guilty') {
    const s = computeSentence(world, k);
    k.sentence = s;
    if (s.exile) {
      s.executeOnDay = world.day + APPEAL_WINDOW_DAYS;
      emit(world, 'verdict', `The Court found ${d.name} guilty of ${offence} (${tally}) and sentenced them to exile, to be carried out on day ${s.executeOnDay} unless appealed.`,
        [d.id, ...bench], 0.9, { caseId: k.id, verdict, tier: s.tier });
      remember(world, d.id, 'verdict', `The Court found you guilty of ${offence} and sentenced you to EXILE on day ${s.executeOnDay}. You may appeal to the Council today.`);
    } else {
      executeSentence(world, k);
      emit(world, 'verdict', `The Court found ${d.name} guilty of ${offence} (${tally}): ${describeSentence(s)}.`,
        [d.id, ...bench], 0.5, { caseId: k.id, verdict, tier: s.tier });
      remember(world, d.id, 'verdict', `The Court found you guilty of ${offence} (${tally}). You may appeal to the Council within a day.`);
    }
  } else {
    k.status = 'closed';
    emit(world, 'verdict', `The Court acquitted ${d.name} of ${offence} (${tally}).`, [d.id, ...bench], 0.5, { caseId: k.id, verdict });
    remember(world, d.id, 'verdict', `The Court acquitted you of ${offence} (${tally}).`);
  }
  if (k.victimId && k.victimId !== d.id) {
    remember(world, k.victimId, 'verdict', `The Court ${verdict === 'guilty' ? 'convicted' : 'acquitted'} ${d.name} of ${offence} against you (case ${k.id}).`);
  }
  for (const j of bench) {
    remember(world, j, 'verdict', `You sat in judgement on ${d.name} (${offence}) and voted ${votes[j]}; the Court ${verdict === 'guilty' ? 'convicted' : 'acquitted'} them.`);
  }
}

/** The daily sitting: every pending case, oldest first. */
export function holdCourt(world: World): void {
  const pending = Object.values(world.cases).filter((k) => k.status === 'pending').sort(byFiling);
  for (const k of pending) tryCase(world, k);
}

// ---------------------------------------------------------------------------
// Daily justice
// ---------------------------------------------------------------------------

/** Exiles whose appeal window passed without an appeal (or whose appeal failed) are carried out. */
function executeDeferredExiles(world: World): void {
  for (const k of Object.values(world.cases)) {
    const s = k.sentence;
    if (!s || !s.exile || s.executed || k.verdict !== 'guilty') continue;
    if (k.status === 'pending' || k.status === 'appealed') continue;
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

/** Charges awaiting trial against a citizen, oldest first. */
export function pendingCasesFor(world: World, cId: CitizenId): Case[] {
  return Object.values(world.cases).filter((k) => k.defendantId === cId && k.status === 'pending').sort(byFiling);
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

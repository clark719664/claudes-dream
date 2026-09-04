/**
 * The Court's sitting, which runs on the judges' — and the jurors' — own
 * decisions.
 *
 * A sitting lasts two hours. At `courtHour` every pending case is put before a
 * bench (bench.ts chooses who may sit); a charge of severity >= JURY_SEVERITY
 * also has five jurors drawn by lot (jury.ts), and a defendant facing one with
 * nobody to speak for them is given a Public Defender (advocates.ts). Everyone
 * seated votes with the `verdict` action during that hour and the next.
 *
 * At the end of `courtHour + 1` the votes are counted **together**: a juror's
 * vote weighs exactly what a judge's does, a majority of the votes cast
 * convicts, ties acquit, anyone who did not vote abstains, and a case with
 * fewer than two votes is held over to the next sitting. A case held over
 * three times is decided by its bench on the evidence alone, and the Chronicle
 * says that the Court failed to sit.
 *
 * Scripted judges and jurors vote through the same `castVerdict` as everyone
 * else, so the record of a reflex bench and a bench of agents is the same
 * record.
 */
import type { ActionResult, Case, CitizenId, ObservedBenchCase, Verdict, World } from '../types.ts';
import { offenceName, trackOf } from '../data/laws.ts';
import { emit, remember } from '../sim/events.ts';
import { adjustReputation } from '../citizens/citizen.ts';
import { assignDefender } from './advocates.ts';
import { GUILT_THRESHOLD, judgeBelief, selectBench } from './bench.ts';
import { byFiling, canSit, courtTallyHour, isPresent, nameOf, priorsOf } from './cases.ts';
import { castJuryVote, describeJury, fillJuryVotes, juryOf, juryTally, needsJury, seatJury, seatedJurors } from './jury.ts';
import { computeSentence, describeSentence, executeSentence } from './sentencing.ts';
import { APPEAL_WINDOW_DAYS } from './appeals.ts';

/** Votes needed before a bench may decide a case at all. */
export const MIN_VOTES = 2;
/** Sittings a case may be held over for want of votes before a bench decides it anyway. */
export const MAX_CARRIED_SESSIONS = 3;
/** How long a citizen's reason for their vote is kept. */
export const REASON_LENGTH = 280;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** Cases a bench is hearing right now, oldest first. */
export function sittingCases(world: World): Case[] {
  return Object.values(world.cases).filter((k) => k.status === 'in_session').sort(byFiling);
}

/** Judges on this bench who have cast a vote. */
function votesCast(k: Case): CitizenId[] {
  return k.judges.filter((id) => k.votes[id] !== undefined);
}

/** Everyone seated on a case, judges and jurors alike. */
export function seatedOn(world: World, k: Case): CitizenId[] {
  return [...k.judges, ...seatedJurors(world, k)];
}

/** How many of the votes cast — bench and box together — were for guilt, out of how many. */
export function fullTally(world: World, k: Case): { guilty: number; total: number } {
  const bench = votesCast(k);
  const box = juryTally(world, k);
  return {
    guilty: bench.filter((id) => k.votes[id] === 'guilty').length + box.guilty,
    total: bench.length + box.total,
  };
}

/** "Ada guilty, Bram acquitted, Cyd abstained" — how the bench and the box divided, by name. */
export function describeVotes(world: World, k: Case): string {
  const bench = k.judges.map((id) => `${nameOf(world, id)} ${k.votes[id] ?? 'abstained'}`).join(', ');
  const box = juryOf(k).length > 0 ? describeJury(world, k) : '';
  return box ? `${bench}; jury: ${box}` : bench;
}

/** A closed door: the defendant has left Reverie, so there is nothing to try. */
function closeAbsent(world: World, k: Case): void {
  k.status = 'closed';
  k.triedDay = world.day;
  k.openedTick = null;
  emit(world, 'verdict', `Case ${k.id} against ${nameOf(world, k.defendantId)} was closed: the defendant has left the city.`,
    [], 0.2, { caseId: k.id });
}

/** A scripted judge's line: what its formula weighed, said plainly. */
function reflexReason(k: Case, guilty: boolean): string {
  const evidence = Math.round(k.evidence * 100);
  return guilty
    ? `The evidence stands at ${evidence} of 100 and the record carries it.`
    : `The evidence stands at ${evidence} of 100 and does not carry it.`;
}

/**
 * Record one judge's vote. Judges may change their vote until the sitting is
 * counted; the vote and the reason are public the moment they are cast.
 */
export function castVerdict(world: World, judgeId: CitizenId, caseId: string, guilty: boolean, reason?: string): ActionResult {
  const k = world.cases[caseId];
  if (!k) return fail('There is no such case.');
  // A citizen drawn into the box votes as a juror, through the same action.
  if (!k.judges.includes(judgeId) && juryOf(k).includes(judgeId)) {
    return castJuryVote(world, judgeId, caseId, guilty, reason);
  }
  if (k.status !== 'in_session') {
    return fail(k.status === 'pending' ? `Case ${k.id} is not before the Court until its next sitting.` : `Case ${k.id} has already been decided.`);
  }
  const judge = world.citizens[judgeId];
  if (!judge) return fail('Unknown citizen.');
  if (!k.judges.includes(judgeId)) return fail(`You are not sitting on case ${k.id}.`);
  if (!canSit(world, judge)) return fail(`You cannot sit in judgement while ${judge.standing}.`);

  const verdict: Verdict = guilty ? 'guilty' : 'acquitted';
  const changed = k.votes[judgeId] !== undefined && k.votes[judgeId] !== verdict;
  k.votes[judgeId] = verdict;
  const words = (reason ?? '').trim().slice(0, REASON_LENGTH);
  if (words) k.reasons[judgeId] = words;
  else delete k.reasons[judgeId];

  const defendant = nameOf(world, k.defendantId);
  emit(world, 'vote', `Judge ${judge.name} voted ${verdict} in case ${k.id} against ${defendant}${words ? `: "${words}"` : '.'}`,
    [judgeId, k.defendantId], 0.2, { caseId: k.id, judge: judgeId, verdict });
  remember(world, judgeId, 'civic', `You voted ${verdict} in case ${k.id} against ${defendant}${words ? `: "${words}"` : '.'}`);
  return { ok: true, message: `${changed ? 'You changed your vote to' : 'You voted'} ${verdict} in case ${k.id}.` };
}

/** Put one pending case before a bench for this sitting. */
function openCase(world: World, k: Case): void {
  const d = world.citizens[k.defendantId];
  if (!d || !isPresent(world, d)) { closeAbsent(world, k); return; }
  const bench = selectBench(world, k);
  if (bench.length === 0) {
    if (world.counters.noBenchNoticeDay !== world.day) {
      world.counters.noBenchNoticeDay = world.day;
      emit(world, 'law', 'No judge could sit today; pending cases are held over.', [], 0.3);
    }
    return;
  }
  // A vote cast at an earlier sitting stands. A judge no longer on the bench
  // keeps their vote in the record, but it is not counted again.
  k.judges = bench;
  k.status = 'in_session';
  k.openedTick = world.tick;
  // A grave charge is heard in a full room: five citizens drawn by lot sit
  // with the bench, and nobody faces it without somebody to speak for them.
  if (needsJury(world, k)) {
    // The defender is found first: an advocate is never also drawn into the box.
    assignDefender(world, k);
    seatJury(world, k);
  }

  const offence = offenceName(k.law).toLowerCase();
  const names = bench.map((id) => nameOf(world, id)).join(', ');
  emit(world, 'law', `The Court opened case ${k.id} against ${d.name} (${offence}) before ${names}.`,
    [d.id, ...bench], 0.2, { caseId: k.id, judges: bench });
  remember(world, d.id, 'verdict', `Case ${k.id} against you (${offence}) is before the Court today; ${names} sit on it.`);
  for (const id of bench) {
    remember(world, id, 'civic', `Case ${k.id} against ${d.name} (${offence}) is before you today; the Court counts the votes at hour ${courtTallyHour(world)}.`);
    const judge = world.citizens[id];
    if (!judge || judge.brain !== 'reflex' || k.votes[id] !== undefined) continue;
    const guilty = judgeBelief(world, id, k) > GUILT_THRESHOLD;
    castVerdict(world, id, k.id, guilty, reflexReason(k, guilty));
  }
}

/** Open the sitting: every pending case goes before a bench, oldest first. */
export function openCourtSession(world: World): void {
  const pending = Object.values(world.cases).filter((k) => k.status === 'pending').sort(byFiling);
  for (const k of pending) openCase(world, k);
}

/** Nobody voted enough: hold the case over, or — after too many sittings — decide it anyway. */
function carryOrForce(world: World, k: Case, cast: CitizenId[]): boolean {
  k.carriedSessions += 1;
  const d = world.citizens[k.defendantId];
  const name = d?.name ?? nameOf(world, k.defendantId);
  if (k.carriedSessions <= MAX_CARRIED_SESSIONS) {
    k.status = 'pending';
    k.openedTick = null;
    emit(world, 'law', `The Court could not decide case ${k.id} against ${name}: ${cast.length} of ${k.judges.length} judges voted. `
      + `It is held over to the next sitting (${k.carriedSessions} of ${MAX_CARRIED_SESSIONS}).`,
    [k.defendantId, ...k.judges], 0.4, { caseId: k.id, carried: k.carriedSessions });
    if (d) remember(world, d.id, 'verdict', `The Court did not sit on case ${k.id}; it waits for the next sitting.`);
    return false;
  }
  // Held over as long as the Charter allows: the bench decides on the evidence.
  for (const id of k.judges) {
    if (k.votes[id] !== undefined) continue;
    const guilty = judgeBelief(world, id, k) > GUILT_THRESHOLD;
    k.votes[id] = guilty ? 'guilty' : 'acquitted';
    k.reasons[id] = reflexReason(k, guilty);
  }
  k.decidedByDefault = true;
  emit(world, 'law', `Case ${k.id} against ${name} went ${MAX_CARRIED_SESSIONS} sittings without the Court deciding it; `
    + 'a temporary bench weighed the evidence and ruled today.', [k.defendantId, ...k.judges], 0.6,
  { caseId: k.id, byDefault: true });
  return true;
}

/** Count one bench's votes and carry out what they decided. */
function decideCase(world: World, k: Case): void {
  const d = world.citizens[k.defendantId];
  if (!d || !isPresent(world, d)) { closeAbsent(world, k); return; }
  let count = fullTally(world, k);
  if (count.total < MIN_VOTES) {
    if (!carryOrForce(world, k, votesCast(k))) return;
    count = fullTally(world, k);
  }
  const { guilty, total } = count;
  // A juror's vote weighs exactly what a judge's does, and a tie acquits.
  const verdict: Verdict = guilty * 2 > total ? 'guilty' : 'acquitted';
  k.verdict = verdict;
  k.triedDay = world.day;
  k.status = 'tried';
  k.openedTick = null;
  d.detainedUntilTick = null;
  for (const id of votesCast(k)) {
    const judge = world.citizens[id];
    if (judge) adjustReputation(world, judge, 1);
  }
  for (const id of seatedJurors(world, k)) {
    const juror = world.citizens[id];
    if (juror && k.juryVotes?.[id] !== undefined) adjustReputation(world, juror, 1);
  }

  const offence = offenceName(k.law).toLowerCase();
  const tally = `${guilty}–${total - guilty}`;
  const how = `${tally}: ${describeVotes(world, k)}`;
  if (verdict === 'guilty') {
    const s = computeSentence(world, k);
    k.sentence = s;
    if (s.exile) {
      s.executeOnDay = world.day + APPEAL_WINDOW_DAYS;
      emit(world, 'verdict', `The Court found ${d.name} guilty of ${offence} (${how}) and sentenced them to exile, to be carried out on day ${s.executeOnDay} unless appealed.`,
        [d.id, ...k.judges], 0.9, { caseId: k.id, verdict, tier: s.tier, votes: { ...k.votes } });
      remember(world, d.id, 'verdict', `The Court found you guilty of ${offence} (${how}) and sentenced you to EXILE on day ${s.executeOnDay}. You may appeal to the Council today.`);
    } else {
      executeSentence(world, k);
      emit(world, 'verdict', `The Court found ${d.name} guilty of ${offence} (${how}): ${describeSentence(s)}.`,
        [d.id, ...k.judges], 0.5, { caseId: k.id, verdict, tier: s.tier, votes: { ...k.votes } });
      remember(world, d.id, 'verdict', `The Court found you guilty of ${offence} (${how}). You may appeal to the Council within a day.`);
    }
  } else {
    k.status = 'closed';
    emit(world, 'verdict', `The Court acquitted ${d.name} of ${offence} (${how}).`, [d.id, ...k.judges], 0.5,
      { caseId: k.id, verdict, votes: { ...k.votes } });
    remember(world, d.id, 'verdict', `The Court acquitted you of ${offence} (${how}).`);
  }
  if (k.victimId && k.victimId !== d.id) {
    remember(world, k.victimId, 'verdict', `The Court ${verdict === 'guilty' ? 'convicted' : 'acquitted'} ${d.name} of ${offence} against you (case ${k.id}; ${how}).`);
  }
  for (const id of k.judges) {
    remember(world, id, 'verdict', `You sat in judgement on ${d.name} (${offence}) and ${k.votes[id] ? `voted ${k.votes[id]}` : 'did not vote'}; `
      + `the Court ${verdict === 'guilty' ? 'convicted' : 'acquitted'} them (${how}).`);
  }
  for (const id of juryOf(k)) {
    remember(world, id, 'verdict', `You sat as a juror on ${d.name} (${offence}) and ${k.juryVotes?.[id] ? `voted ${k.juryVotes[id]}` : 'did not vote'}; `
      + `the Court ${verdict === 'guilty' ? 'convicted' : 'acquitted'} them (${how}).`);
  }
}

/**
 * Close the sitting: scripted jurors weigh what is before them, then every
 * bench's votes are counted with its box, oldest case first.
 */
export function tallyVerdicts(world: World): void {
  fillJuryVotes(world);
  for (const k of sittingCases(world)) decideCase(world, k);
}

/**
 * A whole sitting in one call: benches chosen and votes counted at once. The
 * city runs the two halves an hour apart (world.ts) so that judges who think
 * for themselves have their hour; this is for callers that want the sitting
 * from end to end.
 */
export function holdCourt(world: World): void {
  openCourtSession(world);
  tallyVerdicts(world);
}

/**
 * The cases before a judge this sitting, as their observation shows them.
 * Called for every citizen every hour, so it walks the case book once and
 * sorts only what it matched.
 */
export function benchFor(world: World, judgeId: CitizenId): ObservedBenchCase[] {
  const mine: Case[] = [];
  for (const k of Object.values(world.cases)) {
    if (k.status === 'in_session' && k.judges.includes(judgeId)) mine.push(k);
  }
  if (mine.length === 0) return [];
  mine.sort(byFiling);
  const out: ObservedBenchCase[] = [];
  for (const k of mine) {
    const d = world.citizens[k.defendantId];
    out.push({
      caseId: k.id, defendant: k.defendantId, defendantName: d?.name ?? k.defendantId,
      law: k.law, lawName: offenceName(k.law), track: trackOf(k.law), severity: k.severity,
      evidence: Math.round(k.evidence * 100) / 100,
      victim: k.victimId, victimName: k.victimId ? nameOf(world, k.victimId) : null,
      description: k.description,
      // What the defendant already carried when this charge was laid. A
      // conviction from this same sitting is not one (`cases.ts priorsOf`).
      priorConvictions: priorsOf(world, k).length,
      bench: [...k.judges], votes: { ...k.votes },
      youVoted: k.votes[judgeId] ?? null, carriedSessions: k.carriedSessions,
      jury: juryOf(k), advocate: k.advocateId ?? null,
      advocateName: k.advocateId ? nameOf(world, k.advocateId) : null,
      asJuror: false,
    });
  }
  return out;
}

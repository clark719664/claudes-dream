/**
 * The jury: five citizens drawn by lot to sit with the bench on the gravest
 * charges (severity ≥ `JURY_SEVERITY`).
 *
 * A juror is not an officer of the court. They are drawn from whoever is here
 * and has no stake in it — not the defendant, not the victim, not the accuser,
 * not family, not a friend or a rival of either side, not the Watch, not the
 * bench, not the advocate — and their vote counts exactly as a judge's does.
 * The verdict of such a case is the majority of **all** the votes cast, judges
 * and jurors together, and a tie acquits.
 *
 * Jurors decide for themselves, through the same `verdict` action a judge
 * uses: `castJuryVote` is where that action lands when the citizen casting it
 * sits in the box rather than on the bench. A scripted juror weighs the case
 * with more noise than a judge and without a judge's thumb on the scale — it
 * has taken no oath and holds no office — and a juror who thinks for itself
 * and says nothing abstains, exactly as a councillor does.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Case, CaseId, Citizen, CitizenId, ObservedBenchCase, Verdict, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { JURY_SEVERITY, JURY_SIZE } from '../data/metropolis.ts';
import { normal, shuffle } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { characterOf } from '../citizens/character.ts';
import { areFriends, areRivals, bondBetween } from '../citizens/relationships.ts';
import { areFamily } from '../society/family.ts';
import { publicDefenders } from './advocates.ts';
import { GUILT_THRESHOLD, judgeBelief } from './bench.ts';
import { byFiling, canSit, isDetained, isPresent, nameOf } from './cases.ts';
import { isJailed } from './jail.ts';

/** How much more a juror's reading wanders than a judge's. */
export const JUROR_NOISE = 0.15;
/** How long a juror's reason is kept. */
export const REASON_LENGTH = 280;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** A charge grave enough for the city to hear it in a full room. */
export function needsJury(world: World, k: Case): boolean {
  return k.severity >= JURY_SEVERITY;
}

/** The jury seated on a case (empty when none was). */
export function juryOf(k: Case): CitizenId[] {
  return k.jury ?? [];
}

/** Officers of the Watch never sit in the box. */
function inTheWatch(world: World, cId: CitizenId): boolean {
  return world.government.watch.includes(cId);
}

/** Too close to either side of this case to weigh it. */
function tooClose(world: World, cId: CitizenId, k: Case): boolean {
  const parties: CitizenId[] = [k.defendantId];
  if (k.victimId) parties.push(k.victimId);
  if (k.filedBy !== 'watch') parties.push(k.filedBy);
  for (const p of parties) {
    if (cId === p) return true;
    if (areFamily(world, cId, p)) return true;
    if (areFriends(world, cId, p) || areRivals(world, cId, p)) return true;
  }
  return false;
}

/**
 * Everyone who may be drawn: adults in good standing, here, free, with no
 * stake in the case and no seat on the bench.
 */
export function eligibleJurors(world: World, k: Case): Citizen[] {
  const out: Citizen[] = [];
  const defenders = new Set(publicDefenders(world).map((c) => c.id));
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.lifeStage === 'child') continue;
    if (c.standing !== 'good') continue;
    if (!canSit(world, c) || isJailed(c) || isDetained(world, c)) continue;
    if (k.judges.includes(id) || juryOf(k).includes(id)) continue;
    if (world.government.judges.includes(id)) continue;
    if (inTheWatch(world, id)) continue;
    // Officers of the court — the advocate on this case, and the Courthouse's
    // Public Defenders, who may be given the next one — do not sit in the box.
    if (k.advocateId === id) continue;
    if (defenders.has(id)) continue;
    if (tooClose(world, id, k)) continue;
    out.push(c);
  }
  return out;
}

/**
 * Draw the jury by lot. A small city seats what it can find and tries the case
 * anyway — a charge is not dropped for want of neighbours — and a city that
 * can find nobody at all is tried by its bench alone.
 */
export function seatJury(world: World, k: Case): CitizenId[] {
  if (!needsJury(world, k)) return [];
  k.jury ??= [];
  k.juryVotes ??= {};
  k.juryReasons ??= {};
  if (k.jury.length > 0) return [...k.jury];

  const pool = eligibleJurors(world, k);
  if (pool.length === 0) {
    emit(world, 'charge', `No juror could be drawn for case ${k.id}; the bench hears it alone.`, [k.defendantId], 0.4,
      { caseId: k.id, jury: [] });
    return [];
  }
  const drawn = shuffle(world, pool.map((c) => c.id)).slice(0, JURY_SIZE);
  k.jury = drawn;

  const d = nameOf(world, k.defendantId);
  const offence = LAWS[k.law]?.name.toLowerCase() ?? k.law;
  const names = drawn.map((id) => nameOf(world, id)).join(', ');
  emit(world, 'charge', `${drawn.length} ${drawn.length === 1 ? 'juror was' : 'jurors were'} drawn by lot for case ${k.id} against ${d} (${offence}): ${names}.`,
    [k.defendantId, ...drawn], 0.4, { caseId: k.id, jury: [...drawn] });
  for (const id of drawn) {
    remember(world, id, 'civic', `You were drawn by lot as a juror on case ${k.id} against ${d} (${offence}); you vote with the bench.`);
  }
  remember(world, k.defendantId, 'verdict', `A jury of ${drawn.length} was drawn for case ${k.id}: ${names}. They vote with the bench.`);
  return [...drawn];
}

/**
 * What a scripted juror makes of a case: a judge's reading of the evidence and
 * the record, with more noise and without the honesty term — a juror holds no
 * office, so there is no oath for a dishonest one to bend.
 */
export function jurorBelief(world: World, jurorId: CitizenId, k: Case): number {
  const juror = world.citizens[jurorId];
  const d = world.citizens[k.defendantId];
  if (!juror || !d) return 0;
  const bondD = bondBetween(world, jurorId, d.id);
  // judgeBelief carries the officer's thumb on the scale; a juror is not an
  // officer, so it is added straight back out again.
  const officerTerm = (1 - characterOf(juror).honesty) * 0.1 * Math.sign(bondD);
  const belief = judgeBelief(world, jurorId, k) + officerTerm + normal(world) * JUROR_NOISE;
  return clamp(belief, 0, 1);
}

/** A juror may change their mind until the sitting is counted. */
export function castJuryVote(world: World, jurorId: CitizenId, caseId: CaseId, guilty: boolean, reason?: string): ActionResult {
  const k = world.cases[caseId];
  if (!k) return fail('There is no such case.');
  if (juryOf(k).length === 0) return fail(`Case ${k.id} is heard by the bench alone; no jury sits on it.`);
  if (!juryOf(k).includes(jurorId)) return fail(`You are not a juror on case ${k.id}.`);
  if (k.status !== 'in_session') {
    return fail(k.status === 'pending'
      ? `Case ${k.id} is not before the Court until its next sitting.`
      : `Case ${k.id} has already been decided.`);
  }
  const juror = world.citizens[jurorId];
  if (!juror) return fail('Unknown citizen.');
  if (!isPresent(world, juror)) return fail('You have left Reverie; you cannot vote on it.');

  k.juryVotes ??= {};
  k.juryReasons ??= {};
  const verdict: Verdict = guilty ? 'guilty' : 'acquitted';
  const changed = k.juryVotes[jurorId] !== undefined && k.juryVotes[jurorId] !== verdict;
  k.juryVotes[jurorId] = verdict;
  const words = (reason ?? '').trim().slice(0, REASON_LENGTH);
  if (words) k.juryReasons[jurorId] = words;
  else delete k.juryReasons[jurorId];

  const d = nameOf(world, k.defendantId);
  emit(world, 'vote', `Juror ${juror.name} voted ${verdict} in case ${k.id} against ${d}${words ? `: "${words}"` : '.'}`,
    [jurorId, k.defendantId], 0.2, { caseId: k.id, juror: jurorId, verdict });
  remember(world, jurorId, 'civic', `You voted ${verdict} as a juror in case ${k.id} against ${d}${words ? `: "${words}"` : '.'}`);
  return { ok: true, message: `${changed ? 'You changed your vote to' : 'You voted'} ${verdict} in case ${k.id}.` };
}

/**
 * Jurors still able to have their vote counted. A juror who has left the city,
 * been suspended, been taken in by the Watch or put in the cells between the
 * draw and the count is not in the room, so they are neither counted for nor
 * voted for: the majority is of the people who are actually sitting there.
 */
export function seatedJurors(world: World, k: Case): CitizenId[] {
  return juryOf(k).filter((id) => {
    const c = world.citizens[id];
    return !!c && isPresent(world, c) && canSit(world, c) && !isJailed(c);
  });
}

/** A scripted juror's line: the evidence, weighed and said plainly. */
function reflexReason(k: Case, guilty: boolean): string {
  const evidence = Math.round(k.evidence * 100);
  return guilty
    ? `As a juror I find the evidence at ${evidence} of 100 enough.`
    : `As a juror I do not find the evidence at ${evidence} of 100 enough.`;
}

/**
 * At the tally: scripted jurors who have not voted weigh the case now. Jurors
 * with minds of their own who said nothing abstain — silence is a position,
 * and the city does not vote for them.
 */
export function fillJuryVotes(world: World): void {
  for (const k of Object.values(world.cases)) {
    if (k.status !== 'in_session' || juryOf(k).length === 0) continue;
    k.juryVotes ??= {};
    k.juryReasons ??= {};
    for (const id of seatedJurors(world, k)) {
      if (k.juryVotes[id] !== undefined) continue;
      const juror = world.citizens[id];
      if (!juror || juror.brain !== 'reflex') continue;
      const guilty = jurorBelief(world, id, k) > GUILT_THRESHOLD;
      castJuryVote(world, id, k.id, guilty, reflexReason(k, guilty));
    }
  }
}

/** The jury's own count: how many of its votes were guilty, out of how many were cast. */
export function juryTally(world: World, k: Case): { guilty: number; total: number } {
  let guilty = 0;
  let total = 0;
  for (const id of seatedJurors(world, k)) {
    const v = k.juryVotes?.[id];
    if (v === undefined) continue;
    total++;
    if (v === 'guilty') guilty++;
  }
  return { guilty, total };
}

/** "Ada guilty, Bram acquitted, Cyd abstained" — how the box divided. */
export function describeJury(world: World, k: Case): string {
  return juryOf(k).map((id) => `${nameOf(world, id)} ${k.juryVotes?.[id] ?? 'abstained'}`).join(', ');
}

/** The cases before a citizen as a juror this sitting, as their observation shows them. */
export function juryFor(world: World, cId: CitizenId): ObservedBenchCase[] {
  const mine: Case[] = [];
  for (const k of Object.values(world.cases)) {
    if (k.status === 'in_session' && juryOf(k).includes(cId)) mine.push(k);
  }
  if (mine.length === 0) return [];
  mine.sort(byFiling);
  return mine.map((k) => {
    const d = world.citizens[k.defendantId];
    return {
      caseId: k.id, defendant: k.defendantId, defendantName: d?.name ?? k.defendantId,
      law: k.law, lawName: LAWS[k.law]?.name ?? k.law, severity: k.severity,
      evidence: Math.round(k.evidence * 100) / 100,
      victim: k.victimId, victimName: k.victimId ? nameOf(world, k.victimId) : null,
      description: k.description,
      priorConvictions: d ? d.record.convictions.filter((x) => x.caseId !== k.id).length : 0,
      bench: [...k.judges], votes: { ...k.votes },
      youVoted: k.juryVotes?.[cId] ?? null, carriedSessions: k.carriedSessions,
      jury: juryOf(k), advocate: k.advocateId ?? null,
      advocateName: k.advocateId ? nameOf(world, k.advocateId) : null,
      asJuror: true,
    };
  });
}

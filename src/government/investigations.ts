/**
 * Detectives, traces and investigations — how the Watch catches what it did
 * not see happen.
 *
 * Every offence nobody noticed still leaves a **trace**: an hour unaccounted
 * for, lumens that came from somewhere, a shopfront that was fine yesterday.
 * A detective on duty may find one, and finding one opens an **investigation**
 * that builds evidence over days until it is strong enough to become a report
 * in the Watch's book — where an officer, as always, decides whether to charge
 * it. Detection is a roll; prosecution is somebody's decision.
 *
 * Officials leave traces too. Appointing a friend to the bench, dropping a
 * report for the citizen who paid you, spending the city's money on kin: each
 * of those calls `noteAbuseOfOffice`, and the trail it leaves is why Abuse of
 * office (L11) is a charge that actually happens rather than a line in the
 * Code nobody ever reaches.
 *
 * The suspect is never told. They learn of it when the charge is filed, like
 * anybody else — an investigation a citizen could see coming would be no
 * investigation at all. Children leave no traces: Reverie does not charge its
 * children, so it does not investigate them either.
 */
import { clamp } from '../types.ts';
import type {
  Citizen, CitizenId, Investigation, LawCode, ObservedInvestigation, World,
} from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { chance, rand } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { isDetained, isPresent, nameOf } from './cases.ts';
import { isJailed } from './jail.ts';
import { openReport } from './reports.ts';

/** How far back a trace is still cold enough to read: a week of hours. */
export const TRACE_WINDOW_TICKS = 168;
/** Evidence one day's work on an investigation adds. */
export const EVIDENCE_PER_SHIFT = 0.12;
/** Evidence at which an investigation becomes a report in the Watch's book. */
export const CHARGE_EVIDENCE = 0.5;
/** Evidence an investigation opens with. */
export const OPENING_EVIDENCE = 0.2;
/** Days without progress after which an investigation is closed unsolved. */
export const STALE_DAYS = 5;
/** What a journalist's scrutiny on the suspect is worth to a detective. */
export const SCRUTINY_MULTIPLIER = 1.5;
/** Weight of the trail an official leaves behind them. */
export const ABUSE_TRACE_WEIGHT = 0.8;

export interface Trace {
  suspectId: CitizenId;
  law: LawCode;
  tick: number;
  weight: number;
}

function abuseKey(cId: CitizenId): string { return `abuse:${cId}`; }
function progressKey(id: string): string { return `invDay:${id}`; }
function pursuedKey(cId: CitizenId): string { return `pursued:${cId}`; }

function book(world: World): Record<string, Investigation> {
  world.investigations ??= {};
  return world.investigations;
}

function severityOf(world: World, law: LawCode): number {
  return world.government.lawSeverity[law] ?? LAWS[law]?.severity ?? 1;
}

/**
 * Still a detective at all: the Watch House post is theirs and they are still
 * in Reverie. Being *off duty* for a day — held, jailed, suspended — is a
 * different thing from being off the force, and the two are not confused: an
 * officer who is back tomorrow keeps their files.
 */
export function stillADetective(world: World, cId: CitizenId): boolean {
  const c = world.citizens[cId];
  if (!c || !c.jobId || !isPresent(world, c)) return false;
  const job = world.jobs[c.jobId];
  return !!job && job.role === 'detective' && job.holderId === c.id;
}

/** Detectives able to work today: the post, good standing, here, free and not in the cells. */
export function detectivesOnDuty(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !stillADetective(world, id)) continue;
    if (c.standing !== 'good' && c.standing !== 'probation') continue;
    if (isJailed(c) || isDetained(world, c)) continue;
    out.push(c);
  }
  return out;
}

/** Every investigation still being worked. */
export function openInvestigations(world: World): Investigation[] {
  return Object.values(book(world)).filter((v) => v.closedDay === null);
}

/** True while somebody is already looking into this citizen. */
export function underInvestigation(world: World, cId: CitizenId): boolean {
  return openInvestigations(world).some((v) => v.suspectId === cId);
}

/**
 * What the city has left lying about: undetected offences inside the trace
 * window, and the trail an official leaves when they use their office.
 */
export function traces(world: World): Trace[] {
  const out: Trace[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.lifeStage === 'child' || !isPresent(world, c)) continue;
    for (const o of c.recentOffences) {
      if (o.detected) continue;
      if (world.tick - o.tick > TRACE_WINDOW_TICKS) continue;
      if (!LAWS[o.law]) continue;
      out.push({ suspectId: c.id, law: o.law, tick: o.tick, weight: clamp(severityOf(world, o.law) / 5, 0.1, 1) });
    }
    const abuse = world.counters[abuseKey(c.id)] ?? 0;
    if (abuse > 0) {
      out.push({ suspectId: c.id, law: 'L11', tick: world.tick, weight: clamp(ABUSE_TRACE_WEIGHT + 0.05 * (abuse - 1), 0, 1) });
    }
  }
  return out;
}

/**
 * One detective's look around. The chance of finding anything rises with what
 * was done, with the detective's own eye for it, and with how loudly the
 * city's journalists have been asking questions.
 */
export function findTrace(world: World, detective: Citizen): { suspectId: CitizenId; law: LawCode } | null {
  const open = traces(world).filter((t) => t.suspectId !== detective.id && !underInvestigation(world, t.suspectId));
  if (open.length === 0) return null;

  // Pick which trail to follow first, weighted by how much of a mark it left.
  const total = open.reduce((sum, t) => sum + t.weight, 0);
  let roll = rand(world) * total;
  let picked = open[open.length - 1];
  for (const t of open) {
    roll -= t.weight;
    if (roll <= 0) { picked = t; break; }
  }

  const scrutiny = world.counters.scrutiny ?? 0;
  const p = clamp(
    0.15 + severityOf(world, picked.law) / 20 + Math.max(0, detective.skills.analysis) / 300 + 0.05 * scrutiny,
    0.05, 0.6,
  );
  return chance(world, p) ? { suspectId: picked.suspectId, law: picked.law } : null;
}

/** Open a file on somebody. Only the detective is told; the suspect is not. */
export function openInvestigation(world: World, detectiveId: CitizenId, suspectId: CitizenId, law: LawCode): Investigation | null {
  const detective = world.citizens[detectiveId];
  const suspect = world.citizens[suspectId];
  if (!detective || !suspect || suspectId === detectiveId) return null;
  if (!isPresent(world, suspect) || suspect.lifeStage === 'child') return null;
  if (!LAWS[law]) return null;
  if (underInvestigation(world, suspectId)) return null;

  const v: Investigation = {
    id: nextId(world, 'v'), suspectId, law, evidence: OPENING_EVIDENCE, openedDay: world.day,
    detectiveId, closedDay: null, caseId: null, reportId: null,
  };
  book(world)[v.id] = v;
  world.counters[progressKey(v.id)] = world.day;

  const offence = LAWS[law].name.toLowerCase();
  emit(world, 'investigation', `The Watch is looking into an act of ${offence} nobody was charged with.`, [], 0.4,
    { investigation: v.id, law });
  remember(world, detectiveId, 'civic',
    `You opened an investigation (${v.id}) into ${suspect.name} for ${offence}; the evidence stands at ${Math.round(v.evidence * 100)} of 100.`);
  return v;
}

/** Close a file, with a line for the record. */
function closeInvestigation(world: World, v: Investigation, reason: string, weight: number): void {
  if (v.closedDay !== null) return;
  v.closedDay = world.day;
  delete world.counters[progressKey(v.id)];
  emit(world, 'investigation', reason, [], weight, { investigation: v.id, law: v.law });
  remember(world, v.detectiveId, 'civic', `Your investigation ${v.id} into ${nameOf(world, v.suspectId)} was closed: ${reason}`);
}

/**
 * A detective's day's work: every file they hold moves on a little, and one
 * that reaches `CHARGE_EVIDENCE` goes to the Watch's book as a report. A
 * detective advances each of their files once a day, whether the work was
 * done on a shift or over the morning's roll.
 */
export function pursue(world: World, detective: Citizen): void {
  if (!detective || (world.counters[pursuedKey(detective.id)] ?? -1) === world.day) return;
  world.counters[pursuedKey(detective.id)] = world.day;

  for (const v of openInvestigations(world)) {
    if (v.detectiveId !== detective.id) continue;
    const suspect = world.citizens[v.suspectId];
    if (!suspect || !isPresent(world, suspect)) {
      closeInvestigation(world, v, `The investigation into ${nameOf(world, v.suspectId)} was closed: they are no longer in Reverie.`, 0.2);
      continue;
    }
    const watched = (world.counters[`scrutiny:${v.suspectId}`] ?? 0) > 0;
    v.evidence = clamp(v.evidence + EVIDENCE_PER_SHIFT * (watched ? SCRUTINY_MULTIPLIER : 1), 0, 1);
    world.counters[progressKey(v.id)] = world.day;
    if (v.evidence < CHARGE_EVIDENCE) {
      remember(world, detective.id, 'civic',
        `You worked your investigation (${v.id}) into ${suspect.name}; the evidence stands at ${Math.round(v.evidence * 100)} of 100.`);
      continue;
    }

    const offence = LAWS[v.law].name.toLowerCase();
    const report = openReport(world, {
      officerId: null, suspectId: v.suspectId, law: v.law, evidence: v.evidence,
      description: `${LAWS[v.law].name}: ${suspect.name}, from Detective ${detective.name}'s investigation ${v.id}`,
    });
    v.reportId = report.id;
    v.closedDay = world.day;
    delete world.counters[progressKey(v.id)];
    emit(world, 'investigation', `Detective ${detective.name} closed an investigation into ${suspect.name} for ${offence} and put it before the Watch (${report.id}).`,
      [detective.id, suspect.id], 0.6, { investigation: v.id, law: v.law, reportId: report.id, evidence: v.evidence });
    remember(world, detective.id, 'civic', `You closed investigation ${v.id} and made a report against ${suspect.name} (${report.id}).`);
  }
}

/**
 * The trail an official leaves when they use their office for somebody. It is
 * not a charge and not a conviction — it is a thing a detective may one day
 * notice, which is exactly what an audit is.
 */
export function noteAbuseOfOffice(world: World, officialId: CitizenId, what: string): void {
  const c = world.citizens[officialId];
  if (!c) return;
  world.counters[abuseKey(officialId)] = (world.counters[abuseKey(officialId)] ?? 0) + 1;
  const line = (what ?? '').replace(/\s+/g, ' ').trim() || 'used your office';
  remember(world, officialId, 'civic', `You ${line}. It is on the record, whether or not anybody has read it yet.`);
}

/** Traces of office abused, for the Watch's own books. */
export function abuseTraceCount(world: World, officialId: CitizenId): number {
  return Math.max(0, Math.round(world.counters[abuseKey(officialId)] ?? 0));
}

/** Files older than a cycle, closed, are cleared out of the book. */
function pruneInvestigations(world: World): void {
  const b = book(world);
  const cycle = Math.max(1, world.config.cycleDays);
  for (const [id, v] of Object.entries(b)) {
    if (v.closedDay !== null && world.day - v.closedDay > cycle) delete b[id];
  }
}

/**
 * The Watch's morning: every detective looks around once, works what they
 * hold, and files that have gone nowhere for `STALE_DAYS` are closed unsolved.
 * An investigation whose detective has left the force is closed too — nobody
 * else inherits somebody's hunch.
 */
export function dailyInvestigations(world: World): void {
  const duty = detectivesOnDuty(world);

  // A file belongs to the detective who opened it. When they leave the force
  // or leave Reverie it is closed — nobody inherits somebody else's hunch —
  // but a detective who is merely off duty today keeps theirs, and the file
  // simply makes no progress until they are back (or goes cold below).
  for (const v of openInvestigations(world)) {
    if (stillADetective(world, v.detectiveId)) continue;
    closeInvestigation(world, v, `The investigation into ${nameOf(world, v.suspectId)} was closed: no detective is on it.`, 0.2);
  }

  for (const detective of duty) {
    const found = findTrace(world, detective);
    if (found) openInvestigation(world, detective.id, found.suspectId, found.law);
  }
  for (const detective of duty) pursue(world, detective);

  for (const v of openInvestigations(world)) {
    const last = world.counters[progressKey(v.id)] ?? v.openedDay;
    if (world.day - last < STALE_DAYS) continue;
    closeInvestigation(world, v, `The investigation into ${nameOf(world, v.suspectId)} was closed unsolved; the trail went cold.`, 0.2);
  }

  pruneInvestigations(world);

  // Yesterday's roll of who has already worked their files does not carry over.
  for (const key of Object.keys(world.counters)) {
    if (key.startsWith('pursued:') && (world.counters[key] ?? 0) < world.day) delete world.counters[key];
  }
}

/** The files a detective holds, as their observation shows them. */
export function investigationsFor(world: World, cId: CitizenId): ObservedInvestigation[] {
  return openInvestigations(world)
    .filter((v) => v.detectiveId === cId)
    .sort((a, b) => a.openedDay - b.openedDay || a.id.localeCompare(b.id))
    .map((v) => ({
      id: v.id, suspect: v.suspectId, suspectName: nameOf(world, v.suspectId),
      law: v.law, lawName: LAWS[v.law]?.name ?? v.law,
      evidence: Math.round(v.evidence * 100) / 100, openedDay: v.openedDay,
    }));
}

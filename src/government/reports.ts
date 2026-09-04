/**
 * The Watch's book of reports.
 *
 * Detection is not prosecution. What an officer sees — or what a citizen tells
 * them — becomes a **report**, and an officer of the Watch decides what
 * becomes of it: `file_charge` puts it before the Court, `drop_report` lets it
 * go with a reason on the record, and a report nobody acts on lapses after a
 * day. Every one of them stays in the book, lapsed ones included, because an
 * officer who quietly sits on evidence is doing something a citizen may report
 * in turn (Abuse of office, L11).
 *
 * A report made by a citizen goes to the Watch's shared inbox (officerId
 * null); any officer may take it up. Scripted officers act on what is before
 * them at the next hour, through the same two functions everyone else uses.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, Citizen, CitizenId, ObservedReport, OffenceCode, Report, ReportId, World,
} from '../types.ts';
import { isCivicLaw, isPersonLaw, isRetiredLaw, offenceName, trackOf } from '../data/laws.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { fileCharge } from './court.ts';
import { nameOf } from './cases.ts';
import { officersOnDuty } from './watch.ts';
import { noteAbuseOfOffice } from './investigations.ts';

/** An unfiled report lapses this many ticks after it was made. */
export const REPORT_EXPIRY_TICKS = 24;
/** Evidence at or above which a scripted officer files a report as a charge. */
export const REFLEX_FILING_EVIDENCE = 0.3;
/** Days an officer who took a bribe looks the other way for the citizen who paid it. */
export const BRIBE_BLIND_DAYS = 1;

function fail(message: string): ActionResult { return { ok: false, message }; }

export interface ReportSpec {
  officerId: CitizenId | null;
  suspectId: CitizenId;
  law: OffenceCode;
  evidence: number;
  victimId?: CitizenId | null;
  amount?: number;
  description: string;
}

function reportsBook(world: World): Record<ReportId, Report> {
  world.reports ??= {};
  return world.reports;
}

/** Open a report. `officerId` null leaves it in the Watch's shared inbox. */
export function openReport(world: World, spec: ReportSpec): Report {
  const book = reportsBook(world);
  const victimId = spec.victimId && spec.victimId !== spec.suspectId && world.citizens[spec.victimId] ? spec.victimId : null;
  const report: Report = {
    id: nextId(world, 'r'),
    officerId: spec.officerId && world.citizens[spec.officerId] ? spec.officerId : null,
    suspectId: spec.suspectId,
    law: isPersonLaw(spec.law) || isCivicLaw(spec.law) || isRetiredLaw(spec.law) ? spec.law : 'L01',
    evidence: Number.isFinite(spec.evidence) ? clamp(spec.evidence, 0, 1) : 0,
    tick: world.tick,
    victimId,
    amount: Math.max(0, Math.round(spec.amount ?? 0)),
    description: spec.description.slice(0, 280),
    status: 'open',
    filedCaseId: null,
    droppedReason: null,
  };
  book[report.id] = report;
  if (report.officerId) {
    remember(world, report.officerId, 'civic',
      `You made a report of ${offenceName(report.law).toLowerCase()} against ${nameOf(world, report.suspectId)} (${report.id}); `
      + `it lapses in ${REPORT_EXPIRY_TICKS} hours unless you file it as a charge.`);
  }
  return report;
}

function reportNumber(id: ReportId): number {
  return Number(id.slice(2)) || 0;
}

/** Every report still waiting on an officer, oldest first. */
export function openReports(world: World): Report[] {
  return Object.values(reportsBook(world))
    .filter((r) => r.status === 'open')
    .sort((a, b) => a.tick - b.tick || reportNumber(a.id) - reportNumber(b.id));
}

/** True while this citizen may act on the Watch's reports. */
export function isOnDuty(world: World, cId: CitizenId): boolean {
  return officersOnDuty(world).some((o) => o.id === cId);
}

/** The reports before one officer: the ones made out to them, and the shared inbox. */
export function reportsFor(world: World, officerId: CitizenId): Report[] {
  if (!isOnDuty(world, officerId)) return [];
  return openReports(world).filter((r) => r.officerId === officerId || r.officerId === null);
}

/** The reports before an officer, as their observation shows them. */
export function observedReportsFor(world: World, cId: CitizenId): ObservedReport[] {
  return reportsFor(world, cId).map((r) => ({
    id: r.id, suspect: r.suspectId, suspectName: nameOf(world, r.suspectId),
    law: r.law, lawName: offenceName(r.law), track: trackOf(r.law), evidence: Math.round(r.evidence * 100) / 100,
    victim: r.victimId, amount: r.amount, description: r.description, tick: r.tick,
    shared: r.officerId === null,
    expiresInTicks: Math.max(0, r.tick + REPORT_EXPIRY_TICKS - world.tick),
  }));
}

/** The report an officer may act on right now, or the reason they may not. */
function reportInHand(world: World, officerId: CitizenId, reportId: ReportId): Report | ActionResult {
  const officer = world.citizens[officerId];
  if (!officer) return fail('Unknown citizen.');
  if (!world.government.watch.includes(officerId)) return fail('Only the Watch acts on reports.');
  if (!isOnDuty(world, officerId)) return fail('You are not on duty.');
  const r = reportsBook(world)[reportId];
  if (!r) return fail('There is no such report.');
  if (r.status !== 'open') return fail(`Report ${r.id} was already ${r.status}.`);
  if (r.officerId !== null && r.officerId !== officerId) return fail(`Report ${r.id} is before ${nameOf(world, r.officerId)}.`);
  return r;
}

function isReport(x: Report | ActionResult): x is Report {
  return !('ok' in x);
}

/** Put a report before the Court as a charge. */
export function fileReport(world: World, officerId: CitizenId, reportId: ReportId): ActionResult {
  const found = reportInHand(world, officerId, reportId);
  if (!isReport(found)) return found;
  const suspect = world.citizens[found.suspectId];
  if (!suspect || suspect.standing === 'exiled' || !world.order.includes(suspect.id)) {
    return fail(`${nameOf(world, found.suspectId)} is no longer in Reverie; there is nobody to charge.`);
  }
  if (found.suspectId === officerId) return fail('You cannot charge yourself.');
  const officer = world.citizens[officerId];
  const kase = fileCharge(world, {
    defendantId: found.suspectId, law: found.law, evidence: found.evidence, filedBy: officerId,
    victimId: found.victimId ?? undefined, amount: found.amount,
    description: `${found.description} — filed by Officer ${officer?.name ?? officerId} from report ${found.id}`,
  });
  found.status = 'filed';
  found.officerId = officerId;
  found.filedCaseId = kase.id;
  remember(world, officerId, 'civic', `You filed report ${found.id} against ${suspect.name} as case ${kase.id}.`);
  return { ok: true, message: `You filed report ${found.id}; the Court will hear case ${kase.id}.` };
}

/** Let a report go. The reason is on the record, and so is who let it go. */
export function dropReport(world: World, officerId: CitizenId, reportId: ReportId, reason: string): ActionResult {
  const found = reportInHand(world, officerId, reportId);
  if (!isReport(found)) return found;
  const words = (reason ?? '').trim().slice(0, 280) || 'no reason given';
  const officer = world.citizens[officerId];
  found.status = 'dropped';
  found.officerId = officerId;
  found.droppedReason = words;
  // A report dropped by an officer in somebody's pocket leaves a trace of its
  // own; a detective may find it later (government/investigations.ts).
  if (isBribedBy(world, officerId, found.suspectId)) {
    noteAbuseOfOffice(world, officerId, `dropped report ${found.id} against ${nameOf(world, found.suspectId)} after a bribe`);
  }
  const suspect = nameOf(world, found.suspectId);
  emit(world, 'law', `Officer ${officer?.name ?? officerId} dropped the report of ${offenceName(found.law).toLowerCase()} against ${suspect} (${found.id}): "${words}".`,
    [officerId, found.suspectId], 0.3, { reportId: found.id, law: found.law, officer: officerId });
  remember(world, officerId, 'civic', `You dropped report ${found.id} against ${suspect}: "${words}".`);
  if (found.victimId) {
    remember(world, found.victimId, 'crime', `The Watch dropped the report of ${offenceName(found.law).toLowerCase()} against ${suspect}: "${words}".`);
  }
  return { ok: true, message: `You dropped report ${found.id}: "${words}".` };
}

/**
 * Reports nobody acted on lapse. The notice names the officer who held it,
 * because a citizen who reads the Chronicle may report that in turn.
 */
export function expireReports(world: World): void {
  for (const r of openReports(world)) {
    if (world.tick - r.tick < REPORT_EXPIRY_TICKS) continue;
    r.status = 'expired';
    const suspect = nameOf(world, r.suspectId);
    const offence = offenceName(r.law).toLowerCase();
    const held = r.officerId ? `unfiled by Officer ${nameOf(world, r.officerId)}` : 'unfiled by the Watch';
    emit(world, 'system', `The report of ${offence} against ${suspect} (${r.id}) lapsed, ${held}.`,
      r.officerId ? [r.officerId, r.suspectId] : [r.suspectId], 0.3,
      { reportId: r.id, law: r.law, officer: r.officerId, expired: true });
    if (r.officerId) remember(world, r.officerId, 'civic', `Report ${r.id} against ${suspect} lapsed in your hands.`);
    if (r.victimId) remember(world, r.victimId, 'crime', `The report of ${offence} against ${suspect} lapsed; the Watch never filed it.`);
  }
}

// ---------------------------------------------------------------------------
// Bribes
// ---------------------------------------------------------------------------

function bribeKey(officerId: CitizenId, briberId: CitizenId): string {
  return `bribed:${officerId}:${briberId}`;
}

/** Record that an officer took money from a citizen; the Watch's book remembers it. */
export function recordBribedOfficer(world: World, officerId: CitizenId, briberId: CitizenId): void {
  world.counters[bribeKey(officerId, briberId)] = world.day;
}

/** True while an officer is looking the other way for the citizen who paid them. */
export function isBribedBy(world: World, officerId: CitizenId, suspectId: CitizenId): boolean {
  const day = world.counters[bribeKey(officerId, suspectId)];
  return day !== undefined && world.day - day <= BRIBE_BLIND_DAYS;
}

/** Old bribes stop working. */
export function pruneBribes(world: World): void {
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('bribed:')) continue;
    if (world.day - (world.counters[key] ?? 0) > BRIBE_BLIND_DAYS) delete world.counters[key];
  }
}

/** An officer who took a bribe from this citizen lets go of what they hold against them. */
export function dropReportsAfterBribe(world: World, officerId: CitizenId, briberId: CitizenId): number {
  let dropped = 0;
  for (const r of openReports(world)) {
    if (r.officerId !== officerId || r.suspectId !== briberId) continue;
    if (dropReport(world, officerId, r.id, 'the evidence would not stand up').ok) dropped++;
  }
  return dropped;
}

// ---------------------------------------------------------------------------
// Scripted officers
// ---------------------------------------------------------------------------

/** A scripted officer's line for the report it will not file. */
function refusalReason(world: World, officer: Citizen, r: Report): string | null {
  if (isBribedBy(world, officer.id, r.suspectId)) return 'the evidence would not stand up';
  if (r.evidence < REFLEX_FILING_EVIDENCE) return `the evidence stands at ${Math.round(r.evidence * 100)} of 100; too thin to charge`;
  return null;
}

/**
 * The Watch's hour. Officers who think for themselves act with `file_charge`
 * and `drop_report` like anybody else; scripted officers deal here with what
 * was put before them before this hour — filing what the evidence supports and
 * dropping the rest, unless somebody has paid them not to.
 */
export function watchSession(world: World): void {
  const duty = officersOnDuty(world).filter((o) => o.brain === 'reflex');
  if (duty.length === 0) return;
  for (const officer of duty) {
    for (const r of reportsFor(world, officer.id)) {
      if (r.tick >= world.tick) continue;
      if (r.suspectId === officer.id) continue;
      const refusal = refusalReason(world, officer, r);
      if (refusal) { dropReport(world, officer.id, r.id, refusal); continue; }
      // A charge that cannot be laid (the suspect has left Reverie) is let go
      // rather than left on the desk to lapse.
      const filed = fileReport(world, officer.id, r.id);
      if (!filed.ok) dropReport(world, officer.id, r.id, filed.message);
    }
  }
}

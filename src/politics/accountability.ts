/**
 * The books both roads to a removal are kept in (`docs/POLITICS.md` §4).
 *
 * A conviction already ends a career: an officeholder convicted at severity 3
 * or above forfeits the seat, and abuse of office is L11. Impeachment
 * (`politics/impeachment.ts`) and recall (`politics/recall.ts`) are the other
 * things — removal for conduct in office that no charge fits, and removal
 * because the city changed its mind. Neither is a conviction: there is no
 * entry on either track and no repute penalty, beyond the one thing a removal
 * does take, which is the credit a full cycle in office would have paid to the
 * contribution column.
 *
 * This file holds what both need: the record, who sits in judgment, what a
 * vacated seat does next, and the one offence a body commits by sitting when
 * it should not (L39).
 */
import type { Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { succeedMayor } from '../government/council.ts';
import { contributionLedger } from '../standing/state.ts';
import { charterOf } from './charter.ts';
import { chargeCharterOffence } from './offences.ts';
import { referendumsOfKind } from './referendums.ts';

/** The five things an article of impeachment may name (`POLITICS.md` §4). */
export type ImpeachmentArticle = 'enrichment' | 'direction' | 'duty' | 'payment' | 'defiance';

export const IMPEACHMENT_ARTICLES: Record<ImpeachmentArticle, string> = {
  enrichment: 'enriching self, household or house out of the office',
  direction: 'directing the Watch at a rival',
  duty: 'refusing a duty the charter imposes',
  payment: 'taking a payment',
  defiance: 'defying a ratified referendum or a Court order',
};

export type ImpeachedOffice = 'mayor' | 'councillor' | 'judge' | 'watch';

export interface Impeachment {
  id: string;
  officerId: CitizenId;
  office: ImpeachedOffice;
  article: ImpeachmentArticle;
  evidence: number;
  broughtBy: CitizenId[];
  laidDay: number | null;
  hearingDay: number | null;
  votes: Record<CitizenId, boolean>;
  result: 'gathering' | 'laid' | 'removed' | 'acquitted' | 'lapsed';
  decidedDay: number | null;
}

export interface Recall {
  id: string;
  officerId: CitizenId;
  signatures: CitizenId[];
  openedDay: number;
  closesDay: number;
  needed: number;
  ballotId: string | null;
  result: 'gathering' | 'ballot' | 'removed' | 'kept' | 'lapsed';
}

export interface Accountability {
  impeachments: Impeachment[];
  recalls: Recall[];
}

/** Days a body may sit past its term before the city calls it what it is. */
export const OVERDUE_DAYS = 3;

export function accountability(world: World): Accountability {
  const w = world as World & { accountability?: Accountability };
  if (!w.accountability) w.accountability = { impeachments: [], recalls: [] };
  if (!Array.isArray(w.accountability.impeachments)) w.accountability.impeachments = [];
  if (!Array.isArray(w.accountability.recalls)) w.accountability.recalls = [];
  return w.accountability;
}

/** The office a citizen holds for these purposes, or null. */
export function officeOf(world: World, cId: CitizenId): ImpeachedOffice | null {
  const g = world.government;
  if (g.mayorId === cId) return 'mayor';
  if (g.council.includes(cId)) return 'councillor';
  if (g.judges.includes(cId)) return 'judge';
  if (g.watchCaptainId === cId) return 'watch';
  return null;
}

function barKey(cId: CitizenId): string { return `barred:${cId}`; }

/** Is this citizen barred from office by a removal, and until when? */
export function barredFromOffice(world: World, cId: CitizenId): number | null {
  const until = world.counters[barKey(cId)];
  return until !== undefined && until > world.day ? until : null;
}

/** Bar a removed officer for the days the charter names. */
export function barFromOffice(world: World, cId: CitizenId, days: number): void {
  world.counters[barKey(cId)] = world.day + Math.max(0, Math.round(days));
}

// ---------------------------------------------------------------------------
// The tribunal
// ---------------------------------------------------------------------------

/** Who sits to hear the articles, by the office they are brought against. */
export function tribunalFor(world: World, im: Impeachment): CitizenId[] {
  const g = world.government;
  const council = new Set<CitizenId>(g.council);
  if (g.mayorId) council.add(g.mayorId);
  const seats = [...council].filter((id) => {
    const c = world.citizens[id];
    return id !== im.officerId && Boolean(c) && isPresent(world, c as Citizen);
  });
  if (im.office === 'judge') {
    const judges = g.judges.filter((id) => id !== im.officerId && world.citizens[id]);
    return [...new Set([...seats, ...judges])];
  }
  return seats;
}

/** The ayes it takes: the charter's fraction of the whole tribunal, or a simple majority. */
export function impeachmentNeeded(world: World, im: Impeachment): number {
  const size = tribunalFor(world, im).length;
  if (size === 0) return 1;
  if (im.office === 'watch') return Math.floor(size / 2) + 1;
  return Math.max(1, Math.ceil(charterOf(world).impeachment.threshold * size));
}

// ---------------------------------------------------------------------------
// What a vacated seat does next
// ---------------------------------------------------------------------------

/** Vacate the seat, however the officer came to lose it. */
export function vacateOffice(world: World, officerId: CitizenId, office: ImpeachedOffice): string {
  const g = world.government;
  const officer = world.citizens[officerId];
  if (!officer) return '';
  switch (office) {
    case 'mayor': {
      g.mayorId = null;
      officer.office = g.council.includes(officer.id) ? 'councillor' : g.watch.includes(officer.id) ? 'watch' : null;
      const next = succeedMayor(world, officer.id);
      return next ? `${next.name} succeeds to the chair.` : 'The chair stands empty.';
    }
    case 'councillor':
      g.council = g.council.filter((id) => id !== officer.id);
      if (g.mayorId === officer.id) g.mayorId = null;
      officer.office = g.watch.includes(officer.id) ? 'watch' : null;
      return 'The seat is empty until the city fills it.';
    case 'judge':
      g.judges = g.judges.filter((id) => id !== officer.id);
      officer.judgeTermEndsDay = null;
      if (officer.office === 'judge') officer.office = g.watch.includes(officer.id) ? 'watch' : null;
      return 'The bench is one short until it is filled.';
    default:
      if (g.watchCaptainId === officer.id) g.watchCaptainId = null;
      return 'The Watch has no captain until one is named.';
  }
}

/**
 * The cycle a removed officer was serving pays nothing to the contribution
 * column: the repute a full cycle would have paid never arrives
 * (`docs/CITIZENSHIP.md` §1). Nothing already earned is taken back.
 */
export function denyCycleCredit(world: World, officerId: CitizenId, office: ImpeachedOffice): void {
  const l = contributionLedger(world, officerId);
  const g = world.government;
  if (office === 'judge') { l.judgeTermEnd = null; return; }
  if (l.lastCycleCounted !== g.cycle) { l.lastCycleCounted = g.cycle; return; }
  if (office === 'mayor' && l.mayorCycles > 0) l.mayorCycles -= 1;
  else if (l.councilCycles > 0) l.councilCycles -= 1;
}

// ---------------------------------------------------------------------------
// Sitting unlawfully
// ---------------------------------------------------------------------------

/**
 * L39: holding office after removal, or a body sitting past its term with no
 * election called. Both are read off the public record — the bar the tribunal
 * set, and the election day the charter fixed — and neither is a matter of
 * anybody's opinion.
 */
export function dailySitting(world: World): void {
  const g = world.government;
  for (const id of [...g.council, ...(g.mayorId ? [g.mayorId] : []), ...g.judges]) {
    if (barredFromOffice(world, id) === null) continue;
    const key = `sitting:${id}:${g.cycle}`;
    if (world.counters[key] !== undefined) continue;
    world.counters[key] = world.day;
    chargeCharterOffence(world, id, 'L39', { what: 'holding office while barred from it' });
  }
  const e = g.election;
  const overdue = !e.resolved && world.day > e.electionDay + OVERDUE_DAYS;
  if (!overdue || charterOf(world).term === 0) return;
  const key = `sitting:overdue:${g.cycle}`;
  if (world.counters[key] !== undefined) return;
  world.counters[key] = world.day;
  const answerable = g.mayorId ?? g.council[0] ?? null;
  if (answerable) {
    chargeCharterOffence(world, answerable, 'L39', {
      what: `a Council sitting ${world.day - e.electionDay} days past its term with no election held`,
    });
  }
}

/** Tell the officer, the tribunal and the city one line, once. */
export function announceRemoval(world: World, officerId: CitizenId, text: string, told: CitizenId[]): void {
  emit(world, 'law', text, [officerId, ...told], 1.0, { officer: officerId, removed: true });
  remember(world, officerId, 'civic', text);
  for (const id of told) remember(world, id, 'civic', text);
}

// ---------------------------------------------------------------------------
// What a citizen reads
// ---------------------------------------------------------------------------

export interface ObservedAccountability {
  impeachments: {
    id: string; officer: string; article: string; evidence: number;
    broughtBy: string[]; hearingDay: number | null; youSit: boolean;
  }[];
  recalls: { id: string; officer: string; signatures: number; needed: number; youSigned: boolean; ballotDay: number | null }[];
  /** Set while this citizen may not hold office. */
  barredUntil: number | null;
}

export function accountabilityObservation(world: World, c: Citizen | null): ObservedAccountability {
  const book = accountability(world);
  const ballots = referendumsOfKind(world, 'recall');
  return {
    impeachments: book.impeachments
      .filter((im) => im.result === 'gathering' || im.result === 'laid')
      .map((im) => ({
        id: im.id,
        officer: world.citizens[im.officerId]?.name ?? im.officerId,
        article: IMPEACHMENT_ARTICLES[im.article],
        evidence: im.evidence,
        broughtBy: im.broughtBy.map((id) => world.citizens[id]?.name ?? id),
        hearingDay: im.hearingDay,
        youSit: Boolean(c) && tribunalFor(world, im).includes((c as Citizen).id),
      })),
    recalls: book.recalls
      .filter((r) => r.result === 'gathering' || r.result === 'ballot')
      .map((r) => ({
        id: r.id,
        officer: world.citizens[r.officerId]?.name ?? r.officerId,
        signatures: r.signatures.length,
        needed: r.needed,
        youSigned: Boolean(c) && r.signatures.includes((c as Citizen).id),
        ballotDay: r.ballotId ? ballots.find((b) => b.id === r.ballotId)?.day ?? null : null,
      })),
    barredUntil: c ? barredFromOffice(world, c.id) : null,
  };
}

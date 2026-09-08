/**
 * `GET /api/history` — the city's memory (`docs/UI.md` §10).
 *
 * Four things come out of here. The **timeline**: one list of markers, each
 * tagged with what kind of day it was — an era opening, an election, an
 * exile, a disaster, a monument, a record, a memorial, or simply a day the
 * Chronicle led with. The **Hall of Records**, each entry with the number
 * that holds it and the face that owns it. The **memorials**, which are the
 * one thing in Reverie that outlasts a citizen. And a per-day **statistics
 * series** for the scrubber, so an observer can wind the city back and watch
 * any day's numbers again.
 *
 * Read-only. Nothing here raises a stone, names an era or beats a record.
 */
import type {
  Citizen, CitizenId, CityRecord, DailyStats, Disaster, Era, Memorial, Monument, World, WorldEvent,
} from '../types.ts';
import { RECORD_SPECS, historyView } from '../world/history.ts';
import { epithet } from '../identity/biography.ts';
import { LAWS } from '../data/laws.ts';
import { nameOf, personCard, personCards, portraitPath, presentSet } from './views.ts';

/** Days of statistics the scrubber gets. */
export const STATS_SERIES_LENGTH = 500;
/** Entries on the timeline. */
export const TIMELINE_LENGTH = 200;
/** How heavy an event must be to earn a place on the timeline. */
export const TIMELINE_WEIGHT = 0.6;
/** How heavy a plain event must be to stand beside the city's own landmarks. */
export const STORY_WEIGHT = 0.8;
/** Faces carried by one marker. */
export const MARKER_FACES = 3;
/** Election results kept, newest first. */
export const ELECTIONS_SHOWN = 20;
/** Candidates named in one result. */
export const RESULT_NAMES = 6;

const round2 = (n: number): number => Math.round(n * 100) / 100;

/** What each record is counted in; the Hall keeps the number, the spec the unit. */
const RECORD_UNITS: Record<string, string> = Object.fromEntries(
  RECORD_SPECS.map((s) => [s.key, s.unit]),
);

/** The kinds of event the timeline already has a landmark for. */
const COVERED_KINDS = new Set(['exile', 'election', 'monument', 'sunset', 'history', 'disaster']);

// ---------------------------------------------------------------------------
// Eras
// ---------------------------------------------------------------------------

/** The day's numbers, or the newest ones for a day the series no longer holds. */
function statsOn(byDay: Map<number, DailyStats>, day: number): Record<string, unknown> | null {
  const s = byDay.get(day);
  if (!s) return null;
  return {
    day: s.day, population: s.population, treasury: s.treasury,
    approval: s.approval, priceIndex: s.priceIndex, exiles: s.exiles,
  };
}

function eraView(
  world: World, e: Era, present: Set<CitizenId>, byDay: Map<number, DailyStats>,
): Record<string, unknown> {
  const mayor = e.mayorId ? world.citizens[e.mayorId] ?? null : null;
  const lastDay = e.toDay ?? world.day;
  return {
    cycle: e.cycle, name: e.name, fromDay: e.fromDay, toDay: e.toDay,
    days: lastDay - e.fromDay + 1,
    current: e.toDay === null,
    mayor: personCard(world, e.mayorId, present),
    mayorEpithet: mayor ? epithet(world, mayor) : null,
    // Where the city stood as the era closed: the one number a band on a
    // timeline can carry without becoming a chart.
    stats: statsOn(byDay, lastDay) ?? statsOn(byDay, lastDay - 1),
  };
}

// ---------------------------------------------------------------------------
// The Hall of Records
// ---------------------------------------------------------------------------

function recordView(world: World, r: CityRecord, present: Set<CitizenId>): Record<string, unknown> {
  return {
    key: r.key, label: r.label, value: r.value, day: r.day,
    unit: RECORD_UNITS[r.key] ?? '',
    holderId: r.holderId, holder: r.holderId ? nameOf(world, r.holderId) : null,
    portrait: r.holderId ? portraitPath(r.holderId) : null,
    who: personCard(world, r.holderId, present),
  };
}

// ---------------------------------------------------------------------------
// Elections
// ---------------------------------------------------------------------------

interface ResultRow { candidateId?: unknown; votes?: unknown }

/**
 * A result as the returning officer emitted it. The engine keeps no book of
 * past elections — the event log is the record — so an election older than
 * the log survives only as the era it opened.
 */
function electionView(world: World, e: WorldEvent, present: Set<CitizenId>): Record<string, unknown> {
  const data = e.data ?? {};
  const rows = Array.isArray(data.results) ? (data.results as ResultRow[]) : [];
  return {
    day: e.day, tick: e.tick, text: e.text,
    cycle: typeof data.cycle === 'number' ? data.cycle : null,
    turnout: typeof data.turnout === 'number' ? data.turnout : null,
    seated: personCards(world, e.actors, present, MARKER_FACES),
    results: rows.slice(0, RESULT_NAMES).map((r) => ({
      candidateId: r.candidateId, name: nameOf(world, String(r.candidateId ?? '')) ?? String(r.candidateId ?? ''),
      votes: typeof r.votes === 'number' ? r.votes : 0,
    })),
  };
}

const ELECTED_MAYOR = /elected Mayor/i;
const TOOK_A_SEAT = /took a seat on the Council/i;

/**
 * The elections the log has forgotten. The event log is bounded, so a city a
 * few weeks old has already dropped the day it chose its first Mayor — but
 * the citizens who won keep the milestone for life, and a day on which
 * somebody was elected Mayor or seated on the Council was an election day.
 */
function electionDays(world: World): Map<number, { mayorId: CitizenId | null; seated: CitizenId[] }> {
  const byDay = new Map<number, { mayorId: CitizenId | null; seated: CitizenId[] }>();
  for (const c of Object.values(world.citizens)) {
    for (const m of c.milestones ?? []) {
      const mayor = ELECTED_MAYOR.test(m.text);
      if (!mayor && !TOOK_A_SEAT.test(m.text)) continue;
      const row = byDay.get(m.day) ?? { mayorId: null, seated: [] };
      if (mayor) row.mayorId = c.id;
      else row.seated.push(c.id);
      byDay.set(m.day, row);
    }
  }
  return byDay;
}

/** What the city can still say about an election the log no longer holds. */
function recalledElection(
  world: World, day: number, row: { mayorId: CitizenId | null; seated: CitizenId[] }, present: Set<CitizenId>,
): Record<string, unknown> {
  const mayor = row.mayorId ? nameOf(world, row.mayorId) : null;
  const seats = row.seated.length;
  const text = `Election day ${day}: ${mayor ? `${mayor} took the Mayor's chair` : 'the Council was seated'}`
    + `${seats > 0 ? `, with ${seats} ${seats === 1 ? 'councillor' : 'councillors'} beside them` : ''}.`;
  return {
    day, tick: null, text, cycle: null, turnout: null,
    seated: personCards(world, [...(row.mayorId ? [row.mayorId] : []), ...row.seated], present, MARKER_FACES),
    results: [],
  };
}

/**
 * Every election the city can still account for, newest first: the ones the
 * log still has, with their turnout and their tally, and then the ones only
 * the winners remember.
 */
function elections(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const days = new Set<number>();
  for (let i = world.events.length - 1; i >= 0 && out.length < ELECTIONS_SHOWN; i--) {
    const e = world.events[i];
    if (e.kind !== 'election' || e.weight < 0.9) continue;
    days.add(e.day);
    out.push(electionView(world, e, present));
  }
  for (const [day, row] of electionDays(world)) {
    if (days.has(day)) continue;
    days.add(day);
    out.push(recalledElection(world, day, row, present));
  }
  out.sort((a, b) => (b.day as number) - (a.day as number));
  return out.slice(0, ELECTIONS_SHOWN);
}

// ---------------------------------------------------------------------------
// The timeline
// ---------------------------------------------------------------------------

/**
 * One marker. `category` says which lane it belongs in and `weight` how loud
 * the day was; everything on the timeline is a day the city would have led
 * with, so nothing here is lighter than TIMELINE_WEIGHT.
 */
function marker(
  id: string, category: string, day: number, text: string, weight: number,
  extra?: Record<string, unknown>,
): Record<string, unknown> {
  return { id, category, day, text, weight: round2(Math.max(TIMELINE_WEIGHT, weight)), who: [], ...extra };
}

function disasterText(world: World, d: Disaster): string {
  const where = d.district ? world.districts[d.district]?.name ?? d.district : 'the city';
  const kind = String(d.kind).replace(/_/g, ' ');
  return `${/^[aeiou]/i.test(kind) ? 'An' : 'A'} ${kind} struck ${where}.`;
}

function memorialText(world: World, m: Memorial): string {
  const name = nameOf(world, m.citizenId) ?? m.citizenId;
  return `${name}: ${m.epitaph}`;
}

function monumentText(world: World, m: Monument): string {
  const name = nameOf(world, m.honoreeId) ?? m.honoreeId;
  return `A statue of ${name} in Central Plaza: "${m.inscription}"`;
}

/**
 * Every marker the city keeps, newest first: its landmarks (which are kept
 * forever, whatever the event log has dropped) and then the heaviest of the
 * days in between, until the timeline is full.
 */
function timeline(
  world: World, present: Set<CitizenId>, byDay: Map<number, DailyStats>, polls: Record<string, unknown>[],
): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const cards = (ids: readonly CitizenId[]) => personCards(world, ids, present, MARKER_FACES);
  const one = (id: CitizenId | null) => {
    const card = id ? personCard(world, id, present) : null;
    return card ? [card] : [];
  };

  for (const e of world.eras ?? []) {
    out.push(marker(`era:${e.cycle}`, 'era', e.fromDay, `${e.name} opened.`, 0.7, {
      who: one(e.mayorId), cycle: e.cycle, name: e.name, toDay: e.toDay,
      days: (e.toDay ?? world.day) - e.fromDay + 1,
    }));
  }
  for (const el of polls) {
    out.push(marker(`election:${el.day}`, 'election', el.day as number, el.text as string, 1, {
      who: el.seated, turnout: el.turnout, cycle: el.cycle, results: el.results,
    }));
  }
  for (const b of world.bans) {
    const law = LAWS[b.law]?.name ?? b.law;
    const pardon = b.pardonedDay === null ? '' : ` Pardoned on day ${b.pardonedDay}.`;
    out.push(marker(`exile:${b.citizenId}:${b.day}`, 'exile', b.day,
      `${b.name} went through the Gate for ${law.toLowerCase()}.${pardon}`, 0.9, {
        who: one(b.citizenId), citizenId: b.citizenId, caseId: b.caseId, law: b.law, lawName: law,
        pardonedDay: b.pardonedDay, portrait: portraitPath(b.citizenId),
      }));
  }
  for (const d of world.disasters ?? []) {
    out.push(marker(`disaster:${d.kind}:${d.day}:${d.district ?? 'city'}`, 'disaster', d.day,
      disasterText(world, d), Math.min(0.9, 0.6 + d.severity * 0.1), {
        kind: d.kind, severity: round2(d.severity), district: d.district,
        resolvedDay: d.resolvedDay, active: d.resolvedDay === null,
      }));
  }
  for (const m of world.monuments ?? []) {
    out.push(marker(`monument:${m.id}`, 'monument', m.day, monumentText(world, m), 0.8, {
      who: one(m.honoreeId), inscription: m.inscription, honoreeId: m.honoreeId,
    }));
  }
  for (const m of world.memorials ?? []) {
    out.push(marker(`memorial:${m.citizenId}`, 'memorial', m.day, memorialText(world, m), 0.95, {
      who: one(m.citizenId), epitaph: m.epitaph, citizenId: m.citizenId,
    }));
  }
  for (const r of world.records ?? []) {
    out.push(marker(`record:${r.key}:${r.day}`, 'record', r.day,
      `${r.label}: ${r.holderId ? nameOf(world, r.holderId) ?? r.holderId : 'the city'}, ${r.value} ${RECORD_UNITS[r.key] ?? ''}`.trim(),
      0.6, { who: one(r.holderId), key: r.key, label: r.label, value: r.value }));
  }

  // Then the days in between, heaviest kinds first, until the timeline is full.
  const seen = new Set(out.map((m) => `${m.day}:${m.text}`));
  for (let i = world.events.length - 1; i >= 0 && out.length < TIMELINE_LENGTH; i--) {
    const e: WorldEvent = world.events[i];
    if (e.weight < STORY_WEIGHT || COVERED_KINDS.has(e.kind)) continue;
    const key = `${e.day}:${e.text}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(marker(`story:${e.tick}:${i}`, 'story', e.day, e.text, e.weight, {
      who: cards(e.actors), kind: e.kind, tick: e.tick,
    }));
  }

  out.sort((a, b) => (b.day as number) - (a.day as number) || (b.weight as number) - (a.weight as number)
    || String(a.id).localeCompare(String(b.id)));
  const kept = out.slice(0, TIMELINE_LENGTH);
  for (const m of kept) m.stats = statsOn(byDay, m.day as number);
  return kept;
}

// ---------------------------------------------------------------------------
// The view
// ---------------------------------------------------------------------------

/** `GET /api/history`. */
export function historyApiView(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const { eras, records, monuments, memorials } = historyView(world);
  const series = world.stats.slice(-STATS_SERIES_LENGTH);
  const byDay = new Map<number, DailyStats>(series.map((s) => [s.day, s]));
  const disasters = [...(world.disasters ?? [])].sort((a, b) => b.day - a.day);
  const polls = elections(world, present);
  const epitaphFor = (id: CitizenId): string | null => {
    const c: Citizen | undefined = world.citizens[id];
    return c ? epithet(world, c) : null;
  };
  return {
    day: world.day, year: world.year ?? 0, cycle: world.government.cycle,
    cycleDays: world.config.cycleDays,
    eras: [...eras].sort((a, b) => b.fromDay - a.fromDay).map((e) => eraView(world, e, present, byDay)),
    records: [...records].sort((a, b) => a.key.localeCompare(b.key)).map((r) => recordView(world, r, present)),
    monuments: [...monuments].sort((a, b) => b.day - a.day).map((m) => ({
      id: m.id, day: m.day, inscription: m.inscription,
      honoree: personCard(world, m.honoreeId, present),
    })),
    memorials: [...memorials].sort((a, b) => b.day - a.day).map((m) => ({
      citizenId: m.citizenId, day: m.day, epitaph: m.epitaph,
      who: personCard(world, m.citizenId, present),
      epithet: epitaphFor(m.citizenId),
    })),
    disasters: disasters.map((d) => ({
      kind: d.kind, day: d.day, severity: round2(d.severity), resolvedDay: d.resolvedDay,
      district: d.district, districtName: d.district ? world.districts[d.district]?.name ?? d.district : null,
      active: d.resolvedDay === null,
    })),
    exiles: [...world.bans].sort((a, b) => b.day - a.day).map((b) => ({
      citizenId: b.citizenId, name: b.name, lineage: b.lineage, day: b.day, caseId: b.caseId,
      law: b.law, lawName: LAWS[b.law]?.name ?? b.law, pardonedDay: b.pardonedDay,
      portrait: portraitPath(b.citizenId),
      who: personCard(world, b.citizenId, present),
    })),
    elections: polls,
    stats: {
      firstDay: series.length > 0 ? series[0].day : null,
      lastDay: series.length > 0 ? series[series.length - 1].day : null,
      totalDays: world.stats.length,
      series,
    },
    timeline: timeline(world, present, byDay, polls),
  };
}

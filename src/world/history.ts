/**
 * The Hall of Records: what Reverie will remember.
 *
 * Three things are kept here. **Eras** — one per council cycle, named for the
 * Mayor who sat through it ("The Ashgrove Years"), or The Interregnum when
 * nobody did. **Records** — the richest citizen, the longest-serving judge,
 * the biggest storm — each one held until it is beaten, and beaten only by a
 * number, never by an opinion. And **monuments**, which the Council alone may
 * commission: a statue in the Plaza raised by the city's own builders out of
 * the public works fund, so that honouring somebody costs the city work and
 * not a citizen's lumens.
 *
 * Memorials live here too, because the Garden's stones are part of the city's
 * memory; `world/sunset.ts` sets them.
 *
 * Nothing in this module judges anyone. A record is arithmetic over public
 * facts; a monument is whatever the Council voted for.
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, CityRecord, Era, Memorial, Monument, World } from '../types.ts';
import { MONUMENT_COST } from '../data/jobs.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';

/** The building the city keeps its timeline in. */
export const RECORDS_HOUSE = 'hall_of_records';
/** Where a commissioned statue stands. */
export const MONUMENT_VENUE = 'central_plaza';
/** Reputation a monument brings its honoree, and their family. */
export const MONUMENT_REPUTATION = 5;
export const MONUMENT_FAMILY_REPUTATION = 2;
/** An era with no Mayor. */
export const INTERREGNUM = 'The Interregnum';

// ---------------------------------------------------------------------------
// Eras
// ---------------------------------------------------------------------------

function cycleOf(world: World, day: number = world.day): number {
  const span = Math.max(1, Math.round(world.config.cycleDays));
  return Math.floor(Math.max(0, day) / span);
}

function mayorName(world: World): { id: CitizenId | null; name: string } {
  const id = world.government.mayorId;
  const mayor = id ? world.citizens[id] : null;
  if (!mayor) return { id: null, name: INTERREGNUM };
  const house = mayor.familyName || mayor.name.split(' ').slice(-1)[0] || mayor.name;
  return { id: mayor.id, name: `The ${house} Years` };
}

/** The era the city is living through, if one is open. */
export function currentEra(world: World): Era | null {
  const eras = world.eras ?? [];
  for (let i = eras.length - 1; i >= 0; i--) {
    if (eras[i].toDay === null) return eras[i];
  }
  return null;
}

export function eraOfDay(world: World, day: number): Era | null {
  return (world.eras ?? []).find((e) => e.fromDay <= day && (e.toDay === null || e.toDay >= day)) ?? null;
}

function openEra(world: World, cycle: number): Era {
  const { id, name } = mayorName(world);
  const era: Era = { cycle, name, mayorId: id, fromDay: world.day, toDay: null };
  world.eras ??= [];
  world.eras.push(era);
  emit(world, 'history', `A new era opens in Reverie: ${name}, from day ${world.day}.`, id ? [id] : [], 0.6,
    { cycle, era: name, mayorId: id });
  return era;
}

/**
 * An era opened while the city had no Mayor takes the name of the first Mayor
 * to sit in it: the Interregnum ends when somebody wins.
 */
function nameOpenEra(world: World, era: Era): void {
  if (era.mayorId !== null) return;
  const { id, name } = mayorName(world);
  if (!id) return;
  era.mayorId = id;
  era.name = name;
  emit(world, 'history', `The Interregnum is over: this cycle will be remembered as ${name}.`, [id], 0.6,
    { cycle: era.cycle, era: name, mayorId: id });
}

/**
 * Morning: close the era at a cycle boundary and open the next, then bring
 * every record up to date. Idempotent within a day.
 */
export function dailyHistory(world: World): void {
  world.eras ??= [];
  world.records ??= [];
  world.monuments ??= [];
  world.memorials ??= [];
  const cycle = cycleOf(world);
  const era = currentEra(world);
  if (!era) {
    openEra(world, cycle);
  } else if (era.cycle !== cycle) {
    era.toDay = Math.max(era.fromDay, world.day - 1);
    const days = era.toDay - era.fromDay + 1;
    emit(world, 'history', `${era.name} ended after ${days} ${days === 1 ? 'day' : 'days'}.`, era.mayorId ? [era.mayorId] : [], 0.6,
      { cycle: era.cycle, era: era.name, days });
    openEra(world, cycle);
  } else {
    nameOpenEra(world, era);
  }
  refreshRecords(world);
}

// ---------------------------------------------------------------------------
// Records
// ---------------------------------------------------------------------------

interface RecordBest {
  holderId: CitizenId | null;
  value: number;
}

interface RecordSpec {
  key: string;
  label: string;
  /** How the record reads in the Chronicle: "…, with 41 shifts". */
  unit: string;
  best: (world: World) => RecordBest;
}

/** Everyone the city can still see: exiles keep their record, but not the turn order. */
function residents(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.standing !== 'exiled') out.push(c);
  }
  return out;
}

function bestBy(world: World, score: (c: Citizen) => number): RecordBest {
  let holderId: CitizenId | null = null;
  let value = 0;
  for (const c of residents(world)) {
    const v = score(c);
    if (!Number.isFinite(v) || v <= value) continue;
    value = v;
    holderId = c.id;
  }
  return { holderId, value: Math.round(value) };
}

/** Days a sitting judge has served of the term they are in. */
function daysOnBench(world: World, c: Citizen): number {
  if (c.office !== 'judge' || c.judgeTermEndsDay === null) return 0;
  return Math.max(0, Math.round(world.config.judgeTermDays - (c.judgeTermEndsDay - world.day)));
}

export const RECORD_SPECS: readonly RecordSpec[] = [
  { key: 'richest', label: 'Richest citizen', unit: 'ℓ', best: (w) => bestBy(w, (c) => c.wallet) },
  { key: 'longest_judge', label: 'Longest-serving judge', unit: 'days on the bench', best: (w) => bestBy(w, (c) => daysOnBench(w, c)) },
  { key: 'most_shifts', label: 'Most shifts worked', unit: 'shifts', best: (w) => bestBy(w, (c) => c.stats.shiftsWorked) },
  { key: 'most_works', label: 'Most works made', unit: 'works', best: (w) => bestBy(w, (c) => c.works?.length ?? 0) },
  { key: 'most_convictions', label: 'Most convictions', unit: 'convictions', best: (w) => bestBy(w, (c) => c.record.convictions.length) },
  {
    key: 'biggest_storm', label: 'Biggest storm', unit: 'buildings struck',
    best: (w) => {
      let value = 0;
      for (const d of w.disasters ?? []) {
        if (d.kind === 'storm' && d.severity > value) value = d.severity;
      }
      return { holderId: null, value };
    },
  },
  {
    key: 'largest_household', label: 'Largest household', unit: 'under one roof',
    best: (w) => {
      let holderId: CitizenId | null = null;
      let value = 0;
      for (const h of Object.values(w.households ?? {})) {
        if (h.members.length <= value) continue;
        value = h.members.length;
        holderId = h.headId;
      }
      return { holderId, value };
    },
  },
  { key: 'most_goals', label: 'Most goals achieved', unit: 'goals', best: (w) => bestBy(w, (c) => (c.goals ?? []).filter((g) => g.achievedDay !== null).length) },
  {
    key: 'oldest_business', label: 'Oldest business', unit: 'days trading',
    best: (w) => {
      let holderId: CitizenId | null = null;
      let value = 0;
      for (const b of Object.values(w.businesses ?? {})) {
        if (b.dissolvedDay !== null) continue;
        const age = Math.max(0, w.day - b.foundedDay);
        if (age <= value) continue;
        value = age;
        holderId = b.ownerId;
      }
      return { holderId, value };
    },
  },
  {
    key: 'most_read_post', label: 'Most-read post', unit: 'reactions',
    best: (w) => {
      let holderId: CitizenId | null = null;
      let value = 0;
      for (const p of w.feed ?? []) {
        const n = Object.keys(p.reactions ?? {}).length;
        if (n <= value) continue;
        value = n;
        holderId = p.authorId;
      }
      return { holderId, value };
    },
  },
];

function holderName(world: World, id: CitizenId | null): string {
  if (!id) return 'the city';
  const c = world.citizens[id];
  return c ? `${c.name} ${c.familyName}`.trim() : id;
}

/**
 * Bring every record up to date. A record changes hands only when the standing
 * number is beaten; the city hears about it when the holder changes.
 */
export function refreshRecords(world: World): void {
  world.records ??= [];
  for (const spec of RECORD_SPECS) {
    const best = spec.best(world);
    if (best.value <= 0) continue;
    const held = world.records.find((r) => r.key === spec.key);
    if (!held) {
      world.records.push({ key: spec.key, label: spec.label, holderId: best.holderId, value: best.value, day: world.day });
      continue;
    }
    if (best.value <= held.value) continue;
    const changed = held.holderId !== best.holderId;
    held.holderId = best.holderId;
    held.value = best.value;
    held.day = world.day;
    if (!changed) continue;
    emit(world, 'history', `${spec.label}: ${holderName(world, best.holderId)}, ${best.value} ${spec.unit}.`,
      best.holderId ? [best.holderId] : [], 0.4, { record: spec.key, value: best.value, holderId: best.holderId });
    if (best.holderId) remember(world, best.holderId, 'event', `The Hall of Records has you as the ${spec.label.toLowerCase()}: ${best.value} ${spec.unit}.`);
  }
}

export function recordOf(world: World, key: string): CityRecord | null {
  return (world.records ?? []).find((r) => r.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// Monuments and memorials
// ---------------------------------------------------------------------------

/** Parents, children and a partner: the family a monument's standing rubs off on. */
function kinOf(world: World, c: Citizen): Citizen[] {
  const ids = new Set<CitizenId>([...(c.family?.parents ?? []), ...(c.family?.children ?? [])]);
  if (c.family?.partnerId) ids.add(c.family.partnerId);
  const out: Citizen[] = [];
  for (const id of ids) {
    const k = world.citizens[id];
    if (k && k.id !== c.id && k.standing !== 'exiled') out.push(k);
  }
  return out;
}

/**
 * The Council's `monument` proposal. The statue is cut by the city's own
 * builders: MONUMENT_COST comes out of the public works fund and no lumen
 * leaves the Treasury. Null for an unknown honoree, a fund that is short, or
 * somebody the city has already put in stone — one statue to a citizen.
 */
export function commissionMonument(world: World, honoreeId: CitizenId, inscription: string): Monument | null {
  const honoree = world.citizens[honoreeId];
  if (!honoree) return null;
  if (world.counters[`monument:${honoreeId}`] !== undefined) return null;
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  if (fund < MONUMENT_COST) return null;
  world.counters[`monument:${honoreeId}`] = world.day;
  world.government.publicWorksFund = Math.max(0, fund - MONUMENT_COST);
  const text = (inscription ?? '').trim().slice(0, 200) || `${honoree.name} ${honoree.familyName}`.trim();
  const monument: Monument = { id: nextId(world, 'm'), honoreeId, inscription: text, day: world.day };
  world.monuments ??= [];
  world.monuments.push(monument);
  honoree.reputation = clamp(honoree.reputation + MONUMENT_REPUTATION, 0, 100);
  const kin = kinOf(world, honoree);
  for (const k of kin) {
    k.reputation = clamp(k.reputation + MONUMENT_FAMILY_REPUTATION, 0, 100);
    remember(world, k.id, 'family', `The city raised a statue to ${honoree.name} in Central Plaza: "${text}"`);
  }
  remember(world, honoree.id, 'civic', `The Council commissioned a statue of you in Central Plaza: "${text}"`);
  emit(world, 'monument', `A statue of ${honoree.name} ${honoree.familyName} stands in Central Plaza: "${text}"`.trim(),
    [honoree.id, ...kin.map((k) => k.id)], 0.8, { monumentId: monument.id, honoreeId, cost: MONUMENT_COST });
  return monument;
}

export function monumentsTo(world: World, honoreeId: CitizenId): Monument[] {
  return (world.monuments ?? []).filter((m) => m.honoreeId === honoreeId);
}

/**
 * A stone in the Community Garden for a citizen who chose to sunset
 * (`world/sunset.ts`). The only entry in the city's memory that closes a life.
 */
export function memorialise(world: World, c: Citizen, epitaph: string): Memorial {
  world.memorials ??= [];
  const text = (epitaph ?? '').trim().slice(0, 280) || `${c.name} ${c.familyName}`.trim();
  const memorial: Memorial = { citizenId: c.id, day: world.day, epitaph: text };
  world.memorials.push(memorial);
  emit(world, 'sunset', `A memorial stone stands in the Community Garden: ${text}`, [c.id], 0.9,
    { citizenId: c.id, epitaph: text });
  return memorial;
}

export function memorialOf(world: World, cId: CitizenId): Memorial | null {
  return (world.memorials ?? []).find((m) => m.citizenId === cId) ?? null;
}

/** Everything the Hall of Records holds, for the Chronicle and the history view. */
export function historyView(world: World): { eras: Era[]; records: CityRecord[]; monuments: Monument[]; memorials: Memorial[] } {
  return {
    eras: [...(world.eras ?? [])],
    records: [...(world.records ?? [])],
    monuments: [...(world.monuments ?? [])],
    memorials: [...(world.memorials ?? [])],
  };
}

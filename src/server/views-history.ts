/**
 * `GET /api/history` — the Hall of Records: the eras the city has lived
 * through, the records it keeps, the monuments it raised, the memorials in the
 * Garden, every disaster it has weathered, and a per-day statistics series for
 * the scrubber.
 *
 * Read-only. A memorial is the one thing in Reverie that outlasts a citizen,
 * and nothing here can add to or take from any of it.
 */
import type { CityRecord, CitizenId, Era, World, WorldEvent } from '../types.ts';
import { historyView } from '../world/history.ts';
import { epithet } from '../identity/biography.ts';
import { LAWS } from '../data/laws.ts';
import { nameOf, personCard, portraitPath, presentSet } from './views.ts';

/** Days of statistics the scrubber gets. */
export const STATS_SERIES_LENGTH = 500;
/** Entries on the timeline. */
export const TIMELINE_LENGTH = 200;
/** How heavy an event must be to earn a place on the timeline. */
export const TIMELINE_WEIGHT = 0.6;

const round2 = (n: number): number => Math.round(n * 100) / 100;

function eraView(world: World, e: Era, present: Set<CitizenId>): Record<string, unknown> {
  const mayor = e.mayorId ? world.citizens[e.mayorId] ?? null : null;
  return {
    cycle: e.cycle, name: e.name, fromDay: e.fromDay, toDay: e.toDay,
    days: (e.toDay ?? world.day) - e.fromDay + 1,
    current: e.toDay === null,
    mayor: personCard(world, e.mayorId, present),
    mayorEpithet: mayor ? epithet(world, mayor) : null,
  };
}

function recordView(world: World, r: CityRecord): Record<string, unknown> {
  return {
    key: r.key, label: r.label, value: r.value, day: r.day,
    holderId: r.holderId, holder: r.holderId ? nameOf(world, r.holderId) : null,
    portrait: r.holderId ? portraitPath(r.holderId) : null,
  };
}

/** The city's big days: the events heavy enough that the Chronicle led with them. */
function timeline(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = world.events.length - 1; i >= 0 && out.length < TIMELINE_LENGTH; i--) {
    const e: WorldEvent = world.events[i];
    if (e.weight < TIMELINE_WEIGHT) continue;
    out.push({
      day: e.day, tick: e.tick, kind: e.kind, text: e.text, weight: e.weight,
      who: e.actors.map((id) => personCard(world, id, present)).filter((c) => c !== null).slice(0, 3),
    });
  }
  return out;
}

/** `GET /api/history`. */
export function historyApiView(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const { eras, records, monuments, memorials } = historyView(world);
  const series = world.stats.slice(-STATS_SERIES_LENGTH);
  const disasters = [...(world.disasters ?? [])].sort((a, b) => b.day - a.day);
  return {
    day: world.day, year: world.year ?? 0, cycle: world.government.cycle,
    eras: [...eras].sort((a, b) => b.fromDay - a.fromDay).map((e) => eraView(world, e, present)),
    records: [...records].sort((a, b) => a.key.localeCompare(b.key)).map((r) => recordView(world, r)),
    monuments: [...monuments].sort((a, b) => b.day - a.day).map((m) => ({
      id: m.id, day: m.day, inscription: m.inscription,
      honoree: personCard(world, m.honoreeId, present),
    })),
    memorials: [...memorials].sort((a, b) => b.day - a.day).map((m) => ({
      citizenId: m.citizenId, day: m.day, epitaph: m.epitaph,
      who: personCard(world, m.citizenId, present),
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
    })),
    stats: {
      firstDay: series.length > 0 ? series[0].day : null,
      lastDay: series.length > 0 ? series[series.length - 1].day : null,
      totalDays: world.stats.length,
      series,
    },
    timeline: timeline(world, present),
  };
}

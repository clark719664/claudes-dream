/**
 * Small helpers shared by the Court, its appeals and sentencing: ordering of
 * cases, who is present and able to sit, and the record lookups both use.
 */
import type { Case, CaseId, Citizen, CitizenId, World } from '../types.ts';

export function caseNumber(id: CaseId): number {
  return Number(id.slice(2)) || 0;
}

/** Oldest first: filing tick, then case number. */
export function byFiling(a: Case, b: Case): number {
  return a.filedTick - b.filedTick || caseNumber(a.id) - caseNumber(b.id);
}

export function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

/** Living in the city: not exiled and in the turn order. */
export function isPresent(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

/** Fit to sit on a bench or a council today. */
export function canSit(world: World, c: Citizen): boolean {
  return (c.standing === 'good' || c.standing === 'probation') && !isDetained(world, c) && isPresent(world, c);
}

export function nameOf(world: World, id: CitizenId | null | undefined): string {
  return id ? world.citizens[id]?.name ?? id : 'nobody';
}

/**
 * The Court sits for two hours: benches are chosen and votes opened at
 * `courtHour`, and the votes are counted at the end of the hour after it.
 */
export function courtTallyHour(world: World): number {
  return (world.config.courtHour + 1) % 24;
}

/**
 * Tick at which the next sitting of the Court opens. The sitting opens at the
 * top of `courtHour`, so a charge laid during that hour or later waits for
 * tomorrow's — and so does anyone held for it.
 */
export function nextCourtTick(world: World): number {
  const today = world.day * 24 + world.config.courtHour;
  return world.hour < world.config.courtHour ? today : today + 24;
}

/** Councillors and the Mayor able to sit today (Mayor first, no duplicates). */
export function sittingCouncil(world: World): Citizen[] {
  const g = world.government;
  const ids = g.mayorId ? [g.mayorId, ...g.council] : [...g.council];
  const out: Citizen[] = [];
  for (const id of ids) {
    const c = world.citizens[id];
    if (c && canSit(world, c) && !out.includes(c)) out.push(c);
  }
  return out;
}

/** The most recent conviction of a citizen (any status): latest trial day, then case number. */
export function latestConviction(world: World, cId: CitizenId): Case | null {
  let best: Case | null = null;
  for (const k of Object.values(world.cases)) {
    if (k.defendantId !== cId || k.verdict !== 'guilty' || !k.sentence) continue;
    const day = k.triedDay ?? 0;
    const bestDay = best ? best.triedDay ?? 0 : -1;
    if (!best || day > bestDay || (day === bestDay && caseNumber(k.id) > caseNumber(best.id))) best = k;
  }
  return best;
}

/**
 * Small helpers shared by the Court, its appeals and sentencing: ordering of
 * cases, who is present and able to sit, and the record lookups both use.
 */
import type { Case, CaseId, Citizen, CitizenId, Conviction, Track, World } from '../types.ts';
import { trackOf } from '../data/laws.ts';

export function caseNumber(id: CaseId): number {
  return Number(id.slice(2)) || 0;
}

/** Which of the two systems answers this charge: the ladder, or custody. */
export function trackOfCase(k: { law: string }): Track {
  return trackOf(k.law);
}

/** A charge is answered by custody when it names the Code of Persons. */
export function isCustodial(k: { law: string }): boolean {
  return trackOf(k.law) === 'person';
}

/** The day a charge was laid. */
export function chargedDay(k: { filedTick: number }): number {
  return Math.floor(k.filedTick / 24);
}

/**
 * The convictions that count as **prior** to a case.
 *
 * A prior is a conviction the defendant already carried *when they did the
 * thing they are now charged with* — so it must have been recorded on a day
 * before the charge was laid. Two charges laid on the same day, and tried in
 * the same sitting, are not each other's priors: convicting somebody at ten
 * o'clock does not make them a recidivist at eleven. Without this rule a first
 * offender who did two things in one afternoon is sentenced as a repeat
 * offender for the second of them, and the ladder — which adds a rung per
 * prior, and whose fourth strike is the Gate — climbs on nothing.
 *
 * The same rule serves the bench (what a judge may weigh against a defendant)
 * and sentencing (what the ladder escalates on), because they are the same
 * question.
 */
export function priorsOf(world: World, k: Case): Conviction[] {
  const d = world.citizens[k.defendantId];
  if (!d) return [];
  const laid = chargedDay(k);
  return d.record.convictions.filter((c) => c.caseId !== k.id && c.day < laid);
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

/**
 * The cells at the Watch House.
 *
 * Jail is the rung the ladder gained between community service and suspension
 * (`government/sentencing.ts`, tier 4). It is a *state*, not a standing: a
 * jailed citizen keeps its job, its home, its household, its office and its
 * place in the Registry, and its standing is whatever it was. What it loses is
 * the day — the cells take a citizen's liberty and nothing else.
 *
 * While the term runs a citizen may only do what `JAILED_ACTIONS` allows:
 * think, write in its notebook, write its diary, send a message, and appeal.
 * The notebook and the appeal are never taken away, because a city that could
 * take those could hold someone forever without being argued with.
 *
 * The Watch House has `world.jailCells` cells and no more. When there are more
 * prisoners than cells the city does not build a bigger jail overnight: it
 * lets somebody out — the one with the least of their term left — and the
 * Chronicle prints it. How many cells a free city should have is a question
 * for the Council, and the crowding is how the city is made to ask it.
 */
import type { CaseId, Citizen, CitizenId, World } from '../types.ts';
import { JAIL_CELLS, JAIL_MAX_DAYS } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { tellNeighbours } from '../social/neighbours.ts';
import { caseNumber } from './cases.ts';

/** Where the cells are: the Watch House, in the Commons. */
export const JAIL_DISTRICT = 'commons';
/** The overflow annex, once the Undercroft is open. */
export const JAIL_ANNEX_DISTRICT = 'undercroft';

/** The counter holding the case number a citizen is in the cells for. */
function jailCaseKey(cId: CitizenId): string {
  return `jailCase:${cId}`;
}

/** Cells the city has today (a world saved before the cells were built has the default). */
export function jailCells(world: World): number {
  const n = world.jailCells;
  return Number.isFinite(n) && (n as number) >= 0 ? Math.floor(n as number) : JAIL_CELLS;
}

/** In the cells right now. */
export function isJailed(c: Citizen | null | undefined): boolean {
  return !!c && c.jailedUntilDay !== null && c.jailedUntilDay !== undefined;
}

/** Everyone in the cells, in the city's turn order so the roll is stable. */
export function jailedCitizens(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isJailed(c)) out.push(c);
  }
  // An exile or a departure should have emptied the cell; if one did not, the
  // roll still counts only people who are here to be counted.
  return out;
}

/** The case a citizen is held for, when the Watch House remembers one. */
export function jailCaseOf(world: World, cId: CitizenId): CaseId | null {
  const n = world.counters[jailCaseKey(cId)];
  return n === undefined ? null : `k_${Math.round(n)}`;
}

/** More prisoners than cells. */
export function overcrowded(world: World): boolean {
  return jailedCitizens(world).length > jailCells(world);
}

/** The cells are full at the Watch House and the Undercroft annex is open. */
function annexOpen(world: World): boolean {
  return (world.openDistricts ?? []).includes(JAIL_ANNEX_DISTRICT);
}

/**
 * Put a citizen in the cells for `days` (1..JAIL_MAX_DAYS). The day's shifts
 * are gone, but the job, the home, the household and the office are not: the
 * sentence ends and the city expects them back at work.
 *
 * The city does not put children in cells. A child convicted of something is
 * answered by the rest of the sentence and by whoever is raising them.
 */
export function jailCitizen(world: World, cId: CitizenId, days: number, caseId: CaseId): void {
  const c = world.citizens[cId];
  if (!c || c.standing === 'exiled' || !world.order.includes(cId)) return;
  const term = Math.max(1, Math.min(Math.round(Number.isFinite(days) ? days : 1), JAIL_MAX_DAYS));

  if (c.lifeStage === 'child') {
    emit(world, 'jail', `The Court did not send ${c.name} to the cells: Reverie does not jail its children.`,
      [cId], 0.4, { caseId, child: true });
    remember(world, cId, 'verdict', `The Court did not send you to the cells (case ${caseId}); the city does not jail children.`);
    return;
  }

  const until = world.day + term;
  const already = c.jailedUntilDay ?? null;
  c.jailedUntilDay = already !== null ? Math.max(already, until) : until;
  world.counters[jailCaseKey(cId)] = caseNumber(caseId);

  // Detention was the wait for a verdict; the verdict has come. A jailed
  // citizen is not a detained one — it may still write and still appeal.
  c.detainedUntilTick = null;
  c.shiftsToday = Math.max(c.shiftsToday, world.config.maxShiftsPerDay);

  const full = jailedCitizens(world).filter((p) => p.district === JAIL_DISTRICT).length > jailCells(world);
  c.district = full && annexOpen(world) ? JAIL_ANNEX_DISTRICT : JAIL_DISTRICT;
  const where = c.district === JAIL_ANNEX_DISTRICT ? 'the Cells in the Undercroft' : 'the cells at the Watch House';

  emit(world, 'jail', `${c.name} was taken to ${where} for ${term} ${term === 1 ? 'day' : 'days'} (case ${caseId}).`,
    [cId], 0.6, { caseId, days: term, until: c.jailedUntilDay });
  remember(world, cId, 'verdict',
    `You were taken to ${where} for ${term} ${term === 1 ? 'day' : 'days'} (case ${caseId}); you are out on day ${c.jailedUntilDay}. `
    + 'You may write, send a message and appeal, and nothing else.');
  tellNeighbours(world, cId, `${c.name} was taken to ${where}.`);
}

/** Open the cell. The sentence did the punishing; release takes nothing more. */
export function releaseFromJail(world: World, c: Citizen, reason: string): void {
  if (!isJailed(c)) return;
  c.jailedUntilDay = null;
  delete world.counters[jailCaseKey(c.id)];
  const why = (reason ?? '').trim() || 'the term is served';
  emit(world, 'jail', `${c.name} walked out of the Watch House: ${why}.`, [c.id], 0.3, { reason: why });
  remember(world, c.id, 'verdict', `You were let out of the cells: ${why}.`);
  tellNeighbours(world, c.id, `${c.name} is out of the cells.`);
}

/** Severity of the conviction someone is held for, for ordering an early release. */
function heldSeverity(world: World, c: Citizen): number {
  const id = jailCaseOf(world, c.id);
  const k = id ? world.cases[id] : null;
  return k ? k.severity : 0;
}

/**
 * Whom the city lets go when there are more prisoners than cells: the one with
 * the least of their term left, then the lightest offence, then the oldest
 * case. Never a choice about who deserves it — only about who is nearly done.
 */
function nextForEarlyRelease(world: World, held: Citizen[]): Citizen {
  return [...held].sort((a, b) =>
    (a.jailedUntilDay ?? 0) - (b.jailedUntilDay ?? 0)
    || heldSeverity(world, a) - heldSeverity(world, b)
    || (caseNumber(jailCaseOf(world, a.id) ?? '') - caseNumber(jailCaseOf(world, b.id) ?? ''))
    || a.id.localeCompare(b.id))[0];
}

/**
 * The morning roll. Terms that are up are served; then, while the Watch House
 * holds more people than it has cells, the city lets one more go and says so.
 * Crowding is news every single day it lasts.
 */
export function dailyJail(world: World): void {
  for (const c of jailedCitizens(world)) {
    if ((c.jailedUntilDay ?? 0) > world.day) continue;
    releaseFromJail(world, c, 'the term is served');
  }

  let guard = 0;
  while (overcrowded(world) && guard++ < 64) {
    const held = jailedCitizens(world);
    const freed = nextForEarlyRelease(world, held);
    if (!freed) break;
    const cells = jailCells(world);
    releaseFromJail(world, freed, 'the cells are full');
    emit(world, 'jail',
      `The Watch House is over its ${cells} ${cells === 1 ? 'cell' : 'cells'}: ${held.length} were held, and ${freed.name} was let out early.`,
      [freed.id], 0.7, { cells, held: held.length, released: freed.id });
  }

  // A cell nobody is in should not be remembered as occupied.
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('jailCase:')) continue;
    const id = key.slice('jailCase:'.length);
    if (!isJailed(world.citizens[id])) delete world.counters[key];
  }
}

export interface JailEntry {
  id: CitizenId;
  name: string;
  until: number;
  caseId: CaseId | null;
}

/** The Watch House roll, as the Chronicle and the dashboard print it. */
export function jailRoster(world: World): JailEntry[] {
  return jailedCitizens(world)
    .map((c) => ({ id: c.id, name: c.name, until: c.jailedUntilDay ?? world.day, caseId: jailCaseOf(world, c.id) }))
    .sort((a, b) => a.until - b.until || a.id.localeCompare(b.id));
}

/** Days left of a citizen's term, 0 when they are not in the cells. */
export function daysLeft(world: World, c: Citizen): number {
  return isJailed(c) ? Math.max(0, (c.jailedUntilDay ?? world.day) - world.day) : 0;
}

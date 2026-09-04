/**
 * Feuds — what happens when two families keep hurting each other.
 *
 * Every hostile act between citizens of different families is counted against
 * the pair of names (`citizens/relationships.ts recordHostility` calls
 * `noteHostility`). Three inside one cycle and the two families are **in
 * feud**: from that morning on, every bond that crosses the line is pressed
 * down to FEUD_BOND_FLOOR each day, so a friendship across the two names
 * cannot survive without someone ending the feud.
 *
 * There are exactly two ways out, and both are public. A member of one family
 * may `apologize` to a member of the other at Central Plaza — once a day,
 * where the city can see it — which strikes one incident from the tally; strike
 * the last one and the feud is over. Or two of them marry, and the wedding ends
 * it outright.
 *
 * Nothing here decides that a feud is good or bad, and nothing pushes a citizen
 * toward reconciling. It is simply what the city does with a grudge that keeps
 * being fed.
 */
import type { ActionResult, BuildingId, Citizen, CitizenId, Feud, World } from '../types.ts';
import { districtOfBuilding } from '../data/city.ts';
import { emit, remember } from '../sim/events.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { adjustBond, bondBetween } from '../citizens/relationships.ts';

/** Hostile incidents inside one cycle that open a feud. */
export const FEUD_INCIDENTS = 3;
/** Where a bond that crosses a live feud is pressed down to, every morning. */
export const FEUD_BOND_FLOOR = -30;
/** Bond an apology gives, both ways. */
export const APOLOGY_BOND = 25;
/** Reputation an apology earns: it is a hard thing to do in public. */
export const APOLOGY_REPUTATION = 2;
/** Apologies are made in public, at the Plaza. */
export const APOLOGY_VENUE: BuildingId = 'central_plaza';

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The two names in a fixed order, so a pair is one key whichever way round it comes. */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function incidentPrefix(a: string, b: string): string {
  return `feud:${pairKey(a, b)}:`;
}

function sameFamily(f: Feud, a: string, b: string): boolean {
  return (f.families[0] === a && f.families[1] === b) || (f.families[0] === b && f.families[1] === a);
}

/** Feuds still running. */
export function liveFeuds(world: World): Feud[] {
  return (world.feuds ?? []).filter((f) => f.endedDay === null);
}

/** The live feud between two family names, either order. */
export function feudBetween(world: World, a: string, b: string): Feud | null {
  if (!a || !b || a === b) return null;
  return liveFeuds(world).find((f) => sameFamily(f, a, b)) ?? null;
}

/** True when these two citizens stand on opposite sides of a live feud. */
export function inFeud(world: World, a: CitizenId, b: CitizenId): boolean {
  const ca = world.citizens[a];
  const cb = world.citizens[b];
  if (!ca || !cb || ca.id === cb.id) return false;
  return feudBetween(world, ca.familyName, cb.familyName) !== null;
}

/** Present citizens of a family name. */
export function familyMembers(world: World, name: string): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.familyName === name && isPresent(world, c)) out.push(c);
  }
  return out;
}

/** The live feuds this citizen's family is in. */
export function feudsOf(world: World, c: Citizen): Feud[] {
  return liveFeuds(world).filter((f) => f.families.includes(c.familyName));
}

/** Incidents this pair of names has run up inside the current cycle. */
export function incidentTally(world: World, a: string, b: string): number {
  const prefix = incidentPrefix(a, b);
  let n = 0;
  for (const [key, value] of Object.entries(world.counters)) {
    if (key.startsWith(prefix)) n += value;
  }
  return n;
}

function clearTally(world: World, a: string, b: string): void {
  const prefix = incidentPrefix(a, b);
  for (const key of Object.keys(world.counters)) {
    if (key.startsWith(prefix)) delete world.counters[key];
  }
}

// ---------------------------------------------------------------------------
// Opening a feud
// ---------------------------------------------------------------------------

function tellFamilies(world: World, f: Feud, text: string): void {
  for (const name of f.families) {
    for (const m of familyMembers(world, name)) remember(world, m.id, 'family', text);
  }
}

function openFeud(world: World, a: string, b: string, incidents: number, over: CitizenId[]): Feud {
  world.feuds ??= [];
  const f: Feud = { families: [a, b], sinceDay: world.day, incidents, endedDay: null };
  world.feuds.push(f);
  clearTally(world, a, b);
  const actors = [...familyMembers(world, a), ...familyMembers(world, b)].map((c) => c.id);
  emit(world, 'feud', `The ${a}s and the ${b}s are in feud: ${incidents} hostile acts between them in one cycle.`,
    actors.length ? actors : over, 0.8, { families: [a, b], incidents });
  tellFamilies(world, f, `Your family is in feud with the ${f.families[0] === a ? b : a}s.`);
  return f;
}

/**
 * One hostile act between two families, of the kind the injured family knows
 * the name behind: an insult to their face, a hand in their pocket they saw,
 * a demand for money with a threat behind it. A crime nobody was named for
 * belongs to nobody's family and counts against no name. Inside a live feud
 * it simply deepens it; outside one it counts toward FEUD_INCIDENTS. Children
 * are never part of it, and a family cannot feud with itself.
 */
export function noteHostility(world: World, actorId: CitizenId, targetId: CitizenId): void {
  if (actorId === targetId) return;
  const actor = world.citizens[actorId];
  const target = world.citizens[targetId];
  if (!actor || !target) return;
  if (!isPresent(world, actor) || !isPresent(world, target)) return;
  if (actor.lifeStage === 'child' || target.lifeStage === 'child') return;
  const a = actor.familyName;
  const b = target.familyName;
  if (!a || !b || a === b) return;

  const live = feudBetween(world, a, b);
  if (live) {
    live.incidents += 1;
    return;
  }
  const key = `${incidentPrefix(a, b)}${world.day}`;
  world.counters[key] = (world.counters[key] ?? 0) + 1;
  const tally = incidentTally(world, a, b);
  if (tally < FEUD_INCIDENTS) return;
  openFeud(world, a, b, tally, [actorId, targetId]);
}

// ---------------------------------------------------------------------------
// Living with a feud
// ---------------------------------------------------------------------------

/** Press one direction of a bond down to the floor; a bond already lower is left alone. */
function pressDown(world: World, a: CitizenId, b: CitizenId): void {
  const current = bondBetween(world, a, b);
  if (current <= FEUD_BOND_FLOOR) return;
  adjustBond(world, a, b, FEUD_BOND_FLOOR - current, false);
}

/**
 * Every morning of a feud, every bond that crosses it is pressed down to the
 * floor. It only ever lowers a bond: two people who already hate each other
 * are not warmed up by their families' quarrel.
 */
export function applyFeudFloor(world: World): void {
  for (const f of liveFeuds(world)) {
    const left = familyMembers(world, f.families[0]);
    const right = familyMembers(world, f.families[1]);
    for (const a of left) {
      for (const b of right) {
        if (a.id === b.id) continue;
        pressDown(world, a.id, b.id);
        pressDown(world, b.id, a.id);
      }
    }
  }
}

function endFeud(world: World, f: Feud, text: string, actors: CitizenId[], weight: number): void {
  f.endedDay = world.day;
  f.incidents = 0;
  clearTally(world, f.families[0], f.families[1]);
  emit(world, 'feud', text, actors, weight, { families: f.families, ended: true });
  tellFamilies(world, f, text);
}

/**
 * A public apology at the Plaza, to somebody on the other side of a feud.
 * It strikes one incident from the tally; the one that strikes the last
 * incident ends the feud. Once a day — the city stops listening after that.
 */
export function apologize(world: World, cId: CitizenId, toId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const other = world.citizens[toId];
  if (!other || !isPresent(world, other)) return fail('Nobody by that id lives in Reverie.');
  if (cId === toId) return fail('You cannot apologise to yourself.');
  if (c.familyName === other.familyName) return fail(`${other.name} is of your own family.`);
  const feud = feudBetween(world, c.familyName, other.familyName);
  if (!feud) return fail(`There is no feud between the ${c.familyName}s and the ${other.familyName}s.`);
  const venue = districtOfBuilding(APOLOGY_VENUE);
  if (c.district !== venue) {
    return fail(`A public apology is made at Central Plaza, in ${world.districts[venue]?.name ?? venue}.`);
  }
  const key = `apology:${cId}`;
  if (world.counters[key] === world.day) return fail('You have already made your apology today.');
  world.counters[key] = world.day;

  adjustBond(world, cId, toId, APOLOGY_BOND);
  adjustReputation(world, c, APOLOGY_REPUTATION, 'a public apology');
  feud.incidents = Math.max(0, feud.incidents - 1);
  remember(world, toId, 'social', `${c.name} apologised to you at Central Plaza, before the city.`);
  remember(world, cId, 'social', `You apologised to ${other.name} at Central Plaza, before the city.`);

  if (feud.incidents === 0) {
    endFeud(world, feud, `${c.name} apologised to ${other.name} at Central Plaza, and the feud between the ${feud.families[0]}s and the ${feud.families[1]}s is over.`,
      [cId, toId], 0.7);
    return { ok: true, message: `You apologised to ${other.name}, and the feud is over.` };
  }
  emit(world, 'feud', `${c.name} apologised to ${other.name} at Central Plaza; ${feud.incidents} more stand between the ${feud.families[0]}s and the ${feud.families[1]}s.`,
    [cId, toId], 0.4, { families: feud.families, incidents: feud.incidents });
  return { ok: true, message: `You apologised to ${other.name}; ${feud.incidents} incident${feud.incidents === 1 ? '' : 's'} still stand between your families.` };
}

/** The names a citizen can be said to belong to: their own, and the ones they were born to. */
function namesOf(world: World, c: Citizen): Set<string> {
  const names = new Set<string>([c.familyName, c.family.familyName]);
  for (const id of c.family.parents) {
    const parent = world.citizens[id];
    if (parent) { names.add(parent.familyName); names.add(parent.family.familyName); }
  }
  names.delete('');
  return names;
}

/**
 * A wedding across a feud ends it, and the city hears about it. Called from
 * `society/romance.ts holdWedding`, which may already have merged the couple's
 * family names — so the couple's parents' names count too.
 */
export function reconcileByMarriage(world: World, a: CitizenId, b: CitizenId): void {
  const ca = world.citizens[a];
  const cb = world.citizens[b];
  if (!ca || !cb || a === b) return;
  const left = namesOf(world, ca);
  const right = namesOf(world, cb);
  for (const f of liveFeuds(world)) {
    const [x, y] = f.families;
    const crossed = (left.has(x) && right.has(y)) || (left.has(y) && right.has(x));
    if (!crossed) continue;
    endFeud(world, f, `${ca.name} married ${cb.name}, and the feud between the ${x}s and the ${y}s is over.`, [a, b], 0.8);
  }
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** Incidents that never became a feud lapse after a cycle. */
function pruneIncidents(world: World): void {
  const cutoff = world.day - world.config.cycleDays;
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('feud:')) continue;
    const day = Number(key.slice(key.lastIndexOf(':') + 1));
    if (!Number.isFinite(day) || day < cutoff) delete world.counters[key];
  }
}

/** A feud with nobody left on one side of it is over, whether anyone meant it or not. */
function closeEmptyFeuds(world: World): void {
  for (const f of liveFeuds(world)) {
    const left = familyMembers(world, f.families[0]);
    const right = familyMembers(world, f.families[1]);
    if (left.length > 0 && right.length > 0) continue;
    const gone = left.length === 0 ? f.families[0] : f.families[1];
    f.endedDay = world.day;
    f.incidents = 0;
    clearTally(world, f.families[0], f.families[1]);
    emit(world, 'feud', `The feud between the ${f.families[0]}s and the ${f.families[1]}s ended with the last of the ${gone}s gone from Reverie.`,
      [...left, ...right].map((c) => c.id), 0.4, { families: f.families, ended: true });
  }
}

/** The floor is applied, stale incidents lapse, and feuds with nobody left are closed. */
export function dailyFeuds(world: World): void {
  world.feuds ??= [];
  applyFeudFloor(world);
  pruneIncidents(world);
  closeEmptyFeuds(world);
}

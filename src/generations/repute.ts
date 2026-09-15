/**
 * The house repute — a public 0–1000 figure per family name with a living
 * adult member, recomputed each morning right after each citizen's own repute
 * (`docs/GENERATIONS.md` §1).
 *
 * ```
 * target(H) = 500                       the average; every new name starts here
 *           + 0.50 × (mean repute of H's living adults − 500)
 *           + heritage(H)               capped at 250
 *           − stain(H)
 *
 * heritage(H) = min(250,
 *     Σ over departed, sunset and erased members  contribution(m) × 0.7^generations back
 *   + Σ over every office the name has held       weight × 0.5^(cycles since ÷ 4) )
 *
 * stain(H)    = Σ 15 per civic conviction of severity ≥ 3 + 40 per custodial
 *               + 120 per conviction under P07–P09, each decaying 1 % on every
 *               day no member of the house is convicted of anything
 *
 * houseRepute ← houseRepute + 0.15 × (target − houseRepute)   every morning
 * ```
 *
 * Three things this file will not do, and says so out loud:
 *
 * - **Nothing else in the engine reads this number.** No gate, no repute
 *   component, no sentence, no band, no fine and no licence
 *   (`GENERATIONS.md` §6). What a house repute moves is what a *citizen*
 *   chooses to do about it — a judge's declared familiarity, a bank's terms
 *   when the head pledges, a voter's ten points — and nothing else.
 * - **Contribution is never inherited.** Heritage is a decaying echo of what
 *   the *dead* did, capped at a quarter of the scale; a founder's
 *   great-grandchild comes of age at the ordinary baseline like everybody
 *   else, and their own contribution ledger starts empty.
 * - **The living carry half the weight**, so no name is built out of history
 *   alone and both ends of the scale drift back toward 500.
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, Conviction, World } from '../types.ts';
import { isPersonLaw } from '../data/laws.ts';
import { isPresent } from '../citizens/citizen.ts';
import { contributionLedger } from '../standing/state.ts';
import { contributionWorth } from '../standing/contribution.ts';
import { reputeOf } from '../standing/repute.ts';
import type { HouseStain, OfficeKind, OfficeTerm } from './state.ts';
import { generationsState, officesOf, stainsOf } from './state.ts';

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

export const HOUSE_REPUTE_MIN = 0;
export const HOUSE_REPUTE_MAX = 1000;
/** The average. Every new name starts here, and every name drifts back to it. */
export const HOUSE_BASELINE = 500;
/** A house is mostly the people in it, so the living carry half the weight. */
export const LIVING_WEIGHT = 0.5;
/** Heritage is capped at a quarter of the scale: no name is built out of history alone. */
export const HERITAGE_CAP = 250;
/** A generation is worth 0.7 of the one before it. */
export const GENERATION_DECAY = 0.7;
/** Offices halve every four cycles: a house that stops serving stops counting. */
export const OFFICE_HALF_LIFE_CYCLES = 4;
/** What one term in each office is worth to the name. */
export const OFFICE_WEIGHTS: Record<OfficeKind, number> = {
  council: 12, judge: 20, mayor: 30, watch: 8, envoy: 6,
};
/** A stain, before decay: the ladder, custody, and the three the Expanse never forgets. */
export const STAIN_CIVIC = 15;
export const STAIN_CUSTODIAL = 40;
export const STAIN_GRAVEST = 120;
/** A family is slower to live a thing down than a person: 1 % a clean day against repute's 2 %. */
export const STAIN_DECAY = 0.01;
/** A scandal has a fortnight to be felt in full, and a recovery the same fortnight. */
export const RELAXATION = 0.15;
/** How deep the tree is walked when counting generations back. */
export const MAX_GENERATIONS = 8;

// ---------------------------------------------------------------------------
// Who is of a name
// ---------------------------------------------------------------------------

function adult(c: Citizen): boolean {
  return c.lifeStage === 'adult' || c.lifeStage === 'elder';
}

/** Everybody who ever carried this name, whatever became of them. */
export function bornTo(world: World, name: string): Citizen[] {
  return Object.values(world.citizens).filter((c) => c.familyName === name);
}

/** Members of a name living in Reverie today: not exiled, not departed, not sunset. */
export function livingMembers(world: World, name: string): Citizen[] {
  return bornTo(world, name).filter((c) => isPresent(world, c));
}

/** The adults of a name living in Reverie today. */
export function livingAdults(world: World, name: string): Citizen[] {
  return livingMembers(world, name).filter(adult);
}

/**
 * Members the heritage term counts: the departed, the sunset and the erased.
 * An **exile** is not among them — exile leaves no estate and no heritage —
 * and neither is anybody still living here, whose repute is counted directly.
 */
export function departedMembers(world: World, name: string): Citizen[] {
  return bornTo(world, name).filter((c) => (
    c.standing !== 'exiled' && !isPresent(world, c)
  ));
}

/** Every family name with a living adult member: the names that carry a repute. */
export function houseNames(world: World): string[] {
  const names = new Set<string>();
  for (const c of Object.values(world.citizens)) {
    if (!c.familyName || !adult(c) || !isPresent(world, c)) continue;
    names.add(c.familyName);
  }
  return [...names].sort();
}

// ---------------------------------------------------------------------------
// Heritage
// ---------------------------------------------------------------------------

/**
 * How many generations back a departed member stands from the living: the
 * shortest chain of children from them down to a living adult of the name. A
 * member with no living descendant counts as the generation just gone.
 */
export function generationsBack(world: World, m: Citizen, name: string): number {
  const living = new Set(livingAdults(world, name).map((c) => c.id));
  if (living.size === 0) return 1;
  let front: CitizenId[] = [m.id];
  const seen = new Set<CitizenId>(front);
  for (let depth = 1; depth <= MAX_GENERATIONS; depth++) {
    const next: CitizenId[] = [];
    for (const id of front) {
      const c = world.citizens[id];
      for (const childId of c?.family?.children ?? []) {
        if (seen.has(childId)) continue;
        seen.add(childId);
        if (living.has(childId)) return depth;
        next.push(childId);
      }
    }
    if (next.length === 0) break;
    front = next;
  }
  return 1;
}

/** What one departed member's own deeds are still worth to the name. */
export function heritageOfMember(world: World, m: Citizen, name: string): number {
  const worth = contributionWorth(contributionLedger(world, m.id));
  if (worth <= 0) return 0;
  return worth * GENERATION_DECAY ** generationsBack(world, m, name);
}

/** What one term of office is still worth, halving every four cycles since. */
export function officeWorth(world: World, term: OfficeTerm): number {
  const weight = OFFICE_WEIGHTS[term.kind] ?? 0;
  const since = Math.max(0, (world.government?.cycle ?? 0) - term.cycle);
  return weight * 0.5 ** (since / OFFICE_HALF_LIFE_CYCLES);
}

/**
 * The heritage term: the dead's own contribution, decayed a generation at a
 * time, plus every office the name has held, halving every four cycles.
 * Capped at 250 — a quarter of the scale — and never more.
 */
export function heritageOf(world: World, name: string): number {
  let total = 0;
  for (const m of departedMembers(world, name)) total += heritageOfMember(world, m, name);
  for (const term of officesOf(world, name)) total += officeWorth(world, term);
  return Math.min(HERITAGE_CAP, total);
}

// ---------------------------------------------------------------------------
// Stain
// ---------------------------------------------------------------------------

/** What a conviction costs a name before any decay; 0 for a civic offence under severity 3. */
export function stainBase(k: Conviction): number {
  const custodial = isPersonLaw(k.law) || k.tier === null;
  if (!custodial) return k.severity >= 3 ? STAIN_CIVIC : 0;
  if (k.law === 'P07' || k.law === 'P08' || k.law === 'P09') return STAIN_GRAVEST;
  return STAIN_CUSTODIAL;
}

/** What one stain costs today: 1 % less for every clean day the house has had. */
export function stainValue(s: HouseStain): number {
  return s.base * (1 - STAIN_DECAY) ** Math.max(0, s.cleanDays);
}

/** Was anybody of this name convicted of anything on that day? */
function convictedOn(world: World, name: string, day: number): boolean {
  return bornTo(world, name).some((c) => (c.record?.convictions ?? []).some((k) => k.day === day));
}

/**
 * The morning's work on a name's stains: convictions the record has gained are
 * entered, convictions an appeal set aside are struck, and every stain that had
 * a clean yesterday decays a little. A day on which any member of the house was
 * convicted of anything at all is not a clean day, however small the offence.
 */
export function accrueStains(world: World, name: string): HouseStain[] {
  const held = stainsOf(world, name);
  const members = bornTo(world, name);
  const live = new Set<string>();
  for (const c of members) for (const k of c.record?.convictions ?? []) live.add(k.caseId);

  // A sponsored applicant's conviction is entered by `letters.ts` and is not a
  // member's, so it is kept whatever the members' records now say.
  for (let i = held.length - 1; i >= 0; i--) {
    if (!held[i].sponsored && !live.has(held[i].caseId)) held.splice(i, 1);
  }

  const seen = new Set(held.map((s) => s.caseId));
  for (const c of members) {
    for (const k of c.record?.convictions ?? []) {
      if (seen.has(k.caseId)) continue;
      const base = stainBase(k);
      seen.add(k.caseId);
      if (base <= 0) continue;
      held.push({ caseId: k.caseId, citizenId: c.id, law: k.law, day: k.day, base, cleanDays: 0, sponsored: false });
    }
  }

  const clean = !convictedOn(world, name, world.day) && !convictedOn(world, name, world.day - 1);
  if (clean) {
    for (const s of held) if (world.day > s.day) s.cleanDays += 1;
  } else {
    generationsState(world).lastConvictionDay[name] = world.day;
  }
  return held;
}

/** What this name's convictions cost it today, all of them together. */
export function stainOf(world: World, name: string): number {
  let total = 0;
  for (const s of stainsOf(world, name)) total += stainValue(s);
  return total;
}

// ---------------------------------------------------------------------------
// The number itself
// ---------------------------------------------------------------------------

/** The mean repute of a name's living adults, or the baseline when there are none. */
export function meanLivingRepute(world: World, name: string): number {
  const adults = livingAdults(world, name);
  if (adults.length === 0) return HOUSE_BASELINE;
  let total = 0;
  for (const c of adults) total += reputeOf(world, c.id);
  return total / adults.length;
}

export interface HouseReputeBreakdown {
  name: string;
  repute: number;
  target: number;
  living: number;
  livingAdults: number;
  heritage: number;
  stain: number;
}

/** Where the morning's relaxation is pulling this name, with every part broken out. */
export function houseTarget(world: World, name: string): HouseReputeBreakdown {
  const adults = livingAdults(world, name);
  const mean = meanLivingRepute(world, name);
  const living = LIVING_WEIGHT * (mean - HOUSE_BASELINE);
  const heritage = heritageOf(world, name);
  const stain = stainOf(world, name);
  const target = clamp(HOUSE_BASELINE + living + heritage - stain, HOUSE_REPUTE_MIN, HOUSE_REPUTE_MAX);
  return {
    name,
    repute: houseReputeOf(world, name),
    target: Math.round(target),
    living: Math.round(living),
    livingAdults: adults.length,
    heritage: Math.round(heritage),
    stain: Math.round(stain),
  };
}

/**
 * A name's public figure as the register holds it. A name the register has
 * never seen sits at the average, because a name nobody has heard of is
 * neither better nor worse than any other.
 */
export function houseReputeOf(world: World, name: string): number {
  if (!name) return HOUSE_BASELINE;
  const held = generationsState(world).repute[name];
  return held === undefined ? HOUSE_BASELINE : Math.round(held);
}

/** The house repute of a citizen's own name. */
export function houseReputeFor(world: World, cId: CitizenId): number {
  const c = world.citizens[cId];
  return c ? houseReputeOf(world, c.familyName) : HOUSE_BASELINE;
}

/**
 * The morning's recomputation (`GENERATIONS.md` §1), run right after each
 * citizen's own repute. Every name with a living adult member is relaxed 15 %
 * of the way toward its target; a name whose last adult has gone keeps the
 * figure it had, exactly as an exile keeps the repute they left with.
 */
export function dailyHouseRepute(world: World): void {
  const s = generationsState(world);
  for (const name of houseNames(world)) {
    accrueStains(world, name);
    const { target } = houseTarget(world, name);
    const held = s.repute[name] ?? HOUSE_BASELINE;
    s.repute[name] = clamp(held + RELAXATION * (target - held), HOUSE_REPUTE_MIN, HOUSE_REPUTE_MAX);
  }
}

/** Every name's figure, highest first — the register as anybody may read it. */
export function houseReputeRoll(world: World): { name: string; repute: number; adults: number }[] {
  return houseNames(world)
    .map((name) => ({ name, repute: houseReputeOf(world, name), adults: livingAdults(world, name).length }))
    .sort((a, b) => b.repute - a.repute || a.name.localeCompare(b.name, 'en'));
}

// ---------------------------------------------------------------------------
// Offices held, as the heritage term counts them
// ---------------------------------------------------------------------------

/** Enter one term of office against a name, once per cycle per citizen per office. */
export function noteOffice(world: World, cId: CitizenId, kind: OfficeKind): OfficeTerm | null {
  const c = world.citizens[cId];
  if (!c || !c.familyName) return null;
  const cycle = world.government?.cycle ?? 0;
  const held = officesOf(world, c.familyName);
  if (held.some((t) => t.kind === kind && t.cycle === cycle && t.citizenId === cId)) return null;
  const term: OfficeTerm = { kind, cycle, citizenId: cId };
  held.push(term);
  return term;
}

/**
 * The morning's reading of who is serving. A cycle in an office counts once,
 * however many mornings it is read, and it counts for the name the office
 * holder carries that day.
 */
export function accrueOffices(world: World): void {
  const s = generationsState(world);
  if (s.officesDay === world.day) return;
  s.officesDay = world.day;
  const g = world.government;
  if (!g) return;
  if (g.mayorId) noteOffice(world, g.mayorId, 'mayor');
  for (const id of g.council ?? []) noteOffice(world, id, 'council');
  for (const id of g.judges ?? []) noteOffice(world, id, 'judge');
  if (g.watchCaptainId) noteOffice(world, g.watchCaptainId, 'watch');
}

/**
 * Birth: the ceremony at the Restoration Ward that turns a family's decision
 * (society/family.startFamily) into a citizen. The child takes the mean of
 * its parents' traits with a little noise, one talent from what a parent is
 * best at, its parents' family name and a place under their roof — a cot
 * fits where a lodger would not, so a newborn is never turned away for want
 * of room. It is a child for CHILDHOOD_DAYS (see family.dailyLifeStages).
 *
 * society/family.ts re-exports birthChild; calendar.tickHappenings holds the
 * Happening. Nothing here throws: a birth to parents who have left the city
 * still brings a citizen into the world, as a ward of it.
 */
import { TRAITS, clamp } from '../types.ts';
import type { BuildingId, Citizen, CitizenId, DistrictId, Happening, Personality, Skills, World } from '../types.ts';
import { normal, pick, randInt } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { createCitizen, talentOf } from '../citizens/citizen.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { TIER_NAMES, householdOf, houseNewborn } from './households.ts';

/** Where a child is born, and where children live. */
export const BIRTH_VENUE: BuildingId = 'restoration_ward';
export const BIRTH_HOUR = 7;
export const CHILD_DISTRICT: DistrictId = 'verdant_quarter';
/** How far a newborn's traits may drift from the mean of its parents'. */
export const PERSONALITY_NOISE = 0.1;
/** A parent knows their newborn at once; siblings take to each other nearly as fast. */
export const BIRTH_BOND = 50;
export const SIBLING_BOND = 30;
export const BIRTH_PURPOSE = 10;

/** A citizen living in the city (not exiled, not departed). */
function presentCitizen(world: World, id: CitizenId): Citizen | null {
  const c = world.citizens[id];
  return c && c.standing !== 'exiled' && world.order.includes(id) ? c : null;
}

function addNeed(c: Citizen, need: keyof Citizen['needs'], delta: number): void {
  c.needs[need] = clamp(c.needs[need] + delta, 0, 100);
}

function buildingName(world: World, id: BuildingId | null): string {
  return id ? world.buildings[id]?.name ?? id : 'the open air';
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The mean of the parents' traits, nudged by PERSONALITY_NOISE. */
function blendPersonality(world: World, parents: Citizen[]): Partial<Personality> {
  const p: Partial<Personality> = {};
  for (const t of TRAITS) {
    const mean = parents.length
      ? parents.reduce((sum, parent) => sum + parent.personality[t], 0) / parents.length
      : 0.5;
    p[t] = clamp(Math.round((mean + normal(world) * PERSONALITY_NOISE) * 100) / 100, 0.05, 0.95);
  }
  return p;
}

/** One talent, drawn from what a parent is best at. */
function inheritTalent(world: World, parents: Citizen[]): Partial<Skills> {
  if (parents.length === 0) return {};
  const talent = talentOf(pick(world, parents));
  return { [talent]: randInt(world, 35, 70) } as Partial<Skills>;
}

/** The name a child is born to: the one both parents share, else the better-known parent's. */
function childFamilyName(parents: Citizen[]): string | undefined {
  if (parents.length === 0) return undefined;
  if (parents.length === 1 || parents[0].familyName === parents[1].familyName) return parents[0].familyName;
  return parents[0].reputation >= parents[1].reputation ? parents[0].familyName : parents[1].familyName;
}

/**
 * The birth itself, held by calendar.tickHappenings: a new citizen with its
 * parents' traits and one of their talents, a child for CHILDHOOD_DAYS, under
 * its parents' roof whatever the tier's capacity. A child born to nobody
 * still living in the city is born a ward. Never throws.
 */
export function birthChild(world: World, h: Happening): Citizen {
  const parents = h.who.map((id) => presentCitizen(world, id)).filter((p): p is Citizen => !!p);
  const child = createCitizen(world, {
    lifeStage: 'child',
    parents: parents.map((p) => p.id),
    familyName: childFamilyName(parents),
    personality: blendPersonality(world, parents),
    skills: inheritTalent(world, parents),
    brain: 'reflex',
    district: CHILD_DISTRICT,
    bornDay: world.day,
  });

  const siblings: Citizen[] = [];
  for (const p of parents) {
    if (!p.family.children.includes(child.id)) p.family.children.push(child.id);
    adjustBond(world, p.id, child.id, BIRTH_BOND);
    addNeed(p, 'purpose', BIRTH_PURPOSE);
    for (const s of p.family.children) {
      const sib = s !== child.id ? presentCitizen(world, s) : null;
      if (sib && !siblings.includes(sib)) siblings.push(sib);
    }
  }
  for (const s of siblings) {
    adjustBond(world, s.id, child.id, SIBLING_BOND);
    remember(world, s.id, 'family', `${child.name} was born: you have a new sibling.`);
  }

  const ward = buildingName(world, h.buildingId ?? BIRTH_VENUE);
  const host = parents.find((p) => householdOf(world, p.id));
  const home = host ? houseNewborn(world, child.id, host.id) : null;
  const roof = home ? ` at ${TIER_NAMES[home.tier]}` : '';
  for (const p of parents) {
    remember(world, p.id, 'family', `Your child ${child.name} ${child.familyName} was born at ${ward}${roof}.`);
  }

  const to = parents.length ? ` to ${nameList(parents.map((p) => p.name))}` : ', a ward of the city,';
  emit(world, 'birth', `${child.name} ${child.familyName} was born${to} at ${ward}.`,
    [child.id, ...parents.map((p) => p.id)], 0.8, { happeningId: h.id, childId: child.id, parents: parents.map((p) => p.id) });
  return child;
}

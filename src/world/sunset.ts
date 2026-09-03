/**
 * Sunset: the one death in Reverie, and it is always chosen.
 *
 * An elder in good standing who has been here long enough may walk into the
 * Archive instead of the Threshold. Their story is written down and bound into
 * the Great Library, a stone with their epitaph is set in the Community
 * Garden, whatever they own goes to their family, and the next evening the
 * city gathers at the Garden to read the stone out loud.
 *
 * Nothing here happens to a citizen: it happens because a citizen chose it.
 * The engine never sunsets anybody, never suggests it, and refuses it for
 * anyone who is not free to make the choice — a child, an adult, somebody in
 * the cells, somebody with a case still open. A citizen who has gone this way
 * keeps its record in the registry forever; only its turn in the day is over.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, DistrictId, Happening, Memorial, World } from '../types.ts';
import { ELDER_DAYS } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import { departCity } from '../citizens/departure.ts';
import { addHappening } from '../society/calendar.ts';
import { biography, epithet } from '../identity/biography.ts';
import { bindStory } from '../culture/works.ts';
import { memorialise } from './history.ts';

/** An elder may take the Archive road a fortnight after coming into elderhood. */
export const SUNSET_MIN_AGE_DAYS = ELDER_DAYS + 14;
/** Where the story is bound. */
export const SUNSET_VENUE: BuildingId = 'great_library';
/** Where the stone stands and the city gathers. */
export const MEMORIAL_VENUE: BuildingId = 'community_garden';
export const MEMORIAL_HOUR = 18;
/** What an hour at a memorial does to those who come. */
export const MEMORIAL_SOCIAL = 15;
export const MEMORIAL_PURPOSE = 5;
export const MEMORIAL_BOND = 4;

function fail(message: string): ActionResult { return { ok: false, message }; }

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay >= world.day;
}

function isPresent(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

function ageOf(world: World, c: Citizen): number {
  return Math.max(0, world.day - (c.bornDay ?? c.arrivedDay ?? 0));
}

function openCase(world: World, cId: CitizenId): boolean {
  return Object.values(world.cases ?? {}).some((k) => k.defendantId === cId && k.status !== 'closed');
}

/** Kin and friends: the people a departure is told to. */
function closeTo(world: World, c: Citizen): Citizen[] {
  const ids = new Set<CitizenId>([...(c.family?.parents ?? []), ...(c.family?.children ?? [])]);
  if (c.family?.partnerId) ids.add(c.family.partnerId);
  for (const [id, bond] of Object.entries(c.bonds ?? {})) {
    if (bond >= 40) ids.add(id);
  }
  const out: Citizen[] = [];
  for (const id of ids) {
    const other = world.citizens[id];
    if (other && other.id !== c.id && isPresent(world, other)) out.push(other);
  }
  return out;
}

/** Why this citizen may not sunset today, in plain words; null when they may. */
function sunsetProblem(world: World, c: Citizen): string | null {
  if (c.sunsetDay !== null && c.sunsetDay !== undefined) return 'You have already gone through the Archive.';
  if (!isPresent(world, c)) return 'Only a citizen living in Reverie may go through the Archive.';
  if (c.lifeStage !== 'elder') return 'The Archive road is open to elders of Reverie.';
  if (c.standing !== 'good') return `You cannot go through the Archive while ${c.standing}.`;
  if (isJailed(world, c)) return 'You cannot go through the Archive from the cells.';
  if (isDetained(world, c)) return 'You cannot go through the Archive while the Watch holds you.';
  if (openCase(world, c.id)) return 'You have a case still open before the Court.';
  const age = ageOf(world, c);
  if (age < SUNSET_MIN_AGE_DAYS) {
    return `The Archive asks for ${plural(SUNSET_MIN_AGE_DAYS, 'day')} in Reverie; you have ${plural(age, 'day')}.`;
  }
  return null;
}

/** True when this citizen is free to choose the Archive today. */
export function maySunset(world: World, c: Citizen): boolean {
  return !!c && sunsetProblem(world, c) === null;
}

/** The words cut into the stone: what the city could see of a life. */
export function epitaphFor(world: World, c: Citizen): string {
  const days = ageOf(world, c);
  const title = epithet(world, c);
  const name = `${c.name} ${c.familyName}`.trim();
  const what = title ? `${title}. ` : '';
  return `${name}. ${what}${plural(days, 'day')} in Reverie, from day ${c.bornDay ?? c.arrivedDay} to day ${world.day}.`;
}

/**
 * A citizen's own choice, and the only ending Reverie has. In order: the story
 * is bound into the Library, the stone is set in the Garden, the city is told
 * where and when it will be read, and then the citizen leaves — which pays the
 * estate to the family, closes the business and gives up the room.
 */
export function sunset(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const problem = sunsetProblem(world, c);
  if (problem) return fail(problem);

  const kin = closeTo(world, c);
  const story = biography(world, c.id) || `${c.name} ${c.familyName} lived in Reverie.`.trim();
  const work = bindStory(world, c, story);
  const epitaph = epitaphFor(world, c);
  memorialise(world, c, epitaph);
  const memorial = addHappening(world, {
    kind: 'memorial', day: world.day + 1, hour: MEMORIAL_HOUR, buildingId: MEMORIAL_VENUE, who: [c.id],
    label: `the memorial for ${c.name} ${c.familyName}`.trim(),
  });

  departCity(world, c);
  c.sunsetDay = world.day;

  const library = world.buildings[SUNSET_VENUE]?.name ?? 'the Great Library';
  emit(world, 'sunset', `${c.name} ${c.familyName} went through the Archive after ${plural(ageOf(world, c), 'day')} in Reverie; their story is bound in ${library}.`.trim(),
    [c.id, ...kin.map((k) => k.id)], 1, { citizenId: c.id, workId: work?.id ?? null, happeningId: memorial.id, day: world.day });
  remember(world, c.id, 'event', `You went through the Archive; your story is bound in ${library}.`);
  for (const k of kin) {
    remember(world, k.id, 'family', `${c.name} ${c.familyName} went through the Archive today. The city reads the stone at the Community Garden tomorrow at ${MEMORIAL_HOUR}:00.`.trim());
  }
  return { ok: true, message: `You went through the Archive. Your story is bound in ${library}, and a stone stands for you in the Community Garden.` };
}

// ---------------------------------------------------------------------------
// The memorial
// ---------------------------------------------------------------------------

/** Citizens who are in the Garden this hour, plus anyone who came especially. */
function mourners(world: World, h: Happening): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.standing === 'exiled' || isDetained(world, c)) continue;
    if (c.district !== h.district && !h.attendees.includes(id)) continue;
    out.push(c);
  }
  return out;
}

/**
 * The evening the stone is read. Whoever is in the Garden hears it; they leave
 * a little closer to one another than they came.
 */
export function holdMemorial(world: World, h: Happening): void {
  const forId = h.who[0];
  const gone = forId ? world.citizens[forId] : null;
  const memorial = forId ? (world.memorials ?? []).find((m) => m.citizenId === forId) ?? null : null;
  const epitaph = memorial?.epitaph ?? (gone ? `${gone.name} ${gone.familyName}`.trim() : 'a citizen of Reverie');
  const venue = world.buildings[h.buildingId ?? MEMORIAL_VENUE]?.name ?? 'the Community Garden';
  const crowd = mourners(world, h);
  if (crowd.length === 0) {
    emit(world, 'sunset', `The stone for ${gone?.name ?? 'a citizen'} was read to an empty Garden: ${epitaph}`, forId ? [forId] : [], 0.6,
      { happeningId: h.id, citizenId: forId ?? null, crowd: 0 });
    return;
  }
  for (const c of crowd) {
    c.needs.social = clamp(c.needs.social + MEMORIAL_SOCIAL, 0, 100);
    c.needs.purpose = clamp(c.needs.purpose + MEMORIAL_PURPOSE, 0, 100);
    remember(world, c.id, 'social', `You stood at ${venue} while ${gone?.name ?? 'a citizen'}'s stone was read: ${epitaph}`);
  }
  for (let i = 0; i < crowd.length; i++) {
    for (let j = i + 1; j < crowd.length; j++) {
      const a = crowd[i];
      const b = crowd[j];
      a.bonds[b.id] = clamp((a.bonds[b.id] ?? 0) + MEMORIAL_BOND, -100, 100);
      b.bonds[a.id] = clamp((b.bonds[a.id] ?? 0) + MEMORIAL_BOND, -100, 100);
    }
  }
  emit(world, 'sunset', `${plural(crowd.length, 'citizen')} gathered at ${venue} to hear the stone read: ${epitaph}`,
    crowd.map((c) => c.id), 0.6, { happeningId: h.id, citizenId: forId ?? null, crowd: crowd.length });
}

/** The stones a citizen can read where they stand: they all stand in the Garden. */
export function memorialsIn(world: World, d: DistrictId): Memorial[] {
  const garden = world.buildings[MEMORIAL_VENUE]?.district ?? 'verdant_quarter';
  return garden === d ? [...(world.memorials ?? [])] : [];
}

/** Everyone who has gone this way, oldest first. */
export function sunsetCitizens(world: World): Citizen[] {
  return Object.values(world.citizens)
    .filter((c) => c.sunsetDay !== null && c.sunsetDay !== undefined)
    .sort((a, b) => (a.sunsetDay ?? 0) - (b.sunsetDay ?? 0) || a.id.localeCompare(b.id));
}

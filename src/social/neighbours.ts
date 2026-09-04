/**
 * Neighbours — the people on your stairs.
 *
 * A citizen's home is a *block* (`homeBuildingId`), not just a tier, and
 * everyone in the same block is a neighbour. Living alongside somebody is
 * worth a little every day: bonds between neighbours creep up by
 * NEIGHBOUR_BOND to a ceiling of NEIGHBOUR_BOND_CAP — enough to be on good
 * terms, never enough on its own to make a friend. Friendship still has to be
 * earned somewhere else.
 *
 * On Stillday every block with two or more residents throws a **block party**
 * in the evening, and neighbours are the first to be told when something
 * happens at home: a birth, an eviction, a glitch on the landing, the Watch at
 * the door.
 *
 * A citizen with nowhere to live has no neighbours. That is most of what being
 * homeless in Reverie means.
 */
import { clamp } from '../types.ts';
import type { BuildingId, Citizen, CitizenId, DistrictId, Happening, World } from '../types.ts';
import { districtOfBuilding } from '../data/city.ts';
import { emit, remember } from '../sim/events.ts';
import { isDetained, isPresent } from '../citizens/citizen.ts';
import { adjustBond, bondBetween } from '../citizens/relationships.ts';
import { recordContact } from '../society/affection.ts';
import { addHappening, happeningsAt, weekday } from '../society/calendar.ts';

/** Bond a day of sharing a stairwell is worth. */
export const NEIGHBOUR_BOND = 1;
/** As far as living alongside somebody will take a bond on its own. */
export const NEIGHBOUR_BOND_CAP = 30;
/** Stillday. */
export const BLOCK_PARTY_WEEKDAY = 6;
export const BLOCK_PARTY_HOUR = 18;
/** Residents a block needs before it is worth throwing a party. */
export const BLOCK_PARTY_MIN_RESIDENTS = 2;
export const BLOCK_PARTY_SOCIAL = 18;
export const BLOCK_PARTY_COMFORT = 6;
export const BLOCK_PARTY_BOND = 4;

function buildingName(world: World, id: BuildingId): string {
  return world.buildings[id]?.name ?? id;
}

function districtOf(world: World, id: BuildingId): DistrictId {
  return world.buildings[id]?.district ?? districtOfBuilding(id);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

/** Present and free to take part: not exiled, not gone, not in the Watch House. */
function isAround(world: World, c: Citizen): boolean {
  return isPresent(world, c) && !isDetained(world, c);
}

/** Every present citizen with a home, grouped by the block they live in. */
export function blocks(world: World): Map<BuildingId, Citizen[]> {
  const out = new Map<BuildingId, Citizen[]>();
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !c.homeBuildingId || !isPresent(world, c)) continue;
    const list = out.get(c.homeBuildingId);
    if (list) list.push(c);
    else out.set(c.homeBuildingId, [c]);
  }
  return out;
}

/** Present citizens who live in one block. */
export function residentsOf(world: World, buildingId: BuildingId | null): Citizen[] {
  if (!buildingId) return [];
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.homeBuildingId === buildingId && isPresent(world, c)) out.push(c);
  }
  return out;
}

/** The citizens who share a citizen's block, that citizen excepted. */
export function neighboursOf(world: World, cId: CitizenId): Citizen[] {
  const c = world.citizens[cId];
  if (!c || !c.homeBuildingId || !isPresent(world, c)) return [];
  return residentsOf(world, c.homeBuildingId).filter((o) => o.id !== cId);
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** Raise one direction of a bond toward the neighbourly ceiling, never past it. */
function warm(world: World, a: CitizenId, b: CitizenId): void {
  const current = bondBetween(world, a, b);
  if (current >= NEIGHBOUR_BOND_CAP) return;
  const delta = Math.min(NEIGHBOUR_BOND, NEIGHBOUR_BOND_CAP - current);
  if (delta > 0) adjustBond(world, a, b, delta, false);
}

/** A day of passing each other on the stairs. */
export function dailyNeighbours(world: World): void {
  for (const residents of blocks(world).values()) {
    if (residents.length < 2) continue;
    for (let i = 0; i < residents.length; i++) {
      for (let j = i + 1; j < residents.length; j++) {
        warm(world, residents[i].id, residents[j].id);
        warm(world, residents[j].id, residents[i].id);
      }
    }
  }
}

/**
 * Stillday evening: one party per block with two or more residents, at the
 * block itself. Idempotent — a block already holding one today is left alone.
 */
export function scheduleBlockParties(world: World): void {
  world.happenings ??= [];
  if (weekday(world) !== BLOCK_PARTY_WEEKDAY) return;
  for (const [buildingId, residents] of blocks(world)) {
    if (residents.length < BLOCK_PARTY_MIN_RESIDENTS) continue;
    const district = districtOf(world, buildingId);
    const already = world.happenings.some(
      (h) => h.kind === 'block_party' && h.day === world.day && h.buildingId === buildingId,
    );
    if (already) continue;
    const name = buildingName(world, buildingId);
    addHappening(world, {
      kind: 'block_party', day: world.day, hour: BLOCK_PARTY_HOUR, buildingId, district,
      who: residents.map((c) => c.id), label: `the block party at ${name}`,
    });
    for (const c of residents) {
      remember(world, c.id, 'social', `There is a block party at ${name} tonight at ${BLOCK_PARTY_HOUR}:00.`);
    }
  }
}

/** Everyone at the party: whoever came, plus the residents who are home. */
function partygoers(world: World, h: Happening): Citizen[] {
  const seen = new Set<CitizenId>();
  const out: Citizen[] = [];
  const add = (c: Citizen | undefined): void => {
    if (!c || seen.has(c.id) || !isAround(world, c)) return;
    seen.add(c.id);
    out.push(c);
  };
  for (const id of world.order) {
    if (h.attendees.includes(id)) add(world.citizens[id]);
  }
  for (const resident of residentsOf(world, h.buildingId)) {
    if (resident.district === h.district) add(resident);
  }
  return out;
}

/** Hold the party: a good evening on the landing for everyone who is there. */
export function holdBlockParty(world: World, h: Happening): void {
  const name = h.buildingId ? buildingName(world, h.buildingId) : 'the block';
  const crowd = partygoers(world, h);
  if (crowd.length === 0) {
    emit(world, 'festival', `The block party at ${name} was called off: nobody was home.`, [], 0.1,
      { happeningId: h.id, crowd: 0 });
    return;
  }
  for (const c of crowd) {
    c.needs.social = clamp(c.needs.social + BLOCK_PARTY_SOCIAL, 0, 100);
    c.needs.comfort = clamp(c.needs.comfort + BLOCK_PARTY_COMFORT, 0, 100);
    if (!h.attendees.includes(c.id)) h.attendees.push(c.id);
  }
  for (let i = 0; i < crowd.length; i++) {
    for (let j = i + 1; j < crowd.length; j++) {
      adjustBond(world, crowd[i].id, crowd[j].id, BLOCK_PARTY_BOND);
      recordContact(world, crowd[i].id, crowd[j].id);
    }
  }
  for (const c of crowd) {
    remember(world, c.id, 'social', `You spent Stillday evening at the block party at ${name} with ${plural(crowd.length - 1, 'neighbour')}.`);
  }
  emit(world, 'festival', `${plural(crowd.length, 'neighbour')} kept Stillday together at the block party at ${name}.`,
    crowd.map((c) => c.id), 0.3, { happeningId: h.id, crowd: crowd.length, building: h.buildingId });
}

/**
 * Tell the block. Births, evictions, glitches and the Watch at the door reach
 * the neighbours first, whether they want the news or not.
 */
export function tellNeighbours(world: World, cId: CitizenId, text: string): void {
  const line = (text ?? '').replace(/\s+/g, ' ').trim();
  if (!line) return;
  for (const n of neighboursOf(world, cId)) remember(world, n.id, 'event', line);
}

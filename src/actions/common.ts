/**
 * Helpers shared by the action handlers: result constructors, presence
 * checks, and the memory format victims use to name who wronged them (the id
 * is included so a victim — reflex or Claude — can file a report).
 */
import type { ActionResult, Building, Citizen, CitizenId, DistrictId, OffenceCode, World } from '../types.ts';
import { isFrozen, memo, memoBy } from '../util/memo.ts';
import { presentIds } from '../citizens/relationships.ts';

export function fail(message: string, extra: Partial<ActionResult> = {}): ActionResult {
  return { ok: false, message, ...extra };
}

export function ok(message: string, extra: Partial<ActionResult> = {}): ActionResult {
  return { ok: true, message, ...extra };
}

/** Held in the Watch House until a future tick. */
export function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

/** Living in the city: not exiled and still in the turn order. */
export function isPresent(world: World, c: Citizen): boolean {
  if (c.standing === 'exiled') return false;
  return isFrozen(world) ? presentIds(world).has(c.id) : world.order.includes(c.id);
}

/** Present and free to be met: not exiled, not emigrated, not locked up. */
export function isAround(world: World, c: Citizen): boolean {
  return isPresent(world, c) && !isDetained(world, c);
}

/** Citizens who can be met in a district (excluding `except`), in turn order. */
export function citizensIn(world: World, district: DistrictId, except?: CitizenId): Citizen[] {
  // Walking the turn order already proves that everybody in it is present, so
  // `isAround` is spelt out here rather than called: asking it would search
  // the whole order again for each of the citizens it was just read from, and
  // that search is what made a district roll cost the square of the city.
  const all = memoBy(world, 'district:in', district, () => {
    const out: Citizen[] = [];
    for (const id of world.order) {
      const c = world.citizens[id];
      if (c && c.district === district && c.standing !== 'exiled' && !isDetained(world, c)) out.push(c);
    }
    return out;
  });
  return except === undefined ? all : all.filter((c) => c.id !== except);
}

/** A citizen who can be the object of an action: exists and is around. */
export function targetOf(world: World, id: CitizenId): Citizen | null {
  const t = world.citizens[id];
  return t && isAround(world, t) ? t : null;
}

/** Holds any public office (mayor, councillor, judge or Watch). */
export function holdsOffice(world: World, c: Citizen): boolean {
  const g = world.government;
  return c.office !== null || g.mayorId === c.id || g.council.includes(c.id) || g.judges.includes(c.id) || g.watch.includes(c.id);
}

/**
 * Everyone in the city who holds an office right now. Every citizen asks the
 * same question of the same roll (is there anybody to bribe?), so during a
 * reading round the roll is taken once for the whole city (`util/memo.ts`).
 */
export function officeHoldersPresent(world: World): Set<CitizenId> {
  return memo(world, 'office:present', () => {
    const out = new Set<CitizenId>();
    for (const id of world.order) {
      const c = world.citizens[id];
      if (c && c.standing !== 'exiled' && holdsOffice(world, c)) out.add(c.id);
    }
    return out;
  });
}

/** Somebody other than this citizen holds an office in the city. */
export function anotherHoldsOffice(world: World, c: Citizen): boolean {
  const held = officeHoldersPresent(world);
  return held.size > (held.has(c.id) ? 1 : 0);
}

/** Somebody other than this citizen still lives in the city. */
export function anyoneElsePresent(world: World, c: Citizen): boolean {
  const present = presentIds(world);
  return present.size > (present.has(c.id) ? 1 : 0);
}

/**
 * The buildings that stand in a district, and those of them still whole enough
 * to be damaged further. Every citizen in a district reads the same lists —
 * what is here, what can be broken, what can be sabotaged — so they are
 * gathered once per district for a whole reading round; `world/buildings.ts`
 * keeps the register, since the Stadium and the galleries ask the same
 * question and may not import the action layer.
 */
export { buildingsIn, intactBuildingsIn } from '../world/buildings.ts';

/** "Bram (c_3)": how a victim remembers who wronged them. */
export function nameTag(c: Citizen): string {
  return `${c.name} (${c.id})`;
}

export function districtName(world: World, d: DistrictId): string {
  return world.districts[d]?.name ?? d;
}

/** Stealing this much or more is grand theft (L08) rather than petty theft (L04). */
export const GRAND_THEFT_THRESHOLD = 50;

export interface Grievance {
  actorId: CitizenId;
  /** Either code: a victim's grievance may belong to either track. */
  law: OffenceCode;
  amount: number;
}

const GRIEVANCE_RE = /\((c_\d+)\) (picked your pocket for (\d+) ℓ|tried to pick your pocket|scammed you out of (\d+) ℓ|tried to sell you something|extorted (\d+) ℓ from you|threatened you|harassed you|insulted you|assaulted you|beat you|held you against your will)/;

/**
 * Read a victim's memory ("Bram (c_3) picked your pocket for 34 ℓ.") back
 * into who did it and under which law. Null for any other memory.
 */
export function parseGrievance(text: string): Grievance | null {
  const m = GRIEVANCE_RE.exec(text);
  if (!m) return null;
  const actorId = m[1];
  const phrase = m[2];
  if (phrase.startsWith('picked your pocket')) {
    const amount = Number(m[3]);
    return { actorId, law: amount >= GRAND_THEFT_THRESHOLD ? 'L08' : 'L04', amount };
  }
  if (phrase.startsWith('tried to pick')) return { actorId, law: 'L04', amount: 0 };
  if (phrase.startsWith('scammed')) return { actorId, law: 'L07', amount: Number(m[4]) };
  if (phrase.startsWith('tried to sell')) return { actorId, law: 'L07', amount: 0 };
  // Extortion and harassment left the Code of the City with the two-track
  // reform: they are offences against a *person* and read as P06 and P02.
  if (phrase.startsWith('extorted')) return { actorId, law: 'P06', amount: Number(m[5]) };
  if (phrase.startsWith('threatened')) return { actorId, law: 'P01', amount: 0 };
  if (phrase.startsWith('assaulted')) return { actorId, law: 'P03', amount: 0 };
  if (phrase.startsWith('beat')) return { actorId, law: 'P04', amount: 0 };
  if (phrase.startsWith('held you')) return { actorId, law: 'P05', amount: 0 };
  return { actorId, law: 'P02', amount: 0 };
}

/**
 * Helpers shared by the action handlers: result constructors, presence
 * checks, and the memory format victims use to name who wronged them (the id
 * is included so a victim — reflex or Claude — can file a report).
 */
import type { ActionResult, Citizen, CitizenId, DistrictId, OffenceCode, World } from '../types.ts';

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
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

/** Present and free to be met: not exiled, not emigrated, not locked up. */
export function isAround(world: World, c: Citizen): boolean {
  return isPresent(world, c) && !isDetained(world, c);
}

/** Citizens who can be met in a district (excluding `except`), in turn order. */
export function citizensIn(world: World, district: DistrictId, except?: CitizenId): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    if (id === except) continue;
    const c = world.citizens[id];
    if (c && c.district === district && isAround(world, c)) out.push(c);
  }
  return out;
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

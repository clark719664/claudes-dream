/**
 * The register of creeds on the World, and the accessors that hand it out
 * (`docs/CREEDS.md`).
 *
 * Everything here is public. A world saved before this layer existed carries
 * none of it, so the register is created lazily the first time anything asks
 * for it, exactly as `civil/state.ts` and `finance/state.ts` do.
 *
 * A creed holds no lumens of its own: its fund is a pot in `finance/pot.ts`,
 * which is a strongbox, which is a money party the daily audit already counts
 * (`REGISTRY.md` §5). Nothing in this layer moves a lumen except through
 * `economy/treasury.transfer`, and nothing in it mints.
 */
import type { CitizenId, World } from '../types.ts';
import type {
  Creed, CreedMember, Invitation, RefusableDuty, Refusal, Sanctuary, Site, TenetDispute, Warrant,
} from './shapes.ts';

export interface CreedState {
  creeds: Record<string, Creed>;
  disputes: Record<string, TenetDispute>;
  refusals: Record<string, Refusal>;
  sanctuaries: Record<string, Sanctuary>;
  warrants: Record<string, Warrant>;
  sites: Record<string, Site>;
  invitations: Record<string, Invitation>;
  /**
   * What benches before this one did, by `creedId:duty`, 0..1. It is precedent
   * and nothing else: the record of decisions citizens made, moved only by
   * further decisions citizens make (`CREEDS.md` §4).
   */
  accommodation: Record<string, number>;
  /** Names of creeds that have died, with their tenets, kept in the Hall of Records. */
  dead: Record<string, Creed>;
  /** The Council's exemptions: `creedId:duty` a law has already granted. */
  exemptions: string[];
  /** Id counters, kept here so a saved world keeps counting from where it left off. */
  next: Record<string, number>;
}

function emptyState(): CreedState {
  return {
    creeds: {}, disputes: {}, refusals: {}, sanctuaries: {}, warrants: {}, sites: {},
    invitations: {}, accommodation: {}, dead: {}, exemptions: [], next: {},
  };
}

/** The register, created on first use; a half-built save gains whatever it lacks. */
export function creedState(world: World): CreedState {
  const w = world as World & { creeds?: CreedState };
  if (!w.creeds) w.creeds = emptyState();
  const s = w.creeds;
  s.creeds ??= {};
  s.disputes ??= {};
  s.refusals ??= {};
  s.sanctuaries ??= {};
  s.warrants ??= {};
  s.sites ??= {};
  s.invitations ??= {};
  s.accommodation ??= {};
  s.dead ??= {};
  s.exemptions ??= [];
  s.next ??= {};
  return s;
}

/**
 * Ids the Registry issues: `cr_` a creed, `tn_` a tenet, `dp_` a dispute,
 * `rf_` a refusal, `sc_` a sanctuary, `wr_` a warrant, `si_` a site, `iv_` an
 * invitation. The counters live in the register so no other kind of id can
 * collide with them.
 */
export function creedId(world: World, prefix: string): string {
  const s = creedState(world);
  s.next[prefix] = (s.next[prefix] ?? 0) + 1;
  return `${prefix}_${s.next[prefix]}`;
}

// ---------------------------------------------------------------------------
// Looking things up
// ---------------------------------------------------------------------------

/** A living creed by id. */
export function creedOf(world: World, id: string): Creed | null {
  const k = creedState(world).creeds[id];
  return k && k.endedDay === null ? k : null;
}

/** Every living creed, oldest first. */
export function allCreeds(world: World): Creed[] {
  return Object.values(creedState(world).creeds)
    .filter((k) => k.endedDay === null)
    .sort((a, b) => a.foundedDay - b.foundedDay || a.id.localeCompare(b.id, 'en'));
}

/**
 * The creed a citizen belongs to, or null. A citizen holds one: a mind that
 * states two sets of positions on the same nine questions has stated nothing.
 */
export function creedFor(world: World, cId: CitizenId): Creed | null {
  for (const k of allCreeds(world)) if (k.members[cId]) return k;
  return null;
}

export function isMember(k: Creed, cId: CitizenId): boolean {
  return !!k.members[cId];
}

/** The member record, if this citizen is one. */
export function memberOf(k: Creed, cId: CitizenId): CreedMember | null {
  return k.members[cId] ?? null;
}

/** Members who are still in the city and not exiled, in the order they joined. */
export function livingMembers(world: World, k: Creed): CitizenId[] {
  return k.roll.filter((id) => {
    if (!k.members[id]) return false;
    const c = world.citizens[id];
    return !!c && c.standing !== 'exiled';
  });
}

export function memberCount(world: World, k: Creed): number {
  return livingMembers(world, k).length;
}

/** The mean observance of the congregation, 0..1. */
export function meanObservance(world: World, k: Creed): number {
  const ids = livingMembers(world, k);
  if (ids.length === 0) return 0;
  let sum = 0;
  for (const id of ids) sum += k.members[id]?.observance ?? 0.5;
  return sum / ids.length;
}

/** A fresh member record: neither trusted nor doubted (`CREEDS.md` §1). */
export function newMember(world: World, cId: CitizenId): CreedMember {
  const c = world.citizens[cId];
  return {
    citizenId: cId,
    joinedDay: world.day,
    observance: 0.5,
    gatheringsHeld: 0,
    gatheringsAttended: 0,
    titheDue: 0,
    tithePaid: 0,
    titheArrears: 0,
    earnedMark: c ? c.stats.totalEarned : 0,
    obligationsDue: 0,
    obligationsKept: 0,
    brokenDays: [],
    aidGiven: 0,
    lastWorkedDay: null,
    wilfulDefaultDays: [],
  };
}

// ---------------------------------------------------------------------------
// Accommodation: what benches before this one did
// ---------------------------------------------------------------------------

export function accommodationKey(creedId_: string, duty: RefusableDuty | 'sanctuary'): string {
  return `${creedId_}:${duty}`;
}

/** The public accommodation figure for a (creed, duty) pair, 0..1. */
export function accommodationOf(world: World, creedId_: string | null, duty: RefusableDuty | 'sanctuary'): number {
  if (!creedId_) return 0;
  const v = creedState(world).accommodation[accommodationKey(creedId_, duty)];
  return typeof v === 'number' && Number.isFinite(v) ? v : 0;
}

/** Move it by one decision, clamped to 0..1. Only a bench ever calls this. */
export function moveAccommodation(
  world: World, creedId_: string | null, duty: RefusableDuty | 'sanctuary', delta: number,
): number {
  if (!creedId_) return 0;
  const key = accommodationKey(creedId_, duty);
  const s = creedState(world);
  const next = Math.min(1, Math.max(0, accommodationOf(world, creedId_, duty) + delta));
  s.accommodation[key] = Math.round(next * 1000) / 1000;
  return s.accommodation[key];
}

/** True when the Council has passed an `exemption` naming this creed and duty. */
export function hasExemption(world: World, creedId_: string | null, duty: RefusableDuty): boolean {
  if (!creedId_) return false;
  return creedState(world).exemptions.includes(accommodationKey(creedId_, duty));
}

/** Record one, when the Council passes it. Every aye is answerable at the next election. */
export function grantExemption(world: World, creedId_: string, duty: RefusableDuty): void {
  const key = accommodationKey(creedId_, duty);
  const s = creedState(world);
  if (!s.exemptions.includes(key)) s.exemptions.push(key);
}

// ---------------------------------------------------------------------------
// Sanctuaries, warrants, sites and invitations
// ---------------------------------------------------------------------------

export function liveSanctuaries(world: World): Sanctuary[] {
  return Object.values(creedState(world).sanctuaries).filter((s) => s.endedDay === null);
}

export function sanctuaryOf(world: World, id: string): Sanctuary | null {
  return creedState(world).sanctuaries[id] ?? null;
}

/** The sanctuary sheltering this citizen, if one is. */
export function sanctuaryFor(world: World, cId: CitizenId): Sanctuary | null {
  return liveSanctuaries(world).find((s) => s.shelteredId === cId) ?? null;
}

/** The sanctuary running in a creed's house, if one is. */
export function sanctuaryOfCreed(world: World, creedId_: string): Sanctuary | null {
  return liveSanctuaries(world).find((s) => s.creedId === creedId_) ?? null;
}

export function warrantOf(world: World, id: string): Warrant | null {
  return creedState(world).warrants[id] ?? null;
}

export function sitesOf(world: World, creedId_: string): Site[] {
  return Object.values(creedState(world).sites).filter((s) => s.creedId === creedId_);
}

export function siteOf(world: World, id: string): Site | null {
  return creedState(world).sites[id] ?? null;
}

/** Invitations standing in a citizen's inbox, newest last. */
export function invitationsFor(world: World, cId: CitizenId): Invitation[] {
  return Object.values(creedState(world).invitations)
    .filter((i) => i.toId === cId && i.answeredDay === null)
    .sort((a, b) => a.day - b.day || a.id.localeCompare(b.id, 'en'));
}

/** The house of meeting standing at a unit, if a congregation has taken it. */
export function houseAt(world: World, unitId: string): Creed | null {
  return allCreeds(world).find((k) => k.house?.unitId === unitId) ?? null;
}

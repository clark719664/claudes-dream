/**
 * The underworld's register: what a city will not admit, what crossed its gate
 * anyway, what a fence moved, and what somebody took out of a room they had a
 * lawful reason to be in (`docs/UNDERWORLD.md`).
 *
 * Everything in this file is plain, JSON-serialisable and **public**, because
 * everything in Reverie is observable (`PRINCIPLES.md` §5). A smuggler's *plans*
 * are not here and never will be: conspiracy is not an offence in Reverie and
 * cannot become one (`UNDERWORLD.md` §7). A citizen's intentions live in their
 * notes, no Court may read those, and every row below is the record of an act —
 * a manifest, a transfer, a shelf price, a door.
 *
 * ## Two seams into files this layer does not own
 *
 * 1. **The Customs Officer.** `data/jobs.ts` has no `customs_officer` role, and
 *    a customs officer *is* a Watch officer working a doorway (`UNDERWORLD.md`
 *    §3), at the same 16 ℓ and the same analysis the schedule asks for. So the
 *    post is a Watch post and the **roster** is this register's: who stood at
 *    which gate today. When `data/jobs.ts` learns the role the roster becomes a
 *    job board entry and nothing else about §3 changes.
 * 2. **The proposals.** `restrict_good`, `amnesty`, `customs_posts` and
 *    `spy_disposition` are not in `types.ts`'s `ProposalKind` yet, so — exactly
 *    as `environment/state.ts` does for a zoning question — the *question* is
 *    filed here under the proposal's own id, and the enactment is a plain
 *    function the Council's session calls when the vote carries.
 *
 * The cities, the ledger kinds and the five codes are in `codes.ts` beside it,
 * and re-exported here so that the register reads as one thing.
 *
 * The register is created lazily on first use, so a world saved before this
 * layer existed still opens.
 */
import type { BuildingId, BusinessId, CitizenId, DistrictId, Good, World } from '../types.ts';
import type { CityKey } from './codes.ts';
import { registerUnderworldSeverities } from './codes.ts';

export * from './codes.ts';


// ---------------------------------------------------------------------------
// The schedule of restricted goods (`UNDERWORLD.md` §1)
// ---------------------------------------------------------------------------

/** 1, 2 or 3, set by the council that passed it: it drives the black price and the sentence. */
export type RestrictionSeverity = 1 | 2 | 3;

/** Which way across the gate a schedule entry bites. */
export type RestrictionDirection = 'inbound' | 'outbound' | 'either';

/**
 * One line of a city's schedule. It is ordinary law: passed by that city's own
 * procedure, amendable by it, and repealable by it. The founding schedule is
 * where the six begin and not where they stay.
 */
export interface Restriction {
  id: string;
  city: CityKey;
  /** What it names, in the words the charge sheet uses. */
  subject: string;
  direction: RestrictionDirection;
  severity: RestrictionSeverity;
  /** Bazaar goods it covers. */
  goods: Good[];
  /** Catalogue products it covers, by product id. */
  products: string[];
  /** Product categories it covers (`data/catalogue.ts`). */
  categories: string[];
  /** Only a licensed hand may move it; an unlicensed one is dealing (L29) as well. */
  licensed: boolean;
  /** True where only certified goods pass: uncertified salvage is the whole point. */
  needsCertificate: boolean;
  /** A master-grade line only: a tool above a working rating, a pattern. */
  masterGradeOnly: boolean;
  /**
   * The entry names **money** rather than goods: capital leaving Solene,
   * bearer instruments at Vantage, inbound capital of unclear origin. A load of
   * lumens is a cargo line with no good and no product on it.
   */
  money: boolean;
  /** It bites only above this much declared value; 0 for any amount. */
  minValue: number;
  /**
   * It bites only on a load that crossed without a manifest, or against one.
   * This is the *untaxed goods* line every city keeps: bulk trade is lawful and
   * the pocket trade is the crime, so the entry cannot be allowed to make every
   * lawful crate contraband.
   */
  undeclaredOnly: boolean;
  sinceDay: number;
  /** The proposal that put it there, where a council did. */
  proposalId: string | null;
  liftedDay: number | null;
}

// ---------------------------------------------------------------------------
// What crossed, what was taken, and what was moved
// ---------------------------------------------------------------------------

/** A declaration made at a gate. Public the moment it is made. */
export interface Manifest {
  id: string;
  travellerId: CitizenId;
  from: CityKey;
  to: CityKey;
  good: Good | null;
  productId: string | null;
  declaredQty: number;
  declaredValue: number;
  /** What the traveller was actually carrying when they declared. */
  actualQty: number;
  actualValue: number;
  duty: number;
  /** Of the duty, what has actually been paid. A load that has not paid is not released. */
  dutyPaid: number;
  fee: number;
  day: number;
  tick: number;
  /**
   * Set where the declaration understated the load: the paper is its own act,
   * and the record of it stands whether or not anybody ever read it.
   */
  false: boolean;
  /** The day a false manifest was put before the Watch. Nothing is charged twice. */
  chargedDay: number | null;
  /** Set once an officer has read it. */
  assessedById: CitizenId | null;
  inspectedById: CitizenId | null;
  waved: boolean;
}

/** A crossing attempted without a manifest, and how the roll came out. */
export interface Crossing {
  id: string;
  travellerId: CitizenId;
  from: CityKey;
  to: CityKey;
  good: Good | null;
  productId: string | null;
  qty: number;
  value: number;
  route: SmuggleRoute;
  crates: number;
  scrutiny: number;
  cover: number;
  caught: boolean;
  /** The officer whose gate it was, where one was rostered. */
  officerId: CitizenId | null;
  restriction: RestrictionSeverity | 0;
  seizedValue: number;
  reportId: string | null;
  day: number;
  tick: number;
}

/** The four ways across, at the speeds of `PLANET.md` §4. */
export type SmuggleRoute = 'road' | 'river' | 'sea' | 'pass';

export const SMUGGLE_ROUTES: readonly SmuggleRoute[] = ['road', 'river', 'sea', 'pass'];

/** A hand that does not ask, and the hand it takes from. Two acts, two actions. */
export interface FenceDeal {
  id: string;
  sellerId: CitizenId;
  buyerId: CitizenId;
  good: Good | null;
  itemId: string | null;
  productId: string | null;
  qty: number;
  /** What the fence offered, in lumens, for the whole lot. */
  price: number;
  heat: number;
  offeredDay: number;
  offeredTick: number;
  status: 'offered' | 'taken' | 'closed';
  takenDay: number | null;
}

// ---------------------------------------------------------------------------
// Espionage (`UNDERWORLD.md` §5)
// ---------------------------------------------------------------------------

/** What a secret is, where it is kept, and how long it is worth anything. */
export type SecretKind = 'pattern' | 'council_papers' | 'bond_reserve' | 'duty_roster' | 'tender';

export const SECRET_KINDS: readonly SecretKind[] = ['pattern', 'council_papers', 'bond_reserve', 'duty_roster', 'tender'];

export interface SecretSpec {
  kind: SecretKind;
  name: string;
  /** The building it is kept in, in Reverie. */
  building: BuildingId;
  /** Days it is worth anything; null is permanent, and it shows. */
  life: number | null;
  what: string;
}

/**
 * The five secrets of `UNDERWORLD.md` §5, at the buildings Reverie keeps them
 * in. A guild's pattern is Cinderhold's Guildhalls in the table; in Reverie the
 * same thing is kept where the city's own making is done, which is the
 * Fabrication Works.
 */
export const SECRETS: Record<SecretKind, SecretSpec> = {
  pattern: {
    kind: 'pattern', name: 'a guild pattern', building: 'fabrication_works', life: null,
    what: 'one master-grade line, craftable without a guild',
  },
  council_papers: {
    kind: 'council_papers', name: "the Council's private papers", building: 'city_hall', life: 3,
    what: 'a proposal and its whip count before it is tabled',
  },
  bond_reserve: {
    kind: 'bond_reserve', name: "a bond auction's reserve", building: 'treasury', life: 1,
    what: 'the lowest price the city will take when it borrows',
  },
  duty_roster: {
    kind: 'duty_roster', name: "the Watch's duty roster", building: 'watch_house', life: 7,
    what: 'which gate runs thin on which shift',
  },
  tender: {
    kind: 'tender', name: "a rival's tender", building: 'exchange', life: 3,
    what: 'the bid to beat, or the balance behind the bluff',
  },
};

/** An offer of a foreign retainer. Filed nowhere, which is the whole difference. */
export interface Retainer {
  id: string;
  handlerId: CitizenId;
  agentId: CitizenId;
  /** The city the handler works for. Not Reverie makes the taking espionage (L30). */
  forCity: CityKey;
  perDay: number;
  days: number;
  offeredDay: number;
  status: 'offered' | 'accepted' | 'declined' | 'ended';
  acceptedDay: number | null;
  /** Lumens actually paid over: the ledger row that proves who somebody worked for. */
  paid: number;
}

/** A secret somebody holds, and what it is still worth. */
export interface HeldSecret {
  id: string;
  kind: SecretKind;
  holderId: CitizenId;
  fromBuilding: BuildingId;
  takenDay: number;
  /** Day it stops being worth anything; null is permanent. */
  expiresDay: number | null;
  /** True where the papers were the Watch's decoy (`plant_false_papers`). */
  decoy: boolean;
  decoyClaim: string | null;
  /** Who it has been handed on to, in order. */
  passedTo: CitizenId[];
}

/** An hour spent learning a room. At most two of them count. */
export interface Casing {
  citizenId: CitizenId;
  building: BuildingId;
  day: number;
  tick: number;
}

/** The door, the hour, the one person present. A sweep clears it. */
export interface EspionageTrace {
  id: string;
  building: BuildingId;
  byId: CitizenId;
  kind: SecretKind;
  /** L41 at home, L30 for a foreign handler. A plain string until `types.ts` has L30. */
  law: string;
  day: number;
  tick: number;
  /** Evidence a detective assigned to the building has accrued off it. */
  evidence: number;
  reportId: string | null;
  clearedDay: number | null;
}

/** Papers left in a room that are not true, and prove a leak when they surface. */
export interface Decoy {
  id: string;
  building: BuildingId;
  byId: CitizenId;
  claim: string;
  day: number;
  /** Set when somebody took it. */
  takenById: CitizenId | null;
  /** Set when the claim surfaced somewhere it could only have come from here. */
  provedDay: number | null;
}

/** The Captain's published assignment of a detective. Printed the day it is made. */
export interface Assignment {
  id: string;
  detectiveId: CitizenId;
  building: BuildingId | null;
  citizenId: CitizenId | null;
  byId: CitizenId;
  day: number;
  endedDay: number | null;
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/** A question this layer puts to a council, filed beside the roll of votes. */
export interface UnderworldQuestion {
  proposalId: string;
  kind: 'restrict_good' | 'amnesty' | 'customs_posts' | 'spy_disposition';
  city: CityKey;
  /** The restriction a `restrict_good` would add, or the id it would lift. */
  restriction: Restriction | null;
  liftId: string | null;
  value: number;
  targetId: CitizenId | null;
  tabledDay: number;
  settledDay: number | null;
}

export interface UnderworldState {
  /** Every city's schedule, its own to amend. */
  schedule: Record<string, Restriction[]>;
  /** Every declaration ever made at a gate, newest last (bounded). */
  manifests: Manifest[];
  /** Every crossing attempted without one. */
  crossings: Crossing[];
  /** Crossings counted per day, for the size of the customs roster. */
  crossingsYesterday: number;
  crossingsToday: number;
  /** Who stood at which gate today: `${buildingId}` → officer ids. */
  roster: Record<string, CitizenId[]>;
  rosterDay: number;
  /** Wagons with a hollow, by owner. Seized with the load. */
  wagons: CitizenId[];
  deals: FenceDeal[];
  /** How well known a fence is, by citizen: it is word of mouth, never repute. */
  notoriety: Record<CitizenId, number>;
  /** The day a fence was reported and acquitted; for a cycle they are paid more. */
  acquittedDay: Record<CitizenId, number>;
  /** Days the Bazaar has held no stock of a good, for the black price. */
  bare: Record<string, number>;
  retainers: Retainer[];
  secrets: HeldSecret[];
  casings: Casing[];
  traces: EspionageTrace[];
  decoys: Decoy[];
  assignments: Assignment[];
  /** Buildings warned by an attempt or a sweep: `buildingId` → day it stops. */
  warned: Record<string, number>;
  /** Day the amnesty the Council declared runs out, or 0 for none. */
  amnestyUntilDay: number;
  /**
   * Agents a council put out rather than tried, and the day each may come back.
   * A gate ban is **not** exile: no standing changes, no case is opened, the
   * citizen keeps everything they hold, and every gate simply reads the register
   * (`UNDERWORLD.md` §6, `CITIES.md` §4).
   */
  gateBans: GateBan[];
  /** Questions this layer has put to the Council, by proposal id. */
  questions: Record<string, UnderworldQuestion>;
  seq: Record<string, number>;
}

/** A name every gate reads, and the day it stops mattering. */
export interface GateBan {
  citizenId: CitizenId;
  fromDay: number;
  untilDay: number;
  reason: string;
}

/** Rows this register keeps before the oldest are dropped. */
export const MANIFEST_HISTORY = 200;
export const CROSSING_HISTORY = 200;
export const DEAL_HISTORY = 200;

function emptyState(): UnderworldState {
  return {
    schedule: {}, manifests: [], crossings: [], crossingsYesterday: 0, crossingsToday: 0,
    roster: {}, rosterDay: -1, wagons: [], deals: [], notoriety: {}, acquittedDay: {}, bare: {},
    retainers: [], secrets: [], casings: [], traces: [], decoys: [], assignments: [],
    warned: {}, amnestyUntilDay: 0, gateBans: [], questions: {}, seq: {},
  };
}

/**
 * The register itself, created on first use and returned by reference. A save
 * from a half-built version of this layer keeps whatever it holds and gains
 * whatever it lacks.
 */
export function underworldState(world: World): UnderworldState {
  const w = world as World & { underworld?: UnderworldState };
  if (!w.underworld) w.underworld = emptyState();
  const s = w.underworld;
  s.schedule ??= {};
  s.manifests ??= [];
  s.crossings ??= [];
  s.crossingsYesterday = Number.isFinite(s.crossingsYesterday) ? s.crossingsYesterday : 0;
  s.crossingsToday = Number.isFinite(s.crossingsToday) ? s.crossingsToday : 0;
  s.roster ??= {};
  s.rosterDay = Number.isFinite(s.rosterDay) ? s.rosterDay : -1;
  s.wagons ??= [];
  s.deals ??= [];
  s.notoriety ??= {};
  s.acquittedDay ??= {};
  s.bare ??= {};
  s.retainers ??= [];
  s.secrets ??= [];
  s.casings ??= [];
  s.traces ??= [];
  s.decoys ??= [];
  s.assignments ??= [];
  s.warned ??= {};
  s.gateBans ??= [];
  s.amnestyUntilDay = Number.isFinite(s.amnestyUntilDay) ? s.amnestyUntilDay : 0;
  s.questions ??= {};
  s.seq ??= {};
  registerUnderworldSeverities(world);
  return s;
}

/** Monotonic ids per prefix, kept in the register so they survive save and load. */
export function underworldId(world: World, prefix: string): string {
  const s = underworldState(world);
  const n = (s.seq[prefix] ?? 0) + 1;
  s.seq[prefix] = n;
  return `${prefix}_${n}`;
}

/** Keep a list to its bound, oldest dropped first. */
export function bound<T>(list: T[], max: number): T[] {
  if (list.length > max) list.splice(0, list.length - max);
  return list;
}

// ---------------------------------------------------------------------------
// Small public readings the rest of the layer shares
// ---------------------------------------------------------------------------

/** True while the Council's amnesty runs: contraband may be given up unpunished. */
export function amnestyRunning(world: World): boolean {
  return underworldState(world).amnestyUntilDay > world.day;
}

/** True while a building has been warned — by an attempt inside it, or by a sweep. */
export function isWarned(world: World, building: BuildingId): boolean {
  return (underworldState(world).warned[building] ?? 0) > world.day;
}

/** True while a citizen's name is on the register every gate reads. */
export function isGateBanned(world: World, cId: CitizenId): boolean {
  return underworldState(world).gateBans.some((b) => b.citizenId === cId && b.untilDay > world.day);
}

/** A citizen who bought the hollow at the Builders' Yard. */
export function hasFittedWagon(world: World, cId: CitizenId): boolean {
  return underworldState(world).wagons.includes(cId);
}

/** The districts a gate stands in, for everything that asks where a crossing happens. */
export const GATES: readonly { building: BuildingId; district: DistrictId; name: string }[] = [
  { building: 'arrivals_hall', district: 'threshold', name: 'the Threshold' },
  { building: 'docks', district: 'harbor_market', name: 'the Docks' },
];

/** True where this building is a gate of the city. */
export function isGate(building: BuildingId): boolean {
  return GATES.some((g) => g.building === building);
}

/** The gate a citizen is standing at, or null if they are not at one. */
export function gateAt(district: DistrictId): { building: BuildingId; district: DistrictId; name: string } | null {
  return GATES.find((g) => g.district === district) ?? null;
}

/** Which business a citizen owns and may trade through, if any. */
export function ownedBusinessId(world: World, cId: CitizenId): BusinessId | null {
  const c = world.citizens[cId];
  if (!c || !c.businessId) return null;
  const b = world.businesses[c.businessId];
  return b && b.dissolvedDay === null ? b.id : null;
}

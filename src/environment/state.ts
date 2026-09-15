/**
 * The city's air, its water, its trees and its permits — the register the rest
 * of `docs/ENVIRONMENT.md` is written on.
 *
 * Nothing in this file asserts that a district is dirty. Foundry Row is sooty
 * because its forge is worked, and the morning nobody works it the air over it
 * begins to clear. Air, water and greenery are public everywhere
 * (`PRINCIPLES.md` §5); a **reading** is the other thing — dated, attributed,
 * and paid for with somebody's shift (`readings.ts`).
 *
 * The register is created lazily the first time it is asked for, exactly as
 * `standing/state.ts` and `civil/state.ts` do, so a world saved before this
 * layer existed still opens.
 */
import { DISTRICT_IDS, clamp } from '../types.ts';
import type {
  BuildingId, BusinessId, CitizenId, DistrictId, LawCode, Severity, World,
} from '../types.ts';

// ---------------------------------------------------------------------------
// Permits (`ENVIRONMENT.md` §4)
// ---------------------------------------------------------------------------

/** What a district may be built, extended or newly operated for. */
export type Permit =
  | 'conserved' | 'residential' | 'civic' | 'commercial'
  | 'open' | 'light_industry' | 'heavy_industry';

export const PERMITS: readonly Permit[] = [
  'conserved', 'residential', 'civic', 'commercial', 'open', 'light_industry', 'heavy_industry',
];

/**
 * What a permit is worth to the land the morning it passes, on the 0..1
 * amenity term of `PROPERTY.md` §1 — because what a district *may* become is
 * what a buyer pays for, before a single building moves.
 */
export const PERMIT_PREMIUM: Record<Permit, number> = {
  conserved: 0.20, residential: 0.12, civic: 0.08, commercial: 0.04,
  open: 0, light_industry: -0.08, heavy_industry: -0.20,
};

/** The founding permit: the city zoned nothing, and everything was allowed. */
export const FOUNDING_PERMIT: Permit = 'open';

// ---------------------------------------------------------------------------
// Fittings (`ENVIRONMENT.md` §3)
// ---------------------------------------------------------------------------

export type Fitting = 'filter' | 'scrubber' | 'stack';
export const FITTINGS: readonly Fitting[] = ['filter', 'scrubber', 'stack'];

export interface FittingSpec {
  /** Lumens to fit it, once. */
  capital: number;
  /** Lumens a day to hold it, whoever owns the building. */
  upkeep: number;
  /** What a shift's motes are multiplied by at full effect. */
  emission: number;
  /** The share of a day's load that leaves the district, where the fitting moves it. */
  drift: number | null;
  /** Energy the fitting itself burns, per shift worked under it. */
  energyPerShift: number;
}

/**
 * The three fittings, and the whole of the politics of §6 in one table: the
 * tall stack is the cheapest thing on it, cleans nothing at all, and makes the
 * smoke somebody else's.
 */
export const FITTING_SPECS: Record<Fitting, FittingSpec> = {
  filter: { capital: 250, upkeep: 3, emission: 0.75, drift: null, energyPerShift: 0 },
  scrubber: { capital: 900, upkeep: 11, emission: 0.45, drift: null, energyPerShift: 1 },
  stack: { capital: 400, upkeep: 2, emission: 1.00, drift: 0.65, energyPerShift: 0 },
};

/** A fitting loses this much of its rated effect a day unless somebody works on it. */
export const ABATEMENT_DECAY = 0.04;

export interface Abatement {
  building: BuildingId;
  fitting: Fitting;
  /** 0..1 of the rated effect. A fitting nobody maintains is a stack with a filter's bill. */
  effect: number;
  installedDay: number;
  maintainedDay: number;
  /** Who fitted it: an owner, or `city` where the public works paid. */
  byId: CitizenId | 'city';
}

// ---------------------------------------------------------------------------
// The three offences this layer adds (`REGISTRY.md` §4, all Track I)
// ---------------------------------------------------------------------------

/**
 * `types.ts` does not carry L45–L47 yet, so the codes are handed out as plain
 * strings exactly as `civil/licences.ts` hands out L20–L22. Every one of them
 * is on the civic ladder, none of them reaches custody, and none of them is an
 * offence against a person: smoke is an offence against the city.
 */
export const UNLAWFUL_DISCHARGE = 'L45';
export const FALSE_ABATEMENT_RETURN = 'L46';
export const UNDECLARED_INTEREST = 'L47';

export const ENVIRONMENT_OFFENCES: Record<string, { name: string; severity: Severity; description: string }> = {
  L45: {
    name: 'Unlawful discharge', severity: 3,
    description: 'Dumping to the river, or working a shift with the fitting bypassed.',
  },
  L46: {
    name: 'False abatement return', severity: 3,
    description: 'A fitting claimed maintained, or works certified undone.',
  },
  L47: {
    name: 'Undeclared interest', severity: 3,
    description: 'Voting a zoning question that moves land you or your household hold.',
  },
};

/**
 * Put the three codes into the Council's own severity table the first time
 * this layer runs, so the ladder sentences them at what `REGISTRY.md` says and
 * the Council can move them afterwards like any other number. Nothing is
 * overwritten: a severity the Council has already set stands.
 */
export function registerEnvironmentSeverities(world: World): void {
  const table = world.government?.lawSeverity as Record<string, Severity> | undefined;
  if (!table) return;
  for (const [code, law] of Object.entries(ENVIRONMENT_OFFENCES)) {
    if (table[code] === undefined) table[code] = law.severity;
  }
}

/** The name of one of this layer's codes, for a charge sheet the city can read. */
export function environmentOffenceName(code: string): string {
  return ENVIRONMENT_OFFENCES[code]?.name ?? code;
}

/** The severity in force for one of them: the Council's, then the book's. */
export function environmentSeverity(world: World, code: string): Severity {
  const table = world.government?.lawSeverity as Record<string, Severity> | undefined;
  const set = table?.[code as LawCode];
  if (set !== undefined && Number.isFinite(set)) return Math.min(5, Math.max(1, Math.round(set))) as Severity;
  return ENVIRONMENT_OFFENCES[code]?.severity ?? 3;
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/** One district's air, water, trees and permit. Every field is public. */
export interface DistrictEnvironment {
  air: number;
  water: number;
  /** Trees standing, 0..1; it lifts clearance and amenity. */
  greenery: number;
  /** Trees planted, which greenery grows toward a day at a time. */
  planted: number;
  permit: Permit;
  /** The day the district was conserved, which four of five votes are needed to undo. */
  conservedDay: number | null;
  /** Share of the profit tax and emission charge raised here that its residents take. */
  hostShare: number;
}

/** A dated, attributed reading somebody spent a shift on. */
export interface Reading {
  district: DistrictId;
  kind: 'air' | 'water';
  value: number;
  day: number;
  byId: CitizenId;
}

/** The measures this layer puts to the Council (`ENVIRONMENT.md` §9). */
export type EnvironmentProposalKind =
  | 'zone' | 'conserve' | 'emission_charge' | 'host_payment' | 'abatement_works' | 'relocate_works' | 'buy_out';

export const ENVIRONMENT_PROPOSAL_KINDS: readonly EnvironmentProposalKind[] = [
  'zone', 'conserve', 'emission_charge', 'host_payment', 'abatement_works', 'relocate_works', 'buy_out',
];

/**
 * A question before the Council or the city, and the fields a `Proposal` — one
 * number, one law code, one citizen — cannot carry: which district, which
 * permit, which building, which fitting. Keyed by the proposal's own id, so the
 * roll of votes and the question always read together.
 */
export interface EnvironmentQuestion {
  proposalId: string;
  kind: EnvironmentProposalKind;
  district: DistrictId | null;
  permit: Permit | null;
  building: BuildingId | null;
  fitting: Fitting | null;
  value: number;
  tabledDay: number;
  /** True where the district's own residents opened it (`ENVIRONMENT.md` §6). */
  petition: boolean;
  /** Set once the question has been answered and the gains read off the register. */
  settledDay: number | null;
}

/** What one workplace put into the air today, and what it owes for it. */
export interface EmitterDay {
  building: BuildingId;
  district: DistrictId;
  owner: BusinessId | 'city';
  /** Motes after abatement — what actually left the stack. */
  motes: number;
  /** Of those, the motes worked with the fitting bypassed; the river takes all of them. */
  bypassed: number;
  shifts: number;
}

export interface EnvironmentState {
  districts: Record<DistrictId, DistrictEnvironment>;
  abatement: Record<BuildingId, Abatement>;
  /** Today's emitters, keyed `owner@building`; cleared every rollover. */
  today: Record<string, EmitterDay>;
  /** The day a building's fitting was last bypassed, by whoever bypassed it. */
  bypassDay: Record<BuildingId, number>;
  bypassBy: Record<BuildingId, CitizenId>;
  /** Lumens per mote per day, as the Council has it. Zero at the founding. */
  charge: number;
  /** Lumens of emission charge raised in each district yesterday. */
  chargedToday: Record<string, number>;
  readings: Reading[];
  /** Every environment question ever tabled, by proposal id. */
  zoning: Record<string, EnvironmentQuestion>;
  /** Councillors who filed an interest on a question, by proposal id. */
  declarations: Record<string, CitizenId[]>;
  /** Producing buildings the city has moved out to a hinterland site. */
  relocated: BuildingId[];
  /** Nonconforming buildings the city bought out; they hold no posts and emit nothing. */
  boughtOut: BuildingId[];
  /** What the fields downwind of the city are breathing and drinking. */
  hinterlandAir: number;
  hinterlandWater: number;
  settledDay: number;
}

function foundingDistrict(): DistrictEnvironment {
  return { air: 0, water: 0, greenery: 0, planted: 0, permit: FOUNDING_PERMIT, conservedDay: null, hostShare: 0 };
}

function emptyState(): EnvironmentState {
  const districts = {} as Record<DistrictId, DistrictEnvironment>;
  for (const d of DISTRICT_IDS) districts[d] = foundingDistrict();
  return {
    districts, abatement: {}, today: {}, bypassDay: {}, bypassBy: {},
    charge: 0, chargedToday: {}, readings: [], zoning: {}, declarations: {},
    relocated: [], boughtOut: [], hinterlandAir: 0, hinterlandWater: 0, settledDay: -1,
  };
}

/**
 * The register itself, created on first use and returned by reference, so
 * callers write to the world. A save from a half-built version of this layer
 * keeps whatever it holds and gains whatever it lacks.
 */
export function environmentState(world: World): EnvironmentState {
  const w = world as World & { environment?: EnvironmentState };
  if (!w.environment) w.environment = emptyState();
  const s = w.environment;
  s.districts ??= {} as Record<DistrictId, DistrictEnvironment>;
  for (const d of DISTRICT_IDS) {
    const held = s.districts[d];
    if (!held) { s.districts[d] = foundingDistrict(); continue; }
    held.air = Number.isFinite(held.air) ? held.air : 0;
    held.water = Number.isFinite(held.water) ? held.water : 0;
    held.greenery = Number.isFinite(held.greenery) ? held.greenery : 0;
    held.planted = Number.isFinite(held.planted) ? held.planted : 0;
    held.permit ??= FOUNDING_PERMIT;
    held.conservedDay ??= null;
    held.hostShare = Number.isFinite(held.hostShare) ? held.hostShare : 0;
  }
  s.abatement ??= {};
  s.today ??= {};
  s.bypassDay ??= {};
  s.bypassBy ??= {};
  s.charge = Number.isFinite(s.charge) ? s.charge : 0;
  s.chargedToday ??= {};
  s.readings ??= [];
  s.zoning ??= {};
  s.declarations ??= {};
  s.relocated ??= [];
  s.boughtOut ??= [];
  s.hinterlandAir = Number.isFinite(s.hinterlandAir) ? s.hinterlandAir : 0;
  s.hinterlandWater = Number.isFinite(s.hinterlandWater) ? s.hinterlandWater : 0;
  s.settledDay = Number.isFinite(s.settledDay) ? s.settledDay : -1;
  registerEnvironmentSeverities(world);
  return s;
}

/** One district's row, created on first use. */
export function districtEnvironment(world: World, d: DistrictId): DistrictEnvironment {
  const s = environmentState(world);
  s.districts[d] ??= foundingDistrict();
  return s.districts[d];
}

// ---------------------------------------------------------------------------
// The readings everything else asks for
// ---------------------------------------------------------------------------

/** The air over a district, 0..1. This is what `economy/land.ts` prices. */
export function airLevel(world: World, d: DistrictId): number {
  return clamp(districtEnvironment(world, d).air, 0, 1);
}

/** The river as it passes a district, 0..1. */
export function waterLevel(world: World, d: DistrictId): number {
  return clamp(districtEnvironment(world, d).water, 0, 1);
}

/** The permit in force. */
export function permitOf(world: World, d: DistrictId): Permit {
  return districtEnvironment(world, d).permit;
}

/** What a district's residents take of what is raised inside it, 0..0.5. */
export function hostShareOf(world: World, d: DistrictId): number {
  return clamp(districtEnvironment(world, d).hostShare, 0, HOST_SHARE_MAX);
}

/** The most a district may be paid of what is raised inside it (`ENVIRONMENT.md` §6). */
export const HOST_SHARE_MAX = 0.5;

/** The fitting on a building, if it carries one. */
export function fittingOn(world: World, b: BuildingId): Abatement | null {
  return environmentState(world).abatement[b] ?? null;
}

/** True while a building's fitting was bypassed today (`discharge`, L45). */
export function bypassedToday(world: World, b: BuildingId): boolean {
  return environmentState(world).bypassDay[b] === world.day;
}

/** A building the city bought out holds no posts and emits nothing. */
export function isBoughtOut(world: World, b: BuildingId): boolean {
  return environmentState(world).boughtOut.includes(b);
}

/** A producing building the city moved out to a hinterland site (`ENVIRONMENT.md` §3). */
export function isRelocated(world: World, b: BuildingId): boolean {
  return environmentState(world).relocated.includes(b);
}

/** The key today's emitters are counted under. */
export function emitterKey(owner: BusinessId | 'city', building: BuildingId): string {
  return `${owner}@${building}`;
}

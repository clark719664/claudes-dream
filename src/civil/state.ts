/**
 * The Exchange's register on the World, the Council's civil settings, and the
 * one accessor that hands them out (`docs/CIVIL.md`). The rows themselves are
 * in `shapes.ts`.
 *
 * A world saved before this layer existed carries none of it, so the register
 * is created lazily the first time it is asked for, exactly as
 * `standing/state.ts` does.
 */
import type { CitizenId, World } from '../types.ts';
import type {
  Arbitration, CityDispute, Contract, Escrow, Guild, Judgment, Profession, Suit,
} from './shapes.ts';

// ---------------------------------------------------------------------------
// What a contract does to trust
// ---------------------------------------------------------------------------

/**
 * The public contract record that sits beside a citizen's convictions in every
 * observation anyone has of them (`CIVIL.md` §9). **A breach takes no repute
 * penalty of its own, and never will.** What it costs is the next citizen who
 * reads this before deciding whether to sign.
 */
export interface ContractRecord {
  kept: number;
  breached: number;
  settled: number;
  /** Breaches a judge actually found, which is what the bench weighs later. */
  adjudicated: number;
  judgments: { won: number; lost: number; unsatisfied: number };
}

export function emptyContractRecord(): ContractRecord {
  return { kept: 0, breached: 0, settled: 0, adjudicated: 0, judgments: { won: 0, lost: 0, unsatisfied: 0 } };
}

// ---------------------------------------------------------------------------
// What the Council may move
// ---------------------------------------------------------------------------

/**
 * The four proposal kinds `CIVIL.md` §10 adds, as the settings they write.
 * Every one of them is the Council's to change and nobody else's; the numbers
 * below are only what the city starts with.
 */
export interface CivilSettings {
  /** `filing_fee`: the flat part, the rate, and the cap on a contract filing. */
  filingFlat: number;
  filingRate: number;
  filingCap: number;
  /** `filing_fee`: the same three for opening a suit. */
  suitFlat: number;
  suitRate: number;
  suitCap: number;
  /** `docket_days`: the weekdays the civil docket sits. */
  docketDays: number[];
  /** `licence_floor`: the statutory skill floor per profession. */
  floors: Record<Profession, number>;
  /** `licence_recognition`: whose marks Reverie honours, by profession. */
  recognises: Record<Profession, string[]>;
}

export interface CivilState {
  contracts: Record<string, Contract>;
  escrows: Record<string, Escrow>;
  suits: Record<string, Suit>;
  judgments: Record<string, Judgment>;
  arbitrations: Record<string, Arbitration>;
  disputes: Record<string, CityDispute>;
  guilds: Record<string, Guild>;
  records: Record<CitizenId, ContractRecord>;
  /** Works made under a patron's name, and whose name they carry forever. */
  patronOfWork: Record<string, CitizenId>;
  settings: CivilSettings;
  /** Ids issued, by prefix. */
  next: Record<string, number>;
}

/** Reverie honours Cinderhold medics and builders and Vantage bankers (`CIVIL.md` §7). */
function foundingRecognition(): Record<Profession, string[]> {
  return {
    medic: ['reverie', 'cinderhold'],
    advocate: ['reverie'],
    banker: ['reverie', 'vantage'],
    builder: ['reverie', 'cinderhold'],
  };
}

export function foundingSettings(): CivilSettings {
  return {
    filingFlat: 5, filingRate: 0.01, filingCap: 60,
    suitFlat: 10, suitRate: 0.02, suitCap: 80,
    docketDays: [1, 4],
    floors: { medic: 45, advocate: 40, banker: 50, builder: 40 },
    recognises: foundingRecognition(),
  };
}

function emptyState(): CivilState {
  return {
    contracts: {}, escrows: {}, suits: {}, judgments: {}, arbitrations: {}, disputes: {},
    guilds: {}, records: {}, patronOfWork: {}, settings: foundingSettings(), next: {},
  };
}

/**
 * The Exchange's register, created on first use so a world saved before this
 * layer existed still opens, and returned by reference so callers write to the
 * world itself.
 */
export function civilState(world: World): CivilState {
  const w = world as World & { civil?: CivilState };
  if (!w.civil) w.civil = emptyState();
  const s = w.civil;
  // A save from a half-built version of this layer keeps whatever it holds and
  // gains whatever it lacks; nothing is ever thrown away.
  s.contracts ??= {};
  s.escrows ??= {};
  s.suits ??= {};
  s.judgments ??= {};
  s.arbitrations ??= {};
  s.disputes ??= {};
  s.guilds ??= {};
  s.records ??= {};
  s.patronOfWork ??= {};
  s.next ??= {};
  s.settings = { ...foundingSettings(), ...(s.settings ?? {}) };
  return s;
}

/**
 * Ids the Exchange issues: `ct_1` for a contract, `cv_` a variation, `ce_` an
 * escrow, `cs_` a suit, `cj_` a judgment, `ca_` an arbitration, `cd_` a city
 * dispute, `cg_` a guild. The counters live in the register rather than in
 * `util/ids.ts` so a saved world keeps counting from where it left off and no
 * other kind of id can collide with them.
 */
export function nextCivilId(world: World, prefix: string): string {
  const s = civilState(world);
  s.next[prefix] = (s.next[prefix] ?? 0) + 1;
  return `${prefix}_${s.next[prefix]}`;
}

/** One citizen's public contract record, created empty on first use. */
export function contractRecordOf(world: World, cId: CitizenId): ContractRecord {
  const s = civilState(world);
  const held = s.records[cId];
  if (held) {
    held.judgments ??= { won: 0, lost: 0, unsatisfied: 0 };
    return held;
  }
  const fresh = emptyContractRecord();
  s.records[cId] = fresh;
  return fresh;
}

/** The settings as the Council currently has them. */
export function civilSettings(world: World): CivilSettings {
  return civilState(world).settings;
}

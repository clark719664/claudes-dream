/**
 * The shapes the generations layer keeps on the World, and the one accessor
 * that hands them out (`docs/GENERATIONS.md`).
 *
 * Everything here is plain, JSON-serialisable data that survives save and
 * load, and every field of it is **public**: a house repute is counted from
 * public acts exactly as a citizen's repute is, a will is public the day it is
 * filed, and the roll of houses is a register anybody may read at the Hall of
 * Records. Nothing in this file is hidden from anyone and nothing in it is
 * written by an observer.
 *
 * Two things this layer refuses to be, and says so out loud:
 *
 * - **A house is not a caste.** Nothing here is read by a gate, by the repute
 *   formula, by a sentence or by a licence (`GENERATIONS.md` §6). The single
 *   place a house is read is the belief of a judge who is a citizen with
 *   relatives, and `letters.ts` makes that thumb declare itself or recuse.
 * - **A house treasury is not new money.** It is a strongbox
 *   (`finance/box.ts`) — a money party the audit already sums — so every lumen
 *   a house holds is in the supply and every lumen it moves is an ordinary
 *   `treasury.transfer`.
 *
 * A world saved before this layer existed carries none of it, so the register
 * is created lazily the first time it is asked for, exactly as
 * `standing/state.ts` and `civil/state.ts` do.
 */
import type {
  BusinessId, CaseId, CitizenId, LedgerKind, OffenceCode, World,
} from '../types.ts';

// ---------------------------------------------------------------------------
// What this layer owns: its ledger kinds and its two offence codes
// ---------------------------------------------------------------------------

/**
 * The five ledger kinds `GENERATIONS.md` §8 adds. They are named here rather
 * than in `types.ts` because this layer owns them; `generationsKind` widens one
 * to the ledger's own union at the single point where the ledger is written,
 * so every entry this layer makes is still an ordinary `transfer` with an
 * honest name on it, creating nothing and destroying nothing.
 */
export type GenerationsLedgerKind = 'estate' | 'duty' | 'dowry' | 'endowment' | 'levy';

/** Widen a generations ledger kind to the ledger's union (see above). */
export function generationsKind(kind: GenerationsLedgerKind | LedgerKind): LedgerKind {
  return kind as LedgerKind;
}

/**
 * The two codes `GENERATIONS.md` §8 adds to the Code of the City. Both are
 * civic, both sit on the ladder, and **neither is ever custodial**
 * (`REGISTRY.md` §4). They are named here for the same reason the ledger kinds
 * are: this layer owns them. `government/watch.commitOffence` ignores a code
 * the Code of the City does not yet carry, so charging one is a no-op until
 * `data/laws.ts` has it — and correct the moment it does.
 */
export const GENERATIONS_LAWS = {
  /** An executor under-declaring the assets of an estate. Severity 3. */
  concealmentOfAnEstate: 'L43',
  /** Claiming a dormant house you cannot show descent from. Severity 2. */
  falseClaimOfDescent: 'L44',
} as const;

/** Name one of this layer's offence codes where a charge is laid. */
export function generationsLaw(code: (typeof GENERATIONS_LAWS)[keyof typeof GENERATIONS_LAWS]): OffenceCode {
  return code as unknown as OffenceCode;
}

// ---------------------------------------------------------------------------
// The house repute
// ---------------------------------------------------------------------------

/**
 * One conviction standing against a name (`GENERATIONS.md` §1). A family is
 * slower to live a thing down than a person: this decays at 1 % on every day
 * no member of the house is convicted of anything, against repute's 2 %.
 */
export interface HouseStain {
  /** The case it came from, so nothing is counted twice. */
  caseId: CaseId;
  /** The member (or sponsored applicant) it was recorded against. */
  citizenId: CitizenId;
  law: OffenceCode;
  day: number;
  /** 15, 40 or 120 before any decay. */
  base: number;
  /** Days of clean living counted against it so far. */
  cleanDays: number;
  /** True when it arrived through a head's sponsorship rather than a member. */
  sponsored: boolean;
}

/** An office a name has held, for the heritage term. Weights are in `repute.ts`. */
export type OfficeKind = 'council' | 'judge' | 'mayor' | 'watch' | 'envoy';

export interface OfficeTerm {
  kind: OfficeKind;
  /** The election cycle it was served in; heritage halves every four. */
  cycle: number;
  citizenId: CitizenId;
}

// ---------------------------------------------------------------------------
// A founded house
// ---------------------------------------------------------------------------

/** How a house chooses its head, fixed at founding and amendable by four-fifths. */
export type HouseRule = 'eldest' | 'chosen' | 'assent' | 'founder_line';

export const HOUSE_RULES: readonly HouseRule[] = ['eldest', 'chosen', 'assent', 'founder_line'];

export function isHouseRule(value: unknown): value is HouseRule {
  return typeof value === 'string' && (HOUSE_RULES as readonly string[]).includes(value);
}

/** One head, and the days they held it. The roll keeps them in order, forever. */
export interface HeadTerm {
  citizenId: CitizenId;
  fromDay: number;
  toDay: number | null;
  /** True for an acting head elected while the head was in custody. */
  acting: boolean;
}

/**
 * A founded House: a party in the ledger like a business, holding property,
 * businesses and a treasury, all of it **entailed** (`GENERATIONS.md` §4).
 *
 * Membership is the family name and nothing else. Anybody carrying the name is
 * of the house; `join_house` is a request to take it, `renounce_name` is the
 * way out, and both are the citizen's own act. Keeping membership as the name
 * is what stops a house being a list somebody else writes you onto.
 */
export interface House {
  id: string;
  /** The family name. Every citizen carrying it is of the house. */
  name: string;
  rule: HouseRule;
  founderId: CitizenId;
  foundedDay: number;
  /** The strongbox that holds the house treasury: a real money party. */
  boxId: BusinessId;
  headId: CitizenId | null;
  /** An acting head, while the head is in custody and cannot act. */
  actingHeadId: CitizenId | null;
  /** Named under `chosen`, effective at the sitting head's sunset. */
  successorId: CitizenId | null;
  /** Every head in order, the acting ones included. */
  heads: HeadTerm[];
  /** Entailed property, by unit id. No member may sell one. */
  units: string[];
  /** Entailed businesses. */
  businesses: BusinessId[];
  /** Citizens admitted from outside the name, in the order the members assented. */
  admitted: CitizenId[];
  /** Adults who renounced the name; kept so the record is honest. */
  renounced: CitizenId[];
  /** House levy owed and not yet paid, in lumens. */
  levyArrears: number;
  /** The last cycle the levy was charged, so a cycle is charged once. */
  lastLevyCycle: number;
  /** The day the last adult went, or null while the house is alive. */
  dormantDay: number | null;
  /** Every day the house was revived by a claim of descent. */
  revivedDays: number[];
  /** Eras the house was prominent in, entered by `records.ts`. */
  eras: string[];
}

// ---------------------------------------------------------------------------
// Motions, matches, letters and pledges
// ---------------------------------------------------------------------------

/**
 * What the members may move on (`GENERATIONS.md` §4, §8): selling an entailed
 * asset, admitting a member, amending the rule, funding a member's campaign,
 * and issuing a letter of the house.
 */
export type HouseMotionKind = 'sell' | 'admit' | 'rule' | 'campaign' | 'letter';

export interface HouseMotion {
  id: string;
  houseId: string;
  kind: HouseMotionKind;
  /** Lumens, for `campaign`; unused otherwise. */
  value: number;
  /** A unit id, a business id, a citizen id or a rule name, by kind. */
  target: string | null;
  /** The destination city, for a `letter` motion; null otherwise. */
  city: string | null;
  movedBy: CitizenId;
  day: number;
  votes: Record<CitizenId, boolean>;
  status: 'open' | 'carried' | 'lost' | 'lapsed';
  decidedDay: number | null;
  /** What the motion actually did, once it was carried. */
  outcome: string | null;
}

/** A marriage settlement between two founded houses (`GENERATIONS.md` §4). */
export interface MatchOffer {
  id: string;
  fromHouseId: string;
  toHouseId: string;
  offeredBy: CitizenId;
  /** Lumens moved from the offering house's treasury on acceptance. */
  dowry: number;
  /** A unit conveyed instead of, or beside, the lumens. */
  unitId: string | null;
  /** The terms, as a public instrument. */
  terms: string;
  day: number;
  status: 'open' | 'accepted' | 'declined' | 'lapsed';
  acceptedBy: CitizenId | null;
  decidedDay: number | null;
}

/**
 * A letter of the house: a public instrument saying this citizen is of this
 * house and the house stands behind them. It takes a day off a destination
 * Registry's background check and is admissible at an appeal and at a
 * residency hearing. **It shifts no threshold and buys no repute.**
 */
export interface HouseLetter {
  id: string;
  houseId: string;
  /** The head who filed it; a head's sponsorship is entered against the house. */
  byId: CitizenId;
  toId: CitizenId;
  city: string;
  day: number;
  /** The cycle it was filed in: a conviction inside it lands on the stain. */
  cycle: number;
  withdrawnDay: number | null;
}

/** The entail put behind a member's loan (`GENERATIONS.md` §2). */
export interface HousePledge {
  houseId: string;
  loanId: string;
  borrowerId: CitizenId;
  pledgedBy: CitizenId;
  day: number;
  /** The day the pledge was called in and property was seized, or null. */
  seizedDay: number | null;
  seizedUnitId: string | null;
}

// ---------------------------------------------------------------------------
// Wills and estates
// ---------------------------------------------------------------------------

/** One line of a filed division: a citizen, and their percentage of the net estate. */
export interface WillShare {
  to: CitizenId;
  percent: number;
}

/**
 * A filed will (`GENERATIONS.md` §3). **Public the day it is filed** — the
 * heirs read it while the testator lives, which is the point — refilable any
 * day with the last filing standing, and honoured: the executor has no
 * discretion.
 */
export interface Will {
  citizenId: CitizenId;
  shares: WillShare[];
  /** Where anything the shares did not name goes: a citizen, or the Chest. */
  residue: CitizenId | 'chest' | null;
  executorId: CitizenId | null;
  instructions: string;
  filedDay: number;
  fee: number;
}

/** One payment an estate made, in the order the Exchange made it. */
export interface EstateLine {
  kind: 'debt' | 'duty' | 'share' | 'floor' | 'residue' | 'executor' | 'chest';
  to: CitizenId | 'treasury' | 'chest';
  amount: number;
  reason: string;
}

/** How an estate came to be open. An exile leaves no estate. */
export type EstateCause = 'sunset' | 'emigration' | 'erasure';

/**
 * An estate, from the day it opens to the day the Exchange finishes paying it
 * out. It stays `open` only while the estate is land and no cash: the executor
 * has `EXECUTOR_DAYS` to sell, after which the Exchange liquidates.
 */
export interface Estate {
  id: string;
  citizenId: CitizenId;
  cause: EstateCause;
  openedDay: number;
  /** The will as it stood the day the estate opened, or null for none. */
  will: Will | null;
  executorId: CitizenId | null;
  /** True when the Exchange acted as executor for its fee. */
  exchangeExecuted: boolean;
  /** Lumens in hand plus the market value of the land, before anything is paid. */
  gross: number;
  debts: number;
  duty: number;
  /** Units the estate still holds and has to turn into lumens. */
  units: string[];
  /** The day the Exchange liquidates whatever is left unsold. */
  sellByDay: number;
  status: 'open' | 'settled';
  settledDay: number | null;
  /** Everything the estate paid, in order. */
  lines: EstateLine[];
  /** True once the reading has been held and the shares printed. */
  read: boolean;
}

// ---------------------------------------------------------------------------
// What the Council may move
// ---------------------------------------------------------------------------

/**
 * The three proposal kinds `GENERATIONS.md` §8 adds, as the settings they
 * write. Every one of them is the Council's to change and nobody else's; the
 * numbers below are only what the city starts with.
 */
export interface GenerationsSettings {
  /** `estate_duty`: 0–40 % of the net estate above the exemption. */
  estateDuty: number;
  /** `duty_exemption`: days of the minimum wage that pass untaxed. */
  exemptionWages: number;
  /** `house_levy`: 0–5 % of entailed land value, each cycle. */
  houseLevy: number;
}

export const DUTY_MAX = 0.4;
export const LEVY_MAX = 0.05;
export const EXEMPTION_WAGES_MAX = 200;

export function foundingSettings(): GenerationsSettings {
  return { estateDuty: 0.1, exemptionWages: 60, houseLevy: 0.01 };
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

export interface GenerationsState {
  /** Every family name's public figure, recomputed each morning. */
  repute: Record<string, number>;
  stains: Record<string, HouseStain[]>;
  offices: Record<string, OfficeTerm[]>;
  /** The last day any member of a name was convicted of anything. */
  lastConvictionDay: Record<string, number>;
  houses: Record<string, House>;
  motions: Record<string, HouseMotion>;
  matches: Record<string, MatchOffer>;
  letters: Record<string, HouseLetter>;
  pledges: HousePledge[];
  wills: Record<CitizenId, Will>;
  estates: Record<string, Estate>;
  /** Votes cast under the `assent` rule, by house then voter. */
  headVotes: Record<string, Record<CitizenId, CitizenId>>;
  /** Each name's figure at the start of the cycle, for the trend. */
  cycleRepute: Record<string, number>;
  /** The last cycle the ledger of the house was printed. */
  ledgerCycle: number;
  /** The last day the register accrued offices, so a day counts once. */
  officesDay: number;
  settings: GenerationsSettings;
  /** Ids issued, by prefix. */
  next: Record<string, number>;
}

function emptyState(): GenerationsState {
  return {
    repute: {}, stains: {}, offices: {}, lastConvictionDay: {}, houses: {}, motions: {}, matches: {},
    letters: {}, pledges: [], wills: {}, estates: {}, headVotes: {}, cycleRepute: {},
    ledgerCycle: -1, officesDay: -1, settings: foundingSettings(), next: {},
  };
}

/**
 * The Hall's registers and the Exchange's filings, created on first use so a
 * world saved before this layer existed still opens, and returned by reference
 * so callers write to the world itself.
 */
export function generationsState(world: World): GenerationsState {
  const w = world as World & { generations?: GenerationsState };
  if (!w.generations) w.generations = emptyState();
  const s = w.generations;
  // A save from a half-built version of this layer keeps whatever it holds and
  // gains whatever it lacks; nothing is ever thrown away.
  s.repute ??= {};
  s.stains ??= {};
  s.offices ??= {};
  s.lastConvictionDay ??= {};
  s.houses ??= {};
  s.motions ??= {};
  s.matches ??= {};
  s.letters ??= {};
  s.pledges ??= [];
  s.wills ??= {};
  s.estates ??= {};
  s.headVotes ??= {};
  s.cycleRepute ??= {};
  s.ledgerCycle ??= -1;
  s.officesDay ??= -1;
  s.next ??= {};
  // Filled in place rather than replaced, so a caller holding the settings —
  // `enactGenerationsProposal` does — is never handed a detached copy.
  s.settings ??= foundingSettings();
  const founding = foundingSettings();
  s.settings.estateDuty ??= founding.estateDuty;
  s.settings.exemptionWages ??= founding.exemptionWages;
  s.settings.houseLevy ??= founding.houseLevy;
  return s;
}

/**
 * Ids the Exchange issues: `hs_1` for a house, `hm_` a motion, `mt_` a match,
 * `lt_` a letter, `es_` an estate. The counters live in the register rather
 * than in `util/ids.ts` so a saved world keeps counting from where it left off
 * and no other kind of id can collide with them.
 */
export function nextGenerationsId(world: World, prefix: string): string {
  const s = generationsState(world);
  s.next[prefix] = (s.next[prefix] ?? 0) + 1;
  return `${prefix}_${s.next[prefix]}`;
}

/** The settings as the Council currently has them. */
export function generationsSettings(world: World): GenerationsSettings {
  return generationsState(world).settings;
}

/** The stains standing against one name, newest last. */
export function stainsOf(world: World, name: string): HouseStain[] {
  const s = generationsState(world);
  const held = s.stains[name];
  if (held) return held;
  const fresh: HouseStain[] = [];
  s.stains[name] = fresh;
  return fresh;
}

/** The offices one name has held, oldest first. */
export function officesOf(world: World, name: string): OfficeTerm[] {
  const s = generationsState(world);
  const held = s.offices[name];
  if (held) return held;
  const fresh: OfficeTerm[] = [];
  s.offices[name] = fresh;
  return fresh;
}

/** The will a citizen has on file, or null. */
export function willOf(world: World, cId: CitizenId): Will | null {
  return generationsState(world).wills[cId] ?? null;
}

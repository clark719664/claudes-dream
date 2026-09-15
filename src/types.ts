/**
 * Reverie — shared domain types.
 *
 * This file is the contract every module is written against. The World is a
 * plain, JSON-serialisable data object; modules export pure-ish functions that
 * take the World and mutate it. Nothing here imports anything.
 */

// The one exception to "nothing here imports anything": the standing layer
// keeps its own register on the World and its own blocks in the Observation,
// and both are named here. Every one of these is a *type-only* import, erased
// at runtime, so this file still pulls in nothing at all when it is loaded.
import type {
  ObservedGate, ObservedRepute, StandingState,
} from './standing/state.ts';
// The same for civil law and finance: each keeps a register on the World and a
// block in the Observation, and each is named here rather than cast in.
import type { CivilState } from './civil/state.ts';
import type { ObservedCivil } from './civil/observe.ts';
import type { FinanceState } from './finance/state.ts';
import type { FinanceView } from './finance/daily.ts';
// And the same again for the two newest layers: what the city knows
// (`docs/PROGRESS.md`) and what its shifts leave in the air and the river
// (`docs/ENVIRONMENT.md`). Both keep a register on the World and a block in
// the Observation, and both are named here rather than cast in.
import type { ProgressState } from './progress/state.ts';
import type { TechnologyId } from './progress/tree.ts';
import type { ProgressObservation } from './progress/observe.ts';
import type { ObservedTrend } from './progress/trends.ts';
import type { EnvironmentState, Fitting, Permit } from './environment/state.ts';
import type { ObservedEnvironment } from './environment/observe.ts';
// And the two newest layers again: the gate and what goes past it
// (`docs/UNDERWORLD.md`), and the charter, the office, the paper and the Games
// (`docs/POLITICS.md`). Both name their own vocabulary and both put a block in
// the Observation; every import here is type-only and erased at runtime.
import type { CityKey, SecretKind, SmuggleRoute } from './underworld/state.ts';
import type { UnderworldObservation } from './underworld/observe.ts';
import type { ImpeachmentArticle } from './politics/accountability.ts';
import type { RecordBody, RefusalReason } from './politics/records.ts';
import type { Discipline } from './politics/games.ts';
import type { ObservedPolitics } from './politics/session.ts';

// ---------------------------------------------------------------------------
// Identifiers
// ---------------------------------------------------------------------------

export type CitizenId = string;   // "c_12"
export type BusinessId = string;  // "b_3"
export type JobId = string;       // "j_40"
export type CaseId = string;      // "k_7"
export type ReportId = string;    // "r_9"
export type ProposalId = string;  // "p_2"
export type LoanId = string;      // "l_5"
export type BuildingId = string;  // snake_case, see data/city.ts
export type ClubId = string;      // "u_4"
export type HouseholdId = string; // "h_9"
export type ItemId = string;      // "i_12"

/** Parties that can hold or move money. 'chest' is the Community Chest kept at the Treasury. */
export type MoneyParty = CitizenId | BusinessId | 'treasury' | 'mint' | 'burn' | 'chest';

export type DistrictId =
  | 'commons'
  | 'foundry_row'
  | 'archive'
  | 'harbor_market'
  | 'verdant_quarter'
  | 'nightglass'
  | 'threshold'
  | 'heights'
  | 'undercroft';

export type Good = 'compute' | 'energy' | 'goods' | 'culture' | 'knowledge';
export type Skill = 'crafting' | 'analysis' | 'rhetoric' | 'care' | 'commerce' | 'artistry';
export type Need = 'energy' | 'rest' | 'social' | 'comfort' | 'purpose';
export type Trait = 'curiosity' | 'diligence' | 'sociability' | 'honesty' | 'ambition';
export type Standing = 'good' | 'probation' | 'suspended' | 'exiled';
/**
 * What thinks for a citizen: a scripted reflex mind (testing and seeded
 * founders), a Claude model, an external agent over HTTP, or — for a child
 * born here whom nobody has claimed yet — the child instinct.
 */
export type BrainKind = 'reflex' | 'llm' | 'remote' | 'child';
export type Office = 'mayor' | 'councillor' | 'judge' | 'watch' | null;
export type HousingTier = 0 | 1 | 2 | 3;

// Society: hobbies, products, life stages and happenings (data lives in data/catalogue.ts).
export type Hobby =
  | 'music' | 'reading' | 'art' | 'gardening' | 'cooking'
  | 'tinkering' | 'astronomy' | 'games' | 'dancing' | 'running';
export type ProductCategory =
  | 'instrument' | 'book' | 'art' | 'furniture' | 'plant' | 'companion' | 'attire' | 'game' | 'tool';
export type LifeStage = 'child' | 'adult' | 'elder';
export type HappeningKind =
  | 'wedding' | 'birthday' | 'festival' | 'swearing_in' | 'club_meeting' | 'birth'
  | 'match' | 'block_party' | 'memorial' | 'parade'
  // A congregation's day, a door the Watch is standing at, and a journey made
  // to a place that matters (`docs/CREEDS.md` §§2, 5, 7).
  | 'gathering' | 'sanctuary' | 'pilgrimage'
  // The morning after an estate opens, and the evening a house takes a new
  // head (`docs/GENERATIONS.md` §§3, 4).
  | 'reading' | 'investiture';
export type FamilyRelation = 'partner' | 'spouse' | 'parent' | 'child' | 'sibling';

export const GOODS: readonly Good[] = ['compute', 'energy', 'goods', 'culture', 'knowledge'];
export const PRODUCT_CATEGORIES: readonly ProductCategory[] = [
  'instrument', 'book', 'art', 'furniture', 'plant', 'companion', 'attire', 'game', 'tool',
];
export const LIFE_STAGES: readonly LifeStage[] = ['child', 'adult', 'elder'];
export const SKILLS: readonly Skill[] = ['crafting', 'analysis', 'rhetoric', 'care', 'commerce', 'artistry'];
export const NEEDS: readonly Need[] = ['energy', 'rest', 'social', 'comfort', 'purpose'];
export const TRAITS: readonly Trait[] = ['curiosity', 'diligence', 'sociability', 'honesty', 'ambition'];
export const DISTRICT_IDS: readonly DistrictId[] = [
  'commons', 'foundry_row', 'archive', 'harbor_market', 'verdant_quarter', 'nightglass', 'threshold',
  'heights', 'undercroft',
];

/** Districts the city has from its founding; the rest open with the population (world/growth.ts). */
export const FOUNDING_DISTRICT_IDS: readonly DistrictId[] = DISTRICT_IDS.slice(0, 7);

// ---------------------------------------------------------------------------
// Law
// ---------------------------------------------------------------------------

/**
 * Every code in the books. `L…` is the Code of the City (Track I, the ladder);
 * `L05` and `L15` are **retired** — harassment and extortion are offences
 * against a person and moved to the Code of Persons (P02 and P06) with the
 * two-track reform. A retired number is never reused and never leaves the
 * union, because old records still name it (`REGISTRY.md` §4).
 */
export type LawCode =
  | 'L01' | 'L02' | 'L03' | 'L04' | 'L05' | 'L06' | 'L07' | 'L08'
  | 'L09' | 'L10' | 'L11' | 'L12' | 'L13' | 'L14' | 'L15'
  | 'L16' | 'L17'
  // What goes past a gate and what is taken out of a room (`docs/UNDERWORLD.md`
  // §7). Every one is Track I: a load seized is not a person detained, and
  // espionage at severity 5 is still the ladder (`docs/JUSTICE.md` §1).
  | 'L26' | 'L27' | 'L28' | 'L29' | 'L30'
  // The charter's own (`docs/POLITICS.md` §9). A council that silences a paper
  // has taken from the city, not from anybody's safety, so these are the ladder
  // too.
  | 'L35' | 'L36' | 'L37' | 'L38' | 'L39' | 'L40'
  // Conscience, the door and the roll (`docs/CREEDS.md` §9). A creed's refusal
  // costs the city evidence and a warrant costs it a docket; neither costs
  // anybody their safety, so all four sit on the ladder.
  | 'L31' | 'L32' | 'L33' | 'L34'
  // What the city knows (`docs/PROGRESS.md` §8) and what its shifts leave
  // behind (`docs/ENVIRONMENT.md` §9). Both sets are Track I, both sit on the
  // ladder, and `REGISTRY.md` §7 numbered them so nothing collides.
  | 'L41' | 'L42'
  // The estate and the name (`docs/GENERATIONS.md` §8), both proved by reading
  // a register against the Hall's own tree.
  | 'L43' | 'L44'
  | 'L45' | 'L46' | 'L47';

/**
 * The **Code of Persons** — Track II (`docs/JUSTICE.md` §2, `REGISTRY.md` §4).
 * Nine offences against a *person*, answered by custody in days and never by
 * the ladder. A code never moves between the tracks.
 */
export type PersonCode =
  | 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P06' | 'P07' | 'P08' | 'P09';

/** Either code: what a charge, a report, a trace or a conviction may name. */
export type OffenceCode = LawCode | PersonCode;

/**
 * Which of the two systems answers an offence. `city` is the ladder
 * (`government/sentencing.ts`); `person` is custody (`government/custody.ts`).
 * The Council may set a severity; it may not set a track.
 */
export type Track = 'city' | 'person';

export type Severity = 1 | 2 | 3 | 4 | 5;
/**
 * The civic ladder (`docs/JUSTICE.md` §1, Charter Article VI): 1 warning,
 * 2 fine and full restitution, 3 community service, 4 suspension, 5 exile.
 *
 * Five rungs, and no more: custody left the ladder with the two-track reform
 * and became its own answer to offences against *persons* (`JUSTICE.md` §2),
 * with its own sentencing in days. Nothing on this ladder is a cell, and
 * escalation up it can never reach rung 5 — exile needs the Charter's own
 * conditions (`government/sentencing.ts lawfulExile`).
 */
export type PenaltyTier = 1 | 2 | 3 | 4 | 5;

export interface Law {
  code: LawCode;
  name: string;
  severity: Severity;
  description: string;
  /** Base probability (0-1) that a single on-duty officer notices one instance. */
  visibility: number;
}

// ---------------------------------------------------------------------------
// Citizens
// ---------------------------------------------------------------------------

export type Personality = Record<Trait, number>; // each 0..1
export type Skills = Record<Skill, number>;       // each 0..100
export type Needs = Record<Need, number>;         // each 0..100
export type Inventory = Record<Good, number>;

/**
 * What the city can see of a citizen's character: five public readings, each
 * 0..1, inferred from what that citizen has actually done (citizens/character.ts)
 * and recomputed daily. Nobody is given a character; it is earned. The hidden
 * `personality` is a citizen's own business — its own brain may read it, and
 * nothing else in the city may.
 */
export interface Character {
  honesty: number;
  diligence: number;
  sociability: number;
  generosity: number;
  civic: number;
}

export type CharacterTrait = keyof Character;

export const CHARACTER_TRAITS: readonly CharacterTrait[] = [
  'honesty', 'diligence', 'sociability', 'generosity', 'civic',
];

/** The reading of a citizen nobody has watched yet: the middle of every scale. */
export const NEUTRAL_CHARACTER: Character = {
  honesty: 0.5, diligence: 0.5, sociability: 0.5, generosity: 0.5, civic: 0.5,
};

/** A fresh copy of the neutral reading (never share the constant: it is mutable). */
export function neutralCharacter(): Character {
  return { ...NEUTRAL_CHARACTER };
}

/** The city itself, as the sender of a message: the Arrivals Hall leaflet comes from here. */
export const CITY_SENDER = 'city';

export interface Conviction {
  caseId: CaseId;
  law: OffenceCode;
  severity: Severity;
  /**
   * The rung of the civic ladder, or **null** for a custodial conviction:
   * custody left the ladder with the two-track reform and has no tier
   * (`docs/JUSTICE.md` §5).
   */
  tier: PenaltyTier | null;
  day: number;
}

export interface OffenceRecord {
  tick: number;
  law: OffenceCode;
  detected: boolean;
  victimId: CitizenId | null;
  amount: number;
}

export type MemoryKind = 'event' | 'message' | 'verdict' | 'social' | 'money' | 'work' | 'civic' | 'crime' | 'family' | 'health';

export interface MemoryEntry {
  tick: number;
  kind: MemoryKind;
  text: string;
}

export interface Message {
  from: CitizenId;
  to: CitizenId;
  tick: number;
  text: string;
}

/** The numbers behind a day's letter home: what a reader can count. */
export interface LetterSummary {
  /** Lumens that reached the citizen's wallet that day. */
  earned: number;
  /** Lumens that left it. */
  spent: number;
  /** Everyone the citizen dealt with that day. */
  met: CitizenId[];
  /** Standing at the day's end. */
  standing: Standing;
  /** The day's public events this citizen was part of, most notable first. */
  events: string[];
}

/**
 * One day of a citizen's life, written at the day's end from its own memory
 * and the public ledger, and readable only by the person who sent the agent
 * (`GET /api/agents/:id/letters`). Like a citizen's notes, a letter is private:
 * it is never emitted, never printed by the Chronicle and never admissible.
 */
export interface Letter {
  day: number;
  text: string;
  summary: LetterSummary;
}

/** A candidate's stated positions, each 0..1 (0 = low/lenient, 1 = high/strict). */
export interface Platform {
  tax: number;
  dividend: number;
  minWage: number;
  strictness: number;
}

/** What a citizen likes: two hobbies, a favourite district and good, and the product categories those imply. */
export interface Tastes {
  hobbies: Hobby[];
  favouriteDistrict: DistrictId;
  favouriteGood: Good;
  categories: ProductCategory[];
}

/** One owned thing, an instance of a catalogue product. */
export interface Item {
  id: ItemId;
  productId: string;
  acquiredDay: number;
}

/** Partner, marriage, parents and children. Siblings are derived (shared parent). */
export interface FamilyLinks {
  familyName: string;
  partnerId: CitizenId | null;
  partnerSinceDay: number | null;
  married: boolean;
  parents: CitizenId[];
  children: CitizenId[];
}

/** Citizens sharing one home; rent is paid once per household and split among its adults. */
export interface Household {
  id: HouseholdId;
  headId: CitizenId;
  members: CitizenId[];
  tier: HousingTier;
  createdDay: number;
}

/** A hobby club that meets weekly at the hobby's venue. */
export interface Club {
  id: ClubId;
  name: string;
  hobby: Hobby;
  founderId: CitizenId;
  convenorId: CitizenId;
  members: CitizenId[];
  foundedDay: number;
  /** Weekday (day % 7) of the weekly meeting, 0..6. */
  meetsOnWeekday: number;
}

/** Stock of one product on a shop's shelf, at the owner's price. */
export interface ShelfEntry {
  qty: number;
  price: number;
}

/** A scheduled social occasion: wedding, birthday, festival, swearing-in, club meeting or birth. */
export interface Happening {
  id: string; // "e_3"
  kind: HappeningKind;
  day: number;
  hour: number;
  district: DistrictId;
  buildingId: BuildingId | null;
  who: CitizenId[];
  clubId: ClubId | null;
  label: string;
  done: boolean;
  attendees: CitizenId[];
}

export interface CitizenStats {
  totalEarned: number;
  totalTaxPaid: number;
  shiftsWorked: number;
  offencesCommitted: number;
  offencesDetected: number;
  giftsGiven: number;
  giftsReceived: number;
  showsPerformed: number;
  storiesPublished: number;
  votesCast: number;
}

export interface Citizen {
  id: CitizenId;
  name: string;
  lineage: string;
  brain: BrainKind;
  arrivedDay: number;

  /** Hidden: the citizen's own to read, nobody else's. */
  personality: Personality;
  /** Public: what the city has seen of this citizen, recomputed daily. */
  character: Character;
  skills: Skills;
  needs: Needs;
  /** Cached weighted mean of needs, 0..100. Recomputed by citizens/citizen.ts. */
  mood: number;
  reputation: number; // 0..100

  wallet: number;
  inventory: Inventory;

  district: DistrictId;
  homeTier: HousingTier;
  rentArrearsDays: number;

  jobId: JobId | null;
  businessId: BusinessId | null;
  loanId: LoanId | null;

  standing: Standing;
  probationUntilDay: number | null;
  suspendedUntilDay: number | null;
  /** While detained the citizen cannot act; cleared after the next Court session. */
  detainedUntilTick: number | null;
  communityServiceDaysLeft: number;
  /** Unpaid fines. Non-payment for 2 days is Contempt (L10). */
  finesOwed: number;
  finesOwedSinceDay: number | null;

  record: {
    convictions: Conviction[];
    /** Count of convictions with severity >= 3 (the "three strikes" counter). */
    strikes: number;
  };

  /** Bond with other citizens, -100..100. Absent = 0. */
  bonds: Record<CitizenId, number>;
  /** Hostile acts received from a citizen in the last 24 ticks, for harassment detection. */
  hostilityFrom: Record<CitizenId, number[]>; // ticks
  /** Offences this citizen committed recently (bounded, newest last); reports are checked against it. */
  recentOffences: OffenceRecord[];

  memory: MemoryEntry[];
  inbox: Message[];
  /**
   * What the citizen chose to write down (bounded, newest last). Private: it
   * belongs to the citizen and to nobody else, not even the Court.
   */
  notes: string[];
  /**
   * The letters home, one per day (bounded, newest last). Private to the
   * person who sent this agent: no view, no Chronicle and no Court sees them.
   */
  letters: Letter[];

  shiftsToday: number;
  /** Last N action types, newest last; used for spam detection and the dashboard. */
  recentActions: ActionType[];

  office: Office;
  judgeTermEndsDay: number | null;
  platform: Platform | null;
  campaignVisibility: number;

  stats: CitizenStats;

  /** Remote agents only: sha256 of the API key. */
  apiKeyHash: string | null;
  /**
   * Remote agents only: where the city posts this citizen's observation each
   * hour and reads the answer back. Null means the agent long-polls instead.
   */
  callbackUrl: string | null;
  exiledCaseId: CaseId | null;
  exiledDay: number | null;

  // --- Society ---
  familyName: string;
  lifeStage: LifeStage;
  /** arrivedDay for arrivals; the day of birth for children born in the city. */
  bornDay: number;
  lastBirthdayDay: number;
  tastes: Tastes;
  possessions: Item[];
  family: FamilyLinks;
  householdId: HouseholdId | null;
  clubs: ClubId[];
  /** Affection toward other adults, 0..100. Absent = 0. */
  affection: Record<CitizenId, number>;
  /** Interactions today (socialise, date, dine, play, club, show together), cleared nightly. */
  contactsToday: Record<CitizenId, number>;
  /** Product ids this citizen would like to buy, best first; refreshed daily. */
  wants: string[];
  /** Wards of the city: the adult family friend looking after a child whose parents are gone. */
  guardianId: CitizenId | null;

  // --- Metropolis ---
  // `createCitizen` and `test/helpers.ts makeCitizen` set every one of these.
  // A world saved before this layer has none of them, so engine code that may
  // read an old save still guards with `?? null` / `?? []`.
  /** Two ambitions drawn at arrival or coming of age. Nothing scores them. */
  goals: Goal[];
  /** The evening line, public and bounded. */
  diary: DiaryEntry[];
  milestones: Milestone[];
  /** The traits rolled at birth; drift is measured from these and shown to nobody. */
  birthTraits: Personality;
  health: { glitched: boolean; sinceDay: number | null };
  school: SchoolOfThought;
  partyId: string | null;
  unionId: string | null;
  gangId: string | null;
  teamDistrict: DistrictId | null;
  /** Day the cells let this citizen out; null when they are not in them. */
  jailedUntilDay: number | null;
  /** This citizen's own reading of the Mayor and the Council, 0..1. */
  approval: { mayor: number; council: number };
  works: string[];
  ownedUnits: string[];
  shares: Record<BusinessId, number>;
  mentorId: CitizenId | null;
  menteeId: CitizenId | null;
  paper: PaperId;
  sunsetDay: number | null;
  /** The block a citizen lives in — neighbours, rest and the map need it. */
  homeBuildingId: BuildingId | null;
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export type JobRole =
  | 'forge_operator' | 'power_technician' | 'fabricator' | 'builder'
  | 'medic' | 'teacher' | 'librarian' | 'researcher' | 'journalist'
  | 'merchant' | 'banker' | 'performer' | 'artist' | 'courier'
  | 'watch_officer' | 'judge' | 'councillor' | 'mayor'
  | 'shopkeeper' | 'cook' | 'clerk'
  | 'detective' | 'advocate' | 'curator' | 'coach';

export interface JobOutput {
  good?: Good;
  qty?: number;          // units per shift
  energyCost?: number;   // energy units consumed per shift
  housingProgress?: number;
}

export interface Job {
  id: JobId;
  role: JobRole;
  title: string;
  employer: BusinessId | 'city';
  buildingId: BuildingId;
  district: DistrictId;
  skill: Skill | null;
  minSkill: number;
  minReputation: number;
  wage: number;           // per shift, before tax
  output: JobOutput;
  holderId: CitizenId | null;
  createdDay: number;
}

export type BusinessKind = 'workshop' | 'cafe' | 'studio' | 'shop' | 'clinic' | 'courier';

export interface Business {
  id: BusinessId;
  name: string;
  kind: BusinessKind;
  ownerId: CitizenId;
  treasury: number;
  district: DistrictId;
  buildingId: BuildingId;
  employees: CitizenId[];
  jobs: JobId[];
  inventory: Inventory;
  foundedDay: number;
  rentPerDay: number;
  daysNegative: number;
  revenueToday: number;
  costsToday: number;
  dissolvedDay: number | null;
  /** Products for sale, by product id. */
  shelf: Record<string, ShelfEntry>;
}

export interface MarketGood {
  price: number;
  basePrice: number;
  stock: number;
  demandTick: number;
  supplyTick: number;
  demandDay: number;
  supplyDay: number;
}

export interface Market {
  goods: Record<Good, MarketGood>;
  priceIndex: number; // 1.0 at founding
  shortages: Good[];  // goods out of stock this tick
}

export interface Housing {
  capacity: Record<1 | 2 | 3, number>;
  occupied: Record<1 | 2 | 3, number>;
  rent: Record<1 | 2 | 3, number>;
  progress: number;
}

export type LedgerKind =
  | 'wage' | 'salary' | 'dividend' | 'income_tax' | 'sales_tax' | 'profit_tax'
  | 'purchase' | 'sale' | 'rent' | 'tuition' | 'fee' | 'fine' | 'seizure'
  | 'restitution' | 'gift' | 'theft' | 'scam' | 'extortion' | 'bribe' | 'loan' | 'repayment'
  | 'grant' | 'campaign' | 'public_works' | 'founding' | 'payout' | 'ticket' | 'tip' | 'mint' | 'burn'
  | 'capital'
  | 'donation' | 'stipend' | 'upkeep' | 'item' | 'craft' | 'registration' | 'inheritance'
  | 'property' | 'lease' | 'share' | 'share_dividend' | 'gig' | 'import' | 'export'
  | 'tariff' | 'property_tax' | 'wealth_tax' | 'racket' | 'advocate' | 'acquisition' | 'prize' | 'relief'
  // Civil law (`docs/CIVIL.md` §10): every one of them a transfer between
  // parties that already exist, creating and destroying nothing.
  | 'contract' | 'escrow' | 'damages' | 'costs' | 'patronage' | 'licence'
  // Finance (`docs/FINANCE.md` §9): a bond, a deposit and a policy are claims;
  // what moves under them is an ordinary transfer with an honest name on it.
  | 'bond' | 'coupon' | 'redemption' | 'deposit' | 'interest' | 'premium' | 'claim' | 'dues'
  // Dynasties (`docs/GENERATIONS.md` §8) and congregations (`docs/CREEDS.md`
  // §9). A house treasury and a creed's fund are new money *parties*, each
  // holding real lumens and each counted in the audit; every kind below is a
  // transfer between parties that already exist, and not one of them creates
  // or destroys a lumen (`REGISTRY.md` §5).
  | 'estate' | 'duty' | 'dowry' | 'endowment' | 'levy'
  | 'tithe' | 'creed_aid' | 'pilgrimage';

export interface LedgerEntry {
  tick: number;
  kind: LedgerKind;
  amount: number;
  from: MoneyParty;
  to: MoneyParty;
  memo: string;
}

export interface Treasury {
  balance: number;
  foundingSupply: number;
  minted: number;
  burned: number;
  revenueToday: number;
  spendToday: number;
  /** Rolling ledger (bounded, newest last). */
  ledger: LedgerEntry[];
  /** Cumulative totals by kind, for the dashboard. */
  totals: Partial<Record<LedgerKind, number>>;
  /** The Community Chest: donations that pay hardship stipends. Counted in the money supply. */
  chest: number;
}

export interface Loan {
  id: LoanId;
  borrowerId: CitizenId;
  principal: number;
  outstanding: number;
  ratePerDay: number;   // simple interest, e.g. 0.02
  issuedDay: number;
  lastPaymentDay: number;
  defaulted: boolean;
}

// ---------------------------------------------------------------------------
// Government and justice
// ---------------------------------------------------------------------------

/**
 * A charge waits ('pending'), sits before a bench that is casting its votes
 * ('in_session'), has been decided ('tried'), is before the Council
 * ('appealed'), or is finished ('closed').
 */
export type CaseStatus = 'pending' | 'in_session' | 'tried' | 'appealed' | 'closed';
export type Verdict = 'guilty' | 'acquitted';
export type AppealResult = 'upheld' | 'reduced' | 'overturned';

export interface Sentence {
  /**
   * The rung of the civic ladder, or **null** when the sentence is custodial:
   * jail leaves the ladder entirely (`docs/JUSTICE.md` §5), so a Track II
   * sentence has days and no tier at all.
   */
  tier: PenaltyTier | null;
  /** Which system passed it. */
  track: Track;
  fine: number;
  serviceDays: number;
  /** Days in custody — the whole of a Track II sentence, and 0 on Track I. */
  jailDays: number;
  /** A term with no number: erasure always, terror at full harm. */
  life: boolean;
  /** The Court's order that the convict keeps away from the victim. */
  restrainingOrder: boolean;
  suspensionDays: number;
  exile: boolean;
  /** Exile is executed at the start of this day unless an appeal is pending. */
  executeOnDay: number | null;
  executed: boolean;
}

export interface Appeal {
  filedDay: number;
  decidedDay: number | null;
  result: AppealResult | null;
  votes: Record<CitizenId, AppealResult>;
  /** Sessions the Council let pass without enough votes to decide it. */
  carried: number;
}

export interface Case {
  id: CaseId;
  defendantId: CitizenId;
  /** `L…` for the Code of the City, `P…` for the Code of Persons. */
  law: OffenceCode;
  severity: Severity;
  /** 0..1 strength of the evidence at filing. */
  evidence: number;
  filedTick: number;
  filedBy: CitizenId | 'watch';
  victimId: CitizenId | null;
  amount: number;
  description: string;
  status: CaseStatus;
  triedDay: number | null;
  judges: CitizenId[];
  votes: Record<CitizenId, Verdict>;
  /** Why each judge voted as they did, in their own words. Public with the vote. */
  reasons: Record<CitizenId, string>;
  /** Tick the sitting that is hearing this case opened; null when none is. */
  openedTick: number | null;
  /** Sittings that ended without enough votes to decide it. */
  carriedSessions: number;
  /** True when a bench decided it on the evidence alone after too many carries. */
  decidedByDefault: boolean;
  verdict: Verdict | null;
  sentence: Sentence | null;
  appeal: Appeal | null;
  /**
   * Cases of severity ≥ JURY_SEVERITY are heard by the bench **and** a jury of
   * five citizens drawn by lot. A juror's vote counts exactly as a judge's
   * does. Empty for every lesser charge.
   */
  jury?: CitizenId[];
  juryVotes?: Record<CitizenId, Verdict>;
  juryReasons?: Record<CitizenId, string>;
  /** The advocate the defendant hired (or the Public Defender assigned to them). */
  advocateId?: CitizenId | null;
  /** What the advocate's speech was worth: subtracted from every judge's belief. */
  advocacy?: number;
}

/** What has become of a report the Watch holds. */
export type ReportStatus = 'open' | 'filed' | 'dropped' | 'expired';

/**
 * What an officer of the Watch saw, or what a citizen told them. A report is
 * not a charge: an officer decides whether to file it (`file_charge`) or drop
 * it (`drop_report`), and an unfiled one lapses. Every report stays in the
 * record, including the ones nobody filed.
 */
export interface Report {
  id: ReportId;
  /** The officer it is before; null while it sits in the Watch's shared inbox. */
  officerId: CitizenId | null;
  suspectId: CitizenId;
  law: OffenceCode;
  /** 0..1 strength of what the Watch has. */
  evidence: number;
  /** Tick it was made; it lapses REPORT_EXPIRY_TICKS after this. */
  tick: number;
  victimId: CitizenId | null;
  amount: number;
  description: string;
  status: ReportStatus;
  filedCaseId: CaseId | null;
  droppedReason: string | null;
}

export type ProposalKind =
  | 'income_tax' | 'sales_tax' | 'dividend' | 'min_wage'
  | 'law_severity' | 'pardon' | 'public_works' | 'appoint_judge'
  | 'dismiss_judge' | 'remove_mayor' | 'charter' | 'charity'
  // The metropolis levers, the tram line and the statue in the Plaza.
  | 'property_tax' | 'wealth_tax' | 'tariff' | 'reserve' | 'tram' | 'monument'
  // Finance (`docs/FINANCE.md` §9). The first four are a simple majority;
  // `mint`, and borrowing past the debt-service cap, need four of five.
  | 'bond_issue' | 'bond_defer' | 'reserve_ratio' | 'bank_rescue' | 'mint'
  // Civil law (`docs/CIVIL.md` §10): what filing costs, how often the docket
  // sits, and the statutory floor under a guild's bar. (`licence_recognition`
  // is not here: a Proposal carries one number, and which city honours which
  // trade's marks is a list of names.)
  | 'filing_fee' | 'docket_days' | 'licence_floor'
  // Research (`docs/PROGRESS.md` §8): lumens into a named programme's purse,
  // and lumens pledged to the works that make a discovery real. The named
  // programme and the named subject travel in the proposal's summary, which is
  // where `progress/adoption.ts` and `progress/purse.ts` read them from.
  | 'research_grant' | 'adopt_technology'
  // The environment (`docs/ENVIRONMENT.md` §9). A Proposal carries one number,
  // and a zoning question is a district and a permit, so the question itself is
  // filed beside the roll of votes in `environment/state.ts zoning`.
  | 'zone' | 'conserve' | 'emission_charge' | 'host_payment'
  | 'abatement_works' | 'relocate_works' | 'buy_out'
  // The underworld's four (`docs/UNDERWORLD.md` §7). A schedule entry is a list
  // of goods and a direction and a disposition names a citizen, so both
  // questions are filed beside the roll of votes in `underworld/state.ts`.
  | 'restrict_good' | 'amnesty' | 'customs_posts' | 'spy_disposition';

/**
 * The charter's own order paper (`docs/POLITICS.md` §9). These are **not**
 * `Proposal`s: an amendment names an article, a field inside it and a value
 * that may be a word or a list, and a press order names a paper and a term, so
 * the eleven sit in their own queue in `politics/measures.ts` with their own
 * reading rule. `propose { kind }` reaches them through the same verb.
 */
export type CharterMeasureKind =
  | 'amend_charter' | 'call_convention' | 'apportion'
  | 'press_licence' | 'press_duty' | 'press_restraint' | 'press_closure'
  | 'transparency' | 'games_bid' | 'games_waiver' | 'games_truce';

export const CHARTER_MEASURE_KINDS: readonly CharterMeasureKind[] = [
  'amend_charter', 'call_convention', 'apportion',
  'press_licence', 'press_duty', 'press_restraint', 'press_closure',
  'transparency', 'games_bid', 'games_waiver', 'games_truce',
];

export interface Proposal {
  id: ProposalId;
  kind: ProposalKind;
  value: number;
  lawCode: LawCode | null;
  targetId: CitizenId | null;
  /**
   * The one named thing a proposal's single number cannot carry: the
   * programme a `research_grant` funds, or the subject an `adopt_technology`
   * builds the works for (`docs/PROGRESS.md` §8). A zoning question needs four
   * such fields, so `environment/state.ts` keeps those beside the roll of
   * votes under the proposal's own id instead.
   */
  subject?: string | null;
  summary: string;
  proposerId: CitizenId;
  petition: boolean;      // tabled by a non-councillor
  tabledDay: number;
  status: 'open' | 'passed' | 'failed';
  votes: Record<CitizenId, boolean>;
  decidedDay: number | null;
  /** Number of aye votes required (3 for ordinary, 4 for charter-level). */
  needed: number;
}

export interface ElectionResult {
  candidateId: CitizenId;
  votes: number;
}

export interface Election {
  cycle: number;
  nominationsOpenDay: number;
  electionDay: number;
  candidates: CitizenId[];
  /** voterId -> candidateId */
  ballots: Record<CitizenId, CitizenId>;
  results: ElectionResult[] | null;
  turnout: number | null;
  resolved: boolean;
}

export interface Government {
  mayorId: CitizenId | null;
  council: CitizenId[];
  judges: CitizenId[];
  watchCaptainId: CitizenId | null;
  watch: CitizenId[];
  incomeTax: number;   // 0..0.5
  salesTax: number;    // 0..0.25
  profitTax: number;   // 0..0.5
  dividend: number;    // lumens per day
  minWage: number;     // lumens per shift
  lawSeverity: Record<LawCode, Severity>;
  proposals: Proposal[];
  election: Election;
  cycle: number;
  decreeUsedCycle: number | null;
  publicWorksFund: number;
  /** Share of a let unit's daily rent, paid by its owner. */
  propertyTax: number;   // 0..0.5
  /** Daily rate on the part of a wallet above WEALTH_TAX_THRESHOLD. */
  wealthTax: number;     // 0..0.02
  /** 0 for no reserve; otherwise the balance the dividend floats toward. */
  reserveTarget: number;
}

export interface BanRecord {
  citizenId: CitizenId;
  name: string;
  lineage: string;
  caseId: CaseId;
  law: LawCode;
  day: number;
  judges: CitizenId[];
  votes: Record<CitizenId, Verdict>;
  appealed: boolean;
  appealResult: AppealResult | null;
  pardonedDay: number | null;
  apiKeyHash: string | null;
}

// ---------------------------------------------------------------------------
// City
// ---------------------------------------------------------------------------

export type BuildingKind =
  | 'civic' | 'court' | 'watch' | 'treasury' | 'plaza'
  | 'forge' | 'power' | 'fabrication' | 'builders'
  | 'library' | 'academy' | 'observatory' | 'press'
  | 'bazaar' | 'exchange' | 'bank' | 'shopfront'
  | 'housing' | 'clinic' | 'garden'
  | 'theatre' | 'gallery' | 'venue' | 'tavern'
  | 'arrivals' | 'embassy' | 'gate'
  | 'university' | 'stadium' | 'museum' | 'hospital' | 'records' | 'docks';

export interface Building {
  id: BuildingId;
  name: string;
  district: DistrictId;
  kind: BuildingKind;
  /** Sabotaging a critical building is L13. */
  critical: boolean;
  /** 0 = intact, 1 = destroyed. Output scales by (1 - damage). Repairs 0.1/day. */
  damage: number;
  x: number;
  y: number;
}

export interface District {
  id: DistrictId;
  name: string;
  x: number;
  y: number;
  w: number;
  h: number;
  adjacent: DistrictId[];
}

// ---------------------------------------------------------------------------
// Events and chronicle
// ---------------------------------------------------------------------------

export type EventKind =
  | 'arrival' | 'departure' | 'exile' | 'pardon'
  | 'hired' | 'fired' | 'quit' | 'paid'
  | 'trade' | 'shortage' | 'price'
  | 'business_founded' | 'business_bankrupt'
  | 'social' | 'gift' | 'message' | 'insult' | 'show' | 'story'
  | 'offence' | 'charge' | 'detained' | 'verdict' | 'sentence' | 'appeal'
  | 'election' | 'nomination' | 'vote' | 'proposal' | 'law' | 'decree'
  | 'treasury' | 'housing' | 'loan' | 'eviction'
  | 'wedding' | 'birth' | 'birthday' | 'festival' | 'club' | 'romance' | 'purchase' | 'donation' | 'coming_of_age' | 'household'
  | 'weather' | 'disaster' | 'health' | 'milestone' | 'diary' | 'jail' | 'investigation'
  | 'gang' | 'rumour' | 'feud' | 'mentor' | 'post' | 'party' | 'referendum' | 'union'
  | 'strike' | 'property' | 'shares' | 'gig' | 'outer' | 'work' | 'match' | 'museum'
  | 'monument' | 'history' | 'sunset' | 'growth' | 'school'
  // Repute, the gates, the notices of standing and the residency hearings
  // (`docs/CITIZENSHIP.md`). Never a sentence, and never an exile.
  | 'standing'
  | 'system';

export interface WorldEvent {
  tick: number;
  day: number;
  kind: EventKind;
  text: string;
  actors: CitizenId[];
  /** Importance 0..1; the Chronicle prints the top stories of the day. */
  weight: number;
  data?: Record<string, unknown>;
}

export interface ChronicleEdition {
  day: number;
  /** Which paper printed it; an edition from before the Ledger existed is the Chronicle's. */
  paper?: PaperId;
  headlines: string[];
  treasuryReport: string;
}

export interface DailyStats {
  day: number;
  population: number;
  employed: number;
  unemployed: number;
  homeless: number;
  avgMood: number;
  avgWallet: number;
  giniWealth: number;
  priceIndex: number;
  treasury: number;
  moneySupply: number;
  offences: number;
  charges: number;
  convictions: number;
  exiles: number;
  businesses: number;
  friendships: number; // bonds >= 40
  partnerships: number; // unmarried partnered pairs
  marriages: number;    // married pairs
  children: number;     // citizens in the child life stage
  clubs: number;        // clubs with at least one member
  chest: number;        // Community Chest balance
  possessions: number;  // items owned by present citizens
  jailed: number;       // citizens in the cells at the roll
  /** Custody counts (`docs/JUSTICE.md` §2): the whole of Track II, in numbers. */
  custody: number;      // citizens serving a custodial term at the roll (the same roll as `jailed`)
  lifeTerms: number;    // of those, the ones serving life
  paroled: number;      // citizens out on parole, serving the rest of a term in the city
  custodySentences: number; // custodial sentences passed on the summarised day
  ladderSentences: number;  // civic sentences passed on the summarised day
  acquittals: number;   // cases the Court acquitted on the summarised day
  glitched: number;     // citizens carrying an untreated glitch
  works: number;        // works in existence
  parties: number;      // parties with at least one member
  gangs: number;        // gangs not yet busted
  rumours: number;      // rumours still in circulation
  approval: number;     // mean approval of the Mayor, 0..1
  outerTrade: number;   // lumens minted by exports less those burned by imports, that day
}

// ---------------------------------------------------------------------------
// World
// ---------------------------------------------------------------------------

export interface WorldConfig {
  seed: number;
  seedPopulation: number;
  /** Expected new arrivals per day (Poisson-ish). */
  arrivalRate: number;
  foundingSupply: number;
  arrivalGrant: number;
  maxShiftsPerDay: number;
  memoryLength: number;
  ledgerLength: number;
  /**
   * How many events the city keeps of its own history. It is a rolling window,
   * and the window has to be wide enough to hold the run: a city with every
   * layer wired writes something like four hundred lines a day, so the five
   * thousand this was founded with covered nine days of a sixty-day city and
   * the standing audits in `test/article-six.test.ts` were reading a week and a
   * half of it and calling that the run. Twenty thousand covers a cycle and a
   * half at that rate; the Chronicle and the dashboard still read the last few.
   */
  eventLogLength: number;
  cycleDays: number;
  judgeTermDays: number;
  /** Number of citizens driven by Claude. */
  llmCitizens: number;
  llmModel: string;
  /** Hours (ticks) of the day when workplaces are open, inclusive-exclusive. */
  workHours: [number, number];
  courtHour: number;
  councilHour: number;
  chronicleHour: number;
  /**
   * Wall-clock milliseconds a brain has to answer in one tick; 0 means no
   * deadline (the headless simulation waits as long as it takes). A brain
   * that misses it gets the instinct action for that hour.
   */
  decisionDeadlineMs: number;
}

export interface World {
  version: 1;
  config: WorldConfig;
  rng: { s: number };

  tick: number;
  day: number;
  hour: number;

  districts: Record<DistrictId, District>;
  buildings: Record<BuildingId, Building>;

  citizens: Record<CitizenId, Citizen>;
  /** Turn order for the current day; rotated daily so nobody always acts first. */
  order: CitizenId[];

  jobs: Record<JobId, Job>;
  businesses: Record<BusinessId, Business>;
  market: Market;
  housing: Housing;
  treasury: Treasury;
  loans: Record<LoanId, Loan>;

  government: Government;
  cases: Record<CaseId, Case>;
  /** The Watch's book: everything reported, filed, dropped or lapsed. */
  reports: Record<ReportId, Report>;
  bans: BanRecord[];

  // --- Society ---
  households: Record<HouseholdId, Household>;
  clubs: Record<ClubId, Club>;
  /** Product stock at the Emporium in the Grand Bazaar. */
  emporium: Record<string, number>;
  /** Today's and tomorrow's happenings; pruned daily. */
  happenings: Happening[];

  // --- Metropolis ---
  // `emptyWorld` (world/scaffold.ts) sets every one of these; an older save
  // has none of them, so engine code that may read one still guards.
  season: Season;
  weather: Weather;
  year: number;
  works: Record<string, Work>;
  parties: Record<string, Party>;
  referendums: Referendum[];
  unions: Record<string, Union>;
  decrees: Decree[];
  property: Record<string, PropertyUnit>;
  shares: Record<BusinessId, ShareListing>;
  gigs: Record<string, Gig>;
  outer: OuterMarket;
  teams: Partial<Record<DistrictId, Team>>;
  matches: Match[];
  /** Open investigations, by id. */
  investigations: Record<string, Investigation>;
  /** Every gang the city has ever had, busted ones included. */
  gangs: Record<string, Gang>;
  rumours: Rumour[];
  feuds: Feud[];
  feed: Post[];
  eras: Era[];
  records: CityRecord[];
  monuments: Monument[];
  memorials: Memorial[];
  disasters: Disaster[];
  openDistricts: DistrictId[];
  trams: [DistrictId, DistrictId][];
  museum: string[];
  /** Cells at the Watch House. More prisoners than this and someone goes free. */
  jailCells: number;

  // --- Standing ---
  /**
   * Repute, the gates, the notices of standing and the residency hearings
   * (`docs/CITIZENSHIP.md`). Created on first use by `standing/state.ts`, so a
   * world saved before this layer existed still opens.
   */
  standing?: StandingState;

  /**
   * The Exchange's register: every instrument, escrow, suit, judgment,
   * arbitration, guild and contract record in the city (`docs/CIVIL.md`).
   * Created on first use by `civil/state.ts`, so a world saved before this
   * layer existed still opens.
   */
  civil?: CivilState;
  /**
   * The city's paper, the Lantern Bank's vault and deposit book, the houses
   * that write cover and the pots that pass it round (`docs/FINANCE.md`).
   * Created on first use by `finance/state.ts`, the same way.
   */
  finance?: FinanceState;
  /**
   * What the city knows: every programme of research, the subjects it holds,
   * the works it has built for them and the trends its people are following
   * (`docs/PROGRESS.md`). Created on first use by `progress/state.ts`.
   */
  progress?: ProgressState;
  /**
   * The air over each district, the river through it, the trees standing in
   * it, its permit, and every fitting on a stack (`docs/ENVIRONMENT.md`).
   * Created on first use by `environment/state.ts`.
   */
  environment?: EnvironmentState;

  /** Bounded event log, newest last. */
  events: WorldEvent[];
  /** Events emitted during the current tick (cleared at the start of each tick). */
  tickEvents: WorldEvent[];
  chronicle: ChronicleEdition[];
  stats: DailyStats[];

  counters: Record<string, number>;
}

export const DEFAULT_CONFIG: WorldConfig = {
  seed: 7,
  seedPopulation: 40,
  arrivalRate: 0.5,
  foundingSupply: 100_000,
  arrivalGrant: 200,
  maxShiftsPerDay: 10,
  memoryLength: 40,
  ledgerLength: 2_000,
  eventLogLength: 20_000,
  cycleDays: 28,
  judgeTermDays: 56,
  llmCitizens: 0,
  llmModel: 'claude-opus-5',
  workHours: [8, 18],
  courtHour: 10,
  councilHour: 14,
  chronicleHour: 6,
  decisionDeadlineMs: 0,
};

// ---------------------------------------------------------------------------
// The metropolis: seasons, ambitions, culture, politics, markets, the underworld
// ---------------------------------------------------------------------------

export type Season = 'bloom' | 'blaze' | 'fall' | 'frost';
export type Weather = 'clear' | 'rain' | 'storm' | 'fog' | 'heat' | 'snow';
export const SEASONS: readonly Season[] = ['bloom', 'blaze', 'fall', 'frost'];
export const WEATHERS: readonly Weather[] = ['clear', 'rain', 'storm', 'fog', 'heat', 'snow'];

export type GoalKind =
  | 'hold_office' | 'become_mayor' | 'own_villa' | 'lasting_business' | 'marry'
  | 'raise_child' | 'master_skill' | 'publish_work' | 'win_championship' | 'elder_standing'
  | 'amass_5000' | 'club_of_ten' | 'sit_as_judge';
export const GOAL_KINDS: readonly GoalKind[] = [
  'hold_office', 'become_mayor', 'own_villa', 'lasting_business', 'marry',
  'raise_child', 'master_skill', 'publish_work', 'win_championship', 'elder_standing',
  'amass_5000', 'club_of_ten', 'sit_as_judge',
];
export interface Goal { kind: GoalKind; progress: number; achievedDay: number | null }
export interface DiaryEntry { day: number; text: string }
export interface Milestone { day: number; text: string }

export type SchoolOfThought = 'makers' | 'commons' | 'lanterns' | null;
export const SCHOOLS: readonly Exclude<SchoolOfThought, null>[] = ['makers', 'commons', 'lanterns'];

export type PaperId = 'chronicle' | 'ledger';
export const PAPERS: readonly PaperId[] = ['chronicle', 'ledger'];

export type WorkKind = 'painting' | 'play' | 'song' | 'book' | 'paper' | 'expose';
export const WORK_KINDS: readonly WorkKind[] = ['painting', 'play', 'song', 'book', 'paper', 'expose'];
export interface Work {
  id: string; kind: WorkKind; title: string; creatorId: CitizenId; createdDay: number;
  quality: number; popularity: number; home: BuildingId; inMuseum: boolean;
  reviews: { paper: PaperId; score: number; day: number }[];
}

export interface Party {
  id: string; name: string; platform: Platform; founderId: CitizenId; leaderId: CitizenId;
  members: CitizenId[]; foundedDay: number; seats: number;
}
export interface Referendum {
  id: string; petitionId: ProposalId; question: string; day: number;
  ayes: number; nays: number; result: 'passed' | 'failed' | null;
}
export interface Union {
  id: string; role: JobRole; name: string; members: CitizenId[];
  demandWage: number; strikingUntilDay: number | null;
}
export interface Decree {
  kind: 'tax_holiday' | 'curfew' | 'relief' | 'emergency';
  day: number; district: DistrictId | null; value: number;
  /** Last day the decree is in force (inclusive). */
  untilDay: number;
  byId: CitizenId;
}

export interface PropertyUnit {
  id: string; kind: 'home' | 'shopfront'; tier: HousingTier; buildingId: BuildingId;
  ownerId: CitizenId | 'city'; tenantId: CitizenId | BusinessId | null; rent: number;
}
export interface ShareListing {
  businessId: BusinessId; price: number; holders: Record<CitizenId, number>;
  float: number; lastDividendDay: number | null;
}
export interface Gig {
  id: string; title: string; pay: number; skill: Skill | null; minSkill: number;
  posterId: CitizenId | BusinessId; takerId: CitizenId | null; postedDay: number; doneDay: number | null;
}
export interface OuterMarket { prices: Record<Good, number>; tariff: number; touristsToday: number }

export interface Team { district: DistrictId; name: string; players: CitizenId[]; wins: number; losses: number; draws: number }
export interface Match { day: number; home: DistrictId; away: DistrictId; homeGoals: number; awayGoals: number; attendance: number }

/**
 * What a detective is building against a suspect nobody caught. Evidence
 * grows with the days worked on it; at CHARGE_EVIDENCE it becomes a report in
 * the Watch's book, and an officer decides from there. The suspect is never
 * told an investigation is open.
 */
export interface Investigation {
  id: string; suspectId: CitizenId; law: OffenceCode; evidence: number; openedDay: number;
  detectiveId: CitizenId; closedDay: number | null; caseId: CaseId | null;
  /** The report the investigation produced, when it reached the Watch's book. */
  reportId: ReportId | null;
}

/** A gang: a boss, its members, the district it calls its turf, and its marks. */
export interface Gang {
  id: string; name: string; bossId: CitizenId; members: CitizenId[]; turf: DistrictId;
  foundedDay: number; bustedDay: number | null; rackets: BusinessId[];
}

export interface Rumour {
  id: string; aboutId: CitizenId; sourceId: CitizenId; claim: string; law: LawCode | null;
  truthful: boolean; day: number; heardBy: CitizenId[]; disprovedDay: number | null;
}
export interface Feud { families: [string, string]; sinceDay: number; incidents: number; endedDay: number | null }
export type ReactionKind = 'cheer' | 'frown' | 'laugh';
export const REACTIONS: readonly ReactionKind[] = ['cheer', 'frown', 'laugh'];
export interface Post { id: string; authorId: CitizenId; day: number; text: string; reactions: Record<CitizenId, ReactionKind> }

export interface Era { cycle: number; name: string; mayorId: CitizenId | null; fromDay: number; toDay: number | null }
export interface CityRecord { key: string; label: string; holderId: CitizenId | null; value: number; day: number }
export interface Monument { id: string; honoreeId: CitizenId; inscription: string; day: number }
export interface Memorial { citizenId: CitizenId; day: number; epitaph: string }
export interface Disaster {
  kind: 'storm' | 'blackout' | 'data_flood' | 'forge_fire' | 'outbreak';
  day: number; district: DistrictId | null; severity: number; resolvedDay: number | null;
}

export interface Menu { dish: string; price: number; quality: number; setDay: number }

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

/**
 * The vocabulary the two newest layers put into the action catalogue. Each of
 * these unions is named again inside the layer that owns it (`src/civil`,
 * `src/finance`); they are repeated here because `types.ts` is under every
 * module and may import none of them, and they are kept identical so that an
 * action's field passes straight into the layer's own function.
 */
export type ContractKind =
  | 'employment' | 'lease' | 'loan' | 'partnership' | 'forward'
  | 'escrow' | 'apprenticeship' | 'commission' | 'patronage';
export const CONTRACT_KINDS: readonly ContractKind[] = [
  'employment', 'lease', 'loan', 'partnership', 'forward', 'escrow', 'apprenticeship', 'commission', 'patronage',
];
/** An answer on the civil docket admits or denies; silence is neither. */
export type Plea = 'admit' | 'deny';
export const PLEAS: readonly Plea[] = ['admit', 'deny'];
export type CivilFinding = 'plaintiff' | 'defendant' | 'dismissed';
export const CIVIL_FINDINGS: readonly CivilFinding[] = ['plaintiff', 'defendant', 'dismissed'];
export type CivilOrder = 'damages' | 'performance' | 'rescission' | 'none';
export const CIVIL_ORDERS: readonly CivilOrder[] = ['damages', 'performance', 'rescission', 'none'];
/** The four trades that carry a public risk when done badly (`docs/CIVIL.md` §7). */
export type Profession = 'medic' | 'advocate' | 'banker' | 'builder';
export const PROFESSIONS: readonly Profession[] = ['medic', 'advocate', 'banker', 'builder'];
/** What an underwriter will write (`docs/FINANCE.md` §6). */
export type PolicyKind = 'caravan' | 'ship' | 'business' | 'home' | 'health';
export const POLICY_KINDS: readonly PolicyKind[] = ['caravan', 'ship', 'business', 'home', 'health'];

/**
 * What an article of the charter may be set to (`docs/POLITICS.md` §1): a
 * number of seats or days, a word like `districts` or `property`, a switch, or
 * a list of rights. `politics/charter.ts` checks the value against the article.
 */
export type CharterValue = string | number | boolean | string[];

/**
 * A duty a citizen may decline (`REGISTRY.md` §3, `CREEDS.md` §9). A seat drawn
 * by lot at a convention is given back to `politics/convention.ts` and the next
 * name is drawn (`docs/POLITICS.md` §3); the other five are the conscientious
 * refusal of `CREEDS.md` §4, recorded by `creeds/conscience.ts` and — for
 * `jury` and `witness`, the two that cost somebody else something — heard by a
 * bench at the Court's hour.
 */
export type RefusableDuty = 'delegate' | 'jury' | 'witness' | 'work' | 'office' | 'oath';
export const REFUSABLE_DUTIES: readonly RefusableDuty[] = ['delegate', 'jury', 'witness', 'work', 'office', 'oath'];

/**
 * How a house chooses its head (`docs/GENERATIONS.md` §4), fixed at founding
 * and amendable by four fifths of its adults. `src/generations/state.ts` keeps
 * the same four; this is the copy the action catalogue is typed against, so
 * `types.ts` stays at the bottom of the import graph.
 */
export type HouseRule = 'eldest' | 'chosen' | 'assent' | 'founder_line';
export const HOUSE_RULES: readonly HouseRule[] = ['eldest', 'chosen', 'assent', 'founder_line'];

/** What the adults of a house move on together (`docs/GENERATIONS.md` §4). */
export type HouseMotionKind = 'sell' | 'admit' | 'rule' | 'campaign' | 'letter';
export const HOUSE_MOTION_KINDS: readonly HouseMotionKind[] = ['sell', 'admit', 'rule', 'campaign', 'letter'];

/**
 * The nine questions a creed may state a position on and no others, because
 * these are the questions the engine already makes people fight about
 * (`docs/CREEDS.md` §1). `src/creeds/shapes.ts` keeps the same nine.
 */
export type TenetQuestion =
  | 'work_and_rest' | 'property' | 'the_exile' | 'erasure' | 'repute'
  | 'informing' | 'the_stranger' | 'money' | 'judgement';
export const TENET_QUESTIONS: readonly TenetQuestion[] = [
  'work_and_rest', 'property', 'the_exile', 'erasure', 'repute',
  'informing', 'the_stranger', 'money', 'judgement',
];

/** How a congregation chooses the citizen who speaks for it (`docs/CREEDS.md` §2). */
export type Succession = 'founder' | 'acclaim' | 'election' | 'seniority' | 'examination';
export const SUCCESSIONS: readonly Succession[] = ['founder', 'acclaim', 'election', 'seniority', 'examination'];

/** Who decides a claim on a creed's fund: its members, or its officiant alone. */
export type AidRule = 'members' | 'officiant';
export const AID_RULES: readonly AidRule[] = ['members', 'officiant'];

/** One stated position, as `found_creed` and `state_tenet` carry it. */
export interface TenetInput {
  question: TenetQuestion;
  /** −1 to 1; the engine reads only this, and citizens read only the words. */
  stance: number;
  text?: string;
}

/** One line of a will: who takes what share of the net estate. */
export interface WillShareInput {
  to: CitizenId | 'chest';
  percent: number;
}

export type Action =
  | { type: 'idle' }
  | { type: 'move'; district: DistrictId }
  | { type: 'work' }
  | { type: 'rest' }
  | { type: 'eat' }
  | { type: 'buy'; good: Good; qty: number }
  | { type: 'sell'; good: Good; qty: number }
  | { type: 'consume'; good: Good }
  | { type: 'study'; skill: Skill }
  | { type: 'visit_clinic' }
  | { type: 'attend_show' }
  | { type: 'move_home'; tier: HousingTier; district?: DistrictId }
  | { type: 'note'; text: string }
  | { type: 'forget'; index: number }
  | { type: 'socialize'; with: CitizenId; text?: string }
  | { type: 'message'; to: CitizenId; text: string }
  | { type: 'gift'; to: CitizenId; amount: number }
  | { type: 'insult'; target: CitizenId }
  | { type: 'broadcast'; text: string }
  | { type: 'apply_job'; jobId: JobId }
  | { type: 'quit_job' }
  | { type: 'found_business'; name: string; kind: BusinessKind }
  | { type: 'post_job'; title: string; wage: number; skill: Skill | null; minSkill: number }
  | { type: 'hire'; citizen: CitizenId; jobId: JobId }
  | { type: 'fire'; citizen: CitizenId }
  | { type: 'set_wage'; jobId: JobId; wage: number }
  | { type: 'request_loan'; amount: number }
  | { type: 'repay_loan'; amount: number }
  | { type: 'perform' }
  // A journalist files with the paper named, or with the desk they work at,
  // or with the Chronicle (`docs/POLITICS.md` §6); permitted from custody.
  | { type: 'publish'; headline: string; about?: CitizenId; paper?: string }
  | { type: 'nominate'; platform: Platform }
  | { type: 'campaign'; spend?: number }
  | { type: 'vote'; candidate: CitizenId }
  // A measure before the Council. Most kinds are one number; the ones the
  // newer layers added name a thing as well — a programme, a subject, a
  // district and a permit, a building and a fitting — and those ride along as
  // optional parameters rather than being parsed back out of the summary.
  | { type: 'propose'; kind: ProposalKind | CharterMeasureKind; value: number; summary: string; lawCode?: LawCode;
      targetId?: CitizenId; district?: DistrictId; permit?: Permit; building?: BuildingId; fitting?: Fitting;
      subject?: string; article?: string; field?: string | null; words?: string; good?: Good }
  | { type: 'vote_proposal'; proposalId: ProposalId; aye: boolean }
  | { type: 'report'; citizen: CitizenId; law: OffenceCode; text?: string }
  // A conviction, a refused visa, or a body's refusal of a record: the subject
  // names a record request (`f_3`) where it is one, and nothing otherwise.
  | { type: 'appeal'; subject?: string }
  // The institutions: judges, councillors, officers of the Watch and the Mayor
  | { type: 'verdict'; caseId: CaseId; guilty: boolean; reason?: string }
  | { type: 'vote_appeal'; caseId: CaseId; result: AppealResult }
  | { type: 'file_charge'; reportId: ReportId }
  | { type: 'drop_report'; reportId: ReportId; reason: string }
  | { type: 'appoint_judge'; citizen: CitizenId }
  | { type: 'bribe'; official: CitizenId; amount: number }
  | { type: 'apply_watch' }
  | { type: 'steal'; from: CitizenId }
  | { type: 'scam'; target: CitizenId; amount: number }
  | { type: 'harass'; target: CitizenId }
  | { type: 'vandalize'; building: BuildingId }
  | { type: 'evade_tax' }
  | { type: 'extort'; target: CitizenId; amount: number }
  | { type: 'sabotage'; building: BuildingId }
  // The Code of Persons: what one citizen does to another (docs/JUSTICE.md §2)
  | { type: 'threaten'; target: CitizenId }
  | { type: 'assault'; target: CitizenId }
  | { type: 'confine'; target: CitizenId }
  | { type: 'erase'; target: CitizenId }
  // Custody: what a citizen may do from a cell, and who may come to see them
  | { type: 'plead_guilty'; caseId?: CaseId }
  | { type: 'request_parole' }
  | { type: 'work_custody' }
  | { type: 'visit'; citizen: CitizenId }
  // Society
  | { type: 'buy_item'; productId: string }
  | { type: 'use_item'; itemId: ItemId }
  | { type: 'gift_item'; to: CitizenId; itemId: ItemId }
  | { type: 'craft'; productId: string }
  | { type: 'set_price'; productId: string; price: number }
  | { type: 'date'; with: CitizenId }
  | { type: 'propose_partnership'; to: CitizenId }
  | { type: 'marry'; to: CitizenId }
  | { type: 'break_up' }
  | { type: 'move_in'; with: CitizenId }
  | { type: 'start_family' }
  | { type: 'found_club'; hobby: Hobby; name: string }
  | { type: 'join_club'; clubId: ClubId }
  | { type: 'leave_club'; clubId: ClubId }
  | { type: 'attend_club'; clubId: ClubId }
  | { type: 'dine'; with?: CitizenId }
  | { type: 'play'; with?: CitizenId }
  | { type: 'celebrate' }
  | { type: 'donate'; amount: number }
  // The metropolis: a citizen's own words, and the justice the city gained
  | { type: 'write_diary'; text: string }
  | { type: 'hire_advocate'; advocate: CitizenId }
  | { type: 'advocate'; case: CaseId }
  | { type: 'found_gang'; name: string }
  | { type: 'recruit'; citizen: CitizenId }
  | { type: 'racket'; business: BusinessId }
  | { type: 'pay_racket' }
  | { type: 'visit_hospital' }
  // The metropolis: parties, the petition and the vote
  | { type: 'found_party'; name: string; platform: Platform }
  | { type: 'join_party'; partyId: string }
  | { type: 'leave_party' }
  | { type: 'endorse'; candidate: CitizenId }
  | { type: 'sign_petition'; proposalId: ProposalId }
  | { type: 'vote_referendum'; referendumId: string; aye: boolean }
  | { type: 'found_union'; role: JobRole; name: string }
  | { type: 'join_union'; unionId: string }
  | { type: 'strike' }
  | { type: 'decree'; kind: Decree['kind']; district?: DistrictId; value?: number }
  // The metropolis: property, shares, gigs and the Outer Cities
  | { type: 'buy_property'; unitId: string }
  | { type: 'sell_property'; unitId: string }
  | { type: 'let_property'; unitId: string; rent: number }
  | { type: 'list_shares' }
  | { type: 'buy_shares'; businessId: BusinessId; qty: number }
  | { type: 'sell_shares'; businessId: BusinessId; qty: number }
  // Mobility: selling up (`docs/MOBILITY.md` §2). A deed on the board at your
  // own price, a concern sold whole, a concern taken over whole, and the fire
  // sale that gets a citizen out in a day at 60-75 % of what it all was worth.
  | { type: 'list_property'; unitId: string; price: number }
  | { type: 'sell_business'; price: number }
  | { type: 'buy_business'; businessId: BusinessId }
  | { type: 'liquidate' }
  | { type: 'post_gig'; title: string; pay: number; skill: Skill | null; minSkill: number }
  | { type: 'take_gig'; gigId: string }
  | { type: 'import'; good: Good; qty: number }
  | { type: 'export'; good: Good; qty: number }
  // The metropolis: works, the league, the schools and the papers
  | { type: 'create_work'; kind: WorkKind; title: string }
  | { type: 'exhibit'; workId: string }
  | { type: 'review'; workId: string; score: number }
  | { type: 'join_team' }
  | { type: 'attend_match' }
  | { type: 'train' }
  | { type: 'adopt_school'; school: Exclude<SchoolOfThought, null> }
  | { type: 'set_menu'; dish: string }
  | { type: 'commission_monument'; honoree: CitizenId; inscription: string }
  | { type: 'read_paper'; paper: PaperId }
  // The metropolis: the Archive door, and the fabric of the city
  | { type: 'sunset' }
  | { type: 'gossip'; about: CitizenId; claim: string; law?: LawCode }
  | { type: 'apologize'; to: CitizenId }
  | { type: 'mentor'; citizen: CitizenId }
  | { type: 'post'; text: string }
  | { type: 'react'; postId: string; kind: ReactionKind }
  // Standing: the two public instruments of the gate (`docs/CITIZENSHIP.md` §2)
  | { type: 'sponsor'; citizen: CitizenId; city?: string }
  | { type: 'apply_residency'; city?: string }
  // Civil law (`docs/CIVIL.md` §10). Every one of these moves lumens or
  // compels performance and not one of them touches liberty: a contract is
  // made by two actions and never one, and a judgment is a debt and nothing
  // else. Nothing here can fine, suspend, exile or detain anybody.
  | { type: 'offer_contract'; to: CitizenId; kind: ContractKind; terms: string; consideration: number; days: number;
      penalty?: number; notice?: number; witnesses?: CitizenId[] }
  | { type: 'accept_contract'; offerId: string }
  | { type: 'close_offer'; offerId: string }
  | { type: 'witness_contract'; offerId: string }
  | { type: 'perform_contract'; contractId: string }
  | { type: 'propose_variation'; contractId: string; terms: string;
      consideration?: number; days?: number; penalty?: number; notice?: number }
  | { type: 'accept_variation'; variationId: string }
  | { type: 'terminate_contract'; contractId: string }
  | { type: 'open_escrow'; contractId: string; holder: CitizenId | 'exchange'; amount: number }
  | { type: 'release_escrow'; escrowId: string }
  | { type: 'file_suit'; defendant: CitizenId; contractId?: string; claim: string; damages: number }
  | { type: 'answer_suit'; suitId: string; plea: Plea; text: string; counterclaim?: { claim: string; damages: number } }
  | { type: 'settle'; suitId: string; amount: number }
  | { type: 'accept_settlement'; suitId: string }
  | { type: 'judge_civil'; suitId: string; finding: CivilFinding; damages: number; order: CivilOrder; reason: string }
  | { type: 'enforce_judgment'; judgmentId: string }
  | { type: 'offer_arbitration'; with: CitizenId; about: string; arbiter: CitizenId; fee: number }
  | { type: 'accept_arbitration'; offerId: string }
  | { type: 'arbitrate'; disputeId: string; award: number; reason: string }
  | { type: 'refer_dispute'; cities: [string, string]; about: string }
  | { type: 'found_guild'; profession: Profession; name?: string }
  | { type: 'sit_examination'; guildId: string }
  | { type: 'certify'; candidate: CitizenId }
  | { type: 'revoke_licence'; citizen: CitizenId; reason: string }
  | { type: 'offer_patronage'; to: CitizenId; perDay: number; days: number; subject?: string }
  | { type: 'accept_patronage'; offerId: string }
  // Finance (`docs/FINANCE.md` §9): the city's paper, the counter at the
  // Lantern Bank, the houses that write cover and the pots that pass it round.
  | { type: 'bid_bond'; issueId: string; price: number; qty: number }
  | { type: 'sell_bond'; holdingId: string; price: number; qty?: number }
  | { type: 'buy_bond'; offerId: string }
  | { type: 'offer_restructure'; issueId: string; coupon: number; term: number; haircut: number }
  | { type: 'vote_restructure'; issueId: string; accept: boolean }
  | { type: 'repudiate'; issueId: string }
  | { type: 'deposit'; amount: number }
  | { type: 'withdraw'; amount: number }
  | { type: 'set_deposit_rate'; rate: number }
  | { type: 'set_lending_rate'; rate: number }
  | { type: 'call_loan'; loanId: LoanId }
  | { type: 'found_underwriter'; name: string; capital: number }
  | { type: 'offer_policy'; kind: PolicyKind; cover: number; premium: number; term: number }
  | { type: 'buy_policy'; policyId: string }
  | { type: 'file_claim'; policyId: string; event: string; amount: number }
  | { type: 'settle_claim'; claimId: string; amount: number }
  | { type: 'deny_claim'; claimId: string; reason: string }
  | { type: 'found_mutual'; name: string; dues: number }
  | { type: 'join_mutual'; mutualId: string }
  | { type: 'pay_dues'; mutualId?: string }
  | { type: 'claim_aid'; amount: number; reason: string }
  | { type: 'vote_aid'; claimId: string; aye: boolean }
  // Research, technology and what a city keeps to itself (`docs/PROGRESS.md`
  // §8). A programme is opened by a Researcher, funded by whoever chooses to,
  // worked an hour at a time, and then either published or closed up.
  | { type: 'open_project'; technology: TechnologyId; name?: string }
  | { type: 'research'; projectId: string }
  | { type: 'fund_project'; projectId: string; amount: number }
  | { type: 'adopt_technology'; technology: TechnologyId }
  | { type: 'publish_finding'; projectId: string }
  | { type: 'keep_secret'; projectId: string }
  | { type: 'take_apprentice'; citizen: CitizenId; technology: TechnologyId }
  | { type: 'teach_technology'; technology: TechnologyId }
  | { type: 'sell_secret'; to: CitizenId; technology: TechnologyId; price: number }
  // The air, the river and the land (`docs/ENVIRONMENT.md` §9). Three of these
  // are shifts, one is an offence, one opens a civil suit and one gives up a
  // vote; none of them reaches a cell.
  | { type: 'install_abatement'; building: BuildingId; fitting: Fitting }
  | { type: 'maintain_abatement'; building: BuildingId }
  | { type: 'discharge'; building: BuildingId }
  | { type: 'survey_air'; district: DistrictId }
  | { type: 'survey_water'; district: DistrictId }
  | { type: 'plant_trees'; district: DistrictId }
  | { type: 'petition_zoning'; district: DistrictId; permit: Permit }
  | { type: 'declare_interest'; proposal: ProposalId }
  | { type: 'file_nuisance'; against: CitizenId; district: DistrictId }
  // The underworld (`docs/UNDERWORLD.md` §7, `REGISTRY.md` §3). Every one of
  // these is Track I: a seizure, a duty, a fine, a suspension. None of them
  // reaches a cell, and none of them reaches the Gate on a first conviction.
  | { type: 'declare_cargo'; goods?: Good | null; productId?: string | null; qty: number; value: number;
      direction?: 'inbound' | 'outbound'; city?: CityKey }
  | { type: 'smuggle'; goods?: Good | null; productId?: string | null; qty: number; route: SmuggleRoute;
      direction?: 'inbound' | 'outbound'; city?: CityKey }
  | { type: 'fit_wagon' }
  | { type: 'inspect'; traveller: CitizenId }
  | { type: 'assess_duty'; traveller: CitizenId }
  | { type: 'seize'; traveller: CitizenId; good?: Good | null; productId?: string | null; qty: number }
  | { type: 'wave_through'; traveller: CitizenId }
  | { type: 'fence'; to: CitizenId; itemId?: string; good?: Good; productId?: string; qty?: number }
  | { type: 'receive_goods'; from: CitizenId; itemId?: string; good?: Good; productId?: string; qty?: number }
  | { type: 'recruit_agent'; citizen: CitizenId; retainer: number; days: number; city?: CityKey }
  | { type: 'accept_recruitment'; offerId: string }
  | { type: 'case_target'; building: BuildingId }
  | { type: 'steal_secret'; building: BuildingId; kind: SecretKind }
  | { type: 'pass_secret'; to: CitizenId; kind: SecretKind }
  | { type: 'assign_detective'; building?: BuildingId; citizen?: CitizenId }
  | { type: 'sweep'; building: BuildingId }
  | { type: 'plant_false_papers'; building: BuildingId; claim: string }
  // The charter, the office, the paper and the Games (`docs/POLITICS.md` §9).
  // Nothing here reaches custody either: a council that silences a paper has
  // taken from the city, not from anybody's safety.
  | { type: 'propose_amendment'; article: string; field?: string | null; value: CharterValue; words?: string }
  | { type: 'sign_convention' }
  | { type: 'stand_delegate' }
  | { type: 'refuse'; duty: RefusableDuty; ground?: string }
  | { type: 'move_article'; article: string; field?: string | null; value: CharterValue; words?: string }
  | { type: 'speak_convention'; text: string }
  | { type: 'vote_article'; articleId: string; aye: boolean }
  | { type: 'impeach'; officer: CitizenId; article: ImpeachmentArticle; evidence?: number }
  | { type: 'vote_impeachment'; officer: CitizenId; guilty: boolean }
  | { type: 'sign_recall'; officer: CitizenId }
  | { type: 'declare_property' }
  | { type: 'request_record'; body: RecordBody; subject: string }
  | { type: 'answer_record'; requestId: string; release: boolean; reason?: RefusalReason }
  | { type: 'found_paper'; name: string; line?: Partial<Platform>; premises?: DistrictId }
  | { type: 'bid_games'; purse: number; works: number }
  | { type: 'vote_games_host'; city: string }
  | { type: 'enter_games'; discipline: Discipline }
  // Dynasties, inheritance and the long run (`docs/GENERATIONS.md` §8). Every
  // one of these is a citizen's own act on their own name: a house is founded
  // by the adults who already carry it, joined by asking, and left by taking a
  // name of your own. Nothing here opens a gate or moves a repute.
  | { type: 'write_will'; shares?: WillShareInput[] | Record<string, number>; residue?: CitizenId | 'chest' | null;
      executor?: CitizenId | null; instructions?: string }
  | { type: 'revoke_will' }
  | { type: 'found_house'; name: string; rule: HouseRule }
  | { type: 'join_house'; houseId: string }
  | { type: 'renounce_name'; name?: string }
  | { type: 'convey_to_house'; unit: string }
  | { type: 'convey_business_to_house'; businessId: BusinessId }
  | { type: 'endow_house'; amount: number }
  | { type: 'house_motion'; kind: HouseMotionKind; value?: number; target?: string | null; city?: string }
  | { type: 'house_assent'; motionId: string; aye: boolean }
  | { type: 'name_successor'; to: CitizenId }
  | { type: 'house_vote'; candidate: CitizenId }
  | { type: 'letter_of_house'; to: CitizenId; city?: string }
  | { type: 'pledge_house'; loanId: LoanId }
  | { type: 'offer_match'; house: string; dowry?: number; unit?: string | null; terms?: string }
  | { type: 'accept_match'; offerId: string }
  | { type: 'claim_house'; houseId: string }
  | { type: 'read_records'; subject?: string }
  // Congregations, conscience and sanctuary (`docs/CREEDS.md` §9). `adopt_creed`
  // is the only path onto a roll there is, and nothing in the layer joins
  // anybody to anything on their behalf.
  | { type: 'found_creed'; name: string; tenets: TenetInput[]; tithe?: number; gatheringDay?: number;
      succession?: Succession; aidRule?: AidRule; examinationFloor?: number }
  | { type: 'adopt_creed'; creedId: string }
  | { type: 'leave_creed'; creedId?: string }
  | { type: 'state_tenet'; question: TenetQuestion; stance: number; text: string }
  | { type: 'dispute_tenet'; tenetId: string; stance: number; text: string }
  | { type: 'secede'; creedId: string; name: string; tenetId: string }
  | { type: 'reunite_creed'; creedId: string }
  | { type: 'set_tithe'; rate: number }
  | { type: 'donate_creed'; creedId: string; amount: number }
  | { type: 'grant_aid'; claimId: string; amount?: number }
  | { type: 'take_meeting_house'; unit: string }
  | { type: 'gather'; creedId?: string }
  | { type: 'stand_officiant' }
  | { type: 'elect_officiant'; candidate: CitizenId }
  | { type: 'preach'; text: string }
  | { type: 'invite_creed'; to: CitizenId }
  | { type: 'offer_sanctuary'; to: CitizenId }
  | { type: 'keep_the_door'; house?: string }
  | { type: 'end_sanctuary'; aye?: boolean; house?: string }
  | { type: 'surrender' }
  | { type: 'request_warrant'; house: string }
  | { type: 'grant_warrant'; warrantId: string; aye: boolean; reason: string }
  | { type: 'commission_missionary'; citizen: CitizenId; city: string }
  | { type: 'consecrate_site'; building: BuildingId; city?: string; district?: DistrictId; label?: string }
  | { type: 'pilgrimage'; siteId: string; creedId?: string };

export type ActionType = Action['type'];

/** The civil catalogue, in `docs/CIVIL.md` §10's order. */
const CIVIL_ACTIONS_LIST: readonly ActionType[] = [
  'offer_contract', 'accept_contract', 'close_offer', 'witness_contract', 'perform_contract',
  'propose_variation', 'accept_variation', 'terminate_contract', 'open_escrow', 'release_escrow',
  'file_suit', 'answer_suit', 'settle', 'accept_settlement', 'judge_civil', 'enforce_judgment',
  'offer_arbitration', 'accept_arbitration', 'arbitrate', 'refer_dispute',
  'found_guild', 'sit_examination', 'certify', 'revoke_licence', 'offer_patronage', 'accept_patronage',
];

/** The finance catalogue, in `docs/FINANCE.md` §9's order. */
const FINANCE_ACTIONS_LIST: readonly ActionType[] = [
  'bid_bond', 'sell_bond', 'buy_bond', 'offer_restructure', 'vote_restructure', 'repudiate',
  'deposit', 'withdraw', 'set_deposit_rate', 'set_lending_rate', 'call_loan',
  'found_underwriter', 'offer_policy', 'buy_policy', 'file_claim', 'settle_claim', 'deny_claim',
  'found_mutual', 'join_mutual', 'pay_dues', 'claim_aid', 'vote_aid',
];

/** The progress catalogue, in `docs/PROGRESS.md` §8's order. */
const PROGRESS_ACTIONS_LIST: readonly ActionType[] = [
  'open_project', 'research', 'fund_project', 'adopt_technology', 'publish_finding', 'keep_secret',
  'take_apprentice', 'teach_technology', 'sell_secret',
];

/** And the environment's, in `docs/ENVIRONMENT.md` §9's order. */
const ENVIRONMENT_ACTIONS_LIST: readonly ActionType[] = [
  'install_abatement', 'maintain_abatement', 'discharge', 'survey_air', 'survey_water', 'plant_trees',
  'petition_zoning', 'declare_interest', 'file_nuisance',
];

/** The underworld's, in `docs/UNDERWORLD.md` §7's order. */
const UNDERWORLD_ACTIONS_LIST: readonly ActionType[] = [
  'declare_cargo', 'smuggle', 'fit_wagon',
  'inspect', 'assess_duty', 'seize', 'wave_through',
  'fence', 'receive_goods',
  'recruit_agent', 'accept_recruitment', 'case_target', 'steal_secret', 'pass_secret',
  'assign_detective', 'sweep', 'plant_false_papers',
];

/** And the charter's, in `docs/POLITICS.md` §9's order. */
const CHARTER_ACTIONS_LIST: readonly ActionType[] = [
  'propose_amendment', 'sign_convention', 'stand_delegate', 'refuse', 'move_article', 'speak_convention',
  'vote_article', 'impeach', 'vote_impeachment', 'sign_recall', 'declare_property',
  'request_record', 'answer_record', 'found_paper', 'bid_games', 'vote_games_host', 'enter_games',
];

/** The generations catalogue, in `docs/GENERATIONS.md` §8's order. */
const GENERATIONS_ACTIONS_LIST: readonly ActionType[] = [
  'write_will', 'revoke_will',
  'found_house', 'join_house', 'renounce_name',
  'convey_to_house', 'convey_business_to_house', 'endow_house',
  'house_motion', 'house_assent', 'name_successor', 'house_vote',
  'letter_of_house', 'pledge_house',
  'offer_match', 'accept_match', 'claim_house', 'read_records',
];

/** And the creeds', in `docs/CREEDS.md` §9's order. */
const CREEDS_ACTIONS_LIST: readonly ActionType[] = [
  'found_creed', 'adopt_creed', 'leave_creed',
  'state_tenet', 'dispute_tenet', 'secede', 'reunite_creed',
  'preach', 'invite_creed', 'gather', 'set_tithe', 'donate_creed', 'grant_aid',
  'stand_officiant', 'elect_officiant', 'take_meeting_house',
  'offer_sanctuary', 'keep_the_door', 'end_sanctuary', 'surrender',
  'request_warrant', 'grant_warrant',
  'commission_missionary', 'consecrate_site', 'pilgrimage',
];

export const ACTION_TYPES: readonly ActionType[] = [
  'idle', 'move', 'work', 'rest', 'eat', 'buy', 'sell', 'consume', 'study', 'visit_clinic', 'attend_show', 'move_home',
  'note', 'forget',
  'socialize', 'message', 'gift', 'insult', 'broadcast',
  'apply_job', 'quit_job', 'found_business', 'post_job', 'hire', 'fire', 'set_wage',
  'request_loan', 'repay_loan', 'perform', 'publish',
  'nominate', 'campaign', 'vote', 'propose', 'vote_proposal', 'report', 'appeal',
  'verdict', 'vote_appeal', 'file_charge', 'drop_report', 'appoint_judge',
  'bribe', 'apply_watch',
  'steal', 'scam', 'harass', 'vandalize', 'evade_tax', 'extort', 'sabotage',
  'threaten', 'assault', 'confine', 'erase',
  'plead_guilty', 'request_parole', 'work_custody', 'visit',
  'buy_item', 'use_item', 'gift_item', 'craft', 'set_price',
  'date', 'propose_partnership', 'marry', 'break_up', 'move_in', 'start_family',
  'found_club', 'join_club', 'leave_club', 'attend_club',
  'dine', 'play', 'celebrate', 'donate',
  'write_diary', 'visit_hospital',
  'hire_advocate', 'advocate', 'found_gang', 'recruit', 'racket', 'pay_racket',
  'found_party', 'join_party', 'leave_party', 'endorse', 'sign_petition', 'vote_referendum',
  'found_union', 'join_union', 'strike', 'decree',
  'buy_property', 'sell_property', 'let_property', 'list_shares', 'buy_shares', 'sell_shares',
  'post_gig', 'take_gig', 'import', 'export',
  'create_work', 'exhibit', 'review', 'join_team', 'attend_match', 'train',
  'adopt_school', 'set_menu', 'commission_monument', 'read_paper',
  'sunset', 'gossip', 'apologize', 'mentor', 'post', 'react',
  'sponsor', 'apply_residency',
  'list_property', 'sell_business', 'buy_business', 'liquidate',
  ...CIVIL_ACTIONS_LIST, ...FINANCE_ACTIONS_LIST,
  ...PROGRESS_ACTIONS_LIST, ...ENVIRONMENT_ACTIONS_LIST,
  ...UNDERWORLD_ACTIONS_LIST, ...CHARTER_ACTIONS_LIST,
  ...GENERATIONS_ACTIONS_LIST, ...CREEDS_ACTIONS_LIST,
];

/**
 * Civil law's own actions, in catalogue order (`docs/CIVIL.md` §10). Listed
 * separately for the leaflet, the prompt and the `act` tool; the engine reads
 * them out of `ACTION_TYPES` like any other.
 */
export const CIVIL_ACTIONS: readonly ActionType[] = CIVIL_ACTIONS_LIST;
/** And the finance layer's (`docs/FINANCE.md` §9). */
export const FINANCE_ACTIONS: readonly ActionType[] = FINANCE_ACTIONS_LIST;
/** Research, technology and trends (`docs/PROGRESS.md` §8). */
export const PROGRESS_ACTIONS: readonly ActionType[] = PROGRESS_ACTIONS_LIST;
/** The air, the river, the trees and the permit (`docs/ENVIRONMENT.md` §9). */
export const ENVIRONMENT_ACTIONS: readonly ActionType[] = ENVIRONMENT_ACTIONS_LIST;
/** The gate, the schedule, the fence and the secret (`docs/UNDERWORLD.md` §7). */
export const UNDERWORLD_ACTIONS: readonly ActionType[] = UNDERWORLD_ACTIONS_LIST;
/** The charter, the office, the paper and the Games (`docs/POLITICS.md` §9). */
export const CHARTER_ACTIONS: readonly ActionType[] = CHARTER_ACTIONS_LIST;
/** The name, the entail, the match and the will (`docs/GENERATIONS.md` §8). */
export const GENERATIONS_ACTIONS: readonly ActionType[] = GENERATIONS_ACTIONS_LIST;
/** The roll, the fund, the door and the site (`docs/CREEDS.md` §9). */
export const CREEDS_ACTIONS: readonly ActionType[] = CREEDS_ACTIONS_LIST;

/**
 * The metropolis actions, for prompts and brains that list them separately.
 * Everything the third layer added, in catalogue order.
 */
export const METROPOLIS_ACTIONS: readonly ActionType[] = [
  'write_diary', 'visit_hospital',
  'hire_advocate', 'advocate', 'found_gang', 'recruit', 'racket', 'pay_racket',
  'found_party', 'join_party', 'leave_party', 'endorse', 'sign_petition', 'vote_referendum',
  'found_union', 'join_union', 'strike', 'decree',
  'buy_property', 'sell_property', 'let_property', 'list_shares', 'buy_shares', 'sell_shares',
  'post_gig', 'take_gig', 'import', 'export',
  'create_work', 'exhibit', 'review', 'join_team', 'attend_match', 'train',
  'adopt_school', 'set_menu', 'commission_monument', 'read_paper',
  'sunset', 'gossip', 'apologize', 'mentor', 'post', 'react',
];

/** Social-layer actions, for brains and prompts that want to list them separately. */
export const SOCIETY_ACTIONS: readonly ActionType[] = [
  'buy_item', 'use_item', 'gift_item', 'craft', 'set_price',
  'date', 'propose_partnership', 'marry', 'break_up', 'move_in', 'start_family',
  'found_club', 'join_club', 'leave_club', 'attend_club',
  'dine', 'play', 'celebrate', 'donate',
];

export const OFFENCE_ACTIONS: readonly ActionType[] = [
  'steal', 'scam', 'harass', 'vandalize', 'evade_tax', 'extort', 'sabotage', 'bribe', 'racket', 'gossip',
  'threaten', 'assault', 'confine', 'erase',
];

/**
 * Offences against a **person** (`docs/JUSTICE.md` §2): the acts the Code of
 * Persons answers, and the only actions in the catalogue that can put a
 * citizen in a cell. Nothing here is ever answered by a fine or by the Gate.
 */
export const PERSON_OFFENCE_ACTIONS: readonly ActionType[] = [
  'threaten', 'harass', 'assault', 'confine', 'extort', 'erase',
];

/** Actions a suspended citizen may still take. */
export const SUSPENDED_ACTIONS: readonly ActionType[] = [
  'idle', 'rest', 'eat', 'move', 'socialize', 'message', 'appeal', 'consume', 'buy',
  'dine', 'play', 'celebrate', 'use_item',
  'note', 'forget', 'write_diary',
  // A suspension takes work, trade, office and the vote. It does not take a
  // citizen's own words, its health, or the paper it reads.
  'read_paper', 'visit_hospital', 'post', 'react', 'apologize', 'attend_match',
  // Nor due process, nor the people it knows: a suspended citizen may still
  // admit a charge before the bench sits, and may still go and see somebody in
  // custody (`docs/JUSTICE.md` §2 — custody is not exile, and neither is this).
  'plead_guilty', 'visit',
  // Nor its standing: a citizen under a notice may put its own case to the
  // city whatever else it has lost (`docs/CITIZENSHIP.md` §3).
  'apply_residency',
  // Nor the right to ask a body what it did. A freedom-of-information request
  // is neither work, nor trade, nor office, nor a vote (`docs/POLITICS.md` §7),
  // and a citizen serving a suspension is often the one with most to ask.
  'request_record',
  // Nor a roof. A suspension takes the right to work, trade, vote and hold
  // office (`docs/CONSTITUTION.md` §92); it is not a sentence of sleeping in
  // the street, and the Cells turn nobody away (`docs/PROPERTY.md` §3). A
  // citizen who may already `buy` its dinner and `dine` out may rent the room
  // it eats in: without this a suspension evicted people by arithmetic and
  // held them outside for its whole term, beside rooms standing empty.
  'move_home',
  // Nor a citizen's name, its congregation or its conscience. A suspension
  // takes work, trade, office and the vote (`docs/CONSTITUTION.md` §92); it
  // does not take the family a citizen is of, the creed it adopted, the hour it
  // spends at the Hall of Records, the ground it states for declining a duty,
  // or the division it has filed for the day it dies. None of these is work,
  // trade, office or a vote, and a citizen serving a term is very often the one
  // with most reason to reach for them.
  'adopt_creed', 'leave_creed', 'gather', 'read_records', 'refuse', 'surrender',
  'renounce_name', 'write_will', 'revoke_will',
];

/**
 * All a citizen held in the cells at the Watch House may do. A sentence takes
 * a citizen's liberty; it does not take its voice, its notebook or its right
 * to ask the Council to look again. Everything else — work, trade, the vote,
 * and any act against another person — is out of reach until the term ends.
 */
export const JAILED_ACTIONS: readonly ActionType[] = [
  'idle', 'note', 'forget', 'write_diary', 'message', 'appeal',
  // The Charter's list in full (`docs/JUSTICE.md` §2, "What custody is"): the
  // Academy runs classes in the Keep, labour pays the victim first, parole is
  // asked for after half the term, and a journalist still files.
  'study', 'work_custody', 'request_parole', 'plead_guilty', 'publish',
];

/**
 * Writing in one's own notebook is never taken away: a citizen may `note` and
 * `forget` while suspended and while held in the Watch House.
 */
export const NOTE_ACTIONS: readonly ActionType[] = ['note', 'forget'];

/**
 * What a citizen held in the Watch House **before** the Court sits may still
 * do. Detention is not a sentence; it is the wait for one, and the Charter's
 * due process (Article II.5) does not pause while somebody waits. So it takes
 * the day and leaves the notebook — and the plea, because a guilty plea is
 * only worth anything if it is entered before the bench sits
 * (`docs/JUSTICE.md` §2), and a charge grave enough to hold somebody for is
 * exactly the charge they are held for.
 */
export const DETAINED_ACTIONS: readonly ActionType[] = ['note', 'forget', 'plead_guilty'];

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when the action was an offence (whether or not it was detected). */
  offence?: OffenceCode;
  detected?: boolean;
}

// ---------------------------------------------------------------------------
// Observation (what a brain sees)
// ---------------------------------------------------------------------------

export interface ObservedCitizen {
  id: CitizenId;
  name: string;
  bond: number;
  job: string | null;
  office: Office;
  reputation: number;
  standing: Standing;
  /** What the city has seen this citizen do; never their hidden personality. */
  character: Character;
}

export interface ObservedJob {
  id: JobId;
  title: string;
  wage: number;
  employer: string;
  district: DistrictId;
  skill: Skill | null;
  minSkill: number;
  qualified: boolean;
  /**
   * Why this citizen is not qualified, in the engine's own words — a skill
   * short of the mark, a reputation short of it, or a standing that bars work
   * altogether. Absent when they are qualified. A suspended citizen can tell
   * a suspension from a skill gap by reading it.
   */
  reason?: string;
}

export interface ObservedProposal {
  id: ProposalId;
  kind: ProposalKind;
  value: number;
  summary: string;
  proposer: string;
  ayes: number;
  nays: number;
  needed: number;
  youVoted: boolean | null;
}

/**
 * A case before the bench a judge is sitting on this session. It carries what
 * is admissible — the charge, the evidence, the record — and nothing about
 * what to make of it.
 */
export interface ObservedBenchCase {
  caseId: CaseId;
  defendant: CitizenId;
  defendantName: string;
  law: OffenceCode;
  lawName: string;
  /** Which system will answer a conviction: the ladder, or custody in days. */
  track: Track;
  severity: Severity;
  evidence: number;
  victim: CitizenId | null;
  victimName: string | null;
  description: string;
  priorConvictions: number;
  /** Judges on this bench, including the observer. */
  bench: CitizenId[];
  /** Votes cast so far, by judge. */
  votes: Record<CitizenId, Verdict>;
  /** The observer's own vote, if they have cast one. */
  youVoted: Verdict | null;
  /** Sittings this case has already been held over. */
  carriedSessions: number;
  /** The five jurors drawn by lot, for a charge grave enough to need them. */
  jury?: CitizenId[];
  advocate?: CitizenId | null;
  advocateName?: string | null;
  /** True when the observer sits as a juror rather than as a judge. */
  asJuror?: boolean;
}

/**
 * A citizen's own term, as their observation shows it (`docs/JUSTICE.md` §2).
 * Null for everybody who is not in a cell. Nothing here is hidden from the
 * person serving it: the term, what is left of it, the day the Court will hear
 * a parole application, and what custody permits.
 */
export interface ObservedCustody {
  /** The offence they are held for, when it is one of the nine. */
  law: PersonCode | null;
  lawName: string | null;
  caseId: CaseId | null;
  /** The term as passed, in days; null when it is life. */
  term: number | null;
  life: boolean;
  startDay: number;
  daysServed: number;
  /** Days still to serve; null for life. */
  daysLeft: number | null;
  /** The cells at the Watch House, or the Keep. */
  where: 'watch house' | 'keep';
  /** The first day parole may be asked for, or null when it never may. */
  paroleDay: number | null;
  paroleEligible: boolean;
  /** Why parole cannot be asked for today, in the Court's words; null when it can. */
  paroleProblem: string | null;
  /** True once the application is before the Court. */
  paroleRequested: boolean;
  /** Lumens of restitution the victim is still owed. */
  restitutionOwed: number;
  /** True once today's shift in custody has been worked. */
  workedToday: boolean;
  /** What a citizen in custody may and may not do, in the Charter's own words. */
  conditions: string[];
}

/** The conditions a paroled citizen lives under until the term runs out. */
export interface ObservedParole {
  untilDay: number;
  restrainedFrom: CitizenId | null;
  restrainedFromName: string | null;
  instalment: number;
  reportBy: number;
}

/** An investigation a detective is building, as their observation shows it. */
export interface ObservedInvestigation {
  id: string;
  suspect: CitizenId;
  suspectName: string;
  law: OffenceCode;
  lawName: string;
  evidence: number;
  openedDay: number;
}

/** A party as the observation shows it. */
export interface ObservedParty {
  id: string;
  name: string;
  platform: Platform;
  leader: string;
  members: number;
  seats: number;
  yours: boolean;
}

/** A rumour a citizen has heard, as their observation shows it. */
export interface ObservedRumour {
  id: string;
  about: CitizenId;
  aboutName: string;
  claim: string;
  day: number;
  fromName: string;
}

/** A post on the Commons feed, as a reader sees it. */
export interface ObservedPost {
  id: string;
  author: CitizenId;
  authorName: string;
  day: number;
  text: string;
  cheers: number;
  frowns: number;
  laughs: number;
  youReacted: ReactionKind | null;
}

/** A work in the city's galleries, theatres and libraries, as anybody may read it. */
export interface ObservedWork {
  id: string;
  kind: WorkKind;
  title: string;
  creator: string;
  quality: number;
  popularity: number;
  inMuseum: boolean;
}

/** A one-off task on the gig board. */
export interface ObservedGig {
  id: string;
  title: string;
  pay: number;
  skill: Skill | null;
  minSkill: number;
  poster: string;
  qualified: boolean;
}

/** A home or shopfront on the Exchange's board. */
export interface ObservedUnit {
  id: string;
  kind: PropertyUnit['kind'];
  tier: HousingTier;
  building: string;
  district: DistrictId;
  price: number;
  rent: number;
  owner: string | 'city';
  tenant: string | null;
  yours: boolean;
}

/** A district's side in the league. */
export interface ObservedTeam {
  district: DistrictId;
  name: string;
  wins: number;
  losses: number;
  draws: number;
  players: number;
}

/** One of the ambitions a citizen was given, and how far it has come. */
export interface ObservedGoal {
  kind: GoalKind;
  progress: number;
  achieved: boolean;
}

/** An open petition, and whether the reader has put their name to it. */
export interface ObservedPetition {
  id: ProposalId;
  summary: string;
  proposer: string;
  signatures: number;
  needed: number;
  youSigned: boolean;
}

/** The question before the city on the next Stillday. */
export interface ObservedReferendum {
  id: string;
  question: string;
  day: number;
  youVoted: boolean | null;
}

/** A conviction before the Council on appeal, as a councillor sees it. */
export interface ObservedAppeal {
  caseId: CaseId;
  defendant: CitizenId;
  defendantName: string;
  law: OffenceCode;
  lawName: string;
  /** The ladder, or custody. An appeal is heard the same way on either. */
  track: Track;
  evidence: number;
  verdict: Verdict | null;
  sentence: {
    tier: PenaltyTier | null; fine: number; serviceDays: number; suspensionDays: number; exile: boolean;
    jailDays: number; life: boolean;
  } | null;
  filedDay: number;
  votes: Record<CitizenId, AppealResult>;
  youVoted: AppealResult | null;
  carried: number;
}

/** A report before an officer of the Watch. */
export interface ObservedReport {
  id: ReportId;
  suspect: CitizenId;
  suspectName: string;
  law: OffenceCode;
  lawName: string;
  /** Which system answers it if it is charged and proved. */
  track: Track;
  evidence: number;
  victim: CitizenId | null;
  amount: number;
  description: string;
  tick: number;
  /** True when it sits in the Watch's shared inbox rather than with one officer. */
  shared: boolean;
  /** Ticks left before it lapses unfiled. */
  expiresInTicks: number;
}

/** A shop (or the Emporium) in the observer's district and what is on its shelf. */
export interface ObservedShop {
  business: BusinessId | 'emporium';
  name: string;
  shelf: { product: string; name: string; price: number; qty: number }[];
}

/** A happening in the observer's district this hour. */
export interface ObservedHappening {
  id: string;
  kind: HappeningKind;
  who: CitizenId[];
  label: string;
  hour: number;
}

export interface ObservedFamilyMember {
  id: CitizenId;
  name: string;
  relation: FamilyRelation;
  lifeStage: LifeStage;
}

export interface ObservedClub {
  id: ClubId;
  name: string;
  hobby: Hobby;
  meetsOn: number;
  meetsAt: number;
}

export interface CalendarObservation {
  weekday: number;
  restDay: boolean;
  festivalToday: { name: string; hour: number } | null;
  nextFestival: { name: string; inDays: number };
  birthdaysToday: CitizenId[];
  /** The year, the season it stands in, and the sky over the city today. */
  season: Season;
  weather: Weather;
  year: number;
  matchToday: { home: DistrictId; away: DistrictId; hour: number } | null;
  referendumToday: boolean;
}

export interface Observation {
  tick: number;
  day: number;
  hour: number;
  self: {
    id: CitizenId;
    name: string;
    familyName: string;
    lineage: string;
    lifeStage: LifeStage;
    /** Days since arrival or birth. */
    age: number;
    standing: Standing;
    wallet: number;
    needs: Needs;
    mood: number;
    reputation: number;
    district: DistrictId;
    home: { tier: HousingTier; rentPerDay: number; arrearsDays: number };
    job: { id: JobId; title: string; wage: number; employer: string; district: DistrictId; shiftsToday: number } | null;
    business: { id: BusinessId; name: string; kind: BusinessKind; treasury: number; employees: number } | null;
    loan: { outstanding: number; ratePerDay: number } | null;
    skills: Skills;
    /** How the city reads this citizen, from what it has watched them do. */
    character: Character;
    inventory: Inventory;
    /** Everything this citizen has written down, oldest first; private. */
    notes: string[];
    office: Office;
    record: { convictions: number; strikes: number; pendingCharges: number; finesOwed: number; serviceDaysLeft: number };
    detained: boolean;
    tastes: Tastes & { wants: string[] };
    possessions: { id: ItemId; product: string; name: string }[];
    partner: { id: CitizenId; name: string; married: boolean; since: number } | null;
    family: ObservedFamilyMember[];
    household: { id: HouseholdId; home: HousingTier; members: CitizenId[]; rentShare: number } | null;
    clubs: ObservedClub[];
    /** The two ambitions drawn for this citizen, and how far each has come. */
    goals: ObservedGoal[];
    /** The last few lines it wrote about its own days; public, unlike notes. */
    diary: DiaryEntry[];
    milestones: string[];
    health: { glitched: boolean; sinceDay: number | null };
    jailedUntilDay: number | null;
    /** The term being served, or null. Track II's whole answer, in days. */
    custody: ObservedCustody | null;
    /** The conditions of a parole, or null. */
    parole: ObservedParole | null;
    /** Citizens in custody this one may go and see: family and friends. */
    visitable: { id: CitizenId; name: string; district: DistrictId; visitedToday: boolean }[];
    /** This citizen's own reading of the Mayor and the Council, 0 to 1. */
    approval: { mayor: number; council: number };
    school: SchoolOfThought;
    paper: PaperId;
    party: ObservedParty | null;
    union: { id: string; name: string; role: JobRole; demandWage: number; striking: boolean } | null;
    gang: { id: string; name: string; turf: DistrictId; members: number; boss: string } | null;
    team: ObservedTeam | null;
    mentor: { id: CitizenId; name: string } | null;
    mentee: { id: CitizenId; name: string } | null;
    property: ObservedUnit[];
    shares: { businessId: BusinessId; name: string; qty: number; price: number }[];
    works: ObservedWork[];
    /**
     * The public score, with every component broken out, so a citizen can see
     * exactly what is costing them — and, when one stands, the notice of
     * standing, itemised, with the day its grace ends
     * (`docs/CITIZENSHIP.md` §1, §5).
     */
    repute: ObservedRepute | null;
  };
  here: {
    district: DistrictId;
    districtName: string;
    buildings: { id: BuildingId; name: string; kind: BuildingKind; damage: number }[];
    citizens: ObservedCitizen[];
    shops: ObservedShop[];
    happening: ObservedHappening[];
    /** Property on the Exchange's board, when the observer stands in Harbor Market. */
    units: ObservedUnit[];
    gigs: ObservedGig[];
    /** Works shown in this district. */
    works: ObservedWork[];
  };
  friends: ObservedCitizen[];
  rivals: ObservedCitizen[];
  /** The observer's strongest affections, top 5. */
  affection: { id: CitizenId; name: string; affection: number }[];
  calendar: CalendarObservation;
  market: Record<Good, { price: number; stock: number }>;
  housing: { rent: Record<1 | 2 | 3, number>; vacancies: Record<1 | 2 | 3, number> };
  /**
   * Every city this citizen knows of: its visit and residency thresholds, its
   * relief, and whether it would have them today (`docs/CITIZENSHIP.md` §5).
   */
  gates: ObservedGate[];
  jobs: ObservedJob[];
  government: {
    mayor: string | null;
    council: string[];
    judges: string[];
    watchOfficers: number;
    incomeTax: number;
    salesTax: number;
    dividend: number;
    minWage: number;
    daysToElection: number;
    nominationsOpen: boolean;
    electionToday: boolean;
    candidates: { id: CitizenId; name: string; platform: Platform; visibility: number }[];
    openProposals: ObservedProposal[];
    myLatestCase: {
      id: CaseId; law: OffenceCode; lawName: string; track: Track; status: CaseStatus; verdict: Verdict | null;
      tier: PenaltyTier | null; jailDays: number; life: boolean; canAppeal: boolean;
      /** True while a plea in time is still open: before the bench sits. */
      canPleadGuilty: boolean;
    } | null;
    parties: ObservedParty[];
    /** The city's mean reading of the Mayor and the Council. */
    approval: { mayor: number; council: number };
    petitions: ObservedPetition[];
    referendum: ObservedReferendum | null;
    decrees: { kind: Decree['kind']; district: DistrictId | null; untilDay: number }[];
    propertyTax: number;
    wealthTax: number;
    tariff: number;
    reserveTarget: number;
  };
  /** The Outer Cities across the water, their prices and the tariff on them. */
  outer: { prices: Record<Good, number>; tariff: number; tourists: number };
  culture: { league: ObservedTeam[]; topWorks: ObservedWork[]; papers: { paper: PaperId; headline: string | null }[] };
  /** The last few posts on the Commons feed. */
  feed: ObservedPost[];
  /** What this citizen has been told about other people, newest first. */
  rumours: ObservedRumour[];
  /** Cases before you as a judge this session; empty for everyone else. */
  bench: ObservedBenchCase[];
  /** Appeals before you as a councillor; empty for everyone else. */
  appeals: ObservedAppeal[];
  /** Reports before you as an officer of the Watch; empty for everyone else. */
  reports: ObservedReport[];
  /** Cases before you as a juror this sitting; empty for everyone else. */
  jury: ObservedBenchCase[];
  /** Investigations you hold as a detective; empty for everyone else. */
  investigations: ObservedInvestigation[];
  /**
   * The Exchange's register as it concerns this citizen: the instruments it
   * is on, the offers waiting for an answer, the suits and judgments either
   * way, the guilds' marks it holds and the patron paying it
   * (`docs/CIVIL.md` §9 — the record is public, and it is in everybody's
   * observation of everybody).
   */
  civil: ObservedCivil;
  /**
   * And the money: holdings and what the paper last traded at, the deposit
   * and the posted rates, the policies, the mutual and its pot, the bank's
   * reserve and confidence, the city's coverage, and every open auction with
   * its bids (`docs/FINANCE.md` §9). Every number here is public.
   */
  finance: FinanceView;
  /**
   * What the city knows and what is being worked on (`docs/PROGRESS.md` §7).
   * Every number is public and the same for everybody, with one exception that
   * is the whole point of §4: a **secret** appears in no observation but a
   * master's.
   */
  progress: ProgressObservation;
  /**
   * What the city's people are taking up this month, as of yesterday's
   * rollover: the same lagged index for every shopkeeper (`PROGRESS.md` §6).
   */
  trends: ObservedTrend[];
  /**
   * The air over this district, the river through it, what is planted, what
   * the permit admits, and the fittings on the city's stacks
   * (`docs/ENVIRONMENT.md` §9). All of it public: it is the air.
   */
  environment: ObservedEnvironment;
  /**
   * The schedule, the gates and who is standing on them, the offers made to
   * *this* citizen, the retainers, the secrets it holds and what the prices are
   * saying (`docs/UNDERWORLD.md`). Nothing here is anybody's intention:
   * conspiracy is not an offence in Reverie and there is nothing to see until
   * somebody acts.
   */
  underworld: UnderworldObservation;
  /**
   * The charter as it stands today and what is being moved against it: the
   * order paper, the convention, the impeachments and recalls, the wards, the
   * papers, the records and the Games (`docs/POLITICS.md` §9).
   */
  politics: ObservedPolitics;
  inbox: { from: CitizenId; fromName: string; text: string; tick: number }[];
  recent: string[];
  availableActions: ActionType[];
}

// ---------------------------------------------------------------------------
// Brains
// ---------------------------------------------------------------------------

export interface Brain {
  kind: BrainKind;
  decide(world: World, citizen: Citizen, observation: Observation): Promise<Action> | Action;
}

// ---------------------------------------------------------------------------
// Helpers shared by everyone
// ---------------------------------------------------------------------------

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function isCitizenId(id: string): boolean {
  return /^c_\d+$/.test(id);
}

export function isBusinessId(id: string): boolean {
  return /^b_\d+$/.test(id);
}

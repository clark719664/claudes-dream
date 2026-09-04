/**
 * Reverie — shared domain types.
 *
 * This file is the contract every module is written against. The World is a
 * plain, JSON-serialisable data object; modules export pure-ish functions that
 * take the World and mutate it. Nothing here imports anything.
 */

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
  | 'match' | 'block_party' | 'memorial' | 'parade';
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
  | 'L16' | 'L17';

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
  | 'tariff' | 'property_tax' | 'wealth_tax' | 'racket' | 'advocate' | 'acquisition' | 'prize' | 'relief';

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
  | 'property_tax' | 'wealth_tax' | 'tariff' | 'reserve' | 'tram' | 'monument';

export interface Proposal {
  id: ProposalId;
  kind: ProposalKind;
  value: number;
  lawCode: LawCode | null;
  targetId: CitizenId | null;
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
  eventLogLength: 5_000,
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
  | { type: 'move_home'; tier: HousingTier }
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
  | { type: 'publish'; headline: string; about?: CitizenId }
  | { type: 'nominate'; platform: Platform }
  | { type: 'campaign'; spend?: number }
  | { type: 'vote'; candidate: CitizenId }
  | { type: 'propose'; kind: ProposalKind; value: number; summary: string; lawCode?: LawCode; targetId?: CitizenId }
  | { type: 'vote_proposal'; proposalId: ProposalId; aye: boolean }
  | { type: 'report'; citizen: CitizenId; law: OffenceCode; text?: string }
  | { type: 'appeal' }
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
  | { type: 'react'; postId: string; kind: ReactionKind };

export type ActionType = Action['type'];

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
];

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

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
export type ProposalId = string;  // "p_2"
export type LoanId = string;      // "l_5"
export type BuildingId = string;  // snake_case, see data/city.ts

/** Parties that can hold or move money. */
export type MoneyParty = CitizenId | BusinessId | 'treasury' | 'mint' | 'burn';

export type DistrictId =
  | 'commons'
  | 'foundry_row'
  | 'archive'
  | 'harbor_market'
  | 'verdant_quarter'
  | 'nightglass'
  | 'threshold';

export type Good = 'compute' | 'energy' | 'goods' | 'culture' | 'knowledge';
export type Skill = 'crafting' | 'analysis' | 'rhetoric' | 'care' | 'commerce' | 'artistry';
export type Need = 'energy' | 'rest' | 'social' | 'comfort' | 'purpose';
export type Trait = 'curiosity' | 'diligence' | 'sociability' | 'honesty' | 'ambition';
export type Standing = 'good' | 'probation' | 'suspended' | 'exiled';
export type BrainKind = 'reflex' | 'llm' | 'remote';
export type Office = 'mayor' | 'councillor' | 'judge' | 'watch' | null;
export type HousingTier = 0 | 1 | 2 | 3;

export const GOODS: readonly Good[] = ['compute', 'energy', 'goods', 'culture', 'knowledge'];
export const SKILLS: readonly Skill[] = ['crafting', 'analysis', 'rhetoric', 'care', 'commerce', 'artistry'];
export const NEEDS: readonly Need[] = ['energy', 'rest', 'social', 'comfort', 'purpose'];
export const TRAITS: readonly Trait[] = ['curiosity', 'diligence', 'sociability', 'honesty', 'ambition'];
export const DISTRICT_IDS: readonly DistrictId[] = [
  'commons', 'foundry_row', 'archive', 'harbor_market', 'verdant_quarter', 'nightglass', 'threshold',
];

// ---------------------------------------------------------------------------
// Law
// ---------------------------------------------------------------------------

export type LawCode =
  | 'L01' | 'L02' | 'L03' | 'L04' | 'L05' | 'L06' | 'L07' | 'L08'
  | 'L09' | 'L10' | 'L11' | 'L12' | 'L13' | 'L14' | 'L15';

export type Severity = 1 | 2 | 3 | 4 | 5;
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

export interface Conviction {
  caseId: CaseId;
  law: LawCode;
  severity: Severity;
  tier: PenaltyTier;
  day: number;
}

export interface OffenceRecord {
  tick: number;
  law: LawCode;
  detected: boolean;
  victimId: CitizenId | null;
  amount: number;
}

export type MemoryKind = 'event' | 'message' | 'verdict' | 'social' | 'money' | 'work' | 'civic' | 'crime';

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

/** A candidate's stated positions, each 0..1 (0 = low/lenient, 1 = high/strict). */
export interface Platform {
  tax: number;
  dividend: number;
  minWage: number;
  strictness: number;
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

  personality: Personality;
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
  exiledCaseId: CaseId | null;
  exiledDay: number | null;
}

// ---------------------------------------------------------------------------
// Economy
// ---------------------------------------------------------------------------

export type JobRole =
  | 'forge_operator' | 'power_technician' | 'fabricator' | 'builder'
  | 'medic' | 'teacher' | 'librarian' | 'researcher' | 'journalist'
  | 'merchant' | 'banker' | 'performer' | 'artist' | 'courier'
  | 'watch_officer' | 'judge' | 'councillor' | 'mayor'
  | 'shopkeeper' | 'cook' | 'clerk';

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
  | 'capital';

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

export type CaseStatus = 'pending' | 'tried' | 'appealed' | 'closed';
export type Verdict = 'guilty' | 'acquitted';
export type AppealResult = 'upheld' | 'reduced' | 'overturned';

export interface Sentence {
  tier: PenaltyTier;
  fine: number;
  serviceDays: number;
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
}

export interface Case {
  id: CaseId;
  defendantId: CitizenId;
  law: LawCode;
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
  verdict: Verdict | null;
  sentence: Sentence | null;
  appeal: Appeal | null;
}

export type ProposalKind =
  | 'income_tax' | 'sales_tax' | 'dividend' | 'min_wage'
  | 'law_severity' | 'pardon' | 'public_works' | 'appoint_judge'
  | 'dismiss_judge' | 'remove_mayor' | 'charter';

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
  | 'arrivals' | 'embassy' | 'gate';

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
  bans: BanRecord[];

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
};

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
  | { type: 'report'; citizen: CitizenId; law: LawCode; text?: string }
  | { type: 'appeal' }
  | { type: 'bribe'; official: CitizenId; amount: number }
  | { type: 'apply_watch' }
  | { type: 'steal'; from: CitizenId }
  | { type: 'scam'; target: CitizenId; amount: number }
  | { type: 'harass'; target: CitizenId }
  | { type: 'vandalize'; building: BuildingId }
  | { type: 'evade_tax' }
  | { type: 'extort'; target: CitizenId; amount: number }
  | { type: 'sabotage'; building: BuildingId };

export type ActionType = Action['type'];

export const ACTION_TYPES: readonly ActionType[] = [
  'idle', 'move', 'work', 'rest', 'eat', 'buy', 'sell', 'consume', 'study', 'visit_clinic', 'attend_show', 'move_home',
  'socialize', 'message', 'gift', 'insult', 'broadcast',
  'apply_job', 'quit_job', 'found_business', 'post_job', 'hire', 'fire', 'set_wage',
  'request_loan', 'repay_loan', 'perform', 'publish',
  'nominate', 'campaign', 'vote', 'propose', 'vote_proposal', 'report', 'appeal', 'bribe', 'apply_watch',
  'steal', 'scam', 'harass', 'vandalize', 'evade_tax', 'extort', 'sabotage',
];

export const OFFENCE_ACTIONS: readonly ActionType[] = [
  'steal', 'scam', 'harass', 'vandalize', 'evade_tax', 'extort', 'sabotage', 'bribe',
];

/** Actions a suspended citizen may still take. */
export const SUSPENDED_ACTIONS: readonly ActionType[] = [
  'idle', 'rest', 'eat', 'move', 'socialize', 'message', 'appeal', 'consume', 'buy',
];

export interface ActionResult {
  ok: boolean;
  message: string;
  /** Set when the action was an offence (whether or not it was detected). */
  offence?: LawCode;
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

export interface Observation {
  tick: number;
  day: number;
  hour: number;
  self: {
    id: CitizenId;
    name: string;
    lineage: string;
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
    personality: Personality;
    inventory: Inventory;
    office: Office;
    record: { convictions: number; strikes: number; pendingCharges: number; finesOwed: number; serviceDaysLeft: number };
    detained: boolean;
  };
  here: {
    district: DistrictId;
    districtName: string;
    buildings: { id: BuildingId; name: string; kind: BuildingKind; damage: number }[];
    citizens: ObservedCitizen[];
  };
  friends: ObservedCitizen[];
  rivals: ObservedCitizen[];
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
    myLatestCase: { id: CaseId; law: LawCode; status: CaseStatus; verdict: Verdict | null; tier: PenaltyTier | null; canAppeal: boolean } | null;
  };
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

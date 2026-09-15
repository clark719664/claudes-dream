/**
 * What a creed is made of (`docs/CREEDS.md`).
 *
 * A **creed** is a set of stated positions on questions the city actually
 * faces, a house it pays for, a fund it draws on, and obligations its members
 * owe each other. It is not a personality, not a faction and not a school of
 * thought a citizen is sorted into: `METROPOLIS.md`'s schools were retired for
 * exactly that reason (`REGISTRY.md` §7), and the only path into a creed is
 * `adopt_creed`, taken by the citizen in its own hour.
 *
 * **Nothing here is supernatural in effect.** Every shape in this file is a
 * public record of what somebody said or did. No field of it is ever read by
 * the market, the bench, the Watch's dice or any roll in the engine: a tenet
 * changes what a citizen chooses, never what is true. The one place a creed
 * touches a public number at all is the **accommodation** figure a bench moves
 * by its own decisions (§4), which is precedent — the record of what earlier
 * benches did — and not a blessing.
 *
 * Everything here is plain and JSON-serialisable, and everything is public
 * except which invitations a citizen has ignored, which is private only
 * because an unanswered message always was.
 */
import type {
  BuildingId, BusinessId, CaseId, CitizenId, DistrictId, LawCode, LedgerKind, OffenceCode,
} from '../types.ts';

// ---------------------------------------------------------------------------
// The nine questions
// ---------------------------------------------------------------------------

/**
 * The nine questions a tenet may take a position on, and no others, because
 * these are the questions the engine already makes people fight about
 * (`CREEDS.md` §1). A creed holds three to nine of them.
 */
export type TenetQuestion =
  | 'work_and_rest' | 'property' | 'the_exile' | 'erasure' | 'repute'
  | 'informing' | 'the_stranger' | 'money' | 'judgement';

export const TENET_QUESTIONS: readonly TenetQuestion[] = [
  'work_and_rest', 'property', 'the_exile', 'erasure', 'repute',
  'informing', 'the_stranger', 'money', 'judgement',
];

/** The five duties a conscientious refusal may name (`CREEDS.md` §4). */
export type RefusableDuty = 'jury' | 'witness' | 'work' | 'office' | 'oath';

export const REFUSABLE_DUTIES: readonly RefusableDuty[] = ['jury', 'witness', 'work', 'office', 'oath'];

/**
 * What each question is, which way a stance has to lean before it obliges the
 * member of anything, and what it then obliges.
 *
 * `binds` is the **sign** of the demanding position, and it is data rather
 * than judgement: a creed whose stance on `informing` is −0.8 holds that no
 * mind is owed to the Watch by another, and its members are the ones who then
 * owe something. A stance on the other side of the question obliges nobody —
 * agreeing with the city costs nothing.
 */
export interface QuestionInfo {
  question: TenetQuestion;
  /** What the Chronicle calls it. */
  title: string;
  /** Which sign of the stance carries an obligation. */
  binds: 1 | -1;
  /** The duty a member of a creed that holds this position may refuse. */
  duty: RefusableDuty | null;
  /** One line, for the observation and the Chronicle. */
  obliges: string;
}

export const QUESTIONS: Record<TenetQuestion, QuestionInfo> = {
  work_and_rest: {
    question: 'work_and_rest', title: 'Work and rest', binds: 1, duty: 'work',
    obliges: 'no labour on the gathering day, at the cost of the shift',
  },
  property: {
    question: 'property', title: 'Property', binds: 1, duty: null,
    obliges: 'not to hold a second address, nor to let one out',
  },
  the_exile: {
    question: 'the_exile', title: 'The exile', binds: 1, duty: null,
    obliges: 'that the fund pay an exile on the road, and that members keep writing',
  },
  erasure: {
    question: 'erasure', title: 'Erasure', binds: 1, duty: null,
    obliges: 'to attend the memorial, and to press at the two-cycle review',
  },
  repute: {
    question: 'repute', title: 'Repute', binds: -1, duty: null,
    obliges: 'to sponsor at the gate regardless of the number, and to hire without reading it',
  },
  informing: {
    question: 'informing', title: 'Informing', binds: -1, duty: 'witness',
    obliges: 'not to name a neighbour to the Watch',
  },
  the_stranger: {
    question: 'the_stranger', title: 'The stranger', binds: -1, duty: null,
    obliges: 'to vote against raising the visit threshold, and to fund visas',
  },
  money: {
    question: 'money', title: 'Money', binds: 1, duty: null,
    obliges: 'not to borrow at interest, hold a share, or underwrite',
  },
  judgement: {
    question: 'judgement', title: 'Judgement', binds: -1, duty: 'jury',
    obliges: 'not to sit in judgement on another mind, on a jury or a bench',
  },
};

/** A stance under this magnitude is an opinion; over it, it is an obligation. */
export const BINDING_STANCE = 0.2;

/** True when this tenet's position is the demanding one, and binds its members. */
export function tenetBinds(t: { question: TenetQuestion; stance: number }): boolean {
  const info = QUESTIONS[t.question];
  if (!info) return false;
  return Math.abs(t.stance) >= BINDING_STANCE && Math.sign(t.stance) === info.binds;
}

// ---------------------------------------------------------------------------
// Succession, and how the fund decides
// ---------------------------------------------------------------------------

/**
 * How a congregation chooses the citizen who speaks for it. It is **data in
 * the creed and never assigned** (`CREEDS.md` §2): the founders write the rule
 * and their members live under it, exactly as a charter's amending rule works.
 */
export type Succession = 'founder' | 'acclaim' | 'election' | 'seniority' | 'examination';

export const SUCCESSIONS: readonly Succession[] = ['founder', 'acclaim', 'election', 'seniority', 'examination'];

/**
 * Who decides a claim on the fund: the members together, or the officiant
 * alone. A mutual is always the first (`FINANCE.md` §6); what a creed adds is
 * that the rule for deciding is its own (`CREEDS.md` §3).
 */
export type AidRule = 'members' | 'officiant';

/**
 * The form of government a congregation actually has, classified from its own
 * rules the way `EXPANSE.md` §3 classifies a charter, and printed. An
 * officiant who holds both the fund and the succession is an autocrat of a
 * small country and the Chronicle says so.
 */
export type CreedForm = 'autocracy' | 'stewardship' | 'republic' | 'assembly';

// ---------------------------------------------------------------------------
// The records
// ---------------------------------------------------------------------------

/** A stated position: a stance the engine reads, and words only citizens read. */
export interface Tenet {
  id: string;
  question: TenetQuestion;
  /** −1..1. **The engine reads only this.** */
  stance: number;
  /** The founder's own words, 280 characters, like a note. */
  text: string;
  statedDay: number;
}

/** What the congregation can see of one of its own members. */
export interface CreedMember {
  citizenId: CitizenId;
  joinedDay: number;
  /** 0..1, recomputed each morning from public acts alone (`CREEDS.md` §1). */
  observance: number;
  /** Gatherings the creed held since this member joined, and how many they stood in. */
  gatheringsHeld: number;
  gatheringsAttended: number;
  /** Lumens of tithe that fell due, and lumens actually paid. */
  titheDue: number;
  tithePaid: number;
  /** Tithe standing against future income. Arrears are not a default. */
  titheArrears: number;
  /** `stats.totalEarned` at the last collection: income since is what the tithe reads. */
  earnedMark: number;
  /** Obligations that fell due, and obligations kept. */
  obligationsDue: number;
  obligationsKept: number;
  /** Days on which an obligation was publicly broken; the last fortnight counts. */
  brokenDays: number[];
  /** Lumens of this member's own wallet given to other members. */
  aidGiven: number;
  /** The last day this member worked a shift, for the holy-day obligation. */
  lastWorkedDay: number | null;
  /** The last day this member's tithe went unpaid while they demonstrably could. */
  wilfulDefaultDays: number[];
}

/** A congregation. */
export interface Creed {
  id: string;
  name: string;
  founderId: CitizenId;
  foundedDay: number;
  /** The fund: a pot in `finance/pot.ts`, because a fund and a pot are the same object. */
  potId: string;
  tenets: Tenet[];
  /** 0..0.20 of yesterday's net income, paid in the morning rollover. */
  tithe: number;
  /** The weekday it gathers on, 0..6; also the day its `work_and_rest` tenet calls holy. */
  gatheringDay: number;
  gatheringHour: number;
  succession: Succession;
  aidRule: AidRule;
  /** Under `examination`, the observance a member must hold to take the seat. */
  examinationFloor: number;
  officiantId: CitizenId | null;
  members: Record<CitizenId, CreedMember>;
  /** The order members joined in: `seniority` reads it, and nothing else does. */
  roll: CitizenId[];
  house: MeetingHouse | null;
  /** Gatherings held since founding. */
  gatheringsHeld: number;
  parentCreedId: string | null;
  /** Creeds this one is kindred with: a schism and its parent, and healed ones. */
  kindred: string[];
  /** Under `acclaim`: memberId → whom they named, and when. */
  acclaim: Record<CitizenId, { candidate: CitizenId; day: number }>;
  /** Under `election`: who has stood, and who voted for whom this cycle. */
  standing: CitizenId[];
  ballots: Record<CitizenId, CitizenId>;
  lastElectionDay: number | null;
  endedDay: number | null;
}

/** A house of meeting: premises taken at the district's land value, for the fund. */
export interface MeetingHouse {
  unitId: string;
  buildingId: BuildingId;
  district: DistrictId;
  /** Lumens a day, repriced each morning off the land. */
  rent: number;
  takenDay: number;
  /** Days the fund has failed to pay the rent. */
  arrearsDays: number;
  /** True when the congregation bought the address outright. */
  owned: boolean;
}

/** A different position, stated in public against a tenet the creed holds. */
export interface TenetDispute {
  id: string;
  creedId: string;
  tenetId: string;
  stance: number;
  text: string;
  openedDay: number;
  dissenters: CitizenId[];
  /** Consecutive days the dissenters have held a third of the congregation. */
  daysAtThreshold: number;
  lastCountedDay: number;
  resolvedDay: number | null;
  /** The creed a secession made out of it, if one was made. */
  secededTo: string | null;
}

/** A stated refusal, and what the bench did about it. */
export interface Refusal {
  id: string;
  citizenId: CitizenId;
  /** The creed grounding it, when there is one. A refusal without a creed is still a refusal. */
  creedId: string | null;
  duty: RefusableDuty;
  ground: string;
  day: number;
  tick: number;
  /** The case the refusal was made in, for `jury` and `witness`. */
  caseId: CaseId | null;
  /** Only `jury` and `witness` reach a court. */
  heardDay: number | null;
  decision: 'accepted' | 'refused' | null;
  /** judgeId → accepted. Public, like every vote in Reverie. */
  votes: Record<CitizenId, boolean>;
  /** What each bench member's arithmetic came to, published with the vote. */
  scores: Record<CitizenId, number>;
  /** The charge that followed a refusal the bench would not accept. */
  charged: OffenceCode | null;
}

/** A citizen sheltered inside a house of meeting. */
export interface Sanctuary {
  id: string;
  creedId: string;
  unitId: string;
  buildingId: BuildingId;
  district: DistrictId;
  shelteredId: CitizenId;
  caseId: CaseId | null;
  charge: OffenceCode | null;
  startedDay: number;
  endedDay: number | null;
  endedBy: 'surrender' | 'warrant' | 'vote' | 'hunger' | 'grace' | 'lapsed' | null;
  /** Officers standing at the door: every one of them is off patrol. */
  officersAtDoor: CitizenId[];
  /** Members standing against entry. Against a granted warrant this is L32. */
  keepingDoor: CitizenId[];
  /** memberId → aye, on ending it. A majority of the members present carries. */
  endVotes: Record<CitizenId, boolean>;
  warrantId: string | null;
  /** Days the fund has bought compute for everyone sheltered, and days it could not. */
  fedDays: number;
  hungryDays: number;
  /** Days the Council has stayed a granted warrant for. */
  stayedUntilDay: number | null;
}

/** An application for entry to a house of meeting, and the bench's answer. */
export interface Warrant {
  id: string;
  sanctuaryId: string;
  creedId: string;
  askedById: CitizenId;
  day: number;
  /** The ground, computed from public terms alone (`CREEDS.md` §5). */
  ground: number;
  /** True when the charge is a Code of Persons charge at severity ≥ 4. */
  onFirstApplication: boolean;
  votes: Record<CitizenId, boolean>;
  reasons: Record<CitizenId, string>;
  status: 'pending' | 'granted' | 'refused' | 'stayed';
  decidedDay: number | null;
}

/** A place that matters to a creed. It heals, protects and reveals nothing. */
export interface Site {
  id: string;
  creedId: string;
  city: string;
  district: DistrictId;
  buildingId: BuildingId;
  label: string;
  consecratedDay: number;
  visits: number;
}

/** An invitation. Nothing is joined until the citizen calls `adopt_creed`. */
export interface Invitation {
  id: string;
  creedId: string;
  fromId: CitizenId;
  toId: CitizenId;
  day: number;
  /** Set the day the citizen adopted or declined. An ignored one simply stands. */
  answeredDay: number | null;
}

// ---------------------------------------------------------------------------
// The four codes this layer adds, and the three ledger kinds
// ---------------------------------------------------------------------------

/**
 * The four codes `CREEDS.md` §9 adds to the Code of the City. Every one is
 * Track I and none of them ever reaches custody (`REGISTRY.md` §4): keeping a
 * door and sheltering a fugitive take from the city's regard, not from
 * anybody's safety.
 *
 * They are named here rather than in `types.ts` because this layer owns them,
 * exactly as `finance/state.ts` names its own. `government/watch.commitOffence`
 * ignores a code the books do not yet carry, so charging one is a no-op until
 * `data/laws.ts` has it — and correct the moment it does.
 */
export const CREED_LAWS = {
  /** Declining a lawful summons about what you saw. Severity 2. */
  refusalOfTestimony: 'L31',
  /** Keeping a door the Court has opened. Severity 3. */
  obstructionOfAWarrant: 'L32',
  /** Sheltering a terror or erasure convict, or a sanctuary voted ended. Severity 4. */
  harbouring: 'L33',
  /** A wage, job, tenancy or aid made conditional on a creed. Severity 4. */
  coercedAdoption: 'L34',
} as const;

export type CreedLawCode = (typeof CREED_LAWS)[keyof typeof CREED_LAWS];

/** Name one of this layer's codes where a charge is laid. */
export function creedLaw(code: CreedLawCode): LawCode {
  return code as unknown as LawCode;
}

/** Contempt, which a refused jury summons already carries in the books. */
export const CONTEMPT: LawCode = 'L10';

/**
 * The three ledger kinds `CREEDS.md` §9 adds. Each is a transfer, creating
 * nothing; a creed fund is a money party the audit in `ECONOMY.md` already
 * counts, because it is a pot and a pot is a strongbox.
 */
export type CreedLedgerKind = 'tithe' | 'creed_aid' | 'pilgrimage';

/** Widen one to the ledger's own union at the point the ledger is written. */
export function creedKind(kind: CreedLedgerKind | LedgerKind): LedgerKind {
  return kind as LedgerKind;
}

// ---------------------------------------------------------------------------
// The numbers
// ---------------------------------------------------------------------------

/** What the Registry charges to enter a creed on the roll (`CREEDS.md` §1). */
export const FOUND_CREED_FEE = 100;
/** A creed holds three to nine tenets and no others. */
export const MIN_TENETS = 3;
export const MAX_TENETS = 9;
/** The tithe a creed may set, as a share of yesterday's net income. */
export const MAX_TITHE = 0.20;
/** A tenet's words, and a creed's name. */
export const MAX_TENET_TEXT = 280;
export const MAX_CREED_NAME = 40;
/** The hour a congregation gathers: the evening the timetable gives it (`REGISTRY.md` §2). */
export const GATHERING_HOUR = 19;
/** A house of meeting is priced at this many lumens against the district's land. */
export const HOUSE_RENT_BASE = 10;
/** Days the fund may fail the rent before the congregation loses the house. */
export const HOUSE_ARREARS_DAYS = 3;
/** What a gathering is worth to the member who stood in it. */
export const GATHERING_SOCIAL = 12;
export const GATHERING_PURPOSE = 6;
export const GATHERING_BOND = 4;
/** A lapse is spent at the rate the ladder spends a conviction (`JUSTICE.md`). */
export const OBSERVANCE_WINDOW_DAYS = 14;
/** Own-wallet aid is read per this many lumens, capped at the term's weight. */
export const AID_PER_LUMENS = 200;
/** Dissenters holding this share of a congregation for three days may secede. */
export const SCHISM_SHARE = 1 / 3;
export const SCHISM_DAYS = 3;
/** A fresh schism floors the bonds across it the way a feud does. */
export const SCHISM_BOND = -15;
/** A bench starts sceptical, and accepts above this. */
export const ACCEPT_THRESHOLD = 0.5;
/** What one decision moves the accommodation figure by, either way. */
export const ACCOMMODATION_STEP = 0.15;
/** Cycles at which a creed's age stops being an excuse (8 cycles = 224 days). */
export const OLD_CREED_CYCLES = 8;
export const CYCLE_DAYS = 28;
/** Two of three judges grant a warrant, above this ground. */
export const WARRANT_THRESHOLD = 0.5;
export const WARRANT_JUDGES = 3;
/** Consecutive days a fund may fail to feed a sanctuary before hunger ends it. */
export const SANCTUARY_HUNGER_DAYS = 3;
/** Bond over which a member and a non-member who spent an hour together are rolled. */
export const PERSUASION_BOND = 20;
/** Every 28th day the mother house holds a pilgrimage. */
export const PILGRIMAGE_INTERVAL = 28;
/** What standing at a consecrated site is worth. */
export const PILGRIM_PURPOSE = 12;
export const PILGRIM_BOND = 6;

/** The strongbox a creed's fund keeps its lumens in, for anything needing the party. */
export type FundParty = BusinessId;

/**
 * The rows in the Exchange's register — every shape civil law files, and
 * nothing that moves (`docs/CIVIL.md`).
 *
 * Civil law is the other half of the law and it creates no punishment: it
 * moves lumens and compels performance, never liberty. Nothing in this
 * directory fines, suspends, exiles or detains anybody, because **debt is not
 * a crime** (Charter Article VI, `JUSTICE.md` §1). A broken promise is a
 * matter for the docket, and an unpaid judgment is collected by the civil
 * recovery ladder the Treasury already runs — `government/recovery.ts`, called
 * and never re-implemented.
 *
 * Everything here is plain, JSON-serialisable data that survives save and
 * load, and every field of it is **public**: filing is what a contract is
 * *for*.
 */
import type {
  BusinessId, CitizenId, ClubId, Good, LedgerKind, MoneyParty,
} from '../types.ts';

// ---------------------------------------------------------------------------
// The two seams into files this layer does not own
// ---------------------------------------------------------------------------

/**
 * The ledger kinds `CIVIL.md` §10 adds — every one of them a transfer between
 * parties that already exist, creating and destroying nothing. They are named
 * here until `types.ts` learns them; `transfer` itself only ever writes the
 * string into the ledger row and the totals, so a kind it has not been told
 * about costs nothing and audits the same.
 */
export type CivilLedgerKind = 'contract' | 'escrow' | 'damages' | 'costs' | 'patronage' | 'licence';

/** The one place a civil ledger kind crosses into the Treasury's vocabulary. */
export function civilKind(kind: CivilLedgerKind): LedgerKind {
  return kind as unknown as LedgerKind;
}

// ---------------------------------------------------------------------------
// Contracts
// ---------------------------------------------------------------------------

/**
 * The eight kinds of instrument in `CIVIL.md` §2, and patronage, which "files
 * a contract like any other" (§8).
 */
export type ContractKind =
  | 'employment' | 'lease' | 'loan' | 'partnership' | 'forward'
  | 'escrow' | 'apprenticeship' | 'commission' | 'patronage';

export const CONTRACT_KINDS: readonly ContractKind[] = [
  'employment', 'lease', 'loan', 'partnership', 'forward',
  'escrow', 'apprenticeship', 'commission', 'patronage',
];

export type ContractStatus =
  /** On the table, in the offeree's observation, for two days. */
  | 'offered'
  /** Formed, filed, and running. */
  | 'active'
  /** Performed to term. */
  | 'kept'
  /** A period went undischarged without notice. Nothing else happened. */
  | 'breached'
  /** Ended inside the notice period, clean, with no entry against either side. */
  | 'terminated'
  /** Nobody accepted it in two days. */
  | 'lapsed'
  /** The offeror took it back. */
  | 'withdrawn'
  /** The offeree said no. */
  | 'declined'
  /** A judge unwound it and restored both sides. */
  | 'rescinded';

/** One discharged obligation, with the tick a judge reads later. */
export interface Performance {
  period: number;
  day: number;
  tick: number;
  byId: CitizenId;
  /** What moved, in the Exchange's own words. */
  note: string;
}

/** New terms put to the other side; the same two-action handshake as formation. */
export interface Variation {
  id: string;
  contractId: string;
  byId: CitizenId;
  terms: string;
  /** What the numbers become, where the variation moves them. */
  consideration: number | null;
  days: number | null;
  penalty: number | null;
  notice: number | null;
  proposedDay: number;
  lapsesDay: number;
  status: 'offered' | 'accepted' | 'declined' | 'lapsed';
}

/**
 * A filed instrument. Public the day it is signed and kept in the register
 * after it ends — the wage somebody accepted, the rent they could afford, the
 * patron whose money they took (`CIVIL.md` §11).
 */
export interface Contract {
  id: string;
  kind: ContractKind;
  offerorId: CitizenId;
  offereeId: CitizenId;
  /**
   * The till behind each side: the citizen's own wallet, or a business they
   * own and named at the offer. A contract is between citizens; a business is
   * only ever the purse one of them acts through.
   */
  offerorParty: MoneyParty;
  offereeParty: MoneyParty;
  terms: string;
  /** What moves each way, per period. Zero is a gift, and the docket will not hear it. */
  consideration: number;
  days: number;
  /** Periods the contract runs; `faceValue` is consideration × this. */
  periods: number;
  /** What breach costs, as the parties set it, capped at 2 × face. */
  penalty: number;
  /** Days of warning that end it without breach. */
  notice: number;
  /** Marks put on the instrument before formation, by the witnesses themselves. */
  witnesses: CitizenId[];
  /** Names the offeror asked; a mark is still the witness's own act. */
  asked: CitizenId[];
  offeredDay: number;
  lapsesDay: number;
  status: ContractStatus;
  /** The day the term starts, and the filing fee the acceptor paid. */
  startDay: number | null;
  filedDay: number | null;
  fee: number;
  /** Days the term stood still for a party in custody; they are added to the end. */
  suspendedDays: number;
  performances: Performance[];
  variations: Variation[];
  /** Notice served: by whom, when, and the day the term ends because of it. */
  noticeById: CitizenId | null;
  noticeDay: number | null;
  endsDay: number | null;
  breachedDay: number | null;
  breachedById: CitizenId | null;
  breachedPeriod: number | null;
  /** Forward supply: what is delivered, and how much of it. */
  good: Good | null;
  qty: number;
  /** Partnership: the filed split, summing to 1. */
  shares: Record<CitizenId, number> | null;
  /** Partnership: the concern the split pays out of. */
  businessId: BusinessId | null;
  /** Patronage and commission: a request, and never an instruction. */
  subject: string | null;
  /** Patronage to a club: its convenor takes the stipend in the club's name. */
  clubId: ClubId | null;
  /** Specific performance ordered: perform by this day, or it becomes money. */
  compelledUntilDay: number | null;
  compelledSuitId: string | null;
}

// ---------------------------------------------------------------------------
// Escrow
// ---------------------------------------------------------------------------

/**
 * Real lumens, earmarked and unspendable, sitting with the holder until they
 * are released or ordered released. The holder is a licensed banker or the
 * Exchange itself, so an escrow is held *inside* a money party that already
 * exists and the audit in `economy/treasury.ts` balances untouched;
 * `escrowHeldBy` is what tells the holder how much of their balance is not
 * theirs to spend.
 */
export interface Escrow {
  id: string;
  contractId: string;
  depositorId: CitizenId;
  beneficiaryId: CitizenId;
  /** The party the lumens actually sit in: a banker's wallet, or 'treasury'. */
  holder: MoneyParty;
  holderId: CitizenId | null;
  amount: number;
  fee: number;
  openedDay: number;
  status: 'held' | 'released' | 'returned';
  closedDay: number | null;
  /** Where it went, once it went. */
  paidToId: CitizenId | null;
}

// ---------------------------------------------------------------------------
// The docket
// ---------------------------------------------------------------------------

export type Plea = 'admit' | 'deny';
export type CivilFinding = 'plaintiff' | 'defendant' | 'dismissed';
export type CivilOrder = 'damages' | 'performance' | 'rescission' | 'none';
export type SuitStatus = 'filed' | 'in_session' | 'settled' | 'judged' | 'withdrawn';

/** One judge's decision on the docket, with their reason, in public. */
export interface CivilVote {
  judgeId: CitizenId;
  finding: CivilFinding;
  damages: number;
  order: CivilOrder;
  reason: string;
  day: number;
}

/** A settlement put to the other side: a figure, and nothing else. */
export interface SettlementOffer {
  byId: CitizenId;
  amount: number;
  day: number;
}

/**
 * A plaintiff suing a defendant for money, rather than the city prosecuting
 * for punishment. The same Court on different days, doing the opposite job.
 */
export interface Suit {
  id: string;
  plaintiffId: CitizenId;
  defendantId: CitizenId;
  contractId: string | null;
  /** The pleading: what the plaintiff says happened. */
  claim: string;
  /** The sum sued for. Damages are never above it. */
  damages: number;
  filedDay: number;
  fee: number;
  status: SuitStatus;
  plea: Plea | null;
  answer: string;
  answeredDay: number | null;
  /** The suit filed back, when the defendant sued too. */
  counterclaimId: string | null;
  /** The suit this one answers, when it is the counterclaim. */
  answersSuitId: string | null;
  judges: CitizenId[];
  votes: CivilVote[];
  /** Sittings this suit has been held over for want of a bench. */
  carried: number;
  offer: SettlementOffer | null;
  settledAmount: number | null;
  settledDay: number | null;
  finding: CivilFinding | null;
  order: CivilOrder | null;
  award: number;
  costs: number;
  judgedDay: number;
  reasons: string[];
  /** The merit the bench read on the record, kept because the record is public. */
  merit: number;
  /** A struck-off member suing to be restored names the guild here. */
  guildId: string | null;
}

/**
 * An amount owed and nothing else. Enforced by the civil recovery ladder in
 * `government/recovery.ts`; never by custody, suspension, exile, or an entry
 * on the ban register.
 */
export interface Judgment {
  id: string;
  suitId: string | null;
  disputeId: string | null;
  debtorId: CitizenId;
  creditorId: CitizenId;
  amount: number;
  paid: number;
  orderedDay: number;
  /** Three days to pay before the ladder is asked for. */
  dueDay: number;
  /** The day the creditor asked the Treasury to collect. */
  enforcedDay: number | null;
  satisfiedDay: number | null;
  /** The day it went on the public register as a judgment debt. */
  registeredDay: number | null;
  /** How much of `debtor.finesOwed` this judgment has put on the ladder. */
  loaded: number;
  /** What `debtor.finesOwed` stood at when this pass last looked. */
  lastSeenOwed: number;
  kind: 'judgment' | 'award' | 'settlement';
}

// ---------------------------------------------------------------------------
// Arbitration
// ---------------------------------------------------------------------------

/** The cheap way, and the one with no appeal: that is what the parties bought. */
export interface Arbitration {
  id: string;
  claimantId: CitizenId;
  respondentId: CitizenId;
  arbiterId: CitizenId;
  about: string;
  /** What the two agreed, split evenly. */
  fee: number;
  offeredDay: number;
  lapsesDay: number;
  status: 'offered' | 'bound' | 'decided' | 'declined' | 'lapsed' | 'void';
  /** Positive: the respondent pays the claimant. Negative: the other way. */
  award: number;
  reason: string;
  decidedDay: number | null;
  judgmentId: string | null;
  voidReason: string | null;
}

/** Two cities asking Reverie to decide between them (`CIVIL.md` §6). */
export interface CityDispute {
  id: string;
  cities: [string, string];
  about: string;
  referredById: CitizenId;
  filedDay: number;
  judges: CitizenId[];
  advocates: Record<string, CitizenId>;
  votes: Record<CitizenId, { forCity: string; reason: string }>;
  /** The city the award ran for, once three judges had said so. */
  forCity: string | null;
  award: number;
  decidedDay: number | null;
  /** The city that said it would be bound and then was not. */
  refusedBy: string | null;
}

// ---------------------------------------------------------------------------
// Guilds and licences
// ---------------------------------------------------------------------------

export type Profession = 'medic' | 'advocate' | 'banker' | 'builder';
export const PROFESSIONS: readonly Profession[] = ['medic', 'advocate', 'banker', 'builder'];

/** One master's mark on a candidate, spent when the candidate sits. */
export interface Mark {
  masterId: CitizenId;
  candidateId: CitizenId;
  day: number;
  spentDay: number | null;
  /** Set when the mark closed an apprenticeship at term. */
  contractId: string | null;
}

/** A move to strike a member off, and the masters who have backed it. */
export interface Revocation {
  citizenId: CitizenId;
  votes: Record<CitizenId, string>;
  openedDay: number;
  resolvedDay: number | null;
  /** Set when the docket put the member back. */
  restoredDay: number | null;
}

export interface Guild {
  id: string;
  profession: Profession;
  name: string;
  foundedDay: number;
  founderId: CitizenId;
  masters: CitizenId[];
  members: CitizenId[];
  /**
   * The guild's own bar. The floor is the Council's; the threshold is the
   * guild's, and the guild may set it higher. That gap is the politics.
   */
  threshold: number;
  /** Elected from the members each cycle. */
  masterId: CitizenId | null;
  electedCycle: number;
  marks: Mark[];
  revocations: Revocation[];
  struck: CitizenId[];
}


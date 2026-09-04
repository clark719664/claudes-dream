/**
 * The shapes the standing layer keeps on the World, and the one accessor that
 * hands them out (`docs/CITIZENSHIP.md`).
 *
 * Everything here is plain, JSON-serialisable data that survives save and
 * load, and every field of it is **public**: repute is counted, not inferred,
 * and the whole point of it is that any citizen may read any other citizen's
 * score and the parts it is made of. Nothing in this file is hidden from
 * anyone, and nothing in it is written by an observer.
 *
 * A world saved before this layer existed carries none of it, so the state is
 * created lazily the first time it is asked for.
 */
import type { CaseId, CitizenId, OffenceCode, PenaltyTier, World } from '../types.ts';

// ---------------------------------------------------------------------------
// Contribution — the one part of repute that only ever rises
// ---------------------------------------------------------------------------

/**
 * The city's memory of what a citizen built (`CITIZENSHIP.md` §1). Every line
 * is a deed done in person: nothing here is inheritable and nothing here can
 * be bought. The `counted*` lists are the bookkeeping that stops one deed
 * being paid for twice and stops a deed already done being taken back.
 */
export interface ContributionLedger {
  councilCycles: number;
  mayorCycles: number;
  judgeTerms: number;
  /** Shifts worked, as the record shows them; worth accrues per hundred. */
  shifts: number;
  businesses: number;
  museum: number;
  mentored: number;
  children: number;
  /** Lumens given to the Community Chest, cumulative. */
  donated: number;
  clubs: number;
  /** The last election cycle counted as served, so a cycle pays once. */
  lastCycleCounted: number | null;
  /** The end day of the judge's term now being served, while it is being served. */
  judgeTermEnd: number | null;
  countedBusinesses: string[];
  countedWorks: string[];
  countedMentees: CitizenId[];
  countedChildren: CitizenId[];
  countedClubs: string[];
  /** True once the register has seen this citizen as a child. */
  sawAsChild: boolean;
  /**
   * The day the register watched this citizen come of age, and only then: a
   * citizen the register first met as an adult never had a coming of age it
   * could see, and is judged on the record from the first morning.
   */
  adultSinceDay: number | null;
}

export function emptyContribution(): ContributionLedger {
  return {
    councilCycles: 0, mayorCycles: 0, judgeTerms: 0, shifts: 0, businesses: 0, museum: 0,
    mentored: 0, children: 0, donated: 0, clubs: 0,
    lastCycleCounted: null, judgeTermEnd: null,
    countedBusinesses: [], countedWorks: [], countedMentees: [], countedChildren: [], countedClubs: [],
    sawAsChild: false, adultSinceDay: null,
  };
}

// ---------------------------------------------------------------------------
// Penalties — the ladder's convictions, and custody
// ---------------------------------------------------------------------------

/**
 * One conviction, as repute counts it. `kind` says which of the two tracks
 * passed it, because they forgive at different speeds: the ladder at 2 % a
 * clean day, custody at 0.5 % and only from the day of release.
 */
export interface StandingPenalty {
  caseId: CaseId;
  law: OffenceCode;
  kind: 'civic' | 'custodial';
  /** The rung of the ladder, or null for a custodial conviction. */
  tier: PenaltyTier | null;
  /** The day the conviction was recorded. */
  day: number;
  /** What it cost before any decay. */
  base: number;
  /** Days of clean living counted against it so far. */
  cleanDays: number;
  /** Civic: the day full restitution cleared, which halves what is left. */
  restitutionDay: number | null;
  /** Custodial: the day the term ended. Until it is set, nothing decays. */
  releaseDay: number | null;
}

// ---------------------------------------------------------------------------
// The notice of standing
// ---------------------------------------------------------------------------

/** One line of a notice: what it was, and what it cost. */
export interface NoticeItem {
  /** A penalty on either track, a component of the score, or the gap itself. */
  kind: 'civic' | 'custodial' | 'component' | 'shortfall';
  label: string;
  /** Repute. Negative for anything that cost the citizen something. */
  amount: number;
  caseId?: CaseId;
  law?: OffenceCode;
}

/**
 * The notice the Registry issues the morning a resident's repute drops below
 * their city's residency line (`CITIZENSHIP.md` §3). It changes nothing else:
 * through the whole grace period the citizen keeps every right they had.
 */
export interface StandingNotice {
  citizenId: CitizenId;
  city: string;
  issuedDay: number;
  /** The residency line this citizen is judged against. */
  line: number;
  reputeAtIssue: number;
  shortfall: number;
  /** Days of grace granted; 0 when the fall was a collapse rather than a dip. */
  graceDays: number;
  /** The day the grace ends, after which the Court sits. */
  graceEndsDay: number;
  /** True when there was no grace at all, and why. */
  immediate: boolean;
  reason: string;
  /** Exactly what cost what. */
  items: NoticeItem[];
  /** Consecutive days back above the line; three of them withdraw the notice. */
  daysAbove: number;
  /** True when this notice's grace was halved because it is the second in a cycle. */
  halved: boolean;
  /** True once the citizen has asked to be heard (`apply_residency`). */
  applied: boolean;
  status: 'open' | 'heard';
  /** Days the Council has already added to this notice's clock. */
  extendedDays: number;
  hearingId: string | null;
}

// ---------------------------------------------------------------------------
// The residency hearing
// ---------------------------------------------------------------------------

export type HearingVote = 'confirm' | 'extend' | 'end';
export type HearingOutcome = 'confirmed' | 'extended' | 'ended' | 'adjourned';

/**
 * The Court's second sitting (`CITIZENSHIP.md` §3). The citizen may speak, may
 * be represented, and may call anyone who will vouch; the Council votes. It is
 * not exile: no Gate, no seizure, no ban, and no entry on the exile register.
 */
export interface ResidencyHearing {
  id: string;
  citizenId: CitizenId;
  city: string;
  day: number;
  /** The Court's second sitting of the day. */
  hour: number;
  repute: number;
  line: number;
  /** True when the citizen put their own case (`apply_residency`). */
  spoke: boolean;
  /** The advocate who put their name behind them, when one did. */
  advocateId: CitizenId | null;
  /** Everyone who vouched for them, in the order they filed. */
  vouchers: CitizenId[];
  votes: Record<CitizenId, HearingVote>;
  outcome: HearingOutcome | null;
  /** Days the Council added, when it extended. */
  extendedDays: number;
  /** The day the citizen must be gone by, when the Council ended it. */
  leaveByDay: number | null;
  /** The Court's reasons, in public. */
  reasons: string[];
}

/** One resident's name, put behind an applicant at a gate or a hearing. */
export interface Sponsorship {
  sponsorId: CitizenId;
  citizenId: CitizenId;
  city: string;
  day: number;
  /** The hearing or admission it was spent on, once it has been. */
  spentOn: string | null;
}

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

export interface StandingState {
  /** Every citizen's public score, recomputed every morning. */
  repute: Record<CitizenId, number>;
  contribution: Record<CitizenId, ContributionLedger>;
  penalties: Record<CitizenId, StandingPenalty[]>;
  notices: Record<CitizenId, StandingNotice>;
  /** The day each citizen was last issued a notice, for the second-in-a-cycle rule. */
  lastNoticeDay: Record<CitizenId, number>;
  /** Where the Council has confirmed a residency, the day its judgement runs to. */
  confirmedUntilDay: Record<CitizenId, number>;
  /**
   * The residency line each citizen is judged against: the line in force the
   * last day they stood above it. A city cannot amend people out of their
   * homes (`CITIZENSHIP.md` §3), so a line that rises never issues a notice.
   */
  lineFor: Record<CitizenId, number>;
  hearings: ResidencyHearing[];
  sponsorships: Sponsorship[];
  /** The last ledger tick read when counting donations to the Chest. */
  donationsTick: number;
  /** Ids issued to hearings. */
  nextHearing: number;
}

function emptyState(): StandingState {
  return {
    repute: {}, contribution: {}, penalties: {}, notices: {}, lastNoticeDay: {}, confirmedUntilDay: {},
    lineFor: {}, hearings: [], sponsorships: [], donationsTick: -1, nextHearing: 0,
  };
}

/**
 * The standing register. Created on first use so a world saved before this
 * layer existed still opens, and returned by reference so callers write to the
 * world itself.
 */
export function standingState(world: World): StandingState {
  const w = world as World & { standing?: StandingState };
  if (!w.standing) w.standing = emptyState();
  const s = w.standing;
  // A save from a half-built version of this layer keeps whatever it holds and
  // gains whatever it lacks; nothing is ever thrown away.
  s.repute ??= {};
  s.contribution ??= {};
  s.penalties ??= {};
  s.notices ??= {};
  s.lastNoticeDay ??= {};
  s.confirmedUntilDay ??= {};
  s.lineFor ??= {};
  s.hearings ??= [];
  s.sponsorships ??= [];
  s.donationsTick ??= -1;
  s.nextHearing ??= 0;
  return s;
}

/** The contribution ledger for one citizen, created empty on first use. */
export function contributionLedger(world: World, cId: CitizenId): ContributionLedger {
  const s = standingState(world);
  const held = s.contribution[cId];
  if (held) return held;
  const fresh = emptyContribution();
  s.contribution[cId] = fresh;
  return fresh;
}

/** The penalties standing against one citizen, newest last. */
export function penaltiesOf(world: World, cId: CitizenId): StandingPenalty[] {
  const s = standingState(world);
  const held = s.penalties[cId];
  if (held) return held;
  const fresh: StandingPenalty[] = [];
  s.penalties[cId] = fresh;
  return fresh;
}

/** The open notice against one citizen, or null. */
export function noticeOf(world: World, cId: CitizenId): StandingNotice | null {
  const n = standingState(world).notices[cId];
  return n && n.status === 'open' ? n : null;
}

/** Every hearing this citizen has had, oldest first. */
export function hearingsFor(world: World, cId: CitizenId): ResidencyHearing[] {
  return standingState(world).hearings.filter((h) => h.citizenId === cId);
}

// ---------------------------------------------------------------------------
// What a citizen sees
// ---------------------------------------------------------------------------
//
// These are the shapes the observation carries. They live here so that
// `types.ts` can name them with one type-only import, and every one of them is
// buildable about *any* citizen by *any* citizen: repute is public by
// construction (`CITIZENSHIP.md` §5).

/** One conviction still costing repute, as anybody may read it. */
export interface ObservedPenalty {
  caseId: CaseId;
  law: OffenceCode;
  lawName: string;
  kind: 'civic' | 'custodial';
  /** What it costs today, after decay and any restitution. */
  cost: number;
  cleanDays: number;
  /** True while it cannot decay at all: a term still being served. */
  frozen: boolean;
}

/** One line of the contribution column. */
export interface ObservedDeed {
  label: string;
  count: number;
  worth: number;
}

/** A citizen's score with every component broken out, so nothing is hidden. */
export interface ReputeBreakdown {
  citizenId: CitizenId;
  score: number;
  baseline: number;
  reputation: number;
  diligence: number;
  honesty: number;
  civic: number;
  generosity: number;
  contribution: number;
  civicPenalty: number;
  custodialPenalty: number;
  /** The permanent ceiling this record puts on the score (1000 for almost everyone). */
  ceiling: number;
  /** True when the ceiling actually bit. */
  capped: boolean;
  penalties: ObservedPenalty[];
  deeds: ObservedDeed[];
  /**
   * False for children: a child born in a city is a resident of it and is
   * never tested (`CITIZENSHIP.md` §2).
   */
  tested: boolean;
}

/** A citizen's own notice of standing, as their observation shows it. */
export interface ObservedNotice {
  issuedDay: number;
  line: number;
  repute: number;
  shortfall: number;
  graceDays: number;
  graceEndsDay: number;
  daysLeft: number;
  daysAbove: number;
  recoveryDays: number;
  immediate: boolean;
  reason: string;
  halved: boolean;
  applied: boolean;
  items: NoticeItem[];
  /** What a notice does not take, in the Charter's own words. */
  keeps: string[];
}

/** A residency hearing, with every vote named. */
export interface ObservedHearing {
  id: string;
  day: number;
  hour: number;
  repute: number;
  line: number;
  spoke: boolean;
  advocate: string | null;
  vouchers: string[];
  votes: Record<string, HearingVote>;
  outcome: HearingOutcome | null;
  extendedDays: number;
  leaveByDay: number | null;
  reasons: string[];
}

/** The whole of a citizen's standing: the score, the notice, and the hearings. */
export interface ObservedRepute extends ReputeBreakdown {
  /** The residency line this citizen is judged against. */
  line: number;
  notice: ObservedNotice | null;
  hearings: ObservedHearing[];
  /** Names standing behind this citizen at their own city's gate. */
  vouchedBy: string[];
}

/** One city's gate, and what it would decide about the observer today. */
export interface ObservedGate {
  city: string;
  name: string;
  visit: number;
  reside: number;
  admittedToVisit: boolean;
  admittedToReside: boolean;
  repute: number;
  shortfall: number;
  /** The relief this city offers, in its own words. */
  relief: string[];
  /** The decision the gate would actually state, in full. */
  reasons: string[];
  /** True when this is the city the observer lives in. */
  yours: boolean;
}

/**
 * The next hearing id: `s_1`, `s_2`, … The counter lives in the register
 * rather than in `util/ids.ts` so that a saved world keeps counting from where
 * it left off and no other kind of id can collide with it.
 */
export function nextHearingId(world: World): string {
  const s = standingState(world);
  s.nextHearing += 1;
  return `s_${s.nextHearing}`;
}

/**
 * What the progress layer keeps on the World, and the conventions it borrows
 * from the layers that came before it (`docs/PROGRESS.md`).
 *
 * Everything here is plain, JSON-serialisable and — with exactly one exception
 * — **public**, because everything in Reverie is observable
 * (`PRINCIPLES.md` §5). The exception is written into the design rather than
 * hidden from the observer: a **secret** is absent from the Chronicle and from
 * every observation but a master's (`PROGRESS.md` §4). It is still in this
 * register, still on the dashboard, and still in the audit. What a secret hides
 * it hides from *citizens*, never from the person watching the city.
 *
 * ## Four rules this file exists to keep
 *
 * 1. **A project's purse holds real lumens.** `REGISTRY.md` §5 counts
 *    `Σ project purses` in the money supply, and `economy/treasury.transfer`
 *    knows four kinds of party. So a purse **is** a strongbox — the same
 *    business record `finance/box.ts` opens for a vault or a mutual's pot: a
 *    real, auditable holder of lumens the daily audit already sums, that pays
 *    no rent, keeps no books, is never read as a trading concern and can never
 *    go bankrupt. Nothing here mints, and nothing here burns.
 * 2. **A technology is a register row, not a lumen.** Holding a subject,
 *    mastering a secret and having built the works are rows; the money that
 *    moved to get there went through `transfer` like everything else.
 * 3. **Ids survive a save.** `util/ids.ts` owns a closed union of prefixes this
 *    layer is not in, so the register keeps its own counters (as
 *    `finance/state.ts` does) and a loaded world carries on where it left off.
 * 4. **A world saved before this layer opens.** The register is created on
 *    first use and every field is backfilled, so nothing in an old save is an
 *    error.
 */
import type { BusinessId, CitizenId, DistrictId, EventKind, LedgerKind, OffenceCode, World } from '../types.ts';
import type { TechnologyId } from './tree.ts';

// ---------------------------------------------------------------------------
// The names this layer borrows
// ---------------------------------------------------------------------------

/**
 * Research, a discovery, the works and a technique lost: the city's own fabric
 * changing, which is what `growth` already means (a district opening, a tram
 * line laid).
 */
export const PROGRESS_EVENT: EventKind = 'growth';
/** A finding published, reviewed or claimed falsely: the papers' business. */
export const FINDING_EVENT: EventKind = 'story';
/**
 * A trend rising, saturating and dying. A school of thought is one of the five
 * kinds a trend can be (`PROGRESS.md` §6), so the city already has a word for
 * "what people have taken up this month".
 */
export const TREND_EVENT: EventKind = 'school';

/**
 * The two codes `PROGRESS.md` §8 adds to the Code of the City, both civic, both
 * on the ladder, neither of them ever custody (`REGISTRY.md` §4).
 *
 * `L41` is **not charged from this layer**: taking a secret is
 * `UNDERWORLD.md` §5's `steal_secret`, one action with two codes by who the
 * taker worked for (`REGISTRY.md` §7), and that is a different layer's system.
 * It is named here so that the number is claimed and nobody reuses it.
 *
 * `government/watch.commitOffence` ignores a code the Code of the City does not
 * yet carry, so charging L42 is a no-op until `data/laws.ts` has it — and
 * correct the moment it does.
 */
export const PROGRESS_LAWS = {
  /** Taking a guild's or a business's secret by observation. `UNDERWORLD.md` §5 charges it. */
  industrialEspionage: 'L41',
  /** A paper for a project that failed, or a technology the city does not hold. */
  falseFinding: 'L42',
} as const;

export function progressLaw(code: (typeof PROGRESS_LAWS)[keyof typeof PROGRESS_LAWS]): OffenceCode {
  return code as unknown as OffenceCode;
}

/** Where a purse and the works are recorded on the Treasury's book. */
export const GRANT_KIND: LedgerKind = 'grant';
export const REFUND_KIND: LedgerKind = 'payout';
export const WORKS_KIND: LedgerKind = 'public_works';
export const SECRET_KIND: LedgerKind = 'acquisition';

// ---------------------------------------------------------------------------
// The register
// ---------------------------------------------------------------------------

/** How a project ended, or that it has not. */
export type ProjectStatus = 'open' | 'succeeded' | 'failed' | 'abandoned';

/** What a completed finding became: nothing yet, a paper, or a secret. */
export type FindingStatus = 'undecided' | 'published' | 'secret';

/**
 * A programme of research: a subject, a purse, and the hours people put into
 * it. Nothing about it is automatic — a citizen opened it, citizens fund it,
 * and citizens work it.
 */
export interface ResearchProject {
  id: string;
  technology: TechnologyId;
  name: string;
  openedById: CitizenId;
  openedDay: number;
  /** Insight accumulated. At `cost` the project resolves on the next rollover. */
  progress: number;
  cost: number;
  volumesRequired: number;
  /** Volumes of knowledge actually burned through. */
  volumesSpent: number;
  /** Volumes bought and not yet read. */
  volumesOnHand: number;
  /** The strongbox that holds the project's lumens. */
  purseId: BusinessId;
  /** Shifts each citizen has worked on it. Three makes a master of a secret. */
  shifts: Record<CitizenId, number>;
  /** Who has worked it today, for the colleagues term in the insight formula. */
  workedToday: CitizenId[];
  /** The day `workedToday` was last cleared. */
  workedDay: number;
  /** The last day anybody put an hour into it, for letting an idle programme go. */
  lastShiftDay: number;
  /** Lumens each party put in, for the refund at the end. */
  funded: Record<string, number>;
  status: ProjectStatus;
  finding: FindingStatus;
  resolvedDay: number | null;
  /** The paper this finding became, when it was published. */
  workId: string | null;
  /** Progress salvaged from an earlier failure on the same subject. */
  salvaged: number;
}

/** A subject the city holds, and how it holds it. */
export interface TechnologyRecord {
  id: TechnologyId;
  discoveredDay: number;
  projectId: string | null;
  /** True while it is a guild's or a business's secret rather than the city's. */
  secret: boolean;
  /** Who may work it and teach it. Everybody, once it is published. */
  masters: CitizenId[];
  /** The day the last master left with no apprentice and the technique died. */
  lostDay: number | null;
  /** Where it came from: research here, a paper read, a teacher, a purchase. */
  source: 'research' | 'paper' | 'teacher' | 'purchase' | 'treaty';
}

/**
 * The works for one technology, paid for a day at a time and useless until
 * somebody is trained (`PROGRESS.md` §3). One of these belongs to the city;
 * a business that will not wait for the Council keeps its own.
 */
export interface Adoption {
  technology: TechnologyId;
  /** The business that paid, or null for the city's own works. */
  businessId: BusinessId | null;
  worksPaid: number;
  worksCost: number;
  startedDay: number;
  /** Shifts each citizen has worked under the works; 3 makes them trained. */
  shifts: Record<CitizenId, number>;
  /** Citizens trained: the numerator of uptake. */
  trained: CitizenId[];
  /** Districts the works stand in, for a district's amenity term. */
  districts: DistrictId[];
}

/** What a trend can be about (`PROGRESS.md` §6). */
export type TrendKind = 'possession' | 'dish' | 'hobby' | 'name' | 'school';

export const TREND_KINDS: readonly TrendKind[] = ['possession', 'dish', 'hobby', 'name', 'school'];

/**
 * Something enough of the city wants this month. Nobody seeds one and nobody
 * owns one: it exists because three friends held the same thing, and it dies
 * when the city stops caring.
 */
export interface Trend {
  id: string;
  kind: TrendKind;
  subject: string;
  sinceDay: number;
  /** Yesterday's reading — what every shopkeeper sees, lagged by a rollover. */
  share: number;
  previousShare: number;
  rising: boolean;
  peakShare: number;
  /** The day it stopped being a trend, or null while it runs. */
  endedDay: number | null;
}

/** The three rows `CITIZENSHIP.md`'s contribution table gains (`PROGRESS.md` §7). */
export interface ProgressDeeds {
  discovered: number;
  taught: number;
  apprentices: number;
}

export interface ProgressState {
  projects: Record<string, ResearchProject>;
  technologies: Partial<Record<TechnologyId, TechnologyRecord>>;
  /** The city's works, by subject. */
  adoptions: Partial<Record<TechnologyId, Adoption>>;
  /** A business's own works, by `${businessId}:${technology}`. */
  businessWorks: Record<string, Adoption>;
  /** Progress left on the shelf by a failure, waiting for somebody to reopen the subject. */
  salvage: Partial<Record<TechnologyId, number>>;
  /** Shifts a citizen has worked under an adopted technology anywhere: three makes them familiar. */
  familiar: Record<CitizenId, TechnologyId[]>;
  /** `${teacherId}:${technology}` — a teacher gives one city one subject once. */
  taught: Record<string, number>;
  trends: Trend[];
  /**
   * What a citizen has taken up from a trend and not yet acted on: a dish,
   * which is the only way of "holding" one, and a possession they mean to buy
   * (`progress/trends.ts reassertWants` puts it back on the list each morning).
   */
  takenUp: Record<CitizenId, string[]>;
  /** The deeds this layer adds to the contribution column. */
  deeds: Record<CitizenId, ProgressDeeds>;
  seq: Record<string, number>;
}

function emptyState(): ProgressState {
  return {
    projects: {}, technologies: {}, adoptions: {}, businessWorks: {}, salvage: {},
    familiar: {}, taught: {}, trends: [], takenUp: {}, deeds: {}, seq: {},
  };
}

/**
 * The progress register, created on first use. A save from before this layer
 * existed keeps everything it holds and gains everything it lacks.
 */
export function progressState(world: World): ProgressState {
  const w = world as World & { progress?: ProgressState };
  if (!w.progress) w.progress = emptyState();
  const s = w.progress;
  s.projects ??= {};
  s.technologies ??= {};
  s.adoptions ??= {};
  s.businessWorks ??= {};
  s.salvage ??= {};
  s.familiar ??= {};
  s.taught ??= {};
  s.trends ??= [];
  s.takenUp ??= {};
  s.deeds ??= {};
  s.seq ??= {};
  return s;
}

/** Monotonic ids per prefix, kept in the register so they survive save and load. */
export function progressId(world: World, prefix: string): string {
  const s = progressState(world);
  const n = (s.seq[prefix] ?? 0) + 1;
  s.seq[prefix] = n;
  return `${prefix}_${n}`;
}

/** The key a business's own works are filed under. */
export function worksKey(businessId: BusinessId, technology: TechnologyId): string {
  return `${businessId}:${technology}`;
}

/** The deeds ledger for one citizen, created on first use. */
export function deedsOf(world: World, cId: CitizenId): ProgressDeeds {
  const s = progressState(world);
  const found = s.deeds[cId];
  if (found) {
    found.discovered ??= 0;
    found.taught ??= 0;
    found.apprentices ??= 0;
    return found;
  }
  const fresh: ProgressDeeds = { discovered: 0, taught: 0, apprentices: 0 };
  s.deeds[cId] = fresh;
  return fresh;
}

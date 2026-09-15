/**
 * The shapes the finance layer keeps on the World, the strongboxes that hold
 * its lumens, and the one accessor that hands the register out
 * (`docs/FINANCE.md`).
 *
 * Everything here is plain, JSON-serialisable, and **public**: a bond holding,
 * a deposit, a policy and a mutual's pot are all rows in registers any citizen
 * may read, because everything in Reverie is observable (`PRINCIPLES.md` §5).
 * A world saved before this layer existed carries none of it, so the register
 * is created lazily the first time anything asks for it.
 *
 * ## Two rules this file exists to keep
 *
 * 1. **An instrument is a claim on lumens and never a lumen.** A bond, a
 *    deposit, a policy and a member's standing in a mutual are rows here with
 *    no money in them. Money moves only through `economy/treasury.transfer`,
 *    which is the only thing in the engine that can move a lumen at all, so
 *    the daily audit (`auditMoneySupply`) cannot notice this layer exists.
 *    Nothing here mints; the one creation in the whole city is the Council's
 *    `mint` (`finance/debt.ts`), which goes through `transfer` from the `mint`
 *    party and raises `treasury.minted` in the same call.
 *
 * 2. **A pot that holds lumens is a money party the supply already counts.**
 *    The vault and every mutual's pot hold real lumens, and `REGISTRY.md` §5
 *    counts each of them in the supply equation. `transfer` knows four kinds
 *    of party — the Treasury, the Chest, a citizen and a business — so a
 *    strongbox here **is** a business record: a real, auditable holder of
 *    lumens that `moneySupply` already sums, needing no change to the money
 *    funnel and no new term in the audit.
 *
 * The strongboxes themselves are in `finance/box.ts`, which is where a pot's
 * lumens actually sit and why they sit there.
 */
import type { BusinessId, BusinessKind, CitizenId, LedgerKind, LoanId, OffenceCode, World } from '../types.ts';

// ---------------------------------------------------------------------------
// Ledger kinds and business kinds this layer names
// ---------------------------------------------------------------------------

/**
 * The ledger kinds `FINANCE.md` §9 adds. They are declared here rather than in
 * `types.ts` because this layer owns them; `financeKind` widens one to the
 * ledger's own union at the single point where the ledger is written, so every
 * entry this layer makes is still an ordinary `transfer` with an honest name
 * on it.
 */
export type FinanceLedgerKind =
  | 'bond' | 'coupon' | 'redemption' | 'deposit' | 'interest' | 'premium' | 'claim' | 'dues';

/** Widen a finance ledger kind to the ledger's union (see `FinanceLedgerKind`). */
export function financeKind(kind: FinanceLedgerKind | LedgerKind): LedgerKind {
  return kind as LedgerKind;
}

/**
 * The three codes `FINANCE.md` §9 adds to the Code of the City, all civic, all
 * on the ladder, none of them ever custody (`REGISTRY.md` §4). They are named
 * here for the same reason the ledger kinds are: this layer owns them.
 * `government/watch.commitOffence` ignores a code the Code of the City does
 * not yet carry, so charging one is a no-op until `data/laws.ts` has it — and
 * correct the moment it does.
 */
export const FINANCE_LAWS = {
  /** Writing cover you cannot fund, or insuring a loss you arranged. */
  fraudulentUnderwriting: 'L23',
  /** Lending below the reserve, or to yourself. */
  misappropriation: 'L24',
  /** A ring agreeing a price, or a councillor bidding through a proxy. */
  riggingAnAuction: 'L25',
} as const;

/** Name one of this layer's offence codes where a charge is laid. */
export function financeLaw(code: (typeof FINANCE_LAWS)[keyof typeof FINANCE_LAWS]): OffenceCode {
  return code as unknown as OffenceCode;
}

/**
 * What a strongbox and an underwriter call themselves on the business
 * register. Neither is a shop, a workshop or a clinic, and nothing in the
 * engine that switches on a business kind matches either of them.
 */
export const STRONGBOX_KIND = 'strongbox' as unknown as BusinessKind;
export const UNDERWRITER_KIND = 'underwriter' as unknown as BusinessKind;

// ---------------------------------------------------------------------------
// The registers
// ---------------------------------------------------------------------------

/** Who may hold a bond, a policy or a place in a pot: a citizen or a business. */
export type Holder = CitizenId | BusinessId;

export type IssueStatus = 'auction' | 'outstanding' | 'redeemed' | 'failed' | 'defaulted' | 'repudiated';

/** One issue of the city's paper. Face is fixed at 100 ℓ, so a price is a percentage. */
export interface BondIssue {
  id: string;
  /** Bonds offered (20–3 000). */
  size: number;
  /** Lumens per bond per day (0.5–4). */
  coupon: number;
  /** Days from clearing to redemption; whole cycles. */
  termDays: number;
  openedDay: number;
  /** The auction closes at tick 14 on this day. */
  closesDay: number;
  status: IssueStatus;
  /** Uniform clearing price in lumens per bond, once the auction has cleared. */
  clearingPrice: number | null;
  /** Face bid ÷ face offered: demand for the paper. */
  cover: number | null;
  /** Bonds actually allotted. */
  sold: number;
  maturesDay: number | null;
  /** The Council proposal that authorised it, when there was one. */
  proposalId: string | null;
  /** Issued over the debt-service cap on a four-of-five override. */
  override: boolean;
  /** Days on which a coupon went unpaid and is still uncured. */
  missedDays: number[];
  /** Deferrals taken (at most two in an issue's life). */
  deferrals: number;
  /** While a deferral runs, the day coupons resume being paid. */
  deferredUntilDay: number | null;
  /** Coupons accrued through a deferral at ×1.25, in lumens, owed at redemption. */
  accrued: number;
  /** Face written off by a restructuring, as a share (0.2 = a fifth off). */
  haircut: number;
  defaultedDay: number | null;
  repudiatedDay: number | null;
}

/** A sealed bid at an auction; public forever after the close. */
export interface BondBid {
  id: string;
  issueId: string;
  bidderId: Holder;
  /** Lumens per bond. */
  price: number;
  qty: number;
  tick: number;
  /** Bonds allotted at the close. */
  filled: number;
}

/** A holding on the public register: face, and who holds it. */
export interface BondHolding {
  id: string;
  issueId: string;
  holderId: Holder;
  qty: number;
  /** What the holder paid per bond, at auction or on the secondary market. */
  paid: number;
  sinceDay: number;
}

/** A holding offered on the secondary market at a price its holder chose. */
export interface BondOffer {
  id: string;
  holdingId: string;
  issueId: string;
  sellerId: Holder;
  price: number;
  qty: number;
  day: number;
  status: 'open' | 'taken' | 'withdrawn';
}

/** Terms put to the holders of an issue; two thirds of face carries and binds. */
export interface RestructureOffer {
  issueId: string;
  proposerId: CitizenId;
  coupon: number;
  termDays: number;
  /** Share of face written off (0–0.9). */
  haircut: number;
  day: number;
  /** holderId → accept. Weighted by the face each holds when it is counted. */
  votes: Record<Holder, boolean>;
  status: 'open' | 'carried' | 'rejected';
  decidedDay: number | null;
}

/** The Lantern Bank's own numbers. */
export interface BankState {
  /** The strongbox that holds the vault's lumens. */
  vaultId: BusinessId | null;
  /** The founding seed has been paid. */
  seeded: boolean;
  depositRate: number;
  lendingRate: number;
  reserveRatio: number;
  /** citizenId → lumens on deposit. A claim on the vault, not a lumen in it. */
  deposits: Record<CitizenId, number>;
  /**
   * Interest accrued but not yet worth a lumen. Lumens are integers and the
   * posted rate is four tenths of a per cent, so a modest deposit earns a
   * fraction of a lumen a day; carrying it means a small saver is paid the
   * rate the bank posted rather than nothing at all.
   */
  interestOwed: Record<CitizenId, number>;
  /** The day the counter closed for want of a vault, or null. */
  suspendedDay: number | null;
  /** Lending the vault could not fund, still standing against the Treasury. */
  owedToTreasury: number;
  /** Marks on the Treasury's cumulative loan and repayment totals. */
  loanMark: number;
  repayMark: number;
  /** loanId → the day a banker called it in. */
  called: Record<LoanId, number>;
  /** Lumens the Treasury has put into the vault by `bank_rescue`. */
  rescued: number;
  /** This morning's reading, 0..1. */
  confidence: number;
  /** Withdrawals served today, oldest first: the queue a run is made of. */
  servedToday: CitizenId[];
}

export type PolicyKind = 'caravan' | 'ship' | 'business' | 'home' | 'health';

export const POLICY_KINDS: readonly PolicyKind[] = ['caravan', 'ship', 'business', 'home', 'health'];

/** A line an underwriter has posted and will write. */
export interface PolicyOffer {
  id: string;
  underwriterId: BusinessId;
  kind: PolicyKind;
  /** Most the underwriter will pay on one loss. */
  cover: number;
  /** Lumens a day the insured pays. */
  premium: number;
  termDays: number;
  day: number;
  status: 'open' | 'withdrawn';
}

/** A filed contract: a policy somebody took. Suable on the civil docket if refused. */
export interface Policy {
  id: string;
  offerId: string;
  underwriterId: BusinessId;
  insuredId: Holder;
  kind: PolicyKind;
  cover: number;
  premium: number;
  fromDay: number;
  untilDay: number;
  status: 'live' | 'lapsed' | 'expired' | 'void';
  /** Premiums paid to date, and the last day one was collected. */
  paid: number;
  lastPaidDay: number;
  /** Cover already drawn down by settled claims. */
  claimed: number;
}

export interface InsuranceClaim {
  id: string;
  policyId: string;
  claimantId: Holder;
  underwriterId: BusinessId;
  event: string;
  amount: number;
  day: number;
  status: 'open' | 'settled' | 'denied';
  paid: number;
  reason: string | null;
  decidedDay: number | null;
}

/** How a pot decides a claim on it. */
export type PotRule = 'members' | 'steward';

/**
 * A common fund: lumens pooled by its members and paid out by their own rule.
 * A mutual's pot and a creed's fund are the same object (`REGISTRY.md` §7);
 * what differs is what the members joined for and who is allowed to decide.
 */
export interface Pot {
  id: string;
  name: string;
  /** The strongbox holding the pot's lumens. The pot's balance *is* its balance. */
  boxId: BusinessId;
  members: CitizenId[];
  rule: PotRule;
  /** Under `steward`, the one member who may grant a claim alone. */
  stewardId: CitizenId | null;
  /** Members needed before the pot may pay anything at all. */
  minMembers: number;
  openedDay: number;
  closedDay: number | null;
}

export interface PotClaim {
  id: string;
  potId: string;
  claimantId: CitizenId;
  amount: number;
  reason: string;
  day: number;
  /** memberId → aye. Public, and counted toward the civic reading. */
  votes: Record<CitizenId, boolean>;
  status: 'open' | 'granted' | 'refused' | 'lapsed';
  paid: number;
  decidedDay: number | null;
}

/** A mutual: a pot, a name, a subscription, and the five adults who keep it. */
export interface Mutual {
  id: string;
  potId: string;
  name: string;
  /** Lumens a member owes the pot a day. */
  dues: number;
  founderId: CitizenId;
  foundedDay: number;
  /** memberId → the last day dues were paid. */
  lastDues: Record<CitizenId, number>;
}

export interface FinanceState {
  issues: Record<string, BondIssue>;
  bids: BondBid[];
  holdings: Record<string, BondHolding>;
  offers: Record<string, BondOffer>;
  restructures: Record<string, RestructureOffer>;
  /** issueId → the last price two citizens agreed: the city's live rating. */
  lastTraded: Record<string, number>;
  /** No new issue may be opened before this day (a repudiation bars four cycles). */
  noIssuesUntilDay: number;
  /** The Treasury's daily revenue over the last cycle, oldest first. */
  revenueDays: number[];
  bank: BankState;
  underwriters: Record<BusinessId, Underwriter>;
  policyOffers: Record<string, PolicyOffer>;
  policies: Record<string, Policy>;
  claims: Record<string, InsuranceClaim>;
  pots: Record<string, Pot>;
  potClaims: Record<string, PotClaim>;
  mutuals: Record<string, Mutual>;
  /** Id counters, by prefix. */
  seq: Record<string, number>;
}

/** A licensed house that writes cover: the business, plus what it has promised. */
export interface Underwriter {
  id: BusinessId;
  name: string;
  ownerId: CitizenId;
  foundedDay: number;
  /** Capital paid in at founding, for the loading in the premium formula. */
  capital: number;
  woundUpDay: number | null;
}

// ---------------------------------------------------------------------------
// The register itself
// ---------------------------------------------------------------------------

/** Founding conventions for the bank's three numbers (`FINANCE.md` §4). */
export const FOUNDING_DEPOSIT_RATE = 0.004;
export const FOUNDING_LENDING_RATE = 0.02;
export const FOUNDING_RESERVE_RATIO = 0.25;

function emptyBank(): BankState {
  return {
    vaultId: null, seeded: false,
    depositRate: FOUNDING_DEPOSIT_RATE, lendingRate: FOUNDING_LENDING_RATE, reserveRatio: FOUNDING_RESERVE_RATIO,
    deposits: {}, interestOwed: {}, suspendedDay: null, owedToTreasury: 0, loanMark: 0, repayMark: 0,
    called: {}, rescued: 0, confidence: 1, servedToday: [],
  };
}

function emptyState(): FinanceState {
  return {
    issues: {}, bids: [], holdings: {}, offers: {}, restructures: {}, lastTraded: {},
    noIssuesUntilDay: 0, revenueDays: [], bank: emptyBank(),
    underwriters: {}, policyOffers: {}, policies: {}, claims: {},
    pots: {}, potClaims: {}, mutuals: {}, seq: {},
  };
}

/**
 * The finance register, created on first use. A save from a half-built version
 * of this layer keeps whatever it holds and gains whatever it lacks.
 */
export function financeState(world: World): FinanceState {
  const w = world as World & { finance?: FinanceState };
  if (!w.finance) w.finance = emptyState();
  const s = w.finance;
  s.issues ??= {};
  s.bids ??= [];
  s.holdings ??= {};
  s.offers ??= {};
  s.restructures ??= {};
  s.lastTraded ??= {};
  s.noIssuesUntilDay ??= 0;
  s.revenueDays ??= [];
  s.bank ??= emptyBank();
  s.bank.deposits ??= {};
  s.bank.interestOwed ??= {};
  s.bank.called ??= {};
  s.bank.servedToday ??= [];
  s.bank.owedToTreasury ??= 0;
  s.bank.loanMark ??= 0;
  s.bank.repayMark ??= 0;
  s.bank.rescued ??= 0;
  s.bank.confidence ??= 1;
  s.underwriters ??= {};
  s.policyOffers ??= {};
  s.policies ??= {};
  s.claims ??= {};
  s.pots ??= {};
  s.potClaims ??= {};
  s.mutuals ??= {};
  s.seq ??= {};
  return s;
}

/** Monotonic ids per prefix, kept in the register so they survive save and load. */
export function financeId(world: World, prefix: string): string {
  const s = financeState(world);
  const n = (s.seq[prefix] ?? 0) + 1;
  s.seq[prefix] = n;
  return `${prefix}_${n}`;
}

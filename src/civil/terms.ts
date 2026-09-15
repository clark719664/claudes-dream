/**
 * What an instrument *is*: the arithmetic of face value and the filing fee, the
 * shape of an obligation, and every way of reading the register
 * (`docs/CIVIL.md` §§1–2). Nothing here moves a lumen or changes a status.
 *
 * Two things this layer deliberately does not do. It does not pay a second
 * wage on an employment contract — the post and the wage are what the
 * instrument guarantees, and the lumens still move through `economy/jobs.ts`
 * when the shift is worked, so `perform_contract` records the shift and moves
 * nothing. And where the engine's own letting already charges rent for a unit,
 * a filed lease takes precedence (`filedLeaseFor`): the rent must be collected
 * once, by one of them.
 */
import type { CitizenId, MoneyParty, World } from '../types.ts';
import { memo } from '../util/memo.ts';
import { isJailed } from '../government/jail.ts';
import type { Contract, ContractKind } from './shapes.ts';
import { civilSettings, civilState } from './state.ts';

/** Days an offer sits in the target's observation before it lapses. */
export const OFFER_LAPSE_DAYS = 2;
/** Longer than four council cycles and a contract outlives the law it was written under. */
export const MAX_CONTRACT_DAYS = 112;
/** What a witness is paid, by the offeror, for their mark. */
export const WITNESS_FEE = 2;
/** Marks one instrument may carry. */
export const MAX_WITNESSES = 3;
/** A breach costs at most twice the consideration still outstanding. */
export const PENALTY_MULTIPLE = 2;
/** Days of warning that end an employment or a lease without breach. */
export const DEFAULT_NOTICE_DAYS = 3;
/** An apprenticeship is the only lawful wage under the floor, and this is the floor's share. */
export const APPRENTICE_WAGE_SHARE = 0.6;
/** An apprenticeship runs no longer than this. */
export const MAX_APPRENTICESHIP_DAYS = 28;
/** Patronage runs 7–112 days. */
export const MIN_PATRONAGE_DAYS = 7;
/** What an apprentice's skill growth is multiplied by, as in `social/mentorship.ts`. */
export const APPRENTICE_SKILL_MULTIPLIER = 2;

/** Kinds whose obligation falls due once a day for the whole term. */
const DAILY_KINDS: readonly ContractKind[] = ['employment', 'lease', 'loan', 'apprenticeship', 'patronage'];

/** Kinds discharged by a single delivery at the end of the term. */
function isDaily(kind: ContractKind): boolean {
  return DAILY_KINDS.includes(kind);
}

/**
 * Periods the contract runs. A wage per shift, a rent per day, an instalment
 * and a stipend fall due daily; capital, a load of crates, a commissioned work
 * and a lodged sum fall due once.
 */
export function periodsOf(kind: ContractKind, days: number): number {
  return isDaily(kind) ? Math.max(1, days) : 1;
}

/** `face value = consideration × periods the contract runs` */
export function faceValue(consideration: number, kind: ContractKind, days: number): number {
  return Math.max(0, Math.round(consideration)) * periodsOf(kind, days);
}

/**
 * `filing fee = 5 ℓ + 1 % of face value, capped at 60 ℓ` — the Exchange's whole
 * income here, and the reason a contract must cost less than the 100 ℓ a
 * business registration does or nobody files one for a week's work.
 */
export function filingFee(world: World, face: number): number {
  const s = civilSettings(world);
  return Math.min(s.filingCap, Math.round(s.filingFlat + s.filingRate * Math.max(0, face)));
}

// ---------------------------------------------------------------------------
// Reading the register
// ---------------------------------------------------------------------------

export function contractById(world: World, id: string): Contract | null {
  return civilState(world).contracts[id] ?? null;
}

/**
 * Every instrument the Exchange holds. The register is read by half a dozen
 * questions in every citizen's observation, so during a reading round it is
 * listed once for the whole city (`util/memo.ts`).
 */
export function allContracts(world: World): Contract[] {
  return memo(world, 'civil:contracts', () => Object.values(civilState(world).contracts));
}

/** The instruments each citizen is on, indexed once for a whole reading round. */
function contractIndex(world: World): Map<CitizenId, Contract[]> {
  return memo(world, 'civil:contracts:byParty', () => {
    const by = new Map<CitizenId, Contract[]>();
    for (const k of allContracts(world)) {
      for (const id of [k.offerorId, k.offereeId]) {
        const list = by.get(id);
        if (list) list.push(k);
        else by.set(id, [k]);
      }
    }
    return by;
  });
}

/** Both sides, offeror first. */
export function partiesOf(k: Contract): [CitizenId, CitizenId] {
  return [k.offerorId, k.offereeId];
}

export function isParty(k: Contract, cId: CitizenId): boolean {
  return k.offerorId === cId || k.offereeId === cId;
}

/** Every instrument this citizen is on, newest last. */
export function contractsOf(world: World, cId: CitizenId): Contract[] {
  return contractIndex(world).get(cId) ?? [];
}

/** Instruments running today. */
export function activeContractsOf(world: World, cId: CitizenId): Contract[] {
  return contractsOf(world, cId).filter((k) => k.status === 'active');
}

/** Offers on the table for this citizen to answer. */
export function offersTo(world: World, cId: CitizenId): Contract[] {
  return contractsOf(world, cId).filter((k) => k.status === 'offered' && k.offereeId === cId);
}

/** Offers this citizen has out. */
export function offersBy(world: World, cId: CitizenId): Contract[] {
  return contractsOf(world, cId).filter((k) => k.status === 'offered' && k.offerorId === cId);
}

/**
 * The filed lease over a unit, if one is running. A lease names its address in
 * its own terms, because `offer_contract` carries no field for one, so this is
 * a substring match on what the parties actually wrote. It exists so that rent
 * is collected **once**: where a filed lease covers a unit, it takes precedence
 * over the engine's own letting, which must not charge the same rent twice.
 */
export function filedLeaseFor(world: World, unit: string): Contract | null {
  return allContracts(world).find((k) => k.status === 'active' && k.kind === 'lease' && k.terms.includes(unit)) ?? null;
}

/**
 * The filed profit split for a business, where a partnership names one. While
 * it runs the daily payout splits by these shares instead of all of it going to
 * `Business.ownerId`, who becomes the managing partner.
 */
export function partnershipSharesOf(world: World, businessId: string): Record<CitizenId, number> | null {
  const k = allContracts(world).find(
    (x) => x.status === 'active' && x.kind === 'partnership' && x.businessId === businessId && x.shares);
  return k?.shares ?? null;
}

/** The running apprenticeship a citizen is serving, if any. */
export function apprenticeshipFor(world: World, cId: CitizenId): Contract | null {
  return activeContractsOf(world, cId).find((k) => k.kind === 'apprenticeship' && k.offereeId === cId) ?? null;
}

/** The employment instrument between a worker and a till, if one is filed. */
export function employmentContractFor(world: World, workerId: CitizenId, employer: MoneyParty): Contract | null {
  return activeContractsOf(world, workerId).find(
    (k) => k.kind === 'employment' && k.offereeId === workerId && k.offerorParty === employer) ?? null;
}

/**
 * Would ending this citizen's post breach a filed term? `fire` inside the term
 * is a breach (`CIVIL.md` §2) — which is a matter for the docket and never for
 * the Watch, so this only answers the question.
 */
export function firingBreaches(world: World, workerId: CitizenId, employer: MoneyParty): Contract | null {
  const k = employmentContractFor(world, workerId, employer);
  if (!k || k.startDay === null) return null;
  if (k.noticeById !== null && k.endsDay !== null && world.day >= k.endsDay) return null;
  return world.day < endDay(k) ? k : null;
}

// ---------------------------------------------------------------------------
// The shape of an obligation
// ---------------------------------------------------------------------------

/** The last day of the term, custody's suspensions included. */
export function endDay(k: Contract): number {
  return (k.startDay ?? 0) + k.days + k.suspendedDays;
}

/**
 * The day a given period falls due. Nothing is owed on the day an instrument is
 * signed: a contract formed in the evening is not already a day behind. A daily
 * term's first period falls due the next morning and its last on the day the
 * term ends; a single delivery falls due on the delivery day.
 */
export function periodDueDay(k: Contract, period: number): number {
  const start = (k.startDay ?? 0) + k.suspendedDays;
  return isDaily(k.kind) ? start + 1 + period : start + k.days;
}

/** The period running today, or the last one when the term has run out. */
export function currentPeriod(world: World, k: Contract): number {
  if (k.startDay === null) return 0;
  const elapsed = world.day - k.startDay - k.suspendedDays - 1;
  return Math.max(0, Math.min(k.periods - 1, isDaily(k.kind) ? elapsed : 0));
}

export function isPerformed(k: Contract, period: number): boolean {
  return k.performances.some((p) => p.period === period);
}

/** Periods still to discharge. */
export function periodsOutstanding(k: Contract): number {
  return Math.max(0, k.periods - k.performances.length);
}

/** The consideration still to move, which caps damages and the penalty alike. */
export function outstandingConsideration(k: Contract): number {
  return k.consideration * periodsOutstanding(k);
}

/**
 * Which side owes this period's act. The offeror is always the one whose kind
 * names them — the employer, the master, the landlord, the lender, the patron,
 * the seller, the commissioner — so the direction of every obligation is read
 * off the instrument and never guessed.
 */
export function obligorOf(k: Contract): CitizenId | null {
  switch (k.kind) {
    case 'employment': return k.offereeId;      // the worker works the shift
    case 'lease': return k.offereeId;           // the tenant pays the rent
    case 'loan': return k.offereeId;            // the borrower repays
    case 'commission': return k.offereeId;      // the maker delivers the work
    case 'apprenticeship': return k.offerorId;  // the master pays the training wage
    case 'patronage': return k.offerorId;       // the patron pays the stipend
    case 'forward': return k.offerorId;         // the seller delivers
    default: return null;                       // partnership and escrow have no periodic act
  }
}

/** Where the money for a period moves, and which way. */
export function moneyLeg(k: Contract): { from: MoneyParty; to: MoneyParty; kind: 'wage' | 'transfer' } | null {
  switch (k.kind) {
    case 'lease': return { from: k.offereeParty, to: k.offerorParty, kind: 'transfer' };
    case 'loan': return { from: k.offereeParty, to: k.offerorParty, kind: 'transfer' };
    case 'forward': return { from: k.offereeParty, to: k.offerorParty, kind: 'transfer' };
    case 'commission': return { from: k.offerorParty, to: k.offereeParty, kind: 'transfer' };
    case 'apprenticeship': return { from: k.offerorParty, to: k.offereeParty, kind: 'wage' };
    case 'patronage': return { from: k.offerorParty, to: k.offereeParty, kind: 'transfer' };
    default: return null;
  }
}

/** Is either party in custody? Their contracts stand still, and neither is in breach for it. */
export function suspendedForCustody(world: World, k: Contract): boolean {
  return isJailed(world.citizens[k.offerorId]) || isJailed(world.citizens[k.offereeId]);
}


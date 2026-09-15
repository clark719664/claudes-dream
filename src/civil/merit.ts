/**
 * What a civil judge reads, and what the arithmetic allows them to order
 * (`docs/CIVIL.md` §4).
 *
 * Criminal belief must clear 0.55 and asks *did this person do wrong*. Civil
 * belief clears **0.50** and asks *which of these two is more likely right*.
 * That difference is the reason for a second track: money should follow the
 * likelier story; liberty should not.
 *
 * ```
 * merit  = 0.55 × record          filed terms, performances, dates
 *                                 1.00 for a filed instrument, 0.33 for a handshake
 *        + 0.20 × witnesses       0.07 per witness who confirms the terms, at most three
 *        + 0.15 × corroboration   Bazaar receipts, Chronicle stories, bank ledgers
 *        + 0.10 × pleading        how specific the claim and the answer actually are
 *
 * belief = merit − 0.20 × friendship(judge, defendant)
 *                + 0.08 × (defendant has an adjudicated breach on record)
 *                + noise
 * ```
 *
 * The record carries over half the weight because that is what filing is *for*:
 * nothing else rescues a handshake against a party who denies it. The
 * friendship term is the criminal bench's weight unchanged — a judge is a
 * citizen.
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, World } from '../types.ts';
import { normal, shuffle } from '../util/rng.ts';
import { areFriends, bondBetween } from '../citizens/relationships.ts';
import { areFamily } from '../society/family.ts';
import { canSit } from '../government/cases.ts';
import type { Contract, Suit } from './shapes.ts';
import { civilSettings, contractRecordOf } from './state.ts';
import { wordCount } from './common.ts';
import { contractById, outstandingConsideration } from './terms.ts';

/** Civil belief asks which of the two is more likely right, and clears at a half. */
export const CIVIL_THRESHOLD = 0.5;
export const MERIT_RECORD = 0.55;
export const MERIT_WITNESSES = 0.2;
export const MERIT_CORROBORATION = 0.15;
export const MERIT_PLEADING = 0.1;
/** A filed instrument against a handshake: the whole reason the Exchange exists. */
export const FILED_RECORD = 1;
export const HANDSHAKE_RECORD = 0.33;
/** A friend of the defendant on the bench — the criminal bench's weight, unchanged. */
export const BOND_DEFENDANT_WEIGHT = 0.2;
/** What an adjudicated breach on the defendant's record is worth to a plaintiff. */
export const PRIOR_BREACH_WEIGHT = 0.08;
/** How far one judge's reading of the same page wanders from another's. */
export const JUDGE_NOISE = 0.05;
/** Under this claim one judge sits alone; at or above it, three do. */
export const FULL_BENCH_CLAIM = 500;
export const FULL_BENCH = 3;
/** Sittings a suit may be carried for want of a bench before it is decided on the record. */
export const MAX_CARRIED = 3;
/** A plaintiff who loses under this merit pays the defendant's costs. */
export const WITHOUT_MERIT = 0.25;
/** What a plaintiff who sat on their claim loses of it. */
export const MITIGATION_SHARE = 0.25;
/** Days a plaintiff may wait after a breach before they have sat on it. */
export const MITIGATION_DAYS = 7;
/** Damages never exceed twice the consideration still outstanding. */
export const DAMAGES_MULTIPLE = 2;
/** A tenth of the claim, on top of a filing fee, is what losing without merit costs. */
export const COSTS_SHARE = 0.1;

// ---------------------------------------------------------------------------
// The bench
// ---------------------------------------------------------------------------

/** Judge and party are employer and employee, either way round. */
function employmentTie(world: World, judge: Citizen, party: Citizen): boolean {
  const judgeJob = judge.jobId ? world.jobs[judge.jobId] : null;
  const partyJob = party.jobId ? world.jobs[party.jobId] : null;
  if (judgeJob && party.businessId && judgeJob.employer === party.businessId) return true;
  if (partyJob && judge.businessId && partyJob.employer === judge.businessId) return true;
  return false;
}

/**
 * Article V recusal, unchanged and applied to **both** sides: no judge hears a
 * relative, employer, employee or friend, and nobody hears their own case.
 */
export function mustRecuse(world: World, judgeId: CitizenId, plaintiffId: CitizenId, defendantId: CitizenId): boolean {
  const judge = world.citizens[judgeId];
  if (!judge) return true;
  if (judgeId === plaintiffId || judgeId === defendantId) return true;
  for (const partyId of [plaintiffId, defendantId]) {
    const party = world.citizens[partyId];
    if (!party) return true;
    if (areFamily(world, judgeId, partyId)) return true;
    if (areFriends(world, judgeId, partyId)) return true;
    if (employmentTie(world, judge, party)) return true;
  }
  return false;
}

/** One judge sits alone under a 500 ℓ claim and three above it. */
export function benchSize(damages: number): number {
  return damages >= FULL_BENCH_CLAIM ? FULL_BENCH : 1;
}

/**
 * Who may hear it: the appointed bench minus recusals, made up to size by lot
 * from upstanding citizens where too few judges are free.
 */
export function selectCivilBench(world: World, plaintiffId: CitizenId, defendantId: CitizenId, damages: number): CitizenId[] {
  const want = benchSize(damages);
  const bench: CitizenId[] = [];
  for (const id of world.government.judges) {
    const judge = world.citizens[id];
    if (!judge || bench.includes(id) || !canSit(world, judge) || mustRecuse(world, id, plaintiffId, defendantId)) continue;
    bench.push(id);
    if (bench.length >= want) return bench;
  }
  const pool: CitizenId[] = [];
  for (const id of world.order) {
    const cand = world.citizens[id];
    if (!cand || bench.includes(id) || cand.lifeStage === 'child') continue;
    if (!canSit(world, cand) || mustRecuse(world, id, plaintiffId, defendantId)) continue;
    if (cand.reputation < 50) continue;
    pool.push(id);
  }
  for (const id of shuffle(world, pool)) {
    if (bench.length >= want) break;
    bench.push(id);
  }
  return bench;
}

// ---------------------------------------------------------------------------
// Merit
// ---------------------------------------------------------------------------

/** How specific a pleading actually is: what it says, and whether it says a number. */
export function specificity(text: string): number {
  const words = wordCount(text ?? '');
  if (words === 0) return 0;
  return clamp(Math.min(1, words / 20) + (/\d/.test(text) ? 0.15 : 0), 0, 1);
}

/**
 * What the public record shows of these two dealing with each other: transfers
 * in the Exchange's own ledger, and the days the Chronicle put them in the same
 * line. Nothing private is read, because a Court may not read it.
 */
export function corroboration(world: World, a: CitizenId, b: CitizenId): number {
  let traces = 0;
  for (const row of world.treasury.ledger) {
    if ((row.from === a && row.to === b) || (row.from === b && row.to === a)) traces += 1;
    if (traces >= 3) break;
  }
  if (traces < 3) {
    for (const ev of world.events) {
      if (ev.actors.includes(a) && ev.actors.includes(b)) traces += 1;
      if (traces >= 3) break;
    }
  }
  return clamp(traces / 3, 0, 1);
}

/** The four components of merit, each 0..1, so a reader can see what carried it. */
export interface MeritBreakdown {
  record: number;
  witnesses: number;
  corroboration: number;
  pleading: number;
  merit: number;
  filed: boolean;
}

export function meritOf(world: World, suit: Suit): MeritBreakdown {
  const k: Contract | null = suit.contractId ? contractById(world, suit.contractId) : null;
  const filed = !!k && k.filedDay !== null;
  const record = filed ? FILED_RECORD : HANDSHAKE_RECORD;
  const witnesses = k ? clamp(Math.min(3, k.witnesses.length) / 3, 0, 1) : 0;
  const corr = corroboration(world, suit.plaintiffId, suit.defendantId);
  // The pleading cuts both ways: a specific claim carries, and a specific
  // answer takes it back. Silence is not an admission, and it does not help.
  const pleading = clamp(specificity(suit.claim) - specificity(suit.answer ?? ''), 0, 1);
  const merit = clamp(
    MERIT_RECORD * record + MERIT_WITNESSES * witnesses + MERIT_CORROBORATION * corr + MERIT_PLEADING * pleading, 0, 1);
  return { record, witnesses, corroboration: corr, pleading, merit, filed };
}

/**
 * How strongly one judge believes the plaintiff. A judge is a citizen: the bond
 * they hold with the defendant is on the scale, in public, at the same weight
 * the criminal bench carries it.
 */
export function civilBelief(world: World, judgeId: CitizenId, suit: Suit): number {
  const merit = meritOf(world, suit).merit;
  const bond = clamp(bondBetween(world, judgeId, suit.defendantId) / 100, 0, 1);
  const priorBreach = contractRecordOf(world, suit.defendantId).adjudicated > 0 ? PRIOR_BREACH_WEIGHT : 0;
  return clamp(merit - BOND_DEFENDANT_WEIGHT * bond + priorBreach + normal(world) * JUDGE_NOISE, 0, 1);
}

// ---------------------------------------------------------------------------
// What may be ordered
// ---------------------------------------------------------------------------

/**
 * ```
 * damages = proven loss + the contract's stated penalty
 *         − what the plaintiff could have avoided and did not (25 % where they sat on it)
 *           capped at 2 × the consideration outstanding, never above the sum claimed
 * ```
 */
export function damagesCap(world: World, suit: Suit): number {
  const k = suit.contractId ? contractById(world, suit.contractId) : null;
  if (!k) return suit.damages;
  return Math.min(suit.damages, DAMAGES_MULTIPLE * outstandingConsideration(k));
}

export function assessDamages(world: World, suit: Suit): { award: number; mitigated: boolean; loss: number; penalty: number } {
  const k = suit.contractId ? contractById(world, suit.contractId) : null;
  const loss = k ? Math.min(suit.damages, outstandingConsideration(k)) : suit.damages;
  const penalty = k ? k.penalty : 0;
  const sat = !!k && k.breachedDay !== null && suit.filedDay - k.breachedDay > MITIGATION_DAYS;
  const gross = loss + penalty;
  const award = Math.round(sat ? gross * (1 - MITIGATION_SHARE) : gross);
  return { award: Math.max(0, Math.min(award, damagesCap(world, suit))), mitigated: sat, loss, penalty };
}

/**
 * ```
 * costs = the defendant's filing fee + 10 % of the claim, capped at the claim
 *         against a plaintiff who loses with merit under 0.25
 * ```
 * Costs exist because the docket is deliberately cheap to open: the only thing
 * between a rich citizen and forty suits against a rival is the price of losing
 * them.
 */
export function costsAgainst(world: World, suit: Suit): number {
  const s = civilSettings(world);
  const fee = Math.min(s.suitCap, Math.round(s.suitFlat + s.suitRate * suit.damages));
  return Math.min(suit.damages, fee + Math.round(COSTS_SHARE * suit.damages));
}

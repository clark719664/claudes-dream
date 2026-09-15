/**
 * What cover ought to cost, read off the city's own record (`FINANCE.md` §6).
 *
 * ```
 * p               = events of this class in the last 56 days / 56
 * expected loss   = p × mean payout of those events
 * premium per day = expected loss × (1 + loading)
 * loading         = 0.25 + 0.50 × (cover written / underwriter capital)
 * ```
 *
 * Every input is public, because everything is (`PRINCIPLES.md` §5): the
 * Chronicle's disaster log, the Watch's charge register and the Ward's glitch
 * record. Fifty-six days is two cycles — long enough that a quiet fortnight
 * does not price a forge fire out of existence, short enough that a worse
 * world reprices within a month. The 0.25 base is what survives ordinary
 * variance at this world's own rates; the second term makes a thin house quote
 * dearer, which is correct, and is why it loses business to a better-funded
 * rival.
 *
 * Priced like that only once the city holds the Actuarial Tables
 * (`PROGRESS.md` §2). Until then every house anywhere quotes the flat 4 % of
 * the value (`CITIES.md` §1), spread over the policy's term.
 *
 * The same registers answer the other question an underwriter asks: whether
 * the loss being claimed for happened at all. A claim for a loss no register
 * shows is fraud (L07), and `lossOnRecord` is what the Watch reads.
 */
import type { BusinessId, DistrictId, World } from '../types.ts';
import type { Policy, PolicyKind } from './state.ts';
import { financeState } from './state.ts';
import { coverWritten, underwriterOf } from './houses.ts';

/** Days of the city's own record a premium is priced off: two cycles. */
export const RECORD_DAYS = 56;
/** The base loading: what survives ordinary variance at this world's own rates. */
export const LOADING_BASE = 0.25;
/** How much dearer a thin house has to quote, per unit of cover written against its capital. */
export const LOADING_PER_COVER = 0.5;
/** Before the Actuarial Tables, a policy costs this share of the value it covers, over its term. */
export const FLAT_PREMIUM_RATE = 0.04;

/** The classes of public record that pay each kind of policy. */
const DISASTERS_FOR: Record<PolicyKind, string[]> = {
  caravan: ['storm'],
  ship: ['storm'],
  business: ['forge_fire', 'data_flood', 'blackout'],
  home: ['storm'],
  health: ['outbreak'],
};
const OFFENCES_FOR: Record<PolicyKind, string[]> = {
  caravan: ['L04', 'L08'],
  ship: [],
  business: ['L06', 'L13'],
  home: ['L04', 'L08'],
  health: [],
};

/**
 * Does the city hold the Actuarial Tables (`PROGRESS.md` §2)? Until the
 * technology layer exists nobody does, and every house quotes the flat rate.
 */
export function hasActuarialTables(world: World): boolean {
  const w = world as World & { technologies?: Record<string, unknown> | string[] };
  const held = w.technologies;
  if (Array.isArray(held)) return held.includes('actuarial_tables');
  if (held && typeof held === 'object') return !!(held as Record<string, unknown>).actuarial_tables;
  return false;
}

/** Events of this class on the public record over the last two cycles. */
export function observedEvents(world: World, kind: PolicyKind): number {
  const since = world.day - RECORD_DAYS;
  let count = 0;
  for (const d of world.disasters ?? []) {
    if (d.day >= since && DISASTERS_FOR[kind].includes(d.kind)) count++;
  }
  const laws = OFFENCES_FOR[kind];
  if (laws.length > 0) {
    for (const k of Object.values(world.cases)) {
      if (Math.floor(k.filedTick / 24) >= since && laws.includes(k.law)) count++;
    }
  }
  if (kind === 'health') {
    for (const e of world.events) {
      if (e.day >= since && e.kind === 'health') count++;
    }
  }
  return count;
}

/** The daily rate of loss of this class, off the city's own record. */
export function observedRate(world: World, kind: PolicyKind): number {
  return observedEvents(world, kind) / RECORD_DAYS;
}

/** What this class of loss has actually cost, as the claims register has it. */
export function meanPayout(world: World, kind: PolicyKind, fallback: number): number {
  const since = world.day - RECORD_DAYS;
  const paid = Object.values(financeState(world).claims).filter((k) => {
    const policy = financeState(world).policies[k.policyId];
    return k.status === 'settled' && k.day >= since && policy && policy.kind === kind;
  });
  if (paid.length === 0) return fallback;
  return paid.reduce((sum, k) => sum + k.paid, 0) / paid.length;
}

/** The loading: the base that survives variance, plus what a thin house has to charge. */
export function loadingFor(world: World, uwId: BusinessId | null): number {
  if (!uwId) return LOADING_BASE;
  const uw = underwriterOf(world, uwId);
  if (!uw) return LOADING_BASE;
  const capital = Math.max(1, uw.capital);
  return LOADING_BASE + LOADING_PER_COVER * (coverWritten(world, uwId) / capital);
}

/**
 * What a day of this cover ought to cost. The number an underwriter is quoted
 * by the register; nothing makes them post it, and a house may write dearer or
 * cheaper and answer for it.
 */
export function quotePremium(world: World, kind: PolicyKind, cover: number, termDays: number, uwId: BusinessId | null = null): number {
  const value = Math.max(0, Math.round(cover));
  const term = Math.max(1, Math.round(termDays));
  if (!hasActuarialTables(world)) return Math.max(1, Math.round((value * FLAT_PREMIUM_RATE) / term));
  const p = observedRate(world, kind);
  const expected = p * meanPayout(world, kind, value * 0.5);
  const premium = expected * (1 + loadingFor(world, uwId));
  return Math.max(1, Math.round(premium));
}

/**
 * Is there a loss of this class on the public register in the last few days?
 * The registers decide, not the claimant: a claim for a loss that did not
 * happen is fraud (L07), and this is what the Watch reads.
 */
export function lossOnRecord(world: World, policy: Policy, withinDays = 3): boolean {
  const since = world.day - withinDays;
  const insured = world.citizens[policy.insuredId] ?? null;
  const district: DistrictId | null = insured ? insured.district : (world.businesses[policy.insuredId]?.district ?? null);
  for (const d of world.disasters ?? []) {
    if (d.day < since) continue;
    if (!DISASTERS_FOR[policy.kind].includes(d.kind)) continue;
    if (d.district === null || district === null || d.district === district) return true;
  }
  const laws = OFFENCES_FOR[policy.kind];
  if (laws.length > 0) {
    for (const k of Object.values(world.cases)) {
      if (Math.floor(k.filedTick / 24) < since) continue;
      if (!laws.includes(k.law)) continue;
      if (k.victimId === policy.insuredId) return true;
      const owner = world.businesses[policy.insuredId]?.ownerId;
      if (owner && k.victimId === owner) return true;
    }
  }
  if (policy.kind === 'health' && insured && insured.health?.glitched) return true;
  return false;
}

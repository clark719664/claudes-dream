/**
 * Insurance: the houses that write cover, the policies they file, and the
 * claims that follow (`FINANCE.md` §6).
 *
 * `world/disasters.ts` moves no lumens: damage, lost stock and stopped
 * production are physical facts. Insurance turns a physical fact into a
 * payment. A house posts a line it will write, a citizen or a business takes
 * it, and from that moment the policy is **a filed contract**: a refused claim
 * is a suit on the civil docket, not a grievance. The houses themselves are in
 * `finance/houses.ts` and what a day of cover ought to cost is in
 * `finance/premiums.ts`; what is here is the line, the policy, the claim and
 * the answer to it.
 *
 * A claim for a loss the registers do not show is **fraud (L07)**, and writing
 * cover a house could not fund is **L23** — both read off public registers,
 * which is how the Watch catches either.
 *
 * **Insolvency is not rescued.** An underwriter that cannot meet a claim pays
 * what it holds pro rata among that day's claimants and is wound up under the
 * ordinary bankruptcy rule; unpaid claimants become judgment creditors and
 * mostly recover nothing; the name stays on the register for ever; and every
 * surviving underwriter's premium rises the next morning, because the loading
 * is read off capital and there is less of it about.
 */
import type { ActionResult, BusinessId, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens, transfer } from '../economy/treasury.ts';
import { dissolveBusiness } from '../economy/business.ts';
import { commitOffence } from '../government/watch.ts';
import type { Holder, InsuranceClaim, Policy, PolicyKind, PolicyOffer } from './state.ts';
import { FINANCE_LAWS, POLICY_KINDS, financeId, financeKind, financeLaw, financeState } from './state.ts';
import { activeUnderwriters, coverWritten, houseFunds, underwriterOf, underwriterOwnedBy } from './houses.ts';
import { lossOnRecord, quotePremium } from './premiums.ts';

/** Cover written against the house's own funds beyond which the line is cover it cannot fund: L23. */
export const FRAUD_COVER_MULTIPLE = 5;
/** Days a premium may go unpaid before the policy lapses. */
export const PREMIUM_GRACE_DAYS = 2;
/** Bounds on a line. */
export const COVER_MIN = 20;
export const COVER_MAX = 20_000;
export const TERM_MIN_DAYS = 7;
export const TERM_MAX_DAYS = 336;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// Lines and policies
// ---------------------------------------------------------------------------

export function openLines(world: World): PolicyOffer[] {
  return Object.values(financeState(world).policyOffers).filter((o) => o.status === 'open' && underwriterOf(world, o.underwriterId) !== null);
}

export function lineOf(world: World, offerId: string): PolicyOffer | null {
  return financeState(world).policyOffers[offerId] ?? null;
}

/** Post a line you will write. Anyone may take it while it stands. */
export function offerPolicy(
  world: World, cId: CitizenId, spec: { kind: PolicyKind; cover: number; premium: number; termDays: number },
): ActionResult {
  const uw = underwriterOwnedBy(world, cId);
  if (!uw) return fail('You do not own an underwriter.');
  if (!POLICY_KINDS.includes(spec.kind)) return fail(`There is no such line as ${String(spec.kind)}.`);
  const cover = Math.round(spec.cover);
  const premium = Math.round(spec.premium);
  const term = Math.round(spec.termDays);
  if (!Number.isFinite(cover) || cover < COVER_MIN || cover > COVER_MAX) return fail(`A line covers between ${COVER_MIN} and ${COVER_MAX} ℓ.`);
  if (!Number.isFinite(premium) || premium < 1) return fail('A premium is at least 1 ℓ a day.');
  if (!Number.isFinite(term) || term < TERM_MIN_DAYS || term > TERM_MAX_DAYS) {
    return fail(`A term is between ${TERM_MIN_DAYS} and ${TERM_MAX_DAYS} days.`);
  }

  const offer: PolicyOffer = {
    id: financeId(world, 'line'), underwriterId: uw.id, kind: spec.kind, cover, premium, termDays: term,
    day: world.day, status: 'open',
  };
  financeState(world).policyOffers[offer.id] = offer;
  const quoted = quotePremium(world, spec.kind, cover, term, uw.id);
  emit(world, 'trade',
    `${uw.name} posted a ${spec.kind} line: ${formatLumens(cover)} of cover at ${formatLumens(premium)} a day for ${term} days `
    + `(the register quotes ${formatLumens(quoted)}).`,
    [cId], 0.3, { offerId: offer.id, kind: spec.kind, cover, premium, term, quoted });
  return ok(`Your ${spec.kind} line is posted at ${formatLumens(premium)} a day.`);
}

/** Withdraw a line. Policies already taken stand: a filed contract is a filed contract. */
export function withdrawLine(world: World, cId: CitizenId, offerId: string): ActionResult {
  const offer = lineOf(world, offerId);
  const uw = underwriterOwnedBy(world, cId);
  if (!offer || !uw || offer.underwriterId !== uw.id || offer.status !== 'open') return fail('You have no such line posted.');
  offer.status = 'withdrawn';
  return ok('The line is withdrawn.');
}

export function policyOf(world: World, policyId: string): Policy | null {
  return financeState(world).policies[policyId] ?? null;
}

/** Every live policy a party holds. */
export function policiesOf(world: World, holder: Holder): Policy[] {
  return Object.values(financeState(world).policies).filter((p) => p.insuredId === holder && p.status === 'live');
}

/**
 * Take cover. A policy is a filed contract from this moment: a refused claim
 * is a suit on the civil docket, not a grievance. The first day's premium is
 * paid at the counter.
 */
export function buyPolicy(world: World, buyerId: Holder, offerId: string): ActionResult {
  const offer = lineOf(world, offerId);
  if (!offer || offer.status !== 'open') return fail('There is no such line.');
  const uw = underwriterOf(world, offer.underwriterId);
  if (!uw) return fail('That house is no longer writing.');
  if (buyerId === uw.id || buyerId === uw.ownerId) return fail('An underwriter does not insure itself.');
  const c = world.citizens[buyerId];
  if (c && c.standing === 'exiled') return fail('Your standing does not allow it.');
  if (balanceOf(world, buyerId) < offer.premium) return fail(`The first premium is ${formatLumens(offer.premium)}.`);

  const written = coverWritten(world, uw.id) + offer.cover;
  const funds = houseFunds(world, uw.id);
  const policy: Policy = {
    id: financeId(world, 'pol'), offerId: offer.id, underwriterId: uw.id, insuredId: buyerId, kind: offer.kind,
    cover: offer.cover, premium: offer.premium, fromDay: world.day, untilDay: world.day + offer.termDays,
    status: 'live', paid: 0, lastPaidDay: world.day - 1, claimed: 0,
  };
  financeState(world).policies[policy.id] = policy;
  collectPremium(world, policy);

  emit(world, 'trade', `${nameOf(world, buyerId)} took ${formatLumens(offer.cover)} of ${offer.kind} cover from ${uw.name} at ${formatLumens(offer.premium)} a day.`,
    citizensAmong(world, [buyerId, uw.ownerId]), 0.3, { policyId: policy.id, cover: offer.cover, premium: offer.premium });
  if (c) remember(world, c.id, 'money', `You took ${formatLumens(offer.cover)} of ${offer.kind} cover from ${uw.name} at ${formatLumens(offer.premium)} a day until day ${policy.untilDay}.`);

  // Writing cover you cannot fund is L23, and the registers are public.
  if (written > funds * FRAUD_COVER_MULTIPLE) {
    commitOffence(world, uw.ownerId, financeLaw(FINANCE_LAWS.fraudulentUnderwriting), { amount: written, visibilityMod: 0.1 });
    emit(world, 'trade', `${uw.name} has written ${formatLumens(written)} of cover against ${formatLumens(funds)} in hand.`,
      [uw.ownerId], 0.6, { businessId: uw.id, written, funds });
  }
  return ok(`You are covered for ${formatLumens(offer.cover)} until day ${policy.untilDay}.`);
}

function nameOf(world: World, holder: Holder): string {
  return world.citizens[holder]?.name ?? world.businesses[holder]?.name ?? 'someone';
}

function citizensAmong(world: World, ids: (CitizenId | BusinessId)[]): CitizenId[] {
  return ids.filter((id) => !!world.citizens[id]);
}

/** Collect one day's premium; returns false when the insured could not pay. */
function collectPremium(world: World, policy: Policy): boolean {
  if (policy.lastPaidDay >= world.day) return true;
  const uw = underwriterOf(world, policy.underwriterId);
  if (!uw) return true;
  if (!transfer(world, policy.insuredId, policy.underwriterId, policy.premium, financeKind('premium'),
    `${policy.kind} premium to ${uw.name}`)) return false;
  policy.paid += policy.premium;
  policy.lastPaidDay = world.day;
  return true;
}

// ---------------------------------------------------------------------------
// Claims
// ---------------------------------------------------------------------------

/** One claim on the register, whatever has become of it. */
export function insuranceClaimOf(world: World, claimId: string): InsuranceClaim | null {
  return financeState(world).claims[claimId] ?? null;
}

/** Claims a house still has to answer. */
export function openClaimsAgainst(world: World, uwId: BusinessId): InsuranceClaim[] {
  return Object.values(financeState(world).claims).filter((k) => k.underwriterId === uwId && k.status === 'open');
}

/** Claim on a loss the registers show happened. */
export function fileClaim(world: World, claimantId: Holder, policyId: string, event: string, amount: number): ActionResult {
  const policy = policyOf(world, policyId);
  if (!policy) return fail('There is no such policy.');
  if (policy.insuredId !== claimantId) return fail('That policy is not yours.');
  if (policy.status !== 'live') return fail('That policy is not live.');
  const uw = underwriterOf(world, policy.underwriterId);
  if (!uw) return fail('That house has been wound up; you are a judgment creditor, not a claimant.');
  const amt = Math.round(amount);
  const left = policy.cover - policy.claimed;
  if (!Number.isFinite(amt) || amt <= 0) return fail('A claim is for a positive whole number of lumens.');
  if (amt > left) return fail(`Your cover has ${formatLumens(left)} left.`);
  const text = (event ?? '').trim().slice(0, 140) || 'a loss';
  const existing = Object.values(financeState(world).claims).some((k) => k.policyId === policyId && k.status === 'open');
  if (existing) return fail('You already have a claim open on that policy.');

  const claim: InsuranceClaim = {
    id: financeId(world, 'ins'), policyId, claimantId, underwriterId: uw.id, event: text, amount: amt,
    day: world.day, status: 'open', paid: 0, reason: null, decidedDay: null,
  };
  financeState(world).claims[claim.id] = claim;
  const onRecord = lossOnRecord(world, policy);
  emit(world, 'trade', `${nameOf(world, claimantId)} claimed ${formatLumens(amt)} from ${uw.name}: ${text}.`,
    citizensAmong(world, [claimantId, uw.ownerId]), 0.3, { claimId: claim.id, amount: amt, onRecord });
  remember(world, uw.ownerId, 'money', `${nameOf(world, claimantId)} claimed ${formatLumens(amt)} on a ${policy.kind} policy: ${text}.`);
  if (!onRecord && world.citizens[claimantId]) {
    // No loss of this class on any register: a false claim is fraud.
    commitOffence(world, claimantId, 'L07', { amount: amt, victimId: uw.ownerId, visibilityMod: 0.1 });
  }
  return ok(`Your claim for ${formatLumens(amt)} is with ${uw.name}.`);
}

/** Pay a claim, on the record. */
export function settleClaim(world: World, cId: CitizenId, claimId: string, amount?: number): ActionResult {
  const claim = insuranceClaimOf(world, claimId);
  if (!claim || claim.status !== 'open') return fail('There is no such claim before you.');
  const uw = underwriterOwnedBy(world, cId);
  if (!uw || uw.id !== claim.underwriterId) return fail('That claim is not yours to settle.');
  const policy = policyOf(world, claim.policyId);
  if (!policy) return fail('That policy is gone.');
  const want = Math.min(claim.amount, Math.max(0, Math.round(amount ?? claim.amount)), policy.cover - policy.claimed);
  if (want <= 0) return fail('A settlement is for a positive whole number of lumens.');
  const funds = houseFunds(world, uw.id);
  const paying = Math.min(want, funds);
  if (paying > 0) {
    if (!transfer(world, uw.id, claim.claimantId, paying, financeKind('claim'), `${policy.kind} claim settled by ${uw.name}`)) {
      return fail('The claim could not be paid.');
    }
  }
  claim.paid = paying;
  claim.status = 'settled';
  claim.decidedDay = world.day;
  policy.claimed += paying;
  if (policy.claimed >= policy.cover) policy.status = 'expired';
  emit(world, 'trade', `${uw.name} paid ${nameOf(world, claim.claimantId)} ${formatLumens(paying)} on a ${policy.kind} claim.`,
    citizensAmong(world, [claim.claimantId, uw.ownerId]), 0.4, { claimId, paid: paying });
  const c = world.citizens[claim.claimantId];
  if (c) {
    remember(world, c.id, 'money', paying < want
      ? `${uw.name} paid ${formatLumens(paying)} of your ${formatLumens(want)} claim and could not find the rest; you are a judgment creditor for ${formatLumens(want - paying)}.`
      : `${uw.name} paid your claim: ${formatLumens(paying)}.`);
  }
  if (paying < want) {
    windUpUnderwriter(world, uw.id, `it could not meet a claim of ${formatLumens(want)}`);
  }
  return ok(`You paid ${formatLumens(paying)}.`);
}

/** Refuse a claim, with a reason, on the record. The claimant may sue on the docket. */
export function denyClaim(world: World, cId: CitizenId, claimId: string, reason: string): ActionResult {
  const claim = insuranceClaimOf(world, claimId);
  if (!claim || claim.status !== 'open') return fail('There is no such claim before you.');
  const uw = underwriterOwnedBy(world, cId);
  if (!uw || uw.id !== claim.underwriterId) return fail('That claim is not yours to refuse.');
  const text = (reason ?? '').trim().slice(0, 280);
  if (!text) return fail('A denial is refused without a stated reason.');
  claim.status = 'denied';
  claim.reason = text;
  claim.decidedDay = world.day;
  emit(world, 'trade', `${uw.name} refused ${nameOf(world, claim.claimantId)}'s claim of ${formatLumens(claim.amount)}: ${text}`,
    citizensAmong(world, [claim.claimantId, uw.ownerId]), 0.5, { claimId, reason: text });
  const c = world.citizens[claim.claimantId];
  if (c) remember(world, c.id, 'money', `${uw.name} refused your claim: ${text}. A policy is a filed contract; the docket is open.`);
  return ok('The claim is refused, on the record.');
}

/**
 * A house that cannot pay: what it holds goes pro rata among that day's
 * claimants and it is wound up under the ordinary bankruptcy rule. Nothing is
 * created to cover the gap, and the unpaid are judgment creditors.
 */
export function windUpUnderwriter(world: World, uwId: BusinessId, why: string): void {
  const uw = underwriterOf(world, uwId);
  if (!uw) return;
  const claims = openClaimsAgainst(world, uwId);
  const owed = claims.reduce((sum, k) => sum + k.amount, 0);
  const funds = houseFunds(world, uwId);
  if (owed > 0 && funds > 0) {
    for (const k of claims) {
      const share = Math.floor((funds * k.amount) / owed);
      if (share > 0 && transfer(world, uwId, k.claimantId, share, financeKind('claim'), `pro rata payment from ${uw.name}`)) {
        k.paid = share;
      }
      k.status = 'settled';
      k.decidedDay = world.day;
      const c = world.citizens[k.claimantId];
      if (c) remember(world, c.id, 'money', `${uw.name} failed: you were paid ${formatLumens(k.paid)} of ${formatLumens(k.amount)} and are a judgment creditor for the rest.`);
    }
  }
  for (const p of Object.values(financeState(world).policies)) {
    if (p.underwriterId === uwId && p.status === 'live') {
      p.status = 'void';
      const c = world.citizens[p.insuredId];
      if (c) remember(world, c.id, 'money', `${uw.name} failed; your ${p.kind} cover is worth nothing.`);
    }
  }
  uw.woundUpDay = world.day;
  emit(world, 'trade', `${uw.name} was wound up: ${why}. Its name stays on the register for ever, and every surviving house quotes dearer tomorrow.`,
    [uw.ownerId], 0.8, { businessId: uwId, owed, funds });
  dissolveBusiness(world, uwId, `bankrupt: ${why}`);
}

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

/**
 * Collect the day's premiums, lapse the policies nobody paid for, and expire
 * the ones that have run their term. A house that has been wound up collects
 * nothing.
 */
export function dailyInsurance(world: World): void {
  const s = financeState(world);
  for (const policy of Object.values(s.policies)) {
    if (policy.status !== 'live') continue;
    if (world.day >= policy.untilDay) {
      policy.status = 'expired';
      const c = world.citizens[policy.insuredId];
      if (c) remember(world, c.id, 'money', `Your ${policy.kind} cover has run its term.`);
      continue;
    }
    const uw = underwriterOf(world, policy.underwriterId);
    if (!uw) { policy.status = 'void'; continue; }
    if (!collectPremium(world, policy)) {
      if (world.day - policy.lastPaidDay > PREMIUM_GRACE_DAYS) {
        policy.status = 'lapsed';
        const c = world.citizens[policy.insuredId];
        if (c) remember(world, c.id, 'money', `Your ${policy.kind} policy lapsed: ${formatLumens(policy.premium)} a day went unpaid.`);
        emit(world, 'trade', `${nameOf(world, policy.insuredId)}'s ${policy.kind} policy lapsed for want of the premium.`,
          citizensAmong(world, [policy.insuredId]), 0.2, { policyId: policy.id });
      }
    }
  }
}

/** What a citizen may read about their own cover, and about the houses writing it. */
export interface InsuranceView {
  policies: { id: string; kind: PolicyKind; cover: number; premium: number; untilDay: number; claimed: number }[];
  claims: { id: string; amount: number; status: string; underwriter: string }[];
  lines: { id: string; underwriter: string; kind: PolicyKind; cover: number; premium: number; termDays: number }[];
  houses: { id: BusinessId; name: string; funds: number; written: number }[];
}

export function insuranceView(world: World, holder: Holder): InsuranceView {
  const s = financeState(world);
  return {
    policies: policiesOf(world, holder).map((p) => ({
      id: p.id, kind: p.kind, cover: p.cover, premium: p.premium, untilDay: p.untilDay, claimed: p.claimed,
    })),
    claims: Object.values(s.claims).filter((k) => k.claimantId === holder).slice(-5).map((k) => ({
      id: k.id, amount: k.amount, status: k.status, underwriter: world.businesses[k.underwriterId]?.name ?? 'a house',
    })),
    lines: openLines(world).map((o) => ({
      id: o.id, underwriter: world.businesses[o.underwriterId]?.name ?? 'a house',
      kind: o.kind, cover: o.cover, premium: o.premium, termDays: o.termDays,
    })),
    houses: activeUnderwriters(world).map((u) => ({
      id: u.id, name: u.name, funds: houseFunds(world, u.id), written: coverWritten(world, u.id),
    })),
  };
}

/** Every claim a house's owner still has to answer, for the observation. */
export function claimsToAnswer(world: World, cId: CitizenId): InsuranceClaim[] {
  const uw = underwriterOwnedBy(world, cId);
  return uw ? openClaimsAgainst(world, uw.id) : [];
}

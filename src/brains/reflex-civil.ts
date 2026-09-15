/**
 * The reflex brain's civil life (`docs/CIVIL.md`): what a scripted citizen
 * does with an instrument, a docket, a guild and a patron.
 *
 * Nothing here is a strategy the engine hands anybody. Every step reads the
 * citizen's own situation and the same public register any other mind can
 * read — what the counterparty's record says, what the deal is worth at
 * today's prices, what a suit would cost against what it might win — and
 * answers the question that situation actually poses. §9 of the doc is the
 * shape of it: *a reflex citizen offers a contract only where the deal clears
 * at today's prices and the counterparty's breached count is zero or old; it
 * performs while performing is cheaper than the penalty and breaches when it
 * is not.*
 *
 * A breach costs nothing here and never will. What it costs is the next
 * citizen who reads the record before deciding whether to sign, which is
 * exactly what `counterpartyRisk` is.
 */
import type { Action, CitizenId, World } from '../types.ts';
import { PROFESSIONS } from '../types.ts';
import { chance } from '../util/rng.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { contractRecordOf } from '../civil/state.ts';
import {
  activeContractsOf, allContracts, contractById, currentPeriod, isPerformed, obligorOf, offersBy, offersTo,
  outstandingConsideration, periodDueDay, periodsOutstanding,
} from '../civil/terms.ts';
import { variationsTo } from '../civil/amend.ts';
import { liveEscrows } from '../civil/escrow.ts';
import { suitFee, suitsAgainst, suitsBy, sittingSuits } from '../civil/docket.ts';
import { CIVIL_THRESHOLD, assessDamages, civilBelief, meritOf } from '../civil/merit.ts';
import { judgmentsFor, outstanding } from '../civil/enforcement.ts';
import { arbitrationOffersTo, arbitrationsFor, detectArbiterBribery } from '../civil/arbitration.ts';
import { EXAMINATION_FEE, GUILD_FOUNDING_COST, MASTER_SKILL, PROFESSION_SKILL, allGuilds, guildFor, passMark } from '../civil/licences.ts';
import { guildsOf, markFor } from '../civil/guilds.ts';
import { patronageOf } from '../civil/patronage.ts';
import { mayContract } from '../civil/common.ts';
import { heldJob } from '../actions/execute.ts';
import type { Ctx } from './reflex-util.ts';

/** Days an employment term is offered for: two cycles of a fortnight's work. */
export const TERM_DAYS = 14;
/** A patron keeps this many times the whole stipend in hand before offering one. */
export const PATRON_COVER = 2;
/** Below this the docket is not worth opening: the fee eats the claim. */
export const WORTH_SUING = 3;
/** A settlement offer: what a defendant who expects to lose offers to end it. */
export const SETTLE_SHARE = 0.6;
/** And what a plaintiff will take rather than wait for a bench. */
export const ACCEPT_SHARE = 0.45;
/** What a plaintiff holds out for when the record reads plainly theirs. */
export const HOLD_OUT_SHARE = 0.85;
/** A merit reading at or above this is a record a plaintiff would rather show a judge. */
export const STRONG_RECORD = 0.6;
/** And a reading at or above this is one a defendant reads as already lost. */
export const HOPELESS = 0.7;
/** Marks an instrument carries (`civil/terms.ts MAX_WITNESSES`). */
const MAX_MARKS = 3;
/** Breaches on the public record before a guild's masters move to strike a mark. */
export const STRIKE_OFF_BREACHES = 3;
/** A breach older than a cycle is old news; §9's "zero or old". */
export const RECENT_BREACH_DAYS = 28;
/** Lumens in hand before a citizen commissions a piece from a maker. */
export const COMMISSION_WALLET = 250;
/** And the hand it commissions from: somebody who can actually make the thing. */
export const COMMISSION_SKILL = 45;

/**
 * What the register says about signing with this citizen: breaches inside the
 * last cycle, and judgments that were never satisfied. Zero is a clean record.
 *
 * `CIVIL.md` §9 is exact about the reading — *the counterparty's breached
 * count is zero **or old*** — and the "or old" is the whole difference between
 * a record and a sentence. A citizen who broke a term in a bad fortnight two
 * months ago is somebody the city will deal with again; one who broke three
 * this month is not. Nothing here is a penalty: it is what the next citizen
 * makes of a public line, which is all a breach has ever cost anybody.
 */
export function counterpartyRisk(world: World, cId: CitizenId): number {
  const since = world.day - RECENT_BREACH_DAYS;
  let recent = 0;
  for (const k of allContracts(world)) {
    if (k.breachedById !== cId || k.breachedDay === null) continue;
    if (k.breachedDay >= since) recent += 1;
  }
  return recent + contractRecordOf(world, cId).judgments.unsatisfied;
}

/** Nothing recent against them, and something kept. */
function trustworthy(world: World, cId: CitizenId): boolean {
  return counterpartyRisk(world, cId) === 0;
}

/** Whether the register has ever seen this citizen keep an instrument to term. */
function tested(world: World, cId: CitizenId): boolean {
  return allContracts(world).some((k) => k.status === 'kept' && (k.offerorId === cId || k.offereeId === cId));
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/**
 * Discharge what is due. A period is performed while performing is cheaper
 * than the penalty and while the lumens are actually there; where they are
 * not, the instrument goes into breach at the rollover and the other side may
 * sue or not.
 */
function tryPerform(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('perform_contract')) return null;
  for (const k of activeContractsOf(world, c.id)) {
    if (obligorOf(k) !== c.id) continue;
    const period = currentPeriod(world, k);
    if (isPerformed(k, period) || world.day < periodDueDay(k, period)) continue;
    // An employment term is discharged by working the shift it is for; the
    // shift itself is the job's, so there is nothing to do until it is worked.
    if (k.kind === 'employment' && c.shiftsToday <= 0) continue;
    const owed = k.kind === 'commission' ? Math.round(k.consideration / 2) : k.consideration;
    const pays = k.kind === 'lease' || k.kind === 'loan' || k.kind === 'forward' || k.kind === 'apprenticeship'
      || k.kind === 'patronage' || k.kind === 'commission';
    if (pays && c.wallet < owed) {
      // Not enough to pay it. Where the penalty is worth less than what is
      // owed, letting it lapse is the cheaper answer and the citizen takes it.
      continue;
    }
    return { type: 'perform_contract', contractId: k.id };
  }
  return null;
}

/** Offers on the table, weighed on what they are worth and who is offering. */
function tryAnswerOffers(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const offers = offersTo(world, c.id);
  if (offers.length === 0) return null;
  for (const k of offers) {
    const key = `offerWeighed:${c.id}:${k.id}`;
    if (world.counters[key] === world.day) continue;
    world.counters[key] = world.day;
    const risky = !trustworthy(world, k.offerorId);
    const fee = k.fee;
    if (k.kind === 'patronage') {
      // A stipend for making things: taken where the patron's record is clean
      // and the filing fee is not more than the first days of it.
      if (!risky && c.wallet >= fee && k.consideration * k.days > fee * 2 && ctx.can.has('accept_patronage')) {
        return { type: 'accept_patronage', offerId: k.id };
      }
      return { type: 'close_offer', offerId: k.id };
    }
    if (!ctx.can.has('accept_contract')) continue;
    if (risky || c.wallet < fee * 2) return { type: 'close_offer', offerId: k.id };
    if (k.kind === 'employment') {
      // The post cannot be cut nor the wage lowered inside the term: worth
      // having while the wage is at least what the job pays today.
      const job = heldJob(world, c);
      const wage = job ? Math.max(world.government.minWage, job.wage) : world.government.minWage;
      if (k.consideration + 1 < wage) return { type: 'close_offer', offerId: k.id };
      return { type: 'accept_contract', offerId: k.id };
    }
    if (k.kind === 'loan') {
      // Borrowed money is worth the instalments while there is something the
      // citizen actually needs it for.
      if (c.wallet > k.consideration * k.periods) return { type: 'close_offer', offerId: k.id };
      return { type: 'accept_contract', offerId: k.id };
    }
    if (k.kind === 'apprenticeship') {
      // Skill grows at twice the rate under an indenture, which is worth
      // 60 % of the wage floor to somebody with neither a post nor the trade.
      if (ctx.job !== null) return { type: 'close_offer', offerId: k.id };
      return { type: 'accept_contract', offerId: k.id };
    }
    return { type: 'accept_contract', offerId: k.id };
  }
  return null;
}

/**
 * An owner puts the terms of a post in writing: the wage cannot be cut and
 * the post cannot be taken away inside the term, which is what makes it worth
 * a filing fee to the worker and worth a good hand to the owner.
 */
function tryOfferTerms(ctx: Ctx): Action | null {
  const { world, c, biz } = ctx;
  if (!biz || !ctx.can.has('offer_contract') || biz.employees.length === 0) return null;
  if (biz.daysNegative > 0) return null;
  for (const id of biz.employees) {
    const worker = world.citizens[id];
    const job = worker ? heldJob(world, worker) : null;
    if (!worker || !job || !mayContract(world, worker)) continue;
    const wage = Math.max(world.government.minWage, job.wage);
    // The till has to carry half the term at today's prices before an owner
    // will promise the other half of it, and the hand has to be one the
    // register says keeps its word.
    if (biz.treasury < wage * (TERM_DAYS / 2)) continue;
    if (!trustworthy(world, worker.id)) continue;
    const already = activeContractsOf(world, c.id)
      .some((k) => k.kind === 'employment' && (k.offereeId === worker.id));
    const offered = offersTo(world, worker.id).some((k) => k.offerorId === c.id);
    if (already || offered) continue;
    const key = `termsWeighed:${c.id}:${worker.id}`;
    if (world.counters[key] === world.day) continue;
    world.counters[key] = world.day;
    if (!chance(world, 0.4)) return null;
    return {
      type: 'offer_contract', to: worker.id, kind: 'employment',
      terms: `${job.title} at ${biz.name}, ${wage} ℓ a shift, the post held for the term`,
      consideration: wage, days: TERM_DAYS, penalty: wage * 2, notice: 3,
    };
  }
  return null;
}

/**
 * A hand to somebody who has run out. No licence is needed under 200 ℓ, the
 * instalments come back out of wages like any other loan, and what the lender
 * is really weighing is whether this is somebody whose word the register says
 * is good — because if it is not, the whole of the remedy is a docket that
 * costs money to open.
 */
function tryLendToFriend(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('offer_contract') || c.wallet < 400) return null;
  for (const o of ctx.here) {
    if (o.lifeStage === 'child' || bondBetween(world, c.id, o.id) < 40) continue;
    if (o.wallet > 25 || o.loanId || !mayContract(world, o)) continue;
    if (!trustworthy(world, o.id)) continue;
    if (offersTo(world, o.id).some((k) => k.offerorId === c.id)) continue;
    if (activeContractsOf(world, o.id).some((k) => k.kind === 'loan')) continue;
    const key = `lendWeighed:${c.id}:${o.id}`;
    if (world.counters[key] === world.day) continue;
    world.counters[key] = world.day;
    if (!chance(world, 0.2 + c.personality.sociability * 0.2)) return null;
    const instalment = Math.max(2, Math.round(world.government.minWage / 2));
    return {
      type: 'offer_contract', to: o.id, kind: 'loan',
      terms: `${instalment * 7} ℓ now, paid back at ${instalment} ℓ a day for a week`,
      consideration: instalment, days: 7, penalty: instalment * 2, notice: 0,
    };
  }
  return null;
}

/**
 * A piece made to order. Every other instrument on this ladder is somebody's
 * work or somebody's money; a commission is the one an ordinary citizen enters
 * because it *wants* something — a maker it knows, a price it can carry, half
 * down at the table and half when the work is delivered (`CIVIL.md` §3).
 *
 * It is also the only instrument in a scripted citizen's week where the money
 * goes out before the thing arrives, which is what an escrow is for and why
 * `tryEscrow` below has anything to weigh at all.
 */
function tryCommission(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('offer_contract') || c.wallet < COMMISSION_WALLET) return null;
  // A reason to want one: an empty shelf at home, or money and a taste for
  // made things. Not every hour, and never twice at once.
  if (!(c.needs.comfort < 60 || (c.wallet > COMMISSION_WALLET * 2 && c.personality.curiosity > 0.5))) return null;
  if (activeContractsOf(world, c.id).some((k) => k.kind === 'commission')) return null;
  for (const o of ctx.here) {
    if (o.lifeStage === 'child' || !mayContract(world, o)) continue;
    if (bondBetween(world, c.id, o.id) < 20) continue;
    if (Math.max(o.skills.crafting, o.skills.artistry) < COMMISSION_SKILL) continue;
    if (offersTo(world, o.id).some((k) => k.offerorId === c.id)) continue;
    const key = `commissionWeighed:${c.id}:${o.id}`;
    if (world.day - (world.counters[key] ?? -TERM_DAYS) < TERM_DAYS) continue;
    world.counters[key] = world.day;
    if (!chance(world, 0.15 + c.personality.curiosity * 0.15)) return null;
    const price = Math.max(20, Math.min(80, Math.round(c.wallet / 8)));
    return {
      type: 'offer_contract', to: o.id, kind: 'commission',
      terms: `a piece made to order, ${price} ℓ: half at the table and half on delivery`,
      consideration: price, days: 3, penalty: Math.round(price / 2), notice: 0,
    };
  }
  return null;
}

/**
 * A mark on somebody else's instrument, for the 2 ℓ the offeror pays: taken
 * from people this citizen knows, and never from a stranger.
 */
function tryWitness(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('witness_contract')) return null;
  for (const o of ctx.here) {
    if (bondBetween(world, c.id, o.id) < 20) continue;
    for (const k of offersBy(world, o.id)) {
      if (k.witnesses.length >= MAX_MARKS || k.witnesses.includes(c.id)) continue;
      if (k.offereeId === c.id) continue;
      // An instrument carries three marks and is witnessed before it is
      // formed, so whoever means to put one on it says so here: otherwise
      // four citizens walk to the same table in the same hour and three of
      // them waste it. One counter per instrument, and it never outlives the
      // three marks the instrument can carry.
      const claim = `witnessClaim:${k.id}`;
      if ((world.counters[claim] ?? 0) >= MAX_MARKS) continue;
      const key = `witnessWeighed:${c.id}:${k.id}`;
      if (world.counters[key]) continue;
      world.counters[key] = 1;
      if (!chance(world, 0.5)) continue;
      world.counters[claim] = (world.counters[claim] ?? 0) + 1;
      return { type: 'witness_contract', offerId: k.id };
    }
  }
  return null;
}

/**
 * Notice, where the deal has stopped being one. An employer whose till has
 * been empty for days ends the term it can no longer pay rather than breaching
 * it, and a patron who can no longer carry the stipend does the same.
 */
function tryNotice(ctx: Ctx): Action | null {
  const { world, c, biz } = ctx;
  if (!ctx.can.has('terminate_contract')) return null;
  for (const k of activeContractsOf(world, c.id)) {
    if (k.noticeById !== null) continue;
    const owed = obligorOf(k) === c.id;
    if (!owed) continue;
    const cannotPay = k.kind === 'patronage'
      ? c.wallet < k.consideration * 2
      : k.kind === 'employment' && biz !== null && biz.daysNegative >= 2;
    if (!cannotPay) continue;
    return { type: 'terminate_contract', contractId: k.id };
  }
  return null;
}

/** New terms on a running instrument, where the old ones have stopped fitting. */
function tryVariation(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('accept_variation')) {
    for (const v of variationsTo(world, c.id)) {
      const k = contractById(world, v.contractId);
      if (!k) continue;
      const key = `variationWeighed:${c.id}:${v.id}`;
      if (world.counters[key]) continue;
      world.counters[key] = 1;
      // Worse terms are still better than the instrument breaking, unless what
      // is left of it is worth less than the penalty for walking away.
      const worse = v.consideration !== null && obligorOf(k) !== c.id && v.consideration < k.consideration;
      if (!worse || outstandingConsideration(k) <= k.penalty) return { type: 'accept_variation', variationId: v.id };
    }
  }
  if (!ctx.can.has('propose_variation') || !ctx.biz) return null;
  // A till in the red asks the term down to the floor rather than breaking it.
  if (ctx.biz.daysNegative < 2) return null;
  const floor = world.government.minWage;
  for (const k of activeContractsOf(world, c.id)) {
    if (k.kind !== 'employment' || k.offerorId !== c.id || k.consideration <= floor) continue;
    if (k.variations.some((v) => v.status === 'offered')) continue;
    return {
      type: 'propose_variation', contractId: k.id,
      terms: `the wage to the minimum of ${floor} ℓ while the till is empty`, consideration: floor,
    };
  }
  return null;
}

/** A sum lodged where the other side's record says it might be needed. */
function tryEscrow(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('release_escrow')) {
    for (const e of liveEscrows(world)) {
      if (e.depositorId !== c.id) continue;
      const k = contractById(world, e.contractId);
      // Released when the other side has done what it was lodged against.
      if (k && (k.status === 'kept' || periodsOutstanding(k) === 0)) return { type: 'release_escrow', escrowId: e.id };
    }
  }
  if (!ctx.can.has('open_escrow')) return null;
  for (const k of activeContractsOf(world, c.id)) {
    if (k.kind !== 'forward' && k.kind !== 'commission') continue;
    if (obligorOf(k) === c.id) continue;
    const other = k.offerorId === c.id ? k.offereeId : k.offerorId;
    // A sum promised before the thing arrives is lodged where neither side can
    // reach it — unless the register already answers for the other party. A
    // clean record is not enough: it has to be a record. Somebody who has
    // never yet kept an instrument is not untrustworthy, they are untested,
    // and an untested word is exactly what the Exchange holds a sum against.
    if (trustworthy(world, other) && tested(world, other)) continue;
    const sum = k.consideration;
    if (c.wallet < Math.round(sum * 1.02) + 50) continue;
    if (liveEscrows(world).some((e) => e.contractId === k.id)) continue;
    return { type: 'open_escrow', contractId: k.id, holder: 'exchange', amount: sum };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The docket
// ---------------------------------------------------------------------------

/** What a suit on this breach would be worth: the sum outstanding and its penalty. */
function worthSuing(k: { penalty: number; consideration: number; periods: number; performances: unknown[] }): number {
  const outstandingSum = k.consideration * Math.max(0, k.periods - k.performances.length);
  return outstandingSum + k.penalty;
}

/**
 * Sue, or let it go. Most breaches are never sued on, because suing costs
 * money and the relationship is worth more — so this asks for a filed
 * instrument, a sum worth three times the fee, and a bond that has already
 * gone.
 */
function trySue(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('file_suit')) return null;
  for (const k of allContracts(world)) {
    if (k.status !== 'breached' || k.breachedById === c.id) continue;
    if (k.offerorId !== c.id && k.offereeId !== c.id) continue;
    const defendant = k.breachedById;
    if (!defendant || !world.citizens[defendant]) continue;
    const key = `suitWeighed:${c.id}:${k.id}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    const claim = worthSuing(k);
    const fee = suitFee(world, claim);
    if (claim < fee * WORTH_SUING || c.wallet < fee * 2) continue;
    // A friend is given the benefit of the doubt; a stranger is not.
    if (bondBetween(world, c.id, defendant) > 40 && chance(world, 0.7)) continue;
    if (suitsBy(world, c.id).some((s) => s.contractId === k.id && s.status !== 'judged')) continue;
    return {
      type: 'file_suit', defendant, contractId: k.id, damages: claim,
      claim: `${world.citizens[defendant]?.name ?? defendant} did not do what ${k.id} says: ${k.terms}`,
    };
  }
  return null;
}

/** Answer what has been filed against you: admit what is true, deny what is not. */
function tryAnswer(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('answer_suit')) return null;
  for (const s of suitsAgainst(world, c.id)) {
    if (s.plea !== null || (s.status !== 'filed' && s.status !== 'in_session')) continue;
    const k = s.contractId ? contractById(world, s.contractId) : null;
    const mine = k && k.breachedById === c.id;
    // An admission decides the suit where it stands, at the cap: no bench, no
    // argument, and the whole sum claimed. That is the cheaper answer to a
    // small, true claim and the dearer one to anything worth arguing about —
    // so what is admitted is what a citizen could pay out of a quarter of its
    // wallet, and everything above that goes to a bench and the record.
    const trifling = s.damages <= Math.max(20, Math.round(c.wallet / 4));
    if (mine && trifling && c.personality.honesty > 0.6) {
      return { type: 'answer_suit', suitId: s.id, plea: 'admit', text: 'It is as they say; I could not pay it.' };
    }
    return {
      type: 'answer_suit', suitId: s.id, plea: 'deny',
      text: k
        ? `I say ${k.id} was performed as it stands, or that what is claimed is more than it was ever worth.`
        : 'I say there was no such agreement between us.',
    };
  }
  return null;
}

/** Settle before judgment: cheaper than a bench, and neither kept nor breached. */
function trySettle(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('accept_settlement')) {
    for (const s of [...suitsBy(world, c.id), ...suitsAgainst(world, c.id)]) {
      const offer = s.offer;
      if (!offer || offer.byId === c.id || (s.status !== 'filed' && s.status !== 'in_session')) continue;
      if (s.plaintiffId === c.id) {
        // A plaintiff takes a bird in the hand — unless the record is plainly
        // theirs, in which case the bench is worth waiting two days for.
        const strong = meritOf(world, s).merit >= STRONG_RECORD;
        const enough = offer.amount >= s.damages * (strong ? HOLD_OUT_SHARE : ACCEPT_SHARE);
        if (enough) return { type: 'accept_settlement', suitId: s.id };
        continue;
      }
      if (offer.amount <= s.damages * SETTLE_SHARE) return { type: 'accept_settlement', suitId: s.id };
    }
  }
  if (!ctx.can.has('settle')) return null;
  for (const s of suitsAgainst(world, c.id)) {
    if (s.status !== 'filed' && s.status !== 'in_session') continue;
    if (s.offer && s.offer.byId === c.id) continue;
    const key = `settleWeighed:${c.id}:${s.id}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    // A defendant who reads the record against them offers rather than waits —
    // and only where the offer is one they could actually carry twice over.
    // Anybody else takes their chances with the bench, which is what a bench
    // is for.
    const merit = civilBelief(world, c.id, s);
    // What it is worth offering: a defendant who reads the record as merely
    // against them offers three fifths, and one who reads it as hopeless
    // offers nearly the whole claim, because the alternative is the whole
    // claim plus the plaintiff's fee.
    const share = merit > HOPELESS ? HOLD_OUT_SHARE : SETTLE_SHARE;
    const amount = Math.round(s.damages * share);
    if (merit > CIVIL_THRESHOLD && c.wallet >= amount * 2) return { type: 'settle', suitId: s.id, amount };
  }
  return null;
}

/**
 * A judge sitting on the civil docket. Civil belief clears a half, not 0.55,
 * and the question is which of the two is more likely right; the sum is the
 * arithmetic of `CIVIL.md` §4 and never the judge's mood.
 */
function tryJudgeCivil(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('judge_civil')) return null;
  for (const s of sittingSuits(world)) {
    if (!s.judges.includes(c.id) || s.votes.some((v) => v.judgeId === c.id)) continue;
    const belief = civilBelief(world, c.id, s);
    if (belief > CIVIL_THRESHOLD) {
      const assessed = assessDamages(world, s);
      // A struck-off member asking to be put back is asking for one thing to
      // be done, and the docket can order it done.
      const order = s.guildId ? 'performance' : 'damages';
      return {
        type: 'judge_civil', suitId: s.id, finding: 'plaintiff', damages: assessed.award, order,
        reason: `The record reads for the plaintiff at ${Math.round(belief * 100)} of 100`
          + `${assessed.mitigated ? ', less what they could have avoided and did not' : ''}.`,
      };
    }
    const merit = s.merit;
    return {
      type: 'judge_civil', suitId: s.id, finding: merit < 0.25 ? 'dismissed' : 'defendant', damages: 0, order: 'none',
      reason: merit < 0.25
        ? 'There is nothing on the record to hear: the claim is dismissed.'
        : `The record does not reach a half against the defendant (${Math.round(belief * 100)} of 100).`,
    };
  }
  return null;
}

/** A creditor who has waited the three days asks the Treasury to collect. */
function tryEnforce(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('enforce_judgment')) return null;
  for (const j of judgmentsFor(world, c.id)) {
    if (outstanding(j) <= 0 || j.enforcedDay !== null || world.day < j.dueDay) continue;
    // A debtor who is plainly trying is given a little longer by a friend.
    if (bondBetween(world, c.id, j.debtorId) > 40 && world.day < j.dueDay + 3) continue;
    return { type: 'enforce_judgment', judgmentId: j.id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Arbitration
// ---------------------------------------------------------------------------

/**
 * The cheap way, where the sum is small and there is somebody both sides know.
 * The award is enforced like a judgment and there is no appeal, which is what
 * the two of them are buying.
 */
function tryArbitration(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('accept_arbitration')) {
    for (const a of arbitrationOffersTo(world, c.id)) {
      const key = `arbWeighed:${c.id}:${a.id}`;
      if (world.counters[key]) continue;
      world.counters[key] = 1;
      const half = Math.round(a.fee / 2);
      if (c.wallet >= half * 3) return { type: 'accept_arbitration', offerId: a.id };
      return { type: 'close_offer', offerId: a.id };
    }
  }
  if (ctx.can.has('arbitrate')) {
    for (const a of arbitrationsFor(world, c.id)) {
      if (a.status !== 'bound') continue;
      // An arbiter who has taken anything from a side but its half of the fee
      // knows its award is void before it opens its mouth (`CIVIL.md` §8), and
      // it knows it because the money was paid to *it*. Without this the
      // arbiter walks to the table every hour of every remaining day to make
      // an award the register will not accept: 226 wasted hours in sixty days
      // on one seed, all of them the same disqualified arbiter.
      if (detectArbiterBribery(world, a.id)) continue;
      // And one attempt a day whatever the reason it fails: a decision refused
      // this morning is refused this afternoon too.
      const tried = `arbTried:${c.id}:${a.id}`;
      if (world.counters[tried] === world.day) continue;
      world.counters[tried] = world.day;
      // The arbiter reads the same register anybody can: what the instrument
      // the dispute names says, and whether it is in breach.
      const named = /\b(ct_\d+)\b/.exec(a.about);
      const k = named ? contractById(world, named[1]) : null;
      const award = k && k.status === 'breached' && k.breachedById === a.respondentId
        ? Math.min(outstandingConsideration(k) + k.penalty, 2 * outstandingConsideration(k))
        : 0;
      return {
        type: 'arbitrate', disputeId: a.id, award,
        reason: award > 0
          ? `The register shows ${named?.[1]} in breach; the sum outstanding and its penalty are the award.`
          : 'The register shows nothing owed either way; each side keeps what it has and the fee is spent.',
      };
    }
  }
  if (!ctx.can.has('offer_arbitration')) return null;
  // A small breach, somebody both of them know, and a bond worth keeping.
  for (const k of allContracts(world)) {
    if (k.status !== 'breached' || k.breachedById === c.id) continue;
    if (k.offerorId !== c.id && k.offereeId !== c.id) continue;
    const other = k.breachedById;
    if (!other || !world.citizens[other]) continue;
    const sum = outstandingConsideration(k) + k.penalty;
    // The cheap way: a sum too small to be worth a bench, or a counterparty
    // whose custom is worth more than the difference between the two.
    const small = sum < suitFee(world, sum) * WORTH_SUING;
    const worthKeeping = bondBetween(world, c.id, other) > 20;
    if (sum <= 0 || !(small || worthKeeping)) continue;
    const key = `arbOffered:${c.id}:${k.id}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    const arbiter = ctx.here.find((o) => o.id !== other && bondBetween(world, c.id, o.id) > 20
      && bondBetween(world, other, o.id) > 0 && o.lifeStage !== 'child');
    if (!arbiter) continue;
    const fee = Math.min(40, Math.max(10, Math.round(sum / 4)));
    if (c.wallet < fee) continue;
    return { type: 'offer_arbitration', with: other, about: `the breach of ${k.id}: ${k.terms}`, arbiter: arbiter.id, fee };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The guilds
// ---------------------------------------------------------------------------

/**
 * A licence is worth what it reserves: the four trades that carry a public
 * risk. A master founds the guild its trade has not got, marks a candidate it
 * has watched work, and sits the examination it has the skill for.
 */
function tryGuild(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (ctx.can.has('sit_examination')) {
    for (const g of allGuilds(world)) {
      if (g.members.includes(c.id) || !markFor(g, c.id)) continue;
      const held = Math.floor(c.skills[PROFESSION_SKILL[g.profession]]);
      // The fee buys the sitting and not the result, so nobody sits under the bar.
      if (held < passMark(world, g.profession) || c.wallet < EXAMINATION_FEE * 2) continue;
      return { type: 'sit_examination', guildId: g.id };
    }
  }
  if (ctx.can.has('certify')) {
    // `certify` marks for the first guild this master is a master of, so the
    // candidate is weighed against that guild's bar and nobody else's.
    const mine = guildsOf(world, c.id).filter((g) => g.masters.includes(c.id)).slice(0, 1);
    for (const g of mine) {
      const bar = passMark(world, g.profession);
      for (const o of ctx.here) {
        if (o.lifeStage === 'child' || g.members.includes(o.id) || markFor(g, o.id)) continue;
        if (Math.floor(o.skills[PROFESSION_SKILL[g.profession]]) < bar) continue;
        if (bondBetween(world, c.id, o.id) < 0) continue;
        // One mark to a candidate: another master of the same guild may have
        // reached for the same hand this hour, and a second mark is refused.
        const claimed = `certifyClaimed:${g.id}:${o.id}`;
        if (world.counters[claimed] === world.day) continue;
        const key = `certifyWeighed:${c.id}:${o.id}`;
        if (world.counters[key] === world.day) continue;
        world.counters[key] = world.day;
        world.counters[claimed] = world.day;
        return { type: 'certify', candidate: o.id };
      }
    }
  }
  if (ctx.can.has('revoke_licence')) {
    for (const g of guildsOf(world, c.id).filter((x) => x.masters.includes(c.id))) {
      for (const id of g.members) {
        if (id === c.id || !world.citizens[id]) continue;
        // A mark is the city's word that this citizen's work can be trusted.
        // Taking it back is the gravest thing a guild does to its own, so it
        // asks for a record nobody can read as bad luck — three adjudicated
        // breaches or unsatisfied judgments — and a master who has already
        // moved it this cycle does not move it again.
        if (counterpartyRisk(world, id) < STRIKE_OFF_BREACHES) continue;
        const key = `revokeVoted:${c.id}:${id}:${world.government.cycle}`;
        if (world.counters[key]) continue;
        world.counters[key] = 1;
        return {
          type: 'revoke_licence', citizen: id,
          reason: `the register shows ${counterpartyRisk(world, id)} adjudicated breaches against this mark`,
        };
      }
    }
  }
  if (!ctx.can.has('found_guild')) return null;
  if (c.personality.ambition < 0.5 || c.wallet < GUILD_FOUNDING_COST * 1.2) return null;
  for (const profession of PROFESSIONS) {
    if (guildFor(world, profession)) continue;
    if (c.skills[PROFESSION_SKILL[profession]] < MASTER_SKILL) continue;
    if (!chance(world, 0.25)) return null;
    return { type: 'found_guild', profession };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Patronage
// ---------------------------------------------------------------------------

/**
 * What a fortune can buy that repute cannot: a citizen's whole attention, and
 * their name beside yours on everything they make afterwards.
 */
function tryPatronage(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('offer_patronage')) return null;
  const perDay = Math.max(3, Math.round(world.government.minWage / 2));
  const days = TERM_DAYS;
  if (c.wallet < perDay * days * PATRON_COVER) return null;
  if (c.personality.ambition < 0.4 && c.personality.curiosity < 0.5) return null;
  for (const o of ctx.here) {
    if (o.lifeStage === 'child' || bondBetween(world, c.id, o.id) < 20) continue;
    if (!mayContract(world, o)) continue;
    const job = heldJob(world, o);
    const maker = job && (job.role === 'artist' || job.role === 'performer' || job.role === 'journalist' || job.role === 'researcher');
    // Somebody who makes things, or somebody with nothing else to do it with.
    if (!maker && (job !== null || o.skills.artistry < 40)) continue;
    if (patronageOf(world, o.id)) continue;
    const key = `patronWeighed:${c.id}:${o.id}`;
    if (world.counters[key] === world.day) continue;
    world.counters[key] = world.day;
    if (!chance(world, 0.2)) return null;
    return {
      type: 'offer_patronage', to: o.id, perDay, days,
      subject: chance(world, 0.5) ? 'something of this city' : undefined,
    };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The ladder's two steps
// ---------------------------------------------------------------------------

/**
 * What a citizen owes today and what has been put to it: performance first,
 * because it is an obligation with a date on it, then the answers other
 * people are waiting for.
 */
export function tryObligations(ctx: Ctx): Action | null {
  return tryPerform(ctx) ?? tryAnswer(ctx) ?? tryJudgeCivil(ctx) ?? tryAnswerOffers(ctx) ?? tryVariation(ctx);
}

/**
 * And what a citizen might start: a term in writing, a mark on somebody's
 * instrument, a suit, an arbitration, a guild, a stipend.
 */
export function tryCivilLife(ctx: Ctx): Action | null {
  return trySettle(ctx) ?? tryEnforce(ctx) ?? tryNotice(ctx) ?? tryEscrow(ctx) ?? tryArbitration(ctx)
    ?? trySue(ctx) ?? tryOfferTerms(ctx) ?? tryLendToFriend(ctx) ?? tryCommission(ctx) ?? tryWitness(ctx)
    ?? tryGuild(ctx) ?? tryPatronage(ctx);
}

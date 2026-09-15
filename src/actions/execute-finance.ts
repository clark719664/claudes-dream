/**
 * The finance half of the action table (`docs/FINANCE.md` §9): the city's
 * paper, the counter at the Lantern Bank, the houses that write cover and the
 * pots that pass it round, dispatched to the module that owns each of them.
 *
 * `dispatchFinance` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `financeActions` adds
 * to the set `availableActions` is built from: a guide, never a promise.
 *
 * Two notes on who may act. `repudiate` is the Council's (`FINANCE.md` §3), so
 * it is refused to anybody who is not sitting on it; the four-of-five
 * threshold has no machinery outside a proposal, so what stands here is the
 * office and the public record of who did it. `offer_restructure` is the
 * Mayor's or a councillor's for the same reason, and the module itself checks
 * that too.
 */
import type { Action, ActionResult, ActionType, Citizen, World } from '../types.ts';
import { isCouncillor } from '../government/council.ts';
import { bidBond, holdingsOf, openAuctions, outstandingIssues } from '../finance/bonds.ts';
import { buyBond, openOffers, sellBond } from '../finance/secondary.ts';
import { offerRestructure, repudiate, restructureOf, voteRestructure } from '../finance/debt.ts';
import {
  COUNTER_HOURS, bankOpenNow, bankSuspended, depositLumens, depositOf, hasBankersLicence, isBankOfficer,
  setDepositRate, setLendingRate, withdrawLumens,
} from '../finance/bank.ts';
import { callLoan } from '../finance/credit.ts';
import { UNDERWRITER_CAPITAL, UNDERWRITER_FEE, foundUnderwriter, underwriterOwnedBy } from '../finance/houses.ts';
import {
  buyPolicy, claimsToAnswer, denyClaim, fileClaim, offerPolicy, openLines, policiesOf, settleClaim,
} from '../finance/insurance.ts';
import {
  MUTUAL_FEE, allMutuals, claimAid, foundMutual, joinMutual, mutualFor, payDues, potOfMutual, voteAid,
} from '../finance/mutual.ts';
import { openClaimsOf } from '../finance/pot.ts';

/** Carry out one finance action; null means the caller's switch owns it. */
export function dispatchFinance(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    // The city's paper
    case 'bid_bond': return bidBond(world, c.id, action.issueId, action.price, action.qty);
    case 'sell_bond': return sellBond(world, c.id, action.holdingId, action.price, action.qty);
    case 'buy_bond': return buyBond(world, c.id, action.offerId);
    case 'offer_restructure': return offerRestructure(world, c.id, action.issueId, {
      coupon: action.coupon, termDays: action.term, haircut: action.haircut,
    });
    case 'vote_restructure': return voteRestructure(world, action.issueId, c.id, action.accept);
    case 'repudiate': {
      if (!isCouncillor(world, c.id)) {
        return { ok: false, message: 'Repudiating an issue is the Council’s act, and you do not sit on it.' };
      }
      return repudiate(world, action.issueId, { votedFor: [c.id] });
    }
    // The counter
    case 'deposit': return depositLumens(world, c.id, action.amount);
    case 'withdraw': return withdrawLumens(world, c.id, action.amount);
    case 'set_deposit_rate': return setDepositRate(world, c.id, action.rate);
    case 'set_lending_rate': return setLendingRate(world, c.id, action.rate);
    case 'call_loan': return callLoan(world, c.id, action.loanId);
    // The houses
    case 'found_underwriter': return foundUnderwriter(world, c.id, action.name, action.capital);
    case 'offer_policy': return offerPolicy(world, c.id, {
      kind: action.kind, cover: action.cover, premium: action.premium, termDays: action.term,
    });
    case 'buy_policy': return buyPolicy(world, c.id, action.policyId);
    case 'file_claim': return fileClaim(world, c.id, action.policyId, action.event, action.amount);
    case 'settle_claim': return settleClaim(world, c.id, action.claimId, action.amount);
    case 'deny_claim': return denyClaim(world, c.id, action.claimId, action.reason);
    // The pot
    case 'found_mutual': return foundMutual(world, c.id, action.name, action.dues);
    case 'join_mutual': return joinMutual(world, action.mutualId, c.id);
    case 'pay_dues': return payDues(world, c.id, action.mutualId);
    case 'claim_aid': return claimAid(world, c.id, action.amount, action.reason);
    case 'vote_aid': return voteAid(world, action.claimId, c.id, action.aye);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/** The bank's counter is open at the same hours as every other workplace. */
export function counterOpen(world: World): boolean {
  return world.hour >= COUNTER_HOURS[0] && world.hour < COUNTER_HOURS[1];
}

/** Everything the finance layer puts in front of this citizen here and now. */
export function financeActions(world: World, c: Citizen, set: Set<ActionType>): void {
  if (c.lifeStage === 'child') return;
  const settled = c.standing === 'good' || c.standing === 'probation';

  // --- The counter, hours 8 to 18 ---
  const open = counterOpen(world) && bankOpenNow(world) && !bankSuspended(world);
  if (open && settled && c.wallet > 0) set.add('deposit');
  if (counterOpen(world) && !bankSuspended(world) && depositOf(world, c.id) > 0) set.add('withdraw');
  if (isBankOfficer(world, c.id)) {
    set.add('set_deposit_rate');
    set.add('set_lending_rate');
    for (const loan of Object.values(world.loans)) {
      if (loan.outstanding > 0) { set.add('call_loan'); break; }
    }
  }

  // --- The paper ---
  if (settled) {
    if (c.wallet > 0 && openAuctions(world).length > 0) set.add('bid_bond');
    const held = holdingsOf(world, c.id);
    if (held.length > 0) {
      set.add('sell_bond');
      if (held.some((h) => restructureOf(world, h.issueId) !== null)) set.add('vote_restructure');
    }
    if (c.wallet > 0 && openOffers(world).some((o) => o.sellerId !== c.id)) set.add('buy_bond');
    if (isCouncillor(world, c.id) && outstandingIssues(world).length > 0) {
      set.add('offer_restructure');
      set.add('repudiate');
    }
  }

  // --- The houses ---
  const house = underwriterOwnedBy(world, c.id);
  // A house costs its capital and the Exchange's fee, and a citizen who
  // already runs a concern is running that one.
  const owns = !!c.businessId && world.businesses[c.businessId]?.dissolvedDay === null;
  if (settled && !owns && hasBankersLicence(world, c.id) && c.wallet >= UNDERWRITER_CAPITAL + UNDERWRITER_FEE) {
    set.add('found_underwriter');
  }
  if (house) {
    set.add('offer_policy');
    if (claimsToAnswer(world, c.id).length > 0) { set.add('settle_claim'); set.add('deny_claim'); }
  }
  if (settled && !house) {
    const lines = openLines(world);
    if (lines.some((o) => c.wallet >= o.premium)) set.add('buy_policy');
  }
  if (policiesOf(world, c.id).length > 0) set.add('file_claim');

  // --- The pot ---
  const mutual = mutualFor(world, c.id);
  if (!mutual && settled) {
    if (c.wallet >= MUTUAL_FEE) set.add('found_mutual');
    if (allMutuals(world).length > 0) set.add('join_mutual');
  }
  if (mutual) {
    const pot = potOfMutual(world, mutual);
    if (c.wallet >= mutual.dues && mutual.lastDues[c.id] !== world.day) set.add('pay_dues');
    if (pot && pot.members.length >= pot.minMembers) set.add('claim_aid');
    if (pot && openClaimsOf(world, pot.id).some((k) => k.claimantId !== c.id && k.votes[c.id] === undefined)) {
      set.add('vote_aid');
    }
  }
}

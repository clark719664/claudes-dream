/**
 * The civil half of the action table (`docs/CIVIL.md` §10): instruments, the
 * docket, escrow, arbitration, the guilds and patronage, dispatched to the
 * module that owns each of them, and the list of the ones a citizen could
 * plausibly take where it stands.
 *
 * `dispatchCivil` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `civilActions` adds to
 * the set `availableActions` is built from: a guide, never a promise — every
 * handler checks its own conditions again.
 *
 * Nothing routed through this file can fine, suspend, exile or detain
 * anybody. The whole of the civil layer moves lumens and compels performance,
 * never liberty (Charter Article VI, `docs/JUSTICE.md` §1).
 */
import type { Action, ActionResult, ActionType, Citizen, World } from '../types.ts';
import { PROFESSIONS } from '../types.ts';
import { memo } from '../util/memo.ts';
import {
  EXAMINATION_FEE, GUILD_FOUNDING_COST, MASTER_SKILL, PROFESSION_SKILL, allGuilds, guildFor,
} from '../civil/licences.ts';
import {
  acceptContract, closeOffer, offerContract, performContract, witnessContract,
} from '../civil/contracts.ts';
import { acceptVariation, proposeVariation, terminateContract, variationsTo } from '../civil/amend.ts';
import {
  MAX_WITNESSES, activeContractsOf, allContracts, contractsOf, currentPeriod, isPerformed, obligorOf,
  offersBy, offersTo, periodDueDay,
} from '../civil/terms.ts';
import { liveEscrows, openEscrow, releaseEscrow } from '../civil/escrow.ts';
import {
  acceptSettlement, answerSuit, fileSuit, judgeCivil, offerSettlement, sittingSuits, suitsAgainst, suitsBy,
} from '../civil/docket.ts';
import { enforceJudgment, judgmentsFor, outstanding } from '../civil/enforcement.ts';
import {
  acceptArbitration, arbitrationOffersTo, arbitrationsFor, closeArbitration, offerArbitration, arbitrate,
  referDispute,
} from '../civil/arbitration.ts';
import { certify, foundGuild, guildsOf, markFor, mastersAvailable, revokeLicence, sitExamination } from '../civil/guilds.ts';
import { acceptPatronage, offerPatronage } from '../civil/patronage.ts';
import { mayContract } from '../civil/common.ts';

/** A patron with less than this in hand has nothing to fund anybody with. */
export const PATRONAGE_FLOOR = 200;

/**
 * Carry out one civil action. Null means "not mine": the caller's own switch
 * handles it. Nothing here throws for a citizen's mistake.
 */
export function dispatchCivil(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    // Instruments
    case 'offer_contract': return offerContract(world, c.id, {
      to: action.to, kind: action.kind, terms: action.terms, consideration: action.consideration,
      days: action.days, penalty: action.penalty, notice: action.notice, witnesses: action.witnesses,
    });
    case 'accept_contract': return acceptContract(world, c.id, action.offerId);
    // One verb closes either kind of offer on the table: an instrument, or an
    // offer of arbitration. The id says which register it is in.
    case 'close_offer': return action.offerId.startsWith('ca_')
      ? closeArbitration(world, c.id, action.offerId)
      : closeOffer(world, c.id, action.offerId);
    case 'witness_contract': return witnessContract(world, c.id, action.offerId);
    case 'perform_contract': return performContract(world, c.id, action.contractId);
    case 'propose_variation': return proposeVariation(world, c.id, action.contractId, action.terms, {
      consideration: action.consideration, days: action.days, penalty: action.penalty, notice: action.notice,
    });
    case 'accept_variation': return acceptVariation(world, c.id, action.variationId);
    case 'terminate_contract': return terminateContract(world, c.id, action.contractId);
    case 'open_escrow': return openEscrow(world, c.id, action.contractId, action.holder, action.amount);
    case 'release_escrow': return releaseEscrow(world, c.id, action.escrowId);
    // The docket
    case 'file_suit': return fileSuit(world, c.id, {
      defendant: action.defendant, contractId: action.contractId ?? null, claim: action.claim, damages: action.damages,
    });
    case 'answer_suit': return answerSuit(world, c.id, action.suitId, action.plea, action.text, action.counterclaim ?? null);
    case 'settle': return offerSettlement(world, c.id, action.suitId, action.amount);
    case 'accept_settlement': return acceptSettlement(world, c.id, action.suitId);
    case 'judge_civil': return judgeCivil(world, c.id, action.suitId, action.finding, action.damages, action.order, action.reason);
    case 'enforce_judgment': return enforceJudgment(world, c.id, action.judgmentId);
    // Arbitration, and Reverie between cities
    case 'offer_arbitration': return offerArbitration(world, c.id, {
      with: action.with, about: action.about, arbiter: action.arbiter, fee: action.fee,
    });
    case 'accept_arbitration': return acceptArbitration(world, c.id, action.offerId);
    case 'arbitrate': return arbitrate(world, c.id, action.disputeId, action.award, action.reason);
    case 'refer_dispute': return referDispute(world, c.id, action.cities, action.about);
    // The guilds
    case 'found_guild': return foundGuild(world, c.id, action.profession, action.name);
    case 'sit_examination': return sitExamination(world, c.id, action.guildId);
    case 'certify': return certify(world, c.id, action.candidate);
    case 'revoke_licence': return revokeLicence(world, c.id, action.citizen, action.reason);
    // Patronage
    case 'offer_patronage': return offerPatronage(world, c.id, {
      to: action.to, perDay: action.perDay, days: action.days, subject: action.subject,
    });
    case 'accept_patronage': return acceptPatronage(world, c.id, action.offerId);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/** Instruments on the table anywhere in the city, listed once a round. */
function openOffers(world: World) {
  return memo(world, 'civil:offers:open', () => allContracts(world).filter((k) => k.status === 'offered'));
}

/** How many citizens could stand as founding masters of a trade, counted once a round. */
function masterCount(world: World, profession: (typeof PROFESSIONS)[number]): number {
  return memo(world, `civil:masters:${profession}`, () => mastersAvailable(world, profession).length);
}

/** A period this citizen owes today and has not yet discharged. */
export function periodDue(world: World, c: Citizen): boolean {
  for (const k of activeContractsOf(world, c.id)) {
    if (obligorOf(k) !== c.id) continue;
    const period = currentPeriod(world, k);
    if (!isPerformed(k, period) && world.day >= periodDueDay(k, period)) return true;
  }
  return false;
}

/** Instruments, the docket and the guilds, as this citizen could reach them this hour. */
export function civilActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[], others: boolean): void {
  if (c.lifeStage === 'child' || !mayContract(world, c)) return;

  // --- Instruments ---
  if (others) set.add('offer_contract');
  const mine = contractsOf(world, c.id);
  const toMe = offersTo(world, c.id);
  if (toMe.length > 0) {
    set.add('close_offer');
    if (toMe.some((k) => k.kind === 'patronage')) set.add('accept_patronage');
    if (toMe.some((k) => k.kind !== 'patronage')) set.add('accept_contract');
  }
  if (offersBy(world, c.id).length > 0) set.add('close_offer');
  // A witness stands beside the parties: an offer made by somebody in this
  // district, that this citizen is not a party to and has not already marked.
  if (openOffers(world).some((k) => k.offerorId !== c.id && k.offereeId !== c.id
    && k.witnesses.length < MAX_WITNESSES && !k.witnesses.includes(c.id)
    && world.citizens[k.offerorId]?.district === c.district)) set.add('witness_contract');
  const active = mine.filter((k) => k.status === 'active');
  if (active.length > 0) {
    set.add('propose_variation');
    if (active.some((k) => k.noticeById === null)) set.add('terminate_contract');
    if (periodDue(world, c)) set.add('perform_contract');
    if (c.wallet > 0) set.add('open_escrow');
  }
  if (variationsTo(world, c.id).length > 0) set.add('accept_variation');
  if (liveEscrows(world).some((e) => e.depositorId === c.id)) set.add('release_escrow');

  // --- The docket ---
  if (others && c.wallet > 0) set.add('file_suit');
  const against = suitsAgainst(world, c.id).filter((s) => s.status === 'filed' || s.status === 'in_session');
  const brought = suitsBy(world, c.id).filter((s) => s.status === 'filed' || s.status === 'in_session');
  if (against.some((s) => s.plea === null)) set.add('answer_suit');
  if (against.length > 0 || brought.length > 0) set.add('settle');
  if ([...against, ...brought].some((s) => s.offer !== null && s.offer.byId !== c.id)) set.add('accept_settlement');
  if (sittingSuits(world).some((s) => s.judges.includes(c.id) && !s.votes.some((v) => v.judgeId === c.id))) set.add('judge_civil');
  if (judgmentsFor(world, c.id).some((j) => outstanding(j) > 0 && j.enforcedDay === null && world.day >= j.dueDay)) {
    set.add('enforce_judgment');
  }

  // --- Arbitration ---
  if (others) set.add('offer_arbitration');
  if (arbitrationOffersTo(world, c.id).length > 0) { set.add('accept_arbitration'); set.add('close_offer'); }
  if (arbitrationsFor(world, c.id).some((a) => a.status === 'bound')) set.add('arbitrate');

  // --- The guilds ---
  for (const profession of PROFESSIONS) {
    if (c.skills[PROFESSION_SKILL[profession]] < MASTER_SKILL) continue;
    if (guildFor(world, profession) || c.wallet < GUILD_FOUNDING_COST) continue;
    if (masterCount(world, profession) >= 3) { set.add('found_guild'); break; }
  }
  for (const g of allGuilds(world)) {
    if (!g.members.includes(c.id) && markFor(g, c.id) && c.wallet >= EXAMINATION_FEE) set.add('sit_examination');
  }
  const masterOf = guildsOf(world, c.id).filter((g) => g.masters.includes(c.id));
  if (masterOf.length > 0) {
    if (here.some((o) => o.lifeStage !== 'child' && !masterOf.some((g) => g.members.includes(o.id)))) set.add('certify');
    if (masterOf.some((g) => g.members.some((id) => id !== c.id))) set.add('revoke_licence');
  }

  // --- Patronage ---
  if (others && c.wallet >= PATRONAGE_FLOOR) set.add('offer_patronage');
}

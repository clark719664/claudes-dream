/**
 * The generations half of the action table (`docs/GENERATIONS.md` §8,
 * `REGISTRY.md` §3): the will, the house, the entail, the head, the letter, the
 * pledge, the match and the hour at the Hall of Records — each dispatched to
 * the module in `src/generations/` that owns it.
 *
 * `dispatchGenerations` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `generationsActions`
 * adds to the set `availableActions` is built from: a guide, never a promise,
 * and every handler checks its own conditions again.
 *
 * Two things this file will not do, because `GENERATIONS.md` §6 entrenches
 * them: it reads no house into any gate, threshold, sentence or repute term,
 * and it puts nobody on a roll. A citizen is of a house because they carry the
 * name; `join_house` is a request the members answer and `renounce_name` is the
 * way out, and both directions are the citizen's own act.
 */
import type { Action, ActionResult, ActionType, Citizen, CitizenId, World } from '../types.ts';
import { loanOf } from '../economy/bank.ts';
import { unitsFor } from '../markets/property.ts';
import {
  FOUND_HOUSE_ADULTS, FOUND_HOUSE_COST, RECORDS_HOUSE, acceptMatch, allHouses, claimHouse, closeMatch,
  conveyBusinessToHouse, conveyToHouse, endowHouse, houseAdults, houseAssent, houseById, houseFor, houseHeaded,
  houseMotion, houseOfName, houseTreasury, houseVote, joinHouse, letterOfHouse, livingAdults,
  nameSuccessor, offerMatch, openMatchesFor, openMotionsOf, pledgeFor, pledgeHouse, readRecords,
  renounceName, revokeWill, showsDescent, willOf, writeWill, foundHouse,
} from '../generations/index.ts';

/** Where the registers are read: the Hall of Records, in the Commons. */
export const RECORDS_DISTRICT = 'commons';

/** A match offer id, so `close_offer` can tell one from an instrument. */
export const MATCH_OFFER = /^mt_\d+$/;

/** Carry out one action of the generations layer; null means the caller's switch owns it. */
export function dispatchGenerations(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    // --- The will (`GENERATIONS.md` §3): public the day it is filed, honoured
    // to the letter, and refilable any day.
    case 'write_will': return writeWill(world, c.id, {
      shares: action.shares, residue: action.residue ?? null,
      executor: action.executor ?? null, instructions: action.instructions ?? '',
    });
    case 'revoke_will': return revokeWill(world, c.id);
    // --- The house, and the two doors into and out of a name (§4) ---
    case 'found_house': return foundHouse(world, c.id, action.name, action.rule);
    case 'join_house': return joinHouse(world, c.id, action.houseId);
    case 'renounce_name': return renounceName(world, c.id, action.name);
    // --- The entail (§4): what a house holds, nobody may sell alone ---
    case 'convey_to_house': return conveyToHouse(world, c.id, action.unit);
    case 'convey_business_to_house': return conveyBusinessToHouse(world, c.id, action.businessId);
    case 'endow_house': return endowHouse(world, c.id, action.amount);
    // --- What the adults decide together ---
    case 'house_motion': return houseMotion(world, c.id, {
      kind: action.kind, value: action.value ?? 0, target: action.target ?? null, city: action.city ?? null,
    });
    case 'house_assent': return houseAssent(world, c.id, action.motionId, action.aye);
    case 'name_successor': return nameSuccessor(world, c.id, action.to);
    case 'house_vote': return houseVote(world, c.id, action.candidate);
    // --- What a name is worth outside the family (§2) ---
    case 'letter_of_house': return letterOfHouse(world, c.id, action.to, action.city ?? 'reverie');
    case 'pledge_house': return pledgeHouse(world, c.id, action.loanId);
    // --- Matches, the claim of descent, and the registers ---
    case 'offer_match': return offerMatch(world, c.id, {
      house: action.house, dowry: action.dowry ?? 0, unit: action.unit ?? null, terms: action.terms ?? '',
    });
    case 'accept_match': return acceptMatch(world, c.id, action.offerId);
    case 'claim_house': return claimHouse(world, c.id, action.houseId);
    case 'read_records': return readRecords(world, c.id, action.subject);
    default: return null;
  }
}

/** `close_offer` on a match: declining one made to you, or withdrawing your own. */
export function closeMatchOffer(world: World, cId: CitizenId, offerId: string): ActionResult {
  return closeMatch(world, cId, offerId);
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/**
 * Everything the generations layer puts in front of this citizen here and now.
 *
 * A child is left out of all of it: a child holds no estate, moves nothing in a
 * house's business and asks nobody for a name (`docs/GENERATIONS.md` §4 —
 * three *adults* found one).
 */
export function generationsActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  if (c.lifeStage === 'child') return;
  const settled = c.standing === 'good' || c.standing === 'probation';

  // The Hall of Records is open to anyone standing in it, whatever their
  // standing: the registers are public (`PRINCIPLES.md` §5).
  if (c.district === RECORDS_DISTRICT && world.buildings[RECORDS_HOUSE]) set.add('read_records');

  // A will is a citizen's own paper: it needs no standing, no house and no
  // lumens in hand — only something that could one day be divided.
  if (c.wallet > 0 || unitsFor(world, c.id).length > 0 || c.businessId) set.add('write_will');
  if (willOf(world, c.id)) set.add('revoke_will');

  const house = houseFor(world, c.id);
  const headed = houseHeaded(world, c.id);

  if (!house) {
    // Three adults of the name and 500 ℓ at the Exchange.
    if (settled && livingAdults(world, c.familyName).length >= FOUND_HOUSE_ADULTS
      && !houseOfName(world, c.familyName) && c.wallet >= FOUND_HOUSE_COST) {
      set.add('found_house');
    }
    // Asking to be admitted to somebody else's name. It is a motion, and the
    // members answer it.
    if (settled && allHouses(world).some((h) => h.dormantDay === null && h.name !== c.familyName)) set.add('join_house');
  } else {
    set.add('renounce_name');
    if (settled) {
      if (unitsFor(world, c.id).some((u) => !house.units.includes(u.id))) set.add('convey_to_house');
      if (c.businessId && world.businesses[c.businessId]?.dissolvedDay === null
        && !house.businesses.includes(c.businessId)) set.add('convey_business_to_house');
      if (c.wallet > 0) set.add('endow_house');
      set.add('house_motion');
    }
    if (openMotionsOf(world, house).some((m) => m.votes[c.id] === undefined)) set.add('house_assent');
    if (house.rule === 'assent' && houseAdults(world, house).length > 1) set.add('house_vote');
    if (openMatchesFor(world, house).some((m) => m.toHouseId === house.id)) set.add('accept_match');
    if (openMatchesFor(world, house).length > 0) set.add('close_offer');
  }

  // A dormant house anybody can show descent from waits to be revived, with
  // its holdings, its arrears and its stain together.
  if (settled && allHouses(world).some((h) => h.dormantDay !== null && showsDescent(world, c.id, h))) {
    set.add('claim_house');
  }

  if (!headed || !settled) return;
  // The head's own instruments.
  if (headed.rule === 'chosen' && houseAdults(world, headed).length > 1) set.add('name_successor');
  if (here.length > 0 || Object.keys(c.bonds).length > 0) set.add('letter_of_house');
  if (!pledgeFor(world, c.id) && anyMemberOwesTheBank(world, headed.name)
    && (headed.units.length > 0 || headed.businesses.length > 0 || houseTreasury(world, headed) > 0)) {
    set.add('pledge_house');
  }
  if (houseTreasury(world, headed) > 0 && allHouses(world).some((h) => h.id !== headed.id && h.dormantDay === null)) {
    set.add('offer_match');
  }
}

/** True when somebody of this name holds a loan the entail could stand behind. */
function anyMemberOwesTheBank(world: World, name: string): boolean {
  for (const m of livingAdults(world, name)) {
    const loan = loanOf(world, m);
    if (loan && loan.outstanding > 0 && !loan.defaulted) return true;
  }
  return false;
}


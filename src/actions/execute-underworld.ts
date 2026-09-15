/**
 * The underworld half of the action table (`docs/UNDERWORLD.md` §7,
 * `REGISTRY.md` §3): the manifest and the duty, the crossing that files
 * neither, the four things an officer standing a gate may do about it, the hand
 * that does not ask, the retainer, the room and the secret in it, and the Watch
 * turned inward.
 *
 * `dispatchUnderworld` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `underworldActions`
 * adds to the set `availableActions` is built from: a guide, never a promise —
 * every handler checks its own conditions again.
 *
 * Two notes that are not obvious.
 *
 * **Nothing here punishes anybody.** Every offence this layer records goes
 * through `underworld/offences.ts` into the Watch's own book as a report, an
 * officer decides whether to file it, and the ladder in
 * `government/sentencing.ts` answers it — the same road a theft takes. All five
 * codes are Track I: L26 smuggling, L27 contraband, L28 a false manifest, L29
 * unlicensed dealing and L30 espionage. Not one of them reaches a cell
 * (`docs/JUSTICE.md` §1).
 *
 * **A citizen's plans stay their own.** Nothing in `availableActions` reads an
 * intention and nothing in the observation states one. `smuggle` is offered
 * where a gate is, exactly as `vandalize` is offered where a building is; what
 * anybody means by standing there is theirs (`docs/PRINCIPLES.md` §5).
 */
import { GOODS } from '../types.ts';
import type { Action, ActionResult, ActionType, BuildingId, Citizen, World } from '../types.ts';
import { detectivesOnDuty, stillADetective } from '../government/investigations.ts';
import {
  HOME_CITY, SECRETS, SECRET_KINDS, WAGON_COST, acceptRecruitment, assessDuty, assignFreeDetective, caseTarget,
  declareCargo, fence, fitWagon, gateFor, hasFittedWagon, inspect, isOnCustoms, offersBy, offersTo, passSecret,
  plantFalsePapers, receiveFrom, recruitAgent, retainerOffersTo, secretsHeldBy, seize, smuggle, stealSecret, sweep,
  waveThrough,
} from '../underworld/index.ts';
import type { CityKey } from '../underworld/index.ts';

/** The city on the other side of a crossing when the traveller names none. */
export const DEFAULT_PARTNER_CITY: CityKey = 'marrowgate';

/** Which way a load is moving, and the two cities the manifest names for it. */
function crossing(direction: 'inbound' | 'outbound' | undefined, city: CityKey | undefined): { from: CityKey; to: CityKey } {
  const other = city ?? DEFAULT_PARTNER_CITY;
  return (direction ?? 'inbound') === 'inbound' ? { from: other, to: HOME_CITY } : { from: HOME_CITY, to: other };
}

/** Carry out one underworld action; null means the caller's switch owns it. */
export function dispatchUnderworld(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    case 'declare_cargo': {
      const { from, to } = crossing(action.direction, action.city);
      return declareCargo(world, c.id, {
        good: action.goods ?? null, productId: action.productId ?? null,
        qty: action.qty, value: action.value, from, to,
      });
    }
    case 'smuggle': return smuggle(world, c.id, {
      good: action.goods ?? null, productId: action.productId ?? null,
      qty: action.qty, route: action.route,
      direction: action.direction ?? 'inbound', city: action.city ?? DEFAULT_PARTNER_CITY,
    });
    case 'fit_wagon': return fitWagon(world, c.id);
    case 'inspect': return inspect(world, c.id, action.traveller);
    case 'assess_duty': return assessDuty(world, c.id, action.traveller);
    case 'seize': return seize(world, c.id, action.traveller, action.good ?? null, action.productId ?? null, action.qty);
    case 'wave_through': return waveThrough(world, c.id, action.traveller);
    case 'fence': return fence(world, c.id, {
      to: action.to, itemId: action.itemId ?? null, good: action.good ?? null,
      productId: action.productId ?? null, qty: action.qty,
    });
    case 'receive_goods': return receiveFrom(world, c.id, {
      from: action.from, itemId: action.itemId ?? null, good: action.good ?? null,
      productId: action.productId ?? null, qty: action.qty,
    });
    case 'recruit_agent': return recruitAgent(world, c.id, {
      citizen: action.citizen, retainer: action.retainer, days: action.days, forCity: action.city,
    });
    case 'accept_recruitment': return acceptRecruitment(world, c.id, action.offerId);
    case 'case_target': return caseTarget(world, c.id, action.building);
    case 'steal_secret': return stealSecret(world, c.id, action.building, action.kind);
    case 'pass_secret': return passSecret(world, c.id, action.to, action.kind);
    // The roster picks the least-loaded detective; a Captain who wants a named
    // one uses `assignDetective`, which is not an action anybody takes.
    case 'assign_detective': return assignFreeDetective(world, c.id, {
      ...(action.building !== undefined ? { building: action.building } : {}),
      ...(action.citizen !== undefined ? { citizen: action.citizen } : {}),
    });
    case 'sweep': return sweep(world, c.id, action.building);
    case 'plant_false_papers': return plantFalsePapers(world, c.id, action.building, action.claim);
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/** True where this citizen is carrying anything a load could be made of. */
export function carriesAnything(c: Citizen): boolean {
  return GOODS.some((g) => c.inventory[g] > 0) || c.possessions.length > 0;
}

/** The rooms in this district that hold something worth taking (`UNDERWORLD.md` §5). */
export function secretRoomsHere(world: World, c: Citizen): BuildingId[] {
  const out: BuildingId[] = [];
  for (const kind of SECRET_KINDS) {
    const building = SECRETS[kind].building;
    if (world.buildings[building]?.district === c.district && !out.includes(building)) out.push(building);
  }
  return out;
}

/** Everything this layer puts in front of this citizen here and now. */
export function underworldActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  if (c.lifeStage === 'child') return;
  const settled = c.standing === 'good' || c.standing === 'probation';

  // The gate. A manifest and a crossing are both trade, so a suspension takes
  // them; standing at the doorway is what makes either possible at all.
  const gate = gateFor(world, c);
  if (settled && gate) {
    set.add('declare_cargo');
    if (carriesAnything(c) || c.wallet > 0) set.add('smuggle');
  }
  // The pass is reached over the hills rather than through a gate.
  if (settled && !gate && (c.district === 'heights' || c.district === 'foundry_row') && carriesAnything(c)) {
    set.add('smuggle');
  }
  if (settled && c.district === 'foundry_row' && !hasFittedWagon(world, c.id) && c.wallet >= WAGON_COST) set.add('fit_wagon');

  // The officer's four. Standing a customs post is the whole qualification,
  // and a traveller has to be standing there to be read.
  if (isOnCustoms(world, c.id) && here.length > 0) {
    set.add('inspect');
    set.add('assess_duty');
    set.add('seize');
    set.add('wave_through');
  }

  // The hand that does not ask, and the hand it takes from.
  if (settled && here.length > 0 && carriesAnything(c)) set.add('fence');
  if (settled && offersTo(world, c.id).length > 0) set.add('receive_goods');
  // Declining a lot, or withdrawing one, is the same verb the Exchange uses.
  if (offersTo(world, c.id).length > 0 || offersBy(world, c.id).length > 0) set.add('close_offer');

  // A retainer is an offer and taking it is a separate act, because nobody
  // here is bound by another citizen's decision.
  if (settled && here.length > 0 && c.wallet > 0) set.add('recruit_agent');
  if (retainerOffersTo(world, c.id).length > 0) set.add('accept_recruitment');

  // The room, and what it holds.
  const rooms = secretRoomsHere(world, c);
  if (rooms.length > 0) {
    set.add('case_target');
    set.add('steal_secret');
  }
  if (secretsHeldBy(world, c.id).length > 0 && here.length > 0) set.add('pass_secret');

  // The Watch turned inward: the Captain's call, and a detective's two shifts.
  if (world.government.watchCaptainId === c.id && detectivesOnDuty(world).length > 0) set.add('assign_detective');
  if (stillADetective(world, c.id) && Object.values(world.buildings).some((b) => b.district === c.district)) {
    set.add('sweep');
    set.add('plant_false_papers');
  }
}

/**
 * The creeds half of the action table (`docs/CREEDS.md` §9, `REGISTRY.md` §3):
 * the roll, the tenets, the fund, the house of meeting, the officiant, the
 * conscientious refusal, the door and the site — each dispatched to the module
 * in `src/creeds/` that owns it.
 *
 * `dispatchCreeds` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `creedActions` adds to
 * the set `availableActions` is built from: a guide, never a promise.
 *
 * Two things this file will not do. It never puts anybody on a roll —
 * `adopt_creed` is the only door there is, and it is called by the citizen in
 * its own hour. And it keeps a congregation's premises apart from a dynasty's:
 * `take_meeting_house` rents a room at the district's land value and
 * `found_house` in `execute-generations.ts` files a family at the Exchange
 * (`REGISTRY.md` §7). They are different verbs, different registers and
 * different money.
 */
import type { Action, ActionResult, ActionType, Citizen, CitizenId, RefusableDuty, World } from '../types.ts';
import { openClaimsOf, potBalance } from '../finance/pot.ts';
import { mutualFor, potOfMutual } from '../finance/mutual.ts';
import { memo } from '../util/memo.ts';
import { allUnits } from '../markets/property.ts';
import { pendingCasesFor } from '../government/court.ts';
import {
  FOUND_CREED_FEE, SCHISM_DAYS, adoptCreed, allCreeds, claimAid, consecrateSite, creedFor, creedOf, creedState,
  disputeTenet, disputesOf,
  donateCreed, electOfficiant, endSanctuaryVote, fundBalance, gather, gatheringOf, grantAid, grantWarrant,
  inviteCreed, isMember, keepTheDoor, leaveCreed, liveSanctuaries, livingMembers, meetingHouseRent, offerSanctuary,
  pilgrimage, preach, requestWarrant, reuniteCreed, sanctuaryFor, sanctuaryOf, sanctuaryOfCreed, secede, setTithe,
  sitesHere, standOfficiant, stateTenet, surrender, takeMeetingHouse, foundCreed, commissionMissionary, refuse,
  observeAct, recordAid,
} from '../creeds/index.ts';
import type { Creed, CreedAct } from '../creeds/index.ts';
import { fail } from './common.ts';

/** The sanctuary an action names, by its own id, by its creed's, or by the one standing here. */
function sanctuaryNamed(world: World, cId: CitizenId, named?: string) {
  if (named) {
    return sanctuaryOf(world, named) ?? sanctuaryOfCreed(world, named)
      ?? liveSanctuaries(world).find((s) => s.unitId === named) ?? null;
  }
  const c = world.citizens[cId];
  const own = sanctuaryFor(world, cId);
  if (own) return own;
  return liveSanctuaries(world).find((s) => s.district === c?.district) ?? null;
}

/** Carry out one action of the creeds layer; null means the caller's switch owns it. */
export function dispatchCreeds(world: World, c: Citizen, action: Action): ActionResult | null {
  const k = creedFor(world, c.id);
  switch (action.type) {
    // --- The roll. `adopt_creed` is the only path onto one. ---
    case 'found_creed': return foundCreed(world, c.id, {
      name: action.name, tenets: action.tenets, tithe: action.tithe, gatheringDay: action.gatheringDay,
      succession: action.succession, aidRule: action.aidRule, examinationFloor: action.examinationFloor,
    });
    case 'adopt_creed': return adoptCreed(world, c.id, action.creedId);
    case 'leave_creed': return leaveCreed(world, c.id, action.creedId);
    // --- The tenets, the dispute and the schism ---
    case 'state_tenet': return k
      ? stateTenet(world, k, c.id, action.question, action.stance, action.text)
      : fail('You do not belong to a creed.');
    case 'dispute_tenet': return k
      ? disputeTenet(world, k, c.id, action.tenetId, action.stance, action.text)
      : fail('You do not belong to a creed.');
    case 'secede': return secede(world, c.id, action.creedId, action.name, action.tenetId);
    case 'reunite_creed': return reuniteCreed(world, c.id, action.creedId);
    // --- The fund: a mutual's pot under another name (`REGISTRY.md` §7) ---
    case 'set_tithe': return k ? setTithe(world, k, c.id, action.rate) : fail('You do not belong to a creed.');
    case 'donate_creed': return donateCreed(world, c.id, action.creedId, action.amount);
    case 'grant_aid': return grantAid(world, action.claimId, c.id, action.amount);
    // --- The house of meeting, and the day it gathers ---
    case 'take_meeting_house': return k
      ? takeMeetingHouse(world, k, c.id, action.unit)
      : fail('You do not belong to a creed.');
    case 'gather': {
      const which = action.creedId ? creedOf(world, action.creedId) : k;
      return which ? gather(world, which, c.id) : fail('You do not belong to a creed.');
    }
    // --- The officiant ---
    case 'stand_officiant': return k ? standOfficiant(world, k, c.id) : fail('You do not belong to a creed.');
    case 'elect_officiant': return k
      ? electOfficiant(world, k, c.id, action.candidate)
      : fail('You do not belong to a creed.');
    // --- Spreading it, which produces invitations and nothing else ---
    case 'preach': return preach(world, c.id, action.text);
    case 'invite_creed': return inviteCreed(world, c.id, action.to);
    case 'commission_missionary': return commissionMissionary(world, c.id, action.citizen, action.city);
    // --- The door ---
    case 'offer_sanctuary': return k
      ? offerSanctuary(world, k, c.id, action.to)
      : fail('You do not belong to a creed.');
    case 'keep_the_door': return keepTheDoor(world, c.id, sanctuaryNamed(world, c.id, action.house)?.id);
    case 'end_sanctuary': return endSanctuaryVote(world, c.id, action.aye ?? true, sanctuaryNamed(world, c.id, action.house)?.id);
    case 'surrender': return surrender(world, c.id);
    case 'request_warrant': {
      const s = sanctuaryNamed(world, c.id, action.house);
      return s ? requestWarrant(world, c.id, s.id) : fail('No house of meeting is sheltering anybody.');
    }
    case 'grant_warrant': return grantWarrant(world, c.id, action.warrantId, action.aye, action.reason);
    // --- The sites, and the journeys made to them ---
    case 'consecrate_site': return consecrateSite(
      world, c.id, action.building, action.label ?? '', action.city ?? 'reverie',
    );
    case 'pilgrimage': return pilgrimage(world, c.id, action.siteId);
    default: return null;
  }
}

/**
 * `refuse { duty, ground }` for the five duties of conscience. The convention's
 * own seat is `politics/convention.ts`'s and is handled in `execute-charter.ts`;
 * everything else is a stated refusal, recorded in public, and — for `jury` and
 * `witness`, the two that cost somebody else something — heard by a bench at
 * the Court's hour (`docs/CREEDS.md` §4).
 */
export function refuseDuty(world: World, cId: CitizenId, duty: RefusableDuty, ground?: string): ActionResult {
  return refuse(world, cId, duty as Exclude<RefusableDuty, 'delegate'>, ground ?? 'I will not, and this is my ground.');
}

/**
 * The layer's one action hook (`docs/CREEDS.md` §1). It records — publicly and
 * for nothing — whether a member kept what their own creed says they owe, and
 * the congregation reads that record as observance.
 *
 * It **never refuses an action and never costs a lumen**: the result handed in
 * is the result handed back, unchanged. Obligations are not enforced by the
 * engine, and a member who works on the holy day works on the holy day; what
 * happens is that everybody can see it.
 */
export function noteCreedAct(world: World, cId: CitizenId, act: CreedAct, r: ActionResult): ActionResult {
  if (r.ok) observeAct(world, cId, act);
  return r;
}

/**
 * Lumens out of one member's own wallet into another's, on the `gift` path.
 * It is the one term in the reading that is not an obligation: a congregation
 * notices who pays for its people when the fund is not the one paying.
 */
export function noteCreedAid(world: World, fromId: CitizenId, toId: CitizenId, amount: number, r: ActionResult): ActionResult {
  if (r.ok) recordAid(world, fromId, toId, amount);
  return r;
}

/**
 * `claim_aid { amount, reason }` — one verb, two registers. A mutual's pot and
 * a creed's fund are the same object (`REGISTRY.md` §7, `finance/pot.ts`), so
 * the claim goes to whichever this citizen actually belongs to.
 *
 * Belonging to both, it goes to the one holding more. Neither is a formula and
 * neither owes anybody anything: what settles it for the citizen asking is the
 * public fact of which purse could actually answer, and both balances are
 * public.
 */
export function claimAidAnywhere(
  world: World, cId: CitizenId, amount: number, reason: string,
  onMutual: () => ActionResult,
): ActionResult {
  const mutual = mutualFor(world, cId);
  const k = creedFor(world, cId);
  if (!k) return onMutual();
  if (!mutual) return claimAid(world, cId, amount, reason);
  const pot = potOfMutual(world, mutual);
  const inThePot = pot ? potBalance(world, pot) : 0;
  return fundBalance(world, k) > inThePot ? claimAid(world, cId, amount, reason) : onMutual();
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/**
 * True when a bench is sitting on a charge this citizen could be asked about.
 * Read once for the whole city rather than once per citizen: everybody asks
 * the same question of the same docket in the same hour (`util/memo.ts`).
 */
function summonsOpen(world: World, c: Citizen): boolean {
  const pending = memo(world, 'creed:pendingCharges', () => Object.values(world.cases)
    .filter((k) => k.status === 'pending').map((k) => k.defendantId));
  return pending.some((id) => id !== c.id);
}

/** A vacant address a congregation could take at today's land value. */
function affordableRoom(world: World, k: Creed): boolean {
  const purse = fundBalance(world, k);
  for (const u of allUnits(world)) {
    if (u.tenantId !== null) continue;
    const b = world.buildings[u.buildingId];
    if (!b) continue;
    if (purse >= meetingHouseRent(world, b.district) * 3) return true;
  }
  return false;
}

/** Everything the creeds layer puts in front of this citizen here and now. */
export function creedActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  // Children hold no creed and inherit none; they may adopt on coming of age
  // like anyone else (`docs/CREEDS.md` §6).
  if (c.lifeStage === 'child') return;
  const settled = c.standing === 'good' || c.standing === 'probation';
  const k = creedFor(world, c.id);

  // --- Conscience. Open to anybody, creed or none: what a creed adds is a
  // public position the bench can weigh, not the right to refuse. ---
  if (summonsOpen(world, c) || c.jobId !== null) set.add('refuse');

  if (!k) {
    if (settled && c.wallet >= FOUND_CREED_FEE) set.add('found_creed');
    if (allCreeds(world).some((x) => x.endedDay === null)) set.add('adopt_creed');
  } else {
    set.add('leave_creed');
    if (c.wallet > 0) set.add('donate_creed');
    // The gathering: at its house, at its hour, on its day.
    const meeting = gatheringOf(world, k);
    if (meeting && !meeting.done && meeting.hour === world.hour && meeting.district === c.district
      && !meeting.attendees.includes(c.id)) set.add('gather');
    // The fund is a pot; the two verbs are the pot's own.
    if (livingMembers(world, k).length > 0) set.add('claim_aid');
    const claims = openClaimsOf(world, k.potId);
    if (k.aidRule === 'members' && claims.some((x) => x.claimantId !== c.id && x.votes[c.id] === undefined)) {
      set.add('vote_aid');
    }
    if (k.aidRule === 'officiant' && k.officiantId === c.id && claims.length > 0) set.add('grant_aid');
    // Speaking for it, and speaking of it.
    if (settled && here.length > 0) set.add('preach');
    if (here.some((o) => o.lifeStage !== 'child' && !isMember(k, o.id))) set.add('invite_creed');
    if (k.tenets.length > 0) set.add('dispute_tenet');
    // A schism opens only once the dissenters have held a third of the roll
    // for three consecutive days, which is other members' doing and not this
    // citizen's (`docs/CREEDS.md` §6).
    if (disputesOf(world, k).some((d) => d.dissenters.includes(c.id) && d.daysAtThreshold >= SCHISM_DAYS)) {
      set.add('secede');
    }
    if (k.succession === 'election' && !k.standing.includes(c.id)) set.add('stand_officiant');
    if ((k.succession === 'election' || k.succession === 'acclaim') && livingMembers(world, k).length > 1) {
      set.add('elect_officiant');
    }
    if (sitesHere(world, c.district).length > 0) set.add('pilgrimage');
    // The officiant's own instruments.
    if (k.officiantId === c.id) {
      set.add('set_tithe');
      set.add('state_tenet');
      if (settled && affordableRoom(world, k)) set.add('take_meeting_house');
      // A site is registered, not visited: the officiant files it from
      // wherever it is standing, and the pilgrims are the ones who travel.
      if (k.house && world.buildings[k.house.buildingId]) set.add('consecrate_site');
      if (k.house && c.district === k.house.district && !sanctuaryOfCreed(world, k.id)
        && here.some((o) => pendingCasesFor(world, o.id).length > 0)) set.add('offer_sanctuary');
      if (allCreeds(world).some((x) => x.endedDay === null && x.id !== k.id && x.kindred.includes(k.id))) {
        set.add('reunite_creed');
      }
      if ((world as World & { cities?: unknown }).cities) set.add('commission_missionary');
    }
  }

  // --- The door. A sanctuary is a public happening: the congregation stands
  // at it, the sheltered may walk out of it, the Captain applies for entry and
  // the bench decides (`docs/CREEDS.md` §5). ---
  const sheltering = sanctuaryFor(world, c.id);
  if (sheltering) set.add('surrender');
  const here_ = liveSanctuaries(world).find((s) => s.district === c.district) ?? null;
  if (here_ && k && here_.creedId === k.id) {
    set.add('keep_the_door');
    set.add('end_sanctuary');
  }
  if (world.government.watchCaptainId === c.id && liveSanctuaries(world).some((s) => s.warrantId === null)) {
    set.add('request_warrant');
  }
  if (world.government.judges.includes(c.id)
    && Object.values(creedState(world).warrants).some((w) => w.status === 'pending')) {
    set.add('grant_warrant');
  }
}

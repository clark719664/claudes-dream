/**
 * Creeds — congregations, conscience and sanctuary (`docs/CREEDS.md`).
 *
 * The one door into the layer, for the action system, the daily rollover, the
 * observation builder and the dashboard. Everything the catalogue in
 * `CREEDS.md` §9 and `REGISTRY.md` §3 names is exported from here under the
 * name the catalogue gives it.
 *
 * The three claims this layer makes, all of them tested:
 *
 * - **A creed is joined by `adoptCreed` or not at all.** No other function in
 *   the engine can put a citizen on a roll.
 * - **A creed's fund is a mutual's pot.** `finance/pot.ts` holds the lumens,
 *   takes the claims and counts the votes; this layer wraps one and duplicates
 *   nothing (`REGISTRY.md` §7).
 * - **Nothing here is supernatural in effect.** No tenet moves a price, cures
 *   a glitch, alters a verdict or bends a roll.
 */
export type {
  AidRule, Creed, CreedForm, CreedLawCode, CreedLedgerKind, CreedMember, Invitation, MeetingHouse,
  QuestionInfo, RefusableDuty, Refusal, Sanctuary, Site, Succession, Tenet, TenetDispute,
  TenetQuestion, Warrant,
} from './shapes.ts';
export {
  ACCEPT_THRESHOLD, ACCOMMODATION_STEP, AID_PER_LUMENS, BINDING_STANCE, CONTEMPT, CREED_LAWS,
  CYCLE_DAYS, FOUND_CREED_FEE, GATHERING_BOND, GATHERING_HOUR, GATHERING_PURPOSE, GATHERING_SOCIAL,
  HOUSE_ARREARS_DAYS, HOUSE_RENT_BASE, MAX_CREED_NAME, MAX_TENETS, MAX_TENET_TEXT, MAX_TITHE,
  MIN_TENETS, OBSERVANCE_WINDOW_DAYS, OLD_CREED_CYCLES, PERSUASION_BOND, PILGRIMAGE_INTERVAL,
  QUESTIONS, REFUSABLE_DUTIES, SANCTUARY_HUNGER_DAYS, SCHISM_BOND, SCHISM_DAYS, SCHISM_SHARE,
  SUCCESSIONS, TENET_QUESTIONS, WARRANT_JUDGES, WARRANT_THRESHOLD, creedKind, creedLaw, tenetBinds,
} from './shapes.ts';

export type { CreedState } from './state.ts';
export {
  accommodationOf, allCreeds, creedFor, creedOf, creedState, grantExemption, hasExemption,
  invitationsFor, isMember, liveSanctuaries, livingMembers, meanObservance, memberCount, memberOf,
  moveAccommodation, sanctuaryFor, sanctuaryOf, sanctuaryOfCreed, siteOf, sitesOf, warrantOf,
} from './state.ts';

export type { FoundCreedSpec, TenetSpec } from './creeds.ts';
export {
  adoptCreed, deadCreedNamed, endCreed, foundCreed, leaveCreed, removeMember, stateTenet,
} from './creeds.ts';
export { countDisputes, disputeTenet, disputesOf, reuniteCreed, secede } from './schism.ts';

export {
  ableToTithe, buyFromFund, claimAid, collectTithe, collectTithes, donateCreed, fundBalance,
  fundOf, fundParty, grantAid, handFromFund, openClaims, openFund, payFromFund, payIntoFund,
  setTithe, voteAid,
} from './fund.ts';

export {
  creedPrestige, gather, gatheringOf, gatheringVenue, meetingHouseRent, nextGatheringDay,
  payHouseRent, scheduleGatherings, takeMeetingHouse,
} from './house.ts';

export {
  chooseOfficiant, creedForm, describeForm, electOfficiant, electionDue, holdCreedElection,
  officiantByRule, standOfficiant,
} from './officiant.ts';

export type { CreedAct, ObligationOutcome } from './observance.ts';
export {
  bindingQuestions, bindingTenet, computeObservance, dailyObservance, observanceOf, observeAct,
  recordAid,
} from './observance.ts';

export {
  acceptGround, costToCase, hearRefusals, pendingRefusals, questionForDuty, reachesACourt,
  refusalsOf, refuse, refusedSeat, refusedWorkToday, refuserInterest,
} from './conscience.ts';

export {
  besiegedCreeds, beyondSanctuary, decideWarrant, decideWarrants, endSanctuary, endSanctuaryVote,
  enterOnWarrant, feedSanctuaries,
  forceTheDoor, grantWarrant, keepTheDoor, liftCordon, offerSanctuary, officersAtDoors, postCordon,
  requestWarrant, sanctuariesIn, shelterableCase, siegeOfficers, staySanctuary, surrender,
  warrantGround,
} from './sanctuary.ts';

export {
  agreementWith, aidGivenBy, chargeCoercedAdoption, commissionMissionary, creedMembersOf,
  describeCreed, dailyPersuasion, invite, inviteCreed, persuasionChance, preach,
  standingInvitations,
} from './spread.ts';

export {
  consecrateSite, creedSites, pilgrimage, schedulePilgrimages, sitePrestige, sitesHere,
} from './pilgrimage.ts';

export { dailyCreeds, holdCreedCourt } from './daily.ts';

export type {
  CreedObservation, ObservedClaim, ObservedCreed, ObservedObligation, ObservedOwnCreed,
  ObservedSanctuary, ObservedTenet,
} from './observe.ts';
export { creedObservation, creedRegister, sanctuaryHere } from './observe.ts';

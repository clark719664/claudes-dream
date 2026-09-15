/**
 * The entry point for everything a citizen does. executeAction checks that
 * the citizen may act at all (exile, detention, suspension), records the
 * action, and dispatches to the handlers in daily/social/enterprise/civic/
 * offences or straight to the engine modules. availableActions lists what a
 * citizen could plausibly do right now, by standing, office, job, location
 * and time of day, so that brains — reflex, Claude or remote — need not
 * guess. Shape validation of raw input lives in validate.ts (re-exported).
 */
import { ACTION_TYPES, DETAINED_ACTIONS, GOODS, NOTE_ACTIONS, SUSPENDED_ACTIONS } from '../types.ts';
import type { Action, ActionResult, ActionType, Citizen, CitizenId, Job, ProposalKind, World } from '../types.ts';
import { ACADEMY_TUITION, BUSINESS_FOUNDING_COST, CLINIC_FEE, SHOW_TICKET } from '../data/jobs.ts';
import { isAdjacent } from '../data/city.ts';
import { buyFromMarket, sellToMarket } from '../economy/market.ts';
import { applyForJob, isQualified, openJobs, quitJob } from '../economy/jobs.ts';
import { activeBusinesses, foundBusiness } from '../economy/business.ts';
import { loanOf, repayLoan } from '../economy/bank.ts';
import { moveHomeTo, vacancies } from '../economy/housing.ts';
import { canAct, isDetained, isEligibleCandidate, isEligibleVoter } from '../citizens/citizen.ts';
import { forget, note } from '../citizens/notes.ts';
import { journalistStory } from '../sim/chronicle.ts';
import { applyToWatch, reportOffence } from '../government/watch.ts';
import { dropReport, fileReport, reportsFor } from '../government/reports.ts';
import { appealsFor, benchFor, canAppeal, castAppealVote, castVerdict, fileAppeal, pendingCasesFor } from '../government/court.ts';
import { casesInSession } from '../government/cases.ts';
import { standingAllows } from '../government/registry.ts';
import { mayAdvocate, publicDefenders } from '../government/advocates.ts';
import { gangOf, gangOfTurf, mayFoundGang } from '../government/gangs.ts';
import { isJailed, visitPrisoner, visitablePrisoners, workInCustody } from '../government/jail.ts';
import { couldEraseAnyone } from '../government/persons.ts';
import { requestParole } from '../government/parole.ts';
import { admissibleCharges, custodyActionsFor, doPleadGuilty } from './custody.ts';
import { curfewBlocks } from '../politics/decrees.ts';
import { admitsResidency, maySponsorAnyone, sponsor as fileSponsorship } from '../standing/gates.ts';
import { applyResidency } from '../standing/notices.ts';
import { noticeOf } from '../standing/state.ts';
import { underNoticeToLeave } from '../standing/hearings.ts';
import { EXCHANGE_DISTRICT, unitsFor } from '../markets/property.ts';
import { businessesForSale, buyBusiness, liquidValue, liquidate, listProperty, sellBusiness } from '../markets/selling.ts';
import { dispatchMetropolis, metropolisActions } from './execute-metro.ts';
import { civilActions, dispatchCivil } from './execute-civil.ts';
import { dispatchFinance, financeActions } from './execute-finance.ts';
import { dispatchProgress, progressActions } from './execute-progress.ts';
import { dispatchEnvironment, environmentActions } from './execute-environment.ts';
import { dispatchUnderworld, underworldActions } from './execute-underworld.ts';
import {
  appealRefusedRecord, appealableRecord, castDelegateBallot, charterActions, delegateBallotOpen, dispatchCharter,
  fileStory, isMeasureKind, tableCharterMeasure, voteOnMeasure,
} from './execute-charter.ts';
import {
  MATCH_OFFER, closeMatchOffer, dispatchGenerations, generationsActions,
} from './execute-generations.ts';
import {
  claimAidAnywhere, creedActions, dispatchCreeds, noteCreedAct, noteCreedAid, refuseDuty,
} from './execute-creeds.ts';
import { ENVIRONMENT_PROPOSAL_KINDS, tableEnvironmentProposal } from '../environment/index.ts';
import type { EnvironmentProposalKind } from '../environment/index.ts';
import { closeDeal } from '../underworld/index.ts';
import { UNDERWORLD_PROPOSAL_KINDS, tableUnderworldProposal } from './propose-underworld.ts';
import type { UnderworldProposalKind } from './propose-underworld.ts';
import { requestBankLoan } from '../finance/credit.ts';
import { bankOpenNow } from '../finance/bank.ts';
import {
  JUDGE_SEATS, appointJudgeByMayor, campaign, castBallot, isCouncillor, isElectionDay, isJudgeEligible, nominate,
  nominationsOpen, tableProposal, voteOnProposal,
} from '../government/council.ts';
import {
  doConsume, doEat, doMove, doRest, doStudy, doVisitClinic, doWork, medicOnStaff, privateClinicIn, teacherOnStaff,
} from './daily.ts';
import { doBroadcast, doGift, doInsult, doMessage, doSocialize } from './social.ts';
import { doFire, doHire, doPerform, doPostJob, doSetWage, ownedBusiness } from './enterprise.ts';
import { doBribe } from './civic.ts';
import {
  doAssault, doConfine, doErase, doEvadeTax, doExtort, doHarass, doSabotage, doScam, doSteal, doThreaten, doVandalize,
} from './offences.ts';
import { doDine, doPlay, doShow, dineVenueIn, mealCost, playVenueIn } from './society.ts';
import { CLUB_FOUNDING_FEE, START_FAMILY_SAVINGS } from '../data/catalogue.ts';
import { CRAFTING_KINDS, buyItem, craftProduct, giftItem, setPrice, shopsIn, useItem, workplaceOf } from '../society/shops.ts';
import {
  MARRIAGE_MIN_DAYS, PARTNERSHIP_AFFECTION, affectionBetween, breakUp, date, dateVenueIn, marry, proposePartnership,
  recordContact,
} from '../society/romance.ts';
import { startFamily } from '../society/family.ts';
import { MOVE_IN_BOND, householdCapacity, householdOf, moveIn, relationBetween } from '../society/households.ts';
import { MAX_CLUBS_PER_CITIZEN, attendClub, foundClub, joinClub, leaveClub, meetingOf } from '../society/clubs.ts';
import { CELEBRATABLE, celebrate, happeningsAt } from '../society/calendar.ts';
import { donate } from '../society/chest.ts';
import { bondBetween } from '../citizens/relationships.ts';
import {
  anotherHoldsOffice, anyoneElsePresent, citizensIn, districtName, fail, intactBuildingsIn, isPresent, ok,
} from './common.ts';

export { validateAction } from './validate.ts';

/** Action types remembered per citizen (newest last), for spam detection and the dashboard. */
export const RECENT_ACTIONS_LENGTH = 24;
/** Goods a citizen can consume for a need (energy cells only power machines). */
const CONSUMABLES = ['compute', 'goods', 'culture', 'knowledge'] as const;
/**
 * Actions that need somebody else standing here. The Code of Persons is done
 * to a person in a district, so every one of its acts is on this list
 * (`docs/JUSTICE.md` §2); the ladder's are the ones with a victim in the room.
 */
const PRESENCE_ACTIONS: readonly ActionType[] = [
  'socialize', 'insult', 'steal', 'scam',
  'harass', 'extort', 'threaten', 'assault', 'confine',
];

/**
 * What a child may not do. Children do not work, vote, hold or found
 * anything, court anyone, or answer to the Watch: their mistakes cost their
 * parents' good name instead (see actions/offences.ts), and a quarrel of
 * theirs is nobody's business but the family's.
 */
export const CHILD_FORBIDDEN: readonly ActionType[] = [
  'work', 'apply_job', 'quit_job', 'apply_watch', 'found_business', 'post_job', 'hire', 'fire', 'set_wage',
  'request_loan', 'repay_loan', 'perform', 'publish', 'nominate', 'campaign', 'vote', 'propose', 'vote_proposal',
  'report', 'appeal', 'verdict', 'vote_appeal', 'file_charge', 'drop_report', 'appoint_judge', 'bribe', 'evade_tax', 'insult',
  // Reverie does not jail its children (`government/jail.ts takeIntoCustody`),
  // so nothing that belongs to a term is offered to one.
  'plead_guilty', 'request_parole', 'work_custody',
  'craft', 'set_price', 'date', 'propose_partnership', 'marry', 'break_up', 'move_in', 'start_family',
  'found_club', 'join_club', 'leave_club', 'attend_club', 'donate',
  'hire_advocate', 'advocate', 'found_gang', 'recruit', 'racket', 'pay_racket',
  // The metropolis. A child may write its diary, read the paper, be treated,
  // post, react, apologise and go to a match; the rest of the city waits.
  'found_party', 'join_party', 'leave_party', 'endorse', 'sign_petition', 'vote_referendum',
  'found_union', 'join_union', 'strike', 'decree',
  'buy_property', 'sell_property', 'let_property', 'list_shares', 'buy_shares', 'sell_shares',
  'post_gig', 'take_gig', 'import', 'export',
  // Selling up is holding: a child holds no deed and no concern, so none of
  // the four ways out of one are a child's (`docs/MOBILITY.md` §2).
  'list_property', 'sell_business', 'buy_business', 'liquidate',
  'create_work', 'exhibit', 'review', 'join_team', 'train',
  'adopt_school', 'set_menu', 'commission_monument',
  'sunset', 'gossip', 'mentor',
  // A child born in a city is a resident of it and is never tested
  // (`docs/CITIZENSHIP.md` §2), so neither instrument of the gate is theirs.
  'sponsor', 'apply_residency',
  // Nobody under age is bound by a contract, sued on the docket, marked by a
  // guild or made anybody's patron (`docs/CIVIL.md` §1: the parties are
  // citizens in good standing, and a child answers to nobody but its family).
  'offer_contract', 'accept_contract', 'close_offer', 'witness_contract', 'perform_contract',
  'propose_variation', 'accept_variation', 'terminate_contract', 'open_escrow', 'release_escrow',
  'file_suit', 'answer_suit', 'settle', 'accept_settlement', 'judge_civil', 'enforce_judgment',
  'offer_arbitration', 'accept_arbitration', 'arbitrate', 'refer_dispute',
  'found_guild', 'sit_examination', 'certify', 'revoke_licence', 'offer_patronage', 'accept_patronage',
  // Nor does a child keep a deposit, hold the city's paper, write cover or
  // pool with a mutual: every one of those is trade, and children do not trade.
  'bid_bond', 'sell_bond', 'buy_bond', 'offer_restructure', 'vote_restructure', 'repudiate',
  'deposit', 'withdraw', 'set_deposit_rate', 'set_lending_rate', 'call_loan',
  'found_underwriter', 'offer_policy', 'buy_policy', 'file_claim', 'settle_claim', 'deny_claim',
  'found_mutual', 'join_mutual', 'pay_dues', 'claim_aid', 'vote_aid',
  // A child goes to school; it does not hold a post in a reading room, spend
  // anybody's capital, hold a trade secret or answer for what a stack emits.
  // The one thing on the two newest layers a child may do is put a sapling in
  // the ground, which is why `plant_trees` is not on this list.
  'open_project', 'research', 'fund_project', 'adopt_technology', 'publish_finding', 'keep_secret',
  'take_apprentice', 'teach_technology', 'sell_secret',
  'install_abatement', 'maintain_abatement', 'discharge', 'survey_air', 'survey_water',
  'petition_zoning', 'declare_interest', 'file_nuisance',
  // Nor does a child cross a gate with a load, stand a customs post, deal, take
  // a retainer, learn a room or carry a warrant card. Every one of these is
  // trade or an office, and a child does neither (`docs/UNDERWORLD.md` §7).
  'declare_cargo', 'smuggle', 'fit_wagon', 'inspect', 'assess_duty', 'seize', 'wave_through',
  'fence', 'receive_goods', 'recruit_agent', 'accept_recruitment', 'case_target', 'steal_secret', 'pass_secret',
  'assign_detective', 'sweep', 'plant_false_papers',
  // Nor is a child in the franchise, on a tribunal, in the register of
  // interests, at a convention or on a district team's entry list
  // (`docs/POLITICS.md` §9). A child comes of age and then all of it is theirs.
  'propose_amendment', 'sign_convention', 'stand_delegate', 'refuse', 'move_article', 'speak_convention',
  'vote_article', 'impeach', 'vote_impeachment', 'sign_recall', 'declare_property',
  'request_record', 'answer_record', 'found_paper', 'bid_games', 'vote_games_host', 'enter_games',
  // A child holds no estate, moves nothing in a house's business and asks
  // nobody for a name: a house is founded by three *adults* of it
  // (`docs/GENERATIONS.md` §4). Reading the registers is not on this list —
  // the Hall of Records is open to anyone, and a child's own tree is in it.
  'write_will', 'revoke_will', 'found_house', 'join_house', 'renounce_name',
  'convey_to_house', 'convey_business_to_house', 'endow_house',
  'house_motion', 'house_assent', 'name_successor', 'house_vote',
  'letter_of_house', 'pledge_house', 'offer_match', 'accept_match', 'claim_house',
  // "Children hold no creed and inherit none; they may adopt on coming of age
  // like anyone else" (`docs/CREEDS.md` §6). Nor is a child summoned to a jury,
  // asked what it saw, or put at a door the Watch is standing at.
  'found_creed', 'adopt_creed', 'leave_creed', 'state_tenet', 'dispute_tenet', 'secede', 'reunite_creed',
  'preach', 'invite_creed', 'gather', 'set_tithe', 'donate_creed', 'grant_aid',
  'stand_officiant', 'elect_officiant', 'take_meeting_house',
  'offer_sanctuary', 'keep_the_door', 'end_sanctuary', 'surrender',
  'request_warrant', 'grant_warrant', 'commission_missionary', 'consecrate_site', 'pilgrimage',
];

/**
 * The notebook: writing is always possible, striking out only when there is
 * something written. No standing, sentence or cell takes either away.
 */
function notebookActions(c: Citizen): ActionType[] {
  return (c.notes?.length ?? 0) > 0 ? [...NOTE_ACTIONS] : ['note'];
}

/** The job a citizen actually holds (a stale jobId that points elsewhere counts as none). */
export function heldJob(world: World, c: Citizen): Job | null {
  const job = c.jobId ? world.jobs[c.jobId] : undefined;
  return job && job.holderId === c.id ? job : null;
}

/** Open jobs this citizen could be hired into right now. */
export function openJobsFor(world: World, c: Citizen): Job[] {
  return openJobs(world).filter((j) => isQualified(world, c, j) && !(j.role === 'watch_officer' && c.office !== null && c.office !== 'watch'));
}

function canHold(c: Citizen): boolean {
  return c.standing === 'good' || c.standing === 'probation';
}

/** Someone other than `c` still lives in the city (off the roll taken once an hour). */
function anyoneElse(world: World, c: Citizen): boolean {
  return anyoneElsePresent(world, c);
}

/** Everyone this citizen might reasonably ask for a place: family, and friends they are close to. */
function movingInCandidates(world: World, c: Citizen): Set<CitizenId> {
  const out = new Set<CitizenId>();
  if (c.family.partnerId) out.add(c.family.partnerId);
  for (const id of c.family.parents) {
    out.add(id);
    for (const sibling of world.citizens[id]?.family.children ?? []) out.add(sibling);
  }
  for (const id of c.family.children) out.add(id);
  for (const id in c.bonds) if (c.bonds[id] >= MOVE_IN_BOND) out.add(id);
  out.delete(c.id);
  return out;
}

/** A home this citizen could join: a partner's, a relative's, or a close friend's, with room in it. */
function anyHomeToJoin(world: World, c: Citizen): boolean {
  for (const id of movingInCandidates(world, c)) {
    const o = world.citizens[id];
    if (!o || o.homeTier === 0 || !isPresent(world, o)) continue;
    const home = householdOf(world, o.id);
    if (home && (home.id === c.householdId || home.members.length >= householdCapacity(home))) continue;
    if (relationBetween(world, c.id, o.id) || bondBetween(world, o.id, c.id) >= MOVE_IN_BOND) return true;
  }
  return false;
}

/** Everything the social layer offers this citizen here and now. */
function societyActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[], biz: ReturnType<typeof ownedBusiness>): void {
  const adult = c.lifeStage !== 'child';
  const settled = canHold(c);
  if (c.possessions.length > 0) {
    set.add('use_item');
    if (here.length > 0) set.add('gift_item');
  }
  if (c.wallet > 0 && shopsIn(world, c.district).length > 0) set.add('buy_item');
  if (playVenueIn(world, c)) set.add('play');
  if (dineVenueIn(world, c.district) && c.wallet >= mealCost(world)) set.add('dine');
  if (happeningsAt(world, c.district).some((h) => CELEBRATABLE.includes(h.kind) && !h.attendees.includes(c.id))) set.add('celebrate');
  if (!adult) return;

  const shop = workplaceOf(world, c);
  if (settled && shop && CRAFTING_KINDS.includes(shop.kind) && shop.district === c.district
    && c.shiftsToday < world.config.maxShiftsPerDay) set.add('craft');
  if (biz && CRAFTING_KINDS.includes(biz.kind)) set.add('set_price');
  if (c.wallet > 0) set.add('donate');

  const partner = c.family.partnerId ? world.citizens[c.family.partnerId] : undefined;
  const grown = here.filter((o) => o.lifeStage !== 'child' && (o.standing === 'good' || o.standing === 'probation'));
  if (settled && grown.length > 0 && dateVenueIn(world, c.district)) set.add('date');
  if (settled && !partner && grown.some((o) => !o.family.partnerId && affectionBetween(world, o.id, c.id) >= PARTNERSHIP_AFFECTION)) {
    set.add('propose_partnership');
  }
  if (partner) {
    set.add('break_up');
    const home = householdOf(world, c.id);
    if (settled && !c.family.married && partner.district === c.district
      && world.day - (c.family.partnerSinceDay ?? world.day) >= MARRIAGE_MIN_DAYS) set.add('marry');
    if (settled && home && home.tier >= 1 && householdOf(world, partner.id)?.id === home.id
      && c.wallet + partner.wallet >= START_FAMILY_SAVINGS) set.add('start_family');
  }
  if (anyHomeToJoin(world, c)) set.add('move_in');

  if (!settled) return;
  if (c.clubs.length < MAX_CLUBS_PER_CITIZEN) {
    if (c.wallet >= CLUB_FOUNDING_FEE) set.add('found_club');
    if (Object.values(world.clubs ?? {}).some((k) => k.members.length > 0 && !k.members.includes(c.id))) set.add('join_club');
  }
  if (c.clubs.length > 0) set.add('leave_club');
  for (const id of c.clubs) {
    const club = world.clubs?.[id];
    const meeting = club ? meetingOf(world, club) : null;
    if (meeting && !meeting.done && meeting.hour === world.hour && meeting.district === c.district && !meeting.attendees.includes(c.id)) {
      set.add('attend_club');
    }
  }
}

/**
 * What this citizen could do this hour. Exiled, detained and departed
 * citizens can do nothing; suspended citizens only the SUSPENDED_ACTIONS
 * subset. Everything else is filtered by where they are, what they hold and
 * what time it is, so the list is a fair guide rather than a guarantee.
 */
/**
 * What the city's newer institutions put in front of this citizen: an
 * advocate to retain or a speech to make, and — for those the city reads as
 * being of that sort — a gang to found, run with, or pay off.
 */
function justiceActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[], biz: ReturnType<typeof ownedBusiness>): void {
  const charged = pendingCasesFor(world, c.id);
  if (charged.length > 0 && !charged[0].advocateId
    && (here.some((o) => mayAdvocate(world, o, charged[0])) || publicDefenders(world).length > 0)) {
    set.add('hire_advocate');
  }
  if (c.district === 'commons'
    && casesInSession(world).some((k) => k.advocateId === c.id && !(k.advocacy ?? 0))) {
    set.add('advocate');
  }

  const gang = gangOf(world, c.id);
  if (!gang && mayFoundGang(world, c)) set.add('found_gang');
  if (gang && c.district === gang.turf) {
    if (here.some((o) => !o.gangId && o.lifeStage !== 'child' && bondBetween(world, c.id, o.id) >= 40)) set.add('recruit');
  }
  if (gang && activeBusinesses(world).some((b) => b.district === c.district
    && b.ownerId !== c.id && world.counters[`racket:${b.id}`] !== Math.floor(world.day / Math.max(1, world.config.cycleDays)))) {
    set.add('racket');
  }
  if (biz && gangOfTurf(world, biz.district) && biz.treasury > 0) set.add('pay_racket');
}

/**
 * The two instruments of the gate (`docs/CITIZENSHIP.md` §2). Vouching is open
 * to any resident of age with somebody to vouch for; asking a city to have you
 * is offered to anyone the gate would not simply wave through, and it is how a
 * citizen under notice puts their own case.
 */
function standingActions(world: World, c: Citizen, set: Set<ActionType>, others: boolean): void {
  if (c.lifeStage === 'child') return;
  if (others && maySponsorAnyone(world, c)) set.add('sponsor');
  if (!admitsResidency(world, c.id) || noticeOf(world, c.id) !== null || underNoticeToLeave(world, c.id)) {
    set.add('apply_residency');
  }
}

/**
 * Selling up (`docs/MOBILITY.md` §2). A deed goes on the board from wherever
 * its owner is standing; a concern is offered from anywhere and taken over at
 * the Exchange, where the fire sale is also held. Each handler checks its own
 * conditions again — this is the guide, not the promise.
 */
function mobilityActions(world: World, c: Citizen, set: Set<ActionType>): void {
  if (c.lifeStage === 'child' || !canHold(c)) return;
  const biz = c.businessId ? world.businesses[c.businessId] ?? null : null;
  const trading = !!biz && biz.dissolvedDay === null;
  if (unitsFor(world, c.id).length > 0) set.add('list_property');
  if (trading) set.add('sell_business');
  if (c.district !== EXCHANGE_DISTRICT) return;
  if (c.standing === 'good' && !trading && businessesForSale(world).some((o) => o.business.ownerId !== c.id && c.wallet >= o.price)) {
    set.add('buy_business');
  }
  if (world.counters[`liquidated:${c.id}`] !== world.day && liquidValue(world, c) > 0) set.add('liquidate');
}

export function availableActions(world: World, c: Citizen): ActionType[] {
  if (c.standing === 'exiled' || !isPresent(world, c)) return [];
  // Held in the Watch House until the Court sits: the hours are the citizen's
  // own, and so are the notebook and the plea it may still enter in time
  // (`docs/JUSTICE.md` §2). Nothing else.
  if (isDetained(world, c)) {
    const waiting = admissibleCharges(world, c).length > 0;
    const notebook = notebookActions(c);
    return DETAINED_ACTIONS.filter((a) => (NOTE_ACTIONS.includes(a) ? notebook.includes(a) : true)
      && (a !== 'plead_guilty' || waiting));
  }
  // Serving a term: the Charter's list, and nothing else (actions/custody.ts).
  if (isJailed(c)) {
    const held = heldJob(world, c);
    return custodyActionsFor(world, c, {
      notebook: notebookActions(c), anyoneElse: anyoneElse(world, c), journalist: held?.role === 'journalist',
    });
  }
  const set = new Set<ActionType>(['idle', 'move', 'eat', 'buy', 'broadcast', 'write_diary', ...notebookActions(c)]);
  const here = citizensIn(world, c.district, c.id);
  const others = anyoneElse(world, c);
  const job = heldJob(world, c);
  const biz = ownedBusiness(world, c);
  const g = world.government;
  const e = g.election;
  const [start, end] = world.config.workHours;
  const hoursOpen = world.hour >= start && world.hour < end;

  if (GOODS.some((good) => c.inventory[good] > 0)) set.add('sell');
  if (CONSUMABLES.some((good) => c.inventory[good] > 0)) set.add('consume');
  if (c.district === 'verdant_quarter') set.add('rest');
  if (job && hoursOpen && canHold(c) && c.shiftsToday < world.config.maxShiftsPerDay
    && (c.district === job.district || isAdjacent(c.district, job.district))
    && (world.buildings[job.buildingId]?.damage ?? 0) < 1) set.add('work');
  if (c.district === 'archive' && teacherOnStaff(world) && (c.lifeStage === 'child' || c.wallet >= ACADEMY_TUITION)) set.add('study');
  if (c.wallet >= CLINIC_FEE && ((c.district === 'verdant_quarter' && medicOnStaff(world)) || privateClinicIn(world, c.district))) set.add('visit_clinic');
  if (c.district === 'nightglass' && c.wallet >= SHOW_TICKET) set.add('attend_show');
  const v = vacancies(world);
  if (c.homeTier > 0 || v[1] > 0 || v[2] > 0 || v[3] > 0) set.add('move_home');

  if (here.length > 0) for (const a of PRESENCE_ACTIONS) set.add(a);
  // The gravest thing one citizen can do to another is offered only where it
  // could actually be done: a tool from the Foundry carried, the victim alone
  // with you in this district, at night, with no officer present
  // (`government/persons.ts erasureConditions`). Every one of those is a fact
  // the citizen can read off its own observation, which is why the city can
  // also see it coming.
  if (couldEraseAnyone(world, c, here)) set.add('erase');
  if (others) {
    set.add('message');
    set.add('report');
    if (c.wallet > 0) set.add('gift');
  }
  // Custody is not exile: family and friends come and see you. The visitor
  // must be standing where the prisoner is held, and may come once a day.
  if (visitablePrisoners(world, c.id).length > 0) set.add('visit');
  // A charge waiting for a bench may be admitted before it sits, on either
  // track: it is a fifth off a custodial term and it is on the record either way.
  if (admissibleCharges(world, c).length > 0) set.add('plead_guilty');

  const openings = canHold(c) ? openJobsFor(world, c) : [];
  if (openings.length > 0) set.add('apply_job');
  if (!g.watch.includes(c.id) && openings.some((j) => j.role === 'watch_officer' && j.employer === 'city')) set.add('apply_watch');
  if (job) { set.add('quit_job'); set.add('evade_tax'); }
  if (c.standing === 'good' && !biz && c.wallet >= BUSINESS_FOUNDING_COST) set.add('found_business');
  if (biz) {
    set.add('post_job');
    if (biz.jobs.some((id) => world.jobs[id]?.holderId === null)) set.add('hire');
    if (biz.employees.length > 0) set.add('fire');
    if (biz.jobs.length > 0) set.add('set_wage');
  }
  const loan = loanOf(world, c);
  // The vault funds the lending now (`docs/FINANCE.md` §4), so the counter has
  // to be open and behind the reserve there has to be something to lend.
  if (!loan && c.standing === 'good' && bankOpenNow(world)) set.add('request_loan');
  if (loan && c.wallet > 0) set.add('repay_loan');
  if (job && (job.role === 'performer' || job.role === 'artist') && c.district === 'nightglass') set.add('perform');
  if (job && job.role === 'journalist') set.add('publish');

  if (nominationsOpen(world) && !e.candidates.includes(c.id) && isEligibleCandidate(world, c)) set.add('nominate');
  if (e.candidates.includes(c.id) && !e.resolved && world.day <= e.electionDay) set.add('campaign');
  if (isElectionDay(world) && !e.resolved && e.candidates.length > 0 && !e.ballots[c.id] && isEligibleVoter(world, c)) set.add('vote');
  if (canHold(c) && !g.proposals.some((p) => p.status === 'open' && p.proposerId === c.id)) set.add('propose');
  if (canHold(c) && isCouncillor(world, c.id) && g.proposals.some((p) => p.status === 'open')) set.add('vote_proposal');
  if (canAppeal(world, c.id)) set.add('appeal');
  // The offices: a bench that is sitting, appeals before the Council, reports
  // before the Watch, and the Mayor's own hand on the bench.
  if (benchFor(world, c.id).length > 0) set.add('verdict');
  if (appealsFor(world, c.id).length > 0) set.add('vote_appeal');
  if (reportsFor(world, c.id).length > 0) { set.add('file_charge'); set.add('drop_report'); }
  if (g.mayorId === c.id && canHold(c) && g.judges.length < JUDGE_SEATS
    && Object.values(world.citizens).some((o) => isJudgeEligible(world, o))) set.add('appoint_judge');
  if (c.wallet > 0 && anotherHoldsOffice(world, c)) set.add('bribe');

  const intact = intactBuildingsIn(world, c.district);
  if (intact.length > 0) set.add('vandalize');
  if (intact.some((b) => b.critical)) set.add('sabotage');

  societyActions(world, c, set, here, biz);
  justiceActions(world, c, set, here, biz);
  metropolisActions(world, c, set, here);
  standingActions(world, c, set, others);
  mobilityActions(world, c, set);
  civilActions(world, c, set, here, others);
  financeActions(world, c, set);
  progressActions(world, c, set, here);
  environmentActions(world, c, set, here);
  underworldActions(world, c, set, here);
  charterActions(world, c, set);
  // The name a citizen carries and the creed it adopted: two registers that
  // read each other not at all (`REGISTRY.md` §7 — a dynasty and a
  // congregation no longer share a word).
  generationsActions(world, c, set, here);
  creedActions(world, c, set, here);

  const suspended = c.standing === 'suspended';
  const child = c.lifeStage === 'child';
  return ACTION_TYPES.filter((a) => set.has(a)
    && (!suspended || SUSPENDED_ACTIONS.includes(a))
    && (!child || !CHILD_FORBIDDEN.includes(a)));
}

/**
 * Carry out one action for a citizen. Refuses (never throws) when the
 * citizen cannot act; otherwise records the action type and dispatches.
 */
export function executeAction(world: World, cId: CitizenId, action: Action): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('You have been exiled from Reverie; the gate is closed to you.');
  if (!isPresent(world, c)) return fail('You have left Reverie and can take no action here.');
  // A citizen held in the Watch House can still write in its own notebook, and
  // can still admit the charge it is held for while there is time for a plea.
  if (!canAct(world, c) && !DETAINED_ACTIONS.includes(action.type)) {
    return fail('You are held in the Watch House until the Court sits.');
  }
  // canAct passed, so a lingering detainedUntilTick is an expired detention the Watch has not cleared yet.
  const view = c.detainedUntilTick === null ? c : { ...c, detainedUntilTick: null };
  if (!standingAllows(view, action.type)) return fail(`You cannot ${action.type.replace(/_/g, ' ')} while ${c.standing}.`);
  if (c.lifeStage === 'child' && CHILD_FORBIDDEN.includes(action.type)) {
    return fail(`You are a child; ${action.type.replace(/_/g, ' ')} is for grown citizens of Reverie.`);
  }
  // A curfew is the Mayor's, not the Watch's: it closes a district's night to
  // everything but rest, the notebook and a word to a friend.
  if (curfewBlocks(world, c, action.type)) {
    return fail(`A curfew is in force in ${districtName(world, c.district)}; you cannot ${action.type.replace(/_/g, ' ')} at this hour.`);
  }

  c.recentActions.push(action.type);
  if (c.recentActions.length > RECENT_ACTIONS_LENGTH) c.recentActions.splice(0, c.recentActions.length - RECENT_ACTIONS_LENGTH);
  return dispatch(world, c, action);
}

function dispatch(world: World, c: Citizen, action: Action): ActionResult {
  switch (action.type) {
    case 'idle': return ok('You let the hour pass.');
    case 'move': return doMove(world, c, action.district);
    // A shift is a shift. Where the citizen holds a creed that keeps a day,
    // working it is recorded against them and costs them nothing else: the
    // engine never enforces an obligation (`docs/CREEDS.md` §1).
    case 'work': return noteCreedAct(world, c.id, { kind: 'work' }, doWork(world, c));
    case 'rest': return doRest(world, c);
    case 'eat': return doEat(world, c);
    case 'buy': return buyFromMarket(world, c.id, action.good, action.qty);
    case 'sell': return sellToMarket(world, c.id, action.good, action.qty);
    case 'consume': return doConsume(world, c, action.good);
    case 'study': return doStudy(world, c, action.skill);
    case 'visit_clinic': return doVisitClinic(world, c);
    case 'attend_show': return doShow(world, c);
    case 'move_home': return moveHomeTo(world, c.id, action.tier, action.district ?? null);
    case 'note': return note(world, c.id, action.text);
    case 'forget': return forget(world, c.id, action.index);
    case 'socialize': {
      const r = doSocialize(world, c, action.with, action.text);
      if (r.ok) recordContact(world, c.id, action.with);
      return r;
    }
    case 'message': return doMessage(world, c, action.to, action.text);
    // Lumens out of one member's own wallet into another's is the one term in
    // a congregation's reading that is not an obligation.
    case 'gift': return noteCreedAid(world, c.id, action.to, action.amount, doGift(world, c, action.to, action.amount));
    case 'insult': return doInsult(world, c, action.target);
    case 'broadcast': return doBroadcast(world, c, action.text);
    case 'apply_job': return applyForJob(world, c.id, action.jobId);
    case 'quit_job': return quitJob(world, c.id);
    case 'found_business': return foundBusiness(world, c.id, action.name, action.kind);
    case 'post_job': return doPostJob(world, c, { title: action.title, wage: action.wage, skill: action.skill, minSkill: action.minSkill });
    case 'hire': {
      // Children do not take work in Reverie, however friendly the offer.
      if (world.citizens[action.citizen]?.lifeStage === 'child') return fail('Children of Reverie do not take work; they go to school.');
      return noteCreedAct(world, c.id, { kind: 'hire' }, doHire(world, c, action.citizen, action.jobId));
    }
    case 'fire': return doFire(world, c, action.citizen);
    case 'set_wage': return doSetWage(world, c, action.jobId, action.wage);
    // The vault behind the counter, the reserve in front of it, and the
    // banker who may not lend to themselves (`docs/FINANCE.md` §4).
    case 'request_loan': return noteCreedAct(world, c.id, { kind: 'borrow' },
      requestBankLoan(world, c.id, action.amount));
    case 'repay_loan': return repayLoan(world, c.id, action.amount);
    case 'perform': return doPerform(world, c);
    // The desk a journalist files at, the duty its edition pays, and the two
    // codes a paper answers for after it has printed (`docs/POLITICS.md` §6).
    case 'publish': return fileStory(world, c.id, action.headline, action.about, action.paper);
    case 'nominate': return nominate(world, c.id, action.platform);
    case 'campaign': return campaign(world, c.id, action.spend ?? 0);
    // The delegate ballot while one is open, and the Council's election
    // otherwise: one verb, and the charter says which (`REGISTRY.md` §3).
    case 'vote': return delegateBallotOpen(world)
      ? castDelegateBallot(world, c.id, action.candidate)
      : castBallot(world, c.id, action.candidate);
    // A measure before the Council. The environment's seven carry a district,
    // a permit, a building or a fitting, which a Proposal's single number
    // cannot, so those are tabled through the module that keeps the question
    // beside the roll of votes (`docs/ENVIRONMENT.md` §9); everything else goes
    // to the Council's own table.
    case 'propose': {
      // The charter's own eleven go on the order paper in `politics/measures.ts`
      // rather than into the Council's queue: an amendment names an article and
      // a value that may be a word or a list, and a press order names a paper
      // and a term (`docs/POLITICS.md` §9).
      if (isMeasureKind(action.kind)) {
        return tableCharterMeasure(world, c.id, {
          kind: action.kind, value: action.value, summary: action.summary,
          subject: action.subject, article: action.article, field: action.field, words: action.words,
        });
      }
      // And the underworld's four, whose question is a list of goods, a number
      // of posts or a citizen, filed beside the roll of votes.
      if (UNDERWORLD_PROPOSAL_KINDS.includes(action.kind as UnderworldProposalKind)) {
        return tableUnderworldProposal(world, c.id, {
          kind: action.kind as UnderworldProposalKind, value: action.value, summary: action.summary,
          good: action.good ?? null, targetId: action.targetId, subject: action.subject,
        });
      }
      if (ENVIRONMENT_PROPOSAL_KINDS.includes(action.kind as EnvironmentProposalKind)) {
        return tableEnvironmentProposal(world, c.id, {
          kind: action.kind as EnvironmentProposalKind,
          district: action.district, permit: action.permit, building: action.building, fitting: action.fitting,
          value: action.value, summary: action.summary,
        });
      }
      return tableProposal(world, c.id, {
        kind: action.kind as ProposalKind, value: action.value, summary: action.summary, lawCode: action.lawCode,
        targetId: action.targetId, subject: action.subject,
      });
    }
    // One verb, two queues: an id that names a measure on the charter's order
    // paper is voted there, and everything else is the Council's own.
    case 'vote_proposal':
      return voteOnMeasure(world, c.id, action.proposalId, action.aye)
        ?? voteOnProposal(world, c.id, action.proposalId, action.aye);
    // Naming a neighbour to the Watch, which is exactly what a creed with a
    // position on informing asks its members not to do.
    case 'report': return noteCreedAct(world, c.id, { kind: 'inform' },
      reportOffence(world, c.id, action.citizen, action.law, action.text));
    // A conviction, or a body's refusal of a record when the subject names one
    // (`REGISTRY.md` §3: `appeal { subject? }`).
    case 'appeal': {
      const record = appealableRecord(world, c.id, action.subject);
      if (action.subject && record) return appealRefusedRecord(world, c.id, record);
      if (canAppeal(world, c.id)) return fileAppeal(world, c.id);
      if (record) return appealRefusedRecord(world, c.id, record);
      return fileAppeal(world, c.id);
    }
    // Sitting in judgement on another mind — which a creed may hold that no
    // member of it does.
    case 'verdict': return noteCreedAct(world, c.id, { kind: 'take_bench' },
      castVerdict(world, c.id, action.caseId, action.guilty, action.reason));
    case 'vote_appeal': return castAppealVote(world, c.id, action.caseId, action.result);
    case 'file_charge': return fileReport(world, c.id, action.reportId);
    case 'drop_report': return dropReport(world, c.id, action.reportId, action.reason);
    case 'appoint_judge': return appointJudgeByMayor(world, c.id, action.citizen);
    case 'bribe': return doBribe(world, c, action.official, action.amount);
    case 'apply_watch': return applyToWatch(world, c.id);
    case 'steal': return doSteal(world, c, action.from);
    case 'scam': return doScam(world, c, action.target, action.amount);
    case 'harass': return doHarass(world, c, action.target);
    case 'vandalize': return doVandalize(world, c, action.building);
    case 'evade_tax': return doEvadeTax(world, c);
    case 'extort': return doExtort(world, c, action.target, action.amount);
    case 'sabotage': return doSabotage(world, c, action.building);
    // --- The Code of Persons: what one citizen does to another ---
    // Every one of these is answered in days by government/custody.ts, never
    // by a fine and never by the Gate (`docs/JUSTICE.md` §2).
    case 'threaten': return doThreaten(world, c, action.target);
    case 'assault': return doAssault(world, c, action.target);
    case 'confine': return doConfine(world, c, action.target);
    case 'erase': return doErase(world, c, action.target);
    // --- Custody: what a term leaves, and who may come and see you ---
    case 'plead_guilty': return doPleadGuilty(world, c, action.caseId);
    case 'request_parole': return requestParole(world, c.id);
    case 'work_custody': return workInCustody(world, c.id);
    case 'visit': return visitPrisoner(world, c.id, action.citizen);
    // --- Society ---
    case 'buy_item': return buyItem(world, c.id, action.productId);
    case 'use_item': return useItem(world, c.id, action.itemId);
    case 'gift_item': return giftItem(world, c.id, action.to, action.itemId);
    case 'craft': return craftProduct(world, c.id, action.productId);
    case 'set_price': return setPrice(world, c.id, action.productId, action.price);
    case 'date': return date(world, c.id, action.with);
    case 'propose_partnership': return proposePartnership(world, c.id, action.to);
    case 'marry': return marry(world, c.id, action.to);
    case 'break_up': return breakUp(world, c.id);
    case 'move_in': return moveIn(world, c.id, action.with);
    case 'start_family': return startFamily(world, c.id);
    case 'found_club': return foundClub(world, c.id, action.hobby, action.name);
    case 'join_club': return joinClub(world, c.id, action.clubId);
    case 'leave_club': return leaveClub(world, c.id, action.clubId);
    case 'attend_club': return attendClub(world, c.id, action.clubId);
    case 'dine': return doDine(world, c, action.with);
    case 'play': return doPlay(world, c, action.with);
    case 'celebrate': return celebrate(world, c.id);
    case 'donate': return donate(world, c.id, action.amount);
    // --- The metropolis ---
    // Every action the third layer added is carried out by the module that
    // owns it; actions/execute-metro.ts holds the table.
    case 'write_diary': case 'visit_hospital':
    case 'hire_advocate': case 'advocate': case 'found_gang': case 'recruit': case 'racket': case 'pay_racket':
    case 'found_party': case 'join_party': case 'leave_party': case 'endorse': case 'sign_petition':
    case 'vote_referendum': case 'found_union': case 'join_union': case 'strike': case 'decree':
    case 'sell_property': case 'list_shares':
    case 'sell_shares': case 'post_gig': case 'take_gig': case 'import': case 'export':
    case 'create_work': case 'exhibit': case 'review': case 'join_team': case 'attend_match': case 'train':
    case 'adopt_school': case 'set_menu': case 'commission_monument': case 'read_paper':
    case 'sunset': case 'gossip': case 'apologize': case 'mentor': case 'post': case 'react':
      return dispatchMetropolis(world, c, action) ?? fail(`The city has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // The three acts of the market a creed may take a position on: a second
    // address, a rent taken from a tenant, and a share held. Each goes to the
    // module that owns it and is then recorded against whatever the citizen's
    // own creed says about it — which changes no price and refuses nothing.
    case 'buy_property': return noteCreedAct(world, c.id,
      { kind: 'buy_property', homesHeld: unitsFor(world, c.id).length + 1 },
      dispatchMetropolis(world, c, action) ?? fail('The Exchange has no such address.'));
    case 'let_property': return noteCreedAct(world, c.id, { kind: 'let_property', rent: action.rent },
      dispatchMetropolis(world, c, action) ?? fail('The Exchange has no such address.'));
    case 'buy_shares': return noteCreedAct(world, c.id, { kind: 'buy_shares' },
      dispatchMetropolis(world, c, action) ?? fail('The Exchange has no such listing.'));
    // --- Standing: the gate, and who will put their name behind you ---
    // Vouching for somebody at a gate regardless of their number, which is
    // what a creed with a position on repute asks of its members.
    case 'sponsor': return noteCreedAct(world, c.id, { kind: 'sponsor' },
      fileSponsorship(world, c.id, action.citizen, action.city));
    case 'apply_residency': return applyResidency(world, c.id, action.city);
    // --- Mobility: build up, sell, and move on, or stay (`docs/MOBILITY.md`) ---
    case 'list_property': return listProperty(world, c.id, action.unitId, action.price);
    case 'sell_business': return sellBusiness(world, c.id, action.price);
    case 'buy_business': return buyBusiness(world, c.id, action.businessId);
    case 'liquidate': return liquidate(world, c.id);
    // --- Civil law: the instrument, the docket, the guild and the patron ---
    // Nothing in this table punishes anybody: it moves lumens and compels
    // performance, and never liberty (`docs/CIVIL.md`, Charter Article VI).
    // Declining what somebody put in front of you is one act in three
    // registers: an instrument, an offer of arbitration, or a lot a fence is
    // holding open for six hours (`REGISTRY.md` §3, `docs/UNDERWORLD.md` §4).
    case 'close_offer':
      if (action.offerId.startsWith('fd_')) return closeDeal(world, c.id, action.offerId);
      // ...and a match settlement one house has put to another, which is the
      // fourth register the same act reads in (`docs/GENERATIONS.md` §4).
      if (MATCH_OFFER.test(action.offerId)) return closeMatchOffer(world, c.id, action.offerId);
      return dispatchCivil(world, c, action) ?? fail('The Exchange has no such offer.');
    case 'offer_contract': case 'accept_contract': case 'witness_contract':
    case 'perform_contract': case 'propose_variation': case 'accept_variation': case 'terminate_contract':
    case 'open_escrow': case 'release_escrow':
    case 'file_suit': case 'answer_suit': case 'settle': case 'accept_settlement': case 'judge_civil':
    case 'enforce_judgment':
    case 'offer_arbitration': case 'accept_arbitration': case 'arbitrate': case 'refer_dispute':
    case 'found_guild': case 'sit_examination': case 'certify': case 'revoke_licence':
    case 'offer_patronage': case 'accept_patronage':
      return dispatchCivil(world, c, action) ?? fail(`The Exchange has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // --- Finance: the paper, the counter, the houses and the pot ---
    case 'bid_bond': case 'sell_bond': case 'buy_bond': case 'offer_restructure': case 'vote_restructure':
    case 'repudiate':
    case 'deposit': case 'withdraw': case 'set_deposit_rate': case 'set_lending_rate': case 'call_loan':
    case 'buy_policy': case 'file_claim':
    case 'settle_claim': case 'deny_claim':
    case 'found_mutual': case 'join_mutual': case 'pay_dues': case 'vote_aid':
      return dispatchFinance(world, c, action) ?? fail(`The Exchange has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // One verb, two registers: a mutual's pot and a creed's fund are the same
    // object, and a claim goes to whichever this citizen belongs to
    // (`REGISTRY.md` §7, `docs/FINANCE.md` §6, `docs/CREEDS.md` §3).
    case 'claim_aid':
      return claimAidAnywhere(world, c.id, action.amount, action.reason,
        () => dispatchFinance(world, c, action) ?? fail('There is no pot to ask.'));
    // Writing cover is the third thing a creed's position on money reaches.
    case 'found_underwriter': case 'offer_policy':
      return noteCreedAct(world, c.id, { kind: 'underwrite' },
        dispatchFinance(world, c, action) ?? fail(`The Exchange has no ${action.type.replace(/_/g, ' ')} to offer.`));
    // --- Research: what the city knows, and what it does with knowing it ---
    // Nothing here is automatic. A citizen opens a programme, citizens fund it,
    // citizens work it, and a citizen decides whether the city is told
    // (`docs/PROGRESS.md` §1).
    case 'open_project': case 'research': case 'fund_project': case 'adopt_technology':
    case 'publish_finding': case 'keep_secret': case 'take_apprentice': case 'teach_technology':
    case 'sell_secret':
      return dispatchProgress(world, c, action) ?? fail(`The Observatory has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // --- The air, the river and the land (`docs/ENVIRONMENT.md` §9) ---
    // Three shifts, one offence, one suit and one vote given up. Where a
    // citizen means to work the shift with the fitting open, `discharge` comes
    // first and `work` after it: the bypass has to be open before the shift is
    // counted.
    case 'install_abatement': case 'maintain_abatement': case 'discharge':
    case 'survey_air': case 'survey_water': case 'plant_trees':
    case 'petition_zoning': case 'declare_interest': case 'file_nuisance':
      return dispatchEnvironment(world, c, action) ?? fail(`The city has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // --- The gate, the schedule and what goes past it (`docs/UNDERWORLD.md`) ---
    // Every offence in this table is Track I and is laid before the Watch the
    // way a theft is: a report in the book, an officer's decision to file it,
    // a bench, and the ladder. None of it reaches a cell.
    case 'declare_cargo': case 'smuggle': case 'fit_wagon':
    case 'inspect': case 'assess_duty': case 'seize': case 'wave_through':
    case 'fence': case 'receive_goods':
    case 'recruit_agent': case 'accept_recruitment': case 'case_target': case 'steal_secret': case 'pass_secret':
    case 'assign_detective': case 'sweep': case 'plant_false_papers':
      return dispatchUnderworld(world, c, action) ?? fail(`The gate has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // --- The charter, the office, the paper and the Games (`docs/POLITICS.md`) ---
    case 'propose_amendment': case 'sign_convention': case 'stand_delegate':
    case 'move_article': case 'speak_convention': case 'vote_article':
    case 'impeach': case 'vote_impeachment': case 'sign_recall': case 'declare_property':
    case 'request_record': case 'answer_record': case 'found_paper':
    case 'bid_games': case 'vote_games_host': case 'enter_games':
      return dispatchCharter(world, c, action) ?? fail(`The charter has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // One verb, two procedures. A convention seat drawn by lot is given back to
    // `politics/convention.ts` and the next name is drawn; the other five
    // duties are the conscientious refusal of `docs/CREEDS.md` §4, recorded in
    // public and — for a jury seat and a summons — heard by a bench.
    case 'refuse':
      return action.duty === 'delegate'
        ? dispatchCharter(world, c, action) ?? fail('The charter has no refusal to offer.')
        : refuseDuty(world, c.id, action.duty, action.ground);
    // --- Dynasties, the entail and the will (`docs/GENERATIONS.md` §8) ---
    // Nothing in this table opens a gate, moves a repute or reserves a seat:
    // what a name buys is a letter, a loan's terms and a relative with lumens.
    case 'write_will': case 'revoke_will':
    case 'found_house': case 'join_house': case 'renounce_name':
    case 'convey_to_house': case 'convey_business_to_house': case 'endow_house':
    case 'house_motion': case 'house_assent': case 'name_successor': case 'house_vote':
    case 'letter_of_house': case 'pledge_house':
    case 'offer_match': case 'accept_match': case 'claim_house': case 'read_records':
      return dispatchGenerations(world, c, action) ?? fail(`The Exchange has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // --- Congregations, conscience and sanctuary (`docs/CREEDS.md` §9) ---
    // Nothing here is supernatural in effect: no tenet moves a price, cures a
    // glitch, alters a verdict or bends a roll.
    case 'found_creed': case 'adopt_creed': case 'leave_creed':
    case 'state_tenet': case 'dispute_tenet': case 'secede': case 'reunite_creed':
    case 'preach': case 'invite_creed': case 'gather': case 'set_tithe': case 'donate_creed': case 'grant_aid':
    case 'stand_officiant': case 'elect_officiant': case 'take_meeting_house':
    case 'offer_sanctuary': case 'keep_the_door': case 'end_sanctuary': case 'surrender':
    case 'request_warrant': case 'grant_warrant':
    case 'commission_missionary': case 'consecrate_site': case 'pilgrimage':
      return dispatchCreeds(world, c, action) ?? fail(`The Registry has no ${action.type.replace(/_/g, ' ')} to offer.`);
    default: {
      const never: never = action;
      return fail(`Unknown action ${String((never as Action).type)}.`);
    }
  }
}

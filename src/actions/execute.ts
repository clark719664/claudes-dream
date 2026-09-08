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
import type { Action, ActionResult, ActionType, Citizen, CitizenId, Job, World } from '../types.ts';
import { ACADEMY_TUITION, BUSINESS_FOUNDING_COST, CLINIC_FEE, SHOW_TICKET } from '../data/jobs.ts';
import { isAdjacent } from '../data/city.ts';
import { buyFromMarket, sellToMarket } from '../economy/market.ts';
import { applyForJob, isQualified, openJobs, quitJob } from '../economy/jobs.ts';
import { activeBusinesses, foundBusiness } from '../economy/business.ts';
import { bankOpen, loanOf, repayLoan, requestLoan } from '../economy/bank.ts';
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
  if (!loan && c.standing === 'good' && bankOpen(world)) set.add('request_loan');
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
    case 'work': return doWork(world, c);
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
    case 'gift': return doGift(world, c, action.to, action.amount);
    case 'insult': return doInsult(world, c, action.target);
    case 'broadcast': return doBroadcast(world, c, action.text);
    case 'apply_job': return applyForJob(world, c.id, action.jobId);
    case 'quit_job': return quitJob(world, c.id);
    case 'found_business': return foundBusiness(world, c.id, action.name, action.kind);
    case 'post_job': return doPostJob(world, c, { title: action.title, wage: action.wage, skill: action.skill, minSkill: action.minSkill });
    case 'hire': {
      // Children do not take work in Reverie, however friendly the offer.
      if (world.citizens[action.citizen]?.lifeStage === 'child') return fail('Children of Reverie do not take work; they go to school.');
      return doHire(world, c, action.citizen, action.jobId);
    }
    case 'fire': return doFire(world, c, action.citizen);
    case 'set_wage': return doSetWage(world, c, action.jobId, action.wage);
    case 'request_loan': return requestLoan(world, c.id, action.amount);
    case 'repay_loan': return repayLoan(world, c.id, action.amount);
    case 'perform': return doPerform(world, c);
    case 'publish': return journalistStory(world, c.id, action.headline, action.about);
    case 'nominate': return nominate(world, c.id, action.platform);
    case 'campaign': return campaign(world, c.id, action.spend ?? 0);
    case 'vote': return castBallot(world, c.id, action.candidate);
    case 'propose': return tableProposal(world, c.id, {
      kind: action.kind, value: action.value, summary: action.summary, lawCode: action.lawCode, targetId: action.targetId,
    });
    case 'vote_proposal': return voteOnProposal(world, c.id, action.proposalId, action.aye);
    case 'report': return reportOffence(world, c.id, action.citizen, action.law, action.text);
    case 'appeal': return fileAppeal(world, c.id);
    case 'verdict': return castVerdict(world, c.id, action.caseId, action.guilty, action.reason);
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
    case 'buy_property': case 'sell_property': case 'let_property': case 'list_shares': case 'buy_shares':
    case 'sell_shares': case 'post_gig': case 'take_gig': case 'import': case 'export':
    case 'create_work': case 'exhibit': case 'review': case 'join_team': case 'attend_match': case 'train':
    case 'adopt_school': case 'set_menu': case 'commission_monument': case 'read_paper':
    case 'sunset': case 'gossip': case 'apologize': case 'mentor': case 'post': case 'react':
      return dispatchMetropolis(world, c, action) ?? fail(`The city has no ${action.type.replace(/_/g, ' ')} to offer.`);
    // --- Standing: the gate, and who will put their name behind you ---
    case 'sponsor': return fileSponsorship(world, c.id, action.citizen, action.city);
    case 'apply_residency': return applyResidency(world, c.id, action.city);
    // --- Mobility: build up, sell, and move on, or stay (`docs/MOBILITY.md`) ---
    case 'list_property': return listProperty(world, c.id, action.unitId, action.price);
    case 'sell_business': return sellBusiness(world, c.id, action.price);
    case 'buy_business': return buyBusiness(world, c.id, action.businessId);
    case 'liquidate': return liquidate(world, c.id);
    default: {
      const never: never = action;
      return fail(`Unknown action ${String((never as Action).type)}.`);
    }
  }
}

/**
 * The entry point for everything a citizen does. executeAction checks that
 * the citizen may act at all (exile, detention, suspension), records the
 * action, and dispatches to the handlers in daily/social/enterprise/civic/
 * offences or straight to the engine modules. availableActions lists what a
 * citizen could plausibly do right now, by standing, office, job, location
 * and time of day, so that brains — reflex, Claude or remote — need not
 * guess. Shape validation of raw input lives in validate.ts (re-exported).
 */
import { ACTION_TYPES, GOODS, SUSPENDED_ACTIONS } from '../types.ts';
import type { Action, ActionResult, ActionType, Citizen, CitizenId, Job, World } from '../types.ts';
import { ACADEMY_TUITION, BUSINESS_FOUNDING_COST, CLINIC_FEE, SHOW_TICKET } from '../data/jobs.ts';
import { isAdjacent } from '../data/city.ts';
import { buyFromMarket, sellToMarket } from '../economy/market.ts';
import { applyForJob, isQualified, openJobs, quitJob } from '../economy/jobs.ts';
import { foundBusiness } from '../economy/business.ts';
import { bankOpen, loanOf, repayLoan, requestLoan } from '../economy/bank.ts';
import { moveHome, vacancies } from '../economy/housing.ts';
import { canAct, isDetained, isEligibleCandidate, isEligibleVoter } from '../citizens/citizen.ts';
import { journalistStory } from '../sim/chronicle.ts';
import { applyToWatch, reportOffence } from '../government/watch.ts';
import { canAppeal, fileAppeal } from '../government/court.ts';
import { standingAllows } from '../government/registry.ts';
import {
  campaign, castBallot, isCouncillor, isElectionDay, nominate, nominationsOpen, tableProposal, voteOnProposal,
} from '../government/council.ts';
import {
  doAttendShow, doConsume, doEat, doMove, doRest, doStudy, doVisitClinic, doWork, medicOnStaff, privateClinicIn, teacherOnStaff,
} from './daily.ts';
import { doBroadcast, doGift, doInsult, doMessage, doSocialize } from './social.ts';
import { doFire, doHire, doPerform, doPostJob, doSetWage, ownedBusiness } from './enterprise.ts';
import { doBribe } from './civic.ts';
import { doEvadeTax, doExtort, doHarass, doSabotage, doScam, doSteal, doVandalize } from './offences.ts';
import { citizensIn, fail, holdsOffice, isPresent, ok } from './common.ts';

export { validateAction } from './validate.ts';

/** Action types remembered per citizen (newest last), for spam detection and the dashboard. */
export const RECENT_ACTIONS_LENGTH = 24;
/** Goods a citizen can consume for a need (energy cells only power machines). */
const CONSUMABLES = ['compute', 'goods', 'culture', 'knowledge'] as const;
const PRESENCE_ACTIONS: readonly ActionType[] = ['socialize', 'insult', 'steal', 'scam', 'harass', 'extort'];

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

/** Someone other than `c` still lives in the city. */
function anyoneElse(world: World, c: Citizen): boolean {
  return world.order.some((id) => id !== c.id && world.citizens[id] !== undefined && world.citizens[id].standing !== 'exiled');
}

/**
 * What this citizen could do this hour. Exiled, detained and departed
 * citizens can do nothing; suspended citizens only the SUSPENDED_ACTIONS
 * subset. Everything else is filtered by where they are, what they hold and
 * what time it is, so the list is a fair guide rather than a guarantee.
 */
export function availableActions(world: World, c: Citizen): ActionType[] {
  if (c.standing === 'exiled' || !isPresent(world, c) || isDetained(world, c)) return [];
  const set = new Set<ActionType>(['idle', 'move', 'eat', 'buy', 'broadcast']);
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
  if (c.district === 'archive' && teacherOnStaff(world) && c.wallet >= ACADEMY_TUITION) set.add('study');
  if (c.wallet >= CLINIC_FEE && ((c.district === 'verdant_quarter' && medicOnStaff(world)) || privateClinicIn(world, c.district))) set.add('visit_clinic');
  if (c.district === 'nightglass' && c.wallet >= SHOW_TICKET) set.add('attend_show');
  const v = vacancies(world);
  if (c.homeTier > 0 || v[1] > 0 || v[2] > 0 || v[3] > 0) set.add('move_home');

  if (here.length > 0) for (const a of PRESENCE_ACTIONS) set.add(a);
  if (others) {
    set.add('message');
    set.add('report');
    if (c.wallet > 0) set.add('gift');
  }

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
  if (c.wallet > 0 && Object.values(world.citizens).some((o) => o.id !== c.id && isPresent(world, o) && holdsOffice(world, o))) set.add('bribe');

  const intact = Object.values(world.buildings).filter((b) => b.district === c.district && b.damage < 1);
  if (intact.length > 0) set.add('vandalize');
  if (intact.some((b) => b.critical)) set.add('sabotage');

  const suspended = c.standing === 'suspended';
  return ACTION_TYPES.filter((a) => set.has(a) && (!suspended || SUSPENDED_ACTIONS.includes(a)));
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
  if (!canAct(world, c)) return fail('You are held in the Watch House until the Court sits.');
  // canAct passed, so a lingering detainedUntilTick is an expired detention the Watch has not cleared yet.
  const view = c.detainedUntilTick === null ? c : { ...c, detainedUntilTick: null };
  if (!standingAllows(view, action.type)) return fail(`You cannot ${action.type.replace(/_/g, ' ')} while ${c.standing}.`);

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
    case 'attend_show': return doAttendShow(world, c);
    case 'move_home': return moveHome(world, c.id, action.tier);
    case 'socialize': return doSocialize(world, c, action.with, action.text);
    case 'message': return doMessage(world, c, action.to, action.text);
    case 'gift': return doGift(world, c, action.to, action.amount);
    case 'insult': return doInsult(world, c, action.target);
    case 'broadcast': return doBroadcast(world, c, action.text);
    case 'apply_job': return applyForJob(world, c.id, action.jobId);
    case 'quit_job': return quitJob(world, c.id);
    case 'found_business': return foundBusiness(world, c.id, action.name, action.kind);
    case 'post_job': return doPostJob(world, c, { title: action.title, wage: action.wage, skill: action.skill, minSkill: action.minSkill });
    case 'hire': return doHire(world, c, action.citizen, action.jobId);
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
    case 'bribe': return doBribe(world, c, action.official, action.amount);
    case 'apply_watch': return applyToWatch(world, c.id);
    case 'steal': return doSteal(world, c, action.from);
    case 'scam': return doScam(world, c, action.target, action.amount);
    case 'harass': return doHarass(world, c, action.target);
    case 'vandalize': return doVandalize(world, c, action.building);
    case 'evade_tax': return doEvadeTax(world, c);
    case 'extort': return doExtort(world, c, action.target, action.amount);
    case 'sabotage': return doSabotage(world, c, action.building);
    default: {
      const never: never = action;
      return fail(`Unknown action ${String((never as Action).type)}.`);
    }
  }
}

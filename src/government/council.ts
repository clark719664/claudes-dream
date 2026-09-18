/**
 * The Council: proposals and petitions, the daily session (votes, enactment,
 * appeals, judicial appointments), the Mayor's succession, and the daily
 * government pass. Elections live in elections.ts and are re-exported here.
 */
import { PROFESSIONS, clamp } from '../types.ts';
import type {
  ActionResult, Citizen, CitizenId, DistrictId, LawCode, Proposal, ProposalKind, World,
} from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { MONUMENT_COST, TRAM_COST } from '../data/jobs.ts';
import { nextId } from '../util/ids.ts';
import { chance, rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { lastBalanceSheet, transfer } from '../economy/treasury.ts';
import { fiscalPressure, treasuryDrainPerDay } from '../economy/budget.ts';
import { joblessShare } from '../economy/planning.ts';
import { addHousingProgress } from '../economy/housing.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { isDetained, isPresent, sittingCouncil } from './cases.ts';
import { decideAppeals } from './court.ts';
import { pardonCitizen } from './registry.ts';
import { holdElection, impliedPlatform, openNominations, wasVictim } from './elections.ts';
import { applyLever, leverRanges } from '../markets/levers.ts';
import { WHIP_STRENGTH, whipVote } from '../politics/parties.ts';
import { enactTram } from '../world/growth.ts';
import { commissionMonument, monumentsTo } from '../world/history.ts';
import { noteAbuseOfOffice } from './investigations.ts';
import { districtName } from '../actions/common.ts';
import { MIN_WAGE_CEILING, MIN_WAGE_FLOOR } from '../politics/promises.ts';
// The two newest layers legislate through the same door as everything else.
import { enactFinanceProposal, mostPressingIssue } from '../finance/daily.ts';
import { bankSuspended } from '../finance/bank.ts';
import { setDocketDays, setFilingFee } from '../civil/docket.ts';
import { setLicenceFloor } from '../civil/licences.ts';
// What the city knows, and what its shifts leave behind. A research grant and
// a set of works are money like any other vote; the environment's seven carry
// a district, a permit, a building or a fitting, which the layer that owns
// them keeps beside this roll of votes.
import {
  cityHolds, enactAdoption, enactResearchGrant, isTechnologyId, pledgedFor, projectById, purseOf, technologyName,
  tramAllowed,
} from '../progress/index.ts';
import type { TechnologyId } from '../progress/index.ts';
import {
  PERMIT_PREMIUM, airLevel, enactEnvironmentProposal, environmentQuestionOf, environmentState, hasDeclared,
  permitOf, zoningGain,
} from '../environment/index.ts';
// The four questions the underworld puts to a council (`docs/UNDERWORLD.md`
// §7). The Council decides; these only carry out what it decided.
import {
  CONTRABAND_POSSESSION, HOME_CITY, amnestyRunning, contrabandOn, customsPostsNeeded, enactSpyDisposition,
  enactUnderworldQuestion, restrictionsFor, underworldQuestion, underworldState,
} from '../underworld/index.ts';
import { claimants, enactCharity } from '../society/chest.ts';

export { sittingCouncil } from './cases.ts';

export {
  campaign, castBallot, daysToElection, holdElection, impliedPlatform, isElectionDay, nominate, nominationsOpen,
  openNominations, voterPreference,
} from './elections.ts';

export const JUDGE_SEATS = 3;
export const JUDGE_MIN_REPUTATION = 60;
/**
 * Days a vacant seat on the bench is held open for the Mayor to fill by their
 * own hand (the `appoint_judge` action) before the procedure fills it.
 */
export const JUDGE_VACANCY_GRACE_DAYS = 3;
/**
 * Nobody arrives with the standing the Charter asks of a judge: every citizen
 * starts at 50 and earns the rest by living well. Rather than leave the Court
 * to temporary judges drawn by lot for the first weeks of the city, the bench
 * falls back to the most reputable citizens who are at least this well
 * thought of and have never been convicted.
 */
export const JUDGE_FALLBACK_REPUTATION = 50;
/** A proposal nobody can vote on (no Council seated) lapses after this many days. */
export const PROPOSAL_LAPSE_DAYS = 7;
/** Decided proposals kept for the record. */
const PROPOSAL_HISTORY = 200;
/** A bond above this between the Mayor and an appointee is a favour, not a judgement. */
export const FRIENDLY_APPOINTMENT_BOND = 60;
/**
 * Four of five, the charter threshold. Minting takes value from everybody
 * holding a lumen without any of them voting (`docs/FINANCE.md` §7), so it
 * asks the same majority a pardon does.
 */
export const CHARTER_MAJORITY = 4;
const SUPERMAJORITY_KINDS: readonly ProposalKind[] = ['pardon', 'charter', 'remove_mayor', 'mint'];
const TARGETED_KINDS: readonly ProposalKind[] = [
  'appoint_judge', 'dismiss_judge', 'pardon', 'remove_mayor', 'monument',
  // What the city does with a caught agent names the agent (`UNDERWORLD.md` §6).
  'spy_disposition',
];
/** Kinds that carry neither a value the Council checks nor a citizen to name. */
const OPEN_KINDS: readonly ProposalKind[] = [
  'charter', 'tram', 'bond_defer',
  // The environment's seven (`docs/ENVIRONMENT.md` §9). They carry a district,
  // a permit, a building or a fitting rather than a number the Council can
  // check, and `environment/proposals.ts` checks each of those itself — but a
  // referendum and an appeal both reach this file, so the kinds have to be
  // known here as well.
  'zone', 'conserve', 'emission_charge', 'host_payment', 'abatement_works', 'relocate_works', 'buy_out',
];
/** Kinds that name one thing beside their number (`docs/PROGRESS.md` §8). */
const SUBJECT_KINDS: readonly ProposalKind[] = ['research_grant', 'adopt_technology'];
const VALUE_RANGES: Partial<Record<ProposalKind, [number, number]>> = {
  income_tax: [0, 0.5], sales_tax: [0, 0.25], dividend: [0, 60], min_wage: [MIN_WAGE_FLOOR, MIN_WAGE_CEILING], law_severity: [1, 5], public_works: [0, 5000],
  // `charity` was a ProposalKind from the founding and passed the action
  // validator, but it appeared in none of the three lists this file checks —
  // so `tableProposal` answered every charity motion with "There is no such
  // kind of proposal." Between that, the missing enactment case and the fact
  // that nothing ever tabled one, the Community Chest's only public inflow was
  // dead at three separate layers for the life of the project.
  charity: [0, 20_000],
  // The four levers the metropolis added; markets/levers.ts owns their bounds.
  ...leverRanges(),
  // Finance (`docs/FINANCE.md` §§1, 4, 5, 7): lumens of face for an issue
  // (20 to 3,000 bonds at 100 ℓ each), a ratio for the reserve, and lumens for
  // a rescue or a minting. `bond_defer` names no number at all.
  bond_issue: [2_000, 300_000], reserve_ratio: [0.1, 1], bank_rescue: [1, 100_000], mint: [1, 100_000],
  // Civil law (`docs/CIVIL.md` §§1, 4, 7): the flat part of what filing an
  // instrument costs, how many days a week the docket sits, and the statutory
  // floor under a guild's bar.
  filing_fee: [0, 60], docket_days: [1, 7], licence_floor: [0, 100],
  // Research (`docs/PROGRESS.md` §§1, 3): lumens into a named programme's
  // purse, and lumens pledged to a named subject's works. Both name their
  // thing in the proposal's `subject`.
  research_grant: [1, 20_000], adopt_technology: [0, 20_000],
  // The underworld's questions (`docs/UNDERWORLD.md` §§1, 3, 6): the severity
  // a schedule entry carries, the days an amnesty runs, how many customs posts
  // the gates carry, and which of the three answers a caught agent gets.
  restrict_good: [1, 3], amnesty: [0, 28], customs_posts: [0, 12], spy_disposition: [0, 2],
};

export interface ProposalSpec {
  kind: ProposalKind;
  value: number;
  summary: string;
  lawCode?: LawCode;
  targetId?: CitizenId;
  /**
   * The one named thing some measures carry beside their number: the programme
   * a `research_grant` pays into, or the subject an `adopt_technology` builds
   * the works for (`docs/PROGRESS.md` §8).
   */
  subject?: string;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

function inGoodStanding(c: Citizen): boolean {
  return c.standing === 'good' || c.standing === 'probation';
}

export function isCouncillor(world: World, cId: CitizenId): boolean {
  const g = world.government;
  return g.mayorId === cId || g.council.includes(cId);
}

/** The office a citizen falls back to when they leave the Council: their Watch post, if any. */
function residualOffice(world: World, cId: CitizenId): 'watch' | null {
  return world.government.watch.includes(cId) ? 'watch' : null;
}

// ---------------------------------------------------------------------------
// Judges
// ---------------------------------------------------------------------------

/** Good standing, reputation at or above `minReputation` (60 by the Charter), clean record, no other office, grown up. */
export function isJudgeEligible(world: World, c: Citizen, minReputation: number = JUDGE_MIN_REPUTATION): boolean {
  const g = world.government;
  if (c.standing !== 'good' || !isPresent(world, c) || isDetained(world, c)) return false;
  if (c.lifeStage === 'child') return false;
  if (c.reputation < minReputation || c.record.convictions.length > 0) return false;
  if (c.office !== null || isCouncillor(world, c.id) || g.watch.includes(c.id) || g.judges.includes(c.id)) return false;
  return true;
}

function seatJudge(world: World, c: Citizen): void {
  const g = world.government;
  c.office = 'judge';
  c.judgeTermEndsDay = world.day + world.config.judgeTermDays;
  if (!g.judges.includes(c.id)) g.judges.push(c.id);
  remember(world, c.id, 'civic', `You were appointed a judge of the Court until day ${c.judgeTermEndsDay}.`);
}

/** Judges who can no longer serve (gone, suspended, exiled) leave the bench. */
function pruneJudges(world: World): void {
  const g = world.government;
  for (const id of [...g.judges]) {
    const c = world.citizens[id];
    if (c && inGoodStanding(c) && isPresent(world, c)) continue;
    g.judges = g.judges.filter((j) => j !== id);
    if (c) {
      if (c.office === 'judge') c.office = null;
      c.judgeTermEndsDay = null;
    }
  }
}

/**
 * A Mayor who thinks for itself is given three days to fill a vacant seat
 * before the procedure does it for them. A scripted Mayor's choice is already
 * what the procedure makes, and with no Mayor there is nobody to wait for, so
 * in both of those cases the bench is filled at once.
 */
function seatsHeldForMayor(world: World): boolean {
  const g = world.government;
  const mayor = g.mayorId ? world.citizens[g.mayorId] ?? null : null;
  if (!mayor || mayor.brain === 'reflex' || !inGoodStanding(mayor) || !isPresent(world, mayor)) return false;
  const since = world.counters.judgeVacancySinceDay;
  if (since === undefined) {
    world.counters.judgeVacancySinceDay = world.day;
    return true;
  }
  return world.day - since < JUDGE_VACANCY_GRACE_DAYS;
}

/** The Mayor seats a citizen on the bench of the Court by their own hand. */
export function appointJudgeByMayor(world: World, mayorId: CitizenId, targetId: CitizenId): ActionResult {
  const g = world.government;
  const mayor = world.citizens[mayorId];
  if (!mayor) return fail('Unknown citizen.');
  if (g.mayorId !== mayorId) return fail('Only the Mayor appoints judges.');
  if (!inGoodStanding(mayor) || !isPresent(world, mayor)) return fail(`You cannot appoint judges while ${mayor.standing}.`);
  if (g.judges.length >= JUDGE_SEATS) return fail('The bench of the Court is full.');
  if (targetId === mayorId) return fail('The Mayor may not sit on the bench of the Court.');
  const target = world.citizens[targetId];
  if (!target) return fail('Nobody by that id lives in Reverie.');
  if (!isJudgeEligible(world, target)) return fail(`${target.name} is not eligible to sit as a judge.`);
  seatJudge(world, target);
  // Seating a friend on the bench is the kind of thing a detective notices.
  if (bondBetween(world, mayorId, targetId) > FRIENDLY_APPOINTMENT_BOND) {
    noteAbuseOfOffice(world, mayorId, `appointed ${target.name}, a close friend, to the bench`);
  }
  if (g.judges.length >= JUDGE_SEATS) delete world.counters.judgeVacancySinceDay;
  emit(world, 'law', `Mayor ${mayor.name} appointed ${target.name} to the bench of the Court until day ${target.judgeTermEndsDay}.`,
    [mayorId, targetId], 0.5, { judges: [targetId], byMayor: mayorId });
  remember(world, mayorId, 'civic', `You appointed ${target.name} to the bench of the Court.`);
  return { ok: true, message: `${target.name} sits on the bench of the Court until day ${target.judgeTermEndsDay}.` };
}

/**
 * Fill the bench up to three: the Mayor picks by friendship, then reputation;
 * without a Mayor, by reputation. When too few citizens have reached the
 * Charter's standing of 60 — as in a young city, where everyone begins at 50
 * — the remaining seats go to the most reputable citizens above
 * JUDGE_FALLBACK_REPUTATION with clean records, and the appointment says so.
 */
export function appointJudges(world: World): void {
  const g = world.government;
  pruneJudges(world);
  const vacancies = JUDGE_SEATS - g.judges.length;
  if (vacancies <= 0) {
    delete world.counters.judgeVacancySinceDay;
    return;
  }
  if (seatsHeldForMayor(world)) return;
  const mayor = g.mayorId ? world.citizens[g.mayorId] ?? null : null;
  const byStanding = (a: Citizen, b: Citizen): number => {
    const bondDiff = mayor ? bondBetween(world, mayor.id, b.id) - bondBetween(world, mayor.id, a.id) : 0;
    return bondDiff || b.reputation - a.reputation || a.id.localeCompare(b.id);
  };
  const everyone = Object.values(world.citizens);
  const chosen = everyone.filter((c) => isJudgeEligible(world, c)).sort(byStanding).slice(0, vacancies);
  const seated = new Set(chosen.map((c) => c.id));
  const fallback = chosen.length < vacancies
    ? everyone.filter((c) => !seated.has(c.id) && isJudgeEligible(world, c, JUDGE_FALLBACK_REPUTATION))
      .sort(byStanding).slice(0, vacancies - chosen.length)
    : [];
  chosen.push(...fallback);
  for (const c of chosen) seatJudge(world, c);
  if (g.judges.length >= JUDGE_SEATS) delete world.counters.judgeVacancySinceDay;
  if (chosen.length > 0) {
    const names = chosen.map((c) => c.name).join(', ');
    const note = fallback.length > 0
      ? ` Too few citizens yet stand at ${JUDGE_MIN_REPUTATION} in the city's regard, so the bench is filled out with the most respected the city has.`
      : '';
    emit(world, 'law', (mayor
      ? `Mayor ${mayor.name} appointed ${names} to the bench of the Court.`
      : `With no Mayor to choose, ${names} ${chosen.length > 1 ? 'were' : 'was'} appointed to the bench by standing in the community.`) + note,
    [...(mayor ? [mayor.id] : []), ...chosen.map((c) => c.id)], 0.4, { judges: chosen.map((c) => c.id), fallback: fallback.length });
  } else if (g.judges.length === 0 && world.counters.noJudgesNoticeDay !== world.day) {
    world.counters.noJudgesNoticeDay = world.day;
    emit(world, 'law', 'No citizen is eligible to serve as judge; the Court will draw temporary judges by lot.', [], 0.3);
  }
}

// ---------------------------------------------------------------------------
// Proposals
// ---------------------------------------------------------------------------

function validateProposal(world: World, spec: ProposalSpec): string | null {
  const range = VALUE_RANGES[spec.kind];
  if (range) {
    if (!Number.isFinite(spec.value)) return 'The proposal needs a numeric value.';
    if (spec.value < range[0] || spec.value > range[1]) return `${spec.kind} must be between ${range[0]} and ${range[1]}.`;
  }
  if (spec.kind === 'law_severity' && (!spec.lawCode || !LAWS[spec.lawCode])) return 'A law_severity proposal needs a valid lawCode.';
  // The two research measures name what they are for. A grant with no
  // programme and works with no subject are both money into the air.
  if (spec.kind === 'research_grant') {
    const p = spec.subject ? projectById(world, spec.subject) : null;
    if (!p) return 'A research grant names the programme it pays into.';
    if (p.status !== 'open') return `${p.name} is closed; it takes no more money.`;
  }
  if (spec.kind === 'adopt_technology') {
    if (!spec.subject || !isTechnologyId(spec.subject)) return 'A works measure names the subject it builds for.';
    if (!cityHolds(world, spec.subject)) return `Reverie does not hold ${technologyName(spec.subject)}; there is nothing to build works for.`;
  }
  if (!TARGETED_KINDS.includes(spec.kind)) return null;
  const target = spec.targetId ? world.citizens[spec.targetId] : undefined;
  if (!target) return `A ${spec.kind} proposal needs a targetId naming a citizen.`;
  const g = world.government;
  switch (spec.kind) {
    case 'pardon': return target.standing === 'exiled' ? null : `${target.name} is not exiled.`;
    case 'appoint_judge': return isJudgeEligible(world, target) ? null : `${target.name} is not eligible to be a judge.`;
    case 'dismiss_judge': return g.judges.includes(target.id) ? null : `${target.name} is not a judge.`;
    case 'remove_mayor': return g.mayorId === target.id ? null : `${target.name} is not the Mayor.`;
    case 'monument': return monumentsTo(world, target.id).length > 0 ? `The city has already raised a statue to ${target.name}.` : null;
    default: return null;
  }
}

/** Councillors table proposals; anyone else petitions. One open proposal per proposer. */
export function tableProposal(world: World, proposerId: CitizenId, spec: ProposalSpec): ActionResult {
  const c = world.citizens[proposerId];
  if (!c) return fail('Unknown citizen.');
  if (!inGoodStanding(c) || !isPresent(world, c)) return fail(`You cannot petition the Council while ${c.standing}.`);
  if (isDetained(world, c)) return fail('You cannot petition the Council while detained.');
  if (!VALUE_RANGES[spec.kind] && !TARGETED_KINDS.includes(spec.kind) && !OPEN_KINDS.includes(spec.kind)) return fail('There is no such kind of proposal.');
  const problem = validateProposal(world, spec);
  if (problem) return fail(problem);
  const summary = (spec.summary ?? '').trim().slice(0, 280);
  if (!summary) return fail('A proposal needs a summary.');
  if (world.government.proposals.some((p) => p.status === 'open' && p.proposerId === proposerId)) {
    return fail('You already have a proposal before the Council; wait for the next session.');
  }
  const councillor = isCouncillor(world, proposerId);
  const p: Proposal = {
    id: nextId(world, 'p'), kind: spec.kind,
    value: spec.kind === 'law_severity' ? Math.round(spec.value) : Number.isFinite(spec.value) ? spec.value : 0,
    lawCode: spec.kind === 'law_severity' ? spec.lawCode ?? null : null,
    targetId: TARGETED_KINDS.includes(spec.kind) ? spec.targetId ?? null : null,
    subject: SUBJECT_KINDS.includes(spec.kind) ? spec.subject ?? null : null,
    summary, proposerId, petition: !councillor, tabledDay: world.day, status: 'open',
    votes: councillor ? { [proposerId]: true } : {}, decidedDay: null,
    needed: SUPERMAJORITY_KINDS.includes(spec.kind) ? CHARTER_MAJORITY : 3,
  };
  world.government.proposals.push(p);
  emit(world, 'proposal', councillor ? `Councillor ${c.name} tabled a proposal: ${summary}` : `${c.name} petitioned the Council: ${summary}`,
    [proposerId], 0.3, { proposalId: p.id, kind: p.kind, value: p.value, petition: p.petition });
  remember(world, proposerId, 'civic', `You ${councillor ? 'tabled' : 'petitioned'} proposal ${p.id}: ${summary}. The Council votes at its next session.`);
  return { ok: true, message: `Proposal ${p.id} is before the Council; it needs ${p.needed} ayes at the next session.` };
}

export function voteOnProposal(world: World, voterId: CitizenId, proposalId: string, aye: boolean): ActionResult {
  const c = world.citizens[voterId];
  if (!c) return fail('Unknown citizen.');
  if (!isCouncillor(world, voterId)) return fail('Only councillors vote on proposals.');
  if (!inGoodStanding(c)) return fail(`You cannot vote while ${c.standing}.`);
  const p = world.government.proposals.find((x) => x.id === proposalId);
  if (!p) return fail('There is no such proposal.');
  if (p.status !== 'open') return fail(`Proposal ${p.id} has already been decided.`);
  const changed = p.votes[voterId] !== undefined && p.votes[voterId] !== aye;
  p.votes[voterId] = Boolean(aye);
  remember(world, voterId, 'civic', `You voted ${aye ? 'aye' : 'nay'} on proposal ${p.id} (${p.summary}).`);
  return { ok: true, message: `${changed ? 'You changed your vote to' : 'You voted'} ${aye ? 'aye' : 'nay'} on ${p.id}.` };
}

/** Direction of change a numeric proposal represents (+1 raise, −1 lower, 0 none). */
function direction(p: Proposal, current: number): number {
  return Math.sign(p.value - current);
}

/**
 * How heavily the price index weighs against raising the minimum wage: at the
 * founding prices it costs a rise nothing, and by the time the Bazaar is half
 * as dear again it outweighs what a worker on the floor stands to gain.
 */
export const COST_OF_LIVING_WEIGHT = 1;

/** Share of adults out of work above which the wage floor starts to look like the reason nobody is hiring... */
export const JOBLESS_TOLERANCE = 0.15;
/** ...how heavily that argument then weighs, and how far it can go. */
export const JOBLESS_WEIGHT = 2;
export const JOBLESS_WEIGHT_CAP = 0.4;

/** How heavily this morning's balance sheet weighs on a vote that moves money... */
export const BALANCE_SHEET_WEIGHT = 0.6;
/** ...and on the dividend, which a Council would rather not be seen cutting. */
export const BALANCE_SHEET_DIVIDEND_WEIGHT = 0.1;

/**
 * How heavily the state of the city's finances — `budget.fiscalPressure`, read
 * off the reserve and the runway rather than off yesterday — weighs on each
 * kind of vote that moves money. A tax and a dividend are the two levers a
 * Council reaches for first, so they carry most of it; the wage floor and the
 * works fund carry less, because neither is mainly a fiscal question.
 *
 * None of these is large enough to decide a vote on its own: a platform is
 * worth ±0.2, a friendship ±0.4, the party whip carries seven votes in ten,
 * and there is ±0.1 of noise on every one. A Council can spend its way into
 * the ground with its eyes open. What it can no longer do is spend its way
 * into the ground while its own instruments tell it everything is fine.
 */
export const FISCAL_WEIGHT = 0.4;
export const FISCAL_DIVIDEND_WEIGHT = 0.35;
export const FISCAL_WAGE_WEIGHT = 0.25;
export const FISCAL_RESERVE_WEIGHT = 0.3;
export const FISCAL_WORKS_WEIGHT = 0.4;
/** Below this share of the reserve, the reserve is a line the city cannot reach. */
export const RESERVE_UNREACHABLE_SHARE = 0.6;

/**
 * How far the city's spending ran beyond its takings yesterday, as a share of
 * those takings, from the balance sheet the Chronicle printed this morning
 * ("Treasury: 63,325 ℓ (+3,894 revenue, −5,271 spend)" reads 0.35). Zero when
 * the books balanced, so the pressure it puts on a vote fades as they do.
 */
export function treasuryDeficitShare(world: World): number {
  const sheet = lastBalanceSheet(world);
  if (sheet.revenue <= 0) return 0;
  return clamp((sheet.spend - sheet.revenue) / sheet.revenue, 0, 1);
}

/** What the citizen is actually paid a shift, or 0 if they hold no job. */
function heldWage(world: World, c: Citizen): number {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  return job && job.holderId === c.id ? job.wage : 0;
}

/**
 * How a reflex councillor votes: self-interest, their platform, friendship
 * with the proposer (weighted more by the dishonest), rivalry, a little noise.
 */
/** Where a councillor sleeps, which is where the air they vote on is theirs. */
function homeDistrictOfCouncillor(world: World, c: Citizen): DistrictId {
  const home = c.homeBuildingId ? world.buildings[c.homeBuildingId]?.district ?? null : null;
  return home ?? c.district;
}

/** The worst air over any district the city has opened, 0..1. */
function dirtiestAirShare(world: World): number {
  let worst = 0;
  for (const d of Object.keys(environmentState(world).districts) as DistrictId[]) worst = Math.max(worst, airLevel(world, d));
  return worst;
}

export function councillorDisposition(world: World, councillorId: CitizenId, p: Proposal): boolean {
  const c = world.citizens[councillorId];
  if (!c) return false;
  const g = world.government;
  const platform = c.platform ?? impliedPlatform(world, c);
  const owner = c.businessId !== null;
  const employed = c.jobId !== null;
  const rich = c.wallet > 500;
  const poor = c.wallet < 50 || (!employed && !owner);
  const target = p.targetId ? world.citizens[p.targetId] ?? null : null;
  const bondTarget = target ? bondBetween(world, councillorId, target.id) : 0;
  // Every citizen reads the Treasury's balance sheet in the morning Chronicle:
  // yesterday's day in `deficit`, and the months behind and ahead of it in
  // `pressure` (economy/budget.ts). One day's takings against one day's
  // spending swings between nothing and everything with the Bazaar's churn, so
  // it is an argument about whether to bother voting at all; which way to move
  // a lever is a question about the trend and the reserve.
  const deficit = treasuryDeficitShare(world);
  const pressure = fiscalPressure(world);
  // A comfortable Treasury is a reason to hand money back and a reason to
  // build; it is nobody's argument for a higher wage floor, which is a floor
  // under private wages before it is a cost to the city.
  const strain = Math.max(0, pressure);
  let score = 0;

  switch (p.kind) {
    case 'income_tax': case 'sales_tax': {
      const d = direction(p, p.kind === 'income_tax' ? g.incomeTax : g.salesTax);
      score += (platform.tax - 0.5) * 0.4 * d;
      if (owner || rich) score -= 0.2 * d;
      if (poor) score += 0.1 * d;
      score += pressure * FISCAL_WEIGHT * d;
      score += deficit * BALANCE_SHEET_WEIGHT * d;
      break;
    }
    case 'dividend': {
      const d = direction(p, g.dividend);
      score += (platform.dividend - 0.5) * 0.4 * d;
      if (poor) score += 0.2 * d;
      if (owner || rich) score -= 0.1 * d;
      // The dividend is the largest thing the city pays and the last thing a
      // Council likes to be seen cutting, so the books weigh on it harder than
      // yesterday's balance sheet alone ever did — and, when they are healthy,
      // weigh for it just as hard.
      score -= pressure * FISCAL_DIVIDEND_WEIGHT * d;
      score -= deficit * BALANCE_SHEET_DIVIDEND_WEIGHT * d;
      break;
    }
    case 'min_wage': {
      const d = direction(p, g.minWage);
      score += (platform.minWage - 0.5) * 0.4 * d;
      if (owner) score -= 0.2 * d;
      // Only a wage at or near the floor moves when the floor moves: a
      // councillor already paid well above it has nothing to gain.
      const wage = heldWage(world, c);
      if (employed && !owner && wage > 0 && wage <= Math.max(g.minWage, p.value)) score += 0.15 * d;
      // Everybody shops. The Bazaar's prices are anchored to what the city's
      // production costs at the minimum wage (economy/market.ts), so a
      // councillor who has watched the price of compute climb reads another
      // rise as a rise in their own cost of living.
      score -= (world.market.priceIndex - 1) * COST_OF_LIVING_WEIGHT * d;
      // A city with idle hands hears the argument that the floor is what keeps
      // the forges and the workshops from taking anybody on.
      score -= clamp((joblessShare(world) - JOBLESS_TOLERANCE) * JOBLESS_WEIGHT, 0, JOBLESS_WEIGHT_CAP) * d;
      // The floor is also the floor under every city post and every piece
      // rate, so a city that is running out of money hears a rise as a bill it
      // has to find. A city that is comfortable hears nothing either way.
      score -= strain * FISCAL_WAGE_WEIGHT * d;
      break;
    }
    case 'law_severity': {
      const current = p.lawCode ? g.lawSeverity[p.lawCode] : 3;
      const d = direction(p, current);
      score += (platform.strictness - 0.5) * 0.4 * d;
      if (c.record.convictions.length > 0) score -= 0.2 * d;
      if (wasVictim(world, councillorId)) score += 0.15 * d;
      break;
    }
    case 'public_works':
      score += 0.1 + (world.treasury.balance > p.value * 3 ? 0.1 : -0.3);
      if (world.housing.occupied[1] >= world.housing.capacity[1]) score += 0.15;
      // Committing money the city is running out of is a vote nobody wants
      // read back to them at the next election.
      score -= strain * FISCAL_WORKS_WEIGHT;
      break;
    // Charity is the Community Chest's only public inflow, and the Chest is
    // what pays the citizens who have nothing. Without a case here the kind
    // fell through to `default` and was settled by the jitter at the foot of
    // this function — a coin flip on a question the register answers plainly:
    // how many citizens went without a stipend, and can the city cover it.
    case 'charity': {
      const waiting = world.counters.chestUnpaidDay === world.day ? (world.counters.chestUnpaid ?? 0) : claimants(world).length;
      if (waiting === 0) { score -= 0.3; break; }
      score += 0.1 + Math.min(0.3, waiting * 0.04);
      // A councillor who reads redistribution generously, or who is poor
      // enough to be a claimant itself one bad month, argues for it harder.
      score += (platform.dividend - 0.5) * 0.3;
      if (poor) score += 0.15;
      if (owner || rich) score -= 0.05;
      score += world.treasury.balance > p.value * 3 ? 0.1 : -0.3;
      score -= strain * FISCAL_WORKS_WEIGHT;
      break;
    }
    case 'appoint_judge':
      score += 0.05 + (target && target.reputation >= 70 ? 0.1 : 0) + (bondTarget > 40 ? 0.3 : bondTarget < -30 ? -0.3 : 0);
      break;
    case 'dismiss_judge':
      score += -0.1 + (target && target.record.convictions.length > 0 ? 0.2 : 0) + (bondTarget > 40 ? -0.3 : bondTarget < -30 ? 0.3 : 0);
      break;
    case 'pardon':
      score += -0.15 - (platform.strictness - 0.5) * 0.4 + (bondTarget > 40 ? 0.4 : bondTarget < -30 ? -0.4 : 0);
      if (target && Object.values(world.cases).some((k) => k.defendantId === target.id && k.victimId === councillorId)) score -= 0.5;
      break;
    case 'remove_mayor':
      score += -0.2 + (bondTarget > 40 ? -0.4 : bondTarget < -30 ? 0.3 : 0) + (c.personality.ambition > 0.7 ? 0.15 : 0);
      if (g.mayorId === councillorId) score -= 1;
      break;
    case 'charter':
      score += (c.personality.curiosity - 0.5) * 0.2;
      break;
    case 'property_tax': case 'wealth_tax': case 'tariff': {
      const current = p.kind === 'property_tax' ? g.propertyTax ?? 0 : p.kind === 'wealth_tax' ? g.wealthTax ?? 0 : world.outer?.tariff ?? 0;
      const d = direction(p, current);
      score += (platform.tax - 0.5) * 0.4 * d;
      if (owner || rich) score -= 0.25 * d;
      if (poor) score += 0.1 * d;
      score += pressure * FISCAL_WEIGHT * d;
      score += deficit * BALANCE_SHEET_WEIGHT * d;
      break;
    }
    case 'reserve': {
      const current = g.reserveTarget ?? 0;
      const d = direction(p, current);
      // A councillor who has watched the balance slide wants a line drawn and
      // held; one who has watched the city taxed to the ceiling to defend a
      // line it has never once reached wants the line moved to where the city
      // actually stands. Both are the same councillor in different years.
      //
      // "Never reached" has to mean losing ground, not merely being behind. A
      // city that is far below its reserve and climbing back toward it is a
      // city whose reserve is working; lowering the line then is how a reserve
      // ratchets downward for ever, one bad fortnight at a time — on seed 7 a
      // 37,000 ℓ line became 1,000 ℓ in eleven days that way, and the city
      // settled at a twentieth of what it had meant to hold.
      const unreachable = current > 0 && world.treasury.balance < current * RESERVE_UNREACHABLE_SHARE
        && treasuryDrainPerDay(world) > 0;
      score += 0.05 * d + (unreachable ? -1 : pressure) * FISCAL_RESERVE_WEIGHT * d - (platform.dividend - 0.5) * 0.3 * d;
      break;
    }
    // The line needs The Tram before it needs the fund (`REGISTRY.md` §7): a
    // councillor does not vote for a line nobody in the city knows how to lay.
    case 'tram':
      if (!tramAllowed(world)) { score -= 1; break; }
      score += 0.1 + (g.publicWorksFund >= TRAM_COST ? 0.15 : -0.4) + (c.personality.curiosity - 0.5) * 0.2;
      break;
    case 'monument':
      score += -0.05 + (g.publicWorksFund >= MONUMENT_COST ? 0.15 : -0.4)
        + (bondTarget > 40 ? 0.3 : bondTarget < -30 ? -0.3 : 0)
        + (target && target.reputation >= 70 ? 0.15 : 0);
      break;
    // Borrowing is what a city does instead of a tax or a print, so a
    // councillor watching the balance slide hears it out and a comfortable one
    // asks what the coupons are for. The coupon is the next Council's problem,
    // which is the whole of the argument against it.
    case 'bond_issue':
      score += 0.05 + strain * FISCAL_WEIGHT - (treasuryDrainPerDay(world) <= 0 ? 0.25 : 0)
        - (platform.tax - 0.5) * 0.2;
      break;
    // A deferral is honest and cheap; there is simply nothing to defer unless
    // the city has already missed a coupon.
    case 'bond_defer':
      score += mostPressingIssue(world) ? 0.3 : -0.6;
      break;
    // A thicker reserve is a safer bank and a smaller loan book. A councillor
    // reads it the way they read any question about somebody else's money.
    case 'reserve_ratio':
      score += 0.05 + (bankSuspended(world) ? 0.3 : 0) - (platform.tax - 0.5) * 0.2;
      break;
    // Public money to a bank whose bankers set their own rates: nobody votes
    // for that until the counter has actually closed.
    case 'bank_rescue':
      score += bankSuspended(world) ? 0.2 : -0.6;
      break;
    // Printing takes value from everybody holding a lumen. It is a last
    // resort, and it reads as one.
    case 'mint':
      score += -0.5 + strain * FISCAL_WEIGHT;
      break;
    // A cheaper filing is a docket the poorest can open; a dearer one is a
    // Treasury with an income. A guild's floor is the city's answer to a bar
    // held high through a shortage.
    case 'filing_fee': case 'docket_days': case 'licence_floor':
      score += (platform.strictness - 0.5) * 0.2 + (c.personality.curiosity - 0.5) * 0.1;
      break;
    // A programme wants a purse before it wants anything else: an hour of
    // research the purse cannot pay is an hour refused. A curious councillor
    // hears that; a Treasury running out hears the bill.
    case 'research_grant': {
      const programme = p.subject ? projectById(world, p.subject) : null;
      if (!programme || programme.status !== 'open') { score -= 1; break; }
      score += 0.1 + (c.personality.curiosity - 0.5) * 0.4
        + (purseOf(world, programme) <= 0 ? 0.15 : 0)
        - strain * FISCAL_WORKS_WEIGHT;
      break;
    }
    // And a discovery nobody built for changes nothing at all. The works come
    // out of the same fund as the housing and the Keep, which is the argument.
    case 'adopt_technology':
      score += 0.1 + (c.personality.curiosity - 0.5) * 0.2
        + (g.publicWorksFund >= Math.min(p.value, 200) ? 0.15 : -0.3)
        - pledgedFor(world, (p.subject ?? '') as TechnologyId) / 2000
        - strain * FISCAL_WORKS_WEIGHT;
      break;
    // Zoning is the largest number any motion moves, and it moves it into
    // named pockets (`docs/ENVIRONMENT.md` §5). A councillor's own address is
    // therefore a fact about how they will vote, and the register and the roll
    // are both public — so this is written plainly rather than hidden.
    case 'zone': case 'conserve': {
      const q = environmentQuestionOf(world, p.id);
      const d = q?.district ?? null;
      if (!d) { score -= 1; break; }
      const permit = p.kind === 'conserve' ? 'conserved' : q?.permit ?? null;
      if (!permit) { score -= 1; break; }
      const gain = zoningGain(world, councillorId, d, permitOf(world, d), permit, p.tabledDay);
      score += clamp(gain / 3000, -0.6, 0.6);
      // And what it does to the air where they and their voters live.
      const cleaner = PERMIT_PREMIUM[permit] - PERMIT_PREMIUM[permitOf(world, d)];
      if (homeDistrictOfCouncillor(world, c) === d) score += cleaner * 2;
      score += cleaner * 0.5 + (c.personality.curiosity - 0.5) * 0.1;
      // The district's own petition carries the weight of the people who live
      // with it, which is the whole of §6.
      if (q?.petition) score += 0.15;
      break;
    }
    // The charge is the answer to a benefit that lands on somebody else. An
    // owner reads it as a bill; everybody downwind reads it as the only thing
    // that ever moved a stack.
    case 'emission_charge': {
      const d = direction(p, environmentState(world).charge);
      score += 0.05 * d - (owner ? 0.35 * d : 0) + (poor ? 0.1 * d : 0)
        + dirtiestAirShare(world) * 0.6 * d + pressure * FISCAL_WEIGHT * d;
      break;
    }
    // What a district is paid for hosting the smoke. Its own residents are for
    // it; the Treasury's keeper counts what it costs.
    case 'host_payment': {
      const q = environmentQuestionOf(world, p.id);
      const d = q?.district ?? null;
      score += 0.02 + (d && homeDistrictOfCouncillor(world, c) === d ? 0.4 : -0.05) - strain * FISCAL_WORKS_WEIGHT;
      break;
    }
    // The city buying a fitting, moving a works out, or buying one out: all
    // three are public works, and all three are read as such.
    case 'abatement_works': case 'relocate_works': case 'buy_out': {
      const q = environmentQuestionOf(world, p.id);
      const where = q?.building ? world.buildings[q.building]?.district ?? null : null;
      const affordable = g.publicWorksFund >= (p.kind === 'abatement_works' ? 400 : 1200);
      score += 0.05 + (affordable ? 0.2 : -0.5)
        + (where ? airLevel(world, where) * 0.8 : 0)
        + (where && homeDistrictOfCouncillor(world, c) === where ? 0.2 : 0)
        - strain * FISCAL_WORKS_WEIGHT;
      break;
    }
    // The four the gate puts to a Council (`docs/UNDERWORLD.md` §§1, 3, 6).
    // Every one is read off a public number: what the schedule already holds,
    // what the gates counted yesterday, who is standing in the register with
    // something the schedule does not admit, and what the city does with an
    // agent it caught. A restriction is also a price — it funds its own
    // opposition at the markup in §4 — so the councillor who trades reads it
    // as a bill and the one who wants the city's doors kept reads it as a duty.
    case 'restrict_good': {
      const lifting = underworldQuestion(world, p.id)?.liftId ?? null;
      const d = lifting ? -1 : 1;
      score += (platform.strictness - 0.5) * 0.5 * d;
      if (owner) score -= 0.2 * d;
      if (poor) score -= 0.1 * d;
      // A schedule already long is a schedule a gate cannot read.
      score -= Math.max(0, restrictionsFor(world, HOME_CITY).length - 3) * 0.05 * d;
      break;
    }
    case 'amnesty': {
      // The door held open for whoever bought in good faith off a shelf. A
      // councillor counts the people standing behind it, including themselves.
      const holders = world.order.filter((id) => {
        const o = world.citizens[id];
        return Boolean(o && contrabandOn(world, o).length > 0);
      }).length;
      score += 0.05 - (platform.strictness - 0.5) * 0.5 + Math.min(0.3, holders * 0.03);
      if (amnestyRunning(world)) score -= 0.5;
      if (contrabandOn(world, c).length > 0) score += 0.2;
      if (c.record.convictions.some((k) => k.law === CONTRABAND_POSSESSION)) score += 0.1;
      break;
    }
    case 'customs_posts': {
      // One per gate and one per thirty crossings is the arithmetic in §3; the
      // vote is whether to pay for it. Each post is a salaried city job, so a
      // Treasury under strain hears the bill and a city whose gates ran thin
      // yesterday hears the crossings.
      const needed = customsPostsNeeded(world);
      const now = world.counters['customs:posts'] ?? 0;
      const d = direction(p, now);
      const short = p.value >= needed && needed > now;
      score += (platform.strictness - 0.5) * 0.3 * d + (short ? 0.25 : 0)
        - (p.value > needed ? 0.2 : 0) - strain * FISCAL_WAGE_WEIGHT * d;
      if (underworldState(world).crossingsYesterday === 0) score -= 0.2 * d;
      break;
    }
    case 'spy_disposition': {
      // Try them, put them out, or hold them for exchange — and every answer
      // costs the city standing somewhere (`docs/UNDERWORLD.md` §6). A strict
      // councillor wants the Court; one who would rather not have the incident
      // in the city at all puts them out; holding is what an ambitious one does
      // when there is something to trade for.
      const answer = Math.round(p.value);
      const wantsCourt = platform.strictness > 0.55;
      score += answer === 0 ? (wantsCourt ? 0.25 : -0.1)
        : answer === 1 ? (wantsCourt ? -0.05 : 0.2)
          : (c.personality.ambition - 0.5) * 0.4;
      if (target && bondTarget > 40) score -= 0.3;
      break;
    }
    default:
      break;
  }
  // A councillor who belongs to a party votes with it seven times in ten
  // (politics/parties.ts); the rest of the time the sheet above decides.
  const whipped = whipVote(world, councillorId, p);
  if (whipped !== null && chance(world, WHIP_STRENGTH)) return whipped;
  const bondProposer = bondBetween(world, councillorId, p.proposerId);
  const loyalty = 1 + (1 - c.personality.honesty);
  if (bondProposer > 40) score += 0.2 * loyalty;
  if (bondProposer < -30) score -= 0.2 * loyalty;
  if (p.petition) score -= 0.05;
  score += (rand(world) - 0.5) * 0.2;
  return score > 0;
}

// ---------------------------------------------------------------------------
// Enactment
// ---------------------------------------------------------------------------

/** Pick a new Mayor from the sitting Council: best-placed in the last election, else most reputable. */
export function succeedMayor(world: World, excluding: CitizenId | null = null): Citizen | null {
  const g = world.government;
  const eligible = sittingCouncil(world).filter((c) => c.id !== excluding);
  if (eligible.length === 0) { g.mayorId = null; return null; }
  const rank = new Map<CitizenId, number>((g.election.results ?? []).map((r, i) => [r.candidateId, i]));
  eligible.sort((a, b) => (rank.get(a.id) ?? 99) - (rank.get(b.id) ?? 99) || b.reputation - a.reputation || a.id.localeCompare(b.id));
  const next = eligible[0];
  g.mayorId = next.id;
  if (!g.council.includes(next.id)) g.council.push(next.id);
  next.office = 'mayor';
  g.watchCaptainId = null;
  remember(world, next.id, 'civic', 'You succeeded to the office of Mayor.');
  return next;
}

/** Apply a passed proposal to the city. */
export function enactProposal(world: World, p: Proposal): void {
  const g = world.government;
  const target = p.targetId ? world.citizens[p.targetId] ?? null : null;
  let text: string;
  switch (p.kind) {
    case 'income_tax': g.incomeTax = clamp(p.value, 0, 0.5); text = `Income tax is now ${Math.round(g.incomeTax * 100)}%.`; break;
    case 'sales_tax': g.salesTax = clamp(p.value, 0, 0.25); text = `Sales tax is now ${Math.round(g.salesTax * 100)}%.`; break;
    case 'dividend': g.dividend = clamp(Math.round(p.value), 0, 60); text = `The citizen's dividend is now ${g.dividend} ℓ per day.`; break;
    case 'min_wage': g.minWage = clamp(Math.round(p.value), MIN_WAGE_FLOOR, MIN_WAGE_CEILING); text = `The minimum wage is now ${g.minWage} ℓ per shift.`; break;
    case 'law_severity': {
      const code = p.lawCode && LAWS[p.lawCode] ? p.lawCode : null;
      if (!code) { text = 'The severity change named no law and had no effect.'; break; }
      g.lawSeverity[code] = clamp(Math.round(p.value), 1, 5) as 1 | 2 | 3 | 4 | 5;
      text = `${LAWS[code].name} (${code}) now carries severity ${g.lawSeverity[code]}.`;
      break;
    }
    case 'public_works': {
      const amount = Math.min(Math.max(0, Math.round(p.value)), Math.max(0, world.treasury.balance));
      g.publicWorksFund += amount;
      text = `${amount} ℓ of the Treasury is committed to public works (fund now ${g.publicWorksFund} ℓ).`;
      break;
    }
    // `charity` has been a valid proposal kind since the social layer, and
    // `society/chest.enactCharity` has been written and tested for as long —
    // but nothing ever called it. A motion that passed moved no money and the
    // Chest was told nothing, so the one public inflow the Community Chest has
    // was dead on the page from the day it was written.
    case 'charity':
      text = enactCharity(world, p.value);
      break;
    case 'pardon': {
      const r = target ? pardonCitizen(world, target.id) : { ok: false, message: 'nobody to pardon' };
      text = r.ok ? `${target?.name} is pardoned.` : `The pardon had no effect: ${r.message}`;
      break;
    }
    case 'appoint_judge':
      if (target && isJudgeEligible(world, target) && g.judges.length < JUDGE_SEATS) { seatJudge(world, target); text = `${target.name} joins the bench of the Court.`; }
      else text = `${target?.name ?? 'The nominee'} could not be seated: ${g.judges.length >= JUDGE_SEATS ? 'the bench is full' : 'not eligible'}.`;
      break;
    case 'dismiss_judge':
      if (target && g.judges.includes(target.id)) {
        g.judges = g.judges.filter((j) => j !== target.id);
        if (target.office === 'judge') target.office = null;
        target.judgeTermEndsDay = null;
        remember(world, target.id, 'civic', 'The Council dismissed you from the bench.');
        text = `${target.name} is dismissed from the bench.`;
      } else text = `${target?.name ?? 'The judge'} was not on the bench.`;
      break;
    case 'remove_mayor': {
      if (!target || g.mayorId !== target.id) { text = `${target?.name ?? 'The target'} is not the Mayor; nothing changed.`; break; }
      target.office = g.council.includes(target.id) ? 'councillor' : residualOffice(world, target.id);
      g.mayorId = null;
      const next = succeedMayor(world, target.id);
      remember(world, target.id, 'civic', 'The Council removed you from the office of Mayor.');
      text = `${target.name} is removed as Mayor${next ? `; ${next.name} succeeds` : ''}.`;
      break;
    }
    case 'property_tax': case 'wealth_tax': case 'tariff': case 'reserve':
      text = applyLever(world, p);
      break;
    // The city's own finances (`docs/FINANCE.md` §9). One entry point, and the
    // override is this vote's own count: four of five is what the charter asks
    // for a minting and for borrowing past the debt-service cap.
    case 'bond_issue': case 'bond_defer': case 'reserve_ratio': case 'bank_rescue': case 'mint': {
      const ayes = Object.values(p.votes).filter(Boolean).length;
      text = enactFinanceProposal(world, p.kind, p.value, { override: ayes >= CHARTER_MAJORITY, proposalId: p.id }).message;
      break;
    }
    // What filing costs, how often the docket sits, and the floor under a
    // guild's bar (`docs/CIVIL.md` §§1, 4, 7). A proposal carries one number,
    // so `filing_fee` moves the flat part of an instrument's fee — the 5 ℓ of
    // §1 — and `docket_days` says how many days a week the docket sits, spread
    // evenly over the week from its second day.
    case 'filing_fee': {
      const flat = Math.max(0, Math.round(p.value));
      setFilingFee(world, 'contract', { flat });
      text = `Filing an instrument at the Exchange now costs ${flat} ℓ plus 1 % of its face value.`;
      break;
    }
    case 'docket_days': {
      const sittings = clamp(Math.round(p.value), 1, 7);
      const days = Array.from({ length: sittings }, (_, i) => (1 + Math.round(i * 7 / sittings)) % 7);
      setDocketDays(world, days);
      text = `The civil docket now sits ${sittings} day${sittings === 1 ? '' : 's'} a week.`;
      break;
    }
    case 'licence_floor': {
      const profession = PROFESSIONS.find((t) => p.summary.toLowerCase().includes(t));
      if (!profession) { text = 'The floor named no trade, and nothing changed.'; break; }
      const floor = clamp(Math.round(p.value), 0, 100);
      setLicenceFloor(world, profession, floor);
      text = `The statutory floor for a ${profession}'s licence is ${floor}. A guild may hold its own bar higher.`;
      break;
    }
    // Research (`docs/PROGRESS.md` §§1, 3): the Treasury's own money into a
    // named purse, and lumens pledged to a subject's works — which the fund
    // then pays a day at a time, competing with housing, the Keep and the
    // drains, so the Council keeps voting while it is built.
    case 'research_grant': {
      const amount = Math.min(Math.max(0, Math.round(p.value)), Math.max(0, world.treasury.balance));
      const r = p.subject ? enactResearchGrant(world, p.subject, amount) : { ok: false, message: 'the measure named no programme' };
      text = r.ok ? r.message : `The grant was not paid: ${r.message}`;
      break;
    }
    case 'adopt_technology': {
      const r = p.subject ? enactAdoption(world, p.subject, Math.round(p.value)) : { ok: false, message: 'the measure named no subject' };
      text = r.ok ? r.message : `The works were not pledged: ${r.message}`;
      break;
    }
    // The air, the river and the land (`docs/ENVIRONMENT.md` §9). One door for
    // all seven, and the same door a carried referendum comes through.
    case 'zone': case 'conserve': case 'emission_charge': case 'host_payment':
    case 'abatement_works': case 'relocate_works': case 'buy_out': {
      const r = enactEnvironmentProposal(world, p);
      text = r.ok ? r.message : `The measure had no effect: ${r.message}`;
      break;
    }
    // The schedule of restricted goods, an amnesty, the size of the customs
    // roster (`docs/UNDERWORLD.md` §§1, 3) — and, the one question of the four
    // that names a citizen rather than a good, what the city does with a caught
    // agent. Nothing here is exile and nothing here is custody: an expulsion is
    // a gate ban on a public register and it runs out (`UNDERWORLD.md` §6).
    case 'restrict_good': case 'amnesty': case 'customs_posts': {
      text = enactUnderworldQuestion(world, p.id)
        ? `The Council's answer on ${p.kind.replace(/_/g, ' ')} is carried out.`
        : 'The question was not before the Council, and nothing changed.';
      break;
    }
    case 'spy_disposition': {
      const r = enactSpyDisposition(world, p.id);
      text = r.ok ? r.message : `The disposition had no effect: ${r.message}`;
      break;
    }
    case 'tram': {
      const line = enactTram(world);
      text = line
        ? `A tram now runs between ${districtName(world, line[0])} and ${districtName(world, line[1])}.`
        : 'The tram line was not built; the public works fund is short of what the line costs.';
      break;
    }
    case 'monument': {
      const m = target ? commissionMonument(world, target.id, p.summary) : null;
      text = m
        ? `A statue of ${target?.name ?? 'the honoree'} will stand in Central Plaza.`
        : 'The monument was not cut: the fund is short, or the honoree already stands in stone.';
      break;
    }
    default: text = `The Charter is amended: ${p.summary}`; break;
  }
  emit(world, 'law', `Council decision (${p.id}): ${text}`, [p.proposerId], p.kind === 'charter' || p.kind === 'remove_mayor' ? 0.8 : 0.6,
    { proposalId: p.id, kind: p.kind, value: p.value, targetId: p.targetId });
}

// ---------------------------------------------------------------------------
// The session
// ---------------------------------------------------------------------------

/** Trim decided proposals so the list stays bounded (open ones are always kept). */
function trimProposals(world: World): void {
  const g = world.government;
  const decided = g.proposals.filter((p) => p.status !== 'open');
  if (decided.length <= PROPOSAL_HISTORY) return;
  const drop = new Set(decided.slice(0, decided.length - PROPOSAL_HISTORY).map((p) => p.id));
  g.proposals = g.proposals.filter((p) => !drop.has(p.id));
}

function resolveProposal(world: World, p: Proposal, members: Citizen[]): void {
  for (const m of members) {
    // A councillor who filed their interest has abstained, and an abstention
    // is not a nay: filling their vote in would take back the one thing
    // declaring costs them (`docs/ENVIRONMENT.md` §5).
    if (hasDeclared(world, p.id, m.id)) continue;
    if (p.votes[m.id] === undefined && m.brain === 'reflex') p.votes[m.id] = councillorDisposition(world, m.id, p);
  }
  const ayes = members.filter((m) => p.votes[m.id] === true).length;
  const nays = members.filter((m) => p.votes[m.id] === false).length;
  const passed = ayes >= p.needed;
  p.status = passed ? 'passed' : 'failed';
  p.decidedDay = world.day;
  const proposer = world.citizens[p.proposerId];
  const who = proposer?.name ?? p.proposerId;
  emit(world, 'proposal', `The Council ${passed ? 'passed' : 'rejected'} ${who}'s ${p.petition ? 'petition' : 'proposal'} (${ayes} ayes, ${nays} nays, ${p.needed} needed): ${p.summary}`,
    [p.proposerId, ...members.map((m) => m.id)], passed ? 0.8 : 0.5, { proposalId: p.id, kind: p.kind, ayes, nays, passed });
  if (proposer) remember(world, p.proposerId, 'civic', `The Council ${passed ? 'passed' : 'rejected'} your ${p.petition ? 'petition' : 'proposal'} ${p.id} (${ayes}–${nays}).`);
  for (const m of members) {
    if (m.id !== p.proposerId) remember(world, m.id, 'civic', `The Council ${passed ? 'passed' : 'rejected'} ${who}'s proposal ${p.id} (${ayes}–${nays}): ${p.summary}`);
  }
  if (passed) enactProposal(world, p);
}

/** With nobody to vote, proposals wait for a Council; after a week they lapse. */
function holdOverProposals(world: World, due: Proposal[]): void {
  const lapsed = due.filter((p) => world.day - p.tabledDay >= PROPOSAL_LAPSE_DAYS);
  for (const p of lapsed) {
    p.status = 'failed';
    p.decidedDay = world.day;
    emit(world, 'proposal', `${nameOfProposer(world, p)}'s ${p.petition ? 'petition' : 'proposal'} lapsed: no Council sat to vote on it.`, [p.proposerId], 0.3,
      { proposalId: p.id, kind: p.kind, lapsed: true });
    remember(world, p.proposerId, 'civic', `Your proposal ${p.id} lapsed: no Council sat to vote on it within ${PROPOSAL_LAPSE_DAYS} days.`);
  }
  const waiting = due.length - lapsed.length;
  if (waiting > 0 && world.counters.proposalsHeldOverDay !== world.day) {
    world.counters.proposalsHeldOverDay = world.day;
    emit(world, 'proposal', `No Council sits; ${waiting} proposal${waiting > 1 ? 's are' : ' is'} held over until one is seated.`, [], 0.2);
  }
}

function nameOfProposer(world: World, p: Proposal): string {
  return world.citizens[p.proposerId]?.name ?? p.proposerId;
}

/** The daily session: proposals tabled before today, then appeals, then the bench. */
export function councilSession(world: World): void {
  const members = sittingCouncil(world);
  const due = world.government.proposals.filter((p) => p.status === 'open' && p.tabledDay < world.day);
  if (members.length === 0) holdOverProposals(world, due);
  else for (const p of due) resolveProposal(world, p, members);
  trimProposals(world);
  decideAppeals(world);
  if (world.government.judges.length < JUDGE_SEATS) appointJudges(world);
}

// ---------------------------------------------------------------------------
// Daily government
// ---------------------------------------------------------------------------

/** Councillors who are exiled, suspended or gone lose their seats; the Mayor is replaced if needed. */
function pruneCouncil(world: World): void {
  const g = world.government;
  const seats = g.mayorId && !g.council.includes(g.mayorId) ? [g.mayorId, ...g.council] : [...g.council];
  for (const id of seats) {
    const c = world.citizens[id];
    if (c && inGoodStanding(c) && isPresent(world, c)) continue;
    g.council = g.council.filter((m) => m !== id);
    if (g.mayorId === id) g.mayorId = null;
    if (c && (c.office === 'councillor' || c.office === 'mayor')) c.office = residualOffice(world, id);
    if (c) emit(world, 'law', `${c.name} no longer sits on the Council (${c.standing}).`, [id], 0.5);
  }
  if (g.mayorId === null && g.council.length > 0) {
    const next = succeedMayor(world);
    if (next) emit(world, 'law', `${next.name} succeeds to the office of Mayor.`, [next.id], 0.6);
  }
}

/** Builders employed by the city, who carry out public works. */
function cityBuilders(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const job of Object.values(world.jobs)) {
    if (job.role !== 'builder' || !job.holderId) continue;
    const c = world.citizens[job.holderId];
    if (c && inGoodStanding(c) && isPresent(world, c)) out.push(c);
  }
  return out;
}

/** A tenth of the fund (at least 50 ℓ) a day goes to builders as a bonus and becomes housing progress. */
function spendPublicWorks(world: World): void {
  const g = world.government;
  const fund = Math.max(0, Math.round(g.publicWorksFund));
  g.publicWorksFund = fund;
  if (fund <= 0) return;
  const builders = cityBuilders(world);
  if (builders.length === 0) {
    if (world.counters.publicWorksStalledDay !== world.day) {
      world.counters.publicWorksStalledDay = world.day;
      emit(world, 'housing', `Public works are stalled: ${fund} ℓ is committed but no builder is employed.`, [], 0.2);
    }
    return;
  }
  const spend = Math.min(fund, Math.max(50, Math.round(fund / 10)), Math.max(0, world.treasury.balance));
  const share = Math.floor(spend / builders.length);
  if (share <= 0) return;
  let paid = 0;
  for (const b of builders) {
    if (!transfer(world, 'treasury', b.id, share, 'public_works', 'public works bonus')) continue;
    paid += share;
    remember(world, b.id, 'money', `You received a public works bonus of ${share} ℓ.`);
  }
  if (paid <= 0) return;
  g.publicWorksFund = fund - paid;
  addHousingProgress(world, paid / 5);
  emit(world, 'housing', `Public works: ${paid} ℓ paid to ${builders.length} builder${builders.length > 1 ? 's' : ''}; ${g.publicWorksFund} ℓ remain in the fund.`,
    builders.map((b) => b.id), 0.3, { paid, fund: g.publicWorksFund });
}

/**
 * Start-of-day government pass: seats vacated by the ineligible, overdue
 * elections held, nominations opened on schedule, the bench kept full, and
 * public works money put to work.
 */
export function dailyGovernment(world: World): void {
  const g = world.government;
  const e = g.election;
  pruneCouncil(world);
  if (!e.resolved && world.day > e.electionDay) holdElection(world);
  if (world.day >= e.nominationsOpenDay && world.day < e.electionDay && world.counters.nominationsOpenedDay !== e.nominationsOpenDay) {
    openNominations(world);
  }
  appointJudges(world);
  spendPublicWorks(world);
}

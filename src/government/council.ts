/**
 * The Council: proposals and petitions, the daily session (votes, enactment,
 * appeals, judicial appointments), the Mayor's succession, and the daily
 * government pass. Elections live in elections.ts and are re-exported here.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, Citizen, CitizenId, LawCode, Proposal, ProposalKind, World,
} from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { MONUMENT_COST, TRAM_COST } from '../data/jobs.ts';
import { nextId } from '../util/ids.ts';
import { chance, rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { lastBalanceSheet, transfer } from '../economy/treasury.ts';
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
const SUPERMAJORITY_KINDS: readonly ProposalKind[] = ['pardon', 'charter', 'remove_mayor'];
const TARGETED_KINDS: readonly ProposalKind[] = ['appoint_judge', 'dismiss_judge', 'pardon', 'remove_mayor', 'monument'];
/** Kinds that carry neither a value the Council checks nor a citizen to name. */
const OPEN_KINDS: readonly ProposalKind[] = ['charter', 'tram'];
const VALUE_RANGES: Partial<Record<ProposalKind, [number, number]>> = {
  income_tax: [0, 0.5], sales_tax: [0, 0.25], dividend: [0, 60], min_wage: [5, 40], law_severity: [1, 5], public_works: [0, 5000],
  // The four levers the metropolis added; markets/levers.ts owns their bounds.
  ...leverRanges(),
};

export interface ProposalSpec {
  kind: ProposalKind;
  value: number;
  summary: string;
  lawCode?: LawCode;
  targetId?: CitizenId;
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
    summary, proposerId, petition: !councillor, tabledDay: world.day, status: 'open',
    votes: councillor ? { [proposerId]: true } : {}, decidedDay: null,
    needed: SUPERMAJORITY_KINDS.includes(spec.kind) ? 4 : 3,
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
  const population = Math.max(1, world.order.length);
  const treasuryStrained = world.treasury.balance < g.dividend * population * 5;
  // Every citizen reads the Treasury's balance sheet in the morning Chronicle.
  const deficit = treasuryDeficitShare(world);
  let score = 0;

  switch (p.kind) {
    case 'income_tax': case 'sales_tax': {
      const d = direction(p, p.kind === 'income_tax' ? g.incomeTax : g.salesTax);
      score += (platform.tax - 0.5) * 0.4 * d;
      if (owner || rich) score -= 0.2 * d;
      if (poor) score += 0.1 * d;
      if (treasuryStrained) score += 0.15 * d;
      score += deficit * BALANCE_SHEET_WEIGHT * d;
      break;
    }
    case 'dividend': {
      const d = direction(p, g.dividend);
      score += (platform.dividend - 0.5) * 0.4 * d;
      if (poor) score += 0.2 * d;
      if (owner || rich) score -= 0.1 * d;
      if (treasuryStrained) score -= 0.25 * d;
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
      break;
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
      score += deficit * BALANCE_SHEET_WEIGHT * d;
      break;
    }
    case 'reserve': {
      const d = direction(p, g.reserveTarget ?? 0);
      score += 0.05 * d + (treasuryStrained ? 0.15 * d : -0.05 * d) - (platform.dividend - 0.5) * 0.3 * d;
      break;
    }
    case 'tram':
      score += 0.1 + (g.publicWorksFund >= TRAM_COST ? 0.15 : -0.4) + (c.personality.curiosity - 0.5) * 0.2;
      break;
    case 'monument':
      score += -0.05 + (g.publicWorksFund >= MONUMENT_COST ? 0.15 : -0.4)
        + (bondTarget > 40 ? 0.3 : bondTarget < -30 ? -0.3 : 0)
        + (target && target.reputation >= 70 ? 0.15 : 0);
      break;
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
    case 'min_wage': g.minWage = clamp(Math.round(p.value), 5, 40); text = `The minimum wage is now ${g.minWage} ℓ per shift.`; break;
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

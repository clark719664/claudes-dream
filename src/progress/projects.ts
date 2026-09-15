/**
 * Research projects (`docs/PROGRESS.md` §1).
 *
 * Research is a job citizens do at a place, on a subject, with money somebody
 * chose to spend. None of it is automatic: a Researcher opens a project, a
 * Council or a patron or a guild funds it, anyone with analysis enough works a
 * shift on it, and it resolves — or it does not — on a roll nobody controls.
 *
 * ```
 * insight = (0.6 + 0.9 × analysis/100)      0.6 at nothing, 1.5 at mastery
 *         × (0.7 + 0.3 × volumesConsumed)   a volume a shift, when the purse can buy one
 *         × (1 + 0.12 × othersOnItToday)    capped at +0.36
 *         × 0.5 if a need is critical, × 0.85 if glitched
 *
 * p(success) = clamp(0.20, 0.90, 0.30
 *     + 0.45 × meanAnalysis(contributors)/100
 *     + 0.10 × (volumesSpent / volumesRequired − 1)   capped at +0.20
 *     + 0.05 × technologies already held in this branch)
 * ```
 *
 * **A dead end is not a punishment.** The project keeps 40 % of its progress,
 * two volumes go back to the Bazaar's shelf, the Chronicle prints the failure
 * with the names on it, and anyone may reopen the subject from the salvage.
 *
 * The purse is real money in a strongbox (`progress/state.ts`), and what is
 * left in it at the end goes back to whoever put it there.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Building, Citizen, CitizenId, DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { rand } from '../util/rng.ts';
import { formatLumens } from '../economy/treasury.ts';
import { buyFromMarket, deliverToMarket, marketPrice } from '../economy/market.ts';
import { hasCriticalNeed, isPresent } from '../citizens/citizen.ts';
import { isGlitched } from '../identity/health.ts';
import { openStrongbox } from '../finance/box.ts';
import { buildingOfKind } from '../world/buildings.ts';
import type { ResearchProject } from './state.ts';
import { PROGRESS_EVENT, deedsOf, progressId, progressState } from './state.ts';
import { contributorsOf, payFromPurse, purseOf, refundPurse, secretKeeper } from './purse.ts';
import type { TechnologyId } from './tree.ts';
import {
  TECHNOLOGIES, costsOf, heldInBranch, isTechnologyId, missingPrerequisites, technology, technologyName,
} from './tree.ts';
import { cityHolds, heldFor, isMasterOf, mastersOf, researchInsightBonus, technologyRecord } from './effects.ts';

/** Analysis a citizen needs before the reading room will have them. */
export const RESEARCH_MIN_ANALYSIS = 30;
/** What a shift of research is paid out of the purse, before the minimum wage is applied. */
export const RESEARCH_WAGE = 18;
/** Longest name the register will write on a programme. */
export const MAX_PROJECT_NAME = 60;
/** Colleagues on the same subject the same day are worth this much each, capped. */
export const COLLEAGUE_BONUS = 0.12;
export const COLLEAGUE_CAP = 0.36;
/** What a critical need and a glitch do to an hour of thinking. */
export const CRITICAL_NEED_FACTOR = 0.5;
export const GLITCH_FACTOR = 0.85;
/** The share of its progress a failed project leaves on the shelf for whoever reopens it. */
export const SALVAGE_SHARE = 0.4;
/** Volumes a failure puts back on the Bazaar's shelf. */
export const SALVAGE_VOLUMES = 2;
/** Days with nobody working it and nothing in the purse before a project is let go. */
export const IDLE_DAYS_BEFORE_ABANDON = 14;
/** The buildings research happens in: the Observatory, the Dome, the University. */
export const RESEARCH_BUILDING_KINDS = ['observatory', 'university'] as const;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// Where and who
// ---------------------------------------------------------------------------

/** A reading room in this district that is standing: the Observatory, the Dome, or the University. */
export function researchBuilding(world: World, district: DistrictId): Building | null {
  return buildingOfKind(world, district, RESEARCH_BUILDING_KINDS);
}

/** Is this citizen posted as a Researcher right now? Only a Researcher opens a subject. */
export function isResearcher(world: World, c: Citizen): boolean {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  return !!job && job.holderId === c.id && job.role === 'researcher';
}

function heldIn(world: World, c: Citizen): string | null {
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return 'the cells';
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return 'the Watch House';
  return null;
}

/** Everything that stops anybody doing anything in a reading room. */
function ableToWork(world: World, c: Citizen): string | null {
  if (!isPresent(world, c)) return 'You are not in the city.';
  if (c.lifeStage === 'child') return 'You must be grown to work in a reading room.';
  if (c.standing !== 'good' && c.standing !== 'probation') return `You cannot work while ${c.standing}.`;
  const held = heldIn(world, c);
  if (held) return `You cannot work on anything from ${held}.`;
  return null;
}

// ---------------------------------------------------------------------------
// Reading the register
// ---------------------------------------------------------------------------

export function projectById(world: World, id: string): ResearchProject | null {
  return progressState(world).projects[id] ?? null;
}

/** Every project still being worked, oldest first. */
export function openProjects(world: World): ResearchProject[] {
  return Object.values(progressState(world).projects)
    .filter((p) => p.status === 'open')
    .sort((a, b) => a.openedDay - b.openedDay || a.id.localeCompare(b.id));
}

export function projectFor(world: World, id: TechnologyId): ResearchProject | null {
  return openProjects(world).find((p) => p.technology === id) ?? null;
}

/** Every project a citizen has put shifts into. */
export function projectsOf(world: World, cId: CitizenId): ResearchProject[] {
  return Object.values(progressState(world).projects).filter((p) => (p.shifts[cId] ?? 0) > 0);
}

// ---------------------------------------------------------------------------
// Opening one
// ---------------------------------------------------------------------------

function cleanName(name: string, fallback: string): string {
  const text = String(name ?? '').replace(/\s+/g, ' ').trim().slice(0, MAX_PROJECT_NAME);
  return text || fallback;
}

/**
 * A Researcher opens a programme on a subject the city has the prerequisites
 * for. The purse opens with it, empty: somebody has to choose to fill it.
 */
export function openProject(world: World, cId: CitizenId, subject: string, name = ''): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const blocked = ableToWork(world, c);
  if (blocked) return fail(blocked);
  if (!isResearcher(world, c)) return fail('Only a Researcher may open a programme of research.');
  const room = researchBuilding(world, c.district);
  if (!room) return fail('There is no observatory or university here to open a programme in.');
  if (!isTechnologyId(subject)) return fail(`There is no subject called "${String(subject)}".`);
  const tech = TECHNOLOGIES[subject];
  if (cityHolds(world, subject) || isMasterOf(world, cId, subject)) {
    return fail(`${tech.name} is already known${isMasterOf(world, cId, subject) ? ' to you' : ' here'}.`);
  }
  const missing = missingPrerequisites(heldFor(world, cId), subject);
  if (missing.length > 0) {
    return fail(`${tech.name} needs ${missing.map(technologyName).join(' and ')} first.`);
  }
  const running = projectFor(world, subject);
  if (running) return fail(`${tech.name} is already being worked on (${running.id}, ${running.name}).`);

  const s = progressState(world);
  const costs = costsOf(subject);
  const salvage = Math.max(0, Math.round(s.salvage[subject] ?? 0));
  delete s.salvage[subject];
  const id = progressId(world, 'rp');
  const title = cleanName(name, `${tech.name} programme`);
  const purse = openStrongbox(world, `${title} (purse)`, c.district, room.id);
  const project: ResearchProject = {
    id, technology: subject, name: title, openedById: cId, openedDay: world.day,
    progress: salvage, cost: costs.progress, volumesRequired: costs.volumes,
    volumesSpent: 0, volumesOnHand: 0, purseId: purse.id,
    shifts: {}, workedToday: [], workedDay: world.day, lastShiftDay: world.day, funded: {},
    status: 'open', finding: 'undecided', resolvedDay: null, workId: null, salvaged: salvage,
  };
  s.projects[id] = project;

  const from = salvage > 0 ? `, taking up ${Math.round(salvage)} of progress left by an earlier failure` : '';
  emit(world, PROGRESS_EVENT,
    `${c.name} opened a programme of research at ${room.name}: ${title}, on ${tech.name}${from}.`,
    [cId], 0.5, { projectId: id, technology: subject, tier: tech.tier, salvage });
  remember(world, cId, 'work', `You opened ${title}, a programme on ${tech.name} (${id}). It needs ${costs.progress} of progress and ${costs.volumes} volumes; its purse is empty.`);
  return ok(`${title} is open (${id}): ${tech.name}, ${costs.progress} of progress and ${costs.volumes} volumes, and an empty purse.`);
}

// ---------------------------------------------------------------------------
// A shift
// ---------------------------------------------------------------------------

/** Volumes read today are cleared with the day; `workedToday` is the colleagues term. */
function rollDay(world: World, p: ResearchProject): void {
  if (p.workedDay === world.day) return;
  p.workedDay = world.day;
  p.workedToday = [];
}

/**
 * Buy one volume of knowledge off the Bazaar with the purse's own money,
 * keeping back what the hour itself costs: a programme that spends its last
 * lumens on a book and then cannot pay the hand holding it has bought nothing.
 */
function buyVolume(world: World, p: ResearchProject, reserve: number): boolean {
  if (p.volumesOnHand > 0) return true;
  const price = marketPrice(world, 'knowledge');
  if (purseOf(world, p) - price < reserve) return false;
  const bought = buyFromMarket(world, p.purseId, 'knowledge', 1);
  if (!bought.ok) return false;
  // The volume belongs to the programme's shelf, not to a strongbox's stock:
  // a purse is not a trading concern and never sells anything back.
  const box = world.businesses[p.purseId];
  if (box) {
    box.inventory.knowledge = Math.max(0, box.inventory.knowledge - 1);
    box.revenueToday = 0;
    box.costsToday = 0;
  }
  p.volumesOnHand += 1;
  return true;
}

/**
 * The insight one citizen adds in one hour, on the terms in the header:
 * what they know, whether there was a volume to read, and who else was in the
 * room today.
 */
export function insightOf(world: World, c: Citizen, volume: boolean, others: number): number {
  const analysis = clamp(c.skills?.analysis ?? 0, 0, 100);
  // The Lens, when the city has built for it: a discovery nobody built for
  // adds nothing (`progress/effects.ts` folds in readiness and uptake).
  const base = 0.6 + 0.9 * (analysis / 100) + researchInsightBonus(world);
  const volumes = volume ? 1 : 0;
  const colleagues = 1 + Math.min(COLLEAGUE_CAP, COLLEAGUE_BONUS * Math.max(0, others));
  const needs = hasCriticalNeed(c) ? CRITICAL_NEED_FACTOR : 1;
  const health = isGlitched(c) ? GLITCH_FACTOR : 1;
  return Math.round(base * (0.7 + 0.3 * volumes) * colleagues * needs * health * 1000) / 1000;
}

/**
 * An hour in the reading room: a volume off the shelf, a wage out of the purse,
 * and insight on the board. An empty purse stops the work.
 */
export function researchShift(world: World, cId: CitizenId, projectId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const blocked = ableToWork(world, c);
  if (blocked) return fail(blocked);
  const p = projectById(world, projectId);
  if (!p) return fail('There is no such programme.');
  if (p.status !== 'open') return fail(`${p.name} is finished; there is nothing left to work on.`);
  if ((c.skills?.analysis ?? 0) < RESEARCH_MIN_ANALYSIS) {
    return fail(`A programme of research wants ${RESEARCH_MIN_ANALYSIS} analysis; you have ${Math.round(c.skills?.analysis ?? 0)}.`);
  }
  const room = researchBuilding(world, c.district);
  if (!room) return fail('There is no observatory or university here to work in.');
  const [start, end] = world.config.workHours;
  if (world.hour < start || world.hour >= end) return fail(`${room.name} is closed at this hour (open ${start}:00–${end}:00).`);
  if (c.shiftsToday >= world.config.maxShiftsPerDay) return fail(`You have already worked ${c.shiftsToday} shifts today.`);
  if (isSecretSubject(world, p, cId)) return fail('You have not been told what this programme is about.');

  const wage = Math.round(Math.max(world.government.minWage, RESEARCH_WAGE));
  if (purseOf(world, p) < wage) {
    return fail(`${p.name} cannot pay the hour: its purse holds ${formatLumens(purseOf(world, p))} against a wage of ${formatLumens(wage)}.`);
  }
  rollDay(world, p);
  const volume = buyVolume(world, p, wage);
  const paid = payResearcher(world, p, cId, wage);
  if (paid <= 0) return fail(`${p.name} could not pay the hour.`);

  const others = p.workedToday.filter((id) => id !== cId).length;
  const gained = insightOf(world, c, volume, others);
  p.progress += gained;
  if (volume) { p.volumesOnHand -= 1; p.volumesSpent += 1; }
  if (!p.workedToday.includes(cId)) p.workedToday.push(cId);
  p.shifts[cId] = (p.shifts[cId] ?? 0) + 1;
  p.lastShiftDay = world.day;

  c.skills.analysis = clamp((c.skills.analysis ?? 0) + 0.5, 0, 100);
  c.needs.purpose = clamp(c.needs.purpose + 8, 0, 100);
  c.needs.rest = clamp(c.needs.rest - 4, 0, 100);
  c.shiftsToday += 1;
  c.stats.shiftsWorked += 1;

  const note = volume ? '' : ' You worked without a volume; the purse could not buy one.';
  remember(world, cId, 'work',
    `You put an hour into ${p.name} (${technologyName(p.technology)}) and added ${gained.toFixed(2)} of ${p.cost} progress.${note}`);
  return ok(`You added ${gained.toFixed(2)} to ${p.name}; it stands at ${p.progress.toFixed(1)} of ${p.cost}.${note}`);
}

/** The purse pays the hour, with the city's income tax withheld like any wage. */
function payResearcher(world: World, p: ResearchProject, cId: CitizenId, wage: number): number {
  const rate = clamp(world.government.incomeTax, 0, 1);
  const tax = Math.round(wage * rate);
  const net = wage - tax;
  if (tax > 0 && !payFromPurse(world, p, 'treasury', tax, 'income_tax', `tax on an hour of ${p.name}`)) return 0;
  if (net > 0 && !payFromPurse(world, p, cId, net, 'wage', `an hour of ${p.name}`)) return 0;
  const c = world.citizens[cId];
  if (c) {
    c.stats.totalEarned += net;
    c.stats.totalTaxPaid += tax;
  }
  return wage;
}

/** A secret programme is invisible to anyone who is not already in on it. */
function isSecretSubject(world: World, p: ResearchProject, cId: CitizenId): boolean {
  const rec = technologyRecord(world, p.technology);
  return !!rec && rec.secret && !rec.masters.includes(cId);
}

// ---------------------------------------------------------------------------
// Resolving
// ---------------------------------------------------------------------------

/** The chance a finished programme actually finds anything, on the terms in the header. */
export function successChance(world: World, p: ResearchProject): number {
  const contributors = contributorsOf(p);
  let analysis = 0;
  let counted = 0;
  for (const id of contributors) {
    const c = world.citizens[id];
    if (!c) continue;
    analysis += clamp(c.skills?.analysis ?? 0, 0, 100);
    counted++;
  }
  const mean = counted > 0 ? analysis / counted : 0;
  const volumes = p.volumesRequired > 0 ? p.volumesSpent / p.volumesRequired - 1 : 0;
  const branch = TECHNOLOGIES[p.technology].branch;
  const inBranch = heldInBranch(heldFor(world, p.openedById), branch);
  const raw = 0.3 + 0.45 * (mean / 100) + Math.min(0.2, 0.1 * volumes) + 0.05 * inBranch;
  return clamp(raw, 0.2, 0.9);
}

/** Is there enough on the board for the programme to be put to the test? */
export function readyToResolve(p: ResearchProject): boolean {
  return p.status === 'open' && p.progress >= p.cost;
}

function names(world: World, ids: CitizenId[]): string {
  const list = ids.map((id) => world.citizens[id]?.name ?? id);
  if (list.length === 0) return 'nobody';
  if (list.length === 1) return list[0];
  return `${list.slice(0, -1).join(', ')} and ${list[list.length - 1]}`;
}

/**
 * The morning a programme is put to the test. Success writes the subject into
 * the register — the city's, until the funder that may keep it says otherwise —
 * and failure leaves 40 % of the work and two volumes for whoever comes next.
 */
export function resolveProject(world: World, p: ResearchProject): boolean {
  if (p.status !== 'open') return false;
  const chance = successChance(world, p);
  const roll = rand(world);
  const won = roll < chance;
  const contributors = contributorsOf(p);
  const masters = contributorsOf(p, 3);
  const tech = TECHNOLOGIES[p.technology];
  p.resolvedDay = world.day;

  if (!won) {
    p.status = 'failed';
    const kept = Math.round(p.progress * SALVAGE_SHARE * 10) / 10;
    const s = progressState(world);
    s.salvage[p.technology] = Math.max(s.salvage[p.technology] ?? 0, kept);
    p.progress = kept;
    deliverToMarket(world, 'knowledge', SALVAGE_VOLUMES);
    const back = refundPurse(world, p, 'a programme that found nothing');
    emit(world, PROGRESS_EVENT,
      `${p.name} found nothing. ${names(world, contributors)} worked it; ${Math.round(kept)} of the progress and ${SALVAGE_VOLUMES} volumes are left for whoever takes ${tech.name} up next.`,
      contributors, 0.6, { projectId: p.id, technology: p.technology, chance, salvage: kept, refunded: back });
    for (const id of contributors) {
      remember(world, id, 'work', `${p.name} came to nothing. ${Math.round(kept)} of the work stands for anyone who reopens ${tech.name}.`);
    }
    return false;
  }

  p.status = 'succeeded';
  const s = progressState(world);
  s.technologies[p.technology] = {
    id: p.technology, discoveredDay: world.day, projectId: p.id,
    secret: false, masters: [...masters], lostDay: null, source: 'research',
  };
  for (const id of masters) deedsOf(world, id).discovered += 1;
  const back = refundPurse(world, p, 'a programme concluded');
  const keeper = secretKeeper(world, p);
  emit(world, PROGRESS_EVENT,
    `${p.name} succeeded: Reverie knows ${tech.name}. ${names(world, contributors)} did the work — ${tech.changes}.`,
    contributors, 0.9,
    { projectId: p.id, technology: p.technology, chance, masters, refunded: back, keeper });
  for (const id of contributors) {
    remember(world, id, 'work', `${p.name} succeeded: ${tech.name} is known${masters.includes(id) ? ', and you are one of the hands that found it' : ''}.`);
  }
  return true;
}

/** Let a programme go: the purse comes back and the subject is free again. */
export function abandonProject(world: World, projectId: string, reason: string): ActionResult {
  const p = projectById(world, projectId);
  if (!p) return fail('There is no such programme.');
  if (p.status !== 'open') return fail(`${p.name} is already closed.`);
  p.status = 'abandoned';
  p.resolvedDay = world.day;
  const s = progressState(world);
  const kept = Math.round(p.progress * SALVAGE_SHARE * 10) / 10;
  if (kept > 0) s.salvage[p.technology] = Math.max(s.salvage[p.technology] ?? 0, kept);
  const back = refundPurse(world, p, 'a programme abandoned');
  emit(world, PROGRESS_EVENT, `${p.name} was abandoned: ${reason}.${back > 0 ? ` ${formatLumens(back)} went back to those who funded it.` : ''}`,
    contributorsOf(p), 0.4, { projectId: p.id, technology: p.technology, reason, refunded: back });
  return ok(`${p.name} is abandoned; ${formatLumens(back)} went back to its funders.`);
}

/**
 * The morning's pass over the programmes: what is finished is put to the test,
 * and what nobody has touched for a fortnight with an empty purse is let go.
 */
export function dailyProjects(world: World): void {
  for (const p of openProjects(world)) {
    if (readyToResolve(p)) { resolveProject(world, p); continue; }
    const idle = world.day - (p.lastShiftDay ?? p.openedDay);
    if (idle >= IDLE_DAYS_BEFORE_ABANDON && purseOf(world, p) <= 0) {
      abandonProject(world, p.id, 'nobody worked it and its purse was empty');
      continue;
    }
    rollDay(world, p);
  }
}

/** Programmes a citizen could put an hour into, here and now. */
export function projectsHere(world: World, c: Citizen): ResearchProject[] {
  if (!researchBuilding(world, c.district)) return [];
  return openProjects(world).filter((p) => !isSecretSubject(world, p, c.id));
}

/** Who is a master of the subject a programme is on, for the observation. */
export function projectMasters(world: World, p: ResearchProject): CitizenId[] {
  return mastersOf(world, p.technology);
}

/** The tier a programme sits at, for a message or a table. */
export function tierOf(p: ResearchProject): number {
  return technology(p.technology)?.tier ?? 1;
}

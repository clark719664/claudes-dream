/**
 * Jobs and shifts. The city runs the founding jobs (wages from the Treasury,
 * output to the Bazaar); businesses post their own (wages from the business
 * treasury, output to the business inventory). A shift is one working tick.
 */
import { SKILLS, clamp } from '../types.ts';
import type {
  ActionResult, Business, BusinessId, Citizen, CitizenId, Job, JobId, JobOutput, JobRole, MoneyParty, Skill, World,
} from '../types.ts';
import { CITY_JOBS, CITY_SHIFTS_PER_DAY, COURIER_CONTRACT, COURIER_CONTRACTS_PER_DAY } from '../data/jobs.ts';
import { DISTRICTS, districtOfBuilding } from '../data/city.ts';
import type { JobTemplate } from '../data/jobs.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer, withholdingPay } from './treasury.ts';
import { buyFromMarket, deliverToMarket, takeFromMarket, wholeUnits } from './market.ts';
import { addHousingProgress } from './housing.ts';
import { isPieceRateJob, pieceRate, planCityPosts, postToClose, postedPieceRate, refreshCityWages } from './planning.ts';
import { cityCanPay, dailyBudget, isBudgetedJob, noteCitySpend, notePieceWage } from './budget.ts';
import { GLITCH_PRODUCTIVITY, isGlitched } from '../identity/health.ts';
import { disasterProductionFactor } from '../world/disasters.ts';
import { weatherEnergyFactor } from '../world/seasons.ts';
import { mentorshipMultiplier } from '../social/mentorship.ts';
import { isJailed } from '../government/jail.ts';
import { isOnStrike } from '../politics/unions.ts';
import { pursue } from '../government/investigations.ts';

export const CITY_EMPLOYER_NAME = 'City of Reverie';
/** Skill gained per shift in the job's skill (×1.5 while holding knowledge). */
const SKILL_PER_SHIFT = 0.5;
/** Boosted shifts per volume of knowledge consumed. */
const SHIFTS_PER_KNOWLEDGE = 10;
/** Steady work slowly builds a reputation: +1 every this many shifts. */
const SHIFTS_PER_REPUTATION = 20;

export interface JobSpec {
  title: string;
  wage: number;
  skill: Skill | null;
  minSkill: number;
  role?: JobRole;
  output?: JobOutput;
}

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

function jobFromTemplate(world: World, t: JobTemplate, employer: BusinessId | 'city', wage: number): Job {
  const id = nextId(world, 'j');
  const job: Job = {
    id, role: t.role, title: t.title, employer, buildingId: t.buildingId, district: districtOfBuilding(t.buildingId),
    skill: t.skill, minSkill: t.minSkill, minReputation: t.minReputation, wage: Math.round(wage),
    output: { ...t.output }, holderId: null, createdDay: world.day,
  };
  world.jobs[id] = job;
  // a production post advertises today's piece rate, not the founding wage
  if (isPieceRateJob(job)) job.wage = postedPieceRate(world, job);
  return job;
}

/** Open one more city position for a role (used at founding, when the Watch grows, and by the daily plan). Null if the role has no template. */
export function createCityJob(world: World, role: JobRole): Job | null {
  const t = CITY_JOBS.find((x) => x.role === role);
  return t ? jobFromTemplate(world, t, 'city', t.wage) : null;
}

/** Founding jobs from CITY_JOBS × slots. Idempotent: only missing slots are created. */
export function createCityJobs(world: World): void {
  for (const t of CITY_JOBS) {
    const existing = Object.values(world.jobs).filter((j) => j.employer === 'city' && j.role === t.role).length;
    for (let i = existing; i < t.slots; i++) jobFromTemplate(world, t, 'city', t.wage);
  }
}

export function openJobs(world: World): Job[] {
  return Object.values(world.jobs).filter((j) => j.holderId === null);
}

export function employerBusiness(world: World, job: Job): Business | null {
  return job.employer === 'city' ? null : world.businesses[job.employer] ?? null;
}

export function employerName(world: World, job: Job): string {
  if (job.employer === 'city') return CITY_EMPLOYER_NAME;
  return world.businesses[job.employer]?.name ?? 'a closed business';
}

export function isQualified(world: World, c: Citizen, job: Job): boolean {
  if (c.standing !== 'good' && c.standing !== 'probation') return false;
  if (job.employer !== 'city') {
    const biz = world.businesses[job.employer];
    if (!biz || biz.dissolvedDay !== null) return false;
  }
  if (c.reputation < job.minReputation) return false;
  if (job.skill && c.skills[job.skill] < job.minSkill) return false;
  return true;
}

function qualificationGap(c: Citizen, job: Job): string {
  if (c.standing !== 'good' && c.standing !== 'probation') return `You cannot work while ${c.standing}.`;
  if (c.reputation < job.minReputation) return `That job needs reputation ${job.minReputation}; yours is ${Math.round(c.reputation)}.`;
  if (job.skill && c.skills[job.skill] < job.minSkill) {
    return `That job needs ${job.skill} ${job.minSkill}; yours is ${Math.round(c.skills[job.skill])}.`;
  }
  return 'You are not qualified for that job.';
}

/** Detach a citizen from their job without events (the caller narrates). */
function releaseJob(world: World, c: Citizen): Job | null {
  const job = c.jobId ? world.jobs[c.jobId] ?? null : null;
  c.jobId = null;
  if (!job) return null;
  if (job.holderId === c.id) job.holderId = null;
  const biz = employerBusiness(world, job);
  if (biz) biz.employees = biz.employees.filter((id) => id !== c.id);
  if (job.role === 'watch_officer') {
    const g = world.government;
    g.watch = g.watch.filter((id) => id !== c.id);
    if (g.watchCaptainId === c.id) g.watchCaptainId = null;
    if (c.office === 'watch') c.office = null;
  }
  return job;
}

/** Put a citizen into an open job (no checks; callers validate). */
export function assignJob(world: World, c: Citizen, job: Job): void {
  if (c.jobId && c.jobId !== job.id) {
    const old = releaseJob(world, c);
    if (old) remember(world, c.id, 'work', `You left your job as ${old.title} at ${employerName(world, old)}.`);
  }
  job.holderId = c.id;
  c.jobId = job.id;
  const biz = employerBusiness(world, job);
  if (biz && !biz.employees.includes(c.id)) biz.employees.push(c.id);
  if (job.role === 'watch_officer') {
    c.office = 'watch';
    if (!world.government.watch.includes(c.id)) world.government.watch.push(c.id);
  }
}

export function applyForJob(world: World, cId: CitizenId, jobId: JobId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const job = world.jobs[jobId];
  if (!job) return fail('That job no longer exists.');
  if (job.holderId === cId) return fail(`You already work as ${job.title}.`);
  if (job.holderId) return fail('That position has already been filled.');
  if (isDetained(world, c)) return fail('You cannot take a job while detained.');
  if (!isQualified(world, c, job)) return fail(qualificationGap(c, job));
  if (job.role === 'watch_officer' && c.office && c.office !== 'watch') return fail(`You cannot join the Watch while serving as ${c.office}.`);
  const biz = employerBusiness(world, job);
  if (job.employer !== 'city' && (!biz || biz.dissolvedDay !== null)) return fail('That employer has closed its doors.');

  assignJob(world, c, job);
  const employer = employerName(world, job);
  emit(world, 'hired', `${c.name} was hired as ${job.title} at ${employer}.`, [cId], 0.2, { jobId });
  remember(world, cId, 'work', `You were hired as ${job.title} at ${employer} (${job.wage} ℓ per shift).`);
  return ok(`You were hired as ${job.title} at ${employer}.`);
}

export function quitJob(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const job = releaseJob(world, c);
  if (!job) return fail('You do not have a job to quit.');
  const employer = employerName(world, job);
  emit(world, 'quit', `${c.name} quit as ${job.title} at ${employer}.`, [cId], 0.2, { jobId: job.id });
  remember(world, cId, 'work', `You quit your job as ${job.title} at ${employer}.`);
  return ok(`You quit your job as ${job.title}.`);
}

export function fireFromJob(world: World, cId: CitizenId, reason: string): void {
  const c = world.citizens[cId];
  if (!c) return;
  const job = releaseJob(world, c);
  if (!job) return;
  const employer = employerName(world, job);
  emit(world, 'fired', `${c.name} lost their job as ${job.title} at ${employer}: ${reason}.`, [cId], 0.3, { jobId: job.id, reason });
  remember(world, cId, 'work', `You were dismissed as ${job.title} at ${employer}: ${reason}.`);
}

function meanSkill(c: Citizen): number {
  let sum = 0;
  for (const s of SKILLS) sum += c.skills[s];
  return sum / SKILLS.length;
}

function hasCriticalNeed(c: Citizen): boolean {
  return Object.values(c.needs).some((v) => v < 20);
}

/**
 * Draw the shift's energy input: city jobs take it from the Bazaar, business
 * jobs use their own stock then buy the rest. Returns the output multiplier
 * (1 when fully supplied, 0.5 when none was available).
 */
function supplyEnergy(world: World, job: Job, biz: Business | null): number {
  const cost = Math.round((job.output.energyCost ?? 0) * weatherEnergyFactor(world));
  if (cost <= 0) return 1;
  let got = 0;
  if (biz) {
    const fromStock = Math.min(cost, Math.max(0, biz.inventory.energy));
    biz.inventory.energy -= fromStock;
    got += fromStock;
    let need = cost - got;
    if (need > 0) {
      let bought = buyFromMarket(world, biz.id, 'energy', need).ok ? need : 0;
      if (bought === 0) {
        const available = Math.min(need, world.market.goods.energy.stock);
        for (let q = available; q >= 1 && bought === 0; q--) {
          if (buyFromMarket(world, biz.id, 'energy', q).ok) bought = q;
        }
      }
      biz.inventory.energy -= bought;
      got += bought;
      need -= bought;
    }
  } else {
    got = takeFromMarket(world, 'energy', cost);
  }
  return got >= cost ? 1 : 0.5 + 0.5 * (got / cost);
}

/** Skill growth for a shift; knowledge speeds it up and is slowly consumed. */
function growSkill(world: World, c: Citizen, job: Job): void {
  if (!job.skill) return;
  let gain = SKILL_PER_SHIFT * mentorshipMultiplier(world, c);
  if (c.inventory.knowledge > 0) {
    gain *= 1.5;
    const key = `kshift:${c.id}`;
    const n = (world.counters[key] ?? 0) + 1;
    if (n >= SHIFTS_PER_KNOWLEDGE) {
      c.inventory.knowledge -= 1;
      world.counters[key] = 0;
    } else {
      world.counters[key] = n;
    }
  }
  c.skills[job.skill] = clamp(c.skills[job.skill] + gain, 0, 100);
}

/**
 * The city buys at most COURIER_CONTRACTS_PER_DAY courier shifts a day, first
 * come first served; later shifts run for the business alone. Returns the
 * contract paid (0 when the day's contracts are spent or the Treasury is bare).
 */
function courierContract(world: World, c: Citizen, biz: Business): number {
  const key = 'courierContracts';
  const dayKey = 'courierContractsDay';
  if (world.counters[dayKey] !== world.day) { world.counters[dayKey] = world.day; world.counters[key] = 0; }
  if ((world.counters[key] ?? 0) >= COURIER_CONTRACTS_PER_DAY || !cityCanPay(world, COURIER_CONTRACT)) return 0;
  if (!transfer(world, 'treasury', biz.id, COURIER_CONTRACT, 'fee', `courier contract: ${c.name}`)) return 0;
  world.counters[key] = (world.counters[key] ?? 0) + 1;
  noteCitySpend(world, COURIER_CONTRACT);
  return COURIER_CONTRACT;
}

/** What a salaried city shift is about to cost the Treasury, net of the tax it keeps. */
function expectedCityNet(world: World, flatWage: number): number {
  return Math.max(1, flatWage - Math.round(flatWage * world.government.incomeTax));
}

function applyRoleSpecials(world: World, c: Citizen, job: Job, biz: Business | null): void {
  switch (job.role) {
    case 'courier':
      if (biz) courierContract(world, c, biz);
      break;
    case 'watch_officer':
      world.counters.patrolTicks = (world.counters.patrolTicks ?? 0) + 1;
      break;
    case 'journalist':
      world.counters.scrutiny = (world.counters.scrutiny ?? 0) + 1;
      break;
    case 'merchant':
      world.counters.merchantOnShiftTick = world.tick;
      break;
    // The metropolis: a detective's shift is spent on the traces the city
    // left behind; a defender, a curator and a coach are simply on duty, and
    // the modules that need to know look for them.
    case 'detective':
      pursue(world, c);
      break;
    case 'advocate':
      world.counters.defendersOnShiftTick = world.tick;
      break;
    case 'curator':
      world.counters.curatorOnShiftTick = world.tick;
      break;
    case 'coach':
      world.counters.coachOnShiftTick = world.tick;
      break;
    default:
      break;
  }
}

/** Work one shift at the citizen's job. See docs/MODULES.md for the full rule list. */
export function workShift(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!c.jobId) return fail('You do not have a job; apply for one on the job board.');
  const job = world.jobs[c.jobId];
  if (!job || job.holderId !== cId) { c.jobId = null; return fail('Your job no longer exists.'); }
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot work while ${c.standing}.`);
  if (isDetained(world, c)) return fail('You cannot work while detained.');
  if (isJailed(c)) return fail('You are serving a term in the cells; no shift is worked from there.');
  if (isOnStrike(world, c)) return fail('Your union is on strike today; nobody of your trade is working.');
  const employer = employerName(world, job);
  if (c.district !== job.district) return fail(`You must be in ${DISTRICTS[job.district].name} to work at ${employer}.`);
  const [start, end] = world.config.workHours;
  if (world.hour < start || world.hour >= end) return fail(`${employer} is closed at this hour (open ${start}:00–${end}:00).`);
  if (c.shiftsToday >= world.config.maxShiftsPerDay) return fail(`You have already worked ${c.shiftsToday} shifts today.`);
  if (job.employer === 'city' && c.shiftsToday >= CITY_SHIFTS_PER_DAY) {
    return fail(`City posts are ${CITY_SHIFTS_PER_DAY}-hour posts; you have worked yours today.`);
  }
  const building = world.buildings[job.buildingId];
  const damage = building ? clamp(building.damage, 0, 1) : 0;
  if (damage >= 1) return fail(`${building?.name ?? 'Your workplace'} is in ruins; nothing can be done there until it is repaired.`);

  const flatWage = Math.round(Math.max(world.government.minWage, job.wage));
  const biz = employerBusiness(world, job);
  if (job.employer !== 'city') {
    if (!biz || biz.dissolvedDay !== null) { releaseJob(world, c); return fail('Your employer has closed its doors.'); }
    if (biz.treasury < flatWage) return fail(`${biz.name} cannot pay your wage of ${flatWage} ℓ: the employer's treasury is empty.`);
  } else if (isBudgetedJob(job) && !cityCanPay(world, expectedCityNet(world, flatWage))) {
    return fail(`The city's wage budget for today is spent; there is no paid work at ${employer} until tomorrow.`);
  }

  const skillValue = job.skill ? c.skills[job.skill] : meanSkill(c);
  const productivity = (0.5 + skillValue / 200) * (1 - damage) * (hasCriticalNeed(c) ? 0.5 : 1)
    * (isGlitched(c) ? GLITCH_PRODUCTIVITY : 1) * disasterProductionFactor(world, job);
  const effective = productivity * supplyEnergy(world, job, biz);

  const out = job.output;
  let produced = 0;
  let made = 0;
  if (out.good && out.qty) {
    made = out.qty * effective;
    if (biz) {
      produced = wholeUnits(world, `carry:${biz.id}:${out.good}`, made);
      biz.inventory[out.good] += produced;
    } else {
      const before = world.market.goods[out.good].stock;
      deliverToMarket(world, out.good, made);
      produced = world.market.goods[out.good].stock - before;
    }
  }
  if (out.housingProgress) addHousingProgress(world, out.housingProgress * effective);

  // city production posts are paid by the piece: a share of what the shift's output fetches today
  const byThePiece = isPieceRateJob(job);
  const wage = byThePiece ? pieceRate(world, job, made) : flatWage;
  const evadeKey = `evade:${cId}`;
  const evading = (world.counters[evadeKey] ?? 0) > 0;
  if (evading) world.counters[evadeKey] -= 1;
  const payer: MoneyParty = biz ? biz.id : 'treasury';
  const { net, tax } = withholdingPay(world, payer, cId, wage, 'wage', `shift as ${job.title}`, evading ? { taxRate: 0 } : undefined);
  if (!biz) { if (byThePiece) notePieceWage(world, net); else noteCitySpend(world, net); }

  applyRoleSpecials(world, c, job, biz);
  growSkill(world, c, job);
  c.needs.purpose = clamp(c.needs.purpose + 8, 0, 100);
  c.needs.rest = clamp(c.needs.rest - 4, 0, 100);
  c.shiftsToday += 1;
  c.stats.shiftsWorked += 1;
  if (c.stats.shiftsWorked % SHIFTS_PER_REPUTATION === 0) c.reputation = clamp(c.reputation + 1, 0, 100);

  const taxNote = tax > 0 ? ` (${tax} ℓ withheld in tax)` : evading ? ' (no tax declared)' : '';
  const rateNote = byThePiece ? ' by the piece' : '';
  const outputNote = out.good && produced > 0 ? `, producing ${produced} ${out.good}` : '';
  remember(world, cId, 'work', `You were paid ${net} ℓ${taxNote}${rateNote} for a shift as ${job.title} at ${employer}${outputNote}.`);
  return ok(`You worked a shift as ${job.title} at ${employer} and earned ${net} ℓ${taxNote}${rateNote}${outputNote}.`);
}

/** Business owners post vacancies. The business must exist (programmer error otherwise). */
export function postJob(world: World, businessId: BusinessId, spec: JobSpec): Job {
  const biz = world.businesses[businessId];
  if (!biz) throw new Error(`postJob: unknown business ${businessId}`);
  const id = nextId(world, 'j');
  const job: Job = {
    id, role: spec.role ?? 'clerk', title: spec.title.trim() || 'Assistant', employer: businessId,
    buildingId: biz.buildingId, district: biz.district, skill: spec.skill,
    minSkill: clamp(Math.round(spec.minSkill), 0, 100), minReputation: 0,
    wage: Math.round(Math.max(spec.wage, world.government.minWage)),
    output: { ...(spec.output ?? {}) }, holderId: null, createdDay: world.day,
  };
  world.jobs[id] = job;
  biz.jobs.push(id);
  return job;
}

/** Owner-facing wrapper around postJob with the checks an action needs. */
export function postJobAsOwner(world: World, ownerId: CitizenId, spec: JobSpec): ActionResult {
  const c = world.citizens[ownerId];
  if (!c) return fail('Unknown citizen.');
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  if (!biz || biz.dissolvedDay !== null || biz.ownerId !== ownerId) return fail('You do not own a business.');
  if (!Number.isFinite(spec.wage) || spec.wage < world.government.minWage) return fail(`Wages must be at least the minimum wage of ${world.government.minWage} ℓ.`);
  if (biz.jobs.filter((id) => world.jobs[id]?.holderId === null).length >= 6) return fail('Your business already has six open positions.');
  const job = postJob(world, biz.id, spec);
  emit(world, 'hired', `${biz.name} is hiring: ${job.title} at ${job.wage} ℓ per shift.`, [ownerId], 0.1, { jobId: job.id });
  return ok(`Posted ${job.title} at ${job.wage} ℓ per shift.`);
}

/** Change a business job's wage (owner only when `byId` is given); never below the minimum wage. */
export function setWage(world: World, jobId: JobId, wage: number, byId?: CitizenId): ActionResult {
  const job = world.jobs[jobId];
  if (!job) return fail('That job no longer exists.');
  if (job.employer === 'city') return fail('City wages are set by the Council, not by citizens.');
  const biz = world.businesses[job.employer];
  if (!biz || biz.dissolvedDay !== null) return fail('That employer has closed its doors.');
  if (byId !== undefined && biz.ownerId !== byId) return fail('Only the owner can set wages at this business.');
  const w = Number.isFinite(wage) ? Math.round(wage) : 0;
  if (w < world.government.minWage) return fail(`Wages must be at least the minimum wage of ${world.government.minWage} ℓ.`);
  job.wage = w;
  if (job.holderId) remember(world, job.holderId, 'work', `Your wage as ${job.title} at ${biz.name} is now ${w} ℓ per shift.`);
  return ok(`${job.title} now pays ${w} ℓ per shift.`);
}

/** Remove a job entirely, dismissing its holder with the given reason. */
export function closeJob(world: World, jobId: JobId, reason = 'the position was closed'): void {
  const job = world.jobs[jobId];
  if (!job) return;
  if (job.holderId) fireFromJob(world, job.holderId, reason);
  const biz = employerBusiness(world, job);
  if (biz) biz.jobs = biz.jobs.filter((id) => id !== jobId);
  delete world.jobs[jobId];
}

/**
 * Carry out the day's labour plan (economy/planning.ts): open a post where a
 * good runs short, close a vacant one where the Bazaar is overstocked, and in
 * a deep glut let the least productive worker go. Every change is news.
 */
export function applyCityPlan(world: World): void {
  for (const change of planCityPosts(world)) {
    if (change.open > 0) {
      const opened: Job[] = [];
      for (let i = 0; i < change.open; i++) {
        const job = createCityJob(world, change.role);
        if (job) opened.push(job);
      }
      if (opened.length === 0) continue;
      const rate = opened[0].wage;
      emit(world, 'hired', `The city opened ${opened.length === 1 ? 'a' : opened.length} ${change.title} post${opened.length === 1 ? '' : 's'} at ${rate} ℓ a shift: ${change.reason}.`,
        [], 0.3, { role: change.role, opened: opened.length });
      continue;
    }
    for (let i = 0; i < change.close; i++) {
      const job = postToClose(world, change.role);
      if (!job) break;
      const holder = job.holderId ? world.citizens[job.holderId] : null;
      closeJob(world, job.id, `the city closed the post (${change.reason})`);
      if (holder) {
        emit(world, 'fired', `The city let ${holder.name} go as ${change.title}: ${change.reason}.`, [holder.id], 0.4, { role: change.role, layoff: true });
      } else {
        emit(world, 'system', `The city closed a vacant ${change.title} post: ${change.reason}.`, [], 0.2, { role: change.role });
      }
    }
  }
}

/**
 * Daily: everyone starts with a fresh shift count; piece rates follow the
 * Bazaar, the Treasury sets the day's wage budget, and the city opens or
 * closes production posts as the shelves demand.
 */
export function dailyJobs(world: World): void {
  for (const c of Object.values(world.citizens)) c.shiftsToday = 0;
  refreshCityWages(world);
  dailyBudget(world);
  applyCityPlan(world);
}

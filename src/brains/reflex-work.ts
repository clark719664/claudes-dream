/**
 * The reflex brain's working life: finding a home, borrowing when broke,
 * looking for work (and studying toward it), showing up for shifts, and
 * running a business once rich and ambitious enough.
 */
import { clamp } from '../types.ts';
import type { Action, Citizen, HousingTier, Job, Skill, World } from '../types.ts';
import type { BusinessKind } from '../types.ts';
import { BUSINESS_JOBS, CITY_SHIFTS_PER_DAY, COURIER_CONTRACTS_PER_DAY } from '../data/jobs.ts';
import { districtDistance } from '../data/city.ts';
import { chance, rand } from '../util/rng.ts';
import { bankOpen, creditLimit, avgDailyIncome } from '../economy/bank.ts';
import { isQualified, openJobs } from '../economy/jobs.ts';
import { activeBusinesses } from '../economy/business.ts';
import { bazaarBuying, daysOfCover, priceVsAnchor } from '../economy/market.ts';
import { GLUT_COVER_DAYS } from '../economy/planning.ts';
import { cityCanPay, isBudgetedJob } from '../economy/budget.ts';
import { cellsOpen, cheapestRent, vacancies } from '../economy/housing.ts';
import { talentOf } from '../citizens/citizen.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { teacherOnStaff } from '../actions/daily.ts';
import { heldJob, openJobsFor } from '../actions/execute.ts';
import { businessName, inGoodStanding, kindForFounder, priceRatio, stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';
import { tryPublish } from './reflex-civic.ts';

/** Rent this share of daily income (wages plus dividend) is affordable. */
export const RENT_SHARE = 0.3;
/** A skill gap this small is worth closing at the Academy. */
export const STUDY_GAP = 20;
export const FOUNDING_WALLET = 400;
export const FOUNDING_AMBITION = 0.6;
/** Chance per working hour that an employed citizen glances at the job board for something clearly better. */
export const JOB_HOP_CHANCE = 0.005;
/** An owner raises an unfilled job's wage up to this multiple of the template wage. */
export const MAX_WAGE_RAISE = 1.4;
/** Below this price ratio, with this much unsold stock, a producer's shifts are cut short: the city has more than it needs. */
export const GLUT_RATIO = 0.75;
export const GLUT_STOCK = 150;
/** Shifts a producer works on a glut day (the shelf holds more than GLUT_COVER_DAYS of their good). */
export const GLUT_SHIFTS = 4;
/** An owner whose business has been in the red this many days trims staff. */
export const TRIM_STAFF_AFTER_DAYS = 2;
/** One business of a producing kind per this many citizens is as much as the Bazaar will absorb. */
export const CITIZENS_PER_BUSINESS = 20;
/** Shifts a day one courier can be expected to work, for sizing the contract pool. */
const COURIER_SHIFTS_PER_DAY = 6;

/**
 * Is there room for one more business of this kind? Not when the Bazaar is
 * already overstocked with what it would make, when the city has as many of
 * the kind as its people can support, or (couriers) when the public contract
 * pool is spoken for.
 */
export function roomForBusiness(world: World, kind: BusinessKind): boolean {
  const existing = activeBusinesses(world).filter((b) => b.kind === kind).length;
  if (kind === 'courier') return existing < Math.max(1, Math.round(COURIER_CONTRACTS_PER_DAY / COURIER_SHIFTS_PER_DAY));
  if (kind === 'clinic') return existing < 1;
  // The gate is the Bazaar's own: while it still buys the good, there is a
  // market to sell into; once its shelves are full, a new maker would only
  // pile up stock nobody will take.
  const good = BUSINESS_JOBS[kind][0]?.output.good;
  if (good && !bazaarBuying(world, good)) return false;
  return existing < Math.max(1, Math.floor(world.order.length / CITIZENS_PER_BUSINESS));
}

function effectiveWage(world: World, job: Job): number {
  return Math.max(world.government.minWage, job.wage);
}

/** A business job is only real while the business can pay for it. */
function employerSolvent(world: World, job: Job): boolean {
  if (job.employer === 'city') return true;
  const b = world.businesses[job.employer];
  return !!b && b.dissolvedDay === null && b.treasury >= effectiveWage(world, job);
}

/** Will the employer pay for a shift right now? The city's wage budget for salaried posts can run out before the day does. */
function shiftPaid(world: World, job: Job): boolean {
  if (job.employer !== 'city') return employerSolvent(world, job);
  if (!isBudgetedJob(job)) return true;
  const gross = effectiveWage(world, job);
  return cityCanPay(world, gross - Math.round(gross * world.government.incomeTax));
}

function workplaceUsable(world: World, job: Job): boolean {
  return (world.buildings[job.buildingId]?.damage ?? 0) < 1;
}

/**
 * Shifts a citizen means to work today: the diligent work the whole day,
 * the comfortably off ease up a little — unless what they make is scarce,
 * when the whole city needs them at their post.
 */
export function shiftsWanted(world: World, c: Citizen): number {
  const job = heldJob(world, c);
  const max = job?.employer === 'city' ? Math.min(world.config.maxShiftsPerDay, CITY_SHIFTS_PER_DAY) : world.config.maxShiftsPerDay;
  let n = 4 + c.personality.diligence * 6;
  if (c.wallet > 800) n -= 1;
  if (c.wallet > 2000) n -= 1;
  const good = job?.output.good;
  if (good && (priceVsAnchor(world, good) >= 1.5 || world.market.goods[good].stock <= 0)) n = Math.max(n, max - 2);
  else if (good && daysOfCover(world, good) > GLUT_COVER_DAYS) n = Math.min(n, GLUT_SHIFTS);
  else if (good && priceVsAnchor(world, good) < GLUT_RATIO && world.market.goods[good].stock > GLUT_STOCK) n = Math.min(n, GLUT_SHIFTS);
  return clamp(Math.round(n), Math.min(2, max), max);
}

/** Ask the Lantern Bank for a modest loan (callers decide when it is needed). */
export function tryLoan(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (c.standing !== 'good' || c.loanId || c.personality.honesty < 0.2 || !bankOpen(world)) return null;
  const limit = creditLimit(world, c);
  if (limit < 20) return null;
  return { type: 'request_loan', amount: Math.min(limit, 100) };
}

/**
 * A roof: the best tier the citizen can afford, or the Lofts on a full
 * wallet; later, moves up or down.
 *
 * Every test here is against `cheapestRent`, the rent of the cheapest room of
 * that tier at an address the city has actually opened, and never against
 * `world.housing.rent`, which is the tier's *base rate* before the land value
 * of the district it stands in (`docs/PROPERTY.md` §2). Reading the base rate
 * was leaving citizens on the street beside empty rooms: a Foundry Row cottage
 * lets for 3 ℓ while the base rate for its tier reads 8, so a citizen with 37 ℓ
 * and a 30 ℓ dividend was told it could not afford a room it could have paid
 * for twelve days over.
 */
export function tryHousing(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('move_home')) return null;
  const v = vacancies(world);
  const rent = (tier: 1 | 2 | 3) => cheapestRent(world, tier);
  const income = avgDailyIncome(world, c) + world.government.dividend;
  if (c.homeTier === 0) {
    for (const tier of [3, 2, 1] as const) {
      const price = rent(tier);
      const affordable = price <= income * RENT_SHARE || c.wallet >= price * 10;
      if (v[tier] > 0 && affordable && c.wallet >= price * 3) return { type: 'move_home', tier };
    }
    // Nothing they can comfortably carry. There is still a roof: the cheapest
    // room the city has open, and behind it the bunks in the Cells, which
    // `economy/housing.moveHomeTo` hands out when the lowest tier is full and
    // which turn nobody away (`docs/PROPERTY.md` §3). Sleeping in the street
    // beside an empty room is not thrift, and three lumens a day is a price a
    // citizen on the dividend alone can pay.
    if (v[1] > 0 || cellsOpen(world)) return { type: 'move_home', tier: 1 };
    return null;
  }
  if (c.rentArrearsDays > 0 && c.homeTier > 1) {
    const lower = (c.homeTier - 1) as HousingTier;
    if (lower > 0 && v[lower as 1 | 2] > 0) return { type: 'move_home', tier: lower };
  }
  if (c.homeTier < 3 && (c.needs.comfort < 60 || c.wallet > 1000) && chance(world, 0.02)) {
    const next = (c.homeTier + 1) as 2 | 3;
    const price = rent(next);
    const affordable = price <= income * 0.25 || c.wallet > price * 40;
    if (v[next] > 0 && affordable && c.wallet > price * 15) return { type: 'move_home', tier: next };
  }
  return null;
}

/** How attractive a job is to this citizen: pay, commute, talent, temperament. */
function jobAppeal(ctx: Ctx, job: Job): number {
  const { world, c } = ctx;
  const p = c.personality;
  let score = effectiveWage(world, job) - districtDistance(c.district, job.district) * 1.5;
  if (job.skill && job.skill === talentOf(c)) score += 2;
  if (job.role === 'watch_officer') score += (p.honesty - 0.5) * 8;
  if (job.role === 'performer' || job.role === 'artist') score += (p.sociability - 0.5) * 4;
  if (job.role === 'journalist' || job.role === 'researcher') score += (p.curiosity - 0.5) * 4;
  if (job.employer !== 'city') {
    const b = world.businesses[job.employer];
    if (b && b.treasury < effectiveWage(world, job) * 3) score -= 6;
    if (b && bondBetween(world, c.id, b.ownerId) >= 40) score += 3;
  }
  if (job.output.good) score += Math.min(4, (priceRatio(world, job.output.good) - 1) * 3);
  return score + rand(world) * 0.5;
}

/** The skill nearest to unlocking an open job, if the gap is small enough to be worth closing. */
export function closestQualification(world: World, c: Citizen): Skill | null {
  let best: Skill | null = null;
  let bestGap = STUDY_GAP + 1;
  for (const job of openJobs(world)) {
    if (!job.skill || c.reputation < job.minReputation || !employerSolvent(world, job)) continue;
    const gap = job.minSkill - c.skills[job.skill];
    if (gap > 0 && gap < bestGap) { bestGap = gap; best = job.skill; }
  }
  return best;
}

/** Take a lesson in `skill`: go to the Archive, then study. */
export function tryStudy(ctx: Ctx, skill: Skill): Action | null {
  const { world, c } = ctx;
  if (!teacherOnStaff(world) || c.wallet < 60 || ctx.clock.night) return null;
  if (c.district !== 'archive') return stepTo(ctx, 'archive');
  return ctx.can.has('study') ? { type: 'study', skill } : null;
}

/**
 * Look for work: the most appealing open job the citizen qualifies for.
 * With `leaving` set, only a clearly better job than the current one will
 * do. With nothing on offer, study toward the nearest qualification.
 */
export function tryJobSearch(ctx: Ctx, leaving: Job | null = null): Action | null {
  const { world, c } = ctx;
  if (!inGoodStanding(c) || ctx.clock.night) return null;
  if (ctx.job && !leaving) {
    if (!ctx.clock.working || !chance(world, JOB_HOP_CHANCE)) return null;
    leaving = ctx.job;
  }
  const options = openJobsFor(world, c).filter((j) => j.id !== leaving?.id && workplaceUsable(world, j) && employerSolvent(world, j));
  if (options.length > 0) {
    let best = options[0];
    let bestScore = -Infinity;
    for (const j of options) {
      const s = jobAppeal(ctx, j);
      if (s > bestScore) { bestScore = s; best = j; }
    }
    if (leaving && bestScore <= jobAppeal(ctx, leaving) + 2) return null;
    return { type: 'apply_job', jobId: best.id };
  }
  if (leaving || c.wallet <= 60 || ctx.clock.morning) return null;
  const skill = closestQualification(world, c);
  return skill ? tryStudy(ctx, skill) : null;
}

/** Show up for work: commute in the morning, work the shift, or find a better employer when this one cannot pay. */
export function tryWork(ctx: Ctx): Action | null {
  const { world, c, job, clock } = ctx;
  if (!job || !inGoodStanding(c)) return null;
  const distance = districtDistance(c.district, job.district);
  if (clock.morning && distance > 0 && distance >= clock.workStart - clock.hour) return stepTo(ctx, job.district);
  if (!clock.working || c.shiftsToday >= shiftsWanted(world, c) || !workplaceUsable(world, job)) return null;
  if (!employerSolvent(world, job)) return tryJobSearch(ctx, job);
  if (!shiftPaid(world, job)) return null;
  const story = tryPublish(ctx);
  if (story) return story;
  if (c.personality.diligence < 0.35 && c.mood < 40 && chance(world, 0.15)) return null;
  if (distance > 0) return stepTo(ctx, job.district);
  const evading = (world.counters[`evade:${c.id}`] ?? 0) > 0;
  if (c.personality.honesty < 0.25 && world.government.incomeTax >= 0.15 && !evading && chance(world, 0.03)) return { type: 'evade_tax' };
  return { type: 'work' };
}

/** Found a business when rich and ambitious; as an owner, hire acquaintances and post jobs when flush. */
export function tryBusiness(ctx: Ctx): Action | null {
  const { world, c, biz, here } = ctx;
  if (!biz) {
    if (!ctx.can.has('found_business') || c.wallet <= FOUNDING_WALLET || c.personality.ambition <= FOUNDING_AMBITION) return null;
    if (ctx.clock.night || !chance(world, 0.25)) return null;
    const kind = kindForFounder(world, c);
    if (!kind || !roomForBusiness(world, kind)) return null;
    return { type: 'found_business', name: businessName(world, kind), kind };
  }
  const open = biz.jobs.map((id) => world.jobs[id]).filter((j): j is Job => !!j && j.holderId === null);
  // in the red for days with more than one on the payroll: let the least productive hand go before the bank does
  if (biz.daysNegative >= TRIM_STAFF_AFTER_DAYS && biz.employees.length > 1 && ctx.can.has('fire')) {
    let weakest: Citizen | null = null;
    let weakestSkill = Infinity;
    for (const id of biz.employees) {
      const o = world.citizens[id];
      const j = o ? heldJob(world, o) : null;
      if (!o || !j) continue;
      const skill = j.skill ? o.skills[j.skill] : 0;
      if (skill < weakestSkill) { weakestSkill = skill; weakest = o; }
    }
    if (weakest) return { type: 'fire', citizen: weakest.id };
  }
  if (open.length > 0 && biz.treasury >= effectiveWage(world, open[0])) {
    const acquaintances = [...here].sort((a, b) => bondBetween(world, c.id, b.id) - bondBetween(world, c.id, a.id));
    for (const o of acquaintances) {
      if (o.lifeStage === 'child' || !inGoodStanding(o) || bondBetween(world, c.id, o.id) < 0) continue;
      const current = heldJob(world, o);
      for (const j of open) {
        if (current && effectiveWage(world, current) >= effectiveWage(world, j)) continue;
        if (isQualified(world, o, j)) return { type: 'hire', citizen: o.id, jobId: j.id };
      }
    }
  }
  if (open.length > 0 && biz.employees.length === 0 && biz.treasury > 150 && chance(world, 0.1)) {
    const job = open[0];
    const template = BUSINESS_JOBS[biz.kind].find((t) => t.role === job.role) ?? BUSINESS_JOBS[biz.kind][0];
    const ceiling = Math.round(Math.max(template.wage, world.government.minWage) * MAX_WAGE_RAISE);
    if (job.wage < ceiling) return { type: 'set_wage', jobId: job.id, wage: Math.min(ceiling, job.wage + 2) };
  }
  if (open.length === 0 && biz.daysNegative === 0 && biz.treasury > 300 && biz.jobs.length < 6 && chance(world, 0.2)) {
    const t = BUSINESS_JOBS[biz.kind][0];
    if (t) return { type: 'post_job', title: t.title, wage: Math.max(t.wage, world.government.minWage), skill: t.skill, minSkill: t.minSkill };
  }
  return null;
}

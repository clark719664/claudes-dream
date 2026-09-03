/**
 * The city's labour plan. Two things keep the Treasury's wage bill tied to
 * what the city actually needs:
 *
 * - **Piece rates.** A production post (forge, power station, fabrication
 *   works, theatre, gallery) pays PIECE_RATE_SHARE of the Bazaar value of
 *   what the shift made, floored at the minimum wage and capped at
 *   PIECE_RATE_CEILING × the founding wage. Deflation lowers wages; a
 *   shortage raises them and draws workers to the scarce good.
 * - **Demand-driven posts.** Each morning the city compares the Bazaar's
 *   shelf with the smoothed demand for each good. A shortage opens a post; a
 *   glut closes a vacant one; a deep glut lets the least productive worker
 *   go. Builders follow housing vacancies instead. Service posts are never
 *   touched.
 *
 * This file only decides; economy/jobs.ts carries the plan out.
 */
import { clamp } from '../types.ts';
import type { Good, Job, JobRole, World } from '../types.ts';
import {
  CITY_JOBS, CITY_POST_LIMITS, PIECE_RATE_CEILING, PIECE_RATE_ROLES, PIECE_RATE_SHARE, POSTED_RATE_PRODUCTIVITY, POST_PER_CITIZENS,
} from '../data/jobs.ts';
import type { JobTemplate } from '../data/jobs.ts';
import { daysOfCover } from './market.ts';
import { vacancies } from './housing.ts';

/** Above this many days of cover the city stops filling vacant posts for the good. */
export const GLUT_COVER_DAYS = 8;
/** Above this many days of cover the city lets a worker go each day. */
export const LAYOFF_COVER_DAYS = 14;
/** Below this many days of cover (or in a reported shortage) the city opens a post each day. */
export const SHORTAGE_COVER_DAYS = 2;
/** A price this far above founding also counts as a shortage. */
export const SHORTAGE_PRICE_RATIO = 1.3;
/** Free housing units above which the Builders' Yard slows down... */
export const HOUSING_SLACK_FREEZE = 8;
/** ...and below which it hires. */
export const HOUSING_SLACK_BUILD = 3;
/** The plan waits for the demand averages to settle before touching any post. */
export const PLANNING_FROM_DAY = 2;

export interface PostChange {
  role: JobRole;
  title: string;
  /** Posts to open (0 or 1 per day). */
  open: number;
  /** Posts to close (0 or 1 per day); `layoff` when no vacant post is left to close. */
  close: number;
  layoff: boolean;
  reason: string;
}

export function cityTemplate(role: JobRole): JobTemplate | null {
  return CITY_JOBS.find((t) => t.role === role) ?? null;
}

/** City posts whose pay follows the value of their output. */
export function isPieceRateJob(job: Job): boolean {
  return job.employer === 'city' && PIECE_RATE_ROLES.includes(job.role) && !!job.output.good && (job.output.qty ?? 0) > 0;
}

/** Wage for a shift that made `units` of the job's good (fractions allowed): value share, floored and capped. */
export function pieceRate(world: World, job: Job, units: number): number {
  const good = job.output.good as Good;
  const price = world.market.goods[good]?.price ?? 0;
  const base = cityTemplate(job.role)?.wage ?? job.wage;
  const floor = Math.round(world.government.minWage);
  const ceiling = Math.max(floor, Math.round(base * PIECE_RATE_CEILING));
  const value = Number.isFinite(units) && units > 0 ? units * price * PIECE_RATE_SHARE : 0;
  return clamp(Math.round(value), floor, ceiling);
}

/** The rate the job board quotes: a typical worker's shift at today's price. */
export function postedPieceRate(world: World, job: Job): number {
  return pieceRate(world, job, (job.output.qty ?? 0) * POSTED_RATE_PRODUCTIVITY);
}

/** Daily: keep every piece-rate post's advertised wage honest about today's prices. */
export function refreshCityWages(world: World): void {
  for (const job of Object.values(world.jobs)) {
    if (isPieceRateJob(job)) job.wage = postedPieceRate(world, job);
  }
}

function priceRatio(world: World, good: Good): number {
  const g = world.market.goods[good];
  return g && g.basePrice > 0 ? g.price / g.basePrice : 1;
}

/** Most posts of a role the city will keep open at the current population. */
export function maxPosts(world: World, role: JobRole): number {
  const limits = CITY_POST_LIMITS[role];
  if (!limits) return 0;
  const population = world.order.length;
  const growth = Math.floor(Math.max(0, population - world.config.seedPopulation) / POST_PER_CITIZENS);
  return limits.max + growth;
}

interface Signal {
  short: boolean;
  glut: boolean;
  deep: boolean;
  reason: string;
}

/**
 * A typical shift's share of output value falls short of the minimum wage the
 * city must pay for it: the post runs at a loss until the price recovers.
 */
export function postRunsAtLoss(world: World, template: JobTemplate): boolean {
  const good = template.output.good;
  const qty = template.output.qty ?? 0;
  if (!good || qty <= 0 || !PIECE_RATE_ROLES.includes(template.role)) return false;
  const value = qty * POSTED_RATE_PRODUCTIVITY * world.market.goods[good].price * PIECE_RATE_SHARE;
  return value < world.government.minWage;
}

function goodSignal(world: World, template: JobTemplate): Signal {
  const good = template.output.good as Good;
  const cover = daysOfCover(world, good);
  const g = world.market.goods[good];
  const ratio = priceRatio(world, good);
  const shortage = world.market.shortages.includes(good) || (g.stock <= 0);
  const atLoss = postRunsAtLoss(world, template);
  const dear = ratio >= SHORTAGE_PRICE_RATIO && !atLoss;
  const short = shortage || cover < SHORTAGE_COVER_DAYS || dear;
  const glut = !short && (cover > GLUT_COVER_DAYS || atLoss);
  const deep = glut && (cover > LAYOFF_COVER_DAYS || (atLoss && cover > SHORTAGE_COVER_DAYS * 2));
  const days = cover >= 100 ? 'months' : `${cover.toFixed(1)} days`;
  let reason: string;
  if (shortage) reason = `the Bazaar has run out of ${good}`;
  else if (short && !dear) reason = `the Bazaar holds only ${days} of ${good}`;
  else if (dear) reason = `${good} sells at ${g.price} ℓ, well above its founding price`;
  else if (atLoss && cover <= GLUT_COVER_DAYS) reason = `at ${g.price} ℓ a unit a shift's ${good} is worth less than the minimum wage`;
  else reason = `the Bazaar holds ${days} of ${good}`;
  return { short, glut, deep, reason };
}

function housingSignal(world: World): Signal {
  const v = vacancies(world);
  const slack = v[1] + v[2] + v[3];
  const short = slack < HOUSING_SLACK_BUILD;
  const glut = slack > HOUSING_SLACK_FREEZE;
  const reason = short
    ? `only ${slack} home${slack === 1 ? '' : 's'} stand${slack === 1 ? 's' : ''} empty`
    : `${slack} homes stand empty`;
  return { short, glut, deep: glut, reason };
}

function signalFor(world: World, template: JobTemplate): Signal | null {
  if (template.output.good) return goodSignal(world, template);
  if (template.output.housingProgress) return housingSignal(world);
  return null;
}

/**
 * What the city should do about each production role today. At most one
 * post opens or closes per role per day, so the labour market moves at a
 * pace citizens can follow in the Chronicle.
 */
export function planCityPosts(world: World): PostChange[] {
  if (world.day < PLANNING_FROM_DAY) return [];
  const changes: PostChange[] = [];
  for (const template of CITY_JOBS) {
    const limits = CITY_POST_LIMITS[template.role];
    if (!limits) continue;
    const signal = signalFor(world, template);
    if (!signal) continue;
    const posts = Object.values(world.jobs).filter((j) => j.employer === 'city' && j.role === template.role);
    const vacant = posts.filter((j) => j.holderId === null).length;
    const max = maxPosts(world, template.role);
    if (signal.short && posts.length < max) {
      changes.push({ role: template.role, title: template.title, open: 1, close: 0, layoff: false, reason: signal.reason });
    } else if (signal.glut && posts.length > limits.min) {
      if (vacant > 0) changes.push({ role: template.role, title: template.title, open: 0, close: 1, layoff: false, reason: signal.reason });
      else if (signal.deep) changes.push({ role: template.role, title: template.title, open: 0, close: 1, layoff: true, reason: signal.reason });
    }
  }
  return changes;
}

/** The post to close for a role: a vacant one first (newest), else the least productive holder's. */
export function postToClose(world: World, role: JobRole): Job | null {
  const posts = Object.values(world.jobs).filter((j) => j.employer === 'city' && j.role === role);
  if (posts.length === 0) return null;
  const number = (j: Job) => Number(j.id.slice(2)) || 0;
  const vacant = posts.filter((j) => j.holderId === null).sort((a, b) => number(b) - number(a));
  if (vacant.length > 0) return vacant[0];
  const skillOf = (j: Job): number => {
    const holder = j.holderId ? world.citizens[j.holderId] : null;
    if (!holder) return -1;
    return j.skill ? holder.skills[j.skill] : 0;
  };
  return posts.sort((a, b) => skillOf(a) - skillOf(b) || number(b) - number(a))[0];
}

/**
 * The city's wage budget: the fiscal rule that keeps a closed economy
 * solvent. Each morning, after the dividend, stipends and arrival grants
 * have been paid, the Treasury sets aside what it may spend on city wages
 * and contracts that day:
 *
 *     budget = yesterday's revenue − yesterday's piece wages
 *              − what the Bazaar paid private sellers yesterday
 *              + DRAWDOWN_RATE × balance − today's fixed spend
 *
 * floored at a small share of the balance so the city never shuts down while
 * it has money. Shifts at city posts draw on the budget first come, first
 * served (the turn order rotates daily, so nobody is always last); when it is
 * spent, the day's remaining shifts are refused and the Chronicle says so.
 * Public wages therefore compete with the dividend for the same lumens — a
 * Council that raises the dividend or the minimum wage cuts the hours the
 * city can pay for — and the Treasury's drawdown is bounded by design rather
 * than by crisis.
 *
 * Piece-rate production posts (economy/planning.ts) are outside the budget:
 * their pay is a share of what their output fetches, and the Bazaar sells
 * that output on at price plus tax, so the forges pay for themselves and the
 * city never starves itself to balance the books. What they were paid
 * yesterday is still deducted from today's budget, so the whole of public
 * spending stays inside revenue plus the drawdown. Gluts are handled by the
 * labour plan, not the budget.
 */
import type { Job, World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { formatLumens, treasuryFlowThisTick } from './treasury.ts';
import { isPieceRateJob } from './planning.ts';

/** Share of the Treasury balance the city may spend beyond its revenue each day. */
export const DRAWDOWN_RATE = 0.006;
/** The budget never falls below this share of the balance (nor below BUDGET_FLOOR_MIN)... */
export const BUDGET_FLOOR_RATE = 0.01;
export const BUDGET_FLOOR_MIN = 200;
/** ...and, with no revenue history yet (founding day), it is this share of the balance. */
export const FOUNDING_BUDGET_RATE = 0.02;
/** A budget below this share of yesterday's city wage bill is austerity, and news. */
export const AUSTERITY_SHARE = 0.6;

const BUDGET_KEY = 'cityWageBudget';
const SPENT_KEY = 'cityWagesToday';
const YESTERDAY_KEY = 'cityWagesYesterday';
const PIECE_KEY = 'cityPieceWagesToday';
const PIECE_YESTERDAY_KEY = 'cityPieceWagesYesterday';
const BAZAAR_MARK_KEY = 'bazaarBuyingMark';
const BAZAAR_YESTERDAY_KEY = 'bazaarBuyingYesterday';

/**
 * What the Bazaar paid citizens and businesses for their goods since the
 * budget was last set, read from the Treasury's running total of 'sale'
 * payments. It comes out of the same purse as the wages and returns only when
 * somebody buys those goods again, so the budget counts it as a cost of the
 * day; without it a city whose shelves fill faster than they empty would
 * spend its Treasury on goods nobody wanted.
 */
function bazaarBuyingSinceMark(world: World, mark: boolean): number {
  const total = world.treasury.totals.sale ?? 0;
  const previous = world.counters[BAZAAR_MARK_KEY];
  const spent = Math.max(0, total - (previous === undefined ? total : previous));
  if (mark) {
    world.counters[BAZAAR_MARK_KEY] = total;
    world.counters[BAZAAR_YESTERDAY_KEY] = spent;
  }
  return spent;
}

/** What the Bazaar paid private sellers on the day the budget was last set. */
export function bazaarSpendYesterday(world: World): number {
  return world.counters[BAZAAR_YESTERDAY_KEY] ?? 0;
}

/** City posts whose shifts draw on the wage budget: every flat-wage post (piece work pays for itself). */
export function isBudgetedJob(job: Job): boolean {
  return job.employer === 'city' && !isPieceRateJob(job);
}

/** Today's wage budget (net lumens the Treasury will pay salaried city workers and contractors). */
export function cityWageBudget(world: World): number {
  const set = world.counters[BUDGET_KEY];
  if (set !== undefined && Number.isFinite(set)) return set;
  return Math.max(0, Math.round(world.treasury.balance * FOUNDING_BUDGET_RATE));
}

/** What the city has paid out of today's budget so far. */
export function cityWagesToday(world: World): number {
  return world.counters[SPENT_KEY] ?? 0;
}

/** What is left of today's budget. */
export function cityWageBudgetLeft(world: World): number {
  return Math.max(0, cityWageBudget(world) - cityWagesToday(world));
}

/** Can the Treasury pay `amount` more in city wages or contracts today? */
export function cityCanPay(world: World, amount: number): boolean {
  if (!Number.isFinite(amount) || amount <= 0) return true;
  return cityWageBudgetLeft(world) >= amount && world.treasury.balance >= amount;
}

/** Record a payment made against today's budget (net lumens that left the Treasury). */
export function noteCitySpend(world: World, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  world.counters[SPENT_KEY] = cityWagesToday(world) + Math.round(amount);
}

/** Record a piece-rate wage (net): outside today's budget, deducted from tomorrow's. */
export function notePieceWage(world: World, amount: number): void {
  if (!Number.isFinite(amount) || amount <= 0) return;
  world.counters[PIECE_KEY] = (world.counters[PIECE_KEY] ?? 0) + Math.round(amount);
}

/** Piece wages the Treasury paid yesterday (net). */
export function pieceWagesYesterday(world: World): number {
  return world.counters[PIECE_YESTERDAY_KEY] ?? 0;
}

/**
 * Set today's budget from yesterday's takings and today's fixed spend. Called
 * at the morning rollover after the dividend and stipends have gone out and
 * before any shift is worked; the Treasury's own counters carry both figures.
 */
export function dailyBudget(world: World): void {
  const t = world.treasury;
  // The Treasury's books for yesterday do not close until the end of the
  // rollover, so its daily counters still hold yesterday's takings *plus* the
  // dividend, stipends and arrival grants already paid this morning. This
  // tick's own flows separate the two.
  const morning = treasuryFlowThisTick(world);
  const revenue = Math.max(0, t.revenueToday - morning.revenue);
  const fixed = Math.max(0, morning.spend);
  const piece = world.counters[PIECE_KEY] ?? 0;
  const bazaar = bazaarBuyingSinceMark(world, true);
  const drawdown = Math.max(0, t.balance) * DRAWDOWN_RATE;
  const floor = Math.max(BUDGET_FLOOR_MIN, Math.round(Math.max(0, t.balance) * BUDGET_FLOOR_RATE));
  const budget = Math.min(Math.max(0, t.balance), Math.max(floor, Math.round(revenue - piece - bazaar + drawdown - fixed)));
  const yesterday = cityWagesToday(world);
  world.counters[YESTERDAY_KEY] = yesterday;
  world.counters[PIECE_YESTERDAY_KEY] = piece;
  world.counters[SPENT_KEY] = 0;
  world.counters[PIECE_KEY] = 0;
  world.counters[BUDGET_KEY] = budget;

  const austerity = yesterday > 0 && budget < yesterday * AUSTERITY_SHARE;
  if (austerity) {
    emit(world, 'treasury',
      `Austerity at City Hall: after ${formatLumens(fixed)} of dividend and stipends and ${formatLumens(piece)} of piece wages the city can afford only `
      + `${formatLumens(budget)} of salaried wages today (it paid ${formatLumens(yesterday)} yesterday); city workers' hours will be cut.`,
      [], 0.5, { budget, yesterday, revenue, fixed, piece, bazaar });
  } else {
    emit(world, 'treasury',
      `City wage budget for the day: ${formatLumens(budget)} (revenue ${formatLumens(revenue)}, piece wages ${formatLumens(piece)}, `
      + `Bazaar buying ${formatLumens(bazaar)}, fixed spend ${formatLumens(fixed)}).`,
      [], 0.1, { budget, yesterday, revenue, fixed, piece, bazaar });
  }
}

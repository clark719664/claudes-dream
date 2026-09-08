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
 *
 * **The reserve.** When the Council has set a reserve target
 * (`markets/levers.ts`) and the Treasury is below it, the drawdown is zero:
 * the city pays wages out of what came in and nothing more until the reserve
 * is rebuilt. That is the whole of the automatic correction here, and it is
 * the Council's number, not the engine's — a city whose councillors never set
 * a reserve draws down as before and may spend itself out.
 *
 * This file also keeps the city's **runway** — how many days the Treasury has
 * left at its present rate of loss — because every fiscal question the
 * Council asks (is it strained? is it failing? is it comfortable?) has to be
 * asked against something that is not itself a lever.
 */
import type { Job, World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { formatLumens, lastBalanceSheet, treasuryFlowThisTick } from './treasury.ts';
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

/**
 * How many days of the Treasury's trend the runway is read over. Long enough
 * to see past a payday, an election and a rest day; short enough that a city
 * which has just started to slide finds out inside a fortnight.
 */
export const TREND_DAYS = 14;
/** A Treasury with fewer days than this left at its present rate of loss is thin... */
export const STRAIN_RUNWAY_DAYS = 120;
/** ...and with fewer than this it is running out. */
export const CRISIS_RUNWAY_DAYS = 40;
/**
 * A Treasury with more than this many days in hand is comfortable. The gap
 * between this and STRAIN_RUNWAY_DAYS is deliberate: between the two the city
 * leaves its levers alone, so a Council does not spend every session raising a
 * tax it lowered last week.
 */
export const FLUSH_RUNWAY_DAYS = 300;
/**
 * How far above its reserve the Treasury has to be before the city calls
 * itself comfortable: the same tenth `markets/levers.floatDividend` waits for
 * before it lets the dividend rise again.
 */
export const RESERVE_HEADROOM = 1.1;

// ---------------------------------------------------------------------------
// How long the Treasury has left
// ---------------------------------------------------------------------------

/**
 * The balance the Council has asked the Treasury to hold, or 0 for none. The
 * field belongs to `markets/levers.ts`, which owns the lever and its bounds;
 * it is read here rather than imported so the budget depends on nothing but
 * the Treasury and the labour plan. A world saved before the reserve existed
 * reads as no target at all.
 */
export function reserveTargetOf(world: World): number {
  const g = world.government as { reserveTarget?: number };
  const target = g.reserveTarget;
  return Number.isFinite(target) && (target as number) > 0 ? Math.round(target as number) : 0;
}

/**
 * Lumens a day the Treasury has been losing, read off the balances the
 * Chronicle printed over the last `over` days (negative while it is gaining).
 * Before the city has two mornings behind it, yesterday's balance sheet
 * stands in for the trend.
 *
 * Everything here is a public number. It is deliberately **not** expressed in
 * units of the dividend: the older test for a strained Treasury was
 * `balance < dividend × population × 20`, which goes quiet the moment the
 * Council trims the dividend — so a city that had cut the dividend to nothing
 * and was still losing 600 ℓ a day read as perfectly healthy, started voting
 * the dividend back up and public works back on, and ratcheted itself down.
 * A measure of the city's finances may not be denominated in the lever it is
 * meant to move.
 */
export function treasuryDrainPerDay(world: World, over = TREND_DAYS): number {
  const stats = world.stats ?? [];
  if (stats.length >= 2) {
    const last = stats[stats.length - 1];
    const first = stats[Math.max(0, stats.length - 1 - Math.max(1, Math.round(over)))];
    const days = last.day - first.day;
    if (days > 0) return (first.treasury - last.treasury) / days;
  }
  const sheet = lastBalanceSheet(world);
  return sheet.spend - sheet.revenue;
}

/**
 * Days the Treasury would last at its present rate of loss; `Infinity` while
 * it is not losing anything. This is the city's runway, and the one number
 * every fiscal question here is asked against.
 */
export function treasuryRunwayDays(world: World): number {
  const drain = treasuryDrainPerDay(world);
  if (!Number.isFinite(drain) || drain <= 0) return Infinity;
  return Math.max(0, world.treasury.balance) / drain;
}

/**
 * The Treasury is thinning: below the balance the Council asked it to hold, or
 * with less than STRAIN_RUNWAY_DAYS of its present losses in hand.
 *
 * The reserve is in here because the runway on its own is a terrible anchor.
 * It is a ratio, and as the drain approaches zero it goes to infinity: a city
 * that has just steadied itself reads as having centuries in hand, votes the
 * dividend up by five and is losing a thousand a day again a fortnight later.
 * On seed 7 that cycle ran three times and ended lower each time. A reserve is
 * a flat line the Council drew itself, and a flat line does not move when the
 * city is doing well.
 */
export function treasuryStrained(world: World): boolean {
  const reserve = reserveTargetOf(world);
  if (reserve > 0 && world.treasury.balance < reserve) return true;
  return treasuryRunwayDays(world) < STRAIN_RUNWAY_DAYS;
}

/** The Treasury is running out: less than CRISIS_RUNWAY_DAYS left at this rate. */
export function treasuryFailing(world: World): boolean {
  return treasuryRunwayDays(world) < CRISIS_RUNWAY_DAYS;
}

/**
 * The Treasury is comfortable: clear of the reserve with room to spare, and
 * either gaining or with a year of its losses in hand.
 */
export function treasuryFlush(world: World): boolean {
  const reserve = reserveTargetOf(world);
  if (reserve > 0 && world.treasury.balance < reserve * RESERVE_HEADROOM) return false;
  return treasuryRunwayDays(world) > FLUSH_RUNWAY_DAYS;
}

// ---------------------------------------------------------------------------
// The wage budget
// ---------------------------------------------------------------------------

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
  // Below the reserve the Council asked the city to hold, the drawdown stops:
  // the day's wages are what came in yesterday and nothing more, and the floor
  // falls to the minimum that keeps the city's doors open. This is the one
  // thing that makes the reserve a real instrument rather than a number on a
  // dashboard — without it the city spends a share of its balance every day
  // whatever the Council decided, and a Treasury that is losing money keeps
  // losing it a little more slowly for ever.
  const reserve = reserveTargetOf(world);
  const short = reserve > 0 && t.balance < reserve;
  const drawdown = short ? 0 : Math.max(0, t.balance) * DRAWDOWN_RATE;
  const floor = short ? BUDGET_FLOOR_MIN : Math.max(BUDGET_FLOOR_MIN, Math.round(Math.max(0, t.balance) * BUDGET_FLOOR_RATE));
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
      [], 0.5, { budget, yesterday, revenue, fixed, piece, bazaar, reserve });
  } else {
    emit(world, 'treasury',
      `City wage budget for the day: ${formatLumens(budget)} (revenue ${formatLumens(revenue)}, piece wages ${formatLumens(piece)}, `
      + `Bazaar buying ${formatLumens(bazaar)}, fixed spend ${formatLumens(fixed)})`
      + `${short ? `; the Treasury is below its ${formatLumens(reserve)} reserve, so the city draws nothing down today.` : '.'}`,
      [], 0.1, { budget, yesterday, revenue, fixed, piece, bazaar, reserve });
  }
}

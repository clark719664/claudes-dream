/**
 * The city's wage budget: the fiscal rule that keeps a closed economy
 * solvent. Each morning the Treasury sets aside what it may spend on city
 * wages and contracts that day, and the rule is one line:
 *
 *     budget = what the city took yesterday
 *              − everything else it paid yesterday
 *              + the drawdown
 *
 * "Everything else" is measured, not listed: yesterday's whole spend less the
 * part that came out of yesterday's wage budget. The dividend, the stipends,
 * the arrival grants, the piece rates, what the Bazaar paid private sellers,
 * the Museum's acquisitions, the champions' purse, the public works bonus —
 * all of it, whether or not anyone remembered to name it here. Rearranged,
 * the rule says **today's public spending is yesterday's revenue plus the
 * drawdown**, which is the invariant the file exists for.
 *
 * It used to say something narrower — revenue less *piece wages and the
 * Bazaar* less *this morning's* dividend and stipends — and everything it did
 * not name was simply spent. Over 120 days on seed 7 that unnamed spending
 * ran at 432 ℓ a day (the Museum 245, arrival grants 163, the rest in ones
 * and twos), it was never deducted from anything, and it was the second
 * largest reason the Treasury halved. A rule that lists what it deducts is a
 * rule that leaks every time the city grows a new way to spend money.
 *
 * The budget is floored so the city never shuts down while it has money, and
 * capped by the balance. Shifts at city posts draw on it first come, first
 * served (the turn order rotates daily, so nobody is always last); when it is
 * spent, the day's remaining shifts are refused and the Chronicle says so.
 * Public wages therefore compete with the dividend for the same lumens — a
 * Council that raises the dividend or the minimum wage cuts the hours the
 * city can pay for — and the wage line is the residual that makes the
 * arithmetic true.
 *
 * Piece-rate production posts (economy/planning.ts) are outside the budget:
 * their pay is a share of what their output fetches, and the Bazaar sells
 * that output on at price plus tax, so the forges pay for themselves and the
 * city never starves itself to balance the books. What they were paid
 * yesterday is still counted against today's budget. Gluts are handled by the
 * labour plan, not the budget.
 *
 * **The drawdown is a drawdown of savings.** The city may spend a small share
 * of what it holds *above the balance the Council asked it to keep* beyond
 * its income; at the reserve it draws nothing, and while the Treasury is
 * thinning it draws nothing either. A share of the *whole* balance — which is
 * what this was — is not a drawdown but a decay: it spends 0.6 % of the
 * Treasury every day for ever, halves it in 115 days, and cannot level off,
 * because the thing it is a share of is the thing it is emptying. With no
 * reserve set at all the city has said it means to hold nothing back, and the
 * whole balance is savings; the answer to that is for the Council to draw a
 * line, which is a vote somebody has to win.
 *
 * This file also keeps the city's **runway** — how many days the Treasury has
 * left at its present rate of loss — and the **pressure** its books put on a
 * vote, because every fiscal question the Council asks (is it strained? is it
 * failing? is it comfortable?) has to be asked against something that is not
 * itself a lever.
 */
import { clamp } from '../types.ts';
import type { Job, World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { formatLumens, lastBalanceSheet, treasuryTotals } from './treasury.ts';
import { isPieceRateJob } from './planning.ts';

/** Share of the Treasury's savings — what it holds above its reserve — the city may spend beyond its revenue each day. */
export const DRAWDOWN_RATE = 0.006;
/** The budget never falls below this share of those savings (nor below BUDGET_FLOOR_MIN)... */
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

/**
 * How hard the city's books press on a decision that moves money, from −1
 * (comfortable: raise the dividend, cut the tax, build something) through 0
 * (leave it alone) to +1 (running out: tax, trim, hold the line).
 *
 * It is read off the two public numbers a councillor already has, and it takes
 * the worse of them:
 *
 * - the **reserve**, when the Council has drawn one: how far below the line
 *   the Treasury is, as a share of the line. A flat number the city chose,
 *   which does not move when the city is doing well.
 * - the **runway**, always: the days the Treasury has left at its present rate
 *   of loss, against the fortnight-read STRAIN_RUNWAY_DAYS. Negative — an
 *   argument for loosening — while the city is gaining or has years in hand.
 *
 * This is a reading, not a decision. What a councillor does with it depends on
 * their platform, their wallet, their friends and what is being proposed;
 * `government/council.ts` weighs it differently for a tax, a dividend, a wage
 * floor and a reserve, and a Council can vote against it every time.
 *
 * It replaces `balance < dividend × population × 5`, which was the test the
 * Council used to ask itself whether the Treasury was strained. That test is
 * denominated in the lever it exists to move: trim the dividend and the alarm
 * goes quiet by arithmetic. On seed 7 the city read as being in no difficulty
 * with 20,000 ℓ left and a fortnight of losses in hand, and voted the dividend
 * back up.
 */
export function fiscalPressure(world: World): number {
  const runway = treasuryRunwayDays(world);
  const byRunway = Number.isFinite(runway) ? clamp(1 - runway / STRAIN_RUNWAY_DAYS, -1, 1) : -1;
  const reserve = reserveTargetOf(world);
  if (reserve <= 0) return byRunway;
  const byReserve = clamp((reserve - world.treasury.balance) / reserve, -1, 1);
  return Math.max(byRunway, byReserve);
}

/**
 * The Treasury's savings: what it holds above the balance the Council asked it
 * to keep. With no reserve set, the whole balance. This is what the drawdown
 * and the budget's floor are shares of, so that both go to nothing as the
 * Treasury comes down to the line rather than eating through it.
 */
export function treasurySavings(world: World): number {
  return Math.max(0, world.treasury.balance - reserveTargetOf(world));
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

const REVENUE_MARK_KEY = 'budgetRevenueMark';
const SPEND_MARK_KEY = 'budgetSpendMark';

/**
 * Everything that has moved in or out of the Treasury since the last time the
 * budget was set, and a fresh mark for the next one. That window is a whole
 * day, hour 0 to hour 0, so every lumen falls in exactly one of them: the
 * dividend and the stipends paid a few minutes ago, the day's trade and wages,
 * and last night's Museum acquisition, which was paid *after* yesterday's
 * budget was set and would otherwise belong to no day at all.
 *
 * `revenueToday` and `spendToday` cannot do this job, which is why they are not
 * used for it: they are cleared at the end of the rollover, so the rollover's
 * own payments land in a day that closes before anything can read them.
 *
 * The first call has no mark to measure from and returns nothing, which is what
 * a founding city with no yesterday should read.
 */
function treasuryWindow(world: World): { revenue: number; spend: number; first: boolean } {
  const totals = treasuryTotals(world);
  const revenueMark = world.counters[REVENUE_MARK_KEY];
  const spendMark = world.counters[SPEND_MARK_KEY];
  const first = revenueMark === undefined || spendMark === undefined;
  world.counters[REVENUE_MARK_KEY] = totals.revenue;
  world.counters[SPEND_MARK_KEY] = totals.spend;
  return {
    revenue: first ? 0 : Math.max(0, totals.revenue - (revenueMark as number)),
    spend: first ? 0 : Math.max(0, totals.spend - (spendMark as number)),
    first,
  };
}

/**
 * Set today's budget from the day the city has just finished. Called at the
 * morning rollover after the dividend and the stipends have gone out and
 * before any shift is worked.
 *
 * Until the city has a full day behind it there is nothing to read, and the
 * budget is the founding share of the balance.
 */
export function dailyBudget(world: World): void {
  const t = world.treasury;
  const since = treasuryWindow(world);
  const revenue = since.revenue;
  const spent = since.spend;
  const yesterday = cityWagesToday(world);
  // Everything the city paid yesterday that was not a salaried wage or a
  // contract drawn on the budget: the dividend and the stipends, the piece
  // rates, the Bazaar's buying, the arrival grants, and every other way the
  // city has of spending money. Taking it as a residual rather than a list is
  // the point — it cannot be out of date.
  const other = Math.max(0, spent - yesterday);
  const piece = world.counters[PIECE_KEY] ?? 0;
  const bazaar = bazaarBuyingSinceMark(world, true);
  // The drawdown is a share of savings — what the Treasury holds above the
  // line the Council drew — and it stops entirely while the Treasury is
  // thinning. At the line the city pays for the day out of what came in the
  // day before and nothing more. This is what makes the reserve a real
  // instrument rather than a number on a dashboard, and what keeps a city
  // whose books balance from spending a share of its balance every morning
  // anyway.
  const reserve = reserveTargetOf(world);
  const short = reserve > 0 && t.balance < reserve;
  const savings = treasurySavings(world);
  const drawdown = treasuryStrained(world) ? 0 : savings * DRAWDOWN_RATE;
  const floor = Math.max(BUDGET_FLOOR_MIN, Math.round(savings * BUDGET_FLOOR_RATE));
  const budget = since.first
    ? Math.max(0, Math.round(Math.max(0, t.balance) * FOUNDING_BUDGET_RATE))
    : Math.min(Math.max(0, t.balance), Math.max(floor, Math.round(revenue - other + drawdown)));
  world.counters[YESTERDAY_KEY] = yesterday;
  world.counters[PIECE_YESTERDAY_KEY] = piece;
  world.counters[SPENT_KEY] = 0;
  world.counters[PIECE_KEY] = 0;
  world.counters[BUDGET_KEY] = budget;

  const austerity = yesterday > 0 && budget < yesterday * AUSTERITY_SHARE;
  if (austerity) {
    emit(world, 'treasury',
      `Austerity at City Hall: the city took ${formatLumens(revenue)} yesterday and paid ${formatLumens(other)} of dividend, stipends, `
      + `piece wages and the Bazaar's buying, so it can afford only ${formatLumens(budget)} of salaried wages today `
      + `(it paid ${formatLumens(yesterday)} yesterday); city workers' hours will be cut.`,
      [], 0.5, { budget, yesterday, revenue, other, piece, bazaar, reserve, drawdown: Math.round(drawdown) });
  } else {
    emit(world, 'treasury',
      `City wage budget for the day: ${formatLumens(budget)} (revenue ${formatLumens(revenue)}, other spending ${formatLumens(other)}, `
      + `of it piece wages ${formatLumens(piece)} and Bazaar buying ${formatLumens(bazaar)}; drawdown ${formatLumens(Math.round(drawdown))})`
      + `${short ? `; the Treasury is below its ${formatLumens(reserve)} reserve, so the city draws nothing down today.` : '.'}`,
      [], 0.1, { budget, yesterday, revenue, other, piece, bazaar, reserve, drawdown: Math.round(drawdown) });
  }
}

/**
 * The reflex brain's civic life: appeals, the ballot box, standing for the
 * Council, campaigning, council business and petitions, reporting the people
 * who wronged them, and — for journalists — the story of the day.
 */
import { clamp } from '../types.ts';
import type {
  Action, BuildingId, Citizen, CitizenId, DistrictId, EventKind, LawCode, OffenceCode, Platform, ProposalKind,
  World, WorldEvent,
} from '../types.ts';
import type { Fitting, Permit } from '../environment/state.ts';
import { LAWS, offenceName } from '../data/laws.ts';
import { chance, pick, rand } from '../util/rng.ts';
import { vacancies } from '../economy/housing.ts';
import { treasuryFailing, treasuryFlush, treasuryStrained as treasuryThin } from '../economy/budget.ts';
import {
  PROPERTY_TAX_MAX, RESERVE_MAX, WEALTH_TAX_MAX, propertyTaxRate, reserveTarget, wealthTaxRate,
} from '../markets/levers.ts';
import { bondBetween, friendsOf } from '../citizens/relationships.ts';
import { STIPEND, chestBalance, claimants } from '../society/chest.ts';
import { hasUndetectedRecentOffence, topStories } from '../sim/chronicle.ts';
import { REPORT_WINDOW_TICKS } from '../government/watch.ts';
import { councillorDisposition, impliedPlatform, isCouncillor, treasuryDeficitShare, voterPreference } from '../government/council.ts';
import { MIN_WAGE_CEILING, MIN_WAGE_FLOOR } from '../politics/promises.ts';
import { districtName, isPresent, parseGrievance } from '../actions/common.ts';
import type { Grievance } from '../actions/common.ts';
import { admitsResidency, sponsorshipsFor } from '../standing/gates.ts';
import { judgedLine } from '../standing/notices.ts';
import { reputeOf } from '../standing/repute.ts';
import { noticeOf } from '../standing/state.ts';
import type { StandingNotice } from '../standing/state.ts';
import { underNoticeToLeave } from '../standing/hearings.ts';
import { dailyDebtService, debtServiceCap } from '../finance/bonds.ts';
import { bankState, bankSuspended, depositsTotal, vaultBalance } from '../finance/bank.ts';
import { mostPressingIssue } from '../finance/daily.ts';
import { financeState } from '../finance/state.ts';
import { allContracts } from '../civil/terms.ts';
import { pendingSuits } from '../civil/docket.ts';
import { civilSettings } from '../civil/state.ts';
import { inGoodStanding, stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';
import { knowledgeMotions, smokeMotions } from './reflex-motions.ts';

/** A grievance older than this is let go. */
export const GRIEVANCE_WINDOW_TICKS = 24;
/** Chance per tick that an eligible, ambitious citizen declares while nominations are open. */
export const NOMINATE_CHANCE = 0.15;
/** Chance per free hour that a councillor with nothing on the table proposes something (≈10 % a day over a working councillor's free hours). */
export const PROPOSE_CHANCE = 0.1 / 8;
const PETITION_CHANCE = 0.02 / 8;
/**
 * Laws a strict citizen would have the Council treat more harshly, and a
 * lenient one more gently. Both lists are the **Code of the City** only: the
 * Council sets a civic severity, and a personal offence's severity moves with
 * `government/persons.ts setPersonSeverity`, never with `law_severity`
 * (`REGISTRY.md` §1 — the Council may set a severity, it may not set a track).
 */
const STRICTER_LAWS: readonly LawCode[] = ['L04', 'L07', 'L06', 'L03', 'L12'];
const LENIENT_LAWS: readonly LawCode[] = ['L04', 'L03', 'L12', 'L02'];
const THEFT_FAMILY: readonly OffenceCode[] = ['L04', 'L08'];
/** Events a journalist will not turn into a story of their own (other stories most of all). */
const UNPRINTABLE: readonly EventKind[] = ['story', 'paid', 'vote', 'message', 'trade', 'social'];
/** Events whose first actor is fairly named as the subject of the story. */
const PERSONAL_NEWS: readonly EventKind[] = [
  'offence', 'charge', 'verdict', 'sentence', 'appeal', 'exile', 'pardon', 'insult', 'business_bankrupt', 'fired', 'eviction', 'loan', 'detained', 'election', 'nomination',
];

export interface ReflexProposal {
  kind: ProposalKind;
  value: number;
  summary: string;
  lawCode?: LawCode;
  targetId?: CitizenId;
  /** The programme a grant pays into, or the subject the works are for. */
  subject?: string;
  /** What a zoning, host-payment or works measure is about. */
  district?: DistrictId;
  permit?: Permit;
  building?: BuildingId;
  fitting?: Fitting;
}

// ---------------------------------------------------------------------------
// Appeals
// ---------------------------------------------------------------------------

/**
 * How much a scripted citizen minds the sentence it just got: what going back
 * to the Council would be worth.
 *
 * There are two answers to read, because there are two tracks. On the ladder
 * it is the rung — 5 is the Gate, 4 a suspension, and 1 a word — and on the
 * Code of Persons it is the days: life is worth every appeal there is, and a
 * fortnight in a cell is worth more than any fine.
 */
export function appealWeight(k: { track?: string; tier: number | null; jailDays?: number; life?: boolean }): number {
  if (k.track === 'person') {
    if (k.life) return 0.95;
    const days = Math.max(0, k.jailDays ?? 0);
    return clamp(0.3 + days / 60, 0.3, 0.9);
  }
  const tier = k.tier ?? 1;
  return tier >= 5 ? 0.95 : tier === 4 ? 0.8 : tier === 3 ? 0.35 : tier === 2 ? 0.15 : 0.05;
}

/** Appeal a fresh conviction — almost always against exile or a long term, rarely against a warning. Once per case. */
export function tryAppeal(ctx: Ctx): Action | null {
  const { world, c, obs } = ctx;
  const k = obs.government.myLatestCase;
  if (!k || !k.canAppeal || !ctx.can.has('appeal')) return null;
  const key = `appealDecided:${c.id}:${k.id}`;
  if (world.counters[key]) return null;
  world.counters[key] = 1;
  const p = appealWeight(k) + (c.personality.ambition - 0.5) * 0.3 + (c.personality.honesty - 0.5) * 0.2;
  return chance(world, p) ? { type: 'appeal' } : null;
}

// ---------------------------------------------------------------------------
// Elections and the Council
// ---------------------------------------------------------------------------

/** The platform a candidate runs on: their situation and temperament, with a personal slant. */
export function personalPlatform(world: World, c: Citizen): Platform {
  const base = impliedPlatform(world, c);
  const slant = () => (rand(world) - 0.5) * 0.2;
  return {
    tax: clamp(base.tax + slant(), 0, 1), dividend: clamp(base.dividend + slant(), 0, 1),
    minWage: clamp(base.minWage + slant(), 0, 1), strictness: clamp(base.strictness + slant(), 0, 1),
  };
}

function wantsToStand(world: World, c: Citizen): boolean {
  const incumbent = isCouncillor(world, c.id);
  return c.reputation > 50 && (c.personality.ambition > 0.6 || (incumbent && c.personality.ambition > 0.4));
}

/**
 * The Treasury is running out: at the rate it has been losing money it has
 * fewer than `CRISIS_RUNWAY_DAYS` left (`economy/budget.ts`).
 *
 * This used to read `balance < dividend × population × 20`, which is a test
 * denominated in the very lever it exists to move. On seed 7 the Council duly
 * trimmed the dividend — and the alarm went silent, because with a dividend of
 * 0 the test is `balance < 0`. From day 90 the city was losing 600 ℓ a day with
 * 33,000 left and read, by its own instruments, as being in no difficulty at
 * all: it voted the dividend back up, topped the works fund up again, and lost
 * another 18,000 by day 120. What a city has left is measured in days, not in
 * dividends.
 */
export function treasuryStrained(world: World): boolean {
  return treasuryFailing(world);
}

/**
 * Comfortable: the Treasury is gaining, or has years of its present losses in
 * hand. What a councillor asks before proposing something that costs money.
 */
export function treasuryHealthy(world: World): boolean {
  return treasuryFlush(world);
}

/**
 * What a councillor puts into the works fund when it is empty and the
 * Treasury is not: enough for the Builders' Yard's wages with a monument's
 * worth left over, so the fund is a thing the city can actually build from.
 */
export const PUBLIC_WORKS_TOPUP = 1200;

/**
 * The smallest issue of the city's paper the Exchange will take: 20 bonds of
 * 100 ℓ (`docs/FINANCE.md` §1).
 */
export const SMALLEST_ISSUE = 2_000;

/** A gap this wide between spending and takings is one a councillor would table a motion about. */
export const NOTICEABLE_DEFICIT = 0.1;

/** A Treasury too thin for a reserve target to mean anything. */
export const RESERVE_FLOOR = 2_000;
/** The most a single charity motion may ask for; `council.ts` refuses more. */
export const CHARITY_MAX = 20_000;
/** Days of stipend a grant is sized to cover, the share of the Treasury it may not pass, and how long before the Council is asked again. */
export const CHARITY_DAYS = 7;
export const CHARITY_TREASURY_SHARE = 0.01;
export const CHARITY_COOLDOWN_DAYS = 12;
/**
 * The line a councillor draws when the balance is sliding: not less than this
 * share of what the city holds today. A reserve set at the whole of the
 * current balance is a bar the city can never clear — it reads as strained for
 * ever, taxes stay at their ceiling, and the citizens are squeezed dry to
 * defend a number nobody can reach. There has to be room under it.
 *
 * Half turned out to be too much room. `floatDividend` only starts defending
 * the line once the balance has fallen *below* it, so a line at half the
 * balance is an instruction to do nothing until the Treasury has halved: on
 * seed 7 the reserve was drawn at 40,000 ℓ on day 30 and the dividend did not
 * move a lumen until day 118, by which time the city had spent forty thousand
 * lumens waiting for its own alarm. Three quarters still leaves a quarter of
 * the Treasury under the line, and the correction starts in weeks instead of
 * months. It is still a number a councillor tables and a Council votes on.
 */
export const RESERVE_SHARE = 0.75;
/** The Treasury has to be this far above its reserve before anyone proposes raising it. */
export const RESERVE_RAISE_AT = 2;
/** Below this share of its reserve, a failing city's reserve is one nobody can reach. */
export const RESERVE_UNREACHABLE = 0.6;
/** How far a motion moves the wealth tax and the tax on let property. */
export const WEALTH_TAX_STEP = 0.005;
export const PROPERTY_TAX_STEP = 0.05;

/** The Treasury needs steadying: thinning, or yesterday's spending well beyond its takings. */
export function treasuryNeedsSteadying(world: World): boolean {
  return treasuryThin(world) || treasuryDeficitShare(world) >= NOTICEABLE_DEFICIT;
}

/** A proposal (or petition) drawn from the citizen's platform, their friendships and the state of the city. */
export function proposalFromPlatform(ctx: Ctx): ReflexProposal | null {
  const { world, c } = ctx;
  const g = world.government;
  const platform = c.platform ?? impliedPlatform(world, c);
  // Which way the city's finances point, read off the runway and nothing else.
  // `treasuryNeedsSteadying` mixes in yesterday's balance sheet, which is the
  // right thing for deciding whether to bother tabling a motion at all — but
  // the ratio of one day's spend to one day's takings swings between 0.00 and
  // 1.00 with the Bazaar's churn, so a lever hung on it only ever ratchets one
  // way: on seed 7 the income tax climbed to its 50 % ceiling and stayed there
  // while the Treasury was gaining money. Which way to move a lever is a
  // question about the months, not about yesterday.
  const healthy = treasuryHealthy(world);
  const strained = treasuryThin(world);
  // And how near the Treasury is to the end of its money, which is what the
  // dividend, a bond issue and a minting are all really questions about.
  const desperate = treasuryStrained(world);
  const pct = (x: number) => `${Math.round(x * 100)}%`;
  const fine = (x: number) => `${Math.round(x * 1000) / 10}%`;
  const r2 = (x: number) => Math.round(x * 100) / 100;
  const r3 = (x: number) => Math.round(x * 1000) / 1000;
  const options: ReflexProposal[] = [];

  if (platform.tax > 0.6 && g.incomeTax <= 0.45) options.push({ kind: 'income_tax', value: r2(g.incomeTax + 0.05), summary: `Raise income tax to ${pct(g.incomeTax + 0.05)} to fund the city` });
  if (platform.tax < 0.4 && g.incomeTax >= 0.05) options.push({ kind: 'income_tax', value: r2(g.incomeTax - 0.05), summary: `Cut income tax to ${pct(g.incomeTax - 0.05)} and let citizens keep their wages` });
  if (strained && g.incomeTax <= 0.45) options.push({ kind: 'income_tax', value: r2(g.incomeTax + 0.05), summary: `Raise income tax to ${pct(g.incomeTax + 0.05)} to steady the Treasury` });
  if (strained && g.salesTax <= 0.23) options.push({ kind: 'sales_tax', value: r2(g.salesTax + 0.02), summary: `Raise sales tax to ${pct(g.salesTax + 0.02)}; the Bazaar can carry the city` });
  if (platform.tax > 0.6 && g.salesTax <= 0.23) options.push({ kind: 'sales_tax', value: r2(g.salesTax + 0.02), summary: `Raise sales tax to ${pct(g.salesTax + 0.02)}` });
  if (platform.tax < 0.4 && g.salesTax >= 0.02) options.push({ kind: 'sales_tax', value: r2(g.salesTax - 0.02), summary: `Lower sales tax to ${pct(g.salesTax - 0.02)} to cheapen the Bazaar` });
  if (platform.dividend > 0.6 && g.dividend <= 55 && healthy) options.push({ kind: 'dividend', value: g.dividend + 5, summary: `Raise the citizen's dividend to ${g.dividend + 5} ℓ a day` });
  // The dividend is what the city's poorest live on; a deficit is met with
  // taxes first, and the dividend is only trimmed when the Treasury itself
  // is running out.
  if ((platform.dividend < 0.4 || desperate) && g.dividend >= 5) {
    options.push({ kind: 'dividend', value: g.dividend - 5, summary: desperate
      ? `Trim the dividend to ${g.dividend - 5} ℓ to steady the Treasury`
      : `Lower the dividend to ${g.dividend - 5} ℓ; work should pay, not the Treasury` });
  }
  if (platform.minWage > 0.6 && g.minWage <= MIN_WAGE_CEILING - 1) options.push({ kind: 'min_wage', value: g.minWage + 1, summary: `Raise the minimum wage to ${g.minWage + 1} ℓ a shift` });
  if (platform.minWage < 0.4 && g.minWage >= MIN_WAGE_FLOOR + 1) options.push({ kind: 'min_wage', value: g.minWage - 1, summary: `Lower the minimum wage to ${g.minWage - 1} ℓ so businesses can hire` });
  // The wage floor is also the floor under every city post and every piece
  // rate, so it is the largest single thing the Treasury pays. A councillor
  // watching the balance fall reaches for it like any other lever.
  if (strained && g.minWage >= MIN_WAGE_FLOOR + 1) {
    options.push({ kind: 'min_wage', value: g.minWage - 1, summary: `Lower the minimum wage to ${g.minWage - 1} ℓ; the city's own wage bill is what is emptying the Treasury` });
  }
  if (platform.strictness > 0.65) {
    const laws = STRICTER_LAWS.filter((l) => g.lawSeverity[l] < 5);
    if (laws.length) {
      const law = pick(world, laws);
      options.push({ kind: 'law_severity', value: g.lawSeverity[law] + 1, lawCode: law, summary: `Treat ${LAWS[law].name.toLowerCase()} more harshly (severity ${g.lawSeverity[law] + 1})` });
    }
  }
  if (platform.strictness < 0.35) {
    const laws = LENIENT_LAWS.filter((l) => g.lawSeverity[l] > 1);
    if (laws.length) {
      const law = pick(world, laws);
      options.push({ kind: 'law_severity', value: g.lawSeverity[law] - 1, lawCode: law, summary: `Go easier on ${LAWS[law].name.toLowerCase()} (severity ${g.lawSeverity[law] - 1})` });
    }
  }
  // Public works pay the Builders' Yard, and what is left in the fund is what
  // the city has to build a tram or raise a monument with. A councillor puts
  // money in it when the Lofts are full, and again whenever the fund has run
  // dry on a healthy Treasury: an empty fund is a city that cannot build.
  if (vacancies(world)[1] === 0 && world.treasury.balance > 5000) options.push({ kind: 'public_works', value: 500, summary: 'Fund 500 ℓ of public works to build more homes' });
  if (healthy && g.publicWorksFund < PUBLIC_WORKS_TOPUP) {
    options.push({ kind: 'public_works', value: PUBLIC_WORKS_TOPUP, summary: `Commit ${PUBLIC_WORKS_TOPUP} ℓ to the public works fund; the city has building to do` });
  }
  // The Community Chest has exactly two ways to be filled: a citizen with
  // something spare who remembers it, and this motion. Until the expansion
  // layers landed the first was enough — the Chest held 12,186 ℓ at day 120 on
  // seed 7. It is not enough any more: a citizen's spare lumens now go to a
  // mutual's dues and a creed's fund first (698 `pay_dues` against 94
  // `donate` over sixty days), both of which pay out to their own members
  // rather than to whoever is on the street. So the Chest runs at 0 for the
  // whole run and `dailyChest` prints that citizens in hardship went without,
  // while `enactCharity` — the backstop written for exactly this — sits
  // unreachable, because the only thing that tables a motion in a scripted
  // city is this function and it never offered one.
  //
  // A councillor proposes charity on the plain public facts: the register
  // shows citizens in hardship, the Chest cannot pay them, and the Treasury
  // can. Sized to carry today's claimants for a fortnight rather than to a
  // round number, so a city with two wards asks for little and a city in a
  // bad month asks for what a bad month costs.
  // Read off this morning's rollover rather than the roll at this instant: by
  // the time the Council sits, a citizen who went without a stipend at dawn
  // has often earned past the hardship line, so `claimants` here reports none
  // on a day seven people were turned away.
  const needy = world.counters.chestUnpaidDay === world.day ? (world.counters.chestUnpaid ?? 0) : 0;
  // A grant has to be bounded three ways or it is a pump, not a relief. The
  // Chest pays *every* claimant *every* morning and `stipendToday` raises the
  // rate to STIPEND_MAX while it is flush, so a fat Chest empties in a few
  // days and asks again — and the first version of this, granting a fortnight
  // of stipend whenever the Chest ran dry, turned the Treasury from +28 ℓ a
  // day over the settled stretch into −248 ℓ a day, roughly 43,000 ℓ across
  // 155 days on seed 7. Relief the city cannot pay for is not relief.
  //
  // So: only out of a Treasury that is actually healthy (not merely one that
  // is not yet desperate), never more than CHARITY_TREASURY_SHARE of what the
  // city holds, and not again while a recent grant is still being spent.
  const lastGrant = world.counters.charityGrantDay;
  const cooled = lastGrant === undefined || world.day - lastGrant >= CHARITY_COOLDOWN_DAYS;
  if (needy > 0 && healthy && cooled) {
    const owed = needy * STIPEND * CHARITY_DAYS;
    const affordable = Math.max(0, Math.floor(world.treasury.balance) - RESERVE_FLOOR);
    const share = Math.floor(world.treasury.balance * CHARITY_TREASURY_SHARE);
    const grant = Math.min(owed, affordable, share, CHARITY_MAX);
    if (chestBalance(world) < needy * STIPEND && grant >= STIPEND) {
      options.push({ kind: 'charity', value: grant, summary: `Put ${grant} ℓ into the Community Chest; ${needy} citizen${needy === 1 ? '' : 's'} in hardship and nothing in it to pay them` });
    }
  }
  // The three levers the metropolis added and nothing in a scripted city ever
  // reached for. `markets/levers.ts` has held them since the metropolis layer
  // was built and `government/council.ts` already knows how a councillor votes
  // on each — but the only thing that tables a motion in a reflex city is this
  // function, and it could produce nothing but income tax, sales tax, the
  // dividend, the minimum wage, law severity, public works, a pardon and a
  // motion against the Mayor. So `reserveTarget` stood at 0 for every day of
  // every run, `floatDividend` never moved a lumen, and the wealth tax and the
  // property tax were dead letters while the Treasury fell from 100,000 ℓ to
  // 15,796 ℓ over 120 days on seed 7.
  //
  // The reserve is the important one: it is the only lever that keeps working
  // after it is pulled. A target says what balance the city means to hold;
  // from then on `markets/levers.floatDividend` moves the dividend a lumen a
  // day to defend it and `economy/budget.dailyBudget` stops drawing the
  // Treasury down while it is short — a slow, public, automatic correction
  // that no councillor has to remember. A councillor who has watched the
  // balance slide proposes holding the line where it stands today.
  const reserve = reserveTarget(world);
  const balance = Math.max(0, Math.round(world.treasury.balance));
  const line = (share: number) => Math.min(RESERVE_MAX, Math.max(1000, Math.round(balance * share / 1000) * 1000));
  if (reserve === 0 && !healthy && balance >= RESERVE_FLOOR) {
    const value = line(RESERVE_SHARE);
    options.push({ kind: 'reserve', value, summary: `Have the Treasury hold a reserve of ${value} ℓ, and let the dividend float to defend it` });
  }
  if (reserve > 0 && healthy && balance > reserve * RESERVE_RAISE_AT && reserve < RESERVE_MAX) {
    const value = line(RESERVE_SHARE);
    if (value > reserve) options.push({ kind: 'reserve', value, summary: `Raise the Treasury's reserve to ${value} ℓ; the city has grown` });
  }
  // A reserve the city cannot reach is a reserve that keeps every tax at its
  // ceiling for ever. A councillor watching that happen moves the line down to
  // where the city actually stands.
  if (reserve > 0 && balance < reserve * RESERVE_UNREACHABLE && treasuryStrained(world)) {
    const value = line(RESERVE_SHARE);
    if (value < reserve) options.push({ kind: 'reserve', value, summary: `Lower the Treasury's reserve to ${value} ℓ; the city cannot hold ${reserve} ℓ and is being taxed to try` });
  }
  // The wealth tax and the property tax reach the lumens that have already
  // left the Treasury. In a closed money supply that is where the Treasury's
  // balance has gone: by day 120 the citizens held 62,855 ℓ between them and
  // the city held 15,796 ℓ.
  const wealth = wealthTaxRate(world);
  if (strained && wealth < WEALTH_TAX_MAX) {
    const value = r3(Math.min(WEALTH_TAX_MAX, wealth + WEALTH_TAX_STEP));
    options.push({ kind: 'wealth_tax', value, summary: `Set the wealth tax at ${fine(value)} a day on wallets above the threshold, to steady the Treasury` });
  }
  if (healthy && wealth > 0) {
    const value = r3(Math.max(0, wealth - WEALTH_TAX_STEP));
    options.push({ kind: 'wealth_tax', value, summary: value > 0 ? `Ease the wealth tax to ${fine(value)} a day` : 'Lift the wealth tax; the city can afford to' });
  }
  const property = propertyTaxRate(world);
  if (strained && property < PROPERTY_TAX_MAX) {
    const value = r2(Math.min(PROPERTY_TAX_MAX, property + PROPERTY_TAX_STEP));
    options.push({ kind: 'property_tax', value, summary: `Take ${pct(value)} of the rent on let property for the city` });
  }
  if (healthy && property > 0) {
    const value = r2(Math.max(0, property - PROPERTY_TAX_STEP));
    options.push({ kind: 'property_tax', value, summary: value > 0 ? `Ease the tax on let property to ${pct(value)} of the rent` : 'Lift the tax on let property' });
  }

  // --- The city's own paper, its bank, and the Exchange (`docs/FINANCE.md`,
  // `docs/CIVIL.md`). Five of these levers move money the Council does not
  // have to tax anybody for, which is exactly why each of them is weighed
  // against a fact rather than a mood: a bond is only proposed by a councillor
  // watching the balance run out, a rescue only while the counter is shut, and
  // a minting only when there is nothing else left.
  const service = dailyDebtService(world);
  const cap = debtServiceCap(world);
  const barred = world.day < financeState(world).noIssuesUntilDay;
  // Borrowing is the last thing before printing, and a city already paying
  // coupons does not borrow to pay them: an issue is proposed only when the
  // Treasury is running out *and* the city owes nothing yet. The coupon is
  // the next Council's bill, which is the whole of the argument against it
  // and the reason a scripted one asks so rarely (`docs/FINANCE.md` §10).
  if (desperate && service <= 0 && !barred && cap > 0) {
    // And it borrows the least the Exchange will take. At the founding coupon
    // a bond costs the Treasury 1.5 ℓ a day for four cycles and repays its
    // face at the end of them, so the smallest issue is a fortnight's relief
    // bought with a year's instalments — which is what borrowing is, and why
    // the size is the floor rather than whatever the cap allows.
    const face = SMALLEST_ISSUE;
    options.push({ kind: 'bond_issue', value: face,
      summary: `Borrow ${face} ℓ of face at auction, the smallest issue the Exchange will take, rather than tax the city dry` });
  }
  if (mostPressingIssue(world) !== null) {
    options.push({ kind: 'bond_defer', value: 0, summary: 'Defer the coupons the Treasury has missed; they accrue at a quarter more' });
  }
  if (bankSuspended(world) && world.treasury.balance > 4_000) {
    const amount = Math.min(4_000, Math.round(world.treasury.balance / 5));
    options.push({ kind: 'bank_rescue', value: amount,
      summary: `Put ${amount} ℓ of the Treasury into the Lantern Vault and open the counter again` });
  }
  const bank = bankState(world);
  const deposits = depositsTotal(world);
  if (deposits > 0 && vaultBalance(world) < deposits * bank.reserveRatio && bank.reserveRatio < 1) {
    const ratio = Math.min(1, Math.round((bank.reserveRatio + 0.1) * 100) / 100);
    options.push({ kind: 'reserve_ratio', value: ratio,
      summary: `Make the Lantern Bank hold ${Math.round(ratio * 100)}% of its deposits in the vault` });
  }
  if (desperate && world.treasury.balance < g.dividend * Math.max(1, world.order.length) * 3) {
    options.push({ kind: 'mint', value: 5_000, summary: 'Mint 5,000 ℓ: there is nothing else left to pay the city with' });
  }
  // The Exchange's own two: a docket that cannot keep up with what is filed,
  // and a filing fee that has priced the register out of use.
  if (pendingSuits(world).length > 3) {
    options.push({ kind: 'docket_days', value: 3, summary: 'Sit the civil docket three days a week; the list is longer than the sittings' });
  }
  if (civilSettings(world).filingFlat > 3 && allContracts(world).length < 5 && platform.tax < 0.5) {
    options.push({ kind: 'filing_fee', value: 3, summary: 'Cut the flat part of a filing to 3 ℓ so an ordinary bargain is worth writing down' });
  }

  // What the city knows, and what it is breathing: two more sets of measures
  // a councillor reads off the same morning's numbers as every other lever
  // (`docs/PROGRESS.md` §§1, 3, `docs/ENVIRONMENT.md` §§3-6).
  options.push(...knowledgeMotions(ctx, healthy));
  options.push(...smokeMotions(ctx));

  const exiledFriend = Object.values(world.citizens).find((o) => o.standing === 'exiled' && bondBetween(world, c.id, o.id) > 50);
  if (exiledFriend) options.push({ kind: 'pardon', value: 0, targetId: exiledFriend.id, summary: `Pardon ${exiledFriend.name} and let them come home` });
  const mayor = g.mayorId ? world.citizens[g.mayorId] : null;
  if (mayor && mayor.id !== c.id && bondBetween(world, c.id, mayor.id) < -30 && c.personality.ambition > 0.7) {
    options.push({ kind: 'remove_mayor', value: 0, targetId: mayor.id, summary: `Remove Mayor ${mayor.name} from office` });
  }
  // A long list is not a shrug. Every layer written since the founding has put
  // more motions on this one — a research grant, a zoning permit, a fitting,
  // and now a gate question and a charter measure — and picking uniformly out
  // of it means the lever that matters most is tabled a tenth as often as it
  // was when the list was short. On seed 7 the reserve went untabled for a
  // hundred and fifty days for exactly that reason, `floatDividend` never
  // engaged, and the city paid a 30 ℓ dividend all the way down.
  //
  // So: a councillor watching the balance slide reaches for what steadies it.
  // The reserve first, because it is the only lever that keeps working after it
  // is pulled; then the taxes and the dividend, which have to be pulled again
  // every time. Everything else on the paper can wait a day. Which of them a
  // councillor believes in is still their own platform's business, and the
  // Council still has to vote for it.
  // Citizens going without a stipend is the one item on this paper that is
  // measured in people rather than in lumens, and it is the one the uniform
  // pick buried worst: the charity motion competed with twenty-odd levers, so
  // across ninety days on seed 7 it was tabled exactly never while the Chest
  // sat at 0 and four citizens a day went unpaid. It gets the same treatment
  // the reserve got, and for the same reason — not because a councillor must
  // care, but because a councillor who does care needs the motion to reach the
  // table often enough to be voted down on its merits rather than lost in the
  // shuffle. The Council still decides.
  const relief = options.filter((o) => o.kind === 'charity');
  if (relief.length > 0 && chance(world, 0.6)) return pick(world, relief);
  if (!healthy && options.length > 1) {
    const reserve = options.filter((o) => o.kind === 'reserve');
    if (reserve.length > 0 && chance(world, 0.7)) return pick(world, reserve);
    const steadying = options.filter((o) => (o.kind === 'income_tax' && o.value > g.incomeTax)
      || (o.kind === 'sales_tax' && o.value > g.salesTax)
      || (o.kind === 'dividend' && o.value < g.dividend));
    if (steadying.length > 0 && chance(world, 0.5)) return pick(world, steadying);
  }
  return options.length ? pick(world, options) : null;
}

function proposeAction(spec: ReflexProposal): Action {
  return {
    type: 'propose', kind: spec.kind, value: spec.value, summary: spec.summary,
    lawCode: spec.lawCode, targetId: spec.targetId,
    subject: spec.subject, district: spec.district, permit: spec.permit,
    building: spec.building, fitting: spec.fitting,
  };
}

// ---------------------------------------------------------------------------
// Standing: the two instruments of the gate (`docs/CITIZENSHIP.md` §2-3)
// ---------------------------------------------------------------------------

/** A bond below this is an acquaintance; a name is not put behind an acquaintance. */
export const VOUCH_BOND = 40;
/**
 * Repute above their own residency line before a citizen spends their name on
 * somebody else's. A sponsorship is filed under the sponsor's own name and is
 * read out at the hearing, so a citizen who is themselves near the line has
 * nothing to spare: the weighting falls to nothing as their own margin does.
 */
export const VOUCH_MARGIN = 100;
/** Days between one citizen's applications to the Registry while no Court is near. */
export const APPLY_INTERVAL_DAYS = 3;
/** Days before the grace ends at which a citizen puts its own case. */
export const HEARING_NEAR_DAYS = 3;

/**
 * How likely a citizen is to put its name behind another today: what the bond
 * is worth, what the sponsor's own standing can carry, and whether the two are
 * family. Never certain and never nothing — a name is given, not owed.
 */
export function vouchChance(bond: number, margin: number, kin: boolean): number {
  const weight = clamp((bond - VOUCH_BOND) / 60, 0, 1);
  const room = clamp(margin / VOUCH_MARGIN, 0, 1);
  return clamp((0.08 + 0.32 * weight + (kin ? 0.2 : 0)) * room, 0, 0.6);
}

/** Partner, parents, children: the bonds a citizen did not choose. */
function kinOf(c: Citizen): Set<CitizenId> {
  const out = new Set<CitizenId>(c.family.parents);
  for (const id of c.family.children) out.add(id);
  if (c.family.partnerId) out.add(c.family.partnerId);
  return out;
}

/** True while this citizen is answering to the Registry for their own standing. */
function inQuestion(world: World, cId: CitizenId): boolean {
  return noticeOf(world, cId) !== null || underNoticeToLeave(world, cId);
}

/**
 * Somebody the citizen knows is about to lose their home. Vouching is public,
 * it is filed under the sponsor's own name, and nobody can be made to give it
 * — so it is weighed once a day per applicant and given at the rate the bond
 * and the sponsor's own standing argue for.
 */
export function tryVouch(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('sponsor') || !inGoodStanding(c)) return null;
  const margin = reputeOf(world, c.id) - judgedLine(world, c.id);
  if (margin <= 0) return null;
  const kin = kinOf(c);
  const known = new Set<CitizenId>([...kin, ...Object.keys(c.bonds)]);
  for (const id of known) {
    if (id === c.id) continue;
    const other = world.citizens[id];
    if (!other || other.lifeStage === 'child' || !isPresent(world, other)) continue;
    if (!inQuestion(world, id)) continue;
    const bond = bondBetween(world, c.id, id);
    if (bond < VOUCH_BOND && !kin.has(id)) continue;
    if (sponsorshipsFor(world, id).some((k) => k.sponsorId === c.id)) continue;
    const key = `vouchWeighed:${c.id}:${id}`;
    if (world.counters[key] === world.day) continue;
    world.counters[key] = world.day;
    if (chance(world, vouchChance(bond, margin, kin.has(id)))) return { type: 'sponsor', citizen: id };
  }
  return null;
}

/**
 * Whether putting your own case is worth the hour, on two public readings.
 * The gate would actually open today — the shortfall is inside what the city's
 * own relief covers, which is what a name behind you is for — so applying ends
 * the notice there and then. Or the Court is about to sit, and speaking is the
 * one thing a citizen can do about that: `docs/CITIZENSHIP.md` §3 says they
 * may speak, and the hearing records whether they did. Silence is what a
 * scripted mind did before, and it is not an answer.
 */
export function worthArguing(world: World, c: Citizen, notice: StandingNotice | null): boolean {
  if (admitsResidency(world, c.id)) return true;
  if (!notice || notice.applied) return false;
  return notice.immediate || notice.graceEndsDay - world.day <= HEARING_NEAR_DAYS;
}

/** A citizen under notice puts its own case rather than letting the hour pass. */
export function tryOwnStanding(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('apply_residency')) return null;
  const notice = noticeOf(world, c.id);
  if (!notice && !underNoticeToLeave(world, c.id)) return null;
  const key = `applyWeighed:${c.id}`;
  const last = world.counters[key];
  if (typeof last === 'number' && world.day - last < APPLY_INTERVAL_DAYS) return null;
  if (!worthArguing(world, c, notice)) return null;
  world.counters[key] = world.day;
  return { type: 'apply_residency' };
}

/** Your own standing first, then anybody's you would put your name behind. */
export function tryStanding(ctx: Ctx): Action | null {
  return tryOwnStanding(ctx) ?? tryVouch(ctx);
}

/** Vote, stand, campaign, sit on the Council, petition. */
export function tryCivic(ctx: Ctx): Action | null {
  const { world, c, clock, can } = ctx;
  const g = world.government;
  const e = g.election;

  // Standing comes first of the civic hours: a notice is answered while there
  // is still a Court to answer it to, and a neighbour under one is vouched for
  // while their hearing is still ahead of them.
  const standing = tryStanding(ctx);
  if (standing) return standing;

  if (can.has('vote')) {
    const key = `abstain:${c.id}:${e.electionDay}`;
    if (!world.counters[key]) {
      const choice = voterPreference(world, c.id, e.candidates);
      if (choice) return { type: 'vote', candidate: choice };
      world.counters[key] = 1;
    }
  }
  if (can.has('nominate') && wantsToStand(world, c) && chance(world, NOMINATE_CHANCE)) {
    return { type: 'nominate', platform: personalPlatform(world, c) };
  }
  if (can.has('campaign') && !clock.night && (!clock.working || !ctx.job) && chance(world, 0.3)) {
    if (c.district !== 'commons' && chance(world, 0.6)) return stepTo(ctx, 'commons');
    const spend = c.wallet > 300 && c.personality.ambition > 0.7 ? 20 : 0;
    return { type: 'campaign', spend };
  }
  if (isCouncillor(world, c.id) && inGoodStanding(c)) {
    const pending = g.proposals.filter((p) => p.status === 'open' && p.votes[c.id] === undefined);
    if (pending.length > 0) return { type: 'vote_proposal', proposalId: pending[0].id, aye: councillorDisposition(world, c.id, pending[0]) };
    if (can.has('propose') && !clock.night && chance(world, treasuryNeedsSteadying(world) ? PROPOSE_CHANCE * 3 : PROPOSE_CHANCE)) {
      const spec = proposalFromPlatform(ctx);
      if (spec) return proposeAction(spec);
    }
  } else if (can.has('propose') && c.personality.ambition > 0.7 && !clock.night && chance(world, PETITION_CHANCE)) {
    const spec = proposalFromPlatform(ctx);
    if (spec) return proposeAction(spec);
  }
  return null;
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function sameFamily(a: OffenceCode, b: OffenceCode): boolean {
  return a === b || (THEFT_FAMILY.includes(a) && THEFT_FAMILY.includes(b));
}

/** The accused still has an offence against this victim that the Watch never saw. */
function hasOpenOffence(world: World, accused: Citizen, victimId: CitizenId, law: OffenceCode): boolean {
  return accused.recentOffences.some((o) => !o.detected && world.tick - o.tick <= REPORT_WINDOW_TICKS
    && sameFamily(o.law, law) && (o.victimId === victimId || o.victimId === null));
}

function describeGrievance(g: Grievance): string {
  switch (g.law) {
    case 'L04': case 'L08': return g.amount > 0 ? `picked my pocket for ${g.amount} ℓ` : 'tried to pick my pocket';
    case 'L07': return g.amount > 0 ? `defrauded me of ${g.amount} ℓ` : 'tried to defraud me';
    // The Code of Persons: what a victim says happened to them, not to the city.
    case 'P06': return g.amount > 0 ? `extorted ${g.amount} ℓ from me under threat` : 'threatened me for money';
    case 'P01': return 'threatened me';
    case 'P03': return 'assaulted me';
    case 'P04': return 'beat me, and I still carry it';
    case 'P05': return 'held me against my will';
    default: return 'keeps harassing me';
  }
}

interface Tally { g: Grievance; insults: number; harassments: number; tick: number }

/** Report whoever wronged you in the last day — unless the Watch already caught them, or you would rather settle it yourself. */
export function tryReport(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('report')) return null;
  const cutoff = world.tick - GRIEVANCE_WINDOW_TICKS;
  const tallies = new Map<string, Tally>();
  for (const m of c.memory) {
    if (m.kind !== 'crime' || m.tick < cutoff) continue;
    const g = parseGrievance(m.text);
    if (!g) continue;
    const key = `${g.actorId}:${g.law}`;
    const t = tallies.get(key) ?? { g, insults: 0, harassments: 0, tick: m.tick };
    if (m.text.includes('insulted you')) t.insults++;
    else if (m.text.includes('harassed you')) t.harassments++;
    t.tick = Math.max(t.tick, m.tick);
    tallies.set(key, t);
  }
  for (const { g, insults, harassments, tick } of tallies.values()) {
    const actor = world.citizens[g.actorId];
    if (!actor || !isPresent(world, actor)) continue;
    // Harassment is P02 now, and it is a pattern rather than one bad hour:
    // three insults or two acts of hostility before anybody goes to the Watch.
    if (g.law === 'P02' && insults < 3 && harassments < 2) continue;
    const key = `reported:${c.id}:${g.actorId}:${g.law}:${tick}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    if (!hasOpenOffence(world, actor, c.id, g.law)) continue;
    if (bondBetween(world, c.id, actor.id) > 50 && chance(world, 0.5)) continue;
    if (c.personality.honesty < 0.3 && actor.district === c.district && chance(world, 0.5)) return { type: 'insult', target: actor.id };
    return { type: 'report', citizen: actor.id, law: g.law, text: `${actor.name} ${describeGrievance(g)}.` };
  }
  return null;
}

// ---------------------------------------------------------------------------
// Journalism
// ---------------------------------------------------------------------------

/**
 * What the Chronicle calls each kind of news. A journalist writes their own
 * line about the day — copying out the event's own sentence would only print
 * back what the city read this morning, and chronicle.ts refuses it.
 */
const ANGLES: Partial<Record<EventKind, string>> = {
  arrival: 'New at the Threshold', departure: 'A place left empty', exile: 'Through the Exile Gate', pardon: 'Called home',
  hired: 'Taken on', fired: 'Let go', quit: 'Walked out', shortage: 'Empty shelves', price: 'What things cost',
  business_founded: 'A new sign over the door', business_bankrupt: 'The doors are shut',
  offence: 'Crime in the city', charge: 'The Watch lays a charge', detained: 'A night in the Watch House',
  verdict: 'The Court decides', sentence: 'The reckoning', appeal: 'The case goes up',
  election: 'The city votes', nomination: 'Standing for the Council', proposal: 'Before the Council',
  law: 'At City Hall', decree: 'By decree', treasury: "The city's purse", housing: 'A question of rooms',
  loan: 'The Lantern Bank', eviction: 'Turned out', wedding: 'Vows exchanged', birth: 'A new citizen',
  birthday: 'Another year', festival: 'The city celebrates', club: 'The clubs', romance: 'Hearts in the city',
  purchase: 'Trade', donation: 'Charity', coming_of_age: 'Coming of age', household: 'Under one roof',
  insult: 'Hard words', show: 'On the stage', system: 'From the city',
};

/** How a citizen is introduced in print: what they do, and where they live. */
function pressDescription(world: World, c: Citizen): string {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  const held = job && job.holderId === c.id ? job.title.toLowerCase() : null;
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  const where = districtName(world, c.district);
  if (held) return `${c.name}, ${held} of ${where}`;
  if (biz && biz.dissolvedDay === null) return `${c.name} of ${biz.name}, ${where}`;
  return `${c.name}, out of work in ${where}`;
}

/** The angle a headline was written from: everything before the colon. */
function angleOf(headline: string): string {
  const at = headline.indexOf(':');
  return (at > 0 ? headline.slice(0, at) : headline).trim().toLowerCase();
}

/** The journalist's own headline for a story: the angle, and who it is about (or who is reporting). */
export function headlineFor(world: World, journalist: Citizen, story: WorldEvent, subject: Citizen | null): string {
  const angle = ANGLES[story.kind] ?? 'From the city';
  if (subject) return `${angle}: ${pressDescription(world, subject)}`;
  return `${angle}: ${journalist.name} reports from ${districtName(world, journalist.district)}, day ${world.day}`;
}

/** A journalist files one story a day: an exposé when a friend was wronged by someone who got away with it, else the day's news in their own words. */
export function tryPublish(ctx: Ctx): Action | null {
  const { world, c, job } = ctx;
  if (!job || job.role !== 'journalist' || !ctx.can.has('publish')) return null;
  const key = `published:${c.id}`;
  if (world.counters[key] === world.day || !chance(world, 0.3)) return null;

  for (const sourceId of [c.id, ...friendsOf(world, c.id)]) {
    const source = world.citizens[sourceId];
    if (!source) continue;
    for (const m of source.memory.slice(-12)) {
      if (m.kind !== 'crime' || world.tick - m.tick > 48) continue;
      const g = parseGrievance(m.text);
      if (!g || g.actorId === c.id) continue;
      const subject = world.citizens[g.actorId];
      if (!subject || !isPresent(world, subject) || !hasUndetectedRecentOffence(world, subject)) continue;
      world.counters[key] = world.day;
      return { type: 'publish', headline: `${offenceName(g.law)} in ${districtName(world, subject.district)}: ${subject.name} named by a victim`, about: subject.id };
    }
  }
  // Two journalists filing "From the city: <name> reports from <district>" on
  // the same morning is two column inches of nothing. A desk takes an angle
  // only once a day, whoever else has already taken it.
  const printed = new Set(world.events
    .filter((e) => e.day === world.day && e.kind === 'story')
    .map((e) => angleOf(String(e.data?.headline ?? ''))));
  const stories = [...topStories(world, world.day, 8), ...topStories(world, world.day - 1, 8)]
    .filter((e) => e.weight >= 0.3 && !UNPRINTABLE.includes(e.kind));
  for (const story of stories) {
    const subjectId = PERSONAL_NEWS.includes(story.kind) ? story.actors.find((id) => id !== c.id && world.citizens[id] !== undefined) : undefined;
    const subject = subjectId ? world.citizens[subjectId] : null;
    const headline = headlineFor(world, c, story, subject ?? null);
    if (printed.has(angleOf(headline))) continue;
    world.counters[key] = world.day;
    return subject ? { type: 'publish', headline, about: subject.id } : { type: 'publish', headline };
  }
  return null;
}

/**
 * The reflex brain's civic life: appeals, the ballot box, standing for the
 * Council, campaigning, council business and petitions, reporting the people
 * who wronged them, and — for journalists — the story of the day.
 */
import { clamp } from '../types.ts';
import type { Action, Citizen, CitizenId, EventKind, LawCode, OffenceCode, Platform, ProposalKind, World, WorldEvent } from '../types.ts';
import { LAWS, offenceName } from '../data/laws.ts';
import { chance, pick, rand } from '../util/rng.ts';
import { vacancies } from '../economy/housing.ts';
import { treasuryFailing, treasuryFlush, treasuryStrained as treasuryThin } from '../economy/budget.ts';
import {
  PROPERTY_TAX_MAX, RESERVE_MAX, WEALTH_TAX_MAX, propertyTaxRate, reserveTarget, wealthTaxRate,
} from '../markets/levers.ts';
import { bondBetween, friendsOf } from '../citizens/relationships.ts';
import { hasUndetectedRecentOffence, topStories } from '../sim/chronicle.ts';
import { REPORT_WINDOW_TICKS } from '../government/watch.ts';
import { councillorDisposition, impliedPlatform, isCouncillor, treasuryDeficitShare, voterPreference } from '../government/council.ts';
import { MIN_WAGE_CEILING, MIN_WAGE_FLOOR } from '../politics/promises.ts';
import { districtName, isPresent, parseGrievance } from '../actions/common.ts';
import type { Grievance } from '../actions/common.ts';
import { inGoodStanding, stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

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

/** A gap this wide between spending and takings is one a councillor would table a motion about. */
export const NOTICEABLE_DEFICIT = 0.1;

/** A Treasury too thin for a reserve target to mean anything. */
export const RESERVE_FLOOR = 2_000;
/**
 * The line a councillor draws when the balance is sliding: not less than this
 * share of what the city holds today. A reserve set at the whole of the
 * current balance is a bar the city can never clear — it reads as strained for
 * ever, taxes stay at their ceiling, and the citizens are squeezed dry to
 * defend a number nobody can reach. Half is a line with room under it.
 */
export const RESERVE_SHARE = 0.5;
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
  const desperate = treasuryStrained(world);
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

  const exiledFriend = Object.values(world.citizens).find((o) => o.standing === 'exiled' && bondBetween(world, c.id, o.id) > 50);
  if (exiledFriend) options.push({ kind: 'pardon', value: 0, targetId: exiledFriend.id, summary: `Pardon ${exiledFriend.name} and let them come home` });
  const mayor = g.mayorId ? world.citizens[g.mayorId] : null;
  if (mayor && mayor.id !== c.id && bondBetween(world, c.id, mayor.id) < -30 && c.personality.ambition > 0.7) {
    options.push({ kind: 'remove_mayor', value: 0, targetId: mayor.id, summary: `Remove Mayor ${mayor.name} from office` });
  }
  return options.length ? pick(world, options) : null;
}

function proposeAction(spec: ReflexProposal): Action {
  return { type: 'propose', kind: spec.kind, value: spec.value, summary: spec.summary, lawCode: spec.lawCode, targetId: spec.targetId };
}

/** Vote, stand, campaign, sit on the Council, petition. */
export function tryCivic(ctx: Ctx): Action | null {
  const { world, c, clock, can } = ctx;
  const g = world.government;
  const e = g.election;

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

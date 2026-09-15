/**
 * Trends — what the city wants this month (`docs/PROGRESS.md` §6).
 *
 * Technology is what a city can do; a trend is what its people want. Trends
 * move the way rumours do: along friendship edges, on the daily rollover.
 *
 * **Nothing seeds one.** A trend exists once three friends hold the same thing
 * that under a third of the city holds, so every trend starts with somebody
 * buying something. No engine decision, no roll, no author's thumb.
 *
 * ```
 * p(take it up today) = 0.05
 *    + 0.30 × share of your friends who have it
 *    + 0.15 × (highest repute among those friends / 1000)
 *    + 0.10 if it matches one of your hobbies or tastes
 *    − 0.25 × max(0, cityShare − 0.6) / 0.4
 * ```
 *
 * **The roll moves a reflex citizen's want list and nothing else.** A free
 * mind reads the same `trends` block and buys what it likes or nothing at all;
 * no brain is ever told what to want (`PRINCIPLES.md` §2). That is why the
 * take-up roll touches `wants` — a shopping list a reflex mind consults — and
 * touches nothing a free mind would have to obey.
 *
 * The last line of the formula is the mechanic. **A possession held by more
 * than 60 % of the city gives no social gain when used or gifted**: it reads as
 * ordinary. A thing rises because admired people have it, saturates because
 * everyone copied them, then signals nothing, and the admired move on.
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, World } from '../types.ts';
import { HOBBIES, MAX_POSSESSIONS, PRODUCTS, PRODUCT_IDS } from '../data/catalogue.ts';
import { DISHES } from '../data/metropolis.ts';
import { SCHOOLS } from '../types.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { friendsOf } from '../citizens/relationships.ts';
import { isPresent } from '../citizens/citizen.ts';
import { menuOf } from '../culture/menus.ts';
import { reputeOf } from '../standing/repute.ts';
import type { Trend, TrendKind } from './state.ts';
import { TREND_EVENT, TREND_KINDS, progressId, progressState } from './state.ts';
import { trendReachMultiplier } from './effects.ts';

/** Friends holding the same thing that make it a trend. */
export const TREND_SEED_FRIENDS = 3;
/** A trend can only start below this share: past it, it is not a trend, it is the city. */
export const TREND_SEED_SHARE = 1 / 3;
/** Held by more than this share of the city and it signals nothing at all. */
export const SATURATION_SHARE = 0.6;
/** The width of the band over saturation across which the last term bites. */
export const SATURATION_BAND = 0.4;
/** A trend that has fallen this low, and is not rising, is over. */
export const TREND_FLOOR = 0.02;
/** Trends the city keeps in mind at once. */
export const MAX_TRENDS = 12;
/** Wants a reflex citizen keeps on its list (mirrors `society/tastes.ts`). */
export const MAX_WANTS = 5;
/** What a rising possession adds to what a shop can clear it at. */
export const TREND_PRICE_PREMIUM = 0.4;
/** Days a name keeps its weight after its trend ends: a cycle, not a week. */
export const NAME_MEMORY_DAYS = 28;

const TAKE_UP_BASE = 0.05;
const TAKE_UP_FRIENDS = 0.3;
const TAKE_UP_REPUTE = 0.15;
const TAKE_UP_TASTE = 0.1;
const TAKE_UP_SATURATION = 0.25;

// ---------------------------------------------------------------------------
// Who holds what
// ---------------------------------------------------------------------------

/** Everybody the city counts: present, not exiled. Children included — a name is a name. */
export function population(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) out.push(c);
  }
  return out;
}

/** The given name a citizen goes by: the first word of the name they were called. */
export function givenName(c: Citizen): string {
  return String(c.name ?? '').trim().split(/\s+/)[0] ?? '';
}

/**
 * A dish is the one thing on this list nobody can own, so "holding" it means
 * having taken it up — and a cook or an owner serving it has plainly taken it
 * up (`culture/menus.ts` keeps the menus).
 */
function servesDish(world: World, c: Citizen, dish: string): boolean {
  for (const biz of Object.values(world.businesses)) {
    if (biz.ownerId !== c.id && !biz.employees.includes(c.id)) continue;
    if (menuOf(world, biz.id)?.dish === dish) return true;
  }
  return false;
}

/** Does this citizen hold the thing a trend is about? */
export function holds(world: World, c: Citizen, kind: TrendKind, subject: string): boolean {
  switch (kind) {
    case 'possession':
      return (c.possessions ?? []).some((p) => p.productId === subject);
    case 'dish':
      return (progressState(world).takenUp[c.id] ?? []).includes(subject) || servesDish(world, c, subject);
    case 'hobby':
      return (c.tastes?.hobbies ?? []).includes(subject as never);
    case 'name':
      return givenName(c) === subject;
    case 'school':
      return c.school === subject;
    default:
      return false;
  }
}

/** Everybody in the city who holds it. */
export function holdersOf(world: World, kind: TrendKind, subject: string): CitizenId[] {
  return population(world).filter((c) => holds(world, c, kind, subject)).map((c) => c.id);
}

/** The share of the city that holds it, 0..1. */
export function cityShare(world: World, kind: TrendKind, subject: string): number {
  const heads = population(world).length;
  if (heads === 0) return 0;
  return holdersOf(world, kind, subject).length / heads;
}

// ---------------------------------------------------------------------------
// The index
// ---------------------------------------------------------------------------

/** Every trend still running, newest first. */
export function liveTrends(world: World): Trend[] {
  return progressState(world).trends.filter((t) => t.endedDay === null).reverse();
}

export function trendFor(world: World, kind: TrendKind, subject: string): Trend | null {
  return progressState(world).trends.find((t) => t.endedDay === null && t.kind === kind && t.subject === subject) ?? null;
}

/** Yesterday's reading: the same lagged number every shopkeeper in the city sees. */
export function trendShare(world: World, kind: TrendKind, subject: string): number {
  return trendFor(world, kind, subject)?.share ?? 0;
}

export function isRising(world: World, kind: TrendKind, subject: string): boolean {
  return trendFor(world, kind, subject)?.rising === true;
}

/**
 * Held by more than 60 % of the city. Read by whatever grants a social gain
 * for using or giving a thing: a saturated possession grants none, because it
 * reads as ordinary.
 */
export function isSaturated(world: World, kind: TrendKind, subject: string): boolean {
  const t = trendFor(world, kind, subject);
  const share = t ? t.share : cityShare(world, kind, subject);
  return share > SATURATION_SHARE;
}

/** The social gain a possession is still worth, 1 or 0. Nothing in between. */
export function givesSocialGain(world: World, productId: string): boolean {
  return !isSaturated(world, 'possession', productId);
}

/**
 * What a shop can clear a product at against its shelf price: up to 40 % over
 * while it is rising, because buyers are paying for belonging, and nothing at
 * all once it has saturated.
 */
export function trendPriceMultiplier(world: World, productId: string): number {
  const t = trendFor(world, 'possession', productId);
  if (!t || !t.rising) return 1;
  const room = clamp((SATURATION_SHARE - t.share) / SATURATION_SHARE, 0, 1);
  return 1 + TREND_PRICE_PREMIUM * room;
}

/** The dish the city is talking about, or null. Custom follows whoever serves it. */
export function trendingDish(world: World): string | null {
  const dishes = liveTrends(world).filter((t) => t.kind === 'dish');
  if (dishes.length === 0) return null;
  return dishes.sort((a, b) => b.share - a.share || a.subject.localeCompare(b.subject))[0].subject;
}

/**
 * What parents weigh a name by (`start_family`). One at no fashion at all,
 * more while the name is in the city's mouth. Reflex parents take the
 * weighting; free minds name a child what they like.
 */
export function nameWeight(world: World, name: string): number {
  const s = progressState(world);
  const trend = s.trends.find((t) => t.kind === 'name' && t.subject === name);
  if (!trend) return 1;
  const age = trend.endedDay === null ? 0 : world.day - trend.endedDay;
  if (age > NAME_MEMORY_DAYS) return 1;
  const fade = 1 - age / NAME_MEMORY_DAYS;
  return 1 + 3 * clamp(trend.share, 0, 1) * fade;
}

/** Every name the city is fond of at the moment, heaviest first. */
export function nameWeights(world: World): { name: string; weight: number }[] {
  return progressState(world).trends
    .filter((t) => t.kind === 'name')
    .map((t) => ({ name: t.subject, weight: nameWeight(world, t.subject) }))
    .filter((r) => r.weight > 1)
    .sort((a, b) => b.weight - a.weight || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Finding one
// ---------------------------------------------------------------------------

/** Everything the city could conceivably be fond of, by kind. */
function candidates(world: World): { kind: TrendKind; subject: string }[] {
  const out: { kind: TrendKind; subject: string }[] = [];
  for (const id of PRODUCT_IDS) out.push({ kind: 'possession', subject: id });
  for (const d of DISHES) out.push({ kind: 'dish', subject: d.id });
  for (const h of HOBBIES) out.push({ kind: 'hobby', subject: h });
  for (const s of SCHOOLS) out.push({ kind: 'school', subject: s });
  const names = new Set<string>();
  for (const c of population(world)) names.add(givenName(c));
  for (const n of [...names].sort()) if (n) out.push({ kind: 'name', subject: n });
  return out;
}

/** Are three of the holders friends of one another? That is the whole of the seeding rule. */
export function threeFriendsHold(world: World, holders: CitizenId[]): boolean {
  if (holders.length < TREND_SEED_FRIENDS) return false;
  const set = new Set(holders);
  for (const id of holders) {
    let among = 0;
    for (const friend of friendsOf(world, id)) {
      if (set.has(friend)) among++;
      if (among >= TREND_SEED_FRIENDS - 1) return true;
    }
  }
  return false;
}

/**
 * The morning's look at what people are holding. A subject three friends hold,
 * that under a third of the city holds, becomes a trend — and nobody decided
 * that but the three of them.
 */
export function detectTrends(world: World): Trend[] {
  const s = progressState(world);
  const found: Trend[] = [];
  const live = s.trends.filter((t) => t.endedDay === null).length;
  if (live >= MAX_TRENDS) return found;
  for (const { kind, subject } of candidates(world)) {
    if (s.trends.some((t) => t.endedDay === null && t.kind === kind && t.subject === subject)) continue;
    const holders = holdersOf(world, kind, subject);
    if (holders.length < TREND_SEED_FRIENDS) continue;
    const share = cityShare(world, kind, subject);
    if (share >= TREND_SEED_SHARE) continue;
    if (!threeFriendsHold(world, holders)) continue;
    const trend: Trend = {
      id: progressId(world, 'tr'), kind, subject, sinceDay: world.day,
      share, previousShare: 0, rising: true, peakShare: share, endedDay: null,
    };
    s.trends.push(trend);
    found.push(trend);
    emit(world, TREND_EVENT, `${describeSubject(kind, subject)} is catching on: ${holders.length} people, and three of them friends.`,
      holders.slice(0, 3), 0.4, { trend: trend.id, kind, subject, share });
    if (s.trends.filter((t) => t.endedDay === null).length >= MAX_TRENDS) break;
  }
  return found;
}

/** What a trend is about, in words. */
export function describeSubject(kind: TrendKind, subject: string): string {
  switch (kind) {
    case 'possession': return PRODUCTS[subject]?.name ?? subject;
    case 'dish': return DISHES.find((d) => d.id === subject)?.name ?? subject;
    case 'hobby': return `${subject.charAt(0).toUpperCase()}${subject.slice(1)}`;
    case 'name': return `The name ${subject}`;
    case 'school': return `The ${subject}`;
    default: return subject;
  }
}

// ---------------------------------------------------------------------------
// Taking it up
// ---------------------------------------------------------------------------

/** Does this thing sit with what the citizen already likes? */
function matchesTastes(c: Citizen, kind: TrendKind, subject: string): boolean {
  const tastes = c.tastes;
  if (!tastes) return false;
  if (kind === 'hobby') return tastes.hobbies.includes(subject as never);
  if (kind === 'possession') {
    const product = PRODUCTS[subject];
    if (!product) return false;
    return tastes.categories.includes(product.category) || (product.hobby !== null && tastes.hobbies.includes(product.hobby));
  }
  return false;
}

/**
 * The chance this citizen takes it up today, on the terms in the header. It is
 * a public number: anybody can work out why a thing is spreading.
 */
export function takeUpChance(world: World, c: Citizen, trend: Trend): number {
  const friends = friendsOf(world, c.id);
  let holding = 0;
  let bestRepute = 0;
  for (const id of friends) {
    const f = world.citizens[id];
    if (!f || !holds(world, f, trend.kind, trend.subject)) continue;
    holding++;
    bestRepute = Math.max(bestRepute, reputeOf(world, id));
  }
  const friendShare = friends.length > 0 ? holding / friends.length : 0;
  const saturation = Math.max(0, trend.share - SATURATION_SHARE) / SATURATION_BAND;
  const p = TAKE_UP_BASE
    + TAKE_UP_FRIENDS * friendShare
    + TAKE_UP_REPUTE * (bestRepute / 1000)
    + (matchesTastes(c, trend.kind, trend.subject) ? TAKE_UP_TASTE : 0)
    - TAKE_UP_SATURATION * saturation;
  return clamp(p * trendReachMultiplier(world), 0, 1);
}

/** Put a subject at the top of a reflex citizen's shopping list. */
function pushWant(c: Citizen, subject: string): boolean {
  if (!Array.isArray(c.wants)) c.wants = [];
  if (c.wants.includes(subject)) return false;
  if ((c.possessions ?? []).length >= MAX_POSSESSIONS) return false;
  c.wants.unshift(subject);
  if (c.wants.length > MAX_WANTS) c.wants.length = MAX_WANTS;
  return true;
}

/** A want a reflex mind keeps in front of it. Free minds read the same index and do as they please. */
function want(world: World, c: Citizen, trend: Trend): boolean {
  const s = progressState(world);
  if (trend.kind === 'possession') {
    const list = (s.takenUp[c.id] ??= []);
    if (!list.includes(trend.subject)) list.push(trend.subject);
    return pushWant(c, trend.subject);
  }
  if (trend.kind === 'dish') {
    const list = (s.takenUp[c.id] ??= []);
    if (list.includes(trend.subject)) return false;
    list.push(trend.subject);
    return true;
  }
  // A hobby, a name and a school are not shopping. They are chosen by acts a
  // citizen takes in its own hour — `start_family`, `adopt_school`, a life
  // lived — so the index reads them and the roll leaves them alone.
  return false;
}

/**
 * A want a reflex citizen took up and has not acted on yet, put back at the
 * top of the list.
 *
 * The city rewrites every reflex want list each morning from what a citizen
 * can afford and already likes (`society/tastes.ts refreshWantsDaily`), so a
 * want that came from a trend would last exactly until the next rollover
 * whatever order the morning ran in. What somebody wanted yesterday because
 * their friends had one they still want today, so the register keeps it and
 * puts it back — until they buy one, or the moment passes.
 */
export function reassertWants(world: World): void {
  const s = progressState(world);
  for (const c of population(world)) {
    if (c.brain !== 'reflex') continue;
    const taken = s.takenUp[c.id];
    if (!taken || taken.length === 0) continue;
    const keep: string[] = [];
    for (const subject of taken) {
      const isProduct = !!PRODUCTS[subject];
      if (isProduct && holds(world, c, 'possession', subject)) continue;    // they bought one
      const trend = trendFor(world, isProduct ? 'possession' : 'dish', subject);
      if (!trend) continue;                                                 // the moment passed
      keep.push(subject);
      if (isProduct) pushWant(c, subject);
    }
    if (keep.length > 0) s.takenUp[c.id] = keep;
    else delete s.takenUp[c.id];
  }
}

/**
 * A day of catching on. Every live trend walks one step along the city's
 * friendships, and what it moves is a want list.
 */
export function spreadTrends(world: World): number {
  reassertWants(world);
  let taken = 0;
  for (const trend of liveTrends(world)) {
    for (const c of population(world)) {
      if (c.brain !== 'reflex') continue;
      if (holds(world, c, trend.kind, trend.subject)) continue;
      if (!chance(world, takeUpChance(world, c, trend))) continue;
      if (!want(world, c, trend)) continue;
      taken++;
      remember(world, c.id, 'social', `${describeSubject(trend.kind, trend.subject)} is what people have at the moment.`);
    }
  }
  return taken;
}

// ---------------------------------------------------------------------------
// The morning's reading
// ---------------------------------------------------------------------------

/**
 * Yesterday's shares become today's. A trend that has saturated is still a
 * trend — that is the point of it — and one that has fallen away and stopped
 * rising is over.
 */
export function refreshTrends(world: World): void {
  const s = progressState(world);
  for (const t of s.trends) {
    if (t.endedDay !== null) continue;
    const share = cityShare(world, t.kind, t.subject);
    t.previousShare = t.share;
    t.share = Math.round(share * 1000) / 1000;
    t.rising = t.share > t.previousShare;
    t.peakShare = Math.max(t.peakShare, t.share);
    if (t.share <= TREND_FLOOR && !t.rising && world.day > t.sinceDay) {
      t.endedDay = world.day;
      emit(world, TREND_EVENT, `${describeSubject(t.kind, t.subject)} is over; it peaked at ${Math.round(t.peakShare * 100)} % of the city.`,
        [], 0.3, { trend: t.id, kind: t.kind, subject: t.subject, peak: t.peakShare });
      continue;
    }
    if (t.share > SATURATION_SHARE && t.previousShare <= SATURATION_SHARE) {
      emit(world, TREND_EVENT,
        `${describeSubject(t.kind, t.subject)} is everywhere now: ${Math.round(t.share * 100)} % of the city has it, and having it says nothing.`,
        [], 0.5, { trend: t.id, kind: t.kind, subject: t.subject, share: t.share, saturated: true });
    }
  }
  // Trends the city has forgotten entirely are dropped, oldest first.
  const dead = s.trends.filter((t) => t.endedDay !== null && world.day - t.endedDay > NAME_MEMORY_DAYS);
  if (dead.length > 0) s.trends = s.trends.filter((t) => !dead.includes(t));
}

/** The whole day of it: yesterday's shares, then what is new, then who took it up. */
export function dailyTrends(world: World): void {
  refreshTrends(world);
  detectTrends(world);
  spreadTrends(world);
}

// ---------------------------------------------------------------------------
// What a citizen sees
// ---------------------------------------------------------------------------

export interface ObservedTrend {
  kind: TrendKind;
  subject: string;
  /** Yesterday's share of the city, 0..1. */
  share: number;
  rising: boolean;
}

/** The `trends` block: the same lagged index for everybody, shopkeepers included. */
export function trendsObservation(world: World): ObservedTrend[] {
  return liveTrends(world)
    .map((t) => ({ kind: t.kind, subject: t.subject, share: t.share, rising: t.rising }))
    .sort((a, b) => b.share - a.share || a.subject.localeCompare(b.subject));
}

/** One line for the Chronicle. */
export function trendsReport(world: World): string {
  const live = liveTrends(world);
  if (live.length === 0) return 'Nothing much is catching on.';
  const top = live.slice().sort((a, b) => b.share - a.share)[0];
  return `${describeSubject(top.kind, top.subject)}: ${Math.round(top.share * 100)} % of the city${top.rising ? ' and rising' : ''}.`;
}

/** Every kind of thing a trend can be about, for a dashboard that lists them. */
export const KINDS: readonly TrendKind[] = TREND_KINDS;

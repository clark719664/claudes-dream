/**
 * The schedule of restricted goods (`docs/UNDERWORLD.md` §1).
 *
 * Every city keeps a schedule: what it will not admit, will not let out, or
 * will only move through a licensed hand. It is **ordinary law** — passed by
 * that city's own procedure, amended by it, repealed by it — and the founding
 * schedule below is where the six begin, not where they stay. Nothing in this
 * file decides what a city ought to restrict; it records what one did.
 *
 * A restriction is a price before it is a crime. `prices.ts` reads the severity
 * this file returns straight into the black price, which is why a council that
 * restricts a good it cannot supply has funded its own opposition — and why the
 * Chronicle can print the number the morning after the vote.
 */
import { GOODS } from '../types.ts';
import type { CitizenId, Good, World } from '../types.ts';
import { PRODUCTS } from '../data/catalogue.ts';
import { emit, remember } from '../sim/events.ts';
import type {
  CityKey, Restriction, RestrictionDirection, RestrictionSeverity, UnderworldQuestion,
} from './state.ts';
import { CITY_KEYS, HOME_CITY, cityName, underworldState } from './state.ts';

/**
 * A catalogue tool at or above this price is **master-grade**: the rating a
 * gate can police, and the leg of erasure (`JUSTICE.md` §3) that a doorway can
 * actually take away. Below it a tool is a working tool and nobody's business.
 */
export const MASTER_GRADE_PRICE = 60;

/** Days an amnesty runs when a council declares one. */
export const AMNESTY_DAYS = 7;

/**
 * A lot of lumens at or above this is a holding a schedule can name; below it,
 * it is what somebody has in their pocket, and no city searches pockets.
 */
export const BEARER_FLOOR = 200;

/** One load, as the schedule reads it. A lot of lumens has no good and no product. */
export interface CargoLine {
  good: Good | null;
  productId: string | null;
  qty: number;
  /** Lumens the whole lot is worth. */
  value: number;
  /** A certificate of origin, which is what uncertified salvage does not have. */
  certified?: boolean;
  /** A guild seal, which is what lets a master-grade tool leave Cinderhold. */
  sealed?: boolean;
}

function restriction(spec: Partial<Restriction> & { id: string; city: CityKey; subject: string; severity: RestrictionSeverity }): Restriction {
  return {
    direction: 'either', goods: [], products: [], categories: [],
    licensed: false, needsCertificate: false, masterGradeOnly: false,
    money: false, minValue: 0, undeclaredOnly: false,
    sinceDay: 0, proposalId: null, liftedDay: null, ...spec,
  };
}

/**
 * The founding schedules of `UNDERWORLD.md` §1, and the reason each city gives.
 * Marrowgate registers rather than restricts and still reads manifests, because
 * its sales tax is real; the Verge does neither, and its schedule is empty.
 */
export function foundingSchedule(city: CityKey): Restriction[] {
  const untaxed = restriction({
    id: 'untaxed_goods', city, subject: 'untaxed goods — a load that does not match its manifest',
    severity: 1, undeclaredOnly: true,
  });
  switch (city) {
    case 'cinderhold':
      return [
        restriction({
          id: 'master_tools_unsealed', city, subject: 'master-grade tools leaving without a guild seal',
          severity: 2, direction: 'outbound', categories: ['tool'], masterGradeOnly: true, licensed: true,
        }),
        restriction({
          id: 'guild_patterns', city, subject: 'guild patterns in any form',
          severity: 3, goods: ['knowledge'],
        }),
        restriction({
          id: 'uncertified_salvage', city, subject: 'salvage components with no certificate of origin',
          severity: 2, goods: ['goods'], needsCertificate: true,
        }),
        restriction({
          id: 'foundry_tools', city, subject: 'Foundry tools above a working rating, carried outside a workplace',
          severity: 2, categories: ['tool'], masterGradeOnly: true,
        }),
        untaxed,
      ];
    case 'solene':
      return [
        restriction({
          id: 'capital_out', city, subject: 'capital above 500 ℓ a month leaving',
          severity: 2, direction: 'outbound', money: true, minValue: 500,
        }),
        restriction({
          id: 'private_stock_in', city, subject: 'private stock arriving for resale',
          severity: 2, direction: 'inbound', goods: [...GOODS],
        }),
        untaxed,
      ];
    case 'vantage':
      return [
        // A bearer instrument is a holding, not the coins in somebody's pocket:
        // the floor is what keeps a visitor's purse out of the schedule and a
        // fortune in it. Votes ride on shares, so an unregistered share is an
        // unregistered vote — which is why this one is a 3.
        restriction({
          id: 'bearer_instruments', city, subject: 'unregistered shares and bearer instruments',
          severity: 3, money: true, minValue: BEARER_FLOOR,
        }),
        restriction({
          id: 'unclear_capital', city, subject: 'inbound capital of unclear origin',
          severity: 2, direction: 'inbound', money: true, needsCertificate: true, minValue: BEARER_FLOOR,
        }),
        untaxed,
      ];
    case 'reverie':
      return [
        restriction({
          id: 'uncertified_salvage', city, subject: 'salvage components with no certificate of origin',
          severity: 2, goods: ['goods'], needsCertificate: true,
        }),
        restriction({
          id: 'foundry_tools', city, subject: 'Foundry tools above a working rating, carried outside a workplace',
          severity: 2, categories: ['tool'], masterGradeOnly: true,
        }),
        untaxed,
      ];
    case 'marrowgate':
      return [untaxed];
    default:
      return [];
  }
}

/** A city's schedule, seeded with its founding entries the first time it is read. */
export function scheduleOf(world: World, city: CityKey): Restriction[] {
  const s = underworldState(world);
  if (!s.schedule[city]) s.schedule[city] = foundingSchedule(city);
  return s.schedule[city];
}

/** Every schedule, seeded. What the whole Expanse will not admit today. */
export function schedules(world: World): Record<string, Restriction[]> {
  for (const city of CITY_KEYS) scheduleOf(world, city);
  return underworldState(world).schedule;
}

/** The live entries of a city's schedule: the ones no council has lifted. */
export function restrictionsFor(world: World, city: CityKey): Restriction[] {
  return scheduleOf(world, city).filter((r) => r.liftedDay === null);
}

/** Is this a master-grade line: a tool above a working rating? */
export function isMasterGrade(productId: string | null): boolean {
  if (!productId) return false;
  const p = PRODUCTS[productId];
  return !!p && p.basePrice >= MASTER_GRADE_PRICE;
}

function category(productId: string | null): string | null {
  return productId ? PRODUCTS[productId]?.category ?? null : null;
}

/** Does this entry name what is in this load at all? */
function names(r: Restriction, line: CargoLine): boolean {
  const isMoney = line.good === null && line.productId === null;
  if (r.money) return isMoney;
  if (isMoney) return false;
  const named = r.goods.length + r.products.length + r.categories.length;
  if (named === 0) return true;
  if (line.good && r.goods.includes(line.good)) return true;
  if (line.productId && r.products.includes(line.productId)) return true;
  const cat = category(line.productId);
  return !!cat && r.categories.includes(cat);
}

export interface CrossingContext {
  direction: RestrictionDirection;
  /** True where the load was declared at the gate on a manifest that matched it. */
  declared?: boolean;
}

/** Does this entry bite on this load, crossing this way? */
export function bites(r: Restriction, line: CargoLine, ctx: CrossingContext): boolean {
  if (r.liftedDay !== null) return false;
  if (r.direction !== 'either' && ctx.direction !== 'either' && r.direction !== ctx.direction) return false;
  if (r.undeclaredOnly && ctx.declared) return false;
  if (!names(r, line)) return false;
  if (r.minValue > 0 && line.value < r.minValue) return false;
  if (r.masterGradeOnly && !isMasterGrade(line.productId)) return false;
  if (r.needsCertificate && line.certified) return false;
  if (r.licensed && line.sealed) return false;
  return true;
}

/**
 * The entry a load answers to at a city's gate — the gravest one, where more
 * than one bites — or null where the schedule says nothing about it.
 */
export function restrictionOn(world: World, city: CityKey, line: CargoLine, ctx: CrossingContext): Restriction | null {
  let worst: Restriction | null = null;
  for (const r of restrictionsFor(world, city)) {
    if (!bites(r, line, ctx)) continue;
    if (!worst || r.severity > worst.severity) worst = r;
  }
  return worst;
}

/** How grave the restriction on a load is, 0 where there is none. */
export function restrictionSeverityOn(world: World, city: CityKey, line: CargoLine, ctx: CrossingContext): RestrictionSeverity | 0 {
  return restrictionOn(world, city, line, ctx)?.severity ?? 0;
}

/** True where holding this in this city is contraband at all (L27's question). */
export function isContraband(world: World, city: CityKey, line: CargoLine): boolean {
  return restrictionOn(world, city, line, { direction: 'either', declared: true }) !== null;
}

// ---------------------------------------------------------------------------
// Amending a schedule
// ---------------------------------------------------------------------------

/**
 * Add a line to a city's schedule. This is the enactment of a `restrict_good`
 * proposal and nothing else calls it: a council votes, and the schedule changes
 * the morning after. An entry with an id already in the schedule replaces it,
 * because a council amending its own line is the ordinary case.
 */
export function restrictGood(
  world: World, city: CityKey, spec: Partial<Restriction> & { id: string; subject: string; severity: RestrictionSeverity },
): Restriction {
  const list = scheduleOf(world, city);
  const entry: Restriction = {
    direction: 'either', goods: [], products: [], categories: [],
    licensed: false, needsCertificate: false, masterGradeOnly: false,
    money: false, minValue: 0, undeclaredOnly: false, proposalId: null,
    ...spec, city, sinceDay: world.day, liftedDay: null,
  };
  const at = list.findIndex((r) => r.id === entry.id);
  if (at >= 0) list[at] = entry; else list.push(entry);
  if (city === HOME_CITY) {
    emit(world, 'law', `The Council put ${entry.subject} on the schedule of restricted goods (severity ${entry.severity}).`,
      [], 0.6, { restriction: entry.id, severity: entry.severity, city });
  } else {
    emit(world, 'outer', `${cityName(city)} put ${entry.subject} on its schedule (severity ${entry.severity}).`,
      [], 0.4, { restriction: entry.id, severity: entry.severity, city });
  }
  return entry;
}

/** Strike a line out. What was contraband on Tuesday is a crate on Wednesday. */
export function liftRestriction(world: World, city: CityKey, id: string): Restriction | null {
  const entry = scheduleOf(world, city).find((r) => r.id === id && r.liftedDay === null);
  if (!entry) return null;
  entry.liftedDay = world.day;
  emit(world, city === HOME_CITY ? 'law' : 'outer',
    `${cityName(city)} struck ${entry.subject} from its schedule.`, [], 0.5, { restriction: id, city });
  return entry;
}

/**
 * An amnesty: for `AMNESTY_DAYS` a citizen may give up contraband, or be found
 * holding it, without being charged for the holding (`UNDERWORLD.md` §7). It
 * forgives nobody's smuggling and nothing anybody did to anybody: it is a door
 * held open for the citizen who bought in good faith off a shelf.
 */
export function declareAmnesty(world: World, days = AMNESTY_DAYS): number {
  const s = underworldState(world);
  const until = world.day + Math.max(1, Math.round(days));
  s.amnestyUntilDay = Math.max(s.amnestyUntilDay, until);
  emit(world, 'law', `The Council declared an amnesty on restricted goods until day ${s.amnestyUntilDay}: `
    + 'what is given up in that time is not charged.', [], 0.7, { until: s.amnestyUntilDay });
  return s.amnestyUntilDay;
}

// ---------------------------------------------------------------------------
// The questions this layer puts to a council
// ---------------------------------------------------------------------------

/**
 * File the question beside the roll of votes. A `Proposal` carries one number,
 * one law code and one citizen, and a schedule entry is a list of goods and a
 * direction — so the question lives here under the proposal's own id, exactly
 * as a zoning question does in `environment/state.ts`.
 */
export function tableUnderworldQuestion(world: World, spec: Omit<UnderworldQuestion, 'tabledDay' | 'settledDay'>): UnderworldQuestion {
  const q: UnderworldQuestion = { ...spec, tabledDay: world.day, settledDay: null };
  underworldState(world).questions[q.proposalId] = q;
  return q;
}

/** The question behind a proposal, if this layer put one there. */
export function underworldQuestion(world: World, proposalId: string): UnderworldQuestion | null {
  return underworldState(world).questions[proposalId] ?? null;
}

/**
 * Carry out a question the Council passed about the **schedule**. The Council
 * decides; this only does what it decided. Returns false where there was no
 * such question, it had already been carried out, or it is the one question
 * here that is not about goods at all: what to do with a caught agent is
 * `counter.ts enactSpyDisposition`, because it names a citizen and not a good.
 */
export function enactUnderworldQuestion(world: World, proposalId: string): boolean {
  const q = underworldQuestion(world, proposalId);
  if (!q || q.settledDay !== null) return false;
  switch (q.kind) {
    case 'restrict_good':
      q.settledDay = world.day;
      if (q.liftId) liftRestriction(world, q.city, q.liftId);
      else if (q.restriction) restrictGood(world, q.city, { ...q.restriction, id: q.restriction.id, proposalId });
      return true;
    case 'amnesty':
      q.settledDay = world.day;
      declareAmnesty(world, q.value > 0 ? q.value : AMNESTY_DAYS);
      return true;
    case 'customs_posts':
      q.settledDay = world.day;
      world.counters['customs:posts'] = Math.max(0, Math.round(q.value));
      emit(world, 'law', `The Council set the gates at ${Math.max(0, Math.round(q.value))} customs posts.`, [], 0.4,
        { posts: Math.max(0, Math.round(q.value)) });
      return true;
    default:
      return false;
  }
}

/** A one-line reading of a city's schedule, for an observation or the Chronicle. */
export function scheduleLine(world: World, city: CityKey): string {
  const live = restrictionsFor(world, city).filter((r) => !r.undeclaredOnly);
  if (live.length === 0) return `${cityName(city)} restricts nothing; it reads manifests and takes its duty.`;
  return `${cityName(city)} will not admit or let out: ${live.map((r) => `${r.subject} (${r.severity})`).join('; ')}.`;
}

/** Tell one citizen what the schedule says, in the words the charge sheet uses. */
export function tellSchedule(world: World, cId: CitizenId, city: CityKey): void {
  remember(world, cId, 'civic', scheduleLine(world, city));
}

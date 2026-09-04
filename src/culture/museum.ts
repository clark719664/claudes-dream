/**
 * The Museum — what the city decides to keep.
 *
 * The Museum buys nothing but masterpieces, at one price, out of the public
 * purse, and it never sells. A work it acquires stops belonging to its maker's
 * district and starts belonging to everybody: the doors are free, and a
 * citizen standing in the Archive may walk in whether or not the curator is at
 * their desk.
 *
 * The city cannot always afford what it admires. A Treasury that cannot pay
 * declines quietly and is offered the same work again tomorrow.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, Work, World } from '../types.ts';
import { MASTERPIECE_QUALITY } from '../data/metropolis.ts';
import { MUSEUM_PRICE } from '../data/jobs.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { takeFromMarket } from '../economy/market.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { recordMilestone } from '../identity/goals.ts';

export const MUSEUM_BUILDING: BuildingId = 'museum';
/** What an hour among the collection is worth. */
export const VISIT_SOCIAL = 15;
export const VISIT_PURPOSE = 8;
/** What the city's regard is worth to the maker of an acquired work. */
export const ACQUISITION_REPUTATION = 5;
/** A masterpiece is worth this much to the Hall of Records, per point of quality. */
export const VALUE_PER_QUALITY = 10;

function fail(message: string): ActionResult { return { ok: false, message }; }

function museumIds(world: World): string[] {
  const w = world as { museum?: string[] };
  if (!Array.isArray(w.museum)) w.museum = [];
  return w.museum;
}

function works(world: World): Record<string, Work> {
  const w = world as { works?: Record<string, Work> };
  if (!w.works) w.works = {};
  return w.works;
}

/** The city's collection, in the order it was acquired. Stale ids are skipped. */
export function collection(world: World): Work[] {
  const book = works(world);
  const out: Work[] = [];
  for (const id of museumIds(world)) {
    const work = book[id];
    if (work) out.push(work);
  }
  return out;
}

export function inCollection(world: World, workId: string): boolean {
  return museumIds(world).includes(workId);
}

/**
 * Take a masterpiece into the collection and pay for it. Returns false — and
 * changes nothing — when the work is not good enough, is already held, or the
 * Treasury cannot find the price. A work whose maker has left the city is
 * still kept: there is simply nobody left to pay.
 */
export function acquire(world: World, workId: string): boolean {
  const work = works(world)[workId];
  if (!work) return false;
  if (work.quality < MASTERPIECE_QUALITY) return false;
  if (inCollection(world, workId)) return false;

  const maker = world.citizens[work.creatorId];
  const payable = !!maker && isPresent(world, maker);
  if (payable) {
    if (world.treasury.balance < MUSEUM_PRICE) return false;
    if (!transfer(world, 'treasury', maker.id, MUSEUM_PRICE, 'acquisition', `“${work.title}” for the Museum`)) return false;
  }

  museumIds(world).push(work.id);
  work.inMuseum = true;
  work.home = MUSEUM_BUILDING;
  const house = world.buildings[MUSEUM_BUILDING]?.name ?? 'the Museum';
  if (maker) {
    adjustReputation(world, maker, ACQUISITION_REPUTATION, `“${work.title}” entered the Museum`);
    recordMilestone(world, maker, `${maker.name}'s “${work.title}” entered the Museum's collection.`, 0.7);
    remember(world, maker.id, 'work', payable
      ? `${house} bought “${work.title}” for ${MUSEUM_PRICE} ℓ; it belongs to the city now.`
      : `${house} took “${work.title}” into the collection.`);
  }
  emit(world, 'museum',
    `${house} acquired “${work.title}”${maker ? ` by ${maker.name}` : ''} (quality ${work.quality})${payable ? ` for ${MUSEUM_PRICE} ℓ` : ''}.`,
    maker ? [maker.id] : [], 0.8,
    { workId: work.id, quality: work.quality, price: payable ? MUSEUM_PRICE : 0 });
  return true;
}

/** Is the curator at their desk? The doors open either way; the tours do not. */
export function curatorOnDuty(world: World): boolean {
  for (const job of Object.values(world.jobs)) {
    if (job.role !== 'curator' || !job.holderId) continue;
    const c = world.citizens[job.holderId];
    if (!c || !isPresent(world, c)) continue;
    if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) continue;
    if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) continue;
    if (c.district !== world.buildings[MUSEUM_BUILDING]?.district) continue;
    return true;
  }
  return false;
}

/**
 * An hour among the city's own things. Free — the collection belongs to
 * everybody — and better when the curator is there to talk about it.
 */
export function visitMuseum(world: World, cId: CitizenId): ActionResult {
  const c: Citizen | undefined = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot visit the Museum from the Watch House.');
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return fail('You cannot visit the Museum from the cells.');
  const house = world.buildings[MUSEUM_BUILDING];
  if (!house) return fail('Reverie has no Museum.');
  if (c.district !== house.district) return fail(`${house.name} is in ${world.districts[house.district]?.name ?? house.district}.`);
  if (house.damage >= 1) return fail(`${house.name} is shut for repairs.`);

  const held = collection(world);
  const culture = takeFromMarket(world, 'culture', 1);
  const guided = curatorOnDuty(world);
  const social = Math.round(VISIT_SOCIAL * (culture > 0 ? 1 : 0.5) * (guided ? 1.2 : 1));
  c.needs.social = clamp(c.needs.social + social, 0, 100);
  c.needs.purpose = clamp(c.needs.purpose + VISIT_PURPOSE, 0, 100);
  const what = held.length === 0
    ? 'the empty halls'
    : `${held.length === 1 ? 'the one thing' : `all ${held.length} of them`} the city has kept`;
  remember(world, cId, 'social', `You spent an hour at ${house.name} among ${what}.`);
  return { ok: true, message: `You walked ${house.name} (social +${social}, purpose +${VISIT_PURPOSE}); it holds ${held.length} ${held.length === 1 ? 'work' : 'works'}.` };
}

/** What the collection is worth, for the Hall of Records. */
export function museumValue(world: World): number {
  let sum = 0;
  for (const work of collection(world)) sum += work.quality * VALUE_PER_QUALITY;
  return Math.round(sum);
}

/** Morning: nothing to do but keep the record straight. */
export function dailyMuseum(world: World): void {
  const ids = museumIds(world);
  const book = works(world);
  const seen = new Set<string>();
  const kept: string[] = [];
  for (const id of ids) {
    const work = book[id];
    if (!work || seen.has(id)) continue;
    seen.add(id);
    work.inMuseum = true;
    work.home = MUSEUM_BUILDING;
    kept.push(id);
  }
  if (kept.length !== ids.length) ids.splice(0, ids.length, ...kept);
  for (const work of Object.values(book)) {
    if (work.inMuseum && !seen.has(work.id)) work.inMuseum = false;
  }
}

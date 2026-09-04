/**
 * Decrees — the one thing a Mayor may do without asking anybody.
 *
 * Once a cycle, and once only, the Mayor may act alone: forgive the day's
 * sales tax, put a district under curfew, pay relief out of the Treasury to
 * everybody in hardship, or — while a disaster is actually running — declare a
 * state of emergency that doubles what the city's public works can do.
 *
 * A decree is a fact about the city, in force until its day runs out and then
 * simply gone. It is spent from the Mayor's own hand: nothing here decides
 * whether to use it, and a Mayor who never issues one is doing nothing wrong.
 * The rest of the engine reads the decrees through the small questions below
 * — what the sales tax is today, whether this action is possible at this hour
 * in this district, how visible the Watch is, how fast loneliness gathers,
 * what a lumen of public works buys.
 */
import type { ActionResult, ActionType, Citizen, CitizenId, Decree, Disaster, DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, transfer } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { claimants } from '../society/chest.ts';

/** From dusk to dawn: a curfew covers the hours at or after the first and before the second. */
export const CURFEW_HOURS: [number, number] = [20, 6];
/** The most relief one citizen may be paid by a single decree. */
export const RELIEF_MAX = 40;
/** How long a state of emergency stands. */
export const EMERGENCY_DAYS = 3;
/** What public works buy while an emergency stands. */
export const EMERGENCY_WORKS_MULTIPLIER = 2;
/** How much more the Watch sees in a district under curfew. */
export const CURFEW_VISIBILITY = 0.2;
/** How fast the need for company gathers under curfew, as a multiple. */
export const CURFEW_SOCIAL_RELIEF = 0.5;
/** Decrees kept for the record. */
export const MAX_DECREES = 100;

/** What a citizen may still do in the small hours of a district under curfew. */
export const CURFEW_ALLOWED: readonly ActionType[] = [
  'idle', 'rest', 'eat', 'note', 'forget', 'write_diary', 'message', 'consume', 'use_item', 'appeal',
];

const DECREE_KINDS: readonly Decree['kind'][] = ['tax_holiday', 'curfew', 'relief', 'emergency'];

function fail(message: string): ActionResult { return { ok: false, message }; }

/** The city's decrees. An older save has none. */
function decreeList(world: World): Decree[] {
  const w = world as { decrees?: Decree[] };
  if (!w.decrees) w.decrees = [];
  return w.decrees;
}

function disasters(world: World): Disaster[] {
  return (world as { disasters?: Disaster[] }).disasters ?? [];
}

/** A disaster the city is still living through. */
function liveDisaster(world: World): Disaster | null {
  return disasters(world).find((d) => d.resolvedDay === null) ?? null;
}

/** Every decree still in force on the given day. */
export function activeDecrees(world: World, day: number = world.day): Decree[] {
  return decreeList(world).filter((d) => d.untilDay >= day && d.day <= day);
}

/**
 * The decree of a kind in force, or null. Name a district and only a decree
 * covering that district (or the whole city) answers; name none and any decree
 * of that kind does.
 */
export function decreeInForce(world: World, kind: Decree['kind'], district?: DistrictId): Decree | null {
  // Read straight off the book rather than through activeDecrees: this is
  // asked of every action of every citizen in every hour of the city.
  for (const d of decreeList(world)) {
    if (d.kind !== kind) continue;
    if (d.untilDay < world.day || d.day > world.day) continue;
    if (district !== undefined && d.district !== null && d.district !== district) continue;
    return d;
  }
  return null;
}

function isJailed(world: World, c: Citizen): boolean {
  return c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day;
}

/** The Mayor, in good standing, with this cycle's decree still unspent. */
export function mayDecree(world: World, c: Citizen): boolean {
  if (!c || !isPresent(world, c)) return false;
  const g = world.government;
  if (g.mayorId !== c.id) return false;
  if (c.standing !== 'good') return false;
  if (isJailed(world, c) || (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick)) return false;
  return g.decreeUsedCycle !== g.cycle;
}

// ---------------------------------------------------------------------------
// Issuing
// ---------------------------------------------------------------------------

/** Pay relief to everybody in hardship, pro rata when the Treasury cannot cover it all. */
function payRelief(world: World, mayor: Citizen, want: number): { paid: number; count: number; each: number } | string {
  const list = claimants(world).filter((r) => isPresent(world, r.citizen));
  if (list.length === 0) return 'Nobody in Reverie is in hardship today; there is nobody for relief to reach.';
  const treasury = Math.max(0, Math.floor(balanceOf(world, 'treasury')));
  if (treasury <= 0) return 'The Treasury is empty; there is nothing to pay relief with.';
  const each = Math.max(1, Math.min(want, RELIEF_MAX, Math.floor(treasury / list.length)));
  let paid = 0;
  let count = 0;
  for (const { citizen, hardship } of list) {
    if (!transfer(world, 'treasury', citizen.id, each, 'relief', `emergency relief (${hardship})`)) break;
    paid += each;
    count++;
    remember(world, citizen.id, 'money', `Mayor ${mayor.name} decreed relief: the Treasury paid you ${each} ℓ.`);
  }
  if (count === 0) return 'The Treasury could not pay the relief.';
  return { paid, count, each };
}

/**
 * The Mayor acts alone, once a cycle. The decree takes effect at once and the
 * whole city is told; what it is for is the Mayor's own business.
 */
export function decree(
  world: World, cId: CitizenId, kind: Decree['kind'], district?: DistrictId, value?: number,
): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const g = world.government;
  if (g.mayorId !== cId) return fail('Only the Mayor may issue an emergency decree.');
  if (c.standing !== 'good') return fail(`You cannot decree while ${c.standing}.`);
  if (isJailed(world, c)) return fail('You cannot decree from the cells.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot decree while detained.');
  if (g.decreeUsedCycle === g.cycle) return fail('You have already issued this cycle\'s decree.');
  if (!DECREE_KINDS.includes(kind)) return fail('There is no such decree.');

  // A decree that names no sum (or a nonsensical one) asks for as much as the
  // Charter allows; the Treasury decides what it can actually bear.
  const named = Number.isFinite(value) ? Math.round(value as number) : 0;
  const want = named > 0 ? named : RELIEF_MAX;
  let untilDay = world.day;
  let where: DistrictId | null = null;
  let amount = 0;
  let text: string;

  switch (kind) {
    case 'tax_holiday':
      text = `Mayor ${c.name} decreed a tax holiday: nothing is charged in sales tax today.`;
      break;
    case 'curfew': {
      if (!district || !world.districts[district]) return fail('A curfew must name a district of the city.');
      const open = (world as { openDistricts?: DistrictId[] }).openDistricts;
      if (open && open.length > 0 && !open.includes(district)) {
        return fail(`${world.districts[district].name} is not open to the city yet.`);
      }
      where = district;
      untilDay = world.day + 1;
      text = `Mayor ${c.name} put ${world.districts[district].name} under curfew from ${CURFEW_HOURS[0]}:00 until day ${untilDay}.`;
      break;
    }
    case 'relief': {
      const result = payRelief(world, c, want);
      if (typeof result === 'string') return fail(result);
      amount = result.each;
      text = `Mayor ${c.name} decreed relief: ${result.paid} ℓ from the Treasury, ${result.each} ℓ each to ${result.count} citizen${result.count === 1 ? '' : 's'} in hardship.`;
      break;
    }
    default: {
      const live = liveDisaster(world);
      if (!live) return fail('A state of emergency answers a disaster; the city is not living through one.');
      untilDay = world.day + EMERGENCY_DAYS;
      amount = EMERGENCY_WORKS_MULTIPLIER;
      text = `Mayor ${c.name} declared a state of emergency until day ${untilDay}: the ${live.kind.replace(/_/g, ' ')} is answered with double public works.`;
      break;
    }
  }

  const d: Decree = { kind, day: world.day, district: where, value: amount, untilDay, byId: cId };
  const list = decreeList(world);
  list.push(d);
  if (list.length > MAX_DECREES) list.splice(0, list.length - MAX_DECREES);
  g.decreeUsedCycle = g.cycle;
  emit(world, 'decree', text, [cId], 0.9, { kind, district: where, value: amount, untilDay });
  for (const id of world.order) {
    const other = world.citizens[id];
    if (other && isPresent(world, other)) remember(world, id, 'civic', text);
  }
  return { ok: true, message: text };
}

// ---------------------------------------------------------------------------
// What the rest of the city reads
// ---------------------------------------------------------------------------

/** The sales tax as it stands today: nothing at all during a tax holiday. */
export function salesTaxToday(world: World): number {
  return decreeInForce(world, 'tax_holiday') ? 0 : world.government.salesTax;
}

/** Is this one of the hours a curfew covers? */
export function inCurfewHours(hour: number): boolean {
  const [from, to] = CURFEW_HOURS;
  return from <= to ? hour >= from && hour < to : hour >= from || hour < to;
}

/** True when a curfew stops this citizen doing this, here, now. */
export function curfewBlocks(world: World, c: Citizen, actionType: ActionType): boolean {
  if (!c) return false;
  if (!decreeInForce(world, 'curfew', c.district)) return false;
  if (!inCurfewHours(world.hour)) return false;
  return !CURFEW_ALLOWED.includes(actionType);
}

/** How much more the Watch sees in a district under curfew. */
export function curfewVisibilityMod(world: World, d: DistrictId): number {
  return decreeInForce(world, 'curfew', d) ? CURFEW_VISIBILITY : 0;
}

/** How fast the need for company gathers for this citizen: half as fast behind a curfew. */
export function curfewSocialRelief(world: World, c: Citizen): number {
  if (!c) return 1;
  return decreeInForce(world, 'curfew', c.district) ? CURFEW_SOCIAL_RELIEF : 1;
}

/** What a lumen of public works buys today. */
export function emergencyWorksMultiplier(world: World): number {
  return decreeInForce(world, 'emergency') ? EMERGENCY_WORKS_MULTIPLIER : 1;
}

/** The decrees a citizen sees standing over the city. */
export function decreesObservation(world: World): { kind: Decree['kind']; district: DistrictId | null; untilDay: number }[] {
  return activeDecrees(world).map((d) => ({ kind: d.kind, district: d.district, untilDay: d.untilDay }));
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/**
 * Morning: a decree whose last day was yesterday has lapsed, and the city is
 * told. Relief is the exception — it is a payment made, not a state of
 * affairs, and nothing about it lapses.
 */
export function dailyDecrees(world: World): void {
  const list = decreeList(world);
  for (const d of list) {
    if (d.kind === 'relief') continue;
    if (d.untilDay !== world.day - 1) continue;
    const who = world.citizens[d.byId]?.name ?? 'The Mayor';
    const where = d.district ? ` in ${world.districts[d.district]?.name ?? d.district}` : '';
    emit(world, 'decree', `${who}'s ${d.kind.replace(/_/g, ' ')}${where} has lapsed.`, [d.byId], 0.3,
      { kind: d.kind, district: d.district, lapsed: true });
  }
  const cutoff = world.day - world.config.cycleDays;
  const keep = list.filter((d) => d.untilDay >= cutoff);
  if (keep.length !== list.length) (world as { decrees?: Decree[] }).decrees = keep;
}

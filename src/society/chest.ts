/**
 * The Community Chest: a charity kept at the Treasury. Citizens donate to it
 * (and are respected for it, the more so when they are not rich); each
 * morning it pays a hardship stipend to those with no home, a critical need
 * or nobody to look after them, until it runs dry; the Council may top it up
 * with a `charity` proposal. Every lumen moves through economy/treasury, so
 * the Chest is part of the audited money supply.
 */
import { NEEDS, clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { balanceOf, formatLumens, residentIds, transfer } from '../economy/treasury.ts';

/** The daily hardship stipend. */
export const STIPEND = 10;
/** One point of reputation per this many lumens given. */
export const REPUTATION_PER = 20;
/** Donors with less than this in the wallet earn double the respect. */
export const MODEST_WALLET = 200;
/** A donation this large is news. */
export const BIG_DONATION = 100;
/** Giving feels like doing something. */
export const DONOR_PURPOSE = 5;
/** A need below this is critical (mirrors citizens/citizen.ts CRITICAL_NEED). */
export const CRITICAL_NEED = 20;
/**
 * An empty Chest with claimants waiting is news the first morning it happens;
 * after that it is a standing condition, and the Chronicle is only reminded
 * of it this often (the morning edition has a city to report on). A day on
 * which the Chest happened to cover everyone does not make the next dry
 * morning fresh news: an empty purse every other day is the same poverty, not
 * a new one, and the edition has a city to report on.
 */
export const EMPTY_NOTICE_DAYS = 7;

export type Hardship = 'ward' | 'homeless' | 'critical need';

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

/** A citizen living in the city (not exiled, not departed). */
function presentCitizen(world: World, id: CitizenId): Citizen | null {
  const c = world.citizens[id];
  return c && c.standing !== 'exiled' && world.order.includes(id) ? c : null;
}

function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

export function chestBalance(world: World): number {
  return balanceOf(world, 'chest');
}

// ---------------------------------------------------------------------------
// Donations
// ---------------------------------------------------------------------------

/** Give lumens to the Chest: reputation +1 per 20 ℓ, doubled for a modest purse. */
export function donate(world: World, cId: CitizenId, amount: number): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (isDetained(world, c)) return fail('You cannot reach the Treasury from the Watch House.');
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('A donation must be a positive whole number of lumens.');
  if (c.wallet < amt) return fail(`You cannot give ${amt} ℓ to the Community Chest; you have ${c.wallet} ℓ.`);
  const modest = c.wallet < MODEST_WALLET;
  if (!transfer(world, cId, 'chest', amt, 'donation', `donation from ${c.name}`)) return fail('The donation could not be made.');

  const respect = Math.floor(amt / REPUTATION_PER) * (modest ? 2 : 1);
  const before = c.reputation;
  c.reputation = clamp(c.reputation + respect, 0, 100);
  const gained = Math.round(c.reputation - before);
  c.needs.purpose = clamp(c.needs.purpose + DONOR_PURPOSE, 0, 100);

  const pot = chestBalance(world);
  remember(world, cId, 'money', `You gave ${amt} ℓ to the Community Chest${gained > 0 ? ` (reputation +${gained})` : ''}; it now holds ${pot} ℓ.`);
  emit(world, 'donation', `${c.name} gave ${amt} ℓ to the Community Chest${modest ? ' from a modest purse' : ''}; the Chest holds ${formatLumens(pot)}.`,
    [cId], amt >= BIG_DONATION ? 0.6 : 0.3, { amount: amt, chest: pot, modest });
  return ok(`You gave ${amt} ℓ to the Community Chest${gained > 0 ? ` (reputation +${gained})` : ''}; it now holds ${pot} ℓ.`);
}

// ---------------------------------------------------------------------------
// Stipends
// ---------------------------------------------------------------------------

/** A child with nobody at home: a guardian appointed, or no parent left in the city. */
export function isWard(world: World, c: Citizen): boolean {
  if (c.lifeStage !== 'child') return false;
  if (c.guardianId !== null) return true;
  return !c.family.parents.some((p) => presentCitizen(world, p));
}

/** Why a citizen qualifies for the stipend today, or null. */
export function hardshipOf(world: World, c: Citizen): Hardship | null {
  if (isWard(world, c)) return 'ward';
  if (c.homeTier === 0) return 'homeless';
  if (NEEDS.some((n) => c.needs[n] < CRITICAL_NEED)) return 'critical need';
  return null;
}

/** Today's claimants, neediest first: wards, then the poorest; ties by id so the order is stable. */
export function claimants(world: World): { citizen: Citizen; hardship: Hardship }[] {
  const rows: { citizen: Citizen; hardship: Hardship }[] = [];
  for (const id of residentIds(world)) {
    const c = world.citizens[id];
    const hardship = hardshipOf(world, c);
    if (hardship) rows.push({ citizen: c, hardship });
  }
  const rank = (h: Hardship) => (h === 'ward' ? 0 : 1);
  return rows.sort((a, b) => rank(a.hardship) - rank(b.hardship) || a.citizen.wallet - b.citizen.wallet || a.citizen.id.localeCompare(b.citizen.id));
}

/** Morning: a stipend to each claimant while the Chest lasts; an empty Chest with claimants waiting is news. */
export function dailyChest(world: World): void {
  const list = claimants(world);
  if (list.length === 0) return;
  let paid = 0;
  let count = 0;
  for (const { citizen, hardship } of list) {
    const amt = Math.min(STIPEND, chestBalance(world));
    if (amt <= 0) break;
    if (!transfer(world, 'chest', citizen.id, amt, 'stipend', `hardship stipend (${hardship})`)) break;
    paid += amt;
    count++;
    remember(world, citizen.id, 'money', `The Community Chest paid you a hardship stipend of ${amt} ℓ (${hardship}).`);
  }
  const unpaid = list.length - count;
  if (count > 0) {
    emit(world, 'paid', `The Community Chest paid ${count} hardship stipend${count === 1 ? '' : 's'} (${formatLumens(paid)}); ${formatLumens(chestBalance(world))} remain.`,
      list.slice(0, count).map((r) => r.citizen.id), 0.1, { paid, count, chest: chestBalance(world) });
  }
  if (unpaid > 0) {
    const last = world.counters.chestEmptyNoticeDay;
    if (last === undefined || world.day - last >= EMPTY_NOTICE_DAYS) {
      world.counters.chestEmptyNoticeDay = world.day;
      emit(world, 'system', `The Community Chest is empty: ${unpaid} citizen${unpaid === 1 ? '' : 's'} in hardship went without a stipend today.`,
        list.slice(count).map((r) => r.citizen.id), 0.5, { unpaid, chest: chestBalance(world) });
    }
  }
}

// ---------------------------------------------------------------------------
// The Council's charity
// ---------------------------------------------------------------------------

/**
 * A passed `charity` proposal: `value` lumens from the Treasury into the
 * Chest, as far as the Treasury can go. Returns the sentence the Council's
 * decision is announced with (government/council.ts emits it).
 */
export function enactCharity(world: World, value: number): string {
  const wanted = Number.isFinite(value) ? Math.max(0, Math.round(value)) : 0;
  const amount = Math.min(wanted, Math.max(0, Math.floor(world.treasury.balance)));
  if (amount <= 0 || !transfer(world, 'treasury', 'chest', amount, 'donation', 'Council charity grant')) {
    return `The Treasury could spare nothing for the Community Chest (it holds ${formatLumens(chestBalance(world))}).`;
  }
  const short = amount < wanted ? ', all the Treasury could spare' : '';
  return `${formatLumens(amount)} moves from the Treasury to the Community Chest${short}; the Chest now holds ${formatLumens(chestBalance(world))}.`;
}

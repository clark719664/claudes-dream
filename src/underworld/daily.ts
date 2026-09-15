/**
 * The underworld's morning (`docs/UNDERWORLD.md` §§2–6).
 *
 * Everything here is bookkeeping that follows from what citizens did yesterday:
 * the gates are staffed from the crossings there were, retainers are paid or
 * they lapse, secrets go stale, warnings run out, empty shelves push the black
 * price up, and the detectives who were assigned to something work it a day
 * further. Nothing in this file decides anything a citizen could have decided.
 */
import { GOODS } from '../types.ts';
import type { World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { memo } from '../util/memo.ts';
import { WAVE_WINDOW_TICKS, rosterCustoms } from './customs.ts';
import { payRetainers } from './espionage.ts';
import { workShelves, workTraces } from './counter.ts';
import { SUSPICION_THRESHOLD, blackPrice, daysBare, suspicionOf } from './prices.ts';
import { restrictionsFor } from './schedule.ts';
import { HOME_CITY, underworldState } from './state.ts';

/** Rows this layer keeps before the oldest are forgotten. */
export const CASING_DAYS = 28;
export const TRACE_DAYS = 28;
export const DECOY_DAYS = 56;
/** A fence's name fades by one a cycle, if they keep their hands still. */
export const NOTORIETY_FADE = 1;

/** Days the Bazaar has held no stock, counted per good, for the black price. */
function countBareShelves(world: World): void {
  const s = underworldState(world);
  for (const good of GOODS) {
    const mg = world.market?.goods?.[good];
    if (!mg) continue;
    s.bare[good] = mg.stock <= 0 ? (s.bare[good] ?? 0) + 1 : 0;
  }
}

/** Secrets that have gone stale, retainers that have run out, papers gone cold. */
function forgetWhatIsStale(world: World): void {
  const s = underworldState(world);
  const cycle = Math.max(1, world.config.cycleDays);
  s.secrets = s.secrets.filter((x) => x.expiresDay === null || x.expiresDay > world.day);
  s.casings = s.casings.filter((k) => world.day - k.day <= CASING_DAYS);
  // A trail goes cold: a trace nobody worked in a cycle is not evidence any more.
  s.traces = s.traces.filter((t) => world.day - t.day <= TRACE_DAYS);
  s.decoys = s.decoys.filter((d) => world.day - d.day <= DECOY_DAYS);
  s.gateBans = s.gateBans.filter((b) => b.untilDay + CASING_DAYS > world.day);
  s.retainers = s.retainers.filter((r) => r.status !== 'ended' || world.day - r.offeredDay <= cycle);
  for (const [building, until] of Object.entries(s.warned)) {
    if (until <= world.day) delete s.warned[building];
  }
  for (const a of s.assignments) {
    const detective = world.citizens[a.detectiveId];
    if (a.endedDay === null && (!detective || detective.standing === 'exiled')) a.endedDay = world.day;
  }
  s.assignments = s.assignments.filter((a) => a.endedDay === null || world.day - a.endedDay <= cycle);
  forgetCounters(world);
}

/**
 * The two counters this layer keeps beside the register: an hour an officer
 * waved somebody through, and the evidence a shelf has accrued. A wave older
 * than a day sits beside nothing, and a shelf that has stopped undercutting a
 * lawful landing has nothing left to accrue.
 */
function forgetCounters(world: World): void {
  for (const key of Object.keys(world.counters)) {
    if (key.startsWith('waved:')) {
      if (world.tick - (world.counters[key] ?? 0) > WAVE_WINDOW_TICKS) delete world.counters[key];
      continue;
    }
    if (!key.startsWith('shelfEvidence:')) continue;
    const [, businessId, productId] = key.split(':');
    const b = world.businesses[businessId];
    const entry = b?.shelf?.[productId];
    if (!b || b.dissolvedDay !== null || !entry || entry.qty <= 0 || suspicionOf(world, productId, entry.price) < SUSPICION_THRESHOLD) {
      delete world.counters[key];
    }
  }
}

/** A name known is known, but a hand kept still is forgotten a little each cycle. */
function fadeNotoriety(world: World): void {
  const cycle = Math.max(1, world.config.cycleDays);
  if (world.day % cycle !== 0) return;
  const s = underworldState(world);
  for (const [id, n] of Object.entries(s.notoriety)) {
    const left = n - NOTORIETY_FADE;
    if (left > 0) s.notoriety[id] = left;
    else delete s.notoriety[id];
  }
}

/**
 * **Restriction funds its opposition**, and this is the line that says so. A
 * city can have the restriction or the cheap good, not both, and the number is
 * arithmetic on top of the schedule its own council wrote.
 */
export function blackPriceStory(world: World): string | null {
  return memo(world, 'underworld:blackPriceStory', () => blackPriceStoryNow(world));
}

function blackPriceStoryNow(world: World): string | null {
  const live = restrictionsFor(world, HOME_CITY).filter((r) => !r.undeclaredOnly && r.goods.length > 0);
  if (live.length === 0) return null;
  let worst: { good: string; black: number; anchor: number } | null = null;
  for (const r of live) {
    for (const good of r.goods) {
      const black = blackPrice(world, good, HOME_CITY);
      const anchor = Math.max(1, world.market?.goods?.[good]?.price ?? 1);
      if (!worst || black - anchor > worst.black - worst.anchor) worst = { good, black, anchor };
    }
  }
  if (!worst || worst.black <= worst.anchor) return null;
  return `What the schedule keeps out of Reverie is being sold in it at ${worst.black} ℓ against a shelf price of `
    + `${worst.anchor} ℓ: the restriction on ${worst.good} is worth ${worst.black - worst.anchor} ℓ a unit to whoever runs it.`;
}

/**
 * The whole layer's rollover, in the order the day happens: the gates are
 * staffed, handlers pay, the register forgets what has gone cold, the shelves
 * are counted, and the detectives who were put on something work it.
 */
export function dailyUnderworld(world: World): void {
  const s = underworldState(world);
  s.crossingsYesterday = s.crossingsToday;
  s.crossingsToday = 0;
  s.rosterDay = -1;
  rosterCustoms(world);
  payRetainers(world);
  forgetWhatIsStale(world);
  fadeNotoriety(world);
  countBareShelves(world);
  workTraces(world);
  workShelves(world);

  const story = blackPriceStory(world);
  if (story) emit(world, 'price', story, [], 0.5, { blackMarket: true });
  const bare = GOODS.filter((g) => daysBare(world, g) >= 7);
  if (bare.length > 0) {
    emit(world, 'shortage', `The Bazaar has held no ${bare.join(', ')} for a week; whatever is being sold is being `
      + 'sold somewhere else, at somebody else\'s price.', [], 0.5, { bare });
  }
}

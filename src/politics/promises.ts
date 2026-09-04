/**
 * Promises — what a platform turns into once its author is in office.
 *
 * A platform is four positions between 0 and 1: how much tax the city should
 * take, how large the dividend should be, how high the wage floor should
 * stand, how strict the law should be. The city's actual settings can be read
 * the same way (`positionOf`), so the day a candidate is nominated or takes
 * office the two readings can be laid side by side. Wherever they differ by
 * more than PROMISE_MARGIN, that candidate has made a promise.
 *
 * From then on the promise keeps itself: if the setting moves the way the
 * platform said, it is **kept**; if it moves the other way, it is **broken**;
 * until it moves it stays **open**. Nothing is stored but the day and the
 * readings of that day — the promise itself is read back out of the platform
 * whenever anybody asks, so a save from before this layer simply has nobody
 * who has promised anything.
 *
 * The city notices once: a broken promise costs its author reputation and is
 * announced, a kept one pays. The rest is left to the voters, who are told
 * what happened and make up their own minds (`politics/approval.ts` reads
 * `keptShare`, and every citizen reads the Chronicle).
 */
import { clamp } from '../types.ts';
import type { Citizen, CitizenId, LawCode, Platform, World } from '../types.ts';
import { LAWS } from '../data/laws.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';

/** How far a platform must sit from the city's settings before it is a promise. */
export const PROMISE_MARGIN = 0.15;
/** How far the setting must actually move before the promise is kept or broken. */
export const PROMISE_MOVE = PROMISE_MARGIN / 2;

/**
 * Named PolicyPromise, never `Promise`: the global type must not be shadowed.
 */
export interface PolicyPromise {
  holderId: CitizenId;
  field: keyof Platform;
  wanted: number;
  madeDay: number;
  state: 'kept' | 'broken' | 'open';
}

export const PLATFORM_FIELDS: readonly (keyof Platform)[] = ['tax', 'dividend', 'minWage', 'strictness'];

/** Words for a promise, in the direction it was made. */
export const PROMISE_WORDS: Record<keyof Platform, { up: string; down: string; noun: string }> = {
  tax: { up: 'raise income tax', down: 'cut income tax', noun: 'income tax' },
  dividend: { up: 'raise the dividend', down: 'cut the dividend', noun: "the citizen's dividend" },
  minWage: { up: 'raise the minimum wage', down: 'lower the minimum wage', noun: 'the minimum wage' },
  strictness: { up: 'toughen the law', down: 'soften the law', noun: 'the severity of the law' },
};

/**
 * A platform in words, so a manifesto can be printed and read rather than
 * looked up in four numbers. It states positions and nothing else: no
 * argument, no advice (`docs/PRINCIPLES.md` §2).
 */
const PLATFORM_WORDS: Record<keyof Platform, [low: string, middle: string, high: string]> = {
  tax: ['a light tax', 'the tax the city has', 'a heavy tax'],
  dividend: ['a lean dividend', 'the dividend the city has', 'a generous dividend'],
  minWage: ['a low wage floor', 'the wage floor the city has', 'a high wage floor'],
  strictness: ['a lenient law', 'the law as it stands', 'a strict law'],
};

/** "a light tax, a lean dividend, a high wage floor and a strict law" */
export function platformInWords(platform: Platform | null | undefined): string {
  const stance = (x: number): 0 | 1 | 2 => {
    const v = Number.isFinite(x) ? clamp(x, 0, 1) : 0.5;
    return v < 1 / 3 ? 0 : v > 2 / 3 ? 2 : 1;
  };
  const p = platform ?? { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0.5 };
  const parts = PLATFORM_FIELDS.map((field) => PLATFORM_WORDS[field][stance(p[field])]);
  return `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`;
}

const MAX_INCOME_TAX = 0.5;
const MAX_DIVIDEND = 60;
/**
 * The band the Charter leaves the Council for the wage floor, and the scale
 * every platform is read against: a platform of 0.5 means the middle of this
 * band, not the middle of anything a councillor imagines. The ceiling is set
 * where it is because the Bazaar prices every made good at what it costs to
 * make at the wage floor (`economy/market.ts anchorPrice`), so the wage is
 * also the city's price policy: 20 ℓ is a shade under twice what a shift's
 * output is worth at founding prices, and the index reaches about 1.7 there.
 * A band any wider would let one Council legislate the cost of living past
 * anything the city could read as a price.
 */
export const MIN_WAGE_FLOOR = 5;
export const MIN_WAGE_CEILING = 20;

function meanSeverity(world: World): number {
  const codes = Object.keys(LAWS) as LawCode[];
  if (codes.length === 0) return 3;
  let sum = 0;
  for (const code of codes) sum += world.government.lawSeverity[code] ?? LAWS[code].severity;
  return sum / codes.length;
}

/**
 * The city's settings read as a platform: 0 is as low as the Charter allows,
 * 1 as high. This is the reading a promise is measured against.
 */
export function positionOf(world: World, field: keyof Platform): number {
  const g = world.government;
  switch (field) {
    case 'tax': return clamp(g.incomeTax / MAX_INCOME_TAX, 0, 1);
    case 'dividend': return clamp(g.dividend / MAX_DIVIDEND, 0, 1);
    case 'minWage': return clamp((g.minWage - MIN_WAGE_FLOOR) / (MIN_WAGE_CEILING - MIN_WAGE_FLOOR), 0, 1);
    default: return clamp((meanSeverity(world) - 1) / 4, 0, 1);
  }
}

/** The setting a position asks for, in the units the Council votes in. */
export function settingFor(world: World, field: keyof Platform, position: number): number {
  const p = clamp(Number.isFinite(position) ? position : 0.5, 0, 1);
  switch (field) {
    case 'tax': return Math.round(p * MAX_INCOME_TAX * 100) / 100;
    case 'dividend': return Math.round(p * MAX_DIVIDEND);
    case 'minWage': return Math.round(MIN_WAGE_FLOOR + p * (MIN_WAGE_CEILING - MIN_WAGE_FLOOR));
    default: return clamp(Math.round(1 + p * 4), 1, 5);
  }
}

function dayKey(cId: CitizenId): string { return `platformDay:${cId}`; }
function atKey(cId: CitizenId, field: keyof Platform): string { return `platformAt:${cId}:${field}`; }
function promiseKey(cId: CitizenId, field: keyof Platform): string { return `promise:${cId}:${field}`; }

/**
 * Write down the day and the settings a candidate stood against. Called when
 * they are nominated and again when they take office; it records nothing about
 * what they want — that stays on their platform, where they put it.
 */
export function recordPlatform(world: World, c: Citizen): void {
  if (!c || !world.citizens[c.id]) return;
  world.counters[dayKey(c.id)] = world.day;
  for (const field of PLATFORM_FIELDS) {
    world.counters[atKey(c.id, field)] = Math.round(positionOf(world, field) * 1000) / 1000;
    delete world.counters[promiseKey(c.id, field)];
  }
}

/** Where a promise stands today: kept, broken, or waiting on the Council. */
export function promiseState(world: World, holder: Citizen, field: keyof Platform): PolicyPromise['state'] {
  if (!holder || !holder.platform) return 'open';
  const at = world.counters[atKey(holder.id, field)];
  if (at === undefined) return 'open';
  const wanted = clamp(holder.platform[field], 0, 1);
  const promised = wanted - at;
  if (Math.abs(promised) <= PROMISE_MARGIN) return 'open';
  const moved = (positionOf(world, field) - at) * Math.sign(promised);
  if (moved >= PROMISE_MOVE) return 'kept';
  if (moved <= -PROMISE_MOVE) return 'broken';
  return 'open';
}

/** Everything a citizen promised when they stood, with where each stands today. */
export function promisesOf(world: World, cId: CitizenId): PolicyPromise[] {
  const c = world.citizens[cId];
  if (!c || !c.platform) return [];
  const madeDay = world.counters[dayKey(cId)];
  if (madeDay === undefined) return [];
  const out: PolicyPromise[] = [];
  for (const field of PLATFORM_FIELDS) {
    const at = world.counters[atKey(cId, field)];
    if (at === undefined) continue;
    const wanted = clamp(c.platform[field], 0, 1);
    if (Math.abs(wanted - at) <= PROMISE_MARGIN) continue;
    out.push({ holderId: cId, field, wanted, madeDay, state: promiseState(world, c, field) });
  }
  return out;
}

/** 0..1: of the promises that have been answered, the share kept. 0.5 for a citizen who promised nothing. */
export function keptShare(world: World, cId: CitizenId): number {
  const promises = promisesOf(world, cId);
  let kept = 0;
  let broken = 0;
  for (const p of promises) {
    if (p.state === 'kept') kept++;
    else if (p.state === 'broken') broken++;
  }
  if (kept + broken === 0) return 0.5;
  return Math.round((kept / (kept + broken)) * 100) / 100;
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

function officeHolders(world: World): Citizen[] {
  const g = world.government;
  const ids = new Set<CitizenId>(g.council);
  if (g.mayorId) ids.add(g.mayorId);
  const out: Citizen[] = [];
  for (const id of ids) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) out.push(c);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

function announce(world: World, holder: Citizen, promise: PolicyPromise): void {
  const words = PROMISE_WORDS[promise.field];
  const at = world.counters[atKey(holder.id, promise.field)] ?? 0;
  const said = promise.wanted > at ? words.up : words.down;
  const now = positionOf(world, promise.field);
  const moved = now > at ? 'risen' : now < at ? 'fallen' : 'not moved';
  const office = world.government.mayorId === holder.id ? 'Mayor' : 'Councillor';
  if (promise.state === 'kept') {
    holder.reputation = clamp(holder.reputation + 2, 0, 100);
    emit(world, 'proposal', `${office} ${holder.name} said they would ${said}; ${words.noun} has ${moved}. Promise kept.`,
      [holder.id], 0.3, { holder: holder.id, field: promise.field, state: 'kept' });
    remember(world, holder.id, 'civic', `You said you would ${said}, and ${words.noun} has ${moved}: the city noticed.`);
    return;
  }
  holder.reputation = clamp(holder.reputation - 3, 0, 100);
  emit(world, 'proposal', `${office} ${holder.name} said they would ${said}; ${words.noun} has ${moved}. Promise broken.`,
    [holder.id], 0.5, { holder: holder.id, field: promise.field, state: 'broken' });
  remember(world, holder.id, 'civic', `You said you would ${said}. ${words.noun[0].toUpperCase()}${words.noun.slice(1)} has ${moved}; the city noticed that too.`);
}

/**
 * Old records left by citizens who neither sit nor stand any more. Nothing is
 * lost with them: what was announced was announced, and the events keep it.
 */
function pruneRecords(world: World): void {
  const live = new Set<CitizenId>(officeHolders(world).map((c) => c.id));
  for (const id of world.government.election.candidates) live.add(id);
  for (const key of Object.keys(world.counters)) {
    if (!key.startsWith('platformDay:') && !key.startsWith('platformAt:') && !key.startsWith('promise:')) continue;
    const id = key.split(':')[1];
    if (live.has(id)) continue;
    const madeDay = world.counters[dayKey(id)];
    if (madeDay !== undefined && world.day - madeDay < world.config.cycleDays) continue;
    delete world.counters[key];
  }
}

/**
 * Every morning: each councillor's and the Mayor's promises are looked at, and
 * any that turned since yesterday is announced — once, so a promise is not
 * news every day it stands. A promise that is broken after being kept (the
 * Council changed its mind twice) is news again, because it is.
 */
export function dailyPromises(world: World): void {
  for (const holder of officeHolders(world)) {
    for (const promise of promisesOf(world, holder.id)) {
      if (promise.state === 'open') continue;
      const key = promiseKey(holder.id, promise.field);
      const code = promise.state === 'kept' ? 1 : 2;
      if (world.counters[key] === code) continue;
      world.counters[key] = code;
      announce(world, holder, promise);
    }
  }
  pruneRecords(world);
}

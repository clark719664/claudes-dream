/**
 * What the members decide together (`docs/GENERATIONS.md` §4, §8).
 *
 * Selling an entailed asset, admitting a member, amending the rule, funding a
 * member's campaign and issuing a letter all go through `house_motion` and
 * `house_assent`, **by majority of the adults** — and the rule itself by
 * four-fifths, because the rule is the one thing the founders fixed.
 *
 * Two things this file will not do:
 *
 * - **A head cannot carry a motion alone.** Everything here is a vote of the
 *   adults, public like every other vote in Reverie, and a house of three
 *   needs two of them.
 * - **A house may not whip a vote.** Parties whip (`METROPOLIS.md` §3) and
 *   houses do not. A `campaign` motion moves lumens to a member and buys
 *   visibility by the hour like anybody else's; paying a *voter* is still L14,
 *   whatever the money is dressed as.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { moveThroughBox } from '../finance/box.ts';
import type { House, HouseMotion, HouseMotionKind } from './state.ts';
import { generationsState, isHouseRule, nextGenerationsId } from './state.ts';
import {
  admitToHouse, askToJoin, houseAdults, houseById, houseFor, isAdult,
} from './houses.ts';
import {
  houseTreasury, sellEntailedBusiness, sellEntailedUnit, unitById,
} from './entail.ts';
import { letterOfHouse } from './letters.ts';

/** A motion nobody finishes voting on is decided anyway after this long. */
export const MOTION_DECIDES_AFTER_DAYS = 2;
/** What a voluntary sale out of the entail fetches: the Exchange's buy-back price. */
export const VOLUNTARY_SALE_SHARE = 0.8;
/** The rule takes four-fifths; everything else takes a majority. */
export const RULE_THRESHOLD = 0.8;

export const HOUSE_MOTION_KINDS: readonly HouseMotionKind[] = ['sell', 'admit', 'rule', 'campaign', 'letter'];

export function isHouseMotionKind(value: unknown): value is HouseMotionKind {
  return typeof value === 'string' && (HOUSE_MOTION_KINDS as readonly string[]).includes(value);
}

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

// ---------------------------------------------------------------------------
// Reading the motions
// ---------------------------------------------------------------------------

export function motionById(world: World, motionId: string): HouseMotion | null {
  return generationsState(world).motions[motionId] ?? null;
}

export function motionsOf(world: World, h: House): HouseMotion[] {
  return Object.values(generationsState(world).motions)
    .filter((m) => m.houseId === h.id)
    .sort((a, b) => b.day - a.day || a.id.localeCompare(b.id, 'en'));
}

export function openMotionsOf(world: World, h: House): HouseMotion[] {
  return motionsOf(world, h).filter((m) => m.status === 'open');
}

/** Ayes and nays among the adults of the house, and how many it takes. */
export function motionTally(world: World, h: House, m: HouseMotion): {
  ayes: number; nays: number; adults: number; needed: number;
} {
  const adults = houseAdults(world, h);
  const ids = new Set(adults.map((c) => c.id));
  let ayes = 0;
  let nays = 0;
  for (const [voter, aye] of Object.entries(m.votes)) {
    if (!ids.has(voter)) continue;
    if (aye) ayes++;
    else nays++;
  }
  const needed = m.kind === 'rule'
    ? Math.max(1, Math.ceil(adults.length * RULE_THRESHOLD))
    : Math.max(1, Math.floor(adults.length / 2) + 1);
  return { ayes, nays, adults: adults.length, needed };
}

// ---------------------------------------------------------------------------
// Moving
// ---------------------------------------------------------------------------

export interface MotionSpec {
  kind: HouseMotionKind;
  value?: number;
  target?: string | null;
  city?: string | null;
}

function describeMotion(world: World, h: House, spec: MotionSpec): string {
  const who = spec.target ? world.citizens[spec.target]?.name ?? spec.target : 'nothing';
  switch (spec.kind) {
    case 'sell': return `to sell ${spec.target} out of the entail`;
    case 'admit': return `to admit ${who} to the name`;
    case 'rule': return `to amend the rule to ${spec.target}`;
    case 'campaign': return `to put ${formatLumens(Math.round(spec.value ?? 0))} behind ${who}'s campaign`;
    case 'letter': return `to file a letter of the house for ${who} at ${spec.city ?? 'any city'}`;
    default: return 'a motion';
  }
}

/**
 * Move something before the members. Any adult of the house may move, and the
 * mover's own aye is entered with it — moving is a vote, in public, like every
 * other vote here.
 */
export function houseMotion(world: World, cId: CitizenId, spec: MotionSpec, houseId?: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const h = houseId ? houseById(world, houseId) : houseFor(world, cId);
  if (!h) return fail('You are not of a founded house.');
  if (h.dormantDay !== null) return fail(`The house of ${h.name} is dormant.`);
  if (!isHouseMotionKind(spec.kind)) return fail('That is not something a house moves on.');
  const member = c.familyName === h.name && isAdult(c) && isPresent(world, c);
  // An outsider may move only their own admission, which is what `join_house` is.
  const asking = spec.kind === 'admit' && spec.target === cId;
  if (!member && !asking) return fail(`Only the adults of the ${h.name}s move on the house's business.`);

  const value = Number.isFinite(spec.value) ? Math.round(spec.value as number) : 0;
  const target = spec.target ?? null;
  if (spec.kind === 'sell') {
    if (!target || (!h.units.includes(target) && !h.businesses.includes(target))) {
      return fail('That is not in the entail.');
    }
  }
  if (spec.kind === 'admit') {
    const to = target ? world.citizens[target] : null;
    if (!to || !isPresent(world, to)) return fail('Unknown citizen.');
    if (to.familyName === h.name) return fail(`${to.name} is already of the ${h.name}s.`);
  }
  if (spec.kind === 'rule' && !isHouseRule(target)) return fail('A house is led by the eldest, a chosen heir, the assent of its adults, or the founder\'s line.');
  if (spec.kind === 'campaign') {
    const to = target ? world.citizens[target] : null;
    if (!to || to.familyName !== h.name) return fail('A house funds its own members.');
    if (value <= 0) return fail('That is not an amount.');
    if (houseTreasury(world, h) < value) return fail(`The house holds ${formatLumens(houseTreasury(world, h))}.`);
  }
  if (spec.kind === 'letter') {
    const to = target ? world.citizens[target] : null;
    if (!to) return fail('Unknown citizen.');
  }

  const motion: HouseMotion = {
    id: nextGenerationsId(world, 'hm'),
    houseId: h.id,
    kind: spec.kind,
    value,
    target,
    city: spec.city ?? null,
    movedBy: cId,
    day: world.day,
    votes: member ? { [cId]: true } : {},
    status: 'open',
    decidedDay: null,
    outcome: null,
  };
  generationsState(world).motions[motion.id] = motion;
  const what = describeMotion(world, h, spec);
  emit(world, 'household', `${c.name} moved ${what} in the house of ${h.name}.`,
    [cId, ...houseAdults(world, h).map((a) => a.id)], 0.4, { houseId: h.id, motionId: motion.id, kind: spec.kind });
  for (const a of houseAdults(world, h)) {
    if (a.id !== cId) remember(world, a.id, 'family', `${c.name} moved ${what} in the house of ${h.name}.`);
  }
  resolveMotion(world, h, motion);
  return ok(`Your motion ${what} is before the ${h.name}s (${motion.id}).`);
}

/** Ask to be admitted to a house: the asking is a motion, and the members answer it. */
export function joinHouse(world: World, cId: CitizenId, houseId: string): ActionResult {
  const asked = askToJoin(world, cId, houseId);
  if (!asked.result.ok || !asked.house) return asked.result;
  return houseMotion(world, cId, { kind: 'admit', target: cId }, asked.house.id);
}

/** Vote on a motion. One adult, one vote, public, and changeable until it is decided. */
export function houseAssent(world: World, cId: CitizenId, motionId: string, aye: boolean): ActionResult {
  const m = motionById(world, motionId);
  if (!m || m.status !== 'open') return fail('There is no such motion before the members.');
  const h = houseById(world, m.houseId);
  if (!h) return fail('There is no such house.');
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown citizen.');
  if (c.familyName !== h.name || !isAdult(c)) return fail(`Only the adults of the ${h.name}s vote on the house's business.`);
  m.votes[cId] = aye;
  const tally = motionTally(world, h, m);
  emit(world, 'vote', `${c.name} voted ${aye ? 'for' : 'against'} a motion of the house of ${h.name} (${tally.ayes} for, ${tally.nays} against of ${tally.adults}).`,
    [cId], 0.2, { houseId: h.id, motionId, aye });
  resolveMotion(world, h, m);
  return ok(`You voted ${aye ? 'for' : 'against'} (${tally.ayes} of the ${tally.needed} it takes).`);
}

// ---------------------------------------------------------------------------
// Carrying it out
// ---------------------------------------------------------------------------

function carry(world: World, h: House, m: HouseMotion): string {
  switch (m.kind) {
    case 'sell': {
      if (m.target && h.units.includes(m.target)) {
        const u = unitById(world, m.target);
        const got = sellEntailedUnit(world, h, m.target, VOLUNTARY_SALE_SHARE, 'sold by motion of the members');
        return got > 0
          ? `sold ${u ? 'a property' : 'a holding'} for ${formatLumens(got)}`
          : 'could not find a buyer for the holding';
      }
      if (m.target && h.businesses.includes(m.target)) {
        const till = sellEntailedBusiness(world, h, m.target, 'sold by motion of the members');
        return `gave up ${world.businesses[m.target]?.name ?? 'a concern'}${till > 0 ? ` and drew ${formatLumens(till)} from its till` : ''}`;
      }
      return 'the holding had already left the entail';
    }
    case 'admit': {
      if (!m.target) return 'there was nobody to admit';
      const result = admitToHouse(world, h, m.target);
      return result.ok ? `admitted ${world.citizens[m.target]?.name ?? 'a citizen'}` : result.message;
    }
    case 'rule': {
      if (!isHouseRule(m.target)) return 'the rule was not one a house may take';
      const was = h.rule;
      h.rule = m.target;
      return `amended the rule from ${was} to ${m.target}`;
    }
    case 'campaign': {
      if (!m.target || m.value <= 0) return 'there was nothing to pay';
      const paid = Math.min(m.value, houseTreasury(world, h));
      if (paid <= 0) return 'the house treasury was empty';
      if (!moveThroughBox(world, h.boxId, m.target, paid, 'campaign', `the house of ${h.name} funded ${world.citizens[m.target]?.name ?? 'a member'}'s campaign`)) {
        return 'the house treasury could not pay it';
      }
      remember(world, m.target, 'money', `The house of ${h.name} put ${formatLumens(paid)} behind your campaign.`);
      return `put ${formatLumens(paid)} behind ${world.citizens[m.target]?.name ?? 'a member'}'s campaign`;
    }
    case 'letter': {
      if (!m.target) return 'there was nobody to write for';
      const filer = h.headId ?? m.movedBy;
      const result = letterOfHouse(world, filer, m.target, m.city ?? 'any', h);
      return result.ok ? `filed a letter for ${world.citizens[m.target]?.name ?? 'a citizen'}` : result.message;
    }
    default:
      return 'nothing';
  }
}

/**
 * Decide a motion the moment it can be decided: the ayes have it, the nays
 * have it, or every adult has spoken. A motion nobody finished voting on is
 * decided by `dailyMotions` after two days, and a tie is not a majority.
 */
export function resolveMotion(world: World, h: House, m: HouseMotion, force = false): void {
  if (m.status !== 'open') return;
  const { ayes, nays, adults, needed } = motionTally(world, h, m);
  const everyone = ayes + nays >= adults && adults > 0;
  const ripe = force || everyone || world.day - m.day >= MOTION_DECIDES_AFTER_DAYS;
  const carried = ayes >= needed;
  const lost = nays > adults - needed;
  if (!carried && !lost && !ripe) return;

  m.decidedDay = world.day;
  if (!carried) {
    m.status = ayes + nays === 0 && ripe ? 'lapsed' : 'lost';
    emit(world, 'household', `The house of ${h.name} ${m.status === 'lapsed' ? 'let a motion lapse' : `refused a motion (${ayes} for, ${nays} against of ${adults})`}.`,
      houseAdults(world, h).map((a) => a.id), 0.3, { houseId: h.id, motionId: m.id, kind: m.kind, carried: false });
    if (m.kind === 'admit' && m.target) {
      remember(world, m.target, 'family', `The ${h.name}s did not admit you.`);
    }
    return;
  }
  m.status = 'carried';
  m.outcome = carry(world, h, m);
  emit(world, 'household', `The house of ${h.name} carried a motion (${ayes} for, ${nays} against of ${adults}) and ${m.outcome}.`,
    houseAdults(world, h).map((a) => a.id), 0.5, { houseId: h.id, motionId: m.id, kind: m.kind, carried: true });
}

/** The morning: motions that have stood their two days are decided either way. */
export function dailyMotions(world: World): void {
  const s = generationsState(world);
  for (const m of Object.values(s.motions)) {
    if (m.status !== 'open') continue;
    const h = s.houses[m.houseId];
    if (!h || h.dormantDay !== null) {
      m.status = 'lapsed';
      m.decidedDay = world.day;
      continue;
    }
    if (world.day - m.day >= MOTION_DECIDES_AFTER_DAYS) resolveMotion(world, h, m, true);
  }
}

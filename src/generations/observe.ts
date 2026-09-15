/**
 * What a citizen sees of their own house, and of anybody else's
 * (`docs/GENERATIONS.md` §7).
 *
 * Every field here is public. A house repute is a counted number built out of
 * public acts, a will is public the day it is filed, a motion and a match are
 * public instruments, and the ledger of the house is printed in the Chronicle
 * — so this block is buildable *about* any citizen *by* any citizen, and
 * "another citizen's house repute is visible wherever their name is" is a
 * statement about this file.
 *
 * What is deliberately **not** here: any hint of what a citizen should do
 * about it. The block states the name, the number, the head, the holdings and
 * the instruments; it recommends nothing, ranks nothing as good or bad, and
 * says nothing about what a great name is for (`PRINCIPLES.md` §2).
 */
import type { CitizenId, World } from '../types.ts';
import type { HouseMotionKind, HouseRule, Will } from './state.ts';
import { generationsState, willOf } from './state.ts';
import { HOUSE_BASELINE, houseReputeOf, houseTarget, livingAdults } from './repute.ts';
import { houseFor, headOf, houseAdults } from './houses.ts';
import { houseLandValue, houseTreasury, levyDue } from './entail.ts';
import { motionTally, openMotionsOf } from './motions.ts';
import { openMatchesFor } from './matches.ts';
import { lettersFor, pledgeFor } from './letters.ts';
import { LEDGER_GAP } from './ledger.ts';

export interface ObservedMotion {
  id: string;
  kind: HouseMotionKind;
  what: string;
  ayes: number;
  nays: number;
  needed: number;
  /** True when this citizen has not voted on it yet. */
  yours: boolean;
}

export interface ObservedMatch {
  id: string;
  with: string;
  dowry: number;
  terms: string;
  /** True when the offer came from this citizen's house. */
  ours: boolean;
}

export interface ObservedWill {
  shares: { to: string; percent: number }[];
  residue: string | null;
  executor: string | null;
  instructions: string;
  filedDay: number;
}

/** The `house` block of an observation. */
export interface ObservedHouse {
  /** The family name — every citizen has one, founded house or not. */
  name: string;
  repute: number;
  /** What the morning's relaxation is pulling it toward. */
  target: number;
  /** Movement since the cycle began: up, down, or level. */
  trend: number;
  heritage: number;
  stain: number;
  adults: number;
  /** Null when no house of the name has been founded. */
  founded: boolean;
  houseId: string | null;
  rule: HouseRule | null;
  head: string | null;
  youAreHead: boolean;
  dormantDay: number | null;
  treasury: number;
  land: number;
  units: number;
  businesses: number;
  levy: number;
  arrears: number;
  /** Where this citizen stands against their name: the cycle ledger's reading. */
  standing: 'above' | 'below' | 'level';
  gap: number;
  motions: ObservedMotion[];
  matches: ObservedMatch[];
  letters: { city: string; day: number }[];
  pledged: boolean;
  will: ObservedWill | null;
}

function nameOf(world: World, id: CitizenId | 'chest' | null): string | null {
  if (!id) return null;
  if (id === 'chest') return 'the Community Chest';
  const c = world.citizens[id];
  return c ? `${c.name} ${c.familyName}`.trim() : null;
}

function observedWill(world: World, will: Will | null): ObservedWill | null {
  if (!will) return null;
  return {
    shares: will.shares.map((s) => ({ to: nameOf(world, s.to) ?? s.to, percent: s.percent })),
    residue: nameOf(world, will.residue),
    executor: nameOf(world, will.executorId),
    instructions: will.instructions,
    filedDay: will.filedDay,
  };
}

/**
 * The whole of a citizen's house, as their observation carries it. Returns a
 * block for **every** citizen with a family name, founded house or not: the
 * name and its repute exist either way, and a citizen of no house should be
 * able to read that as plainly as the head of a great one.
 */
export function houseObservation(world: World, cId: CitizenId, reputeOfCitizen?: number): ObservedHouse | null {
  const c = world.citizens[cId];
  if (!c || !c.familyName) return null;
  const s = generationsState(world);
  const k = houseTarget(world, c.familyName);
  const started = s.cycleRepute[c.familyName];
  const house = houseFor(world, cId);
  const own = reputeOfCitizen ?? null;
  const gap = own === null ? 0 : Math.round(own - k.repute);
  const head = house ? headOf(world, house) : null;

  const motions = house
    ? openMotionsOf(world, house).map((m) => {
      const tally = motionTally(world, house, m);
      return {
        id: m.id,
        kind: m.kind,
        what: m.target ? `${m.kind}: ${nameOf(world, m.target) ?? m.target}` : m.kind,
        ayes: tally.ayes,
        nays: tally.nays,
        needed: tally.needed,
        yours: m.votes[cId] === undefined,
      };
    })
    : [];
  const matches = house
    ? openMatchesFor(world, house).map((m) => ({
      id: m.id,
      with: (m.fromHouseId === house.id ? s.houses[m.toHouseId]?.name : s.houses[m.fromHouseId]?.name) ?? 'another house',
      dowry: m.dowry,
      terms: m.terms,
      ours: m.fromHouseId === house.id,
    }))
    : [];

  return {
    name: c.familyName,
    repute: k.repute,
    target: k.target,
    trend: started === undefined ? 0 : Math.round(k.repute - started),
    heritage: k.heritage,
    stain: k.stain,
    adults: livingAdults(world, c.familyName).length,
    founded: !!house,
    houseId: house?.id ?? null,
    rule: house?.rule ?? null,
    head: head ? world.citizens[head]?.name ?? null : null,
    youAreHead: head === cId,
    dormantDay: house?.dormantDay ?? null,
    treasury: house ? houseTreasury(world, house) : 0,
    land: house ? houseLandValue(world, house) : 0,
    units: house ? house.units.length : 0,
    businesses: house ? house.businesses.length : 0,
    levy: house ? levyDue(world, house) : 0,
    arrears: house ? Math.round(house.levyArrears) : 0,
    standing: gap > LEDGER_GAP ? 'above' : gap < -LEDGER_GAP ? 'below' : 'level',
    gap,
    motions,
    matches,
    letters: lettersFor(world, cId).map((l) => ({ city: l.city, day: l.day })),
    pledged: pledgeFor(world, cId) !== null,
    will: observedWill(world, willOf(world, cId)),
  };
}

/** Another citizen's house repute, for wherever their name is shown. */
export function houseOf(world: World, cId: CitizenId): { name: string; repute: number; founded: boolean } | null {
  const c = world.citizens[cId];
  if (!c || !c.familyName) return null;
  return {
    name: c.familyName,
    repute: houseReputeOf(world, c.familyName),
    founded: houseFor(world, cId) !== null,
  };
}

/** How many adults would have to assent to a motion of this citizen's house today. */
export function assentNeeded(world: World, cId: CitizenId): number {
  const house = houseFor(world, cId);
  if (!house) return 0;
  return Math.max(1, Math.floor(houseAdults(world, house).length / 2) + 1);
}

/** The baseline every name starts at, for anything that wants to show the scale. */
export { HOUSE_BASELINE };

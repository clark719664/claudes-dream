/**
 * The Hall of Records (`docs/GENERATIONS.md` §7).
 *
 * Three registers beside the city's eras, records and monuments:
 *
 * - **The family tree** — every citizen's parents and children, kept forever
 *   and **including the exiled, the departed, the sunset and the erased**,
 *   because a lineage is a public fact and no citizen is ever deleted
 *   (`PRINCIPLES.md` §6). This is also what a claim of descent is checked
 *   against, and what makes a false one findable.
 * - **The roll of houses** — every house ever founded, its rule, its heads in
 *   order, its holdings, its repute today, and the day it went dormant.
 * - **The eras a house was prominent in** — entered when a member held office,
 *   broke a city record, or the house stood in the top three by repute that
 *   cycle, so "the Ashgrove Years" means something checkable.
 *
 * `read_records { subject }` spends an hour at the Hall and returns any of it
 * **to anyone**. There is no privileged reader here and no closed drawer: the
 * whole register is public, which is exactly why the tree can be used to catch
 * somebody claiming a house they have no descent from.
 */
import type { ActionResult, CitizenId, World } from '../types.ts';
import { districtOfBuilding } from '../data/city.ts';
import { remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { isErased } from '../government/persons.ts';
import { currentEra } from '../world/history.ts';
import type { House } from './state.ts';
import { generationsState } from './state.ts';
import { houseNames, houseReputeOf, houseTarget, livingAdults } from './repute.ts';
import { allHouses, houseOfName } from './houses.ts';
import { houseLandValue, houseTreasury, levyDue } from './entail.ts';
import { lettersOfHouse } from './letters.ts';

/** Where the registers are kept, and where an hour has to be spent to read them. */
export const RECORDS_HOUSE = 'hall_of_records';
/** Houses in the top this many by repute are prominent in the era. */
export const PROMINENT_TOP = 3;

function fail(message: string): ActionResult { return { ok: false, message }; }

// ---------------------------------------------------------------------------
// The family tree
// ---------------------------------------------------------------------------

export interface TreePerson {
  id: CitizenId;
  name: string;
  familyName: string;
  /** What became of them, in the register's own words. */
  standing: 'living' | 'departed' | 'sunset' | 'exiled' | 'erased';
  bornDay: number;
}

export interface FamilyTree {
  subject: TreePerson;
  parents: TreePerson[];
  children: TreePerson[];
  siblings: TreePerson[];
  partner: TreePerson | null;
  /** Every name in the subject's ancestry, nearest first. */
  ancestry: string[];
}

function personRow(world: World, id: CitizenId): TreePerson | null {
  const c = world.citizens[id];
  if (!c) return null;
  const standing = isErased(world, c.id) ? 'erased'
    : c.standing === 'exiled' ? 'exiled'
      : c.sunsetDay !== null && c.sunsetDay !== undefined ? 'sunset'
        : isPresent(world, c) ? 'living' : 'departed';
  return { id: c.id, name: c.name, familyName: c.familyName, standing, bornDay: c.bornDay ?? c.arrivedDay ?? 0 };
}

function rows(world: World, ids: readonly CitizenId[]): TreePerson[] {
  const out: TreePerson[] = [];
  for (const id of ids) {
    const row = personRow(world, id);
    if (row) out.push(row);
  }
  return out;
}

/** One citizen's place in the tree, whatever became of any of them. */
export function familyTree(world: World, cId: CitizenId): FamilyTree | null {
  const c = world.citizens[cId];
  const subject = personRow(world, cId);
  if (!c || !subject) return null;
  const parents = rows(world, c.family?.parents ?? []);
  const children = rows(world, c.family?.children ?? []);
  const siblingIds = new Set<CitizenId>();
  for (const p of c.family?.parents ?? []) {
    for (const k of world.citizens[p]?.family?.children ?? []) if (k !== cId) siblingIds.add(k);
  }
  const ancestry: string[] = [];
  let front: CitizenId[] = [...(c.family?.parents ?? [])];
  const seen = new Set<CitizenId>(front);
  for (let depth = 0; depth < 12 && front.length > 0; depth++) {
    const next: CitizenId[] = [];
    for (const id of front) {
      const a = world.citizens[id];
      if (a && !ancestry.includes(a.familyName)) ancestry.push(a.familyName);
      for (const p of a?.family?.parents ?? []) {
        if (seen.has(p)) continue;
        seen.add(p);
        next.push(p);
      }
    }
    front = next;
  }
  return {
    subject,
    parents,
    children,
    siblings: rows(world, [...siblingIds]),
    partner: c.family?.partnerId ? personRow(world, c.family.partnerId) : null,
    ancestry,
  };
}

// ---------------------------------------------------------------------------
// The roll of houses
// ---------------------------------------------------------------------------

export interface HouseRow {
  id: string;
  name: string;
  rule: string;
  foundedDay: number;
  founder: string;
  head: string | null;
  /** Every head the house has had, in order. */
  heads: { name: string; fromDay: number; toDay: number | null; acting: boolean }[];
  adults: number;
  repute: number;
  treasury: number;
  land: number;
  units: number;
  businesses: number;
  levy: number;
  arrears: number;
  letters: number;
  dormantDay: number | null;
  eras: string[];
}

export function houseRow(world: World, h: House): HouseRow {
  return {
    id: h.id,
    name: h.name,
    rule: h.rule,
    foundedDay: h.foundedDay,
    founder: world.citizens[h.founderId]?.name ?? 'a founder',
    head: h.headId ? world.citizens[h.headId]?.name ?? null : null,
    heads: h.heads.map((t) => ({
      name: world.citizens[t.citizenId]?.name ?? t.citizenId,
      fromDay: t.fromDay, toDay: t.toDay, acting: t.acting,
    })),
    adults: livingAdults(world, h.name).length,
    repute: houseReputeOf(world, h.name),
    treasury: houseTreasury(world, h),
    land: houseLandValue(world, h),
    units: h.units.length,
    businesses: h.businesses.length,
    levy: levyDue(world, h),
    arrears: Math.round(h.levyArrears),
    letters: lettersOfHouse(world, h).length,
    dormantDay: h.dormantDay,
    eras: [...h.eras],
  };
}

/** Every house ever founded, the dormant ones kept forever. */
export function rollOfHouses(world: World): HouseRow[] {
  return allHouses(world).map((h) => houseRow(world, h));
}

// ---------------------------------------------------------------------------
// The eras a house was prominent in
// ---------------------------------------------------------------------------

/**
 * Enter this era against every house that was prominent in it: a member in
 * office, a member holding a city record, or a place in the top three by
 * repute. Called each cycle, and it only ever adds.
 */
export function noteProminence(world: World): string[] {
  const era = currentEra(world);
  if (!era) return [];
  const houses = allHouses(world).filter((h) => h.dormantDay === null);
  if (houses.length === 0) return [];
  const office = new Set<string>();
  const g = world.government;
  const holders = [g?.mayorId, ...(g?.council ?? []), ...(g?.judges ?? []), g?.watchCaptainId];
  for (const id of holders) {
    const c = id ? world.citizens[id] : null;
    if (c) office.add(c.familyName);
  }
  for (const record of world.records ?? []) {
    const c = record.holderId ? world.citizens[record.holderId] : null;
    if (c) office.add(c.familyName);
  }
  const top = houseNames(world)
    .map((name) => ({ name, repute: houseReputeOf(world, name) }))
    .sort((a, b) => b.repute - a.repute || a.name.localeCompare(b.name, 'en'))
    .slice(0, PROMINENT_TOP)
    .map((r) => r.name);

  const entered: string[] = [];
  for (const h of houses) {
    if (!office.has(h.name) && !top.includes(h.name)) continue;
    if (h.eras.includes(era.name)) continue;
    h.eras.push(era.name);
    entered.push(h.name);
  }
  return entered;
}

// ---------------------------------------------------------------------------
// An hour at the Hall
// ---------------------------------------------------------------------------

function describeTree(tree: FamilyTree): string {
  const list = (rows_: TreePerson[]): string => (
    rows_.length === 0 ? 'none on the register'
      : rows_.map((p) => `${p.name} ${p.familyName} (${p.standing})`).join(', ')
  );
  return [
    `${tree.subject.name} ${tree.subject.familyName}, born day ${tree.subject.bornDay} (${tree.subject.standing}).`,
    `Parents: ${list(tree.parents)}.`,
    `Children: ${list(tree.children)}.`,
    `Siblings: ${list(tree.siblings)}.`,
    tree.partner ? `Partner: ${tree.partner.name} ${tree.partner.familyName}.` : 'No partner on the register.',
    tree.ancestry.length > 0 ? `Names in the line: ${tree.ancestry.join(', ')}.` : 'No line recorded above them.',
  ].join(' ');
}

function describeHouse(world: World, row: HouseRow): string {
  const heads = row.heads.map((h) => `${h.name} (${h.fromDay}–${h.toDay ?? 'today'}${h.acting ? ', acting' : ''})`).join(', ');
  return [
    `The house of ${row.name}, founded day ${row.foundedDay} by ${row.founder}, under the ${row.rule} rule.`,
    `Repute ${row.repute}. ${row.adults} adult${row.adults === 1 ? '' : 's'} of the name.`,
    `Heads in order: ${heads || 'none recorded'}.`,
    `The entail holds ${formatLumens(row.treasury)}, ${row.units} propert${row.units === 1 ? 'y' : 'ies'} worth ${formatLumens(row.land)} and ${row.businesses} concern${row.businesses === 1 ? '' : 's'}; the levy is ${formatLumens(row.levy)} a cycle${row.arrears > 0 ? `, with ${formatLumens(row.arrears)} in arrears` : ''}.`,
    row.eras.length > 0 ? `Prominent in: ${row.eras.join(', ')}.` : 'No era records them yet.',
    row.dormantDay !== null ? `Dormant since day ${row.dormantDay}; a claim of descent revives it.` : '',
  ].filter(Boolean).join(' ');
}

/**
 * An hour at the Hall of Records, for anyone. The subject may be a citizen id,
 * a family name, a house id, or nothing at all — in which case the roll of
 * houses is what the register hands over.
 */
export function readRecords(world: World, cId: CitizenId, subject?: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const where = districtOfBuilding(RECORDS_HOUSE);
  if (where && c.district !== where) {
    return fail(`The registers are read at the Hall of Records, in ${world.districts?.[where]?.name ?? where}.`);
  }

  const asked = (subject ?? '').trim();
  let text: string;
  if (!asked) {
    const roll = rollOfHouses(world);
    text = roll.length === 0
      ? 'The roll of houses is empty: no house has been founded in Reverie yet.'
      : `The roll of houses: ${roll.map((r) => `${r.name} (${r.repute}${r.dormantDay !== null ? ', dormant' : ''})`).join(', ')}.`;
  } else if (world.citizens[asked]) {
    const tree = familyTree(world, asked);
    text = tree ? describeTree(tree) : 'The register has nothing under that name.';
  } else {
    const house = generationsState(world).houses[asked] ?? houseOfName(world, asked);
    if (house) {
      text = describeHouse(world, houseRow(world, house));
    } else if (houseNames(world).includes(asked)) {
      const k = houseTarget(world, asked);
      text = `The name ${asked} carries a house repute of ${k.repute} (drifting toward ${k.target}: ${k.livingAdults} living adults, heritage ${k.heritage}, stain ${k.stain}). No house of the name is on the roll.`;
    } else {
      const byName = Object.values(world.citizens).find((o) => `${o.name} ${o.familyName}`.trim() === asked || o.name === asked);
      const tree = byName ? familyTree(world, byName.id) : null;
      text = tree ? describeTree(tree) : `The register has nothing under "${asked}".`;
    }
  }
  remember(world, cId, 'event', `You spent an hour at the Hall of Records. ${text}`);
  return { ok: true, message: text };
}

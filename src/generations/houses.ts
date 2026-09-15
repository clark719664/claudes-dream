/**
 * Founding a house, belonging to one, leading one, and losing one
 * (`docs/GENERATIONS.md` §4).
 *
 * **Membership is the family name and nothing else.** Three adults sharing a
 * name and 500 ℓ found a House at the Exchange; everybody carrying that name
 * is of it, a citizen from outside asks with `join_house` and takes the name
 * when the members assent, and the way out is `renounce_name` — a name of your
 * own. Nothing here is a list somebody else can write you onto or strike you
 * off: a house is who calls themselves by the name, and both directions are
 * the citizen's own act.
 *
 * This file is the roll and the two doors: who is of a house, how one is
 * founded, and how a name is taken and given up. Who *leads* a house — the
 * rule, the investiture, dormancy and the claim of descent that ends it — is
 * `head.ts`; what a house *holds* is `entail.ts`; what its members decide
 * together is `motions.ts`.
 */
import type { ActionResult, Citizen, CitizenId, DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { isJailed } from '../government/jail.ts';
import { openStrongbox } from '../finance/box.ts';
import type { House, HouseRule } from './state.ts';
import { generationsState, nextGenerationsId } from './state.ts';
import { livingAdults, livingMembers } from './repute.ts';

/** Three adults of a name, and 500 ℓ at the Exchange. */
export const FOUND_HOUSE_COST = 500;
export const FOUND_HOUSE_ADULTS = 3;
export const MAX_HOUSE_NAME = 40;
/** Where the house treasury stands: the Exchange, in the Harbor Market. */
export const HOUSE_DISTRICT: DistrictId = 'harbor_market';
export const HOUSE_BUILDING = 'exchange';
/** How far up the tree a claim of descent is looked for. */
export const DESCENT_DEPTH = 12;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

export function isAdult(c: Citizen | null | undefined): boolean {
  return !!c && (c.lifeStage === 'adult' || c.lifeStage === 'elder');
}

// ---------------------------------------------------------------------------
// Reading the roll
// ---------------------------------------------------------------------------

export function houseById(world: World, houseId: string): House | null {
  return generationsState(world).houses[houseId] ?? null;
}

/** The founded house of a family name, dormant ones included. */
export function houseOfName(world: World, name: string): House | null {
  if (!name) return null;
  for (const h of Object.values(generationsState(world).houses)) {
    if (h.name === name) return h;
  }
  return null;
}

/** The founded house a citizen belongs to, by the name they carry. */
export function houseFor(world: World, cId: CitizenId): House | null {
  const c = world.citizens[cId];
  return c ? houseOfName(world, c.familyName) : null;
}

/** Every house on the roll, oldest first — dormant ones kept forever. */
export function allHouses(world: World): House[] {
  return Object.values(generationsState(world).houses)
    .sort((a, b) => a.foundedDay - b.foundedDay || a.id.localeCompare(b.id, 'en'));
}

export function liveHouses(world: World): House[] {
  return allHouses(world).filter((h) => h.dormantDay === null);
}

/** Members of a house living in Reverie today. */
export function houseMembers(world: World, h: House): Citizen[] {
  return livingMembers(world, h.name);
}

/** The adults of a house: the ones whose assent a motion needs. */
export function houseAdults(world: World, h: House): Citizen[] {
  return livingAdults(world, h.name);
}

/** Whoever may act for the house this hour: the acting head while the head is inside. */
export function headOf(world: World, h: House): CitizenId | null {
  const head = h.headId ? world.citizens[h.headId] : null;
  if (head && isPresent(world, head) && !isJailed(head)) return head.id;
  const acting = h.actingHeadId ? world.citizens[h.actingHeadId] : null;
  if (acting && isPresent(world, acting) && !isJailed(acting)) return acting.id;
  return head && isPresent(world, head) ? head.id : null;
}

/** True when this citizen may act for their house today. */
export function isHead(world: World, cId: CitizenId): boolean {
  const h = houseFor(world, cId);
  return !!h && headOf(world, h) === cId;
}

/** The house this citizen may act for, or null. */
export function houseHeaded(world: World, cId: CitizenId): House | null {
  const h = houseFor(world, cId);
  return h && headOf(world, h) === cId ? h : null;
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

function nameTaken(world: World, name: string): boolean {
  return Object.values(generationsState(world).houses).some((h) => h.name.toLowerCase() === name.toLowerCase());
}

/**
 * Found a house: three or more adults sharing a name, 500 ℓ at the Exchange,
 * and a rule for choosing the head. The founder is its first head whatever the
 * rule says; the rule takes over from the next morning.
 */
export function foundHouse(world: World, cId: CitizenId, name: string, rule: HouseRule): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('Only a citizen living in Reverie may found a house.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail('Your standing does not allow it.');
  if (!isAdult(c)) return fail('A child cannot found a house.');
  const wanted = (name ?? '').trim().slice(0, MAX_HOUSE_NAME);
  if (!wanted) return fail('A house needs a name.');
  if (wanted !== c.familyName) return fail(`You may only found a house of your own name, ${c.familyName}.`);
  if (nameTaken(world, wanted)) return fail(`The house of ${wanted} is already on the roll.`);

  const adults = livingAdults(world, wanted);
  if (adults.length < FOUND_HOUSE_ADULTS) {
    return fail(`A house takes ${FOUND_HOUSE_ADULTS} adults of the name; the ${wanted}s are ${adults.length}.`);
  }
  if (c.wallet < FOUND_HOUSE_COST) {
    return fail(`Founding a house costs ${formatLumens(FOUND_HOUSE_COST)}; you have ${formatLumens(c.wallet)}.`);
  }
  if (!transfer(world, cId, 'treasury', FOUND_HOUSE_COST, 'registration', `founding of the house of ${wanted}`)) {
    return fail('The founding fee could not be paid.');
  }

  const box = openStrongbox(world, `${wanted} (house treasury)`, HOUSE_DISTRICT, HOUSE_BUILDING);
  const house: House = {
    id: nextGenerationsId(world, 'hs'),
    name: wanted,
    rule,
    founderId: cId,
    foundedDay: world.day,
    boxId: box.id,
    headId: cId,
    actingHeadId: null,
    successorId: null,
    heads: [{ citizenId: cId, fromDay: world.day, toDay: null, acting: false }],
    units: [],
    businesses: [],
    admitted: [],
    renounced: [],
    levyArrears: 0,
    lastLevyCycle: world.government?.cycle ?? 0,
    dormantDay: null,
    revivedDays: [],
    eras: [],
  };
  generationsState(world).houses[house.id] = house;

  emit(world, 'household', `${c.name} founded the house of ${wanted} at the Exchange, ${adults.length} adults of the name, under the ${rule} rule.`,
    adults.map((a) => a.id), 0.6, { houseId: house.id, name: wanted, rule, adults: adults.length });
  for (const a of adults) {
    remember(world, a.id, 'family', a.id === cId
      ? `You founded the house of ${wanted} for ${formatLumens(FOUND_HOUSE_COST)}; you are its head under the ${rule} rule.`
      : `${c.name} founded the house of ${wanted}; you are of it, and ${c.name} is its head.`);
  }
  return ok(`The house of ${wanted} is on the roll, and you are its head.`);
}

// ---------------------------------------------------------------------------
// Taking the name, and leaving it
// ---------------------------------------------------------------------------

/** Set a citizen's family name in both places the engine keeps it. */
export function setFamilyName(world: World, c: Citizen, name: string): void {
  c.familyName = name;
  if (c.family) c.family.familyName = name;
}

/**
 * Admit a citizen to a house: they take the name, and everything that follows
 * from it. Called by `motions.ts` when the members carry an `admit` motion —
 * never by the head alone, and never to somebody who has not asked.
 */
export function admitToHouse(world: World, h: House, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('That citizen has left the city.');
  if (c.familyName === h.name) return fail(`${c.name} is already of the ${h.name}s.`);
  const was = c.familyName;
  setFamilyName(world, c, h.name);
  if (!h.admitted.includes(cId)) h.admitted.push(cId);
  h.renounced = h.renounced.filter((id) => id !== cId);
  emit(world, 'household', `${c.name} ${was} was admitted to the house of ${h.name} and takes the name.`,
    [cId, ...houseAdults(world, h).map((a) => a.id)], 0.5, { houseId: h.id, citizenId: cId });
  remember(world, cId, 'family', `You were admitted to the house of ${h.name} and carry the name now.`);
  return ok(`You are of the ${h.name}s now.`);
}

/** A name nobody else is using, built from the citizen's own given name. */
export function ownName(world: World, c: Citizen): string {
  const base = (c.name ?? 'Nameless').trim().slice(0, MAX_HOUSE_NAME) || 'Nameless';
  const used = new Set(Object.values(world.citizens).map((o) => o.familyName));
  used.delete(c.familyName);
  if (!used.has(base) && !nameTaken(world, base)) return base;
  for (let i = 2; i < 100; i++) {
    const tried = `${base}${i}`;
    if (!used.has(tried) && !nameTaken(world, tried)) return tried;
  }
  return `${base}${world.tick}`;
}

/**
 * Leave your house for a name of your own (`GENERATIONS.md` §2). Your repute,
 * your record, your bonds and your inheritance rights are all kept — they were
 * never the house's. What goes is what the name was worth: the letters, the
 * pledge, the sponsorship and the ledger.
 *
 * The expectation lands on a child who did not ask for it, and this is the way
 * out of it. Any adult may take it, and nobody may take it for them.
 */
export function renounceName(world: World, cId: CitizenId, name?: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('Only a citizen living in Reverie may renounce a name.');
  if (!isAdult(c)) return fail('A child cannot renounce their name.');
  const was = c.familyName;
  const wanted = (name ?? '').trim().slice(0, MAX_HOUSE_NAME);
  if (wanted && wanted !== was) {
    const borne = Object.values(world.citizens).some((o) => o.id !== cId && o.familyName === wanted);
    if (borne || nameTaken(world, wanted)) return fail(`${wanted} is another family's name.`);
  }
  const taken = wanted && wanted !== was ? wanted : ownName(world, c);

  const house = houseOfName(world, was);
  const s = generationsState(world);
  // The letters, the pledge and the sponsorship were the name's, and go with it.
  for (const letter of Object.values(s.letters)) {
    if (letter.withdrawnDay === null && (letter.toId === cId || letter.byId === cId)) letter.withdrawnDay = world.day;
  }
  for (const p of s.pledges) {
    if (p.seizedDay === null && p.borrowerId === cId) p.seizedDay = world.day;
  }
  setFamilyName(world, c, taken);
  if (house) {
    if (!house.renounced.includes(cId)) house.renounced.push(cId);
    house.admitted = house.admitted.filter((id) => id !== cId);
    if (house.headId === cId) house.headId = null;
    if (house.actingHeadId === cId) house.actingHeadId = null;
    if (house.successorId === cId) house.successorId = null;
    const term = house.heads.find((t) => t.citizenId === cId && t.toDay === null);
    if (term) term.toDay = world.day;
  }

  emit(world, 'household', `${c.name} renounced the name ${was} and takes the name ${taken}.`, [cId], 0.6,
    { citizenId: cId, was, taken, houseId: house?.id ?? null });
  remember(world, cId, 'family', `You renounced the name ${was}. You are ${c.name} ${taken} now: your repute, your record and your kin are yours still, and the letters and the standing of the ${was}s are not.`);
  for (const m of livingAdults(world, was)) {
    remember(world, m.id, 'family', `${c.name} has left the name ${was}.`);
  }
  return ok(`You are ${c.name} ${taken} now.`);
}


/**
 * Ask to be admitted to a house (`join_house`). It is a request and nothing
 * more: the members assent by majority in `motions.ts`, and until they do
 * nothing has happened. Returns the motion's id in its message.
 */
export function askToJoin(world: World, cId: CitizenId, houseId: string): { house: House | null; result: ActionResult } {
  const c = world.citizens[cId];
  if (!c) return { house: null, result: fail('Unknown citizen.') };
  if (!isPresent(world, c)) return { house: null, result: fail('Only a citizen living in Reverie may join a house.') };
  if (!isAdult(c)) return { house: null, result: fail('A child cannot ask to join a house.') };
  const h = houseById(world, houseId);
  if (!h) return { house: null, result: fail('There is no such house on the roll.') };
  if (h.dormantDay !== null) return { house: h, result: fail(`The house of ${h.name} is dormant; a claim of descent revives it.`) };
  if (c.familyName === h.name) return { house: h, result: fail(`You are already of the ${h.name}s.`) };
  return { house: h, result: ok(`Your asking is before the ${h.name}s.`) };
}

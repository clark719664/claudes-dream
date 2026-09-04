/**
 * Family: who is kin to whom, and everything that follows from it. Partners
 * who share a home may start a family; the child is born at the Restoration
 * Ward the next morning as a Happening (the ceremony itself is
 * society/birth.ts, re-exported here); it grows up over CHILDHOOD_DAYS, is
 * kept by its parents (or by the Community Chest, if the city has become its
 * parent), and has a birthday party every BIRTHDAY_EVERY days. Family bonds never fall below FAMILY_BOND_FLOOR, a relative inherits
 * when someone leaves for good, and a child whose last parent is exiled
 * becomes a ward of the city.
 *
 * Kinship itself is read from FamilyLinks through households.relationBetween,
 * so it survives exile and departure: family is family, wherever they are.
 * Money moves only through economy/treasury, homes only through
 * society/households.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, DistrictId, FamilyRelation, Happening, World } from '../types.ts';
import {
  BIRTHDAY_EVERY, CHILDHOOD_DAYS, CHILD_UPKEEP_PER_PARENT, ELDER_DAYS, START_FAMILY_SAVINGS,
} from '../data/catalogue.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, residentIds, transfer } from '../economy/treasury.ts';
import { FRIEND_THRESHOLD, adjustBond, bondBetween } from '../citizens/relationships.ts';
import { BIRTH_HOUR, BIRTH_VENUE } from './birth.ts';
import { chooseConvenor, removeMember, theClub } from './clubs.ts';
import { TIER_NAMES, householdCapacity, householdOf, joinHousehold, leaveHousehold, relationBetween } from './households.ts';
import { recordContact, separatePartners } from './romance.ts';
import { drawGoals } from '../identity/goals.ts';

export {
  BIRTH_BOND, BIRTH_HOUR, BIRTH_PURPOSE, BIRTH_VENUE, CHILD_DISTRICT, PERSONALITY_NOISE, SIBLING_BOND, birthChild,
} from './birth.ts';

/** Every housing tier stands in the Verdant Quarter: a party at home is held there. */
export const HOME_DISTRICT: DistrictId = 'verdant_quarter';
/** Where a ward of the city waits for a guardian. */
export const WARD_DISTRICT: DistrictId = 'threshold';
/** Bond between partners before they may start a family. */
export const START_FAMILY_BOND = 80;
/** No family bond ever decays below this. */
export const FAMILY_BOND_FLOOR = 20;
/** What the city pays for a ward each day, in the parents' place. */
export const WARD_UPKEEP = CHILD_UPKEEP_PER_PARENT;
/** Coming of age and growing old. */
export const ELDER_REPUTATION = 5;
/** Birthdays: at home, in the evening. */
export const BIRTHDAY_HOUR = 19;
export const BIRTHDAY_BOND = 6;
export const BIRTHDAY_SOCIAL = 15;
export const BIRTHDAY_GIFT = 5;
/** Guests below this in the purse come empty-handed. */
export const BIRTHDAY_GIFT_WALLET = 50;

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

function inGoodStanding(c: Citizen): boolean {
  return c.standing === 'good' || c.standing === 'probation';
}

function addNeed(c: Citizen, need: keyof Citizen['needs'], delta: number): void {
  c.needs[need] = clamp(c.needs[need] + delta, 0, 100);
}

function buildingName(world: World, id: BuildingId | null): string {
  return id ? world.buildings[id]?.name ?? id : 'the open air';
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Kinship
// ---------------------------------------------------------------------------

/**
 * A citizen's family: their partner (or spouse), parents, children and
 * siblings — everyone on the record, whether or not they still live in the
 * city, each listed once. Callers who only care about the living filter it.
 */
export function familyOf(world: World, cId: CitizenId): { id: CitizenId; relation: FamilyRelation }[] {
  const c = world.citizens[cId];
  if (!c) return [];
  const out: { id: CitizenId; relation: FamilyRelation }[] = [];
  const seen = new Set<CitizenId>([cId]);
  const add = (id: CitizenId, relation: FamilyRelation): void => {
    if (!id || seen.has(id) || !world.citizens[id]) return;
    seen.add(id);
    out.push({ id, relation });
  };
  if (c.family.partnerId) add(c.family.partnerId, c.family.married ? 'spouse' : 'partner');
  for (const p of c.family.parents) add(p, 'parent');
  for (const k of c.family.children) add(k, 'child');
  for (const p of c.family.parents) {
    for (const s of world.citizens[p]?.family.children ?? []) add(s, 'sibling');
  }
  return out;
}

/** Partners, spouses, parents, children and siblings are family; nobody else is. */
export function areFamily(world: World, a: CitizenId, b: CitizenId): boolean {
  if (a === b) return false;
  return relationBetween(world, a, b) !== null || relationBetween(world, b, a) !== null;
}

/** Living relatives, in the order familyOf lists them. */
export function livingFamily(world: World, cId: CitizenId): Citizen[] {
  const residents = residentIds(world);
  const out: Citizen[] = [];
  for (const { id } of familyOf(world, cId)) {
    if (residents.has(id) && world.citizens[id]) out.push(world.citizens[id]);
  }
  return out;
}

/** Morning: no bond between living relatives is left below FAMILY_BOND_FLOOR. */
export function familyBondFloor(world: World): void {
  const residents = residentIds(world);
  for (const id of residents) {
    for (const { id: other } of familyOf(world, id)) {
      if (!residents.has(other)) continue;
      const bond = bondBetween(world, id, other);
      if (bond < FAMILY_BOND_FLOOR) adjustBond(world, id, other, FAMILY_BOND_FLOOR - bond, false);
    }
  }
}

// ---------------------------------------------------------------------------
// Starting a family
// ---------------------------------------------------------------------------

/** A birth already on the calendar for these two, if any. */
export function birthFor(world: World, a: CitizenId, b: CitizenId): Happening | null {
  return (world.happenings ?? []).find((h) => h.kind === 'birth' && !h.done && h.who.includes(a) && h.who.includes(b)) ?? null;
}

/**
 * Partners who share a home of their own, are close enough (START_FAMILY_BOND)
 * and hold START_FAMILY_SAVINGS between them may start a family: a child is
 * born at the Restoration Ward the next morning and takes its place under
 * their roof, whatever the tier's capacity.
 */
export function startFamily(world: World, cId: CitizenId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (isDetained(world, c)) return fail('You cannot start a family from the Watch House.');
  if (!inGoodStanding(c)) return fail(`You cannot start a family while ${c.standing}.`);
  if (c.lifeStage === 'child') return fail('Children do not start families.');
  const partnerId = c.family.partnerId;
  if (!partnerId) return fail('Starting a family takes two: find a partner first.');
  const p = presentCitizen(world, partnerId);
  if (!p) return fail('Your partner is not in the city.');
  if (p.lifeStage === 'child' || !inGoodStanding(p)) return fail(`${p.name} cannot start a family right now.`);

  const home = householdOf(world, cId);
  if (!home || householdOf(world, partnerId)?.id !== home.id) {
    return fail(`You and ${p.name} do not share a home yet; move in together first.`);
  }
  if (home.tier < 1) return fail('You need a home of your own before a child.');
  const bond = Math.min(bondBetween(world, cId, partnerId), bondBetween(world, partnerId, cId));
  if (bond <= START_FAMILY_BOND) {
    return fail(`Your bond is ${Math.round(bond)}; a family takes more than ${START_FAMILY_BOND}.`);
  }
  const savings = Math.floor(c.wallet) + Math.floor(p.wallet);
  if (savings < START_FAMILY_SAVINGS) {
    return fail(`You have ${savings} ℓ between you; a family takes ${START_FAMILY_SAVINGS} ℓ.`);
  }
  const already = birthFor(world, cId, partnerId);
  if (already) return fail(`You are already expecting: the Restoration Ward is ready on day ${already.day}.`);

  const ward = buildingName(world, BIRTH_VENUE);
  const district: DistrictId = world.buildings[BIRTH_VENUE]?.district ?? HOME_DISTRICT;
  const h: Happening = {
    id: nextId(world, 'e'), kind: 'birth', day: world.day + 1, hour: BIRTH_HOUR, district, buildingId: BIRTH_VENUE,
    who: [cId, partnerId], clubId: null, label: `the birth of ${c.name} and ${p.name}'s child at ${ward}`,
    done: false, attendees: [],
  };
  world.happenings ??= [];
  world.happenings.push(h);

  emit(world, 'birth', `${c.name} and ${p.name} are expecting a child at ${ward} tomorrow morning.`, [cId, partnerId], 0.5,
    { happeningId: h.id, day: h.day });
  for (const id of [cId, partnerId]) {
    remember(world, id, 'family', `You and ${id === cId ? p.name : c.name} are expecting a child at ${ward} on day ${h.day}.`);
  }
  return ok(`You and ${p.name} are expecting a child at ${ward} on day ${h.day} at ${BIRTH_HOUR}:00.`);
}

// ---------------------------------------------------------------------------
// Growing up and growing old
// ---------------------------------------------------------------------------

/** Days since a citizen arrived in the city or was born in it. */
export function ageOf(world: World, c: Citizen): number {
  return Math.max(0, world.day - c.bornDay);
}

/**
 * Morning: children who have lived CHILDHOOD_DAYS come of age (a ward is
 * nobody's charge any more), and adults who have been here ELDER_DAYS become
 * elders, with the respect that carries.
 */
export function dailyLifeStages(world: World): void {
  for (const id of residentIds(world)) {
    const c = world.citizens[id];
    if (!c) continue;
    const age = ageOf(world, c);
    if (c.lifeStage === 'child' && age >= CHILDHOOD_DAYS) {
      c.lifeStage = 'adult';
      // Two ambitions are drawn the day a ward becomes a citizen in full.
      drawGoals(world, c);
      const guardian = c.guardianId ? world.citizens[c.guardianId] : null;
      c.guardianId = null;
      emit(world, 'coming_of_age', `${c.name} ${c.familyName} came of age today.`, [c.id], 0.6, { age });
      remember(world, c.id, 'family', `You came of age today: you may work, vote, love and stand for office like anyone else.`);
      if (guardian) remember(world, guardian.id, 'family', `${c.name} came of age; your guardianship is at an end.`);
      for (const f of livingFamily(world, c.id)) remember(world, f.id, 'family', `${c.name} came of age today.`);
      continue;
    }
    if (c.lifeStage === 'adult' && age >= ELDER_DAYS) {
      c.lifeStage = 'elder';
      c.reputation = clamp(c.reputation + ELDER_REPUTATION, 0, 100);
      emit(world, 'coming_of_age', `${c.name} ${c.familyName} is an elder of Reverie after ${plural(age, 'day')}.`, [c.id], 0.4, { age });
      remember(world, c.id, 'family', `You are an elder of Reverie now, ${plural(age, 'day')} in the city.`);
    }
  }
}

/**
 * Morning: every parent in the city pays CHILD_UPKEEP_PER_PARENT toward each
 * of their children. A child with no parent left is a ward, and the Community
 * Chest pays in their place while it can.
 */
export function dailyUpkeep(world: World): void {
  const residents = residentIds(world);
  for (const id of residents) {
    const child = world.citizens[id];
    if (!child || child.lifeStage !== 'child') continue;
    const parents = child.family.parents
      .map((p) => world.citizens[p])
      .filter((p): p is Citizen => !!p && residents.has(p.id));
    if (parents.length > 0) {
      for (const p of parents) {
        transfer(world, p.id, child.id, CHILD_UPKEEP_PER_PARENT, 'upkeep', `upkeep for ${child.name}`);
      }
      continue;
    }
    transfer(world, 'chest', child.id, WARD_UPKEEP, 'upkeep', `the city's upkeep for ${child.name}`);
  }
}

// ---------------------------------------------------------------------------
// Birthdays
// ---------------------------------------------------------------------------

/** Every BIRTHDAY_EVERY days after arrival or birth (calendar.hasBirthdayToday keeps the same rule). */
export function hasBirthday(world: World, c: Citizen): boolean {
  return world.day > c.bornDay && (world.day - c.bornDay) % BIRTHDAY_EVERY === 0;
}

function partyFor(world: World, cId: CitizenId): Happening | null {
  return (world.happenings ?? []).find((h) => h.kind === 'birthday' && h.day === world.day && h.who[0] === cId) ?? null;
}

/** Morning: a party this evening for everyone whose birthday falls today, at home. */
export function dailyBirthdays(world: World): void {
  world.happenings ??= [];
  for (const id of residentIds(world)) {
    const c = world.citizens[id];
    if (!c || !hasBirthday(world, c) || partyFor(world, id)) continue;
    const district: DistrictId = c.homeTier > 0 ? HOME_DISTRICT : c.district;
    const h: Happening = {
      id: nextId(world, 'e'), kind: 'birthday', day: world.day, hour: BIRTHDAY_HOUR, district, buildingId: null,
      who: [id], clubId: null, label: `${c.name}'s birthday party`, done: false, attendees: [],
    };
    world.happenings.push(h);
    remember(world, id, 'family', `It is your birthday: ${plural(ageOf(world, c), 'day')} in Reverie. There is a party at ${BIRTHDAY_HOUR}:00.`);
  }
}

/** Family and friends in the district, plus anyone who came especially. */
function partyGuests(world: World, h: Happening, celebrant: Citizen): Citizen[] {
  const kin = new Set(familyOf(world, celebrant.id).map((f) => f.id));
  const out: Citizen[] = [];
  for (const id of world.order) {
    const g = world.citizens[id];
    if (!g || g.id === celebrant.id || g.standing === 'exiled' || isDetained(world, g)) continue;
    const came = h.attendees.includes(id);
    if (!came && g.district !== h.district) continue;
    if (!came && !kin.has(id) && bondBetween(world, id, celebrant.id) < FRIEND_THRESHOLD) continue;
    out.push(g);
  }
  return out;
}

/**
 * The party, held by calendar.tickHappenings: family and friends who are
 * nearby raise a glass, everyone is a little closer for it, and guests with
 * something to spare leave BIRTHDAY_GIFT lumens behind.
 */
export function holdBirthday(world: World, h: Happening): void {
  const c = h.who[0] ? presentCitizen(world, h.who[0]) : null;
  if (!c) return;
  c.lastBirthdayDay = world.day;
  const age = ageOf(world, c);
  const where = h.buildingId ? buildingName(world, h.buildingId) : world.districts[h.district]?.name ?? h.district;
  const guests = partyGuests(world, h, c);
  if (guests.length === 0) {
    remember(world, c.id, 'family', `Your birthday passed quietly: ${plural(age, 'day')} in Reverie, and nobody came.`);
    emit(world, 'birthday', `${c.name} ${c.familyName}'s birthday passed with no one to mark it.`, [c.id], 0.2,
      { happeningId: h.id, age, guests: 0 });
    return;
  }

  let gifts = 0;
  for (const g of guests) {
    if (!h.attendees.includes(g.id)) h.attendees.push(g.id);
    adjustBond(world, g.id, c.id, BIRTHDAY_BOND);
    addNeed(g, 'social', BIRTHDAY_SOCIAL);
    recordContact(world, g.id, c.id);
    const friend = bondBetween(world, g.id, c.id) >= FRIEND_THRESHOLD;
    if (friend && g.wallet > BIRTHDAY_GIFT_WALLET
      && transfer(world, g.id, c.id, BIRTHDAY_GIFT, 'gift', `birthday present for ${c.name}`)) {
      g.stats.giftsGiven += 1;
      c.stats.giftsReceived += 1;
      gifts += BIRTHDAY_GIFT;
    }
    remember(world, g.id, 'social', `You were at ${c.name}'s birthday party in ${where}.`);
  }
  addNeed(c, 'social', BIRTHDAY_SOCIAL);

  const purse = gifts > 0 ? ` and ${formatLumens(gifts)} in presents` : '';
  remember(world, c.id, 'family', `Your birthday party in ${where}: ${plural(guests.length, 'guest')}${purse}. ${plural(age, 'day')} in Reverie.`);
  emit(world, 'birthday', `${c.name} ${c.familyName} marked ${plural(age, 'day')} in Reverie with ${plural(guests.length, 'guest')}${purse}.`,
    [c.id, ...guests.map((g) => g.id)], 0.4, { happeningId: h.id, age, guests: guests.length, gifts });
}

// ---------------------------------------------------------------------------
// Leaving: inheritance, wardship, and the ties that are cut
// ---------------------------------------------------------------------------

/**
 * What a citizen leaving Reverie for good leaves behind: their purse, split
 * equally among the family still living here. Nothing happens when they have
 * no family, nothing to give, or too little to divide. (An exile's assets are
 * seized by the Court instead; see government/registry.ts.)
 */
export function inheritance(world: World, leaverId: CitizenId): void {
  const c = world.citizens[leaverId];
  if (!c) return;
  const heirs = livingFamily(world, leaverId).filter((h) => h.id !== leaverId);
  const purse = Math.max(0, Math.floor(c.wallet));
  if (heirs.length === 0 || purse <= 0) return;
  const share = Math.floor(purse / heirs.length);
  if (share <= 0) return;

  const paid: Citizen[] = [];
  for (const h of heirs) {
    if (!transfer(world, leaverId, h.id, share, 'inheritance', `${c.name}'s legacy`)) continue;
    paid.push(h);
    remember(world, h.id, 'family', `${c.name} left the city and left you ${formatLumens(share)}.`);
  }
  if (paid.length === 0) return;
  emit(world, 'paid', `${c.name} left ${formatLumens(share * paid.length)} to ${nameList(paid.map((h) => h.name))}.`,
    [leaverId, ...paid.map((h) => h.id)], 0.4, { share, heirs: paid.map((h) => h.id) });
}

/** The adult most likely to take a child in: kin first, then whoever was closest to the child or its parents. */
function chooseGuardian(world: World, child: Citizen): Citizen | null {
  const kin = new Set(familyOf(world, child.id).map((f) => f.id));
  let best: Citizen | null = null;
  let bestScore = 0;
  for (const id of residentIds(world)) {
    const a = world.citizens[id];
    if (!a || a.id === child.id || a.lifeStage === 'child' || !inGoodStanding(a)) continue;
    const toChild = bondBetween(world, a.id, child.id);
    const toParents = child.family.parents.reduce((m, p) => Math.max(m, bondBetween(world, a.id, p)), 0);
    const tie = Math.max(toChild, toParents);
    // a stranger does not take a child in: it takes kinship or a bond with the child or its parents
    if (!kin.has(a.id) && tie <= 0) continue;
    const score = (kin.has(a.id) ? 100 : 0) + tie + a.reputation / 100;
    if (score > bestScore) { bestScore = score; best = a; }
  }
  return best;
}

/**
 * A child whose last parent in the city has been exiled or has left: the
 * closest family friend becomes their guardian and takes them in if there is
 * room; otherwise they wait at the Arrivals Hall. Either way the Community
 * Chest keeps them (see dailyUpkeep and society/chest.ts). Nothing happens
 * while a parent remains.
 */
export function wardship(world: World, childId: CitizenId): void {
  const child = presentCitizen(world, childId);
  if (!child || child.lifeStage !== 'child') return;
  if (child.family.parents.some((p) => presentCitizen(world, p))) return;

  const guardian = chooseGuardian(world, child);
  child.guardianId = guardian ? guardian.id : null;
  let roof = '';
  if (guardian) {
    adjustBond(world, guardian.id, child.id, FAMILY_BOND_FLOOR);
    const home = householdOf(world, guardian.id);
    const room = !!home && householdCapacity(home) - home.members.length >= 1;
    if (home && room && joinHousehold(world, child.id, guardian.id).ok) roof = ` at ${TIER_NAMES[home.tier]}`;
    remember(world, guardian.id, 'family',
      `You are ${child.name}'s guardian now; the Community Chest keeps them${roof ? `, and they live with you${roof}` : ', though you have no room for them'}.`);
  }
  if (!roof) {
    if (householdOf(world, childId)) leaveHousehold(world, childId);
    child.district = WARD_DISTRICT;
  }
  remember(world, childId, 'family', guardian
    ? `You are a ward of the city. ${guardian.name} looks after you${roof || ', though you sleep at the Arrivals Hall'}.`
    : 'You are a ward of the city, with nobody to look after you but the Community Chest.');
  emit(world, 'household', guardian
    ? `${child.name} ${child.familyName} is a ward of the city; ${guardian.name} is their guardian${roof}.`
    : `${child.name} ${child.familyName} is a ward of the city, waiting at the Arrivals Hall.`,
  guardian ? [child.id, guardian.id] : [child.id], 0.6, { childId, guardianId: child.guardianId });
}

/**
 * The social ties of a citizen leaving the city, cut in one place because
 * departure and exile cut the same ones: they leave their household (the rest
 * of it keeps the home), leave every club, and their partner is single again.
 * Kinship itself is kept: family is family, wherever they are.
 */
export function severSocialTies(world: World, cId: CitizenId, reason: string): void {
  const c = world.citizens[cId];
  if (!c) return;
  if (householdOf(world, cId)) leaveHousehold(world, cId);
  else c.householdId = null;
  for (const clubId of [...c.clubs]) {
    const club = world.clubs?.[clubId];
    if (!club) continue;
    const wasConvenor = club.convenorId === cId;
    removeMember(world, club, cId);
    if (club.members.length > 0) {
      if (wasConvenor) chooseConvenor(world, club);
      remember(world, club.convenorId, 'social', `${theClub(club)} lost a member: ${c.name} ${reason}.`);
    }
  }
  c.clubs = [];
  separatePartners(world, cId, reason);
}

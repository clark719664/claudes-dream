/**
 * Romance: the second axis of feeling between citizens. Bonds say how much
 * two people like each other; affection says who they are drawn to. It grows
 * only from hours actually spent together (recordContact, called by every
 * action that puts two citizens in the same room) and fades without them.
 *
 * The affection itself — contact, growth and decay — lives in
 * society/affection.ts and is re-exported here, so romance.ts is the one
 * import the rest of the engine needs.
 *
 * From affection come partnerships (a proposal accepted at PARTNERSHIP_AFFECTION),
 * weddings (arranged by `marry`, held the next evening at the Sound Garden as
 * a Happening, see calendar.ts) and, when it goes wrong, breakups that split
 * a household. Nothing here decides for a citizen: every step is an action a
 * mind chose. Money moves only through economy/treasury; homes only through
 * society/households.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, BuildingId, Citizen, CitizenId, DistrictId, Happening, HousingTier, Item, MoneyParty, Need, World,
} from '../types.ts';
import { DINE_PRICE_MULTIPLIER, MAX_POSSESSIONS, PRODUCTS } from '../data/catalogue.ts';
import { chance } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { marketPrice } from '../economy/market.ts';
import { transfer } from '../economy/treasury.ts';
import { FRIEND_THRESHOLD, adjustBond, bondBetween } from '../citizens/relationships.ts';
import { addAffection, affectionBetween, isAdult, recordContact } from './affection.ts';
import { TIER_NAMES, householdOf, leaveHousehold, relationBetween } from './households.ts';
import { preferenceScore } from './tastes.ts';
import { reconcileByMarriage } from '../social/feuds.ts';

export {
  AFFECTION_BASE, AFFECTION_BOND_DIVISOR, AFFECTION_COMPATIBILITY, AFFECTION_DAILY_CAP, AFFECTION_DECAY, COLLAPSED_BOND,
  affectionBetween, dailyAffection, openToAffection, recordContact,
} from './affection.ts';

/** A date: dinner (both pay) or a walk in the Community Garden (free). */
export const TAVERN: BuildingId = 'halflight_tavern';
export const GARDEN: BuildingId = 'community_garden';
export const DATE_AFFECTION = 8;
export const DATE_BOND = 6;
export const DATE_SOCIAL = 15;
export const DATE_ENERGY = 20;
export const DATE_REST = 5;
/** What a slighted partner's bond loses, and the chance they hear about it. */
export const JEALOUSY_BOND = 10;
export const JEALOUSY_LEARN_CHANCE = 0.5;

/** Partnership: the target's affection for the proposer must have reached this. */
export const PARTNERSHIP_AFFECTION = 60;
export const PARTNERSHIP_BOND = 10;
export const PARTNERSHIP_SOCIAL = 10;

/** Marriage: days as partners and the bond a wedding takes. */
export const MARRIAGE_MIN_DAYS = 7;
export const MARRIAGE_MIN_BOND = 75;
export const WEDDING_VENUE: BuildingId = 'sound_garden';
export const WEDDING_HOUR = 20;
/** Reputations within this of each other and both partners keep their family name. */
export const NAME_MERGE_MARGIN = 5;
/** The wedding itself. */
export const WEDDING_SOCIAL = 20;
export const WEDDING_GUEST_BOND = 4;
export const COUPLE_BOND = 10;
export const COUPLE_AFFECTION = 10;
export const WEDDING_GIFT = 10;
/** A possession the couple would love this much is given instead of lumens. */
export const GIFT_TASTE_MIN = 0.5;

/** Breaking up. */
export const BREAKUP_BOND = 40;
export const BREAKUP_SOCIAL = 15;

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

function districtName(world: World, d: DistrictId): string {
  return world.districts[d]?.name ?? d;
}

function buildingName(world: World, id: BuildingId | null): string {
  return id ? world.buildings[id]?.name ?? id : 'the open air';
}

function addNeed(c: Citizen, need: Need, delta: number): void {
  c.needs[need] = clamp(c.needs[need] + delta, 0, 100);
}

function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// Dates
// ---------------------------------------------------------------------------

/** What a table for one costs tonight: the price of a meal, not of compute. */
export function dateCost(world: World): number {
  return Math.max(1, Math.round(marketPrice(world, 'compute') * DINE_PRICE_MULTIPLIER));
}

export interface DateVenue {
  name: string;
  /** Who is paid for the table; null for a free walk in the Garden. */
  payTo: MoneyParty | null;
}

/** Somewhere in this district to take someone: a café first, then the Tavern, then the Garden. */
export function dateVenueIn(world: World, district: DistrictId): DateVenue | null {
  for (const b of Object.values(world.businesses)) {
    if (b.dissolvedDay === null && b.kind === 'cafe' && b.district === district) return { name: b.name, payTo: b.id };
  }
  if (world.buildings[TAVERN]?.district === district) return { name: buildingName(world, TAVERN), payTo: 'treasury' };
  if (world.buildings[GARDEN]?.district === district) return { name: buildingName(world, GARDEN), payTo: null };
  return null;
}

/** A partner (of either dater) who is not the other: the person with something to lose. */
function jealousPartners(world: World, a: Citizen, b: Citizen): Citizen[] {
  const out: Citizen[] = [];
  for (const [dater, otherId] of [[a, b.id], [b, a.id]] as [Citizen, CitizenId][]) {
    const pId = dater.family.partnerId;
    if (!pId || pId === otherId) continue;
    const p = world.citizens[pId];
    if (p && !out.includes(p)) out.push(p);
  }
  return out;
}

/**
 * An evening out with someone: dinner at a café or the Halflight Tavern (both
 * pay their own way) or a free walk in the Community Garden. Affection and
 * bond both rise. Anyone's partner left at home resents it, and half the time
 * hears about it.
 */
export function date(world: World, cId: CitizenId, withId: CitizenId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (withId === cId) return fail('A date takes two.');
  if (isDetained(world, c)) return fail('You cannot go courting from the Watch House.');
  if (!inGoodStanding(c)) return fail(`You cannot go courting while ${c.standing}.`);
  if (!isAdult(c)) return fail('Children do not date; they play.');
  const t = presentCitizen(world, withId);
  if (!t) return fail('Nobody by that id is around.');
  if (isDetained(world, t)) return fail(`${t.name} is held at the Watch House.`);
  if (!isAdult(t)) return fail(`${t.name} is a child.`);
  if (!inGoodStanding(t)) return fail(`${t.name} cannot come out while ${t.standing}.`);
  if (t.district !== c.district) return fail(`${t.name} is in ${districtName(world, t.district)}, not here.`);

  const venue = dateVenueIn(world, c.district);
  if (!venue) {
    return fail(`There is nowhere in ${districtName(world, c.district)} to take someone: try a café or the Halflight Tavern in Nightglass, or the Community Garden in the Verdant Quarter.`);
  }
  const cost = venue.payTo === null ? 0 : dateCost(world);
  if (cost > 0) {
    if (c.wallet < cost) return fail(`A table at ${venue.name} costs ${cost} ℓ each; you have ${c.wallet} ℓ.`);
    if (t.wallet < cost) return fail(`${t.name} cannot spare the ${cost} ℓ a table at ${venue.name} costs.`);
    const memo = `a table for two at ${venue.name}`;
    if (!transfer(world, cId, venue.payTo as MoneyParty, cost, 'purchase', memo)) return fail('The table could not be paid for.');
    if (!transfer(world, withId, venue.payTo as MoneyParty, cost, 'purchase', memo)) {
      transfer(world, venue.payTo as MoneyParty, cId, cost, 'purchase', `refund for ${memo}`);
      return fail(`${t.name} could not pay their half of the bill.`);
    }
  }

  addAffection(c, withId, DATE_AFFECTION);
  addAffection(t, cId, DATE_AFFECTION);
  adjustBond(world, cId, withId, DATE_BOND);
  for (const person of [c, t]) {
    addNeed(person, 'social', DATE_SOCIAL);
    if (cost > 0) addNeed(person, 'energy', DATE_ENERGY);
    else addNeed(person, 'rest', DATE_REST);
  }
  recordContact(world, cId, withId);

  const slighted = jealousPartners(world, c, t);
  for (const p of slighted) {
    const strayed = p.family.partnerId === cId ? c : t;
    const other = strayed === c ? t : c;
    adjustBond(world, p.id, strayed.id, -JEALOUSY_BOND, false);
    if (chance(world, JEALOUSY_LEARN_CHANCE)) {
      remember(world, p.id, 'family', `You heard that ${strayed.name} spent the evening with ${other.name} at ${venue.name}.`);
    }
  }

  const bill = cost > 0 ? ` for ${cost} ℓ each` : '';
  remember(world, cId, 'social', `You spent the evening with ${t.name} at ${venue.name}${bill}.`);
  remember(world, withId, 'social', `You spent the evening with ${c.name} at ${venue.name}${bill}.`);
  emit(world, 'romance', `${c.name} and ${t.name} were seen together at ${venue.name}.`, [cId, withId], 0.3,
    { venue: venue.name, cost, jealous: slighted.map((p) => p.id) });
  return ok(`You spent the evening with ${t.name} at ${venue.name}${bill}.`);
}

// ---------------------------------------------------------------------------
// Partnership
// ---------------------------------------------------------------------------

/** Kin nobody may partner with. */
function forbiddenKin(world: World, a: CitizenId, b: CitizenId): boolean {
  const relation = relationBetween(world, a, b) ?? relationBetween(world, b, a);
  return relation === 'parent' || relation === 'child' || relation === 'sibling';
}

/** Ask someone to be your partner. They say yes when their affection has reached PARTNERSHIP_AFFECTION. */
export function proposePartnership(world: World, cId: CitizenId, to: CitizenId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (to === cId) return fail('You cannot be your own partner.');
  if (isDetained(world, c)) return fail('You cannot propose from the Watch House.');
  if (!inGoodStanding(c)) return fail(`You cannot propose a partnership while ${c.standing}.`);
  if (!isAdult(c)) return fail('Partnerships are for adults.');
  const t = presentCitizen(world, to);
  if (!t) return fail('Nobody by that id is around.');
  if (!isAdult(t)) return fail(`${t.name} is a child.`);
  if (isDetained(world, t)) return fail(`${t.name} is held at the Watch House.`);
  if (t.district !== c.district) return fail(`${t.name} is in ${districtName(world, t.district)}, not here.`);
  if (c.family.partnerId) {
    const own = world.citizens[c.family.partnerId]?.name ?? c.family.partnerId;
    return fail(`You are already with ${own}; break up first.`);
  }
  if (t.family.partnerId) return fail(`${t.name} is already with somebody else.`);
  if (forbiddenKin(world, cId, to)) return fail(`${t.name} is family.`);
  const felt = affectionBetween(world, to, cId);
  if (felt < PARTNERSHIP_AFFECTION) {
    return fail(`${t.name} is not that fond of you yet (${Math.round(felt)} of the ${PARTNERSHIP_AFFECTION} it takes). Spend more time together.`);
  }

  c.family.partnerId = to;
  c.family.partnerSinceDay = world.day;
  c.family.married = false;
  t.family.partnerId = cId;
  t.family.partnerSinceDay = world.day;
  t.family.married = false;
  adjustBond(world, cId, to, PARTNERSHIP_BOND);
  addNeed(c, 'social', PARTNERSHIP_SOCIAL);
  addNeed(t, 'social', PARTNERSHIP_SOCIAL);
  recordContact(world, cId, to);

  emit(world, 'romance', `${c.name} ${c.familyName} and ${t.name} ${t.familyName} are partners.`, [cId, to], 0.5,
    { since: world.day });
  remember(world, cId, 'family', `${t.name} said yes: you are partners as of day ${world.day}.`);
  remember(world, to, 'family', `You said yes to ${c.name}: you are partners as of day ${world.day}.`);
  return ok(`${t.name} said yes; you are partners.`);
}

// ---------------------------------------------------------------------------
// Marriage
// ---------------------------------------------------------------------------

/** A wedding already on the calendar for these two, if any. */
export function weddingFor(world: World, a: CitizenId, b: CitizenId): Happening | null {
  return (world.happenings ?? []).find((h) => h.kind === 'wedding' && !h.done && h.who.includes(a) && h.who.includes(b)) ?? null;
}

/**
 * Arrange a wedding: partners of at least MARRIAGE_MIN_DAYS days whose bond
 * has passed MARRIAGE_MIN_BOND are married the next evening at the Sound
 * Garden. Nothing changes until the ceremony is held (calendar.tickHappenings
 * calls holdWedding), so either of them may still break it off.
 */
export function marry(world: World, cId: CitizenId, to: CitizenId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (to === cId) return fail('You cannot marry yourself.');
  if (isDetained(world, c)) return fail('You cannot arrange a wedding from the Watch House.');
  if (!inGoodStanding(c)) return fail(`You cannot arrange a wedding while ${c.standing}.`);
  const t = presentCitizen(world, to);
  if (!t) return fail('Nobody by that id is around.');
  if (c.family.partnerId !== to || t.family.partnerId !== cId) return fail(`You and ${t.name} are not partners.`);
  if (c.family.married) return fail(`You are already married to ${t.name}.`);
  const since = c.family.partnerSinceDay ?? world.day;
  const days = world.day - since;
  if (days < MARRIAGE_MIN_DAYS) {
    return fail(`You have been partners for ${plural(days, 'day')}; a wedding takes ${MARRIAGE_MIN_DAYS}.`);
  }
  const bond = Math.min(bondBetween(world, cId, to), bondBetween(world, to, cId));
  if (bond <= MARRIAGE_MIN_BOND) {
    return fail(`Your bond is ${Math.round(bond)}; a wedding takes more than ${MARRIAGE_MIN_BOND}.`);
  }
  const already = weddingFor(world, cId, to);
  if (already) return fail(`Your wedding is already arranged for day ${already.day} at ${already.hour}:00.`);

  const venue = buildingName(world, WEDDING_VENUE);
  const district: DistrictId = world.buildings[WEDDING_VENUE]?.district ?? 'nightglass';
  const h: Happening = {
    id: nextId(world, 'e'), kind: 'wedding', day: world.day + 1, hour: WEDDING_HOUR, district, buildingId: WEDDING_VENUE,
    who: [cId, to], clubId: null, label: `the wedding of ${c.name} and ${t.name} at ${venue}`, done: false, attendees: [],
  };
  world.happenings ??= [];
  world.happenings.push(h);

  emit(world, 'romance', `${c.name} and ${t.name} will marry at ${venue} tomorrow at ${WEDDING_HOUR}:00.`, [cId, to], 0.5,
    { happeningId: h.id, day: h.day, hour: h.hour });
  for (const id of [cId, to]) {
    remember(world, id, 'family', `Your wedding is set for day ${h.day} at ${WEDDING_HOUR}:00 at ${venue}.`);
  }
  return ok(`Your wedding with ${t.name} is set for day ${h.day} at ${WEDDING_HOUR}:00 at ${venue}.`);
}

/**
 * The family name after a wedding: the higher-reputation partner's, unless the
 * two are within NAME_MERGE_MARGIN of each other, in which case both keep the
 * name they came with. Returns the shared name, or null when both kept theirs.
 */
function mergeFamilyNames(a: Citizen, b: Citizen): string | null {
  if (a.familyName === b.familyName) return a.familyName;
  if (Math.abs(a.reputation - b.reputation) <= NAME_MERGE_MARGIN) return null;
  const higher = a.reputation > b.reputation ? a : b;
  const other = higher === a ? b : a;
  other.familyName = higher.familyName;
  other.family.familyName = higher.familyName;
  return higher.familyName;
}

/** Guests: everyone free in the district, plus anyone who came especially, minus the couple. */
function weddingGuests(world: World, h: Happening, couple: Citizen[]): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const g = world.citizens[id];
    if (!g || g.standing === 'exiled' || isDetained(world, g) || couple.includes(g)) continue;
    if (g.district !== h.district && !h.attendees.includes(id)) continue;
    out.push(g);
  }
  return out;
}

/** The partner a guest knows best (their gift goes to them). */
function closerOf(world: World, guest: Citizen, couple: Citizen[]): Citizen {
  return bondBetween(world, guest.id, couple[1].id) > bondBetween(world, guest.id, couple[0].id) ? couple[1] : couple[0];
}

/** A possession of the guest's that the newlywed would love, if they have room for it. */
function giftableItem(world: World, guest: Citizen, to: Citizen): Item | null {
  if (to.possessions.length >= MAX_POSSESSIONS) return null;
  for (const item of guest.possessions) {
    if (preferenceScore(to, item.productId, world) >= GIFT_TASTE_MIN) return item;
  }
  return null;
}

/**
 * The ceremony, held by calendar.tickHappenings at the hour it falls on: the
 * couple are married, family names may merge, and everyone in the district
 * attends. Friends bring a present — something the couple would love, or ten
 * lumens. Never throws: a couple who parted or left is simply not married.
 */
export function holdWedding(world: World, h: Happening): void {
  const couple = h.who.map((id) => presentCitizen(world, id)).filter((c): c is Citizen => !!c);
  if (couple.length < 2) return;
  const [a, b] = couple;
  if (a.family.partnerId !== b.id || b.family.partnerId !== a.id) return;

  a.family.married = true;
  b.family.married = true;
  // A marriage across a feud is how a feud ends (social/feuds.ts).
  reconcileByMarriage(world, a.id, b.id);
  const shared = mergeFamilyNames(a, b);
  adjustBond(world, a.id, b.id, COUPLE_BOND);
  addAffection(a, b.id, COUPLE_AFFECTION);
  addAffection(b, a.id, COUPLE_AFFECTION);
  recordContact(world, a.id, b.id);
  for (const person of couple) addNeed(person, 'social', WEDDING_SOCIAL);

  const venue = buildingName(world, h.buildingId);
  const guests = weddingGuests(world, h, couple);
  let lumens = 0;
  const presents: string[] = [];
  for (const g of guests) {
    if (!h.attendees.includes(g.id)) h.attendees.push(g.id);
    addNeed(g, 'social', WEDDING_SOCIAL);
    for (const person of couple) {
      adjustBond(world, g.id, person.id, WEDDING_GUEST_BOND);
      recordContact(world, g.id, person.id);
    }
    const friendly = Math.max(bondBetween(world, g.id, a.id), bondBetween(world, g.id, b.id)) >= FRIEND_THRESHOLD;
    if (!friendly) {
      remember(world, g.id, 'social', `You were at the wedding of ${a.name} and ${b.name} at ${venue}.`);
      continue;
    }
    const to = closerOf(world, g, couple);
    const item = giftableItem(world, g, to);
    if (item) {
      g.possessions = g.possessions.filter((i) => i.id !== item.id);
      to.possessions.push({ ...item, acquiredDay: world.day });
      g.stats.giftsGiven += 1;
      to.stats.giftsReceived += 1;
      const name = PRODUCTS[item.productId]?.name ?? item.productId;
      presents.push(`${g.name}'s ${name}`);
      remember(world, g.id, 'social', `You gave ${to.name} your ${name} as a wedding present.`);
      remember(world, to.id, 'family', `${g.name} gave you a ${name} as a wedding present.`);
      continue;
    }
    if (transfer(world, g.id, to.id, WEDDING_GIFT, 'gift', `wedding present for ${to.name}`)) {
      g.stats.giftsGiven += 1;
      to.stats.giftsReceived += 1;
      lumens += WEDDING_GIFT;
      remember(world, g.id, 'social', `You gave ${to.name} ${WEDDING_GIFT} ℓ as a wedding present.`);
      continue;
    }
    remember(world, g.id, 'social', `You were at the wedding of ${a.name} and ${b.name} at ${venue}, with nothing to give.`);
  }

  const names = shared
    ? `They take the name ${shared}.`
    : `They keep their names, ${a.familyName} and ${b.familyName}.`;
  const gifts = lumens > 0 || presents.length > 0
    ? ` Their friends gave ${nameList([...presents, ...(lumens > 0 ? [`${lumens} ℓ in all`] : [])])}.`
    : '';
  emit(world, 'wedding', `${a.name} and ${b.name} were married at ${venue} before ${plural(guests.length, 'guest')}. ${names}${gifts}`,
    [a.id, b.id, ...guests.map((g) => g.id)], 0.9,
    { happeningId: h.id, couple: [a.id, b.id], guests: guests.length, gifts: lumens, familyName: shared });
  for (const person of couple) {
    const other = person === a ? b : a;
    remember(world, person.id, 'family', `You married ${other.name} at ${venue} before ${plural(guests.length, 'guest')}.${shared ? ` You are the ${shared} family now.` : ''}`);
  }
}

// ---------------------------------------------------------------------------
// Breaking up
// ---------------------------------------------------------------------------

/** Everything both records hold about a partnership, cleared. */
function clearPartnership(a: Citizen, b: Citizen | null): void {
  a.family.partnerId = null;
  a.family.partnerSinceDay = null;
  a.family.married = false;
  if (!b) return;
  b.family.partnerId = null;
  b.family.partnerSinceDay = null;
  b.family.married = false;
}

/** Who keeps the home: the higher earner; if they earn alike, the head of the household. */
function keepsTheHome(world: World, a: Citizen, b: Citizen): Citizen {
  if (a.stats.totalEarned !== b.stats.totalEarned) return a.stats.totalEarned > b.stats.totalEarned ? a : b;
  const h = householdOf(world, a.id);
  if (h && h.headId === b.id) return b;
  return a;
}

/**
 * End a partnership or a marriage. The bond falls hard, the affection goes,
 * and a shared home stays with whoever earns more — the other walks out into
 * the street. A marriage ends with a dissolution recorded in the Registry.
 */
export function breakUp(world: World, cId: CitizenId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (isDetained(world, c)) return fail('You cannot end a partnership from the Watch House.');
  const partnerId = c.family.partnerId;
  if (!partnerId) return fail('You have no partner to leave.');
  const married = c.family.married;
  const p = world.citizens[partnerId] ?? null;
  clearPartnership(c, p && p.family.partnerId === cId ? p : null);
  delete c.affection[partnerId];
  if (p) delete p.affection[cId];

  if (!p || !presentCitizen(world, partnerId)) {
    remember(world, cId, 'family', `You are no longer with ${p?.name ?? partnerId}, who has left the city.`);
    return ok(`You are no longer with ${p?.name ?? partnerId}.`);
  }

  adjustBond(world, cId, partnerId, -BREAKUP_BOND);
  addNeed(c, 'social', -BREAKUP_SOCIAL);
  addNeed(p, 'social', -BREAKUP_SOCIAL);

  let street = '';
  const home = householdOf(world, cId);
  if (home && householdOf(world, partnerId)?.id === home.id) {
    const stays = keepsTheHome(world, c, p);
    const leaves = stays === c ? p : c;
    const tier: HousingTier = home.tier;
    leaveHousehold(world, leaves.id);
    street = ` ${leaves.name} moved out of ${TIER_NAMES[tier]}.`;
    remember(world, leaves.id, 'event', `You moved out of ${TIER_NAMES[tier]} and have nowhere to sleep.`);
    remember(world, stays.id, 'event', `${leaves.name} moved out of ${TIER_NAMES[tier]}; the home is yours.`);
  }

  emit(world, 'romance', `${c.name} and ${p.name} are no longer ${married ? 'married' : 'together'}.${street}`,
    [cId, partnerId], 0.5, { married });
  if (married) {
    emit(world, 'law', `The Registry recorded the dissolution of the marriage of ${c.name} and ${p.name}.`, [cId, partnerId], 0.4,
      { dissolution: true });
  }
  remember(world, cId, 'family', `You ended your ${married ? 'marriage' : 'partnership'} with ${p.name}.`);
  remember(world, partnerId, 'family', `${c.name} ended your ${married ? 'marriage' : 'partnership'}.`);
  return ok(`You are no longer ${married ? 'married to' : 'with'} ${p.name}.${street}`);
}

/**
 * A citizen has left the city (departure or exile): their partner is single
 * again, without the rancour of a breakup — bonds and the record are kept, so
 * a pardoned exile can come home to them.
 */
export function separatePartners(world: World, cId: CitizenId, reason: string): CitizenId | null {
  const c = world.citizens[cId];
  if (!c) return null;
  const partnerId = c.family.partnerId;
  const married = c.family.married;
  const p = partnerId ? world.citizens[partnerId] ?? null : null;
  clearPartnership(c, p && p.family.partnerId === cId ? p : null);
  if (!partnerId || !p) return null;
  remember(world, partnerId, 'family', `${c.name} ${reason}; you are no longer ${married ? 'married' : 'partners'}.`);
  return partnerId;
}

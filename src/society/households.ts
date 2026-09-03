/**
 * Households: the citizens who share one home. A household holds one housing
 * unit; rent is paid once per household and split among its adults (children
 * live free), arrears and eviction are shared, and a good home comforts
 * everyone under its roof. Households form when a citizen takes a home
 * (economy/housing.moveHome), grow when partners, relatives and close friends
 * move in, and dissolve when the last member leaves.
 *
 * Kinship is read straight from FamilyLinks here (relationBetween) because
 * households form along family lines; society/family builds on it. Money
 * moves only through economy/treasury.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, FamilyRelation, Household, HousingTier, World } from '../types.ts';
import { HOUSEHOLD_CAPACITY } from '../data/catalogue.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { residentIds, transfer } from '../economy/treasury.ts';
import { bondBetween } from '../citizens/relationships.ts';

export type PaidTier = 1 | 2 | 3;

export const TIER_NAMES: Record<HousingTier, string> = {
  0: 'the streets', 1: 'Lantern Lofts', 2: 'The Terraces', 3: 'Skyline Villas',
};
/** Days of unpaid rent before a household is evicted. */
export const EVICTION_ARREARS = 3;
/** Daily comfort for everyone living in each tier, when the rent is paid. */
export const DAILY_COMFORT: Record<HousingTier, number> = { 0: 0, 1: 2, 2: 5, 3: 10 };
/** Comfort lost on eviction. */
export const EVICTION_COMFORT = 10;
/** A friend must hold at least this bond toward you before you may move in with them. */
export const MOVE_IN_BOND = 60;
/** Social need gained by mover and host when someone moves in. */
export const MOVE_IN_SOCIAL = 10;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

export function isPaidTier(tier: number): tier is PaidTier {
  return tier === 1 || tier === 2 || tier === 3;
}

/** Living in the city: not exiled and still in the turn order. */
function isResident(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

/** "Ondine", "Ondine and Bram", "Ondine, Bram and Wren". */
export function nameList(names: string[]): string {
  if (names.length <= 1) return names[0] ?? 'nobody';
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

// ---------------------------------------------------------------------------
// Kinship
// ---------------------------------------------------------------------------

/**
 * How `b` is related to `a` (partner, spouse, parent, child or sibling), or
 * null. Siblings share a parent. Read from the family links only, so it works
 * for citizens who have left the city as well as those present.
 */
export function relationBetween(world: World, a: CitizenId, b: CitizenId): FamilyRelation | null {
  if (a === b) return null;
  const ca = world.citizens[a];
  const cb = world.citizens[b];
  if (!ca || !cb) return null;
  if (ca.family.partnerId === b) return ca.family.married ? 'spouse' : 'partner';
  if (ca.family.parents.includes(b)) return 'parent';
  if (ca.family.children.includes(b)) return 'child';
  if (ca.family.parents.some((p) => cb.family.parents.includes(p))) return 'sibling';
  return null;
}

// ---------------------------------------------------------------------------
// Queries
// ---------------------------------------------------------------------------

/** The household a citizen belongs to (null when they live alone on the streets or the record is stale). */
export function householdOf(world: World, cId: CitizenId): Household | null {
  const c = world.citizens[cId];
  if (!c || !c.householdId) return null;
  const h = world.households?.[c.householdId];
  return h && h.members.includes(cId) ? h : null;
}

/** Members of a household that still exist, head first. */
export function membersOf(world: World, h: Household): Citizen[] {
  const out: Citizen[] = [];
  for (const id of h.members) {
    const c = world.citizens[id];
    if (c && !out.includes(c)) out.push(c);
  }
  return out.sort((x, y) => (x.id === h.headId ? -1 : y.id === h.headId ? 1 : 0));
}

/** How many may live in the household's home. */
export function householdCapacity(h: Household): number {
  return isPaidTier(h.tier) ? HOUSEHOLD_CAPACITY[h.tier] : 0;
}

/** Days of unpaid rent the household owes (kept on every member; the largest wins if they drift). */
export function householdArrears(world: World, h: Household): number {
  let days = 0;
  for (const m of membersOf(world, h)) days = Math.max(days, m.rentArrearsDays);
  return days;
}

/**
 * Each adult's share of today's rent, head first; the odd lumens of an uneven
 * split fall on the first adults. Children pay nothing and are not listed.
 */
export function rentShares(world: World, h: Household): Record<CitizenId, number> {
  const shares: Record<CitizenId, number> = {};
  const rent = isPaidTier(h.tier) ? Math.max(0, Math.round(world.housing.rent[h.tier])) : 0;
  const adults = membersOf(world, h).filter((m) => m.lifeStage !== 'child');
  if (rent <= 0 || adults.length === 0) return shares;
  const base = Math.floor(rent / adults.length);
  let extra = rent - base * adults.length;
  for (const a of adults) {
    shares[a.id] = base + (extra > 0 ? 1 : 0);
    if (extra > 0) extra--;
  }
  return shares;
}

/** What a citizen pays toward the rent each day (0 for children and the homeless). */
export function rentShareOf(world: World, cId: CitizenId): number {
  const h = householdOf(world, cId);
  return h ? rentShares(world, h)[cId] ?? 0 : 0;
}

// ---------------------------------------------------------------------------
// Membership
// ---------------------------------------------------------------------------

function releaseUnit(world: World, tier: HousingTier): void {
  if (!isPaidTier(tier)) return;
  world.housing.occupied[tier] = Math.max(0, world.housing.occupied[tier] - 1);
}

/** The next head: the first adult on the record, else the first member. */
function nextHead(world: World, h: Household): CitizenId {
  const members = membersOf(world, h);
  return (members.find((m) => m.lifeStage !== 'child') ?? members[0])?.id ?? h.members[0];
}

/** Strike a member off the record; the head passes on; the last one out frees the unit and dissolves the household. */
function detach(world: World, h: Household, cId: CitizenId): void {
  h.members = h.members.filter((id) => id !== cId);
  if (h.members.length === 0) {
    releaseUnit(world, h.tier);
    delete world.households[h.id];
    return;
  }
  if (h.headId === cId) h.headId = nextHead(world, h);
}

/**
 * A household of one for a citizen who has just taken a home (housing.moveHome
 * calls this). A citizen already alone in a household keeps it; one still on
 * another household's record is struck off it first.
 */
export function createHousehold(world: World, headId: CitizenId): Household {
  const c = world.citizens[headId];
  if (!c) throw new Error(`createHousehold: unknown citizen ${headId}`);
  world.households ??= {};
  const current = c.householdId ? world.households[c.householdId] : undefined;
  if (current && current.members.includes(headId)) {
    if (current.members.length === 1) {
      current.headId = headId;
      current.tier = c.homeTier;
      return current;
    }
    detach(world, current, headId);
  }
  const h: Household = { id: nextId(world, 'h'), headId, members: [headId], tier: c.homeTier, createdDay: world.day };
  world.households[h.id] = h;
  c.householdId = h.id;
  return h;
}

/**
 * Leave the household and become homeless. A departing head hands the
 * household to its next adult; the last member out frees the housing unit.
 */
export function leaveHousehold(world: World, cId: CitizenId): void {
  const c = world.citizens[cId];
  if (!c) return;
  const h = c.householdId ? world.households?.[c.householdId] : undefined;
  c.householdId = null;
  if (!h || !h.members.includes(cId)) return;
  const wasHead = h.headId === cId;
  detach(world, h, cId);
  c.homeTier = 0;
  c.rentArrearsDays = 0;
  if (wasHead && world.households[h.id]) {
    remember(world, h.headId, 'event', `With ${c.name} gone, you are now head of the household at ${TIER_NAMES[h.tier]}.`);
  }
}

/** Children of `c` in `c`'s household who would be left there without a parent. They move with `c`. */
function dependantsOf(world: World, c: Citizen): Citizen[] {
  const h = householdOf(world, c.id);
  if (!h) return [];
  const out: Citizen[] = [];
  for (const id of c.family.children) {
    const k = world.citizens[id];
    if (!k || k.lifeStage !== 'child' || k.householdId !== h.id) continue;
    const otherParentStays = k.family.parents.some((p) => p !== c.id && world.citizens[p]?.householdId === h.id);
    if (!otherParentStays) out.push(k);
  }
  return out;
}

/**
 * Take a citizen (and the children who depend on them) into the host's
 * household: no questions asked about kinship — moveIn asks those. The
 * newcomers give up any home of their own; the host's unit is shared, so
 * occupancy does not change. Quiet: callers narrate.
 */
export function joinHousehold(world: World, cId: CitizenId, hostId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (cId === hostId) return fail('You cannot move in with yourself.');
  const host = world.citizens[hostId];
  if (!host || !isResident(world, host)) return fail('Nobody by that id lives in Reverie.');
  if (!isPaidTier(host.homeTier)) return fail(`${host.name} has no home to share.`);
  const h = householdOf(world, hostId) ?? createHousehold(world, hostId);
  if (h.members.includes(cId)) return fail(`You already live with ${host.name}.`);

  const party = [c, ...dependantsOf(world, c)];
  const room = householdCapacity(h) - h.members.length;
  if (party.length > room) {
    const kids = party.length - 1;
    return fail(room <= 0
      ? `There is no room left at ${host.name}'s home in ${TIER_NAMES[h.tier]} (${h.members.length} of ${householdCapacity(h)}).`
      : `${TIER_NAMES[h.tier]} has room for ${room} more, not ${party.length} (you and your ${kids} ${kids === 1 ? 'child' : 'children'}).`);
  }
  const arrears = householdArrears(world, h);
  for (const m of party) {
    if (householdOf(world, m.id)) leaveHousehold(world, m.id);
    else if (isPaidTier(m.homeTier)) releaseUnit(world, m.homeTier);
    m.householdId = h.id;
    h.members.push(m.id);
    m.homeTier = h.tier;
    m.rentArrearsDays = arrears;
  }
  return ok(`You moved in with ${host.name} at ${TIER_NAMES[h.tier]}.`);
}

/**
 * The move_in action: join the household of a partner, relative or close
 * friend (their bond toward you at least MOVE_IN_BOND) if there is room.
 */
export function moveIn(world: World, cId: CitizenId, withId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isResident(world, c)) return fail('Unknown or absent citizen.');
  if (withId === cId) return fail('You cannot move in with yourself.');
  const host = world.citizens[withId];
  if (!host || !isResident(world, host)) return fail('Nobody by that id lives in Reverie.');
  const relation = relationBetween(world, cId, withId);
  const bond = bondBetween(world, withId, cId);
  if (!relation && bond < MOVE_IN_BOND) {
    return fail(`${host.name} is neither family nor a close enough friend to share a home (their bond with you is ${Math.round(bond)}; it takes ${MOVE_IN_BOND}).`);
  }
  if (!isPaidTier(host.homeTier)) return fail(`${host.name} has no home to move into.`);

  const from = c.homeTier;
  const dependants = dependantsOf(world, c);
  const r = joinHousehold(world, cId, withId);
  if (!r.ok) return r;
  const h = householdOf(world, cId);
  if (!h) return r;

  c.needs.social = clamp(c.needs.social + MOVE_IN_SOCIAL, 0, 100);
  host.needs.social = clamp(host.needs.social + MOVE_IN_SOCIAL, 0, 100);
  const who = relation ? `their ${relation} ${host.name}` : `their friend ${host.name}`;
  const withKids = dependants.length ? ` with ${nameList(dependants.map((k) => k.name))}` : '';
  const share = rentShareOf(world, cId);
  emit(world, 'household', `${c.name} moved in with ${who} at ${TIER_NAMES[h.tier]}${withKids}.`, [cId, withId],
    relation ? 0.3 : 0.2, { householdId: h.id, relation });
  remember(world, cId, 'event',
    `You moved in with ${host.name} at ${TIER_NAMES[h.tier]}${from ? ` from ${TIER_NAMES[from]}` : ''}; your share of the rent is ${share} ℓ a day.`);
  for (const id of h.members) {
    if (id === cId || dependants.some((k) => k.id === id)) continue;
    remember(world, id, 'event', `${c.name}${withKids} moved in with you at ${TIER_NAMES[h.tier]}.`);
  }
  return ok(`You moved in with ${host.name} at ${TIER_NAMES[h.tier]} (household of ${h.members.length}); your share of the rent is ${share} ℓ a day.`);
}

// ---------------------------------------------------------------------------
// Rent
// ---------------------------------------------------------------------------

/** Members who have left the city (or whose record points elsewhere) are struck off; an empty household frees its unit. */
function prune(world: World, h: Household, residents: Set<CitizenId>): void {
  for (const id of [...h.members]) {
    const m = world.citizens[id];
    if (m && residents.has(id) && m.householdId === h.id) continue;
    if (m && m.householdId === h.id) leaveHousehold(world, id); // gone from the city: homeless on the record
    else detach(world, h, id);
    if (!world.households[h.id]) return;
  }
}

/** Rent paid: arrears cleared and the comfort of a good home for everyone under the roof. */
function settle(world: World, h: Household, members: Citizen[], rent: number): void {
  for (const m of members) {
    if (m.rentArrearsDays > 0) remember(world, m.id, 'money', `Your household paid ${rent} ℓ rent at ${TIER_NAMES[h.tier]} and cleared its arrears.`);
    m.rentArrearsDays = 0;
    m.needs.comfort = clamp(m.needs.comfort + DAILY_COMFORT[h.tier], 0, 100);
  }
}

/** Throw a whole household out of its home. */
export function evictHousehold(world: World, h: Household, reason: string): void {
  const members = membersOf(world, h);
  const tier = h.tier;
  for (const m of members) {
    m.householdId = null;
    m.homeTier = 0;
    m.rentArrearsDays = 0;
    m.needs.comfort = clamp(m.needs.comfort - EVICTION_COMFORT, 0, 100);
    remember(world, m.id, 'event', `You were evicted from ${TIER_NAMES[tier]}: ${reason}.`);
  }
  releaseUnit(world, tier);
  delete world.households[h.id];
  const names = nameList(members.map((m) => m.name));
  emit(world, 'eviction', `${names} ${members.length > 1 ? 'were' : 'was'} evicted from ${TIER_NAMES[tier]}: ${reason}.`,
    members.map((m) => m.id), 0.5, { tier, reason, householdId: h.id });
}

function fallBehind(world: World, h: Household, members: Citizen[], adults: Citizen[], rent: number): void {
  const arrears = householdArrears(world, h) + 1;
  for (const m of members) m.rentArrearsDays = arrears;
  if (arrears >= EVICTION_ARREARS) {
    evictHousehold(world, h, `${arrears} days of unpaid rent`);
    return;
  }
  for (const a of adults) {
    remember(world, a.id, 'money', `Your household could not pay ${rent} ℓ rent at ${TIER_NAMES[h.tier]} (${arrears} of ${EVICTION_ARREARS} days in arrears).`);
  }
}

/** Each adult pays their share; housemates with lumens to spare cover anyone short. True when the whole rent was collected. */
function collect(world: World, h: Household, adults: Citizen[], shares: Record<CitizenId, number>): boolean {
  let shortfall = 0;
  for (const a of adults) {
    const share = shares[a.id] ?? 0;
    if (share <= 0) continue;
    if (!transfer(world, a.id, 'treasury', share, 'rent', `rent at ${TIER_NAMES[h.tier]}`)) shortfall += share;
  }
  for (const a of adults) {
    if (shortfall <= 0) break;
    const can = Math.min(shortfall, Math.max(0, Math.floor(a.wallet)));
    if (can <= 0 || !transfer(world, a.id, 'treasury', can, 'rent', `covering a housemate's rent at ${TIER_NAMES[h.tier]}`)) continue;
    shortfall -= can;
    remember(world, a.id, 'money', `You covered ${can} ℓ of a housemate's rent at ${TIER_NAMES[h.tier]}.`);
  }
  return shortfall <= 0;
}

/**
 * The daily rent, household by household: absent members are struck off,
 * then the adults split the rent (children live free); a household whose
 * adults cannot raise it between them falls a day into arrears and is
 * evicted together after EVICTION_ARREARS days. A household of children only
 * (wards left behind) is not charged.
 */
export function householdRent(world: World): void {
  const residents = residentIds(world);
  for (const h of Object.values(world.households ?? {})) {
    prune(world, h, residents);
    if (!world.households[h.id]) continue;
    const members = membersOf(world, h);
    if (!isPaidTier(h.tier) || members.length === 0) {
      for (const m of members) m.householdId = null;
      delete world.households[h.id];
      continue;
    }
    const rent = Math.max(0, Math.round(world.housing.rent[h.tier]));
    const adults = members.filter((m) => m.lifeStage !== 'child');
    if (rent === 0 || adults.length === 0) {
      settle(world, h, members, rent);
      continue;
    }
    const purse = adults.reduce((sum, a) => sum + Math.max(0, Math.floor(a.wallet)), 0);
    if (purse < rent || !collect(world, h, adults, rentShares(world, h))) {
      fallBehind(world, h, members, adults, rent);
      continue;
    }
    settle(world, h, members, rent);
  }
}

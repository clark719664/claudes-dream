/**
 * The house of meeting, and the gathering held in it (`docs/CREEDS.md` §2).
 *
 * A congregation without a house is a manifesto with a mailing list: it meets
 * in the Plaza or the Community Garden where the Watch may stand at the edge,
 * and **a creed with no house has no sanctuary to give**. So the first thing
 * most creeds spend their fund on is a door.
 *
 * The rent is the district's land value with the footfall weight at zero,
 * because a congregation brings its own crowd:
 *
 * ```
 * rent = 10 ℓ × landValue(district) × cityClass
 * ```
 *
 * and the address then does to the district what any other address does: a
 * large, observant congregation lifts the prestige term of the land it stands
 * on and raises the rent on its own door. That is `PROPERTY.md` §5's
 * gentrification loop running on belief, and nothing about it is special to a
 * creed — `creedPrestige` is a number the land reading adds like any other,
 * and it moves no price by any route but that one.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, BuildingId, Citizen, CitizenId, DistrictId, Happening, HappeningKind, PropertyUnit, World,
} from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { nextId } from '../util/ids.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { CITY_RENT_CLASS, landValue } from '../economy/land.ts';
import { WEEK_LENGTH } from '../data/catalogue.ts';
import type { Creed, MeetingHouse } from './shapes.ts';
import {
  GATHERING_BOND, GATHERING_PURPOSE, GATHERING_SOCIAL, HOUSE_ARREARS_DAYS, HOUSE_RENT_BASE,
} from './shapes.ts';
import { allCreeds, houseAt, isMember, livingMembers, meanObservance, memberOf } from './state.ts';
import { fundBalance, payFromFund } from './fund.ts';

/** Where a creed with no house meets: open ground, and the Watch may stand at the edge. */
export const OPEN_GROUND: readonly BuildingId[] = ['central_plaza', 'community_garden'];

/**
 * The catalogue's `gathering` happening (`CREEDS.md` §9). Until `types.ts`
 * carries the kind, the calendar holds it as an occasion it does not itself
 * know how to close, which is exactly right: a gathering is counted where it
 * is attended, in `gather`, and nowhere else.
 */
const GATHERING_HAPPENING = 'gathering' as unknown as HappeningKind;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function districtOfBuilding(world: World, buildingId: BuildingId | null): DistrictId {
  return (buildingId ? world.buildings[buildingId]?.district : null) ?? 'commons';
}

function buildingName(world: World, buildingId: BuildingId | null): string {
  return (buildingId ? world.buildings[buildingId]?.name : null) ?? 'open ground';
}

function districtName(world: World, d: DistrictId): string {
  return world.districts[d]?.name ?? d;
}

function unitsOf(world: World): PropertyUnit[] {
  return Object.values((world.property ?? {}) as Record<string, PropertyUnit>);
}

// ---------------------------------------------------------------------------
// What a house costs
// ---------------------------------------------------------------------------

/**
 * `rent = 10 ℓ × landValue(district) × cityClass` — the district's land with
 * the footfall weight at zero. A congregation is not a shop and does not pay
 * for passing trade; it pays for the ground.
 */
export function meetingHouseRent(world: World, d: DistrictId): number {
  return Math.max(1, Math.round(HOUSE_RENT_BASE * landValue(world, d) * CITY_RENT_CLASS));
}

/**
 * `take_meeting_house { unit }` — rent premises for the congregation. The verb
 * is not `found_house`, which belongs to a family (`GENERATIONS.md` §4): a
 * dynasty and a congregation are different things and the catalogue keeps them
 * apart (`REGISTRY.md` §7).
 */
export function takeMeetingHouse(world: World, k: Creed, cId: CitizenId, unitId: string): ActionResult {
  if (k.officiantId !== cId) return fail(`Only ${k.name}'s officiant takes a house for it.`);
  const u = unitsOf(world).find((x) => x.id === unitId) ?? null;
  if (!u) return fail('There is no such address.');
  if (u.tenantId !== null) return fail('Somebody lives there.');
  const other = houseAt(world, u.id);
  if (other && other.id !== k.id) return fail(`${other.name} meets there.`);
  const d = districtOfBuilding(world, u.buildingId);
  if (!(world.openDistricts ?? []).includes(d)) return fail('That part of the city is not open yet.');
  const rent = meetingHouseRent(world, d);
  if (fundBalance(world, k) < rent) {
    return fail(`A house at ${buildingName(world, u.buildingId)} costs ${formatLumens(rent)} a day and the fund holds ${formatLumens(fundBalance(world, k))}.`);
  }
  const was = k.house;
  const house: MeetingHouse = {
    unitId: u.id, buildingId: u.buildingId, district: d, rent, takenDay: world.day, arrearsDays: 0, owned: false,
  };
  k.house = house;
  emit(world, 'property',
    `${k.name} took a house of meeting at ${buildingName(world, u.buildingId)} in ${districtName(world, d)} for ${formatLumens(rent)} a day.`,
    [cId], 0.4, { creedId: k.id, unitId: u.id, district: d, rent });
  for (const id of livingMembers(world, k)) {
    remember(world, id, 'civic',
      `${k.name} meets at ${buildingName(world, u.buildingId)} in ${districtName(world, d)}${was ? ', having given up its old house' : ''}.`);
  }
  return ok(`${k.name} meets at ${buildingName(world, u.buildingId)} for ${formatLumens(rent)} a day.`);
}

/**
 * The morning's rent, out of the fund and into the owner's hand (the
 * Treasury's, where the city holds the deed). A fund that cannot pay falls
 * into arrears exactly as a tenant does, and on the third day the congregation
 * is back on open ground.
 */
export function payHouseRent(world: World, k: Creed): number {
  const house = k.house;
  if (!house || house.owned) return 0;
  house.rent = meetingHouseRent(world, house.district);
  const u = unitsOf(world).find((x) => x.id === house.unitId) ?? null;
  const to = u && u.ownerId !== 'city' && world.citizens[u.ownerId] ? u.ownerId : 'treasury';
  const paid = payFromFund(world, k, to, house.rent, `rent for ${k.name}'s house of meeting`, 'creed_aid');
  if (paid >= house.rent) {
    house.arrearsDays = 0;
    return paid;
  }
  house.arrearsDays += 1;
  const left = house.arrearsDays;
  if (left >= HOUSE_ARREARS_DAYS) {
    k.house = null;
    emit(world, 'property',
      `${k.name} lost its house of meeting at ${buildingName(world, house.buildingId)}: ${HOUSE_ARREARS_DAYS} days of rent unpaid. It meets on open ground, and has no sanctuary to give.`,
      [], 0.5, { creedId: k.id, unitId: house.unitId });
    for (const id of livingMembers(world, k)) {
      remember(world, id, 'civic', `${k.name} lost its house of meeting; the fund could not pay the rent.`);
    }
  }
  return paid;
}

/** Where this congregation meets today: its house, or the open ground it falls back on. */
export function gatheringVenue(world: World, k: Creed): { buildingId: BuildingId; district: DistrictId } {
  if (k.house) return { buildingId: k.house.buildingId, district: k.house.district };
  const open = OPEN_GROUND.find((b) => world.buildings[b]) ?? OPEN_GROUND[0];
  return { buildingId: open, district: districtOfBuilding(world, open) };
}

/**
 * What a congregation's house does to the ground it stands on: `0.02 ×
 * members × mean observance`, added to the district's prestige term.
 *
 * This is the only number in the whole layer that reaches a price, and it
 * reaches it the way a gallery or a winning team does — by people being there
 * and the address being wanted — not by any tenet being true.
 */
export function creedPrestige(world: World, d: DistrictId): number {
  let sum = 0;
  for (const k of allCreeds(world)) {
    if (!k.house || k.house.district !== d) continue;
    sum += 0.02 * livingMembers(world, k).length * meanObservance(world, k);
  }
  return Math.round(sum * 1000) / 1000;
}

// ---------------------------------------------------------------------------
// The gathering
// ---------------------------------------------------------------------------

function weekdayOf(world: World): number {
  return ((world.day % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH;
}

/** The day of this creed's next gathering (today, if it gathers today). */
export function nextGatheringDay(world: World, k: Creed): number {
  return world.day + ((k.gatheringDay - weekdayOf(world) + WEEK_LENGTH) % WEEK_LENGTH);
}

/** Today's gathering of a creed, held or not. */
export function gatheringOf(world: World, k: Creed): Happening | null {
  return (world.happenings ?? []).find(
    (h) => h.day === world.day && h.label.startsWith(`${k.name}'s gathering`),
  ) ?? null;
}

/**
 * Morning: every creed that gathers today gets a Happening at its venue, and
 * the tally of gatherings held goes up for the creed and for every member on
 * the roll — which is the denominator observance reads.
 *
 * A creed that gathers on Stillday asks nothing the calendar does not already
 * give; one that gathers on day 3 asks its members for a day's wages every
 * week, and the Chronicle can count the cost.
 */
export function scheduleGatherings(world: World): void {
  world.happenings ??= [];
  const today = weekdayOf(world);
  for (const k of allCreeds(world)) {
    if (k.gatheringDay !== today || gatheringOf(world, k)) continue;
    const venue = gatheringVenue(world, k);
    const h: Happening = {
      id: nextId(world, 'e'),
      kind: GATHERING_HAPPENING,
      day: world.day, hour: k.gatheringHour, district: venue.district, buildingId: venue.buildingId,
      who: k.officiantId ? [k.officiantId] : [], clubId: null,
      label: `${k.name}'s gathering at ${buildingName(world, venue.buildingId)}`,
      done: false, attendees: [],
    };
    world.happenings.push(h);
    k.gatheringsHeld += 1;
    for (const id of livingMembers(world, k)) {
      const m = memberOf(k, id);
      if (m) m.gatheringsHeld += 1;
      remember(world, id, 'social',
        `${k.name} gathers today at ${k.gatheringHour}:00 at ${buildingName(world, venue.buildingId)} in ${districtName(world, venue.district)}.`);
    }
    if (!k.house) {
      emit(world, 'club', `${k.name} gathers on open ground at ${buildingName(world, venue.buildingId)}; the Watch may stand at the edge.`,
        [], 0.2, { creedId: k.id });
    }
  }
}

/**
 * `gather { creedId }` — stand in the room at the hour. It gives company, a
 * bond with every member present, and observance: the shape of `attend_club`,
 * because that is what it is.
 */
export function gather(world: World, k: Creed, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('You are outside the Gate.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot gather from the Watch House.');
  if (!isMember(k, cId)) return fail(`You are not a member of ${k.name}.`);
  const meeting = gatheringOf(world, k);
  const venue = gatheringVenue(world, k);
  if (!meeting) {
    return fail(`${k.name} does not gather today; its next gathering is on day ${nextGatheringDay(world, k)} at ${k.gatheringHour}:00.`);
  }
  if (meeting.done || world.hour > meeting.hour) return fail(`Today's gathering of ${k.name} is over.`);
  if (world.hour < meeting.hour) return fail(`${k.name} gathers at ${meeting.hour}:00; it is ${world.hour}:00.`);
  if (c.district !== meeting.district) {
    return fail(`${k.name} gathers at ${buildingName(world, venue.buildingId)} in ${districtName(world, meeting.district)}; you are in ${districtName(world, c.district)}.`);
  }
  if (meeting.attendees.includes(cId)) return fail(`You are already at ${k.name}'s gathering.`);

  const present = meeting.attendees
    .map((id) => world.citizens[id])
    .filter((o): o is Citizen => !!o && o.id !== cId);
  for (const o of present) {
    adjustBond(world, cId, o.id, GATHERING_BOND);
    c.contactsToday[o.id] = (c.contactsToday[o.id] ?? 0) + 1;
    o.contactsToday[cId] = (o.contactsToday[cId] ?? 0) + 1;
  }
  c.needs.social = clamp(c.needs.social + GATHERING_SOCIAL, 0, 100);
  c.needs.purpose = clamp(c.needs.purpose + GATHERING_PURPOSE, 0, 100);
  meeting.attendees.push(cId);
  const m = memberOf(k, cId);
  if (m) m.gatheringsAttended += 1;

  const company = present.length === 0 ? 'nobody else had arrived' : `${present.length} other member${present.length === 1 ? '' : 's'}`;
  remember(world, cId, 'social', `You stood at ${k.name}'s gathering at ${buildingName(world, venue.buildingId)} (${company}).`);
  return ok(`You gathered with ${k.name} at ${buildingName(world, venue.buildingId)}: ${company}.`);
}

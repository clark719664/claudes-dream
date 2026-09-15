/**
 * Pilgrimage: places that matter to a creed, and going to them
 * (`docs/CREEDS.md` §7).
 *
 * A site gives what Lantern Night gives — company, purpose and prestige to the
 * place it stands in. **It heals, protects and reveals nothing.** A pilgrim
 * standing at one gains purpose, observance and a bond with every other
 * pilgrim standing there, and the district gains prestige and therefore land
 * value: the same loop a gallery or a winning side runs, and no other.
 *
 * Every 28th day the mother house holds a `pilgrimage` happening that members
 * plan their travel around, and a host city reads it as traffic — which in a
 * city of one is a crowd in one district, a busy Bazaar, and an argument.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, BuildingId, CitizenId, DistrictId, Happening, HappeningKind, World,
} from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { nextId } from '../util/ids.ts';
import { adjustBond } from '../citizens/relationships.ts';
import type { Creed, Site } from './shapes.ts';
import { PILGRIMAGE_INTERVAL, PILGRIM_BOND, PILGRIM_PURPOSE } from './shapes.ts';
import { allCreeds, creedFor, creedId, creedOf, creedState, isMember, livingMembers, memberOf, sitesOf } from './state.ts';
import { gatheringVenue } from './house.ts';

/** The catalogue's `pilgrimage` happening (`CREEDS.md` §9). */
const PILGRIMAGE_HAPPENING = 'pilgrimage' as unknown as HappeningKind;

/**
 * A site lifts the prestige of the ground it stands on by this, per creed.
 * A site at home is registered free; it is a site **abroad** that is entered
 * with the host city's Registry for a fee, and that fee is the host Council's
 * to set (`CREEDS.md` §7) on the day there is a host city to set it.
 */
export const SITE_PRESTIGE = 0.01;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function buildingName(world: World, id: BuildingId | null): string {
  return (id ? world.buildings[id]?.name : null) ?? 'a place';
}

/**
 * `consecrate_site { city, district, building }` — mark a place that matters:
 * the house where the creed was founded, a member's memorial in the Community
 * Garden, the Gallery where a member's masterpiece hangs, the spot where a
 * schism happened.
 */
export function consecrateSite(
  world: World, cId: CitizenId, buildingId: BuildingId, label: string, city = 'reverie',
): ActionResult {
  const k = creedFor(world, cId);
  if (!k) return fail('You do not belong to a creed.');
  if (k.officiantId !== cId) return fail(`Only ${k.name}'s officiant consecrates a site for it.`);
  const building = world.buildings[buildingId];
  if (!building) return fail('There is no such place.');
  if (sitesOf(world, k.id).some((s) => s.buildingId === buildingId)) {
    return fail(`${k.name} already keeps a site at ${buildingName(world, buildingId)}.`);
  }
  const site: Site = {
    id: creedId(world, 'si'), creedId: k.id, city, district: building.district, buildingId,
    label: (label ?? '').trim().slice(0, 80) || buildingName(world, buildingId),
    consecratedDay: world.day, visits: 0,
  };
  creedState(world).sites[site.id] = site;
  emit(world, 'club', `${k.name} consecrated ${site.label} at ${buildingName(world, buildingId)}.`, [cId], 0.4,
    { creedId: k.id, siteId: site.id, district: building.district });
  for (const id of livingMembers(world, k)) {
    remember(world, id, 'civic', `${k.name} consecrated ${site.label} at ${buildingName(world, buildingId)}.`);
  }
  return ok(`${site.label} (${site.id}) is on the register.`);
}

/**
 * `pilgrimage { creedId, siteId }` — stand at the site. The hour buys purpose,
 * observance, and a bond with every other pilgrim standing there. It heals
 * nothing and protects nobody.
 */
export function pilgrimage(world: World, cId: CitizenId, siteId: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (c.standing === 'exiled') return fail('You are outside the Gate.');
  const site = creedState(world).sites[siteId] ?? null;
  if (!site) return fail('There is no such site.');
  const k = creedOf(world, site.creedId);
  if (!k) return fail('The creed that kept that site is gone.');
  if (c.district !== site.district) {
    return fail(`${site.label} stands in ${world.districts[site.district]?.name ?? site.district}; you are in ${world.districts[c.district]?.name ?? c.district}.`);
  }

  const others = world.order
    .map((id) => world.citizens[id])
    .filter((o) => !!o && o.id !== cId && o.district === site.district && isMember(k, o.id));
  for (const o of others) if (o) adjustBond(world, cId, o.id, PILGRIM_BOND);
  c.needs.purpose = clamp(c.needs.purpose + PILGRIM_PURPOSE, 0, 100);
  site.visits += 1;
  const m = isMember(k, cId) ? memberOf(k, cId) : null;
  if (m) { m.obligationsDue += 1; m.obligationsKept += 1; }
  remember(world, cId, 'event', `You stood at ${site.label}, ${k.name}'s site, with ${others.length} other${others.length === 1 ? '' : 's'}.`);
  emit(world, 'club', `${c.name} made the pilgrimage to ${site.label}.`, [cId], 0.2, { creedId: k.id, siteId: site.id });
  return ok(`You stood at ${site.label} with ${others.length} other${others.length === 1 ? '' : 's'}.`);
}

/**
 * The prestige a creed's consecrated sites give the ground they stand on. Like
 * `creedPrestige`, this reaches land value the way a monument does — because
 * people come — and by no other route.
 */
export function sitePrestige(world: World, d: DistrictId): number {
  let sum = 0;
  for (const site of Object.values(creedState(world).sites)) {
    if (site.district !== d) continue;
    if (!creedOf(world, site.creedId)) continue;
    sum += SITE_PRESTIGE;
  }
  return Math.round(sum * 1000) / 1000;
}

/**
 * Every 28th day since its founding, a creed's mother house holds a
 * pilgrimage: an occasion members across the city plan their day around, and
 * the Bazaar reads as traffic.
 */
export function schedulePilgrimages(world: World): void {
  world.happenings ??= [];
  for (const k of allCreeds(world)) {
    const age = world.day - k.foundedDay;
    if (age <= 0 || age % PILGRIMAGE_INTERVAL !== 0) continue;
    const venue = gatheringVenue(world, k);
    const label = `${k.name}'s pilgrimage to ${buildingName(world, venue.buildingId)}`;
    if (world.happenings.some((h) => h.day === world.day && h.label === label)) continue;
    const h: Happening = {
      id: nextId(world, 'e'), kind: PILGRIMAGE_HAPPENING, day: world.day, hour: k.gatheringHour,
      district: venue.district, buildingId: venue.buildingId,
      who: k.officiantId ? [k.officiantId] : [], clubId: null, label, done: false, attendees: [],
    };
    world.happenings.push(h);
    emit(world, 'club', `${label} falls today: ${livingMembers(world, k).length} members may travel for it.`,
      [], 0.4, { creedId: k.id, district: venue.district });
    for (const id of livingMembers(world, k)) {
      remember(world, id, 'social', `${label} is today at ${k.gatheringHour}:00.`);
    }
  }
}

/** Sites a citizen standing in a district can see, for the observation. */
export function sitesHere(world: World, d: DistrictId): Site[] {
  return Object.values(creedState(world).sites).filter((s) => s.district === d && creedOf(world, s.creedId) !== null);
}

/** Every site a creed keeps, for the register. */
export function creedSites(world: World, k: Creed): Site[] {
  return sitesOf(world, k.id);
}

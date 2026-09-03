/**
 * JSON view of the World's social layer for the dashboard: households and
 * who lives in them, clubs and when they meet, the day's happenings, the
 * Community Chest, recent weddings and births, and everything on sale at the
 * Emporium and in citizens' shops. Read-only — nothing here moves money,
 * emits events or touches the rng.
 */
import type {
  Citizen, CitizenId, Club, DistrictId, Happening, Household, ItemId, LedgerEntry, World,
} from '../types.ts';
import { DISTRICT_IDS } from '../types.ts';
import { HOBBY_INFO, CLUB_MEETING_HOUR, PRODUCTS } from '../data/catalogue.ts';
import { chestBalance } from '../society/chest.ts';
import { clubVenue, nextMeetingDay } from '../society/clubs.ts';
import {
  hasBirthdayToday, isFestivalToday, isRestDay, nextFestival, weekday, weekdayName,
} from '../society/calendar.ts';
import { ageOf, familyOf } from '../society/family.ts';
import {
  TIER_NAMES, householdArrears, householdCapacity, householdOf, isPaidTier, membersOf, relationBetween, rentShares,
} from '../society/households.ts';
import { EMPORIUM_ID, EMPORIUM_NAME, shopsIn } from '../society/shops.ts';
import type { Shop } from '../society/shops.ts';
import { isPresentIn, nameOf, partyName, presentSet } from './views.ts';

/** Chest movements shown on the Society tab. */
export const CHEST_LEDGER_LENGTH = 12;
/** Weddings and births shown on the Society tab. */
export const CEREMONY_VIEW_LENGTH = 8;

// ---------------------------------------------------------------- helpers

interface Person {
  id: CitizenId;
  name: string;
  familyName: string;
  lifeStage: string;
  standing: string;
  present: boolean;
}

function person(world: World, id: CitizenId, present: Set<CitizenId>): Person | null {
  const c = world.citizens[id];
  if (!c) return null;
  return {
    id: c.id, name: c.name, familyName: c.familyName, lifeStage: c.lifeStage, standing: c.standing,
    present: isPresentIn(world, c, present),
  };
}

function people(world: World, ids: CitizenId[], present: Set<CitizenId>): Person[] {
  const out: Person[] = [];
  for (const id of ids) {
    const p = person(world, id, present);
    if (p) out.push(p);
  }
  return out;
}

function districtName(world: World, id: DistrictId): string {
  return world.districts[id]?.name ?? id;
}

function buildingName(world: World, id: string | null): string | null {
  return id ? world.buildings[id]?.name ?? id : null;
}

const idNumber = (id: string) => Number(id.slice(id.indexOf('_') + 1)) || 0;

// ------------------------------------------------------------- households

export function householdView(world: World, h: Household, present: Set<CitizenId>): Record<string, unknown> {
  const members = membersOf(world, h);
  const shares = rentShares(world, h);
  const rent = isPaidTier(h.tier) ? Math.max(0, Math.round(world.housing.rent[h.tier])) : 0;
  const names = new Set(members.map((m) => m.familyName));
  return {
    id: h.id, tier: h.tier, tierName: TIER_NAMES[h.tier] ?? `tier ${h.tier}`, createdDay: h.createdDay,
    headId: h.headId, headName: nameOf(world, h.headId),
    capacity: householdCapacity(h), size: members.length, rent, arrearsDays: householdArrears(world, h),
    familyNames: [...names],
    members: members.map((m) => ({
      id: m.id, name: m.name, familyName: m.familyName, lifeStage: m.lifeStage, age: ageOf(world, m),
      relation: m.id === h.headId ? 'head' : relationBetween(world, h.headId, m.id) ?? 'housemate',
      rentShare: shares[m.id] ?? 0, mood: Math.round(m.mood), standing: m.standing,
      present: isPresentIn(world, m, present),
      partnerId: m.family.partnerId, married: m.family.married,
    })),
  };
}

/** Households, largest first; a home with nobody left in it is not listed. */
export function householdsView(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  return Object.values(world.households ?? {})
    .map((h) => householdView(world, h, present))
    .filter((h) => (h.size as number) > 0)
    .sort((a, b) => (b.size as number) - (a.size as number) || (b.tier as number) - (a.tier as number)
      || idNumber(a.id as string) - idNumber(b.id as string));
}

// ------------------------------------------------------------------ clubs

export function clubView(world: World, k: Club, present: Set<CitizenId>): Record<string, unknown> {
  const venue = clubVenue(world, k);
  const meetsDay = nextMeetingDay(world, k);
  return {
    id: k.id, name: k.name, hobby: k.hobby, hobbyName: HOBBY_INFO[k.hobby]?.name ?? k.hobby,
    founderId: k.founderId, founderName: nameOf(world, k.founderId),
    convenorId: k.convenorId, convenorName: nameOf(world, k.convenorId),
    foundedDay: k.foundedDay, size: k.members.length,
    meetsOnWeekday: k.meetsOnWeekday, meetsOnName: weekdayName(k.meetsOnWeekday), meetsAtHour: CLUB_MEETING_HOUR,
    nextMeetingDay: meetsDay, meetsToday: meetsDay === world.day,
    venue: { id: venue.buildingId, name: venue.name, district: venue.district, districtName: districtName(world, venue.district) },
    members: people(world, k.members, present),
  };
}

export function clubsView(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  return Object.values(world.clubs ?? {})
    .map((k) => clubView(world, k, present))
    .sort((a, b) => (b.size as number) - (a.size as number) || idNumber(a.id as string) - idNumber(b.id as string));
}

// ------------------------------------------------------------- happenings

export function happeningView(world: World, h: Happening, present: Set<CitizenId>): Record<string, unknown> {
  const club = h.clubId ? world.clubs?.[h.clubId] ?? null : null;
  return {
    id: h.id, kind: h.kind, day: h.day, hour: h.hour, done: h.done,
    district: h.district, districtName: districtName(world, h.district),
    buildingId: h.buildingId, buildingName: buildingName(world, h.buildingId),
    label: h.label, clubId: h.clubId, clubName: club ? club.name : null,
    who: people(world, h.who, present),
    attendees: people(world, h.attendees, present),
  };
}

/** Today's and tomorrow's calendar, each earliest first. */
export function happeningsView(world: World, present: Set<CitizenId>): Record<string, unknown> {
  const rows = (world.happenings ?? []).slice().sort((a, b) => a.hour - b.hour || idNumber(a.id) - idNumber(b.id));
  const on = (day: number) => rows.filter((h) => h.day === day).map((h) => happeningView(world, h, present));
  return { today: on(world.day), tomorrow: on(world.day + 1) };
}

// ---------------------------------------------------------- Community Chest

function chestEntry(world: World, l: LedgerEntry): Record<string, unknown> {
  return {
    tick: l.tick, day: Math.floor(l.tick / 24), kind: l.kind, amount: l.amount,
    from: l.from, fromName: partyName(world, l.from), to: l.to, toName: partyName(world, l.to), memo: l.memo,
  };
}

export function chestView(world: World): Record<string, unknown> {
  const ledger = world.treasury.ledger;
  const donations: Record<string, unknown>[] = [];
  const stipends: Record<string, unknown>[] = [];
  for (let i = ledger.length - 1; i >= 0; i--) {
    const l = ledger[i];
    if (l.to === 'chest' && donations.length < CHEST_LEDGER_LENGTH) donations.push(chestEntry(world, l));
    else if (l.from === 'chest' && stipends.length < CHEST_LEDGER_LENGTH) stipends.push(chestEntry(world, l));
    if (donations.length >= CHEST_LEDGER_LENGTH && stipends.length >= CHEST_LEDGER_LENGTH) break;
  }
  return {
    balance: chestBalance(world),
    donatedTotal: world.treasury.totals.donation ?? 0,
    paidTotal: world.treasury.totals.stipend ?? 0,
    donations,
    stipends,
  };
}

// ------------------------------------------------------- weddings, births

function ceremonies(world: World, kind: 'wedding' | 'birth', present: Set<CitizenId>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = world.events.length - 1; i >= 0 && out.length < CEREMONY_VIEW_LENGTH; i--) {
    const e = world.events[i];
    if (e.kind !== kind) continue;
    out.push({ tick: e.tick, day: e.day, text: e.text, who: people(world, e.actors, present) });
  }
  return out;
}

// --------------------------------------------------------- shops and wants

function shelfRows(shop: Shop): Record<string, unknown>[] {
  return Object.entries(shop.shelf)
    .filter(([id, e]) => PRODUCTS[id] && e.qty > 0)
    .map(([id, e]) => {
      const p = PRODUCTS[id];
      return {
        product: id, name: p.name, category: p.category, hobby: p.hobby, basePrice: p.basePrice,
        price: e.price, qty: e.qty,
      };
    })
    .sort((a, b) => (a.price as number) - (b.price as number) || String(a.name).localeCompare(String(b.name)));
}

/** Every shop with something on its shelf, the Emporium separately. */
export function shopsView(world: World): { emporium: Record<string, unknown> | null; shops: Record<string, unknown>[] } {
  let emporium: Record<string, unknown> | null = null;
  const shops: Record<string, unknown>[] = [];
  for (const district of DISTRICT_IDS) {
    for (const shop of shopsIn(world, district)) {
      const row = {
        businessId: shop.businessId, name: shop.name, district, districtName: districtName(world, district),
        ownerId: shop.businessId === EMPORIUM_ID ? null : world.businesses[shop.businessId]?.ownerId ?? null,
        shelf: shelfRows(shop),
      };
      const owner = row.ownerId ? nameOf(world, row.ownerId) : null;
      if (shop.businessId === EMPORIUM_ID) emporium = { ...row, name: EMPORIUM_NAME, ownerName: null };
      else shops.push({ ...row, ownerName: owner });
    }
  }
  shops.sort((a, b) => (b.shelf as unknown[]).length - (a.shelf as unknown[]).length || String(a.name).localeCompare(String(b.name)));
  return { emporium, shops };
}

// ------------------------------------------------------------------ people

/** The names of a citizen's possessions, for the citizen detail view. */
export function possessionsView(c: Citizen): { id: ItemId; productId: string; name: string; category: string; hobby: string | null; acquiredDay: number }[] {
  return c.possessions.map((it) => {
    const p = PRODUCTS[it.productId];
    return {
      id: it.id, productId: it.productId, name: p?.name ?? it.productId, category: p?.category ?? 'tool',
      hobby: p?.hobby ?? null, acquiredDay: it.acquiredDay,
    };
  });
}

/** What a citizen would like to own, best first. */
export function wantsView(c: Citizen): Record<string, unknown>[] {
  return (c.wants ?? []).filter((id) => PRODUCTS[id]).map((id) => {
    const p = PRODUCTS[id];
    return { product: id, name: p.name, category: p.category, hobby: p.hobby, basePrice: p.basePrice };
  });
}

/** A citizen's family with names and relations (everyone on the record, near or gone). */
export function familyView(world: World, id: CitizenId, present: Set<CitizenId>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const { id: otherId, relation } of familyOf(world, id)) {
    const p = person(world, otherId, present);
    if (p) out.push({ ...p, relation });
  }
  return out;
}

export function partnerView(world: World, c: Citizen, present: Set<CitizenId>): Record<string, unknown> | null {
  const partnerId = c.family.partnerId;
  if (!partnerId) return null;
  const p = person(world, partnerId, present);
  if (!p) return null;
  return { ...p, married: c.family.married, since: c.family.partnerSinceDay, affection: Math.round(c.affection?.[partnerId] ?? 0) };
}

/** The clubs a citizen belongs to, with when and where they meet. */
export function citizenClubsView(world: World, c: Citizen): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const id of c.clubs ?? []) {
    const k = world.clubs?.[id];
    if (!k) continue;
    const venue = clubVenue(world, k);
    out.push({
      id: k.id, name: k.name, hobby: k.hobby, hobbyName: HOBBY_INFO[k.hobby]?.name ?? k.hobby,
      convenorId: k.convenorId, convenorName: nameOf(world, k.convenorId), isConvenor: k.convenorId === c.id,
      members: k.members.length, meetsOnWeekday: k.meetsOnWeekday, meetsOnName: weekdayName(k.meetsOnWeekday),
      meetsAtHour: CLUB_MEETING_HOUR, nextMeetingDay: nextMeetingDay(world, k),
      venue: { id: venue.buildingId, name: venue.name, district: venue.district },
    });
  }
  return out;
}

/** The household a citizen lives in, with their share of the rent. */
export function citizenHouseholdView(world: World, c: Citizen, present: Set<CitizenId>): Record<string, unknown> | null {
  const h = householdOf(world, c.id);
  if (!h) return null;
  const view = householdView(world, h, present);
  return { ...view, rentShare: (view.members as { id: CitizenId; rentShare: number }[]).find((m) => m.id === c.id)?.rentShare ?? 0 };
}

/** Strongest affections, top `max`, adults only (the engine records no others). */
export function affectionsView(world: World, c: Citizen, max = 5): Record<string, unknown>[] {
  return Object.entries(c.affection ?? {})
    .filter(([id, v]) => v > 0 && world.citizens[id])
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, max)
    .map(([id, v]) => ({ id, name: nameOf(world, id), affection: Math.round(v) }));
}

// ------------------------------------------------------------------- view

/** `GET /api/society`. */
export function societyView(world: World): Record<string, unknown> {
  const present = presentSet(world);
  const living = Object.values(world.citizens).filter((c) => isPresentIn(world, c, present));
  const households = householdsView(world, present);
  const clubs = clubsView(world, present);
  const { emporium, shops } = shopsView(world);
  let partnerships = 0;
  let marriages = 0;
  for (const c of living) {
    const partnerId = c.family.partnerId;
    if (!partnerId || !(c.id < partnerId)) continue;   // count each couple once
    const other = world.citizens[partnerId];
    if (!other || other.family.partnerId !== c.id || !isPresentIn(world, other, present)) continue;
    if (c.family.married) marriages++;
    else partnerships++;
  }
  return {
    calendar: {
      day: world.day, hour: world.hour, weekday: weekday(world), weekdayName: weekdayName(world.day),
      restDay: isRestDay(world), festivalToday: isFestivalToday(world), nextFestival: nextFestival(world),
      birthdaysToday: living.filter((c) => hasBirthdayToday(world, c))
        .map((c) => ({ id: c.id, name: c.name, familyName: c.familyName, age: ageOf(world, c) })),
    },
    counts: {
      households: households.length,
      housed: households.reduce((s, h) => s + (h.size as number), 0),
      clubs: clubs.length,
      clubMembers: new Set(clubs.flatMap((k) => (k.members as Person[]).map((m) => m.id))).size,
      partnerships,
      marriages,
      children: living.filter((c) => c.lifeStage === 'child').length,
      elders: living.filter((c) => c.lifeStage === 'elder').length,
      possessions: living.reduce((s, c) => s + c.possessions.length, 0),
      shops: shops.length,
    },
    households,
    clubs,
    happenings: happeningsView(world, present),
    chest: chestView(world),
    recentWeddings: ceremonies(world, 'wedding', present),
    recentBirths: ceremonies(world, 'birth', present),
    emporium,
    shops,
  };
}

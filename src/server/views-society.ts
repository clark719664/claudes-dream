/**
 * JSON view of the World's social layer for the dashboard: households and who
 * lives in them, the families they carry, clubs and when they meet, the
 * district sides, the day's happenings, the Community Chest and who has given
 * to it, everything on sale at the Emporium and in citizens' shops, the
 * Commons feed and the rumours still in circulation. Read-only — nothing here
 * moves money, emits events or touches the rng.
 */
import type {
  Citizen, CitizenId, Club, DistrictId, Happening, Household, ItemId, LedgerEntry, Post, World,
} from '../types.ts';
import { DISTRICT_IDS } from '../types.ts';
import { LAWS } from '../data/laws.ts';
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
import { liveRumours } from '../social/rumours.ts';
import { familyMembers, liveFeuds } from '../social/feuds.ts';
import type { PersonCard } from './views.ts';
import { isPresentIn, nameOf, partyName, personCard, personCards, presentSet } from './views.ts';

/** Chest movements shown on the Society tab. */
export const CHEST_LEDGER_LENGTH = 12;
/** Weddings and births shown on the Society tab. */
export const CEREMONY_VIEW_LENGTH = 8;
/** Names listed for one ceremony; a wedding may have the whole district as guests. */
export const CEREMONY_NAMES = 6;
/** Posts kept on the Commons feed view, newest first. */
export const FEED_VIEW_LENGTH = 60;
/** Rumours still in circulation shown on the Society tab. */
export const RUMOUR_VIEW_LENGTH = 40;
/** Faces listed for one family, one post's reactions, one rumour's hearers. */
export const FAMILY_FACES = 24;
export const POST_FACES = 12;
export const RUMOUR_FACES = 8;
/** Days of Chest balance the sparkline carries. */
export const CHEST_SERIES_DAYS = 30;
/** Names on the Chest's roll of givers and of those it has helped. */
export const CHEST_ROLL = 8;

// ---------------------------------------------------------------- helpers

/**
 * Everyone in this file is a `PersonCard` — the same id, name, face, office
 * and district every other view sends — so a citizen looks the same in a
 * household, a club, a rumour and a post as they do anywhere else.
 */
function person(world: World, id: CitizenId, present: Set<CitizenId>): PersonCard | null {
  return personCard(world, id, present);
}

function people(world: World, ids: readonly CitizenId[], present: Set<CitizenId>): PersonCard[] {
  return personCards(world, ids, present, ids.length);
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
      ...(personCard(world, m.id, present) as PersonCard),
      age: ageOf(world, m),
      relation: m.id === h.headId ? 'head' : relationBetween(world, h.headId, m.id) ?? 'housemate',
      rentShare: shares[m.id] ?? 0, mood: Math.round(m.mood),
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

// --------------------------------------------------------------- families

/** Who is feuding with whom, as a lookup by family name. */
function feudMap(world: World): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const f of liveFeuds(world)) {
    for (const [a, b] of [[f.families[0], f.families[1]], [f.families[1], f.families[0]]]) {
      out.set(a, [...(out.get(a) ?? []), b]);
    }
  }
  return out;
}

/**
 * The families of Reverie: every surname living in the city, who carries it,
 * where they live and who they are not speaking to. A household is an address;
 * a family is a name, and the two rarely line up.
 */
export function familiesView(world: World, present: Set<CitizenId>): Record<string, unknown>[] {
  const feuds = feudMap(world);
  const out: Record<string, unknown>[] = [];
  for (const name of new Set(world.order.map((id) => world.citizens[id]?.familyName).filter(Boolean))) {
    const members = familyMembers(world, name as string);
    if (!members.length) continue;
    const homes = new Set<string>();
    const districts = new Map<DistrictId, number>();
    for (const m of members) {
      const h = householdOf(world, m.id);
      if (h) homes.add(h.id);
      districts.set(m.district, (districts.get(m.district) ?? 0) + 1);
    }
    const eldest = members.slice().sort((a, b) => ageOf(world, b) - ageOf(world, a))[0];
    out.push({
      name, size: members.length,
      adults: members.filter((m) => m.lifeStage === 'adult').length,
      children: members.filter((m) => m.lifeStage === 'child').length,
      elders: members.filter((m) => m.lifeStage === 'elder').length,
      married: members.filter((m) => m.family.married).length,
      officeHolders: members.filter((m) => m.office).length,
      eldest: personCard(world, eldest.id, present), eldestAge: ageOf(world, eldest),
      homes: homes.size,
      districts: [...districts].sort((a, b) => b[1] - a[1])
        .map(([d, n]) => ({ district: d, districtName: districtName(world, d), count: n })),
      feudsWith: feuds.get(name as string) ?? [],
      members: personCards(world, members.map((m) => m.id), present, FAMILY_FACES),
    });
  }
  return out.sort((a, b) => (b.size as number) - (a.size as number) || String(a.name).localeCompare(String(b.name)));
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

/** A roll of names and sums, largest first: who gave, or who was helped. */
function chestRoll(world: World, totals: Map<string, number>, present: Set<CitizenId>): Record<string, unknown>[] {
  return [...totals]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, CHEST_ROLL)
    .map(([party, amount]) => ({
      party, name: partyName(world, party as Parameters<typeof partyName>[1]),
      who: personCard(world, party, present), amount,
    }));
}

/**
 * What the Chest held at the close of each day, today's live balance last.
 * Walked backwards from that balance, undoing each movement as it goes; the
 * ledger is capped, so the series reaches back as far as the ledger does and
 * no further.
 */
function chestSeries(world: World, ledger: readonly LedgerEntry[], balance: number): { day: number; balance: number }[] {
  const days: { day: number; balance: number }[] = [{ day: world.day, balance }];
  let running = balance;
  let day = world.day;
  for (let i = ledger.length - 1; i >= 0; i--) {
    const l = ledger[i];
    if (l.to !== 'chest' && l.from !== 'chest') continue;
    const entryDay = Math.floor(l.tick / 24);
    // Crossing a midnight: what is left is what the Chest closed that day on.
    while (day > entryDay) { day--; days.push({ day, balance: running }); }
    running += l.to === 'chest' ? -l.amount : l.amount;
  }
  return days.reverse().slice(-CHEST_SERIES_DAYS);
}

export function chestView(world: World, present: Set<CitizenId> = presentSet(world)): Record<string, unknown> {
  const ledger = world.treasury.ledger;
  const donations: Record<string, unknown>[] = [];
  const stipends: Record<string, unknown>[] = [];
  const given = new Map<string, number>();
  const helped = new Map<string, number>();
  for (let i = ledger.length - 1; i >= 0; i--) {
    const l = ledger[i];
    if (l.to === 'chest') {
      given.set(l.from, (given.get(l.from) ?? 0) + l.amount);
      if (donations.length < CHEST_LEDGER_LENGTH) donations.push(chestEntry(world, l));
    } else if (l.from === 'chest') {
      helped.set(l.to, (helped.get(l.to) ?? 0) + l.amount);
      if (stipends.length < CHEST_LEDGER_LENGTH) stipends.push(chestEntry(world, l));
    }
  }
  const balance = chestBalance(world);
  return {
    balance,
    donatedTotal: world.treasury.totals.donation ?? 0,
    paidTotal: world.treasury.totals.stipend ?? 0,
    givers: given.size,
    helped: helped.size,
    donations,
    stipends,
    roll: chestRoll(world, given, present),
    helpedRoll: chestRoll(world, helped, present),
    series: chestSeries(world, ledger, balance),
  };
}

// ------------------------------------------------------- weddings, births

function ceremonies(world: World, kind: 'wedding' | 'birth', present: Set<CitizenId>): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (let i = world.events.length - 1; i >= 0 && out.length < CEREMONY_VIEW_LENGTH; i--) {
    const e = world.events[i];
    if (e.kind !== kind) continue;
    const who = people(world, e.actors, present);
    out.push({ tick: e.tick, day: e.day, text: e.text, who: who.slice(0, CEREMONY_NAMES), others: Math.max(0, who.length - CEREMONY_NAMES) });
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
        product: id, name: p.name, category: p.category, hobby: p.hobby,
        hobbyName: p.hobby ? HOBBY_INFO[p.hobby]?.name ?? p.hobby : null,
        description: p.description, basePrice: p.basePrice,
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
      const shelf = shelfRows(shop);
      const row = {
        businessId: shop.businessId, name: shop.name, district, districtName: districtName(world, district),
        ownerId: shop.businessId === EMPORIUM_ID ? null : world.businesses[shop.businessId]?.ownerId ?? null,
        shelf,
        lines: shelf.length,
        stock: shelf.reduce((n, e) => n + (e.qty as number), 0),
        value: shelf.reduce((n, e) => n + (e.qty as number) * (e.price as number), 0),
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
  const families = familiesView(world, present);
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
      clubMembers: new Set(clubs.flatMap((k) => (k.members as PersonCard[]).map((m) => m.id))).size,
      partnerships,
      marriages,
      children: living.filter((c) => c.lifeStage === 'child').length,
      elders: living.filter((c) => c.lifeStage === 'elder').length,
      possessions: living.reduce((s, c) => s + c.possessions.length, 0),
      shops: shops.length,
      families: families.length,
      posts: (world.feed ?? []).length,
      rumours: liveRumours(world).length,
      rumoursTold: (world.rumours ?? []).length,
      feuds: liveFeuds(world).length,
      teams: Object.values(world.teams ?? {}).filter(Boolean).length,
    },
    households,
    families,
    clubs,
    happenings: happeningsView(world, present),
    chest: chestView(world, present),
    recentWeddings: ceremonies(world, 'wedding', present),
    recentBirths: ceremonies(world, 'birth', present),
    emporium,
    shops,
    ...societyExtras(world, present),
  };
}

// ------------------------------------------- rumours, feuds, mentors and the feed

/** Rumours in circulation, feuds, mentorships and the Commons feed. */
export function societyExtras(world: World, present: Set<CitizenId> = presentSet(world)): Record<string, unknown> {
  const mentorships: Record<string, unknown>[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !c.menteeId) continue;
    const mentee = world.citizens[c.menteeId];
    if (!mentee) continue;
    mentorships.push({ mentor: personCard(world, c.id, present), mentee: personCard(world, mentee.id, present) });
  }
  const feed = world.feed ?? [];
  return {
    posts: {
      count: feed.length,
      today: feed.filter((p) => p.day === world.day).length,
      reactions: feed.reduce((n, p) => n + Object.keys(p.reactions ?? {}).length, 0),
    },
    feed: [...feed]
      .sort((a, b) => b.day - a.day || b.id.localeCompare(a.id))
      .slice(0, FEED_VIEW_LENGTH)
      .map((p) => postView(world, p, present)),
    rumours: liveRumours(world)
      .sort((a, b) => b.day - a.day || a.id.localeCompare(b.id))
      .slice(0, RUMOUR_VIEW_LENGTH)
      .map((r) => ({
        id: r.id, about: personCard(world, r.aboutId, present), source: personCard(world, r.sourceId, present),
        claim: r.claim, law: r.law, lawName: r.law ? LAWS[r.law]?.name ?? r.law : null,
        day: r.day, age: world.day - r.day, heard: r.heardBy.length, disprovedDay: r.disprovedDay,
        // Nothing is secret from an observer (docs/PRINCIPLES.md §5); the
        // citizens repeating it have no idea which way this reads.
        truthful: r.truthful,
        heardBy: personCards(world, r.heardBy, present, RUMOUR_FACES),
      })),
    feuds: liveFeuds(world).map((f) => ({
      families: f.families, sinceDay: f.sinceDay, incidents: f.incidents, endedDay: f.endedDay,
      sizes: f.families.map((name) => familyMembers(world, name).length),
    })),
    mentorships,
    teams: Object.values(world.teams ?? {})
      .filter((t): t is NonNullable<typeof t> => !!t)
      .map((t) => ({
        district: t.district, districtName: districtName(world, t.district),
        name: t.name, wins: t.wins, losses: t.losses, draws: t.draws, size: t.players.length,
        players: personCards(world, t.players, present, 24),
      }))
      .sort((a, b) => b.wins - a.wins || b.size - a.size || a.name.localeCompare(b.name)),
  };
}

/** One post on the Commons feed: what was said, and who cheered it. */
export function postView(world: World, p: Post, present: Set<CitizenId>): Record<string, unknown> {
  const reactions = { cheer: 0, frown: 0, laugh: 0 };
  for (const kind of Object.values(p.reactions ?? {})) {
    if (kind === 'cheer' || kind === 'frown' || kind === 'laugh') reactions[kind]++;
  }
  const ids = Object.keys(p.reactions ?? {});
  return {
    id: p.id, day: p.day, text: p.text,
    author: personCard(world, p.authorId, present),
    reactions, reactionCount: ids.length,
    reactors: personCards(world, ids, present, POST_FACES).map((who) => ({
      ...who, reaction: (p.reactions ?? {})[who.id],
    })),
  };
}

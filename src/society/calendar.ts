/**
 * The calendar of Reverie: a seven-day week ending in Stillday, the two
 * festivals (Lantern Night every fortnight at the Sound Garden; Founders'
 * Day, with the Council sworn in at the Plaza, the day after each election),
 * and the happenings — weddings, births, birthdays, club meetings, festivals
 * and swearing-ins — that gather citizens at a place and an hour.
 *
 * Happenings are records on world.happenings: scheduled in the morning (or
 * by the action that causes them), joined by citizens through celebrate(),
 * and held by tickHappenings at the end of the hour they fall on. The
 * ceremonies of family life are held by romance.ts and family.ts; this
 * module knows only when to call them. Money moves through economy/treasury.
 */
import { clamp } from '../types.ts';
import type {
  ActionResult, BuildingId, CalendarObservation, Citizen, CitizenId, ClubId, DistrictId, Happening, HappeningKind, Need, World,
} from '../types.ts';
import { BIRTHDAY_EVERY, LANTERN_NIGHT_EVERY, LANTERN_NIGHT_HOUR, REST_DAY, WEEK_LENGTH } from '../data/catalogue.ts';
import { chance } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { deliverToMarket, takeFromMarket } from '../economy/market.ts';
import { FRIEND_THRESHOLD, adjustBond, bondBetween } from '../citizens/relationships.ts';
import { sittingCouncil } from '../government/cases.ts';
import { holdWedding } from './romance.ts';
import { birthChild, holdBirthday } from './family.ts';
import { festivalScale, seasonOf, yearOf } from '../world/seasons.ts';
import { fixtureOf, holdParade, playMatch } from '../culture/stadium.ts';
import { holdBlockParty } from '../social/neighbours.ts';
import { holdMemorial } from '../world/sunset.ts';
import { referendumToday } from '../politics/referendums.ts';

/** Names of the seven days; the last is Stillday, the rest day. */
export const WEEKDAY_NAMES: readonly string[] = ['Kindleday', 'Forgeday', 'Tideday', 'Quillday', 'Lanternday', 'Marketday', 'Stillday'];
export const LANTERN_NIGHT = 'Lantern Night';
export const FOUNDERS_DAY = "Founders' Day";
/** The Council is sworn in at noon on Founders' Day. */
export const SWEARING_IN_HOUR = 12;
export const FESTIVAL_VENUE: BuildingId = 'sound_garden';
export const SWEARING_IN_VENUE: BuildingId = 'central_plaza';
/** Happenings a passer-by may join with `celebrate`. */
export const CELEBRATABLE: readonly HappeningKind[] = [
  'wedding', 'birthday', 'festival', 'swearing_in',
  // The metropolis: the match, the block party, the memorial and the parade.
  'match', 'block_party', 'memorial', 'parade',
];
/** What a parade gives the crowd that walks in it, and the champions in front of it. */
export const PARADE_SOCIAL = 20;
export const PARADE_REPUTATION = 1;
/** Lantern Night: everyone present is cheered, the arts are in demand, lanterns are shared. */
export const FESTIVAL_SOCIAL = 20;
export const FESTIVAL_PURPOSE = 5;
export const FESTIVAL_BOND = 2;
/** One unit of culture is taken from the Bazaar for every this many festival-goers. */
export const FESTIVAL_CULTURE_PER = 5;
/** Performers play for double the usual 2 ℓ tip. */
export const FESTIVAL_TIP = 4;
export const TIP_MIN_WALLET = 20;
export const TIP_CHANCE = 0.5;
export const FESTIVAL_SHOW_CULTURE = 2;
/** Founders' Day: the oath lifts the Council, the crowd warms to it. */
export const SWEARING_IN_PURPOSE = 10;
export const SWEARING_IN_SOCIAL = 10;
export const SWEARING_IN_BOND = 1;
/** Birthdays listed in the calendar block, nearest and dearest first. */
export const MAX_BIRTHDAYS_SHOWN = 8;

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

/** Present and free to take part. */
function isAround(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id) && !isDetained(world, c);
}

function presentIds(world: World): CitizenId[] {
  return world.order.filter((id) => world.citizens[id] && world.citizens[id].standing !== 'exiled');
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

/** An hour spent together counts as contact for romance.dailyAffection. */
function noteContact(a: Citizen, b: Citizen): void {
  if (a.id === b.id) return;
  a.contactsToday[b.id] = (a.contactsToday[b.id] ?? 0) + 1;
  b.contactsToday[a.id] = (b.contactsToday[a.id] ?? 0) + 1;
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

// ---------------------------------------------------------------------------
// The week
// ---------------------------------------------------------------------------

/** Day of the week, 0..6 (6 is Stillday). */
export function weekday(world: World): number {
  return ((world.day % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH;
}

export function weekdayName(day: number): string {
  return WEEKDAY_NAMES[((Math.round(day) % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH];
}

/** Stillday: workplaces close (economy/jobs.ts keeps the same rule locally, see REST_DAY_EXEMPT_ROLES). */
export function isRestDay(world: World): boolean {
  return weekday(world) === REST_DAY;
}

// ---------------------------------------------------------------------------
// Festivals
// ---------------------------------------------------------------------------

/** Lantern Night falls every LANTERN_NIGHT_EVERY days (never on the founding day). */
export function isLanternNight(world: World, day: number = world.day): boolean {
  return day > 0 && day % LANTERN_NIGHT_EVERY === 0;
}

/** The day of the most recent election, or null before the first one has been held. */
export function lastElectionDay(world: World): number | null {
  const e = world.government.election;
  if (e.cycle <= 0) return null;
  return e.electionDay - world.config.cycleDays;
}

/**
 * Founders' Day is the day after each election. economy/treasury.ts keeps
 * an identical one-line rule (it must not import the society layer); the
 * calendar tests check that the two agree.
 */
export function isFoundersDay(world: World, day: number = world.day): boolean {
  const last = lastElectionDay(world);
  return last !== null && day === last + 1;
}

/** Today's festivals with the hour of their main event, Founders' Day first. */
export function festivalsToday(world: World): { name: string; hour: number }[] {
  const out: { name: string; hour: number }[] = [];
  if (isFoundersDay(world)) out.push({ name: FOUNDERS_DAY, hour: SWEARING_IN_HOUR });
  if (isLanternNight(world)) out.push({ name: LANTERN_NIGHT, hour: LANTERN_NIGHT_HOUR });
  return out;
}

export function isFestivalToday(world: World): { name: string; hour: number } | null {
  return festivalsToday(world)[0] ?? null;
}

/** The nearest festival (today counts as 0 days away); ties go to Founders' Day. */
export function nextFestival(world: World): { name: string; inDays: number } {
  const day = world.day;
  const lantern = isLanternNight(world) ? 0 : LANTERN_NIGHT_EVERY - (((day % LANTERN_NIGHT_EVERY) + LANTERN_NIGHT_EVERY) % LANTERN_NIGHT_EVERY);
  const e = world.government.election;
  let founders = isFoundersDay(world) ? 0 : e.electionDay + 1 - day;
  // an overdue election is held at the next rollover, so its Founders' Day is tomorrow
  if (founders <= 0 && !isFoundersDay(world)) founders = 1;
  return founders <= lantern ? { name: FOUNDERS_DAY, inDays: founders } : { name: LANTERN_NIGHT, inDays: lantern };
}

// ---------------------------------------------------------------------------
// Happenings
// ---------------------------------------------------------------------------

export interface HappeningSpec {
  kind: HappeningKind;
  day: number;
  hour: number;
  buildingId: BuildingId | null;
  /** Defaults to the building's district. */
  district?: DistrictId;
  who?: CitizenId[];
  clubId?: ClubId | null;
  label: string;
}

/** Put a happening on the calendar. */
export function addHappening(world: World, spec: HappeningSpec): Happening {
  world.happenings ??= [];
  const district: DistrictId = spec.district ?? (spec.buildingId ? world.buildings[spec.buildingId]?.district : undefined) ?? 'commons';
  const h: Happening = {
    id: nextId(world, 'e'), kind: spec.kind, day: Math.round(spec.day), hour: clamp(Math.round(spec.hour), 0, 23), district,
    buildingId: spec.buildingId, who: [...(spec.who ?? [])], clubId: spec.clubId ?? null, label: spec.label, done: false, attendees: [],
  };
  world.happenings.push(h);
  return h;
}

/** Happenings not yet held in a district at a given day and hour (now by default). */
export function happeningsAt(world: World, district: DistrictId, day: number = world.day, hour: number = world.hour): Happening[] {
  return (world.happenings ?? []).filter((h) => !h.done && h.district === district && h.day === day && h.hour === hour);
}

/** Today's happenings still to come (or under way), optionally in one district, earliest first. */
export function happeningsToday(world: World, district?: DistrictId): Happening[] {
  return (world.happenings ?? [])
    .filter((h) => !h.done && h.day === world.day && h.hour >= world.hour && (!district || h.district === district))
    .sort((a, b) => a.hour - b.hour);
}

function alreadyScheduled(world: World, kind: HappeningKind, day: number): boolean {
  return (world.happenings ?? []).some((h) => h.kind === kind && h.day === day);
}

/** Morning: put today's festivals on the calendar (idempotent) and drop stale entries. Everyone hears. */
export function scheduleFestivals(world: World): void {
  world.happenings ??= [];
  world.happenings = world.happenings.filter((h) => h.day >= world.day);
  const residents = presentIds(world);
  for (const f of festivalsToday(world)) {
    if (f.name === FOUNDERS_DAY) {
      if (alreadyScheduled(world, 'swearing_in', world.day)) continue;
      const council = sittingCouncil(world).map((m) => m.id);
      addHappening(world, {
        kind: 'swearing_in', day: world.day, hour: SWEARING_IN_HOUR, buildingId: SWEARING_IN_VENUE, who: council,
        label: `the Founders' Day swearing-in at ${buildingName(world, SWEARING_IN_VENUE)}`,
      });
      emit(world, 'festival', `Today is Founders' Day: the Council is sworn in at Central Plaza at ${SWEARING_IN_HOUR}:00 and the citizen's dividend is doubled.`,
        council, 0.5, { festival: FOUNDERS_DAY, hour: SWEARING_IN_HOUR });
      for (const id of residents) {
        remember(world, id, 'event', `Today is Founders' Day: the Council is sworn in at Central Plaza at noon, and the dividend is doubled.`);
      }
    } else {
      if (alreadyScheduled(world, 'festival', world.day)) continue;
      addHappening(world, {
        kind: 'festival', day: world.day, hour: LANTERN_NIGHT_HOUR, buildingId: FESTIVAL_VENUE,
        label: `Lantern Night at ${buildingName(world, FESTIVAL_VENUE)}`,
      });
      emit(world, 'festival', `Tonight is Lantern Night: lanterns at the Sound Garden from ${LANTERN_NIGHT_HOUR}:00, and performers play for double tips.`,
        [], 0.4, { festival: LANTERN_NIGHT, hour: LANTERN_NIGHT_HOUR });
      for (const id of residents) {
        remember(world, id, 'event', `Tonight is Lantern Night at the Sound Garden in Nightglass, from ${LANTERN_NIGHT_HOUR}:00.`);
      }
    }
  }
}

/** Join what is happening here this hour; the effects arrive when the happening is held at the end of the hour. */
export function celebrate(world: World, cId: CitizenId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (isDetained(world, c)) return fail('You cannot celebrate from the Watch House.');
  const where = districtName(world, c.district);
  const here = happeningsAt(world, c.district).filter((h) => CELEBRATABLE.includes(h.kind));
  if (here.length === 0) {
    const later = happeningsToday(world, c.district).find((h) => CELEBRATABLE.includes(h.kind) && h.hour > world.hour);
    if (later) return fail(`Nothing is happening in ${where} right now; ${later.label} starts at ${later.hour}:00.`);
    const elsewhere = happeningsToday(world).find((h) => CELEBRATABLE.includes(h.kind));
    if (elsewhere) return fail(`Nothing is happening in ${where} this hour; ${elsewhere.label} is at ${elsewhere.hour}:00 in ${districtName(world, elsewhere.district)}.`);
    const next = nextFestival(world);
    return fail(`Nothing is happening in ${where} this hour. The next festival is ${next.name}, ${next.inDays === 0 ? 'today' : `in ${plural(next.inDays, 'day')}`}.`);
  }
  const h = here.find((x) => !x.attendees.includes(cId));
  if (!h) return fail(`You are already at ${here[0].label}.`);
  h.attendees.push(cId);
  remember(world, cId, 'social', `You joined ${h.label}.`);
  return ok(`You joined ${h.label}.`);
}

// ---------------------------------------------------------------------------
// Holding happenings
// ---------------------------------------------------------------------------

/** Everyone free in the district, plus attendees who came from elsewhere, in turn order. */
function participants(world: World, h: Happening): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !isAround(world, c)) continue;
    if (c.district !== h.district && !h.attendees.includes(id)) continue;
    out.push(c);
  }
  return out;
}

function isPerformer(world: World, c: Citizen): boolean {
  const job = c.jobId ? world.jobs[c.jobId] : undefined;
  return !!job && job.holderId === c.id && (job.role === 'performer' || job.role === 'artist');
}

/** Lantern Night: the whole district is cheered, lanterns are shared among those who came, performers play for double tips. */
function holdFestival(world: World, h: Happening): void {
  const venue = buildingName(world, h.buildingId);
  const crowd = participants(world, h);
  if (crowd.length === 0) {
    emit(world, 'festival', `${LANTERN_NIGHT} passed with an empty ${venue}.`, [], 0.3, { happeningId: h.id, crowd: 0 });
    return;
  }
  const culture = takeFromMarket(world, 'culture', Math.max(1, Math.ceil(crowd.length / FESTIVAL_CULTURE_PER)));
  // Rain and snow keep people at home; a storm all but empties the Garden.
  const scale = festivalScale(world);
  for (const c of crowd) {
    addNeed(c, 'social', FESTIVAL_SOCIAL * scale);
    if (culture > 0) addNeed(c, 'purpose', FESTIVAL_PURPOSE * scale);
  }
  const attendees = crowd.filter((c) => h.attendees.includes(c.id));
  for (let i = 0; i < attendees.length; i++) {
    for (let j = i + 1; j < attendees.length; j++) {
      adjustBond(world, attendees[i].id, attendees[j].id, FESTIVAL_BOND);
      noteContact(attendees[i], attendees[j]);
    }
  }
  const performers = crowd.filter((c) => isPerformer(world, c));
  let tips = 0;
  for (const p of performers) {
    deliverToMarket(world, 'culture', FESTIVAL_SHOW_CULTURE);
    p.stats.showsPerformed += 1;
    addNeed(p, 'purpose', FESTIVAL_PURPOSE);
    let earned = 0;
    for (const a of crowd) {
      if (a.id === p.id || a.wallet <= TIP_MIN_WALLET || !chance(world, TIP_CHANCE)) continue;
      if (transfer(world, a.id, p.id, FESTIVAL_TIP, 'tip', `${LANTERN_NIGHT} tip for ${p.name}`)) earned += FESTIVAL_TIP;
    }
    tips += earned;
    remember(world, p.id, 'work', `You played ${LANTERN_NIGHT} at ${venue} for a crowd of ${crowd.length}${earned > 0 ? `, earning ${earned} ℓ in double tips` : ''}.`);
  }
  for (const c of crowd) {
    if (performers.includes(c)) continue;
    remember(world, c.id, 'social', `You celebrated ${LANTERN_NIGHT} at ${venue} with ${plural(crowd.length - 1, 'other')}${culture > 0 ? '' : '; the lanterns burned a little dim for want of culture'}.`);
  }
  const played = performers.length > 0
    ? `; ${performers.map((p) => p.name).join(' and ')} played${tips > 0 ? ` for ${tips} ℓ in tips` : ''}`
    : '';
  const dim = culture === 0 ? ' The Bazaar had no culture to spare, and the lanterns burned a little dim.' : '';
  emit(world, 'festival', `${LANTERN_NIGHT} lit up ${venue}: ${plural(crowd.length, 'citizen')} celebrated${played}.${dim}`,
    crowd.map((c) => c.id), 0.7, { happeningId: h.id, crowd: crowd.length, attendees: attendees.length, performers: performers.map((p) => p.id), tips, culture });
}

/** Founders' Day: the Council takes its oath before whoever gathers in the Plaza. */
function holdSwearingIn(world: World, h: Happening): void {
  const venue = buildingName(world, h.buildingId);
  const council = sittingCouncil(world);
  const crowd = participants(world, h).filter((c) => !council.includes(c));
  if (council.length === 0) {
    emit(world, 'festival', `${FOUNDERS_DAY} passed with no Council to swear in at ${venue}.`, [], 0.4, { happeningId: h.id, crowd: crowd.length });
    for (const c of crowd) remember(world, c.id, 'civic', `You gathered at ${venue} on ${FOUNDERS_DAY}, but there was no Council to swear in.`);
    return;
  }
  const mayor = world.government.mayorId ? world.citizens[world.government.mayorId] ?? null : null;
  for (const m of council) {
    addNeed(m, 'purpose', SWEARING_IN_PURPOSE);
    m.reputation = clamp(m.reputation + 1, 0, 100);
    remember(world, m.id, 'civic', `You took the oath of office at ${venue} on ${FOUNDERS_DAY} before ${plural(crowd.length, 'citizen')}.`);
  }
  for (const c of crowd) {
    addNeed(c, 'social', SWEARING_IN_SOCIAL);
    for (const m of council) adjustBond(world, c.id, m.id, SWEARING_IN_BOND, false);
    remember(world, c.id, 'civic', `You watched the Council sworn in at ${venue} on ${FOUNDERS_DAY}.`);
  }
  const others = council.filter((m) => m !== mayor);
  const who = mayor
    ? `Mayor ${mayor.name}${others.length ? ` and ${plural(others.length, 'councillor')}` : ''}`
    : plural(council.length, 'councillor');
  emit(world, 'festival', `${FOUNDERS_DAY}: ${who} were sworn in at ${venue} before ${plural(crowd.length, 'citizen')}.`,
    [...council.map((m) => m.id), ...crowd.map((c) => c.id)], 0.6, { happeningId: h.id, council: council.map((m) => m.id), crowd: crowd.length });
}

/** A club meeting closes: attendance is recorded (attendClub applied the effects as members arrived). */
function closeMeeting(world: World, h: Happening): void {
  const club = h.clubId ? world.clubs?.[h.clubId] : undefined;
  if (!club) return;
  const venue = buildingName(world, h.buildingId);
  const n = h.attendees.length;
  if (n === 0) {
    emit(world, 'club', `Nobody came to the ${club.name}'s meeting at ${venue}.`, [club.convenorId], 0.1, { clubId: club.id, attendees: 0 });
    return;
  }
  emit(world, 'club', `The ${club.name} met at ${venue}: ${plural(n, 'member')} attended.`, h.attendees, n >= 5 ? 0.3 : 0.15,
    { clubId: club.id, attendees: n });
}

function holdHappening(world: World, h: Happening): void {
  switch (h.kind) {
    case 'wedding': {
      const couple = h.who.map((id) => presentCitizen(world, id));
      const [a, b] = couple;
      if (couple.length < 2 || !a || !b) {
        const gone = h.who.filter((id) => !presentCitizen(world, id)).map((id) => world.citizens[id]?.name ?? id);
        emit(world, 'romance', `The wedding at ${buildingName(world, h.buildingId)} did not take place: ${gone.join(' and ') || 'the couple'} ${gone.length === 1 ? 'has' : 'have'} left the city.`,
          h.who, 0.4, { happeningId: h.id });
        return;
      }
      if (a.family.partnerId !== b.id || b.family.partnerId !== a.id) {
        emit(world, 'romance', `The wedding of ${a.name} and ${b.name} was called off: they are no longer together.`, [a.id, b.id], 0.4, { happeningId: h.id });
        return;
      }
      holdWedding(world, h);
      return;
    }
    case 'birth': {
      if (!h.who.some((id) => presentCitizen(world, id))) {
        emit(world, 'birth', `No birth at the Restoration Ward: the parents have left the city.`, h.who, 0.3, { happeningId: h.id });
        return;
      }
      birthChild(world, h);
      return;
    }
    case 'birthday': {
      if (!h.who[0] || !presentCitizen(world, h.who[0])) return;
      holdBirthday(world, h);
      return;
    }
    case 'festival': holdFestival(world, h); return;
    case 'swearing_in': holdSwearingIn(world, h); return;
    case 'club_meeting': closeMeeting(world, h); return;
    // The metropolis: the Stadium, the stairwell, the Garden and the Plaza.
    case 'match': playMatch(world, h); return;
    case 'block_party': holdBlockParty(world, h); return;
    case 'memorial': holdMemorial(world, h); return;
    case 'parade': holdParadeHere(world, h); return;
    default: return;
  }
}

/**
 * The champions' parade. `culture/stadium.ts` names the side and prints the
 * day; here the crowd that turned out shares the walk.
 */
function holdParadeHere(world: World, h: Happening): void {
  holdParade(world, h);
  const crowd = participants(world, h);
  for (const c of crowd) addNeed(c, 'social', PARADE_SOCIAL);
  for (const id of h.who) {
    const champion = presentCitizen(world, id);
    if (champion) champion.reputation = clamp(champion.reputation + PARADE_REPUTATION, 0, 100);
  }
  if (crowd.length > 0) {
    emit(world, 'match', `${crowd.length} came out to the parade at ${buildingName(world, h.buildingId)}.`,
      crowd.map((c) => c.id), 0.7, { happeningId: h.id, crowd: crowd.length });
  }
}

/**
 * End of the hour: hold every happening due now (an overdue one, missed by
 * an engine hiccup, is held at the first opportunity), then drop yesterday's.
 * A ceremony that throws is recorded as an engine error and never re-run.
 */
export function tickHappenings(world: World): void {
  world.happenings ??= [];
  const due = world.happenings.filter((h) => !h.done && (h.day < world.day || (h.day === world.day && h.hour <= world.hour)));
  for (const h of due) {
    h.done = true;
    try {
      holdHappening(world, h);
    } catch (err) {
      world.counters.engineErrors = (world.counters.engineErrors ?? 0) + 1;
      const message = err instanceof Error ? err.message : String(err);
      emit(world, 'system', `Engine error while holding ${h.label}: ${message}`, [], 0.3, { where: `happening ${h.id}`, kind: h.kind });
    }
  }
  world.happenings = world.happenings.filter((h) => h.day >= world.day);
}

// ---------------------------------------------------------------------------
// Observation
// ---------------------------------------------------------------------------

/** Every BIRTHDAY_EVERY days after arrival or birth. */
export function hasBirthdayToday(world: World, c: Citizen): boolean {
  return world.day > c.bornDay && (world.day - c.bornDay) % BIRTHDAY_EVERY === 0;
}

/** Birthdays today that matter to `self`: their own, family, friends, then neighbours in the district. */
function birthdaysToday(world: World, self: Citizen): CitizenId[] {
  const family = new Set<CitizenId>([...self.family.parents, ...self.family.children, ...(self.family.partnerId ? [self.family.partnerId] : [])]);
  const rows: { id: CitizenId; rank: number }[] = [];
  for (const id of world.order) {
    const o = world.citizens[id];
    if (!o || o.standing === 'exiled' || !hasBirthdayToday(world, o)) continue;
    const rank = id === self.id ? 0 : family.has(id) ? 1 : bondBetween(world, self.id, id) >= FRIEND_THRESHOLD ? 2 : o.district === self.district ? 3 : -1;
    if (rank >= 0) rows.push({ id, rank });
  }
  rows.sort((a, b) => a.rank - b.rank || a.id.localeCompare(b.id));
  return rows.slice(0, MAX_BIRTHDAYS_SHOWN).map((r) => r.id);
}

/** The fixture at the Stadium today, if the league has one. */
function matchToday(world: World): { home: DistrictId; away: DistrictId; hour: number } | null {
  for (const h of world.happenings ?? []) {
    if (h.kind !== 'match' || h.day !== world.day) continue;
    const fixture = fixtureOf(world, h);
    if (fixture) return { home: fixture.home, away: fixture.away, hour: h.hour };
  }
  return null;
}

/** The calendar block of an observation. */
export function calendarObservation(world: World, c: Citizen): CalendarObservation {
  return {
    weekday: weekday(world),
    restDay: isRestDay(world),
    festivalToday: isFestivalToday(world),
    nextFestival: nextFestival(world),
    birthdaysToday: birthdaysToday(world, c),
    season: world.season ?? seasonOf(world),
    weather: world.weather ?? 'clear',
    year: world.year ?? yearOf(world),
    matchToday: matchToday(world),
    referendumToday: referendumToday(world) !== null,
  };
}

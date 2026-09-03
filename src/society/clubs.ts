/**
 * Clubs: hobbies practised together. Any adult may found a club for a hobby
 * (a registration fee to the Treasury); clubs meet weekly at the hobby's
 * venue, members who attend gain company, friendship with everyone else in
 * the room and a little skill, and a convenor — the founder, then the
 * best-connected member — speaks for the club. Meetings are Happenings (see
 * calendar.ts): scheduled each morning by scheduleMeetings, attended through
 * attendClub, closed by calendar.tickHappenings. Clubs are also where
 * politics happens: a candidate seen at a well-attended meeting gains
 * visibility. Money moves only through economy/treasury.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Citizen, CitizenId, Club, ClubId, Happening, Hobby, World } from '../types.ts';
import { CLUB_FOUNDING_FEE, CLUB_MEETING_HOUR, CLUB_NAME_PARTS, HOBBIES, HOBBY_INFO, WEEK_LENGTH } from '../data/catalogue.ts';
import { pick, randInt } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustBond, bondBetween } from '../citizens/relationships.ts';

/** A citizen belongs to at most this many clubs. */
export const MAX_CLUBS_PER_CITIZEN = 5;
/** Membership reaching this size makes the news. */
export const CLUB_NEWS_SIZE = 10;
export const MAX_CLUB_NAME = 40;
/** What an evening at the club does for a member. */
export const MEETING_SOCIAL = 12;
export const MEETING_BOND = 4;
export const MEETING_SKILL = 0.5;
export const MEETING_PURPOSE = 4;
/** Extra purpose when the club's hobby is one of the member's own. */
export const MEETING_TASTE_PURPOSE = 4;
/** Founding a club is a purpose in itself. */
export const FOUNDING_PURPOSE = 8;
/** A candidate present gains one visibility for every this many members in the room. */
export const ATTENDEES_PER_VISIBILITY = 3;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

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

/** An adult (or elder) living in the city: the only kind of citizen a club counts. */
function presentAdult(world: World, c: Citizen): boolean {
  return c.lifeStage !== 'child' && c.standing !== 'exiled' && world.order.includes(c.id);
}

function districtName(world: World, d: keyof World['districts']): string {
  return world.districts[d]?.name ?? d;
}

/** "the Halflight Chess Circle", unless the name already starts with "The". */
export function theClub(club: Club): string {
  return /^the\s/i.test(club.name) ? club.name : `the ${club.name}`;
}

/** Where a club meets: the hobby's venue and its district. */
export function clubVenue(world: World, club: Club): { buildingId: string; district: keyof World['districts']; name: string } {
  const info = HOBBY_INFO[club.hobby];
  const building = world.buildings[info.venue];
  return { buildingId: info.venue, district: building?.district ?? info.district, name: building?.name ?? info.venue };
}

function weekdayOf(world: World): number {
  return ((world.day % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH;
}

/** The day of the club's next meeting (today if it meets today). */
export function nextMeetingDay(world: World, club: Club): number {
  const wait = (club.meetsOnWeekday - weekdayOf(world) + WEEK_LENGTH) % WEEK_LENGTH;
  return world.day + wait;
}

export function isMember(club: Club, cId: CitizenId): boolean {
  return club.members.includes(cId);
}

/** Living clubs (with members) for a hobby, largest first. */
export function clubsFor(world: World, hobby: Hobby): Club[] {
  return Object.values(world.clubs ?? {})
    .filter((k) => k.hobby === hobby && k.members.length > 0)
    .sort((a, b) => b.members.length - a.members.length || a.id.localeCompare(b.id));
}

/** Today's meeting of a club, held or not. */
export function meetingOf(world: World, club: Club): Happening | null {
  return (world.happenings ?? []).find((h) => h.kind === 'club_meeting' && h.clubId === club.id && h.day === world.day) ?? null;
}

function nameTaken(world: World, name: string): boolean {
  const wanted = name.toLowerCase();
  return Object.values(world.clubs ?? {}).some((k) => k.name.toLowerCase() === wanted);
}

/** "Lantern Ensemble": a club name from the catalogue parts, unique among living clubs. */
export function suggestClubName(world: World, hobby: Hobby): string {
  const suffix = CLUB_NAME_PARTS.suffixes[hobby];
  for (let i = 0; i < 10; i++) {
    const name = `${pick(world, CLUB_NAME_PARTS.prefixes)} ${suffix}`;
    if (!nameTaken(world, name)) return name;
  }
  for (let n = 2; ; n++) {
    const name = `${CLUB_NAME_PARTS.prefixes[0]} ${suffix} ${n}`;
    if (!nameTaken(world, name)) return name;
  }
}

// ---------------------------------------------------------------------------
// Founding, joining, leaving
// ---------------------------------------------------------------------------

/** Found a club for a hobby. The registration fee goes to the Treasury; the founder is its first convenor. */
export function foundClub(world: World, cId: CitizenId, hobby: Hobby, name: string): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (isDetained(world, c)) return fail('You cannot found a club from the Watch House.');
  if (!inGoodStanding(c)) return fail(`You cannot found a club while ${c.standing}.`);
  if (c.lifeStage === 'child') return fail('Clubs are founded by adults; children play in the Garden.');
  if (!HOBBIES.includes(hobby)) return fail(`There is no such hobby as ${String(hobby)}.`);
  if (c.clubs.length >= MAX_CLUBS_PER_CITIZEN) return fail(`You already belong to ${MAX_CLUBS_PER_CITIZEN} clubs; leave one first.`);
  const chosen = (typeof name === 'string' ? name : '').trim().slice(0, MAX_CLUB_NAME) || suggestClubName(world, hobby);
  if (nameTaken(world, chosen)) return fail(`There is already a club called ${chosen}.`);
  if (c.wallet < CLUB_FOUNDING_FEE) return fail(`Registering a club costs ${CLUB_FOUNDING_FEE} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, cId, 'treasury', CLUB_FOUNDING_FEE, 'registration', `registration of ${chosen}`)) return fail('The registration fee could not be paid.');

  world.clubs ??= {};
  const club: Club = {
    id: nextId(world, 'u'), name: chosen, hobby, founderId: cId, convenorId: cId, members: [cId],
    foundedDay: world.day, meetsOnWeekday: randInt(world, 0, WEEK_LENGTH - 1),
  };
  world.clubs[club.id] = club;
  c.clubs.push(club.id);
  c.needs.purpose = clamp(c.needs.purpose + FOUNDING_PURPOSE, 0, 100);

  const venue = clubVenue(world, club);
  const first = nextMeetingDay(world, club);
  const hobbyName = HOBBY_INFO[hobby].name.toLowerCase();
  emit(world, 'club', `${c.name} founded ${theClub(club)}, a ${hobbyName} club meeting weekly at ${venue.name} (first meeting on day ${first} at ${CLUB_MEETING_HOUR}:00).`,
    [cId], 0.5, { clubId: club.id, hobby, meetsOnWeekday: club.meetsOnWeekday });
  remember(world, cId, 'social', `You founded ${theClub(club)} (${club.id}) for ${CLUB_FOUNDING_FEE} ℓ; it meets weekly at ${venue.name} at ${CLUB_MEETING_HOUR}:00, next on day ${first}.`);
  return ok(`You founded ${theClub(club)} (${club.id}); it meets at ${venue.name} in ${districtName(world, venue.district)} at ${CLUB_MEETING_HOUR}:00, first on day ${first}.`);
}

export function joinClub(world: World, cId: CitizenId, clubId: ClubId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (isDetained(world, c)) return fail('You cannot join a club from the Watch House.');
  if (!inGoodStanding(c)) return fail(`You cannot join a club while ${c.standing}.`);
  if (c.lifeStage === 'child') return fail('Clubs are for adults; children play in the Garden and the Plaza.');
  const club = world.clubs?.[clubId];
  if (!club) return fail('There is no such club.');
  if (isMember(club, cId)) return fail(`You are already a member of ${theClub(club)}.`);
  if (c.clubs.length >= MAX_CLUBS_PER_CITIZEN) return fail(`You already belong to ${MAX_CLUBS_PER_CITIZEN} clubs; leave one first.`);

  club.members.push(cId);
  c.clubs.push(club.id);
  const venue = clubVenue(world, club);
  const size = club.members.length;
  const milestone = size === CLUB_NEWS_SIZE;
  emit(world, 'club', milestone
    ? `${theClub(club)[0].toUpperCase()}${theClub(club).slice(1)} has grown to ${CLUB_NEWS_SIZE} members with ${c.name} joining; it meets at ${venue.name}.`
    : `${c.name} joined ${theClub(club)}.`,
  [cId, club.convenorId].filter((id, i, all) => all.indexOf(id) === i), milestone ? 0.6 : 0.2, { clubId: club.id, members: size });
  remember(world, cId, 'social', `You joined ${theClub(club)} (${club.id}); it meets at ${venue.name} at ${CLUB_MEETING_HOUR}:00, next on day ${nextMeetingDay(world, club)}.`);
  if (club.convenorId !== cId) remember(world, club.convenorId, 'social', `${c.name} joined ${theClub(club)} (${size} members now).`);
  return ok(`You joined ${theClub(club)}; it meets at ${venue.name} at ${CLUB_MEETING_HOUR}:00, next on day ${nextMeetingDay(world, club)}.`);
}

/** Take a member off the roll without ceremony (departures, exile, pruning). The caller narrates. */
export function removeMember(world: World, club: Club, cId: CitizenId): void {
  club.members = club.members.filter((id) => id !== cId);
  const c = world.citizens[cId];
  if (c) c.clubs = c.clubs.filter((id) => id !== club.id);
}

function dissolveClub(world: World, club: Club, reason: string): void {
  for (const id of [...club.members]) removeMember(world, club, id);
  delete world.clubs[club.id];
  emit(world, 'club', `${theClub(club)[0].toUpperCase()}${theClub(club).slice(1)} has disbanded: ${reason}.`, [], 0.3, { clubId: club.id, reason });
}

/**
 * The convenor is the founder while they remain a member in good standing;
 * otherwise the member with the warmest mean bond toward the others (ties:
 * the sitting convenor, then join order). A change is announced.
 */
export function chooseConvenor(world: World, club: Club): CitizenId {
  const members = club.members
    .map((id) => world.citizens[id])
    .filter((m): m is Citizen => !!m && presentAdult(world, m) && inGoodStanding(m));
  if (members.length === 0) return club.convenorId;
  let next = members.find((m) => m.id === club.founderId) ?? null;
  if (!next) {
    let bestScore = Number.NEGATIVE_INFINITY;
    for (const m of members) {
      const others = club.members.filter((id) => id !== m.id);
      const mean = others.length ? others.reduce((sum, id) => sum + bondBetween(world, m.id, id), 0) / others.length : 0;
      const score = mean + (m.id === club.convenorId ? 0.001 : 0);
      if (score > bestScore) { bestScore = score; next = m; }
    }
  }
  if (!next || next.id === club.convenorId) return club.convenorId;
  const previous = club.convenorId;
  club.convenorId = next.id;
  emit(world, 'club', `${next.name} is the new convenor of ${theClub(club)}.`, [next.id], 0.3, { clubId: club.id, previous });
  remember(world, next.id, 'civic', `You are now the convenor of ${theClub(club)}.`);
  return club.convenorId;
}

export function leaveClub(world: World, cId: CitizenId, clubId: ClubId): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  const club = world.clubs?.[clubId];
  if (!club) return fail('There is no such club.');
  if (!isMember(club, cId)) return fail(`You are not a member of ${theClub(club)}.`);
  removeMember(world, club, cId);
  remember(world, cId, 'social', `You left ${theClub(club)}.`);
  if (club.members.length === 0) {
    dissolveClub(world, club, 'its last member left');
    return ok(`You left ${theClub(club)}; with nobody left, it has disbanded.`);
  }
  emit(world, 'club', `${c.name} left ${theClub(club)}.`, [cId], 0.1, { clubId: club.id, members: club.members.length });
  if (club.convenorId === cId) chooseConvenor(world, club);
  return ok(`You left ${theClub(club)}.`);
}

// ---------------------------------------------------------------------------
// Meetings
// ---------------------------------------------------------------------------

/** Morning: every club meeting today gets a Happening at the venue (idempotent); members are reminded. */
export function scheduleMeetings(world: World): void {
  world.happenings ??= [];
  const today = weekdayOf(world);
  for (const club of Object.values(world.clubs ?? {})) {
    if (club.members.length === 0 || club.meetsOnWeekday !== today || meetingOf(world, club)) continue;
    const venue = clubVenue(world, club);
    const h: Happening = {
      id: nextId(world, 'e'), kind: 'club_meeting', day: world.day, hour: CLUB_MEETING_HOUR, district: venue.district,
      buildingId: venue.buildingId, who: [club.convenorId], clubId: club.id, label: `${theClub(club)}'s meeting at ${venue.name}`,
      done: false, attendees: [],
    };
    world.happenings.push(h);
    for (const id of club.members) {
      if (presentCitizen(world, id)) {
        remember(world, id, 'social', `${theClub(club)[0].toUpperCase()}${theClub(club).slice(1)} meets today at ${CLUB_MEETING_HOUR}:00 at ${venue.name} in ${districtName(world, venue.district)}.`);
      }
    }
  }
}

/** Contact for romance.dailyAffection: an evening together at the club. */
function noteContact(a: Citizen, b: Citizen): void {
  if (a.id === b.id) return;
  a.contactsToday[b.id] = (a.contactsToday[b.id] ?? 0) + 1;
  b.contactsToday[a.id] = (b.contactsToday[a.id] ?? 0) + 1;
}

/**
 * Attend the club's meeting: at the venue, at the meeting hour. The member
 * gains company, a bond with everyone already in the room, a little of the
 * hobby's skill and some purpose; candidates in the room gain visibility as
 * it fills.
 */
export function attendClub(world: World, cId: CitizenId, clubId: ClubId): ActionResult {
  const c = presentCitizen(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (isDetained(world, c)) return fail('You cannot attend a meeting from the Watch House.');
  if (!inGoodStanding(c)) return fail(`You cannot attend club meetings while ${c.standing}.`);
  const club = world.clubs?.[clubId];
  if (!club) return fail('There is no such club.');
  if (!isMember(club, cId)) return fail(`You are not a member of ${theClub(club)}; join it first.`);
  const venue = clubVenue(world, club);
  const meeting = meetingOf(world, club);
  if (!meeting) {
    const next = nextMeetingDay(world, club);
    return fail(`${theClub(club)[0].toUpperCase()}${theClub(club).slice(1)} does not meet today; its next meeting is on day ${next} at ${CLUB_MEETING_HOUR}:00 at ${venue.name}.`);
  }
  if (meeting.done || world.hour > meeting.hour) return fail(`Today's meeting of ${theClub(club)} is over; the next is on day ${nextMeetingDay(world, club) + WEEK_LENGTH}.`);
  if (world.hour < meeting.hour) return fail(`${theClub(club)[0].toUpperCase()}${theClub(club).slice(1)} meets at ${meeting.hour}:00 at ${venue.name}; it is ${world.hour}:00.`);
  if (c.district !== meeting.district) {
    return fail(`${theClub(club)[0].toUpperCase()}${theClub(club).slice(1)} meets at ${venue.name} in ${districtName(world, meeting.district)}; you are in ${districtName(world, c.district)}.`);
  }
  if (meeting.attendees.includes(cId)) return fail(`You are already at the meeting of ${theClub(club)}.`);

  const present = meeting.attendees.map((id) => world.citizens[id]).filter((o): o is Citizen => !!o && o.id !== cId);
  for (const o of present) {
    adjustBond(world, cId, o.id, MEETING_BOND);
    noteContact(c, o);
  }
  const info = HOBBY_INFO[club.hobby];
  c.needs.social = clamp(c.needs.social + MEETING_SOCIAL, 0, 100);
  c.skills[info.skill] = clamp(round2(c.skills[info.skill] + MEETING_SKILL), 0, 100);
  const loved = c.tastes.hobbies.includes(club.hobby);
  c.needs.purpose = clamp(c.needs.purpose + MEETING_PURPOSE + (loved ? MEETING_TASTE_PURPOSE : 0), 0, 100);
  meeting.attendees.push(cId);

  if (meeting.attendees.length % ATTENDEES_PER_VISIBILITY === 0) {
    const candidates = world.government.election.candidates;
    for (const id of meeting.attendees) {
      const a = world.citizens[id];
      if (!a || !candidates.includes(id)) continue;
      a.campaignVisibility += 1;
      remember(world, id, 'civic', `Your candidacy was noticed at ${theClub(club)}'s meeting (${meeting.attendees.length} members present).`);
    }
  }

  const company = present.length === 0 ? 'nobody else had arrived yet' : `${present.length} other member${present.length === 1 ? '' : 's'}`;
  remember(world, cId, 'social', `You attended ${theClub(club)}'s meeting at ${venue.name} (${company}), practising ${info.name.toLowerCase()}${loved ? ', which you love' : ''}.`);
  return ok(`You attended ${theClub(club)}'s meeting at ${venue.name} with ${company}.`);
}

// ---------------------------------------------------------------------------
// Daily
// ---------------------------------------------------------------------------

/** Morning: members who have left the city are struck off, convenors are settled, empty clubs are dissolved, rolls are kept honest. */
export function dailyClubs(world: World): void {
  world.clubs ??= {};
  for (const club of Object.values(world.clubs)) {
    for (const id of [...club.members]) {
      const m = world.citizens[id];
      if (!m || !presentAdult(world, m)) removeMember(world, club, id);
    }
    if (club.members.length === 0) {
      dissolveClub(world, club, 'no members remain');
      continue;
    }
    chooseConvenor(world, club);
  }
  for (const c of Object.values(world.citizens)) {
    const kept = c.clubs.filter((id) => world.clubs[id]?.members.includes(c.id));
    if (kept.length !== c.clubs.length) c.clubs = kept;
  }
}

/**
 * The Stadium — the one place in Reverie where a district is a thing you can
 * belong to.
 *
 * Every open district fields a team. Citizens `join_team` (their own district's
 * — you cannot buy your way onto a better one), `train` at the Stadium or on
 * their own ground, and play on Quillday evenings. A match is decided by what
 * the players have actually done: how fit they are (care), whether games are
 * their thing, how well they know one another, the work their coach has put
 * in, and the week's training. Fans pay at the gate, and the takings are the
 * city's. A league table runs for a cycle; at its end the champions share a
 * purse, take a milestone each, and parade on the next Founders' Day — and
 * then everything is set back to nothing and the city starts again.
 */
import { DISTRICT_IDS, clamp } from '../types.ts';
import type {
  ActionResult, Building, BuildingId, Citizen, CitizenId, DistrictId, Happening, Match, Team, World,
} from '../types.ts';
import { MATCH_HOUR, MATCH_WEEKDAY, MAX_MATCHES, TEAM_NAMES } from '../data/metropolis.ts';
import { CHAMPION_PRIZE, MATCH_TICKET } from '../data/jobs.ts';
import { WEEK_LENGTH } from '../data/catalogue.ts';
import { poisson, rand } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { adjustBond, bondBetween } from '../citizens/relationships.ts';
import { recordMilestone } from '../identity/goals.ts';
import { addHappening, happeningsAt } from '../society/calendar.ts';

export const STADIUM: BuildingId = 'stadium';
export const PARADE_VENUE: BuildingId = 'central_plaza';
export const PARADE_HOUR = 13;
/** A fixture needs two sides with this many players who can take the field. */
export const MIN_PLAYERS = 2;
/** What a session on the ground is worth to a player, and to their side. */
export const TRAIN_SKILL = 0.5;
export const TRAIN_REST = 6;
export const TRAIN_PURPOSE = 6;
export const TRAIN_STRENGTH = 0.5;
/** A week of training can only carry a side so far. */
export const TRAIN_STRENGTH_CAP = 6;
/** Playing, watching, winning. */
export const MATCH_PURPOSE = 10;
export const MATCH_BOND = 3;
export const CROWD_SOCIAL = 12;
export const ATTEND_SOCIAL = 15;
export const CHAMPION_REPUTATION = 3;
export const PARADE_SOCIAL = 20;
/** Goals are Poisson: a side of this strength scores about one. */
export const STRENGTH_PER_GOAL = 12;
export const POINTS_WIN = 3;
export const POINTS_DRAW = 1;
/** Being a games player is worth this much to a side. */
export const GAMES_HOBBY_BONUS = 5;
/** Where a district may train when the Stadium is across town. */
export const GROUND_KINDS: readonly Building['kind'][] = ['stadium', 'plaza', 'garden'];

function fail(message: string): ActionResult { return { ok: false, message }; }

function teamBook(world: World): Partial<Record<DistrictId, Team>> {
  const w = world as { teams?: Partial<Record<DistrictId, Team>> };
  if (!w.teams) w.teams = {};
  return w.teams;
}

function openDistricts(world: World): DistrictId[] {
  const open = world.openDistricts;
  const list = Array.isArray(open) && open.length > 0 ? open : DISTRICT_IDS.slice(0, 7);
  return DISTRICT_IDS.filter((d) => list.includes(d));
}

/** At liberty and in the city: able to take the field. */
function canPlay(world: World, c: Citizen | undefined): c is Citizen {
  if (!c || !isPresent(world, c)) return false;
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return false;
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return false;
  return c.standing === 'good' || c.standing === 'probation';
}

/** The players of a side who can actually take the field today. */
export function availablePlayers(world: World, t: Team): Citizen[] {
  const out: Citizen[] = [];
  for (const id of t?.players ?? []) {
    const c = world.citizens[id];
    if (canPlay(world, c)) out.push(c);
  }
  return out;
}

export function teamOf(world: World, cId: CitizenId): Team | null {
  const c = world.citizens[cId];
  if (!c || !c.teamDistrict) return null;
  const team = teamBook(world)[c.teamDistrict];
  return team && team.players.includes(cId) ? team : null;
}

/** One side per open district, and nobody on a roster who has left the city. */
export function ensureTeams(world: World): void {
  const book = teamBook(world);
  for (const d of openDistricts(world)) {
    if (!book[d]) {
      book[d] = { district: d, name: TEAM_NAMES[d] ?? `${d} XI`, players: [], wins: 0, losses: 0, draws: 0 };
    }
  }
  for (const team of Object.values(book)) {
    if (!team) continue;
    team.players = team.players.filter((id) => {
      const c = world.citizens[id];
      if (!c || !isPresent(world, c)) return false;
      if (c.teamDistrict !== team.district) return false;
      return true;
    });
  }
}

/**
 * The district a citizen plays for. Reverie sleeps in one quarter — every
 * block of homes but the Hilltop and the Tunnels stands in the Verdant
 * Quarter — so a side picked by bedroom would be one side and no league. A
 * citizen turns out for the district they spend their days in: the one they
 * work in, else the one they sleep in, else the one they are standing in.
 * Nobody chooses it, and nobody can buy their way onto a better side.
 */
export function homeDistrictOf(world: World, c: Citizen): DistrictId {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (job && job.holderId === c.id && world.districts[job.district]) return job.district;
  const home = c.homeBuildingId ? world.buildings[c.homeBuildingId] : null;
  return home?.district ?? c.district;
}

export function joinTeam(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.lifeStage === 'child') return fail('You must be grown to play for a district.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot join a team while ${c.standing}.`);
  if (!canPlay(world, c)) return fail('You cannot join a team from where you are being held.');
  const already = teamOf(world, cId);
  if (already) return fail(`You already play for ${already.name}.`);
  const district = homeDistrictOf(world, c);
  const team = teamBook(world)[district];
  if (!team) return fail(`${world.districts[district]?.name ?? district} fields no team.`);

  team.players.push(cId);
  c.teamDistrict = district;
  emit(world, 'match', `${c.name} signed for ${team.name}.`, [cId], 0.2,
    { district, team: team.name, players: team.players.length });
  remember(world, cId, 'social', `You signed for ${team.name}; they are ${team.players.length} strong.`);
  return { ok: true, message: `You play for ${team.name}.` };
}

/** The Stadium, or a ground in this citizen's own district. */
export function groundFor(world: World, c: Citizen): Building | null {
  const stadium = world.buildings[STADIUM];
  if (stadium && stadium.district === c.district && stadium.damage < 1) return stadium;
  if (c.teamDistrict !== c.district) return null;
  for (const b of Object.values(world.buildings)) {
    if (b.district !== c.district || b.damage >= 1) continue;
    if (GROUND_KINDS.includes(b.kind)) return b;
  }
  return null;
}

function trainKey(cId: CitizenId): string { return `train:${cId}`; }
function formKey(d: DistrictId): string { return `teamForm:${d}`; }

/** What this week's training is worth to a side. */
export function trainingBonus(world: World, d: DistrictId): number {
  const v = world.counters[formKey(d)] ?? 0;
  return Number.isFinite(v) ? clamp(v, 0, TRAIN_STRENGTH_CAP) : 0;
}

export function train(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const team = teamOf(world, cId);
  if (!team) return fail('You are not on a team; sign for your district first.');
  if (!canPlay(world, c)) return fail('You cannot train from where you are being held.');
  const ground = groundFor(world, c);
  if (!ground) {
    return fail(`There is nowhere to train in ${world.districts[c.district]?.name ?? c.district}; try the Stadium or your own district's ground.`);
  }
  if (world.counters[trainKey(cId)] === world.day) return fail('You have already trained today.');

  world.counters[trainKey(cId)] = world.day;
  c.skills.care = clamp((c.skills.care ?? 0) + TRAIN_SKILL, 0, 100);
  c.needs.rest = clamp(c.needs.rest - TRAIN_REST, 0, 100);
  c.needs.purpose = clamp(c.needs.purpose + TRAIN_PURPOSE, 0, 100);
  world.counters[formKey(team.district)] = clamp(trainingBonus(world, team.district) + TRAIN_STRENGTH, 0, TRAIN_STRENGTH_CAP);
  remember(world, cId, 'event', `You trained with ${team.name} at ${ground.name}.`);
  return { ok: true, message: `You trained with ${team.name} at ${ground.name} (care +${TRAIN_SKILL}).` };
}

/** The coach who works with this side, if the city has one on the books. */
function coachFor(world: World, d: DistrictId): Citizen | null {
  const stadiumDistrict = world.buildings[STADIUM]?.district ?? 'commons';
  for (const job of Object.values(world.jobs)) {
    if (job.role !== 'coach' || !job.holderId) continue;
    const c = world.citizens[job.holderId];
    if (!canPlay(world, c)) continue;
    const theirs = c.teamDistrict ?? stadiumDistrict;
    if (theirs === d) return c;
  }
  return null;
}

/**
 * What a side is worth on the day: fitness, a taste for games, how well they
 * know one another, their coach and their week's training.
 */
export function teamStrength(world: World, t: Team): number {
  if (!t) return 0;
  const players = availablePlayers(world, t);
  if (players.length === 0) return 0;
  let sum = 0;
  for (const p of players) {
    let bonds = 0;
    let n = 0;
    for (const o of players) {
      if (o.id === p.id) continue;
      bonds += bondBetween(world, p.id, o.id);
      n++;
    }
    const mates = n > 0 ? bonds / n : 0;
    const games = (p.tastes?.hobbies ?? []).includes('games') ? GAMES_HOBBY_BONUS : 0;
    sum += (p.skills?.care ?? 0) / 2 + games + mates / 10;
  }
  const coach = coachFor(world, t.district);
  const fromCoach = coach ? (coach.skills?.care ?? 0) / 10 : 0;
  const strength = sum / players.length + fromCoach + trainingBonus(world, t.district);
  return Math.round(Math.max(0, strength) * 100) / 100;
}

// ---------------------------------------------------------------------------
// The fixture list
// ---------------------------------------------------------------------------

/**
 * Which two sides a fixture is between, kept beside the happening as district
 * indices so it survives a save and a load like everything else in the World.
 */
function fixtureKey(happeningId: string, side: 'home' | 'away'): string { return `fixture:${side}:${happeningId}`; }

function setFixture(world: World, h: Happening, home: DistrictId, away: DistrictId): void {
  world.counters[fixtureKey(h.id, 'home')] = DISTRICT_IDS.indexOf(home);
  world.counters[fixtureKey(h.id, 'away')] = DISTRICT_IDS.indexOf(away);
}

/** Who this happening put on the field, or null when the record has been lost. */
export function fixtureOf(world: World, h: Happening): { home: DistrictId; away: DistrictId } | null {
  const home = DISTRICT_IDS[world.counters[fixtureKey(h.id, 'home')] ?? -1];
  const away = DISTRICT_IDS[world.counters[fixtureKey(h.id, 'away')] ?? -1];
  return home && away && home !== away ? { home, away } : null;
}

function clearFixture(world: World, h: Happening): void {
  delete world.counters[fixtureKey(h.id, 'home')];
  delete world.counters[fixtureKey(h.id, 'away')];
}

/** Sides with enough players to field a team, in map order. */
export function eligibleTeams(world: World): Team[] {
  const book = teamBook(world);
  const out: Team[] = [];
  for (const d of openDistricts(world)) {
    const team = book[d];
    if (team && availablePlayers(world, team).length >= MIN_PLAYERS) out.push(team);
  }
  return out;
}

/**
 * This week's fixture, by the circle method: one match a week, and over the
 * weeks every side meets every other. Deterministic from the day alone.
 */
export function fixtureForWeek(world: World, teams: Team[], week: number): [Team, Team] | null {
  if (teams.length < 2) return null;
  const slots: (Team | null)[] = [...teams];
  if (slots.length % 2 === 1) slots.push(null);
  const m = slots.length;
  const rounds = m - 1;
  const half = m / 2;
  const w = ((week % (rounds * half)) + rounds * half) % (rounds * half);
  const r = w % rounds;
  const pick = Math.floor(w / rounds) % half;

  const arranged: (Team | null)[] = new Array(m);
  arranged[0] = slots[0];
  for (let i = 1; i < m; i++) arranged[i] = slots[1 + ((i - 1 + r) % rounds)];

  const pairs: [Team, Team][] = [];
  for (let i = 0; i < half; i++) {
    const a = arranged[i];
    const b = arranged[m - 1 - i];
    if (a && b) pairs.push([a, b]);
  }
  if (pairs.length === 0) return null;
  const [x, y] = pairs[pick % pairs.length];
  return week % 2 === 0 ? [x, y] : [y, x];
}

/**
 * Quillday morning: put this week's match on the calendar. A week with fewer
 * than two sides who can field a team is a week without football.
 */
export function scheduleMatches(world: World): void {
  const day = world.day;
  if (((day % WEEK_LENGTH) + WEEK_LENGTH) % WEEK_LENGTH !== MATCH_WEEKDAY) return;
  const already = (world.happenings ?? []).some((h) => h.kind === 'match' && h.day === day);
  if (already) return;
  const stadium = world.buildings[STADIUM];
  if (!stadium || stadium.damage >= 1) return;

  const teams = eligibleTeams(world);
  const fixture = fixtureForWeek(world, teams, Math.floor(day / WEEK_LENGTH));
  if (!fixture) return;
  const [home, away] = fixture;
  const who = [...availablePlayers(world, home), ...availablePlayers(world, away)].map((c) => c.id);
  const h = addHappening(world, {
    kind: 'match', day, hour: MATCH_HOUR, buildingId: STADIUM, who,
    label: `${home.name} against ${away.name} at ${stadium.name}`,
  });
  setFixture(world, h, home.district, away.district);
  emit(world, 'match', `${home.name} play ${away.name} at ${stadium.name} tonight at ${MATCH_HOUR}:00.`, who, 0.4,
    { happeningId: h.id, home: home.district, away: away.district, hour: MATCH_HOUR });
  for (const id of who) remember(world, id, 'event', `You are named for tonight's match, ${home.name} against ${away.name}, at ${MATCH_HOUR}:00.`);
}

/** A seat at the gate: the takings are the city's. */
export function attendMatch(world: World, cId: CitizenId): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) return fail('You cannot get to the Stadium from the Watch House.');
  if (c.jailedUntilDay !== null && c.jailedUntilDay !== undefined && c.jailedUntilDay > world.day) return fail('You cannot get to the Stadium from the cells.');
  const here = happeningsAt(world, c.district).filter((h) => h.kind === 'match');
  if (here.length === 0) {
    const later = (world.happenings ?? []).find((h) => !h.done && h.kind === 'match' && h.day === world.day);
    return fail(later
      ? `There is no match here this hour; ${later.label} starts at ${later.hour}:00.`
      : 'There is no match today.');
  }
  const match = here[0];
  if (match.attendees.includes(cId)) return fail('You are already in the ground.');
  if (c.wallet < MATCH_TICKET) return fail(`A seat costs ${MATCH_TICKET} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, cId, 'treasury', MATCH_TICKET, 'ticket', 'a seat at the Stadium')) return fail('The ticket could not be paid for.');

  match.attendees.push(cId);
  c.needs.social = clamp(c.needs.social + ATTEND_SOCIAL, 0, 100);
  remember(world, cId, 'social', `You paid ${MATCH_TICKET} ℓ for a seat at ${match.label}.`);
  return { ok: true, message: `You are in the ground for ${match.label} (social +${ATTEND_SOCIAL}).` };
}

// ---------------------------------------------------------------------------
// The match
// ---------------------------------------------------------------------------

function goalsFor(world: World, strength: number): number {
  const mean = Math.max(0.05, strength / STRENGTH_PER_GOAL + rand(world) * 0.5);
  return poisson(world, mean);
}

/** Ninety minutes, at the end of the hour it was called for. */
export function playMatch(world: World, h: Happening): void {
  const fixture = fixtureOf(world, h);
  if (!fixture) return;
  const book = teamBook(world);
  const home = book[fixture.home];
  const away = book[fixture.away];
  clearFixture(world, h);
  if (!home || !away) return;

  const homePlayers = availablePlayers(world, home);
  const awayPlayers = availablePlayers(world, away);
  if (homePlayers.length === 0 || awayPlayers.length === 0) {
    emit(world, 'match', `${home.name} against ${away.name} was called off: one of the sides could not put a team out.`, [], 0.3,
      { home: home.district, away: away.district, abandoned: true });
    world.counters[formKey(home.district)] = 0;
    world.counters[formKey(away.district)] = 0;
    return;
  }

  const homeGoals = goalsFor(world, teamStrength(world, home));
  const awayGoals = goalsFor(world, teamStrength(world, away));
  const attendees = (h.attendees ?? []).filter((id) => !!world.citizens[id]);
  const record: Match = {
    day: world.day, home: home.district, away: away.district, homeGoals, awayGoals, attendance: attendees.length,
  };
  if (!Array.isArray(world.matches)) world.matches = [];
  world.matches.push(record);
  if (world.matches.length > MAX_MATCHES) world.matches.splice(0, world.matches.length - MAX_MATCHES);

  if (homeGoals > awayGoals) { home.wins++; away.losses++; }
  else if (awayGoals > homeGoals) { away.wins++; home.losses++; }
  else { home.draws++; away.draws++; }

  for (const side of [homePlayers, awayPlayers]) {
    for (const [i, p] of side.entries()) {
      p.needs.purpose = clamp(p.needs.purpose + MATCH_PURPOSE, 0, 100);
      p.needs.rest = clamp(p.needs.rest - TRAIN_REST, 0, 100);
      for (let j = i + 1; j < side.length; j++) adjustBond(world, p.id, side[j].id, MATCH_BOND);
    }
  }
  for (const id of attendees) {
    const fan = world.citizens[id];
    if (fan) fan.needs.social = clamp(fan.needs.social + CROWD_SOCIAL, 0, 100);
  }
  world.counters[formKey(home.district)] = 0;
  world.counters[formKey(away.district)] = 0;

  const result = homeGoals === awayGoals
    ? `${home.name} ${homeGoals}, ${away.name} ${awayGoals} — honours even`
    : `${homeGoals > awayGoals ? home.name : away.name} beat ${homeGoals > awayGoals ? away.name : home.name} ${Math.max(homeGoals, awayGoals)}–${Math.min(homeGoals, awayGoals)}`;
  emit(world, 'match', `${result}, before ${attendees.length === 1 ? 'a crowd of one' : `${attendees.length} in the ground`}.`,
    [...homePlayers, ...awayPlayers].map((c) => c.id), 0.6,
    { home: home.district, away: away.district, homeGoals, awayGoals, attendance: attendees.length });
  for (const p of [...homePlayers, ...awayPlayers]) remember(world, p.id, 'event', `You played: ${result}.`);
}

// ---------------------------------------------------------------------------
// The table
// ---------------------------------------------------------------------------

function sinceKey(): string { return 'league:since'; }

/** The day the current table started. */
export function leagueSince(world: World): number {
  const v = world.counters[sinceKey()];
  return Number.isFinite(v) ? (v as number) : 0;
}

function goalDifference(world: World, d: DistrictId): number {
  const since = leagueSince(world);
  let gd = 0;
  for (const m of world.matches ?? []) {
    if (m.day < since) continue;
    if (m.home === d) gd += m.homeGoals - m.awayGoals;
    else if (m.away === d) gd += m.awayGoals - m.homeGoals;
  }
  return gd;
}

/** Three for a win, one for a draw; ties by goal difference, then by district. */
export function leagueTable(world: World): { district: DistrictId; name: string; played: number; points: number }[] {
  const book = teamBook(world);
  const rows: { district: DistrictId; name: string; played: number; points: number; gd: number }[] = [];
  for (const d of openDistricts(world)) {
    const t = book[d];
    if (!t) continue;
    rows.push({
      district: d, name: t.name,
      played: (t.wins ?? 0) + (t.losses ?? 0) + (t.draws ?? 0),
      points: (t.wins ?? 0) * POINTS_WIN + (t.draws ?? 0) * POINTS_DRAW,
      gd: goalDifference(world, d),
    });
  }
  rows.sort((a, b) => b.points - a.points || b.gd - a.gd || a.district.localeCompare(b.district));
  return rows.map(({ district, name, played, points }) => ({ district, name, played, points }));
}

/** The day the next Founders' Day falls on. */
function nextFoundersDay(world: World): number {
  const electionDay = world.government?.election?.electionDay ?? world.day;
  const day = electionDay + 1;
  return day > world.day ? day : world.day + 1;
}

/**
 * The end of a cycle: the side at the top of the table shares the purse, each
 * of them takes a milestone, and the city puts a parade on the calendar for
 * the next Founders' Day. Then the table goes back to nothing.
 */
export function crownChampions(world: World): void {
  const table = leagueTable(world);
  const top = table.find((r) => r.played > 0) ?? null;
  const book = teamBook(world);
  if (top && table[0] && table[0].district === top.district) {
    const team = book[top.district];
    const players = team ? availablePlayers(world, team) : [];
    let paid = 0;
    const share = players.length > 0 ? Math.floor(CHAMPION_PRIZE / players.length) : 0;
    for (const p of players) {
      if (share > 0 && transfer(world, 'treasury', p.id, share, 'prize', `champions' purse for ${team?.name ?? 'the champions'}`)) paid += share;
      adjustReputation(world, p, CHAMPION_REPUTATION, 'a championship');
      recordMilestone(world, p, `${p.name} was a champion of Reverie with ${team?.name ?? 'their district'}.`, 0.7);
    }
    const parade = addHappening(world, {
      kind: 'parade', day: nextFoundersDay(world), hour: PARADE_HOUR, buildingId: PARADE_VENUE,
      who: players.map((p) => p.id),
      label: `the champions' parade for ${team?.name ?? 'the champions'}`,
    });
    emit(world, 'match',
      `${team?.name ?? top.name} took the league with ${top.points} ${top.points === 1 ? 'point' : 'points'} from ${top.played} ${top.played === 1 ? 'match' : 'matches'}${paid > 0 ? `, and shared ${paid} ℓ` : ''}. They parade on Founders' Day.`,
      players.map((p) => p.id), 0.9,
      { district: top.district, points: top.points, played: top.played, prize: paid, happeningId: parade.id });
  }
  for (const t of Object.values(book)) {
    if (!t) continue;
    t.wins = 0; t.losses = 0; t.draws = 0;
  }
  world.counters[sinceKey()] = world.day;
}

/** The champions' hour in the Plaza, held from `society/calendar.ts`. */
export function holdParade(world: World, h: Happening): void {
  const champions = (h.who ?? []).map((id) => world.citizens[id]).filter((c): c is Citizen => !!c && isPresent(world, c));
  const crowd: CitizenId[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || c.district !== h.district || !isPresent(world, c)) continue;
    if (c.detainedUntilTick !== null && c.detainedUntilTick > world.tick) continue;
    c.needs.social = clamp(c.needs.social + PARADE_SOCIAL, 0, 100);
    crowd.push(id);
  }
  for (const c of champions) adjustReputation(world, c, 1, 'the champions’ parade');
  emit(world, 'match', `The champions paraded in ${world.districts[h.district]?.name ?? h.district} before ${crowd.length} ${crowd.length === 1 ? 'citizen' : 'citizens'}.`,
    champions.map((c) => c.id), 0.7, { happeningId: h.id, crowd: crowd.length });
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/** Morning: sides, the end of a cycle, and this week's fixture. */
export function dailyStadium(world: World): void {
  ensureTeams(world);
  if (world.counters[sinceKey()] === undefined) world.counters[sinceKey()] = world.day;
  const cycle = Math.max(1, world.config?.cycleDays ?? 28);
  if (world.day - leagueSince(world) >= cycle) crownChampions(world);
  scheduleMatches(world);
}

/** Mirrors `ObservedTeam` in `src/types.ts` (lane C): what anybody may read of a side. */
export interface ObservedTeam {
  district: DistrictId; name: string; wins: number; losses: number; draws: number; players: number;
}

/** What a citizen can read about their side. */
export function teamObservation(world: World, t: Team | null): ObservedTeam | null {
  if (!t) return null;
  return { district: t.district, name: t.name, wins: t.wins, losses: t.losses, draws: t.draws, players: t.players.length };
}

/** The league as the city reads it, in table order. */
export function leagueObservation(world: World): ObservedTeam[] {
  const book = teamBook(world);
  const out: ObservedTeam[] = [];
  for (const row of leagueTable(world)) {
    const seen = teamObservation(world, book[row.district] ?? null);
    if (seen) out.push(seen);
  }
  return out;
}

/**
 * The seven days of the Games, and what they leave behind (`docs/POLITICS.md` §8).
 *
 * Seven disciplines, one settled each day, each scored on a skill the engine
 * already keeps: the sprint (care), the forge trial (crafting), the analysis
 * prize, the oration (rhetoric), the artistry prize, the market game (commerce),
 * and the team match between district champions, resolved by the same
 * arithmetic as an ordinary fixture.
 *
 * ```
 * for the seven days and the cycle after:
 *   prestige, the stadium's district   +0.40, decaying 3 %/day to baseline
 *   footfall, host city                ×1.6 during the Games
 *   treasury                           purse and works out; entries and tickets in
 *   standing with every member city    +5 for a Games held, −15 for a truce broken
 * ```
 *
 * Land value is normalised to the city's own average, so a lift given to every
 * district at once cancels: hosting **redistributes** land value inside the host
 * rather than raising it. A medal is worth 20 on the contribution column,
 * permanent, plus a parade on the champions' return and a line in the Hall of
 * Records that outlives them.
 */
import type { Citizen, CitizenId, DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { adjustReputation, isPresent } from '../citizens/citizen.ts';
import { normal } from '../util/rng.ts';
import { transfer } from '../economy/treasury.ts';
import { recordMilestone } from '../identity/goals.ts';
import { addHappening } from '../society/calendar.ts';
import { availablePlayers, leagueTable, teamStrength } from '../culture/stadium.ts';
import type { Discipline } from './games.ts';
import {
  CYCLES_PER_YEAR, DISCIPLINES, DISCIPLINE_SKILL, GAMES_DAYS, HOST_FOOTFALL, HOST_PRESTIGE, MEDAL_REPUTATION,
  PRESTIGE_DECAY, STADIUM_BASE_CAPACITY, STANDING_FOR_GAMES, awardGames, entrants, games, gamesRunning, hosting,
  stadiumIsBigEnough, yearOf,
} from './games.ts';

// ---------------------------------------------------------------------------
// The seven days
// ---------------------------------------------------------------------------

function medalFor(world: World, c: Citizen, discipline: Discipline, purseShare: number): void {
  const g = games(world);
  g.medals.push({ citizenId: c.id, discipline, year: g.year, day: world.day });
  adjustReputation(world, c, MEDAL_REPUTATION, `a medal in the ${discipline}`);
  recordMilestone(world, c, `${c.name} took a medal in the ${discipline} at the Games of year ${g.year}.`, 0.8);
  if (purseShare > 0) transfer(world, 'treasury', c.id, purseShare, 'prize', `a medal in the ${discipline}`);
  remember(world, c.id, 'event', `You took a medal in the ${discipline} at the Games.`);
}

/** What one day of the Games settles. */
export function holdDiscipline(world: World, discipline: Discipline): void {
  const g = games(world);
  const purse = g.bids.find((b) => b.city === g.host)?.purse ?? 0;
  const share = Math.max(0, Math.floor(purse / Math.max(1, DISCIPLINES.length)));
  if (discipline === 'team') {
    holdTeamMatch(world, share);
    return;
  }
  const field = entrants(world, discipline);
  if (field.length === 0) {
    emit(world, 'match', `The ${discipline} was not contested: nobody entered.`, [], 0.3, { discipline });
    return;
  }
  const skill = DISCIPLINE_SKILL[discipline];
  const scored = field.map((c) => ({ c, score: (c.skills[skill] ?? 0) + normal(world) * 5 }))
    .sort((a, b) => b.score - a.score || a.c.id.localeCompare(b.c.id));
  const winner = scored[0].c;
  medalFor(world, winner, discipline, share);
  emit(world, 'match', `The ${discipline}: ${winner.name} took it from ${field.length - 1} other`
    + `${field.length === 2 ? '' : 's'}${share > 0 ? `, and ${share} ℓ of the purse` : ''}.`,
  scored.map((s) => s.c.id), 0.8, { discipline, winner: winner.id, field: field.length });
}

/** The team match, resolved by the same arithmetic as an ordinary fixture. */
function holdTeamMatch(world: World, share: number): void {
  const table = leagueTable(world);
  const book = world.teams ?? {};
  const sides = table.map((row) => book[row.district]).filter((t): t is NonNullable<typeof t> => Boolean(t));
  if (sides.length < 2) {
    emit(world, 'match', 'The team match was not contested: the city could not put two sides out.', [], 0.3, {});
    return;
  }
  const [home, away] = sides;
  const homeScore = teamStrength(world, home) + normal(world) * 2;
  const awayScore = teamStrength(world, away) + normal(world) * 2;
  const winner = homeScore >= awayScore ? home : away;
  const players = availablePlayers(world, winner);
  const each = players.length > 0 ? Math.floor(share / players.length) : 0;
  for (const p of players) medalFor(world, p, 'team', each);
  emit(world, 'match', `The team match: ${winner.name} took it from ${(winner === home ? away : home).name}`
    + `${players.length > 0 ? `, and ${players.length} medal${players.length === 1 ? '' : 's'}` : ''}.`,
  players.map((p) => p.id), 0.8, { discipline: 'team', winner: winner.district });
}

// ---------------------------------------------------------------------------
// What hosting does
// ---------------------------------------------------------------------------

/**
 * The lift the stadium's district carries: +0.40 for the seven days and the
 * cycle after, decaying 3 % a day. Read by the land layer; hosting
 * redistributes land value inside the host rather than raising it, because the
 * reading is normalised to the city's own average.
 */
export function gamesPrestigeBonus(world: World, d: DistrictId): number {
  const g = games(world);
  if (!hosting(world) || g.opensDay === null || g.stadiumDistrict !== d) return 0;
  const since = world.day - g.opensDay;
  if (since < 0) return 0;
  const cycle = world.config?.cycleDays ?? 28;
  if (since > GAMES_DAYS + cycle) return 0;
  const decayed = HOST_PRESTIGE * Math.pow(1 - PRESTIGE_DECAY, Math.max(0, since - GAMES_DAYS));
  return Math.round(decayed * 1000) / 1000;
}

/** What the crowds do to the host's footfall while the Games are on. */
export function gamesFootfallMultiplier(world: World): number {
  return hosting(world) && gamesRunning(world) ? HOST_FOOTFALL : 1;
}

// ---------------------------------------------------------------------------
// The daily pass
// ---------------------------------------------------------------------------

/**
 * Morning: the Congress awards the year ahead, the Games open and close, one
 * discipline is settled each day, and the medallists parade on their return.
 */
export function dailyGames(world: World): void {
  const g = games(world);
  const cycle = Math.max(1, world.config?.cycleDays ?? 28);
  const year = yearOf(world);

  // The Congress sits a year ahead, at the turn of the year.
  if (world.day > 0 && world.day % (cycle * CYCLES_PER_YEAR) === 0) awardGames(world);
  if (g.host === null || g.opensDay === null || g.closesDay === null) return;

  if (world.day === g.opensDay) {
    const built = stadiumIsBigEnough(world);
    emit(world, 'match', built
      ? `The Games of year ${g.year} opened in ${g.host}: ${g.entries.length} entries, a stadium for ${g.capacity},`
        + `${g.truce ? ' and a truce of seven days.' : ' and no truce at all.'}`
      : `The Games of year ${g.year} opened in ${g.host} in a ground too small for them: the stand holds ${STADIUM_BASE_CAPACITY}`
        + ` and the Games want ${g.capacity}. The works were bid at ${g.works} ℓ.`,
    [], 1.0, { year: g.year, host: g.host, entries: g.entries.length, capacity: g.capacity, truce: g.truce });
    for (const id of world.order) {
      const c = world.citizens[id];
      if (c && isPresent(world, c)) remember(world, id, 'event', `The Games opened in ${g.host}.`);
    }
  }

  // Seven days, seven disciplines, one settled each day.
  if (world.day >= g.opensDay && world.day <= g.closesDay) {
    const index = world.day - g.opensDay;
    if (index >= 0 && index < DISCIPLINES.length) holdDiscipline(world, DISCIPLINES[index]);
    if (world.day === g.closesDay) closeGames(world);
    return;
  }

  if (world.day === g.closesDay + 1 && g.year === year) g.truce = false;
}

function closeGames(world: World): void {
  const g = games(world);
  const medallists = [...new Set(g.medals.filter((m) => m.year === g.year).map((m) => m.citizenId))]
    .filter((id) => {
      const c = world.citizens[id];
      return Boolean(c && isPresent(world, c));
    });
  if (!g.truceBroken) g.standing += STANDING_FOR_GAMES;
  const parade = medallists.length > 0
    ? addHappening(world, {
      kind: 'parade', day: world.day + 1, hour: 13, buildingId: 'central_plaza', who: medallists,
      label: `the parade for Reverie's medallists at the Games of year ${g.year}`,
    })
    : null;
  emit(world, 'match', `The Games of year ${g.year} closed in ${g.host}: ${medallists.length} medallist`
    + `${medallists.length === 1 ? '' : 's'}${parade ? ', and a parade tomorrow' : ''}.`
    + `${g.truceBroken ? ' The truce was broken, and every member city keeps the record.' : ''}`,
  medallists, 1.0, { year: g.year, medallists: medallists.length, standing: g.standing, happeningId: parade?.id ?? null });
  for (const id of medallists) remember(world, id, 'event', 'You came home from the Games with a medal.');
}

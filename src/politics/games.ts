/**
 * The Expanse Games (`docs/POLITICS.md` §8).
 *
 * Every four cycles — one year — the district league goes international, and
 * for seven days the Expanse is all watching one thing. The host is chosen by
 * the Congress from the cities that bid; a host needs a stadium of capacity
 * `30 + 6 × competing cities`, funded out of its own Treasury as public works;
 * athletes on a district team enter, travel like anyone else, and are scored on
 * skills the engine already keeps; and the Congress declares a truce that is a
 * term of the treaty rather than a rule of the engine.
 *
 * **No Congress, no Games.** They are the federation's one visible dividend,
 * and the year a federation breaks is a year without them. Until the Expanse
 * layer seats a Congress of real cities, the federation Reverie belongs to has
 * one member — itself — and the Chronicle says so when it awards the Games to
 * the only city that bid.
 *
 * Hosting **redistributes** land value inside the host rather than raising it:
 * land value is normalised to the city's own average, so a lift given to every
 * district at once cancels. The stadium's district gains and every other
 * district pays for it in relative rent, which is why *where the stadium goes*
 * is the most valuable proposal on the order paper.
 */
import type { ActionResult, Citizen, CitizenId, DistrictId, Skill, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { isPresent } from '../citizens/citizen.ts';
import { transfer } from '../economy/treasury.ts';
import { STADIUM } from '../culture/stadium.ts';
import { reputeOf } from '../standing/repute.ts';
import type { Measure, MeasureHooks, MeasureSpec } from './measures.ts';
import { tableMeasure } from './measures.ts';

/** The seven disciplines, each scored on a skill the engine already keeps. */
export type Discipline = 'sprint' | 'forge' | 'analysis' | 'oration' | 'artistry' | 'market' | 'team';

export const DISCIPLINES: readonly Discipline[] = ['sprint', 'forge', 'analysis', 'oration', 'artistry', 'market', 'team'];

export const DISCIPLINE_SKILL: Record<Exclude<Discipline, 'team'>, Skill> = {
  sprint: 'care', forge: 'crafting', analysis: 'analysis', oration: 'rhetoric', artistry: 'artistry', market: 'commerce',
};

/** Cycles in a year: the Games come round once. */
export const CYCLES_PER_YEAR = 4;
/** How long the Games run. */
export const GAMES_DAYS = 7;
/** A stadium holds this many, and six more for every city competing. */
export const STADIUM_BASE_CAPACITY = 30;
export const CAPACITY_PER_CITY = 6;
/** What a seat past the stand the city already has costs to build. */
export const WORKS_PER_SEAT = 20;
/** What an entry costs, and what a medal is worth on the contribution column. */
export const ENTRY_FEE = 10;
export const MEDAL_CONTRIBUTION = 20;
export const MEDAL_REPUTATION = 3;
/** The repute a competitor needs, unless the host waives it. */
export const REPUTE_LINE = 400;
/** What hosting does to the stadium's district, and how fast it fades. */
export const HOST_PRESTIGE = 0.40;
export const PRESTIGE_DECAY = 0.03;
export const HOST_FOOTFALL = 1.6;
/** What a Games held, and a truce broken, are worth with every member city. */
export const STANDING_FOR_GAMES = 5;
export const STANDING_FOR_BREAKING_TRUCE = -15;

export interface GamesBid { city: string; purse: number; works: number; byId: CitizenId | null; day: number }
export interface GamesEntry { citizenId: CitizenId; discipline: Discipline; day: number }
export interface Medal { citizenId: CitizenId; discipline: Discipline; year: number; day: number }

export interface Games {
  year: number;
  host: string | null;
  opensDay: number | null;
  closesDay: number | null;
  truce: boolean;
  truceBroken: boolean;
  /** The repute line the host set for competitors, or null where none was set. */
  waiver: number | null;
  bids: GamesBid[];
  votes: Record<CitizenId, string>;
  entries: GamesEntry[];
  medals: Medal[];
  works: number;
  capacity: number;
  /** The district the stadium stands in when the Games were awarded. */
  stadiumDistrict: DistrictId | null;
  /** Standing with every member city, as the treaty keeps it. */
  standing: number;
}

function fail(message: string): ActionResult { return { ok: false, message }; }

export function games(world: World): Games {
  const w = world as World & { games?: Games };
  if (!w.games) {
    w.games = {
      year: yearOf(world), host: null, opensDay: null, closesDay: null, truce: false, truceBroken: false,
      waiver: null, bids: [], votes: {}, entries: [], medals: [], works: 0, capacity: 0,
      stadiumDistrict: null, standing: 0,
    };
  }
  const g = w.games;
  if (!Array.isArray(g.bids)) g.bids = [];
  if (!Array.isArray(g.entries)) g.entries = [];
  if (!Array.isArray(g.medals)) g.medals = [];
  if (!g.votes) g.votes = {};
  return g;
}

/** Which year of the federation this is: four cycles to a year. */
export function yearOf(world: World): number {
  const cycle = Math.max(1, world.config?.cycleDays ?? 28);
  return Math.floor(world.day / (cycle * CYCLES_PER_YEAR));
}

/** The day this year's Games would open: the last week of the year. */
export function opensDayFor(world: World, year: number): number {
  const cycle = Math.max(1, world.config?.cycleDays ?? 28);
  return (year + 1) * cycle * CYCLES_PER_YEAR - GAMES_DAYS;
}

/**
 * The federation's member cities. The Expanse layer fills this in; until it
 * does, the federation has one member and everybody knows it.
 */
export function memberCities(world: World): string[] {
  const known = (world as World & { cities?: Record<string, unknown> }).cities;
  const names = known ? Object.keys(known) : [];
  return names.length > 0 ? names : ['Reverie'];
}

/** Who speaks for this city at the Congress: the Mayor and the Council. */
export function delegation(world: World): CitizenId[] {
  const g = world.government;
  const ids = new Set<CitizenId>(g.council);
  if (g.mayorId) ids.add(g.mayorId);
  return [...ids].filter((id) => {
    const c = world.citizens[id];
    return Boolean(c && isPresent(world, c));
  });
}

/** Are the Games on today? */
export function gamesRunning(world: World): boolean {
  const g = games(world);
  return g.host !== null && g.opensDay !== null && g.closesDay !== null
    && world.day >= g.opensDay && world.day <= g.closesDay;
}

/** Is Reverie the host this year? */
export function hosting(world: World): boolean {
  return games(world).host === 'Reverie';
}

// ---------------------------------------------------------------------------
// The bid, and the vote
// ---------------------------------------------------------------------------

/** The `games_bid` measure: what the city will pay, and what it will build. */
export const gamesBidHooks: MeasureHooks = {
  problem(world: World, spec: MeasureSpec): string | null {
    const g = games(world);
    if (g.host !== null && g.opensDay !== null && world.day <= g.opensDay) return 'The Games are already awarded for this year.';
    if (!Number.isFinite(spec.value) || (spec.value as number) < 0) return 'A bid names the purse the city will pay.';
    return null;
  },
  enact(world: World, m: Measure): string {
    const g = games(world);
    const purse = Math.max(0, Math.round(m.value));
    const works = Math.max(0, Math.round(Number(m.subject ?? 0)));
    g.bids = g.bids.filter((b) => b.city !== 'Reverie');
    g.bids.push({ city: 'Reverie', purse, works, byId: m.proposerId, day: world.day });
    emit(world, 'match', `Reverie bids for the Games: a purse of ${purse} ℓ and ${works} ℓ of works.`, [m.proposerId], 0.7,
      { purse, works, city: 'Reverie' });
    return `The bid is entered with the Congress: ${purse} ℓ and ${works} ℓ of works.`;
  },
  disposition(world: World, cId: CitizenId, m: Measure): boolean | null {
    // A councillor reads a bid against the Treasury it comes out of: a city
    // that cannot pay for the stadium is bidding with money it does not have.
    const cost = Math.max(0, Math.round(m.value)) + Math.max(0, Math.round(Number(m.subject ?? 0)));
    void cId;
    if (cost === 0) return null;
    return world.treasury.balance > cost * 3;
  },
};

/**
 * `bid_games { purse, works }` — a councillor puts the city's bid to the
 * Council, which decides whether the city can afford to want this.
 */
export function bidGames(world: World, cId: CitizenId, purse: number, works: number): ActionResult {
  return tableMeasure(world, cId, {
    kind: 'games_bid', value: Math.max(0, Math.round(purse)), subject: String(Math.max(0, Math.round(works))),
    words: `Bid for the Games: a purse of ${Math.max(0, Math.round(purse))} ℓ and ${Math.max(0, Math.round(works))} ℓ of works.`,
  }, gamesBidHooks);
}

/** `games_waiver` — the repute line for competitors, or none at all. */
export function waiveGamesRepute(world: World, cId: CitizenId, line: number): ActionResult {
  const value = Math.max(0, Math.round(line));
  return tableMeasure(world, cId, {
    kind: 'games_waiver', value,
    words: value > 0 ? `Competitors need ${value} repute.` : 'Waive the repute line for competitors.',
  }, gamesWaiverHooks);
}

/** `games_truce` — declare the seven days, or end them. */
export function declareTruce(world: World, cId: CitizenId, on: boolean): ActionResult {
  return tableMeasure(world, cId, {
    kind: 'games_truce', value: on ? 1 : 0,
    words: on ? 'The truce of the Games stands.' : 'Break the truce of the Games.',
  }, gamesTruceHooks);
}

/** A Congress delegate's vote for a host city. */
export function voteGamesHost(world: World, cId: CitizenId, city: string): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  if (!delegation(world).includes(cId)) return fail('Only a delegate to the Congress votes on the host.');
  const g = games(world);
  if (g.bids.length === 0) return fail('No city has bid for the Games.');
  if (!g.bids.some((b) => b.city === city)) return fail(`${city} has not bid for the Games.`);
  g.votes[cId] = city;
  emit(world, 'match', `${c.name} voted for ${city} to host the Games.`, [cId], 0.4, { city });
  remember(world, cId, 'civic', `You voted for ${city} to host the Games.`);
  return { ok: true, message: `You voted for ${city}.` };
}

/**
 * The Congress awards the Games: a majority of member cities takes it. With no
 * Congress there are no Games at all; with one member city, the award is that
 * city's own delegation deciding, and the Chronicle prints how small the
 * federation has become.
 */
export function awardGames(world: World): void {
  const g = games(world);
  const year = yearOf(world) + 1;
  if (g.bids.length === 0) return;
  const members = memberCities(world);
  const counts = new Map<string, number>();
  for (const city of Object.values(g.votes)) counts.set(city, (counts.get(city) ?? 0) + 1);
  const delegates = delegation(world).length;
  let host: string | null = null;
  if (counts.size > 0) {
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
    if (ranked[0][1] * 2 > delegates || members.length === 1) host = ranked[0][0];
  }
  if (!host && g.bids.length === 1) host = g.bids[0].city;
  if (!host) return;
  const bid = g.bids.find((b) => b.city === host);
  g.host = host;
  g.year = year;
  g.opensDay = opensDayFor(world, year);
  g.closesDay = g.opensDay + GAMES_DAYS - 1;
  g.truce = true;
  g.truceBroken = false;
  g.works = bid?.works ?? 0;
  g.capacity = STADIUM_BASE_CAPACITY + CAPACITY_PER_CITY * members.length;
  g.stadiumDistrict = world.buildings[STADIUM]?.district ?? null;
  g.votes = {};
  g.entries = [];
  if (host === 'Reverie' && g.works > 0) {
    const committed = Math.min(g.works, Math.max(0, Math.round(world.treasury.balance)));
    world.government.publicWorksFund += committed;
    g.works = committed;
  }
  emit(world, 'match', `The Congress awarded the Games of year ${year} to ${host}`
    + `${members.length === 1 ? ' — the only member city that bid' : ''}.`
    + ` They open on day ${g.opensDay}; the stadium must hold ${g.capacity}.`, [], 1.0,
  { host, year, opensDay: g.opensDay, capacity: g.capacity, works: g.works, members: members.length });
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && isPresent(world, c)) remember(world, id, 'civic', `The Games of year ${year} go to ${host}, opening day ${g.opensDay}.`);
  }
}

/** The `games_waiver` measure: the repute line for competitors, or none at all. */
export const gamesWaiverHooks: MeasureHooks = {
  enact(world: World, m: Measure): string {
    const g = games(world);
    g.waiver = Math.max(0, Math.round(m.value));
    return g.waiver > 0
      ? `Competitors need ${g.waiver} repute to enter, and no more.`
      : 'The repute line is waived for competitors: anybody may enter, exiles included.';
  },
  /**
   * A waiver is a question about who the city lets in, and a councillor reads
   * it off the field: it is worth a vote to somebody whose own people are kept
   * out by the line, and nothing at all to somebody with nobody in it.
   */
  disposition(world: World, cId: CitizenId, m: Measure): boolean | null {
    const c = world.citizens[cId];
    if (!c) return null;
    const line = Math.max(0, Math.round(m.value));
    const shutOut = Object.values(world.citizens).some((other) => other.teamDistrict !== null
      && isPresent(world, other) && reputeOf(world, other.id) < REPUTE_LINE && reputeOf(world, other.id) >= line);
    return shutOut ? true : null;
  },
};

/** The `games_truce` measure: seven days of it, or the end of it. */
export const gamesTruceHooks: MeasureHooks = {
  enact(world: World, m: Measure): string {
    const g = games(world);
    const on = m.value > 0;
    if (!on && g.truce) {
      g.truce = false;
      g.truceBroken = true;
      g.standing += STANDING_FOR_BREAKING_TRUCE;
      emit(world, 'match', 'Reverie broke the truce of the Games. Every member city keeps the record.', [], 1.0,
        { truce: false, standing: g.standing });
      return `The truce is broken; it costs ${Math.abs(STANDING_FOR_BREAKING_TRUCE)} standing with every member city.`;
    }
    g.truce = on;
    return on ? 'The truce stands for the seven days.' : 'There is no truce.';
  },
};

// ---------------------------------------------------------------------------
// Entering
// ---------------------------------------------------------------------------

/**
 * The repute a competitor needs today: the city's ordinary line, or whatever
 * the host waived it to. A waiver of nothing is precisely how an exile walks
 * back into the city that sent them away, and every host argues about it.
 */
export function reputeLine(world: World): number {
  const g = games(world);
  return g.waiver === null ? REPUTE_LINE : Math.max(0, g.waiver);
}

/** An athlete on a district team enters a discipline. */
export function enterGames(world: World, cId: CitizenId, discipline: Discipline): ActionResult {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return fail('Unknown or absent citizen.');
  const g = games(world);
  if (!g.host || g.opensDay === null) return fail('There are no Games to enter.');
  if (world.day > g.opensDay) return fail('The Games have opened; entries are closed.');
  if (!DISCIPLINES.includes(discipline)) return fail(`The disciplines are ${DISCIPLINES.join(', ')}.`);
  if (c.lifeStage === 'child') return fail('You must be grown to compete.');
  if (!c.teamDistrict) return fail('Athletes come from a district team; sign for your district first.');
  if (g.entries.some((e) => e.citizenId === cId && e.discipline === discipline)) return fail('You have already entered that discipline.');
  const line = reputeLine(world);
  if (line > 0 && reputeOf(world, cId) < line) {
    return fail(`Competitors need ${line} repute; the host may waive it, and has not.`);
  }
  if (c.wallet < ENTRY_FEE) return fail(`An entry costs ${ENTRY_FEE} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, cId, 'treasury', ENTRY_FEE, 'fee', `an entry in the ${discipline}`)) {
    return fail('The entry fee could not be paid.');
  }
  g.entries.push({ citizenId: cId, discipline, day: world.day });
  emit(world, 'match', `${c.name} entered the ${discipline} at the Games.`, [cId], 0.4, { discipline, entrant: cId });
  remember(world, cId, 'event', `You entered the ${discipline} at the Games of year ${g.year}.`);
  return { ok: true, message: `You are entered in the ${discipline}.` };
}

/** Everybody entered in a discipline who can still take the field. */
export function entrants(world: World, discipline: Discipline): Citizen[] {
  return games(world).entries
    .filter((e) => e.discipline === discipline)
    .map((e) => world.citizens[e.citizenId])
    .filter((c): c is Citizen => Boolean(c) && isPresent(world, c as Citizen));
}
/** How many medals a citizen has, ever. */
export function medalsOf(world: World, cId: CitizenId): number {
  return games(world).medals.filter((m) => m.citizenId === cId).length;
}

/**
 * What a citizen's medals are worth on the contribution column
 * (`docs/CITIZENSHIP.md` §1): 20 each, permanent, like every entry there. The
 * standing layer reads this; nothing here writes to the ledger.
 */
export function medalContribution(world: World, cId: CitizenId): number {
  return medalsOf(world, cId) * MEDAL_CONTRIBUTION;
}

// ---------------------------------------------------------------------------
// What a citizen reads
// ---------------------------------------------------------------------------

export interface ObservedGames {
  year: number;
  host: string | null;
  opensDay: number | null;
  running: boolean;
  truce: boolean;
  reputeLine: number;
  disciplines: readonly Discipline[];
  yourEntries: Discipline[];
  yourMedals: number;
  capacity: number;
}

export function gamesObservation(world: World, c: Citizen | null): ObservedGames | null {
  const g = games(world);
  if (g.host === null) return null;
  return {
    year: g.year,
    host: g.host,
    opensDay: g.opensDay,
    running: gamesRunning(world),
    truce: g.truce,
    reputeLine: reputeLine(world),
    disciplines: DISCIPLINES,
    yourEntries: c ? g.entries.filter((e) => e.citizenId === c.id).map((e) => e.discipline) : [],
    yourMedals: c ? medalsOf(world, c.id) : 0,
    capacity: g.capacity,
  };
}

/**
 * Whether the stand will hold the Games the city took. Thirty is what Reverie
 * already has; every city competing needs six seats more, and those seats are
 * the works the host bid for out of its own Treasury. A city that bid the
 * purse and not the works holds the Games in a ground too small, and the
 * Chronicle says so on the morning they open.
 */
export function stadiumIsBigEnough(world: World): boolean {
  const g = games(world);
  const stadium = world.buildings[STADIUM];
  if (!stadium || stadium.damage >= 1) return false;
  const extra = Math.max(0, g.capacity - STADIUM_BASE_CAPACITY);
  return g.works >= extra * WORKS_PER_SEAT;
}

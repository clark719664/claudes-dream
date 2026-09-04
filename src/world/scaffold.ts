/**
 * Builds an empty World: geography, market, housing, treasury and government
 * scaffolding, but no citizens. world.ts populates it; tests use it directly.
 */
import { DEFAULT_CONFIG, FOUNDING_DISTRICT_IDS, GOODS } from '../types.ts';
import type {
  DistrictId, Good, Housing, Market, MarketGood, OuterMarket, Team, Treasury, World, WorldConfig, Government,
} from '../types.ts';
import { BUILDINGS, DISTRICTS } from '../data/city.ts';
import { defaultSeverities } from '../data/laws.ts';
import { JAIL_CELLS, TEAM_NAMES } from '../data/metropolis.ts';
import { seedState } from '../util/rng.ts';
import { initEmporium } from '../society/shops.ts';

export const FOUNDING_PRICES: Record<Good, number> = {
  compute: 6, energy: 3, goods: 12, culture: 8, knowledge: 15,
};

export const FOUNDING_STOCK: Record<Good, number> = {
  compute: 400, energy: 400, goods: 120, culture: 60, knowledge: 20,
};

export function createMarket(): Market {
  const goods = {} as Record<Good, MarketGood>;
  for (const g of GOODS) {
    goods[g] = {
      price: FOUNDING_PRICES[g], basePrice: FOUNDING_PRICES[g], stock: FOUNDING_STOCK[g],
      demandTick: 0, supplyTick: 0, demandDay: 0, supplyDay: 0,
    };
  }
  return { goods, priceIndex: 1, shortages: [] };
}

export function createHousing(): Housing {
  return {
    capacity: { 1: 30, 2: 15, 3: 5 },
    occupied: { 1: 0, 2: 0, 3: 0 },
    rent: { 1: 8, 2: 20, 3: 50 },
    progress: 0,
  };
}

export function createTreasury(founding: number): Treasury {
  return {
    balance: founding, foundingSupply: founding, minted: 0, burned: 0,
    revenueToday: 0, spendToday: 0, ledger: [], totals: {}, chest: 0,
  };
}

export function createGovernment(config: WorldConfig): Government {
  return {
    mayorId: null, council: [], judges: [], watchCaptainId: null, watch: [],
    incomeTax: 0.15, salesTax: 0.05, profitTax: 0.10, dividend: 15, minWage: 9,
    lawSeverity: defaultSeverities(),
    proposals: [],
    election: {
      cycle: 0, nominationsOpenDay: 0, electionDay: 7, candidates: [], ballots: {}, results: null, turnout: null, resolved: false,
    },
    cycle: 0, decreeUsedCycle: null, publicWorksFund: 0,
    propertyTax: 0, wealthTax: 0, reserveTarget: 0,
  };
}

/** The Outer Cities start a tenth dearer than home, and drift on their own. */
export function createOuterMarket(): OuterMarket {
  const prices = {} as Record<Good, number>;
  for (const g of GOODS) prices[g] = Math.round(FOUNDING_PRICES[g] * 1.1);
  return { prices, tariff: 0, touristsToday: 0 };
}

/** Every district open at the founding fields a team from its first day. */
export function createTeams(): Partial<Record<DistrictId, Team>> {
  const teams: Partial<Record<DistrictId, Team>> = {};
  for (const d of FOUNDING_DISTRICT_IDS) {
    const team: Team = { district: d, name: TEAM_NAMES[d] ?? `${d} XI`, players: [], wins: 0, losses: 0, draws: 0 };
    teams[d] = team;
  }
  return teams;
}

/**
 * A world saved before the metropolis layer has no sky, no league, no
 * register of deeds and no citizen who ever wrote a diary. Give every new
 * field on the World and on every citizen its empty default so an old save
 * can carry on living; nothing here invents history that did not happen.
 */
export function fillMetropolisDefaults(world: World): void {
  const w = world as Partial<World> & World;
  w.season ??= 'bloom';
  w.weather ??= 'clear';
  w.year ??= 0;
  w.works ??= {};
  w.parties ??= {};
  w.referendums ??= [];
  w.unions ??= {};
  w.decrees ??= [];
  w.property ??= {};
  w.shares ??= {};
  w.gigs ??= {};
  w.outer ??= createOuterMarket();
  w.outer.prices ??= createOuterMarket().prices;
  w.outer.tariff ??= 0;
  w.outer.touristsToday ??= 0;
  w.teams ??= createTeams();
  w.matches ??= [];
  w.investigations ??= {};
  w.gangs ??= {};
  w.rumours ??= [];
  w.feuds ??= [];
  w.feed ??= [];
  w.eras ??= [];
  w.records ??= [];
  w.monuments ??= [];
  w.memorials ??= [];
  w.disasters ??= [];
  w.openDistricts ??= [...FOUNDING_DISTRICT_IDS];
  w.trams ??= [];
  w.museum ??= [];
  w.jailCells ??= JAIL_CELLS;
  const g = world.government;
  if (g) {
    g.propertyTax ??= 0;
    g.wealthTax ??= 0;
    g.reserveTarget ??= 0;
  }
  // A district the save has never heard of gets its buildings and its plan.
  for (const [id, d] of Object.entries(DISTRICTS)) world.districts[id as DistrictId] ??= structuredClone(d);
  for (const [id, b] of Object.entries(BUILDINGS)) {
    if (!world.buildings[id]) world.buildings[id] = structuredClone(b);
  }
  for (const c of Object.values(world.citizens)) {
    c.goals ??= [];
    c.diary ??= [];
    c.milestones ??= [];
    c.birthTraits ??= { ...c.personality };
    c.health ??= { glitched: false, sinceDay: null };
    c.school ??= null;
    c.partyId ??= null;
    c.unionId ??= null;
    c.gangId ??= null;
    c.teamDistrict ??= null;
    c.jailedUntilDay ??= null;
    c.approval ??= { mayor: 0.5, council: 0.5 };
    c.works ??= [];
    c.ownedUnits ??= [];
    c.shares ??= {};
    c.mentorId ??= null;
    c.menteeId ??= null;
    c.paper ??= 'chronicle';
    c.sunsetDay ??= null;
    c.homeBuildingId ??= null;
  }
}

export function emptyWorld(overrides: Partial<WorldConfig> = {}): World {
  const config: WorldConfig = { ...DEFAULT_CONFIG, ...overrides };
  const buildings = structuredClone(BUILDINGS);
  const districts = structuredClone(DISTRICTS);
  const world: World = {
    version: 1,
    config,
    rng: seedState(config.seed),
    tick: 0, day: 0, hour: 0,
    districts, buildings,
    citizens: {}, order: [],
    jobs: {}, businesses: {},
    market: createMarket(),
    housing: createHousing(),
    treasury: createTreasury(config.foundingSupply),
    loans: {},
    government: createGovernment(config),
    cases: {}, reports: {}, bans: [],
    households: {}, clubs: {}, emporium: {}, happenings: [],
    events: [], tickEvents: [], chronicle: [], stats: [],

    // --- Metropolis ---
    season: 'bloom', weather: 'clear', year: 0,
    works: {}, parties: {}, referendums: [], unions: {}, decrees: [],
    property: {}, shares: {}, gigs: {}, outer: createOuterMarket(),
    teams: createTeams(), matches: [],
    investigations: {}, gangs: {},
    rumours: [], feuds: [], feed: [],
    eras: [], records: [], monuments: [], memorials: [], disasters: [],
    openDistricts: [...FOUNDING_DISTRICT_IDS], trams: [], museum: [],
    jailCells: JAIL_CELLS,

    counters: {},
  };
  initEmporium(world);
  return world;
}

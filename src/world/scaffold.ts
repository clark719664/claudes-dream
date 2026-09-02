/**
 * Builds an empty World: geography, market, housing, treasury and government
 * scaffolding, but no citizens. world.ts populates it; tests use it directly.
 */
import { DEFAULT_CONFIG, GOODS } from '../types.ts';
import type { Good, Housing, Market, MarketGood, Treasury, World, WorldConfig, Government } from '../types.ts';
import { BUILDINGS, DISTRICTS } from '../data/city.ts';
import { defaultSeverities } from '../data/laws.ts';
import { seedState } from '../util/rng.ts';

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
    revenueToday: 0, spendToday: 0, ledger: [], totals: {},
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
  };
}

export function emptyWorld(overrides: Partial<WorldConfig> = {}): World {
  const config: WorldConfig = { ...DEFAULT_CONFIG, ...overrides };
  const buildings = structuredClone(BUILDINGS);
  const districts = structuredClone(DISTRICTS);
  return {
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
    cases: {}, bans: [],
    events: [], tickEvents: [], chronicle: [], stats: [],
    counters: {},
  };
}

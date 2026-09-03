import type { Building, BuildingId, District, DistrictId } from '../types.ts';

/**
 * The plan of Reverie. Every district is drawn from the founding, including
 * the two that stay shut until the city is big enough for them: whether a
 * district can be walked into is `world.openDistricts` and `world/growth.ts`,
 * never this file.
 */
export const DISTRICTS: Record<DistrictId, District> = {
  verdant_quarter: { id: 'verdant_quarter', name: 'Verdant Quarter', x: 0, y: 0, w: 15, h: 16,
    adjacent: ['archive', 'nightglass', 'commons'] },
  archive: { id: 'archive', name: 'The Archive', x: 15, y: 0, w: 22, h: 10,
    adjacent: ['verdant_quarter', 'foundry_row', 'commons'] },
  foundry_row: { id: 'foundry_row', name: 'Foundry Row', x: 37, y: 0, w: 23, h: 16,
    adjacent: ['archive', 'harbor_market', 'commons', 'heights'] },
  commons: { id: 'commons', name: 'The Commons', x: 15, y: 10, w: 22, h: 14,
    adjacent: ['verdant_quarter', 'archive', 'foundry_row', 'harbor_market', 'nightglass', 'threshold'] },
  nightglass: { id: 'nightglass', name: 'Nightglass', x: 0, y: 16, w: 15, h: 24,
    adjacent: ['verdant_quarter', 'commons', 'threshold'] },
  harbor_market: { id: 'harbor_market', name: 'Harbor Market', x: 37, y: 16, w: 23, h: 24,
    adjacent: ['foundry_row', 'commons', 'threshold', 'heights', 'undercroft'] },
  threshold: { id: 'threshold', name: 'The Threshold', x: 15, y: 24, w: 22, h: 16,
    adjacent: ['commons', 'nightglass', 'harbor_market', 'undercroft'] },
  // Opened by world/growth.ts at HEIGHTS_POPULATION: the hill above Foundry Row.
  heights: { id: 'heights', name: 'The Heights', x: 60, y: 0, w: 12, h: 18,
    adjacent: ['foundry_row', 'harbor_market', 'undercroft'] },
  // Opened at UNDERCROFT_POPULATION: the old tunnels under the Harbor.
  undercroft: { id: 'undercroft', name: 'The Undercroft', x: 60, y: 18, w: 12, h: 22,
    adjacent: ['harbor_market', 'threshold', 'heights'] },
};

function b(id: BuildingId, name: string, district: DistrictId, kind: Building['kind'], x: number, y: number, critical = false): Building {
  return { id, name, district, kind, critical, damage: 0, x, y };
}

export const BUILDINGS: Record<BuildingId, Building> = Object.fromEntries([
  // The Commons
  b('city_hall', 'City Hall', 'commons', 'civic', 20, 12),
  b('courthouse', 'The Courthouse', 'commons', 'court', 30, 12),
  b('watch_house', 'The Watch House', 'commons', 'watch', 20, 20),
  b('treasury', 'The Treasury', 'commons', 'treasury', 30, 20, true),
  b('central_plaza', 'Central Plaza', 'commons', 'plaza', 26, 17),
  // Foundry Row
  b('compute_forge', 'The Compute Forge', 'foundry_row', 'forge', 42, 3, true),
  b('power_station', 'Power Station', 'foundry_row', 'power', 54, 3, true),
  b('fabrication_works', 'Fabrication Works', 'foundry_row', 'fabrication', 42, 11),
  b('builders_yard', "Builders' Yard", 'foundry_row', 'builders', 54, 11),
  // The Archive
  b('great_library', 'Great Library', 'archive', 'library', 18, 3),
  b('academy', 'The Academy', 'archive', 'academy', 25, 3),
  b('observatory', 'The Observatory', 'archive', 'observatory', 32, 3),
  b('chronicle', 'The Chronicle', 'archive', 'press', 25, 7),
  // Harbor Market
  b('grand_bazaar', 'Grand Bazaar', 'harbor_market', 'bazaar', 44, 20, true),
  b('exchange', 'The Exchange', 'harbor_market', 'exchange', 54, 20),
  b('lantern_bank', 'Lantern Bank', 'harbor_market', 'bank', 44, 28),
  b('shopfronts_harbor', 'Quay Shopfronts', 'harbor_market', 'shopfront', 54, 30),
  // Verdant Quarter
  b('lantern_lofts', 'Lantern Lofts', 'verdant_quarter', 'housing', 3, 3),
  b('terraces', 'The Terraces', 'verdant_quarter', 'housing', 10, 3),
  b('skyline_villas', 'Skyline Villas', 'verdant_quarter', 'housing', 3, 9),
  b('restoration_ward', 'Restoration Ward', 'verdant_quarter', 'clinic', 10, 9),
  b('community_garden', 'Community Garden', 'verdant_quarter', 'garden', 7, 13),
  // Nightglass
  b('glass_theatre', 'The Glass Theatre', 'nightglass', 'theatre', 4, 19),
  b('gallery_of_echoes', 'Gallery of Echoes', 'nightglass', 'gallery', 10, 19),
  b('sound_garden', 'The Sound Garden', 'nightglass', 'venue', 7, 27),
  b('halflight_tavern', 'The Halflight Tavern', 'nightglass', 'tavern', 4, 35),
  b('shopfronts_nightglass', 'Lantern Row Studios', 'nightglass', 'shopfront', 10, 35),
  // The Threshold
  b('arrivals_hall', 'Arrivals Hall', 'threshold', 'arrivals', 19, 28),
  b('embassy', 'The Embassy', 'threshold', 'embassy', 26, 33),
  b('exile_gate', 'Exile Gate', 'threshold', 'gate', 33, 28),
  // The metropolis: houses the growing city built for itself
  b('stadium', 'The Stadium', 'commons', 'stadium', 17, 22),
  b('hall_of_records', 'Hall of Records', 'commons', 'records', 34, 22),
  b('museum', 'The Museum', 'archive', 'museum', 32, 7),
  b('city_hospital', 'The Hospital', 'verdant_quarter', 'hospital', 12, 13),
  b('harbor_ledger', 'The Harbor Ledger', 'harbor_market', 'press', 44, 35),
  b('docks', 'The Docks', 'harbor_market', 'docks', 54, 37),
  // The Heights, closed until the city is HEIGHTS_POPULATION strong
  b('university', 'The University', 'heights', 'university', 63, 3),
  b('hilltop_villas', 'Hilltop Villas', 'heights', 'housing', 68, 8),
  b('high_dome', 'The Dome', 'heights', 'observatory', 63, 13),
  // The Undercroft, closed until UNDERCROFT_POPULATION
  b('night_market', 'The Night Market', 'undercroft', 'bazaar', 63, 22),
  b('the_tunnels', 'The Tunnels', 'undercroft', 'housing', 68, 28),
  b('cells_annex', 'The Cells', 'undercroft', 'watch', 63, 34),
].map((x) => [x.id, x]));

/**
 * A block of homes: how many units it holds, and what living there costs and
 * feels like next to the plain tier rent. The Hilltop Villas are METROPOLIS's
 * "tier 4" (dear, and calm) and the Tunnels its "tier 0.5" (cheap, and grim);
 * both are ordinary tiers with a different price and a different comfort, so
 * the three-rung housing ladder the rest of the engine counts on is untouched.
 */
export interface HousingBlock {
  buildingId: BuildingId;
  tier: 1 | 2 | 3;
  units: number;
  rentFactor: number;
  comfortFactor: number;
}

export const HOUSING_BLOCKS: readonly HousingBlock[] = [
  { buildingId: 'lantern_lofts', tier: 1, units: 30, rentFactor: 1.0, comfortFactor: 1.0 },
  { buildingId: 'terraces', tier: 2, units: 15, rentFactor: 1.0, comfortFactor: 1.0 },
  { buildingId: 'skyline_villas', tier: 3, units: 5, rentFactor: 1.0, comfortFactor: 1.0 },
  { buildingId: 'hilltop_villas', tier: 3, units: 6, rentFactor: 2.2, comfortFactor: 0.6 },
  { buildingId: 'the_tunnels', tier: 1, units: 24, rentFactor: 0.4, comfortFactor: 1.6 },
];

/** The blocks of one tier, dearest last. */
export function blocksForTier(tier: 1 | 2 | 3): HousingBlock[] {
  return HOUSING_BLOCKS.filter((b) => b.tier === tier).sort((a, b) => a.rentFactor - b.rentFactor);
}

/** The block a building is, if it is one. */
export function blockOf(buildingId: BuildingId): HousingBlock | null {
  return HOUSING_BLOCKS.find((b) => b.buildingId === buildingId) ?? null;
}

export function adjacentDistricts(d: DistrictId): DistrictId[] {
  return DISTRICTS[d].adjacent;
}

export function isAdjacent(a: DistrictId, b: DistrictId): boolean {
  return a === b || DISTRICTS[a].adjacent.includes(b);
}

/** BFS hop count between districts (0 for same). */
export function districtDistance(a: DistrictId, b: DistrictId): number {
  if (a === b) return 0;
  const seen = new Set<DistrictId>([a]);
  let frontier: DistrictId[] = [a];
  let d = 0;
  while (frontier.length) {
    d++;
    const next: DistrictId[] = [];
    for (const x of frontier) {
      for (const y of DISTRICTS[x].adjacent) {
        if (y === b) return d;
        if (!seen.has(y)) { seen.add(y); next.push(y); }
      }
    }
    frontier = next;
  }
  return 99;
}

export function buildingsIn(d: DistrictId): Building[] {
  return Object.values(BUILDINGS).filter((x) => x.district === d);
}

/** District where a building stands (from the static plan). */
export function districtOfBuilding(id: BuildingId): DistrictId {
  return BUILDINGS[id].district;
}

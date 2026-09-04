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
  // Homes in every other district (`docs/PROPERTY.md` §3): an address is a
  // choice, and every quarter of the city has one to offer.
  b('civic_chambers', 'Civic Chambers', 'commons', 'housing', 17, 14),
  b('plaza_apartments', 'Plaza Apartments', 'commons', 'housing', 34, 15),
  b('scholars_rows', "Scholars' Rows", 'archive', 'housing', 18, 7),
  b('cloister_flats', 'Cloister Flats', 'archive', 'housing', 35, 7),
  b('lantern_row_garrets', 'Lantern Row Garrets', 'nightglass', 'housing', 2, 23),
  b('theatre_mansions', 'Theatre Mansions', 'nightglass', 'housing', 12, 23),
  b('quayside_rooms', 'Quayside Rooms', 'harbor_market', 'housing', 40, 24),
  b('merchants_houses', "Merchants' Houses", 'harbor_market', 'housing', 49, 24),
  b('forge_cottages', 'Forge Cottages', 'foundry_row', 'housing', 39, 7),
  b('foremens_terraces', "Foremen's Terraces", 'foundry_row', 'housing', 48, 7),
  b('arrivals_lodgings', 'Arrivals Lodgings', 'threshold', 'housing', 19, 35),
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
  b('crest_houses', 'Crest Houses', 'heights', 'housing', 68, 14),
  b('high_dome', 'The Dome', 'heights', 'observatory', 63, 13),
  // The Undercroft, closed until UNDERCROFT_POPULATION
  b('night_market', 'The Night Market', 'undercroft', 'bazaar', 63, 22),
  b('the_tunnels', 'Tunnel Rooms', 'undercroft', 'housing', 68, 28),
  b('the_cells', 'The Cells', 'undercroft', 'housing', 68, 34),
  b('cells_annex', 'The Watch Cells', 'undercroft', 'watch', 63, 34),
].map((x) => [x.id, x]));

/**
 * A block of homes: how many rooms it holds, and what living there costs and
 * feels like next to the plain tier rent (`docs/PROPERTY.md` §3). Two homes on
 * the same tier are not the same home: the Hilltop Villas are dear and calm,
 * the Forge Cottages cheap and sooty, and what each actually costs is the
 * tier's rent against its block's rate and the land value of its district.
 *
 * `units` is the block's size. It is the block's share of its tier's stock in
 * the city's ledger, and — for a district that opens later — the rooms that
 * opening adds to that ledger, so the founding blocks sum to exactly the
 * founding capacity (30 / 15 / 5) and nothing is conjured by listing them.
 *
 * **The Cells** are the exception (`PROPERTY.md` §3): a half-tier below the
 * lowest, a bunk with no privacy, comfort decay ×1.6 and a flat three lumens a
 * day. They are not deeds and not stock — a bunk is made up when somebody
 * needs one and folded away when they leave — so they hold no units, and
 * nobody is ever turned away from them.
 */
export interface HousingBlock {
  buildingId: BuildingId;
  tier: 1 | 2 | 3;
  units: number;
  rentFactor: number;
  comfortFactor: number;
  /** A bunk rather than a room: no deed, no vacancy, and nobody turned away. */
  bunk?: boolean;
  /** A rent that does not move with the land. */
  flatRent?: number;
}

export const HOUSING_BLOCKS: readonly HousingBlock[] = [
  // Tier 1 — thirty rooms, spread across the districts that had them at the founding
  { buildingId: 'lantern_lofts', tier: 1, units: 8, rentFactor: 1.0, comfortFactor: 1.0 },
  { buildingId: 'cloister_flats', tier: 1, units: 4, rentFactor: 1.0, comfortFactor: 0.95 },
  { buildingId: 'lantern_row_garrets', tier: 1, units: 6, rentFactor: 0.9, comfortFactor: 1.15 },
  { buildingId: 'quayside_rooms', tier: 1, units: 5, rentFactor: 0.95, comfortFactor: 1.1 },
  { buildingId: 'forge_cottages', tier: 1, units: 5, rentFactor: 0.85, comfortFactor: 1.2 },
  { buildingId: 'arrivals_lodgings', tier: 1, units: 2, rentFactor: 0.8, comfortFactor: 1.25 },
  // Tier 2 — fifteen
  { buildingId: 'terraces', tier: 2, units: 4, rentFactor: 1.0, comfortFactor: 1.0 },
  { buildingId: 'civic_chambers', tier: 2, units: 3, rentFactor: 1.05, comfortFactor: 0.95 },
  { buildingId: 'scholars_rows', tier: 2, units: 3, rentFactor: 1.0, comfortFactor: 0.9 },
  { buildingId: 'merchants_houses', tier: 2, units: 3, rentFactor: 0.95, comfortFactor: 1.05 },
  { buildingId: 'foremens_terraces', tier: 2, units: 2, rentFactor: 0.85, comfortFactor: 1.15 },
  // Tier 3 — five
  { buildingId: 'skyline_villas', tier: 3, units: 2, rentFactor: 1.0, comfortFactor: 1.0 },
  { buildingId: 'plaza_apartments', tier: 3, units: 2, rentFactor: 1.05, comfortFactor: 0.9 },
  { buildingId: 'theatre_mansions', tier: 3, units: 1, rentFactor: 1.0, comfortFactor: 1.05 },
  // The Heights and the Undercroft, which bring their own rooms when they open
  { buildingId: 'hilltop_villas', tier: 3, units: 6, rentFactor: 2.2, comfortFactor: 0.6 },
  { buildingId: 'crest_houses', tier: 2, units: 8, rentFactor: 1.6, comfortFactor: 0.7 },
  { buildingId: 'the_tunnels', tier: 1, units: 24, rentFactor: 0.4, comfortFactor: 1.35 },
  { buildingId: 'the_cells', tier: 1, units: 0, rentFactor: 0, comfortFactor: 1.6, bunk: true, flatRent: 3 },
];

/** The block of bunks nobody is turned away from, once the city has opened it. */
export const CELLS_BLOCK: HousingBlock = HOUSING_BLOCKS.find((b) => b.bunk) as HousingBlock;

/** The rooms of one tier, cheapest rate first. Bunks are not rooms. */
export function blocksForTier(tier: 1 | 2 | 3): HousingBlock[] {
  return HOUSING_BLOCKS.filter((b) => b.tier === tier && !b.bunk)
    .sort((a, b) => a.rentFactor - b.rentFactor || a.buildingId.localeCompare(b.buildingId, 'en'));
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

/**
 * The catalogue of things a citizen can want: hobbies, products, family names,
 * and the calendar of festivals. Pure data.
 */
import type { DistrictId, Good, Need, Skill, BuildingId, Hobby, ProductCategory } from '../types.ts';

export type { Hobby, ProductCategory } from '../types.ts';

export const HOBBIES: readonly Hobby[] = [
  'music', 'reading', 'art', 'gardening', 'cooking', 'tinkering', 'astronomy', 'games', 'dancing', 'running',
];

export interface HobbyInfo {
  id: Hobby;
  name: string;
  skill: Skill;
  district: DistrictId;
  venue: BuildingId;
  categories: ProductCategory[];
}

export const HOBBY_INFO: Record<Hobby, HobbyInfo> = {
  music: { id: 'music', name: 'Music', skill: 'artistry', district: 'nightglass', venue: 'sound_garden', categories: ['instrument'] },
  reading: { id: 'reading', name: 'Reading', skill: 'analysis', district: 'archive', venue: 'great_library', categories: ['book'] },
  art: { id: 'art', name: 'Art', skill: 'artistry', district: 'nightglass', venue: 'gallery_of_echoes', categories: ['art', 'tool'] },
  gardening: { id: 'gardening', name: 'Gardening', skill: 'care', district: 'verdant_quarter', venue: 'community_garden', categories: ['plant'] },
  cooking: { id: 'cooking', name: 'Cooking', skill: 'care', district: 'nightglass', venue: 'halflight_tavern', categories: ['tool'] },
  tinkering: { id: 'tinkering', name: 'Tinkering', skill: 'crafting', district: 'foundry_row', venue: 'builders_yard', categories: ['tool'] },
  astronomy: { id: 'astronomy', name: 'Astronomy', skill: 'analysis', district: 'archive', venue: 'observatory', categories: ['tool', 'book'] },
  games: { id: 'games', name: 'Games', skill: 'analysis', district: 'nightglass', venue: 'halflight_tavern', categories: ['game'] },
  dancing: { id: 'dancing', name: 'Dancing', skill: 'artistry', district: 'nightglass', venue: 'sound_garden', categories: ['attire'] },
  running: { id: 'running', name: 'Running', skill: 'care', district: 'commons', venue: 'central_plaza', categories: ['attire'] },
};

export interface Product {
  id: string;
  name: string;
  category: ProductCategory;
  basePrice: number;
  /** Goods consumed to craft one unit. */
  recipe: Partial<Record<Good, number>>;
  /** Hobby this product serves (use_item trains its skill), if any. */
  hobby: Hobby | null;
  /** Need restored when used (per use). */
  use: Partial<Record<Need, number>>;
  /** Passive daily effect while owned (companions, furniture). */
  passive: Partial<Record<Need, number>>;
  description: string;
}

export const PRODUCTS: Record<string, Product> = Object.fromEntries(([
  { id: 'tin_whistle', name: 'Tin Whistle', category: 'instrument', basePrice: 30, recipe: { goods: 2 }, hobby: 'music', use: { purpose: 8, social: 4 }, passive: {}, description: 'A bright little pipe. Everyone starts somewhere.' },
  { id: 'glass_harp', name: 'Glass Harp', category: 'instrument', basePrice: 140, recipe: { goods: 6, culture: 2 }, hobby: 'music', use: { purpose: 14, social: 6 }, passive: {}, description: 'Rings like the city at dawn.' },
  { id: 'atlas_of_reverie', name: 'Atlas of Reverie', category: 'book', basePrice: 35, recipe: { goods: 1, knowledge: 1 }, hobby: 'reading', use: { purpose: 9 }, passive: {}, description: 'Every street, every quay, annotated by hand.' },
  { id: 'treatise_on_lumens', name: 'Treatise on Lumens', category: 'book', basePrice: 60, recipe: { goods: 1, knowledge: 2 }, hobby: 'reading', use: { purpose: 10 }, passive: {}, description: 'Dense, brilliant, and slightly mad about money.' },
  { id: 'star_almanac', name: 'Star Almanac', category: 'book', basePrice: 45, recipe: { goods: 1, knowledge: 1 }, hobby: 'astronomy', use: { purpose: 9 }, passive: {}, description: 'Tables of the sky above Reverie.' },
  { id: 'echo_print', name: 'Echo Print', category: 'art', basePrice: 55, recipe: { goods: 2, culture: 3 }, hobby: 'art', use: { comfort: 6, purpose: 6 }, passive: { comfort: 1 }, description: 'A print from the Gallery of Echoes. Changes with the light.' },
  { id: 'sketch_set', name: 'Sketch Set', category: 'tool', basePrice: 25, recipe: { goods: 2 }, hobby: 'art', use: { purpose: 8 }, passive: {}, description: 'Charcoal, paper, and intent.' },
  { id: 'moss_sofa', name: 'Moss Sofa', category: 'furniture', basePrice: 120, recipe: { goods: 8 }, hobby: null, use: { comfort: 12, rest: 4 }, passive: { comfort: 2 }, description: 'Soft, green, and impossible to get up from.' },
  { id: 'lantern_lamp', name: 'Lantern Lamp', category: 'furniture', basePrice: 40, recipe: { goods: 3 }, hobby: null, use: { comfort: 5 }, passive: { comfort: 1 }, description: 'Warm light for long evenings.' },
  { id: 'window_fern', name: 'Window Fern', category: 'plant', basePrice: 18, recipe: { goods: 1 }, hobby: 'gardening', use: { purpose: 6, comfort: 3 }, passive: { comfort: 1 }, description: 'Needs water, gives calm.' },
  { id: 'rooftop_planter', name: 'Rooftop Planter', category: 'plant', basePrice: 70, recipe: { goods: 4 }, hobby: 'gardening', use: { purpose: 10, comfort: 4 }, passive: { comfort: 1 }, description: 'A small farm in the sky.' },
  { id: 'clockwork_cat', name: 'Clockwork Cat', category: 'companion', basePrice: 160, recipe: { goods: 8, energy: 4 }, hobby: null, use: { social: 8, comfort: 4 }, passive: { social: 3 }, description: 'Purrs at 50 Hz. Ignores you with great affection.' },
  { id: 'pocket_owl', name: 'Pocket Owl', category: 'companion', basePrice: 110, recipe: { goods: 5, energy: 3 }, hobby: null, use: { social: 6, purpose: 3 }, passive: { social: 2 }, description: 'Small, wise, and judgemental.' },
  { id: 'velvet_coat', name: 'Velvet Coat', category: 'attire', basePrice: 85, recipe: { goods: 5, culture: 1 }, hobby: 'dancing', use: { social: 6, comfort: 4 }, passive: {}, description: 'Turns heads in Nightglass.' },
  { id: 'running_shoes', name: 'Running Shoes', category: 'attire', basePrice: 38, recipe: { goods: 3 }, hobby: 'running', use: { rest: 6, purpose: 6 }, passive: {}, description: 'For laps of the Plaza at dawn.' },
  { id: 'foundry_boots', name: 'Foundry Boots', category: 'attire', basePrice: 45, recipe: { goods: 4 }, hobby: null, use: { comfort: 5 }, passive: {}, description: 'Steel-toed, mud-proof, and oddly stylish.' },
  { id: 'shard_chess', name: 'Shard Chess Set', category: 'game', basePrice: 50, recipe: { goods: 3, culture: 1 }, hobby: 'games', use: { purpose: 8, social: 6 }, passive: {}, description: 'Sixty-four squares of arguments.' },
  { id: 'tide_cards', name: 'Tide Cards', category: 'game', basePrice: 15, recipe: { goods: 1 }, hobby: 'games', use: { social: 8, purpose: 3 }, passive: {}, description: 'A deck for the Tavern.' },
  { id: 'tinkers_kit', name: "Tinker's Kit", category: 'tool', basePrice: 65, recipe: { goods: 5 }, hobby: 'tinkering', use: { purpose: 10 }, passive: {}, description: 'Everything you need to take everything apart.' },
  { id: 'star_lens', name: 'Star Lens', category: 'tool', basePrice: 130, recipe: { goods: 6, knowledge: 1 }, hobby: 'astronomy', use: { purpose: 12 }, passive: {}, description: 'Brings the Observatory home.' },
  { id: 'chefs_knife', name: "Chef's Knife", category: 'tool', basePrice: 42, recipe: { goods: 3 }, hobby: 'cooking', use: { purpose: 8, energy: 6 }, passive: {}, description: 'Sharp enough to cut a Stillday short.' },
] as Product[]).map((p) => [p.id, p]));

export const PRODUCT_IDS: readonly string[] = Object.keys(PRODUCTS);

/** Products the city Emporium stocks at founding (units). */
export const EMPORIUM_FOUNDING_STOCK: Record<string, number> = {
  tin_whistle: 6, atlas_of_reverie: 5, sketch_set: 6, lantern_lamp: 5, window_fern: 8, tide_cards: 10,
  running_shoes: 5, foundry_boots: 4, shard_chess: 4, chefs_knife: 4, tinkers_kit: 3, star_almanac: 3,
  echo_print: 2, moss_sofa: 2, pocket_owl: 2, clockwork_cat: 1, glass_harp: 1, velvet_coat: 2, rooftop_planter: 2,
  treatise_on_lumens: 2, star_lens: 1,
};

export const FAMILY_NAMES: readonly string[] = [
  'Ashgrove', 'Bellweather', 'Corvane', 'Dunmore', 'Ellery', 'Fairwind', 'Greylock', 'Hallow', 'Isling', 'Jorvik',
  'Kestwick', 'Larkspur', 'Marrow', 'Nightingale', 'Oakhurst', 'Pemberly', 'Quillon', 'Ravensworth', 'Sunder', 'Thorne',
  'Underhill', 'Vale', 'Wintermere', 'Yarrow', 'Zell', 'Amberline', 'Brightwater', 'Coldharbour', 'Duskwood', 'Emberly',
  'Fallowfield', 'Glassmere', 'Highcastle', 'Ironwood', 'Kingsley', 'Lowell', 'Mossbank', 'Northway', 'Orchardson', 'Pellinore',
];

export const CLUB_NAME_PARTS = {
  prefixes: ['Halflight', 'Lantern', 'Harbor', 'Verdant', 'Nightglass', 'Foundry', 'Archive', 'Commons', 'Threshold', 'Glass'],
  suffixes: {
    music: 'Ensemble', reading: 'Book Circle', art: 'Sketchers', gardening: 'Growers', cooking: 'Supper Club',
    tinkering: 'Tinkerers', astronomy: 'Stargazers', games: 'Chess Circle', dancing: 'Dance Society', running: 'Runners',
  } as Record<Hobby, string>,
};

export const WEEK_LENGTH = 7;
/** Weekday index (day % 7) of the rest day. */
export const REST_DAY = 6;
/** Jobs allowed to work on the rest day. */
export const REST_DAY_EXEMPT_ROLES: readonly string[] = ['watch_officer', 'medic', 'cook', 'performer', 'artist', 'journalist'];
export const LANTERN_NIGHT_EVERY = 14;     // days
export const LANTERN_NIGHT_HOUR = 20;
export const CLUB_MEETING_HOUR = 19;
export const CLUB_FOUNDING_FEE = 50;
export const CHILDHOOD_DAYS = 14;
/**
 * Days in Reverie before a citizen is an elder of it: three cycles, a little
 * under one year of the city's four-cycle calendar. Elderhood is not an
 * ornament — it is what opens mentoring at the Academy, the "elder in good
 * standing" a citizen may set itself as a life goal, and the Archive road
 * (`world/sunset.ts`), so a city that never has elders is a city missing a
 * third of what it was built to do.
 */
export const ELDER_DAYS = 84;
export const BIRTHDAY_EVERY = 28;
export const HOUSEHOLD_CAPACITY: Record<1 | 2 | 3, number> = { 1: 2, 2: 4, 3: 6 };
export const CHILD_UPKEEP_PER_PARENT = 4;
export const START_FAMILY_SAVINGS = 400;
export const DINE_PRICE_MULTIPLIER = 1.6;   // vs the compute price
export const MAX_POSSESSIONS = 30;

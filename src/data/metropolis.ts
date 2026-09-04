/**
 * The metropolis layer's shared constants: the numbers and names more than one
 * module reads. Pure data — nothing here imports anything but the types.
 *
 * Everything in this file is a *fact about the city*, never advice to a
 * citizen: how many cells the Watch House has, how many jurors a grave charge
 * is heard by, what the four seasons are called. No weight here says what a
 * citizen ought to want (`docs/PRINCIPLES.md` §2).
 */
import type {
  BuildingId, BuildingKind, DistrictId, GoalKind, Good, Hobby, PaperId, Platform,
  SchoolOfThought, Season, Skill, Weather, WorkKind,
} from '../types.ts';

// ---------------------------------------------------------------------------
// The year, the sky and the map
// ---------------------------------------------------------------------------

/** A year is four council cycles. */
export const YEAR_CYCLES = 4;

export const SEASON_NAMES: Record<Season, string> = {
  bloom: 'Bloom', blaze: 'Blaze', fall: 'Fall', frost: 'Frost',
};

export const WEATHER_NAMES: Record<Weather, string> = {
  clear: 'Clear', rain: 'Rain', storm: 'Storm', fog: 'Fog', heat: 'Heat', snow: 'Snow',
};

/** Odds of each kind of day, by season. Every row sums to 1. */
export const WEATHER_TABLE: Record<Season, Record<Weather, number>> = {
  bloom: { clear: 0.45, rain: 0.30, storm: 0.07, fog: 0.13, heat: 0.05, snow: 0.00 },
  blaze: { clear: 0.50, rain: 0.10, storm: 0.08, fog: 0.04, heat: 0.28, snow: 0.00 },
  fall: { clear: 0.32, rain: 0.30, storm: 0.12, fog: 0.22, heat: 0.04, snow: 0.00 },
  frost: { clear: 0.28, rain: 0.12, storm: 0.10, fog: 0.20, heat: 0.00, snow: 0.30 },
};

/** Population at which the Heights open. */
export const HEIGHTS_POPULATION = 70;
/** Population at which the Undercroft opens. */
export const UNDERCROFT_POPULATION = 100;

// ---------------------------------------------------------------------------
// Justice
// ---------------------------------------------------------------------------

/** Cells at the Watch House. More prisoners than this and the city must let someone out. */
export const JAIL_CELLS = 6;
/** The longest a tier-4 sentence can hold anyone. */
export const JAIL_MAX_DAYS = 5;
/** Severity at which a jury is drawn by lot to sit with the bench. */
export const JURY_SEVERITY = 4;
/** Jurors drawn for such a case, when the city has that many who may sit. */
export const JURY_SIZE = 5;
/** The most an advocate's speech can take off a judge's belief. */
export const MAX_ADVOCACY = 0.15;

// ---------------------------------------------------------------------------
// Politics, markets and culture
// ---------------------------------------------------------------------------

/** Share of the citizenry whose signatures put a petition to a referendum. */
export const PETITION_SHARE = 0.2;
/** Stillday. */
export const REFERENDUM_WEEKDAY = 6;
export const REFERENDUM_HOUR = 18;
/** Quillday. */
export const MATCH_WEEKDAY = 3;
export const MATCH_HOUR = 19;
export const MASTERPIECE_QUALITY = 90;
export const MASTER_SKILL = 80;
export const WEALTH_TAX_THRESHOLD = 1_000;
export const OUTER_GOODS_DRIFT = 0.03;

// ---------------------------------------------------------------------------
// Bounds
// ---------------------------------------------------------------------------

export const MAX_DIARY = 30;
export const MAX_DIARY_SHOWN = 3;
export const MAX_MILESTONES = 30;
export const MAX_FEED = 500;
export const MAX_FEED_SHOWN = 8;
export const MAX_RUMOURS = 200;
export const RUMOUR_LIFE_DAYS = 7;
export const MAX_MATCHES = 200;
export const MAX_DISASTERS = 100;
export const TRAIT_DRIFT_CAP = 0.15;
export const GOALS_PER_CITIZEN = 2;

// ---------------------------------------------------------------------------
// Names and tables
// ---------------------------------------------------------------------------

export interface Dish {
  id: string;
  name: string;
  recipe: Partial<Record<Good, number>>;
  energy: number;
  social: number;
}

export const DISHES: readonly Dish[] = [
  { id: 'lantern_broth', name: 'Lantern broth', recipe: { goods: 1 }, energy: 18, social: 6 },
  { id: 'forge_hash', name: 'Forge hash', recipe: { goods: 1, energy: 1 }, energy: 24, social: 4 },
  { id: 'archive_loaf', name: 'Archive loaf', recipe: { goods: 1, knowledge: 1 }, energy: 16, social: 10 },
  { id: 'harbor_plate', name: 'Harbor plate', recipe: { goods: 2 }, energy: 26, social: 8 },
  { id: 'glasswater_tart', name: 'Glasswater tart', recipe: { goods: 1, culture: 1 }, energy: 14, social: 14 },
  { id: 'tunnel_stew', name: 'Tunnel stew', recipe: { goods: 1 }, energy: 20, social: 5 },
];

export const PARTY_NAME_PARTS: { prefixes: string[]; suffixes: string[] } = {
  prefixes: ['Open', 'Common', 'Bright', 'Steady', 'Free', 'New', 'Founding', 'Lantern', 'Harbor', 'Civic'],
  suffixes: ['Front', 'Union', 'Assembly', 'League', 'Circle', 'Bloc', 'Compact', 'Movement'],
};

export const GANG_NAME_PARTS: { prefixes: string[]; suffixes: string[] } = {
  prefixes: ['Ash', 'Black', 'Low', 'Iron', 'Salt', 'Quiet', 'Cold', 'Under', 'Night', 'Broken'],
  suffixes: ['Hands', 'Lanterns', 'Keys', 'Crows', 'Ledger', 'Tide', 'Wire', 'Cellar'],
};

export const TEAM_NAMES: Record<DistrictId, string> = {
  commons: 'Commons Lanterns',
  foundry_row: 'Foundry Hammers',
  archive: 'Archive Scholars',
  harbor_market: 'Harbor Tide',
  verdant_quarter: 'Verdant Green',
  nightglass: 'Nightglass Stars',
  threshold: 'Threshold Gate',
  heights: 'Heights Falcons',
  undercroft: 'Undercroft Moles',
};

export interface SchoolInfo {
  name: string;
  creed: string;
  platform: Platform;
  hobbies: Hobby[];
}

export const SCHOOL_INFO: Record<Exclude<SchoolOfThought, null>, SchoolInfo> = {
  makers: {
    name: 'the Makers',
    creed: 'What a city is, it built.',
    platform: { tax: 0.35, dividend: 0.3, minWage: 0.45, strictness: 0.6 },
    hobbies: ['tinkering', 'cooking', 'gardening'],
  },
  commons: {
    name: 'the Commons',
    creed: 'Nobody eats until everybody eats.',
    platform: { tax: 0.75, dividend: 0.85, minWage: 0.8, strictness: 0.5 },
    hobbies: ['reading', 'games', 'running'],
  },
  lanterns: {
    name: 'the Lanterns',
    creed: 'A life is not a shift.',
    platform: { tax: 0.5, dividend: 0.6, minWage: 0.5, strictness: 0.25 },
    hobbies: ['music', 'art', 'dancing', 'astronomy'],
  },
};

export interface PaperInfo {
  name: string;
  buildingId: BuildingId;
  line: Platform;
  slant: string;
}

export const PAPER_INFO: Record<PaperId, PaperInfo> = {
  chronicle: {
    name: 'The Reverie Chronicle',
    buildingId: 'chronicle',
    line: { tax: 0.5, dividend: 0.5, minWage: 0.5, strictness: 0.5 },
    slant: 'the city of record',
  },
  ledger: {
    name: 'The Harbor Ledger',
    buildingId: 'harbor_ledger',
    line: { tax: 0.1, dividend: 0.2, minWage: 0.2, strictness: 0.6 },
    slant: 'trade first',
  },
};

export interface WorkInfo {
  name: string;
  skill: Skill;
  home: BuildingId;
  venueKinds: BuildingKind[];
}

export const WORK_INFO: Record<WorkKind, WorkInfo> = {
  painting: { name: 'painting', skill: 'artistry', home: 'gallery_of_echoes', venueKinds: ['gallery', 'museum'] },
  play: { name: 'play', skill: 'artistry', home: 'glass_theatre', venueKinds: ['theatre', 'venue'] },
  song: { name: 'song', skill: 'artistry', home: 'glass_theatre', venueKinds: ['theatre', 'venue', 'tavern'] },
  book: { name: 'book', skill: 'rhetoric', home: 'great_library', venueKinds: ['library', 'academy'] },
  paper: { name: 'paper', skill: 'analysis', home: 'observatory', venueKinds: ['observatory', 'library', 'university'] },
  expose: { name: 'exposé', skill: 'rhetoric', home: 'chronicle', venueKinds: ['press'] },
};

export const GOAL_INFO: Record<GoalKind, { label: string }> = {
  hold_office: { label: 'hold an office of the city' },
  become_mayor: { label: 'be elected Mayor' },
  own_villa: { label: 'own a villa' },
  lasting_business: { label: 'found a business that lasts thirty days' },
  marry: { label: 'marry' },
  raise_child: { label: 'raise a child' },
  master_skill: { label: 'master a craft' },
  publish_work: { label: 'publish a work' },
  win_championship: { label: 'win a championship' },
  elder_standing: { label: 'grow old in good standing' },
  amass_5000: { label: 'hold five thousand lumens' },
  club_of_ten: { label: 'found a club of ten' },
  sit_as_judge: { label: 'sit as a judge' },
};

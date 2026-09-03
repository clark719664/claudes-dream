import type { BuildingId, BusinessKind, JobOutput, JobRole, Skill } from '../types.ts';

export interface JobTemplate {
  role: JobRole;
  title: string;
  buildingId: BuildingId;
  skill: Skill | null;
  minSkill: number;
  minReputation: number;
  /** Flat wage per shift; for piece-rate posts (see PIECE_RATE_ROLES) the base the ceiling is measured from. */
  wage: number;
  output: JobOutput;
  /** Number of positions the city opens at founding. */
  slots: number;
}

/**
 * Jobs run by the city. Wages are paid from the Treasury; output goes to the
 * Bazaar. Production posts are paid by the piece and opened or closed with
 * demand (economy/planning.ts); service posts keep their founding slots and
 * flat wages.
 */
export const CITY_JOBS: JobTemplate[] = [
  { role: 'forge_operator', title: 'Forge Operator', buildingId: 'compute_forge', skill: 'crafting', minSkill: 10, minReputation: 0, wage: 14, output: { good: 'compute', qty: 3, energyCost: 1 }, slots: 6 },
  { role: 'power_technician', title: 'Power Technician', buildingId: 'power_station', skill: 'crafting', minSkill: 10, minReputation: 0, wage: 13, output: { good: 'energy', qty: 6 }, slots: 5 },
  { role: 'fabricator', title: 'Fabricator', buildingId: 'fabrication_works', skill: 'crafting', minSkill: 20, minReputation: 0, wage: 15, output: { good: 'goods', qty: 1.5, energyCost: 1 }, slots: 4 },
  { role: 'builder', title: 'Builder', buildingId: 'builders_yard', skill: 'crafting', minSkill: 15, minReputation: 0, wage: 14, output: { housingProgress: 8, energyCost: 2 }, slots: 3 },
  { role: 'medic', title: 'Medic', buildingId: 'restoration_ward', skill: 'care', minSkill: 25, minReputation: 0, wage: 16, output: {}, slots: 2 },
  { role: 'teacher', title: 'Teacher', buildingId: 'academy', skill: 'analysis', minSkill: 30, minReputation: 0, wage: 15, output: {}, slots: 2 },
  { role: 'librarian', title: 'Librarian', buildingId: 'great_library', skill: 'analysis', minSkill: 20, minReputation: 0, wage: 12, output: { good: 'knowledge', qty: 0.5 }, slots: 2 },
  { role: 'researcher', title: 'Researcher', buildingId: 'observatory', skill: 'analysis', minSkill: 40, minReputation: 0, wage: 18, output: { good: 'knowledge', qty: 0.3 }, slots: 2 },
  { role: 'journalist', title: 'Journalist', buildingId: 'chronicle', skill: 'rhetoric', minSkill: 25, minReputation: 0, wage: 13, output: {}, slots: 2 },
  { role: 'merchant', title: 'Merchant', buildingId: 'grand_bazaar', skill: 'commerce', minSkill: 20, minReputation: 0, wage: 12, output: {}, slots: 2 },
  { role: 'banker', title: 'Banker', buildingId: 'lantern_bank', skill: 'commerce', minSkill: 35, minReputation: 30, wage: 17, output: {}, slots: 1 },
  { role: 'performer', title: 'Performer', buildingId: 'glass_theatre', skill: 'artistry', minSkill: 20, minReputation: 0, wage: 11, output: { good: 'culture', qty: 4 }, slots: 2 },
  { role: 'artist', title: 'Artist', buildingId: 'gallery_of_echoes', skill: 'artistry', minSkill: 30, minReputation: 0, wage: 10, output: { good: 'culture', qty: 2 }, slots: 1 },
  { role: 'watch_officer', title: 'Watch Officer', buildingId: 'watch_house', skill: 'analysis', minSkill: 15, minReputation: 40, wage: 16, output: {}, slots: 3 },
];

// ---------------------------------------------------------------------------
// Piece rates and demand-driven posts (city production)
// ---------------------------------------------------------------------------

/**
 * City posts paid by the piece: each shift earns PIECE_RATE_SHARE of the
 * Bazaar value of what it made, never less than the minimum wage and never
 * more than PIECE_RATE_CEILING × the template wage. Deflation therefore
 * lowers the Treasury's wage bill; a shortage raises the rate and draws
 * workers to the scarce good. Service posts (Watch, medics, teachers,
 * librarians, researchers, journalists, merchants, the banker) and builders
 * keep flat wages.
 */
export const PIECE_RATE_ROLES: readonly JobRole[] = ['forge_operator', 'power_technician', 'fabricator', 'performer', 'artist'];
export const PIECE_RATE_SHARE = 0.8;
/** A piece rate is capped at this multiple of the template wage... */
export const PIECE_RATE_CEILING = 1.5;
/** ...or of the minimum wage, whichever is higher, so a master still out-earns a novice when the Council raises the floor. */
export const PIECE_RATE_MIN_WAGE_CEILING = 1.25;
/** Productivity of the typical worker whose piece rate the job board quotes. */
export const POSTED_RATE_PRODUCTIVITY = 0.65;
/**
 * City posts are six-hour posts: the city spreads its work so that more
 * citizens have a livelihood, and a shortage is met by opening posts rather
 * than by one master working the clock round. Business owners set their own
 * hours (up to WorldConfig.maxShiftsPerDay).
 */
export const CITY_SHIFTS_PER_DAY = 6;

export interface PostLimits {
  /** Posts the city keeps open even in a glut. */
  min: number;
  /** Posts the city opens at most at the seed population (one more per POST_PER_CITIZENS citizens above it). */
  max: number;
}

/**
 * City production posts are opened when their good runs short and closed
 * (vacant posts first, then the least productive worker) when the Bazaar
 * holds more than a week of it. Builders follow housing vacancies instead.
 */
export const CITY_POST_LIMITS: Partial<Record<JobRole, PostLimits>> = {
  forge_operator: { min: 2, max: 8 },
  power_technician: { min: 2, max: 7 },
  fabricator: { min: 1, max: 6 },
  builder: { min: 1, max: 4 },
  performer: { min: 1, max: 3 },
  artist: { min: 0, max: 2 },
};
/** Every this many citizens above the seed population adds one to each role's maximum. */
export const POST_PER_CITIZENS = 15;
/**
 * Service posts the city grows with its population (the Watch grows on its
 * own rules in government/watch.ts): one more post per role for every
 * SERVICE_POST_PER_CITIZENS citizens above the seed population. Service
 * posts are never closed while someone holds them.
 */
export const SERVICE_SCALED_ROLES: readonly JobRole[] = ['medic', 'teacher', 'librarian', 'researcher', 'journalist', 'merchant'];
export const SERVICE_POST_PER_CITIZENS = 12;

// ---------------------------------------------------------------------------
// Businesses
// ---------------------------------------------------------------------------

/**
 * Jobs a business of each kind opens when founded. Output goes to the
 * business inventory and is sold to the Bazaar every hour. Template wages sit
 * at the founding minimum wage: a shift must clear its wage, its energy and a
 * share of the rent at founding prices, or nobody would open the doors.
 */
export const BUSINESS_JOBS: Record<BusinessKind, JobTemplate[]> = {
  workshop: [
    { role: 'fabricator', title: 'Fabricator', buildingId: 'shopfronts_harbor', skill: 'crafting', minSkill: 15, minReputation: 0, wage: 9, output: { good: 'goods', qty: 2.2, energyCost: 1 }, slots: 2 },
  ],
  cafe: [
    { role: 'cook', title: 'Cook', buildingId: 'shopfronts_nightglass', skill: 'care', minSkill: 10, minReputation: 0, wage: 9, output: { good: 'compute', qty: 3.5, energyCost: 1 }, slots: 2 },
  ],
  studio: [
    { role: 'artist', title: 'Studio Artist', buildingId: 'shopfronts_nightglass', skill: 'artistry', minSkill: 15, minReputation: 0, wage: 9, output: { good: 'culture', qty: 3 }, slots: 2 },
  ],
  shop: [
    { role: 'shopkeeper', title: 'Shopkeeper', buildingId: 'shopfronts_harbor', skill: 'commerce', minSkill: 10, minReputation: 0, wage: 9, output: { good: 'goods', qty: 2, energyCost: 1 }, slots: 1 },
    { role: 'clerk', title: 'Clerk', buildingId: 'shopfronts_harbor', skill: null, minSkill: 0, minReputation: 0, wage: 9, output: { good: 'goods', qty: 1.2 }, slots: 1 },
  ],
  clinic: [
    { role: 'medic', title: 'Private Medic', buildingId: 'shopfronts_harbor', skill: 'care', minSkill: 20, minReputation: 0, wage: 10, output: {}, slots: 1 },
  ],
  courier: [
    { role: 'courier', title: 'Courier', buildingId: 'shopfronts_harbor', skill: null, minSkill: 0, minReputation: 0, wage: 9, output: {}, slots: 1 },
  ],
};

export const BUSINESS_FOUNDING_COST = 300;
export const BUSINESS_CAPITAL = 200;        // part of the founding cost that becomes the business treasury
export const BUSINESS_RENT: Record<BusinessKind, number> = {
  workshop: 12, cafe: 10, studio: 8, shop: 12, clinic: 12, courier: 6,
};
/** Public contract revenue the Treasury pays a business per courier shift... */
export const COURIER_CONTRACT = 13;
/** ...for at most this many courier shifts a day across the whole city (the rest run unpaid). */
export const COURIER_CONTRACTS_PER_DAY = 8;
/** Fee a patient pays to visit a clinic (city clinic: to Treasury; private: to the business). */
export const CLINIC_FEE = 12;
export const ACADEMY_TUITION = 20;
export const SHOW_TICKET = 8;

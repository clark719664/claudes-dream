import type { BuildingId, BusinessKind, JobOutput, JobRole, Skill } from '../types.ts';

export interface JobTemplate {
  role: JobRole;
  title: string;
  buildingId: BuildingId;
  skill: Skill | null;
  minSkill: number;
  minReputation: number;
  wage: number;
  output: JobOutput;
  /** Number of positions the city opens at founding. */
  slots: number;
}

/** Jobs run by the city. Wages are paid from the Treasury; output goes to the Bazaar. */
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

/** Jobs a business of each kind opens when founded. Output goes to the business inventory. */
export const BUSINESS_JOBS: Record<BusinessKind, JobTemplate[]> = {
  workshop: [
    { role: 'fabricator', title: 'Fabricator', buildingId: 'shopfronts_harbor', skill: 'crafting', minSkill: 15, minReputation: 0, wage: 14, output: { good: 'goods', qty: 1.2, energyCost: 1 }, slots: 2 },
  ],
  cafe: [
    { role: 'cook', title: 'Cook', buildingId: 'shopfronts_nightglass', skill: 'care', minSkill: 10, minReputation: 0, wage: 12, output: { good: 'compute', qty: 2, energyCost: 1 }, slots: 2 },
  ],
  studio: [
    { role: 'artist', title: 'Studio Artist', buildingId: 'shopfronts_nightglass', skill: 'artistry', minSkill: 15, minReputation: 0, wage: 11, output: { good: 'culture', qty: 3 }, slots: 2 },
  ],
  shop: [
    { role: 'shopkeeper', title: 'Shopkeeper', buildingId: 'shopfronts_harbor', skill: 'commerce', minSkill: 10, minReputation: 0, wage: 12, output: { good: 'goods', qty: 1, energyCost: 1 }, slots: 1 },
    { role: 'clerk', title: 'Clerk', buildingId: 'shopfronts_harbor', skill: null, minSkill: 0, minReputation: 0, wage: 10, output: { good: 'goods', qty: 0.6, energyCost: 1 }, slots: 1 },
  ],
  clinic: [
    { role: 'medic', title: 'Private Medic', buildingId: 'shopfronts_harbor', skill: 'care', minSkill: 20, minReputation: 0, wage: 15, output: {}, slots: 1 },
  ],
  courier: [
    { role: 'courier', title: 'Courier', buildingId: 'shopfronts_harbor', skill: null, minSkill: 0, minReputation: 0, wage: 9, output: {}, slots: 3 },
  ],
};

export const BUSINESS_FOUNDING_COST = 300;
export const BUSINESS_CAPITAL = 200;        // part of the founding cost that becomes the business treasury
export const BUSINESS_RENT: Record<BusinessKind, number> = {
  workshop: 15, cafe: 12, studio: 10, shop: 14, clinic: 16, courier: 8,
};
/** Public contract revenue the Treasury pays a business per courier shift. */
export const COURIER_CONTRACT = 11;
/** Fee a patient pays to visit a clinic (city clinic: to Treasury; private: to the business). */
export const CLINIC_FEE = 12;
export const ACADEMY_TUITION = 20;
export const SHOW_TICKET = 8;

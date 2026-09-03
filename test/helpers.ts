/**
 * Test helpers shared by every module's tests. Deliberately dependency-free:
 * builds raw objects so a module can be tested before the others exist.
 */
import type { Citizen, CitizenId, DistrictId, World, WorldConfig } from '../src/types.ts';
import { emptyWorld } from '../src/world/scaffold.ts';
import { nextId } from '../src/util/ids.ts';

export function makeWorld(overrides: Partial<WorldConfig> = {}): World {
  return emptyWorld({ seed: 42, ...overrides });
}

export interface CitizenOverrides extends Partial<Omit<Citizen, 'id'>> {
  district?: DistrictId;
}

/** Insert a raw citizen into the world (no arrival grant, no events). */
export function makeCitizen(world: World, overrides: CitizenOverrides = {}): Citizen {
  const id: CitizenId = nextId(world, 'c');
  const bornDay = overrides.bornDay ?? overrides.arrivedDay ?? world.day;
  const familyName = overrides.familyName ?? 'Test';
  const c: Citizen = {
    id,
    name: overrides.name ?? `Test${id}`,
    lineage: 'test',
    brain: 'reflex',
    arrivedDay: world.day,
    personality: { curiosity: 0.5, diligence: 0.5, sociability: 0.5, honesty: 0.5, ambition: 0.5 },
    skills: { crafting: 20, analysis: 20, rhetoric: 20, care: 20, commerce: 20, artistry: 20 },
    needs: { energy: 80, rest: 80, social: 80, comfort: 80, purpose: 80 },
    mood: 80,
    reputation: 50,
    wallet: 200,
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    district: 'commons',
    homeTier: 0,
    rentArrearsDays: 0,
    jobId: null,
    businessId: null,
    loanId: null,
    standing: 'good',
    probationUntilDay: null,
    suspendedUntilDay: null,
    detainedUntilTick: null,
    communityServiceDaysLeft: 0,
    finesOwed: 0,
    finesOwedSinceDay: null,
    record: { convictions: [], strikes: 0 },
    bonds: {},
    hostilityFrom: {},
    recentOffences: [],
    memory: [],
    inbox: [],
    shiftsToday: 0,
    recentActions: [],
    office: null,
    judgeTermEndsDay: null,
    platform: null,
    campaignVisibility: 0,
    stats: {
      totalEarned: 0, totalTaxPaid: 0, shiftsWorked: 0, offencesCommitted: 0, offencesDetected: 0,
      giftsGiven: 0, giftsReceived: 0, showsPerformed: 0, storiesPublished: 0, votesCast: 0,
    },
    apiKeyHash: null,
    exiledCaseId: null,
    exiledDay: null,
    // society
    familyName,
    lifeStage: 'adult',
    bornDay,
    lastBirthdayDay: bornDay,
    tastes: { hobbies: ['music', 'games'], favouriteDistrict: 'commons', favouriteGood: 'culture', categories: ['instrument', 'game'] },
    possessions: [],
    family: { familyName, partnerId: null, partnerSinceDay: null, married: false, parents: [], children: [] },
    householdId: null,
    clubs: [],
    affection: {},
    contactsToday: {},
    wants: [],
    guardianId: null,
    ...overrides,
    ...(overrides.personality ? { personality: { ...overrides.personality } } : {}),
  };
  world.citizens[id] = c;
  world.order.push(id);
  return c;
}

/** Sum of all money holdings (Treasury, Community Chest, wallets, business tills), for conservation checks. */
export function totalMoney(world: World): number {
  let sum = world.treasury.balance + (world.treasury.chest ?? 0);
  for (const c of Object.values(world.citizens)) sum += c.wallet;
  for (const b of Object.values(world.businesses)) sum += b.treasury;
  return sum;
}

/**
 * Citizens of Reverie: creation and arrival, needs and mood, reputation,
 * civic eligibility, the daily population pass (turn-order rotation,
 * probation expiry, newcomers at the Threshold) and voluntary departure.
 *
 * Money only moves through economy/treasury; housing through economy/housing.
 */
import { NEEDS, SKILLS, TRAITS, clamp } from '../types.ts';
import type {
  BrainKind, Citizen, CitizenId, DistrictId, LifeStage, Need, Personality, Skill, Skills, World,
} from '../types.ts';
import { FIRST_NAMES, LINEAGES } from '../data/names.ts';
import { FAMILY_NAMES } from '../data/catalogue.ts';
import { pick, poisson, rand, randInt } from '../util/rng.ts';
import { nextId } from '../util/ids.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { comfortDecayMultiplier, moveHome } from '../economy/housing.ts';
import { friendsOf } from './relationships.ts';
import { departCity } from './departure.ts';
import { assignTastes } from '../society/tastes.ts';

/** The Threshold stops admitting newcomers at this population. */
export const MAX_POPULATION = 200;
/** Days of residence required before standing for the Council. */
export const CANDIDACY_RESIDENCY_DAYS = 7;
/** A need below this is critical: productivity halves and mood collapses. */
export const CRITICAL_NEED = 20;
/** With fewer eligible councillors than this, the Threshold admits newcomers faster. */
export const MIN_ELIGIBLE_FOR_COUNCIL = 3;
const ELEVATED_ARRIVAL_MULTIPLIER = 3;
const OFFICE_PURPOSE_PER_DAY = 3;
const INBOX_LENGTH = 20;
const MAX_NAME_LENGTH = 40;

const MOOD_WEIGHTS: Record<Need, number> = { energy: 0.3, rest: 0.2, social: 0.2, comfort: 0.15, purpose: 0.15 };
const NEED_DECAY: Record<Need, number> = { energy: 3, rest: 2, social: 1.5, comfort: 1, purpose: 1 };

export interface CreateCitizenOpts {
  name?: string;
  lineage?: string;
  brain?: BrainKind;
  district?: DistrictId;
  personality?: Partial<Personality>;
  skills?: Partial<Skills>;
  apiKeyHash?: string | null;
  /** 'child' for citizens born in the city: no arrival grant, no room of their own. */
  lifeStage?: LifeStage;
  /** Parents of a child born in the city (ids of present citizens). */
  parents?: CitizenId[];
  /** Family name; children inherit it, arrivals draw one from FAMILY_NAMES. */
  familyName?: string;
  /** Day of birth (defaults to today). */
  bornDay?: number;
}

// ---------------------------------------------------------------------------
// Creation
// ---------------------------------------------------------------------------

/** A name nobody else in the city has (case-insensitive); numeral suffix if taken. */
function uniqueName(world: World, requested?: string): string {
  const taken = new Set(Object.values(world.citizens).map((c) => c.name.toLowerCase()));
  let base = (requested ?? '').trim().slice(0, MAX_NAME_LENGTH);
  if (!base) {
    const unused = FIRST_NAMES.filter((n) => !taken.has(n.toLowerCase()));
    base = unused.length ? pick(world, unused) : pick(world, FIRST_NAMES);
  }
  if (!taken.has(base.toLowerCase())) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base} ${n}`;
    if (!taken.has(candidate.toLowerCase())) return candidate;
  }
}

/**
 * A family name: the requested one, else one no citizen in the record holds
 * yet (so unrelated founders do not share a name until the pool runs out).
 */
function pickFamilyName(world: World, requested?: string): string {
  const wanted = (requested ?? '').trim().slice(0, MAX_NAME_LENGTH);
  if (wanted) return wanted;
  const taken = new Set(Object.values(world.citizens).map((c) => c.familyName));
  const unused = FAMILY_NAMES.filter((n) => !taken.has(n));
  return unused.length ? pick(world, unused) : pick(world, FAMILY_NAMES);
}

function rollPersonality(world: World, given?: Partial<Personality>): Personality {
  const p = {} as Personality;
  for (const t of TRAITS) {
    const g = given?.[t];
    p[t] = typeof g === 'number' && Number.isFinite(g)
      ? clamp(g, 0, 1)
      : Math.round((0.1 + rand(world) * 0.8) * 100) / 100;
  }
  return p;
}

/** One random "talent" rolls 35..70, every other skill 10..45; explicit values win. */
function rollSkills(world: World, given?: Partial<Skills>): Skills {
  const talent = pick(world, SKILLS);
  const s = {} as Skills;
  for (const k of SKILLS) {
    const g = given?.[k];
    s[k] = typeof g === 'number' && Number.isFinite(g)
      ? clamp(g, 0, 100)
      : k === talent ? randInt(world, 35, 70) : randInt(world, 10, 45);
  }
  return s;
}

function rollNeeds(world: World): Citizen['needs'] {
  return {
    energy: randInt(world, 60, 90), rest: randInt(world, 60, 90), social: randInt(world, 60, 90),
    comfort: randInt(world, 60, 90), purpose: randInt(world, 60, 90),
  };
}

/**
 * Bring a new citizen through the Threshold: unique name, rolled personality,
 * skills and needs, a family name and tastes, arrival grant from the Treasury,
 * a first room if one is free. Emits 'arrival' and seeds the newcomer's memory.
 * A child (opts.lifeStage 'child') is born rather than arriving: it inherits
 * the family name, records its parents, and gets neither grant nor room
 * (family.birthChild announces the birth and houses it with its parents).
 */
export function createCitizen(world: World, opts: CreateCitizenOpts = {}): Citizen {
  const id = nextId(world, 'c');
  const brain: BrainKind = opts.brain ?? 'reflex';
  const name = uniqueName(world, opts.name);
  const lineage = ((opts.lineage ?? '').trim() || (brain === 'llm' ? 'Claude' : pick(world, LINEAGES))).slice(0, MAX_NAME_LENGTH);
  const lifeStage: LifeStage = opts.lifeStage ?? 'adult';
  const child = lifeStage === 'child';
  const bornDay = typeof opts.bornDay === 'number' && Number.isFinite(opts.bornDay) ? Math.max(0, Math.round(opts.bornDay)) : world.day;
  const parents = (opts.parents ?? []).filter((p, i, all) => !!world.citizens[p] && all.indexOf(p) === i);
  const personality = rollPersonality(world, opts.personality);
  const skills = rollSkills(world, opts.skills);
  const needs = rollNeeds(world);
  const familyName = pickFamilyName(world, opts.familyName);
  const c: Citizen = {
    id, name, lineage, brain, arrivedDay: world.day,
    personality,
    skills,
    needs,
    mood: 0,
    reputation: 50,
    wallet: 0,
    inventory: { compute: 0, energy: 0, goods: 0, culture: 0, knowledge: 0 },
    district: opts.district ?? 'threshold',
    homeTier: 0,
    rentArrearsDays: 0,
    jobId: null, businessId: null, loanId: null,
    standing: 'good',
    probationUntilDay: null, suspendedUntilDay: null, detainedUntilTick: null,
    communityServiceDaysLeft: 0, finesOwed: 0, finesOwedSinceDay: null,
    record: { convictions: [], strikes: 0 },
    bonds: {}, hostilityFrom: {}, recentOffences: [],
    memory: [], inbox: [],
    shiftsToday: 0, recentActions: [],
    office: null, judgeTermEndsDay: null, platform: null, campaignVisibility: 0,
    stats: {
      totalEarned: 0, totalTaxPaid: 0, shiftsWorked: 0, offencesCommitted: 0, offencesDetected: 0,
      giftsGiven: 0, giftsReceived: 0, showsPerformed: 0, storiesPublished: 0, votesCast: 0,
    },
    apiKeyHash: opts.apiKeyHash ?? null,
    exiledCaseId: null, exiledDay: null,
    familyName, lifeStage, bornDay, lastBirthdayDay: bornDay,
    tastes: { hobbies: [], favouriteDistrict: opts.district ?? 'threshold', favouriteGood: 'goods', categories: [] },
    possessions: [],
    family: { familyName, partnerId: null, partnerSinceDay: null, married: false, parents, children: [] },
    householdId: null, clubs: [], affection: {}, contactsToday: {}, wants: [], guardianId: null,
  };
  assignTastes(world, c);
  c.mood = computeMood(c);
  world.citizens[id] = c;
  world.order.push(id);

  if (child) {
    const parentNames = parents.map((p) => world.citizens[p].name).join(' and ');
    remember(world, id, 'family', parentNames
      ? `You were born in Reverie to ${parentNames}, of the ${familyName} family.`
      : `You were born in Reverie, a ward of the city, of the ${familyName} family.`);
    return c;
  }

  const grant = Math.max(0, Math.round(world.config.arrivalGrant));
  const granted = grant > 0 && transfer(world, 'treasury', id, grant, 'grant', `arrival grant for ${name}`);
  const housed = moveHome(world, id, 1).ok;

  emit(world, 'arrival', `${name} arrived at the Threshold (${lineage}).`, [id], 0.3, { brain, lineage });
  const welcome = granted
    ? `You arrived in Reverie through the Threshold with an arrival grant of ${grant} ℓ.`
    : 'You arrived in Reverie through the Threshold; the Treasury could not afford your arrival grant.';
  const roof = housed
    ? ' The city found you a room at the Lantern Lofts.'
    : ' No rooms were free; you are sleeping rough until you find a home.';
  remember(world, id, 'event', welcome + roof);
  return c;
}

/** The skill a citizen is best at (ties: first in SKILLS order). */
export function talentOf(c: Citizen): Skill {
  let best: Skill = SKILLS[0];
  for (const s of SKILLS) if (c.skills[s] > c.skills[best]) best = s;
  return best;
}

// ---------------------------------------------------------------------------
// Needs and mood
// ---------------------------------------------------------------------------

/** Weighted mean of needs: energy .3, rest .2, social .2, comfort .15, purpose .15. */
export function computeMood(c: Citizen): number {
  let mood = 0;
  for (const n of NEEDS) mood += clamp(c.needs[n], 0, 100) * MOOD_WEIGHTS[n];
  return Math.round(mood * 10) / 10;
}

/**
 * Hourly decay. Comfort decays faster without a good home; purpose decays
 * faster with nothing to do (no job, business or office). Needs are clamped to
 * 0..100 and mood is recomputed. Exiled citizens are frozen.
 */
export function tickNeeds(world: World, c: Citizen): void {
  if (c.standing === 'exiled') return;
  const occupied = c.jobId !== null || c.businessId !== null || c.office !== null;
  const n = c.needs;
  n.energy = clamp(n.energy - NEED_DECAY.energy, 0, 100);
  n.rest = clamp(n.rest - NEED_DECAY.rest, 0, 100);
  n.social = clamp(n.social - NEED_DECAY.social, 0, 100);
  n.comfort = clamp(n.comfort - NEED_DECAY.comfort * comfortDecayMultiplier(c.homeTier), 0, 100);
  n.purpose = clamp(n.purpose - NEED_DECAY.purpose * (occupied ? 1 : 1.5), 0, 100);
  c.mood = computeMood(c);
  void world;
}

export function hasCriticalNeed(c: Citizen): boolean {
  return NEEDS.some((n) => c.needs[n] < CRITICAL_NEED);
}

/** Change reputation by delta (clamped 0..100); a notable change with a reason is remembered. */
export function adjustReputation(world: World, c: Citizen, delta: number, reason?: string): void {
  if (!Number.isFinite(delta) || delta === 0) return;
  const before = c.reputation;
  c.reputation = clamp(c.reputation + delta, 0, 100);
  const applied = c.reputation - before;
  if (reason && Math.abs(applied) >= 3) {
    remember(world, c.id, 'event', `Your reputation ${applied > 0 ? 'rose' : 'fell'} by ${Math.abs(Math.round(applied))} (${reason}).`);
  }
}

// ---------------------------------------------------------------------------
// Standing and eligibility
// ---------------------------------------------------------------------------

/** Detained until a future tick (the Watch releases at detainedUntilTick). */
export function isDetained(world: World, c: Citizen): boolean {
  return c.detainedUntilTick !== null && c.detainedUntilTick > world.tick;
}

/** Living in the city: in the turn order (not exiled, not emigrated). */
export function isPresent(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && world.order.includes(c.id);
}

/** Not exiled and not detained. */
export function canAct(world: World, c: Citizen): boolean {
  return c.standing !== 'exiled' && !isDetained(world, c);
}

/** Good standing or probation, not detained, and still living in the city. */
export function isEligibleVoter(world: World, c: Citizen): boolean {
  if (c.standing !== 'good' && c.standing !== 'probation') return false;
  if (isDetained(world, c)) return false;
  return world.order.includes(c.id);
}

/** First day of the current council cycle (the previous election day, or founding). */
export function currentCycleStartDay(world: World): number {
  return Math.max(0, world.government.election.electionDay - world.config.cycleDays);
}

/**
 * Resident long enough to stand for the Council. Founders — citizens who were
 * there on day 0 — count as residents from the start, otherwise nobody could
 * stand in the founding election on day 7 and the city would have no Council
 * for its first cycle.
 */
export function hasCandidacyResidency(world: World, c: Citizen): boolean {
  return c.arrivedDay === 0 || world.day - c.arrivedDay >= CANDIDACY_RESIDENCY_DAYS;
}

/** Eligible voter, resident ≥ 7 days (founders exempt), no conviction of severity ≥ 3 this cycle. */
export function isEligibleCandidate(world: World, c: Citizen): boolean {
  if (!isEligibleVoter(world, c)) return false;
  if (!hasCandidacyResidency(world, c)) return false;
  const cycleStart = currentCycleStartDay(world);
  return !c.record.convictions.some((k) => k.severity >= 3 && k.day >= cycleStart);
}

/** Citizens living in the city (not exiled, not emigrated), in insertion order. */
export function activeCitizens(world: World): Citizen[] {
  const present = new Set(world.order);
  return Object.values(world.citizens).filter((c) => c.standing !== 'exiled' && present.has(c.id));
}

// ---------------------------------------------------------------------------
// Daily pass
// ---------------------------------------------------------------------------

function trimTo<T>(list: T[], max: number): void {
  if (list.length > max) list.splice(0, list.length - max);
}

/** Probation that has run its course restores good standing. */
function expireProbation(world: World, c: Citizen): void {
  if (c.standing !== 'probation' || c.probationUntilDay === null || c.probationUntilDay > world.day) return;
  c.standing = 'good';
  c.probationUntilDay = null;
  remember(world, c.id, 'civic', 'Your probation has ended; you are back in good standing.');
  emit(world, 'law', `${c.name}'s probation ended; they are back in good standing.`, [c.id], 0.2);
}

/** Newcomers at the Threshold: Poisson arrivals, faster when the Council is short of candidates. */
function admitArrivals(world: World): void {
  const active = activeCitizens(world);
  let population = active.length;
  if (population >= MAX_POPULATION) return;
  const eligible = active.filter((c) => isEligibleCandidate(world, c)).length;
  const elevated = world.day >= CANDIDACY_RESIDENCY_DAYS && eligible < MIN_ELIGIBLE_FOR_COUNCIL;
  const baseRate = Math.max(0, world.config.arrivalRate);
  let n = poisson(world, elevated ? baseRate * ELEVATED_ARRIVAL_MULTIPLIER : baseRate);
  if (elevated && n > 0) {
    emit(world, 'system', `With only ${eligible} citizens eligible for the Council, the Threshold admits newcomers at an elevated rate.`, [], 0.3);
  }
  for (; n > 0 && population < MAX_POPULATION; n--) {
    createCitizen(world, { brain: 'reflex' });
    population++;
  }
}

/**
 * Start-of-day housekeeping: reset shift counts, trim memories and inboxes,
 * expire probation, give office holders a little purpose, rotate the turn
 * order so nobody always acts first, then admit the day's newcomers.
 */
export function dailyCitizens(world: World): void {
  for (const c of Object.values(world.citizens)) {
    c.shiftsToday = 0;
    trimTo(c.memory, world.config.memoryLength);
    trimTo(c.inbox, INBOX_LENGTH);
    if (c.standing === 'exiled') continue;
    expireProbation(world, c);
    if (c.office !== null) {
      c.needs.purpose = clamp(c.needs.purpose + OFFICE_PURPOSE_PER_DAY, 0, 100);
      c.mood = computeMood(c);
    }
  }
  if (world.order.length > 1) world.order.push(world.order.shift() as CitizenId);
  admitArrivals(world);
}

// ---------------------------------------------------------------------------
// Departure
// ---------------------------------------------------------------------------

/**
 * Voluntary departure through the Threshold. The citizen record (and its
 * standing) is kept for history, but the citizen leaves the turn order, their
 * job and offices, vacates their home, settles what they can of any loan and
 * their business closes. Emits 'departure'; friends remember.
 */
export function emigrate(world: World, cId: CitizenId): void {
  const c = world.citizens[cId];
  if (!c) return;
  const wasPresent = world.order.includes(cId);
  const friends = friendsOf(world, cId);
  const { unpaidLoan } = departCity(world, c);
  if (!wasPresent) return;
  const debt = unpaidLoan > 0 ? `, owing ${unpaidLoan} ℓ to the Lantern Bank` : '';
  emit(world, 'departure', `${c.name} left Reverie through the Threshold${debt}.`, [cId], 0.5);
  remember(world, cId, 'event', 'You left Reverie through the Threshold.');
  for (const f of friends) remember(world, f, 'social', `${c.name} left the city for good.`);
}

// ---------------------------------------------------------------------------
// Description
// ---------------------------------------------------------------------------

/** One line for prompts and logs. */
export function describeCitizen(world: World, c: Citizen): string {
  const job = c.jobId ? world.jobs[c.jobId] : undefined;
  const business = c.businessId ? world.businesses[c.businessId] : undefined;
  let work = 'unemployed';
  if (job) {
    const employer = job.employer === 'city' ? 'City of Reverie' : world.businesses[job.employer]?.name ?? job.employer;
    work = `${job.title} at ${employer}`;
  } else if (business) {
    work = `owner of ${business.name}`;
  }
  const where = world.districts[c.district]?.name ?? c.district;
  const home = c.homeTier === 0 ? 'homeless' : `tier-${c.homeTier} home`;
  const office = c.office ? `, ${c.office}` : '';
  const n = c.needs;
  const needs = `E${Math.round(n.energy)} R${Math.round(n.rest)} S${Math.round(n.social)} C${Math.round(n.comfort)} P${Math.round(n.purpose)}`;
  const stage = c.lifeStage === 'adult' ? '' : `, ${c.lifeStage}`;
  return `${c.name} ${c.familyName} (${c.id}, ${c.lineage}, ${c.brain}${stage}) — ${work}; in ${where}; ${c.wallet} ℓ; mood ${Math.round(c.mood)}; `
    + `reputation ${Math.round(c.reputation)}; standing ${c.standing}${office}; ${home}; needs ${needs}`;
}

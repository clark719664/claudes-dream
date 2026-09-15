/**
 * What the city actually holds, and what holding it is worth
 * (`docs/PROGRESS.md` §§2–3).
 *
 * This is the read side of the layer: every other module asks its questions
 * here, through a named function, and never by reaching into the register.
 * Two ideas run through all of it.
 *
 * **Knowing is not using.** A discovery is a line in the Hall of Records until
 * the works are built and the workers are trained:
 *
 * ```
 * readiness = min(1, worksPaid / worksCost)          worksCost = 400 ℓ × tier
 * uptake    = trained / postsAffected                trained after 3 shifts under the works
 * effect    = fullEffect × readiness × (0.4 + 0.6 × uptake)
 * ```
 *
 * Dig the drains and train nobody and you get 40 % of sanitation; train hands
 * and dig nothing and you get none of it.
 *
 * **A secret is not the city's.** A subject a guild or a business kept is held
 * by its masters and by nobody else: it is not in the city's prerequisites, it
 * is not in anybody else's observation, and the Council cannot vote works for
 * something it has not been told. What a master knows, a master may build on.
 */
import { clamp } from '../types.ts';
import type { BusinessId, Citizen, CitizenId, DistrictId, World } from '../types.ts';
import type { Adoption, TechnologyRecord } from './state.ts';
import { progressState, worksKey } from './state.ts';
import type { EffectKey, Technology, TechnologyId, Unlock } from './tree.ts';
import { TECHNOLOGIES, TECHNOLOGY_IDS, technology, worksCost } from './tree.ts';

/** Shifts under the works that make a worker trained — and a traveller familiar. */
export const SHIFTS_TO_TRAIN = 3;
/** The share of an effect that arrives with the works alone, before anybody is trained. */
export const UNTRAINED_SHARE = 0.4;

// ---------------------------------------------------------------------------
// What is held
// ---------------------------------------------------------------------------

export function technologyRecord(world: World, id: TechnologyId): TechnologyRecord | null {
  const rec = progressState(world).technologies[id];
  return rec && rec.lostDay === null ? rec : null;
}

/** True while the technique is a secret rather than the city's own. */
export function isSecret(world: World, id: TechnologyId): boolean {
  return technologyRecord(world, id)?.secret === true;
}

/** Who may work a secret. Empty for a published subject: everybody may. */
export function mastersOf(world: World, id: TechnologyId): CitizenId[] {
  const rec = technologyRecord(world, id);
  return rec && rec.secret ? [...rec.masters] : [];
}

export function isMasterOf(world: World, cId: CitizenId, id: TechnologyId): boolean {
  return mastersOf(world, id).includes(cId);
}

/**
 * Does the city hold this subject openly? A secret does not answer yes: the
 * Hall of Records has no line for it, so the Council cannot adopt it and no
 * project may be built on it by anyone but a master.
 */
export function cityHolds(world: World, id: TechnologyId): boolean {
  const rec = technologyRecord(world, id);
  return !!rec && !rec.secret;
}

/** Everything the city holds openly, in tree order. */
export function heldTechnologies(world: World): TechnologyId[] {
  return TECHNOLOGY_IDS.filter((id) => cityHolds(world, id));
}

/** Every subject in the register, secrets included — the observer's view, never a citizen's. */
export function allHeld(world: World): TechnologyId[] {
  return TECHNOLOGY_IDS.filter((id) => technologyRecord(world, id) !== null);
}

/**
 * What one citizen may build on: everything the city holds, plus every secret
 * they are a master of. A master can carry their own branch further; nobody
 * else can carry a branch they were never told about.
 */
export function heldFor(world: World, cId: CitizenId): TechnologyId[] {
  return TECHNOLOGY_IDS.filter((id) => cityHolds(world, id) || isMasterOf(world, cId, id));
}

/** May this citizen be told this subject exists at all? */
export function visibleTo(world: World, cId: CitizenId, id: TechnologyId): boolean {
  return cityHolds(world, id) || isMasterOf(world, cId, id);
}

// ---------------------------------------------------------------------------
// The works
// ---------------------------------------------------------------------------

/** The city's works for a subject, or null where the Council has voted none. */
export function cityWorks(world: World, id: TechnologyId): Adoption | null {
  return progressState(world).adoptions[id] ?? null;
}

/** One business's own works for a subject, or null. */
export function businessWorks(world: World, businessId: BusinessId, id: TechnologyId): Adoption | null {
  return progressState(world).businessWorks[worksKey(businessId, id)] ?? null;
}

/** Posts an adoption has to train: a business's own, or every post held in the city. */
export function postsAffected(world: World, a: Adoption): number {
  if (a.businessId) {
    const biz = world.businesses[a.businessId];
    const posts = biz ? biz.jobs.filter((j) => world.jobs[j]?.holderId).length : 0;
    return Math.max(1, posts);
  }
  let held = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    if (c && c.jobId && world.jobs[c.jobId]?.holderId === c.id) held++;
  }
  return Math.max(1, held);
}

export function readinessOf(a: Adoption | null): number {
  if (!a || a.worksCost <= 0) return 0;
  return clamp(a.worksPaid / a.worksCost, 0, 1);
}

export function uptakeOf(world: World, a: Adoption | null): number {
  if (!a) return 0;
  return clamp(a.trained.length / postsAffected(world, a), 0, 1);
}

/** `readiness × (0.4 + 0.6 × uptake)`: what share of an effect has actually arrived. */
export function adoptionStrength(world: World, a: Adoption | null): number {
  if (!a) return 0;
  return clamp(readinessOf(a) * (UNTRAINED_SHARE + (1 - UNTRAINED_SHARE) * uptakeOf(world, a)), 0, 1);
}

/**
 * How much of a technology's effect the city is getting, 0 when it does not
 * hold the subject, has voted no works, or has trained nobody at all.
 *
 * A business gets the better of the city's works and its own: a workshop that
 * paid for its own drains is not made worse off by the Council finally voting
 * for some.
 */
export function effectStrength(world: World, id: TechnologyId, businessId?: BusinessId | null): number {
  const owner = businessId ? world.businesses[businessId]?.ownerId ?? null : null;
  const known = cityHolds(world, id) || (owner ? isMasterOf(world, owner, id) : false);
  if (!known) return 0;
  const city = cityHolds(world, id) ? adoptionStrength(world, cityWorks(world, id)) : 0;
  const own = businessId ? adoptionStrength(world, businessWorks(world, businessId, id)) : 0;
  return Math.max(city, own);
}

// ---------------------------------------------------------------------------
// Reading an effect
// ---------------------------------------------------------------------------

/**
 * The city's multiplier for one number: every held-and-adopted technology's
 * full multiplier, each scaled by how far it has actually arrived, multiplied
 * together. 1 when nothing touches it.
 */
export function multiplier(world: World, key: EffectKey, businessId?: BusinessId | null): number {
  let out = 1;
  for (const id of TECHNOLOGY_IDS) {
    const full = TECHNOLOGIES[id].multipliers[key];
    if (full === undefined) continue;
    const strength = effectStrength(world, id, businessId);
    if (strength <= 0) continue;
    out *= 1 + (full - 1) * strength;
  }
  return out;
}

/** The city's additive change to one number, scaled the same way. 0 when nothing touches it. */
export function delta(world: World, key: EffectKey, businessId?: BusinessId | null): number {
  let out = 0;
  for (const id of TECHNOLOGY_IDS) {
    const full = TECHNOLOGIES[id].deltas[key];
    if (full === undefined) continue;
    const strength = effectStrength(world, id, businessId);
    if (strength <= 0) continue;
    out += full * strength;
  }
  return out;
}

/**
 * Is a door open? A door is not a quantity: it opens when the city holds the
 * subject that opens it, and the works that follow are what the door is *for*.
 * (The tram is the case that matters: the works are the tram line itself.)
 */
export function unlocked(world: World, door: Unlock): boolean {
  for (const id of TECHNOLOGY_IDS) {
    if (!TECHNOLOGIES[id].unlocks.includes(door)) continue;
    if (cityHolds(world, id)) return true;
  }
  return false;
}

/** Which subject opens a door, for a message that says what is missing. */
export function doorKeeper(door: Unlock): Technology | null {
  for (const id of TECHNOLOGY_IDS) {
    if (TECHNOLOGIES[id].unlocks.includes(door)) return TECHNOLOGIES[id];
  }
  return null;
}

// ---------------------------------------------------------------------------
// The named readings the rest of the engine asks for
// ---------------------------------------------------------------------------

/** Comfort decays this much slower with the Loom in the city (`housing.comfortDecayMultiplier` × this). */
export function comfortDecayMultiplier(world: World): number {
  return multiplier(world, 'comfortDecay');
}

/** Goods off an attire or furniture recipe (a negative number). */
export function attireGoodsDiscount(world: World, businessId?: BusinessId | null): number {
  return delta(world, 'attireGoods', businessId) + delta(world, 'recipeGoods', businessId);
}

/** Goods off every other craft recipe. */
export function recipeGoodsDiscount(world: World, businessId?: BusinessId | null): number {
  return delta(world, 'recipeGoods', businessId);
}

/** What one shift produces, against what it produced on founding day. */
export function outputMultiplier(
  world: World, opts: { buildingId?: string; good?: string; businessId?: BusinessId | null } = {},
): number {
  let out = 1;
  const biz = opts.businessId ?? null;
  if (opts.buildingId === 'power_station' || opts.buildingId === 'fabrication_works') {
    out *= multiplier(world, 'producerOutput', biz);
  }
  if (opts.good === 'compute') out *= multiplier(world, 'computeOutput', biz);
  if (biz) out *= multiplier(world, 'businessOutput', biz);
  return out;
}

/** A graded tool in the hand of its owner: what the grade is worth to a shift. */
export function toolGradeBonus(world: World, businessId?: BusinessId | null): number {
  return delta(world, 'toolOutput', businessId);
}

/** A fabricator's post asks this much less skill. */
export function minSkillRelief(world: World): number {
  return delta(world, 'fabricatorMinSkill');
}

/** The Academy teaches analysis this much faster. */
export function academyMultiplier(world: World): number {
  return multiplier(world, 'academyAnalysis');
}

/** What the Lens adds to an hour of research. */
export function researchInsightBonus(world: World): number {
  return delta(world, 'researchInsight');
}

/** What a producing building actually puts into the air. */
export function emissionMultiplier(world: World, businessId?: BusinessId | null): number {
  return multiplier(world, 'emission', businessId);
}

/** Glitches begin at this much of their old rate, and spread at this much of theirs. */
export function glitchOnsetMultiplier(world: World): number {
  return multiplier(world, 'glitchOnset');
}

export function glitchSpreadMultiplier(world: World): number {
  return multiplier(world, 'glitchSpread');
}

/** The Ward's chance of a cure, from a base of 0.60. */
export function wardCureChance(world: World, base: number): number {
  return clamp(base + delta(world, 'wardCure'), 0, 1);
}

/** Glitches in the city before it is an outbreak, from a base of 3. */
export function outbreakThreshold(world: World, base: number): number {
  return Math.max(1, Math.round(base + delta(world, 'outbreakThreshold')));
}

/** Leagues a road carries in a tick, from a base of 8. */
export function roadSpeed(world: World, base: number): number {
  return base + delta(world, 'roadSpeed');
}

export function routeDecayMultiplier(world: World): number {
  return multiplier(world, 'routeDecay');
}

export function riverSpeedMultiplier(world: World): number {
  return multiplier(world, 'riverSpeed');
}

export function riverCapacityMultiplier(world: World): number {
  return multiplier(world, 'riverCapacity');
}

export function spoilageMultiplier(world: World): number {
  return multiplier(world, 'spoilage');
}

/** Days of cover the Bazaar will hold before it stops buying, from a base of 6. */
export function glutDays(world: World, base: number): number {
  return base + delta(world, 'glutDays');
}

export function seaCargoMultiplier(world: World): number {
  return multiplier(world, 'seaCargo');
}

export function stormHazardMultiplier(world: World): number {
  return multiplier(world, 'stormHazard');
}

export function travelHazardMultiplier(world: World): number {
  return multiplier(world, 'travelHazard');
}

/**
 * What the books add to the chance of noticing an offence: open books make tax
 * evasion and insider dealing visible in a way no officer on a corner can.
 */
export function lawVisibilityBonus(world: World, code: string): number {
  if (code === 'L03') return delta(world, 'evasionVisibility');
  if (code === 'L17') return delta(world, 'insiderVisibility');
  return 0;
}

/** How far a rumour or a trend travels in a day, against the founding city. */
export function rumourReachMultiplier(world: World): number {
  return multiplier(world, 'rumourReach');
}

export function trendReachMultiplier(world: World): number {
  return multiplier(world, 'trendReach');
}

/** The ceiling a famine drives the staple to, from a base of 1.6× the anchor. */
export function famineCeiling(world: World, base: number): number {
  return Math.max(1, base + delta(world, 'famineCeiling'));
}

/** The labour plan's forge maximum, cut by the seed drill. */
export function forgeMaximumMultiplier(world: World): number {
  return multiplier(world, 'forgeMaximum');
}

/** What making a unit of energy is anchored at, against the founding anchor. */
export function energyAnchorMultiplier(world: World): number {
  return multiplier(world, 'energyAnchor');
}

// ---------------------------------------------------------------------------
// The tram (`REGISTRY.md` §7)
// ---------------------------------------------------------------------------

/**
 * **The gate the registry asks for.** METROPOLIS's tram was buildable from day
 * one; it needs The Tram now. The Council may still table and pass the
 * proposal — a city may vote for whatever it likes — but the works are not
 * possible until somebody has discovered how a tram works, so
 * `world/growth.ts enactTram` is asked this question first and prints the
 * shortfall the way it already prints the fund's.
 *
 * A secret does not open it: the Council cannot lay rails on a technique it
 * has not been told. Publish it, sell it or teach it to the city, and it can.
 */
export function tramAllowed(world: World): boolean {
  return unlocked(world, 'tram');
}

/** Whether the line may be laid, and why not when it may not — in the Chronicle's own words. */
export function tramGate(world: World): { ok: boolean; message: string } {
  if (tramAllowed(world)) return { ok: true, message: 'The Tram is known; the line can be laid.' };
  const keeper = doorKeeper('tram');
  const secret = keeper ? isSecret(world, keeper.id) : false;
  return {
    ok: false,
    message: secret
      ? 'The tram cannot be laid: how a tram works is a secret the city has not been told.'
      : 'The tram cannot be laid: the city has not discovered The Tram.',
  };
}

// ---------------------------------------------------------------------------
// Training, familiarity and the amenity of works
// ---------------------------------------------------------------------------

/**
 * A shift worked under the works. Every live adoption that covers this citizen
 * counts it: the city's, and their employer's own. Three shifts trains them,
 * which is what uptake counts — and makes them *familiar* with the subject,
 * which is what a traveller carries down the road (`PROGRESS.md` §4).
 *
 * Called once per shift by the layer that runs shifts.
 */
export function trainShift(world: World, cId: CitizenId, businessId: BusinessId | null = null): TechnologyId[] {
  const s = progressState(world);
  const c = world.citizens[cId];
  if (!c) return [];
  const trained: TechnologyId[] = [];
  const works: Adoption[] = [];
  for (const id of TECHNOLOGY_IDS) {
    const a = s.adoptions[id];
    if (a && a.worksPaid > 0 && cityHolds(world, id)) works.push(a);
  }
  if (businessId) {
    for (const id of TECHNOLOGY_IDS) {
      const a = s.businessWorks[worksKey(businessId, id)];
      if (a && a.worksPaid > 0) works.push(a);
    }
  }
  for (const a of works) {
    a.shifts[cId] = (a.shifts[cId] ?? 0) + 1;
    if (a.shifts[cId] < SHIFTS_TO_TRAIN || a.trained.includes(cId)) continue;
    a.trained.push(cId);
    trained.push(a.technology);
    const list = (s.familiar[cId] ??= []);
    if (!list.includes(a.technology)) list.push(a.technology);
  }
  return trained;
}

/** Subjects this citizen has worked under long enough to teach elsewhere. */
export function familiarWith(world: World, cId: CitizenId): TechnologyId[] {
  return [...(progressState(world).familiar[cId] ?? [])];
}

export function isFamiliar(world: World, cId: CitizenId, id: TechnologyId): boolean {
  return familiarWith(world, cId).includes(id);
}

/**
 * Adopted works are buildings, so they lift the land where they stand
 * (`PROPERTY.md` §1): drains, a tram stop and a printing house are worth
 * something to a district's amenity. This is that term — the count of works
 * standing in a district, weighted by how far each is actually built.
 */
export function worksAmenity(world: World, district: DistrictId): number {
  const s = progressState(world);
  let sum = 0;
  for (const id of TECHNOLOGY_IDS) {
    const a = s.adoptions[id];
    if (!a || !a.districts.includes(district)) continue;
    sum += readinessOf(a);
  }
  for (const a of Object.values(s.businessWorks)) {
    if (!a.districts.includes(district)) continue;
    sum += readinessOf(a) * 0.5;
  }
  return Math.round(sum * 100) / 100;
}

/** One line for the Chronicle: what the city knows, and what it has built. */
export function describeProgress(world: World): string {
  const held = heldTechnologies(world);
  const s = progressState(world);
  const building = TECHNOLOGY_IDS.filter((id) => {
    const a = s.adoptions[id];
    return a && a.worksPaid < a.worksCost;
  });
  const secrets = TECHNOLOGY_IDS.filter((id) => isSecret(world, id)).length;
  const parts = [`${held.length} of ${TECHNOLOGY_IDS.length} technologies held`];
  if (building.length > 0) parts.push(`${building.length} in the works`);
  if (secrets > 0) parts.push(`${secrets} kept secret`);
  return `${parts.join('; ')}.`;
}

/** Everything a citizen may work a research shift on: an analysis of 30 and a building that will have them. */
export function mayResearch(c: Citizen): boolean {
  return (c.skills?.analysis ?? 0) >= 30;
}

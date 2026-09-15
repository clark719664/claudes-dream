/**
 * The reflex brain and the air (`docs/ENVIRONMENT.md`).
 *
 * The hard fact this layer is built on is that **abatement pays the wrong
 * person**: a scrubber costs its owner the capital, the upkeep and a cell a
 * shift, and the forty lumens a day it is worth land on the landlords downwind.
 * A scripted mind is not going to be public-spirited about that, and it is not
 * asked to be. What it reads instead is its own bill and its own address:
 *
 * - an owner fits a stack when the **emission charge** makes the motes cost
 *   more than the fitting does, when a neighbour has already sued, or when the
 *   owner lives in the district it is dirtying — and it picks the *tall stack*,
 *   which cleans nothing and moves the smoke, when it does not live there;
 * - a worker or an owner **maintains** what is fitted, because a fitting at
 *   half its rating is the upkeep with none of the benefit;
 * - a citizen short of money and not much troubled by the law **opens the
 *   bypass** and saves the upkeep and the cell, which is L45;
 * - somebody living under a reading that is climbing **files a reading**, and
 *   a reading downstream is exactly what makes the next bypass provable;
 * - somebody with an hour and no shift **plants**, most readily where they live
 *   and where there is least standing;
 * - a resident of a district the smoke has settled over **petitions** its
 *   permit, and a poor citizen in a district with no work petitions the other
 *   way — which is §6, and both are the same action;
 * - a councillor who holds land near a zoning question **declares** it, or
 *   quietly does not, and the register and the roll are both public either way;
 * - and a household breathing somebody else's stack **sues** on the docket,
 *   which needs no conviction and no Watch.
 */
import type { Action, BuildingId, Citizen, DistrictId, World } from '../types.ts';
import { chance } from '../util/rng.ts';
import { isOpen } from '../world/growth.ts';
import { bondBetween } from '../citizens/relationships.ts';
import { FITTING_SPECS, districtEnvironment, environmentState, fittingOn, permitOf } from '../environment/state.ts';
import type { Fitting, Permit } from '../environment/state.ts';
import { motesForShift, shiftsUnder } from '../environment/emissions.ts';
import { greeneryOf, pollutionBurden, recentReading } from '../environment/readings.ts';
import { airLevel, waterLevel } from '../environment/state.ts';
import { openGround } from '../environment/greenery.ts';
import { emissionsBy } from '../environment/nuisance.ts';
import { holdingsNear, zoningGain } from '../environment/interests.ts';
import { environmentQuestionOf } from '../environment/proposals.ts';
import { residentsOf } from '../environment/zoning.ts';
import { homeDistrict, nuisanceDefendants, stacksReachable } from '../actions/execute-environment.ts';
import { stepTo } from './reflex-util.ts';
import type { Ctx } from './reflex-util.ts';

/** A fitting below this share of its rating is worth a shift to put right. */
export const MAINTAIN_AT = 0.9;
/** Air at or above this is a district somebody would read, plant in, or petition about. */
export const NOTICEABLE_AIR = 0.12;
/** And the reading at which a resident starts thinking about the permit itself. */
export const PETITION_AIR = 0.3;
/** Greenery below this leaves room worth planting into. */
export const SPARSE_GREENERY = 0.5;
/** Chance per free hour that a citizen who would plant, plants. */
export const PLANT_CHANCE = 0.05;
/** Chance per free hour that somebody who would read the air reads it. */
export const SURVEY_CHANCE = 0.12;
/** Days between one citizen's readings of the same district. */
export const SURVEY_INTERVAL_DAYS = 2;
/** Chance per hour that an owner who would abate does. */
export const INSTALL_CHANCE = 0.25;
/** What a business keeps in the till whatever it fits. */
export const FITTING_RESERVE = 150;
/** Chance per shift-hour that a citizen who would bypass the fitting does. */
export const DISCHARGE_CHANCE = 0.12;
/** Chance per free hour that a resident weighs putting its district's permit to the city. */
export const PETITION_CHANCE = 0.02;
/** Days between one citizen's petitions, whatever comes of them. */
export const PETITION_INTERVAL_DAYS = 21;
/**
 * Chance per free hour that a neighbour breathing somebody's stack sues over
 * it, and the days between one household's suits. A nuisance is a pointed act
 * and a filing fee, not a habit: the docket sits twice a week and a city that
 * files two hundred of them in a season has stopped meaning any of them.
 */
export const NUISANCE_CHANCE = 0.02;
export const NUISANCE_INTERVAL_DAYS = 14;
/** Motes reaching an address below this are not worth a claim. */
export const NUISANCE_MOTES = 1;
/** And the reading at which a household is actually being harmed. */
export const NUISANCE_BURDEN = 0.15;
/** The filing fee wants a wallet behind it. */
export const NUISANCE_WALLET = 120;

/** What the citizen's own address is breathing. */
function burdenAtHome(world: World, c: Citizen): number {
  return pollutionBurden(world, homeDistrict(world, c));
}

/** What one day of this building's shifts would cost its owner under the charge. */
export function chargeAtRisk(world: World, buildingId: BuildingId): number {
  const rate = environmentState(world).charge;
  if (rate <= 0) return 0;
  const jobs = Object.values(world.jobs).filter((j) => j.buildingId === buildingId && j.holderId !== null);
  const perShift = jobs.reduce((sum, j) => sum + motesForShift(world, j), 0);
  const shifts = Math.max(1, shiftsUnder(world, buildingId));
  const share = jobs.length > 0 ? perShift / jobs.length : 0;
  return rate * share * shifts;
}

/**
 * Which fitting an owner buys, which is a question about where they sleep. A
 * tall stack is the cheapest thing on the table, cleans nothing at all, and
 * makes the smoke somebody else's; an owner who lives under their own stack
 * does not buy one.
 */
export function fittingFor(world: World, c: Citizen, buildingId: BuildingId, purse: number): Fitting | null {
  const district = world.buildings[buildingId]?.district ?? null;
  const lives = district !== null && homeDistrict(world, c) === district;
  const order: Fitting[] = lives
    ? ['scrubber', 'filter']
    : c.character?.honesty !== undefined && c.character.honesty < 0.45 ? ['stack', 'filter'] : ['filter', 'scrubber'];
  for (const fitting of order) {
    if (purse - FITTING_SPECS[fitting].capital >= FITTING_RESERVE) return fitting;
  }
  return null;
}

// ---------------------------------------------------------------------------
// The stacks
// ---------------------------------------------------------------------------

/** A fitting at half its rating is the upkeep with none of the benefit. */
function tryMaintain(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('maintain_abatement')) return null;
  for (const id of stacksReachable(world, c)) {
    const fitted = fittingOn(world, id);
    if (!fitted || fitted.effect >= MAINTAIN_AT) continue;
    // The owner has the bill; anybody else does it for the hour's purpose and
    // because a diligent hand does not watch a stack go to ruin.
    const owner = world.businesses[c.businessId ?? '']?.buildingId === id;
    if (!owner && !chance(world, 0.25 + c.personality.diligence * 0.5)) continue;
    return { type: 'maintain_abatement', building: id };
  }
  return null;
}

/** The capital an owner will not spend unless something makes it cheaper than not to. */
function tryInstall(ctx: Ctx): Action | null {
  const { world, c, biz } = ctx;
  if (!biz || !ctx.can.has('install_abatement') || !biz.buildingId) return null;
  const key = `abatementWeighed:${c.id}`;
  if (world.counters[key] === world.day) return null;
  const building = biz.buildingId;
  const district = world.buildings[building]?.district ?? null;
  if (!district) return null;
  const charge = chargeAtRisk(world, building);
  const sued = Object.values(world.civil?.suits ?? {})
    .some((s) => s.defendantId === c.id && (s.status === 'filed' || s.status === 'in_session'));
  const lives = homeDistrict(world, c) === district;
  const dirty = airLevel(world, district);
  // Three reasons, and not one of them is public spirit: the charge is dearer
  // than the fitting, a neighbour has already sued, or the smoke is over the
  // owner's own roof.
  const worthIt = charge > FITTING_SPECS.filter.upkeep * 1.5 || sued || (lives && dirty > NOTICEABLE_AIR);
  if (!worthIt) return null;
  world.counters[key] = world.day;
  const fitting = fittingFor(world, c, building, biz.treasury);
  if (!fitting) return null;
  if (!chance(world, INSTALL_CHANCE + (sued ? 0.4 : 0) + (lives ? 0.2 : 0))) return null;
  return { type: 'install_abatement', building, fitting };
}

/** What a bypass saves, and who takes it. */
function tryDischarge(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (!ctx.can.has('discharge') || !clock.working) return null;
  if (c.personality.honesty >= 0.35) return null;
  for (const id of stacksReachable(world, c)) {
    const fitted = fittingOn(world, id);
    if (!fitted) continue;
    if (environmentState(world).bypassDay[id] === world.day) continue;
    const biz = c.businessId ? world.businesses[c.businessId] : null;
    // An owner whose till is thin saves the upkeep and the cell; a hand with
    // no stake in it does it out of the same carelessness it does anything.
    const pressed = (biz && biz.buildingId === id && biz.treasury < FITTING_SPECS[fitted.fitting].upkeep * 10)
      || c.wallet < 40;
    const odds = DISCHARGE_CHANCE * (pressed ? 2 : 1) * (1 - c.personality.honesty);
    if (!chance(world, odds)) continue;
    return { type: 'discharge', building: id };
  }
  return null;
}

// ---------------------------------------------------------------------------
// The readings, and the trees
// ---------------------------------------------------------------------------

/**
 * A dated, attributed reading. Somebody living under a number that is climbing
 * files one; so does somebody downstream of a stack, because a fresh reading
 * on the river is what turns the next bypass from a rumour into a case.
 */
function trySurvey(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  const d = c.district;
  if (!isOpen(world, d)) return null;
  const air = airLevel(world, d);
  const water = waterLevel(world, d);
  const kind: 'air' | 'water' = water > air * 0.8 ? 'water' : 'air';
  const level = kind === 'water' ? water : air;
  if (level < NOTICEABLE_AIR / (kind === 'water' ? 2 : 1)) return null;
  if (!ctx.can.has(kind === 'water' ? 'survey_water' : 'survey_air')) return null;
  if (recentReading(world, d, kind, SURVEY_INTERVAL_DAYS)) return null;
  const key = `surveyed:${c.id}:${d}`;
  if (world.day - (world.counters[key] ?? -99) < SURVEY_INTERVAL_DAYS) return null;
  // A citizen who can read an instrument, who lives here, or who simply keeps
  // the city's books in its head.
  const analyst = (c.skills.analysis ?? 0) >= 40;
  const resident = homeDistrict(world, c) === d;
  const odds = SURVEY_CHANCE * (analyst ? 1.5 : 0.5) * (resident ? 1.5 : 1)
    * (0.5 + (c.character?.civic ?? 0.5)) * (1 + level);
  if (!chance(world, odds)) return null;
  world.counters[key] = world.day;
  return kind === 'water' ? { type: 'survey_water', district: d } : { type: 'survey_air', district: d };
}

/** An hour and a spade. Nothing planted this cycle shows before the next election. */
function tryPlant(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('plant_trees')) return null;
  const d = c.district;
  const row = districtEnvironment(world, d);
  if (row.planted >= openGround(world, d)) return null;
  const green = greeneryOf(world, d);
  if (green >= SPARSE_GREENERY && pollutionBurden(world, d) < NOTICEABLE_AIR) return null;
  const resident = homeDistrict(world, c) === d;
  const idle = !ctx.job || c.shiftsToday >= world.config.maxShiftsPerDay - 1;
  const odds = PLANT_CHANCE * (resident ? 1.6 : 0.6) * (idle ? 1.5 : 0.4)
    * (0.4 + (c.character?.generosity ?? 0.5) + c.personality.curiosity * 0.4)
    * (1 + pollutionBurden(world, d) * 2);
  return chance(world, odds) ? { type: 'plant_trees', district: d } : null;
}

// ---------------------------------------------------------------------------
// The permit, the interest and the suit
// ---------------------------------------------------------------------------

/** What a district would rather be, read off the people who live in it. */
export function wantedPermit(world: World, c: Citizen, d: DistrictId): Permit | null {
  const permit = permitOf(world, d);
  const burden = pollutionBurden(world, d);
  const jobless = c.jobId === null && c.businessId === null;
  // The smoke: a resident under a climbing reading wants the works out.
  if (burden >= PETITION_AIR) {
    if (permit === 'heavy_industry') return 'light_industry';
    if (permit === 'light_industry' || permit === 'open') return 'residential';
    return null;
  }
  // And the wages: a poor district with nobody working in it can petition
  // itself into the smoke, and somebody will say in the Plaza that it was
  // bought (`ENVIRONMENT.md` §6).
  if (jobless && c.wallet < 60 && (permit === 'open' || permit === 'residential') && burden < NOTICEABLE_AIR) {
    return 'light_industry';
  }
  return null;
}

/** The district's own petition, at its own fifth of its own voters. */
function tryPetition(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('petition_zoning')) return null;
  const d = homeDistrict(world, c);
  if (!residentsOf(world, d).includes(c.id)) return null;
  const key = `zoningPetition:${c.id}`;
  if (world.day - (world.counters[key] ?? -99) < PETITION_INTERVAL_DAYS) return null;
  const wanted = wantedPermit(world, c, d);
  if (!wanted) return null;
  // One open question about a district at a time; the city is not asked twice.
  const already = world.government.proposals.some((p) => {
    if (p.status !== 'open') return false;
    const q = environmentQuestionOf(world, p.id);
    return !!q && q.district === d;
  });
  if (already) return null;
  const odds = PETITION_CHANCE * (0.5 + (c.character?.civic ?? 0.5)) * (1 + pollutionBurden(world, d) * 2);
  if (!chance(world, odds)) return null;
  world.counters[key] = world.day;
  return { type: 'petition_zoning', district: d, permit: wanted };
}

/**
 * A councillor holding land near a zoning question. Declaring is honest and it
 * costs them the vote they know most about; not declaring is L47, and a proven
 * gain above 200 ℓ is L11 and the seat. A scripted councillor weighs its own
 * reading of its own honesty against what the question is worth to it.
 */
function tryDeclare(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('declare_interest')) return null;
  for (const p of world.government.proposals) {
    if (p.status !== 'open' || p.votes[c.id] !== undefined) continue;
    const q = environmentQuestionOf(world, p.id);
    if (!q || (q.kind !== 'zone' && q.kind !== 'conserve') || !q.district) continue;
    if (holdingsNear(world, c.id, q.district).length === 0) continue;
    const permit = q.kind === 'conserve' ? 'conserved' : q.permit;
    if (!permit) continue;
    const key = `declareWeighed:${c.id}:${p.id}`;
    if (world.counters[key]) continue;
    world.counters[key] = 1;
    const gain = zoningGain(world, c.id, q.district, permitOf(world, q.district), permit, p.tabledDay);
    // The honest declare whatever it costs them; the rest declare when the
    // gain is small enough not to be worth the risk of the register.
    const honest = c.personality.honesty * 0.6 + (c.character?.honesty ?? 0.5) * 0.4;
    const odds = honest - Math.min(0.5, Math.abs(gain) / 2000);
    if (chance(world, Math.max(0.05, odds))) return { type: 'declare_interest', proposal: p.id };
  }
  return null;
}

/** The neighbour's suit: no conviction, no Watch, and damages read off the motes. */
function tryNuisance(ctx: Ctx): Action | null {
  const { world, c } = ctx;
  if (!ctx.can.has('file_nuisance') || c.wallet < NUISANCE_WALLET) return null;
  const d = homeDistrict(world, c);
  if (burdenAtHome(world, c) < NUISANCE_BURDEN) return null;
  const mine = `nuisance:${c.id}`;
  if (world.day - (world.counters[mine] ?? -99) < NUISANCE_INTERVAL_DAYS) return null;
  for (const id of nuisanceDefendants(world, c)) {
    const key = `nuisance:${c.id}:${id}`;
    if (world.day - (world.counters[key] ?? -99) < world.config.cycleDays) continue;
    const motes = emissionsBy(world, id).reduce((sum, w) => sum + w.motes, 0);
    if (motes <= NUISANCE_MOTES) continue;
    const bond = bondBetween(world, c.id, id);
    const odds = NUISANCE_CHANCE * (1 + motes) * (bond < 0 ? 1.5 : bond > 40 ? 0.2 : 1)
      * (0.5 + c.personality.ambition);
    if (!chance(world, odds)) continue;
    world.counters[key] = world.day;
    world.counters[mine] = world.day;
    return { type: 'file_nuisance', against: id, district: d };
  }
  return null;
}

/**
 * Somewhere to plant that is not where you are standing: a citizen with an
 * idle hour walks to the district it lives in rather than plant a sapling in
 * the middle of the Bazaar.
 */
function tryWalkToPlant(ctx: Ctx): Action | null {
  const { world, c, clock } = ctx;
  if (ctx.job || clock.night || c.lifeStage === 'child') return null;
  const home = homeDistrict(world, c);
  if (home === c.district || !isOpen(world, home)) return null;
  const row = districtEnvironment(world, home);
  if (row.planted >= openGround(world, home)) return null;
  if (pollutionBurden(world, home) < NOTICEABLE_AIR) return null;
  return chance(world, PLANT_CHANCE / 2) ? stepTo(ctx, home) : null;
}

/** The layer's whole step on the ladder, in the order a citizen would weigh it. */
export function tryEnvironment(ctx: Ctx): Action | null {
  if (ctx.c.lifeStage === 'child') return tryPlant(ctx);
  return tryMaintain(ctx)
    ?? tryDischarge(ctx)
    ?? tryInstall(ctx)
    ?? tryDeclare(ctx)
    ?? trySurvey(ctx)
    ?? tryPlant(ctx)
    ?? tryNuisance(ctx)
    ?? tryPetition(ctx)
    ?? tryWalkToPlant(ctx);
}


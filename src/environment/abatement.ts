/**
 * Fittings — capital against a benefit that lands on somebody else
 * (`docs/ENVIRONMENT.md` §3).
 *
 * A filter is a screen on the stack; a scrubber burns a cell a shift to take
 * more than half the motes out; a tall stack cleans nothing at all, is the
 * cheapest thing on the table, and makes the smoke somebody else's. Every one
 * of them **decays 0.04 of its effect a day** unless somebody works a
 * `maintain_abatement` shift, so abatement is a job and not a purchase.
 *
 * And abatement pays the wrong person: a scrubber on the Forge takes Foundry
 * Row from 0.33 to 0.25, and the forty lumens a day that is worth accrue to the
 * Heights, in rent its landlords never notice not losing. No rational owner
 * fits one. The two answers — an emission charge, or the city buying the
 * fittings itself — are both proposals somebody has to win (`daily.ts`,
 * `zoning.ts`).
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Business, Citizen, CitizenId, DistrictId, World } from '../types.ts';
import { BUILDINGS } from '../data/city.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { takeFromMarket } from '../economy/market.ts';
import { districtName, fail, isPresent, ok } from '../actions/common.ts';
import {
  ABATEMENT_DECAY, FITTINGS, FITTING_SPECS, FALSE_ABATEMENT_RETURN, UNLAWFUL_DISCHARGE,
  environmentState, fittingOn, isBoughtOut,
} from './state.ts';
import type { Abatement, Fitting } from './state.ts';
import { motesForShift, shiftsUnder } from './emissions.ts';
import { SURVEY_VISIBILITY_BONUS, chargeEnvironmentOffence } from './offences.ts';
import { recentReading } from './readings.ts';
import { downstreamOf } from './wind.ts';

/** Purpose a maintenance shift gives the citizen who works it, and the rest it costs. */
export const MAINTAIN_PURPOSE = 8;
export const MAINTAIN_REST = 4;

/** Days a downstream reading stays fresh enough to catch a bypass against. */
export const SURVEY_FRESH_DAYS = 3;

function buildingName(world: World, id: BuildingId): string {
  return world.buildings[id]?.name ?? BUILDINGS[id]?.name ?? id;
}

function buildingDistrict(world: World, id: BuildingId): DistrictId | null {
  return world.buildings[id]?.district ?? BUILDINGS[id]?.district ?? null;
}

/** The citizen, if they are here and able to act at all. */
function actor(world: World, cId: CitizenId): Citizen | null {
  const c = world.citizens[cId];
  if (!c || !isPresent(world, c)) return null;
  return c;
}

/** The business this citizen owns, if it trades out of this building. */
function ownedPremises(world: World, c: Citizen, buildingId: BuildingId): Business | null {
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  if (!biz || biz.dissolvedDay !== null || biz.ownerId !== c.id) return null;
  if (biz.buildingId !== buildingId) return null;
  return biz;
}

/** Whether a citizen works at a building, whoever owns it. */
export function worksAt(world: World, c: Citizen, buildingId: BuildingId): boolean {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  return !!job && job.buildingId === buildingId && job.holderId === c.id;
}

// ---------------------------------------------------------------------------
// Fitting one
// ---------------------------------------------------------------------------

function fitTo(world: World, buildingId: BuildingId, fitting: Fitting, byId: CitizenId | 'city'): Abatement {
  const s = environmentState(world);
  const row: Abatement = {
    building: buildingId, fitting, effect: 1, installedDay: world.day, maintainedDay: world.day, byId,
  };
  s.abatement[buildingId] = row;
  return row;
}

/** What the fitting on a building is worth today, as a share of its rated effect. */
export function fittingEffect(world: World, buildingId: BuildingId): number {
  return fittingOn(world, buildingId)?.effect ?? 0;
}

/**
 * An owner fits a filter, a scrubber or a stack to their own premises, out of
 * the business's own funds. A city building is fitted by the Council instead
 * (`installFromPublicWorks`), because nobody owns the Forge.
 */
export function installAbatement(
  world: World, cId: CitizenId, buildingId: BuildingId, fitting: Fitting,
): ActionResult {
  const c = actor(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  if (!FITTINGS.includes(fitting)) return fail(`There is no such fitting as ${String(fitting)}.`);
  const district = buildingDistrict(world, buildingId);
  if (!district) return fail('There is no such building.');
  const biz = ownedPremises(world, c, buildingId);
  if (!biz) return fail(`${buildingName(world, buildingId)} is not your premises; only its owner may fit it, or the Council out of public works.`);
  const held = fittingOn(world, buildingId);
  if (held) return fail(`${buildingName(world, buildingId)} already carries a ${held.fitting}.`);
  const spec = FITTING_SPECS[fitting];
  if (biz.treasury < spec.capital) {
    return fail(`A ${fitting} costs ${spec.capital} ℓ; ${biz.name} has ${biz.treasury} ℓ.`);
  }
  if (!transfer(world, biz.id, 'treasury', spec.capital, 'capital', `${fitting} fitted at ${buildingName(world, buildingId)}`)) {
    return fail('The fitting could not be paid for.');
  }
  fitTo(world, buildingId, fitting, cId);
  emit(world, 'property',
    `${c.name} fitted a ${fitting} at ${buildingName(world, buildingId)} for ${spec.capital} ℓ; it costs ${spec.upkeep} ℓ a day to hold.`,
    [cId], 0.4, { buildingId, fitting, capital: spec.capital });
  remember(world, cId, 'money',
    `You fitted a ${fitting} at ${buildingName(world, buildingId)} for ${spec.capital} ℓ; unmaintained it loses ${ABATEMENT_DECAY} of its effect a day.`);
  return ok(`A ${fitting} is fitted at ${buildingName(world, buildingId)}; it costs ${spec.upkeep} ℓ a day and wants maintaining.`);
}

/**
 * The `abatement_works` proposal, enacted: the city fits a building out of the
 * public works fund, competing with the Keep, the drains and the tram.
 */
export function installFromPublicWorks(world: World, buildingId: BuildingId, fitting: Fitting): ActionResult {
  if (!FITTINGS.includes(fitting)) return fail(`There is no such fitting as ${String(fitting)}.`);
  if (!buildingDistrict(world, buildingId)) return fail('There is no such building.');
  const held = fittingOn(world, buildingId);
  if (held) return fail(`${buildingName(world, buildingId)} already carries a ${held.fitting}.`);
  const spec = FITTING_SPECS[fitting];
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  if (fund < spec.capital) {
    return fail(`A ${fitting} costs ${spec.capital} ℓ and the public works fund holds ${fund} ℓ.`);
  }
  world.government.publicWorksFund = fund - spec.capital;
  fitTo(world, buildingId, fitting, 'city');
  emit(world, 'property',
    `The city fitted a ${fitting} at ${buildingName(world, buildingId)} out of public works (${spec.capital} ℓ).`,
    [], 0.6, { buildingId, fitting, capital: spec.capital, publicWorks: true });
  return ok(`A ${fitting} is fitted at ${buildingName(world, buildingId)} out of the public works fund.`);
}

// ---------------------------------------------------------------------------
// Holding it at its rated effect
// ---------------------------------------------------------------------------

/**
 * A shift spent holding a fitting at what it is rated for. Anybody who works at
 * the building or owns it may work one; it is a job, not a purchase.
 *
 * A maintenance return filed for a day whose shift was worked with that same
 * fitting bypassed is a **false abatement return** (L46): the book says the
 * fitting ran and the river says it did not.
 */
export function maintainAbatement(world: World, cId: CitizenId, buildingId: BuildingId): ActionResult {
  const c = actor(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  const district = buildingDistrict(world, buildingId);
  if (!district) return fail('There is no such building.');
  const fitted = fittingOn(world, buildingId);
  if (!fitted) return fail(`${buildingName(world, buildingId)} carries no fitting to maintain.`);
  if (c.lifeStage === 'child') return fail('Children do not work the stacks.');
  if (c.district !== district) return fail(`${buildingName(world, buildingId)} is in ${districtName(world, district)}, not here.`);
  if (!worksAt(world, c, buildingId) && !ownedPremises(world, c, buildingId)) {
    return fail(`You neither work at nor own ${buildingName(world, buildingId)}.`);
  }
  const [start, end] = world.config.workHours;
  if (world.hour < start || world.hour >= end) return fail(`Nothing is worked at ${buildingName(world, buildingId)} at this hour.`);
  if (c.shiftsToday >= world.config.maxShiftsPerDay) return fail('You have done enough work for one day.');

  const s = environmentState(world);
  const bypassedBy = s.bypassDay[buildingId] === world.day ? s.bypassBy[buildingId] : null;
  const was = fitted.effect;
  fitted.effect = 1;
  fitted.maintainedDay = world.day;
  c.shiftsToday += 1;
  c.needs.purpose = clamp(c.needs.purpose + MAINTAIN_PURPOSE, 0, 100);
  c.needs.rest = clamp(c.needs.rest - MAINTAIN_REST, 0, 100);
  remember(world, cId, 'work',
    `You maintained the ${fitted.fitting} at ${buildingName(world, buildingId)}; it stands at its rated effect again (it was at ${Math.round(was * 100)}%).`);
  if (was < 0.9) {
    emit(world, 'property', `${c.name} maintained the ${fitted.fitting} at ${buildingName(world, buildingId)}.`,
      [cId], 0.2, { buildingId, fitting: fitted.fitting, was });
  }
  if (bypassedBy === cId) {
    chargeEnvironmentOffence(world, cId, FALSE_ABATEMENT_RETURN, {
      description: `${c.name} signed the ${fitted.fitting} at ${buildingName(world, buildingId)} as maintained on a day they worked it bypassed`,
    });
  }
  return ok(`The ${fitted.fitting} at ${buildingName(world, buildingId)} is back at its rated effect.`);
}

// ---------------------------------------------------------------------------
// Bypassing it
// ---------------------------------------------------------------------------

/**
 * `discharge` — work the shift with the fitting bypassed and the waste in the
 * river, saving the upkeep and the cell. It is **L45**, quiet on the Watch's
 * ordinary roll and very much less quiet where somebody downstream has filed a
 * reading to compare against.
 *
 * The shift itself is worked through `economy/jobs.ts workShift` as usual; this
 * says only that the fitting was open while it was.
 */
export function dischargeShift(world: World, cId: CitizenId, buildingId: BuildingId): ActionResult {
  const c = actor(world, cId);
  if (!c) return fail('Unknown or absent citizen.');
  const district = buildingDistrict(world, buildingId);
  if (!district) return fail('There is no such building.');
  const fitted = fittingOn(world, buildingId);
  if (!fitted) return fail(`${buildingName(world, buildingId)} carries no fitting to bypass.`);
  if (c.district !== district) return fail(`${buildingName(world, buildingId)} is in ${districtName(world, district)}, not here.`);
  if (!worksAt(world, c, buildingId) && !ownedPremises(world, c, buildingId)) {
    return fail(`You neither work at nor own ${buildingName(world, buildingId)}.`);
  }
  const s = environmentState(world);
  if (s.bypassDay[buildingId] === world.day) {
    return fail(`The ${fitted.fitting} at ${buildingName(world, buildingId)} is already open today.`);
  }
  s.bypassDay[buildingId] = world.day;
  s.bypassBy[buildingId] = cId;

  const below = downstreamOf(world, district);
  const watched = below !== null && recentReading(world, below, 'water', SURVEY_FRESH_DAYS) !== null;
  chargeEnvironmentOffence(world, cId, UNLAWFUL_DISCHARGE, {
    visibilityMod: watched ? SURVEY_VISIBILITY_BONUS : 0,
    corroboration: watched ? 0.15 : 0,
    description: `${c.name} opened the ${fitted.fitting} at ${buildingName(world, buildingId)} and put the shift's waste in the river`,
  });
  remember(world, cId, 'work',
    `You opened the ${fitted.fitting} at ${buildingName(world, buildingId)}; today's shifts there run unabated and the waste goes to the river.`);
  return ok(`The ${fitted.fitting} at ${buildingName(world, buildingId)} is bypassed for the day.`);
}

// ---------------------------------------------------------------------------
// The morning
// ---------------------------------------------------------------------------

/** What holding every fitting in the city costs its owners today. */
export function upkeepDue(world: World): { fitting: Abatement; upkeep: number }[] {
  const s = environmentState(world);
  return Object.values(s.abatement).map((f) => ({ fitting: f, upkeep: FITTING_SPECS[f.fitting].upkeep }));
}

/** The business that trades out of a building, for the bill. */
function occupantBusiness(world: World, buildingId: BuildingId): Business | null {
  const list = Object.values(world.businesses)
    .filter((b) => b.dissolvedDay === null && b.buildingId === buildingId)
    .sort((a, b) => a.foundedDay - b.foundedDay || a.id.localeCompare(b.id, 'en'));
  return list[0] ?? null;
}

/**
 * The fittings' morning: the upkeep is paid, a scrubber burns its cells for
 * the shifts it ran under, and everything decays by `ABATEMENT_DECAY` unless
 * somebody worked on it yesterday. A fitting whose upkeep nobody paid decays
 * twice as fast, and the Chronicle says how many days it has been.
 */
export function dailyAbatement(world: World): void {
  const s = environmentState(world);
  for (const fitted of Object.values(s.abatement)) {
    const spec = FITTING_SPECS[fitted.fitting];
    const bypassed = s.bypassDay[fitted.building] === world.day - 1;
    let paid = true;
    if (!bypassed && spec.upkeep > 0) {
      const biz = occupantBusiness(world, fitted.building);
      if (biz) {
        paid = transfer(world, biz.id, 'treasury', spec.upkeep, 'upkeep',
          `upkeep of the ${fitted.fitting} at ${buildingName(world, fitted.building)}`);
      } else {
        // A city building's fitting is held out of the public works fund.
        const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
        paid = fund >= spec.upkeep;
        if (paid) world.government.publicWorksFund = fund - spec.upkeep;
      }
    }
    if (!bypassed && spec.energyPerShift > 0) {
      const cells = Math.round(spec.energyPerShift * shiftsUnder(world, fitted.building));
      if (cells > 0) takeFromMarket(world, 'energy', cells);
    }
    const decay = ABATEMENT_DECAY * (paid ? 1 : 2);
    const maintained = fitted.maintainedDay >= world.day - 1;
    if (!maintained) fitted.effect = clamp(fitted.effect - decay, 0, 1);
    const days = world.day - fitted.maintainedDay;
    if (days > 0 && days % 9 === 0) {
      emit(world, 'property',
        `The ${fitted.fitting} at ${buildingName(world, fitted.building)} has not been maintained in ${days} days; it is holding ${Math.round(fitted.effect * 100)}% of what it is rated for.`,
        [], 0.4, { buildingId: fitted.building, fitting: fitted.fitting, effect: fitted.effect, days });
    }
  }
  // Yesterday's bypasses are not today's.
  for (const [buildingId, day] of Object.entries(s.bypassDay)) {
    if (day < world.day) { delete s.bypassDay[buildingId]; delete s.bypassBy[buildingId]; }
  }
}

/**
 * What a scrubber on this building would actually be worth to the city, in
 * motes a day, at the shifts it worked yesterday. The number no owner is paid
 * for.
 */
export function abatementWorth(world: World, buildingId: BuildingId, fitting: Fitting): number {
  if (isBoughtOut(world, buildingId)) return 0;
  const jobs = Object.values(world.jobs).filter((j) => j.buildingId === buildingId && j.holderId !== null);
  const perShift = jobs.reduce((sum, j) => sum + motesForShift(world, j), 0);
  const shifts = Math.max(1, shiftsUnder(world, buildingId));
  const share = jobs.length > 0 ? perShift / jobs.length : 0;
  return share * shifts * (1 - FITTING_SPECS[fitting].emission);
}

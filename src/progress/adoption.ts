/**
 * Adoption — knowing is not using (`docs/PROGRESS.md` §3).
 *
 * A discovery is a line in the Hall of Records until the works are built, the
 * workers are trained, and somebody voted for it.
 *
 * ```
 * readiness = min(1, worksPaid / worksCost)      worksCost = 400 ℓ × tier
 * uptake    = trainedWorkers / postsAffected     trained after 3 shifts under the works
 * effect    = fullEffect × readiness × (0.4 + 0.6 × uptake)
 * ```
 *
 * Two doors into it, and they are different in kind:
 *
 * - **The city's.** An `adopt_technology` proposal pledges lumens to a named
 *   subject's works, and the works are then paid a day at a time out of the
 *   public works fund — so the Council keeps voting while the fund competes
 *   with housing and the Keep, and the Chronicle prints the shortfall the way
 *   it already prints the tram's: *"The drains reach the Undercroft at 620 ℓ
 *   of 800."*
 * - **A business's.** An owner pays from the business's own capital, for its
 *   own shifts only, as much as the till will bear at a time. This is how a
 *   technology reaches a city whose Council will not fund it, one workshop at
 *   a time.
 *
 * And the cost nobody votes for: **every adopted technology destroys the jobs
 * it replaces**. The seed drill cuts the forge maximum by a third and the
 * labour plan closes those posts by its own glut rule. That is `forgeMaximumMultiplier`
 * in `progress/effects.ts`, read by the plan, and it is meant to hurt.
 */
import type { ActionResult, BusinessId, CitizenId, DistrictId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens, transfer } from '../economy/treasury.ts';
import { isPresent } from '../citizens/citizen.ts';
import { openDistricts } from '../world/growth.ts';
import type { Adoption } from './state.ts';
import { PROGRESS_EVENT, WORKS_KIND, progressState, worksKey } from './state.ts';
import type { Branch, TechnologyId } from './tree.ts';
import { TECHNOLOGIES, isTechnologyId, technologyName, worksCost } from './tree.ts';
import {
  adoptionStrength, businessWorks, cityHolds, cityWorks, isMasterOf, readinessOf, uptakeOf,
} from './effects.ts';

/** Most the public works fund will put into one subject's works in a day. */
export const WORKS_PER_DAY = 200;
/** Days between two printings of the same shortfall: an empty fund is not daily news. */
export const WORKS_WAIT_SILENCE_DAYS = 3;

/**
 * Where a branch's works stand. Drains are dug where the people are, a press
 * is built beside the Chronicle, and a furnace is rebuilt in Foundry Row —
 * which is why an adopted technology lifts one district's land and not
 * another's (`PROPERTY.md` §1).
 */
export const BRANCH_DISTRICT: Record<Branch, DistrictId> = {
  materials: 'foundry_row',
  medicine: 'verdant_quarter',
  transport: 'harbor_market',
  information: 'archive',
  agriculture: 'foundry_row',
};

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function newAdoption(world: World, id: TechnologyId, businessId: BusinessId | null, district: DistrictId): Adoption {
  return {
    technology: id, businessId,
    worksPaid: 0, worksCost: worksCost(TECHNOLOGIES[id].tier),
    startedDay: world.day, shifts: {}, trained: [], districts: [district],
  };
}

// ---------------------------------------------------------------------------
// The city's works
// ---------------------------------------------------------------------------

/** What the Council has pledged toward a subject's works but not yet paid. */
function pledgeKey(id: TechnologyId): string {
  return `worksPledge:${id}`;
}

export function pledgedFor(world: World, id: TechnologyId): number {
  return Math.max(0, Math.round(world.counters[pledgeKey(id)] ?? 0));
}

/**
 * The Council's `adopt_technology`: lumens pledged to a named subject's works.
 * Nothing is built the day it passes — the fund pays a day at a time, and if
 * the fund is empty nothing is paid at all.
 */
export function enactAdoption(world: World, subject: string, value: number): ActionResult {
  if (!isTechnologyId(subject)) return fail(`There is no subject called "${String(subject)}".`);
  if (!cityHolds(world, subject)) {
    return fail(`Reverie does not hold ${technologyName(subject)}; there is nothing to build works for.`);
  }
  const s = progressState(world);
  const existing = s.adoptions[subject];
  const cost = worksCost(TECHNOLOGIES[subject].tier);
  if (existing && existing.worksPaid >= existing.worksCost) {
    return fail(`The works for ${technologyName(subject)} are finished; what is missing now is trained hands.`);
  }
  const adoption = existing ?? newAdoption(world, subject, null, BRANCH_DISTRICT[TECHNOLOGIES[subject].branch]);
  s.adoptions[subject] = adoption;
  const wanted = Number.isFinite(value) && value > 0 ? Math.round(value) : cost;
  const room = Math.max(0, adoption.worksCost - adoption.worksPaid - pledgedFor(world, subject));
  const pledged = Math.min(wanted, room);
  world.counters[pledgeKey(subject)] = pledgedFor(world, subject) + pledged;
  emit(world, PROGRESS_EVENT,
    `The Council put ${formatLumens(pledged)} of public works behind ${technologyName(subject)}: ${formatLumens(adoption.worksPaid)} of ${formatLumens(adoption.worksCost)} built.`,
    [], 0.6, { technology: subject, pledged, worksPaid: adoption.worksPaid, worksCost: adoption.worksCost });
  return ok(`${formatLumens(pledged)} pledged to the works for ${technologyName(subject)}.`);
}

/**
 * The morning's building. Each subject the Council has pledged for draws up to
 * WORKS_PER_DAY from the public works fund, in tree order, until the fund runs
 * out — which is the whole argument: housing, the Keep and the drains are all
 * paid from one purse.
 */
export function dailyWorks(world: World): void {
  const s = progressState(world);
  for (const id of Object.keys(s.adoptions) as TechnologyId[]) {
    const a = s.adoptions[id];
    if (!a) continue;
    const owed = Math.min(pledgedFor(world, id), Math.max(0, a.worksCost - a.worksPaid));
    if (owed <= 0) continue;
    const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
    const pay = Math.min(owed, fund, WORKS_PER_DAY);
    if (pay <= 0) {
      // A fund that stays empty is the same story every morning, and the
      // Chronicle has a city to report on: it is printed, but not daily.
      const key = `worksWaited:${id}`;
      if (world.day - (world.counters[key] ?? -WORKS_WAIT_SILENCE_DAYS) >= WORKS_WAIT_SILENCE_DAYS) {
        world.counters[key] = world.day;
        emit(world, PROGRESS_EVENT,
          `The works for ${technologyName(id)} wait: ${formatLumens(a.worksPaid)} of ${formatLumens(a.worksCost)} built, and the public works fund holds ${formatLumens(fund)}.`,
          [], 0.3, { technology: id, worksPaid: a.worksPaid, worksCost: a.worksCost, fund });
      }
      continue;
    }
    world.government.publicWorksFund = fund - pay;
    world.counters[pledgeKey(id)] = pledgedFor(world, id) - pay;
    a.worksPaid += pay;
    if (a.worksPaid >= a.worksCost) {
      emit(world, PROGRESS_EVENT,
        `The works for ${technologyName(id)} are finished at ${formatLumens(a.worksCost)}. ${TECHNOLOGIES[id].changes} — once there are hands trained to it.`,
        [], 0.7, { technology: id, worksPaid: a.worksPaid, worksCost: a.worksCost });
    } else {
      emit(world, PROGRESS_EVENT,
        `The works for ${technologyName(id)} reach ${formatLumens(a.worksPaid)} of ${formatLumens(a.worksCost)}.`,
        [], 0.3, { technology: id, worksPaid: a.worksPaid, worksCost: a.worksCost });
    }
  }
}

// ---------------------------------------------------------------------------
// A business's own works
// ---------------------------------------------------------------------------

/**
 * An owner builds the works at their own premises out of their own capital,
 * for their own shifts. As much as the till will bear at a time: a workshop
 * that cannot pay 800 ℓ this morning pays 200 and comes back tomorrow.
 */
export function adoptTechnology(world: World, cId: CitizenId, subject: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!isPresent(world, c)) return fail('You are not in the city.');
  if (c.standing !== 'good' && c.standing !== 'probation') return fail(`You cannot spend a business's capital while ${c.standing}.`);
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  if (!biz || biz.dissolvedDay !== null) return fail('Only the owner of a business may build works for it.');
  if (!isTechnologyId(subject)) return fail(`There is no subject called "${String(subject)}".`);
  if (!cityHolds(world, subject) && !isMasterOf(world, cId, subject)) {
    // Either nobody has found it, or the people who have are not telling.
    return fail(`Nobody has told you how ${technologyName(subject)} works.`);
  }
  const s = progressState(world);
  const key = worksKey(biz.id, subject);
  const adoption = s.businessWorks[key] ?? newAdoption(world, subject, biz.id, biz.district);
  s.businessWorks[key] = adoption;
  const owed = adoption.worksCost - adoption.worksPaid;
  if (owed <= 0) {
    return fail(`${biz.name} has already built its works for ${technologyName(subject)}; what is missing is trained hands.`);
  }
  const pay = Math.min(owed, Math.floor(biz.treasury));
  if (pay <= 0) {
    return fail(`${biz.name} holds ${formatLumens(biz.treasury)}; the works for ${technologyName(subject)} want ${formatLumens(owed)} more.`);
  }
  if (!transfer(world, biz.id, 'treasury', pay, WORKS_KIND, `works for ${technologyName(subject)} at ${biz.name}`)) {
    return fail('The works could not be paid for.');
  }
  adoption.worksPaid += pay;
  const done = adoption.worksPaid >= adoption.worksCost;
  emit(world, PROGRESS_EVENT,
    done
      ? `${biz.name} finished its own works for ${technologyName(subject)} at ${formatLumens(adoption.worksCost)}; the Council voted for nothing.`
      : `${biz.name} put ${formatLumens(pay)} into works for ${technologyName(subject)}: ${formatLumens(adoption.worksPaid)} of ${formatLumens(adoption.worksCost)}.`,
    [cId], done ? 0.6 : 0.3,
    { technology: subject, businessId: biz.id, worksPaid: adoption.worksPaid, worksCost: adoption.worksCost });
  remember(world, cId, 'money',
    `You put ${formatLumens(pay)} of ${biz.name}'s capital into works for ${technologyName(subject)} (${adoption.worksPaid} of ${adoption.worksCost}).`);
  return ok(done
    ? `${biz.name}'s works for ${technologyName(subject)} are built; train three shifts and they will start to tell.`
    : `${formatLumens(pay)} into the works; ${formatLumens(adoption.worksCost - adoption.worksPaid)} to go.`);
}

// ---------------------------------------------------------------------------
// Reading the works
// ---------------------------------------------------------------------------

/** Every subject the city is building for, finished or not. */
export function cityAdoptions(world: World): Adoption[] {
  return Object.values(progressState(world).adoptions).filter((a): a is Adoption => !!a);
}

/** Every set of works a business built for itself. */
export function businessAdoptions(world: World, businessId?: BusinessId): Adoption[] {
  const all = Object.values(progressState(world).businessWorks);
  return businessId ? all.filter((a) => a.businessId === businessId) : all;
}

/** The Chronicle's line on the works: what is being built, and how short it is. */
export function worksReport(world: World): string {
  const rows = cityAdoptions(world)
    .filter((a) => a.worksPaid < a.worksCost)
    .map((a) => `${technologyName(a.technology)} at ${a.worksPaid} of ${a.worksCost} ℓ`);
  if (rows.length === 0) return 'No works are outstanding.';
  return `Works: ${rows.join('; ')}.`;
}

/** Readiness, uptake and what the two of them together are actually worth. */
export function adoptionState(
  world: World, subject: TechnologyId, businessId?: BusinessId,
): { readiness: number; uptake: number; strength: number; worksPaid: number; worksCost: number } {
  const a = businessId ? businessWorks(world, businessId, subject) : cityWorks(world, subject);
  return {
    readiness: readinessOf(a),
    uptake: uptakeOf(world, a),
    strength: adoptionStrength(world, a),
    worksPaid: a?.worksPaid ?? 0,
    worksCost: a?.worksCost ?? worksCost(TECHNOLOGIES[subject]?.tier ?? 1),
  };
}

/** Districts an adoption's works stand in, for whatever reads a district's amenity. */
export function worksDistricts(world: World): DistrictId[] {
  const open = openDistricts(world);
  const out: DistrictId[] = [];
  for (const a of [...cityAdoptions(world), ...businessAdoptions(world)]) {
    for (const d of a.districts) {
      if (open.includes(d) && !out.includes(d)) out.push(d);
    }
  }
  return out;
}

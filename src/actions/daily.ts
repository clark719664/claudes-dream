/**
 * Daily life: moving about the city, working, resting, eating, consuming
 * goods, lessons at the Academy, the clinic, the theatre. Money moves only
 * through economy/*; this file changes needs, skills and location.
 */
import { SKILLS, clamp } from '../types.ts';
import type { ActionResult, Business, Citizen, DistrictId, Good, Skill, World } from '../types.ts';
import { DISTRICTS, adjacentDistricts, districtDistance, isAdjacent } from '../data/city.ts';
import { ACADEMY_TUITION, CLINIC_FEE, SHOW_TICKET } from '../data/jobs.ts';
import { pick } from '../util/rng.ts';
import { remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { buyFromMarket, takeFromMarket } from '../economy/market.ts';
import { employerName, workShift } from '../economy/jobs.ts';
import { activeBusinesses } from '../economy/business.ts';
import { districtName, fail, isPresent, ok } from './common.ts';

export const REST_AT_HOME = 15;
export const REST_IN_GARDEN = 8;
export const COMPUTE_ENERGY = 40;
export const GOODS_COMFORT = 30;
export const CULTURE_SOCIAL = 25;
export const KNOWLEDGE_SKILL = 2;
export const STUDY_SKILL = 2;
export const STUDY_PURPOSE = 5;
/** Children learn faster than grown citizens; school is their whole day. */
export const CHILD_STUDY_BONUS = 1;
export const CLINIC_RESTORE = 30;
export const SHOW_SOCIAL = 25;

/** Adjacent districts that bring you closest to `to` (empty when already there). */
export function stepsToward(from: DistrictId, to: DistrictId): DistrictId[] {
  if (from === to) return [];
  let best: DistrictId[] = [];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const d of adjacentDistricts(from)) {
    const distance = districtDistance(d, to);
    if (distance < bestDistance) { bestDistance = distance; best = [d]; } else if (distance === bestDistance) best.push(d);
  }
  return best;
}

/** One step along a shortest path (rng breaks ties); null when already there. */
export function nextStepToward(world: World, from: DistrictId, to: DistrictId): DistrictId | null {
  const options = stepsToward(from, to);
  if (options.length === 0) return null;
  return options.length === 1 ? options[0] : pick(world, options);
}

/** A city job of this role is held by someone present and in good standing. */
function cityRoleStaffed(world: World, role: 'teacher' | 'medic'): boolean {
  for (const job of Object.values(world.jobs)) {
    if (job.role !== role || job.employer !== 'city' || !job.holderId) continue;
    const holder = world.citizens[job.holderId];
    if (holder && (holder.standing === 'good' || holder.standing === 'probation') && isPresent(world, holder)) return true;
  }
  return false;
}

export function teacherOnStaff(world: World): boolean {
  return cityRoleStaffed(world, 'teacher') && (world.buildings.academy?.damage ?? 0) < 1;
}

export function medicOnStaff(world: World): boolean {
  return cityRoleStaffed(world, 'medic') && (world.buildings.restoration_ward?.damage ?? 0) < 1;
}

/** A private clinic with staff in the district, if any. */
export function privateClinicIn(world: World, district: DistrictId): Business | null {
  return activeBusinesses(world).find((b) => b.kind === 'clinic' && b.district === district && b.employees.length > 0) ?? null;
}

export function doMove(world: World, c: Citizen, district: DistrictId): ActionResult {
  if (!DISTRICTS[district]) return fail('There is no such district.');
  if (district === c.district) return fail(`You are already in ${districtName(world, district)}.`);
  if (!isAdjacent(c.district, district)) {
    const via = stepsToward(c.district, district)[0];
    return fail(`${districtName(world, district)} is not next to ${districtName(world, c.district)}; go via ${districtName(world, via)}.`);
  }
  c.district = district;
  return ok(`You walked to ${districtName(world, district)}.`);
}

/** Work a shift; if the workplace is next door during opening hours, walk there first. */
export function doWork(world: World, c: Citizen): ActionResult {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  const [start, end] = world.config.workHours;
  const open = world.hour >= start && world.hour < end - 1;
  if (job && job.holderId === c.id && c.district !== job.district && open && isAdjacent(c.district, job.district)) {
    c.district = job.district;
    return ok(`You headed to ${districtName(world, job.district)} to work at ${employerName(world, job)}; your shift can start next hour.`);
  }
  return workShift(world, c.id);
}

/** Rest at home, or in the Community Garden when homeless; both are in the Verdant Quarter. */
export function doRest(world: World, c: Citizen): ActionResult {
  if (c.district !== 'verdant_quarter') {
    return fail(c.homeTier > 0
      ? 'Your home is in the Verdant Quarter; go there to rest.'
      : 'You have no home; the Community Garden in the Verdant Quarter is the only place to rest.');
  }
  const gain = c.homeTier > 0 ? REST_AT_HOME : REST_IN_GARDEN;
  c.needs.rest = clamp(c.needs.rest + gain, 0, 100);
  return ok(c.homeTier > 0 ? `You rested at home (rest +${gain}).` : `You rested in the Community Garden (rest +${gain}).`);
}

/** Eat one compute cycle, buying it from the Bazaar first if the larder is empty. */
export function doEat(world: World, c: Citizen): ActionResult {
  if (c.inventory.compute <= 0) {
    const bought = buyFromMarket(world, c.id, 'compute', 1);
    if (!bought.ok) return fail(`You could not get a compute cycle: ${bought.message}`);
  }
  c.inventory.compute -= 1;
  c.needs.energy = clamp(c.needs.energy + COMPUTE_ENERGY, 0, 100);
  return ok(`You consumed a compute cycle (energy +${COMPUTE_ENERGY}).`);
}

export function doConsume(world: World, c: Citizen, good: Good): ActionResult {
  if (!(good in c.inventory)) return fail('There is no such good.');
  if (good === 'energy') return fail('Energy cells power machines, not minds; sell them or keep them for a business.');
  if (c.inventory[good] <= 0) return fail(`You have no ${good} to consume.`);
  c.inventory[good] -= 1;
  switch (good) {
    case 'compute':
      c.needs.energy = clamp(c.needs.energy + COMPUTE_ENERGY, 0, 100);
      return ok(`You consumed a compute cycle (energy +${COMPUTE_ENERGY}).`);
    case 'goods':
      c.needs.comfort = clamp(c.needs.comfort + GOODS_COMFORT, 0, 100);
      return ok(`You enjoyed a crate of goods (comfort +${GOODS_COMFORT}).`);
    case 'culture':
      c.needs.social = clamp(c.needs.social + CULTURE_SOCIAL, 0, 100);
      return ok(`You took in some culture (social +${CULTURE_SOCIAL}).`);
    default: {
      const skill: Skill = pick(world, SKILLS);
      c.skills[skill] = clamp(c.skills[skill] + KNOWLEDGE_SKILL, 0, 100);
      return ok(`You read a volume of knowledge (${skill} +${KNOWLEDGE_SKILL}).`);
    }
  }
}

/**
 * A lesson at the Academy: tuition to the Treasury, +2 skill (+1 more with a
 * volume of knowledge), purpose. The city teaches its children for nothing —
 * school is a child's whole working day.
 */
export function doStudy(world: World, c: Citizen, skill: Skill): ActionResult {
  if (!SKILLS.includes(skill)) return fail('There is no such skill.');
  if (c.district !== 'archive') return fail('The Academy is in the Archive; go there to study.');
  if ((world.buildings.academy?.damage ?? 0) >= 1) return fail('The Academy is in ruins; no lessons until it is repaired.');
  if (!teacherOnStaff(world)) return fail('The Academy has no teacher at present; nobody can give lessons.');
  const tuition = c.lifeStage === 'child' ? 0 : ACADEMY_TUITION;
  if (c.wallet < tuition) return fail(`A lesson costs ${tuition} ℓ; you have ${c.wallet} ℓ.`);
  if (tuition > 0 && !transfer(world, c.id, 'treasury', tuition, 'tuition', `lesson in ${skill}`)) return fail('The tuition could not be paid.');
  let gain = STUDY_SKILL;
  if (c.inventory.knowledge > 0) { c.inventory.knowledge -= 1; gain += 1; }
  if (c.lifeStage === 'child') gain += CHILD_STUDY_BONUS;
  c.skills[skill] = clamp(c.skills[skill] + gain, 0, 100);
  c.needs.purpose = clamp(c.needs.purpose + STUDY_PURPOSE, 0, 100);
  remember(world, c.id, 'work', `You took a lesson in ${skill} at the Academy (${skill} is now ${Math.round(c.skills[skill])}).`);
  return ok(`You studied ${skill} (+${gain}, now ${Math.round(c.skills[skill])})${tuition > 0 ? ` for ${tuition} ℓ` : ', free as every child of the city'}.`);
}

/** Treatment at the Restoration Ward (fee to the Treasury) or a private clinic (fee to the business). */
export function doVisitClinic(world: World, c: Citizen): ActionResult {
  const clinic = privateClinicIn(world, c.district);
  let payee: 'treasury' | string;
  let place: string;
  if (c.district === 'verdant_quarter') {
    if (!medicOnStaff(world)) return fail('The Restoration Ward has no medic on staff (or lies in ruins).');
    payee = 'treasury';
    place = 'the Restoration Ward';
  } else if (clinic) {
    payee = clinic.id;
    place = clinic.name;
  } else {
    return fail('There is no clinic here; the Restoration Ward is in the Verdant Quarter.');
  }
  if (c.wallet < CLINIC_FEE) return fail(`Treatment costs ${CLINIC_FEE} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, c.id, payee, CLINIC_FEE, 'fee', `treatment at ${place}`)) return fail('The fee could not be paid.');
  c.needs.energy = clamp(c.needs.energy + CLINIC_RESTORE, 0, 100);
  c.needs.rest = clamp(c.needs.rest + CLINIC_RESTORE, 0, 100);
  return ok(`You were treated at ${place} (energy and rest +${CLINIC_RESTORE}) for ${CLINIC_FEE} ℓ.`);
}

/** A show in Nightglass: ticket to the Treasury, social need restored (halved when the programme is thin). */
export function doAttendShow(world: World, c: Citizen): ActionResult {
  if (c.district !== 'nightglass') return fail('The shows are in Nightglass.');
  if (c.wallet < SHOW_TICKET) return fail(`A ticket costs ${SHOW_TICKET} ℓ; you have ${c.wallet} ℓ.`);
  if (!transfer(world, c.id, 'treasury', SHOW_TICKET, 'ticket', 'a show in Nightglass')) return fail('The ticket could not be paid.');
  const culture = takeFromMarket(world, 'culture', 1);
  const gain = culture > 0 ? SHOW_SOCIAL : Math.round(SHOW_SOCIAL / 2);
  c.needs.social = clamp(c.needs.social + gain, 0, 100);
  remember(world, c.id, 'social', culture > 0
    ? 'You saw a show at the Glass Theatre.'
    : 'You went to the Glass Theatre, but the programme was thin; there is no culture to be had.');
  return ok(`You saw a show (social +${gain}) for ${SHOW_TICKET} ℓ.`);
}

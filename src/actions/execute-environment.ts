/**
 * The environment half of the action table (`docs/ENVIRONMENT.md` §9,
 * `REGISTRY.md` §3): the fittings on a stack, the readings somebody spends a
 * shift on, the trees, the district's own petition, a councillor's declared
 * interest, and the neighbour's suit.
 *
 * `dispatchEnvironment` returns null for anything it does not own, so
 * `actions/execute.ts` falls through to its own switch. `environmentActions`
 * adds to the set `availableActions` is built from: a guide, never a promise.
 *
 * One ordering note that is not obvious and matters. `discharge` says only that
 * the fitting is open for the day; the shift itself is worked by
 * `economy/jobs.ts workShift` afterwards, and the emission is counted there. So
 * a citizen spends this hour opening the bypass and the next hour working under
 * it, and the day's motes are counted unabated from the moment the bypass is
 * open — which is exactly what the Watch may notice.
 */
import type { Action, ActionResult, ActionType, Citizen, CitizenId, DistrictId, World } from '../types.ts';
import { isOpen } from '../world/growth.ts';
import { emittersToday } from '../environment/emissions.ts';
import {
  declareInterest, dischargeShift, environmentQuestionOf, fileNuisance, fittingOn, hasDeclared, holdingsNear,
  installAbatement, maintainAbatement, openGround, petitionZoning, plantTrees, reaches, residentsOf, surveyAir,
  surveyWater, worksAt,
} from '../environment/index.ts';
import { districtEnvironment } from '../environment/state.ts';
import { memo, memoBy } from '../util/memo.ts';

/** Carry out one environment action; null means the caller's switch owns it. */
export function dispatchEnvironment(world: World, c: Citizen, action: Action): ActionResult | null {
  switch (action.type) {
    case 'install_abatement': return installAbatement(world, c.id, action.building, action.fitting);
    case 'maintain_abatement': return maintainAbatement(world, c.id, action.building);
    case 'discharge': return dischargeShift(world, c.id, action.building);
    case 'survey_air': return surveyAir(world, c.id, action.district);
    case 'survey_water': return surveyWater(world, c.id, action.district);
    case 'plant_trees': return plantTrees(world, c.id, action.district);
    case 'petition_zoning': return petitionZoning(world, c.id, action.district, action.permit);
    case 'declare_interest': return declareInterest(world, c.id, action.proposal);
    // A nuisance is an ordinary civil suit and its result is a civil one, which
    // carries the same `ok` and `message` an ActionResult does.
    case 'file_nuisance': {
      const r = fileNuisance(world, c.id, action.against, action.district);
      return { ok: r.ok, message: r.message };
    }
    default: return null;
  }
}

// ---------------------------------------------------------------------------
// What is on offer
// ---------------------------------------------------------------------------

/** The premises this citizen owns or works at, where a fitting could be touched. */
export function stacksReachable(world: World, c: Citizen): string[] {
  const out: string[] = [];
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (job && job.holderId === c.id && worksAt(world, c, job.buildingId)) out.push(job.buildingId);
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  if (biz && biz.dissolvedDay === null && biz.ownerId === c.id && biz.buildingId && !out.includes(biz.buildingId)) {
    out.push(biz.buildingId);
  }
  return out.filter((id) => (world.buildings[id]?.district ?? null) === c.district);
}

/** Everything this layer puts in front of this citizen here and now. */
export function environmentActions(world: World, c: Citizen, set: Set<ActionType>, here: Citizen[]): void {
  const settled = c.standing === 'good' || c.standing === 'probation';
  const [start, end] = world.config.workHours;
  const hoursOpen = world.hour >= start && world.hour < end;
  const shiftLeft = c.shiftsToday < world.config.maxShiftsPerDay;
  const child = c.lifeStage === 'child';

  // A shift on the open ground of the district you stand in. Children plant
  // trees: it is not trade, it is not an office, and nothing in the Charter
  // says a child may not put a sapling in the ground.
  if (shiftLeft && isOpen(world, c.district) && districtEnvironment(world, c.district).planted < openGround(world, c.district)) {
    set.add('plant_trees');
  }
  if (child) return;
  // A reading is a shift, and it is a shift anybody may work: the evidence a
  // compact is made of does not belong to an office (`ENVIRONMENT.md` §7).
  if (shiftLeft && isOpen(world, c.district)) { set.add('survey_air'); set.add('survey_water'); }

  const stacks = stacksReachable(world, c);
  const fitted = stacks.filter((id) => fittingOn(world, id) !== null);
  if (settled && hoursOpen && shiftLeft && fitted.length > 0) set.add('maintain_abatement');
  if (hoursOpen && fitted.some((id) => world.environment?.bypassDay?.[id] !== world.day)) set.add('discharge');
  const biz = c.businessId ? world.businesses[c.businessId] : null;
  if (settled && biz && biz.dissolvedDay === null && biz.ownerId === c.id && biz.buildingId
    && !fittingOn(world, biz.buildingId) && biz.treasury > 0) {
    set.add('install_abatement');
  }

  // The district's own petition, at its own share of its own voters.
  if (settled && residentsHere(world, c.district).includes(c.id)
    && !world.government.proposals.some((p) => p.status === 'open' && p.proposerId === c.id)) {
    set.add('petition_zoning');
  }
  // A zoning question before the Council, and a councillor who holds land
  // anywhere near it. Declaring is the honest escape and it costs the vote.
  const g = world.government;
  if (g.mayorId === c.id || g.council.includes(c.id)) {
    for (const p of g.proposals) {
      if (p.status !== 'open') continue;
      const q = environmentQuestionOf(world, p.id);
      if (!q || (q.kind !== 'zone' && q.kind !== 'conserve') || !q.district) continue;
      if (hasDeclared(world, p.id, c.id) || p.votes[c.id] !== undefined) continue;
      if (holdingsNear(world, c.id, q.district).length === 0) continue;
      set.add('declare_interest');
      break;
    }
  }
  // And the neighbour whose stack you are breathing: a claim on the docket,
  // which needs no conviction and no Watch.
  if (settled && nuisanceDefendants(world, c).length > 0) set.add('file_nuisance');
}

/** Where this citizen's address is, which is where a nuisance is sued for. */
export function homeDistrict(world: World, c: Citizen): DistrictId {
  const home = c.homeBuildingId ? world.buildings[c.homeBuildingId]?.district ?? null : null;
  return home ?? c.district;
}

/**
 * Whose works are putting something over this citizen's own address today: the
 * owners of the businesses that emitted, upwind or upstream of where they
 * live. The city's own Forge is nobody's to sue — there is one purse, and the
 * answer to it is a proposal (`ENVIRONMENT.md` §3).
 */
export function nuisanceDefendants(world: World, c: Citizen): CitizenId[] {
  const home = homeDistrict(world, c);
  if (!isOpen(world, home)) return [];
  // The question is about an address rather than a person, so the answer is
  // one list per district for the whole reading round; only "and not me" is
  // this citizen's own.
  return reachingOwners(world, home).filter((id) => id !== c.id);
}

/** The owners whose works put something over this district today. */
function reachingOwners(world: World, home: DistrictId): CitizenId[] {
  return memoBy(world, 'env:reachingOwners', home, () => {
    const out: CitizenId[] = [];
    for (const row of emittersToday(world)) {
      if (row.owner === 'city' || row.motes <= 0) continue;
      const biz = world.businesses[row.owner];
      if (!biz || biz.dissolvedDay !== null) continue;
      if (!reaches(world, row.district, home)) continue;
      if (!out.includes(biz.ownerId) && world.citizens[biz.ownerId]) out.push(biz.ownerId);
    }
    return out;
  });
}

/** Who lives in a district, asked once a round rather than once a citizen. */
function residentsHere(world: World, d: DistrictId): CitizenId[] {
  return memoBy(world, 'env:residents', d, () => residentsOf(world, d));
}

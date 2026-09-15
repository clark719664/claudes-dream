/**
 * The measures a scripted councillor moves about the two things the city
 * cannot buy at the Bazaar: what it knows, and what it breathes.
 *
 * Everything here is read off the same morning's public numbers every other
 * lever is read off — an empty purse, a set of works standing at nothing, a
 * district's air, the public works fund, and the councillor's own address —
 * and none of it is a goal anybody was given. A councillor who lives in
 * Foundry Row moves different motions from one who lives in the Heights, and
 * that is the whole of `ENVIRONMENT.md` §5 and §6.
 */
import type { BuildingId, Citizen, DistrictId, World } from '../types.ts';
import { buildingsIn } from '../world/buildings.ts';
import { openDistricts } from '../world/growth.ts';
import { districtName } from '../actions/common.ts';
import {
  RESEARCH_WAGE, TECHNOLOGIES, cityAdoptions, cityHolds, heldTechnologies, openProjects, pledgedFor, purseOf,
  technologyName, worksCost,
} from '../progress/index.ts';
import {
  CHARGE_MAX, FITTING_SPECS, HOST_SHARE_MAX, airLevel, environmentState, fittingOn, hostShareOf, permitOf,
} from '../environment/index.ts';
import type { Fitting, Permit } from '../environment/state.ts';
import { homeDistrict } from '../actions/execute-environment.ts';
import type { ReflexProposal } from './reflex-civic.ts';
import type { Ctx } from './reflex-util.ts';

/** A purse with fewer hours than this in it is a room the city has left idle. */
export const GRANT_AT_HOURS = 12;
/** What a grant is worth putting up, and the share of the Treasury it may not pass. */
export const GRANT_SIZE = 400;
export const GRANT_TREASURY_SHARE = 0.05;
/** Air at or above this is a district a councillor will move a motion about. */
export const MOTION_AIR = 0.2;
/** And at or above this, one worth spending the works fund on. */
export const HEAVY_AIR = 0.35;
/** What the charge is set at when a Council first reaches for it, in lumens a mote. */
export const FIRST_CHARGE = 2;
/** The share of what a district raises that a host payment hands back.  */
export const FIRST_HOST_SHARE = 0.3;
/**
 * What a councillor asks for the fund when it is empty and there is something
 * to build with it. The works are paid a day at a time out of the same purse
 * as the housing and the Keep (`PROGRESS.md` §3), so a Council that wants
 * drains has to put the money there first — and an empty fund is the reason
 * nothing is ever built, not a reason not to want it.
 */
export const WORKS_TOPUP = 1200;
/**
 * The Treasury a councillor will not commit that out of: a city still holding
 * this share of what it was founded with can afford to build, and one that is
 * not has other arguments to have first.
 */
export const WORKS_TOPUP_SHARE = 0.4;
export const WORKS_TOPUP_FLOOR = 8_000;

/** What the city has to hold before a councillor asks it to build anything. */
function canAffordWorks(world: World): boolean {
  const founding = Math.max(0, world.treasury.foundingSupply ?? 0);
  return world.treasury.balance > Math.max(WORKS_TOPUP_FLOOR, founding * WORKS_TOPUP_SHARE);
}

/** The buildings whose shifts actually make motes, in the order they make them. */
const PRODUCING = ['forge', 'power', 'fabrication', 'builders'] as const;

/**
 * The two research measures: a purse the city has left empty, and a discovery
 * nobody has built for. Both are money, so both wait on a Treasury that can
 * carry them.
 */
export function knowledgeMotions(ctx: Ctx, healthy: boolean): ReflexProposal[] {
  const { world, c } = ctx;
  const out: ReflexProposal[] = [];
  const wage = Math.max(world.government.minWage, RESEARCH_WAGE);
  const ceiling = Math.floor(world.treasury.balance * GRANT_TREASURY_SHARE);
  const starved = openProjects(world)
    .filter((p) => purseOf(world, p) < wage * GRANT_AT_HOURS)
    .sort((a, b) => purseOf(world, a) - purseOf(world, b))[0];
  if (starved && ceiling >= wage * GRANT_AT_HOURS) {
    const value = Math.max(wage * GRANT_AT_HOURS, Math.min(GRANT_SIZE, ceiling));
    out.push({
      kind: 'research_grant', value, subject: starved.id,
      summary: `Put ${value} ℓ into ${starved.name}: the programme on ${technologyName(starved.technology)} `
        + `stands at ${Math.round(starved.progress)} of ${starved.cost} and cannot pay the hour`,
    });
  }
  // A discovery is a line in the Hall of Records until the works are built.
  const adopting = new Map(cityAdoptions(world).map((a) => [a.technology, a]));
  let wanted = 0;
  for (const id of heldTechnologies(world)) {
    const a = adopting.get(id);
    if (a && a.worksPaid + pledgedFor(world, id) >= a.worksCost) continue;
    const cost = worksCost(TECHNOLOGIES[id].tier);
    const owed = a ? Math.max(0, a.worksCost - a.worksPaid - pledgedFor(world, id)) : cost;
    if (owed <= 0) continue;
    wanted++;
    if (wanted > 1) continue;
    out.push({
      kind: 'adopt_technology', value: owed, subject: id,
      summary: `Build the works for ${technologyName(id)} — ${owed} ℓ of public works, and ${TECHNOLOGIES[id].changes}`,
    });
  }
  // And the fund itself, which is what the works are actually paid out of. A
  // pledge against an empty fund builds nothing and prints the shortfall every
  // third morning, so a councillor who wants the drains dug asks for the money
  // first — and says in the motion what it is for.
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  const dirty = airLevel(world, dirtiestOpen(world)) >= MOTION_AIR;
  if ((wanted > 0 || dirty) && fund < WORKS_TOPUP / 2 && canAffordWorks(world)) {
    const need = wanted > 0 ? `the works ${heldTechnologies(world).length} discoveries are waiting on` : 'a fitting for the stacks';
    out.push({
      kind: 'public_works', value: WORKS_TOPUP,
      summary: `Commit ${WORKS_TOPUP} ℓ to the public works fund; it holds ${fund} ℓ and ${need} cannot be built out of nothing`,
    });
  }
  // Nobody votes for a line the city does not know how to lay (`REGISTRY.md`
  // §7), so a councillor who wants one moves the subject first.
  if (!cityHolds(world, 'the_tram')) {
    const running = openProjects(world).some((p) => p.technology === 'the_tram');
    if (running) {
      const p = openProjects(world).find((x) => x.technology === 'the_tram');
      if (p && purseOf(world, p) < wage * GRANT_AT_HOURS && ceiling > 0 && c.personality.curiosity > 0.55) {
        out.push({
          kind: 'research_grant', value: Math.min(GRANT_SIZE, ceiling), subject: p.id,
          summary: `Fund ${p.name}: there is no tram line until somebody works out how a tram is laid`,
        });
      }
    }
  }
  return out;
}

/** The producing buildings of a district, dirtiest first, with nothing on the stack. */
export function unfittedWorks(world: World, d: DistrictId): BuildingId[] {
  return buildingsIn(world, d)
    .filter((b) => (PRODUCING as readonly string[]).includes(b.kind) && !fittingOn(world, b.id))
    .map((b) => b.id);
}

/** Which fitting the public works fund can carry today. */
export function affordableFitting(world: World): Fitting | null {
  const fund = Math.max(0, Math.round(world.government.publicWorksFund ?? 0));
  if (fund >= FITTING_SPECS.scrubber.capital) return 'scrubber';
  if (fund >= FITTING_SPECS.filter.capital) return 'filter';
  return null;
}

/** What a district would be zoned instead, once its air is a thing people talk about. */
function lighterPermit(permit: Permit): Permit | null {
  if (permit === 'heavy_industry') return 'light_industry';
  if (permit === 'light_industry' || permit === 'open') return 'residential';
  return null;
}

/** Where a councillor sleeps, which is whose air they are voting on. */
function homeOf(world: World, c: Citizen): DistrictId {
  return homeDistrict(world, c);
}

/**
 * The environment's measures. A councillor reaches for the charge when the
 * city's worst reading is one people are talking about, for the works fund
 * when it has one, for a host payment when they live in the district that
 * hosts the smoke, and for the permit itself when nothing else has worked.
 */
export function smokeMotions(ctx: Ctx): ReflexProposal[] {
  const { world, c } = ctx;
  const out: ReflexProposal[] = [];
  const s = environmentState(world);
  const districts = openDistricts(world)
    .map((d) => ({ d, air: airLevel(world, d) }))
    .sort((a, b) => b.air - a.air);
  const worst = districts[0];
  if (!worst || worst.air < MOTION_AIR) return out;
  const where = districtName(world, worst.d);
  const home = homeOf(world, c);

  // The charge is the one answer that does not cost the Treasury anything —
  // which is exactly why an owner on the Council will vote against it.
  if (s.charge <= 0) {
    out.push({
      kind: 'emission_charge', value: FIRST_CHARGE,
      summary: `Charge ${FIRST_CHARGE} ℓ a mote a day for what the city's shifts emit; the air over ${where} `
        + `stands at ${worst.air.toFixed(2)} and nobody pays for it`,
    });
  } else if (worst.air >= HEAVY_AIR && s.charge < CHARGE_MAX / 2) {
    const value = Math.min(CHARGE_MAX, Math.round((s.charge + 2) * 100) / 100);
    out.push({
      kind: 'emission_charge', value,
      summary: `Raise the emission charge to ${value} ℓ a mote: ${where} reads ${worst.air.toFixed(2)} and the charge has not moved it`,
    });
  }

  // A fitting the city buys itself, because no owner ever will.
  const fitting = affordableFitting(world);
  const target = unfittedWorks(world, worst.d)[0] ?? null;
  if (fitting && target) {
    out.push({
      kind: 'abatement_works', value: FITTING_SPECS[fitting].capital, building: target, fitting,
      summary: `Fit a ${fitting} at ${world.buildings[target]?.name ?? target} out of public works; ${where} reads ${worst.air.toFixed(2)}`,
    });
  }

  // What the district that breathes it is paid for breathing it.
  const hosting = districts.find((row) => row.air >= MOTION_AIR && hostShareOf(world, row.d) <= 0);
  if (hosting && (hosting.d === home || c.personality.sociability > 0.6)) {
    out.push({
      kind: 'host_payment', value: Math.min(HOST_SHARE_MAX, FIRST_HOST_SHARE), district: hosting.d,
      summary: `Pay the residents of ${districtName(world, hosting.d)} ${Math.round(FIRST_HOST_SHARE * 100)}% of what is raised inside it; `
        + 'they host what the rest of the city eats',
    });
  }

  // And the permit itself, which is the largest number any motion moves.
  if (worst.air >= HEAVY_AIR) {
    const permit = lighterPermit(permitOf(world, worst.d));
    if (permit) {
      out.push({
        kind: 'zone', value: 0, district: worst.d, permit,
        summary: `Zone ${where} ${permit.replace(/_/g, ' ')}: it reads ${worst.air.toFixed(2)} and its people live in it`,
      });
    }
  }
  return out;
}

/** The dirtiest district the city has opened. */
function dirtiestOpen(world: World): DistrictId {
  return openDistricts(world)
    .map((d) => ({ d, air: airLevel(world, d) }))
    .sort((a, b) => b.air - a.air)[0]?.d ?? 'commons';
}

/**
 * Work and enterprise: the owner's side of a business (posting jobs, hiring,
 * firing, wages) and the performer's show. The modules under economy/* do
 * the bookkeeping; these wrappers add the "is this citizen the owner" and
 * "is this citizen a performer in Nightglass" checks an action needs.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Business, Citizen, CitizenId, JobId, Skill, World } from '../types.ts';
import { BUSINESS_JOBS } from '../data/jobs.ts';
import { chance } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { deliverToMarket } from '../economy/market.ts';
import { postJobAsOwner, setWage } from '../economy/jobs.ts';
import { fireCitizen, hireCitizen } from '../economy/business.ts';
import { adjustBond } from '../citizens/relationships.ts';
import { citizensIn, fail, ok } from './common.ts';

/** Culture a show adds to the Bazaar. */
export const SHOW_CULTURE = 2;
export const TIP = 2;
export const TIP_MIN_WALLET = 20;
export const TIP_CHANCE = 0.5;

/** The business a citizen owns and still runs, if any. */
export function ownedBusiness(world: World, c: Citizen): Business | null {
  if (!c.businessId) return null;
  const b = world.businesses[c.businessId];
  return b && b.dissolvedDay === null && b.ownerId === c.id ? b : null;
}

/** Post a vacancy; the role and output come from the business kind's template that matches the skill. */
export function doPostJob(world: World, c: Citizen, spec: { title: string; wage: number; skill: Skill | null; minSkill: number }): ActionResult {
  const biz = ownedBusiness(world, c);
  if (!biz) return fail('You do not own a business.');
  const templates = BUSINESS_JOBS[biz.kind] ?? [];
  const template = templates.find((t) => t.skill === spec.skill) ?? templates[0];
  return postJobAsOwner(world, c.id, {
    title: spec.title, wage: spec.wage, skill: spec.skill, minSkill: spec.minSkill,
    ...(template ? { role: template.role, output: { ...template.output } } : {}),
  });
}

export function doHire(world: World, c: Citizen, citizenId: CitizenId, jobId: JobId): ActionResult {
  const biz = ownedBusiness(world, c);
  if (!biz) return fail('You do not own a business.');
  return hireCitizen(world, biz.id, citizenId, jobId);
}

export function doFire(world: World, c: Citizen, citizenId: CitizenId): ActionResult {
  const biz = ownedBusiness(world, c);
  if (!biz) return fail('You do not own a business.');
  if (citizenId === c.id) return fail('You cannot dismiss yourself; quit the job instead.');
  return fireCitizen(world, biz.id, citizenId);
}

export function doSetWage(world: World, c: Citizen, jobId: JobId, wage: number): ActionResult {
  if (!ownedBusiness(world, c)) return fail('You do not own a business.');
  return setWage(world, jobId, wage, c.id);
}

/** A performer's or artist's show in Nightglass: culture for the Bazaar, tips from the crowd. */
export function doPerform(world: World, c: Citizen): ActionResult {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (!job || job.holderId !== c.id || (job.role !== 'performer' && job.role !== 'artist')) {
    return fail('Only working performers and artists put on shows.');
  }
  if (c.district !== 'nightglass') return fail('Shows happen in Nightglass; go there first.');
  deliverToMarket(world, 'culture', SHOW_CULTURE);
  const audience = citizensIn(world, 'nightglass', c.id);
  let tips = 0;
  for (const a of audience) {
    if (a.wallet <= TIP_MIN_WALLET || !chance(world, TIP_CHANCE)) continue;
    if (!transfer(world, a.id, c.id, TIP, 'tip', `tip for ${c.name}'s show`)) continue;
    tips += TIP;
    a.needs.social = clamp(a.needs.social + 5, 0, 100);
    adjustBond(world, a.id, c.id, 1, false);
  }
  c.needs.social = clamp(c.needs.social + 10, 0, 100);
  c.needs.purpose = clamp(c.needs.purpose + 4, 0, 100);
  c.stats.showsPerformed += 1;
  const venue = job.role === 'artist' ? 'the Gallery of Echoes' : 'the Glass Theatre';
  const crowd = audience.length === 0 ? 'an empty house' : `an audience of ${audience.length}`;
  const earned = tips > 0 ? `, earning ${tips} ℓ in tips` : '';
  emit(world, 'show', `${c.name} performed at ${venue} to ${crowd}${earned}.`, [c.id, ...audience.map((a) => a.id)], 0.3, { tips, audience: audience.length });
  remember(world, c.id, 'work', `You performed at ${venue} to ${crowd}${earned}.`);
  return ok(`You performed to ${crowd}${earned}.`);
}

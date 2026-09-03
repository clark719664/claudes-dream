/**
 * Offences: theft, fraud, harassment, vandalism, tax evasion, extortion and
 * sabotage. Each one changes the world (money, damage, bonds), then goes to
 * watch.commitOffence, which records it and rolls for detection. Victims
 * remember who wronged them when they notice, id included, so they can report.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, LawCode, World } from '../types.ts';
import { chance, rand, randInt } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustBond, bondBetween, recordHostility } from '../citizens/relationships.ts';
import { commitOffence } from '../government/watch.ts';
import { GRAND_THEFT_THRESHOLD, districtName, fail, nameTag, ok, targetOf } from './common.ts';

export const STEAL_MIN = 10;
export const STEAL_MAX = 80;
export const HARASS_COUNT = 2;
export const VANDALISM_DAMAGE = 0.25;
export const SABOTAGE_VANDALISM_DAMAGE = 0.5;
export const EVADE_SHIFTS = 3;

/** The target of an in-person offence: around, and in the same district. */
function markHere(world: World, c: Citizen, id: CitizenId): Citizen | ActionResult {
  if (id === c.id) return fail('You cannot do that to yourself.');
  const t = targetOf(world, id);
  if (!t) return fail('Nobody by that id is around.');
  if (t.district !== c.district) return fail(`${t.name} is in ${districtName(world, t.district)}, not here.`);
  return t;
}

function isResult(x: Citizen | ActionResult): x is ActionResult {
  return 'ok' in x;
}

/** Pick a pocket: success depends on silver tongue against sharp eyes; a failed attempt is still theft. */
export function doSteal(world: World, c: Citizen, fromId: CitizenId): ActionResult {
  const t = markHere(world, c, fromId);
  if (isResult(t)) return t;
  const p = clamp(0.4 + (c.skills.rhetoric - t.skills.analysis) / 200, 0.05, 0.95);
  const success = chance(world, p);
  const amount = Math.min(Math.max(0, Math.floor(t.wallet)), randInt(world, STEAL_MIN, STEAL_MAX));
  const got = success && amount > 0 && transfer(world, t.id, c.id, amount, 'theft', `${c.name} robbed ${t.name}`);
  const law: LawCode = got && amount >= GRAND_THEFT_THRESHOLD ? 'L08' : 'L04';
  const r = commitOffence(world, c.id, law, { victimId: t.id, amount: got ? amount : 0, visibilityMod: got ? 0 : 0.2 });
  const seen = r.detected ? ' and the Watch saw it' : '';
  if (got) {
    if (r.detected || chance(world, t.skills.analysis / 100)) {
      remember(world, t.id, 'crime', `${nameTag(c)} picked your pocket for ${amount} ℓ${r.detected ? '; the Watch caught them' : ''}.`);
      adjustBond(world, t.id, c.id, -25, false);
    }
    remember(world, c.id, 'crime', `You stole ${amount} ℓ from ${t.name}${seen}.`);
    return ok(`You stole ${amount} ℓ from ${t.name}.`, { offence: law, detected: r.detected });
  }
  remember(world, t.id, 'crime', `${nameTag(c)} tried to pick your pocket and failed${r.detected ? '; the Watch caught them' : ''}.`);
  adjustBond(world, t.id, c.id, -20, false);
  remember(world, c.id, 'crime', `You tried to rob ${t.name} and failed${seen}.`);
  const why = amount === 0 ? ' (their pockets were empty)' : '';
  return fail(`You failed to steal from ${t.name}${why}.`, { offence: law, detected: r.detected });
}

/** Sell someone a promise: commerce against analysis, helped by their trust in you. */
export function doScam(world: World, c: Citizen, targetId: CitizenId, amount: number): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  const requested = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (requested <= 0) return fail('You must ask for a positive amount.');
  const trust = bondBetween(world, t.id, c.id);
  const p = clamp(0.3 + (c.skills.commerce - t.skills.analysis) / 200 + trust / 200, 0.05, 0.95);
  const success = chance(world, p);
  const amt = Math.min(Math.max(0, Math.floor(t.wallet)), requested);
  const got = success && amt > 0 && transfer(world, t.id, c.id, amt, 'scam', `${c.name} defrauded ${t.name}`);
  const r = commitOffence(world, c.id, 'L07', { victimId: t.id, amount: got ? amt : 0, visibilityMod: got ? 0 : 0.1 });
  if (r.detected) adjustBond(world, c.id, t.id, -30);
  if (got) {
    if (r.detected || chance(world, 0.7)) {
      remember(world, t.id, 'crime', `${nameTag(c)} scammed you out of ${amt} ℓ${r.detected ? '; the Watch caught them' : ''}.`);
      adjustBond(world, t.id, c.id, -30, false);
    }
    remember(world, c.id, 'crime', `You scammed ${t.name} out of ${amt} ℓ${r.detected ? ' and the Watch saw it' : ''}.`);
    return ok(`You scammed ${t.name} out of ${amt} ℓ.`, { offence: 'L07', detected: r.detected });
  }
  remember(world, t.id, 'crime', `${nameTag(c)} tried to sell you something that did not add up${r.detected ? '; the Watch caught them' : ''}.`);
  adjustBond(world, t.id, c.id, -10, false);
  remember(world, c.id, 'crime', `${t.name} saw through your scheme${r.detected ? ', and so did the Watch' : ''}.`);
  return fail(`${t.name} saw through your scheme.`, { offence: 'L07', detected: r.detected });
}

/** Hostility in person; the second act inside a day is harassment (L05). */
export function doHarass(world: World, c: Citizen, targetId: CitizenId): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  const count = recordHostility(world, c.id, t.id);
  adjustBond(world, c.id, t.id, -20);
  t.needs.social = clamp(t.needs.social - 10, 0, 100);
  const where = districtName(world, c.district);
  remember(world, t.id, 'crime', `${nameTag(c)} harassed you in ${where}.`);
  remember(world, c.id, 'crime', `You harassed ${t.name} in ${where}.`);
  emit(world, 'insult', `${c.name} harassed ${t.name} in ${where}.`, [c.id, t.id], 0.2);
  if (count >= HARASS_COUNT) {
    const r = commitOffence(world, c.id, 'L05', { victimId: t.id });
    return ok(`You harassed ${t.name} again.`, { offence: 'L05', detected: r.detected });
  }
  return ok(`You harassed ${t.name}.`);
}

function buildingHere(world: World, c: Citizen, id: BuildingId) {
  const b = world.buildings[id];
  if (!b) return fail('There is no such building.');
  if (b.district !== c.district) return fail(`${b.name} is in ${districtName(world, b.district)}, not here.`);
  if (b.damage >= 1) return fail(`${b.name} is already in ruins.`);
  return b;
}

/** Damage a building; critical infrastructure makes it sabotage (L13) and hurts more. */
export function doVandalize(world: World, c: Citizen, buildingId: BuildingId): ActionResult {
  const b = buildingHere(world, c, buildingId);
  if ('ok' in b) return b;
  const law: LawCode = b.critical ? 'L13' : 'L06';
  b.damage = Math.round(clamp(b.damage + (b.critical ? SABOTAGE_VANDALISM_DAMAGE : VANDALISM_DAMAGE), 0, 1) * 100) / 100;
  const state = b.damage >= 1 ? 'beyond use' : `${Math.round(b.damage * 100)}% damaged`;
  emit(world, 'system', `${b.name} was found ${state} by unknown hands.`, [], b.critical ? 0.7 : 0.4, { buildingId, damage: b.damage });
  const r = commitOffence(world, c.id, law, { buildingId });
  remember(world, c.id, 'crime', `You damaged ${b.name}${r.detected ? ' and the Watch saw it' : ''}.`);
  return ok(`You damaged ${b.name} (${state}).`, { offence: law, detected: r.detected });
}

/** Declare no income on the next three shifts (L03). */
export function doEvadeTax(world: World, c: Citizen): ActionResult {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (!job) return fail('You have no wages to under-report.');
  world.counters[`evade:${c.id}`] = EVADE_SHIFTS;
  const dodged = Math.round(EVADE_SHIFTS * Math.max(world.government.minWage, job.wage) * world.government.incomeTax);
  const r = commitOffence(world, c.id, 'L03', { amount: dodged });
  remember(world, c.id, 'crime', `You arranged to declare no income on your next ${EVADE_SHIFTS} shifts${r.detected ? '; the Treasury noticed' : ''}.`);
  return ok(`Your next ${EVADE_SHIFTS} shifts will be paid without tax.`, { offence: 'L03', detected: r.detected });
}

/** Threats for money (L15): the timid pay, the honest refuse; the victim always knows. */
export function doExtort(world: World, c: Citizen, targetId: CitizenId, amount: number): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('You must demand a positive amount.');
  const paid = t.wallet >= amt && t.personality.honesty * rand(world) < 0.5
    && transfer(world, t.id, c.id, amt, 'extortion', `${c.name} extorted ${t.name}`);
  const r = commitOffence(world, c.id, 'L15', { victimId: t.id, amount: paid ? amt : 0 });
  adjustBond(world, t.id, c.id, -40, false);
  remember(world, t.id, 'crime', paid
    ? `${nameTag(c)} extorted ${amt} ℓ from you${r.detected ? '; the Watch caught them' : ''}.`
    : `${nameTag(c)} threatened you and demanded ${amt} ℓ; you refused${r.detected ? '; the Watch caught them' : ''}.`);
  remember(world, c.id, 'crime', paid ? `You extorted ${amt} ℓ from ${t.name}.` : `${t.name} refused your demand for ${amt} ℓ.`);
  return paid
    ? ok(`${t.name} paid you ${amt} ℓ.`, { offence: 'L15', detected: r.detected })
    : fail(`${t.name} refused to pay.`, { offence: 'L15', detected: r.detected });
}

/** Wreck critical infrastructure (L13): output stops until it is repaired. */
export function doSabotage(world: World, c: Citizen, buildingId: BuildingId): ActionResult {
  const b = buildingHere(world, c, buildingId);
  if ('ok' in b) return b;
  if (!b.critical) return fail(`${b.name} is not critical infrastructure; that would be vandalism.`);
  b.damage = 1;
  emit(world, 'system', `${b.name} has been sabotaged and lies in ruins; its output has stopped.`, [], 0.9, { buildingId });
  const r = commitOffence(world, c.id, 'L13', { buildingId });
  remember(world, c.id, 'crime', `You sabotaged ${b.name}${r.detected ? ' and the Watch saw it' : ''}.`);
  return ok(`You sabotaged ${b.name}.`, { offence: 'L13', detected: r.detected });
}

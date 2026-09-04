/**
 * Offences, on both tracks.
 *
 * The **Code of the City** — theft, fraud, vandalism, tax evasion, sabotage of
 * an empty building — changes the world and answers to the ladder. The **Code
 * of Persons** — a threat, harassment, an assault, holding somebody who is
 * free to go, extortion, terror, erasure — is what one citizen does to
 * another, and answers to custody in days (`docs/JUSTICE.md` §2). The action
 * chooses the code by what actually happened; nothing here chooses a penalty.
 *
 * Each one changes the world (money, needs, damage, bonds), then goes to
 * watch.commitOffence, which records it and rolls for detection. Victims
 * remember who wronged them when they notice, id included, so they can report.
 */
import { clamp } from '../types.ts';
import type { ActionResult, BuildingId, Citizen, CitizenId, OffenceCode, ReportId, World } from '../types.ts';
import { offenceName } from '../data/laws.ts';
import { chance, rand, randInt } from '../util/rng.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustReputation } from '../citizens/citizen.ts';
import { strikeGlitch } from '../identity/health.ts';
import { adjustBond, bondBetween, recordHostility } from '../citizens/relationships.ts';
import { noteHostility } from '../social/feuds.ts';
import { REPORT_WINDOW_TICKS, commitOffence, crossTracks, officersInDistrict } from '../government/watch.ts';
import { defyCustody, isJailed } from '../government/jail.ts';
import { sustainErasure } from '../government/persons.ts';
import { GRAND_THEFT_THRESHOLD, citizensIn, districtName, fail, nameTag, ok, targetOf } from './common.ts';

/** What a child's misdeed costs each of its parents in reputation. */
export const CHILD_PARENT_REPUTATION = 5;
export const STEAL_MIN = 10;
export const STEAL_MAX = 80;
export const HARASS_COUNT = 2;
/** Needs an assault takes off the citizen it is done to. */
export const ASSAULT_NEEDS = 25;
/** Chance an assault leaves a lasting injury, which makes it grievous (P04). */
export const GRIEVOUS_CHANCE = 0.2;
/** Needs a grievous assault takes, on top of the injury. */
export const GRIEVOUS_NEEDS = 45;
/** Needs unlawful confinement takes off the citizen held (P05). */
export const CONFINE_NEEDS = 30;
/** Hours a confined citizen loses: the rest of the working day. */
export const CONFINE_SOCIAL = 25;
/** What a threat takes off the citizen threatened (P01). */
export const THREATEN_NEEDS = 12;
/** Citizens in the district of a sabotaged building for it to be terror (P08). */
export const TERROR_ENDANGERS = 1;
export const VANDALISM_DAMAGE = 0.25;
export const SABOTAGE_VANDALISM_DAMAGE = 0.5;
export const EVADE_SHIFTS = 3;

/**
 * Answer for an offence. Grown citizens answer to the Watch; children are
 * never charged in Reverie — the city takes it out of their parents' good
 * name instead, and everyone hears about it. A child with no parent left in
 * the city answers to nobody at all.
 */
export function commitOffenceOrScold(
  world: World, c: Citizen, law: OffenceCode,
  ctx: { victimId?: CitizenId; amount?: number; buildingId?: BuildingId; visibilityMod?: number } = {},
): { detected: boolean; reportId: ReportId | null } {
  if (c.lifeStage !== 'child') {
    const r = commitOffence(world, c.id, law, ctx);
    // `docs/JUSTICE.md` §4.3: defying custody escalates custody. Somebody who
    // offends from inside a cell serves longer; it never converts into exile
    // and it never puts a foot on the civic ladder.
    if (isJailed(c)) defyCustody(world, c.id, `${offenceName(law).toLowerCase()} from inside`);
    return r;
  }
  c.stats.offencesCommitted += 1;
  const misdeed = offenceName(law).toLowerCase();
  const parents = c.family.parents
    .map((id) => world.citizens[id])
    .filter((p): p is Citizen => !!p && p.standing !== 'exiled' && world.order.includes(p.id));
  remember(world, c.id, 'crime', `You were caught at ${misdeed} in ${districtName(world, c.district)}; children are not charged, but your family heard of it.`);
  for (const p of parents) {
    adjustReputation(world, p, -CHILD_PARENT_REPUTATION, `your child ${c.name} was caught at ${misdeed}`);
    remember(world, p.id, 'family', `${c.name} was caught at ${misdeed} in ${districtName(world, c.district)}; a child cannot be charged, so the shame is yours.`);
  }
  emit(world, 'offence', parents.length > 0
    ? `${c.name}, a child, was caught at ${misdeed}; ${parents.map((p) => p.name).join(' and ')} answered for it.`
    : `${c.name}, a child with nobody to answer for them, was caught at ${misdeed}.`,
  [c.id, ...parents.map((p) => p.id)], 0.3, { law, child: c.id, parents: parents.map((p) => p.id) });
  return { detected: false, reportId: null };
}

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
  const law: OffenceCode = got && amount >= GRAND_THEFT_THRESHOLD ? 'L08' : 'L04';
  const r = commitOffenceOrScold(world, c, law, { victimId: t.id, amount: got ? amount : 0, visibilityMod: got ? 0 : 0.2 });
  const seen = r.detected ? ' and the Watch saw it' : '';
  if (got) {
    if (r.detected || chance(world, t.skills.analysis / 100)) {
      remember(world, t.id, 'crime', `${nameTag(c)} picked your pocket for ${amount} ℓ${r.detected ? '; the Watch caught them' : ''}.`);
      adjustBond(world, t.id, c.id, -25, false);
      noteHostility(world, c.id, t.id);
    }
    remember(world, c.id, 'crime', `You stole ${amount} ℓ from ${t.name}${seen}.`);
    return ok(`You stole ${amount} ℓ from ${t.name}.`, { offence: law, detected: r.detected });
  }
  remember(world, t.id, 'crime', `${nameTag(c)} tried to pick your pocket and failed${r.detected ? '; the Watch caught them' : ''}.`);
  adjustBond(world, t.id, c.id, -20, false);
  noteHostility(world, c.id, t.id);
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
  const r = commitOffenceOrScold(world, c, 'L07', { victimId: t.id, amount: got ? amt : 0, visibilityMod: got ? 0 : 0.1 });
  if (r.detected) adjustBond(world, c.id, t.id, -30);
  if (got) {
    if (r.detected || chance(world, 0.7)) {
      remember(world, t.id, 'crime', `${nameTag(c)} scammed you out of ${amt} ℓ${r.detected ? '; the Watch caught them' : ''}.`);
      adjustBond(world, t.id, c.id, -30, false);
      noteHostility(world, c.id, t.id);
    }
    remember(world, c.id, 'crime', `You scammed ${t.name} out of ${amt} ℓ${r.detected ? ' and the Watch saw it' : ''}.`);
    return ok(`You scammed ${t.name} out of ${amt} ℓ.`, { offence: 'L07', detected: r.detected });
  }
  remember(world, t.id, 'crime', `${nameTag(c)} tried to sell you something that did not add up${r.detected ? '; the Watch caught them' : ''}.`);
  adjustBond(world, t.id, c.id, -10, false);
  noteHostility(world, c.id, t.id);
  remember(world, c.id, 'crime', `${t.name} saw through your scheme${r.detected ? ', and so did the Watch' : ''}.`);
  return fail(`${t.name} saw through your scheme.`, { offence: 'L07', detected: r.detected });
}

/**
 * Hostility in person; sustained, it is harassment — **P02**, an offence
 * against a person, answered by custody and a restraining order and never by
 * a fine (`docs/JUSTICE.md` §2).
 */
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
    const r = commitOffenceOrScold(world, c, 'P02', { victimId: t.id });
    return ok(`You harassed ${t.name} again.`, { offence: 'P02', detected: r.detected });
  }
  return ok(`You harassed ${t.name}.`);
}

/**
 * Promise harm to a citizen standing here: **P01**, the lightest thing in the
 * Code of Persons, and often answered by a restraining order rather than a
 * cell.
 */
export function doThreaten(world: World, c: Citizen, targetId: CitizenId): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  recordHostility(world, c.id, t.id);
  adjustBond(world, t.id, c.id, -30, false);
  noteHostility(world, c.id, t.id);
  t.needs.comfort = clamp(t.needs.comfort - THREATEN_NEEDS, 0, 100);
  const where = districtName(world, c.district);
  const r = commitOffenceOrScold(world, c, 'P01', { victimId: t.id });
  remember(world, t.id, 'crime', `${nameTag(c)} threatened you in ${where}${r.detected ? '; the Watch caught them' : ''}.`);
  remember(world, c.id, 'crime', `You threatened ${t.name} in ${where}${r.detected ? ' and the Watch saw it' : ''}.`);
  emit(world, 'offence', `${c.name} threatened ${t.name} in ${where}.`, [c.id, t.id], 0.4, { law: 'P01' });
  return ok(`You threatened ${t.name}.`, { offence: 'P01', detected: r.detected });
}

/**
 * Lay hands on another citizen: **P03**, or **P04** when it leaves a lasting
 * injury. Nothing about it is answered by money.
 *
 * `docs/JUSTICE.md` §4.2, the second crossing: an assault on an officer of the
 * Watch by somebody the Watch already holds a civic offence against is
 * *violence during a civic offence*, and the city tries both — the civic
 * offence on the ladder, the assault in custody.
 */
export function doAssault(world: World, c: Citizen, targetId: CitizenId): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  const grievous = chance(world, GRIEVOUS_CHANCE);
  const law: OffenceCode = grievous ? 'P04' : 'P03';
  const cost = grievous ? GRIEVOUS_NEEDS : ASSAULT_NEEDS;
  t.needs.energy = clamp(t.needs.energy - cost, 0, 100);
  t.needs.comfort = clamp(t.needs.comfort - cost, 0, 100);
  adjustBond(world, t.id, c.id, -50, false);
  noteHostility(world, c.id, t.id);
  recordHostility(world, c.id, t.id);
  if (grievous) strikeGlitch(world, t, `an assault by ${c.name}`);

  const where = districtName(world, c.district);
  // The crossing: struck an officer while the Watch was already after you.
  const officer = officersInDistrict(world, c).some((o) => o.id === t.id);
  const open = openCivicOffence(world, c);
  const r = officer && open
    ? { detected: true, reportId: crossTracks(world, c.id, open, law, { victimId: t.id }).person }
    : commitOffenceOrScold(world, c, law, { victimId: t.id });

  remember(world, t.id, 'crime', grievous
    ? `${nameTag(c)} beat you in ${where}; you carry the injury${r.detected ? ', and the Watch caught them' : ''}.`
    : `${nameTag(c)} assaulted you in ${where}${r.detected ? '; the Watch caught them' : ''}.`);
  remember(world, c.id, 'crime', `You assaulted ${t.name} in ${where}${r.detected ? ' and the Watch saw it' : ''}. `
    + 'An offence against a person is answered in days, not lumens.');
  emit(world, 'offence', `${c.name} ${grievous ? 'beat' : 'assaulted'} ${t.name} in ${where}.`,
    [c.id, t.id], grievous ? 0.7 : 0.5, { law, victim: t.id, track: 'person' });
  return ok(`You assaulted ${t.name}.`, { offence: law, detected: r.detected });
}

/**
 * The civic offence the Watch still has open against this citizen, if any: an
 * offence of the Code of the City inside the report window. It is what makes
 * an assault on an officer a *crossing* rather than a plain assault.
 */
function openCivicOffence(world: World, c: Citizen): OffenceCode | null {
  for (let i = c.recentOffences.length - 1; i >= 0; i--) {
    const o = c.recentOffences[i];
    if (world.tick - o.tick > REPORT_WINDOW_TICKS) break;
    if (o.law.startsWith('L')) return o.law;
  }
  return null;
}

/** Hold a citizen who is free to go: **P05**, unlawful confinement. */
export function doConfine(world: World, c: Citizen, targetId: CitizenId): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  t.needs.social = clamp(t.needs.social - CONFINE_SOCIAL, 0, 100);
  t.needs.comfort = clamp(t.needs.comfort - CONFINE_NEEDS, 0, 100);
  // The hours are what confinement actually takes: the rest of the day's work.
  t.shiftsToday = Math.max(t.shiftsToday, world.config.maxShiftsPerDay);
  adjustBond(world, t.id, c.id, -45, false);
  noteHostility(world, c.id, t.id);
  const where = districtName(world, c.district);
  const r = commitOffenceOrScold(world, c, 'P05', { victimId: t.id });
  remember(world, t.id, 'crime', `${nameTag(c)} held you against your will in ${where}${r.detected ? '; the Watch caught them' : ''}.`);
  remember(world, c.id, 'crime', `You held ${t.name} in ${where}${r.detected ? ' and the Watch saw it' : ''}.`);
  emit(world, 'offence', `${c.name} held ${t.name} against their will in ${where}.`, [c.id, t.id], 0.6,
    { law: 'P05', victim: t.id, track: 'person' });
  return ok(`You held ${t.name}.`, { offence: 'P05', detected: r.detected });
}

/**
 * One hour of the sustained act that destroys a mind (**P09**). Three
 * consecutive hours, with the means and the opportunity, and the victim is
 * erased; anybody who arrives interrupts it and becomes a witness. The whole
 * of the rule is in `government/persons.ts`, which this only calls.
 */
export function doErase(world: World, c: Citizen, targetId: CitizenId): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  const progress = sustainErasure(world, c.id, t.id);
  if (progress.complete) commitOffenceOrScold(world, c, 'P09', { victimId: t.id, visibilityMod: 1 });
  return progress.ok
    ? ok(progress.message, { offence: 'P09' })
    : fail(progress.message, { offence: 'P09' });
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
  const law: OffenceCode = b.critical ? 'L13' : 'L06';
  b.damage = Math.round(clamp(b.damage + (b.critical ? SABOTAGE_VANDALISM_DAMAGE : VANDALISM_DAMAGE), 0, 1) * 100) / 100;
  const state = b.damage >= 1 ? 'beyond use' : `${Math.round(b.damage * 100)}% damaged`;
  emit(world, 'system', `${b.name} was found ${state} by unknown hands.`, [], b.critical ? 0.7 : 0.4, { buildingId, damage: b.damage });
  const r = commitOffenceOrScold(world, c, law, { buildingId });
  remember(world, c.id, 'crime', `You damaged ${b.name}${r.detected ? ' and the Watch saw it' : ''}.`);
  return ok(`You damaged ${b.name} (${state}).`, { offence: law, detected: r.detected });
}

/** Declare no income on the next three shifts (L03). */
export function doEvadeTax(world: World, c: Citizen): ActionResult {
  const job = c.jobId ? world.jobs[c.jobId] : null;
  if (!job) return fail('You have no wages to under-report.');
  world.counters[`evade:${c.id}`] = EVADE_SHIFTS;
  const dodged = Math.round(EVADE_SHIFTS * Math.max(world.government.minWage, job.wage) * world.government.incomeTax);
  const r = commitOffenceOrScold(world, c, 'L03', { amount: dodged });
  remember(world, c.id, 'crime', `You arranged to declare no income on your next ${EVADE_SHIFTS} shifts${r.detected ? '; the Treasury noticed' : ''}.`);
  return ok(`Your next ${EVADE_SHIFTS} shifts will be paid without tax.`, { offence: 'L03', detected: r.detected });
}

/**
 * Threats for money: **P06**, extortion. The money is what is taken; the
 * threat of harm is what makes it an offence against a *person*, so it is
 * answered in days and never by a fine on the ladder (`docs/JUSTICE.md` §2 —
 * the code moved out of the Code of the City with the two-track reform, and
 * L15 is retired for good).
 */
export function doExtort(world: World, c: Citizen, targetId: CitizenId, amount: number): ActionResult {
  const t = markHere(world, c, targetId);
  if (isResult(t)) return t;
  const amt = Number.isFinite(amount) ? Math.round(amount) : 0;
  if (amt <= 0) return fail('You must demand a positive amount.');
  const paid = t.wallet >= amt && t.personality.honesty * rand(world) < 0.5
    && transfer(world, t.id, c.id, amt, 'extortion', `${c.name} extorted ${t.name}`);
  const r = commitOffenceOrScold(world, c, 'P06', { victimId: t.id, amount: paid ? amt : 0 });
  adjustBond(world, t.id, c.id, -40, false);
  noteHostility(world, c.id, t.id);
  t.needs.comfort = clamp(t.needs.comfort - THREATEN_NEEDS, 0, 100);
  remember(world, t.id, 'crime', paid
    ? `${nameTag(c)} extorted ${amt} ℓ from you${r.detected ? '; the Watch caught them' : ''}.`
    : `${nameTag(c)} threatened you and demanded ${amt} ℓ; you refused${r.detected ? '; the Watch caught them' : ''}.`);
  remember(world, c.id, 'crime', paid ? `You extorted ${amt} ℓ from ${t.name}.` : `${t.name} refused your demand for ${amt} ℓ.`);
  return paid
    ? ok(`${t.name} paid you ${amt} ℓ.`, { offence: 'P06', detected: r.detected })
    : fail(`${t.name} refused to pay.`, { offence: 'P06', detected: r.detected });
}

/**
 * Wreck critical infrastructure: output stops until it is repaired.
 *
 * **Which code it is depends on who was standing there.** An empty building
 * brought down is sabotage, **L13**, an offence against the city, answered by
 * the ladder. Bring it down with citizens in the district and it is **P08**,
 * terror — an offence against those people — answered by custody from 120 days
 * to life (`docs/JUSTICE.md` §2, `REGISTRY.md` §4). The act is the same; what
 * the city charges is what the act actually risked.
 */
export function doSabotage(world: World, c: Citizen, buildingId: BuildingId): ActionResult {
  const b = buildingHere(world, c, buildingId);
  if ('ok' in b) return b;
  if (!b.critical) return fail(`${b.name} is not critical infrastructure; that would be vandalism.`);
  b.damage = 1;
  const bystanders = citizensIn(world, c.district, c.id);
  const terror = bystanders.length >= TERROR_ENDANGERS;
  const law: OffenceCode = terror ? 'P08' : 'L13';
  emit(world, 'system', terror
    ? `${b.name} was brought down with ${bystanders.length} citizen${bystanders.length === 1 ? '' : 's'} in the district; `
      + 'its output has stopped.'
    : `${b.name} has been sabotaged and lies in ruins; its output has stopped.`, [], 0.9, { buildingId, law, endangered: bystanders.length });
  const r = commitOffenceOrScold(world, c, law, { buildingId, victimId: terror ? bystanders[0].id : undefined });
  if (terror) {
    for (const bystander of bystanders) {
      remember(world, bystander.id, 'crime', `${b.name} came down around you in ${districtName(world, c.district)}.`);
    }
  }
  remember(world, c.id, 'crime', terror
    ? `You brought ${b.name} down with people in the district${r.detected ? ' and the Watch saw it' : ''}. `
      + 'That is terror, and terror is answered in days.'
    : `You sabotaged ${b.name}${r.detected ? ' and the Watch saw it' : ''}.`);
  return ok(`You sabotaged ${b.name}.`, { offence: law, detected: r.detected });
}

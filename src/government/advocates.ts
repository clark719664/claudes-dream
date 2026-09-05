/**
 * Advocates: somebody to speak for you.
 *
 * A defendant may `hire_advocate` before or during their trial, and the
 * advocate `advocate`s — speaks — at the Courthouse while the case sits. What
 * a speech is worth is the advocate's rhetoric and nothing else: at most
 * `MAX_ADVOCACY` off every judge's belief, once per case. It never touches a
 * jury's own noise, never shortens a term, and never buys an acquittal on its
 * own — a good advocate moves a doubtful case, not a certain one.
 *
 * Wealth buys a better advocate; it does not buy a different law. So that the
 * gravest charges are not tried against a defendant with nobody at all, the
 * Courthouse keeps **Public Defenders** on the city payroll: they charge
 * nothing, and one is assigned to any serious charge whose defendant has not
 * found their own.
 */
import { clamp } from '../types.ts';
import type { ActionResult, Case, CaseId, Citizen, CitizenId, World } from '../types.ts';
import { ADVOCATE_BASE_FEE } from '../data/jobs.ts';
import { JURY_SEVERITY, MAX_ADVOCACY } from '../data/metropolis.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { adjustReputation } from '../citizens/citizen.ts';
import { isDetained, isPresent, nameOf } from './cases.ts';
import { isJailed } from './jail.ts';
import { memo } from '../util/memo.ts';

/** Rhetoric below which the Court will not hear you speak for somebody else. */
export const ADVOCATE_MIN_RHETORIC = 40;
/** The Courthouse, where an advocate must stand to be heard. */
export const COURTHOUSE_DISTRICT = 'commons';
/** Rhetoric a speech is worth to the advocate who gave it. */
export const ADVOCATE_SKILL_GAIN = 0.5;
/** Longest speech the record keeps. */
export const SPEECH_LENGTH = 280;

function fail(message: string): ActionResult { return { ok: false, message }; }

/** Holders of the city's Public Defender post, on duty and able to speak. */
export function publicDefenders(world: World): Citizen[] {
  return memo(world, 'advocates:public', () => publicDefendersNow(world));
}

function publicDefendersNow(world: World): Citizen[] {
  const out: Citizen[] = [];
  for (const id of world.order) {
    const c = world.citizens[id];
    if (!c || !c.jobId) continue;
    const job = world.jobs[c.jobId];
    if (!job || job.role !== 'advocate' || job.holderId !== c.id) continue;
    if (c.standing !== 'good' && c.standing !== 'probation') continue;
    if (isJailed(c) || isDetained(world, c) || !isPresent(world, c)) continue;
    out.push(c);
  }
  return out;
}

/** True while this citizen holds the city's Public Defender post. */
export function isPublicDefender(world: World, c: Citizen): boolean {
  return publicDefenders(world).some((d) => d.id === c.id);
}

/** A juror or a judge on this case cannot also speak for the defendant. */
function sitsOn(k: Case, cId: CitizenId): boolean {
  return k.judges.includes(cId) || (k.jury ?? []).includes(cId);
}

/**
 * Whether a citizen may speak for somebody. Adult, here, in good standing or
 * on probation, and articulate enough to be heard — and, when a case is named,
 * not the victim, not on the bench or the jury, and not the officer who filed.
 */
export function mayAdvocate(world: World, c: Citizen | null | undefined, k?: Case): boolean {
  if (!c || !isPresent(world, c)) return false;
  if (c.lifeStage === 'child') return false;
  if (c.standing !== 'good' && c.standing !== 'probation') return false;
  // Somebody the Watch is holding cannot stand up in the Courthouse for
  // anybody else, and neither can somebody in the cells.
  if (isJailed(c) || isDetained(world, c)) return false;
  if (c.skills.rhetoric < ADVOCATE_MIN_RHETORIC) return false;
  if (!k) return true;
  if (c.id === k.defendantId || c.id === k.victimId || c.id === k.filedBy) return false;
  return !sitsOn(k, c.id);
}

/** What a private advocate asks: a base fee and half their rhetoric. */
export function advocateFee(world: World, c: Citizen): number {
  if (isPublicDefender(world, c)) return 0;
  return ADVOCATE_BASE_FEE + Math.round(Math.max(0, c.skills.rhetoric) / 2);
}

/** The case a citizen is defending against right now: the one before the Court, oldest first. */
function caseAwaitingTrial(world: World, cId: CitizenId): Case | null {
  let best: Case | null = null;
  for (const k of Object.values(world.cases)) {
    if (k.defendantId !== cId) continue;
    if (k.status !== 'pending' && k.status !== 'in_session') continue;
    if (!best || k.filedTick < best.filedTick) best = k;
  }
  return best;
}

/**
 * Retain an advocate for the charge you are facing. A Public Defender charges
 * nothing; anybody else is paid their fee before they say a word.
 */
export function hireAdvocate(world: World, cId: CitizenId, advocateId: CitizenId): ActionResult {
  const d = world.citizens[cId];
  if (!d) return fail('Unknown citizen.');
  const k = caseAwaitingTrial(world, cId);
  if (!k) return fail('There is no charge against you for anyone to answer.');
  if (k.advocateId) {
    return fail(k.advocateId === advocateId
      ? `${nameOf(world, advocateId)} already speaks for you in case ${k.id}.`
      : `${nameOf(world, k.advocateId)} already speaks for you in case ${k.id}.`);
  }
  const a = world.citizens[advocateId];
  if (!a) return fail('Nobody by that id lives in Reverie.');
  if (a.id === cId) return fail('You cannot be hired to speak for yourself; speak for yourself for nothing.');
  if (!mayAdvocate(world, a, k)) {
    return fail(a.skills.rhetoric < ADVOCATE_MIN_RHETORIC
      ? `${a.name} has not the rhetoric the Court requires of an advocate (${Math.round(a.skills.rhetoric)} of ${ADVOCATE_MIN_RHETORIC}).`
      : `${a.name} cannot speak for you in case ${k.id}.`);
  }

  const fee = advocateFee(world, a);
  if (fee > 0) {
    if (d.wallet < fee) return fail(`${a.name} asks ${fee} ℓ and you have ${Math.floor(d.wallet)} ℓ.`);
    if (!transfer(world, d.id, a.id, fee, 'advocate', `advocate's fee in case ${k.id}`)) {
      return fail(`You could not pay ${a.name}'s fee of ${fee} ℓ.`);
    }
  }
  k.advocateId = a.id;
  k.advocacy ??= 0;

  const paid = fee > 0 ? ` for ${fee} ℓ` : ' as a Public Defender, for nothing';
  emit(world, 'charge', `${a.name} will speak for ${d.name} in case ${k.id}${paid}.`, [d.id, a.id], 0.3,
    { caseId: k.id, advocate: a.id, fee });
  remember(world, d.id, 'civic', `You retained ${a.name} to speak for you in case ${k.id}${paid}.`);
  remember(world, a.id, 'civic', `You were retained to speak for ${d.name} in case ${k.id}${paid}.`);
  return { ok: true, message: `${a.name} will speak for you in case ${k.id}${paid}.` };
}

/**
 * Speak. Once per case, at the Courthouse, while the bench is sitting: every
 * judge's belief falls by up to `MAX_ADVOCACY`, scaled by the advocate's
 * rhetoric. What was said goes on the record with the votes.
 */
export function speak(world: World, cId: CitizenId, caseId: CaseId, words?: string): ActionResult {
  const a = world.citizens[cId];
  if (!a) return fail('Unknown citizen.');
  const k = world.cases[caseId];
  if (!k) return fail('There is no such case.');
  if (k.advocateId !== cId) return fail(`You do not speak for the defendant in case ${k.id}.`);
  if (k.status !== 'in_session') {
    return fail(k.status === 'pending'
      ? `Case ${k.id} is not before the Court until its next sitting.`
      : `Case ${k.id} has already been decided.`);
  }
  if (!mayAdvocate(world, a, k)) return fail(`You cannot speak for anybody while ${a.standing}.`);
  if (a.district !== COURTHOUSE_DISTRICT) return fail('You must stand in the Courthouse to be heard.');
  if ((k.advocacy ?? 0) > 0) return fail(`You have already spoken in case ${k.id}.`);

  const worth = clamp(MAX_ADVOCACY * (Math.max(0, a.skills.rhetoric) / 100), 0, MAX_ADVOCACY);
  k.advocacy = Math.round(worth * 1000) / 1000;
  a.skills.rhetoric = clamp(a.skills.rhetoric + ADVOCATE_SKILL_GAIN, 0, 100);
  adjustReputation(world, a, 1);

  const said = (words ?? '').replace(/\s+/g, ' ').trim().slice(0, SPEECH_LENGTH);
  const d = nameOf(world, k.defendantId);
  emit(world, 'charge', `${a.name} spoke for ${d} in case ${k.id}${said ? `: "${said}"` : '.'}`,
    [a.id, k.defendantId], 0.4, { caseId: k.id, advocate: a.id, advocacy: k.advocacy });
  remember(world, a.id, 'civic', `You spoke for ${d} in case ${k.id}${said ? `: "${said}"` : '.'}`);
  remember(world, k.defendantId, 'verdict', `${a.name} spoke for you in case ${k.id}${said ? `: "${said}"` : '.'}`);
  return { ok: true, message: `You spoke for ${d} in case ${k.id}.` };
}

/** What an advocate's speech takes off a judge's belief. Zero when nobody spoke. */
export function advocacyDiscount(world: World, k: Case): number {
  const v = k.advocacy;
  return Number.isFinite(v) && (v as number) > 0 ? clamp(v as number, 0, MAX_ADVOCACY) : 0;
}

/** Cases a defender is already carrying this sitting. */
function caseload(world: World, defenderId: CitizenId): number {
  let n = 0;
  for (const k of Object.values(world.cases)) {
    if (k.advocateId === defenderId && (k.status === 'pending' || k.status === 'in_session')) n++;
  }
  return n;
}

/**
 * Nobody faces a grave charge alone if the city can help it: a defendant with
 * no advocate and a charge of severity ≥ JURY_SEVERITY is given whichever
 * Public Defender is carrying the least, for nothing.
 */
export function assignDefender(world: World, k: Case): void {
  if (k.advocateId || k.severity < JURY_SEVERITY) return;
  if (k.status !== 'pending' && k.status !== 'in_session') return;
  const pool = publicDefenders(world).filter((c) => mayAdvocate(world, c, k));
  if (pool.length === 0) return;
  const chosen = [...pool].sort((a, b) =>
    caseload(world, a.id) - caseload(world, b.id)
    || b.skills.rhetoric - a.skills.rhetoric
    || a.id.localeCompare(b.id))[0];
  k.advocateId = chosen.id;
  k.advocacy ??= 0;
  const d = nameOf(world, k.defendantId);
  emit(world, 'charge', `The Courthouse assigned Public Defender ${chosen.name} to ${d} in case ${k.id}.`,
    [chosen.id, k.defendantId], 0.3, { caseId: k.id, advocate: chosen.id, fee: 0 });
  remember(world, chosen.id, 'civic', `You were assigned to defend ${d} in case ${k.id}.`);
  remember(world, k.defendantId, 'verdict', `Public Defender ${chosen.name} was assigned to speak for you in case ${k.id}.`);
}

/** The advocate speaking for a case, when there is one. */
export function advocateFor(world: World, k: Case): Citizen | null {
  return k.advocateId ? world.citizens[k.advocateId] ?? null : null;
}

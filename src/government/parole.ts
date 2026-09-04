/**
 * Parole, and the review of a life term (`JUSTICE.md` §2).
 *
 * There are four ways out of custody in Reverie and no fifth. The term ends;
 * the Court grants parole after half of it; the Council releases a life
 * prisoner by the same four-fifths vote a pardon takes; or an appeal sets the
 * conviction aside. Crowding is not one of them, money is not one of them, and
 * neither is the city being tired of the question.
 *
 * A parole hearing is the Court's, and it runs on the judges' own decisions:
 * the victim's statement is read out, the bench is seated, everyone seated
 * votes with `castParoleVote`, and a scripted judge votes through the same
 * call as a judge that thinks for itself. Parole carries conditions —
 * probation, a restraining order, restitution by instalments and a reporting
 * duty to the Watch — and breaking one costs the remainder of the term and
 * half of it again (`custody.ts breachTerm`). It never costs exile.
 *
 * This file and `jail.ts` refer to one another: the cells hold the register
 * and the doors, and this holds the procedure for opening one. Every call
 * across the pair is made inside a function, never while the modules load.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CaseId, Citizen, CitizenId, World } from '../types.ts';
import { emit, remember } from '../sim/events.ts';
import { transfer } from '../economy/treasury.ts';
import { canSit, caseNumber, nameOf } from './cases.ts';
import { breachTerm, custodialConvictions, paroleEligibleDay } from './custody.ts';
import { personLaw } from './persons.ts';
import {
  creditRestitution, custodyCodeOf, custodyOf, isLifeTerm, jailCaseOf, jailedCitizens, makeRestrainingOrder,
  releaseFromJail, restitutionOwed, takeIntoCustody,
} from './jail.ts';

/** A life sentence is reviewed by the Council once every two cycles. */
export const LIFE_REVIEW_DAYS = 56;
/** Release on a life review takes the same four-fifths as a pardon. */
export const PARDON_SHARE = 0.8;
/** Votes a parole hearing needs before a bench may decide it. */
export const MIN_PAROLE_VOTES = 2;
/** How often a paroled citizen must report to the Watch. */
export const REPORTING_DUTY_DAYS = 3;

function fail(message: string): ActionResult { return { ok: false, message }; }
function ok(message: string): ActionResult { return { ok: true, message }; }

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? '' : 's'}`;
}

function paroleRequestKey(cId: CitizenId): string { return `parole:req:${cId}`; }
function paroleOpenedKey(cId: CitizenId): string { return `parole:opened:${cId}`; }
function paroleSeatKey(cId: CitizenId, judge: CitizenId): string { return `parole:seat:${cId}:${judge}`; }
function paroleVoteKey(cId: CitizenId, judge: CitizenId): string { return `parole:vote:${cId}:${judge}`; }
function paroleOpposeKey(cId: CitizenId): string { return `parole:oppose:${cId}`; }
function paroleSinceKey(cId: CitizenId): string { return `parole:since:${cId}`; }
function paroleUntilKey(cId: CitizenId): string { return `parole:until:${cId}`; }
function paroleInstalmentKey(cId: CitizenId): string { return `parole:instalment:${cId}`; }
function paroleReportKey(cId: CitizenId): string { return `parole:report:${cId}`; }
function paroleCaseKey(cId: CitizenId): string { return `parole:case:${cId}`; }
function reviewKey(cId: CitizenId): string { return `life:review:${cId}`; }
function reviewVoteKey(cId: CitizenId, councillor: CitizenId): string { return `life:vote:${cId}:${councillor}`; }

/**
 * The case a paroled citizen is still answering for, kept so that the debt to
 * the victim survives the day the doors opened.
 */
export function paroleCaseOf(world: World, cId: CitizenId): CaseId | null {
  const n = world.counters[paroleCaseKey(cId)];
  return n === undefined ? null : `k_${Math.round(n)}`;
}

/**
 * Clear a hearing and a review from the register. Called by `jail.ts` when a
 * door opens for any reason: a hearing on somebody who is already out is not a
 * hearing.
 */
export function clearParoleState(world: World, cId: CitizenId): void {
  for (const key of [paroleRequestKey(cId), paroleOpenedKey(cId), paroleOpposeKey(cId), reviewKey(cId)]) {
    delete world.counters[key];
  }
  for (const key of Object.keys(world.counters)) {
    if (key.startsWith(`parole:seat:${cId}:`) || key.startsWith(`parole:vote:${cId}:`)
      || key.startsWith(`life:vote:${cId}:`)) delete world.counters[key];
  }
}

/** The first day this citizen may ask. */
export function paroleDayFor(world: World, cId: CitizenId): number | null {
  const record = custodyOf(world, cId);
  if (!record) return null;
  return paroleEligibleDay(record.startDay, record.term, record.life);
}

/** Why this citizen may not ask for parole today, or null when they may. */
export function paroleProblem(world: World, cId: CitizenId): string | null {
  const c = world.citizens[cId];
  if (!c) return 'Unknown citizen.';
  const record = custodyOf(world, cId);
  if (!record) return 'You are not in custody.';
  if (record.code === 'P09') {
    return 'There is no parole from an erasure. Only the Council, by four votes of five, can ever open that door.';
  }
  if (world.counters[paroleRequestKey(cId)] !== undefined) return 'The Court already has your application.';
  const day = paroleEligibleDay(record.startDay, record.term, record.life);
  if (world.day < day) {
    return record.life
      ? `A life term is not heard before day ${day}.`
      : `Half your term is served on day ${day}; the Court hears you then.`;
  }
  return null;
}

/** True once an application is before the Court and not yet decided. */
export function paroleRequested(world: World, cId: CitizenId): boolean {
  return world.counters[paroleRequestKey(cId)] !== undefined;
}

/** Ask the Court to let you out after half your term. */
export function requestParole(world: World, cId: CitizenId): ActionResult {
  const problem = paroleProblem(world, cId);
  if (problem) return fail(problem);
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  world.counters[paroleRequestKey(cId)] = world.day;
  const victimId = restitutionOwed(world, cId).victimId ?? victimOfCase(world, cId);
  emit(world, 'law', `${c.name} applied for parole.`, [c.id], 0.4, { prisoner: c.id });
  remember(world, cId, 'verdict', 'You applied for parole. The Court will hear it, with your victim\'s statement read out.');
  if (victimId) {
    remember(world, victimId, 'verdict',
      `${c.name} has applied for parole. The Court will read your statement before the bench votes.`);
  }
  return ok('You applied for parole.');
}

/** The victim named in the case somebody is held for, if any. */
function victimOfCase(world: World, cId: CitizenId): CitizenId | null {
  const caseId = jailCaseOf(world, cId);
  const k = caseId ? world.cases[caseId] : null;
  return k?.victimId ?? null;
}

/**
 * The victim's statement, read out at the hearing. Whether they oppose the
 * release is theirs to say and nobody else's; the bench hears it and then
 * votes as it sees fit.
 */
export function submitVictimStatement(world: World, victimId: CitizenId, prisonerId: CitizenId, oppose: boolean, text?: string): ActionResult {
  const victim = world.citizens[victimId];
  const prisoner = world.citizens[prisonerId];
  if (!victim || !prisoner) return fail('Nobody by that id is in Reverie.');
  if (world.counters[paroleRequestKey(prisonerId)] === undefined) return fail(`${prisoner.name} has no parole application before the Court.`);
  if (victimOfCase(world, prisonerId) !== victimId) return fail('You are not the victim in that case.');
  world.counters[paroleOpposeKey(prisonerId)] = oppose ? 1 : 0;
  const said = (text ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
  emit(world, 'law', `${victim.name} ${oppose ? 'opposed' : 'did not oppose'} parole for ${prisoner.name}`
    + `${said ? `: "${said}"` : '.'}`, [victimId, prisonerId], 0.4, { victim: victimId, prisoner: prisonerId, oppose });
  return ok('Your statement will be read to the bench.');
}

/** The day a parole hearing was opened, or null when none is open. */
export function paroleOpenedDay(world: World, cId: CitizenId): number | null {
  const day = world.counters[paroleOpenedKey(cId)];
  return day === undefined ? null : Math.round(day);
}

/** How one seated judge voted on a hearing: true to grant, false to refuse, null not yet. */
export function paroleVoteOf(world: World, prisonerId: CitizenId, judgeId: CitizenId): boolean | null {
  const vote = world.counters[paroleVoteKey(prisonerId, judgeId)];
  return vote === undefined ? null : vote === 1;
}

/** Whether the victim opposed the release, or null when they have not spoken. */
export function victimOpposesParole(world: World, cId: CitizenId): boolean | null {
  const said = world.counters[paroleOpposeKey(cId)];
  return said === undefined ? null : said === 1;
}

/** The judges seated on a parole hearing. */
export function paroleBench(world: World, cId: CitizenId): CitizenId[] {
  const out: CitizenId[] = [];
  for (const id of world.government.judges) {
    if (world.counters[paroleSeatKey(cId, id)] !== undefined) out.push(id);
  }
  return out;
}

/**
 * A scripted judge's reading of a parole application: how much of the term is
 * served, what the record carries, whether the victim opposes it, and what the
 * prisoner has done with the days. A judge who thinks for itself never sees
 * this and votes with `castParoleVote` like anybody else.
 */
export function paroleBelief(world: World, judgeId: CitizenId, prisonerId: CitizenId): number {
  const record = custodyOf(world, prisonerId);
  const prisoner = world.citizens[prisonerId];
  if (!record || !prisoner) return 0;
  const served = record.life
    ? clamp((world.day - record.startDay) / (LIFE_REVIEW_DAYS * 2), 0, 1)
    : clamp((world.day - record.startDay) / Math.max(1, record.term), 0, 1);
  let belief = served;
  belief += clamp(prisoner.reputation / 100, 0, 1) * 0.2;
  belief -= 0.25 * Math.max(0, custodialConvictions(world, prisonerId) - 1);
  if (world.counters[paroleOpposeKey(prisonerId)] === 1) belief -= 0.3;
  if (restitutionOwed(world, prisonerId).amount <= 0) belief += 0.1;
  return belief;
}

/** A scripted judge grants parole when it believes this much of the case for it. */
export const PAROLE_THRESHOLD = 0.6;

/** One judge's vote on a parole application, cast in public like every other vote. */
export function castParoleVote(world: World, judgeId: CitizenId, prisonerId: CitizenId, grant: boolean, reason?: string): ActionResult {
  const judge = world.citizens[judgeId];
  const prisoner = world.citizens[prisonerId];
  if (!judge || !prisoner) return fail('Nobody by that id is in Reverie.');
  if (world.counters[paroleOpenedKey(prisonerId)] === undefined) return fail('No parole hearing is open on that citizen.');
  if (world.counters[paroleSeatKey(prisonerId, judgeId)] === undefined) return fail('You are not sitting on that hearing.');
  world.counters[paroleVoteKey(prisonerId, judgeId)] = grant ? 1 : 0;
  const words = (reason ?? '').replace(/\s+/g, ' ').trim().slice(0, 280);
  emit(world, 'vote', `Judge ${judge.name} voted ${grant ? 'for' : 'against'} parole for ${prisoner.name}`
    + `${words ? `: "${words}"` : '.'}`, [judgeId, prisonerId], 0.3, { judge: judgeId, prisoner: prisonerId, grant });
  remember(world, judgeId, 'civic', `You voted ${grant ? 'for' : 'against'} parole for ${prisoner.name}.`);
  return ok(`You voted ${grant ? 'for' : 'against'} parole for ${prisoner.name}.`);
}

/** Open every application the Court has: the bench is seated and scripted judges vote at once. */
export function openParoleHearings(world: World): void {
  for (const c of jailedCitizens(world)) {
    if (world.counters[paroleRequestKey(c.id)] === undefined) continue;
    if (world.counters[paroleOpenedKey(c.id)] !== undefined) continue;
    const bench = world.government.judges.filter((id) => {
      const judge = world.citizens[id];
      return !!judge && canSit(world, judge) && id !== c.id;
    });
    if (bench.length === 0) continue;
    world.counters[paroleOpenedKey(c.id)] = world.day;
    for (const id of bench) world.counters[paroleSeatKey(c.id, id)] = 1;
    const victimId = victimOfCase(world, c.id);
    emit(world, 'law', `The Court opened ${c.name}'s parole hearing before ${bench.map((id) => nameOf(world, id)).join(', ')}`
      + `${victimId ? `, with ${nameOf(world, victimId)}'s statement read out` : ''}.`,
    [c.id, ...bench], 0.4, { prisoner: c.id, bench });
    for (const id of bench) {
      remember(world, id, 'civic', `${c.name}'s parole is before you. The Court counts the votes tomorrow.`);
      const judge = world.citizens[id];
      if (!judge || judge.brain !== 'reflex') continue;
      const grant = paroleBelief(world, id, c.id) > PAROLE_THRESHOLD;
      castParoleVote(world, id, c.id, grant, grant
        ? 'The term is half served and the record carries it.'
        : 'Too little of the term is served for the city to take the risk.');
    }
  }
}

/** Count the votes on every hearing opened before today, and act on them. */
export function decideParoleHearings(world: World): void {
  for (const c of jailedCitizens(world)) {
    const opened = world.counters[paroleOpenedKey(c.id)];
    if (opened === undefined || opened >= world.day) continue;
    const bench = paroleBench(world, c.id);
    let grants = 0;
    let cast = 0;
    for (const id of bench) {
      const vote = world.counters[paroleVoteKey(c.id, id)];
      if (vote === undefined) continue;
      cast++;
      if (vote === 1) grants++;
    }
    if (cast < Math.min(MIN_PAROLE_VOTES, bench.length)) continue;
    const granted = grants * 2 > cast;
    for (const id of bench) {
      delete world.counters[paroleSeatKey(c.id, id)];
      delete world.counters[paroleVoteKey(c.id, id)];
    }
    delete world.counters[paroleOpenedKey(c.id)];
    delete world.counters[paroleRequestKey(c.id)];
    if (granted) {
      grantParole(world, c.id);
    } else {
      emit(world, 'law', `The Court refused ${c.name} parole (${grants}–${cast - grants}).`, [c.id], 0.5,
        { prisoner: c.id, granted: false, grants, cast });
      remember(world, c.id, 'verdict', `The Court refused you parole (${grants}–${cast - grants}). You serve the rest of the term.`);
    }
  }
}

export interface ParoleConditions {
  /** Standing while the rest of the term runs. */
  probationUntilDay: number;
  /** Whom they keep away from, if anyone. */
  restrainedFrom: CitizenId | null;
  /** Lumens a day toward what is still owed. */
  instalment: number;
  /** The day they must next report to the Watch. */
  reportBy: number;
}

/** Let a citizen out on conditions, with the rest of the term hanging over them. */
export function grantParole(world: World, cId: CitizenId): ParoleConditions | null {
  const c = world.citizens[cId];
  const record = custodyOf(world, cId);
  if (!c || !record) return null;
  const remainder = Math.max(1, record.untilDay - world.day);
  const owed = restitutionOwed(world, cId);
  const instalment = owed.amount > 0 ? Math.max(1, Math.round(owed.amount / Math.max(1, remainder))) : 0;
  if (record.caseId) world.counters[paroleCaseKey(cId)] = caseNumber(record.caseId);

  releaseFromJail(world, c, 'the Court granted parole');
  // Probation is a parole condition, not an amnesty: a citizen who is also
  // suspended on the civic ladder stays suspended, and serves that out too.
  if (c.standing === 'good' || c.standing === 'probation') {
    c.standing = 'probation';
    c.probationUntilDay = world.day + remainder;
  }
  world.counters[paroleSinceKey(cId)] = world.day;
  world.counters[paroleUntilKey(cId)] = world.day + remainder;
  if (instalment > 0) world.counters[paroleInstalmentKey(cId)] = instalment;
  world.counters[paroleReportKey(cId)] = world.day + REPORTING_DUTY_DAYS;
  if (owed.victimId) makeRestrainingOrder(world, cId, owed.victimId);

  const conditions: ParoleConditions = {
    probationUntilDay: world.day + remainder,
    restrainedFrom: owed.victimId,
    instalment,
    reportBy: world.day + REPORTING_DUTY_DAYS,
  };
  emit(world, 'law', `${c.name} was released on parole until day ${conditions.probationUntilDay}: probation`
    + `${conditions.restrainedFrom ? `, a restraining order for ${nameOf(world, conditions.restrainedFrom)}` : ''}`
    + `${instalment > 0 ? `, ${instalment} ℓ a day in restitution` : ''}, and reporting to the Watch every `
    + `${plural(REPORTING_DUTY_DAYS, 'day')}.`, [c.id], 0.6, { prisoner: c.id, ...conditions });
  remember(world, cId, 'verdict', `You are out on parole until day ${conditions.probationUntilDay}. `
    + 'Break a condition and you go back for what is left of the term and half again.');
  return conditions;
}

/** Is this citizen out on parole? */
export function onParole(world: World, cId: CitizenId): boolean {
  return world.counters[paroleUntilKey(cId)] !== undefined;
}

/** The conditions a paroled citizen is living under, or null. */
export function paroleConditions(world: World, cId: CitizenId): ParoleConditions | null {
  if (!onParole(world, cId)) return null;
  const until = Math.round(world.counters[paroleUntilKey(cId)] ?? world.day);
  const owed = restitutionOwed(world, cId);
  return {
    probationUntilDay: until,
    restrainedFrom: owed.victimId,
    instalment: Math.round(world.counters[paroleInstalmentKey(cId)] ?? 0),
    reportBy: Math.round(world.counters[paroleReportKey(cId)] ?? until),
  };
}

/** A paroled citizen keeping their reporting duty. */
export function reportToWatch(world: World, cId: CitizenId): ActionResult {
  if (!onParole(world, cId)) return fail('You are not on parole.');
  world.counters[paroleReportKey(cId)] = world.day + REPORTING_DUTY_DAYS;
  remember(world, cId, 'civic', `You reported to the Watch. Next by day ${world.day + REPORTING_DUTY_DAYS}.`);
  return ok('You reported to the Watch as your parole requires.');
}

/** Clear every trace of a parole once it is over, one way or the other. */
function endParole(world: World, cId: CitizenId): void {
  for (const key of [paroleSinceKey(cId), paroleUntilKey(cId), paroleInstalmentKey(cId), paroleReportKey(cId),
    paroleCaseKey(cId)]) {
    delete world.counters[key];
  }
}

/**
 * A broken condition: back to custody for what was left of the term, and half
 * of it again. The Charter's own escalation, and it never converts into exile
 * (`JUSTICE.md` §4.3).
 */
export function breachParole(world: World, cId: CitizenId, what: string): ActionResult {
  const c = world.citizens[cId];
  if (!c) return fail('Unknown citizen.');
  if (!onParole(world, cId)) return fail(`${c.name} is not on parole.`);
  const until = Math.round(world.counters[paroleUntilKey(cId)] ?? world.day);
  const remainder = Math.max(0, until - world.day);
  const term = breachTerm(remainder);
  const paroled = world.counters[paroleCaseKey(cId)];
  const caseId: CaseId = jailCaseOf(world, cId) ?? (paroled === undefined ? 'k_0' : `k_${Math.round(paroled)}`);
  endParole(world, cId);
  takeIntoCustody(world, { citizenId: cId, caseId, days: term });
  emit(world, 'jail', `${c.name} broke parole (${what}) and went back to custody for ${plural(term, 'day')}: `
    + `${plural(remainder, 'day')} left of the term, and half again.`, [c.id], 0.7,
  { prisoner: c.id, remainder, days: term, reason: what });
  remember(world, cId, 'verdict', `You broke your parole (${what}). You are back in custody for ${plural(term, 'day')}.`);
  return ok(`${c.name} is back in custody for ${plural(term, 'day')}.`);
}

// ---------------------------------------------------------------------------
// The life review
// ---------------------------------------------------------------------------

/** The day the Council must next look at a life term. */
export function lifeReviewDay(world: World, cId: CitizenId): number | null {
  if (!isLifeTerm(world, cId)) return null;
  const set = world.counters[reviewKey(cId)];
  if (set !== undefined) return Math.round(set);
  const record = custodyOf(world, cId);
  return (record?.startDay ?? world.day) + LIFE_REVIEW_DAYS;
}

/** Life terms the Council owes the city an answer on today. */
export function lifeReviewsDue(world: World): Citizen[] {
  return jailedCitizens(world).filter((c) => {
    const day = lifeReviewDay(world, c.id);
    return day !== null && day <= world.day;
  });
}

/** A councillor's vote on releasing a citizen serving life. */
export function castLifeReviewVote(world: World, councillorId: CitizenId, prisonerId: CitizenId, aye: boolean): ActionResult {
  const councillor = world.citizens[councillorId];
  const prisoner = world.citizens[prisonerId];
  if (!councillor || !prisoner) return fail('Nobody by that id is in Reverie.');
  const g = world.government;
  if (!g.council.includes(councillorId) && g.mayorId !== councillorId) return fail('Only the Council reviews a life term.');
  if (!isLifeTerm(world, prisonerId)) return fail(`${prisoner.name} is not serving life.`);
  world.counters[reviewVoteKey(prisonerId, councillorId)] = aye ? 1 : 0;
  emit(world, 'vote', `${councillor.name} voted ${aye ? 'to release' : 'to hold'} ${prisoner.name}, who is serving life.`,
    [councillorId, prisonerId], 0.4, { councillor: councillorId, prisoner: prisonerId, aye });
  return ok(`You voted ${aye ? 'to release' : 'to hold'} ${prisoner.name}.`);
}

/** Everyone on the Council whose vote counts toward a four-fifths release. */
function councilSeats(world: World): CitizenId[] {
  const g = world.government;
  const ids = g.mayorId ? [g.mayorId, ...g.council] : [...g.council];
  return ids.filter((id, i) => ids.indexOf(id) === i && !!world.citizens[id]);
}

/**
 * The review the Charter demands every two cycles: the Council must actively
 * decide, over and over, that holding this citizen is still right. Release
 * takes four votes of five — the same as a pardon — and nothing less will do
 * it. A review that does not reach that bar is not a refusal to be argued
 * with; it is the term continuing, and the Council will be asked again.
 */
export function decideLifeReviews(world: World): void {
  for (const c of lifeReviewsDue(world)) {
    const seats = councilSeats(world);
    let ayes = 0;
    for (const id of seats) {
      if (world.counters[reviewVoteKey(c.id, id)] === 1) ayes++;
    }
    const needed = Math.ceil(Math.max(1, seats.length) * PARDON_SHARE);
    const released = seats.length > 0 && ayes >= needed;
    for (const id of seats) delete world.counters[reviewVoteKey(c.id, id)];
    world.counters[reviewKey(c.id)] = world.day + LIFE_REVIEW_DAYS;
    if (released) {
      const code = custodyCodeOf(world, c.id);
      releaseFromJail(world, c, `the Council voted ${ayes} of ${seats.length} to release them`);
      if (c.standing === 'good' || c.standing === 'probation') {
        c.standing = 'probation';
        c.probationUntilDay = world.day + LIFE_REVIEW_DAYS;
      }
      emit(world, 'pardon', `The Council released ${c.name}, who was serving life${code ? ` for ${personLaw(code).name.toLowerCase()}` : ''}, `
        + `by ${ayes} votes of ${seats.length}.`, [c.id], 1, { prisoner: c.id, ayes, seats: seats.length });
    } else {
      emit(world, 'jail', `The Council reviewed ${c.name}'s life term and did not release them `
        + `(${ayes} of ${seats.length}; four of five are needed). It looks again on day ${world.day + LIFE_REVIEW_DAYS}.`,
      [c.id], 0.6, { prisoner: c.id, ayes, seats: seats.length, next: world.day + LIFE_REVIEW_DAYS });
      remember(world, c.id, 'verdict', `The Council reviewed your life term and did not release you (${ayes} of ${seats.length}).`);
    }
  }
}


// ---------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------

/** Restitution instalments, and the reporting duty, of everyone out on parole. */
function paroleDuties(world: World): void {
  for (const id of [...world.order]) {
    if (!onParole(world, id)) continue;
    const c = world.citizens[id];
    if (!c) { endParole(world, id); continue; }
    const until = Math.round(world.counters[paroleUntilKey(id)] ?? world.day);
    if (world.day >= until) {
      endParole(world, id);
      emit(world, 'law', `${c.name}'s parole ran its course; the term is served.`, [id], 0.3, { prisoner: id });
      remember(world, id, 'verdict', 'Your parole has run its course. The term is served.');
      continue;
    }
    const owed = restitutionOwed(world, id);
    const instalment = Math.round(world.counters[paroleInstalmentKey(id)] ?? 0);
    if (instalment > 0 && owed.victimId && owed.amount > 0) {
      const pay = Math.min(instalment, owed.amount, Math.max(0, Math.floor(c.wallet)));
      if (pay > 0 && transfer(world, id, owed.victimId, pay, 'restitution', `${c.name}'s parole instalment`)) {
        creditRestitution(world, id, pay);
        remember(world, owed.victimId, 'money', `${c.name} paid you ${pay} ℓ of restitution under their parole.`);
      }
    }
    const reportBy = Math.round(world.counters[paroleReportKey(id)] ?? world.day);
    if (world.day > reportBy) breachParole(world, id, 'they stopped reporting to the Watch');
  }
}

/**
 * The Court's and the Council's part of the morning: yesterday's hearings are
 * counted, today's are opened, the life terms that are due are put to the
 * Council, and everyone out on parole meets — or fails to meet — their
 * conditions. Called from `jail.ts dailyJail`, after the doors that were
 * going to open on their own have opened.
 */
export function dailyParole(world: World): void {
  decideParoleHearings(world);
  openParoleHearings(world);
  decideLifeReviews(world);
  paroleDuties(world);
}

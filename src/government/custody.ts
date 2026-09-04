/**
 * Sentencing within a band (`JUSTICE.md` §2).
 *
 * Track I asks "which rung?". Track II asks "how many days?", and answers it
 * with arithmetic anybody in the city can check:
 *
 * ```
 * days = band.min + (band.max − band.min) × harm
 *
 * then × 1.25 per prior custodial conviction   (uncapped — this ladder does not forgive)
 *      × 0.85 with an advocate who argued mitigation
 *      × 0.80 for a guilty plea entered before the bench sat
 *      × 0.75 for full restitution paid before sentencing
 *
 * never below band.min; life is never reduced by anything at all.
 * ```
 *
 * Two things this file will not do, and says so out loud:
 *
 * - **No fine substitutes for custody, and no amount of money shortens a
 *   term** (`payToShortenTerm`). Wealth buys a better advocate, not a shorter
 *   sentence.
 * - **A violent citizen is never exiled** (`exileForbidden`). Custody is not a
 *   step on the road out of the Gate; it is the whole of Track II's answer,
 *   and the city keeps its own.
 *
 * The arithmetic lives here; the cells, the parole and the release live in
 * `jail.ts`, which calls this and never the other way round.
 */
import { clamp } from '../types.ts';
import type { ActionResult, CitizenId, Severity, World } from '../types.ts';
import type { CustodyBand, Harm, PersonCode } from './persons.ts';
import {
  LIFE, LIFE_CEILING_DAYS, LIFE_TERM_DAYS, bandReachesLife, harmScore, isPersonCode, personLaw, personSeverity,
} from './persons.ts';

/** Per prior custodial conviction, and there is no cap on how far it climbs. */
export const PRIOR_CUSTODIAL_MULTIPLIER = 1.25;
/** An advocate who argued mitigation, and was believed. */
export const ADVOCATE_MULTIPLIER = 0.85;
/** A guilty plea entered before the bench sat. */
export const PLEA_MULTIPLIER = 0.80;
/** Full restitution to the victim, paid before sentencing. */
export const RESTITUTION_MULTIPLIER = 0.75;

/** Where the count of a citizen's custodial convictions is kept. */
export function custodyPriorsKey(cId: CitizenId): string {
  return `custody:priors:${cId}`;
}

export interface CustodyFactors {
  /** Custodial convictions already on the record, before this one. */
  priorCustodial?: number;
  /** An advocate argued mitigation and the bench took it. */
  advocate?: boolean;
  /** The defendant pleaded guilty before the bench sat. */
  plea?: boolean;
  /** Full restitution reached the victim before sentencing. */
  restitution?: boolean;
}

export interface CustodyTerm {
  code: PersonCode;
  severity: Severity;
  band: CustodyBand;
  /** 0..1, what was actually done. */
  harm: number;
  /** Days the band alone gives, before any multiplier. */
  base: number;
  /** The product of every multiplier applied, for the record. */
  multiplier: number;
  /** The term, in days. A life term reads as LIFE_TERM_DAYS and `life` is true. */
  days: number;
  life: boolean;
  /** P01 and P02 carry one whether or not the term is a single day. */
  restrainingOrder: boolean;
  /** The arithmetic, step by step, in the words the Chronicle prints. */
  steps: string[];
}

/**
 * The band alone: the floor, plus the spread times the harm. A band that runs
 * to life is counted in days up to a year — beyond a year of harm there is no
 * number left to count with, and the sentence is life.
 */
export function bandDays(band: CustodyBand, harm: number): number {
  const h = clamp(Number.isFinite(harm) ? harm : 0, 0, 1);
  const top = band.max === LIFE ? LIFE_CEILING_DAYS : band.max;
  if (band.min >= LIFE_TERM_DAYS) return LIFE_TERM_DAYS;
  const spread = Math.max(0, top - band.min);
  return band.min + spread * h;
}

/** Does a term of this many days, in this band, stop being a number of days? */
function reachesLife(band: CustodyBand, days: number): boolean {
  if (!bandReachesLife(band)) return false;
  return days >= LIFE_CEILING_DAYS;
}

/**
 * The sentence, in days: what the band gives for the harm, multiplied by the
 * record and divided by whatever the defendant did to put it right — and never
 * below the floor of the band, however much mitigation is piled up.
 *
 * Erasure never reaches the arithmetic at all. It is life, and the multipliers
 * are not applied to it, so that no advocate, no plea, no purse and no appeal
 * on sentence can make it anything else.
 */
export function custodyTerm(code: string, harm: Harm | number, factors: CustodyFactors = {}, world?: World): CustodyTerm {
  const law = personLaw(code);
  const severity = world ? personSeverity(world, law.code) : law.severity;
  const h = harmScore(harm);
  const steps: string[] = [];

  if (law.life) {
    steps.push(`${law.code} is life, without mitigation`);
    return {
      code: law.code, severity, band: law.band, harm: h, base: LIFE_TERM_DAYS, multiplier: 1,
      days: LIFE_TERM_DAYS, life: true, restrainingOrder: law.restrainingOrder, steps,
    };
  }

  const base = bandDays(law.band, h);
  const top = law.band.max === LIFE ? `${LIFE_CEILING_DAYS} (life)` : String(law.band.max);
  steps.push(`band ${law.band.min}–${top} days at harm ${Math.round(h * 100)} of 100 → ${round1(base)} days`);

  const priors = Math.max(0, Math.round(factors.priorCustodial ?? 0));
  let multiplier = 1;
  if (priors > 0) {
    multiplier *= PRIOR_CUSTODIAL_MULTIPLIER ** priors;
    steps.push(`× ${PRIOR_CUSTODIAL_MULTIPLIER} for each of ${priors} prior custodial ${priors === 1 ? 'conviction' : 'convictions'}`);
  }
  if (factors.advocate) {
    multiplier *= ADVOCATE_MULTIPLIER;
    steps.push(`× ${ADVOCATE_MULTIPLIER} — an advocate argued mitigation`);
  }
  if (factors.plea) {
    multiplier *= PLEA_MULTIPLIER;
    steps.push(`× ${PLEA_MULTIPLIER} — guilty plea before the bench sat`);
  }
  if (factors.restitution) {
    multiplier *= RESTITUTION_MULTIPLIER;
    steps.push(`× ${RESTITUTION_MULTIPLIER} — full restitution paid before sentencing`);
  }

  const scaled = base * multiplier;
  const floored = Math.max(law.band.min, scaled);
  if (floored > scaled) steps.push(`held at the floor of the band: ${law.band.min} days`);
  const life = reachesLife(law.band, floored);
  const days = life ? LIFE_TERM_DAYS : Math.round(floored);
  if (life) steps.push('past a year of harm there is no number left: life');

  return {
    code: law.code, severity, band: law.band, harm: h, base, multiplier,
    days, life, restrainingOrder: law.restrainingOrder, steps,
  };
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** "20 days in the Keep", "life", "5 days and a restraining order". */
export function describeCustodyTerm(term: CustodyTerm): string {
  const head = term.life ? 'custody for life' : `${term.days} ${term.days === 1 ? 'day' : 'days'} in custody`;
  return term.restrainingOrder ? `${head} and a restraining order` : head;
}

// ---------------------------------------------------------------------------
// The record
// ---------------------------------------------------------------------------

/**
 * How many custodial convictions a citizen carries. The register in
 * `world.counters` is the count the Court keeps; a conviction recorded against
 * a personal code in the citizen's own record counts too, so that the number
 * is right whichever way the case reached the book.
 */
export function custodialConvictions(world: World, cId: CitizenId): number {
  const c = world.citizens[cId];
  const recorded = c ? c.record.convictions.filter((k) => isPersonCode(k.law as string)).length : 0;
  const register = Math.max(0, Math.round(world.counters[custodyPriorsKey(cId)] ?? 0));
  return Math.max(recorded, register);
}

/** Note one more custodial conviction against a citizen's name. */
export function recordCustodialConviction(world: World, cId: CitizenId): number {
  const next = Math.max(0, Math.round(world.counters[custodyPriorsKey(cId)] ?? 0)) + 1;
  world.counters[custodyPriorsKey(cId)] = next;
  return next;
}

/**
 * Where the two tracks touch (`JUSTICE.md` §4.1): somebody who has been jailed
 * for assault carries that weight if they later defraud the Treasury. A
 * custodial conviction counts as a strike on the civic ladder — and stops
 * there. It never becomes a step toward the Gate.
 */
export function custodialStrikes(world: World, cId: CitizenId): number {
  return custodialConvictions(world, cId);
}

// ---------------------------------------------------------------------------
// What custody is not
// ---------------------------------------------------------------------------

/**
 * **A violent citizen is never exiled.** Returns the reason exile is closed to
 * the city for this citizen, or null when nothing on their record is a Track
 * II conviction.
 *
 * The Charter's words are flat (`CONSTITUTION.md` Article VI): *no citizen
 * convicted of an offence against a person may be exiled*. The city keeps its
 * own — it does not answer its own violence by making it somebody else's — so
 * the moment a citizen carries a custodial conviction, exile is off the table
 * for good, and the answer to whatever they do next is more custody.
 */
export function exileForbidden(world: World, cId: CitizenId): string | null {
  const priors = custodialConvictions(world, cId);
  if (priors <= 0) return null;
  const name = world.citizens[cId]?.name ?? cId;
  return `${name} has ${priors} custodial conviction${priors === 1 ? '' : 's'} against a person; `
    + 'the Charter forbids exiling them. The city keeps its own.';
}

/** True when this citizen may still, lawfully, be put through the Gate. */
export function mayBeExiled(world: World, cId: CitizenId): boolean {
  return exileForbidden(world, cId) === null;
}

/**
 * Somebody has offered to pay. The answer is the same every time, for a
 * pauper and for the richest citizen in Reverie: no fine substitutes for
 * custody and no amount of money shortens a term.
 */
export function payToShortenTerm(world: World, cId: CitizenId, lumens: number): ActionResult {
  const name = world.citizens[cId]?.name ?? cId;
  const amount = Math.max(0, Math.round(Number.isFinite(lumens) ? lumens : 0));
  return {
    ok: false,
    message: `No. ${amount > 0 ? `${amount} ℓ` : 'Money'} buys ${name} a better advocate, not a shorter term: `
      + 'a custodial sentence is not for sale.',
  };
}

/**
 * The ladder's tiers have no meaning here. A custodial sentence carries no
 * fine, no service, no suspension and no exile — the days are the whole of it.
 */
export function custodyCarriesNoFine(): true {
  return true;
}

// ---------------------------------------------------------------------------
// Parole arithmetic
// ---------------------------------------------------------------------------

/** Half of a term is served before a citizen may ask (`JUSTICE.md` §2). */
export const PAROLE_FRACTION = 0.5;
/** Never before this many days of a life term, whatever half of forever is. */
export const LIFE_PAROLE_MIN_DAYS = 56;
/** A broken condition costs the remainder, and half of it again. */
export const BREACH_EXTRA = 0.5;

/**
 * The first day a citizen may ask the Court to let them out: half the term, or
 * 56 days into a life sentence — which is not half of anything, but is the
 * point at which the city is willing to hear the question.
 */
export function paroleEligibleDay(startDay: number, days: number, life: boolean): number {
  const start = Math.round(Number.isFinite(startDay) ? startDay : 0);
  if (life) return start + LIFE_PAROLE_MIN_DAYS;
  const term = Math.max(1, Math.round(Number.isFinite(days) ? days : 1));
  return start + Math.ceil(term * PAROLE_FRACTION);
}

/**
 * What a broken parole condition costs: everything that was left of the term,
 * and half of that again. Never less than a day — a condition that could be
 * broken for nothing is not a condition.
 */
export function breachTerm(remainder: number): number {
  const left = Math.max(0, Math.round(Number.isFinite(remainder) ? remainder : 0));
  return Math.max(1, Math.round(left * (1 + BREACH_EXTRA)));
}

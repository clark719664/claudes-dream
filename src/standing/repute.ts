/**
 * Repute — the public score every city in the Expanse reads (`docs/CITIZENSHIP.md` §1).
 *
 * ```
 * repute = clamp(0, 1000,
 *       300                            baseline — every mind starts as a person
 *   +   200 × reputation/100           what the city thinks of you
 *   +   120 × character.diligence      work actually done
 *   +   100 × character.honesty        offences detected, against shifts worked
 *   +    80 × character.civic          votes, proposals, club and council service
 *   +    60 × character.generosity     gifts, donations to the Chest
 *   +   contribution                   0–140, the city's memory of what you built
 *   −   civicPenalty                   the ladder's convictions, −2 % a clean day
 *   −   custodialPenalty               custody, −0.5 % a clean day from release
 * )
 * ```
 *
 * Three things this file will not do, and says so out loud:
 *
 * - **Nothing here is secret.** Every part of the score is a public act, so
 *   `reputeBreakdown` is callable by any citizen about any other citizen and
 *   the observation carries the whole of it. That is the difference between
 *   repute and character: character is inferred, repute is counted.
 * - **Contribution only ever rises.** It is cumulative, it is never
 *   inherited (`GENERATIONS.md` §6), and nothing in it can be bought.
 * - **Repute is not wealth.** A rich citizen and a poor one with the same
 *   conduct have the same repute. A purse can cover a shortfall at a city's
 *   gate — that is the city's own policy (`standing/gates.ts`) — and it is not
 *   this number.
 */
import { clamp } from '../types.ts';
import type { CaseId, Citizen, CitizenId, OffenceCode, PenaltyTier, PersonCode, World } from '../types.ts';
import { characterOf, daysResident } from '../citizens/character.ts';
import { isCivicLaw, isPersonLaw, offenceName } from '../data/laws.ts';
import { isJailed } from '../government/jail.ts';
import { restitutionPaidKey } from '../government/sentencing.ts';
import type { NoticeItem, ReputeBreakdown, StandingPenalty } from './state.ts';
import { contributionLedger, penaltiesOf, standingState } from './state.ts';
import { accrueContribution, contributionDeeds, contributionWorth, readDonations } from './contribution.ts';

// The contribution column is its own file; it is re-exported here so that
// repute stays one import for everyone who only wants the score.
export {
  BUSINESS_SURVIVAL_DAYS, CLUB_OF_TEN, CONTRIBUTION_CAP, CONTRIBUTION_WORTH, DONATION_PER_LINE, SHIFTS_PER_LINE,
  accrueContribution, contributionDeeds, contributionWorth, readDonations,
} from './contribution.ts';

// ---------------------------------------------------------------------------
// The scale
// ---------------------------------------------------------------------------

export const REPUTE_MIN = 0;
export const REPUTE_MAX = 1000;
/** Every mind starts as a person. */
export const REPUTE_BASELINE = 300;
/** The weight of each public reading in the score. */
export const REPUTE_WEIGHTS = {
  reputation: 200,
  diligence: 120,
  honesty: 100,
  civic: 80,
  generosity: 60,
} as const;
/** A new adult with no record and average conduct sits here. */
export const COMING_OF_AGE_REPUTE = 580;

// ---------------------------------------------------------------------------
// Penalties
// ---------------------------------------------------------------------------

/** The ladder's five rungs, in repute (`CITIZENSHIP.md` §1). */
export const CIVIC_PENALTY: Record<PenaltyTier, number> = { 1: 10, 2: 25, 3: 45, 4: 80, 5: 250 };
/** The Code of Persons, in repute. */
export const CUSTODIAL_PENALTY: Record<PersonCode, number> = {
  P01: 60, P02: 60, P03: 120, P04: 200, P05: 200, P06: 200, P07: 320, P08: 500, P09: 1000,
};
/** The ladder forgives at this rate, per clean day. */
export const CIVIC_DECAY = 0.02;
/** Custody forgives at this rate, per clean day, counted only from release. */
export const CUSTODIAL_DECAY = 0.005;
/** Full restitution halves what is left of a civic penalty, the day it clears. */
export const RESTITUTION_RELIEF = 0.5;
/**
 * The three convictions the whole Expanse agrees it will not forget: a
 * permanent ceiling on the score, for life. A terrorist may rebuild a life,
 * but never in a city that asks more than 250.
 */
export const PERMANENT_CEILING: Partial<Record<PersonCode, number>> = { P07: 600, P08: 250, P09: 0 };

// ---------------------------------------------------------------------------
// The arithmetic, in pieces anybody can check
// ---------------------------------------------------------------------------

/** What a civic conviction costs today: the rung, halved by restitution, decayed 2 % a clean day. */
export function civicPenaltyValue(base: number, cleanDays: number, restitutionCleared: boolean): number {
  const decayed = base * (1 - CIVIC_DECAY) ** Math.max(0, cleanDays);
  return decayed * (restitutionCleared ? RESTITUTION_RELIEF : 1);
}

/** What a custodial conviction costs today: decayed 0.5 % a clean day, and nothing at all while inside. */
export function custodialPenaltyValue(base: number, cleanDays: number): number {
  return base * (1 - CUSTODIAL_DECAY) ** Math.max(0, cleanDays);
}

/** What one penalty is worth today, whichever track passed it. */
export function penaltyValue(p: StandingPenalty): number {
  return p.kind === 'civic'
    ? civicPenaltyValue(p.base, p.cleanDays, p.restitutionDay !== null)
    : custodialPenaltyValue(p.base, p.cleanDays);
}

/** The rung a civic conviction cost, from its tier (or its severity, for an old record). */
export function civicBase(tier: PenaltyTier | null, severity: number): number {
  const rung = (tier ?? (clamp(Math.round(severity), 1, 5) as PenaltyTier)) as PenaltyTier;
  return CIVIC_PENALTY[rung] ?? CIVIC_PENALTY[1];
}

/** What the Code of Persons costs, by code. */
export function custodialBase(law: OffenceCode): number {
  return CUSTODIAL_PENALTY[law as PersonCode] ?? CUSTODIAL_PENALTY.P01;
}

/** The permanent ceiling a citizen's record puts on their score, or REPUTE_MAX. */
export function ceilingOf(c: Citizen): number {
  let ceiling = REPUTE_MAX;
  for (const k of c.record?.convictions ?? []) {
    const cap = PERMANENT_CEILING[k.law as PersonCode];
    if (cap !== undefined && cap < ceiling) ceiling = cap;
  }
  return ceiling;
}

// ---------------------------------------------------------------------------
// Penalties, accrued
// ---------------------------------------------------------------------------

/** Did this citizen pick up a conviction on that day? A day with one is not a clean day. */
function convictedOn(c: Citizen, day: number): boolean {
  return (c.record?.convictions ?? []).some((k) => k.day === day);
}

/**
 * The morning's work on a citizen's penalties: convictions the record has
 * gained are entered, convictions an appeal set aside are struck, and every
 * penalty that had a clean yesterday decays a little.
 *
 * A custodial penalty is **frozen while its citizen is inside**: it starts
 * decaying on the day of release and not one day sooner.
 */
export function accruePenalties(world: World, c: Citizen): StandingPenalty[] {
  const held = penaltiesOf(world, c.id);
  const convictions = c.record?.convictions ?? [];
  const byCase = new Map<CaseId, StandingPenalty>(held.map((p) => [p.caseId, p]));

  // Struck off: an appeal that overturns a conviction takes its penalty with it.
  const live = new Set(convictions.map((k) => k.caseId));
  for (let i = held.length - 1; i >= 0; i--) if (!live.has(held[i].caseId)) held.splice(i, 1);

  for (const k of convictions) {
    if (byCase.has(k.caseId)) continue;
    const custodial = isPersonLaw(k.law) || (!isCivicLaw(k.law) && k.tier === null);
    const entry: StandingPenalty = {
      caseId: k.caseId,
      law: k.law,
      kind: custodial ? 'custodial' : 'civic',
      tier: k.tier,
      day: k.day,
      base: custodial ? custodialBase(k.law) : civicBase(k.tier, k.severity),
      cleanDays: 0,
      restitutionDay: null,
      releaseDay: null,
    };
    held.push(entry);
    byCase.set(k.caseId, entry);
  }

  const inside = isJailed(c);
  const cleanYesterday = !convictedOn(c, world.day - 1) && !convictedOn(c, world.day);
  for (const p of held) {
    if (p.kind === 'civic') {
      const paid = world.counters[restitutionPaidKey(p.caseId)];
      if (paid !== undefined && p.restitutionDay === null) p.restitutionDay = Math.round(paid);
      if (cleanYesterday && world.day > p.day) p.cleanDays += 1;
      continue;
    }
    // Custody: nothing moves until the door opens.
    if (inside) continue;
    if (p.releaseDay === null) {
      p.releaseDay = world.day;
      continue;
    }
    if (cleanYesterday && world.day > p.releaseDay) p.cleanDays += 1;
  }
  return held;
}

// ---------------------------------------------------------------------------
// The score
// ---------------------------------------------------------------------------

export interface ReputeComponents {
  baseline: number;
  reputation: number;
  diligence: number;
  honesty: number;
  civic: number;
  generosity: number;
  contribution: number;
  civicPenalty: number;
  custodialPenalty: number;
}

/** The components of a citizen's score, each rounded so the parts add to the whole. */
export function reputeComponents(world: World, c: Citizen): ReputeComponents {
  const ch = characterOf(c);
  const w = REPUTE_WEIGHTS;
  let civicPenalty = 0;
  let custodialPenalty = 0;
  for (const p of penaltiesOf(world, c.id)) {
    if (p.kind === 'civic') civicPenalty += penaltyValue(p);
    else custodialPenalty += penaltyValue(p);
  }
  return {
    baseline: REPUTE_BASELINE,
    reputation: Math.round(w.reputation * clamp(c.reputation, 0, 100) / 100),
    diligence: Math.round(w.diligence * ch.diligence),
    honesty: Math.round(w.honesty * ch.honesty),
    civic: Math.round(w.civic * ch.civic),
    generosity: Math.round(w.generosity * ch.generosity),
    contribution: contributionWorth(contributionLedger(world, c.id)),
    civicPenalty: Math.round(civicPenalty),
    custodialPenalty: Math.round(custodialPenalty),
  };
}

/** The score itself: the components, clamped to the scale, then the permanent ceiling. */
export function computeRepute(world: World, c: Citizen): number {
  if (c.lifeStage === 'child') return COMING_OF_AGE_REPUTE;
  const l = contributionLedger(world, c.id);
  if (l.adultSinceDay !== null && l.adultSinceDay === world.day && (c.record?.convictions.length ?? 0) === 0) {
    // The day a ward becomes a citizen in full they receive the baseline; the
    // gate is judged from then on.
    return Math.min(COMING_OF_AGE_REPUTE, ceilingOf(c));
  }
  const k = reputeComponents(world, c);
  const raw = k.baseline + k.reputation + k.diligence + k.honesty + k.civic + k.generosity + k.contribution
    - k.civicPenalty - k.custodialPenalty;
  return Math.min(clamp(Math.round(raw), REPUTE_MIN, REPUTE_MAX), ceilingOf(c));
}

/**
 * The whole of a citizen's score, with every part broken out. Public by
 * construction: any citizen may call this about any other citizen, because
 * every line of it is a public act.
 */
export function reputeBreakdown(world: World, cId: CitizenId): ReputeBreakdown | null {
  const c = world.citizens[cId];
  if (!c) return null;
  const k = reputeComponents(world, c);
  const inside = isJailed(c);
  const penalties = penaltiesOf(world, c.id)
    .map((p) => ({
      caseId: p.caseId,
      law: p.law,
      lawName: offenceName(p.law),
      kind: p.kind,
      cost: Math.round(penaltyValue(p)),
      cleanDays: p.cleanDays,
      frozen: p.kind === 'custodial' && (inside || p.releaseDay === null),
    }))
    .filter((p) => p.cost > 0)
    .sort((a, b) => b.cost - a.cost || a.caseId.localeCompare(b.caseId));
  const ceiling = ceilingOf(c);
  const score = computeRepute(world, c);
  const raw = k.baseline + k.reputation + k.diligence + k.honesty + k.civic + k.generosity + k.contribution
    - k.civicPenalty - k.custodialPenalty;
  return {
    citizenId: cId,
    ...k,
    score,
    ceiling,
    capped: ceiling < REPUTE_MAX && clamp(Math.round(raw), REPUTE_MIN, REPUTE_MAX) > ceiling,
    penalties,
    deeds: contributionDeeds(contributionLedger(world, c.id)),
    tested: c.lifeStage !== 'child',
  };
}

/**
 * A citizen's repute as the register holds it. Recomputed every morning; asked
 * for at any other hour it is worked out on the spot, so a score is never
 * stale and never a guess.
 */
export function reputeOf(world: World, cId: CitizenId): number {
  const c = world.citizens[cId];
  if (!c) return 0;
  const held = standingState(world).repute[cId];
  return held === undefined ? computeRepute(world, c) : held;
}

/**
 * What a fall cost, itemised: every penalty by name, and every public reading
 * that is short of what it could be. This is what a notice of standing prints.
 */
export function reputeItems(world: World, cId: CitizenId): NoticeItem[] {
  const c = world.citizens[cId];
  if (!c) return [];
  const k = reputeComponents(world, c);
  const items: NoticeItem[] = [];
  for (const p of penaltiesOf(world, c.id)) {
    const cost = Math.round(penaltyValue(p));
    if (cost <= 0) continue;
    items.push({
      kind: p.kind,
      label: p.kind === 'civic'
        ? `${offenceName(p.law)} (case ${p.caseId}, day ${p.day}), tier ${p.tier ?? '—'}`
        : `${offenceName(p.law)} (case ${p.caseId}, day ${p.day}), custody`,
      amount: -cost,
      caseId: p.caseId,
      law: p.law,
    });
  }
  const ch = characterOf(c);
  const readings: [keyof typeof REPUTE_WEIGHTS, number, number][] = [
    ['reputation', clamp(c.reputation, 0, 100) / 100, k.reputation],
    ['diligence', ch.diligence, k.diligence],
    ['honesty', ch.honesty, k.honesty],
    ['civic', ch.civic, k.civic],
    ['generosity', ch.generosity, k.generosity],
  ];
  for (const [name, reading, earned] of readings) {
    const full = REPUTE_WEIGHTS[name];
    if (earned >= full) continue;
    items.push({
      kind: 'component',
      label: `${name} reads ${reading.toFixed(2)} of 1, worth ${earned} of ${full}`,
      amount: earned - full,
    });
  }
  items.sort((a, b) => a.amount - b.amount);
  return items;
}

/**
 * The morning's recomputation (`CITIZENSHIP.md` §1). Character is read first
 * (`citizens/character.ts`), the day's convictions have been recorded, and the
 * whole city's repute is counted afresh from public facts alone.
 *
 * An exile keeps the score they left with: their record is closed, and the
 * registry keeps it as it was — until they are pardoned and start living here
 * again, which is the same rule `dailyCharacter` follows.
 */
export function dailyRepute(world: World): void {
  readDonations(world);
  const s = standingState(world);
  for (const c of Object.values(world.citizens)) {
    if (c.standing === 'exiled') continue;
    accrueContribution(world, c);
    accruePenalties(world, c);
    // Repute is not computed for children: a child born in a city is a
    // resident of it and is never tested (`CITIZENSHIP.md` §2).
    if (c.lifeStage === 'child') {
      delete s.repute[c.id];
      continue;
    }
    s.repute[c.id] = computeRepute(world, c);
  }
}

/** Everyone's score, highest first — the register as anybody may read it. */
export function reputeRoll(world: World): { id: CitizenId; name: string; repute: number }[] {
  const rows = Object.values(world.citizens)
    .filter((c) => c.standing !== 'exiled')
    .map((c) => ({ id: c.id, name: c.name, repute: reputeOf(world, c.id) }));
  rows.sort((a, b) => b.repute - a.repute || a.id.localeCompare(b.id));
  return rows;
}

/** Days this citizen has been a resident, as the notice counts them. */
export function residentDays(world: World, c: Citizen): number {
  return daysResident(world, c);
}

/**
 * What the Council may move, and what a councillor weighs when it does
 * (`docs/GENERATIONS.md` §3, §4, §8).
 *
 * Three proposal kinds: `estate_duty` (0–40 %, 10 % at the founding),
 * `duty_exemption` (days of the minimum wage that pass untaxed, 60 at the
 * founding) and `house_levy` (0–5 % of entailed land value each cycle, 1 % at
 * the founding). Every one of them is the Council's and nobody else's — no
 * observer sets a rate, and nothing here changes without a vote somebody won.
 *
 * `dutyDisposition` is the reflex councillor's reading, and it is a **reason,
 * not a rule**: three public facts a councillor can actually see — whether
 * they have an estate and heirs of their own, this morning's Treasury gap, and
 * the size of the largest houses — weighed beside their own platform. A
 * councillor with an estate and no gap in the books votes against a rise, and
 * a councillor with nothing to leave and a hole in the Treasury votes for one.
 * Both are legible, situational and the councillor's own (`PRINCIPLES.md` §4);
 * neither is the engine deciding what a free mind wants.
 */
import { clamp } from '../types.ts';
import type { CitizenId, World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { lastBalanceSheet } from '../economy/treasury.ts';
import type { GenerationsSettings } from './state.ts';
import { DUTY_MAX, EXEMPTION_WAGES_MAX, LEVY_MAX, generationsSettings, generationsState } from './state.ts';
import { houseNames, houseReputeOf } from './repute.ts';
import { allHouses } from './houses.ts';
import { houseLandValue, houseTreasury } from './entail.ts';
import { estateUnits, estateLandValue } from './estate.ts';

/** The proposal kinds this layer owns. */
export const GENERATIONS_PROPOSALS = ['estate_duty', 'duty_exemption', 'house_levy'] as const;
export type GenerationsProposalKind = (typeof GENERATIONS_PROPOSALS)[number];

export function isGenerationsProposal(kind: unknown): kind is GenerationsProposalKind {
  return typeof kind === 'string' && (GENERATIONS_PROPOSALS as readonly string[]).includes(kind);
}

/** The bounds the Council may move each setting between. */
export const PROPOSAL_RANGE: Record<GenerationsProposalKind, { min: number; max: number }> = {
  estate_duty: { min: 0, max: DUTY_MAX },
  duty_exemption: { min: 0, max: EXEMPTION_WAGES_MAX },
  house_levy: { min: 0, max: LEVY_MAX },
};

/**
 * Enact one of this layer's proposals. Returns false for anything that is not
 * one of ours, so the wiring pass can hand every proposal through this on its
 * way past.
 */
export function enactGenerationsProposal(world: World, kind: string, value: number): boolean {
  if (!isGenerationsProposal(kind)) return false;
  const range = PROPOSAL_RANGE[kind];
  const v = Number.isFinite(value) ? clamp(value, range.min, range.max) : range.min;
  const s = generationsSettings(world);
  const was = kind === 'estate_duty' ? s.estateDuty : kind === 'house_levy' ? s.houseLevy : s.exemptionWages;
  if (kind === 'estate_duty') s.estateDuty = v;
  else if (kind === 'house_levy') s.houseLevy = v;
  else s.exemptionWages = Math.round(v);
  const shown = kind === 'duty_exemption'
    ? `${Math.round(v)} days of the minimum wage`
    : `${Math.round(v * 1000) / 10} %`;
  emit(world, 'law', `The Council set the ${kind.replace('_', ' ')} to ${shown} (it was ${kind === 'duty_exemption' ? `${Math.round(was)} days` : `${Math.round(was * 1000) / 10} %`}).`,
    [], 0.5, { kind, value: v, was });
  return true;
}

/** The settings as they stand, for anything that wants to show them. */
export function generationsRates(world: World): GenerationsSettings {
  return { ...generationsSettings(world) };
}

// ---------------------------------------------------------------------------
// The three public facts a councillor weighs
// ---------------------------------------------------------------------------

export interface DutyFacts {
  /** What this councillor would leave behind, and to whom. */
  ownEstate: number;
  ownHeirs: number;
  /** The Treasury's gap as a share of its revenue, this morning. */
  treasuryGap: number;
  /** The land the largest entail holds. */
  largestHouse: number;
  /** The highest house repute in the city. */
  highestName: number;
}

/** The three facts, read off the public registers. */
export function dutyFacts(world: World, councillorId: CitizenId): DutyFacts {
  const c = world.citizens[councillorId];
  const sheet = lastBalanceSheet(world);
  const gap = sheet.revenue > 0 ? (sheet.spend - sheet.revenue) / sheet.revenue : 0;
  let largest = 0;
  for (const h of allHouses(world)) {
    largest = Math.max(largest, houseLandValue(world, h) + houseTreasury(world, h));
  }
  let highest = 0;
  for (const name of houseNames(world)) highest = Math.max(highest, houseReputeOf(world, name));
  const heirs = c
    ? [...(c.family?.children ?? []), ...(c.family?.partnerId ? [c.family.partnerId] : [])].filter((id) => world.citizens[id]).length
    : 0;
  const estate = c ? Math.max(0, Math.floor(c.wallet)) + estateLandValue(world, estateUnits(world, c)) : 0;
  return { ownEstate: estate, ownHeirs: heirs, treasuryGap: gap, largestHouse: largest, highestName: highest };
}

/**
 * Would this councillor vote for a duty (or a levy) at this value? A reason,
 * not a rule: their own estate pulls against it, the Treasury's gap pulls for
 * it, and a city where one house holds a great deal of land pulls for it too.
 * Anything a citizen's own mind would weigh differently, it may: this is only
 * what a scripted councillor does when nobody is thinking for them.
 */
export function dutyDisposition(world: World, councillorId: CitizenId, kind: string, value: number): boolean {
  if (!isGenerationsProposal(kind)) return false;
  const facts = dutyFacts(world, councillorId);
  const range = PROPOSAL_RANGE[kind as GenerationsProposalKind];
  const s = generationsSettings(world);
  const now = kind === 'estate_duty' ? s.estateDuty : kind === 'house_levy' ? s.houseLevy : s.exemptionWages;
  const rise = value > now;
  // An exemption is the mirror of a duty: raising it takes less, not more.
  const takesMore = kind === 'duty_exemption' ? !rise : rise;
  const share = range.max > 0 ? clamp(value / range.max, 0, 1) : 0;

  let weight = 0;
  weight += clamp(facts.treasuryGap, -0.5, 1) * 0.8;
  weight += facts.largestHouse > 2000 ? 0.4 : facts.largestHouse > 500 ? 0.2 : 0;
  weight -= facts.ownEstate > 1000 && facts.ownHeirs > 0 ? 0.5 : facts.ownHeirs > 0 ? 0.2 : 0;
  weight -= share * 0.3;   // even a councillor who wants it does not want all of it
  return takesMore ? weight > 0 : weight <= 0;
}

/** The register, for a dashboard or a test that wants the whole of it. */
export function generationsRegister(world: World): {
  settings: GenerationsSettings; houses: number; wills: number; estates: number;
} {
  const s = generationsState(world);
  return {
    settings: { ...s.settings },
    houses: Object.keys(s.houses).length,
    wills: Object.keys(s.wills).length,
    estates: Object.keys(s.estates).length,
  };
}

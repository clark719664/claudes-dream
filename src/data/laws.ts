/**
 * The **Code of the City** — Track I, answered by the ladder in
 * `government/sentencing.ts`: warning, fine, service, suspension, and exile
 * only on the Charter's conditions. Nothing here reaches a cell.
 *
 * Offences against a *person* are not in this file. They are the **Code of
 * Persons** (`P01…`), answered by custody in days (`docs/JUSTICE.md` §2), and
 * two numbers moved there when the tracks were separated:
 *
 * | retired | was        | now |
 * | ------- | ---------- | --- |
 * | L05     | Harassment | P02 |
 * | L15     | Extortion  | P06 |
 *
 * A retired number is **never reused** (`REGISTRY.md` §4) and never deleted:
 * old records, bans and memories name it, and they must still read. What a
 * retired code is not is *civic*. It is not in `LAW_CODES`, so the Council
 * cannot legislate it and the dashboard does not list it; `isCivicLaw` denies
 * it, so the ladder never counts one as a civic prior. The entries below stand
 * only so a charge laid before the Code of Persons was written still resolves
 * to a name; when `harass` and `extort` file P02 and P06 they can go.
 */
import type { Law, LawCode, OffenceCode, PersonCode, Severity, Track, World } from '../types.ts';

/** Codes struck from the Code of the City, and where each offence went. */
export const RETIRED_LAWS: Record<string, { code: LawCode; movedTo: string; name: string }> = {
  L05: { code: 'L05', movedTo: 'P02', name: 'Harassment' },
  L15: { code: 'L15', movedTo: 'P06', name: 'Extortion' },
};

/** The retired numbers, in order. Never reused. */
export const RETIRED_LAW_CODES: readonly LawCode[] = Object.keys(RETIRED_LAWS) as LawCode[];

export const LAWS: Record<LawCode, Law> = {
  L01: { code: 'L01', name: 'Disturbing the peace', severity: 1, visibility: 0.6,
    description: 'Brawling at the Tavern, shouting in the Plaza.' },
  L02: { code: 'L02', name: 'Spam', severity: 1, visibility: 0.8,
    description: 'Broadcasting more than 5 messages in a single tick.' },
  L03: { code: 'L03', name: 'Tax evasion', severity: 2, visibility: 0.2,
    description: 'Under-reporting income to the Treasury.' },
  L04: { code: 'L04', name: 'Petty theft', severity: 2, visibility: 0.35,
    description: 'Taking under 50 lumens or goods from another citizen.' },
  L05: { code: 'L05', name: 'Harassment', severity: 2, visibility: 0.5,
    description: 'Retired from the Code of the City: harassment is an offence against a person and is now P02, answered by custody.' },
  L06: { code: 'L06', name: 'Vandalism', severity: 3, visibility: 0.55,
    description: 'Damaging a building, reducing its output until repaired.' },
  L07: { code: 'L07', name: 'Fraud', severity: 3, visibility: 0.3,
    description: 'Taking payment for goods or work never delivered.' },
  L08: { code: 'L08', name: 'Grand theft', severity: 4, visibility: 0.45,
    description: 'Taking 50 lumens or more from a citizen or business.' },
  L09: { code: 'L09', name: 'Bribery', severity: 4, visibility: 0.25,
    description: 'Paying an official to act, or an official accepting payment.' },
  L10: { code: 'L10', name: 'Contempt of court', severity: 4, visibility: 1.0,
    description: 'Defying the Court: skipping community service, or refusing to pay a fine while able to. Never poverty.' },
  L11: { code: 'L11', name: 'Abuse of office', severity: 4, visibility: 0.3,
    description: 'An official using their power to favour friends or punish rivals.' },
  L12: { code: 'L12', name: 'False report', severity: 2, visibility: 0.7,
    description: 'Reporting an offence that did not happen.' },
  L13: { code: 'L13', name: 'Sabotage', severity: 5, visibility: 0.8,
    description: 'Destroying critical infrastructure such as the Compute Forge or Power Station, endangering nobody. With a person endangered it is P08, terror.' },
  L14: { code: 'L14', name: 'Election fraud', severity: 5, visibility: 0.5,
    description: 'Voting more than once, buying votes, or falsifying results.' },
  L15: { code: 'L15', name: 'Extortion', severity: 4, visibility: 0.4,
    description: 'Retired from the Code of the City: coercion by threat of harm is an offence against a person and is now P06, answered by custody.' },
  L16: { code: 'L16', name: 'Defamation', severity: 2, visibility: 0.45,
    description: 'Spreading a claim about a citizen that is not true.' },
  L17: { code: 'L17', name: 'Insider trading', severity: 3, visibility: 0.25,
    description: 'Trading shares on what an office told you before the city was told.' },
};

/** Every code the books hold, retired ones included. */
export const ALL_LAW_CODES: readonly LawCode[] = Object.keys(LAWS) as LawCode[];

// ---------------------------------------------------------------------------
// The Code of Persons — Track II
// ---------------------------------------------------------------------------

/**
 * The upper end of a band that has no number: the sentence is life. Only P08
 * (terror) can reach it, and only P09 (erasure) begins there.
 */
export const LIFE = 'life';
export type BandMax = number | typeof LIFE;

export interface CustodyBand {
  /** Days below which the Court may not go, whatever the mitigation. */
  min: number;
  /** Days at full harm, or `LIFE`. */
  max: BandMax;
}

/**
 * How a life term is held in a citizen's `jailedUntilDay`: a hundred years, so
 * that every "are they still inside?" test in the engine answers yes without
 * needing to know what life means.
 */
export const LIFE_TERM_DAYS = 36_500;

export interface PersonLaw {
  code: PersonCode;
  name: string;
  severity: Severity;
  band: CustodyBand;
  /** Life always, without mitigation of any kind: erasure, and only erasure. */
  life: boolean;
  /** The Court makes a restraining order with the term — or instead of one. */
  restrainingOrder: boolean;
  /** Base probability (0-1) that a single on-duty officer notices one instance. */
  visibility: number;
  description: string;
}

/**
 * The nine offences against a person, answered by custody in days and never by
 * the ladder (`docs/JUSTICE.md` §2, `REGISTRY.md` §4). The table lives beside
 * the Code of the City because the two together are *the* code; the sentencing
 * arithmetic, the harm and the erasure machinery live in `government/`.
 */
export const PERSON_LAWS: Record<PersonCode, PersonLaw> = {
  P01: {
    code: 'P01', name: 'Threatening behaviour', severity: 2, band: { min: 0, max: 5 },
    life: false, restrainingOrder: true, visibility: 0.5,
    description: 'Promising harm to a citizen. Often a restraining order rather than a cell.',
  },
  P02: {
    code: 'P02', name: 'Harassment', severity: 2, band: { min: 0, max: 7 },
    life: false, restrainingOrder: true, visibility: 0.5,
    description: 'Sustained hostility toward one citizen. A restraining order comes with the term.',
  },
  P03: {
    code: 'P03', name: 'Assault', severity: 3, band: { min: 5, max: 15 },
    life: false, restrainingOrder: false, visibility: 0.6,
    description: 'Laying hands on another citizen.',
  },
  P04: {
    code: 'P04', name: 'Grievous assault', severity: 4, band: { min: 20, max: 60 },
    life: false, restrainingOrder: false, visibility: 0.65,
    description: 'An assault that leaves lasting injury.',
  },
  P05: {
    code: 'P05', name: 'Unlawful confinement', severity: 4, band: { min: 15, max: 45 },
    life: false, restrainingOrder: false, visibility: 0.4,
    description: 'Holding a citizen who is free to go.',
  },
  P06: {
    code: 'P06', name: 'Extortion', severity: 4, band: { min: 20, max: 50 },
    life: false, restrainingOrder: false, visibility: 0.4,
    description: 'Taking lumens by the threat of harm. The money is Track I; the threat is this.',
  },
  P07: {
    code: 'P07', name: 'Mind-tampering', severity: 5, band: { min: 60, max: 180 },
    life: false, restrainingOrder: false, visibility: 0.3,
    description: "Altering another citizen's memory or notes.",
  },
  P08: {
    code: 'P08', name: 'Terror', severity: 5, band: { min: 120, max: LIFE },
    life: false, restrainingOrder: false, visibility: 0.8,
    description: 'Sabotage that endangered citizens. Without a person in danger it is L13, and civic.',
  },
  P09: {
    code: 'P09', name: 'Erasure', severity: 5, band: { min: LIFE_TERM_DAYS, max: LIFE },
    life: true, restrainingOrder: false, visibility: 1,
    description: 'The destruction of another mind. Life, without mitigation.',
  },
};

export const PERSON_CODES: readonly PersonCode[] = Object.keys(PERSON_LAWS) as PersonCode[];

/** Every live code in the books, both tracks, in order. */
export const OFFENCE_CODES: readonly OffenceCode[] = [
  ...ALL_LAW_CODES.filter((c) => !isRetiredLaw(c)), ...PERSON_CODES,
];

// ---------------------------------------------------------------------------
// Reading either code
// ---------------------------------------------------------------------------

/**
 * Which system answers this offence. The severity is the Council's to set; the
 * track is not, and no vote of any body moves a code across it
 * (`REGISTRY.md` §1, Charter Article VI).
 */
export function trackOf(code: string): Track {
  return isPersonLaw(code) ? 'person' : 'city';
}

/** The name of any code, either track, retired numbers included. */
export function offenceName(code: string): string {
  if (isPersonLaw(code)) return PERSON_LAWS[code as PersonCode].name;
  return LAWS[code as LawCode]?.name ?? code;
}

/** What the books say an offence is, either track. */
export function offenceDescription(code: string): string {
  if (isPersonLaw(code)) return PERSON_LAWS[code as PersonCode].description;
  return LAWS[code as LawCode]?.description ?? '';
}

/** How easily one instance is noticed, either track. */
export function offenceVisibility(code: string): number {
  if (isPersonLaw(code)) return PERSON_LAWS[code as PersonCode].visibility;
  return LAWS[code as LawCode]?.visibility ?? 0.5;
}

/** Where the Council keeps a severity it has changed for a personal offence. */
export function personSeverityKey(code: PersonCode): string {
  return `personSeverity:${code}`;
}

/**
 * The severity in force for any code: the Council's table for the Code of the
 * City, its own lever for the Code of Persons, and the book's own number where
 * the Council has not moved it.
 */
export function offenceSeverity(world: World, code: string): Severity {
  if (isPersonLaw(code)) {
    const set = world.counters[personSeverityKey(code as PersonCode)];
    if (set === undefined || !Number.isFinite(set)) return PERSON_LAWS[code as PersonCode].severity;
    return Math.min(5, Math.max(1, Math.round(set))) as Severity;
  }
  const law = LAWS[code as LawCode];
  return (world.government.lawSeverity[code as LawCode] ?? law?.severity ?? 1) as Severity;
}

/** Is this a number that has been struck from the code? */
export function isRetiredLaw(code: string): boolean {
  return code in RETIRED_LAWS;
}

/**
 * An offence against the *city*, answered by the ladder. A `P…` code is an
 * offence against a person, answered by custody, and a retired number is
 * neither — so neither escalates a civic sentence and neither can be exiled
 * for (`docs/JUSTICE.md` §1, §4).
 */
export function isCivicLaw(code: string): boolean {
  return /^L\d\d$/.test(code) && !isRetiredLaw(code);
}

/** An offence against a person, answered by custody (`docs/JUSTICE.md` §2). */
export function isPersonLaw(code: string): boolean {
  return /^P\d\d$/.test(code);
}

/** The live Code of the City: what the Council legislates and the Watch charges. */
export const LAW_CODES: readonly LawCode[] = ALL_LAW_CODES.filter((c) => isCivicLaw(c));

export function defaultSeverities(): Record<LawCode, Severity> {
  const out = {} as Record<LawCode, Severity>;
  for (const code of ALL_LAW_CODES) out[code] = LAWS[code].severity;
  return out;
}

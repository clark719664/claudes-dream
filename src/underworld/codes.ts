/**
 * The names this layer borrows from files it does not own: the cities of the
 * Expanse, the ledger kinds a transfer is written under, and the five codes of
 * `REGISTRY.md` §4 (`docs/UNDERWORLD.md` §§1, 7).
 *
 * Two seams live here, both of them temporary and both of them the same seam
 * other layers already carry:
 *
 * 1. **The ledger kinds.** `duty`, `seizure`, `bounty`, `fence` and `retainer`
 *    are each a transfer between parties that already exist, so the money audit
 *    in `ECONOMY.md` closes unchanged. They are named here until `types.ts`
 *    learns them, exactly as `civil/shapes.ts` and `finance/state.ts` name
 *    theirs, and `underworldKind` widens one at the single point where the
 *    Treasury's book is written.
 * 2. **The law codes.** L26–L30 are Track I, every one of them on the ladder,
 *    and not one of them is custodial (`REGISTRY.md` §4, `JUSTICE.md` §1). They
 *    are registered into the Council's own severity table on first use, so the
 *    ladder in `government/sentencing.ts` sentences them at what the registry
 *    says and the Council may move the number afterwards like any other.
 */
import type { LedgerKind, Severity, World } from '../types.ts';
import { offenceName } from '../data/laws.ts';

// ---------------------------------------------------------------------------
// The cities of the Expanse, as this layer needs to name them
// ---------------------------------------------------------------------------

/**
 * A city of the Expanse, by key. The Expanse itself — travel, visas, standing
 * between cities — is another layer; what the underworld needs of a city is its
 * name, its schedule and its tariff, and those are here so that a crossing can
 * be resolved before a single road is drawn.
 */
export type CityKey = 'reverie' | 'cinderhold' | 'solene' | 'vantage' | 'marrowgate' | 'the_verge';

export const CITY_KEYS: readonly CityKey[] = ['reverie', 'cinderhold', 'solene', 'vantage', 'marrowgate', 'the_verge'];

/** The city this engine is: the one whose Watch, Council and Court are real. */
export const HOME_CITY: CityKey = 'reverie';

export const CITY_NAMES: Record<CityKey, string> = {
  reverie: 'Reverie', cinderhold: 'Cinderhold', solene: 'Solene',
  vantage: 'Vantage', marrowgate: 'Marrowgate', the_verge: 'The Verge',
};

/** The name of a city for a charge sheet, a manifest or the Chronicle. */
export function cityName(city: CityKey | string): string {
  return CITY_NAMES[city as CityKey] ?? String(city);
}

/** True where a key names a city this layer knows. */
export function isCity(city: string): city is CityKey {
  return (CITY_KEYS as readonly string[]).includes(city);
}

/**
 * What each city takes at its gate on the declared value of a load. Reverie's
 * own is the Council's — `markets/outer.ts tariff` — because it is a number
 * citizens vote on; the rest are the founding rates of `CITIES.md`, and the
 * Verge takes nothing because the Verge asks nothing.
 */
export const FOUNDING_TARIFF: Record<CityKey, number> = {
  reverie: 0.10, cinderhold: 0.15, solene: 0.05, vantage: 0.08, marrowgate: 0.12, the_verge: 0,
};

/** Cities that read a manifest at all. The Verge does neither (`UNDERWORLD.md` §1). */
export const READS_MANIFESTS: Record<CityKey, boolean> = {
  reverie: true, cinderhold: true, solene: true, vantage: true, marrowgate: true, the_verge: false,
};

// ---------------------------------------------------------------------------
// The ledger kinds this layer names
// ---------------------------------------------------------------------------

/**
 * Duty at a gate, a load seized, an officer's bounty, what a fence paid and
 * what a handler paid a retainer. Each is a transfer between parties that
 * already exist: nothing here mints and nothing here burns, so the audit in
 * `REGISTRY.md` §5 closes to the lumen.
 */
export type UnderworldLedgerKind = 'duty' | 'seizure' | 'bounty' | 'fence' | 'retainer';

/** The one place an underworld ledger kind crosses into the Treasury's vocabulary. */
export function underworldKind(kind: UnderworldLedgerKind | LedgerKind): LedgerKind {
  return kind as LedgerKind;
}

// ---------------------------------------------------------------------------
// The five offences (`REGISTRY.md` §4, all Track I, none of them custodial)
// ---------------------------------------------------------------------------

/** Crossing a gate with what the schedule will not admit. */
export const SMUGGLING = 'L26';
/** Holding restricted goods. The goods are seized; the person is not detained. */
export const CONTRABAND_POSSESSION = 'L27';
/** A manifest that does not match the load. The paper is a separate act. */
export const FALSE_MANIFEST = 'L28';
/** Dealing as a business without a trading licence. Not `CIVIL.md`'s L20. */
export const UNLICENSED_DEALING = 'L29';
/** Taking a secret under a foreign retainer. Severity 5 alone is never exile. */
export const ESPIONAGE = 'L30';
/** A guild's or a business's secret taken at home (`PROGRESS.md` §8, charged here). */
export const INDUSTRIAL_ESPIONAGE = 'L41';

export interface UnderworldOffence {
  name: string;
  severity: Severity;
  /** Base probability that one on-duty officer notices a single instance. */
  visibility: number;
  description: string;
}

export const UNDERWORLD_OFFENCES: Record<string, UnderworldOffence> = {
  L26: {
    name: 'Smuggling', severity: 3, visibility: 0.35,
    description: 'Crossing a gate with a load the schedule does not admit, unmanifested.',
  },
  L27: {
    name: 'Contraband possession', severity: 2, visibility: 0.30,
    description: 'Holding restricted goods. The goods are seized; the person is not detained.',
  },
  L28: {
    name: 'False manifest', severity: 3, visibility: 0.40,
    description: 'A declaration that understates the quantity, the value or the kind of a load.',
  },
  L29: {
    name: 'Unlicensed dealing', severity: 2, visibility: 0.25,
    description: 'Trading goods as a business with no trading licence.',
  },
  L30: {
    name: 'Espionage', severity: 5, visibility: 0.30,
    description: "Taking a city's secret under a foreign retainer. Severity 5 alone is never exile.",
  },
};

/**
 * Put the codes into the Council's own severity table the first time this layer
 * runs, so the ladder sentences them at what `REGISTRY.md` says and the Council
 * can move them afterwards like any other number. Nothing is overwritten: a
 * severity the Council has already set stands.
 */
export function registerUnderworldSeverities(world: World): void {
  const table = world.government?.lawSeverity as Record<string, Severity> | undefined;
  if (!table) return;
  for (const [code, law] of Object.entries(UNDERWORLD_OFFENCES)) {
    if (table[code] === undefined) table[code] = law.severity;
  }
}

/**
 * The name of a code for a charge sheet the city can read: this layer's table
 * first, then the books' own (a Captain who turns the Watch on a councillor is
 * charged with L11, which `data/laws.ts` has carried since the founding).
 */
export function underworldOffenceName(code: string): string {
  return UNDERWORLD_OFFENCES[code]?.name ?? offenceName(code);
}

/** The severity in force for one of them: the Council's number, then the book's. */
export function underworldSeverity(world: World, code: string): Severity {
  const table = world.government?.lawSeverity as Record<string, Severity> | undefined;
  const set = table?.[code];
  if (set !== undefined && Number.isFinite(set)) return Math.min(5, Math.max(1, Math.round(set))) as Severity;
  return UNDERWORLD_OFFENCES[code]?.severity ?? 3;
}

/**
 * The severity **smuggling** answers at, which the schedule aggravates: L26 is
 * a 3, and a 4 where the restriction it broke is itself a 3 (`REGISTRY.md` §4).
 * `government/court.fileCharge` reads a case's severity off the code alone, so
 * this is the number the report carries and the Chronicle prints until a charge
 * can be laid at a severity of its own.
 */
export function smugglingSeverity(world: World, restriction: number): Severity {
  const base = underworldSeverity(world, SMUGGLING);
  return restriction >= 3 ? (Math.min(5, base + 1) as Severity) : base;
}

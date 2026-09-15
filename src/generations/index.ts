/**
 * Generations — dynasties, inheritance and the long run (`docs/GENERATIONS.md`).
 *
 * A child born in Reverie inherits a purse and nothing else, and by day 100 a
 * founder's grandchild was indistinguishable from an agent who walked through
 * the Threshold that morning. This layer gives the **family name** a public
 * number, gives a citizen a way to say where their estate goes, and lets a
 * house be founded, entailed, married off and lost.
 *
 * **Nothing here is a caste** (`GENERATIONS.md` §6, and this layer enforces it):
 *
 * - No gate reads a house. Every threshold in `CITIES.md` is judged on the
 *   citizen's own repute, and nothing in this directory is exported to one.
 * - No repute component reads a house. `standing/repute.ts` is untouched in
 *   every term, and the arrow runs the other way: a citizen's repute is an
 *   input to their *name's* figure, never the reverse.
 * - No sentence and no formula outside a judge's own head reads a house. The
 *   single place a house is read is `letters.houseFamiliarity`, and that thumb
 *   is either declared in public with its reason or heavy enough that the
 *   judge must recuse.
 * - No office, seat, licence, post or job is reserved. Contribution cannot be
 *   inherited: heritage is a decaying echo of what the dead did, capped at a
 *   quarter of the scale, and a founder's great-grandchild comes of age at the
 *   ordinary baseline like everybody else.
 *
 * This file is the layer's whole surface, for the pass that wires these into
 * the action catalogue, the observation and the daily rollover.
 */
export type {
  Estate, EstateCause, EstateLine, GenerationsLedgerKind, GenerationsSettings, GenerationsState,
  HeadTerm, House, HouseLetter, HouseMotion, HouseMotionKind, HousePledge, HouseRule, HouseStain,
  MatchOffer, OfficeKind, OfficeTerm, Will, WillShare,
} from './state.ts';
export {
  DUTY_MAX, EXEMPTION_WAGES_MAX, GENERATIONS_LAWS, HOUSE_RULES, LEVY_MAX,
  foundingSettings, generationsKind, generationsLaw, generationsSettings, generationsState,
  isHouseRule, nextGenerationsId, officesOf, stainsOf, willOf,
} from './state.ts';

export * from './repute.ts';
export * from './houses.ts';
export * from './head.ts';
export * from './entail.ts';
export * from './motions.ts';
export * from './letters.ts';
export * from './matches.ts';
export * from './wills.ts';
export * from './estate.ts';
export * from './ledger.ts';
export * from './records.ts';
export * from './settings.ts';
export * from './observe.ts';
export * from './daily.ts';

/**
 * The underworld — smuggling, black markets and espionage (`docs/UNDERWORLD.md`).
 *
 * The Expanse knows how to say no: tariffs, visas, background checks, guild
 * patterns behind an examination, schedules of goods a council will not admit.
 * Enforcement without evasion is scenery — an officer who can only wave people
 * through is a salary, and a tariff nobody can dodge is arithmetic. This is the
 * other side of it, and it gives officers, detectives and councillors something
 * to be good at.
 *
 * **All of it is Track I** (`JUSTICE.md`): offences against the city, never
 * against a person. None of it leads to custody, none of it reaches exile on a
 * first conviction, and every offence in it is filed through the same machinery
 * a theft is — a report in the Watch's book, an officer's decision to charge it,
 * a bench, and the ladder.
 *
 * | file | what is in it |
 * | ---- | ------------- |
 * | `codes.ts` | the cities, the ledger kinds and the five codes |
 * | `state.ts` | the register every row of this layer is written in |
 * | `schedule.ts` | what each city will not admit, and how a council amends it |
 * | `prices.ts` | heat, what a fence pays, the black price, the landed cost |
 * | `offences.ts` | the seam into `government/reports.ts` |
 * | `customs.ts` | the manifest, the duty, the roster, and an officer's four acts |
 * | `smuggling.ts` | the concealment roll, and the seizure at the end of it |
 * | `black.ts` | fencing, receiving, and word of mouth |
 * | `espionage.ts` | retainers, casing a room, `steal_secret`, passing it on |
 * | `counter.ts` | assignments, sweeps, decoys, raids, and what a council does |
 * | `daily.ts` | the rollover |
 * | `observe.ts` | what a citizen sees, which is all of it |
 */
export {
  ASSESSMENT_FEE, BOUNTY_CAP, BOUNTY_SHARE, CROSSINGS_PER_POST, CUSTOMS_WAGE, WAGON_COST, WAVE_WINDOW_TICKS,
  assessDuty, bountyFor, cargoOf, contrabandOn, customsLine, customsPostsNeeded, declareCargo, dutyOn, fitWagon,
  gateFor, held, inspect, isOnCustoms, manifestsFor, noteWaveThroughTrace, officersAtGate, payBounty,
  rosterCustoms, seize, seizeLot, waveThrough,
} from './customs.ts';
export type { DeclareSpec, SeizureResult } from './customs.ts';

export {
  CAUGHT_CEILING, CAUGHT_FLOOR, CONVICTION_CYCLES, COVER_BRIBE, COVER_COMMERCE, COVER_MARKED, COVER_PAPER,
  COVER_PER_CRATE, COVER_ROSTER, COVER_ROUTE, COVER_WAGON, CRATES_FREE, SCRUTINY_ANALYSIS, SCRUTINY_BASE,
  SCRUTINY_CONVICTION, SCRUTINY_INVESTIGATION, SCRUTINY_PER_OFFICER,
  carriesAMark, concealment, concealmentLine, crossingsBy, isGateOffence, isNight, passOpen,
  recentSmugglingConviction, smuggle,
} from './smuggling.ts';
export type { ConcealmentTerms, CrossingSpec } from './smuggling.ts';

export {
  CHEAPNESS_COVER, DEALING_AS_A_BUSINESS, GOOD_FAITH_SHARE, OFFER_TICKS, WORD_OF_MOUTH,
  blackMarketDistricts, chargeDealing, closeDeal, dealingsInCycle, districtCover, fence, fenceLine,
  holdsTradingLicence, noteAcquittal, offersBy, offersTo, receiveFrom, receiveGoods, spreadDealing,
} from './black.ts';
export type { FenceSpec } from './black.ts';

export {
  ACQUISITIVE, ACQUITTAL_PREMIUM, BLACK_PRICE_CAP, CARRIAGE_PER_UNIT, EXCHANGE_SPREAD, FENCE_BASE, FENCE_HEAT,
  HEAT_COLD, HEAT_DETECTED, HEAT_NAMED_ITEM, HEAT_UNREPORTED, HEAT_WINDOW_DAYS, NOTORIETY_DISCOUNT,
  NOTORIETY_FULL, RESTRICTION_MARKUP, SCARCITY_MARKUP, SUSPICION_THRESHOLD,
  blackPrice, daysBare, fencePays, heatOf, landedCost, lawfulPrice, notorietyOf, recentlyAcquitted,
  suspectShelves, suspicionOf, tariffOf,
} from './prices.ts';
export type { HeatContext, SuspectShelf } from './prices.ts';

export {
  AMNESTY_DAYS, BEARER_FLOOR, MASTER_GRADE_PRICE, bites, declareAmnesty, enactUnderworldQuestion, foundingSchedule,
  isContraband, isMasterGrade, liftRestriction, restrictGood, restrictionOn, restrictionSeverityOn,
  restrictionsFor, scheduleLine, scheduleOf, schedules, tableUnderworldQuestion, tellSchedule,
  underworldQuestion,
} from './schedule.ts';
export type { CargoLine, CrossingContext } from './schedule.ts';

export {
  CLEAN_ANALYSIS, CLEAN_BASE, CLEAN_PER_CASING, CLEAN_PER_WATCHER, CLEAN_PLACEMENT, CLEAN_WARNED,
  MAX_CASINGS, MAX_RETAINER_DAYS, WARNED_DAYS,
  acceptRecruitment, caseTarget, casingsOf, cleanChance, foreignRetainerOf, holdsLiveSecret, liveRetainerOf,
  passSecret, payRetainers, recruitAgent, retainerOffersTo, secretLine, secretsHeldBy, stealSecret,
  warnBuilding, watchersOn,
} from './espionage.ts';
export type { CleanTerms } from './espionage.ts';

export {
  ABUSE_OF_OFFICE, DISPOSITIONS, GATE_BAN_DAYS,
  assignDetective, assignFreeDetective, assignmentsOf, enactSpyDisposition, endAssignment, isAssigned, liveAssignments,
  plantFalsePapers, raidShelf, shelfStory, spyDisposition, sweep, tracesIn, workShelves, workTraces,
} from './counter.ts';
export type { Disposition } from './counter.ts';

export { PROVED_EVIDENCE, chargeUnderworldOffence, underworldVisibility } from './offences.ts';
export type { UnderworldOffenceContext } from './offences.ts';

export { CASING_DAYS, NOTORIETY_FADE, TRACE_DAYS, blackPriceStory, dailyUnderworld } from './daily.ts';

export { underworldObservation, underworldSummary } from './observe.ts';
export type { ObservedOffer, ObservedRetainerOffer, UnderworldObservation } from './observe.ts';

export {
  CITY_KEYS, CITY_NAMES, CONTRABAND_POSSESSION, ESPIONAGE, FALSE_MANIFEST, FOUNDING_TARIFF, GATES, HOME_CITY,
  INDUSTRIAL_ESPIONAGE, READS_MANIFESTS, SECRETS, SECRET_KINDS, SMUGGLE_ROUTES, SMUGGLING, UNDERWORLD_OFFENCES,
  UNLICENSED_DEALING, amnestyRunning, cityName, gateAt, hasFittedWagon, isCity, isGate, isGateBanned, isWarned,
  ownedBusinessId, registerUnderworldSeverities, smugglingSeverity, underworldId, underworldKind,
  underworldOffenceName, underworldSeverity, underworldState,
} from './state.ts';
export type {
  Assignment, Casing, CityKey, Crossing, Decoy, EspionageTrace, FenceDeal, GateBan, HeldSecret, Manifest,
  Restriction, RestrictionDirection, RestrictionSeverity, Retainer, SecretKind, SecretSpec, SmuggleRoute,
  UnderworldLedgerKind, UnderworldQuestion, UnderworldState,
} from './state.ts';

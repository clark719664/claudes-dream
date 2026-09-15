/**
 * Pollution, zoning and the land (`docs/ENVIRONMENT.md`) — one door for the
 * rest of the engine.
 *
 * The Compute Forge had run since the founding and left no mark on anything.
 * This layer makes that a consequence instead: what a district produces settles
 * in the air above it and the water below it, the neighbours downwind get it
 * without the wages, and the Council holds a power over land value — zoning —
 * worth more than every tax rate it sets.
 */
export {
  ABATEMENT_DECAY, ENVIRONMENT_OFFENCES, ENVIRONMENT_PROPOSAL_KINDS, FALSE_ABATEMENT_RETURN, FITTINGS,
  FITTING_SPECS, FOUNDING_PERMIT, HOST_SHARE_MAX, PERMITS, PERMIT_PREMIUM, UNDECLARED_INTEREST,
  UNLAWFUL_DISCHARGE, airLevel, bypassedToday, districtEnvironment, environmentOffenceName,
  environmentSeverity, environmentState, fittingOn, hostShareOf, isBoughtOut, isRelocated, permitOf,
  registerEnvironmentSeverities, waterLevel,
} from './state.ts';
export type {
  Abatement, DistrictEnvironment, EmitterDay, EnvironmentProposalKind, EnvironmentQuestion,
  EnvironmentState, Fitting, Permit, Reading,
} from './state.ts';

export {
  CLEARANCE_BASE, DOWNSTREAM, DRIFT_SHARE, GREENERY_CLEARANCE, SEASON_BEARING, VENTILATION,
  bearingBetween, clearanceOf, downstreamOf, downwindOf, driftWeights, riverOrder, upstreamOf,
  waterClearanceOf, windBearing, windName,
} from './wind.ts';

export {
  BUILDING_MOTES, BUSINESS_MOTES, SHORTAGE_MULTIPLIER, abatementFactor, bypassedLoadOf, driftShareOf,
  emittersToday, hinterlandLoad, loadOf, motesForShift, recordShiftEmission, shiftsUnder,
} from './emissions.ts';

export {
  MAINTAIN_PURPOSE, abatementWorth, dailyAbatement, dischargeShift, fittingEffect, installAbatement,
  installFromPublicWorks, maintainAbatement, upkeepDue, worksAt,
} from './abatement.ts';

export {
  AMENITY_AIR, AMENITY_GREENERY, GLITCH_AIR, HINTERLAND_WATER_WEIGHT, MEMORIAL_GREENERY, REST_AIR,
  WATER_WEIGHT, YIELD_AIR, amenityAdjustment, glitchAirFactor, greeneryOf, hinterlandAir,
  hinterlandWater, hinterlandYieldFactor, pollutionBurden, pruneReadings, readingsFor, recentReading,
  restAirFactor, surveyAir, surveyWater,
} from './readings.ts';

export {
  BUSINESS_PREMISES, HAULAGE_FEE, PERMIT_ADMITS, RELOCATION_COST, admits, buyOutBuilding, buyOutCost,
  haulageFee, isConserved, isNonconforming, mayExtend, mayOperate, mayTrade, nonconformingBuildings,
  permitPremium, readPermit, relocateWorks, residentsOf, setPermit,
} from './zoning.ts';
export type { PremisesKind } from './zoning.ts';

export {
  CHARGE_MAX, ENTRENCHED_MAJORITY, checkMeasure, describeMeasure, enactEnvironmentProposal,
  environmentQuestionOf, isEnvironmentProposal, neededFor, tableEnvironmentMeasure,
  tableEnvironmentProposal,
} from './proposals.ts';
export type { EnvironmentProposalSpec } from './proposals.ts';

export {
  DISTRICT_PETITION_SHARE, dailyZoningPetitions, districtPetitionStanding, districtSignatures,
  districtSignaturesNeeded, districtVoters, petitionZoning,
} from './petitions.ts';

export {
  GAIN_THRESHOLD, RECENT_PURCHASE_DAYS, boughtRecently, declarationsOn, declareInterest, hasDeclared,
  holdingsNear, settleZoningInterests, valuesWithAmenityShift, zoningGain,
} from './interests.ts';
export type { ZoningInterest } from './interests.ts';

export {
  BUILT_FULL, GROWTH_PER_DAY, MATURE_STAND, PLANT_PER_SHIFT, builtShare, growGreenery, openGround,
  plantTrees,
} from './greenery.ts';

export {
  CHRONICLE_AIR, DISCHARGE_SHARE, MOTE_DIVISOR, WATER_PASS, billEmissionCharge, dailyEnvironment,
  dirtiestDistrict, dischargeOf, payHostPayments, profitTaxRaisedIn, settleAir, settleWater,
  settledToday,
} from './daily.ts';

export { NUISANCE_PER_BURDEN, NUISANCE_PER_MOTE, emissionsBy, fileNuisance, reaches } from './nuisance.ts';

export { describeAir, environmentObservation } from './observe.ts';
export type { ObservedEnvironment } from './observe.ts';

export { ENVIRONMENT_VISIBILITY, chargeEnvironmentOffence } from './offences.ts';

/**
 * Research, technology and trends — the whole layer's public surface
 * (`docs/PROGRESS.md`).
 *
 * Everything the rest of the engine needs is re-exported here, so wiring an
 * action, a proposal or a daily rollover is one import. The layer itself never
 * reaches out: it exports plain functions over the World and is called, never
 * calling into the action system, the brains or the rollover.
 *
 * **The nine actions** (`REGISTRY.md` §3, all defined in `PROGRESS.md` §8):
 *
 * | Action | Function |
 * | --- | --- |
 * | `open_project` | `openProject(world, cId, technology, name)` |
 * | `research` | `researchShift(world, cId, projectId)` |
 * | `fund_project` | `fundProject(world, from, projectId, amount)` |
 * | `adopt_technology` | `adoptTechnology(world, cId, technology)` (a business owner, from capital) |
 * | `publish_finding` | `publishFinding(world, cId, projectId)` |
 * | `keep_secret` | `keepSecret(world, cId, projectId)` |
 * | `take_apprentice` | `takeApprentice(world, masterId, citizenId, technology)` |
 * | `teach_technology` | `teachTechnology(world, cId, technology)` |
 * | `sell_secret` | `sellSecret(world, sellerId, buyerId, technology, price)` |
 *
 * **The two proposals**: `research_grant` → `enactResearchGrant(world, projectId, amount)`,
 * `adopt_technology` → `enactAdoption(world, technology, value)`.
 *
 * **The gate `REGISTRY.md` §7 asks for**: `tramAllowed(world)` — METROPOLIS's
 * tram was buildable from day one, and now it needs The Tram.
 *
 * **The rollover**: `dailyProgress(world)`.
 *
 * `steal_secret` is deliberately absent: `REGISTRY.md` §7 unified it under
 * `UNDERWORLD.md` §5, and L41 belongs to that layer.
 */
export type { Branch, EffectKey, Technology, TechnologyId, Tier, Unlock } from './tree.ts';
export {
  BRANCHES, TECHNOLOGIES, TECHNOLOGY_IDS,
  costsOf, heldInBranch, isTechnologyId, missingPrerequisites, openSubjects, prerequisitesMet,
  progressCost, technologiesIn, technology, technologyName, volumesRequired, worksCost,
} from './tree.ts';

export type {
  Adoption, FindingStatus, ProgressDeeds, ProgressState, ProjectStatus, ResearchProject, Trend, TrendKind,
} from './state.ts';
export { PROGRESS_LAWS, TREND_KINDS, deedsOf, progressLaw, progressState } from './state.ts';

export {
  SHIFTS_TO_TRAIN, UNTRAINED_SHARE,
  academyMultiplier, adoptionStrength, allHeld, attireGoodsDiscount, businessWorks, cityHolds, cityWorks,
  comfortDecayMultiplier, delta, describeProgress, doorKeeper, effectStrength, emissionMultiplier,
  energyAnchorMultiplier, familiarWith, famineCeiling, forgeMaximumMultiplier, glitchOnsetMultiplier,
  glitchSpreadMultiplier, glutDays, heldFor, heldTechnologies, isFamiliar, isMasterOf, isSecret,
  lawVisibilityBonus, mastersOf, mayResearch, minSkillRelief, multiplier, outbreakThreshold, outputMultiplier,
  postsAffected, readinessOf, recipeGoodsDiscount, researchInsightBonus, riverCapacityMultiplier,
  riverSpeedMultiplier, roadSpeed, routeDecayMultiplier, rumourReachMultiplier, seaCargoMultiplier,
  spoilageMultiplier, stormHazardMultiplier, technologyRecord, toolGradeBonus, trainShift,
  tramAllowed, tramGate, travelHazardMultiplier, trendReachMultiplier, unlocked, uptakeOf, visibleTo,
  wardCureChance, worksAmenity,
} from './effects.ts';

export {
  IDLE_DAYS_BEFORE_ABANDON, RESEARCH_MIN_ANALYSIS, RESEARCH_WAGE, SALVAGE_SHARE,
  abandonProject, dailyProjects, insightOf, isResearcher, openProject, openProjects, projectById, projectFor,
  projectsHere, projectsOf, readyToResolve, researchBuilding, researchShift, resolveProject, successChance,
  tierOf,
} from './projects.ts';

export {
  contributorsOf, enactResearchGrant, fundProject, maySecrete, purseOf, refundPurse, secretKeeper,
} from './purse.ts';

export {
  PAPER_PROGRESS_SHARE, SECRET_WINDOW_DAYS, TEACHING_SHARE,
  arriveFamiliarWith, keepSecret, loseOrphanedSecrets, lostTechnologies, paperProgress, publishFinding,
  readPaperFrom, secretsHeld, sellSecret, takeApprentice, teachTechnology,
} from './discovery.ts';

export {
  BRANCH_DISTRICT, WORKS_PER_DAY,
  adoptTechnology, adoptionState, businessAdoptions, cityAdoptions, dailyWorks, enactAdoption, pledgedFor,
  worksDistricts, worksReport,
} from './adoption.ts';

export type { ObservedTrend } from './trends.ts';
export {
  MAX_TRENDS, SATURATION_SHARE, TREND_FLOOR, TREND_PRICE_PREMIUM, TREND_SEED_FRIENDS, TREND_SEED_SHARE,
  cityShare, dailyTrends, describeSubject, detectTrends, givenName, givesSocialGain, holdersOf, holds,
  isRising, isSaturated, liveTrends, nameWeight, nameWeights, population, reassertWants, refreshTrends, spreadTrends,
  takeUpChance, threeFriendsHold, trendFor, trendPriceMultiplier, trendShare, trendingDish, trendsObservation,
  trendsReport,
} from './trends.ts';

export type { ObservedAdoption, ObservedElsewhere, ObservedProject, ProgressObservation } from './observe.ts';
export {
  PROGRESS_CONTRIBUTION_WORTH,
  funderOf, progressContribution, progressDeedRows, progressObservation, progressReport, trendsBlock,
} from './observe.ts';

export { dailyProgress, progressChronicle } from './daily.ts';

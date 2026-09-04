/**
 * The morning of Reverie. At hour 0 the whole city settles up, in one fixed
 * order, and every step is guarded so that a bug in one of them costs a
 * paragraph rather than the day.
 *
 * The order matters and is the contract in `docs/MODULES_METROPOLIS_FULL.md`
 * §7.2: the sky is rolled before anything reads it, districts open before
 * anybody is housed in them, landlords take their rent after the city takes
 * its own, the wealth tax and the reserve come after the public money has
 * moved, the cells are emptied before the Court sits on anybody, approval is
 * read after the promises it is read from, and the two papers print last of
 * all — after the Treasury's report and before the audit.
 *
 * Groups exist so this file stays readable and so one pack's bad morning
 * cannot take another's with it.
 */
import type { CitizenId, Loan, World } from '../types.ts';
import { emit } from '../sim/events.ts';
import { auditMoneySupply, dailyTreasuryRollover, payDividend, paySalaries } from '../economy/treasury.ts';
import { dailyMarket } from '../economy/market.ts';
import { dailyJobs } from '../economy/jobs.ts';
import { dailyBusinesses } from '../economy/business.ts';
import { dailyLoans } from '../economy/bank.ts';
import { dailyHousing } from '../economy/housing.ts';
import { dailyCitizens } from '../citizens/citizen.ts';
import { dailyCharacter } from '../citizens/character.ts';
import { dailyLetters } from '../citizens/letters.ts';
import { dailyRelationships } from '../citizens/relationships.ts';
import { printMorningEdition } from '../sim/chronicle.ts';
import { dailyWatch } from '../government/watch.ts';
import { dailyJustice, fileCharge } from '../government/court.ts';
import { dailyStandings } from '../government/registry.ts';
import { dailyJail } from '../government/jail.ts';
import { dailyInvestigations } from '../government/investigations.ts';
import { dailyGangs } from '../government/gangs.ts';
import { dailyGovernment } from '../government/council.ts';
import { refreshWantsDaily } from '../society/tastes.ts';
import { dailyPossessions, restockEmporium } from '../society/shops.ts';
import { dailyAffection } from '../society/romance.ts';
import { dailyBirthdays, dailyLifeStages, dailyUpkeep, familyBondFloor } from '../society/family.ts';
import { dailyClubs, scheduleMeetings } from '../society/clubs.ts';
import { scheduleFestivals } from '../society/calendar.ts';
import { dailyChest } from '../society/chest.ts';
// The metropolis
import { dailyDrift } from '../identity/drift.ts';
import { dailyHealth } from '../identity/health.ts';
import { dailyGoals } from '../identity/goals.ts';
import { dailySeasons } from './seasons.ts';
import { dailyGrowth } from './growth.ts';
import { dailyDisasters } from './disasters.ts';
import { dailyHistory } from './history.ts';
import { dailyRepute } from '../standing/repute.ts';
import { dailyNotices } from '../standing/notices.ts';
import { dailyHearings } from '../standing/hearings.ts';
import { dailyProperty } from '../markets/property.ts';
import { dailyLevers } from '../markets/levers.ts';
import { dailyGigs } from '../markets/gigs.ts';
import { dailyShares } from '../markets/shares.ts';
import { dailyOuter } from '../markets/outer.ts';
import { dailyNeighbours, scheduleBlockParties } from '../social/neighbours.ts';
import { dailyMentorship } from '../social/mentorship.ts';
import { dailyRumours } from '../social/rumours.ts';
import { dailyFeuds } from '../social/feuds.ts';
import { dailyFeed } from '../social/feed.ts';
import { dailyParties } from '../politics/parties.ts';
import { dailyPromises } from '../politics/promises.ts';
import { dailyApproval } from '../politics/approval.ts';
import { dailyReferendums } from '../politics/referendums.ts';
import { dailyUnions } from '../politics/unions.ts';
import { dailyDecrees } from '../politics/decrees.ts';
import { dailySchools } from '../culture/schools.ts';
import { dailyWorks } from '../culture/works.ts';
import { dailyMuseum } from '../culture/museum.ts';
import { dailyStadium } from '../culture/stadium.ts';
import { dailyMenus } from '../culture/menus.ts';
import { printLedgerEdition } from '../culture/press.ts';
import { computeStats } from './stats.ts';

/** Buildings mend this much damage every day. */
export const REPAIR_PER_DAY = 0.1;

/** What the rollover needs from `world/world.ts`, which owns the error book. */
export interface DailyHooks {
  guard<T>(world: World, where: string, fn: () => T): T | undefined;
  autosave(world: World): void;
}

/** A defaulted loan is fraud in the eyes of the Watch. */
function chargeLoanDefault(world: World, borrowerId: CitizenId, loan: Loan): void {
  const name = world.citizens[borrowerId]?.name ?? borrowerId;
  fileCharge(world, {
    defendantId: borrowerId, law: 'L07', evidence: 0.5, filedBy: 'watch', amount: loan.outstanding,
    description: `Fraud: ${name} defaulted on a Lantern Bank loan with ${loan.outstanding} ℓ outstanding`,
  });
}

/** Buildings mend a little every day; a full repair is news. */
export function repairBuildings(world: World): void {
  for (const b of Object.values(world.buildings)) {
    if (b.damage <= 0) continue;
    b.damage = Math.max(0, Math.round((b.damage - REPAIR_PER_DAY) * 100) / 100);
    if (b.damage === 0) emit(world, 'system', `${b.name} has been fully repaired and is back in service.`, [], 0.3, { buildingId: b.id });
  }
}

/**
 * Who everybody is this morning: letters home for whoever sent an agent, the
 * character the city reads off yesterday, the slow drift of a life lived, and
 * the needs, arrears and terms that the night moved on.
 */
function dailyIdentity(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyLetters', () => dailyLetters(world));
  h.guard(world, 'dailyCharacter', () => dailyCharacter(world));
  h.guard(world, 'dailyDrift', () => dailyDrift(world));
  h.guard(world, 'dailyCitizens', () => dailyCitizens(world));
}

/** The sky, and the city's own footprint under it. */
function dailyWorldDynamics(world: World, h: DailyHooks): void {
  h.guard(world, 'dailySeasons', () => dailySeasons(world));
  h.guard(world, 'dailyGrowth', () => dailyGrowth(world));
}

/**
 * The money: rents (the city's, then the landlords'), the dividend and the
 * salaries, then the taxes that are read off what is left, then work, gigs,
 * businesses, shares, the water and the bank.
 */
function dailyMarkets(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyHousing', () => dailyHousing(world));
  h.guard(world, 'dailyProperty', () => dailyProperty(world));
  h.guard(world, 'payDividend', () => payDividend(world));
  h.guard(world, 'paySalaries', () => paySalaries(world));
  h.guard(world, 'dailyLevers', () => dailyLevers(world));
  h.guard(world, 'dailyJobs', () => dailyJobs(world));
  h.guard(world, 'dailyGigs', () => dailyGigs(world));
  h.guard(world, 'dailyBusinesses', () => dailyBusinesses(world));
  h.guard(world, 'dailyShares', () => dailyShares(world));
  h.guard(world, 'dailyOuter', () => dailyOuter(world));
  h.guard(world, 'dailyLoans', () => dailyLoans(world, chargeLoanDefault));
}

/** The fabric: who lives beside whom, who teaches whom, and what is being said. */
function dailyFabric(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyRelationships', () => dailyRelationships(world));
  h.guard(world, 'dailyNeighbours', () => dailyNeighbours(world));
  h.guard(world, 'dailyMentorship', () => dailyMentorship(world));
  h.guard(world, 'dailyRumours', () => dailyRumours(world));
  h.guard(world, 'dailyFeuds', () => dailyFeuds(world));
  h.guard(world, 'dailyFeed', () => dailyFeed(world));
}

/** The institutions: standing, the cells, the Court, the detectives, the gangs, the Council. */
function dailyInstitutions(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyStandings', () => dailyStandings(world));
  h.guard(world, 'dailyJail', () => dailyJail(world));
  h.guard(world, 'dailyJustice', () => dailyJustice(world));
  h.guard(world, 'dailyInvestigations', () => dailyInvestigations(world));
  h.guard(world, 'dailyGangs', () => dailyGangs(world));
  h.guard(world, 'dailyGovernment', () => dailyGovernment(world));
}

/** The politics: parties, the promises they made, how the city reads them, the vote, the unions and the decrees. */
function dailyPolitics(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyParties', () => dailyParties(world));
  h.guard(world, 'dailyPromises', () => dailyPromises(world));
  h.guard(world, 'dailyApproval', () => dailyApproval(world));
  h.guard(world, 'dailyReferendums', () => dailyReferendums(world));
  h.guard(world, 'dailyUnions', () => dailyUnions(world));
  h.guard(world, 'dailyDecrees', () => dailyDecrees(world));
}

/**
 * The social layer's morning: what people want and what the shops hold, the
 * night's affections, growing up and growing old, the keep of children, the
 * bonds of family, the clubs and their meetings, the festivals and the block
 * parties of the day, and the Community Chest's stipends.
 */
function dailySociety(world: World, h: DailyHooks): void {
  h.guard(world, 'refreshWantsDaily', () => refreshWantsDaily(world));
  h.guard(world, 'restockEmporium', () => restockEmporium(world));
  h.guard(world, 'dailyPossessions', () => dailyPossessions(world));
  h.guard(world, 'dailyAffection', () => dailyAffection(world));
  h.guard(world, 'dailyLifeStages', () => dailyLifeStages(world));
  h.guard(world, 'dailyUpkeep', () => dailyUpkeep(world));
  h.guard(world, 'dailyBirthdays', () => dailyBirthdays(world));
  h.guard(world, 'familyBondFloor', () => familyBondFloor(world));
  h.guard(world, 'dailyClubs', () => dailyClubs(world));
  h.guard(world, 'scheduleMeetings', () => scheduleMeetings(world));
  h.guard(world, 'scheduleFestivals', () => scheduleFestivals(world));
  h.guard(world, 'scheduleBlockParties', () => scheduleBlockParties(world));
  h.guard(world, 'dailyChest', () => dailyChest(world));
}

/** The arts, the collection, the league and the kitchens. */
function dailyCulture(world: World, h: DailyHooks): void {
  h.guard(world, 'dailySchools', () => dailySchools(world));
  h.guard(world, 'dailyWorks', () => dailyWorks(world));
  h.guard(world, 'dailyMuseum', () => dailyMuseum(world));
  h.guard(world, 'dailyStadium', () => dailyStadium(world));
  h.guard(world, 'dailyMenus', () => dailyMenus(world));
}

/**
 * What the water moved since yesterday's roll. Imports burn lumens and
 * exports (and the visitors who come in on the tide) mint them; they are the
 * only two things in Reverie that do either, so the day's trade is the
 * difference in the Treasury's own count of both.
 */
function tallyOuterTrade(world: World): void {
  const minted = world.treasury.minted;
  const burned = world.treasury.burned;
  world.counters.outerMintedToday = minted - (world.counters.outerMintedTotal ?? 0);
  world.counters.outerBurnedToday = burned - (world.counters.outerBurnedTotal ?? 0);
  world.counters.outerMintedTotal = minted;
  world.counters.outerBurnedTotal = burned;
}

/**
 * Standing: the public score, recomputed from a day the city has now finished
 * reading, then the notices it moves and the hearings they end in
 * (`docs/CITIZENSHIP.md`). It runs last of the institutions because every
 * figure it counts — character, convictions, custody, offices, shifts, works,
 * children and the Chest — has already been settled this morning.
 */
function dailyStanding(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyRepute', () => dailyRepute(world));
  h.guard(world, 'dailyNotices', () => dailyNotices(world));
  h.guard(world, 'dailyHearings', () => dailyHearings(world));
}

/** Bodies, ambitions, the weather's worst and the city's memory of it. */
function dailyLives(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyHealth', () => dailyHealth(world));
  h.guard(world, 'dailyGoals', () => dailyGoals(world));
  h.guard(world, 'dailyDisasters', () => dailyDisasters(world));
  h.guard(world, 'dailyHistory', () => dailyHistory(world));
}

/** Hour 0: the whole morning, in contract order. */
export function dailyRollover(world: World, h: DailyHooks): void {
  dailyIdentity(world, h);
  dailyWorldDynamics(world, h);
  dailyMarkets(world, h);
  dailyFabric(world, h);
  dailyInstitutions(world, h);
  dailyPolitics(world, h);
  h.guard(world, 'dailyWatch', () => dailyWatch(world));
  h.guard(world, 'dailyMarket', () => dailyMarket(world));
  dailySociety(world, h);
  dailyCulture(world, h);
  dailyLives(world, h);
  dailyStanding(world, h);
  h.guard(world, 'repairBuildings', () => repairBuildings(world));
  const report = h.guard(world, 'dailyTreasuryRollover', () => dailyTreasuryRollover(world)) ?? 'Treasury: no report today.';
  h.guard(world, 'printMorningEdition', () => printMorningEdition(world, report));
  h.guard(world, 'printLedgerEdition', () => printLedgerEdition(world, report));
  h.guard(world, 'auditMoneySupply', () => auditMoneySupply(world));
  h.guard(world, 'tallyOuterTrade', () => tallyOuterTrade(world));
  h.guard(world, 'computeStats', () => world.stats.push(computeStats(world)));
  h.autosave(world);
}

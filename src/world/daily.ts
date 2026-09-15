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
import type { CitizenId, World } from '../types.ts';
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
// The two newest layers: the Exchange's register and the city's own paper.
import { closeCivilDocket, dailyCivil, openCivilDocket } from '../civil/daily.ts';
import { dailyFinance, financeReport, tickFinance } from '../finance/daily.ts';
// What the city knows, and what its shifts left in the air overnight.
import { dailyProgress } from '../progress/daily.ts';
import { dailyEnvironment } from '../environment/daily.ts';
// The gate and what goes past it, and the charter that all of it is under.
// `politics/session.ts` is imported whole rather than in pieces, because
// loading it is what registers the two referendum questions the recall ballot
// and a convention's ratification are put to the city as.
import { dailyUnderworld } from '../underworld/daily.ts';
// The congregation's morning and the family's: the two newest registers.
import { dailyCreeds, holdCreedCourt } from '../creeds/index.ts';
import { dailyGenerations } from '../generations/index.ts';
import { CONVENTION_HOUR } from '../politics/convention.ts';
import {
  dailyPolitics as dailyCharter, politicsHearings, politicsSession, tickPolitics,
} from '../politics/session.ts';
import { computeStats } from './stats.ts';

/** Buildings mend this much damage every day. */
export const REPAIR_PER_DAY = 0.1;

/**
 * A debtor who can pay and will not is in contempt (L10), and the Watch lays
 * the charge. `government/recovery.ts` decides *whether* — after a fortnight,
 * and only for somebody who demonstrably can pay — and the civil layer never
 * files anything itself, which is why it takes this handler rather than
 * importing the Court. Poverty is never contempt, and a judgment debt reaches
 * no further than the ladder (`docs/CIVIL.md` §5).
 */
function chargeCivilContempt(world: World, cId: CitizenId, owed: number, days: number): void {
  const c = world.citizens[cId];
  if (!c || c.standing === 'exiled' || c.standing === 'suspended') return;
  fileCharge(world, {
    defendantId: cId, law: 'L10', evidence: 1, filedBy: 'watch', amount: owed,
    description: `Contempt of court: ${c.name} has held back ${owed} ℓ for ${days} days while able to pay`,
  });
}

/** What the rollover needs from `world/world.ts`, which owns the error book. */
export interface DailyHooks {
  guard<T>(world: World, where: string, fn: () => T): T | undefined;
  autosave(world: World): void;
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
  // What the city knows, before anything reads it: a programme that reached
  // its cost yesterday is put to the test this morning, a secret whose last
  // master left in the night is lost, the works draw their day's lumens from
  // the public fund, and yesterday's shares become the lagged trend index
  // every shopkeeper reads today (`docs/PROGRESS.md`). It runs above the
  // money because the day's output, glitch rolls and detection all read the
  // register it settles.
  h.guard(world, 'dailyProgress', () => dailyProgress(world));
}

/**
 * What the city owes before it spends anything: the coupons on its own paper,
 * anything matured redeemed, the holders' votes counted, the bank's vault
 * settled and read, the premiums collected and the pots' claims decided
 * (`docs/FINANCE.md` §1 — debt service is today's fixed spend, and it is paid
 * ahead of any salaried shift, which is what makes the 20 % cap the line it
 * is). It therefore runs before `dailyMarkets`, whose `dailyJobs` sets the
 * day's wage budget out of what is left.
 */
function dailyFinances(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyFinance', () => dailyFinance(world));
}

/**
 * The Exchange's own morning: the patrons' stipends, the instruments that ran
 * to term or went undischarged, the orders of performance that expired, the
 * guilds' elections, and the recovery of every judgment somebody has asked to
 * be collected. It runs after the money has moved, so a stipend and a
 * garnishment are read against a wallet the day has already filled.
 */
function dailyExchange(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyCivil', () => dailyCivil(world, chargeCivilContempt));
}

/**
 * The congregations' morning (`docs/CREEDS.md`): the roll kept honest, the
 * tithe taken as a share of yesterday's net income, the house rent paid or the
 * arrears counted, the seat settled by the founders' own rule, sanctuaries fed,
 * gatherings and pilgrimages put on the calendar, disputes counted toward a
 * schism, the fund's claims decided by its members, yesterday's persuasion
 * rolls turned into invitations — and nothing else — and observance recomputed
 * from public acts alone.
 *
 * It runs **before** `dailySociety`, whose `dailyChest` pays the city's own
 * hardship stipends out of the same wallets: donations to the Chest fall as
 * tithes rise, same wallets, same morning (`CREEDS.md` §3), and the order here
 * is what makes that true rather than an assertion.
 *
 * The layer's other hook is not here. Refusals of conscience and applications
 * for a warrant of entry are heard by a **bench**, so they sit at the Court's
 * hour in `closeSittings` and never at hour 0 with the tithes.
 */
function dailyCongregations(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyCreeds', () => dailyCreeds(world));
}

/**
 * The money: rents (the city's, then the landlords'), the dividend and the
 * salaries, then the taxes that are read off what is left, then work, gigs,
 * businesses, shares, the water and the bank.
 */
function dailyMarkets(world: World, h: DailyHooks): void {
  // Yesterday's air settles first: the emission charge is billed on what made
  // it, the fittings are held or lose their edge, the districts that host the
  // works are paid, and the trees grow. It runs before `dailyHousing`, which
  // is what strikes the land value — so the morning's rents read the night's
  // air (`docs/ENVIRONMENT.md` §§1, 3).
  h.guard(world, 'dailyEnvironment', () => dailyEnvironment(world));
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
  // A default is **not a crime**, so `dailyLoans` is given no handler: there is
  // no charge to file (`REGISTRY.md` §7 — "ECONOMY: a bank default is reported
  // to the Watch as Fraud → a default is not a crime; the civil recovery ladder
  // collects it"; `JUSTICE.md` §1, "Debt is not a crime"; and `REGISTRY.md` §4,
  // which lists a called loan among the debts that reach no code at all).
  //
  // What answers a default instead is already built and already runs: the bank
  // keeps collecting a quarter of the wallet every morning — the garnishment
  // share to the lumen (`economy/bank.ts AUTO_REPAY_FRACTION` against
  // `government/recovery.ts GARNISHMENT_SHARE`) — the borrower loses fifteen of
  // reputation on the day, the outstanding balance counts against the vault's
  // book in `finance/credit.ts defaultedLoanShare` and so against what the city
  // will lend anybody afterwards, and `finance/credit.ts dailyCalledLoans` says
  // in as many words that a called loan "goes to civil recovery". Charging L07
  // on top of that put a severity-3 strike on the ladder for owing money, and
  // four such strikes reach the Gate: it was the last road in the engine from
  // poverty to exile.
  h.guard(world, 'dailyLoans', () => dailyLoans(world));
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
  // The charter itself, last of the politics: the convention finishes what the
  // city answered yesterday, the charter is read back and classified, the seats
  // are counted, the bodies answer for sitting past their term, the records and
  // the papers do their day, and the Games keep their clock
  // (`docs/POLITICS.md` §9, `REGISTRY.md` §2).
  h.guard(world, 'dailyCharter', () => dailyCharter(world));
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
  // The name's own figure is recomputed **right after each citizen's own**
  // (`docs/GENERATIONS.md` §1), and the arrow only ever runs that way: a
  // citizen's repute is an input to their house's number and never the
  // reverse. Everything else the layer does in a morning hangs off it —
  // offices entered, sponsored convictions stained, heads read from the rule,
  // motions and matches decided, the entail's rents and the cycle's levy, a
  // called pledge, and the estates that opened overnight.
  h.guard(world, 'dailyGenerations', () => dailyGenerations(world));
}

/** Bodies, ambitions, the weather's worst and the city's memory of it. */
function dailyLives(world: World, h: DailyHooks): void {
  h.guard(world, 'dailyHealth', () => dailyHealth(world));
  h.guard(world, 'dailyGoals', () => dailyGoals(world));
  h.guard(world, 'dailyDisasters', () => dailyDisasters(world));
  h.guard(world, 'dailyHistory', () => dailyHistory(world));
}

/**
 * The public hours the two newest layers sit at (`REGISTRY.md` §2), run
 * around the hour's turns by `world/world.ts`:
 *
 * - tick 14, at City Hall beside the Council's session: a bond auction closes.
 * - tick 16, at the Courthouse on the second and fifth day of the week: the
 *   civil docket. The benches are seated **before** the turns, so a judge
 *   sitting today sees the suits in the observation it acts on, exactly as
 *   the criminal list does; the votes are counted at the end of the hour, and
 *   a bench that did not vote holds the suit over.
 */
export function openSittings(world: World, h: DailyHooks): void {
  h.guard(world, 'tickFinance', () => tickFinance(world));
  h.guard(world, 'openCivilDocket', () => openCivilDocket(world));
  // Every tick: an hour a candidate spends in a ward is an hour that ward saw
  // them, which is the whole of what a ward scheme reads (`POLITICS.md` §5).
  h.guard(world, 'tickPolitics', () => tickPolitics(world));
}

/**
 * The same hour, after everyone has acted: the docket counts its votes, the
 * Court's second sitting counts the tribunal's and the convention's, and the
 * Council's hour reads the charter's own order paper (`REGISTRY.md` §2).
 *
 * Both politics hours sit here rather than in `openSittings` because both
 * *count* what the hour's turns cast: a delegate votes on an article during
 * tick 12 and the article is decided at the end of it, exactly as the criminal
 * list is tallied after the hour it is heard in.
 */
export function closeSittings(world: World, h: DailyHooks): void {
  h.guard(world, 'closeCivilDocket', () => closeCivilDocket(world));
  // The Court's criminal list and any warrant application sit at the same hour
  // (`REGISTRY.md` §2), so the two things a creed puts before a bench are heard
  // at the end of it: a refusal of conscience, on the precedent formula in
  // `CREEDS.md` §4, and an application to open a house of meeting, on the
  // ground formula in §5. A captain who applied this hour is answered this
  // hour, and a member who refused a jury seat learns whether the ground stood.
  if (world.hour === world.config.courtHour) h.guard(world, 'holdCreedCourt', () => holdCreedCourt(world));
  if (world.hour === CONVENTION_HOUR) h.guard(world, 'politicsHearings', () => politicsHearings(world));
  if (world.hour === world.config.councilHour) h.guard(world, 'politicsSession', () => politicsSession(world));
}

/** Hour 0: the whole morning, in contract order. */
export function dailyRollover(world: World, h: DailyHooks): void {
  dailyIdentity(world, h);
  dailyWorldDynamics(world, h);
  dailyFinances(world, h);
  dailyMarkets(world, h);
  dailyExchange(world, h);
  dailyCongregations(world, h);
  dailyFabric(world, h);
  dailyInstitutions(world, h);
  dailyPolitics(world, h);
  h.guard(world, 'dailyWatch', () => dailyWatch(world));
  h.guard(world, 'dailyMarket', () => dailyMarket(world));
  // The underworld's morning runs after `dailyWatch` and `dailyInvestigations`,
  // because it staffs the gates out of the officers the Watch has just put on
  // duty and works the traces the detectives were assigned to; and after
  // `dailyMarket`, because the black price is arithmetic on top of the shelf
  // price the market has just struck (`docs/UNDERWORLD.md` §§3–4).
  h.guard(world, 'dailyUnderworld', () => dailyUnderworld(world));
  dailySociety(world, h);
  dailyCulture(world, h);
  dailyLives(world, h);
  dailyStanding(world, h);
  h.guard(world, 'repairBuildings', () => repairBuildings(world));
  const report = h.guard(world, 'dailyTreasuryRollover', () => dailyTreasuryRollover(world)) ?? 'Treasury: no report today.';
  // The city's own paper, and what stands behind a lumen, print side by side:
  // the balance sheet is the number every bidder reads first (`FINANCE.md` §7).
  const debt = h.guard(world, 'financeReport', () => financeReport(world)) ?? '';
  const balanceSheet = debt ? `${report} ${debt}` : report;
  h.guard(world, 'printMorningEdition', () => printMorningEdition(world, balanceSheet));
  h.guard(world, 'printLedgerEdition', () => printLedgerEdition(world, balanceSheet));
  h.guard(world, 'auditMoneySupply', () => auditMoneySupply(world));
  h.guard(world, 'tallyOuterTrade', () => tallyOuterTrade(world));
  h.guard(world, 'computeStats', () => world.stats.push(computeStats(world)));
  h.autosave(world);
}

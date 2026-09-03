/**
 * The World: founding the city, the tick loop that drives it, the morning
 * rollover, brain registries and persistence.
 *
 * One tick is one city hour. Every tick each present citizen is shown an
 * observation, asked its brain for an action, and the action is executed;
 * then the Court, the Council and the polls sit at their hours, needs decay,
 * the market moves, detentions expire and businesses sell. At hour 0 the day
 * rolls over: money, housing, justice, government and the Chronicle.
 *
 * The engine never lets one citizen's action (or one module's bug) end a
 * run: every phase is guarded, errors are counted in
 * world.counters.engineErrors, emitted as 'system' events and logged to
 * stderr so they stay visible.
 */
import { DEFAULT_CONFIG, DISTRICT_IDS } from '../types.ts';
import type { Action, Brain, BrainKind, Citizen, CitizenId, DistrictId, Loan, Observation, World, WorldConfig } from '../types.ts';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyWorld } from './scaffold.ts';
import { emit, remember } from '../sim/events.ts';
import { auditMoneySupply, dailyTreasuryRollover, formatLumens, payDividend, paySalaries } from '../economy/treasury.ts';
import { dailyMarket, tickMarket } from '../economy/market.ts';
import { createCityJobs, dailyJobs } from '../economy/jobs.ts';
import { dailyBusinesses, hourlyBusinesses } from '../economy/business.ts';
import { dailyLoans } from '../economy/bank.ts';
import { dailyHousing } from '../economy/housing.ts';
import { activeCitizens, canAct, createCitizen, dailyCitizens, tickNeeds } from '../citizens/citizen.ts';
import { dailyRelationships } from '../citizens/relationships.ts';
import { printMorningEdition } from '../sim/chronicle.ts';
import { dailyWatch, tickWatch } from '../government/watch.ts';
import { dailyJustice, fileCharge, holdCourt } from '../government/court.ts';
import { dailyStandings } from '../government/registry.ts';
import { appointJudges, councilSession, dailyGovernment, holdElection, isElectionDay, openNominations } from '../government/council.ts';
import { executeAction } from '../actions/execute.ts';
import { buildObservation } from '../brains/observe.ts';
import { reflexBrain } from '../brains/reflex.ts';
import { computeStats } from './stats.ts';

export { computeStats } from './stats.ts';

/** Buildings mend this much damage every day. */
export const REPAIR_PER_DAY = 0.1;
/** Founders are spread over the six living districts; the Threshold is for newcomers. */
export const FOUNDING_DISTRICTS: readonly DistrictId[] = DISTRICT_IDS.filter((d) => d !== 'threshold');
const IDLE: Action = { type: 'idle' };

// ---------------------------------------------------------------------------
// Brains
// ---------------------------------------------------------------------------

/** Maps each citizen to the brain that decides for it. */
export interface BrainRegistry {
  brainFor(c: Citizen): Brain;
}

/** Everyone thinks with the reflex brain: the deterministic, headless city. */
export function createReflexRegistry(): BrainRegistry {
  return { brainFor: () => reflexBrain };
}

/** A registry by brain kind; kinds without a brain fall back to reflex. */
export function createBrainRegistry(brains: Partial<Record<BrainKind, Brain>>): BrainRegistry {
  return { brainFor: (c) => brains[c.brain] ?? brains.reflex ?? reflexBrain };
}

// ---------------------------------------------------------------------------
// Founding
// ---------------------------------------------------------------------------

/**
 * Found the city: geography and market from the scaffold, the city's jobs,
 * the seed population spread over the districts (the first
 * config.llmCitizens of them with a Claude brain), a provisional bench, open
 * nominations for the founding election, and the founding notice.
 */
export function createWorld(config: Partial<WorldConfig> = {}): World {
  const world = emptyWorld(config);
  createCityJobs(world);
  const population = Math.max(0, Math.round(world.config.seedPopulation));
  const llm = Math.max(0, Math.round(world.config.llmCitizens));
  for (let i = 0; i < population; i++) {
    createCitizen(world, {
      district: FOUNDING_DISTRICTS[i % FOUNDING_DISTRICTS.length],
      brain: i < llm ? 'llm' : 'reflex',
    });
  }
  appointJudges(world);
  openNominations(world);
  const jobs = Object.keys(world.jobs).length;
  emit(world, 'system',
    `Reverie was founded with ${population} citizens, ${jobs} city jobs and a Treasury of ${formatLumens(world.treasury.balance)}; `
    + `the first Council election is on day ${world.government.election.electionDay}.`,
    [], 0.9, { population, jobs, seed: world.config.seed });
  return world;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/** Count, announce and log an engine error without stopping the run. */
export function recordEngineError(world: World, where: string, err: unknown): void {
  world.counters.engineErrors = (world.counters.engineErrors ?? 0) + 1;
  const message = err instanceof Error ? err.message : String(err);
  emit(world, 'system', `Engine error in ${where}: ${message}`, [], 0.3, { where });
  const detail = err instanceof Error ? err.stack ?? err.message : String(err);
  console.error(`[reverie] engine error at tick ${world.tick} (day ${world.day}, hour ${world.hour}) in ${where}:\n${detail}`);
}

/** Run one engine phase, turning an exception into a recorded engine error. */
function guard<T>(world: World, where: string, fn: () => T): T | undefined {
  try {
    return fn();
  } catch (err) {
    recordEngineError(world, where, err);
    return undefined;
  }
}

// ---------------------------------------------------------------------------
// The day
// ---------------------------------------------------------------------------

/** A defaulted loan is fraud in the eyes of the Watch. */
function chargeLoanDefault(world: World, borrowerId: CitizenId, loan: Loan): void {
  const name = world.citizens[borrowerId]?.name ?? borrowerId;
  fileCharge(world, {
    defendantId: borrowerId, law: 'L07', evidence: 0.5, filedBy: 'watch', amount: loan.outstanding,
    description: `Fraud: ${name} defaulted on a Lantern Bank loan with ${loan.outstanding} ℓ outstanding`,
  });
}

/** Buildings mend a little every day; a full repair is news. */
function repairBuildings(world: World): void {
  for (const b of Object.values(world.buildings)) {
    if (b.damage <= 0) continue;
    b.damage = Math.max(0, Math.round((b.damage - REPAIR_PER_DAY) * 100) / 100);
    if (b.damage === 0) emit(world, 'system', `${b.name} has been fully repaired and is back in service.`, [], 0.3, { buildingId: b.id });
  }
}

/** Hour 0: the daily passes in contract order, the Treasury's report, the morning edition, the audit and the statistics. */
function dailyRollover(world: World): void {
  guard(world, 'dailyCitizens', () => dailyCitizens(world));
  guard(world, 'dailyHousing', () => dailyHousing(world));
  guard(world, 'payDividend', () => payDividend(world));
  guard(world, 'paySalaries', () => paySalaries(world));
  guard(world, 'dailyJobs', () => dailyJobs(world));
  guard(world, 'dailyBusinesses', () => dailyBusinesses(world));
  guard(world, 'dailyLoans', () => dailyLoans(world, chargeLoanDefault));
  guard(world, 'dailyRelationships', () => dailyRelationships(world));
  guard(world, 'dailyStandings', () => dailyStandings(world));
  guard(world, 'dailyJustice', () => dailyJustice(world));
  guard(world, 'dailyGovernment', () => dailyGovernment(world));
  guard(world, 'dailyWatch', () => dailyWatch(world));
  guard(world, 'dailyMarket', () => dailyMarket(world));
  guard(world, 'repairBuildings', () => repairBuildings(world));
  const report = guard(world, 'dailyTreasuryRollover', () => dailyTreasuryRollover(world)) ?? 'Treasury: no report today.';
  guard(world, 'printMorningEdition', () => printMorningEdition(world, report));
  guard(world, 'auditMoneySupply', () => auditMoneySupply(world));
  guard(world, 'computeStats', () => world.stats.push(computeStats(world)));
}

// ---------------------------------------------------------------------------
// The tick
// ---------------------------------------------------------------------------

function describeAction(a: Action): string {
  return a.type.replace(/_/g, ' ');
}

/** A brain's answer, if it is even the right shape. */
function isAction(a: unknown): a is Action {
  return typeof a === 'object' && a !== null && typeof (a as { type?: unknown }).type === 'string';
}

/** One citizen's hour: observe, decide (never trusting the brain not to throw), act, remember failures. */
async function actFor(world: World, c: Citizen, brains: BrainRegistry): Promise<void> {
  let obs: Observation;
  try {
    obs = buildObservation(world, c.id);
  } catch (err) {
    recordEngineError(world, `observation for ${c.name}`, err);
    return;
  }
  let action: Action = IDLE;
  try {
    const decided: unknown = await brains.brainFor(c).decide(world, c, obs);
    action = isAction(decided) ? decided : IDLE;
  } catch (err) {
    recordEngineError(world, `${c.brain} brain of ${c.name}`, err);
  }
  // A remote or Claude brain may have taken real time: make sure the citizen is still able to act.
  if (!world.order.includes(c.id) || !canAct(world, c)) return;
  const result = guard(world, `${describeAction(action)} by ${c.name}`, () => executeAction(world, c.id, action))
    ?? { ok: false, message: 'the engine stumbled; the hour passed' };
  if (!result.ok) remember(world, c.id, 'event', `(could not ${describeAction(action)}: ${result.message})`);
}

/**
 * Advance the city by one hour. See the module comment for the order of
 * play; it follows docs/MODULES.md exactly.
 */
export async function stepTick(world: World, brains: BrainRegistry): Promise<void> {
  world.tick += 1;
  world.day = Math.floor(world.tick / 24);
  world.hour = world.tick % 24;
  world.tickEvents = [];

  if (world.hour === 0) dailyRollover(world);

  for (const id of [...world.order]) {
    const c = world.citizens[id];
    if (!c || !canAct(world, c) || !world.order.includes(id)) continue;
    await actFor(world, c, brains);
  }

  if (world.hour === world.config.courtHour) guard(world, 'holdCourt', () => holdCourt(world));
  if (world.hour === world.config.councilHour) guard(world, 'councilSession', () => councilSession(world));
  if (world.hour === 20 && isElectionDay(world)) guard(world, 'holdElection', () => holdElection(world));

  guard(world, 'tickNeeds', () => { for (const c of activeCitizens(world)) tickNeeds(world, c); });
  guard(world, 'tickMarket', () => tickMarket(world));
  guard(world, 'tickWatch', () => tickWatch(world));
  guard(world, 'hourlyBusinesses', () => hourlyBusinesses(world));
}

export async function runTicks(world: World, n: number, brains: BrainRegistry): Promise<void> {
  for (let i = 0; i < n; i++) await stepTick(world, brains);
}

export async function runDays(world: World, n: number, brains: BrainRegistry): Promise<void> {
  await runTicks(world, n * 24, brains);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/** Write the world as JSON (atomically: a temporary file renamed into place). */
export function saveWorld(world: World, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(world));
  renameSync(tmp, path);
}

/** Read a world saved by saveWorld. Throws if the file is not a Reverie save. */
export function loadWorld(path: string): World {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  if (typeof parsed !== 'object' || parsed === null) throw new Error(`${path} does not contain a Reverie world`);
  const world = parsed as World;
  if (world.version !== 1 || typeof world.citizens !== 'object' || typeof world.config !== 'object' || !world.rng) {
    throw new Error(`${path} is not a version-1 Reverie world save`);
  }
  world.config = { ...DEFAULT_CONFIG, ...world.config };
  world.tickEvents ??= [];
  world.stats ??= [];
  world.chronicle ??= [];
  world.counters ??= {};
  return world;
}

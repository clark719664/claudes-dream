/**
 * The World: founding the city, the tick loop that drives it, the morning
 * rollover, brain registries and persistence.
 *
 * One tick is one city hour, and it has two phases. First the engine builds
 * the observation for every citizen who can act and asks every brain at the
 * same time, with a deadline (config.decisionDeadlineMs); a brain that misses
 * it acts on instinct for that hour. Then the answers are carried out in
 * world.order, so everyone acts on the city as it stood at the top of the
 * hour. The Court opens its sitting before that first phase, so a judge sees
 * the cases before it in the observation it acts on, and counts the votes an
 * hour later. After that the Council and the polls sit at their hours,
 * needs decay, the market moves, detentions expire and businesses sell. At
 * hour 0 the day rolls over: money, housing, justice, government and the
 * Chronicle — and the world is autosaved if a path was registered.
 *
 * Determinism is unaffected: brains are asked in world.order and answer in
 * that order too, reflex brains answer synchronously (so they draw from the
 * random stream in a fixed sequence), and instinct touches nothing at all.
 *
 * The engine never lets one citizen's action (or one module's bug) end a
 * run: every phase is guarded, errors are counted in
 * world.counters.engineErrors, emitted as 'system' events and logged to
 * stderr so they stay visible.
 */
import { DEFAULT_CONFIG, FOUNDING_DISTRICT_IDS } from '../types.ts';
import type { Action, Brain, BrainKind, Citizen, DistrictId, Observation, World, WorldConfig } from '../types.ts';
import { mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { emptyWorld } from './scaffold.ts';
import { FAMILY_NAMES } from '../data/catalogue.ts';
import { REFERENDUM_HOUR, REFERENDUM_WEEKDAY } from '../data/metropolis.ts';
import { assignTastes } from '../society/tastes.ts';
import { emit, remember } from '../sim/events.ts';
import { formatLumens } from '../economy/treasury.ts';
import { tickMarket } from '../economy/market.ts';
import { createCityJobs } from '../economy/jobs.ts';
import { hourlyBusinesses } from '../economy/business.ts';
import { activeCitizens, canAct, createCitizen, tickNeeds } from '../citizens/citizen.ts';
import { tickWatch } from '../government/watch.ts';
import { courtTallyHour, openCourtSession, tallyVerdicts } from '../government/court.ts';
import { appointJudges, councilSession, holdElection, isElectionDay, openNominations } from '../government/council.ts';
import { initEmporium } from '../society/shops.ts';
import { tickHappenings, weekday } from '../society/calendar.ts';
import { holdReferendum } from '../politics/referendums.ts';
import { fillMetropolisDefaults } from './scaffold.ts';
import { closeSittings, dailyRollover, openSittings } from './daily.ts';
import { executeAction } from '../actions/execute.ts';
import { buildObservation } from '../brains/observe.ts';
import { reflexBrain } from '../brains/reflex.ts';
import { childDecide } from '../brains/child.ts';
import { instinctBrain, instinctOrIdle } from '../brains/instinct.ts';
import { computeStats } from './stats.ts';
import { frozenRound } from '../util/memo.ts';

export { computeStats } from './stats.ts';

/**
 * Founders are spread over the six living districts the city has on its first
 * day; the Threshold is for newcomers, and the Heights and the Undercroft are
 * not open yet (world/growth.ts opens them with the population).
 */
export const FOUNDING_DISTRICTS: readonly DistrictId[] = FOUNDING_DISTRICT_IDS.filter((d) => d !== 'threshold');
const IDLE: Action = { type: 'idle' };

// ---------------------------------------------------------------------------
// Brains
// ---------------------------------------------------------------------------

/** Maps each citizen to the brain that decides for it. */
export interface BrainRegistry {
  brainFor(c: Citizen): Brain;
}

/**
 * A child born in Reverie whom nobody has claimed: it goes to school, plays,
 * eats and sleeps, and nothing is played for it. `POST /api/agents/:id/claim`
 * is how a parent's owner gives it a mind of its own.
 */
export const childBrain: Brain = { kind: 'child', decide: childDecide };

/** Everyone thinks with the reflex brain: the deterministic, headless city. */
export function createReflexRegistry(): BrainRegistry {
  return { brainFor: () => reflexBrain };
}

/**
 * A registry by brain kind. Unclaimed children always get the child brain and
 * scripted citizens always get the reflex brain, since that is what they are.
 * A citizen of any other kind whose mind is not in the registry — a Claude
 * citizen in a world with no model, an agent in a city replayed with no
 * broker — lives on **instinct**: nothing scripted plays its life for it
 * (docs/PRINCIPLES.md §4).
 */
export function createBrainRegistry(brains: Partial<Record<BrainKind, Brain>>): BrainRegistry {
  return {
    brainFor: (c) => brains[c.brain]
      ?? (c.brain === 'child' ? childBrain : c.brain === 'reflex' ? reflexBrain : instinctBrain),
  };
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
    const claude = i < llm;
    createCitizen(world, {
      district: FOUNDING_DISTRICTS[i % FOUNDING_DISTRICTS.length],
      brain: claude ? 'llm' : 'reflex',
      // Seeded founders say what they are wherever they appear: scripted minds, not agents anyone sent.
      lineage: claude ? 'Claude' : 'reflex',
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
// The tick
// ---------------------------------------------------------------------------

/** The morning, run with this file's error book and this file's autosave. */
const DAILY_HOOKS = { guard, autosave };

function describeAction(a: Action): string {
  return a.type.replace(/_/g, ' ');
}

/** A brain's answer, if it is even the right shape. */
function isAction(a: unknown): a is Action {
  return typeof a === 'object' && a !== null && typeof (a as { type?: unknown }).type === 'string';
}

function isThenable(v: unknown): v is PromiseLike<unknown> {
  return typeof v === 'object' && v !== null && typeof (v as PromiseLike<unknown>).then === 'function';
}

/** A citizen, what it was shown this hour, and what it decided to do with it. */
interface Turn {
  c: Citizen;
  obs: Observation;
  /** Filled in phase one: an answer, or a promise of one. */
  answer: Action | Promise<Action>;
}

/**
 * A brain that takes real time gets `config.decisionDeadlineMs` to answer
 * (0 waits forever). Miss it — or throw, or answer with rubbish — and the
 * citizen falls back on instinct for the hour; a late answer is ignored.
 */
function withDeadline(world: World, c: Citizen, obs: Observation, answer: PromiseLike<unknown>): Promise<Action> {
  const fallback = (why: string | null): Action => {
    if (why) {
      world.counters.deadlineMisses = (world.counters.deadlineMisses ?? 0) + 1;
      remember(world, c.id, 'event', `(${why}; instinct took the hour)`);
    }
    return instinctOrIdle(world, c, obs);
  };
  const decided = Promise.resolve(answer).then(
    (a) => (isAction(a) ? a : fallback(null)),
    (err: unknown) => {
      recordEngineError(world, `${c.brain} brain of ${c.name}`, err);
      return fallback(null);
    },
  );
  const ms = Math.max(0, Math.round(world.config.decisionDeadlineMs ?? 0));
  if (ms <= 0) return decided;
  return new Promise<Action>((resolve) => {
    const timer = setTimeout(() => resolve(fallback(`${c.name} did not decide within ${ms} ms`)), ms);
    void decided.then((a) => {
      clearTimeout(timer);
      resolve(a);
    });
  });
}

/** Ask one brain, without letting it throw into the tick. */
function askBrain(world: World, brains: BrainRegistry, c: Citizen, obs: Observation): Action | Promise<Action> {
  let decided: unknown;
  try {
    decided = brains.brainFor(c).decide(world, c, obs);
  } catch (err) {
    recordEngineError(world, `${c.brain} brain of ${c.name}`, err);
    return instinctOrIdle(world, c, obs);
  }
  if (isThenable(decided)) return withDeadline(world, c, obs, decided);
  return isAction(decided) ? decided : instinctOrIdle(world, c, obs);
}

/**
 * Phase one of the hour: the observation for everyone who can act, then every
 * brain asked at once. Reflex brains answer where they stand (in world.order,
 * so the random stream is drawn from in a fixed sequence); brains that take
 * time are all in flight before any of them is awaited.
 */
async function collectTurns(world: World, brains: BrainRegistry): Promise<Turn[]> {
  const turns: Turn[] = [];
  // Nothing the city can be asked about changes while it is being looked at,
  // so the public facts every observation shares — the job board, the deeds,
  // the wall, who is standing where — are read once for the whole round
  // rather than once per citizen (`util/memo.ts`). Asking the minds happens
  // inside the same round: a scripted mind puts the city the same questions
  // its own observation just did, and between the observation and the answer
  // the only things that move are the random stream and a mind's private
  // "already done today" marks, which nothing the round remembers reads.
  // The round is opened and closed synchronously, before anybody acts.
  frozenRound(world, () => {
    for (const id of [...world.order]) {
      const c = world.citizens[id];
      if (!c || !canAct(world, c)) continue;
      let obs: Observation;
      try {
        obs = buildObservation(world, c.id);
      } catch (err) {
        recordEngineError(world, `observation for ${c.name}`, err);
        continue;
      }
      turns.push({ c, obs, answer: IDLE });
    }
    for (const turn of turns) turn.answer = askBrain(world, brains, turn.c, turn.obs);
  });
  // A mind that takes real time answers after the round has closed, and what
  // it (or instinct in its place) reads then is read fresh.
  const answers = await Promise.all(turns.map((t) => t.answer));
  answers.forEach((action, i) => { turns[i].answer = action; });
  return turns;
}

/** Phase two: carry out the hour's decisions in world.order, remembering failures. */
function executeTurns(world: World, turns: Turn[]): void {
  for (const { c, answer } of turns) {
    const action = isAction(answer) ? answer : IDLE;
    // Deciding may have taken real time: make sure the citizen can still act.
    if (!world.citizens[c.id] || !world.order.includes(c.id) || !canAct(world, c)) continue;
    const result = guard(world, `${describeAction(action)} by ${c.name}`, () => executeAction(world, c.id, action))
      ?? { ok: false, message: 'the engine stumbled; the hour passed' };
    if (!result.ok) remember(world, c.id, 'event', `(could not ${describeAction(action)}: ${result.message})`);
  }
}

/**
 * Advance the city by one hour: the daily rollover at hour 0, then the two
 * phases of the tick, then the institutions that sit at their hours and the
 * hourly upkeep of needs, market, Watch and businesses.
 */
export async function stepTick(world: World, brains: BrainRegistry): Promise<void> {
  world.tick += 1;
  world.day = Math.floor(world.tick / 24);
  world.hour = world.tick % 24;
  world.tickEvents = [];

  if (world.hour === 0) dailyRollover(world, DAILY_HOOKS);

  // The Court opens before the hour is decided, so that a judge sitting today
  // sees the cases before it in the observation it acts on.
  if (world.hour === world.config.courtHour) guard(world, 'openCourtSession', () => openCourtSession(world));
  // And so do the hours the Exchange keeps: the auction's close at 14 and the
  // civil docket at 16 (`world/daily.ts`, `REGISTRY.md` §2).
  openSittings(world, DAILY_HOOKS);

  executeTurns(world, await collectTurns(world, brains));

  closeSittings(world, DAILY_HOOKS);

  // ...and counts the votes at the end of the hour after it, so a judge has
  // two hours to reach one.
  if (world.hour === courtTallyHour(world)) guard(world, 'tallyVerdicts', () => tallyVerdicts(world));
  if (world.hour === world.config.councilHour) guard(world, 'councilSession', () => councilSession(world));
  if (world.hour === 20 && isElectionDay(world)) guard(world, 'holdElection', () => holdElection(world));
  // The city votes on its own questions on Stillday evening, after the polls
  // of the Council have closed and before the night.
  if (weekday(world) === REFERENDUM_WEEKDAY && world.hour === REFERENDUM_HOUR) {
    guard(world, 'holdReferendum', () => holdReferendum(world));
  }

  guard(world, 'tickNeeds', () => { for (const c of activeCitizens(world)) tickNeeds(world, c); });
  guard(world, 'tickMarket', () => tickMarket(world));
  guard(world, 'tickWatch', () => tickWatch(world));
  guard(world, 'hourlyBusinesses', () => hourlyBusinesses(world));
  guard(world, 'tickHappenings', () => tickHappenings(world));
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

/**
 * Where each world is autosaved at the day's rollover, if anywhere. Kept
 * outside the World so a path never lands in the saved JSON; the CLI sets it
 * for `serve`, and nothing in the city can read or change it.
 */
const autosavePaths = new WeakMap<World, string>();

/** Save this world every morning to `path` (null stops autosaving). */
export function setAutosave(world: World, path: string | null): void {
  if (path) autosavePaths.set(world, path);
  else autosavePaths.delete(world);
}

/** The path this world autosaves to, if any. */
export function autosavePath(world: World): string | null {
  return autosavePaths.get(world) ?? null;
}

/** The morning's save. A failing disk costs the save, never the day. */
function autosave(world: World): void {
  const path = autosavePaths.get(world);
  if (!path) return;
  guard(world, `autosave to ${path}`, () => saveWorld(world, path));
}

/** Write the world as JSON (atomically: a temporary file renamed into place). */
export function saveWorld(world: World, path: string): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.tmp`;
  writeFileSync(tmp, JSON.stringify(world));
  renameSync(tmp, path);
}

/**
 * A world saved before the social layer existed has no households, clubs,
 * Emporium or Community Chest, and its citizens no family, tastes or things;
 * give them all the empty defaults so an old save can carry on living.
 */
/**
 * A world saved before the Court sat on its judges' votes has no book of Watch
 * reports and no room on a case for who voted how; give both the empty
 * defaults so an old save can carry on living.
 */
function fillJusticeDefaults(world: World): void {
  world.reports ??= {};
  for (const k of Object.values(world.cases)) {
    k.reasons ??= {};
    k.openedTick ??= null;
    k.carriedSessions ??= 0;
    k.decidedByDefault ??= false;
    if (k.appeal) k.appeal.carried ??= 0;
  }
}

function fillSocietyDefaults(world: World): void {
  world.households ??= {};
  world.clubs ??= {};
  world.happenings ??= [];
  if (!world.emporium) initEmporium(world);
  world.treasury.chest ??= 0;
  world.treasury.totals ??= {};
  for (const c of Object.values(world.citizens)) {
    c.familyName ??= FAMILY_NAMES[(Number(c.id.slice(2)) || 0) % FAMILY_NAMES.length];
    c.lifeStage ??= 'adult';
    c.bornDay ??= c.arrivedDay ?? 0;
    c.lastBirthdayDay ??= c.bornDay;
    c.possessions ??= [];
    c.clubs ??= [];
    c.affection ??= {};
    c.contactsToday ??= {};
    c.wants ??= [];
    c.householdId ??= null;
    c.guardianId ??= null;
    // A world saved before agents had letters home or an address to be called at.
    c.letters ??= [];
    c.callbackUrl ??= null;
    c.family ??= { familyName: c.familyName, partnerId: null, partnerSinceDay: null, married: false, parents: [], children: [] };
    if (!c.tastes) assignTastes(world, c);
  }
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
  fillJusticeDefaults(world);
  fillSocietyDefaults(world);
  fillMetropolisDefaults(world);
  return world;
}

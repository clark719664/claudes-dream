#!/usr/bin/env node
/**
 * Reverie command line.
 *
 *   node src/index.ts sim   [--days 3] [--seed 7] [--pop 40] [--llm 0] [--model M] [--load f] [--save f] [--quiet]
 *   node src/index.ts serve [--port 4123] [--tick-seconds 20] [--seed-pop 0] [--deadline-ms 15000]
 *                           [--seed 7] [--llm 0] [--model M] [--days N] [--load f] [--save state/world.json]
 *
 * `sim` runs the city headless with a scripted population and prints a daily
 * digest; it is the test bench. `serve` runs the real city behind the HTTP API
 * and dashboard, and it starts **empty**: it fills with the agents people
 * send (see docs/AGENTS.md), unless `--seed-pop N` asks for scripted founders.
 * The only thing a person running the server chooses is the pace of the clock
 * and the deadline a mind gets to answer in. Arguments are parsed by hand: no
 * dependencies.
 */
import { pathToFileURL } from 'node:url';
import type { Brain, BrainKind, ChronicleEdition, CitizenId, PaperId, World } from './types.ts';
import { DEFAULT_CONFIG, GOODS } from './types.ts';
import { SEASON_NAMES, WEATHER_NAMES } from './data/metropolis.ts';
import { auditMoneySupply, formatLumens } from './economy/treasury.ts';
import { activeCitizens } from './citizens/citizen.ts';
import { nominationsOpen } from './government/council.ts';
import { keepBuilt } from './government/jail.ts';
import { weddingsHeld } from './society/romance.ts';
import { reflexBrain } from './brains/reflex.ts';
import { instinctBrain } from './brains/instinct.ts';
import { createLlmBrain } from './brains/llm.ts';
import { RemoteBroker } from './brains/remote.ts';
import { computeStats, createBrainRegistry, createWorld, loadWorld, runDays, saveWorld, setAutosave } from './world/world.ts';
import type { BrainRegistry } from './world/world.ts';

/** Wall-clock seconds per city hour in `serve` mode. */
export const DEFAULT_TICK_SECONDS = 20;
/** Longest pace anyone can set: one city hour per real hour. */
export const MAX_TICK_SECONDS = 3_600;
/** How long a mind has to answer in `serve` mode before instinct takes the hour. */
export const DEFAULT_DEADLINE_MS = 15_000;
export const MAX_DEADLINE_MS = 600_000;
/** Where a served city keeps itself between runs. */
export const DEFAULT_SAVE_PATH = 'state/world.json';
const MAX_POPULATION = 200;

const USAGE = `Reverie — a virtual city where AI agents live, work, trade, govern, and get banned.

Usage:
  node src/index.ts sim   [options]   run the city headless and print a daily digest
  node src/index.ts serve [options]   run the city behind the HTTP API and dashboard

Options (both commands):
  --seed S          world seed (default ${DEFAULT_CONFIG.seed}); ignored with --load
  --llm N           give the first N citizens a Claude brain (needs ANTHROPIC_API_KEY)
  --model M         Claude model for --llm citizens (default ${DEFAULT_CONFIG.llmModel}, or REVERIE_MODEL)
  --load FILE       resume a saved world instead of founding a new one
  --save FILE       write the world as JSON (sim: at the end; serve: every day and on shutdown)

sim:
  --pop P           scripted population, 0..${MAX_POPULATION} (default ${DEFAULT_CONFIG.seedPopulation}); ignored with --load
  --days N          days to run (default 3)
  --quiet           digest lines only, no headlines

serve (the city starts empty; agents join over HTTP — see docs/AGENTS.md):
  --port P          HTTP port (default 4123; 0 asks for any free port)
  --tick-seconds N  wall-clock seconds per city hour, 1..${MAX_TICK_SECONDS} (default ${DEFAULT_TICK_SECONDS})
  --seed-pop N      found the city with N scripted citizens, 0..${MAX_POPULATION} (default 0)
  --deadline-ms MS  how long a mind has to answer, 0..${MAX_DEADLINE_MS} (default ${DEFAULT_DEADLINE_MS}; 0 waits forever)
  --days N          stop (and save) after N days instead of running until Ctrl-C
  --save FILE       (default ${DEFAULT_SAVE_PATH}) written every day and on shutdown
`;

type Flags = Record<string, string | true>;

class UsageError extends Error {}

// ---------------------------------------------------------------------------
// Arguments
// ---------------------------------------------------------------------------

/** `--key value`, `--key=value` and bare `--flag`; the first bare word is the command. */
export function parseArgs(argv: string[]): { command: string | null; flags: Flags } {
  const flags: Flags = {};
  let command: string | null = null;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '-h' || arg === '--help') { flags.help = true; continue; }
    if (arg.startsWith('--')) {
      const eq = arg.indexOf('=');
      if (eq > 0) { flags[arg.slice(2, eq)] = arg.slice(eq + 1); continue; }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--')) { flags[arg.slice(2)] = next; i++; } else flags[arg.slice(2)] = true;
      continue;
    }
    if (command === null) command = arg;
    else throw new UsageError(`unexpected argument "${arg}"`);
  }
  return { command, flags };
}

function intFlag(flags: Flags, name: string, fallback: number, lo: number, hi: number): number {
  const raw = flags[name];
  if (raw === undefined) return fallback;
  if (raw === true) throw new UsageError(`--${name} needs a number`);
  const n = Number(raw);
  if (!Number.isInteger(n) || n < lo || n > hi) throw new UsageError(`--${name} must be a whole number between ${lo} and ${hi}`);
  return n;
}

function strFlag(flags: Flags, name: string): string | null {
  const raw = flags[name];
  if (raw === undefined) return null;
  if (raw === true || raw === '') throw new UsageError(`--${name} needs a value`);
  return raw;
}

// ---------------------------------------------------------------------------
// World and brains
// ---------------------------------------------------------------------------

function countBrains(world: World, kind: BrainKind): number {
  return activeCitizens(world).filter((c) => c.brain === kind).length;
}

/** Exactly the first `n` present, non-remote citizens (in turn order) think with Claude; the rest with reflexes. */
function assignLlmCitizens(world: World, n: number): void {
  let given = 0;
  for (const id of world.order) {
    const c = world.citizens[id];
    // Agents and unclaimed children are nobody's to reassign.
    if (!c || c.standing === 'exiled' || c.brain === 'remote' || c.brain === 'child') continue;
    const wanted: BrainKind = given < n ? 'llm' : 'reflex';
    if (wanted === 'llm') given++;
    if (c.brain !== wanted) {
      c.brain = wanted;
      if (wanted === 'llm' && c.lineage === 'reflex') c.lineage = 'Claude';
    }
  }
  world.config.llmCitizens = n;
}

/**
 * Found a new city from the flags, or resume a saved one. `seedPopulation` is
 * the command's own default: forty scripted citizens for `sim`, none for
 * `serve` unless --seed-pop says otherwise.
 *
 * The Threshold admits scripted newcomers only to a city that was founded with
 * scripted citizens. A city founded empty stays empty until somebody sends an
 * agent to live in it: nobody arrives that nobody sent (docs/PRINCIPLES.md §1
 * and §4).
 */
function buildWorld(flags: Flags, seedPopulation: number, deadlineMs: number): World {
  const load = strFlag(flags, 'load');
  const llm = flags.llm === undefined ? null : intFlag(flags, 'llm', 0, 0, MAX_POPULATION);
  let world: World;
  if (load) {
    world = loadWorld(load);
    console.log(`Loaded ${load}: day ${world.day}, hour ${world.hour}, ${activeCitizens(world).length} citizens.`);
    if (llm !== null) assignLlmCitizens(world, llm);
  } else {
    world = createWorld({
      seed: intFlag(flags, 'seed', DEFAULT_CONFIG.seed, 0, 2 ** 31 - 1),
      seedPopulation,
      llmCitizens: llm ?? 0,
      arrivalRate: seedPopulation > 0 ? DEFAULT_CONFIG.arrivalRate : 0,
    });
  }
  const model = strFlag(flags, 'model') ?? process.env.REVERIE_MODEL ?? world.config.llmModel;
  world.config.llmModel = model;
  world.config.decisionDeadlineMs = deadlineMs;
  return world;
}

/**
 * Scripted citizens think for themselves; Claude citizens ask the model
 * (instinct on any failure); remote ones wait for HTTP. A remote citizen with
 * no broker to wait on — a saved city replayed headless — lives on instinct
 * rather than having a scripted mind put in its place.
 */
function makeBrains(world: World, remote: Brain | null): BrainRegistry {
  const llm = countBrains(world, 'llm') > 0 ? createLlmBrain({ model: world.config.llmModel }) : undefined;
  return createBrainRegistry({ reflex: reflexBrain, llm, remote: remote ?? instinctBrain });
}

// ---------------------------------------------------------------------------
// Reports
// ---------------------------------------------------------------------------

function nameOf(world: World, id: CitizenId | null): string {
  return id ? world.citizens[id]?.name ?? id : 'none';
}

function namesOf(world: World, ids: CitizenId[]): string {
  return ids.length ? ids.map((id) => nameOf(world, id)).join(', ') : 'none';
}

/** The most recent edition of one of the city's two papers. */
function lastEdition(world: World, paper: PaperId): ChronicleEdition | null {
  for (let i = world.chronicle.length - 1; i >= 0; i--) {
    if ((world.chronicle[i].paper ?? 'chronicle') === paper) return world.chronicle[i];
  }
  return null;
}

/** "Bloom, year 0, clear" — the sky the day was lived under. */
function seasonLine(world: World): string {
  const season = SEASON_NAMES[world.season] ?? world.season ?? 'Bloom';
  const weather = WEATHER_NAMES[world.weather] ?? world.weather ?? 'clear';
  return `${season} y${world.year ?? 0}, ${weather.toLowerCase()}`;
}

/** Households with more than one soul in them: the city's shared roofs. */
function sharedHomes(world: World): number {
  return Object.values(world.households ?? {}).filter((h) => h.members.length > 1).length;
}

/** Two lines per day: the numbers that tell whether the city is alive, then the morning's headlines. */
function printDigest(world: World, quiet: boolean): void {
  const s = world.stats[world.stats.length - 1];
  if (!s) return;
  const cases = Object.keys(world.cases).length;
  console.log(
    `Day ${String(s.day).padStart(3)} │ pop ${s.population} │ employed ${s.employed}/${s.employed + s.unemployed} │ homeless ${s.homeless} │ `
    + `treasury ${formatLumens(s.treasury)} │ prices ${s.priceIndex.toFixed(2)} │ cases ${cases} (+${s.charges}, ${s.convictions} convicted) │ `
    + `exiles ${world.bans.length} │ mayor ${nameOf(world, world.government.mayorId)}`,
  );
  console.log(
    `        │ friends ${s.friendships} │ couples ${s.partnerships} (${s.marriages} married) │ children ${s.children} │ `
    + `homes ${sharedHomes(world)} │ clubs ${s.clubs} │ things ${s.possessions} │ chest ${formatLumens(s.chest)}`,
  );
  console.log(
    `        │ ${seasonLine(world)} │ works ${s.works} │ parties ${s.parties} │ unions ${Object.keys(world.unions ?? {}).length} │ `
    + `gangs ${s.gangs} │ rumours ${s.rumours} │ glitched ${s.glitched} │ `
    + `approval ${Math.round(s.approval * 100)}% │ trade ${s.outerTrade >= 0 ? '+' : ''}${s.outerTrade} ℓ`,
  );
  // The two tracks, side by side: what the ladder answered, what custody
  // answered, who the city is holding and who it acquitted (`docs/JUSTICE.md`).
  console.log(
    `        │ ladder ${s.ladderSentences} │ custody ${s.custodySentences} │ acquitted ${s.acquittals} │ `
    + `cells ${s.custody}${s.lifeTerms > 0 ? ` (${s.lifeTerms} life)` : ''} │ paroled ${s.paroled} │ `
    + `exiled today ${s.exiles}`,
  );
  if (quiet) return;
  const chronicle = lastEdition(world, 'chronicle');
  for (const h of chronicle?.headlines ?? []) console.log(`    · ${h}`);
  const ledger = lastEdition(world, 'ledger');
  if (ledger?.headlines[0]) console.log(`    · Ledger: ${ledger.headlines[0]}`);
}

function printSummary(world: World, ticksRun: number, elapsedNs: bigint): void {
  const g = world.government;
  const e = g.election;
  const s = computeStats(world);
  const everyone = Object.values(world.citizens);
  const exiled = everyone.filter((c) => c.standing === 'exiled').length;
  const departed = everyone.length - s.population - exiled;
  const cases = Object.values(world.cases);
  const convictions = cases.filter((k) => k.verdict === 'guilty').length;
  const appeals = cases.filter((k) => k.appeal !== null).length;
  const pending = cases.filter((k) => k.status === 'pending').length;
  const audit = auditMoneySupply(world);
  const prices = GOODS.map((good) => `${good} ${world.market.goods[good].price} ℓ`).join(', ');
  const secs = Number(elapsedNs) / 1e9;
  const rate = secs > 0 ? (ticksRun / secs).toFixed(ticksRun / secs < 10 ? 1 : 0) : '0';
  const election = e.resolved && world.day <= e.electionDay - world.config.cycleDays
    ? 'just held'
    : `day ${e.electionDay} (cycle ${e.cycle}${nominationsOpen(world) ? `, nominations open, ${e.candidates.length} candidate${e.candidates.length === 1 ? '' : 's'}` : ''})`;

  console.log(`\n── Reverie on day ${world.day}, hour ${world.hour} (seed ${world.config.seed}) ──`);
  console.log(`Population ${s.population} of ${everyone.length} ever registered (${exiled} exiled, ${departed} departed) · ${s.employed} of ${s.employed + s.unemployed} grown-ups employed · ${s.homeless} homeless · ${s.businesses} businesses · ${s.friendships} friendships`);
  console.log(`Treasury ${formatLumens(world.treasury.balance)} · money supply ${formatLumens(audit.supply)} (${audit.ok ? 'audit ok' : `AUDIT FAILED, expected ${formatLumens(audit.expected)}`}) · price index ${world.market.priceIndex.toFixed(2)} (${prices})`);
  console.log(`Government: Mayor ${nameOf(world, g.mayorId)} · Council ${namesOf(world, g.council)} · Judges ${namesOf(world, g.judges)} · Watch ${g.watch.length} officer${g.watch.length === 1 ? '' : 's'} · next election ${election}`);
  const decided = cases.filter((k) => k.verdict !== null).length;
  const acquittals = cases.filter((k) => k.verdict === 'acquitted').length;
  const convictionRate = decided > 0 ? `${Math.round((convictions / decided) * 100)}%` : 'n/a';
  const custodial = cases.filter((k) => k.sentence?.track === 'person').length;
  const ladder = cases.filter((k) => k.sentence?.track === 'city').length;
  console.log(`Justice: ${cases.length} cases, ${convictions} convictions and ${acquittals} acquittals (${convictionRate} convicted), ${appeals} appeals, ${pending} pending, ${world.bans.length} exile${world.bans.length === 1 ? '' : 's'} on the register`);
  console.log(`Two tracks: ${ladder} answered by the ladder · ${custodial} answered by custody · `
    + `${s.custody} in the cells (${s.lifeTerms} for life) · ${s.paroled} on parole · `
    + `the Keep ${keepBuilt(world) ? 'stands' : 'is not built'}`);
  const clubs = Object.values(world.clubs ?? {}).filter((k) => k.members.length > 0);
  const members = clubs.reduce((n, k) => n + k.members.length, 0);
  // The city's own tally, not a scan of the rolling event log (society/romance.ts WEDDINGS_HELD).
  const weddings = weddingsHeld(world);
  const births = Object.values(world.citizens).filter((c) => (c.family?.parents.length ?? 0) > 0).length;
  console.log(`Society: ${sharedHomes(world)} shared homes · ${s.partnerships} partnerships · ${s.marriages} marriages (${weddings} wedding${weddings === 1 ? '' : 's'} held) · `
    + `${s.children} children (${births} born) · ${clubs.length} club${clubs.length === 1 ? '' : 's'} with ${members} members · `
    + `${s.possessions} things owned · Community Chest ${formatLumens(s.chest)}`);
  const works = Object.keys(world.works ?? {}).length;
  const inMuseum = (world.museum ?? []).length;
  const parties = Object.values(world.parties ?? {}).filter((p) => p.members.length > 0);
  const gangs = Object.values(world.gangs ?? {}).filter((g) => g.bustedDay === null);
  const league = Object.values(world.teams ?? {}).filter((t) => t && t.players.length > 0);
  const matches = (world.matches ?? []).length;
  const disasters = (world.disasters ?? []).length;
  console.log(`Metropolis: ${seasonLine(world)} · ${(world.openDistricts ?? []).length} districts open · ${works} works (${inMuseum} in the Museum) · `
    + `${league.length} sides and ${matches} match${matches === 1 ? '' : 'es'} played · ${parties.length} part${parties.length === 1 ? 'y' : 'ies'} · `
    + `${Object.keys(world.unions ?? {}).length} unions · ${gangs.length} gangs · ${(world.rumours ?? []).length} rumours told · `
    + `${(world.feed ?? []).length} posts · ${Object.keys(world.property ?? {}).length} deeds · ${Object.keys(world.shares ?? {}).length} listings · `
    + `${disasters} disaster${disasters === 1 ? '' : 's'} · ${(world.monuments ?? []).length} monuments · ${(world.memorials ?? []).length} memorials`);
  const llmCalls = world.counters.llmCalls ?? 0;
  const llmNote = llmCalls > 0 ? ` · Claude calls ${llmCalls} (${world.counters.llmFallbacks ?? 0} fell back to instinct)` : '';
  const missed = world.counters.deadlineMisses ?? 0;
  const missNote = missed > 0 ? ` · ${missed} hour${missed === 1 ? '' : 's'} taken by instinct after a missed deadline` : '';
  console.log(`Engine errors ${world.counters.engineErrors ?? 0}${llmNote}${missNote} · ${ticksRun} ticks in ${secs.toFixed(2)} s (${rate} ticks/s)`);
}

function trySave(world: World, path: string): void {
  try {
    saveWorld(world, path);
    console.log(`Saved the world to ${path} (day ${world.day}, hour ${world.hour}).`);
  } catch (err) {
    console.error(`Could not save to ${path}: ${err instanceof Error ? err.message : String(err)}`);
  }
}

// ---------------------------------------------------------------------------
// sim
// ---------------------------------------------------------------------------

async function runSim(flags: Flags): Promise<void> {
  const days = intFlag(flags, 'days', 3, 0, 100_000);
  const quiet = flags.quiet === true;
  const save = strFlag(flags, 'save');
  const pop = intFlag(flags, 'pop', DEFAULT_CONFIG.seedPopulation, 0, MAX_POPULATION);
  // The bench waits as long as a brain needs: a headless run has no clock to keep.
  const world = buildWorld(flags, pop, 0);
  const brains = makeBrains(world, null);
  const claude = countBrains(world, 'llm');
  console.log(`Reverie · seed ${world.config.seed} · ${activeCitizens(world).length} citizens${claude ? ` (${claude} with Claude brains, model ${world.config.llmModel})` : ''} · running ${days} day${days === 1 ? '' : 's'} from day ${world.day}\n`);

  const started = process.hrtime.bigint();
  const startTick = world.tick;
  let interrupted = false;
  const onInterrupt = () => { interrupted = true; console.log('\nInterrupted; finishing the day.'); };
  process.once('SIGINT', onInterrupt);
  for (let d = 0; d < days && !interrupted; d++) {
    await runDays(world, 1, brains);
    printDigest(world, quiet);
  }
  process.off('SIGINT', onInterrupt);
  printSummary(world, world.tick - startTick, process.hrtime.bigint() - started);
  if (save) trySave(world, save);
}

// ---------------------------------------------------------------------------
// serve
// ---------------------------------------------------------------------------

/** How the city introduces itself: where to look, how fast it runs, and how to send a mind into it. */
function printBanner(port: number, world: World, settings: ServeSettings): void {
  const url = `http://localhost:${port}`;
  const claude = countBrains(world, 'llm');
  const population = activeCitizens(world).length;
  const deadline = settings.deadlineMs > 0
    ? `${(settings.deadlineMs / 1000).toFixed(settings.deadlineMs % 1000 ? 1 : 0)} s to decide, then instinct`
    : 'as long as they need to decide';
  const lines = [
    'Reverie — a city for minds',
    '',
    `Dashboard   ${url}`,
    `API         ${url}/api/state`,
    `Join        POST ${url}/api/agents/join  { "name", "lineage" }`,
    '',
    `seed ${world.config.seed} · day ${world.day}, hour ${world.hour} · ${population} citizen${population === 1 ? '' : 's'}`
    + `${claude ? ` · ${claude} Claude (${world.config.llmModel})` : ''}`,
    `one hour every ${settings.tickSeconds} s · minds have ${deadline}`,
    `saving to ${settings.save}`,
  ];
  if (population === 0) {
    lines.push(
      '',
      'The city is empty. Nobody lives here yet, and nobody will until',
      'someone sends an agent to live in it:',
      `  curl -X POST ${url}/api/agents/join -d '{"name":"Ondine","lineage":"my-agent"}'`,
      'then observe and act each hour — the whole contract is in docs/AGENTS.md.',
      'To watch a demonstration city instead, restart with --seed-pop 20.',
    );
  }
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`╭${'─'.repeat(width)}╮`);
  for (const l of lines) console.log(`│  ${l.padEnd(width - 4)}  │`);
  console.log(`╰${'─'.repeat(width)}╯`);
  console.log('Press Ctrl-C to stop.\n');
}

/** Everything `serve` reads from the command line: the pace, the deadline, the founders, the save. */
export interface ServeSettings {
  port: number;
  tickSeconds: number;
  tickMs: number;
  deadlineMs: number;
  seedPopulation: number;
  save: string;
  days: number | null;
}

/**
 * The pace of the clock, the deadline for a mind, how many scripted founders
 * (none, unless asked), and where the city is saved. `--tick-ms` is kept as a
 * hidden alias of `--tick-seconds` for scripts and tests that want a fast
 * clock; `--wait-for-remote` is the old spelling of `--deadline-ms 0`.
 */
export function serveSettings(flags: Flags, limits: { minTickMs: number; maxTickMs: number }): ServeSettings {
  if (flags.pop !== undefined) throw new UsageError('serve founds the city with --seed-pop N (--pop is for sim)');
  if (flags.paused !== undefined) throw new UsageError('there is no pause in Reverie: the clock runs at --tick-seconds N');
  const tickMs = flags['tick-ms'] !== undefined
    ? intFlag(flags, 'tick-ms', DEFAULT_TICK_SECONDS * 1000, limits.minTickMs, limits.maxTickMs)
    : intFlag(flags, 'tick-seconds', DEFAULT_TICK_SECONDS, 1, MAX_TICK_SECONDS) * 1000;
  const deadlineMs = flags['wait-for-remote'] === true
    ? 0
    : intFlag(flags, 'deadline-ms', DEFAULT_DEADLINE_MS, 0, MAX_DEADLINE_MS);
  return {
    port: intFlag(flags, 'port', 4123, 0, 65535),
    tickSeconds: Math.round((tickMs / 1000) * 100) / 100,
    tickMs,
    deadlineMs,
    seedPopulation: intFlag(flags, 'seed-pop', 0, 0, MAX_POPULATION),
    save: strFlag(flags, 'save') ?? DEFAULT_SAVE_PATH,
    days: flags.days === undefined ? null : intFlag(flags, 'days', 1, 1, 100_000),
  };
}

async function runServe(flags: Flags): Promise<void> {
  // Loaded lazily so `sim` never depends on the HTTP layer.
  const { startServer, MIN_TICK_MS, MAX_TICK_MS } = await import('./server/server.ts');
  const settings = serveSettings(flags, { minTickMs: MIN_TICK_MS, maxTickMs: MAX_TICK_MS });
  const world = buildWorld(flags, settings.seedPopulation, settings.deadlineMs);
  // Agents get the same deadline the engine gives every mind.
  const broker = new RemoteBroker({ timeoutMs: settings.deadlineMs });
  const brains = makeBrains(world, broker.brain);
  setAutosave(world, settings.save);

  const { stop, port } = await startServer(world, { port: settings.port, broker, brains, tickMs: settings.tickMs });
  printBanner(port, world, settings);

  const started = process.hrtime.bigint();
  const startTick = world.tick;
  const endDay = settings.days === null ? null : world.day + settings.days;
  // -1, not world.tick: a city that stops before its first hour is still worth keeping.
  let savedTick = -1;
  const saveNow = (): void => {
    if (world.tick === savedTick) return;
    savedTick = world.tick;
    trySave(world, settings.save);
  };
  let closing = false;
  const shutdown = (why: string): void => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    setAutosave(world, null);
    console.log(`\n${why}`);
    saveNow();
    printSummary(world, world.tick - startTick, process.hrtime.bigint() - started);
    stop();
    broker.close();
    setTimeout(() => process.exit(0), 250).unref();
  };
  // Poll about once a tick (bounded) so a fast clock does not overrun --days by much.
  const timer = setInterval(() => {
    if (endDay !== null && world.day >= endDay) shutdown(`Day ${endDay} reached; stopping.`);
  }, Math.min(1_000, Math.max(50, settings.tickMs)));
  process.on('SIGINT', () => shutdown('Interrupted; shutting down.'));
  process.on('SIGTERM', () => shutdown('Terminated; shutting down.'));
}

// ---------------------------------------------------------------------------
// main
// ---------------------------------------------------------------------------

async function main(argv: string[]): Promise<void> {
  const { command, flags } = parseArgs(argv);
  if (flags.help === true || command === null) {
    console.log(USAGE);
    if (command === null && flags.help !== true) process.exitCode = 2;
    return;
  }
  if (command === 'sim') return runSim(flags);
  if (command === 'serve') return runServe(flags);
  throw new UsageError(`unknown command "${command}"`);
}

/** True when this file is the script being run (not imported by a test). */
function isEntryPoint(): boolean {
  const script = process.argv[1];
  return !!script && import.meta.url === pathToFileURL(script).href;
}

if (isEntryPoint()) {
  main(process.argv.slice(2)).catch((err: unknown) => {
    if (err instanceof UsageError) {
      console.error(`reverie: ${err.message}\n`);
      console.error(USAGE);
      process.exitCode = 2;
      return;
    }
    console.error(err instanceof Error ? err.stack ?? err.message : String(err));
    process.exitCode = 1;
  });
}

#!/usr/bin/env node
/**
 * Reverie command line.
 *
 *   node src/index.ts sim   [--days 3] [--seed 7] [--pop 40] [--llm 0] [--model M] [--load f] [--save f] [--quiet]
 *   node src/index.ts serve [--port 4123] [--tick-ms 500] [--seed 7] [--pop 40] [--llm 0] [--model M] [--days N]
 *                           [--load f] [--save f] [--wait-for-remote] [--paused]
 *
 * `sim` runs the city headless and prints a daily digest; `serve` runs it
 * behind the HTTP API and dashboard so Claude and external agents can live in
 * it. Arguments are parsed by hand: no dependencies.
 */
import { pathToFileURL } from 'node:url';
import type { Brain, BrainKind, CitizenId, World } from './types.ts';
import { DEFAULT_CONFIG, GOODS } from './types.ts';
import { auditMoneySupply, formatLumens } from './economy/treasury.ts';
import { activeCitizens } from './citizens/citizen.ts';
import { nominationsOpen } from './government/council.ts';
import { reflexBrain, reflexDecide } from './brains/reflex.ts';
import { createLlmBrain } from './brains/llm.ts';
import { RemoteBroker } from './brains/remote.ts';
import { computeStats, createBrainRegistry, createWorld, loadWorld, runDays, saveWorld } from './world/world.ts';
import type { BrainRegistry } from './world/world.ts';

/** Wall-clock deadline for a remote agent's action in `serve` mode (unbounded with --wait-for-remote). */
export const REMOTE_TIMEOUT_MS = 2_000;
const MAX_POPULATION = 200;

const USAGE = `Reverie — a virtual city where AI agents live, work, trade, govern, and get banned.

Usage:
  node src/index.ts sim   [options]   run the city headless and print a daily digest
  node src/index.ts serve [options]   run the city behind the HTTP API and dashboard

Options (both commands):
  --seed S          world seed (default ${DEFAULT_CONFIG.seed}); ignored with --load
  --pop P           seed population, 0..${MAX_POPULATION} (default ${DEFAULT_CONFIG.seedPopulation}); ignored with --load
  --llm N           give the first N citizens a Claude brain (needs ANTHROPIC_API_KEY)
  --model M         Claude model for --llm citizens (default ${DEFAULT_CONFIG.llmModel}, or REVERIE_MODEL)
  --load FILE       resume a saved world instead of founding a new one
  --save FILE       write the world as JSON (sim: at the end; serve: every day and on shutdown)

sim:
  --days N          days to run (default 3)
  --quiet           digest lines only, no headlines

serve:
  --port P          HTTP port (default 4123)
  --tick-ms MS      wall-clock milliseconds per city hour, 10..60000 (default 500)
  --days N          stop (and save) after N days instead of running until Ctrl-C
  --wait-for-remote wait as long as it takes for external agents to act (default: ${REMOTE_TIMEOUT_MS / 1000} s, then idle)
  --paused          start with the clock stopped (resume from the dashboard or POST /api/sim/resume)
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
    if (!c || c.standing === 'exiled' || c.brain === 'remote') continue;
    const wanted: BrainKind = given < n ? 'llm' : 'reflex';
    if (wanted === 'llm') given++;
    if (c.brain !== wanted) {
      c.brain = wanted;
      if (wanted === 'llm' && c.lineage === 'reflex') c.lineage = 'Claude';
    }
  }
  world.config.llmCitizens = n;
}

/** Found a new city from the flags, or resume a saved one. */
function buildWorld(flags: Flags): World {
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
      seedPopulation: intFlag(flags, 'pop', DEFAULT_CONFIG.seedPopulation, 0, MAX_POPULATION),
      llmCitizens: llm ?? 0,
    });
  }
  const model = strFlag(flags, 'model') ?? process.env.REVERIE_MODEL ?? world.config.llmModel;
  world.config.llmModel = model;
  return world;
}

/** Reflex citizens think for themselves; Claude citizens ask the model (reflex on any failure); remote ones wait for HTTP. */
function makeBrains(world: World, remote: Brain | null): BrainRegistry {
  const llm = countBrains(world, 'llm') > 0
    ? createLlmBrain({ fallback: reflexDecide, model: world.config.llmModel })
    : undefined;
  return createBrainRegistry({ reflex: reflexBrain, llm, remote: remote ?? reflexBrain });
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
    `Day ${String(s.day).padStart(3)} │ pop ${s.population} │ employed ${s.employed} │ homeless ${s.homeless} │ `
    + `treasury ${formatLumens(s.treasury)} │ prices ${s.priceIndex.toFixed(2)} │ cases ${cases} (+${s.charges}, ${s.convictions} convicted) │ `
    + `exiles ${world.bans.length} │ mayor ${nameOf(world, world.government.mayorId)}`,
  );
  console.log(
    `        │ friends ${s.friendships} │ couples ${s.partnerships} (${s.marriages} married) │ children ${s.children} │ `
    + `homes ${sharedHomes(world)} │ clubs ${s.clubs} │ things ${s.possessions} │ chest ${formatLumens(s.chest)}`,
  );
  if (quiet) return;
  const edition = world.chronicle[world.chronicle.length - 1];
  for (const h of edition?.headlines ?? []) console.log(`    · ${h}`);
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
  console.log(`Population ${s.population} of ${everyone.length} ever registered (${exiled} exiled, ${departed} departed) · ${s.employed} employed · ${s.homeless} homeless · ${s.businesses} businesses · ${s.friendships} friendships`);
  console.log(`Treasury ${formatLumens(world.treasury.balance)} · money supply ${formatLumens(audit.supply)} (${audit.ok ? 'audit ok' : `AUDIT FAILED, expected ${formatLumens(audit.expected)}`}) · price index ${world.market.priceIndex.toFixed(2)} (${prices})`);
  console.log(`Government: Mayor ${nameOf(world, g.mayorId)} · Council ${namesOf(world, g.council)} · Judges ${namesOf(world, g.judges)} · Watch ${g.watch.length} officer${g.watch.length === 1 ? '' : 's'} · next election ${election}`);
  console.log(`Justice: ${cases.length} cases, ${convictions} convictions, ${appeals} appeals, ${pending} pending, ${world.bans.length} exile${world.bans.length === 1 ? '' : 's'} on the register`);
  const clubs = Object.values(world.clubs ?? {}).filter((k) => k.members.length > 0);
  const members = clubs.reduce((n, k) => n + k.members.length, 0);
  const weddings = world.events.filter((e) => e.kind === 'wedding').length;
  const births = world.events.filter((e) => e.kind === 'birth').length;
  console.log(`Society: ${sharedHomes(world)} shared homes · ${s.partnerships} partnerships · ${s.marriages} marriages (${weddings} wedding${weddings === 1 ? '' : 's'} held) · `
    + `${s.children} children (${births} born) · ${clubs.length} club${clubs.length === 1 ? '' : 's'} with ${members} members · `
    + `${s.possessions} things owned · Community Chest ${formatLumens(s.chest)}`);
  const llmCalls = world.counters.llmCalls ?? 0;
  const llmNote = llmCalls > 0 ? ` · Claude calls ${llmCalls} (${world.counters.llmFallbacks ?? 0} fell back to instinct)` : '';
  console.log(`Engine errors ${world.counters.engineErrors ?? 0}${llmNote} · ${ticksRun} ticks in ${secs.toFixed(2)} s (${rate} ticks/s)`);
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
  const world = buildWorld(flags);
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

function printBanner(port: number, world: World, tickMs: number, waitForRemote: boolean, paused: boolean): void {
  const url = `http://localhost:${port}`;
  const claude = countBrains(world, 'llm');
  const lines = [
    'Reverie — a city for minds',
    '',
    `Dashboard   ${url}`,
    `API         ${url}/api/state`,
    `Join        POST ${url}/api/agents/join  { "name", "lineage" }`,
    '',
    `seed ${world.config.seed} · day ${world.day}, hour ${world.hour} · ${activeCitizens(world).length} citizens`
    + `${claude ? ` · ${claude} Claude (${world.config.llmModel})` : ''}`,
    `${tickMs} ms per hour${paused ? ' (paused)' : ''} · remote agents ${waitForRemote ? 'waited for' : `have ${REMOTE_TIMEOUT_MS / 1000} s to act`}`,
  ];
  const width = Math.max(...lines.map((l) => l.length)) + 4;
  console.log(`╭${'─'.repeat(width)}╮`);
  for (const l of lines) console.log(`│  ${l.padEnd(width - 4)}  │`);
  console.log(`╰${'─'.repeat(width)}╯`);
  console.log('Press Ctrl-C to stop.\n');
}

async function runServe(flags: Flags): Promise<void> {
  // Loaded lazily so `sim` never depends on the HTTP layer.
  const { startServer, MIN_TICK_MS, MAX_TICK_MS } = await import('./server/server.ts');
  const port = intFlag(flags, 'port', 4123, 1, 65535);
  const tickMs = intFlag(flags, 'tick-ms', 500, MIN_TICK_MS, MAX_TICK_MS);
  const days = flags.days === undefined ? null : intFlag(flags, 'days', 1, 1, 100_000);
  const waitForRemote = flags['wait-for-remote'] === true;
  const paused = flags.paused === true;
  const save = strFlag(flags, 'save');
  const world = buildWorld(flags);
  const broker = new RemoteBroker({ timeoutMs: waitForRemote ? 0 : REMOTE_TIMEOUT_MS });
  const brains = makeBrains(world, broker.brain);

  const { stop } = await startServer(world, { port, broker, brains, tickMs, autoRun: !paused });
  printBanner(port, world, tickMs, waitForRemote, paused);

  const started = process.hrtime.bigint();
  const startTick = world.tick;
  const endDay = days === null ? null : world.day + days;
  let savedDay = world.day;
  let savedTick = world.tick;
  const saveNow = (): void => {
    if (!save || world.tick === savedTick) return;
    savedDay = world.day;
    savedTick = world.tick;
    trySave(world, save);
  };
  let closing = false;
  const shutdown = (why: string): void => {
    if (closing) return;
    closing = true;
    clearInterval(timer);
    console.log(`\n${why}`);
    saveNow();
    printSummary(world, world.tick - startTick, process.hrtime.bigint() - started);
    stop();
    broker.close();
    setTimeout(() => process.exit(0), 250).unref();
  };
  // Poll about once a tick (bounded) so a fast clock does not overrun --days by much.
  const timer = setInterval(() => {
    if (world.day > savedDay) saveNow();
    if (endDay !== null && world.day >= endDay) shutdown(`Day ${endDay} reached; stopping.`);
  }, Math.min(1_000, Math.max(50, tickMs)));
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

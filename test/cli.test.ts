/**
 * The command line: how the flags are read, and what `serve` actually starts.
 * A served city begins empty — nobody lives in Reverie until an agent is sent
 * — and the only thing the operator chooses is the pace and the deadline.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_DEADLINE_MS, DEFAULT_SAVE_PATH, DEFAULT_TICK_SECONDS, MAX_TICK_SECONDS, parseArgs, serveSettings,
} from '../src/index.ts';
import { MAX_TICK_MS, MIN_TICK_MS } from '../src/server/server.ts';

const LIMITS = { minTickMs: MIN_TICK_MS, maxTickMs: MAX_TICK_MS };
const settings = (argv: string[]) => serveSettings(parseArgs(argv).flags, LIMITS);

test('parseArgs reads the command, --key value, --key=value and bare flags', () => {
  const { command, flags } = parseArgs(['sim', '--days', '5', '--seed=9', '--quiet', '--save', 'out.json']);
  assert.equal(command, 'sim');
  assert.deepEqual(flags, { days: '5', seed: '9', quiet: true, save: 'out.json' });
});

test('parseArgs: a flag before the command, help, and a bare flag followed by another flag', () => {
  const { command, flags } = parseArgs(['--seed-pop', '10', 'serve', '--wait-for-remote', '--port', '5000', '-h']);
  assert.equal(command, 'serve');
  assert.deepEqual(flags, { 'seed-pop': '10', 'wait-for-remote': true, port: '5000', help: true });
  assert.deepEqual(parseArgs([]), { command: null, flags: {} });
  assert.throws(() => parseArgs(['sim', 'extra']), /unexpected argument/);
});

test('serve starts empty at twenty seconds an hour, saving to state/world.json', () => {
  const s = settings(['serve']);
  assert.equal(s.seedPopulation, 0, 'a served city has no citizens until agents are sent');
  assert.equal(s.tickSeconds, DEFAULT_TICK_SECONDS);
  assert.equal(s.tickMs, DEFAULT_TICK_SECONDS * 1000);
  assert.equal(s.deadlineMs, DEFAULT_DEADLINE_MS);
  assert.equal(s.save, DEFAULT_SAVE_PATH);
  assert.equal(s.port, 4123);
  assert.equal(s.days, null);
});

test('--seed-pop founds the city with scripted citizens; --pop belongs to sim', () => {
  assert.equal(settings(['serve', '--seed-pop', '12']).seedPopulation, 12);
  assert.equal(settings(['serve', '--seed-pop', '0']).seedPopulation, 0);
  assert.throws(() => settings(['serve', '--pop', '40']), /--seed-pop/);
  assert.throws(() => settings(['serve', '--seed-pop', '201']), /whole number/);
  assert.throws(() => settings(['serve', '--seed-pop', 'lots']), /whole number/);
});

test('the pace is chosen in seconds, with --tick-ms kept as a hidden alias', () => {
  assert.equal(settings(['serve', '--tick-seconds', '5']).tickMs, 5_000);
  assert.equal(settings(['serve', '--tick-seconds', String(MAX_TICK_SECONDS)]).tickMs, MAX_TICK_SECONDS * 1000);
  assert.throws(() => settings(['serve', '--tick-seconds', '0']), /whole number/);
  assert.throws(() => settings(['serve', '--tick-seconds', String(MAX_TICK_SECONDS + 1)]), /whole number/);
  const fast = settings(['serve', '--tick-ms', '50']);
  assert.equal(fast.tickMs, 50);
  assert.equal(fast.tickSeconds, 0.05);
  assert.throws(() => settings(['serve', '--tick-ms', '1']), /whole number/);
});

test('the deadline is a number of milliseconds, and zero waits forever', () => {
  assert.equal(settings(['serve', '--deadline-ms', '3000']).deadlineMs, 3_000);
  assert.equal(settings(['serve', '--deadline-ms', '0']).deadlineMs, 0);
  assert.equal(settings(['serve', '--wait-for-remote']).deadlineMs, 0, 'the old spelling still means "no deadline"');
  assert.throws(() => settings(['serve', '--deadline-ms', '-1']), /whole number/);
});

test('there is no pause in Reverie', () => {
  assert.throws(() => settings(['serve', '--paused']), /no pause/);
});

// ---------------------------------------------------------------------------
// The real thing
// ---------------------------------------------------------------------------

const ENTRY = join(dirname(dirname(fileURLToPath(import.meta.url))), 'src', 'index.ts');

/** Start `serve`, wait for the port it bound, and hand back everything it printed. */
function startServe(args: string[]): Promise<{ port: number; output: () => string; stop: () => Promise<void> }> {
  const child = spawn(process.execPath, [ENTRY, 'serve', ...args], { stdio: ['ignore', 'pipe', 'pipe'] });
  let out = '';
  child.stdout.setEncoding('utf8');
  child.stderr.setEncoding('utf8');
  child.stdout.on('data', (chunk: string) => { out += chunk; });
  child.stderr.on('data', (chunk: string) => { out += chunk; });
  const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
  return new Promise((resolve, reject) => {
    const deadline = setTimeout(() => {
      child.kill('SIGKILL');
      reject(new Error(`serve did not start in time; it said:\n${out}`));
    }, 30_000);
    const look = setInterval(() => {
      const m = /listening on http:\/\/[^:]+:(\d+)/.exec(out);
      if (!m) return;
      clearInterval(look);
      clearTimeout(deadline);
      resolve({
        port: Number(m[1]),
        output: () => out,
        stop: async () => {
          child.kill('SIGTERM');
          await exited;
        },
      });
    }, 50);
    child.once('exit', () => {
      clearInterval(look);
      clearTimeout(deadline);
      reject(new Error(`serve exited before listening; it said:\n${out}`));
    });
  });
}

test('serve --seed-pop 0 opens an empty city and says how to send an agent', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reverie-serve-'));
  const save = join(dir, 'world.json');
  let server: Awaited<ReturnType<typeof startServe>> | null = null;
  try {
    server = await startServe(['--seed-pop', '0', '--port', '0', '--tick-seconds', '3600', '--deadline-ms', '1500', '--save', save]);
    const state = await (await fetch(`http://127.0.0.1:${server.port}/api/state`)).json() as Record<string, unknown>;
    assert.equal(state.population, 0, 'nobody lives here yet');
    assert.equal(state.founders, 0, 'and no scripted founders were seeded');
    assert.equal(state.tickSeconds, 3600);
    assert.equal(state.decisionDeadlineMs, 1500);
    assert.equal(state.running, undefined, 'there is nothing to start or stop');
    assert.equal((await fetch(`http://127.0.0.1:${server.port}/api/sim/step`, { method: 'POST' })).status, 404);

    const banner = server.output();
    assert.match(banner, /The city is empty/);
    assert.match(banner, /docs\/AGENTS\.md/);
    assert.match(banner, /one hour every 3600 s/);
    assert.match(banner, /agents\/join/);
  } finally {
    if (server) await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

test('serve --seed-pop 3 seeds scripted founders and saves the city on the way out', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'reverie-serve-'));
  const save = join(dir, 'nested', 'world.json');
  let server: Awaited<ReturnType<typeof startServe>> | null = null;
  try {
    server = await startServe(['--seed-pop', '3', '--port', '0', '--tick-ms', '20', '--save', save]);
    const url = `http://127.0.0.1:${server.port}/api/state`;
    const state = await (await fetch(url)).json() as Record<string, unknown>;
    assert.equal(state.population, 3);
    assert.equal(state.founders, 3, 'the dashboard is told they are scripted');
    assert.equal(state.tickSeconds, 0.02, 'a hidden alias can set a very fast clock');
    assert.doesNotMatch(server.output(), /The city is empty/);

    // The clock turns on its own; give it a few hours before taking the city away.
    const deadline = Date.now() + 10_000;
    let ticked = 0;
    while (ticked < 3 && Date.now() < deadline) {
      ticked = Number((await (await fetch(url)).json() as Record<string, unknown>).tick ?? 0);
    }
    assert.ok(ticked >= 3, `the clock turned by itself (tick ${ticked})`);

    await server.stop();
    server = null;
    const saved = JSON.parse(readFileSync(save, 'utf8')) as { version: number; order: string[]; tick: number };
    assert.equal(saved.version, 1);
    assert.equal(saved.order.length, 3);
    assert.ok(saved.tick > 0, 'the city was saved on the way out');
  } finally {
    if (server) await server.stop();
    rmSync(dir, { recursive: true, force: true });
  }
});

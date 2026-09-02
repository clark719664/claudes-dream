/**
 * CLI test-suite. Every subprocess run uses --offline with the fixture top
 * list, so the suite is deterministic and never touches the network.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  parsePackageJson,
  parseRequirementsTxt,
  parseCargoToml,
  parseGemfile,
  parseComposerJson,
  parseGoMod,
  parsePlainList,
  parseDepsFromFile,
  detectManifest,
  parseArgs,
  checkOffline,
  shouldFail,
  sortVerdicts,
  summarize,
  formatHuman,
  runApi,
  authHeaders,
  isAllowedApiUrl,
  CliError,
  ECOSYSTEMS,
} from '../cli/vapordep.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const CLI = path.join(ROOT, 'cli', 'vapordep.mjs');
const FIXTURES = path.join(HERE, 'fixtures');
const TOP = path.join(FIXTURES, 'top-lists.json');
const fixture = (name) => path.join(FIXTURES, name);
const read = (name) => readFileSync(fixture(name), 'utf8');

/** Spawn the CLI; resolves with { code, stdout, stderr } regardless of the exit code. */
function run(args, { cwd = FIXTURES, env = {} } = {}) {
  return new Promise((resolve) => {
    execFile(
      process.execPath,
      [CLI, ...args],
      { cwd, env: { ...process.env, VAPORDEP_API: '', VAPORDEP_API_KEY: '', ...env }, maxBuffer: 8 * 1024 * 1024 },
      (error, stdout, stderr) => resolve({ code: error ? error.code : 0, stdout, stderr }),
    );
  });
}

/** Offline run against a fixture, parsed as JSON. */
async function offlineJson(files, extra = []) {
  const res = await run(['check', ...files, '--offline', '--json', '--top-lists', TOP, '--fail-on', 'never', ...extra]);
  assert.equal(res.code, 0, `stderr: ${res.stderr}`);
  return JSON.parse(res.stdout);
}

const names = (deps) => deps.map((d) => d.name);
const byName = (results, name) => results.find((r) => r.name === name);

// ---------------------------------------------------------------------------
// Parsers (unit)
// ---------------------------------------------------------------------------

describe('parsers', () => {
  test('package.json: dependencies + devDependencies, aliases resolved, local specs skipped', () => {
    const deps = parsePackageJson(read('package.json'));
    assert.ok(deps.every((d) => d.ecosystem === 'npm'));
    assert.deepEqual(names(deps), ['express', 'lodash', 'axios', 'reakt-dom-router', 'lodahs', '@babel/core', 'vitest', 'react']);
  });

  test('package.json: invalid JSON throws a CliError', () => {
    assert.throws(() => parsePackageJson('{ nope'), (err) => err instanceof CliError && err.code === 'PARSE_ERROR');
  });

  test('requirements.txt: names before specifiers/extras/markers, options and URLs skipped, lowercased', () => {
    const deps = parseRequirementsTxt(read('requirements.txt'));
    assert.ok(deps.every((d) => d.ecosystem === 'pypi'));
    assert.deepEqual(names(deps), ['requests', 'numpy', 'flask', 'django', 'pyyaml', 'reqeusts']);
  });

  test('requirements.txt: every specifier operator terminates the name', () => {
    const content = ['a==1', 'b>=2', 'c<=3', 'd~=4', 'e!=5', 'f<6', 'g>7', 'h[x]', 'i;python_version>"3"', 'j (>=1)', 'k\\', '  ==2'].join('\n');
    assert.deepEqual(names(parseRequirementsTxt(content)), ['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h', 'i', 'j', 'k']);
  });

  test('Cargo.toml: [dependencies], [dev-dependencies], [build-dependencies], sub-tables and renames; path/git deps skipped', () => {
    const deps = parseCargoToml(read('Cargo.toml'));
    assert.ok(deps.every((d) => d.ecosystem === 'crates'));
    assert.deepEqual(names(deps), ['serde', 'serde_json', 'tokio', 'rand', 'serde_jsn', 'anyhow', 'regex', 'criterion', 'cc']);
  });

  test('Cargo.toml: a path/git dependency that names a registry is still checked', () => {
    const content = ['[dependencies]', 'mirrored = { git = "https://x.invalid/m.git", registry = "corp" }', '[dependencies.local]', 'path = "../local"', 'registry = "corp"', '[dependencies.plain]', 'git = "https://x.invalid/p.git"'].join('\n');
    assert.deepEqual(names(parseCargoToml(content)), ['mirrored', 'local']);
  });

  test('Cargo.toml: target-specific and workspace dependency tables, sub-table renames', () => {
    const content = [
      "[target.'cfg(unix)'.dependencies]",
      'libc = "0.2"',
      '[workspace.dependencies]',
      'thiserror = "1"',
      '[dependencies.pretty]',
      'package = "real-crate"',
      'version = "2"',
      '[package.metadata.docs]',
      'features = "dependencies"',
    ].join('\n');
    assert.deepEqual(names(parseCargoToml(content)), ['libc', 'thiserror', 'real-crate']);
  });

  test('Gemfile: gem "name" in every quoting style, comments ignored, path:/git:/github: gems skipped', () => {
    const deps = parseGemfile(read('Gemfile'));
    assert.ok(deps.every((d) => d.ecosystem === 'rubygems'));
    assert.deepEqual(names(deps), ['rails', 'nokogiri', 'rake', 'rspec-rails', 'nokogirl']);
    assert.deepEqual(names(parseGemfile('gem "a", require: false\ngem "b", source: "https://gems.example"\ngem "c", :path => "x"')), ['a', 'b']);
  });

  test('composer.json: require + require-dev, platform packages skipped', () => {
    const deps = parseComposerJson(read('composer.json'));
    assert.ok(deps.every((d) => d.ecosystem === 'packagist'));
    assert.deepEqual(names(deps), ['monolog/monolog', 'symfony/console', 'guzzlehttp/guzzle', 'monolog/monolg', 'phpunit/phpunit']);
  });

  test('go.mod: single-line and block requires; exclude ignored; modules replaced by a local path skipped', () => {
    const deps = parseGoMod(read('go.mod'));
    assert.ok(deps.every((d) => d.ecosystem === 'go'));
    assert.deepEqual(names(deps), [
      'github.com/spf13/cobra',
      'github.com/gin-gonic/gin', // replaced by another module version, still a registry module
      'github.com/sirupsen/logrus',
      'golang.org/x/text',
      'github.com/sirupsen/logrs',
    ]);
  });

  test('plain list: one name per line with comments', () => {
    assert.deepEqual(parsePlainList(read('names.txt'), 'npm'), [
      { name: 'express', ecosystem: 'npm' },
      { name: 'React', ecosystem: 'npm' },
      { name: 'lodahs', ecosystem: 'npm' },
    ]);
  });

  test('detectManifest recognises every manifest kind', () => {
    assert.equal(detectManifest('/x/package.json').ecosystem, 'npm');
    assert.equal(detectManifest('requirements.txt').ecosystem, 'pypi');
    assert.equal(detectManifest('requirements-dev.txt').ecosystem, 'pypi');
    assert.equal(detectManifest('dev.requirements.txt').ecosystem, 'pypi');
    assert.equal(detectManifest('Cargo.toml').ecosystem, 'crates');
    assert.equal(detectManifest('Gemfile').ecosystem, 'rubygems');
    assert.equal(detectManifest('composer.json').ecosystem, 'packagist');
    assert.equal(detectManifest('go.mod').ecosystem, 'go');
    assert.equal(detectManifest('names.txt'), null);
    assert.equal(detectManifest('pyproject.toml'), null);
  });

  test('parseDepsFromFile dispatches by file name and honours a forced ecosystem', () => {
    assert.deepEqual(names(parseDepsFromFile('some/dir/Gemfile', 'gem "rails"')), ['rails']);
    assert.deepEqual(parseDepsFromFile('names.txt', 'foo\nbar', { ecosystem: 'crates' }), [
      { name: 'foo', ecosystem: 'crates' },
      { name: 'bar', ecosystem: 'crates' },
    ]);
    assert.deepEqual(parseDepsFromFile('package.json', '{"dependencies":{"x":"1"}}', { ecosystem: 'pypi' }), [{ name: 'x', ecosystem: 'pypi' }]);
    assert.throws(() => parseDepsFromFile('names.txt', 'foo'), (err) => err instanceof CliError && err.code === 'UNKNOWN_MANIFEST');
  });
});

// ---------------------------------------------------------------------------
// Pure helpers (unit)
// ---------------------------------------------------------------------------

describe('helpers', () => {
  test('parseArgs handles flags, --flag=value, env fallbacks and validation', () => {
    const env = { VAPORDEP_API: '', VAPORDEP_API_KEY: '' };
    const opts = parseArgs(['check', 'a.json', '--offline', '--json', '--fail-on=caution', '--ecosystem', 'npm', '-q', '--batch-size', '5', 'b.txt'], env);
    assert.equal(opts.command, 'check');
    assert.deepEqual(opts.files, ['a.json', 'b.txt']);
    assert.equal(opts.offline, true);
    assert.equal(opts.json, true);
    assert.equal(opts.quiet, true);
    assert.equal(opts.failOn, 'caution');
    assert.equal(opts.ecosystem, 'npm');
    assert.equal(opts.batchSize, 5);
    assert.equal(opts.api, null);

    const fromEnv = parseArgs(['check'], { VAPORDEP_API: 'https://api.example.test/', VAPORDEP_API_KEY: 'k1' });
    assert.equal(fromEnv.api, 'https://api.example.test/');
    assert.equal(fromEnv.apiKey, 'k1');
    assert.equal(fromEnv.batchSize, 100, 'a key raises the default batch size to the pro limit');
    assert.equal(parseArgs(['check', '--batch-size', '7'], { VAPORDEP_API_KEY: 'k1' }).batchSize, 7);
    assert.equal(parseArgs(['check'], env).failOn, 'danger');
    assert.equal(parseArgs(['check'], env).batchSize, 10);

    // An exported VAPORDEP_API must not break --offline; an explicit --api still conflicts.
    const offline = parseArgs(['check', '--offline'], { VAPORDEP_API: 'https://api.example.test' });
    assert.equal(offline.offline, true);
    assert.equal(offline.api, null);

    // http:// is only allowed for loopback hosts.
    assert.equal(parseArgs(['check', '--api', 'http://localhost:8787'], env).api, 'http://localhost:8787');
    assert.equal(parseArgs(['check', '--api', 'http://127.0.0.1:8787/'], env).api, 'http://127.0.0.1:8787/');
    assert.throws(() => parseArgs(['check', '--api', 'http://api.example.test'], env), (err) => err instanceof CliError && err.code === 'USAGE' && /https/.test(err.message));
    assert.throws(() => parseArgs(['check'], { VAPORDEP_API: 'http://api.example.test' }), (err) => err.code === 'USAGE');
    assert.equal(isAllowedApiUrl('https://x.p.rapidapi.com'), true);
    assert.equal(isAllowedApiUrl('ftp://localhost'), false);
    assert.equal(isAllowedApiUrl('http://[::1]:8787'), true);

    for (const bad of [
      ['check', '--fail-on', 'sometimes'],
      ['check', '--ecosystem', 'maven'],
      ['check', '--batch-size', '0'],
      ['check', '--batch-size', '101'],
      ['check', '--offline', '--api', 'https://x.test'],
      ['check', '--api', 'not-a-url'],
      ['check', '--bogus'],
      ['check', '--api'],
    ]) {
      assert.throws(() => parseArgs(bad, env), (err) => err instanceof CliError && err.code === 'USAGE', bad.join(' '));
    }
  });

  test('shouldFail respects the threshold ordering', () => {
    const v = (level) => ({ risk: { level } });
    assert.equal(shouldFail([v('ok'), v('caution')], 'danger'), false);
    assert.equal(shouldFail([v('ok'), v('caution')], 'caution'), true);
    assert.equal(shouldFail([v('danger')], 'danger'), true);
    assert.equal(shouldFail([v('danger')], 'never'), false);
    assert.equal(shouldFail([], 'caution'), false);
  });

  test('sortVerdicts orders danger > caution > ok, then score, ecosystem, name', () => {
    const mk = (name, level, score, ecosystem = 'npm') => ({ name, ecosystem, risk: { level, score } });
    const sorted = sortVerdicts([mk('b', 'ok', 0), mk('a', 'danger', 60), mk('c', 'caution', 30), mk('z', 'danger', 90), mk('a', 'ok', 0, 'go')]);
    assert.deepEqual(
      sorted.map((v) => `${v.ecosystem}/${v.name}`),
      ['npm/z', 'npm/a', 'npm/c', 'go/a', 'npm/b'],
    );
  });

  test('summarize counts levels and records mode/tier/files', () => {
    const verdicts = [{ risk: { level: 'ok' } }, { risk: { level: 'danger' } }, { risk: { level: 'caution' } }];
    const s = summarize(verdicts, { mode: 'api', failOn: 'danger', tier: 'pro', sources: [{ path: 'x' }] });
    assert.deepEqual(s, { total: 3, ok: 1, caution: 1, danger: 1, mode: 'api', failOn: 'danger', failed: true, files: [{ path: 'x' }], tier: 'pro' });
  });

  test('formatHuman renders an ASCII table, details and a summary line', () => {
    const verdicts = [
      { name: 'express', ecosystem: 'npm', exists: true, registry: null, risk: { level: 'ok', score: 0, flags: [] }, suggestions: [] },
      {
        name: 'lodahs',
        ecosystem: 'npm',
        exists: false,
        registry: null,
        risk: { level: 'danger', score: 90, flags: [{ code: 'NOT_FOUND', message: 'nope' }, { code: 'NEAR_MISS_TOP', message: 'close' }] },
        suggestions: [{ name: 'lodash', distance: 2 }],
      },
    ];
    const text = formatHuman(verdicts, summarize(verdicts, { mode: 'local', failOn: 'danger', sources: [{ path: 'package.json' }] }));
    assert.match(text, /RISK\s+SCORE\s+ECOSYSTEM\s+PACKAGE\s+EXISTS\s+FLAGS\s+DID YOU MEAN/);
    assert.match(text, /danger\s+90\s+npm\s+lodahs\s+NO\s+NOT_FOUND,NEAR_MISS_TOP\s+lodash \(2\)/);
    assert.match(text, /ok\s+0\s+npm\s+express\s+yes\s+-\s+-/);
    assert.match(text, /- NOT_FOUND: nope/);
    assert.match(text, /Summary: 2 packages from 1 file \| 1 danger \| 0 caution \| 1 ok \| mode: local/);
    assert.match(text, /FAIL: .*danger/);
    assert.ok(/^[\x00-\x7F]*$/.test(text), 'human output is plain ASCII');

    const quiet = formatHuman(verdicts, summarize(verdicts, { mode: 'local', failOn: 'danger', sources: [] }), { quiet: true });
    assert.ok(!/^ok\s/m.test(quiet));
    assert.match(quiet, /lodahs/);
  });

  test('checkOffline produces contract-shaped verdicts', async () => {
    const { validateName, levelForScore } = await import('../src/check.js');
    const { nearMatches } = await import('../src/similarity.js');
    const topLists = JSON.parse(read('top-lists.json'));
    const helpers = { topLists, validateName, nearMatches, levelForScore };

    const near = checkOffline({ name: 'lodahs', ecosystem: 'npm', ...helpers });
    assert.deepEqual(near, {
      name: 'lodahs',
      ecosystem: 'npm',
      exists: null,
      registry: null,
      risk: { level: 'caution', score: 30, flags: [{ code: 'NEAR_MISS_TOP', message: near.risk.flags[0].message }] },
      suggestions: [{ name: 'lodash', distance: 2 }],
    });
    assert.match(near.risk.flags[0].message, /"lodash"/);

    const popular = checkOffline({ name: 'express', ecosystem: 'npm', ...helpers });
    assert.equal(popular.risk.level, 'ok');
    assert.deepEqual(popular.suggestions, []);

    const unknown = checkOffline({ name: 'reakt-dom-router', ecosystem: 'npm', ...helpers });
    assert.equal(unknown.risk.level, 'ok');
    assert.equal(unknown.exists, null);

    const invalid = checkOffline({ name: 'React', ecosystem: 'npm', ...helpers });
    assert.equal(invalid.risk.level, 'danger');
    assert.equal(invalid.risk.score, 100);
    assert.deepEqual(invalid.risk.flags.map((f) => f.code), ['INVALID_NAME']);
    assert.deepEqual(invalid.suggestions, [{ name: 'react', distance: 1 }]);
  });

  test('checkOffline with topMatches compares PyPI / crates names in canonical form', async () => {
    const { validateName, levelForScore, topMatches } = await import('../src/check.js');
    const { nearMatches } = await import('../src/similarity.js');
    const topLists = { pypi: ['typing-extensions', 'importlib-metadata', 'requests'], crates: ['serde_json', 'serde'] };
    const helpers = { topLists, validateName, nearMatches, levelForScore, topMatches };

    for (const name of ['typing_extensions', 'importlib_metadata', 'Typing.Extensions']) {
      const v = checkOffline({ name, ecosystem: 'pypi', ...helpers });
      assert.equal(v.risk.level, 'ok', `${name} is a popular package spelled differently, not a near miss`);
      assert.deepEqual(v.suggestions, []);
      assert.equal(v.name, name, 'the name is reported as written');
    }
    const miss = checkOffline({ name: 'Reqeusts', ecosystem: 'pypi', ...helpers });
    assert.deepEqual(miss.risk.flags.map((f) => f.code), ['NEAR_MISS_TOP']);
    assert.deepEqual(miss.suggestions, [{ name: 'requests', distance: 2 }]);

    assert.equal(checkOffline({ name: 'serde-json', ecosystem: 'crates', ...helpers }).risk.level, 'ok');
    const crate = checkOffline({ name: 'serde-jsn', ecosystem: 'crates', ...helpers });
    assert.deepEqual(crate.suggestions, [{ name: 'serde_json', distance: 1 }]);
  });

  test('authHeaders picks RapidAPI headers for *.rapidapi.com and x-api-key elsewhere', () => {
    assert.deepEqual(authHeaders('https://vapordep.p.rapidapi.com', 'rk'), { 'x-rapidapi-key': 'rk', 'x-rapidapi-host': 'vapordep.p.rapidapi.com' });
    assert.deepEqual(authHeaders('https://vapordep-api.example.workers.dev', 'k'), { 'x-api-key': 'k' });
    assert.deepEqual(authHeaders('https://notrapidapi.com', 'k'), { 'x-api-key': 'k' });
    assert.deepEqual(authHeaders('https://vapordep.p.rapidapi.com', null), {});
  });

  test('runApi sends RapidAPI headers to a RapidAPI listing and refuses redirects', async () => {
    let seen;
    const fetchImpl = async (url, init) => {
      seen = { url, init };
      return new Response(JSON.stringify({ results: [{ name: 'a', ecosystem: 'npm' }], tier: 'pro' }), { status: 200 });
    };
    await runApi([{ name: 'a', ecosystem: 'npm' }], { apiUrl: 'https://vapordep.p.rapidapi.com/', apiKey: 'rk', fetchImpl });
    assert.equal(seen.url, 'https://vapordep.p.rapidapi.com/v1/batch');
    assert.equal(seen.init.headers['x-rapidapi-key'], 'rk');
    assert.equal(seen.init.headers['x-rapidapi-host'], 'vapordep.p.rapidapi.com');
    assert.equal('x-api-key' in seen.init.headers, false);
    assert.equal(seen.init.redirect, 'error');
  });

  test('runApi chunks batches, sends x-api-key and concatenates results', async () => {
    const calls = [];
    const fetchImpl = async (url, init) => {
      const body = JSON.parse(init.body);
      calls.push({ url, headers: init.headers, count: body.packages.length });
      return new Response(JSON.stringify({ results: body.packages.map((p) => ({ ...p, exists: true })), tier: 'pro' }), { status: 200 });
    };
    const deps = Array.from({ length: 23 }, (_, i) => ({ name: `pkg-${i}`, ecosystem: 'npm', files: [] }));
    const { results, tier } = await runApi(deps, { apiUrl: 'https://api.example.test/', apiKey: 'secret', batchSize: 10, fetchImpl });
    assert.equal(results.length, 23);
    assert.equal(results[22].name, 'pkg-22');
    assert.equal(tier, 'pro');
    assert.deepEqual(calls.map((c) => c.count), [10, 10, 3]);
    assert.ok(calls.every((c) => c.url === 'https://api.example.test/v1/batch'));
    assert.ok(calls.every((c) => c.headers['x-api-key'] === 'secret'));
    assert.ok(!('files' in JSON.parse(JSON.stringify(calls[0]))), 'only name+ecosystem are sent');
  });

  test('runApi surfaces API error envelopes with their code', async () => {
    const fetchImpl = async () => new Response(JSON.stringify({ error: { code: 'BATCH_LIMIT', message: 'too many' } }), { status: 402 });
    await assert.rejects(
      runApi([{ name: 'a', ecosystem: 'npm' }], { apiUrl: 'https://api.example.test', fetchImpl }),
      (err) => err instanceof CliError && err.code === 'BATCH_LIMIT' && /402/.test(err.message) && /batch-size/.test(err.message),
    );
    const down = async () => {
      throw new Error('ECONNREFUSED');
    };
    await assert.rejects(runApi([{ name: 'a', ecosystem: 'npm' }], { apiUrl: 'https://api.example.test', fetchImpl: down }), (err) => err.code === 'API_UNREACHABLE');
  });
});

// ---------------------------------------------------------------------------
// Subprocess runs (--offline only)
// ---------------------------------------------------------------------------

const VERDICT_KEYS = ['name', 'ecosystem', 'exists', 'registry', 'risk', 'suggestions'];

function assertVerdictShape(v) {
  assert.deepEqual(Object.keys(v).sort(), [...VERDICT_KEYS].sort(), `verdict keys for ${v.name}`);
  assert.equal(typeof v.name, 'string');
  assert.ok(ECOSYSTEMS.includes(v.ecosystem), `ecosystem ${v.ecosystem}`);
  assert.equal(v.exists, null, 'offline verdicts cannot verify existence');
  assert.equal(v.registry, null);
  assert.ok(['ok', 'caution', 'danger'].includes(v.risk.level));
  assert.equal(typeof v.risk.score, 'number');
  assert.ok(Array.isArray(v.risk.flags));
  for (const f of v.risk.flags) assert.deepEqual(Object.keys(f).sort(), ['code', 'message']);
  assert.ok(Array.isArray(v.suggestions) && v.suggestions.length <= 5);
  for (const s of v.suggestions) assert.deepEqual(Object.keys(s).sort(), ['distance', 'name']);
}

describe('cli subprocess (offline)', () => {
  test('--help exits 0 and prints usage', async () => {
    const res = await run(['--help'], { cwd: ROOT });
    assert.equal(res.code, 0);
    assert.match(res.stdout, /Usage:/);
    assert.match(res.stdout, /vapordep check/);
    assert.match(res.stdout, /--offline/);
    const short = await run(['-h'], { cwd: ROOT });
    assert.equal(short.code, 0);
    const bare = await run([], { cwd: ROOT });
    assert.equal(bare.code, 0);
    assert.match(bare.stdout, /Usage:/);
  });

  test('--version prints the package.json version', async () => {
    const { version } = JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const res = await run(['--version'], { cwd: ROOT });
    assert.equal(res.code, 0);
    assert.equal(res.stdout.trim(), `vapordep ${version}`);
  });

  const expectations = [
    ['package.json', 'npm', ['express', 'lodash', 'axios', 'reakt-dom-router', 'lodahs', '@babel/core', 'vitest', 'react'], 'lodahs', 'lodash'],
    ['requirements.txt', 'pypi', ['requests', 'numpy', 'flask', 'django', 'pyyaml', 'reqeusts'], 'reqeusts', 'requests'],
    ['Cargo.toml', 'crates', ['serde', 'serde_json', 'tokio', 'rand', 'serde_jsn', 'anyhow', 'regex', 'criterion', 'cc'], 'serde_jsn', 'serde_json'],
    ['Gemfile', 'rubygems', ['rails', 'nokogiri', 'rake', 'rspec-rails', 'nokogirl'], 'nokogirl', 'nokogiri'],
    ['composer.json', 'packagist', ['monolog/monolog', 'symfony/console', 'guzzlehttp/guzzle', 'monolog/monolg', 'phpunit/phpunit'], 'monolog/monolg', 'monolog/monolog'],
    ['go.mod', 'go', ['github.com/spf13/cobra', 'github.com/gin-gonic/gin', 'github.com/sirupsen/logrus', 'golang.org/x/text', 'github.com/sirupsen/logrs'], 'github.com/sirupsen/logrs', 'github.com/sirupsen/logrus'],
  ];

  for (const [file, ecosystem, expected, fake, real] of expectations) {
    test(`${file}: finds every dependency and flags the near-miss "${fake}"`, async () => {
      const { results, summary } = await offlineJson([file]);
      assert.deepEqual(results.map((r) => r.name), expected);
      assert.ok(results.every((r) => r.ecosystem === ecosystem));
      for (const v of results) assertVerdictShape(v);

      const miss = byName(results, fake);
      assert.equal(miss.risk.level, 'caution');
      assert.deepEqual(miss.risk.flags.map((f) => f.code), ['NEAR_MISS_TOP']);
      assert.match(miss.risk.flags[0].message, /offline/);
      assert.equal(miss.suggestions[0].name, real);
      assert.ok(miss.suggestions[0].distance >= 1 && miss.suggestions[0].distance <= 2);

      const genuine = byName(results, real);
      assert.equal(genuine.risk.level, 'ok');
      assert.deepEqual(genuine.risk.flags, []);
      assert.deepEqual(genuine.suggestions, []);

      assert.equal(summary.mode, 'offline');
      assert.equal(summary.total, expected.length);
      assert.equal(summary.caution, 1);
      assert.equal(summary.failed, false);
      assert.deepEqual(summary.files, [{ path: file, kind: file, ecosystem, packages: expected }]);
    });
  }

  test('--fail-on: never exits 0, caution exits 1 on an offline near miss, default danger exits 0', async () => {
    const base = ['check', 'package.json', '--offline', '--top-lists', TOP];
    assert.equal((await run([...base, '--fail-on', 'never'])).code, 0);
    assert.equal((await run([...base, '--fail-on', 'caution'])).code, 1);
    assert.equal((await run([...base])).code, 0);

    const json = await run([...base, '--json', '--fail-on', 'caution']);
    assert.equal(json.code, 1);
    const parsed = JSON.parse(json.stdout);
    assert.equal(parsed.summary.failed, true);
    assert.equal(parsed.summary.failOn, 'caution');
  });

  test('INVALID_NAME is danger and fails the default threshold; plain lists need --ecosystem', async () => {
    const res = await run(['check', 'names.txt', '--offline', '--top-lists', TOP, '--ecosystem', 'npm', '--json']);
    assert.equal(res.code, 1);
    const { results, summary } = JSON.parse(res.stdout);
    assert.deepEqual(results.map((r) => r.name), ['express', 'React', 'lodahs']);
    const invalid = byName(results, 'React');
    assert.equal(invalid.risk.level, 'danger');
    assert.equal(invalid.risk.score, 100);
    assert.deepEqual(invalid.risk.flags.map((f) => f.code), ['INVALID_NAME']);
    assert.deepEqual(invalid.suggestions, [{ name: 'react', distance: 1 }]);
    assert.equal(summary.danger, 1);
    assert.equal(summary.failed, true);
    assert.equal(summary.files[0].kind, 'list');

    const missing = await run(['check', 'names.txt', '--offline', '--top-lists', TOP]);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /--ecosystem/);
  });

  test('auto-detects every manifest in the working directory and de-duplicates across files', async () => {
    const { results, summary } = await offlineJson([]);
    assert.equal(summary.files.length, 6);
    assert.deepEqual(
      summary.files.map((f) => f.path),
      ['package.json', 'requirements.txt', 'Cargo.toml', 'Gemfile', 'composer.json', 'go.mod'],
    );
    const total = expectations.reduce((n, [, , expected]) => n + expected.length, 0);
    assert.equal(results.length, total);
    assert.equal(summary.caution, 6);
    assert.equal(summary.total, total);

    // Same package listed twice (package.json + names.txt) yields a single verdict.
    const dup = await offlineJson(['package.json', 'names.txt'], ['--ecosystem', 'npm']);
    assert.equal(dup.results.filter((r) => r.name === 'express').length, 1);
    assert.equal(dup.summary.files.length, 2);
  });

  test('a directory argument is scanned for manifests', async () => {
    const res = await run(['check', FIXTURES, '--offline', '--json', '--top-lists', TOP], { cwd: ROOT });
    assert.equal(res.code, 0, res.stderr);
    assert.equal(JSON.parse(res.stdout).summary.files.length, 6);
  });

  test('human output is an ASCII table with a summary line', async () => {
    const res = await run(['check', 'package.json', '--offline', '--top-lists', TOP]);
    assert.equal(res.code, 0, res.stderr);
    assert.match(res.stdout, /RISK\s+SCORE\s+ECOSYSTEM\s+PACKAGE\s+EXISTS\s+FLAGS\s+DID YOU MEAN/);
    assert.match(res.stdout, /caution\s+30\s+npm\s+lodahs\s+\?\s+NEAR_MISS_TOP\s+lodash \(2\)/);
    assert.match(res.stdout, /ok\s+0\s+npm\s+express\s+\?/);
    assert.match(res.stdout, /Summary: 8 packages from 1 file \| 0 danger \| 1 caution \| 7 ok \| mode: offline/);
    assert.match(res.stdout, /PASS/);
    assert.ok(/^[\x00-\x7F]*$/.test(res.stdout), 'plain ASCII');

    const quiet = await run(['check', 'package.json', '--offline', '--top-lists', TOP, '--quiet']);
    assert.match(quiet.stdout, /lodahs/);
    assert.ok(!/\bexpress\b/.test(quiet.stdout));
  });

  test('usage and file errors exit 2 with a message on stderr', async () => {
    const missing = await run(['check', 'does-not-exist.json', '--offline']);
    assert.equal(missing.code, 2);
    assert.match(missing.stderr, /No such file/);
    assert.equal(missing.stdout, '');

    const badFlag = await run(['check', '--fail-on', 'maybe', '--offline']);
    assert.equal(badFlag.code, 2);
    assert.match(badFlag.stderr, /--fail-on/);

    const badCommand = await run(['frobnicate'], { cwd: ROOT });
    assert.equal(badCommand.code, 2);
    assert.match(badCommand.stderr, /Unknown command/);

    const conflict = await run(['check', 'package.json', '--offline', '--api', 'https://example.test']);
    assert.equal(conflict.code, 2);
    assert.match(conflict.stderr, /cannot be combined/);
  });

  test('--json output is the only thing on stdout', async () => {
    const res = await run(['check', 'Gemfile', '--offline', '--json', '--top-lists', TOP]);
    assert.equal(res.code, 0);
    assert.doesNotThrow(() => JSON.parse(res.stdout));
    assert.deepEqual(Object.keys(JSON.parse(res.stdout)), ['results', 'summary']);
  });

  const hasRealData = existsSync(path.join(ROOT, 'data', 'top-lists.mjs'));
  test('bundled data/top-lists.mjs is used when --top-lists is omitted', { skip: !hasRealData && 'data/top-lists.mjs not built yet' }, async () => {
    const res = await run(['check', 'package.json', 'requirements.txt', '--offline', '--json', '--fail-on', 'never']);
    assert.equal(res.code, 0, res.stderr);
    const { results } = JSON.parse(res.stdout);
    for (const v of results) assertVerdictShape(v);
    assert.equal(byName(results, 'express').risk.level, 'ok');
    assert.equal(byName(results, 'requests').risk.level, 'ok');
    assert.equal(byName(results, 'lodahs').suggestions[0]?.name, 'lodash');
  });
});

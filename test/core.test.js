/**
 * Offline test-suite for the VaporDep core: similarity, validation, scoring,
 * registry normalisation, tiering and the Worker routes. No network access —
 * every fetch is mocked.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import { levenshtein, nearMatches } from '../src/similarity.js';
import { createRegistryClient, normalizeRepoUrl, escapeGoModulePath, MAX_UPSTREAM_BYTES } from '../src/registries.js';
import { ECOSYSTEMS, validateName, checkPackage, levelForScore, FLAG_POINTS, canonicalName, topMatches } from '../src/check.js';
import { resolveTier, safeEqual } from '../src/tiers.js';
import worker from '../src/worker.js';

// ---------------------------------------------------------------------------
// Fixtures & helpers
// ---------------------------------------------------------------------------

const TOP = {
  npm: ['react', 'lodash', 'express', 'axios', 'vue', 'ms', '@babel/core'],
  pypi: ['requests', 'numpy', 'flask', 'django'],
  crates: ['serde', 'tokio', 'rand'],
  rubygems: ['rails', 'rake', 'nokogiri'],
  packagist: ['monolog/monolog', 'symfony/console'],
  go: ['github.com/sirupsen/logrus', 'github.com/gin-gonic/gin'],
};

const NOW = new Date('2026-09-01T00:00:00Z');
const OLD_DATE = '2020-01-15T00:00:00.000Z';
const DAY = 86_400_000;
const daysAgo = (n) => new Date(NOW.getTime() - n * DAY).toISOString();

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

/**
 * Build a recording mock fetch. `handler(url, init)` may return a Response, a
 * plain object (sent as 200 JSON) or undefined (sent as a 404).
 */
function mockFetch(handler) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url: String(url), init });
    const out = await handler(String(url), init);
    if (out instanceof Response) return out;
    if (out === undefined) return new Response('not found', { status: 404 });
    return jsonResponse(out);
  };
  fn.calls = calls;
  fn.urls = () => calls.map((c) => c.url);
  return fn;
}

/** Stub registry client for checkPackage tests. */
function stubClient(result) {
  const client = {
    calls: [],
    async lookup(ecosystem, name) {
      client.calls.push({ ecosystem, name });
      return typeof result === 'function' ? result(ecosystem, name) : result;
    },
  };
  return client;
}

const cleanRegistry = (extra = {}) => ({
  exists: true,
  created: OLD_DATE,
  lastPublish: '2026-01-01T00:00:00.000Z',
  downloadsWeekly: 50_000,
  repo: 'https://github.com/example/pkg',
  description: 'An example package',
  ...extra,
});

const codes = (verdict) => verdict.risk.flags.map((f) => f.code);

// ---------------------------------------------------------------------------
// similarity.js
// ---------------------------------------------------------------------------

describe('levenshtein', () => {
  test('identical strings and empty strings', () => {
    assert.equal(levenshtein('', ''), 0);
    assert.equal(levenshtein('abc', 'abc'), 0);
    assert.equal(levenshtein('', 'abc'), 3);
    assert.equal(levenshtein('abc', ''), 3);
  });

  test('classic cases', () => {
    assert.equal(levenshtein('kitten', 'sitting'), 3);
    assert.equal(levenshtein('flaw', 'lawn'), 2);
    assert.equal(levenshtein('react', 'reactt'), 1);
    assert.equal(levenshtein('reqeusts', 'requests'), 2); // transposition = 2 edits
    assert.equal(levenshtein('lodash', 'lodahs'), 2);
  });

  test('is symmetric', () => {
    for (const [a, b] of [['kitten', 'sitting'], ['', 'x'], ['abc', 'yabcd']]) {
      assert.equal(levenshtein(a, b), levenshtein(b, a));
    }
  });

  test('measures unicode in code points, not UTF-16 units', () => {
    assert.equal(levenshtein('café', 'cafe'), 1);
    assert.equal(levenshtein('😀', ''), 1); // would be 2 if counted in UTF-16 units
    assert.equal(levenshtein('a😀b', 'ab'), 1);
    assert.equal(levenshtein('😀', '😃'), 1);
    assert.equal(levenshtein('日本語', '日本'), 1);
  });

  test('maxDist early exit returns maxDist + 1', () => {
    assert.equal(levenshtein('abcdef', 'ghijkl', 2), 3);
    assert.equal(levenshtein('abc', 'abcdefgh', 2), 3); // length-difference prune
    assert.equal(levenshtein('kitten', 'sitting', 2), 3);
    assert.equal(levenshtein('kitten', 'sitting', 3), 3); // exactly at the limit is exact
    assert.equal(levenshtein('react', 'reacts', 2), 1);
    assert.equal(levenshtein('a', 'b', 0), 1);
    assert.equal(levenshtein('same', 'same', 0), 0);
  });

  test('coerces non-string input', () => {
    assert.equal(levenshtein(123, '123'), 0);
    assert.equal(levenshtein(12, '123'), 1);
  });
});

describe('nearMatches', () => {
  const list = ['react', 'redux', 'reach', 'rea', 're', 'reacts', 'preact', 'reactor'];

  test('sorts by distance then name and caps at 5', () => {
    const out = nearMatches('reac', list);
    assert.deepEqual(out, [
      { name: 'rea', distance: 1 },
      { name: 'reach', distance: 1 },
      { name: 'react', distance: 1 },
      { name: 'preact', distance: 2 },
      { name: 're', distance: 2 },
    ]);
  });

  test('excludes the exact match but keeps its neighbours', () => {
    const out = nearMatches('react', list);
    assert.ok(!out.some((m) => m.name === 'react'));
    assert.ok(out.some((m) => m.name === 'reacts' && m.distance === 1));
    assert.ok(out.every((m) => m.distance >= 1 && m.distance <= 2));
  });

  test('honours maxDist', () => {
    assert.deepEqual(nearMatches('reac', list, 1), [
      { name: 'rea', distance: 1 },
      { name: 'reach', distance: 1 },
      { name: 'react', distance: 1 },
    ]);
    assert.deepEqual(nearMatches('zzzzzz', list), []);
  });

  test('handles empty / invalid input gracefully', () => {
    assert.deepEqual(nearMatches('', list), []);
    assert.deepEqual(nearMatches('react', []), []);
    assert.deepEqual(nearMatches('react', undefined), []);
    assert.deepEqual(nearMatches(undefined, list), []);
    assert.deepEqual(nearMatches('react', ['react', 42, null, 'reacts']), [{ name: 'reacts', distance: 1 }]);
  });

  test('is case-sensitive as written (top lists are lowercase)', () => {
    assert.deepEqual(nearMatches('React', ['react']), [{ name: 'react', distance: 1 }]);
  });
});

// ---------------------------------------------------------------------------
// check.js — validateName
// ---------------------------------------------------------------------------

describe('validateName', () => {
  test('ECOSYSTEMS lists the six supported registries', () => {
    assert.deepEqual([...ECOSYSTEMS], ['npm', 'pypi', 'crates', 'rubygems', 'packagist', 'go']);
  });

  const cases = {
    npm: {
      ok: ['react', 'left-pad', 'lodash.get', 'my_pkg', '@babel/core', '@scope/pkg-name', 'a', 'pkg123', 'a'.repeat(214)],
      bad: ['React', 'my pkg', '.hidden', '_private', '@scope', '@/pkg', '@scope/', '@scope/.x', '@scope/pkg/extra', 'pkg!', '', 'a'.repeat(215), 'pkg\n', 'react ', 'ünïcode'],
    },
    pypi: {
      ok: ['requests', 'Requests', 'zope.interface', 'typing_extensions', 'scikit-learn', 'a', 'a1', 'a'.repeat(100)],
      bad: ['-requests', 'requests-', '.requests', 'requests.', 'my pkg', 'req uests', 'pkg/sub', '', 'a'.repeat(101), 'pkg@1'],
    },
    crates: {
      ok: ['serde', 'Serde', 'tokio-util', 'my_crate', 'a', 'a'.repeat(64)],
      bad: ['1serde', '-serde', '_serde', 'serde.json', 'my crate', '', 'a'.repeat(65), 'sérde'],
    },
    rubygems: {
      ok: ['rails', 'Rails', '0mq', 'rack-test', 'net.http', 'rake_task', 'a'.repeat(100)],
      bad: ['-rails', '.rails', '_rails', 'my gem', 'rails/engine', '', 'a'.repeat(101)],
    },
    packagist: {
      ok: ['monolog/monolog', 'symfony/console', 'vendor/my-pkg', 'vendor/my--pkg', 'vendor/my_pkg', 'vendor/my.pkg', 'a1/b2', 'ven.dor/pkg'],
      bad: ['monolog', 'Monolog/monolog', 'vendor/', '/pkg', 'vendor/pkg/', 'vendor/-pkg', 'vendor/pkg-', 'vendor/my---pkg', 'ven--dor/pkg', 'vendor/pkg/extra', '', 'vendor/my pkg'],
    },
    go: {
      ok: ['github.com/sirupsen/logrus', 'golang.org/x/net', 'github.com/Azure/azure-sdk-for-go', 'gopkg.in/yaml.v3', 'go.uber.org/zap', 'example.com/a/b/c'],
      bad: ['logrus', 'github/sirupsen/logrus', 'github.com', 'github.com/', 'Github.com/x/y', 'github.com//x', 'github.com/x y', 'github.com/x/y!', '', `github.com/${'a'.repeat(255)}`],
    },
  };

  for (const [eco, { ok, bad }] of Object.entries(cases)) {
    test(`${eco} accepts valid names`, () => {
      for (const name of ok) assert.equal(validateName(eco, name), true, `${eco}: expected "${name}" to be valid`);
    });
    test(`${eco} rejects invalid names`, () => {
      for (const name of bad) assert.equal(validateName(eco, name), false, `${eco}: expected "${name}" to be invalid`);
    });
  }

  test('rejects unknown ecosystems and non-string names', () => {
    assert.equal(validateName('maven', 'junit'), false);
    assert.equal(validateName('npm', undefined), false);
    assert.equal(validateName('npm', 42), false);
    assert.equal(validateName('npm', null), false);
  });

  test('pathological packagist names are validated quickly (no catastrophic backtracking)', () => {
    const start = Date.now();
    assert.equal(validateName('packagist', `${'a'.repeat(60)}!/pkg`), false);
    assert.equal(validateName('packagist', `vendor/${'a'.repeat(60)}!`), false);
    assert.ok(Date.now() - start < 500);
  });
});

// ---------------------------------------------------------------------------
// check.js — checkPackage
// ---------------------------------------------------------------------------

describe('checkPackage', () => {
  test('exists and clean → ok with score 0', async () => {
    const client = stubClient(cleanRegistry());
    const v = await checkPackage({ name: 'express', ecosystem: 'npm', client, topLists: TOP, now: NOW });
    assert.deepEqual(Object.keys(v), ['name', 'ecosystem', 'exists', 'registry', 'risk', 'suggestions']);
    assert.equal(v.name, 'express');
    assert.equal(v.ecosystem, 'npm');
    assert.equal(v.exists, true);
    assert.deepEqual(v.registry, {
      created: OLD_DATE,
      lastPublish: '2026-01-01T00:00:00.000Z',
      downloadsWeekly: 50_000,
      repo: 'https://github.com/example/pkg',
      description: 'An example package',
    });
    assert.deepEqual(v.risk, { level: 'ok', score: 0, flags: [] });
    assert.deepEqual(v.suggestions, []);
    assert.deepEqual(client.calls, [{ ecosystem: 'npm', name: 'express' }]);
  });

  test('not found with no near-miss → NOT_FOUND danger', async () => {
    const v = await checkPackage({ name: 'totally-made-up-pkg', ecosystem: 'npm', client: stubClient({ exists: false }), topLists: TOP });
    assert.equal(v.exists, false);
    assert.equal(v.registry, null);
    assert.deepEqual(codes(v), ['NOT_FOUND']);
    assert.equal(v.risk.score, 60);
    assert.equal(v.risk.level, 'danger');
    assert.deepEqual(v.suggestions, []);
  });

  test('not found near "react" → NOT_FOUND + NEAR_MISS_TOP with suggestions', async () => {
    const v = await checkPackage({ name: 'reactt', ecosystem: 'npm', client: stubClient({ exists: false }), topLists: TOP });
    assert.deepEqual(codes(v), ['NOT_FOUND', 'NEAR_MISS_TOP']);
    assert.equal(v.risk.score, 90);
    assert.equal(v.risk.level, 'danger');
    assert.deepEqual(v.suggestions, [{ name: 'react', distance: 1 }]);
    assert.match(v.risk.flags[1].message, /"react"/);
  });

  test('not found near "requests" (pypi, distance 2) → danger with suggestion', async () => {
    const v = await checkPackage({ name: 'reqeusts', ecosystem: 'pypi', client: stubClient({ exists: false }), topLists: TOP });
    assert.deepEqual(codes(v), ['NOT_FOUND', 'NEAR_MISS_TOP']);
    assert.deepEqual(v.suggestions, [{ name: 'requests', distance: 2 }]);
    assert.equal(v.risk.level, 'danger');
  });

  test('very new + low adoption → caution', async () => {
    const client = stubClient(cleanRegistry({ created: daysAgo(3), downloadsWeekly: 12 }));
    const v = await checkPackage({ name: 'brand-new-thing', ecosystem: 'npm', client, topLists: TOP, now: NOW });
    assert.deepEqual(codes(v), ['VERY_NEW', 'LOW_ADOPTION']);
    assert.equal(v.risk.score, 40);
    assert.equal(v.risk.level, 'caution');
    assert.match(v.risk.flags[0].message, /3 days ago/);
    assert.match(v.risk.flags[1].message, /12 downloads/);
  });

  test('very new + low adoption + no repo → score 50, still caution', async () => {
    const client = stubClient(cleanRegistry({ created: daysAgo(1), downloadsWeekly: 0, repo: null }));
    const v = await checkPackage({ name: 'brand-new-thing', ecosystem: 'npm', client, topLists: TOP, now: NOW });
    assert.deepEqual(codes(v), ['VERY_NEW', 'LOW_ADOPTION', 'NO_REPO']);
    assert.equal(v.risk.score, 50);
    assert.equal(v.risk.level, 'caution');
  });

  test('VERY_NEW boundary is 30 days from `now`', async () => {
    const at29 = await checkPackage({ name: 'x-pkg', ecosystem: 'npm', client: stubClient(cleanRegistry({ created: daysAgo(29) })), topLists: TOP, now: NOW });
    assert.deepEqual(codes(at29), ['VERY_NEW']);
    const at30 = await checkPackage({ name: 'x-pkg', ecosystem: 'npm', client: stubClient(cleanRegistry({ created: daysAgo(30) })), topLists: TOP, now: NOW });
    assert.deepEqual(codes(at30), []);
    const at31 = await checkPackage({ name: 'x-pkg', ecosystem: 'npm', client: stubClient(cleanRegistry({ created: daysAgo(31) })), topLists: TOP, now: NOW });
    assert.deepEqual(codes(at31), []);
    // `now` may also be a timestamp
    const numericNow = await checkPackage({ name: 'x-pkg', ecosystem: 'npm', client: stubClient(cleanRegistry({ created: daysAgo(5) })), topLists: TOP, now: NOW.getTime() });
    assert.deepEqual(codes(numericNow), ['VERY_NEW']);
  });

  test('unknown created / downloads do not trigger VERY_NEW / LOW_ADOPTION', async () => {
    const client = stubClient(cleanRegistry({ created: null, downloadsWeekly: null, lastPublish: null, description: '' }));
    const v = await checkPackage({ name: 'mystery', ecosystem: 'rubygems', client, topLists: TOP, now: NOW });
    assert.deepEqual(codes(v), []);
    assert.deepEqual(v.registry, { created: null, lastPublish: null, downloadsWeekly: null, repo: 'https://github.com/example/pkg', description: null });
  });

  test('LOW_ADOPTION boundary: 99 flags, 100 does not', async () => {
    const low = await checkPackage({ name: 'x-pkg', ecosystem: 'npm', client: stubClient(cleanRegistry({ downloadsWeekly: 99 })), topLists: TOP, now: NOW });
    assert.deepEqual(codes(low), ['LOW_ADOPTION']);
    const fine = await checkPackage({ name: 'x-pkg', ecosystem: 'npm', client: stubClient(cleanRegistry({ downloadsWeekly: 100 })), topLists: TOP, now: NOW });
    assert.deepEqual(codes(fine), []);
  });

  test('SHADOWS_TOP: exists, not in top list, near "lodash"', async () => {
    const v = await checkPackage({ name: 'lodahs', ecosystem: 'npm', client: stubClient(cleanRegistry()), topLists: TOP, now: NOW });
    assert.deepEqual(codes(v), ['SHADOWS_TOP']);
    assert.equal(v.risk.score, 35);
    assert.equal(v.risk.level, 'caution');
    assert.equal(v.exists, true);
    assert.deepEqual(v.suggestions, [{ name: 'lodash', distance: 2 }]);
    assert.match(v.risk.flags[0].message, /"lodash"/);
  });

  test('SHADOWS_TOP stacks with other flags into danger', async () => {
    const client = stubClient(cleanRegistry({ created: daysAgo(2), downloadsWeekly: 3, repo: null }));
    const v = await checkPackage({ name: 'reqests', ecosystem: 'pypi', client, topLists: TOP, now: NOW });
    assert.deepEqual(codes(v), ['VERY_NEW', 'LOW_ADOPTION', 'NO_REPO', 'SHADOWS_TOP']);
    assert.equal(v.risk.score, 85);
    assert.equal(v.risk.level, 'danger');
  });

  test('a package that is itself on the top list is never SHADOWS_TOP and gets no suggestions', async () => {
    // "ms" is one edit from nothing here, but add a neighbour to prove suggestions are suppressed.
    const lists = { npm: ['ms', 'qs', 'react'] };
    const v = await checkPackage({ name: 'ms', ecosystem: 'npm', client: stubClient(cleanRegistry()), topLists: lists, now: NOW });
    assert.deepEqual(codes(v), []);
    assert.deepEqual(v.suggestions, []);
    // Top-list membership is case-insensitive (crates.io names are).
    const crate = await checkPackage({ name: 'Serde', ecosystem: 'crates', client: stubClient(cleanRegistry()), topLists: TOP, now: NOW });
    assert.deepEqual(codes(crate), []);
    assert.deepEqual(crate.suggestions, []);
  });

  test('INVALID_NAME short-circuits: score 100, danger, no lookup, still suggests', async () => {
    const client = stubClient(cleanRegistry());
    const v = await checkPackage({ name: 'React', ecosystem: 'npm', client, topLists: TOP });
    assert.deepEqual(codes(v), ['INVALID_NAME']);
    assert.equal(v.risk.score, 100);
    assert.equal(v.risk.level, 'danger');
    assert.equal(v.exists, false);
    assert.equal(v.registry, null);
    assert.deepEqual(v.suggestions, [{ name: 'react', distance: 1 }]);
    assert.equal(client.calls.length, 0, 'no registry lookup for invalid names');

    const noClient = await checkPackage({ name: 'bad name', ecosystem: 'npm', topLists: TOP });
    assert.deepEqual(codes(noClient), ['INVALID_NAME']);
  });

  test('score is capped at 100 and levels follow thresholds', () => {
    assert.equal(levelForScore(0), 'ok');
    assert.equal(levelForScore(24), 'ok');
    assert.equal(levelForScore(25), 'caution');
    assert.equal(levelForScore(59), 'caution');
    assert.equal(levelForScore(60), 'danger');
    assert.equal(levelForScore(100), 'danger');
    assert.deepEqual(FLAG_POINTS, { INVALID_NAME: 100, NOT_FOUND: 60, NEAR_MISS_TOP: 30, VERY_NEW: 25, LOW_ADOPTION: 15, NO_REPO: 10, SHADOWS_TOP: 35 });
  });

  test('every flag carries a code and a non-empty message', async () => {
    const client = stubClient(cleanRegistry({ created: daysAgo(2), downloadsWeekly: 3, repo: null }));
    const v = await checkPackage({ name: 'reqests', ecosystem: 'pypi', client, topLists: TOP, now: NOW });
    for (const f of v.risk.flags) {
      assert.deepEqual(Object.keys(f), ['code', 'message']);
      assert.ok(f.message.length > 10);
    }
  });

  test('works without top lists', async () => {
    const v = await checkPackage({ name: 'reactt', ecosystem: 'npm', client: stubClient({ exists: false }) });
    assert.deepEqual(codes(v), ['NOT_FOUND']);
    assert.deepEqual(v.suggestions, []);
  });

  test('rejects unknown ecosystems, non-string names and missing clients', async () => {
    await assert.rejects(checkPackage({ name: 'x', ecosystem: 'maven', client: stubClient({}) }), { code: 'INVALID_ECOSYSTEM' });
    await assert.rejects(checkPackage({ name: 42, ecosystem: 'npm', client: stubClient({}) }), TypeError);
    await assert.rejects(checkPackage({ name: 'valid', ecosystem: 'npm' }), TypeError);
  });

  test('propagates UPSTREAM errors from the client', async () => {
    const client = { lookup: async () => { const e = new Error('boom'); e.code = 'UPSTREAM'; throw e; } };
    await assert.rejects(checkPackage({ name: 'express', ecosystem: 'npm', client, topLists: TOP }), { code: 'UPSTREAM' });
  });
});

// ---------------------------------------------------------------------------
// registries.js
// ---------------------------------------------------------------------------

describe('createRegistryClient', () => {
  const packument = {
    name: 'left-pad',
    description: 'String left pad',
    'dist-tags': { latest: '1.3.0' },
    versions: { '1.3.0': { repository: { type: 'git', url: 'git+https://github.com/stevemao/left-pad.git' } } },
    time: { created: '2014-03-06T02:41:26.014Z', modified: '2020-01-01T00:00:00.000Z', '1.3.0': '2018-04-12T00:00:00.000Z' },
  };

  test('npm: normalises the packument and the downloads endpoint', async () => {
    const fetch = mockFetch((url) => {
      if (url === 'https://registry.npmjs.org/left-pad') return packument;
      if (url === 'https://api.npmjs.org/downloads/point/last-week/left-pad') return { downloads: 12345, package: 'left-pad' };
    });
    const client = createRegistryClient(fetch);
    const r = await client.lookup('npm', 'left-pad');
    assert.deepEqual(r, {
      exists: true,
      created: '2014-03-06T02:41:26.014Z',
      lastPublish: '2018-04-12T00:00:00.000Z',
      downloadsWeekly: 12345,
      repo: 'https://github.com/stevemao/left-pad',
      description: 'String left pad',
    });
    assert.deepEqual(fetch.urls(), ['https://registry.npmjs.org/left-pad', 'https://api.npmjs.org/downloads/point/last-week/left-pad']);
    assert.equal(fetch.calls[0].init.headers['user-agent'].startsWith('vapordep/'), true);
  });

  test('npm: scoped names encode the slash for the registry but not for the downloads API', async () => {
    const fetch = mockFetch((url) => {
      if (url === 'https://registry.npmjs.org/@types%2Fnode') return { ...packument, name: '@types/node' };
      if (url === 'https://api.npmjs.org/downloads/point/last-week/@types/node') return { downloads: 7 };
    });
    const r = await createRegistryClient(fetch).lookup('npm', '@types/node');
    assert.equal(r.exists, true);
    assert.equal(r.downloadsWeekly, 7);
    assert.deepEqual(fetch.urls(), ['https://registry.npmjs.org/@types%2Fnode', 'https://api.npmjs.org/downloads/point/last-week/@types/node']);
  });

  test('npm: downloads failure is tolerated (downloadsWeekly null)', async () => {
    const fetch = mockFetch((url) => {
      if (url.startsWith('https://registry.npmjs.org/')) return packument;
      return new Response('nope', { status: 500 });
    });
    const r = await createRegistryClient(fetch).lookup('npm', 'left-pad');
    assert.equal(r.exists, true);
    assert.equal(r.downloadsWeekly, null);
  });

  test('npm: 404 → exists:false, unpublished → exists:false', async () => {
    const fetch = mockFetch((url) => {
      if (url.endsWith('/ghost-pkg')) return { name: 'ghost-pkg', time: { created: '2019-01-01T00:00:00Z', unpublished: { time: '2019-02-01T00:00:00Z' } } };
      return undefined;
    });
    const client = createRegistryClient(fetch);
    assert.deepEqual(await client.lookup('npm', 'does-not-exist-xyz'), { exists: false });
    assert.deepEqual(await client.lookup('npm', 'ghost-pkg'), { exists: false });
    assert.equal(fetch.calls.length, 2, 'no downloads call for missing packages');
  });

  test('npm: falls back to time.modified and top-level repository/description', async () => {
    const fetch = mockFetch((url) => {
      if (url.startsWith('https://registry.npmjs.org/')) return { name: 'x', repository: 'github:foo/bar', time: { created: '2020-01-01T00:00:00Z', modified: '2021-01-01T00:00:00Z' } };
      return { error: 'package not found' };
    });
    const r = await createRegistryClient(fetch).lookup('npm', 'x');
    assert.equal(r.lastPublish, '2021-01-01T00:00:00Z');
    assert.equal(r.repo, 'https://github.com/foo/bar');
    assert.equal(r.description, null);
    assert.equal(r.downloadsWeekly, null);
  });

  test('url-encodes untrusted names', async () => {
    const fetch = mockFetch(() => undefined);
    const client = createRegistryClient(fetch);
    await client.lookup('npm', 'weird name?#');
    await client.lookup('pypi', 'a/b');
    await client.lookup('crates', 'x y');
    await client.lookup('rubygems', 'a/b.json');
    await client.lookup('packagist', 'ven dor/pk g');
    assert.deepEqual(fetch.urls(), [
      'https://registry.npmjs.org/weird%20name%3F%23',
      'https://pypi.org/pypi/a%2Fb/json',
      'https://crates.io/api/v1/crates/x%20y',
      'https://rubygems.org/api/v1/gems/a%2Fb.json.json',
      'https://repo.packagist.org/p2/ven%20dor/pk%20g.json',
    ]);
  });

  test('5xx → throws UPSTREAM', async () => {
    const client = createRegistryClient(mockFetch(() => new Response('bad gateway', { status: 502 })));
    await assert.rejects(client.lookup('npm', 'react'), { code: 'UPSTREAM' });
    await assert.rejects(client.lookup('pypi', 'requests'), { code: 'UPSTREAM' });
    await assert.rejects(client.lookup('go', 'github.com/a/b'), { code: 'UPSTREAM' });
  });

  test('network failure and malformed JSON → throws UPSTREAM', async () => {
    const offline = createRegistryClient(async () => { throw new TypeError('fetch failed'); });
    await assert.rejects(offline.lookup('npm', 'react'), (err) => err.code === 'UPSTREAM' && err.cause instanceof TypeError);
    const garbage = createRegistryClient(async () => new Response('<html>', { status: 200 }));
    await assert.rejects(garbage.lookup('crates', 'serde'), { code: 'UPSTREAM' });
    const rateLimited = createRegistryClient(async () => new Response('slow down', { status: 429 }));
    await assert.rejects(rateLimited.lookup('rubygems', 'rails'), { code: 'UPSTREAM' });
  });

  test('pypi: derives created/lastPublish from releases and repo from project_urls', async () => {
    const fetch = mockFetch(() => ({
      info: {
        summary: 'Python HTTP for Humans.',
        home_page: 'https://requests.readthedocs.io',
        project_urls: { Documentation: 'https://requests.readthedocs.io', Source: 'https://github.com/psf/requests' },
      },
      releases: {
        '2.31.0': [{ upload_time_iso_8601: '2023-05-22T15:12:00.000000Z' }, { upload_time_iso_8601: '2023-05-22T15:13:00.000000Z' }],
        '0.2.0': [{ upload_time_iso_8601: '2011-02-14T00:00:00.000000Z' }],
        '0.0.1': [],
      },
    }));
    const r = await createRegistryClient(fetch).lookup('pypi', 'Requests');
    assert.deepEqual(r, {
      exists: true,
      created: '2011-02-14T00:00:00.000000Z',
      lastPublish: '2023-05-22T15:13:00.000000Z',
      downloadsWeekly: null,
      repo: 'https://github.com/psf/requests',
      description: 'Python HTTP for Humans.',
    });
    assert.deepEqual(fetch.urls(), ['https://pypi.org/pypi/requests/json']);
  });

  test('pypi: falls back to a forge home_page, 404 → exists:false', async () => {
    const fetch = mockFetch((url) => (url.includes('/pypi/present/') ? { info: { summary: '', home_page: 'https://gitlab.com/x/y' }, releases: {} } : undefined));
    const client = createRegistryClient(fetch);
    const present = await client.lookup('pypi', 'present');
    assert.equal(present.repo, 'https://gitlab.com/x/y');
    assert.equal(present.description, null);
    assert.equal(present.created, null);
    assert.deepEqual(await client.lookup('pypi', 'missing'), { exists: false });
  });

  test('crates: scales recent_downloads to a weekly figure', async () => {
    const fetch = mockFetch(() => ({
      crate: {
        created_at: '2015-01-01T00:00:00.000000+00:00',
        updated_at: '2026-06-02T00:00:00.000000+00:00',
        downloads: 100_000_000,
        recent_downloads: 900_000,
        repository: 'https://github.com/serde-rs/serde',
        description: 'A generic serialization/deserialization framework',
      },
      versions: [{ created_at: '2026-06-01T00:00:00.000000+00:00' }],
    }));
    const r = await createRegistryClient(fetch).lookup('crates', 'serde');
    assert.deepEqual(r, {
      exists: true,
      created: '2015-01-01T00:00:00.000000+00:00',
      lastPublish: '2026-06-01T00:00:00.000000+00:00',
      downloadsWeekly: 70_000,
      repo: 'https://github.com/serde-rs/serde',
      description: 'A generic serialization/deserialization framework',
    });
    assert.deepEqual(fetch.urls(), ['https://crates.io/api/v1/crates/serde']);
    assert.deepEqual(await createRegistryClient(mockFetch(() => undefined)).lookup('crates', 'nope'), { exists: false });
  });

  test('rubygems: uses the .json endpoint and source_code_uri', async () => {
    const fetch = mockFetch(() => ({
      name: 'rails',
      downloads: 500_000_000,
      version_created_at: '2026-05-01T00:00:00.000Z',
      info: 'Ruby on Rails is a full-stack web framework.',
      source_code_uri: 'https://github.com/rails/rails',
      homepage_uri: 'https://rubyonrails.org',
    }));
    const r = await createRegistryClient(fetch).lookup('rubygems', 'rails');
    assert.deepEqual(r, {
      exists: true,
      created: null,
      lastPublish: '2026-05-01T00:00:00.000Z',
      downloadsWeekly: null,
      repo: 'https://github.com/rails/rails',
      description: 'Ruby on Rails is a full-stack web framework.',
    });
    assert.deepEqual(fetch.urls(), ['https://rubygems.org/api/v1/gems/rails.json']);
    assert.deepEqual(await createRegistryClient(mockFetch(() => undefined)).lookup('rubygems', 'nope'), { exists: false });
  });

  test('packagist: expands minified p2 metadata', async () => {
    const fetch = mockFetch(() => ({
      minified: 'composer/2.0',
      packages: {
        'monolog/monolog': [
          { name: 'monolog/monolog', version: '3.5.0', time: '2023-10-27T15:32:24+00:00', source: { url: 'https://github.com/Seldaek/monolog.git', type: 'git' }, description: 'Sends your logs to files, sockets, inboxes, databases and various web services' },
          { version: '3.4.0', time: '2023-06-21T08:46:11+00:00' },
          { version: '1.0.0', time: '2011-02-14T00:00:00+00:00', description: '__unset' },
        ],
      },
    }));
    const r = await createRegistryClient(fetch).lookup('packagist', 'monolog/monolog');
    assert.deepEqual(r, {
      exists: true,
      created: '2011-02-14T00:00:00+00:00',
      lastPublish: '2023-10-27T15:32:24+00:00',
      downloadsWeekly: null,
      repo: 'https://github.com/Seldaek/monolog',
      description: 'Sends your logs to files, sockets, inboxes, databases and various web services',
    });
    assert.deepEqual(fetch.urls(), ['https://repo.packagist.org/p2/monolog/monolog.json']);
    assert.deepEqual(await createRegistryClient(mockFetch(() => undefined)).lookup('packagist', 'acme/nope'), { exists: false });
    assert.deepEqual(await createRegistryClient(mockFetch(() => ({ packages: {} }))).lookup('packagist', 'acme/empty'), { exists: false });
    await assert.rejects(createRegistryClient(mockFetch(() => ({}))).lookup('packagist', 'noslash'), { code: 'INVALID_NAME' });
  });

  test('go: escapes capitals per the goproxy protocol and treats 404/410 as missing', async () => {
    const fetch = mockFetch((url) => {
      if (url === 'https://proxy.golang.org/github.com/!azure/azure-sdk-for-go/@latest') return { Version: 'v68.0.0', Time: '2023-01-01T00:00:00Z' };
      if (url.includes('gone')) return new Response('gone', { status: 410 });
      return undefined;
    });
    const client = createRegistryClient(fetch);
    const r = await client.lookup('go', 'github.com/Azure/azure-sdk-for-go');
    assert.deepEqual(r, {
      exists: true,
      created: null,
      lastPublish: '2023-01-01T00:00:00Z',
      downloadsWeekly: null,
      repo: 'https://github.com/Azure/azure-sdk-for-go',
      description: null,
    });
    assert.deepEqual(await client.lookup('go', 'example.com/gone/module'), { exists: false });
    assert.deepEqual(await client.lookup('go', 'example.com/missing'), { exists: false });
    assert.equal(escapeGoModulePath('github.com/BurntSushi/toml'), 'github.com/!burnt!sushi/toml');
  });

  test('go: prefers Origin.URL for the repository', async () => {
    const fetch = mockFetch(() => ({ Version: 'v1.0.0', Time: '2024-01-01T00:00:00Z', Origin: { VCS: 'git', URL: 'https://github.com/uber-go/zap' } }));
    const r = await createRegistryClient(fetch).lookup('go', 'go.uber.org/zap');
    assert.equal(r.repo, 'https://github.com/uber-go/zap');
  });

  test('rejects unknown ecosystems and empty names', async () => {
    const client = createRegistryClient(mockFetch(() => ({})));
    await assert.rejects(client.lookup('maven', 'junit'), { code: 'INVALID_ECOSYSTEM' });
    await assert.rejects(client.lookup('npm', ''), { code: 'INVALID_NAME' });
    assert.throws(() => createRegistryClient('not a function'), TypeError);
  });

  test('normalizeRepoUrl handles the common spellings', () => {
    assert.equal(normalizeRepoUrl('git+https://github.com/x/y.git'), 'https://github.com/x/y');
    assert.equal(normalizeRepoUrl('git://github.com/x/y.git'), 'https://github.com/x/y');
    assert.equal(normalizeRepoUrl('git@github.com:x/y.git'), 'https://github.com/x/y');
    assert.equal(normalizeRepoUrl('git+ssh://git@github.com/x/y.git'), 'https://github.com/x/y');
    assert.equal(normalizeRepoUrl('github:x/y'), 'https://github.com/x/y');
    assert.equal(normalizeRepoUrl('gitlab:x/y'), 'https://gitlab.com/x/y');
    assert.equal(normalizeRepoUrl('x/y'), 'https://github.com/x/y');
    assert.equal(normalizeRepoUrl({ type: 'git', url: 'https://github.com/x/y/' }), 'https://github.com/x/y');
    assert.equal(normalizeRepoUrl(''), null);
    assert.equal(normalizeRepoUrl(null), null);
    assert.equal(normalizeRepoUrl({}), null);
  });
});

// ---------------------------------------------------------------------------
// tiers.js
// ---------------------------------------------------------------------------

describe('resolveTier', () => {
  const req = (headers = {}) => new Request('https://api.example/v1/batch', { method: 'POST', headers });
  const env = { API_KEYS: 'k1, k2 ,k3', RAPIDAPI_PROXY_SECRET: 's3cret' };

  test('defaults to free', () => {
    assert.deepEqual(resolveTier(req(), env), { tier: 'free', batchLimit: 10 });
    assert.deepEqual(resolveTier(req(), {}), { tier: 'free', batchLimit: 10 });
    assert.deepEqual(resolveTier(req(), undefined), { tier: 'free', batchLimit: 10 });
  });

  test('pro via API_KEYS (whitespace-tolerant, exact match only)', () => {
    assert.deepEqual(resolveTier(req({ 'x-api-key': 'k2' }), env), { tier: 'pro', batchLimit: 100 });
    assert.deepEqual(resolveTier(req({ 'X-API-KEY': 'k3' }), env), { tier: 'pro', batchLimit: 100 });
    assert.equal(resolveTier(req({ 'x-api-key': 'k' }), env).tier, 'free');
    assert.equal(resolveTier(req({ 'x-api-key': 'k22' }), env).tier, 'free');
    assert.equal(resolveTier(req({ 'x-api-key': 'K1' }), env).tier, 'free');
    assert.equal(resolveTier(req({ 'x-api-key': 'k1' }), { API_KEYS: '' }).tier, 'free');
    assert.equal(resolveTier(req({ 'x-api-key': 'k1' }), {}).tier, 'free');
    assert.equal(resolveTier(req({ 'x-api-key': '' }), { API_KEYS: ',,' }).tier, 'free');
  });

  test('pro via RAPIDAPI_PROXY_SECRET', () => {
    assert.deepEqual(resolveTier(req({ 'x-rapidapi-proxy-secret': 's3cret' }), env), { tier: 'pro', batchLimit: 100 });
    assert.equal(resolveTier(req({ 'x-rapidapi-proxy-secret': 'wrong' }), env).tier, 'free');
  });

  test('secret env unset or empty ⇒ header ignored', () => {
    assert.equal(resolveTier(req({ 'x-rapidapi-proxy-secret': 's3cret' }), { API_KEYS: 'k1' }).tier, 'free');
    assert.equal(resolveTier(req({ 'x-rapidapi-proxy-secret': '' }), { RAPIDAPI_PROXY_SECRET: '' }).tier, 'free');
    assert.equal(resolveTier(req({ 'x-rapidapi-proxy-secret': 'undefined' }), { RAPIDAPI_PROXY_SECRET: undefined }).tier, 'free');
  });

  test('accepts plain-object headers too', () => {
    assert.equal(resolveTier({ headers: { 'X-Api-Key': 'k1' } }, env).tier, 'pro');
    assert.equal(resolveTier({}, env).tier, 'free');
  });

  test('safeEqual', () => {
    assert.equal(safeEqual('abc', 'abc'), true);
    assert.equal(safeEqual('abc', 'abd'), false);
    assert.equal(safeEqual('abc', 'abcd'), false);
    assert.equal(safeEqual('', ''), true);
    assert.equal(safeEqual('a', 1), false);
  });
});

// ---------------------------------------------------------------------------
// worker.js — end to end with injected fetch + top lists
// ---------------------------------------------------------------------------

describe('worker', () => {
  const BASE = 'https://vapordep.example';

  /** Registry simulation shared by the route tests. */
  function registryFetch() {
    return mockFetch((url) => {
      if (url.startsWith('https://registry.npmjs.org/')) {
        const name = decodeURIComponent(url.slice('https://registry.npmjs.org/'.length));
        if (['express', 'lodash', 'react', 'lodahs', 'axios'].includes(name)) {
          return {
            name,
            description: `${name} package`,
            'dist-tags': { latest: '1.0.0' },
            versions: { '1.0.0': { repository: { url: `git+https://github.com/org/${name}.git` } } },
            time: { created: OLD_DATE, modified: OLD_DATE, '1.0.0': OLD_DATE },
          };
        }
        if (name === 'flaky') return new Response('upstream exploded', { status: 503 });
        return undefined;
      }
      if (url.startsWith('https://api.npmjs.org/')) return { downloads: 1_000_000 };
      if (url.startsWith('https://pypi.org/pypi/requests/')) {
        return { info: { summary: 'HTTP', project_urls: { Source: 'https://github.com/psf/requests' } }, releases: { '1.0': [{ upload_time_iso_8601: OLD_DATE }] } };
      }
      return undefined;
    });
  }

  const makeEnv = (fetch = registryFetch(), extra = {}) => ({
    __fetchImpl: fetch,
    __topLists: TOP,
    API_KEYS: 'pro-key-1,pro-key-2',
    RAPIDAPI_PROXY_SECRET: 'rapid-secret',
    ...extra,
  });

  const get = (pathname, env, init) => worker.fetch(new Request(`${BASE}${pathname}`, init), env);
  const post = (pathname, body, env, headers = {}) =>
    worker.fetch(
      new Request(`${BASE}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...headers },
        body: typeof body === 'string' ? body : JSON.stringify(body),
      }),
      env,
    );

  test('GET / describes the service', async () => {
    const res = await get('/', makeEnv());
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.match(res.headers.get('content-type'), /application\/json/);
    const body = await res.json();
    assert.equal(body.name, 'vapordep');
    assert.equal(body.version, '0.1.0');
    assert.equal(typeof body.description, 'string');
    assert.match(body.docs, /^https?:\/\//);
    assert.ok(Array.isArray(body.endpoints) && body.endpoints.length >= 3);
    assert.deepEqual(body.endpoints.map((e) => `${e.method} ${e.path}`), ['GET /v1/health', 'GET /v1/check', 'POST /v1/batch']);
    assert.deepEqual(body.ecosystems, [...ECOSYSTEMS]);
  });

  test('GET / honours env.DOCS_URL', async () => {
    const body = await (await get('/', makeEnv(undefined, { DOCS_URL: 'https://docs.example/vapordep' }))).json();
    assert.equal(body.docs, 'https://docs.example/vapordep');
  });

  test('OPTIONS preflight returns CORS headers', async () => {
    const res = await get('/v1/batch', makeEnv(), {
      method: 'OPTIONS',
      headers: { origin: 'https://app.example', 'access-control-request-method': 'POST', 'access-control-request-headers': 'content-type, x-api-key' },
    });
    assert.equal(res.status, 204);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    assert.equal(res.headers.get('access-control-allow-methods'), 'GET, POST, OPTIONS');
    assert.equal(res.headers.get('access-control-allow-headers'), 'content-type, x-api-key');
  });

  test('GET /v1/health', async () => {
    const res = await get('/v1/health', makeEnv());
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
  });

  test('GET /v1/check — hallucinated near-miss is danger and cacheable', async () => {
    const fetch = registryFetch();
    const res = await get('/v1/check?name=reactt&ecosystem=npm', makeEnv(fetch));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('cache-control'), 'public, max-age=300');
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const v = await res.json();
    assert.equal(v.name, 'reactt');
    assert.equal(v.ecosystem, 'npm');
    assert.equal(v.exists, false);
    assert.equal(v.registry, null);
    assert.equal(v.risk.level, 'danger');
    assert.equal(v.risk.score, 90);
    assert.deepEqual(codes(v), ['NOT_FOUND', 'NEAR_MISS_TOP']);
    assert.deepEqual(v.suggestions, [{ name: 'react', distance: 1 }]);
    assert.deepEqual(fetch.urls(), ['https://registry.npmjs.org/reactt']);
  });

  test('GET /v1/check — existing package is ok with registry metadata', async () => {
    const res = await get('/v1/check?name=express&ecosystem=NPM', makeEnv());
    assert.equal(res.status, 200);
    const v = await res.json();
    assert.equal(v.ecosystem, 'npm');
    assert.equal(v.exists, true);
    assert.deepEqual(v.risk, { level: 'ok', score: 0, flags: [] });
    assert.equal(v.registry.repo, 'https://github.com/org/express');
    assert.equal(v.registry.downloadsWeekly, 1_000_000);
    assert.equal(v.registry.created, OLD_DATE);
  });

  test('GET /v1/check — typosquat of a top package is SHADOWS_TOP', async () => {
    const v = await (await get('/v1/check?name=lodahs&ecosystem=npm', makeEnv())).json();
    assert.equal(v.exists, true);
    assert.deepEqual(codes(v), ['SHADOWS_TOP']);
    assert.equal(v.risk.level, 'caution');
    assert.deepEqual(v.suggestions, [{ name: 'lodash', distance: 2 }]);
  });

  test('GET /v1/check — pypi and scoped npm names pass through the query string', async () => {
    const py = await (await get('/v1/check?name=requests&ecosystem=pypi', makeEnv())).json();
    assert.equal(py.exists, true);
    assert.equal(py.risk.level, 'ok');
    const scoped = await (await get(`/v1/check?name=${encodeURIComponent('@babel/nope')}&ecosystem=npm`, makeEnv())).json();
    assert.equal(scoped.name, '@babel/nope');
    assert.equal(scoped.exists, false);
    assert.deepEqual(codes(scoped), ['NOT_FOUND', 'NEAR_MISS_TOP']);
    assert.deepEqual(scoped.suggestions, [{ name: '@babel/core', distance: 2 }]);
  });

  test('GET /v1/check — invalid name short-circuits without touching the registry', async () => {
    const fetch = registryFetch();
    const res = await get('/v1/check?name=React&ecosystem=npm', makeEnv(fetch));
    assert.equal(res.status, 200);
    const v = await res.json();
    assert.deepEqual(codes(v), ['INVALID_NAME']);
    assert.equal(v.risk.score, 100);
    assert.deepEqual(v.suggestions, [{ name: 'react', distance: 1 }]);
    assert.equal(fetch.calls.length, 0);
  });

  test('GET /v1/check — validation errors are 400 JSON', async () => {
    const missingName = await get('/v1/check?ecosystem=npm', makeEnv());
    assert.equal(missingName.status, 400);
    assert.equal(missingName.headers.get('cache-control'), 'no-store');
    assert.deepEqual(Object.keys((await missingName.json()).error), ['code', 'message']);

    const missingEco = await get('/v1/check?name=react', makeEnv());
    assert.equal(missingEco.status, 400);
    assert.equal((await missingEco.json()).error.code, 'MISSING_ECOSYSTEM');

    const badEco = await get('/v1/check?name=react&ecosystem=maven', makeEnv());
    assert.equal(badEco.status, 400);
    const err = (await badEco.json()).error;
    assert.equal(err.code, 'INVALID_ECOSYSTEM');
    assert.match(err.message, /npm, pypi, crates, rubygems, packagist, go/);
  });

  test('GET /v1/check — registry outage is 502 UPSTREAM', async () => {
    const res = await get('/v1/check?name=flaky&ecosystem=npm', makeEnv());
    assert.equal(res.status, 502);
    const body = await res.json();
    assert.equal(body.error.code, 'UPSTREAM');
    assert.match(body.error.message, /503/);

    const offline = await get('/v1/check?name=express&ecosystem=npm', makeEnv(async () => { throw new Error('ECONNRESET'); }));
    assert.equal(offline.status, 502);
    assert.equal((await offline.json()).error.code, 'UPSTREAM');
  });

  test('POST /v1/batch — free tier returns verdicts in order and dedupes lookups', async () => {
    const fetch = registryFetch();
    const res = await post('/v1/batch', { packages: [
      { name: 'express', ecosystem: 'npm' },
      { name: 'reactt', ecosystem: 'npm' },
      { name: 'requests', ecosystem: 'pypi' },
      { name: 'React', ecosystem: 'npm' },
      { name: 'express', ecosystem: 'npm' },
    ] }, makeEnv(fetch));
    assert.equal(res.status, 200);
    assert.equal(res.headers.get('access-control-allow-origin'), '*');
    const body = await res.json();
    assert.equal(body.tier, 'free');
    assert.equal(body.results.length, 5);
    assert.deepEqual(body.results.map((r) => `${r.ecosystem}:${r.name}:${r.risk.level}`), [
      'npm:express:ok',
      'npm:reactt:danger',
      'pypi:requests:ok',
      'npm:React:danger',
      'npm:express:ok',
    ]);
    assert.deepEqual(body.results[0], body.results[4]);
    assert.equal(fetch.urls().filter((u) => u === 'https://registry.npmjs.org/express').length, 1, 'duplicate entries share one lookup');
  });

  test('POST /v1/batch — free tier limit is 10 (402 BATCH_LIMIT), pro allows up to 100', async () => {
    const packages = Array.from({ length: 11 }, (_, i) => ({ name: `pkg-${i}`, ecosystem: 'npm' }));
    const denied = await post('/v1/batch', { packages }, makeEnv());
    assert.equal(denied.status, 402);
    const err = (await denied.json()).error;
    assert.equal(err.code, 'BATCH_LIMIT');
    assert.match(err.message, /11/);
    assert.match(err.message, /10/);

    const viaKey = await post('/v1/batch', { packages }, makeEnv(), { 'x-api-key': 'pro-key-2' });
    assert.equal(viaKey.status, 200);
    const viaKeyBody = await viaKey.json();
    assert.equal(viaKeyBody.tier, 'pro');
    assert.equal(viaKeyBody.results.length, 11);
    assert.ok(viaKeyBody.results.every((r) => r.exists === false && r.risk.level === 'danger'));

    const viaRapid = await post('/v1/batch', { packages }, makeEnv(), { 'x-rapidapi-proxy-secret': 'rapid-secret' });
    assert.equal(viaRapid.status, 200);
    assert.equal((await viaRapid.json()).tier, 'pro');

    const exactlyTen = await post('/v1/batch', { packages: packages.slice(0, 10) }, makeEnv());
    assert.equal(exactlyTen.status, 200);

    const hundredOne = Array.from({ length: 101 }, (_, i) => ({ name: `pkg-${i}`, ecosystem: 'npm' }));
    const proDenied = await post('/v1/batch', { packages: hundredOne }, makeEnv(), { 'x-api-key': 'pro-key-1' });
    assert.equal(proDenied.status, 402);
    assert.equal((await proDenied.json()).error.code, 'BATCH_LIMIT');

    const wrongKey = await post('/v1/batch', { packages }, makeEnv(), { 'x-api-key': 'nope' });
    assert.equal(wrongKey.status, 402);
  });

  test('POST /v1/batch — malformed input is 400', async () => {
    const invalidJson = await post('/v1/batch', '{"packages": [', makeEnv());
    assert.equal(invalidJson.status, 400);
    assert.equal((await invalidJson.json()).error.code, 'INVALID_JSON');

    const noPackages = await post('/v1/batch', { items: [] }, makeEnv());
    assert.equal(noPackages.status, 400);
    assert.equal((await noPackages.json()).error.code, 'BAD_REQUEST');

    const empty = await post('/v1/batch', { packages: [] }, makeEnv());
    assert.equal(empty.status, 400);

    const badEntry = await post('/v1/batch', { packages: [{ name: 'react', ecosystem: 'npm' }, { name: '', ecosystem: 'npm' }] }, makeEnv());
    assert.equal(badEntry.status, 400);
    assert.match((await badEntry.json()).error.message, /packages\[1\]/);

    const badEco = await post('/v1/batch', { packages: [{ name: 'react', ecosystem: 'maven' }] }, makeEnv());
    assert.equal(badEco.status, 400);
    assert.equal((await badEco.json()).error.code, 'INVALID_ECOSYSTEM');

    const notObject = await post('/v1/batch', { packages: ['react'] }, makeEnv());
    assert.equal(notObject.status, 400);

    const arrayBody = await post('/v1/batch', [1, 2], makeEnv());
    assert.equal(arrayBody.status, 400);
  });

  test('POST /v1/batch — bodies over 100KB are rejected with 413', async () => {
    const fetch = registryFetch();
    const huge = { packages: [{ name: 'a'.repeat(120 * 1024), ecosystem: 'npm' }] };
    const res = await post('/v1/batch', huge, makeEnv(fetch));
    assert.equal(res.status, 413);
    assert.equal((await res.json()).error.code, 'PAYLOAD_TOO_LARGE');
    assert.equal(fetch.calls.length, 0);
  });

  test('POST /v1/batch — an upstream failure surfaces as 502', async () => {
    const res = await post('/v1/batch', { packages: [{ name: 'express', ecosystem: 'npm' }, { name: 'flaky', ecosystem: 'npm' }] }, makeEnv());
    assert.equal(res.status, 502);
    assert.equal((await res.json()).error.code, 'UPSTREAM');
  });

  test('unknown routes are 404 JSON, wrong methods are 405', async () => {
    const missing = await get('/v2/nope', makeEnv());
    assert.equal(missing.status, 404);
    const body = await missing.json();
    assert.equal(body.error.code, 'NOT_FOUND');
    assert.equal(missing.headers.get('access-control-allow-origin'), '*');

    const wrongMethod = await post('/v1/check', {}, makeEnv());
    assert.equal(wrongMethod.status, 405);
    assert.equal((await wrongMethod.json()).error.code, 'METHOD_NOT_ALLOWED');
    assert.match(wrongMethod.headers.get('allow'), /GET/);

    const getBatch = await get('/v1/batch', makeEnv());
    assert.equal(getBatch.status, 405);
  });

  test('trailing slashes are tolerated', async () => {
    const res = await get('/v1/health/', makeEnv());
    assert.equal(res.status, 200);
  });

  test('works with an undefined env (plain Node usage)', async () => {
    const res = await worker.fetch(new Request(`${BASE}/v1/health`));
    assert.equal(res.status, 200);
  });
});

// ---------------------------------------------------------------------------
// data/top-lists.mjs — integration check, skipped until the data file exists
// ---------------------------------------------------------------------------

const TOP_LISTS_PATH = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../data/top-lists.mjs');

test('data/top-lists.mjs has the expected shape', { skip: !existsSync(TOP_LISTS_PATH) && 'data/top-lists.mjs not present' }, async () => {
  const { default: lists } = await import(pathToFileURL(TOP_LISTS_PATH).href);
  assert.equal(typeof lists, 'object');
  for (const eco of ECOSYSTEMS) {
    assert.ok(Array.isArray(lists[eco]) && lists[eco].length > 0, `${eco} list must be a non-empty array`);
    for (const name of lists[eco]) {
      assert.equal(typeof name, 'string', `${eco}: entries must be strings`);
      assert.equal(name, name.toLowerCase(), `${eco}: "${name}" must be lowercase`);
      assert.ok(validateName(eco, name), `${eco}: "${name}" must pass validateName`);
    }
  }
});

// ---------------------------------------------------------------------------
// Canonical spellings, Go path hardening and upstream size caps
// ---------------------------------------------------------------------------

describe('canonical names', () => {
  const lists = { pypi: ['typing-extensions', 'importlib-metadata', 'requests', 'python-dateutil'], crates: ['serde_json', 'proc-macro2', 'serde'] };

  test('canonicalName follows PEP 503 for pypi and "-" ≡ "_" for crates', () => {
    assert.equal(canonicalName('pypi', 'Typing_Extensions'), 'typing-extensions');
    assert.equal(canonicalName('pypi', 'zope.interface'), 'zope-interface');
    assert.equal(canonicalName('pypi', 'a__b--c..d'), 'a-b-c-d');
    assert.equal(canonicalName('crates', 'serde-json'), 'serde_json');
    assert.equal(canonicalName('crates', 'Proc_Macro2'), 'proc_macro2');
    assert.equal(canonicalName('npm', 'react'), 'react');
    assert.equal(canonicalName('go', 'github.com/Azure/x'), 'github.com/azure/x');
  });

  test('a popular PyPI package written with underscores is itself, not a typosquat', async () => {
    for (const name of ['typing_extensions', 'importlib_metadata', 'python_dateutil', 'Typing.Extensions']) {
      const v = await checkPackage({ name, ecosystem: 'pypi', client: stubClient(cleanRegistry()), topLists: lists, now: NOW });
      assert.equal(v.name, name);
      assert.deepEqual(v.risk, { level: 'ok', score: 0, flags: [] }, name);
      assert.deepEqual(v.suggestions, []);
    }
    const crate = await checkPackage({ name: 'serde-json', ecosystem: 'crates', client: stubClient(cleanRegistry()), topLists: lists, now: NOW });
    assert.deepEqual(crate.risk.flags, []);
    assert.deepEqual(crate.suggestions, []);
  });

  test('capitalised near misses on case-insensitive registries still match (suggestions use the list spelling)', async () => {
    const v = await checkPackage({ name: 'Reqeusts', ecosystem: 'pypi', client: stubClient({ exists: false }), topLists: lists });
    assert.deepEqual(v.risk.flags.map((f) => f.code), ['NOT_FOUND', 'NEAR_MISS_TOP']);
    assert.equal(v.risk.score, 90);
    assert.deepEqual(v.suggestions, [{ name: 'requests', distance: 2 }]);

    const shadow = await checkPackage({ name: 'serde-jsn', ecosystem: 'crates', client: stubClient(cleanRegistry()), topLists: lists, now: NOW });
    assert.deepEqual(shadow.risk.flags.map((f) => f.code), ['SHADOWS_TOP']);
    assert.deepEqual(shadow.suggestions, [{ name: 'serde_json', distance: 1 }]);

    assert.deepEqual(topMatches('pypi', 'typing_extensions', lists.pypi), { inTop: true, suggestions: [] });
    assert.deepEqual(topMatches('pypi', 'typing_extension', lists.pypi), { inTop: false, suggestions: [{ name: 'typing-extensions', distance: 1 }] });
  });

  test('invalid names are still compared as written', async () => {
    const v = await checkPackage({ name: 'React', ecosystem: 'npm', client: stubClient({ exists: false }), topLists: TOP });
    assert.deepEqual(v.risk.flags.map((f) => f.code), ['INVALID_NAME']);
    assert.deepEqual(v.suggestions, [{ name: 'react', distance: 1 }]);
  });
});

describe('go path hardening', () => {
  test('dot segments and non-host first segments are rejected before any URL is built', async () => {
    for (const bad of ['github.com/../../anything/here', '../x', 'github.com/./foo/..', 'github.com/x/...', 'github.com/../x', '-a.com/x', 'a-.com/x', 'a..com/x', '.com/x', 'github.com./x']) {
      assert.equal(validateName('go', bad), false, bad);
      const fetch = mockFetch(() => ({ Version: 'v1.0.0' }));
      const v = await checkPackage({ name: bad, ecosystem: 'go', client: createRegistryClient(fetch), topLists: TOP });
      assert.deepEqual(v.risk.flags.map((f) => f.code), ['INVALID_NAME'], bad);
      assert.equal(fetch.calls.length, 0, `${bad} must not be fetched`);
    }
    for (const ok of ['github.com/x/y', 'gopkg.in/yaml.v3', 'go.uber.org/zap', 'k8s.io/api', 'github.com/x/y.v2', 'example.com/a/b/c', 'my-host.example.org/x']) {
      assert.equal(validateName('go', ok), true, ok);
    }
  });
});

describe('upstream body size cap', () => {
  const huge = () => '{"padding":"' + 'x'.repeat(MAX_UPSTREAM_BYTES + 16) + '"}';

  test('npm: an oversized packument falls back to the small /latest document', async () => {
    const fetch = mockFetch((url) => {
      if (url === 'https://registry.npmjs.org/typescript') return new Response(huge(), { status: 200 });
      if (url === 'https://registry.npmjs.org/typescript/latest') {
        return { name: 'typescript', description: 'TypeScript is a language', repository: { type: 'git', url: 'git+https://github.com/microsoft/TypeScript.git' } };
      }
      if (url.startsWith('https://api.npmjs.org/')) return { downloads: 12_345 };
      return undefined;
    });
    const r = await createRegistryClient(fetch).lookup('npm', 'typescript');
    assert.deepEqual(r, {
      exists: true,
      created: null,
      lastPublish: null,
      downloadsWeekly: 12_345,
      repo: 'https://github.com/microsoft/TypeScript',
      description: 'TypeScript is a language',
    });
    assert.deepEqual(fetch.urls(), [
      'https://registry.npmjs.org/typescript',
      'https://registry.npmjs.org/typescript/latest',
      'https://api.npmjs.org/downloads/point/last-week/typescript',
    ]);
  });

  test('npm: a declared content-length over the cap is enough to skip the body', async () => {
    const fetch = mockFetch((url) => {
      if (url === 'https://registry.npmjs.org/big') return new Response('{}', { status: 200, headers: { 'content-length': String(MAX_UPSTREAM_BYTES + 1) } });
      if (url === 'https://registry.npmjs.org/big/latest') return { repository: 'https://github.com/x/big' };
      return undefined;
    });
    const r = await createRegistryClient(fetch).lookup('npm', 'big');
    assert.equal(r.exists, true);
    assert.equal(r.repo, 'https://github.com/x/big');
  });

  test('other registries fail an oversized body with UPSTREAM instead of parsing it', async () => {
    const fetch = mockFetch(() => new Response(huge(), { status: 200 }));
    const client = createRegistryClient(fetch);
    await assert.rejects(client.lookup('pypi', 'enormous'), (err) => err.code === 'UPSTREAM' && /6 MB/.test(err.message));
    await assert.rejects(client.lookup('crates', 'enormous'), { code: 'UPSTREAM' });
  });

  test('bodies at or under the cap are parsed normally', async () => {
    const fetch = mockFetch(() => new Response(JSON.stringify({ info: { summary: 'ok' }, releases: {} }), { status: 200 }));
    const r = await createRegistryClient(fetch).lookup('pypi', 'small');
    assert.equal(r.exists, true);
    assert.equal(r.description, 'ok');
  });
});

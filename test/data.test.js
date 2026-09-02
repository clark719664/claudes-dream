// Structural checks for the top-package data. Fully offline.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import topLists from '../data/top-lists.mjs';
import { renderTopLists } from '../scripts/refresh-top-packages.mjs';

const ECOSYSTEMS = ['npm', 'pypi', 'crates', 'rubygems', 'packagist', 'go'];

const MIN_COUNT = { npm: 300, pypi: 300, crates: 150, rubygems: 150, packagist: 120, go: 100 };

const SENTINELS = {
  npm: ['react', 'express', 'lodash'],
  pypi: ['requests', 'numpy'],
  crates: ['serde'],
  rubygems: ['rails'],
  packagist: ['monolog/monolog'],
  go: ['github.com/gin-gonic/gin'],
};

// Lowercase form of the ecosystem naming rules from the build contract.
const FORMAT = {
  npm: (n) => n.length <= 214 && /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(n),
  pypi: (n) => n.length <= 100 && /^[a-z0-9]([a-z0-9._-]*[a-z0-9])?$/.test(n),
  crates: (n) => n.length <= 64 && /^[a-z][a-z0-9_-]*$/.test(n),
  rubygems: (n) => n.length <= 100 && /^[a-z0-9][a-z0-9._-]*$/.test(n),
  packagist: (n) => /^[a-z0-9]([_.-]?[a-z0-9]+)*\/[a-z0-9](([_.]|-{1,2})?[a-z0-9]+)*$/.test(n),
  go: (n) => n.length <= 255 && /^[a-z0-9.-]+(\/[a-z0-9._~-]+)+$/.test(n) && n.split('/')[0].includes('.'),
};

const dataDir = new URL('../data/', import.meta.url);

async function readJsonList(ecosystem) {
  return JSON.parse(await readFile(new URL(`top-${ecosystem}.json`, dataDir), 'utf8'));
}

for (const eco of ECOSYSTEMS) {
  test(`data/top-${eco}.json is a valid top list`, async () => {
    const list = await readJsonList(eco);

    assert.ok(Array.isArray(list), 'must be a JSON array');
    assert.ok(
      list.length >= MIN_COUNT[eco],
      `expected at least ${MIN_COUNT[eco]} ${eco} names, got ${list.length}`,
    );

    for (const name of list) {
      assert.equal(typeof name, 'string', `non-string entry: ${JSON.stringify(name)}`);
      assert.ok(name.length > 0, 'empty name');
      assert.equal(name, name.trim(), `untrimmed name: ${JSON.stringify(name)}`);
      assert.equal(name, name.toLowerCase(), `name is not lowercase: ${name}`);
      assert.ok(FORMAT[eco](name), `name violates ${eco} naming rules: ${name}`);
    }

    assert.equal(new Set(list).size, list.length, 'list contains duplicates');

    for (const sentinel of SENTINELS[eco]) {
      assert.ok(list.includes(sentinel), `expected sentinel "${sentinel}" in ${eco} list`);
    }
  });
}

test('data/top-lists.mjs default export has exactly the six ecosystems', () => {
  assert.deepEqual(Object.keys(topLists).sort(), [...ECOSYSTEMS].sort());
});

test('data/top-lists.mjs default export matches the JSON files exactly', async () => {
  for (const eco of ECOSYSTEMS) {
    assert.deepEqual(topLists[eco], await readJsonList(eco), `top-lists.mjs ${eco} differs from data/top-${eco}.json`);
  }
});

test('data/top-lists.mjs imports nothing and is byte-identical to the generator output', async () => {
  const source = await readFile(new URL('top-lists.mjs', dataDir), 'utf8');
  assert.doesNotMatch(source, /^\s*import\b/m, 'generated module must not import anything');

  const lists = {};
  for (const eco of ECOSYSTEMS) lists[eco] = await readJsonList(eco);
  assert.equal(source, renderTopLists(lists), 'data/top-lists.mjs is stale - run scripts/refresh-top-packages.mjs');
});

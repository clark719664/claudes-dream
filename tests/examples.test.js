import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeSpec } from '../shared/spec.js';

test('bundled examples are valid, normalized specs', () => {
  const names = JSON.parse(fs.readFileSync(new URL('../examples/index.json', import.meta.url)));
  assert.ok(names.length >= 5);
  for (const name of names) {
    const spec = JSON.parse(fs.readFileSync(new URL(`../examples/${name}.json`, import.meta.url)));
    const { spec: again, warnings } = normalizeSpec(spec);
    assert.equal(warnings.length, 0, `${name}: ${warnings.join('; ')}`);
    assert.deepEqual(normalizeSpec(again).spec, again, `${name} normalization is not idempotent`);
  }
});

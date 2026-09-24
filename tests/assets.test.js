import test from 'node:test';
import assert from 'node:assert/strict';
import { assetRequest, semanticAssetKey, qualityBudget } from '../shared/assets.js';

test('semantic asset keys are stable regardless of object key order', () => {
  const a = semanticAssetKey({ style: { b: 2, a: 1 }, description: 'mossy ruin' });
  const b = semanticAssetKey({ description: 'mossy ruin', style: { a: 1, b: 2 } });
  assert.equal(a, b);
});

test('different semantic assets receive different keys', () => {
  assert.notEqual(
    semanticAssetKey({ description: 'oak tree' }),
    semanticAssetKey({ description: 'alien crystal tree' }),
  );
});

test('asset requests clamp importance and preserve a procedural fallback', () => {
  const r = assetRequest({ description: 'hero sword', importance: 99, fallback: { shape: 'box' } });
  assert.equal(r.importance, 1);
  assert.deepEqual(r.fallback, { shape: 'box' });
  assert.match(r.key, /^rv1-/);
});

test('quality budgets increase monotonically', () => {
  const tiers = ['low', 'medium', 'high', 'ultra'].map(qualityBudget);
  for (let i = 1; i < tiers.length; i++) {
    assert.ok(tiers[i].texture >= tiers[i - 1].texture);
    assert.ok(tiers[i].triangles >= tiers[i - 1].triangles);
    assert.ok(tiers[i].memoryMB >= tiers[i - 1].memoryMB);
  }
});

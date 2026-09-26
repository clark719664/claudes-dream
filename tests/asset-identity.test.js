import test from 'node:test';
import assert from 'node:assert/strict';
import { assetRequest } from '../shared/assets.js';

test('fallback geometry does not change semantic asset identity', () => {
  const common = { kind:'mesh', archetype:'prop', description:'brass lantern', seed:7 };
  const first = assetRequest({ ...common, fallback:{shape:'box'} });
  const second = assetRequest({ ...common, fallback:{shape:'sphere'} });
  assert.equal(first.key, second.key);
});

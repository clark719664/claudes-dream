import test from 'node:test';
import assert from 'node:assert/strict';
import { assetRequest } from '../shared/assets.js';
import { requestAssetJob } from '../server/assets.js';

test('asset service accepts a correctly keyed semantic request', () => {
  const request = assetRequest({ kind:'mesh', archetype:'prop', description:'weathered iron lantern', seed:42 });
  const job = requestAssetJob(request.key, request, 'high');
  assert.equal(job.key, request.key);
  assert.equal(job.quality, 'high');
});
test('asset service rejects tampered semantic requests', () => {
  const request = assetRequest({ kind:'mesh', archetype:'prop', description:'weathered iron lantern', seed:43 });
  assert.throws(() => requestAssetJob('rv1-tampered', request, 'ultra'), /key mismatch/);
});

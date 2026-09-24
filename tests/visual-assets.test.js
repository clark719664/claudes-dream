import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpec } from '../shared/spec.js';
import { prefabAssetRequest, collectAssetRequests } from '../engine/assets/requests.js';

test('legacy prefabs remain procedural and backwards compatible', () => {
  const { spec } = normalizeSpec({ prefabs: [{ id:'crate', shape:'box', color:'#885522', emissive:0, metallic:0, roughness:.8, size:[1,1,1], solid:true, behaviors:[] }] });
  assert.equal(spec.prefabs[0].visual.archetype, 'primitive');
  assert.equal(prefabAssetRequest(spec.prefabs[0], spec.seed), null);
});

test('semantic visuals become deterministic enhancement requests', () => {
  const { spec } = normalizeSpec({ prefabs: [{
    id:'forge', shape:'box', color:'#665544', emissive:1, metallic:.5, roughness:.7, size:[4,3,3], solid:true, behaviors:[],
    visual:{ archetype:'architecture', description:'ancient moss-covered dwarven forge', surface:'stone', detail:.9, variation:.15 }
  }] });
  const a = collectAssetRequests(spec)[0];
  const b = collectAssetRequests(spec)[0];
  assert.equal(a.key, b.key);
  assert.equal(a.archetype, 'architecture');
  assert.equal(a.style.surface, 'stone');
  assert.equal(a.fallback.shape, 'box');
});

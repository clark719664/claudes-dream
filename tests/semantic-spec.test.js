import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpec } from '../shared/spec.js';

test('semantic prefab visual survives normalization with bounded values', () => {
  const { spec } = normalizeSpec({ prefabs: [{
    id:'forge', shape:'box', color:'#665544', emissive:0, metallic:.5, roughness:.7,
    size:[4,3,3], solid:true, behaviors:[],
    visual:{ archetype:'architecture', description:'ancient moss-covered dwarven forge', surface:'stone', detail:5, variation:-2 }
  }] });
  assert.deepEqual(spec.prefabs[0].visual, {
    archetype:'architecture', description:'ancient moss-covered dwarven forge',
    surface:'stone', detail:1, variation:0
  });
});

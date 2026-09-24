import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeAssetManifest } from '../engine/assets/manifest.js';

test('PBR manifest is bounded and preserves supported texture channels', () => {
  const m = normalizeAssetManifest({
    key:'rv1-test', format:'glb', url:'/assets/forge.glb', bytes:1234,
    material:{
      baseColorFactor:[1,.5,.25,1], metallicFactor:2, roughnessFactor:-1,
      emissiveFactor:[2,1,0], normalScale:9, occlusionStrength:.7,
      textures:{baseColor:'/a.ktx2',normal:'/n.ktx2',metallicRoughness:'/mr.ktx2',junk:'/bad'}
    }
  }, 'rv1-test');
  assert.equal(m.material.metallicFactor, 1);
  assert.equal(m.material.roughnessFactor, .02);
  assert.equal(m.material.normalScale, 4);
  assert.equal(m.material.textures.junk, undefined);
  assert.equal(m.material.textures.normal, '/n.ktx2');
});
test('manifest key mismatch is rejected', () => {
  assert.throws(() => normalizeAssetManifest({key:'wrong',format:'glb',url:'/x.glb'}, 'right'), /key mismatch/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { GpuScene, INSTANCE_FLOATS } from '../engine/render/scene.js';

test('replaceBatchMesh changes mesh and refreshes instance bounds before build', () => {
  const scene = Object.create(GpuScene.prototype);
  scene.meshes = new Map([
    ['fallback', { key:'fallback', radius:1 }],
    ['enhanced', { key:'enhanced', radius:3 }],
  ]);
  scene.batches = [{ id:0, mesh:scene.meshes.get('fallback'), count:1 }];
  scene.count = 1;
  scene.built = false;
  scene.data = new Float32Array(INSTANCE_FLOATS);
  scene.data[0]=scene.data[5]=scene.data[10]=scene.data[15]=1;
  scene.data[27]=0;
  scene.dirtyMin=Infinity; scene.dirtyMax=-1;
  assert.equal(scene.replaceBatchMesh(0, 'enhanced'), true);
  assert.equal(scene.batches[0].mesh.key, 'enhanced');
  assert.equal(scene.replaceBatchMesh(0, 'missing'), false);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { gltfToGeo } from '../engine/assets/gltf.js';

test('glTF triangle geometry converts to Reverie packed geometry', () => {
  const positions = new Float32Array([0,0,0, 1,0,0, 0,1,0]);
  const indices = new Uint16Array([0,1,2]);
  const bin = new ArrayBuffer(positions.byteLength + indices.byteLength);
  new Float32Array(bin, 0, positions.length).set(positions);
  new Uint16Array(bin, positions.byteLength, indices.length).set(indices);
  const gltf = {
    bufferViews: [
      { buffer: 0, byteOffset: 0, byteLength: positions.byteLength },
      { buffer: 0, byteOffset: positions.byteLength, byteLength: indices.byteLength },
    ],
    accessors: [
      { bufferView: 0, componentType: 5126, count: 3, type: 'VEC3' },
      { bufferView: 1, componentType: 5123, count: 3, type: 'SCALAR' },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
  };
  const geo = gltfToGeo(gltf, bin);
  assert.equal(geo.vertexCount, 3);
  assert.equal(geo.indices.length, 3);
  assert.ok(geo.radius >= 1);
});

// Registers the heightfield as GPU-displaced terrain chunks with three LODs.
import { terrainChunk } from './meshes.js';
import { CHUNK_QUADS } from '../world/terrain.js';
import { KIND } from './scene.js';

const LODS = [
  { step: 1, min: 0, max: 90 },
  { step: 2, min: 90, max: 220 },
  { step: 4, min: 220, max: 1e9 },
];

export function addTerrain(scene, heightfield) {
  for (const lod of LODS) {
    const key = `terrain:${lod.step}`;
    scene.addMesh(key, terrainChunk(CHUNK_QUADS, lod.step));
    const batch = scene.addBatch(key, { minDist: lod.min, maxDist: lod.max, shadows: true, label: key });
    for (const chunk of heightfield.chunkList()) {
      const i = scene.addInstance(batch);
      const m = scene.instance(i);
      m.fill(0);
      m[0] = m[5] = m[10] = m[15] = 1;
      m[12] = chunk.i0; m[14] = chunk.j0;
      m[16] = 1; m[17] = 1; m[18] = 1; m[19] = 0;   // color / metallic
      m[23] = 0.9;                                   // roughness
      m[24] = KIND.terrain; m[27] = batch;
      m[28] = chunk.center[0]; m[29] = chunk.center[1]; m[30] = chunk.center[2]; m[31] = chunk.radius;
    }
  }
}

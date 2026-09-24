import test from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield, CHUNK_QUADS } from '../engine/world/terrain.js';

const STYLES = ['hills', 'mountains', 'islands', 'canyon', 'dunes', 'flat', 'terraces'];

test('heightfields are finite, normalised and cover the render area', () => {
  for (const style of STYLES) {
    const hf = new Heightfield({ style, size: 140, height: 20, roughness: 0.5 }, 11, [0, 0]);
    assert.equal((hf.res - 1) % CHUNK_QUADS, 0);
    assert.ok(hf.worldSize >= hf.playSize * 1.6);
    let min = Infinity;
    for (const h of hf.heights) { assert.ok(Number.isFinite(h)); min = Math.min(min, h); }
    assert.equal(min, 0);
  }
});

test('heightAt matches grid vertices and interpolates inside triangles', () => {
  const hf = new Heightfield({ style: 'hills', size: 100, height: 15, roughness: 0.5 }, 3, [0, 0]);
  for (const [i, j] of [[10, 10], [40, 77], [120, 5]]) {
    const x = hf.origin + i * hf.spacing, z = hf.origin + j * hf.spacing;
    assert.ok(Math.abs(hf.heightAt(x, z) - hf.heights[j * hf.res + i]) < 1e-4);
  }
  const x = hf.origin + 20.3 * hf.spacing, z = hf.origin + 20.7 * hf.spacing;
  const corners = [[20, 20], [21, 20], [20, 21], [21, 21]].map(([i, j]) => hf.heights[j * hf.res + i]);
  const h = hf.heightAt(x, z);
  assert.ok(h >= Math.min(...corners) - 1e-4 && h <= Math.max(...corners) + 1e-4);
});

test('spawn area is flattened', () => {
  const hf = new Heightfield({ style: 'mountains', size: 140, height: 40, roughness: 0.7 }, 5, [10, -10]);
  const center = hf.heightAt(10, -10);
  for (const [dx, dz] of [[3, 0], [0, 3], [-3, -2]]) assert.ok(Math.abs(hf.heightAt(10 + dx, -10 + dz) - center) < 0.8);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeSpec, decodeSpec } from '../shared/share.js';
import { designFromPrompt } from '../shared/designer.js';

test('share links round-trip and stay small', async () => {
  const spec = designFromPrompt('neon cyberpunk rooftop parkour');
  const packed = await encodeSpec(spec);
  assert.match(packed, /^[A-Za-z0-9_-]+$/);
  assert.ok(packed.length < 6000, `link too long: ${packed.length}`);
  assert.deepEqual(await decodeSpec(packed), spec);
});

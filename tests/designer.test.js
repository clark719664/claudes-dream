import test from 'node:test';
import assert from 'node:assert/strict';
import { designFromPrompt, refineSpec, analyzePrompt } from '../shared/designer.js';
import { normalizeSpec } from '../shared/spec.js';

const PROMPTS = [
  'A cozy forest coin hunt at sunset',
  'neon cyberpunk rooftop parkour, hard',
  'survive the zombie horde in a haunted graveyard',
  'race across tropical islands',
  'collect stars on an alien planet',
  'lava volcano escape with fireballs',
  'snowy mountain exploration',
  'treasure hunt in ancient desert ruins',
  '',
];

test('every prompt yields a valid, playable, stable spec', () => {
  for (const p of PROMPTS) {
    const spec = designFromPrompt(p);
    const again = normalizeSpec(spec);
    assert.equal(again.warnings.length, 0, `"${p}" produced warnings: ${again.warnings}`);
    assert.deepEqual(again.spec, spec);
    assert.ok(spec.title.length > 0);
    if (spec.rules.goal === 'collect') assert.ok(spec.rules.targetScore > 0);
    if (spec.rules.goal === 'reach') assert.ok(spec.prefabs.some((x) => x.behaviors.some((b) => b.type === 'goal')));
  }
});

test('same prompt, same game (deterministic)', () => {
  assert.deepEqual(designFromPrompt('a spooky swamp'), designFromPrompt('a spooky swamp'));
});

test('prompt analysis picks theme and genre', () => {
  assert.equal(analyzePrompt('neon cyberpunk rooftop parkour').genre, 'platformer');
  assert.equal(analyzePrompt('neon cyberpunk rooftop parkour').theme, 'neon');
  assert.equal(analyzePrompt('survive the zombie horde').genre, 'survive');
  assert.equal(analyzePrompt('a snowy mountain').theme, 'snow');
  assert.equal(analyzePrompt('start the race').theme, 'meadow', '"start" must not match "star"');
  assert.equal(analyzePrompt('at midnight').time, 23);
});

test('refinements apply recognisable edits', () => {
  const base = designFromPrompt('forest coin hunt');
  const night = refineSpec(base, 'make it night');
  assert.equal(night.spec.environment.timeOfDay, 23);
  const snowy = refineSpec(base, 'turn it into a snowy winter wonderland');
  assert.equal(snowy.spec.environment.particles, 'snow');
  const fp = refineSpec(base, 'first person please');
  assert.equal(fp.spec.player.camera, 'first');
  const nothing = refineSpec(base, 'xyzzy');
  assert.match(nothing.changes[0], /no recognised changes/);
});

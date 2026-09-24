import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSpec, defaultSpec, GAME_SPEC_SCHEMA, LIMITS, availablePoints } from '../shared/spec.js';

test('garbage input becomes the default spec', () => {
  for (const input of [null, undefined, 42, 'hello', [], { title: 7 }]) {
    const { spec } = normalizeSpec(input);
    assert.equal(spec.version, 1);
    assert.equal(typeof spec.title, 'string');
    assert.ok(spec.terrain.size >= 60);
  }
});

test('numbers are clamped and reported', () => {
  const { spec, warnings } = normalizeSpec({ terrain: { size: 99999, height: -5 }, player: { speed: 1000, lives: 0 } });
  assert.equal(spec.terrain.size, 400);
  assert.equal(spec.terrain.height, 0);
  assert.equal(spec.player.speed, 20);
  assert.equal(spec.player.lives, 1);
  assert.ok(warnings.length >= 4);
});

test('colors accept names, short hex and reject junk', () => {
  const { spec } = normalizeSpec({ player: { color: 'gold' }, water: { color: '#abc' }, terrain: { palette: { low: 'not-a-color' } } });
  assert.equal(spec.player.color, '#ffc526');
  assert.equal(spec.water.color, '#aabbcc');
  assert.equal(spec.terrain.palette.low, defaultSpec().terrain.palette.low);
});

test('unknown prefab references are dropped', () => {
  const { spec, warnings } = normalizeSpec({
    prefabs: [{ id: 'Gold Coin!', shape: 'coin', behaviors: [{ type: 'collectible', value: 5 }] }],
    placements: [{ prefab: 'gold_coin', position: [1, 1, 1] }, { prefab: 'ghost', position: [0, 0, 0] }],
  });
  assert.equal(spec.prefabs[0].id, 'gold_coin');
  assert.equal(spec.placements.length, 1);
  assert.ok(warnings.some((w) => w.includes('ghost')));
});

test('entity budget is enforced', () => {
  const { spec } = normalizeSpec({
    prefabs: [{ id: 'a', shape: 'sphere' }],
    spawns: Array.from({ length: 30 }, () => ({ prefab: 'a', count: 200 })),
  });
  const total = spec.spawns.reduce((n, s) => n + s.count, 0);
  assert.ok(total <= LIMITS.entities);
});

test('unwinnable rules are repaired', () => {
  const collect = normalizeSpec({ rules: { goal: 'collect' } }).spec;
  assert.equal(collect.rules.goal, 'score');
  const reach = normalizeSpec({ rules: { goal: 'reach' } }).spec;
  assert.ok(reach.prefabs.some((p) => p.behaviors.some((b) => b.type === 'goal')));
  const survive = normalizeSpec({ rules: { goal: 'survive', timeLimit: 0 } }).spec;
  assert.ok(survive.rules.timeLimit > 0);
  const tooMany = normalizeSpec({
    prefabs: [{ id: 'c', shape: 'coin', behaviors: [{ type: 'collectible', value: 10 }] }],
    placements: [{ prefab: 'c', position: [0, 1, 0] }],
    rules: { goal: 'collect', targetScore: 500 },
  }).spec;
  assert.equal(tooMany.rules.targetScore, availablePoints(tooMany));
});

test('normalization is idempotent', () => {
  const once = normalizeSpec({ title: 'X', prefabs: [{ id: 'p', shape: 'box', solid: true }], placements: [{ prefab: 'p', position: [3, 0, 3] }], rules: { goal: 'reach' } });
  const twice = normalizeSpec(once.spec);
  assert.deepEqual(twice.spec, once.spec);
  assert.equal(twice.warnings.length, 0);
});

test('schema is compatible with structured outputs', () => {
  const visit = (node, path) => {
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false, `${path} must forbid additional properties`);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort(), `${path} must require every property`);
      for (const [k, v] of Object.entries(node.properties)) visit(v, `${path}.${k}`);
    }
    if (node.type === 'array') visit(node.items, `${path}[]`);
    for (const banned of ['minimum', 'maximum', 'minLength', 'maxLength', 'minItems', 'maxItems']) assert.ok(!(banned in node), `${path} uses unsupported ${banned}`);
  };
  visit(GAME_SPEC_SCHEMA, 'spec');
});

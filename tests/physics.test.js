import test from 'node:test';
import assert from 'node:assert/strict';
import { Heightfield } from '../engine/world/terrain.js';
import { Physics } from '../engine/game/physics.js';

const flat = () => new Heightfield({ style: 'flat', size: 100, height: 0, roughness: 0 }, 1, [0, 0]);
const character = (pos) => ({ pos, vel: [0, 0, 0], radius: 0.4, height: 1.8 });
const run = (physics, c, frames, gravity = 26) => {
  for (let i = 0; i < frames; i++) { c.vel[1] -= gravity / 60; physics.moveCharacter(c, 1 / 60); }
};

test('falls onto the terrain and becomes grounded', () => {
  const p = new Physics(flat());
  const c = character([0, 10, 0]);
  run(p, c, 120);
  assert.ok(c.grounded);
  assert.ok(Math.abs(c.pos[1] - p.groundAt(0, 0)) < 1e-3);
});

test('lands on top of a box and is blocked by its side', () => {
  const p = new Physics(flat());
  const g = p.groundAt(5, 0);
  p.addStatic({ min: [4, g, -1], max: [6, g + 2, 1] });
  const top = character([5, g + 5, 0]);
  run(p, top, 120);
  assert.ok(Math.abs(top.pos[1] - (g + 2)) < 1e-3, 'should stand on the box');
  const side = character([2, g, 0]);
  for (let i = 0; i < 60; i++) { side.vel[0] = 5; side.vel[1] -= 26 / 60; p.moveCharacter(side, 1 / 60); }
  assert.ok(side.pos[0] <= 4 - 0.4 + 1e-3, 'should be stopped by the wall');
});

test('steps up small ledges', () => {
  const p = new Physics(flat());
  const g = p.groundAt(3, 0);
  p.addStatic({ min: [3, g - 1, -2], max: [8, g + 0.3, 2] });
  const c = character([1, g, 0]);
  for (let i = 0; i < 60; i++) { c.vel[0] = 4; c.vel[1] -= 26 / 60; p.moveCharacter(c, 1 / 60); }
  assert.ok(c.pos[0] > 3.5 && c.pos[1] >= g + 0.29);
});

test('moving platforms carry the character', () => {
  const p = new Physics(flat());
  const g = p.groundAt(0, 0);
  const platform = { delta: [0, 0, 0] };
  const box = p.addDynamic({ min: [-2, g + 1, -2], max: [2, g + 1.5, 2], entity: platform });
  const c = character([0, g + 3, 0]);
  run(p, c, 60);
  assert.equal(c.ground, platform);
  platform.delta = [0.05, 0, 0];
  for (let i = 0; i < 20; i++) {
    box.min[0] += 0.05; box.max[0] += 0.05;
    c.vel[1] -= 26 / 60;
    p.moveCharacter(c, 1 / 60);
  }
  assert.ok(c.pos[0] > 0.9, `carried to ${c.pos[0]}`);
});

test('stays inside the world bounds', () => {
  const p = new Physics(flat());
  const c = character([0, p.groundAt(0, 0), 0]);
  for (let i = 0; i < 600; i++) { c.vel[0] = 30; c.vel[1] -= 26 / 60; p.moveCharacter(c, 1 / 60); }
  assert.ok(c.pos[0] <= 50);
});

// Headless gameplay simulation: the real world builder, physics, behaviours
// and rules, with a stand-in renderer so no GPU is needed.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildWorld } from '../engine/game/builder.js';
import { Game } from '../engine/game/game.js';
import { CameraRig } from '../engine/game/camera.js';
import { normalizeSpec } from '../shared/spec.js';
import { designFromPrompt } from '../shared/designer.js';

class FakeScene {
  constructor() { this.meshes = new Map(); this.data = new Float32Array(32 * 4096); this.count = 0; this.batches = []; }
  addMesh(key, geo) { this.meshes.set(key, geo); return geo; }
  hasMesh(key) { return this.meshes.has(key); }
  addBatch(key) { this.batches.push({ key, mesh: this.meshes.get(key) }); return this.batches.length - 1; }
  addInstance(batch) {
    if ((this.count + 1) * 32 > this.data.length) { const d = new Float32Array(this.data.length * 2); d.set(this.data); this.data = d; }
    this.data[this.count * 32 + 27] = batch;
    this.data[this.count * 32 + 31] = 1;
    return this.count++;
  }
  instance(i) { return this.data.subarray(i * 32, i * 32 + 32); }
  updateBounds() {}
  setVisible(i, v) { const o = i * 32 + 31; this.data[o] = v ? Math.abs(this.data[o]) || 1 : -Math.abs(this.data[o]) || -1; }
  markDirty() {}
  build() { this.built = true; }
  destroy() {}
}
const fakeRenderer = () => ({
  flash: [0, 0, 0, 0], lights: [], player: [0, 0, 0, 0],
  setTerrain() {}, setPalette() {}, setEnvironment() {}, setGrade() {}, setScene() {},
  createScene: () => new FakeScene(),
});
const input = (over = {}) => ({ move: [0, 0], jumpPressed: false, jumpHeld: false, sprint: false, consumeLook: () => [0, 0], ...over });

function setup(specInput) {
  const { spec } = normalizeSpec(specInput);
  const renderer = fakeRenderer();
  const world = buildWorld(renderer, spec, { tier: 'low' });
  const events = [];
  const game = new Game(world, { audio: null, particles: { burst() {} }, renderer, camera: new CameraRig(), emit: (type, data) => events.push({ type, ...data }) });
  return { spec, world, game, events };
}
const run = (game, seconds, inp = input()) => { for (let t = 0; t < seconds; t += 1 / 60) game.update(1 / 60, inp); };
const B = (type, value = 0, speed = 0, range = 0, axis = 'y') => ({ type, value, speed, range, axis });

test('collecting everything wins a collect game', () => {
  const { game, world, events } = setup(designFromPrompt('forest coin hunt'));
  game.start();
  run(game, 0.5);
  for (const e of world.entities.filter((x) => x.behaviors.some((b) => b.type === 'collectible'))) game.collect(e, 10);
  assert.equal(game.state, 'won');
  assert.ok(events.some((e) => e.type === 'win'));
});

test('touching a hazard costs a life and running out loses', () => {
  const { game, world, events } = setup({
    player: { lives: 2 },
    prefabs: [{ id: 'spike', shape: 'cone', size: [2, 2, 2], behaviors: [B('hazard', 1)] }],
    placements: [{ prefab: 'spike', position: [0, 0, 20] }],
    rules: { goal: 'survive', timeLimit: 60 },
  });
  game.start();
  run(game, 0.2);
  const spike = world.entities[0];
  game.player.pos = [spike.pos[0], world.physics.surfaceAt(spike.pos[0], spike.pos[2]), spike.pos[2]];
  game.player.invulnerable = 0;
  run(game, 1 / 60);
  assert.equal(game.lives, 1);
  game.player.invulnerable = 0;
  game.hurt(1);
  assert.equal(game.state, 'lost');
  assert.ok(events.some((e) => e.type === 'lose'));
});

test('surviving until the clock runs out wins', () => {
  const { game } = setup({ rules: { goal: 'survive', timeLimit: 2 } });
  game.start();
  run(game, 2.2);
  assert.equal(game.state, 'won');
});

test('reaching the goal wins', () => {
  const { game, world } = setup({ rules: { goal: 'reach' } });
  game.start();
  const goal = world.entities.find((e) => e.behaviors.some((b) => b.type === 'goal'));
  game.player.pos = [goal.pos[0], goal.pos[1] - goal.size[1] / 2, goal.pos[2]];
  run(game, 1 / 60);
  assert.equal(game.state, 'won');
});

test('bounce pads launch the player', () => {
  const { game, world } = setup({
    prefabs: [{ id: 'pad', shape: 'cylinder', size: [3, 0.3, 3], behaviors: [B('bounce', 18)] }],
    placements: [{ prefab: 'pad', position: [0, 0, 10] }],
  });
  game.start();
  const pad = world.entities[0];
  game.player.pos = [pad.pos[0], world.physics.surfaceAt(pad.pos[0], pad.pos[2]), pad.pos[2]];
  run(game, 1 / 60);
  assert.ok(game.player.vel[1] > 10);
});

test('chasers approach and shooters fire', () => {
  const { game, world } = setup({
    prefabs: [
      { id: 'slime', shape: 'sphere', size: [1, 1, 1], behaviors: [B('chase', 0, 4, 40)] },
      { id: 'turret', shape: 'cylinder', size: [1, 2, 1], behaviors: [B('shooter', 0.5, 10, 40)] },
    ],
    placements: [{ prefab: 'slime', position: [20, 0, 0] }, { prefab: 'turret', position: [-20, 0, 0] }],
    player: { spawn: [0, 1, 0] },
  });
  game.start();
  let shots = 0;
  const spawn = game.spawnProjectile.bind(game);
  game.spawnProjectile = (...args) => { shots++; spawn(...args); };
  const slime = world.entities[0];
  const d0 = Math.hypot(slime.pos[0] - game.player.pos[0], slime.pos[2] - game.player.pos[2]);
  run(game, 2);
  const d1 = Math.hypot(slime.pos[0] - game.player.pos[0], slime.pos[2] - game.player.pos[2]);
  assert.ok(d1 < d0 - 4, `slime should close in (${d0} -> ${d1})`);
  run(game, 2);
  assert.ok(shots >= 2, `turret should have fired (shots: ${shots})`);
});

test('moving platforms carry the player', () => {
  const { game, world } = setup({
    terrain: { style: 'flat', height: 0 },
    water: { enabled: false },
    prefabs: [{ id: 'lift', shape: 'box', size: [4, 0.6, 4], solid: true, behaviors: [B('patrol', 0, 2, 6, 'x')] }],
    placements: [{ prefab: 'lift', position: [0, 3, 12] }],
  });
  game.start();
  const lift = world.entities[0];
  game.player.pos = [lift.pos[0], lift.box.max[1] + 0.5, lift.pos[2]];
  game.player.vel = [0, 0, 0];
  run(game, 0.3);
  assert.equal(game.player.ground, lift);
  const offset = game.player.pos[0] - lift.pos[0];
  run(game, 1.5);
  assert.equal(game.player.ground, lift, 'still standing on the platform');
  assert.ok(Math.abs(game.player.pos[0] - lift.pos[0] - offset) < 0.3, 'moved with the platform');
});

test('walking input moves the player across the ground', () => {
  const { game } = setup({ terrain: { style: 'flat' }, water: { enabled: false } });
  game.start();
  const start = [...game.player.pos];
  run(game, 1, input({ move: [0, 1] }));
  assert.ok(Math.hypot(game.player.pos[0] - start[0], game.player.pos[2] - start[2]) > 4);
  assert.ok(game.player.grounded);
});

test('every example world builds and plays without errors', async () => {
  const fs = await import('node:fs');
  for (const name of JSON.parse(fs.readFileSync(new URL('../examples/index.json', import.meta.url)))) {
    const spec = JSON.parse(fs.readFileSync(new URL(`../examples/${name}.json`, import.meta.url)));
    const { game } = setup(spec);
    game.start();
    run(game, 1, input({ move: [0.3, 1], jumpPressed: true, jumpHeld: true }));
    assert.ok(['playing', 'won', 'lost'].includes(game.state), name);
    assert.ok(game.player.pos.every(Number.isFinite), `${name}: player position became invalid`);
  }
});

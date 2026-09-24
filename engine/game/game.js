// Game session: rules, scoring, lives, timers, triggers and all the juice
// (particles, sounds, screen flashes, camera shake) that makes actions feel good.

import { BEHAVIOR_IMPL } from './behaviors.js';
import { Player } from './player.js';
import { writeEntity, writeInstance, updateBox } from './builder.js';
import { hexToLinear } from '../core/math.js';

export class Game {
  constructor(world, { audio, particles, renderer, camera, emit }) {
    this.world = world;
    this.spec = world.spec;
    this.audio = audio;
    this.particles = particles;
    this.renderer = renderer;
    this.camera = camera;
    this.emit = emit ?? (() => {});
    this.state = 'attract';
    this.time = 0;
    this.player = new Player(this.spec, world.spawn);
    this.playerColor = hexToLinear(this.spec.player.color);
    this.surface = (x, z) => world.physics.surfaceAt(x, z);
    for (const e of world.entities) for (const b of e.behaviors) BEHAVIOR_IMPL[b.type]?.init?.(e, b, this);
    this.#resetStats();
  }

  #resetStats() {
    const r = this.spec.rules;
    this.score = 0;
    this.lives = this.spec.player.lives;
    this.timeLeft = r.timeLimit > 0 ? r.timeLimit : null;
    this.elapsed = 0;
    this.checkpointPos = [...this.world.spawn];
    this.collected = 0;
    this.totalCollectibles = this.world.entities.filter((e) => e.behaviors.some((b) => b.type === 'collectible')).length;
  }

  start() {
    for (const e of this.world.entities) {
      e.alive = true;
      e.base = [...e.home];
      e.pos = [...e.home];
      for (const b of e.behaviors) { b.state = {}; BEHAVIOR_IMPL[b.type]?.init?.(e, b, this); }
      this.world.scene.setVisible(e.instance, true);
      if (e.box) e.box.active = true;
    }
    for (const p of this.world.projectiles) this.#killProjectile(p);
    this.#resetStats();
    this.player.reset(this.world.spawn);
    this.player.yaw = Math.atan2(this.world.center[0] - this.world.spawn[0], this.world.center[2] - this.world.spawn[2]) || 0;
    this.camera.mode = this.spec.player.camera === 'first' ? 'first' : 'third';
    this.camera.snapBehind(this.player);
    this.state = 'playing';
    this.emit('start', this.#hud());
  }

  stop() {
    this.state = 'attract';
    this.camera.mode = 'orbit';
    this.emit('stop', this.#hud());
  }

  pause(p) {
    if (this.state === 'playing' && p) this.state = 'paused';
    else if (this.state === 'paused' && !p) this.state = 'playing';
    this.emit('pause', { paused: this.state === 'paused' });
  }

  #hud() {
    return {
      score: this.score, lives: this.lives, maxLives: this.spec.player.lives, timeLeft: this.timeLeft,
      collected: this.collected, total: this.totalCollectibles, target: this.spec.rules.targetScore,
      goal: this.spec.rules.goal, objective: this.spec.rules.objective, title: this.spec.title,
    };
  }

  // ------------------------------------------------------------------ events from behaviours

  collect(e, points) {
    if (!e.alive || this.state !== 'playing') return;
    this.#despawn(e);
    this.score += points;
    this.collected++;
    const pitch = 1 + Math.min(this.collected, 24) * 0.025;
    this.audio?.play('collect', { pitch });
    this.particles?.burst({ position: [e.pos[0], e.pos[1] + e.bob, e.pos[2]], color: e.color.map((c) => c * 5 + 0.5), count: 36, speed: 5, size: 0.09, gravity: 5, life: 0.9, up: 2.5 });
    this.emit('score', { ...this.#hud(), delta: points, at: e.pos });
    this.#checkWin();
  }

  heal(e, amount) {
    if (!e.alive || this.state !== 'playing') return;
    if (this.lives >= this.spec.player.lives) return;
    this.#despawn(e);
    this.lives = Math.min(this.spec.player.lives, this.lives + amount);
    this.audio?.play('heal');
    this.particles?.burst({ position: e.pos, color: [4, 1, 1.5], count: 24, speed: 3, size: 0.1, gravity: -1, life: 1 });
    this.emit('lives', { ...this.#hud(), delta: amount });
  }

  hurt(amount, source = null) {
    const p = this.player;
    if (this.state !== 'playing' || p.invulnerable > 0 || p.dead) return;
    this.lives -= amount;
    p.invulnerable = 1.5;
    this.audio?.play('hurt');
    this.camera.shake = 1;
    this.renderer.flash = [1.5, 0.05, 0.02, 0.35];
    this.particles?.burst({ position: [p.pos[0], p.pos[1] + 1, p.pos[2]], color: [4, 0.6, 0.3], count: 30, speed: 5, size: 0.08, gravity: 12, life: 0.8 });
    if (source) {
      // knock the player away from the hazard
      const dx = p.pos[0] - source.pos[0], dz = p.pos[2] - source.pos[2];
      const d = Math.hypot(dx, dz) || 1;
      p.vel[0] = (dx / d) * 9; p.vel[2] = (dz / d) * 9; p.vel[1] = 7;
    }
    this.emit('lives', { ...this.#hud(), delta: -amount });
    if (this.lives <= 0) this.#lose();
  }

  reachGoal(e) {
    if (this.state !== 'playing') return;
    this.particles?.burst({ position: e.pos, color: e.color.map((c) => c * 6 + 1), count: 120, speed: 9, size: 0.12, gravity: 4, life: 2, up: 5 });
    if (this.spec.rules.goal === 'reach') this.#win();
  }

  checkpoint(e) {
    this.checkpointPos = [e.pos[0], this.surface(e.pos[0], e.pos[2]) + 0.1, e.pos[2]];
    this.audio?.play('checkpoint');
    this.particles?.burst({ position: e.pos, color: e.color.map((c) => c * 5 + 0.5), count: 50, speed: 6, size: 0.1, gravity: 3, life: 1.2 });
    e.flash = 0.6;
    this.emit('message', { text: 'Checkpoint!' });
  }

  bounce(e, strength) {
    const p = this.player;
    if (p.vel[1] > strength * 0.6) return;
    p.vel[1] = strength;
    p.launched = true;
    p.squash = 1.35;
    e.flash = 0.5;
    this.audio?.play('bounce');
    this.particles?.burst({ position: [p.pos[0], p.pos[1], p.pos[2]], color: e.color.map((c) => c * 4 + 0.5), count: 20, speed: 4, size: 0.08, gravity: 6, life: 0.7 });
  }

  spawnProjectile(from, vel, color) {
    const slot = this.world.projectiles.find((p) => !p.alive);
    if (!slot) return;
    slot.alive = true;
    slot.pos = [...from];
    slot.vel = [...vel];
    slot.life = 4;
    slot.color = color.map((c) => c * 6 + 1);
    this.world.scene.setVisible(slot.instance, true);
    this.audio?.play('shoot');
  }

  #killProjectile(p) {
    p.alive = false;
    p.pos = [0, -100, 0];
    this.world.scene.setVisible(p.instance, false);
  }

  #despawn(e) {
    e.alive = false;
    this.world.scene.setVisible(e.instance, false);
    if (e.box) e.box.active = false;
  }

  #checkWin() {
    const r = this.spec.rules;
    if (r.goal === 'collect' && this.score >= r.targetScore && r.targetScore > 0) this.#win();
  }

  #win() {
    this.state = 'won';
    this.audio?.play('win');
    const p = this.player.pos;
    for (let k = 0; k < 5; k++) {
      this.particles?.burst({ position: [p[0] + (Math.random() - 0.5) * 6, p[1] + 3 + Math.random() * 3, p[2] + (Math.random() - 0.5) * 6], color: [Math.random() * 5, Math.random() * 5, Math.random() * 5], count: 60, speed: 8, size: 0.1, gravity: 3, life: 2 });
    }
    this.emit('win', { ...this.#hud(), message: this.spec.rules.winMessage, time: this.elapsed });
  }

  #lose() {
    this.state = 'lost';
    this.player.dead = true;
    this.audio?.play('lose');
    this.emit('lose', { ...this.#hud(), message: this.spec.rules.loseMessage, time: this.elapsed });
  }

  // ------------------------------------------------------------------ frame

  update(dt, input) {
    this.time += dt;
    const playing = this.state === 'playing';
    const w = this.world;
    const look = input.consumeLook();
    if (playing) {
      this.elapsed += dt;
      if (this.timeLeft !== null) {
        const before = Math.ceil(this.timeLeft);
        this.timeLeft = Math.max(0, this.timeLeft - dt);
        if (Math.ceil(this.timeLeft) !== before) this.emit('tick', this.#hud());
        if (this.timeLeft <= 0) {
          if (this.spec.rules.goal === 'survive' || this.spec.rules.goal === 'score') this.#win(); else this.#lose();
        }
      }
    }

    // entities
    for (const e of w.entities) {
      if (!e.alive) continue;
      e.prev[0] = e.pos[0]; e.prev[1] = e.pos[1]; e.prev[2] = e.pos[2];
      for (const b of e.behaviors) BEHAVIOR_IMPL[b.type]?.update?.(e, b, dt, this);
      e.pos[0] = e.base[0]; e.pos[1] = e.base[1]; e.pos[2] = e.base[2];
      e.delta[0] = e.pos[0] - e.prev[0]; e.delta[1] = e.pos[1] - e.prev[1]; e.delta[2] = e.pos[2] - e.prev[2];
      if (e.box) updateBox(e);
      e.flash = Math.max(0, e.flash - dt * 2);
    }

    // player
    if (playing) {
      const p = this.player;
      const camYaw = this.camera.yaw;
      p.update(dt, input, camYaw, w.physics, this.audio, true);
      // hazards: falling out of the world, drowning in lava
      if (p.inLava) { this.hurt(1); if (this.state === 'playing') { p.reset(this.checkpointPos); } }
      if (p.pos[1] < w.hf.minHeight - 30) { this.hurt(1); if (this.state === 'playing') p.reset(this.checkpointPos); }
      // triggers
      const pc = [p.pos[0], p.pos[1] + p.height * 0.5, p.pos[2]];
      for (const e of w.entities) {
        if (!e.alive || !e.trigger) continue;
        const reach = Math.max(e.size[0], e.size[2]) * 0.5 + p.radius + 0.1;
        const dy = Math.abs(pc[1] - (e.pos[1] + e.bob));
        if (dy > e.size[1] * 0.5 + p.height * 0.5) continue;
        const dx = pc[0] - e.pos[0], dz = pc[2] - e.pos[2];
        if (dx * dx + dz * dz > reach * reach) continue;
        for (const b of e.behaviors) BEHAVIOR_IMPL[b.type]?.touch?.(e, b, this);
      }
    } else if (this.state === 'won' || this.state === 'lost') {
      // let the player coast to a stop
      this.player.update(dt, input, this.camera.yaw, w.physics, null, false);
    }

    // projectiles
    for (const pr of w.projectiles) {
      if (!pr.alive) continue;
      pr.vel[1] -= 4 * dt;
      pr.pos[0] += pr.vel[0] * dt; pr.pos[1] += pr.vel[1] * dt; pr.pos[2] += pr.vel[2] * dt;
      pr.life -= dt;
      const p = this.player.pos;
      const hit = Math.hypot(pr.pos[0] - p[0], pr.pos[1] - (p[1] + 0.9), pr.pos[2] - p[2]) < 0.8;
      if (hit && playing) this.hurt(1, { pos: pr.pos });
      if (hit || pr.life <= 0 || pr.pos[1] < w.hf.heightAt(pr.pos[0], pr.pos[2])) {
        this.particles?.burst({ position: pr.pos, color: pr.color, count: 12, speed: 3, size: 0.07, gravity: 6, life: 0.5 });
        this.#killProjectile(pr);
      }
    }

    const camOut = this.camera.update(dt, playing ? look : [0, 0], w, this.player, this.time);
    this.#writeVisuals();
    return camOut;
  }

  #writeVisuals() {
    const w = this.world;
    const scene = w.scene;
    for (const e of w.entities) if (e.alive) writeEntity(scene, e);
    const v = this.player.visual(this.time);
    const showAvatar = this.state !== 'attract' && this.camera.mode !== 'first' && !v.hidden;
    writeInstance(scene, w.avatar, v.pos, v.yaw, v.scale, this.playerColor, this.playerColor.map((c) => c * 0.05), 0.45, 0.1);
    scene.setVisible(w.avatar, showAvatar);
    for (const pr of w.projectiles) if (pr.alive) writeInstance(scene, pr.instance, pr.pos, 0, w.projectileScale, [0.2, 0.2, 0.2], pr.color, 0.5, 0);
    // point lights from entities
    const lights = [];
    for (const e of w.entities) if (e.alive && e.light) lights.push({ position: [e.pos[0], e.pos[1] + e.bob, e.pos[2]], color: e.light.color, radius: e.light.radius });
    for (const pr of w.projectiles) if (pr.alive) lights.push({ position: pr.pos, color: pr.color.map((c) => c * 0.8), radius: 6 });
    this.renderer.lights = lights;
    const pp = this.player.pos;
    this.renderer.player = [pp[0], pp[1], pp[2], this.state === 'attract' ? 0.01 : 1.1];
  }
}

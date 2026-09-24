// Entity behaviours. Each has optional init(e, b, game), update(e, b, dt, game)
// and touch(e, b, game) (called when the player overlaps the entity).

import { DEG } from '../core/math.js';

const TAU = Math.PI * 2;

export const BEHAVIOR_IMPL = {
  spin: {
    update(e, b, dt) { e.yaw += (b.speed || 90) * DEG * dt; },
  },
  bob: {
    init(e, b) { b.state.phase = Math.random() * TAU; },
    update(e, b, dt, g) { e.bob = Math.sin(g.time * (b.speed || 0.5) * TAU + b.state.phase) * (b.range || 0.3); },
  },
  collectible: {
    touch(e, b, g) { g.collect(e, Math.max(1, Math.round(b.value || 10))); },
  },
  heal: {
    touch(e, b, g) { g.heal(e, Math.max(1, Math.round(b.value || 1))); },
  },
  hazard: {
    touch(e, b, g) { g.hurt(Math.max(1, Math.round(b.value || 1)), e); },
  },
  goal: {
    touch(e, b, g) { g.reachGoal(e); },
  },
  checkpoint: {
    touch(e, b, g) { if (!b.state.done) { b.state.done = true; g.checkpoint(e); } },
  },
  bounce: {
    touch(e, b, g) { g.bounce(e, b.value || 15); },
  },
  patrol: {
    init(e, b) { b.state.t = Math.random() * 10; },
    update(e, b, dt) {
      const range = b.range || 6;
      const speed = Math.abs(b.speed || 2);
      b.state.t += dt;
      // smooth ping-pong with constant cruising speed and eased turns
      const period = (2 * range) / speed * 2;
      const phase = (b.state.t % period) / period;
      const offset = (0.5 - 0.5 * Math.cos(phase * TAU)) * range * 2 - range;
      const axis = b.axis === 'x' ? 0 : b.axis === 'z' ? 2 : 1;
      e.base[axis] = e.home[axis] + offset;
    },
  },
  orbit: {
    init(e, b) { b.state.a = Math.random() * TAU; },
    update(e, b, dt) {
      b.state.a += (b.speed || 1) * dt;
      const r = b.range || 4;
      e.base[0] = e.home[0] + Math.cos(b.state.a) * r;
      e.base[2] = e.home[2] + Math.sin(b.state.a) * r;
    },
  },
  chase: {
    update(e, b, dt, g) {
      if (g.state !== 'playing' || g.player.dead) return;
      const p = g.player.pos;
      const dx = p[0] - e.base[0], dz = p[2] - e.base[2];
      const d = Math.hypot(dx, dz);
      const range = b.range || 20;
      if (d < range && d > 0.5) {
        const s = Math.min(d, (b.speed || 3) * dt);
        e.base[0] += (dx / d) * s;
        e.base[2] += (dz / d) * s;
        e.yaw = Math.atan2(dx, dz);
        const floatH = e.home[1] - g.surface(e.home[0], e.home[2]);
        e.base[1] += (g.surface(e.base[0], e.base[2]) + floatH - e.base[1]) * Math.min(1, dt * 8);
      } else if (d >= range) {
        // wander back home
        const hx = e.home[0] - e.base[0], hz = e.home[2] - e.base[2];
        const hd = Math.hypot(hx, hz);
        if (hd > 0.3) {
          const s = Math.min(hd, (b.speed || 3) * 0.4 * dt);
          e.base[0] += (hx / hd) * s;
          e.base[2] += (hz / hd) * s;
          const floatH = e.home[1] - g.surface(e.home[0], e.home[2]);
          e.base[1] += (g.surface(e.base[0], e.base[2]) + floatH - e.base[1]) * Math.min(1, dt * 8);
        }
      }
    },
  },
  light: {
    init(e, b) {
      const k = Math.max(0.5, b.value || 4);
      e.light = { color: e.color.map((c) => c * k * 6 + 0.02), radius: b.range || 10, position: e.pos };
    },
  },
  shooter: {
    init(e, b) { b.state.cool = 1 + Math.random() * 2; },
    update(e, b, dt, g) {
      if (g.state !== 'playing' || g.player.dead) return;
      b.state.cool -= dt;
      const p = g.player.pos;
      const target = [p[0], p[1] + 1, p[2]];
      const dx = target[0] - e.pos[0], dy = target[1] - e.pos[1], dz = target[2] - e.pos[2];
      const d = Math.hypot(dx, dy, dz);
      e.yaw = Math.atan2(dx, dz);
      if (d < (b.range || 30) && b.state.cool <= 0) {
        b.state.cool = Math.max(0.4, b.value || 2);
        const speed = b.speed || 10;
        g.spawnProjectile([e.pos[0], e.pos[1] + e.size[1] * 0.3, e.pos[2]], [(dx / d) * speed, (dy / d) * speed + 1.5, (dz / d) * speed], e.color);
      }
    },
  },
};

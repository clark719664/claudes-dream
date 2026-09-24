// Camera rig: cinematic orbit (title screen), third-person follow with
// terrain collision and look-ahead, and first-person.

import { damp, clamp } from '../core/math.js';

export class CameraRig {
  constructor() {
    this.mode = 'orbit';
    this.yaw = 0;
    this.pitch = 0.25;
    this.distance = 6.5;
    this.fov = 62 * Math.PI / 180;
    this.position = [0, 20, -30];
    this.target = [0, 0, 0];
    this.orbitAngle = 0;
    this.shake = 0;
  }

  /** Point the camera behind the player's facing direction. */
  snapBehind(player) {
    this.yaw = player.yaw;
    this.pitch = 0.28;
    this.position = null;
  }

  update(dt, look, world, player, time) {
    const surface = (x, z) => world.physics.surfaceAt(x, z);
    if (this.mode === 'orbit') {
      this.orbitAngle += dt * 0.05;
      const r = Math.min(world.hf.playSize * 0.42, 70);
      const c = world.spawn;
      const x = c[0] + Math.sin(this.orbitAngle) * r;
      const z = c[2] + Math.cos(this.orbitAngle) * r;
      const y = Math.max(surface(x, z) + 10, c[1] + 14);
      this.position = [x, y, z];
      this.target = [c[0], c[1] + 2, c[2]];
      return this.#out(time);
    }
    this.yaw -= look[0];
    this.pitch = clamp(this.pitch + look[1], -1.2, 1.35);
    if (this.mode === 'first') {
      const eye = [player.pos[0], player.pos[1] + 1.6, player.pos[2]];
      const cp = Math.cos(this.pitch);
      this.position = eye;
      this.target = [eye[0] + Math.sin(this.yaw) * cp, eye[1] - Math.sin(this.pitch), eye[2] + Math.cos(this.yaw) * cp];
      return this.#out(time);
    }
    // third person with a little look-ahead in the movement direction
    const lead = [player.vel[0] * 0.12, 0, player.vel[2] * 0.12];
    const focus = [player.pos[0] + lead[0], player.pos[1] + 1.45, player.pos[2] + lead[2]];
    const cp = Math.cos(this.pitch);
    const dir = [-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp];
    let dist = this.distance;
    // pull in when terrain blocks the view
    for (let i = 1; i <= 10; i++) {
      const t = (i / 10) * dist;
      const p = [focus[0] + dir[0] * t, focus[1] + dir[1] * t, focus[2] + dir[2] * t];
      if (world.hf.heightAt(p[0], p[2]) + 0.35 > p[1]) { dist = Math.max(1.2, t - 0.4); break; }
    }
    const desired = [focus[0] + dir[0] * dist, focus[1] + dir[1] * dist, focus[2] + dir[2] * dist];
    desired[1] = Math.max(desired[1], surface(desired[0], desired[2]) + 0.4);
    if (!this.position) this.position = desired;
    const k = damp(14, dt);
    for (let i = 0; i < 3; i++) this.position[i] += (desired[i] - this.position[i]) * k;
    this.target = focus;
    return this.#out(time);
  }

  #out(time) {
    let pos = this.position;
    if (this.shake > 0) {
      const s = this.shake * 0.25;
      pos = [pos[0] + Math.sin(time * 71) * s, pos[1] + Math.sin(time * 83) * s, pos[2] + Math.cos(time * 67) * s];
      this.shake = Math.max(0, this.shake - 0.05);
    }
    return { position: pos, target: this.target, fovY: this.fov, near: 0.1 };
  }
}

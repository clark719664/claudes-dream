// Player controller tuned for game feel: acceleration curves, coyote time,
// jump buffering, variable jump height, air control, swimming and a
// squash-and-stretch avatar.

import { damp } from '../core/math.js';

export class Player {
  constructor(spec, spawn) {
    this.spec = spec;
    this.pos = [...spawn];
    this.vel = [0, 0, 0];
    this.radius = 0.4;
    this.height = 1.8;
    this.yaw = 0;
    this.speed = spec.player.speed;
    this.gravity = 26;
    this.jumpVel = Math.sqrt(2 * this.gravity * spec.player.jump);
    this.coyote = 0;
    this.jumpBuffer = 0;
    this.invulnerable = 0;
    this.squash = 1;
    this.airTime = 0;
    this.stepTimer = 0;
    this.dead = false;
    this.grounded = false;
  }

  reset(pos) {
    this.pos = [...pos];
    this.vel = [0, 0, 0];
    this.dead = false;
    this.invulnerable = 1.2;
    this.carrier = null;
  }

  update(dt, input, cameraYaw, physics, audio, allowControl = true) {
    const move = allowControl ? input.move : [0, 0];
    // camera-relative wish direction
    const fx = Math.sin(cameraYaw), fz = Math.cos(cameraYaw);
    const rx = -fz, rz = fx;
    let wx = fx * move[1] + rx * move[0];
    let wz = fz * move[1] + rz * move[0];
    const wl = Math.hypot(wx, wz);
    if (wl > 1) { wx /= wl; wz /= wl; }
    const sprint = allowControl && input.sprint ? 1.55 : 1;
    const target = this.speed * sprint;
    const inWater = this.inWater;
    const accel = this.grounded ? 14 : inWater ? 5 : 6;
    const k = damp(accel, dt);
    this.vel[0] += (wx * target * (inWater ? 0.6 : 1) - this.vel[0]) * k;
    this.vel[2] += (wz * target * (inWater ? 0.6 : 1) - this.vel[2]) * k;
    if (wl > 0.1) {
      const desired = Math.atan2(wx, wz);
      let d = desired - this.yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      this.yaw += d * damp(14, dt);
    }

    // jumping: coyote time + input buffering + variable height
    this.coyote = this.grounded ? 0.12 : Math.max(0, this.coyote - dt);
    if (allowControl && input.jumpPressed) this.jumpBuffer = 0.14;
    else this.jumpBuffer = Math.max(0, this.jumpBuffer - dt);
    if (this.jumpBuffer > 0 && (this.coyote > 0 || inWater)) {
      this.vel[1] = inWater ? this.jumpVel * 0.75 : this.jumpVel;
      this.jumpBuffer = 0;
      this.coyote = 0;
      this.squash = 1.25;
      audio?.play('jump');
    }
    if (!(allowControl && input.jumpHeld) && this.vel[1] > 0 && !this.launched) this.vel[1] *= Math.exp(-dt * 9);

    // gravity / buoyancy
    if (inWater) {
      this.vel[1] += (this.gravity * 0.15) * dt;
      this.vel[1] *= Math.exp(-dt * 3);
    } else {
      const g = this.vel[1] < 0 ? this.gravity * 1.25 : this.gravity;
      this.vel[1] = Math.max(this.vel[1] - g * dt, -40);
    }

    const wasGrounded = this.grounded;
    const fall = this.vel[1];
    physics.moveCharacter(this, dt);
    if (this.grounded) this.launched = false;
    if (this.grounded && !wasGrounded && fall < -8) {
      this.squash = 0.72;
      audio?.play('land');
    }
    if (this.grounded && Math.hypot(this.vel[0], this.vel[2]) > 2) {
      this.stepTimer -= dt * Math.hypot(this.vel[0], this.vel[2]);
      if (this.stepTimer <= 0) { this.stepTimer = 2.2; audio?.play('step'); }
    }
    this.squash += (1 - this.squash) * damp(10, dt);
    this.invulnerable = Math.max(0, this.invulnerable - dt);
  }

  /** Visual transform for the avatar: position, yaw and non-uniform scale. */
  visual(time) {
    const s = this.squash;
    const speed = Math.hypot(this.vel[0], this.vel[2]);
    const bounce = this.grounded ? Math.abs(Math.sin(time * 11)) * Math.min(speed / 8, 1) * 0.08 : 0;
    const blink = this.invulnerable > 0 && Math.floor(time * 16) % 2 === 0;
    return { pos: [this.pos[0], this.pos[1] + bounce, this.pos[2]], yaw: this.yaw, scale: [1 / Math.sqrt(s), s, 1 / Math.sqrt(s)], hidden: blink };
  }
}

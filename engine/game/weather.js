// Living weather: rain arrives in passing showers, the ground soaks up water
// and dries again, lightning strikes somewhere in the storm and its thunder
// rolls in after the light, and auroras shimmer on clear nights.
//
// The simulation is deterministic for a given seed so captures and tests are
// repeatable. It produces renderer inputs (frame.weatherFx, frame.flashPos)
// plus events for audio.

import { Rng } from '../../shared/rng.js';

const SPEED_OF_SOUND = 343;

export class Weather {
  constructor(seed = 1) {
    this.configure({}, seed);
  }

  /** Apply a spec's environment ({ rain, lightning, aurora }). */
  configure({ rain = 0, lightning = 0, aurora = 0 } = {}, seed = 1) {
    this.rain = rain;
    this.lightning = lightning;
    this.aurora = aurora;
    this.rng = new Rng(seed ^ 0x5eed);
    this.time = 0;
    // a rainy world starts out already soaked
    this.wetness = rain > 0 ? Math.min(1, 0.35 + rain * 0.65) : 0;
    this.rainNow = rain;
    this.pulses = [];
    this.flash = 0;
    this.flashDir = [0, 0, 0, 0];
    this.nextStrike = lightning > 0 ? 1.5 + this.rng.range(0, 4) / lightning : Infinity;
    this.events = [];
  }

  /** Rain intensity right now: heavy rain stays heavy, lighter rain comes and goes in showers. */
  #shower(t) {
    if (this.rain <= 0) return 0;
    const wave = 0.5 + 0.3 * Math.sin(t * 0.071) + 0.2 * Math.sin(t * 0.193 + 1.3);
    const steady = Math.min(1, this.rain * 1.1);
    return this.rain * Math.min(1, Math.max(0, steady * 0.6 + wave * (1 - steady * 0.6) - 0.05));
  }

  /** Schedule a strike: a few return strokes over ~0.4 s, a bolt direction and delayed thunder. */
  #strike(forward) {
    const r = this.rng;
    const distance = r.range(900, 2400 + (1 - this.lightning) * 3600);
    // most strikes land somewhere in front of the player, where they can be seen
    const base = Math.atan2(forward[0], forward[2]);
    const az = r.float() < 0.65 ? base + r.range(-0.9, 0.9) : r.range(0, Math.PI * 2);
    const cloudBase = 1100;
    const el = Math.atan2(cloudBase, distance);
    this.flashDir = [Math.sin(az) * Math.cos(el), Math.sin(el), Math.cos(az) * Math.cos(el), r.range(0, 1000)];
    const strength = Math.min(1, 2200 / distance);
    let t = this.time;
    const strokes = r.int(2, 4);
    for (let i = 0; i < strokes; i++) {
      this.pulses.push({ at: t, peak: strength * (i === 0 ? 1 : r.range(0.45, 0.9)) });
      t += r.range(0.05, 0.14);
    }
    this.events.push({ type: 'thunder', delay: Math.min(7, distance / SPEED_OF_SOUND), distance });
  }

  /**
   * Advance the simulation. forward is the camera's view direction.
   * Returns { fx: [wetness, rain, flash, aurora], flashDir: [x, y, z, seed], events }.
   */
  update(dt, forward = [0, 0, 1]) {
    this.time += dt;
    this.events = [];
    this.rainNow = this.#shower(this.time);
    // ground wets quickly in rain and dries slowly afterwards
    const target = this.rainNow > 0.05 ? Math.min(1, 0.35 + this.rainNow * 0.8) : 0;
    const rate = target > this.wetness ? 0.12 : 0.012;
    this.wetness += (target - this.wetness) * Math.min(1, rate * dt * 4);

    if (this.lightning > 0) {
      this.nextStrike -= dt;
      if (this.nextStrike <= 0) {
        this.#strike(forward);
        // roughly every 4 s in a fierce storm, every 20 s in a mild one
        this.nextStrike = this.rng.range(0.4, 1.6) * (3 + (1 - this.lightning) * 18);
      }
    }
    let flash = 0;
    this.pulses = this.pulses.filter((p) => this.time - p.at < 1.5);
    for (const p of this.pulses) {
      const age = this.time - p.at;
      if (age >= 0) flash = Math.max(flash, p.peak * Math.exp(-age * 16));
    }
    this.flash = flash;
    return {
      fx: [this.wetness, this.rainNow, flash, this.aurora],
      flashDir: flash > 0.001 ? this.flashDir : [0, 0, 0, 0],
      events: this.events,
    };
  }
}

// The reactive world: a scrolling, player-centred interaction map.
//
// A small texture that follows the player (32-48 m across) remembers what
// has happened to the ground and water around them:
//   r  trail depth: footprints and trenches pressed into snow, sand and soil,
//      which slowly fill back in; grass stays trampled where it was walked on
//   g  water height and b  previous height: a wave-equation simulation, so
//      wading and swimming push out wakes and rings that spread, reflect off
//      each other and fade
//   a  foam stirred up by the waves
// It is world-aligned and scrolls texel by texel as the player moves, so
// trails stay where they were made. Terrain, grass and water read it through
// the global bind group (see INTERACT_WGSL).

import { bindLayout, bindGroup, createShader, createBuffer, texture2D, U } from '../gpu/gpu.js';

const MAX_STAMPS = 16;
const STRIDE = 0.62;     // meters between footprints
const FOOT_OFFSET = 0.13;

const SIM_CS = /* wgsl */ `
struct Params { origin: vec4f, step: vec4f, count: vec4f };
@group(0) @binding(0) var prevTex: texture_2d<f32>;
@group(0) @binding(1) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(2) var<uniform> params: Params; // origin: x, z, texel m, -; step: shift x, y, trail recovery, apply stamps; count: stamps
@group(0) @binding(3) var<storage, read> stamps: array<vec4f, ${MAX_STAMPS * 2}>; // [x, z, radius, amount], [kind, -, -, -]

fn prevAt(c: vec2i) -> vec4f {
  let q = c + vec2i(params.step.xy);
  let n = vec2i(textureDimensions(prevTex));
  if (any(q < vec2i(0)) || any(q >= n)) { return vec4f(0.0); }
  return textureLoad(prevTex, q, 0);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outTex);
  if (id.x >= n.x || id.y >= n.y) { return; }
  let c = vec2i(id.xy);
  var v = prevAt(c);
  // trails fill back in slowly
  v.r = max(v.r - params.step.z, 0.0);
  // one step of the 2D wave equation, damped
  let lap = prevAt(c + vec2i(1, 0)).g + prevAt(c - vec2i(1, 0)).g + prevAt(c + vec2i(0, 1)).g + prevAt(c - vec2i(0, 1)).g - 4.0 * v.g;
  let h = (2.0 * v.g - v.b + 0.3 * lap) * 0.988;
  v.b = v.g;
  v.g = clamp(h, -2.0, 2.0);
  v.a = max(v.a * 0.93, smoothstep(0.22, 0.45, abs(h)) * 0.5);
  // new footprints and splashes
  if (params.step.w > 0.5) {
    let world = params.origin.xy + (vec2f(c) + 0.5) * params.origin.z;
    for (var i = 0u; i < u32(params.count.x); i++) {
      let s = stamps[i * 2u];
      let kind = stamps[i * 2u + 1u].x;
      let fall = 1.0 - smoothstep(s.z * 0.45, s.z, length(world - s.xy));
      if (kind < 1.5) { v.r = max(v.r, s.w * fall); }
      else if (kind < 2.5) { v.g += s.w * fall; }
      // a moving body holds the surface down to a depth; the waves it leaves behind make the wake
      else { v.g = min(v.g, s.w * fall); }
    }
  }
  // fade towards the border so the scrolling edge never shows
  let edge = min(min(c.x, c.y), min(i32(n.x) - 1 - c.x, i32(n.y) - 1 - c.y));
  v = v * clamp(f32(edge) / 6.0, 0.0, 1.0);
  textureStore(outTex, c, v);
}
`;

export class Interaction {
  constructor(renderer) {
    this.renderer = renderer;
    const d = (this.device = renderer.device);
    this.res = renderer.tier.interactRes;
    this.size = renderer.tier.interactSize;
    this.texel = this.size / this.res;
    this.scratch = texture2D(d, { width: this.res, height: this.res, format: 'rgba16float', usage: U.STO | U.CSRC, label: 'interaction-scratch' });
    this.stampData = new Float32Array(MAX_STAMPS * 8);
    this.stampBuffer = createBuffer(d, this.stampData.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'interaction-stamps');
    this.paramBuffers = [0, 1, 2].map((i) => createBuffer(d, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, `interaction-params-${i}`));
    const layout = bindLayout(d, 'interaction', [['C', 'utexture'], ['C', 'storage-texture:rgba16float:2d'], ['C', 'uniform'], ['C', 'read']]);
    this.pipe = d.createComputePipeline({
      label: 'interaction', layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: createShader(d, SIM_CS, 'interaction'), entryPoint: 'main' },
    });
    this.groups = this.paramBuffers.map((p) => bindGroup(d, layout, [renderer.interactView, this.scratch.createView(), p, this.stampBuffer], 'interaction'));
    this.stamps = [];
    this.origin = null;
    this.walked = 0;
    this.foot = 1;
    this.wasInWater = false;
    this.accum = 0;
  }

  attach(renderer) { renderer.interactEnabled = true; }

  /** A new world: forget old trails. */
  onTerrain() { this.origin = null; this.stamps = []; this.clear = true; }

  /** Press the ground ('trail', depth 0-1), kick the water ('splash', +/- height) or hold it down ('wake', depth). */
  stamp(x, z, radius, amount, kind = 'trail') {
    if (this.stamps.length < MAX_STAMPS) this.stamps.push([x, z, radius, amount, { trail: 1, splash: 2, wake: 3 }[kind] ?? 1]);
  }

  /** Footprints, trenches and wakes from the player. heightAt(x, z) gives the terrain height. */
  trackPlayer(player, dt, heightAt, waterLevel) {
    const [x, y, z] = player.pos;
    this.center = [x, z];
    if (dt <= 0) return;
    const speed = Math.hypot(player.vel[0], player.vel[2]);
    const onTerrain = player.grounded && heightAt && y - heightAt(x, z) < 0.35;
    if (onTerrain && speed > 0.3) {
      this.walked += speed * dt;
      // a shallow trench where the body ploughs through, deeper footprints left and right
      this.stamp(x, z, 0.3, 0.3);
      if (this.walked > STRIDE) {
        this.walked = 0;
        this.foot = -this.foot;
        const inv = 1 / speed;
        const px = -player.vel[2] * inv * FOOT_OFFSET * this.foot;
        const pz = player.vel[0] * inv * FOOT_OFFSET * this.foot;
        this.stamp(x + px, z + pz, 0.15, 1);
      }
    }
    const inWater = waterLevel !== null && waterLevel !== undefined && player.inWater && Math.abs(y - waterLevel) < 1.6;
    if (inWater) {
      // wake: push down where the body moves; a big ring when jumping in
      if (!this.wasInWater) this.stamp(x, z, 1.1, -0.5, 'splash');
      else if (speed > 0.2) this.stamp(x, z, 0.5, -Math.min(0.2, speed * 0.03), 'wake');
    }
    this.wasInWater = inWater;
  }

  update(encoder) {
    const r = this.renderer;
    const c = this.center ?? [r.camera?.position[0] ?? 0, r.camera?.position[2] ?? 0];
    // world-aligned origin snapped to whole texels, so trails stay put while the map scrolls
    const half = this.size / 2;
    const ox = Math.round((c[0] - half) / this.texel) * this.texel;
    const oz = Math.round((c[1] - half) / this.texel) * this.texel;
    let shift = [0, 0];
    if (this.origin && !this.clear) shift = [Math.round((ox - this.origin[0]) / this.texel), Math.round((oz - this.origin[1]) / this.texel)];
    else shift = [this.res * 4, this.res * 4]; // everything reads as empty
    this.clear = false;
    this.origin = [ox, oz];
    r.interactParams = [ox, oz, this.size, 1];

    // a fixed 60 Hz simulation step keeps waves the same speed at any frame rate
    this.accum = Math.min(this.accum + (r.dt ?? 1 / 60), 3 / 60);
    const steps = Math.max(1, Math.min(3, Math.floor(this.accum * 60 + 1e-3)));
    this.accum = Math.max(0, this.accum - steps / 60);

    const n = this.stamps.length;
    this.stampData.fill(0);
    this.stamps.forEach(([x, z, radius, amount, kind], i) => this.stampData.set([x, z, radius, amount, kind, 0, 0, 0], i * 8));
    if (n) this.device.queue.writeBuffer(this.stampBuffer, 0, this.stampData, 0, n * 8);
    this.stamps = [];
    const recovery = (1 / 60) / 45; // footprints fill back in over ~45 s
    const groups = Math.ceil(this.res / 8);
    for (let i = 0; i < steps; i++) {
      const first = i === 0;
      this.device.queue.writeBuffer(this.paramBuffers[i], 0, new Float32Array([
        ox, oz, this.texel, 0,
        first ? shift[0] : 0, first ? shift[1] : 0, recovery, first ? 1 : 0,
        n, 0, 0, 0,
      ]));
      const pass = encoder.beginComputePass({ label: 'interaction' });
      pass.setPipeline(this.pipe);
      pass.setBindGroup(0, this.groups[i]);
      pass.dispatchWorkgroups(groups, groups);
      pass.end();
      encoder.copyTextureToTexture({ texture: this.scratch }, { texture: r.interactTexture }, [this.res, this.res]);
    }
  }
}

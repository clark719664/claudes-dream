// GPU particles. Ambient weather (snow, rain, fireflies, embers, dust, spores)
// lives in a pool that the compute shader recycles around the camera; gameplay
// bursts (sparkles, hits, fireworks) are spawned into a ring buffer and
// simulated by the same shader. Rendered as soft, depth-faded billboards
// (rain as velocity-stretched streaks) that blend additively or as lit
// translucent flakes depending on the effect.

import { bindLayout, bindGroup, createShader, createBuffer } from '../gpu/gpu.js';
import { GLOBALS_WGSL, MATH_WGSL, ATMOSPHERE_WGSL, LIGHTING_WGSL, RECONSTRUCT_WGSL } from './wgsl/common.js';

export const AMBIENT_TYPES = { none: 0, snow: 1, rain: 2, fireflies: 3, embers: 4, dust: 5, spores: 6 };
const BURST_TYPE = 10;
const FLOATS = 16; // pos(4) vel(4) color(4) misc(4)

const STRUCTS = /* wgsl */ `
struct Particle { pos: vec4f, vel: vec4f, color: vec4f, misc: vec4f };
// pos.w = life left, vel.w = max life, color.a = size, misc = type, seed, gravity, drag
struct SimParams { counts: vec4f, cam: vec4f, wind: vec4f, time: vec4f };
// counts: ambient count, total, ambient type, intensity; cam: xyz, range; wind: xz dir, strength, -; time: t, dt, -, -
`;

const SIM_CS = /* wgsl */ `
${STRUCTS}
@group(0) @binding(0) var<storage, read_write> particles: array<Particle>;
@group(0) @binding(1) var<uniform> sim: SimParams;
@group(0) @binding(2) var heightmap: texture_2d<f32>;
@group(0) @binding(3) var<uniform> grid: vec4f; // terrain origin x, z, spacing, res

fn hash(n: f32) -> f32 { return fract(sin(n) * 43758.5453); }
fn ground(p: vec2f) -> f32 {
  let i = vec2i(round((p - grid.xy) / grid.z));
  let n = i32(grid.w) - 1;
  return textureLoad(heightmap, clamp(i, vec2i(0), vec2i(n)), 0).r;
}
fn curl(p: vec3f, t: f32) -> vec3f {
  return vec3f(sin(p.y * 0.9 + t * 0.7) + cos(p.z * 0.6 + t), sin(p.z * 0.8 + t * 0.9) * 0.5, cos(p.x * 0.7 - t * 0.8) + sin(p.y * 0.5 + t));
}

fn respawnAmbient(i: u32, kind: f32, t: f32) -> Particle {
  var p: Particle;
  let s = f32(i) * 1.618 + t * 13.7;
  let range = sim.cam.w;
  let a = vec3f(hash(s), hash(s + 1.3), hash(s + 2.7));
  var pos = sim.cam.xyz + (a - 0.5) * vec3f(range * 2.0, 0.0, range * 2.0);
  let g = ground(pos.xz);
  var life = 6.0;
  var vel = vec3f(0.0);
  var color = vec4f(1.0, 1.0, 1.0, 0.05);
  var gravity = 0.0;
  var drag = 0.0;
  if (kind == 1.0) { // snow
    pos.y = sim.cam.y + a.y * 22.0 - 4.0; vel = vec3f(0.0, -1.1, 0.0); life = 16.0; color = vec4f(0.95, 0.97, 1.0, 0.018 + a.x * 0.014);
  } else if (kind == 2.0) { // rain
    pos.y = sim.cam.y + a.y * 20.0 + 2.0; vel = vec3f(0.0, -16.0, 0.0); life = 2.0; color = vec4f(0.7, 0.75, 0.85, 0.012);
  } else if (kind == 3.0) { // fireflies
    pos.y = g + 0.3 + a.y * 2.5; life = 5.0 + a.x * 6.0; color = vec4f(1.2, 1.7, 0.25, 0.012);
  } else if (kind == 4.0) { // embers
    pos.y = g + a.y * 3.0; vel = vec3f(0.0, 1.2 + a.x * 1.5, 0.0); life = 3.0 + a.x * 4.0; color = vec4f(4.0, 1.2, 0.2, 0.012);
  } else if (kind == 5.0) { // dust motes
    pos.y = g + 0.5 + a.y * 6.0; life = 8.0 + a.x * 8.0; color = vec4f(1.0, 0.92, 0.75, 0.02);
  } else { // spores
    pos.y = g + 0.3 + a.y * 5.0; vel = vec3f(0.0, 0.25, 0.0); life = 7.0 + a.x * 7.0; color = vec4f(0.4, 1.1, 1.4, 0.014);
  }
  p.pos = vec4f(pos, life * (0.3 + 0.7 * a.z));
  p.vel = vec4f(vel, life);
  p.color = color;
  p.misc = vec4f(kind, a.x, gravity, drag);
  return p;
}

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  let total = u32(sim.counts.y);
  if (i >= total) { return; }
  let dt = sim.time.y;
  let t = sim.time.x;
  var p = particles[i];
  let ambient = i < u32(sim.counts.x);
  if (ambient) {
    let kind = sim.counts.z;
    let range = sim.cam.w;
    let off = p.pos.xz - sim.cam.xz;
    if (kind == 0.0) { p.pos.w = 0.0; particles[i] = p; return; }
    if (p.pos.w <= 0.0 || p.misc.x != kind || abs(off.x) > range || abs(off.y) > range || p.pos.y < ground(p.pos.xz) - 0.2) {
      p = respawnAmbient(i, kind, t);
    }
    let wind = vec3f(sim.wind.x, 0.0, sim.wind.y) * sim.wind.z;
    var v = p.vel.xyz;
    if (kind == 1.0) { v = vec3f(0.0, -1.1, 0.0) + wind * 1.5 + curl(p.pos.xyz * 0.5, t) * 0.35; }
    else if (kind == 2.0) { v = vec3f(0.0, -16.0, 0.0) + wind * 3.0; }
    else if (kind == 3.0) { v = curl(p.pos.xyz * 0.6 + p.misc.y * 10.0, t * 0.6) * 0.6; }
    else if (kind == 4.0) { v = vec3f(0.0, v.y, 0.0) + curl(p.pos.xyz, t) * 0.5 + wind * 0.8; }
    else if (kind == 5.0) { v = curl(p.pos.xyz * 0.3, t * 0.3) * 0.15 + wind * 0.3; }
    else { v = vec3f(0.0, 0.25, 0.0) + curl(p.pos.xyz * 0.4, t * 0.4) * 0.2 + wind * 0.2; }
    p.vel = vec4f(v, p.vel.w);
    p.pos = vec4f(p.pos.xyz + v * dt, p.pos.w - dt);
  } else {
    if (p.pos.w <= 0.0) { return; }
    var v = p.vel.xyz;
    v.y -= p.misc.z * dt;
    v *= exp(-p.misc.w * dt);
    var pos = p.pos.xyz + v * dt;
    let g = ground(pos.xz);
    if (pos.y < g + 0.05 && p.misc.z > 0.0) { pos.y = g + 0.05; v = vec3f(v.x * 0.5, -v.y * 0.35, v.z * 0.5); }
    p.vel = vec4f(v, p.vel.w);
    p.pos = vec4f(pos, p.pos.w - dt);
  }
  particles[i] = p;
}
`;

const RENDER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
${STRUCTS}
@group(1) @binding(0) var<storage, read> particles: array<Particle>;
@group(1) @binding(1) var sceneDepth: texture_depth_2d;
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${LIGHTING_WGSL}
${RECONSTRUCT_WGSL}

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) corner: vec2f,
  @location(1) color: vec4f,
  @location(2) @interpolate(flat) mode: f32,
  @location(3) world: vec3f,
};

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let p = particles[ii];
  var corners = array<vec2f, 6>(vec2f(-1.0, -1.0), vec2f(1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, -1.0), vec2f(1.0, 1.0), vec2f(-1.0, 1.0));
  let c = corners[vi];
  o.corner = c;
  if (p.pos.w <= 0.0) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); return o; }
  let kind = p.misc.x;
  let camRight = vec3f(frame.view[0][0], frame.view[1][0], frame.view[2][0]);
  let camUp = vec3f(frame.view[0][1], frame.view[1][1], frame.view[2][1]);
  var size = p.color.a * 4.0;
  var up = camUp;
  var right = camRight;
  var streak = 1.0;
  if (kind == 2.0) {
    // rain: thin streaks stretched along the velocity, never thinner than about a pixel (TAA resolves the rest)
    let toCam = frame.camPos.xyz - p.pos.xyz;
    let camDist = length(toCam);
    let pixel = camDist * frame.camFwd.w * 2.0 * frame.resolution.w;
    let width = max(0.006, pixel * 0.7);
    up = normalize(p.vel.xyz) * 0.5;
    right = normalize(cross(up, toCam)) * width;
    size = 1.0;
    // a thin drop covers only part of a wide streak's area; drops right at the lens are skipped
    streak = clamp(0.012 / width, 0.12, 1.0) * smoothstep(1.2, 3.5, camDist) * 0.45;
  }
  let lifeFrac = clamp(p.pos.w / max(p.vel.w, 1e-3), 0.0, 1.0);
  var fade = smoothstep(0.0, 0.15, lifeFrac) * smoothstep(1.0, 0.85, lifeFrac);
  var col = p.color.rgb;
  var mode = 0.0; // 0 = additive glow, 1 = lit translucent
  if (kind == 3.0) { fade *= 0.5 + 0.5 * sin(frame.time.x * 3.0 + p.misc.y * 40.0); }
  if (kind == 4.0) { col *= 0.6 + 0.4 * sin(frame.time.x * 9.0 + p.misc.y * 30.0); }
  if (kind == 1.0 || kind == 2.0 || kind == 5.0) {
    mode = 1.0;
    let lit = keyRadiance() * 0.25 * cloudShadow(p.pos.xyz) + ambientIrradiance(p.pos.xyz, vec3f(0.0, 1.0, 0.0)) * 1.2;
    col *= lit;
  }
  if (kind >= 10.0) { size = p.color.a; fade = smoothstep(0.0, 0.35, lifeFrac); }
  fade *= streak;
  o.world = p.pos.xyz + (right * c.x + up * c.y) * size;
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  o.color = vec4f(col, fade);
  o.mode = mode;
  return o;
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let d = length(in.corner);
  if (d > 1.0) { discard; }
  var a = smoothstep(1.0, 0.0, d);
  a *= a * in.color.a;
  // soft particles: fade out where they intersect geometry
  let sceneD = textureLoad(sceneDepth, vec2i(in.pos.xy), 0);
  let behind = linearDepth(sceneD) - linearDepth(in.pos.z);
  a *= clamp(behind * 2.0, 0.0, 1.0);
  let dist = length(in.world - frame.camPos.xyz);
  let uv = in.pos.xy * frame.resolution.zw;
  let vol = textureSampleLevel(volumeTex, linearSampler, vec3f(uv, pow(clamp(dist / frame.lightInfo.w, 0.0, 1.0), 1.0 / frame.volInfo.w)), 0.0);
  let t = select(1.0, vol.a, frame.lightInfo.z > 0.5);
  let rgb = in.color.rgb * a * t;
  // premultiplied: additive glow writes alpha 0, lit flakes occlude what is behind them
  return vec4f(rgb, a * in.mode);
}
`;

export class Particles {
  constructor(renderer) {
    const d = (this.device = renderer.device);
    this.renderer = renderer;
    this.total = renderer.tier.particles;
    this.ambientCount = Math.floor(this.total * 0.7);
    this.burstCursor = 0;
    this.ambientType = 0;
    this.intensity = 1;
    this.buffer = createBuffer(d, this.total * FLOATS * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'particles');
    this.simParams = createBuffer(d, 64, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'particle-sim');
    this.gridParams = createBuffer(d, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'particle-grid');
    this.simLayout = bindLayout(d, 'particle-sim', [['C', 'storage'], ['C', 'uniform'], ['C', 'utexture'], ['C', 'uniform']]);
    this.simPipe = d.createComputePipeline({ label: 'particle-sim', layout: d.createPipelineLayout({ bindGroupLayouts: [this.simLayout] }), compute: { module: createShader(d, SIM_CS, 'particle-sim'), entryPoint: 'main' } });
    this.renderLayout = bindLayout(d, 'particle-render', [['V', 'read'], ['F', 'depth']]);
    const module = createShader(d, RENDER_WGSL, 'particles');
    const blend = { color: { srcFactor: 'one', dstFactor: 'one-minus-src-alpha', operation: 'add' }, alpha: { srcFactor: 'zero', dstFactor: 'one', operation: 'add' } };
    this.pipeline = d.createRenderPipeline({
      label: 'particles',
      layout: d.createPipelineLayout({ bindGroupLayouts: [renderer.globalLayout, this.renderLayout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float', blend }] },
      primitive: { topology: 'triangle-list' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
    });
    this.scratch = new Float32Array(FLOATS);
  }

  setAmbient(name, intensity = 1) {
    this.ambientType = AMBIENT_TYPES[name] ?? 0;
    this.intensity = intensity;
  }

  /** Spawn a burst: { position, color (linear rgb, HDR ok), count, speed, size, gravity, life, drag, up } */
  burst({ position, color = [3, 2.5, 1], count = 24, speed = 4, size = 0.12, gravity = 6, life = 1.2, drag = 1.5, up = 2 }) {
    const n = Math.min(count, this.total - this.ambientCount);
    const data = new Float32Array(n * FLOATS);
    for (let k = 0; k < n; k++) {
      const z = Math.random() * 2 - 1, a = Math.random() * Math.PI * 2, r = Math.sqrt(1 - z * z);
      const s = speed * (0.4 + Math.random() * 0.6);
      const l = life * (0.6 + Math.random() * 0.4);
      data.set([position[0], position[1], position[2], l, r * Math.cos(a) * s, z * s + up, r * Math.sin(a) * s, l, color[0], color[1], color[2], size * (0.6 + Math.random() * 0.8), BURST_TYPE, Math.random(), gravity, drag], k * FLOATS);
    }
    const span = this.total - this.ambientCount;
    let written = 0;
    while (written < n) {
      const slot = this.burstCursor % span;
      const chunk = Math.min(n - written, span - slot);
      this.device.queue.writeBuffer(this.buffer, (this.ambientCount + slot) * FLOATS * 4, data, written * FLOATS, chunk * FLOATS);
      written += chunk;
      this.burstCursor += chunk;
    }
  }

  #simGroup() {
    const r = this.renderer;
    if (this._hm !== r.heightmap) {
      this._hm = r.heightmap;
      this.simGroup = bindGroup(this.device, this.simLayout, [this.buffer, this.simParams, r.heightmap.createView(), this.gridParams]);
    }
    return this.simGroup;
  }

  resize() {
    this.renderGroup = bindGroup(this.device, this.renderLayout, [this.buffer, this.renderer.depthView]);
  }

  compute(encoder, r) {
    const cam = r.camera.position;
    const range = this.ambientType === AMBIENT_TYPES.rain ? 18 : 28;
    // how much of the pool each effect uses (glowing effects look best sparse)
    const share = [0, 1, 1, 0.03, 0.12, 0.25, 0.08][this.ambientType] ?? 0;
    const count = Math.floor(this.ambientCount * share * Math.min(1, this.intensity));
    this.device.queue.writeBuffer(this.simParams, 0, new Float32Array([
      count, this.total, this.ambientType, this.intensity,
      cam[0], cam[1], cam[2], range,
      r.env.windDir[0], r.env.windDir[1], r.env.wind, 0,
      r.time, r.dt, 0, 0,
    ]));
    this.device.queue.writeBuffer(this.gridParams, 0, new Float32Array(r.terrain.grid));
    const pass = encoder.beginComputePass({ label: 'particles' });
    pass.setPipeline(this.simPipe);
    pass.setBindGroup(0, this.#simGroup());
    pass.dispatchWorkgroups(Math.ceil(this.total / 64));
    pass.end();
  }

  afterMain(encoder, r) {
    const pass = encoder.beginRenderPass({
      label: 'particles',
      colorAttachments: [{ view: r.hdrView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: r.depthView, depthReadOnly: true },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, r.globalGroup);
    pass.setBindGroup(1, this.renderGroup);
    pass.draw(6, this.total);
    pass.end();
  }
}

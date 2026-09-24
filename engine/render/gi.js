// Heightfield global illumination.
//
// A 2.5D irradiance field: a grid of probes floating just above the terrain
// (48x48 on phones up to 128x128 on ultra). Every frame each probe traces a
// handful of rays, rotated randomly, against the terrain heightmap itself
// (not the screen, so off-screen hills still bounce light and nothing
// flickers as the camera turns). A ray that hits the ground returns the
// light leaving it: its albedo times the sun (with a heightfield shadow ray
// and cloud shadows) plus the irradiance field's own previous value there,
// which makes bounces compound over frames into multi-bounce GI. Rays that
// cross water see sky reflections, rays that cross lava see its glow, and
// rays that escape see the live sky (clouds included) from the environment
// cube. The radiance is projected onto L1 spherical harmonics and blended
// into the previous frame's probes.
//
// Surfaces sample the field with one filtered lookup per layer and get:
//   - large-scale sky occlusion: valleys, canyons and cliff bases darken,
//   - colored bounce light: sunlit grass tints the undersides of things
//     green, red rock warms its surroundings, snow brightens shadows,
//   - emissive terrain light: lava lights up cliffs, props and the fog,
//   - occluded reflections where the terrain blocks the sky.
// Anything far above the terrain fades back to the open-sky irradiance.

import { bindLayout, bindGroup, createShader, createBuffer, texture2D, U } from '../gpu/gpu.js';
import { FRAME, MATH_WGSL, ATMOSPHERE_WGSL, KEY_WGSL, SH_WGSL, CLOUD_WGSL, GI_WGSL } from './wgsl/common.js';

const PROBE_HEIGHT = 1.5;

const GI_CS = /* wgsl */ `
${FRAME.wgsl}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var repeatSampler: sampler;
@group(0) @binding(3) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> shCoeffs: array<vec4f, 9>;
@group(0) @binding(5) var weatherTex: texture_2d<f32>;
@group(0) @binding(6) var heightmap: texture_2d<f32>;
@group(0) @binding(7) var envCube: texture_cube<f32>;
@group(0) @binding(8) var giTex: texture_2d_array<f32>;
@group(0) @binding(9) var outTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(10) var<uniform> params: vec4f; // blend, seed, probe height above ground, -
override RAYS: u32 = 16u;
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${KEY_WGSL}
${SH_WGSL}
${CLOUD_WGSL}
${GI_WGSL}

var<workgroup> partial: array<array<vec4f, 3>, 64>;

fn hfHeight(xz: vec2f) -> f32 {
  let res = frame.terrainGrid.w;
  let g = clamp((xz - frame.terrainGrid.xy) / frame.terrainGrid.z, vec2f(0.0), vec2f(res - 1.001));
  let i = vec2i(floor(g));
  let f = g - floor(g);
  let h00 = textureLoad(heightmap, i, 0).r;
  let h10 = textureLoad(heightmap, i + vec2i(1, 0), 0).r;
  let h01 = textureLoad(heightmap, i + vec2i(0, 1), 0).r;
  let h11 = textureLoad(heightmap, i + vec2i(1, 1), 0).r;
  return mix(mix(h00, h10, f.x), mix(h01, h11, f.x), f.y);
}
fn hfNormal(xz: vec2f) -> vec3f {
  let e = frame.terrainGrid.z;
  let hx = hfHeight(xz + vec2f(e, 0.0)) - hfHeight(xz - vec2f(e, 0.0));
  let hz = hfHeight(xz + vec2f(0.0, e)) - hfHeight(xz - vec2f(0.0, e));
  return normalize(vec3f(-hx, 2.0 * e, -hz));
}
fn inGrid(xz: vec2f) -> bool {
  let g = (xz - frame.terrainGrid.xy) / frame.terrainGrid.z;
  return all(g >= vec2f(0.0)) && all(g <= vec2f(frame.terrainGrid.w - 1.0));
}

/** The terrain material's palette logic, without the close-up detail. */
fn hitAlbedo(p: vec3f, n: vec3f) -> vec3f {
  let range = max(frame.terrain.y - frame.terrain.x, 0.001);
  let hn = (p.y - frame.terrain.x) / range;
  let slope = 1.0 - n.y;
  var low = 1.0 - smoothstep(0.03, 0.16, hn);
  if (frame.terrain.w > 0.5) { low = 1.0 - smoothstep(frame.terrain.z + 0.4, frame.terrain.z + 1.6, p.y); }
  var c = mix(frame.palMid.rgb, frame.palLow.rgb, low);
  c = mix(c, frame.palHigh.rgb, smoothstep(0.66, 0.8, hn) * (1.0 - smoothstep(0.35, 0.55, slope)));
  c = mix(c, frame.palCliff.rgb, smoothstep(0.26, 0.46, slope));
  return c;
}

/** Soft heightfield shadow towards the key light. */
fn sunVisibility(p: vec3f, l: vec3f) -> f32 {
  if (l.y <= 0.0) { return 0.0; }
  var vis = 1.0;
  var t = 1.0;
  for (var i = 0; i < 12; i++) {
    let q = p + l * t;
    if (!inGrid(q.xz) || q.y > frame.terrain.y) { break; }
    vis = min(vis, clamp((q.y - hfHeight(q.xz)) * 8.0 / t, 0.0, 1.0));
    if (vis <= 0.0) { break; }
    t *= 1.55;
  }
  return vis;
}

fn skyRadiance(d: vec3f) -> vec3f { return textureSampleLevel(envCube, linearSampler, d, 1.0).rgb; }

fn surfaceRadiance(p: vec3f, n: vec3f, albedo: vec3f) -> vec3f {
  let l = frame.keyDir.xyz;
  let direct = keyRadiance() * max(dot(n, l), 0.0) * sunVisibility(p + n * 0.3, l) * cloudShadow(p) / PI;
  // the field's previous value at the hit carries the earlier bounces
  return albedo * (direct + ambientIrradiance(p, n));
}

fn waterRadiance(p: vec3f, d: vec3f) -> vec3f {
  if (frame.water.w > 0.5) { return frame.water.rgb * 3.0; } // lava glows
  let fresnel = 0.02 + 0.98 * pow(1.0 - abs(d.y), 5.0);
  return frame.water.rgb * ambientIrradiance(p, vec3f(0.0, 1.0, 0.0)) * 0.8 + skyRadiance(reflect(d, vec3f(0.0, 1.0, 0.0))) * fresnel;
}

/** Radiance arriving at o from direction d, traced against the heightfield. */
fn trace(o: vec3f, d: vec3f) -> vec3f {
  let water = frame.terrain.w > 0.5;
  var t = 0.3;
  var prevT = 0.0;
  for (var i = 0; i < 40; i++) {
    let p = o + d * t;
    if (!inGrid(p.xz)) { break; }
    if (d.y >= 0.0 && p.y > frame.terrain.y + 1.0) { return skyRadiance(d); }
    if (p.y < hfHeight(p.xz)) {
      var lo = prevT;
      var hi = t;
      for (var k = 0; k < 5; k++) {
        let m = 0.5 * (lo + hi);
        let q = o + d * m;
        if (q.y < hfHeight(q.xz)) { hi = m; } else { lo = m; }
      }
      let hp = o + d * hi;
      if (water && hp.y < frame.terrain.z) { return waterRadiance(o + d * ((frame.terrain.z - o.y) / d.y), d); }
      let n = hfNormal(hp.xz);
      return surfaceRadiance(hp, n, hitAlbedo(hp, n));
    }
    if (water && p.y < frame.terrain.z) { return waterRadiance(o + d * ((frame.terrain.z - o.y) / min(d.y, -1e-4)), d); }
    prevT = t;
    t += max(0.4, t * 0.16);
  }
  // left the terrain: the sky above, the sea or distant ground below
  if (d.y >= 0.0) { return skyRadiance(d); }
  if (water) { return waterRadiance(o, d); }
  let up = vec3f(0.0, 1.0, 0.0);
  return frame.palMid.rgb * 0.8 * (keyRadiance() * max(frame.keyDir.y, 0.0) / PI + skyIrradiance(up));
}

fn fibDir(i: u32, count: u32) -> vec3f {
  let y = 1.0 - 2.0 * (f32(i) + 0.5) / f32(count);
  let r = sqrt(max(0.0, 1.0 - y * y));
  let phi = f32(i) * 2.39996323;
  return vec3f(cos(phi) * r, y, sin(phi) * r);
}
/** Rotate by a random unit quaternion (Shoemake) so every frame traces new directions. */
fn randomRotate(v: vec3f, seed: vec3f) -> vec3f {
  let u1 = hash13(seed + vec3f(0.13, 7.1, 3.3));
  let u2 = hash13(seed + vec3f(5.7, 1.9, 8.8));
  let u3 = hash13(seed + vec3f(2.4, 9.6, 4.1));
  let q = vec4f(sqrt(1.0 - u1) * sin(TAU * u2), sqrt(1.0 - u1) * cos(TAU * u2), sqrt(u1) * sin(TAU * u3), sqrt(u1) * cos(TAU * u3));
  return v + 2.0 * cross(q.xyz, cross(q.xyz, v) + q.w * v);
}

@compute @workgroup_size(64)
fn main(@builtin(workgroup_id) wg: vec3u, @builtin(local_invocation_index) li: u32) {
  let n = textureDimensions(outTex).x;
  let perGroup = 64u / RAYS;
  let probe = wg.x * perGroup + li / RAYS;
  let ray = li % RAYS;
  let valid = probe < n * n;
  let pc = vec2u(probe % n, probe / n);
  let uv = (vec2f(pc) + 0.5) / f32(n);
  let xz = frame.gi.xy + uv * frame.gi.z;
  var y = hfHeight(xz) + params.z;
  if (frame.terrain.w > 0.5) { y = max(y, frame.terrain.z + 0.6); }

  var c = array<vec4f, 3>(vec4f(0.0), vec4f(0.0), vec4f(0.0));
  if (valid) {
    let d = randomRotate(fibDir(ray, RAYS), vec3f(vec2f(pc), params.y));
    let L = trace(vec3f(xz.x, y, xz.y), d);
    // project onto L1 spherical harmonics (Monte Carlo over the sphere)
    let sh = vec4f(0.282095, 0.488603 * d.y, 0.488603 * d.z, 0.488603 * d.x) * (4.0 * PI / f32(RAYS));
    c[0] = sh * L.r;
    c[1] = sh * L.g;
    c[2] = sh * L.b;
  }
  partial[li] = c;
  workgroupBarrier();
  if (valid && ray == 0u) {
    var s = array<vec4f, 3>(vec4f(0.0), vec4f(0.0), vec4f(0.0));
    for (var k = 0u; k < RAYS; k++) {
      s[0] += partial[li + k][0];
      s[1] += partial[li + k][1];
      s[2] += partial[li + k][2];
    }
    for (var layer = 0; layer < 3; layer++) {
      let prev = textureLoad(giTex, pc, layer, 0);
      textureStore(outTex, pc, layer, mix(prev, s[layer], params.x));
    }
    textureStore(outTex, pc, 3, vec4f(y, 0.0, 0.0, 1.0));
  }
}
`;

export class GI {
  constructor(renderer) {
    this.renderer = renderer;
    const d = (this.device = renderer.device);
    this.size = renderer.tier.giProbes;
    this.rays = renderer.tier.giRays;
    this.scratch = texture2D(d, { width: this.size, height: this.size, layers: 4, format: 'rgba16float', usage: U.STO | U.CSRC, label: 'gi-scratch' });
    // one parameter block per iteration of the first frame (queue writes land before the whole encoder runs)
    this.paramBuffers = [0, 1, 2, 3].map((i) => createBuffer(d, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, `gi-params-${i}`));
    this.layout = bindLayout(d, 'gi', [
      ['C', 'uniform'], ['C', 'sampler'], ['C', 'sampler'], ['C', 'texture'], ['C', 'read'], ['C', 'texture'],
      ['C', 'utexture'], ['C', 'cube'], ['C', 'texture-array'], ['C', 'storage-texture:rgba16float:2d-array'], ['C', 'uniform'],
    ]);
    this.pipe = d.createComputePipeline({
      label: 'gi-probes', layout: d.createPipelineLayout({ bindGroupLayouts: [this.layout] }),
      compute: { module: createShader(d, GI_CS, 'gi-probes'), entryPoint: 'main', constants: { RAYS: this.rays } },
    });
    this.accumulated = 0;
    this.seed = 0;
  }

  attach(renderer) { renderer.giEnabled = true; }

  /** A new world: forget the old light and converge quickly. */
  onTerrain() { this.accumulated = 0; }
  /** New lighting (time of day, weather): re-converge fast but keep the old result as a start. */
  onEnvironment() { this.accumulated = Math.min(this.accumulated, 2); }

  #group(i) {
    const r = this.renderer;
    if (this._hm !== r.heightmap) {
      this._hm = r.heightmap;
      const a = r.atmosphere;
      this.groups = this.paramBuffers.map((params) => bindGroup(this.device, this.layout, [
        r.frameBuffer, r.samplers.linear, r.samplers.repeat, a.transmittance.createView(), a.shBuffer, r.weatherView,
        r.heightmap.createView(), a.envView, r.giView, this.scratch.createView({ dimension: '2d-array' }), params,
      ], 'gi'));
    }
    return this.groups[i];
  }

  update(encoder) {
    const r = this.renderer;
    if (!r.heightfield) return;
    // a new world converges its first bounces within one frame
    const iterations = this.accumulated === 0 ? 4 : 1;
    for (let i = 0; i < iterations; i++) {
      // running average at first, then an exponential history that follows moving clouds and the sun
      const blend = Math.max(0.08, 1 / (this.accumulated + 1));
      this.accumulated++;
      this.seed = (this.seed + 1) % 4096;
      const params = this.paramBuffers[i];
      this.device.queue.writeBuffer(params, 0, new Float32Array([blend, this.seed, PROBE_HEIGHT, 0]));
      const pass = encoder.beginComputePass({ label: 'gi' });
      pass.setPipeline(this.pipe);
      pass.setBindGroup(0, this.#group(i));
      pass.dispatchWorkgroups(Math.ceil((this.size * this.size) / (64 / this.rays)));
      pass.end();
      encoder.copyTextureToTexture({ texture: this.scratch }, { texture: r.giTexture }, [this.size, this.size, 4]);
    }
  }
}

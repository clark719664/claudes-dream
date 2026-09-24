// Volumetric clouds.
//
// Clouds are raymarched through a curved shell around the planet, shaped by a
// weather map (coverage, cloud type) and two tileable 3D noises (Perlin-Worley
// base shape, Worley erosion detail), lit by the physical atmosphere with a
// cone-traced light march, multiple-scattering octaves, a dual-lobe phase
// function and "powder" darkening, and hazed by distance into the sky.
//
// The cloud panorama. Clouds are kilometres away, so moving the camera a few
// metres doesn't change them. Instead of raymarching every screen pixel every
// frame, Reverie keeps the clouds in a sky-dome panorama (rows spaced by
// sqrt(elevation) so the horizon gets the most texels) and refreshes 1/16 of
// its texels per frame in an ordered pattern, accumulating each refresh into
// the previous result. The payoff:
//   - the cost is fixed and independent of screen resolution (phones pay the
//     same small price as 4K monitors),
//   - clouds never ghost or smear when the camera turns, because the cache is
//     indexed by direction rather than by screen position,
//   - the sky, water reflections, the environment cube and the ambient light
//     (spherical harmonics) all read the same clouds, so an overcast sky
//     darkens the world and a sunset cloud tints the sea.

import { bindLayout, bindGroup, createShader, createBuffer } from '../gpu/gpu.js';
import { FRAME, MATH_WGSL, ATMOSPHERE_WGSL, SH_WGSL, CLOUD_WGSL, PANO_WGSL } from './wgsl/common.js';
import { SKY_LUT_WGSL } from './atmosphere.js';

export const WEATHER_SIZE = 512;
const SHAPE_SIZE = 64;
const DETAIL_SIZE = 32;

// ---------------------------------------------------------------- tileable noise

const NOISE_WGSL = /* wgsl */ `
fn hash33(p: vec3f) -> vec3f {
  var q = fract(p * vec3f(0.1031, 0.1030, 0.0973));
  q += dot(q, q.yxz + 33.33);
  return fract((q.xxy + q.yxx) * q.zyx);
}
fn wrap3(c: vec3f, period: f32) -> vec3f { return c - period * floor(c / period); }

/** Tileable cellular noise: 1 on the feature points, falling towards 0 between them. */
fn worley3(p: vec3f, period: f32) -> f32 {
  let id = floor(p);
  let f = p - id;
  var d = 1.0;
  for (var z = -1; z <= 1; z++) {
    for (var y = -1; y <= 1; y++) {
      for (var x = -1; x <= 1; x++) {
        let o = vec3f(f32(x), f32(y), f32(z));
        let r = o + hash33(wrap3(id + o, period)) - f;
        d = min(d, dot(r, r));
      }
    }
  }
  return clamp(1.0 - sqrt(d), 0.0, 1.0);
}
fn worleyFbm(p: vec3f, period: f32) -> f32 {
  return worley3(p, period) * 0.625 + worley3(p * 2.0, period * 2.0) * 0.25 + worley3(p * 4.0, period * 4.0) * 0.125;
}

fn grad3(c: vec3f, period: f32) -> vec3f { return normalize(hash33(wrap3(c, period)) * 2.0 - 1.0 + vec3f(1e-4)); }
/** Tileable gradient noise in about [-1, 1]. */
fn perlin3(p: vec3f, period: f32) -> f32 {
  let i = floor(p);
  let f = p - i;
  let u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  let n000 = dot(grad3(i, period), f);
  let n100 = dot(grad3(i + vec3f(1.0, 0.0, 0.0), period), f - vec3f(1.0, 0.0, 0.0));
  let n010 = dot(grad3(i + vec3f(0.0, 1.0, 0.0), period), f - vec3f(0.0, 1.0, 0.0));
  let n110 = dot(grad3(i + vec3f(1.0, 1.0, 0.0), period), f - vec3f(1.0, 1.0, 0.0));
  let n001 = dot(grad3(i + vec3f(0.0, 0.0, 1.0), period), f - vec3f(0.0, 0.0, 1.0));
  let n101 = dot(grad3(i + vec3f(1.0, 0.0, 1.0), period), f - vec3f(1.0, 0.0, 1.0));
  let n011 = dot(grad3(i + vec3f(0.0, 1.0, 1.0), period), f - vec3f(0.0, 1.0, 1.0));
  let n111 = dot(grad3(i + vec3f(1.0, 1.0, 1.0), period), f - vec3f(1.0, 1.0, 1.0));
  return mix(mix(mix(n000, n100, u.x), mix(n010, n110, u.x), u.y), mix(mix(n001, n101, u.x), mix(n011, n111, u.x), u.y), u.z) * 1.4;
}
fn perlinFbm(p: vec3f, period: f32, octaves: i32) -> f32 {
  var s = 0.0;
  var a = 1.0;
  var n = 0.0;
  var q = p;
  var per = period;
  for (var i = 0; i < octaves; i++) {
    s += perlin3(q, per) * a;
    n += a;
    q *= 2.0;
    per *= 2.0;
    a *= 0.5;
  }
  return s / n;
}
`;

const SHAPE_CS = /* wgsl */ `
${NOISE_WGSL}
@group(0) @binding(0) var outTex: texture_storage_3d<rgba8unorm, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outTex).x;
  if (any(id >= vec3u(n))) { return; }
  let p = (vec3f(id) + 0.5) / f32(n);
  // billowy Perlin, dilated by Worley: round cauliflower heads with connected bases
  let billow = clamp(abs(perlinFbm(p * 4.0, 4.0, 5)), 0.0, 1.0);
  let w1 = worleyFbm(p * 4.0, 4.0);
  let pw = w1 + billow * (1.0 - w1);
  textureStore(outTex, id, vec4f(pw, w1, worleyFbm(p * 8.0, 8.0), worleyFbm(p * 16.0, 16.0)));
}
`;

const DETAIL_CS = /* wgsl */ `
${NOISE_WGSL}
@group(0) @binding(0) var outTex: texture_storage_3d<rgba8unorm, write>;
@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outTex).x;
  if (any(id >= vec3u(n))) { return; }
  let p = (vec3f(id) + 0.5) / f32(n);
  textureStore(outTex, id, vec4f(worleyFbm(p * 2.0, 2.0), worleyFbm(p * 4.0, 4.0), worleyFbm(p * 8.0, 8.0), 1.0));
}
`;

// Weather map: r coverage, g cloud type (0 flat stratus .. 1 towering cumulus), b local detail, a storm cells.
const WEATHER_CS = /* wgsl */ `
${NOISE_WGSL}
@group(0) @binding(0) var outTex: texture_storage_2d<rgba8unorm, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let n = textureDimensions(outTex).x;
  if (id.x >= n || id.y >= n) { return; }
  let p = vec3f((vec2f(id.xy) + 0.5) / f32(n), 0.37);
  let coverage = perlinFbm(p * 8.0, 8.0, 5) * 0.5 + 0.5;
  let cells = worley3(p * 16.0, 16.0);
  let cov = clamp(coverage * 0.8 + cells * 0.3 - 0.05, 0.0, 1.0);
  let kind = clamp(perlinFbm(p * 3.0 + vec3f(0.0, 0.0, 5.3), 3.0, 3) * 0.9 + 0.55, 0.0, 1.0);
  let detail = perlinFbm(p * 32.0 + vec3f(0.0, 0.0, 9.1), 32.0, 3) * 0.5 + 0.5;
  let storm = clamp(perlinFbm(p * 4.0 + vec3f(0.0, 0.0, 2.2), 4.0, 3) * 1.6 + 0.2, 0.0, 1.0);
  textureStore(outTex, id.xy, vec4f(cov, kind, detail, storm));
}
`;

/** Generate the tileable weather map once (shared by every cloud effect, on every tier). */
export function createWeatherMap(device) {
  const tex = device.createTexture({
    label: 'weather-map', size: [WEATHER_SIZE, WEATHER_SIZE], format: 'rgba8unorm',
    usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
  });
  runOnce(device, WEATHER_CS, 'weather-map', tex.createView(), 'storage-texture:rgba8unorm:2d', [WEATHER_SIZE / 8, WEATHER_SIZE / 8, 1]);
  return tex;
}

function runOnce(device, code, label, view, type, groups) {
  const layout = bindLayout(device, label, [['C', type]]);
  const pipe = device.createComputePipeline({
    label, layout: device.createPipelineLayout({ bindGroupLayouts: [layout] }),
    compute: { module: createShader(device, code, label), entryPoint: 'main' },
  });
  const enc = device.createCommandEncoder({ label });
  const pass = enc.beginComputePass({ label });
  pass.setPipeline(pipe);
  pass.setBindGroup(0, bindGroup(device, layout, [view]));
  pass.dispatchWorkgroups(...groups);
  pass.end();
  device.queue.submit([enc.finish()]);
}

// ---------------------------------------------------------------- raymarching

const MARCH_CS = /* wgsl */ `
${FRAME.wgsl}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var repeatSampler: sampler;
@group(0) @binding(3) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(4) var skyviewLUT: texture_2d<f32>;
@group(0) @binding(5) var<storage, read> shCoeffs: array<vec4f, 9>;
@group(0) @binding(6) var weatherTex: texture_2d<f32>;
@group(0) @binding(7) var shapeTex: texture_3d<f32>;
@group(0) @binding(8) var detailTex: texture_3d<f32>;
@group(0) @binding(9) var<storage, read_write> cloudPano: array<vec2u>;
struct Params { pattern: vec4f, march: vec4f };
@group(0) @binding(10) var<uniform> params: Params; // pattern: stride, offset x, offset y, blend; march: min steps, max steps, seed, -
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${SH_WGSL}
${CLOUD_WGSL}
${PANO_WGSL}
${SKY_LUT_WGSL}

const EARTH_R = 6360000.0;
const SHAPE_TILE = 4000.0;
const DETAIL_TILE = 640.0;
const MAX_DIST = 36000.0;
const HAZE = 1.0 / 26000.0;
const MS_GAIN = 2.6; // light scattered many times inside the cloud that the octaves don't capture

fn remap(v: f32, l0: f32, h0: f32, l1: f32, h1: f32) -> f32 { return l1 + (v - l0) * (h1 - l1) / (h0 - l0); }

/** Altitude (m) of a camera-relative point above a planet whose centre lies straight below the camera. */
fn altitudeOf(rel: vec3f) -> f32 {
  let y = rel.y + frame.camPos.y;
  let num = 2.0 * EARTH_R * y + y * y + rel.x * rel.x + rel.z * rel.z;
  return num / (EARTH_R + sqrt(EARTH_R * EARTH_R + num));
}
/** Distance along a ray (camera below the sphere) to where it leaves the sphere at altitude h. Cancellation free. */
fn shellExit(b: f32, h: f32) -> f32 {
  let camY = frame.camPos.y;
  let c = (camY - h) * (2.0 * EARTH_R + camY + h);
  let s = sqrt(max(b * b - c, 0.0));
  return select(s - b, -c / (b + s), b > 0.0);
}
/** Distance to where a downward ray (camera above altitude h) enters that sphere, or -1. */
fn shellEnter(b: f32, h: f32) -> f32 {
  let camY = frame.camPos.y;
  let c = (camY - h) * (2.0 * EARTH_R + camY + h);
  let disc = b * b - c;
  if (disc < 0.0 || b >= 0.0) { return -1.0; }
  return c / (sqrt(disc) - b);
}

/** Vertical profile by cloud type: flat stratus sheets up to towering cumulus. */
fn heightProfile(h: f32, kind: f32) -> f32 {
  let top = mix(0.28, 1.0, kind);
  let base = smoothstep(0.0, mix(0.05, 0.12, kind), h);
  let crown = 1.0 - smoothstep(top * mix(0.55, 0.35, kind), top, h);
  return base * crown;
}

/** Cloud density at world point p (x, altitude, z) and normalised layer height h. */
fn cloudDensity(p: vec3f, h: f32, detail: bool) -> f32 {
  let w = weatherAt(p.xz);
  let coverage = coverageFrom(w.r);
  if (coverage <= 0.0) { return 0.0; }
  // shear: cloud tops lean downwind; the noise drifts with the weather map
  let q = p + vec3f(frame.wind.z + frame.wind.x * h * 700.0, 0.0, frame.wind.w + frame.wind.y * h * 700.0);
  let shape = textureSampleLevel(shapeTex, repeatSampler, q / SHAPE_TILE, 0.0);
  let lowFbm = shape.g * 0.625 + shape.b * 0.25 + shape.a * 0.125;
  var base = remap(shape.r, lowFbm - 1.0, 1.0, 0.0, 1.0);
  base *= heightProfile(h, w.g);
  base = clamp(remap(base, 1.0 - coverage, 1.0, 0.0, 1.0), 0.0, 1.0) * coverage;
  if (!detail || base <= 0.0) { return base; }
  // erode the edges with Worley detail: wispy at the base, billowy at the top
  let dq = q / DETAIL_TILE + vec3f(0.0, frame.time.x * 0.01, 0.0);
  let det = textureSampleLevel(detailTex, repeatSampler, dq, 0.0);
  let highFbm = det.r * 0.625 + det.g * 0.25 + det.b * 0.125;
  let modifier = mix(1.0 - highFbm, highFbm, clamp(h * 6.0, 0.0, 1.0));
  return clamp(remap(base, modifier * 0.5, 1.0, 0.0, 1.0), 0.0, 1.0);
}

fn densityAt(rel: vec3f, detail: bool) -> f32 {
  let alt = altitudeOf(rel);
  let h = (alt - frame.clouds.x) / (frame.clouds.y - frame.clouds.x);
  if (h < 0.0 || h > 1.0) { return 0.0; }
  return cloudDensity(vec3f(frame.camPos.x + rel.x, alt, frame.camPos.z + rel.z), h, detail);
}

/** Optical depth towards the key light: six cone samples with growing steps. */
fn lightDepth(rel: vec3f, l: vec3f) -> f32 {
  var od = 0.0;
  var t = 0.0;
  var step = 36.0;
  for (var i = 0; i < 6; i++) {
    let sampleT = t + step * 0.5;
    od += densityAt(rel + l * sampleT, i < 2) * step;
    t += step;
    step *= 1.9;
  }
  return od * frame.clouds.z;
}

fn phaseClouds(c: f32, k: f32) -> f32 {
  return mix(phaseHG(c, 0.8 * k), phaseHG(c, -0.3 * k), 0.3);
}

fn keyAtClouds() -> vec3f {
  let k = frame.keyDir.xyz;
  let r = R_BOTTOM + mix(frame.clouds.x, frame.clouds.y, 0.5) * 0.001;
  // the key light still reaches the clouds for a while after it sets on the ground
  let horizon = -sqrt(max(1.0 - (R_BOTTOM / r) * (R_BOTTOM / r), 0.0));
  let lit = smoothstep(horizon - 0.01, horizon + 0.02, k.y);
  let t = textureSampleLevel(transmittanceLUT, linearSampler, transmittanceUV(r, max(k.y, horizon + 0.002)), 0.0).rgb;
  // moonlit clouds stay moody: silver edges rather than daylight white
  if (frame.keyDir.w > 0.5) { return t * frame.moonDir.w * vec3f(0.75, 0.85, 1.0) * lit * 0.45; }
  return t * frame.sunDir.w * lit;
}

fn march(d: vec3f, jitter: f32) -> vec4f {
  let camY = frame.camPos.y;
  let bottom = frame.clouds.x;
  let top = frame.clouds.y;
  let b = (EARTH_R + camY) * d.y;
  var t0 = 0.0;
  var t1 = 0.0;
  if (camY < bottom) {
    if (d.y < 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
    t0 = shellExit(b, bottom);
    t1 = shellExit(b, top);
  } else if (camY < top) {
    t1 = shellExit(b, top);
    let tb = shellEnter(b, bottom);
    if (tb > 0.0) { t1 = min(t1, tb); }
  } else {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }
  t1 = min(t1, MAX_DIST);
  if (t1 <= t0) { return vec4f(0.0, 0.0, 0.0, 1.0); }

  let len = t1 - t0;
  let steps = i32(mix(params.march.x, params.march.y, clamp(len / 16000.0, 0.0, 1.0)));
  let dt = len / f32(steps);
  let l = frame.keyDir.xyz;
  let cosT = dot(d, l);
  let keyL = keyAtClouds();
  let ambTop = skyIrradiance(vec3f(0.0, 1.0, 0.0));
  let ambGround = skyIrradiance(vec3f(0.0, -1.0, 0.0)) * 0.6 + ambTop * frame.skyTint.w * 0.15;
  let sigma = frame.clouds.z;
  // looking into the sun the forward lobe dominates and "powder" darkening fades out
  let powderAmount = 1.0 - smoothstep(-0.1, 0.85, cosT);

  var T = 1.0;
  var S = vec3f(0.0);
  var distSum = 0.0;
  var t = t0 + dt * jitter;
  for (var i = 0; i < steps; i++) {
    let rel = d * t;
    let dens = densityAt(rel, true);
    if (dens > 0.002) {
      let sigT = dens * sigma;
      let od = lightDepth(rel, l);
      // multiple scattering as octaves of ever softer, more penetrating light (Wrenninge 2013)
      var sun = 0.0;
      var a = 1.0;
      var e = 1.0;
      for (var o = 0; o < 4; o++) {
        sun += a * phaseClouds(cosT, e) * exp(-od * e * 0.6);
        a *= 0.62;
        e *= 0.45;
      }
      let powder = mix(1.0, 1.0 - exp(-od * 3.0 - sigT * 40.0), powderAmount * 0.5);
      let h = clamp((altitudeOf(rel) - bottom) / (top - bottom), 0.0, 1.0);
      let ambient = ambTop * mix(0.35, 1.0, sqrt(h)) + ambGround * (1.0 - h) * 0.5;
      let lum = keyL * sun * powder * MS_GAIN + ambient;
      let Ts = exp(-sigT * dt);
      // energy-conserving integration of the step (Hillaire 2015)
      S += T * (lum - lum * Ts);
      distSum += t * T * (1.0 - Ts);
      T *= Ts;
      if (T < 0.01) { T = 0.0; break; }
    }
    t += dt;
  }
  let covered = 1.0 - T;
  if (covered <= 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  // aerial haze: distant clouds melt into the sky behind them
  let meanDist = distSum / covered;
  let air = exp(-meanDist * HAZE * frame.atmos.x / 22.0);
  let rgb = S * air + skyLUT(d) * covered * (1.0 - air);
  return vec4f(rgb, T);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let W = u32(frame.cloudPano.x);
  let H = u32(frame.cloudPano.y);
  let stride = u32(params.pattern.x);
  let px = id.x * stride + u32(params.pattern.y);
  let py = id.y * stride + u32(params.pattern.z);
  if (px >= W || py >= H) { return; }
  let uv = (vec2f(f32(px), f32(py)) + 0.5) / vec2f(f32(W), f32(H));
  let jitter = fract(ign(vec2f(f32(px), f32(py))) + params.march.z * 0.618034);
  let res = march(panoDir(uv), jitter);
  let idx = py * W + px;
  let old = vec4f(unpack2x16float(cloudPano[idx].x), unpack2x16float(cloudPano[idx].y));
  let v = mix(old, res, params.pattern.w);
  cloudPano[idx] = vec2u(pack2x16float(v.rg), pack2x16float(v.ba));
}
`;

// 4x4 ordered refresh pattern: every texel is re-marched once every 16 frames.
const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
const PATTERN = BAYER.map((_, i) => { const k = BAYER.indexOf(i); return [k % 4, k >> 2]; });
const FAST = [[0, 0], [1, 1], [1, 0], [0, 1]];

/** Allocate a cloud panorama buffer, cleared to an empty sky (transmittance 1). */
export function createCloudPanorama(device, width, height) {
  const texels = Math.max(1, width * height);
  const data = new Uint32Array(texels * 2);
  for (let i = 1; i < data.length; i += 2) data[i] = 0x3c000000; // (b = 0, transmittance = 1.0 in f16)
  return createBuffer(device, data.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'cloud-panorama', data);
}

export class Clouds {
  constructor(renderer) {
    this.renderer = renderer;
    const d = (this.device = renderer.device);
    const tier = renderer.tier;
    this.steps = tier.cloudSteps;
    [this.width, this.height] = tier.cloudPano;
    this.frame = 0;
    this.refresh = 4;

    const make3D = (size, label) => d.createTexture({
      label, size: [size, size, size], dimension: '3d', format: 'rgba8unorm',
      usage: GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING,
    });
    this.shape = make3D(SHAPE_SIZE, 'cloud-shape');
    this.detail = make3D(DETAIL_SIZE, 'cloud-detail');
    runOnce(d, SHAPE_CS, 'cloud-shape', this.shape.createView({ dimension: '3d' }), 'storage-texture:rgba8unorm:3d', [SHAPE_SIZE / 4, SHAPE_SIZE / 4, SHAPE_SIZE / 4]);
    runOnce(d, DETAIL_CS, 'cloud-detail', this.detail.createView({ dimension: '3d' }), 'storage-texture:rgba8unorm:3d', [DETAIL_SIZE / 4, DETAIL_SIZE / 4, DETAIL_SIZE / 4]);

    this.sampler = d.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat', addressModeW: 'repeat' });
    this.params = createBuffer(d, 32, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'cloud-params');
    this.paramData = new Float32Array(8);
    const layout = bindLayout(d, 'clouds', [
      ['C', 'uniform'], ['C', 'sampler'], ['C', 'sampler'], ['C', 'texture'], ['C', 'texture'], ['C', 'read'],
      ['C', 'texture'], ['C', 'texture3d'], ['C', 'texture3d'], ['C', 'storage'], ['C', 'uniform'],
    ]);
    this.pipe = d.createComputePipeline({
      label: 'cloud-march', layout: d.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: createShader(d, MARCH_CS, 'cloud-march'), entryPoint: 'main' },
    });
    const a = renderer.atmosphere;
    this.group = bindGroup(d, layout, [
      renderer.frameBuffer, renderer.samplers.linear, this.sampler, a.transmittance.createView(), a.skyview.createView(), a.shBuffer,
      renderer.weatherView, this.shape.createView({ dimension: '3d' }), this.detail.createView({ dimension: '3d' }),
      renderer.cloudPanorama, this.params,
    ], 'clouds');
  }

  attach(renderer) { renderer.cloudsEnabled = true; }

  /** Re-march the whole panorama over the next four frames (new world, new weather). */
  invalidate() { this.refresh = 4; }
  onEnvironment() { this.invalidate(); }

  update(encoder) {
    let stride, offset, blend;
    if (this.refresh > 0) {
      stride = 2; offset = FAST[4 - this.refresh]; blend = 1;
      if (--this.refresh === 0) this.renderer.atmosphere.invalidate(); // reflections and ambient pick up the new clouds
    } else {
      stride = 4; offset = PATTERN[this.frame % 16]; blend = 0.45;
    }
    this.frame++;
    const p = this.paramData;
    p.set([stride, offset[0], offset[1], blend, this.steps[0], this.steps[1], this.frame % 997, 0]);
    this.device.queue.writeBuffer(this.params, 0, p);
    const pass = encoder.beginComputePass({ label: 'clouds' });
    pass.setPipeline(this.pipe);
    pass.setBindGroup(0, this.group);
    pass.dispatchWorkgroups(Math.ceil(this.width / stride / 8), Math.ceil(this.height / stride / 8));
    pass.end();
  }
}

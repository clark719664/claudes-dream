// Physically based sky (Hillaire 2020, "A Scalable and Production Ready Sky
// and Atmosphere Rendering Technique") plus image based lighting derived from
// it. Everything is computed on the GPU and refreshed as the sun moves, so
// time of day, sunsets and night skies relight the whole world for free.

import { bindLayout, bindGroup, createShader, createBuffer, texture2D, U } from '../gpu/gpu.js';
import { FRAME, MATH_WGSL, ATMOSPHERE_WGSL } from './wgsl/common.js';

const TRANSMITTANCE_SIZE = [256, 64];
const MULTISCATTER_SIZE = [32, 32];
const SKYVIEW_SIZE = [192, 108];

// ---------------------------------------------------------------- shaders

const TRANSMITTANCE_CS = /* wgsl */ `
${MATH_WGSL}
${ATMOSPHERE_WGSL}
@group(0) @binding(0) var outTex: texture_storage_2d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(outTex);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let p = transmittanceParams(uv);
  let ro = vec3f(0.0, p.x, 0.0);
  let rd = vec3f(sqrt(max(1.0 - p.y * p.y, 0.0)), p.y, 0.0);
  let tMax = raySphere(ro, rd, R_TOP);
  var od = vec3f(0.0);
  let steps = 40;
  let dt = max(tMax, 0.0) / f32(steps);
  for (var i = 0; i < steps; i++) {
    let pos = ro + rd * ((f32(i) + 0.5) * dt);
    od += sampleMedium(length(pos) - R_BOTTOM).extinction * dt;
  }
  textureStore(outTex, id.xy, vec4f(exp(-od), 1.0));
}
`;

const MULTISCATTER_CS = /* wgsl */ `
${MATH_WGSL}
${ATMOSPHERE_WGSL}
@group(0) @binding(0) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> params: vec4f; // x = ground albedo

fn transmittanceTo(pos: vec3f, dir: vec3f) -> vec3f {
  let r = length(pos);
  return textureSampleLevel(transmittanceLUT, linearSampler, transmittanceUV(r, dot(pos / r, dir)), 0.0).rgb;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(outTex);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let sunCos = uv.x * 2.0 - 1.0;
  let h = mix(R_BOTTOM + 0.005, R_TOP - 0.005, uv.y);
  let pos = vec3f(0.0, h, 0.0);
  let sunDir = normalize(vec3f(sqrt(max(1.0 - sunCos * sunCos, 0.0)), sunCos, 0.0));
  var lum = vec3f(0.0);
  var fms = vec3f(0.0);
  let N = 8;
  for (var i = 0; i < N; i++) {
    for (var j = 0; j < N; j++) {
      let az = TAU * (f32(i) + 0.5) / f32(N);
      let cz = 1.0 - 2.0 * (f32(j) + 0.5) / f32(N);
      let sz = sqrt(max(1.0 - cz * cz, 0.0));
      let rd = vec3f(cos(az) * sz, cz, sin(az) * sz);
      let tBottom = raySphere(pos, rd, R_BOTTOM);
      let tTop = raySphere(pos, rd, R_TOP);
      let tMax = select(tTop, tBottom, tBottom > 0.0);
      let steps = 20;
      let dt = max(tMax, 0.0) / f32(steps);
      var T = vec3f(1.0);
      var L = vec3f(0.0);
      var F = vec3f(0.0);
      for (var s = 0; s < steps; s++) {
        let p = pos + rd * ((f32(s) + 0.5) * dt);
        let m = sampleMedium(length(p) - R_BOTTOM);
        let ext = max(m.extinction, vec3f(1e-7));
        let sampleT = exp(-ext * dt);
        let shadow = select(1.0, 0.0, raySphere(p, sunDir, R_BOTTOM) > 0.0);
        let S = m.scattering * transmittanceTo(p, sunDir) * shadow / (4.0 * PI);
        L += T * (S - S * sampleT) / ext;
        F += T * (m.scattering - m.scattering * sampleT) / ext;
        T *= sampleT;
      }
      if (tBottom > 0.0) {
        let p = pos + rd * tBottom;
        let n = normalize(p);
        L += T * transmittanceTo(p, sunDir) * max(dot(n, sunDir), 0.0) * params.x / PI;
      }
      lum += L;
      fms += F;
    }
  }
  lum /= f32(N * N);
  fms /= f32(N * N);
  textureStore(outTex, id.xy, vec4f(lum / max(1.0 - fms, vec3f(1e-3)), 1.0));
}
`;

/** Resources and helpers shared by the sky-view LUT, the sky pass and the env-map pass. */
export const SKY_FUNCTIONS_WGSL = /* wgsl */ `
fn multiscatterAt(pos: vec3f, dir: vec3f) -> vec3f {
  let r = length(pos);
  let uv = vec2f(dot(pos / r, dir) * 0.5 + 0.5, clamp((r - R_BOTTOM) / (R_TOP - R_BOTTOM), 0.0, 1.0));
  return textureSampleLevel(multiscatterLUT, linearSampler, uv, 0.0).rgb;
}
fn transmittanceTo(pos: vec3f, dir: vec3f) -> vec3f {
  let r = length(pos);
  return textureSampleLevel(transmittanceLUT, linearSampler, transmittanceUV(r, dot(pos / r, dir)), 0.0).rgb;
}

/** Sky radiance from the sky-view LUT for a world direction. */
fn skyLUT(d: vec3f) -> vec3f {
  let r = R_BOTTOM + frame.atmos.y;
  let sunH = frame.sunDir.xz;
  let dH = d.xz;
  var lightViewCos = 1.0;
  if (dot(sunH, sunH) > 1e-8 && dot(dH, dH) > 1e-8) { lightViewCos = dot(normalize(dH), normalize(sunH)); }
  let vHorizon = sqrt(max(r * r - R_BOTTOM * R_BOTTOM, 0.0));
  let groundCos = -vHorizon / r;
  let uv = skyviewUV(r, d.y, lightViewCos, d.y < groundCos);
  return textureSampleLevel(skyviewLUT, linearSampler, uv, 0.0).rgb;
}

/** Cloud layer: a procedural deck lit by the key light, with silver lining and self shadowing. */
fn cloudLayer(d: vec3f, sky: vec3f, keyL: vec3f, ambient: vec3f) -> vec4f {
  if (d.y <= 0.0 || frame.atmos.z < 0.01) { return vec4f(0.0); }
  let t = 1.0 / (d.y + 0.06);
  let uv = d.xz * t * 0.55 + frame.wind.zw * 1.6;
  let c = cloudCoverage(uv);
  if (c < 0.002) { return vec4f(0.0); }
  let k = frame.keyDir.xyz;
  let towards = cloudCoverage(uv + k.xz * 0.06);
  let lit = clamp(1.0 - towards * 0.85, 0.0, 1.0);
  let cosT = dot(d, k);
  let phase = phaseHG(cosT, 0.6) * 2.5 + 0.35;
  let thick = c * (0.6 + 0.4 * fbm(uv * 2.7, 3));
  var col = ambient * (0.65 + 0.35 * lit) * (1.0 - thick * 0.35) + keyL * lit * phase * 0.12 * (1.0 - thick * 0.5);
  let horizonFade = smoothstep(0.0, 0.16, d.y);
  let alpha = clamp(c * 1.3, 0.0, 1.0) * horizonFade;
  // blend distant clouds into the sky haze
  col = mix(sky, col, smoothstep(0.0, 0.3, d.y) * 0.8 + 0.2);
  return vec4f(col, alpha);
}

fn cloudLayerAt(d: vec3f, sky: vec3f) -> vec4f {
  let r = R_BOTTOM + frame.atmos.y;
  let k = frame.keyDir.xyz;
  var keyL = textureSampleLevel(transmittanceLUT, linearSampler, transmittanceUV(r, max(k.y, 0.0)), 0.0).rgb;
  keyL *= select(frame.sunDir.w, frame.moonDir.w, frame.keyDir.w > 0.5) * smoothstep(-0.05, 0.05, k.y);
  let ambient = skyLUT(normalize(vec3f(0.3, 1.0, 0.2))) * 1.8 + skyLUT(normalize(vec3f(-k.x, 0.2, -k.z))) * 0.6;
  return cloudLayer(d, sky, keyL, ambient);
}
`;

const SKYVIEW_CS = /* wgsl */ `
${FRAME.wgsl}
${MATH_WGSL}
${ATMOSPHERE_WGSL}
@group(0) @binding(0) var outTex: texture_storage_2d<rgba16float, write>;
@group(0) @binding(1) var<uniform> frame: Frame;
@group(0) @binding(2) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(3) var multiscatterLUT: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;

fn multiscatterAt(pos: vec3f, dir: vec3f) -> vec3f {
  let r = length(pos);
  let uv = vec2f(dot(pos / r, dir) * 0.5 + 0.5, clamp((r - R_BOTTOM) / (R_TOP - R_BOTTOM), 0.0, 1.0));
  return textureSampleLevel(multiscatterLUT, linearSampler, uv, 0.0).rgb;
}
fn transmittanceTo(pos: vec3f, dir: vec3f) -> vec3f {
  let r = length(pos);
  return textureSampleLevel(transmittanceLUT, linearSampler, transmittanceUV(r, dot(pos / r, dir)), 0.0).rgb;
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(outTex);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(size);
  let r = R_BOTTOM + frame.atmos.y;
  let vHorizon = sqrt(max(r * r - R_BOTTOM * R_BOTTOM, 0.0));
  let beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  let zha = PI - beta;
  var vza: f32;
  if (uv.y < 0.5) {
    var c = 1.0 - 2.0 * uv.y;
    c = 1.0 - c * c;
    vza = zha * c;
  } else {
    let c = uv.y * 2.0 - 1.0;
    vza = zha + beta * c * c;
  }
  let lvc = -(uv.x * uv.x * 2.0 - 1.0);
  let cz = cos(vza);
  let sz = sin(vza);
  let rd = vec3f(sz * lvc, cz, sz * sqrt(max(1.0 - lvc * lvc, 0.0)));

  let sunY = frame.sunDir.y;
  let sunDir = vec3f(sqrt(max(1.0 - sunY * sunY, 0.0)), sunY, 0.0);
  let moonY = frame.moonDir.y;
  let moonDir = vec3f(-sqrt(max(1.0 - moonY * moonY, 0.0)), moonY, 0.0);
  let sunE = frame.sunDir.w;
  let moonE = frame.moonDir.w * vec3f(0.75, 0.85, 1.0);

  let ro = vec3f(0.0, r, 0.0);
  let tBottom = raySphere(ro, rd, R_BOTTOM);
  let tTop = raySphere(ro, rd, R_TOP);
  let tMax = select(tTop, tBottom, tBottom > 0.0);
  let cosSun = dot(rd, sunDir);
  let cosMoon = dot(rd, moonDir);
  let phRs = phaseRayleigh(cosSun);
  let phMs = phaseMie(cosSun, MIE_G);
  let phRm = phaseRayleigh(cosMoon);
  let phMm = phaseMie(cosMoon, MIE_G);

  let steps = 30;
  var T = vec3f(1.0);
  var L = vec3f(0.0);
  var tPrev = 0.0;
  for (var i = 0; i < steps; i++) {
    let f = (f32(i) + 0.3) / f32(steps);
    let t = tMax * f * f;
    let dt = t - tPrev;
    tPrev = t;
    let p = ro + rd * t;
    let m = sampleMedium(length(p) - R_BOTTOM);
    let ext = max(m.extinction, vec3f(1e-7));
    let sampleT = exp(-ext * dt);
    let sunVis = select(1.0, 0.0, raySphere(p, sunDir, R_BOTTOM) > 0.0);
    let moonVis = select(1.0, 0.0, raySphere(p, moonDir, R_BOTTOM) > 0.0);
    let sunS = (m.rayleigh * phRs + m.mie * phMs) * transmittanceTo(p, sunDir) * sunVis + multiscatterAt(p, sunDir) * m.scattering;
    let moonS = (m.rayleigh * phRm + m.mie * phMm) * transmittanceTo(p, moonDir) * moonVis + multiscatterAt(p, moonDir) * m.scattering;
    let S = sunS * sunE + moonS * moonE;
    L += T * (S - S * sampleT) / ext;
    T *= sampleT;
  }
  if (tBottom > 0.0) {
    let p = ro + rd * tBottom;
    let n = normalize(p);
    let albedo = frame.skyTint.w;
    L += T * albedo / PI * (transmittanceTo(p, sunDir) * max(dot(n, sunDir), 0.0) * sunE + transmittanceTo(p, moonDir) * max(dot(n, moonDir), 0.0) * moonE);
  }
  textureStore(outTex, id.xy, vec4f(L * frame.skyTint.rgb, 1.0));
}
`;

// Environment cube: the sky (without the sun disk, which would cause sparkles) rendered into 6 faces.
const ENV_CS = /* wgsl */ `
${FRAME.wgsl}
${MATH_WGSL}
${ATMOSPHERE_WGSL}
@group(0) @binding(0) var outTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(1) var<uniform> frame: Frame;
@group(0) @binding(2) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(3) var multiscatterLUT: texture_2d<f32>;
@group(0) @binding(4) var skyviewLUT: texture_2d<f32>;
@group(0) @binding(5) var linearSampler: sampler;

fn cloudCoverage(p: vec2f) -> f32 {
  let cover = frame.atmos.z;
  let n = fbm(p, 5) * 0.8 + vnoise(p * 6.3) * 0.2;
  return smoothstep(0.62 - cover * 0.5, 0.92 - cover * 0.42, n);
}
${SKY_FUNCTIONS_WGSL}

fn cubeDir(face: u32, uv: vec2f) -> vec3f {
  let u = uv.x * 2.0 - 1.0;
  let v = uv.y * 2.0 - 1.0;
  switch (face) {
    case 0u: { return normalize(vec3f(1.0, -v, -u)); }
    case 1u: { return normalize(vec3f(-1.0, -v, u)); }
    case 2u: { return normalize(vec3f(u, 1.0, v)); }
    case 3u: { return normalize(vec3f(u, -1.0, -v)); }
    case 4u: { return normalize(vec3f(u, -v, 1.0)); }
    default: { return normalize(vec3f(-u, -v, -1.0)); }
  }
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(outTex);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let d = cubeDir(id.z, (vec2f(id.xy) + 0.5) / vec2f(size));
  var sky = skyLUT(d);
  // below the horizon: a soft ground bounce rather than the planet surface
  if (d.y < 0.0) {
    let ground = skyLUT(normalize(vec3f(d.x, 0.02, d.z)));
    sky = mix(ground, ground * frame.skyTint.w * 1.2, smoothstep(0.0, -0.25, d.y));
  }
  let cl = cloudLayerAt(d, sky);
  sky = mix(sky, cl.rgb, cl.a);
  textureStore(outTex, id.xy, id.z, vec4f(sky, 1.0));
}
`;

// Project the environment onto 9 spherical-harmonic coefficients (irradiance, cosine lobe baked in).
const SH_CS = /* wgsl */ `
@group(0) @binding(0) var envTex: texture_2d_array<f32>;
@group(0) @binding(1) var<storage, read_write> outSH: array<vec4f, 9>;
var<workgroup> partial: array<array<vec3f, 9>, 64>;

fn cubeDir(face: u32, u: f32, v: f32) -> vec3f {
  switch (face) {
    case 0u: { return vec3f(1.0, -v, -u); }
    case 1u: { return vec3f(-1.0, -v, u); }
    case 2u: { return vec3f(u, 1.0, v); }
    case 3u: { return vec3f(u, -1.0, -v); }
    case 4u: { return vec3f(u, -v, 1.0); }
    default: { return vec3f(-u, -v, -1.0); }
  }
}

@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32) {
  let size = textureDimensions(envTex).x;
  let total = size * size * 6u;
  var acc: array<vec3f, 9>;
  for (var k = 0u; k < 9u; k++) { acc[k] = vec3f(0.0); }
  for (var i = li; i < total; i += 64u) {
    let face = i / (size * size);
    let rem = i % (size * size);
    let x = rem % size;
    let y = rem / size;
    let u = (f32(x) + 0.5) / f32(size) * 2.0 - 1.0;
    let v = (f32(y) + 0.5) / f32(size) * 2.0 - 1.0;
    let raw = cubeDir(face, u, v);
    let l2 = dot(raw, raw);
    let n = raw * inverseSqrt(l2);
    let dw = 4.0 / (f32(size * size) * l2 * sqrt(l2));
    let c = textureLoad(envTex, vec2u(x, y), face, 0).rgb * dw;
    acc[0] += c * 0.282095;
    acc[1] += c * 0.488603 * n.y;
    acc[2] += c * 0.488603 * n.z;
    acc[3] += c * 0.488603 * n.x;
    acc[4] += c * 1.092548 * n.x * n.y;
    acc[5] += c * 1.092548 * n.y * n.z;
    acc[6] += c * 0.315392 * (3.0 * n.z * n.z - 1.0);
    acc[7] += c * 1.092548 * n.x * n.z;
    acc[8] += c * 0.546274 * (n.x * n.x - n.y * n.y);
  }
  partial[li] = acc;
  workgroupBarrier();
  if (li == 0u) {
    var sum: array<vec3f, 9>;
    for (var k = 0u; k < 9u; k++) { sum[k] = vec3f(0.0); }
    for (var t = 0u; t < 64u; t++) {
      for (var k = 0u; k < 9u; k++) { sum[k] += partial[t][k]; }
    }
    // cosine-lobe convolution (A_l / PI): 1, 2/3, 1/4
    var band = array<f32, 9>(1.0, 0.6666667, 0.6666667, 0.6666667, 0.25, 0.25, 0.25, 0.25, 0.25);
    for (var k = 0u; k < 9u; k++) { outSH[k] = vec4f(sum[k] * band[k], 0.0); }
  }
}
`;

// GGX prefiltered specular mips from the raw environment cube.
const PREFILTER_CS = /* wgsl */ `
const PI = 3.14159265359;
@group(0) @binding(0) var outTex: texture_storage_2d_array<rgba16float, write>;
@group(0) @binding(1) var envCube: texture_cube<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<uniform> params: vec4f; // roughness, sample count

fn cubeDir(face: u32, uv: vec2f) -> vec3f {
  let u = uv.x * 2.0 - 1.0;
  let v = uv.y * 2.0 - 1.0;
  switch (face) {
    case 0u: { return normalize(vec3f(1.0, -v, -u)); }
    case 1u: { return normalize(vec3f(-1.0, -v, u)); }
    case 2u: { return normalize(vec3f(u, 1.0, v)); }
    case 3u: { return normalize(vec3f(u, -1.0, -v)); }
    case 4u: { return normalize(vec3f(u, -v, 1.0)); }
    default: { return normalize(vec3f(-u, -v, -1.0)); }
  }
}
fn hammersley(i: u32, n: u32) -> vec2f {
  var b = i;
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2f(f32(i) / f32(n), f32(b) * 2.3283064365386963e-10);
}
fn importanceGGX(xi: vec2f, n: vec3f, a: f32) -> vec3f {
  let phi = 2.0 * PI * xi.x;
  let cosT = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
  let sinT = sqrt(1.0 - cosT * cosT);
  let h = vec3f(cos(phi) * sinT, sin(phi) * sinT, cosT);
  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 0.0, 1.0), abs(n.z) < 0.999);
  let tx = normalize(cross(up, n));
  let ty = cross(n, tx);
  return normalize(tx * h.x + ty * h.y + n * h.z);
}

@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(outTex);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let n = cubeDir(id.z, (vec2f(id.xy) + 0.5) / vec2f(size));
  let rough = params.x;
  let a = rough * rough;
  let count = u32(params.y);
  var sum = vec3f(0.0);
  var w = 0.0;
  let srcSize = f32(textureDimensions(envCube).x);
  for (var i = 0u; i < count; i++) {
    let h = importanceGGX(hammersley(i, count), n, a);
    let l = normalize(2.0 * dot(n, h) * h - n);
    let NoL = dot(n, l);
    if (NoL > 0.0) {
      // filtered importance sampling: pick a source mip matching the sample's footprint
      let NoH = max(dot(n, h), 0.0);
      let d = (NoH * a * a - NoH) * NoH + 1.0;
      let D = a * a / (PI * d * d);
      let pdf = D * 0.25;
      let saTexel = 4.0 * PI / (6.0 * srcSize * srcSize);
      let saSample = 1.0 / (f32(count) * pdf + 1e-4);
      let mip = select(0.5 * log2(saSample / saTexel) + 1.0, 0.0, rough == 0.0);
      sum += textureSampleLevel(envCube, linearSampler, l, clamp(mip, 0.0, 5.0)).rgb * NoL;
      w += NoL;
    }
  }
  textureStore(outTex, id.xy, id.z, vec4f(sum / max(w, 1e-4), 1.0));
}
`;

// Split-sum BRDF integration LUT (scale, bias) for image based lighting.
const BRDF_CS = /* wgsl */ `
const PI = 3.14159265359;
@group(0) @binding(0) var outTex: texture_storage_2d<rgba16float, write>;
fn hammersley(i: u32, n: u32) -> vec2f {
  var b = i;
  b = (b << 16u) | (b >> 16u);
  b = ((b & 0x55555555u) << 1u) | ((b & 0xAAAAAAAAu) >> 1u);
  b = ((b & 0x33333333u) << 2u) | ((b & 0xCCCCCCCCu) >> 2u);
  b = ((b & 0x0F0F0F0Fu) << 4u) | ((b & 0xF0F0F0F0u) >> 4u);
  b = ((b & 0x00FF00FFu) << 8u) | ((b & 0xFF00FF00u) >> 8u);
  return vec2f(f32(i) / f32(n), f32(b) * 2.3283064365386963e-10);
}
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let size = textureDimensions(outTex);
  if (id.x >= size.x || id.y >= size.y) { return; }
  let NoV = (f32(id.x) + 0.5) / f32(size.x);
  let rough = (f32(id.y) + 0.5) / f32(size.y);
  let a = rough * rough;
  let v = vec3f(sqrt(1.0 - NoV * NoV), 0.0, NoV);
  var A = 0.0;
  var B = 0.0;
  let count = 256u;
  for (var i = 0u; i < count; i++) {
    let xi = hammersley(i, count);
    let phi = 2.0 * PI * xi.x;
    let cosT = sqrt((1.0 - xi.y) / (1.0 + (a * a - 1.0) * xi.y));
    let sinT = sqrt(1.0 - cosT * cosT);
    let h = vec3f(cos(phi) * sinT, sin(phi) * sinT, cosT);
    let l = normalize(2.0 * dot(v, h) * h - v);
    let NoL = max(l.z, 0.0);
    let NoH = max(h.z, 0.0);
    let VoH = max(dot(v, h), 0.0);
    if (NoL > 0.0) {
      let k = a * 0.5;
      let gv = NoV / (NoV * (1.0 - k) + k);
      let gl = NoL / (NoL * (1.0 - k) + k);
      let G = gv * gl;
      let Gvis = G * VoH / (NoH * NoV + 1e-5);
      let Fc = pow(1.0 - VoH, 5.0);
      A += (1.0 - Fc) * Gvis;
      B += Fc * Gvis;
    }
  }
  textureStore(outTex, id.xy, vec4f(A / f32(count), B / f32(count), 0.0, 1.0));
}
`;

// ---------------------------------------------------------------- class

export class Atmosphere {
  constructor(device, frameBuffer, tier) {
    this.device = device;
    this.frameBuffer = frameBuffer;
    this.envSize = tier.envSize;
    this.envMips = Math.max(1, Math.log2(this.envSize) - 1);
    const S = U.STO | U.TEX;
    this.transmittance = texture2D(device, { width: TRANSMITTANCE_SIZE[0], height: TRANSMITTANCE_SIZE[1], format: 'rgba16float', usage: S, label: 'transmittance' });
    this.multiscatter = texture2D(device, { width: MULTISCATTER_SIZE[0], height: MULTISCATTER_SIZE[1], format: 'rgba16float', usage: S, label: 'multiscatter' });
    this.skyview = texture2D(device, { width: SKYVIEW_SIZE[0], height: SKYVIEW_SIZE[1], format: 'rgba16float', usage: S, label: 'skyview' });
    this.brdf = texture2D(device, { width: 64, height: 64, format: 'rgba16float', usage: S, label: 'brdf-lut' });
    this.envRaw = texture2D(device, { width: this.envSize, height: this.envSize, layers: 6, format: 'rgba16float', usage: S, label: 'env-raw' });
    this.env = texture2D(device, { width: this.envSize, height: this.envSize, layers: 6, mips: this.envMips, format: 'rgba16float', usage: S, label: 'env-prefiltered' });
    this.envView = this.env.createView({ dimension: 'cube' });
    this.shBuffer = createBuffer(device, 9 * 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'sh');
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    this.paramsBuffer = createBuffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'atmos-params');
    this.prefilterParams = [];
    for (let m = 0; m < this.envMips; m++) {
      const b = createBuffer(device, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, `prefilter-${m}`);
      device.queue.writeBuffer(b, 0, new Float32Array([m / Math.max(1, this.envMips - 1), m === 0 ? 1 : 48, 0, 0]));
      this.prefilterParams.push(b);
    }
    this.#build();
    this.lutsDirty = true;
    this.envDirty = true;
    this.envTimer = 0;
  }

  #pipeline(code, label, layout) {
    return this.device.createComputePipeline({
      label,
      layout: this.device.createPipelineLayout({ bindGroupLayouts: [layout] }),
      compute: { module: createShader(this.device, code, label), entryPoint: 'main' },
    });
  }

  #build() {
    const d = this.device;
    const st = (fmt, dim = '2d') => `storage-texture:${fmt}:${dim}`;
    const L = {
      trans: bindLayout(d, 'trans', [['C', st('rgba16float')]]),
      ms: bindLayout(d, 'ms', [['C', st('rgba16float')], ['C', 'texture'], ['C', 'sampler'], ['C', 'uniform']]),
      sv: bindLayout(d, 'sv', [['C', st('rgba16float')], ['C', 'uniform'], ['C', 'texture'], ['C', 'texture'], ['C', 'sampler']]),
      env: bindLayout(d, 'env', [['C', st('rgba16float', '2d-array')], ['C', 'uniform'], ['C', 'texture'], ['C', 'texture'], ['C', 'texture'], ['C', 'sampler']]),
      sh: bindLayout(d, 'sh', [['C', 'texture-array'], ['C', 'storage']]),
      pre: bindLayout(d, 'pre', [['C', st('rgba16float', '2d-array')], ['C', 'cube'], ['C', 'sampler'], ['C', 'uniform']]),
      brdf: bindLayout(d, 'brdf', [['C', st('rgba16float')]]),
    };
    this.pipes = {
      trans: this.#pipeline(TRANSMITTANCE_CS, 'transmittance', L.trans),
      ms: this.#pipeline(MULTISCATTER_CS, 'multiscatter', L.ms),
      sv: this.#pipeline(SKYVIEW_CS, 'skyview', L.sv),
      env: this.#pipeline(ENV_CS, 'env', L.env),
      sh: this.#pipeline(SH_CS, 'sh', L.sh),
      pre: this.#pipeline(PREFILTER_CS, 'prefilter', L.pre),
      brdf: this.#pipeline(BRDF_CS, 'brdf', L.brdf),
    };
    const v = (t) => t.createView();
    this.groups = {
      trans: bindGroup(d, L.trans, [v(this.transmittance)]),
      ms: bindGroup(d, L.ms, [v(this.multiscatter), v(this.transmittance), this.sampler, this.paramsBuffer]),
      sv: bindGroup(d, L.sv, [v(this.skyview), this.frameBuffer, v(this.transmittance), v(this.multiscatter), this.sampler]),
      env: bindGroup(d, L.env, [this.envRaw.createView({ dimension: '2d-array' }), this.frameBuffer, v(this.transmittance), v(this.multiscatter), v(this.skyview), this.sampler]),
      sh: bindGroup(d, L.sh, [this.envRaw.createView({ dimension: '2d-array' }), this.shBuffer]),
      pre: this.prefilterParams.map((p, m) => bindGroup(d, L.pre, [
        this.env.createView({ dimension: '2d-array', baseMipLevel: m, mipLevelCount: 1 }),
        this.envRaw.createView({ dimension: 'cube' }), this.sampler, p,
      ])),
      brdf: bindGroup(d, L.brdf, [v(this.brdf)]),
    };
  }

  setGroundAlbedo(albedo) {
    this.device.queue.writeBuffer(this.paramsBuffer, 0, new Float32Array([albedo, 0, 0, 0]));
    this.lutsDirty = true;
  }

  /** Mark the environment lighting for refresh (sun moved, clouds changed...). */
  invalidate() { this.envDirty = true; }

  #dispatch(pass, pipe, group, w, h, layers = 1) {
    pass.setPipeline(pipe);
    pass.setBindGroup(0, group);
    pass.dispatchWorkgroups(Math.ceil(w / 8), Math.ceil(h / 8), layers);
  }

  update(encoder, dt) {
    const pass = encoder.beginComputePass({ label: 'atmosphere' });
    if (this.lutsDirty) {
      this.#dispatch(pass, this.pipes.trans, this.groups.trans, ...TRANSMITTANCE_SIZE);
      this.#dispatch(pass, this.pipes.ms, this.groups.ms, ...MULTISCATTER_SIZE);
      this.#dispatch(pass, this.pipes.brdf, this.groups.brdf, 64, 64);
    }
    this.#dispatch(pass, this.pipes.sv, this.groups.sv, ...SKYVIEW_SIZE);
    this.envTimer -= dt;
    const refreshEnv = this.envDirty || this.lutsDirty || this.envTimer <= 0;
    if (refreshEnv) {
      this.envTimer = 0.5; // clouds drift slowly; refresh reflections twice a second
      this.#dispatch(pass, this.pipes.env, this.groups.env, this.envSize, this.envSize, 6);
      pass.setPipeline(this.pipes.sh);
      pass.setBindGroup(0, this.groups.sh);
      pass.dispatchWorkgroups(1);
      for (let m = 0; m < this.envMips; m++) {
        const s = Math.max(1, this.envSize >> m);
        this.#dispatch(pass, this.pipes.pre, this.groups.pre[m], s, s, 6);
      }
    }
    pass.end();
    this.lutsDirty = false;
    this.envDirty = false;
  }
}

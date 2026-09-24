// Shared WGSL: the per-frame uniform block, the global bind group used by
// every shading pipeline, and the math/lighting library.
import { defineStruct } from '../../gpu/gpu.js';

export const FRAME = defineStruct('Frame', [
  ['viewProj', 'mat4'],       // jittered, reversed-Z
  ['viewProjNJ', 'mat4'],     // unjittered
  ['prevViewProj', 'mat4'],   // previous frame, unjittered
  ['invViewProj', 'mat4'],    // inverse of the jittered viewProj
  ['view', 'mat4'],
  ['proj', 'mat4'],           // jittered
  ['invProj', 'mat4'],
  ['camPos', 'vec4'],         // xyz, near plane
  ['camFwd', 'vec4'],         // forward xyz, tan(fovY / 2)
  ['time', 'vec4'],           // seconds, dt, frame index, wind strength
  ['resolution', 'vec4'],     // internal w, h, 1/w, 1/h
  ['jitter', 'vec4'],         // ndc jitter xy, previous jitter xy
  ['sunDir', 'vec4'],         // towards the sun, w = illuminance
  ['moonDir', 'vec4'],        // towards the moon, w = illuminance
  ['keyDir', 'vec4'],         // key light (sun or moon), w = 1 when moon
  ['atmos', 'vec4'],          // aerial scale, camera altitude km, cloud cover, star intensity
  ['skyTint', 'vec4'],        // rgb tint, ground albedo
  ['fog', 'vec4'],            // density /m, height falloff, base height, anisotropy
  ['fogAlbedo', 'vec4'],      // rgb, noise amount
  ['wind', 'vec4'],           // direction x, z, cloud offset x, y
  ['terrain', 'vec4'],        // min h, max h, water level, has water
  ['terrainGrid', 'vec4'],    // origin x, origin z, spacing, vertices per side
  ['palLow', 'vec4'],
  ['palMid', 'vec4'],
  ['palHigh', 'vec4'],
  ['palCliff', 'vec4'],
  ['water', 'vec4'],          // rgb, lava flag
  ['grass', 'vec4'],          // rgb, density
  ['player', 'vec4'],         // xyz, push radius
  ['shadowMats', 'mat4', 4],
  ['cascadeSplits', 'vec4'],  // view distance where each cascade ends
  ['cascadeTexel', 'vec4'],   // world size of one shadow texel per cascade
  ['shadowInfo', 'vec4'],     // cascade count, map size, enabled, softness
  ['lightInfo', 'vec4'],      // light count, ao enabled, volumetrics enabled, volume max distance
  ['volInfo', 'vec4'],        // froxel dims xyz, depth exponent
  ['clouds', 'vec4'],         // cloud layer bottom m, top m, extinction /m, volumetric clouds enabled
  ['cloudPano', 'vec4'],      // cloud panorama width, height, -, -
  ['weatherFx', 'vec4'],      // surface wetness, rain intensity, lightning flash, aurora strength
  ['flashPos', 'vec4'],       // lightning bolt position xz (camera relative), strike brightness, -
  ['gi', 'vec4'],             // irradiance field origin x, z, extent m, enabled
]);

/** Group 0 for every shading pipeline (mesh, grass, sky, water, particles). */
export const GLOBAL_LAYOUT = [
  ['VFC', 'uniform'],        // 0 frame
  ['VFC', 'sampler'],        // 1 linear clamp
  ['VFC', 'sampler'],        // 2 linear repeat
  ['F', 'csampler'],         // 3 shadow compare
  ['VFC', 'texture'],        // 4 transmittance LUT
  ['FC', 'texture'],         // 5 multi-scattering LUT
  ['F', 'texture'],          // 6 sky-view LUT
  ['F', 'texture3d'],        // 7 volumetric fog / aerial perspective
  ['F', 'cube'],             // 8 prefiltered environment
  ['VF', 'read'],            // 9 SH irradiance
  ['F', 'texture'],          // 10 BRDF LUT
  ['F', 'depth-array'],      // 11 shadow cascades
  ['F', 'read'],             // 12 point lights
  ['VF', 'utexture'],        // 13 terrain heightmap (r32float)
  ['F', 'texture'],          // 14 ambient occlusion
  ['F', 'texture'],          // 15 foliage atlas
  ['VFC', 'texture'],        // 16 weather map (cloud coverage, type, detail)
  ['F', 'read'],             // 17 volumetric cloud panorama
  ['VFC', 'texture-array'],  // 18 heightfield irradiance field (GI)
];

export const GLOBALS_WGSL = /* wgsl */ `
${FRAME.wgsl}
struct Light { posRadius: vec4f, color: vec4f };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var repeatSampler: sampler;
@group(0) @binding(3) var shadowSampler: sampler_comparison;
@group(0) @binding(4) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(5) var multiscatterLUT: texture_2d<f32>;
@group(0) @binding(6) var skyviewLUT: texture_2d<f32>;
@group(0) @binding(7) var volumeTex: texture_3d<f32>;
@group(0) @binding(8) var envCube: texture_cube<f32>;
@group(0) @binding(9) var<storage, read> shCoeffs: array<vec4f, 9>;
@group(0) @binding(10) var brdfLUT: texture_2d<f32>;
@group(0) @binding(11) var shadowMap: texture_depth_2d_array;
@group(0) @binding(12) var<storage, read> lights: array<Light>;
@group(0) @binding(13) var heightmap: texture_2d<f32>;
@group(0) @binding(14) var aoTex: texture_2d<f32>;
@group(0) @binding(15) var foliageAtlas: texture_2d<f32>;
@group(0) @binding(16) var weatherTex: texture_2d<f32>;
@group(0) @binding(17) var<storage, read> cloudPano: array<vec2u>;
@group(0) @binding(18) var giTex: texture_2d_array<f32>;
`;

// ---------------------------------------------------------------- pure functions

export const MATH_WGSL = /* wgsl */ `
const PI = 3.14159265359;
const TAU = 6.28318530718;

fn hash12(p: vec2f) -> f32 {
  var p3 = fract(vec3f(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash13(q: vec3f) -> f32 {
  var p3 = fract(q * 0.1031);
  p3 += dot(p3, p3.zyx + 31.32);
  return fract((p3.x + p3.y) * p3.z);
}
fn hash22(p: vec2f) -> vec2f {
  var p3 = fract(vec3f(p.xyx) * vec3f(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
fn vnoise(p: vec2f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash12(i), hash12(i + vec2f(1.0, 0.0)), u.x),
             mix(hash12(i + vec2f(0.0, 1.0)), hash12(i + vec2f(1.0, 1.0)), u.x), u.y);
}
fn vnoise3(p: vec3f) -> f32 {
  let i = floor(p);
  let f = fract(p);
  let u = f * f * (3.0 - 2.0 * f);
  let a = mix(mix(hash13(i), hash13(i + vec3f(1.0, 0.0, 0.0)), u.x), mix(hash13(i + vec3f(0.0, 1.0, 0.0)), hash13(i + vec3f(1.0, 1.0, 0.0)), u.x), u.y);
  let b = mix(mix(hash13(i + vec3f(0.0, 0.0, 1.0)), hash13(i + vec3f(1.0, 0.0, 1.0)), u.x), mix(hash13(i + vec3f(0.0, 1.0, 1.0)), hash13(i + vec3f(1.0, 1.0, 1.0)), u.x), u.y);
  return mix(a, b, u.z);
}
fn fbm(p0: vec2f, octaves: i32) -> f32 {
  var p = p0;
  var s = 0.0;
  var a = 0.5;
  var n = 0.0;
  for (var i = 0; i < octaves; i++) {
    s += a * vnoise(p);
    n += a;
    p = p * 2.03 + vec2f(1.7, 9.2);
    a *= 0.5;
  }
  return s / n;
}
// Interleaved gradient noise: per-pixel rotation that TAA resolves into smooth results.
fn ign(p: vec2f) -> f32 { return fract(52.9829189 * fract(dot(p, vec2f(0.06711056, 0.00583715)))); }
fn luminance(c: vec3f) -> f32 { return dot(c, vec3f(0.2126, 0.7152, 0.0722)); }
`;

// ---------------------------------------------------------------- atmosphere (units: km)

export const ATMOSPHERE_WGSL = /* wgsl */ `
const R_BOTTOM = 6360.0;
const R_TOP = 6460.0;
const RAYLEIGH_SCATTER = vec3f(5.802, 13.558, 33.1) * 1e-3;
const MIE_SCATTER = vec3f(3.996e-3);
const MIE_EXTINCT = vec3f(4.40e-3);
const OZONE_ABSORB = vec3f(0.650, 1.881, 0.085) * 1e-3;
const MIE_G = 0.8;
const SUN_ANGULAR_RADIUS = 0.0085;

struct Medium { scattering: vec3f, extinction: vec3f, rayleigh: vec3f, mie: vec3f };

fn sampleMedium(altitude: f32) -> Medium {
  let h = max(altitude, 0.0);
  let rd = exp(-h / 8.0);
  let md = exp(-h / 1.2);
  let od = max(0.0, 1.0 - abs(h - 25.0) / 15.0);
  var m: Medium;
  m.rayleigh = RAYLEIGH_SCATTER * rd;
  m.mie = MIE_SCATTER * md;
  m.scattering = m.rayleigh + m.mie;
  m.extinction = m.rayleigh + MIE_EXTINCT * md + OZONE_ABSORB * od;
  return m;
}

/** Distance to the nearest positive intersection with a sphere at the origin, or -1. */
fn raySphere(ro: vec3f, rd: vec3f, radius: f32) -> f32 {
  let b = dot(ro, rd);
  let c = dot(ro, ro) - radius * radius;
  if (c > 0.0 && b > 0.0) { return -1.0; }
  let disc = b * b - c;
  if (disc < 0.0) { return -1.0; }
  let s = sqrt(disc);
  if (-b - s > 0.0) { return -b - s; }
  return -b + s;
}

fn phaseRayleigh(c: f32) -> f32 { return 3.0 / (16.0 * PI) * (1.0 + c * c); }
fn phaseMie(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return 3.0 / (8.0 * PI) * ((1.0 - g2) * (1.0 + c * c)) / ((2.0 + g2) * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}
fn phaseHG(c: f32, g: f32) -> f32 {
  let g2 = g * g;
  return (1.0 - g2) / (4.0 * PI * pow(max(1.0 + g2 - 2.0 * g * c, 1e-4), 1.5));
}

// Bruneton parameterisation of the transmittance LUT.
fn transmittanceUV(r: f32, mu: f32) -> vec2f {
  let H = sqrt(R_TOP * R_TOP - R_BOTTOM * R_BOTTOM);
  let rho = sqrt(max(0.0, r * r - R_BOTTOM * R_BOTTOM));
  let disc = r * r * (mu * mu - 1.0) + R_TOP * R_TOP;
  let d = max(0.0, -r * mu + sqrt(max(disc, 0.0)));
  let dMin = R_TOP - r;
  let dMax = rho + H;
  return vec2f((d - dMin) / (dMax - dMin), rho / H);
}
fn transmittanceParams(uv: vec2f) -> vec2f {
  let H = sqrt(R_TOP * R_TOP - R_BOTTOM * R_BOTTOM);
  let rho = H * uv.y;
  let r = sqrt(rho * rho + R_BOTTOM * R_BOTTOM);
  let dMin = R_TOP - r;
  let dMax = rho + H;
  let d = dMin + uv.x * (dMax - dMin);
  var mu = 1.0;
  if (d > 0.0) { mu = clamp((H * H - rho * rho - d * d) / (2.0 * r * d), -1.0, 1.0); }
  return vec2f(r, mu);
}

// Sky-view LUT mapping (non-linear latitude to keep the horizon crisp).
fn skyviewUV(r: f32, viewZenithCos: f32, lightViewCos: f32, intersectsGround: bool) -> vec2f {
  let vHorizon = sqrt(max(r * r - R_BOTTOM * R_BOTTOM, 0.0));
  let beta = acos(clamp(vHorizon / r, -1.0, 1.0));
  let zenithHorizonAngle = PI - beta;
  var v: f32;
  if (!intersectsGround) {
    var c = acos(clamp(viewZenithCos, -1.0, 1.0)) / zenithHorizonAngle;
    c = 1.0 - sqrt(max(1.0 - c, 0.0));
    v = c * 0.5;
  } else {
    let c = (acos(clamp(viewZenithCos, -1.0, 1.0)) - zenithHorizonAngle) / beta;
    v = sqrt(max(c, 0.0)) * 0.5 + 0.5;
  }
  let u = sqrt(clamp(-lightViewCos * 0.5 + 0.5, 0.0, 1.0));
  return vec2f(u, v);
}
`;

/** Needs shCoeffs. */
export const SH_WGSL = /* wgsl */ `
/** Diffuse irradiance / PI from the sky's spherical harmonics. */
fn skyIrradiance(n: vec3f) -> vec3f {
  var r = shCoeffs[0].rgb * 0.282095;
  r += shCoeffs[1].rgb * 0.488603 * n.y;
  r += shCoeffs[2].rgb * 0.488603 * n.z;
  r += shCoeffs[3].rgb * 0.488603 * n.x;
  r += shCoeffs[4].rgb * 1.092548 * n.x * n.y;
  r += shCoeffs[5].rgb * 1.092548 * n.y * n.z;
  r += shCoeffs[6].rgb * 0.315392 * (3.0 * n.z * n.z - 1.0);
  r += shCoeffs[7].rgb * 1.092548 * n.x * n.z;
  r += shCoeffs[8].rgb * 0.546274 * (n.x * n.x - n.y * n.y);
  return max(r, vec3f(0.0));
}
`;

/**
 * The weather map drives every cloud effect: the volumetric clouds, the 2D
 * fallback layer, the cloud shadows on the ground and the god rays through
 * the fog. It tiles every CLOUD_TILE meters and drifts with the wind
 * (frame.wind.zw, in meters). Needs frame, weatherTex and repeatSampler.
 */
export const CLOUD_WGSL = /* wgsl */ `
const CLOUD_TILE = 32000.0;

fn weatherAt(xz: vec2f) -> vec4f {
  return textureSampleLevel(weatherTex, repeatSampler, (xz + frame.wind.zw) / CLOUD_TILE, 0.0);
}
/** Cloud coverage 0..1 from the weather map's coverage channel and the spec's cloud cover. */
fn coverageFrom(w: f32) -> f32 {
  let cover = frame.atmos.z;
  if (cover < 0.01) { return 0.0; }
  let threshold = mix(0.74, 0.12, cover);
  return clamp((w - threshold) / 0.2, 0.0, 1.0);
}
fn cloudCoverage(xz: vec2f) -> f32 { return coverageFrom(weatherAt(xz).r); }

/** Soft moving shadows cast by the clouds onto the world (sampled where the key light crosses the cloud layer). */
fn cloudShadow(worldPos: vec3f) -> f32 {
  if (frame.atmos.z < 0.02) { return 1.0; }
  let d = frame.keyDir.xyz;
  let alt = mix(frame.clouds.x, frame.clouds.y, 0.3);
  let t = (alt - worldPos.y) / max(d.y, 0.08);
  let c = cloudCoverage(worldPos.xz + d.xz * t);
  return 1.0 - 0.82 * smoothstep(0.0, 0.75, c);
}
`;

/**
 * Lookups into the volumetric cloud panorama: a sky-dome cache of the
 * raymarched clouds (rgb in-scattered light, a transmittance), refreshed a few
 * texels at a time. Rows are spaced by sqrt(elevation) so the horizon, where
 * clouds are thin slivers, gets the most resolution. Needs frame and cloudPano.
 */
export const PANO_WGSL = /* wgsl */ `
fn panoUV(d: vec3f) -> vec2f {
  let az = atan2(d.x, d.z) / TAU + 0.5;
  let el = asin(clamp(d.y, 0.0, 1.0));
  return vec2f(az, sqrt(el / (PI * 0.5)));
}
fn panoDir(uv: vec2f) -> vec3f {
  let az = (uv.x - 0.5) * TAU;
  let el = uv.y * uv.y * PI * 0.5;
  return vec3f(sin(az) * cos(el), sin(el), cos(az) * cos(el));
}
fn panoLoad(x: i32, y: i32) -> vec4f {
  let w = i32(frame.cloudPano.x);
  let h = i32(frame.cloudPano.y);
  let p = cloudPano[clamp(y, 0, h - 1) * w + ((x % w) + w) % w];
  return vec4f(unpack2x16float(p.x), unpack2x16float(p.y));
}
/** Volumetric clouds seen in direction d: rgb light added, a = sky transmittance. */
fn cloudsAt(d: vec3f) -> vec4f {
  if (frame.clouds.w < 0.5 || d.y < 0.0) { return vec4f(0.0, 0.0, 0.0, 1.0); }
  let uv = panoUV(d) * frame.cloudPano.xy - 0.5;
  let i = vec2i(floor(uv));
  let f = uv - floor(uv);
  let a = mix(panoLoad(i.x, i.y), panoLoad(i.x + 1, i.y), f.x);
  let b = mix(panoLoad(i.x, i.y + 1), panoLoad(i.x + 1, i.y + 1), f.x);
  return mix(a, b, f.y);
}
`;

/** Key light (sun or moon) after the atmosphere. Needs frame, transmittanceLUT, linearSampler. */
export const KEY_WGSL = /* wgsl */ `
fn sampleTransmittance(r: f32, mu: f32) -> vec3f {
  return textureSampleLevel(transmittanceLUT, linearSampler, transmittanceUV(r, mu), 0.0).rgb;
}

/** Radiance of the key light (sun or moon) arriving at the scene, after the atmosphere. */
fn keyRadiance() -> vec3f {
  let r = R_BOTTOM + frame.atmos.y;
  let d = frame.keyDir.xyz;
  let horizon = smoothstep(-0.03, 0.02, d.y);
  let t = sampleTransmittance(r, d.y);
  if (frame.keyDir.w > 0.5) { return t * frame.moonDir.w * vec3f(0.75, 0.85, 1.0) * horizon; }
  return t * frame.sunDir.w * horizon;
}
`;

/**
 * Heightfield irradiance field: a 2.5D grid of SH probes floating over the
 * terrain (see render/gi.js). Surfaces near the ground read bounce light and
 * sky occlusion from it; things high above the terrain fade back to the open
 * sky. Needs frame, giTex, linearSampler and SH_WGSL.
 */
export const GI_WGSL = /* wgsl */ `
struct GiProbe { r: vec4f, g: vec4f, b: vec4f, info: vec4f, weight: f32 };

fn giFetch(p: vec3f) -> GiProbe {
  var g: GiProbe;
  g.weight = 0.0;
  if (frame.gi.w < 0.5) { return g; }
  let uv = (p.xz - frame.gi.xy) / frame.gi.z;
  if (any(uv <= vec2f(0.0)) || any(uv >= vec2f(1.0))) { return g; }
  g.r = textureSampleLevel(giTex, linearSampler, uv, 0, 0.0);
  g.g = textureSampleLevel(giTex, linearSampler, uv, 1, 0.0);
  g.b = textureSampleLevel(giTex, linearSampler, uv, 2, 0.0);
  g.info = textureSampleLevel(giTex, linearSampler, uv, 3, 0.0);
  let edge = smoothstep(0.0, 0.04, min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y)));
  g.weight = edge * (1.0 - smoothstep(4.0, 45.0, p.y - g.info.x));
  return g;
}
/** Irradiance / PI from an L1 SH probe (cosine lobe applied). */
fn giEval(g: GiProbe, n: vec3f) -> vec3f {
  let k = 0.488603 * 0.6666667;
  let sh = vec4f(0.282095, k * n.y, k * n.z, k * n.x);
  return max(vec3f(dot(g.r, sh), dot(g.g, sh), dot(g.b, sh)), vec3f(0.0));
}
/** Diffuse irradiance / PI at p: bounce light and terrain occlusion near the ground, open sky above. */
fn ambientIrradiance(p: vec3f, n: vec3f) -> vec3f {
  let sky = skyIrradiance(n);
  let g = giFetch(p);
  if (g.weight <= 0.0) { return sky + weatherLight(n); }
  return mix(sky, max(giEval(g, n), sky * 0.1), g.weight) + weatherLight(n);
}
`;

/**
 * Living weather on surfaces: rain ripples, puddles, soaked materials and the
 * light of lightning flashes and auroras. Needs frame and MATH_WGSL.
 */
export const WEATHER_WGSL = /* wgsl */ `
/** One layer of rain drops: expanding rings inside a grid of cells. Returns a normal offset (xz). */
fn rippleLayer(p: vec2f, t: f32, seed: f32, rate: f32) -> vec2f {
  let cell = floor(p);
  let h = hash22(cell + seed);
  let cycle = t * (0.9 + h.y * 0.5) + h.x;
  // only some cells get a drop this cycle: fewer drops in a drizzle
  if (hash12(cell + floor(cycle) * 17.31 + seed) > rate) { return vec2f(0.0); }
  let phase = fract(cycle);
  let d = p - cell - (0.25 + 0.5 * hash22(cell + floor(cycle) + seed * 3.1));
  let r = length(d);
  let x = (r - phase * 0.5) * 22.0;
  let wave = cos(x * 2.4) * exp(-x * x * 0.35) * (1.0 - phase) * (1.0 - phase);
  return d / max(r, 1e-3) * wave;
}
fn rainRipples(xz: vec2f, intensity: f32) -> vec2f {
  if (intensity <= 0.01) { return vec2f(0.0); }
  let t = frame.time.x;
  let rate = 0.25 + 0.75 * intensity;
  return (rippleLayer(xz * 2.6, t * 1.2, 0.0, rate) + rippleLayer(xz * 2.6 + 0.5, t * 1.35, 7.3, rate)) * 0.4 * intensity;
}
/** Where water pools on flat, low-lying ground as it gets wetter. */
fn puddleMask(xz: vec2f, n: vec3f) -> f32 {
  let wet = frame.weatherFx.x;
  if (wet <= 0.02) { return 0.0; }
  let flatness = smoothstep(0.94, 0.99, n.y);
  let noise = fbm(xz * 0.11 + 3.7, 3) * 0.8 + vnoise(xz * 0.9) * 0.2;
  let threshold = mix(0.86, 0.56, wet);
  return smoothstep(threshold, threshold + 0.035, noise) * flatness;
}

struct WetSurface { albedo: vec3f, rough: f32, n: vec3f };
/**
 * Soak a dielectric material: darker (water fills the pores), glossier with a
 * water film that smooths out fine bumps, and puddles with ripples on flat
 * ground. n is the detailed normal, geo the smooth geometric one.
 */
fn wetSurface(albedo: vec3f, rough: f32, n: vec3f, geo: vec3f, world: vec3f, metallic: f32, puddles: bool) -> WetSurface {
  var w: WetSurface;
  w.albedo = albedo;
  w.rough = rough;
  w.n = n;
  let wet = frame.weatherFx.x;
  if (wet <= 0.01) { return w; }
  let level = wet * (0.55 + 0.45 * clamp(geo.y, 0.0, 1.0));
  w.albedo = albedo * mix(1.0, mix(0.5, 1.0, metallic), level);
  w.rough = mix(rough, min(rough, 0.24), level);
  w.n = normalize(mix(n, geo, level * 0.6));
  if (puddles) {
    let pud = puddleMask(world.xz, geo);
    if (pud > 0.0) {
      let fade = 1.0 - smoothstep(15.0, 30.0, length(world - frame.camPos.xyz));
      let rip = rainRipples(world.xz, frame.weatherFx.y) * fade * 0.6;
      w.n = normalize(mix(w.n, normalize(vec3f(rip.x, 1.0, rip.y)), pud));
      w.albedo = w.albedo * mix(1.0, 0.4, pud);
      w.rough = mix(w.rough, 0.07, pud);
    }
  }
  return w;
}

/** Extra ambient light (irradiance / PI) from the weather: lightning flashes and the aurora's glow. */
fn weatherLight(n: vec3f) -> vec3f {
  let flash = frame.weatherFx.z * vec3f(0.62, 0.68, 0.9) * (0.55 + 0.45 * n.y) * 0.05;
  let aurora = frame.weatherFx.w * frame.atmos.w * vec3f(0.006, 0.03, 0.018) * (0.5 + 0.5 * n.y);
  return flash + aurora;
}
`;

// ---------------------------------------------------------------- shading library (needs globals)

export const LIGHTING_WGSL = /* wgsl */ `
${KEY_WGSL}
${SH_WGSL}
${WEATHER_WGSL}
${GI_WGSL}
${CLOUD_WGSL}
var<private> POISSON: array<vec2f, 12> = array<vec2f, 12>(
  vec2f(-0.326, -0.406), vec2f(-0.840, -0.074), vec2f(-0.696, 0.457), vec2f(-0.203, 0.621),
  vec2f(0.962, -0.195), vec2f(0.473, -0.480), vec2f(0.519, 0.767), vec2f(0.185, -0.893),
  vec2f(0.507, 0.064), vec2f(0.896, 0.412), vec2f(-0.322, -0.933), vec2f(-0.792, -0.598));

fn cascadeFor(viewDist: f32) -> u32 {
  let count = u32(frame.shadowInfo.x);
  var c = 0u;
  loop {
    if (c >= count) { break; }
    if (viewDist < frame.cascadeSplits[c]) { break; }
    c++;
  }
  return c;
}

fn sampleCascade(c: u32, worldPos: vec3f, n: vec3f, rot: mat2x2f, softness: f32) -> f32 {
  let texel = frame.cascadeTexel[c];
  let p = worldPos + n * texel * 1.8;
  let lp = frame.shadowMats[c] * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0)) || lp.z > 1.0) { return 1.0; }
  let texelUV = 1.0 / frame.shadowInfo.y;
  var sum = 0.0;
  for (var i = 0; i < 12; i++) {
    let o = rot * POISSON[i] * texelUV * softness;
    sum += textureSampleCompareLevel(shadowMap, shadowSampler, uv + o, c, lp.z - 0.0004);
  }
  return sum / 12.0;
}

/** Cascaded, rotated-Poisson soft shadows. TAA turns the per-pixel rotation into smooth penumbrae. */
fn shadowAt(worldPos: vec3f, n: vec3f, fragXY: vec2f) -> f32 {
  if (frame.shadowInfo.z < 0.5) { return 1.0; }
  let viewDist = dot(worldPos - frame.camPos.xyz, frame.camFwd.xyz);
  let c = cascadeFor(viewDist);
  let count = u32(frame.shadowInfo.x);
  if (c >= count) { return 1.0; }
  let a = ign(fragXY + 5.588238 * (frame.time.z % 64.0)) * TAU;
  let rot = mat2x2f(cos(a), sin(a), -sin(a), cos(a));
  var s = sampleCascade(c, worldPos, n, rot, frame.shadowInfo.w);
  // Dithered blend into the next cascade near the split, and fade out at the end.
  let end = frame.cascadeSplits[c];
  let start = select(0.0, frame.cascadeSplits[max(c, 1u) - 1u], c > 0u);
  let blend = smoothstep(0.85, 1.0, (viewDist - start) / max(end - start, 1e-3));
  if (blend > ign(fragXY.yx + frame.time.z)) {
    if (c + 1u < count) { s = sampleCascade(c + 1u, worldPos, n, rot, frame.shadowInfo.w); }
    else { s = mix(s, 1.0, blend); }
  }
  return s;
}

`;

export const SURFACE_WGSL = /* wgsl */ `
// ------------------------------------------------ BRDF
fn D_GGX(NoH: f32, a: f32) -> f32 {
  let a2 = a * a;
  let f = (NoH * a2 - NoH) * NoH + 1.0;
  return a2 / (PI * f * f + 1e-7);
}
fn V_SmithGGX(NoV: f32, NoL: f32, a: f32) -> f32 {
  let a2 = a * a;
  let gv = NoL * sqrt(NoV * NoV * (1.0 - a2) + a2);
  let gl = NoV * sqrt(NoL * NoL * (1.0 - a2) + a2);
  return 0.5 / (gv + gl + 1e-5);
}
fn F_Schlick(VoH: f32, f0: vec3f) -> vec3f { return f0 + (1.0 - f0) * pow(1.0 - VoH, 5.0); }

struct Surface {
  albedo: vec3f,
  metallic: f32,
  roughness: f32,
  n: vec3f,
  v: vec3f,
  f0: vec3f,
  energyComp: vec3f,
};

fn makeSurface(albedo: vec3f, metallic: f32, roughness: f32, n: vec3f, v: vec3f) -> Surface {
  var s: Surface;
  s.albedo = albedo;
  s.metallic = metallic;
  s.roughness = clamp(roughness, 0.045, 1.0);
  s.n = n;
  s.v = v;
  s.f0 = mix(vec3f(0.04), albedo, metallic);
  let NoV = max(dot(n, v), 1e-4);
  let ab = textureSampleLevel(brdfLUT, linearSampler, vec2f(NoV, s.roughness), 0.0).rg;
  // Multiple-scattering energy compensation (Fdez-Aguera 2019)
  s.energyComp = 1.0 + s.f0 * (1.0 / max(ab.x + ab.y, 1e-3) - 1.0);
  return s;
}

fn directLight(s: Surface, l: vec3f, radiance: vec3f) -> vec3f {
  let NoL = dot(s.n, l);
  if (NoL <= 0.0) { return vec3f(0.0); }
  let h = normalize(s.v + l);
  let NoV = max(dot(s.n, s.v), 1e-4);
  let NoH = max(dot(s.n, h), 0.0);
  let VoH = max(dot(s.v, h), 0.0);
  let a = s.roughness * s.roughness;
  let F = F_Schlick(VoH, s.f0);
  let spec = D_GGX(NoH, a) * V_SmithGGX(NoV, NoL, a) * F * s.energyComp;
  let diff = (1.0 - F) * (1.0 - s.metallic) * s.albedo / PI;
  return (diff + spec) * radiance * NoL;
}

fn pointLights(s: Surface, worldPos: vec3f) -> vec3f {
  var c = vec3f(0.0);
  let count = u32(frame.lightInfo.x);
  for (var i = 0u; i < count; i++) {
    let L = lights[i];
    let lv = L.posRadius.xyz - worldPos;
    let d2 = dot(lv, lv);
    let r = L.posRadius.w;
    if (d2 > r * r) { continue; }
    let x = d2 / (r * r);
    let win = clamp(1.0 - x * x, 0.0, 1.0);
    let atten = win * win / (d2 + 1.0);
    c += directLight(s, lv * inverseSqrt(d2), L.color.rgb * atten);
  }
  return c;
}

/**
 * Image based lighting: diffuse from the heightfield irradiance field (or the
 * sky's SH far from the ground) + prefiltered GGX specular (split sum).
 */
fn ambientLight(s: Surface, p: vec3f, ao: f32, specOcclusion: f32) -> vec3f {
  let NoV = max(dot(s.n, s.v), 1e-4);
  let ab = textureSampleLevel(brdfLUT, linearSampler, vec2f(NoV, s.roughness), 0.0).rg;
  let specColor = (s.f0 * ab.x + ab.y) * s.energyComp;
  let r = reflect(-s.v, s.n);
  let maxMip = f32(textureNumLevels(envCube) - 1u);
  let env = textureSampleLevel(envCube, linearSampler, r, s.roughness * maxMip).rgb;
  let sky = skyIrradiance(s.n);
  var irr = sky;
  var reflOcc = 1.0;
  let g = giFetch(p);
  if (g.weight > 0.0) {
    irr = mix(sky, max(giEval(g, s.n), sky * 0.1), g.weight);
    // reflections that would see the valley wall instead of the sky are dimmed
    let skyR = luminance(skyIrradiance(r));
    reflOcc = mix(1.0, clamp(luminance(giEval(g, r)) / max(skyR, 1e-4), 0.0, 1.0), g.weight);
  }
  irr += weatherLight(s.n);
  let diffuse = irr * s.albedo * (1.0 - s.metallic) * (1.0 - specColor);
  // horizon occlusion: reflections pointing below the surface are blocked by it
  let horizon = clamp(1.0 + dot(r, s.n), 0.0, 1.0);
  return diffuse * ao + env * specColor * specOcclusion * horizon * horizon * reflOcc;
}

/** Apply the froxel volume: aerial perspective + volumetric fog with light shafts. */
fn applyVolumetrics(color: vec3f, uv: vec2f, dist: f32) -> vec3f {
  if (frame.lightInfo.z < 0.5) { return color; }
  let w = pow(clamp(dist / frame.lightInfo.w, 0.0, 1.0), 1.0 / frame.volInfo.w);
  let v = textureSampleLevel(volumeTex, linearSampler, vec3f(uv, w), 0.0);
  return color * v.a + v.rgb;
}
`;

export const SHADING_WGSL = LIGHTING_WGSL + SURFACE_WGSL;

/** Reconstruct world position from a depth-buffer value (reversed-Z) and screen uv. */
export const RECONSTRUCT_WGSL = /* wgsl */ `
fn worldFromDepth(uv: vec2f, depth: f32) -> vec3f {
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, depth, 1.0);
  let w = frame.invViewProj * ndc;
  return w.xyz / w.w;
}
fn linearDepth(depth: f32) -> f32 { return frame.camPos.w / max(depth, 1e-7); }
`;

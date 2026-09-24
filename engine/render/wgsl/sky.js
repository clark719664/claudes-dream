// Sky pass: sky-view LUT, sun and moon discs, stars, cloud layer and aerial perspective.
import { GLOBALS_WGSL, MATH_WGSL, ATMOSPHERE_WGSL, SHADING_WGSL, RECONSTRUCT_WGSL } from './common.js';
import { FULLSCREEN_VS } from '../../gpu/gpu.js';
import { SKY_FUNCTIONS_WGSL } from '../atmosphere.js';

export const SKY_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${SHADING_WGSL}
${RECONSTRUCT_WGSL}
${SKY_FUNCTIONS_WGSL}
${FULLSCREEN_VS}

fn stars(d: vec3f) -> vec3f {
  let p = d * 300.0;
  let id = floor(p);
  let h = hash13(id);
  if (h < 0.9965) { return vec3f(0.0); }
  let f = fract(p) - 0.5;
  let core = smoothstep(0.35, 0.0, length(f));
  let twinkle = 0.65 + 0.35 * sin(frame.time.x * (1.5 + h * 6.0) + h * 91.0);
  let tint = mix(vec3f(0.75, 0.85, 1.0), vec3f(1.0, 0.85, 0.7), fract(h * 37.0));
  return tint * core * twinkle * (h - 0.9965) * 900.0;
}

// ---------------------------------------------------------------- aurora
// Curtains of light hanging 100 km up: thin sheets folded along drifting,
// domain-warped lines, streaked with vertical rays. Green oxygen light at the
// lower edge fading into violet higher up; marched through the curtain height
// so they have depth and parallax against the stars.

fn auroraCurtain(p: vec2f, t: f32) -> f32 {
  let warp = fbm(p * 0.22 + vec2f(t * 0.018, -t * 0.012), 3);
  let f = p.y * 0.55 + sin(p.x * 0.33 + t * 0.035) * 1.2 + (warp - 0.5) * 3.4;
  let g = f / 2.8;
  let dist = abs(fract(g) - 0.5) * 2.0;
  let sheet = exp(-dist * dist * 34.0);
  let rays = vnoise(vec2f(p.x * 5.5 + floor(g) * 13.0, t * 0.22));
  let pulse = 0.55 + 0.45 * vnoise(vec2f(p.x * 0.25 - t * 0.08, floor(g) * 3.0));
  return sheet * (0.3 + 0.7 * rays * rays) * pulse;
}

fn aurora(d: vec3f, jitter: f32) -> vec3f {
  let strength = frame.weatherFx.w * frame.atmos.w;
  if (strength <= 0.001 || d.y <= 0.0) { return vec3f(0.0); }
  let t = frame.time.x;
  var col = vec3f(0.0);
  let steps = 20;
  for (var i = 0; i < steps; i++) {
    let h = (f32(i) + jitter) / f32(steps);
    let p = d.xz / (d.y + 0.06) * (1.0 + h * 0.9) * 3.0;
    let tint = mix(vec3f(0.1, 1.0, 0.42), vec3f(0.75, 0.18, 0.95), smoothstep(0.3, 1.0, h));
    col += tint * auroraCurtain(p, t) * exp(-h * 2.4) * smoothstep(0.0, 0.1, h);
  }
  return col * strength * smoothstep(0.0, 0.2, d.y) * (0.5 / f32(steps));
}

// ---------------------------------------------------------------- lightning
fn boltOffset(s: f32, seed: f32) -> f32 {
  var off = 0.0;
  var amp = 1.0;
  var f = 3.0;
  for (var i = 0; i < 5; i++) {
    off += (vnoise(vec2f(s * f, seed + f32(i) * 7.7)) - 0.5) * amp;
    amp *= 0.5;
    f *= 2.2;
  }
  return off;
}

/** A jagged, forking bolt from the cloud base to the ground, drawn in direction space. */
fn lightningBolt(d: vec3f) -> vec3f {
  let fl = frame.weatherFx.z;
  let top = frame.flashPos.xyz;
  if (fl < 0.3 || dot(top, top) < 0.5) { return vec3f(0.0); }
  let elTop = asin(clamp(top.y, -1.0, 1.0));
  let el = asin(clamp(d.y, -1.0, 1.0));
  if (el > elTop || el < -0.02) { return vec3f(0.0); }
  let s = 1.0 - el / max(elTop, 1e-3);
  let seed = frame.flashPos.w;
  let az = atan2(d.x, d.z);
  let azTop = atan2(top.x, top.z);
  let width = elTop * 0.2;
  var da = az - azTop - boltOffset(s, seed) * width;
  da -= TAU * round(da / TAU);
  var dist = abs(da) * cos(el);
  if (s > 0.25 && s < 0.85) {
    let side = select(-1.0, 1.0, fract(seed * 7.13) > 0.5);
    var db = az - azTop - (boltOffset(s, seed) + (s - 0.25) * 1.4 * side + boltOffset(s * 1.7, seed + 3.3) * 0.4) * width;
    db -= TAU * round(db / TAU);
    dist = min(dist, abs(db) * cos(el) * mix(1.2, 3.5, (s - 0.25) / 0.6));
  }
  let px = frame.camFwd.w * 2.0 * frame.resolution.w;
  // bright enough to burn white at night exposure, with a tight halo that bloom widens
  let core = exp(-dist / (px * 0.9));
  let glow = exp(-dist / (px * 5.0)) * 0.25 + exp(-dist / 0.03) * 0.006;
  return vec3f(0.85, 0.9, 1.0) * (core * 4.0 + glow) * (fl - 0.3) / 0.7;
}

@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let wp = worldFromDepth(in.uv, 1.0);
  let d = normalize(wp - frame.camPos.xyz);
  var sky = skyLUT(d);
  let r = R_BOTTOM + frame.atmos.y;
  let viewT = sampleTransmittance(r, max(d.y, 0.0));

  // sun disc with limb darkening
  let sd = dot(d, frame.sunDir.xyz);
  let sunCos = cos(SUN_ANGULAR_RADIUS);
  if (sd > sunCos - 0.00002 && d.y > -0.05) {
    let x = clamp((1.0 - sd) / (1.0 - sunCos), 0.0, 1.0);
    let limb = pow(max(1.0 - x, 0.0), 0.4);
    let edge = smoothstep(1.0, 0.85, x);
    sky += frame.sunDir.w * viewT * 180.0 * limb * edge;
  }
  // moon disc with procedural maria
  let md = dot(d, frame.moonDir.xyz);
  let moonCos = cos(SUN_ANGULAR_RADIUS * 1.4);
  if (md > moonCos && frame.moonDir.w > 0.0) {
    let up = select(vec3f(0.0, 1.0, 0.0), vec3f(1.0, 0.0, 0.0), abs(frame.moonDir.y) > 0.99);
    let tx = normalize(cross(up, frame.moonDir.xyz));
    let ty = cross(frame.moonDir.xyz, tx);
    let q = vec2f(dot(d, tx), dot(d, ty)) / sin(SUN_ANGULAR_RADIUS * 1.4);
    let maria = 0.65 + 0.35 * fbm(q * 3.0 + 7.0, 4);
    let edge = smoothstep(1.0, 0.9, length(q));
    sky += vec3f(0.9, 0.93, 1.0) * maria * edge * 0.6 * viewT;
  }
  // stars fade in as the sky darkens
  if (d.y > 0.0 && frame.atmos.w > 0.0) {
    let dark = clamp(1.0 - luminance(sky) * 60.0, 0.0, 1.0);
    sky += stars(d) * frame.atmos.w * dark * viewT;
  }
  sky += aurora(d, ign(in.pos.xy + frame.time.z * 1.7));
  // clouds, lit from within when lightning strikes
  var cover = 0.0;
  if (frame.clouds.w > 0.5) {
    let c = cloudsAt(d);
    sky = sky * c.a + c.rgb;
    cover = 1.0 - c.a;
  } else {
    let cl = cloudLayerAt(d, sky);
    sky = mix(sky, cl.rgb, cl.a);
    cover = cl.a;
  }
  if (frame.weatherFx.z > 0.001) {
    let c = max(dot(d, normalize(frame.flashPos.xyz + vec3f(0.0, 1e-4, 0.0))), 0.0);
    let near = pow(c, 12.0);
    sky += vec3f(0.62, 0.66, 0.9) * frame.weatherFx.z * (cover * (0.015 + 0.8 * near) + pow(c, 80.0) * 0.03);
    sky += lightningBolt(d);
  }
  sky = applyVolumetrics(sky, in.uv, frame.lightInfo.w * 4.0);
  return vec4f(sky, 1.0);
}
`;

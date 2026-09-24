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
  sky = applyClouds(sky, d);
  sky = applyVolumetrics(sky, in.uv, frame.lightInfo.w * 4.0);
  return vec4f(sky, 1.0);
}
`;

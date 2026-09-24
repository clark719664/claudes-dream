// Ground Truth Ambient Occlusion (Jimenez et al. 2016), half resolution,
// temporally rotated slices + a depth-aware blur. Uses the depth prepass.

import { bindLayout, bindGroup, createShader, texture2D, U, FULLSCREEN_VS, fullscreenPipeline } from '../gpu/gpu.js';
import { FRAME, MATH_WGSL } from './wgsl/common.js';

const GTAO_WGSL = /* wgsl */ `
${FRAME.wgsl}
${MATH_WGSL}
${FULLSCREEN_VS}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var depthTex: texture_depth_2d;

fn viewPos(uv: vec2f) -> vec3f {
  let size = vec2f(textureDimensions(depthTex));
  let d = textureLoad(depthTex, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0);
  let p = frame.invProj * vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, max(d, 1e-7), 1.0);
  return p.xyz / p.w;
}

@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(depthTex));
  let uv = in.uv;
  let d0 = textureLoad(depthTex, vec2i(uv * size), 0);
  if (d0 <= 0.0) { return vec4f(1.0); }
  let P = viewPos(uv);
  let px = 1.0 / size;
  // normal from the smaller depth differences (robust at silhouettes)
  let pr = viewPos(uv + vec2f(px.x, 0.0)) - P;
  let pl = P - viewPos(uv - vec2f(px.x, 0.0));
  let pu = viewPos(uv + vec2f(0.0, px.y)) - P;
  let pd = P - viewPos(uv - vec2f(0.0, px.y));
  let dx = select(pl, pr, abs(pr.z) < abs(pl.z));
  let dy = select(pd, pu, abs(pu.z) < abs(pd.z));
  let N = normalize(cross(dy, dx));
  let V = normalize(-P);

  let radius = 1.4;
  let projScale = frame.proj[1][1] * 0.5 * size.y;
  let screenRadius = min(radius * projScale / max(-P.z, 0.1), 80.0);
  if (screenRadius < 1.0) { return vec4f(1.0); }
  let noise = ign(in.pos.xy + 7.13 * (frame.time.z % 16.0));
  let jitter = fract(noise * 1.618 + 0.3);
  let slices = 3;
  let steps = 5;
  var vis = 0.0;
  for (var s = 0; s < slices; s++) {
    let phi = (f32(s) + noise) / f32(slices) * PI;
    let dir2 = vec2f(cos(phi), sin(phi));
    let dirV = vec3f(dir2.x, -dir2.y, 0.0);
    let orth = dirV - V * dot(dirV, V);
    let axis = normalize(cross(orth, V));
    let projN = N - axis * dot(N, axis);
    let projLen = length(projN);
    let cosN = clamp(dot(projN / max(projLen, 1e-4), V), -1.0, 1.0);
    let n = sign(dot(orth, projN)) * acos(cosN);
    let lowCos0 = cos(n + PI * 0.5);
    let lowCos1 = cos(n - PI * 0.5);
    var hc0 = lowCos0;
    var hc1 = lowCos1;
    for (var k = 0; k < steps; k++) {
      let t = (f32(k) + jitter) / f32(steps);
      let offs = dir2 * (t * t * screenRadius + 1.0) * px;
      let S0 = viewPos(uv + offs) - P;
      let S1 = viewPos(uv - offs) - P;
      let l0 = length(S0);
      let l1 = length(S1);
      let f0 = clamp(1.0 - l0 * l0 / (radius * radius), 0.0, 1.0);
      let f1 = clamp(1.0 - l1 * l1 / (radius * radius), 0.0, 1.0);
      hc0 = max(hc0, mix(lowCos0, dot(S0 / max(l0, 1e-4), V), f0));
      hc1 = max(hc1, mix(lowCos1, dot(S1 / max(l1, 1e-4), V), f1));
    }
    let h0 = n + clamp(-acos(clamp(hc1, -1.0, 1.0)) - n, -PI * 0.5, PI * 0.5);
    let h1 = n + clamp(acos(clamp(hc0, -1.0, 1.0)) - n, -PI * 0.5, PI * 0.5);
    let iarc0 = (cosN + 2.0 * h0 * sin(n) - cos(2.0 * h0 - n)) * 0.25;
    let iarc1 = (cosN + 2.0 * h1 * sin(n) - cos(2.0 * h1 - n)) * 0.25;
    vis += projLen * (iarc0 + iarc1);
  }
  vis /= f32(slices);
  return vec4f(vec3f(clamp(pow(vis, 1.25), 0.0, 1.0)), 1.0);
}
`;

const BLUR_WGSL = /* wgsl */ `
${FRAME.wgsl}
${FULLSCREEN_VS}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var aoTex: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
fn lin(uv: vec2f) -> f32 {
  let size = vec2f(textureDimensions(depthTex));
  let d = textureLoad(depthTex, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0);
  return frame.camPos.w / max(d, 1e-7);
}
@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(aoTex));
  let center = lin(in.uv);
  var sum = 0.0;
  var wsum = 0.0;
  for (var y = -2; y <= 1; y++) {
    for (var x = -2; x <= 1; x++) {
      let uv = in.uv + (vec2f(f32(x), f32(y)) + 0.5) / size;
      let w = exp(-abs(lin(uv) - center) / (center * 0.04 + 0.05));
      sum += textureLoad(aoTex, vec2i(clamp(uv * size, vec2f(0.0), size - 1.0)), 0).r * w;
      wsum += w;
    }
  }
  return vec4f(vec3f(sum / max(wsum, 1e-4)), 1.0);
}
`;

export class GTAO {
  constructor(renderer) {
    const d = (this.device = renderer.device);
    this.renderer = renderer;
    this.layout = bindLayout(d, 'gtao', [['F', 'uniform'], ['F', 'depth']]);
    this.blurLayout = bindLayout(d, 'gtao-blur', [['F', 'uniform'], ['F', 'utexture'], ['F', 'depth']]);
    this.pipe = fullscreenPipeline(d, { label: 'gtao', module: createShader(d, GTAO_WGSL, 'gtao'), layouts: [this.layout], format: 'r8unorm' });
    this.blurPipe = fullscreenPipeline(d, { label: 'gtao-blur', module: createShader(d, BLUR_WGSL, 'gtao-blur'), layouts: [this.blurLayout], format: 'r8unorm' });
  }

  resize(iw, ih) {
    const d = this.device;
    const r = this.renderer;
    this.raw?.destroy();
    this.blurred?.destroy();
    const w = Math.max(1, iw >> 1), h = Math.max(1, ih >> 1);
    this.raw = texture2D(d, { width: w, height: h, format: 'r8unorm', usage: U.RT | U.TEX, label: 'gtao-raw' });
    this.blurred = texture2D(d, { width: w, height: h, format: 'r8unorm', usage: U.RT | U.TEX, label: 'gtao' });
    this.group = bindGroup(d, this.layout, [r.frameBuffer, r.depthView]);
    this.blurGroup = bindGroup(d, this.blurLayout, [r.frameBuffer, this.raw.createView(), r.depthView]);
    r.setAOView(this.blurred.createView(), true);
  }

  afterPrepass(encoder) {
    const run = (view, pipe, group) => {
      const pass = encoder.beginRenderPass({ label: 'gtao', colorAttachments: [{ view, loadOp: 'clear', storeOp: 'store', clearValue: { r: 1, g: 1, b: 1, a: 1 } }] });
      pass.setPipeline(pipe);
      pass.setBindGroup(0, group);
      pass.draw(3);
      pass.end();
    };
    run(this.raw.createView(), this.pipe, this.group);
    run(this.blurred.createView(), this.blurPipe, this.blurGroup);
  }
}

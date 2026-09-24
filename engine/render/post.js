// Post-processing: temporal anti-aliasing with upscaling (renders internally
// at a fraction of the screen resolution and reconstructs a full resolution
// image over time), histogram auto-exposure, physically based bloom, AgX
// tonemapping, color grading and adaptive sharpening.

import { bindLayout, bindGroup, createShader, createBuffer, texture2D, U, FULLSCREEN_VS, fullscreenPipeline } from '../gpu/gpu.js';
import { FRAME, MATH_WGSL } from './wgsl/common.js';

const TAA_WGSL = /* wgsl */ `
${FRAME.wgsl}
${MATH_WGSL}
${FULLSCREEN_VS}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var current: texture_2d<f32>;
@group(0) @binding(2) var depthTex: texture_depth_2d;
@group(0) @binding(3) var history: texture_2d<f32>;
@group(0) @binding(4) var linearSampler: sampler;
@group(0) @binding(5) var<uniform> params: vec4f; // x = history valid, y = feedback

fn toYCoCg(c: vec3f) -> vec3f {
  return vec3f(c.r * 0.25 + c.g * 0.5 + c.b * 0.25, c.r * 0.5 - c.b * 0.5, -c.r * 0.25 + c.g * 0.5 - c.b * 0.25);
}
fn fromYCoCg(c: vec3f) -> vec3f {
  return vec3f(c.x + c.y - c.z, c.x + c.z, c.x - c.y - c.z);
}
// compress HDR so bright pixels don't dominate the resolve (reduces flicker)
fn tm(c: vec3f) -> vec3f { return c / (1.0 + luminance(c)); }
fn itm(c: vec3f) -> vec3f { return c / max(1.0 - luminance(c), 1e-4); }

fn sampleHistoryCatmullRom(uv: vec2f) -> vec3f {
  let size = vec2f(textureDimensions(history));
  let pos = uv * size;
  let center = floor(pos - 0.5) + 0.5;
  let f = pos - center;
  let w0 = f * (-0.5 + f * (1.0 - 0.5 * f));
  let w1 = 1.0 + f * f * (-2.5 + 1.5 * f);
  let w2 = f * (0.5 + f * (2.0 - 1.5 * f));
  let w3 = f * f * (-0.5 + 0.5 * f);
  let w12 = w1 + w2;
  let tc12 = (center + w2 / w12) / size;
  let tc0 = (center - 1.0) / size;
  let tc3 = (center + 2.0) / size;
  var c = textureSampleLevel(history, linearSampler, vec2f(tc12.x, tc0.y), 0.0).rgb * (w12.x * w0.y);
  c += textureSampleLevel(history, linearSampler, vec2f(tc0.x, tc12.y), 0.0).rgb * (w0.x * w12.y);
  c += textureSampleLevel(history, linearSampler, vec2f(tc12.x, tc12.y), 0.0).rgb * (w12.x * w12.y);
  c += textureSampleLevel(history, linearSampler, vec2f(tc3.x, tc12.y), 0.0).rgb * (w3.x * w12.y);
  c += textureSampleLevel(history, linearSampler, vec2f(tc12.x, tc3.y), 0.0).rgb * (w12.x * w3.y);
  let wsum = w12.x * w0.y + w0.x * w12.y + w12.x * w12.y + w3.x * w12.y + w12.x * w3.y;
  return max(c / wsum, vec3f(0.0));
}

@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let inSize = vec2f(textureDimensions(current));
  let texel = 1.0 / inSize;
  // where this (unjittered) output pixel lands in the jittered current frame
  let jitterUV = vec2f(frame.jitter.x * 0.5, -frame.jitter.y * 0.5);
  let uvCur = in.uv + jitterUV;

  // 3x3 neighbourhood statistics + closest depth (for crisp reprojection of edges)
  var m1 = vec3f(0.0);
  var m2 = vec3f(0.0);
  var closest = 0.0;
  var closestUV = uvCur;
  for (var y = -1; y <= 1; y++) {
    for (var x = -1; x <= 1; x++) {
      let o = vec2f(f32(x), f32(y)) * texel;
      let c = toYCoCg(tm(textureSampleLevel(current, linearSampler, uvCur + o, 0.0).rgb));
      m1 += c;
      m2 += c * c;
      let dCoord = vec2i(clamp((uvCur + o) * inSize, vec2f(0.0), inSize - 1.0));
      let d = textureLoad(depthTex, dCoord, 0);
      if (d > closest) { closest = d; closestUV = uvCur + o; }
    }
  }
  let mean = m1 / 9.0;
  let sigma = sqrt(max(m2 / 9.0 - mean * mean, vec3f(0.0)));
  let cur = toYCoCg(tm(textureSampleLevel(current, linearSampler, uvCur, 0.0).rgb));

  // reproject using camera motion
  let ndc = vec4f(closestUV.x * 2.0 - 1.0, 1.0 - closestUV.y * 2.0, closest, 1.0);
  var world = frame.invViewProj * ndc;
  var prevUV = in.uv;
  if (closest > 0.0) {
    world = world / world.w;
    let prev = frame.prevViewProj * vec4f(world.xyz, 1.0);
    let prevNdc = prev.xy / prev.w;
    prevUV = in.uv + (vec2f(prevNdc.x * 0.5 + 0.5, 0.5 - prevNdc.y * 0.5) - (closestUV - jitterUV));
  } else {
    // sky: rotation-only reprojection through the far plane direction
    let far = frame.invViewProj * vec4f(ndc.xy, 1.0, 1.0);
    let dir = normalize(far.xyz / far.w - frame.camPos.xyz);
    let prev = frame.prevViewProj * vec4f(frame.camPos.xyz + dir * 1e4, 1.0);
    let prevNdc = prev.xy / prev.w;
    prevUV = vec2f(prevNdc.x * 0.5 + 0.5, 0.5 - prevNdc.y * 0.5);
  }

  var result = cur;
  let valid = params.x > 0.5 && all(prevUV >= vec2f(0.0)) && all(prevUV <= vec2f(1.0));
  if (valid) {
    var hist = toYCoCg(tm(sampleHistoryCatmullRom(prevUV)));
    // variance clipping against the current neighbourhood
    let gamma = 1.25;
    let lo = mean - sigma * gamma;
    let hi = mean + sigma * gamma;
    let c = (lo + hi) * 0.5;
    let e = max((hi - lo) * 0.5, vec3f(1e-5));
    let off = hist - c;
    let unit = abs(off / e);
    let maxUnit = max(unit.x, max(unit.y, unit.z));
    if (maxUnit > 1.0) { hist = c + off / maxUnit; }
    // more history when the scene is stable, less when disoccluded
    let motion = length((prevUV - in.uv) * vec2f(textureDimensions(history)));
    let feedback = clamp(params.y - motion * 0.01, 0.8, params.y);
    result = mix(cur, hist, feedback);
  }
  return vec4f(max(itm(fromYCoCg(result)), vec3f(0.0)), 1.0);
}
`;

const BLOOM_DOWN_WGSL = /* wgsl */ `
${FULLSCREEN_VS}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> params: vec4f; // x = first pass (karis)
fn s(uv: vec2f, o: vec2f, t: vec2f) -> vec3f { return textureSampleLevel(src, linearSampler, uv + o * t, 0.0).rgb; }
fn karis(c: vec3f) -> f32 { return 1.0 / (1.0 + dot(c, vec3f(0.2126, 0.7152, 0.0722)) * 0.25); }
@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let t = 1.0 / vec2f(textureDimensions(src));
  let uv = in.uv;
  let a = s(uv, vec2f(-2.0, 2.0), t); let b = s(uv, vec2f(0.0, 2.0), t); let c = s(uv, vec2f(2.0, 2.0), t);
  let d = s(uv, vec2f(-2.0, 0.0), t); let e = s(uv, vec2f(0.0, 0.0), t); let f = s(uv, vec2f(2.0, 0.0), t);
  let g = s(uv, vec2f(-2.0, -2.0), t); let h = s(uv, vec2f(0.0, -2.0), t); let i = s(uv, vec2f(2.0, -2.0), t);
  let j = s(uv, vec2f(-1.0, 1.0), t); let k = s(uv, vec2f(1.0, 1.0), t); let l = s(uv, vec2f(-1.0, -1.0), t); let m = s(uv, vec2f(1.0, -1.0), t);
  var col: vec3f;
  if (params.x > 0.5) {
    let g0 = (a + b + d + e) * 0.25; let g1 = (b + c + e + f) * 0.25;
    let g2 = (d + e + g + h) * 0.25; let g3 = (e + f + h + i) * 0.25; let g4 = (j + k + l + m) * 0.25;
    let w0 = karis(g0) * 0.125; let w1 = karis(g1) * 0.125; let w2 = karis(g2) * 0.125; let w3 = karis(g3) * 0.125; let w4 = karis(g4) * 0.5;
    col = (g0 * w0 + g1 * w1 + g2 * w2 + g3 * w3 + g4 * w4) / (w0 + w1 + w2 + w3 + w4);
  } else {
    col = e * 0.125 + (a + c + g + i) * 0.03125 + (b + d + f + h) * 0.0625 + (j + k + l + m) * 0.125;
  }
  return vec4f(max(col, vec3f(0.0)), 1.0);
}
`;

const BLOOM_UP_WGSL = /* wgsl */ `
${FULLSCREEN_VS}
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var<uniform> params: vec4f; // x = radius
@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let t = params.x / vec2f(textureDimensions(src));
  let uv = in.uv;
  var c = textureSampleLevel(src, linearSampler, uv + vec2f(-t.x, t.y), 0.0).rgb + textureSampleLevel(src, linearSampler, uv + vec2f(t.x, t.y), 0.0).rgb
        + textureSampleLevel(src, linearSampler, uv + vec2f(-t.x, -t.y), 0.0).rgb + textureSampleLevel(src, linearSampler, uv + vec2f(t.x, -t.y), 0.0).rgb;
  c += 2.0 * (textureSampleLevel(src, linearSampler, uv + vec2f(0.0, t.y), 0.0).rgb + textureSampleLevel(src, linearSampler, uv + vec2f(0.0, -t.y), 0.0).rgb
            + textureSampleLevel(src, linearSampler, uv + vec2f(-t.x, 0.0), 0.0).rgb + textureSampleLevel(src, linearSampler, uv + vec2f(t.x, 0.0), 0.0).rgb);
  c += 4.0 * textureSampleLevel(src, linearSampler, uv, 0.0).rgb;
  return vec4f(c / 16.0, 1.0);
}
`;

const HISTOGRAM_CS = /* wgsl */ `
@group(0) @binding(0) var src: texture_2d<f32>;
@group(0) @binding(1) var<storage, read_write> bins: array<atomic<u32>, 64>;
var<workgroup> local: array<atomic<u32>, 64>;
const MIN_EV = -12.0;
const RANGE_EV = 20.0;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u, @builtin(local_invocation_index) li: u32) {
  atomicStore(&local[li], 0u);
  workgroupBarrier();
  let size = textureDimensions(src);
  if (id.x < size.x && id.y < size.y) {
    let c = textureLoad(src, id.xy, 0).rgb;
    let l = dot(c, vec3f(0.2126, 0.7152, 0.0722));
    var bin = 0u;
    if (l > 1e-5) { bin = u32(clamp((log2(l) - MIN_EV) / RANGE_EV, 0.0, 1.0) * 62.0 + 1.0); }
    // weight the centre of the screen more (where the player looks)
    let uv = vec2f(id.xy) / vec2f(size) - 0.5;
    let w = u32(mix(4.0, 1.0, clamp(length(uv) * 1.6, 0.0, 1.0)));
    atomicAdd(&local[bin], w);
  }
  workgroupBarrier();
  atomicAdd(&bins[li], atomicLoad(&local[li]));
}
`;

const EXPOSURE_CS = /* wgsl */ `
@group(0) @binding(0) var<storage, read_write> bins: array<atomic<u32>, 64>;
@group(0) @binding(1) var<storage, read_write> exposure: array<f32, 4>; // avg log2 lum, exposure, -, -
@group(0) @binding(2) var<uniform> params: vec4f; // dt, compensation EV, min EV, max EV
const MIN_EV = -12.0;
const RANGE_EV = 20.0;
var<workgroup> counts: array<f32, 64>;
@compute @workgroup_size(64)
fn main(@builtin(local_invocation_index) li: u32) {
  counts[li] = f32(atomicLoad(&bins[li]));
  atomicStore(&bins[li], 0u);
  workgroupBarrier();
  if (li == 0u) {
    var total = 0.0;
    for (var i = 1u; i < 64u; i++) { total += counts[i]; }
    // average the middle of the histogram, ignoring the darkest 40% and brightest 3%
    let lo = total * 0.4;
    let hi = total * 0.97;
    var acc = 0.0;
    var sum = 0.0;
    var weight = 0.0;
    for (var i = 1u; i < 64u; i++) {
      let c = counts[i];
      let start = acc;
      let end = acc + c;
      acc = end;
      let w = max(0.0, min(end, hi) - max(start, lo));
      let ev = MIN_EV + (f32(i) - 0.5) / 62.0 * RANGE_EV;
      sum += ev * w;
      weight += w;
    }
    var goal = select(-2.0, sum / weight, weight > 0.0);
    goal = clamp(goal, params.z, params.w);
    var current = exposure[0];
    if (current != current || exposure[3] < 0.5) { current = goal; exposure[3] = 1.0; }
    let speed = select(1.2, 2.5, goal > current);
    current = current + (goal - current) * (1.0 - exp(-params.x * speed));
    exposure[0] = current;
    // map average luminance to mid grey (0.18), plus artistic compensation
    exposure[1] = 0.18 / exp2(current) * exp2(params.y);
  }
}
`;

const COMPOSITE_WGSL = /* wgsl */ `
${MATH_WGSL}
${FULLSCREEN_VS}
@group(0) @binding(0) var scene: texture_2d<f32>;
@group(0) @binding(1) var bloom: texture_2d<f32>;
@group(0) @binding(2) var linearSampler: sampler;
@group(0) @binding(3) var<storage, read> exposure: array<f32, 4>;
@group(0) @binding(4) var<uniform> grade: array<vec4f, 3>; // [bloom, saturation, contrast, vignette], [warmth, sharpen, grain, time], [flash rgb, flash]

fn agxContrast(x: vec3f) -> vec3f {
  let x2 = x * x;
  let x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4 - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}
fn agx(c: vec3f) -> vec3f {
  let m = mat3x3f(0.842479062253094, 0.0423282422610123, 0.0423756549057051,
                  0.0784335999999992, 0.878468636469772, 0.0784336,
                  0.0792237451477643, 0.0791661274605434, 0.879142973793104);
  let minEv = -12.47393;
  let maxEv = 4.026069;
  var v = m * c;
  v = clamp(log2(max(v, vec3f(1e-10))), vec3f(minEv), vec3f(maxEv));
  v = (v - minEv) / (maxEv - minEv);
  return agxContrast(v);
}
fn agxEotf(c: vec3f) -> vec3f {
  let m = mat3x3f(1.19687900512017, -0.0528968517574562, -0.0529716355144438,
                  -0.0980208811401368, 1.15190312990417, -0.0980434501171241,
                  -0.0990297440797205, -0.0989611768448433, 1.15107367264116);
  return pow(max(m * c, vec3f(0.0)), vec3f(2.2));
}
fn toSRGB(c: vec3f) -> vec3f {
  return select(1.055 * pow(c, vec3f(1.0 / 2.4)) - 0.055, c * 12.92, c <= vec3f(0.0031308));
}

@fragment
fn fs(in: FsOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(scene));
  let t = 1.0 / size;
  let uv = in.uv;
  let ex = exposure[1];
  var c = textureSampleLevel(scene, linearSampler, uv, 0.0).rgb * ex;
  // contrast-adaptive sharpening (restores detail lost to upscaling + TAA), evaluated in a tonemapped domain
  let n = textureSampleLevel(scene, linearSampler, uv + vec2f(0.0, -t.y), 0.0).rgb * ex;
  let s = textureSampleLevel(scene, linearSampler, uv + vec2f(0.0, t.y), 0.0).rgb * ex;
  let e = textureSampleLevel(scene, linearSampler, uv + vec2f(t.x, 0.0), 0.0).rgb * ex;
  let w = textureSampleLevel(scene, linearSampler, uv + vec2f(-t.x, 0.0), 0.0).rgb * ex;
  let tc = c / (1.0 + c);
  let mn = min(tc, min(min(n / (1.0 + n), s / (1.0 + s)), min(e / (1.0 + e), w / (1.0 + w))));
  let mx = max(tc, max(max(n / (1.0 + n), s / (1.0 + s)), max(e / (1.0 + e), w / (1.0 + w))));
  let amp = sqrt(clamp(min(mn, 1.0 - mx) / max(mx, vec3f(1e-4)), vec3f(0.0), vec3f(1.0)));
  let wgt = amp * (-1.0 / mix(8.0, 5.0, grade[1].y)) * step(0.001, grade[1].y);
  c = max((c + (n + s + e + w) * wgt) / (1.0 + 4.0 * wgt), vec3f(0.0));

  let bl = textureSampleLevel(bloom, linearSampler, uv, 0.0).rgb * ex;
  c = mix(c, bl, grade[0].x);
  let warm = grade[1].x;
  c *= vec3f(1.0 + 0.1 * warm, 1.0 + 0.015 * warm, 1.0 - 0.1 * warm);
  c = mix(c, grade[2].rgb, grade[2].a);

  // scotopic (night) vision: dim scenes lose colour and shift towards blue
  let night = smoothstep(-3.5, -7.0, exposure[0]);
  c = mix(c, luminance(c) * vec3f(0.55, 0.7, 1.05), night * 0.75);
  c = agxEotf(agx(c));
  let l = luminance(c);
  c = max(mix(vec3f(l), c, grade[0].y), vec3f(0.0));
  c = clamp((c - 0.18) * grade[0].z + 0.18, vec3f(0.0), vec3f(1.0));
  let q = uv - 0.5;
  c *= mix(1.0, smoothstep(0.95, 0.25, length(q * vec2f(size.x / size.y, 1.0) * 0.8)), grade[0].w);
  var o = toSRGB(clamp(c, vec3f(0.0), vec3f(1.0)));
  let noise = hash12(in.pos.xy + fract(grade[1].w) * 173.0) - 0.5;
  o += noise * (grade[1].z * 0.04 + 1.0 / 255.0);
  return vec4f(o, 1.0);
}
`;

export class PostProcess {
  constructor(device, format, features, tier) {
    this.device = device;
    this.format = format;
    this.bloomFormat = features.has('rg11b10ufloat-renderable') ? 'rg11b10ufloat' : 'rgba16float';
    this.bloomMips = tier.bloomMips;
    this.sampler = device.createSampler({ magFilter: 'linear', minFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge' });
    const d = device;
    this.taaParams = createBuffer(d, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'taa-params');
    this.gradeBuffer = createBuffer(d, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'grade');
    this.exposureParams = createBuffer(d, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'exposure-params');
    this.bins = createBuffer(d, 64 * 4, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'histogram');
    this.exposure = createBuffer(d, 16, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'exposure', new Float32Array([0, 1, 0, 0]));
    this.downParams = [0, 1].map((first) => createBuffer(d, 16, GPUBufferUsage.UNIFORM, 'bloom-down', new Float32Array([first, 0, 0, 0])));
    this.upParams = createBuffer(d, 16, GPUBufferUsage.UNIFORM, 'bloom-up', new Float32Array([1, 0, 0, 0]));

    this.layouts = {
      taa: bindLayout(d, 'taa', [['F', 'uniform'], ['F', 'texture'], ['F', 'depth'], ['F', 'texture'], ['F', 'sampler'], ['F', 'uniform']]),
      bloom: bindLayout(d, 'bloom', [['F', 'texture'], ['F', 'sampler'], ['F', 'uniform']]),
      hist: bindLayout(d, 'hist', [['C', 'utexture'], ['C', 'storage']]),
      exp: bindLayout(d, 'exp', [['C', 'storage'], ['C', 'storage'], ['C', 'uniform']]),
      comp: bindLayout(d, 'comp', [['F', 'texture'], ['F', 'texture'], ['F', 'sampler'], ['F', 'read'], ['F', 'uniform']]),
    };
    const blendAdd = { color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }, alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' } };
    this.pipes = {
      taa: fullscreenPipeline(d, { label: 'taa', module: createShader(d, TAA_WGSL, 'taa'), layouts: [this.layouts.taa], format: 'rgba16float' }),
      down: fullscreenPipeline(d, { label: 'bloom-down', module: createShader(d, BLOOM_DOWN_WGSL, 'bloom-down'), layouts: [this.layouts.bloom], format: this.bloomFormat }),
      up: fullscreenPipeline(d, { label: 'bloom-up', module: createShader(d, BLOOM_UP_WGSL, 'bloom-up'), layouts: [this.layouts.bloom], format: this.bloomFormat, blend: blendAdd }),
      hist: d.createComputePipeline({ label: 'histogram', layout: d.createPipelineLayout({ bindGroupLayouts: [this.layouts.hist] }), compute: { module: createShader(d, HISTOGRAM_CS, 'histogram'), entryPoint: 'main' } }),
      exp: d.createComputePipeline({ label: 'exposure', layout: d.createPipelineLayout({ bindGroupLayouts: [this.layouts.exp] }), compute: { module: createShader(d, EXPOSURE_CS, 'exposure'), entryPoint: 'main' } }),
      comp: fullscreenPipeline(d, { label: 'composite', module: createShader(d, COMPOSITE_WGSL, 'composite'), layouts: [this.layouts.comp], format }),
    };
    this.expGroup = bindGroup(d, this.layouts.exp, [this.bins, this.exposure, this.exposureParams]);
    this.historyValid = false;
    this.historyIndex = 0;
    this.time = 0;
  }

  /** (Re)create output-resolution resources. */
  resize(outW, outH) {
    const d = this.device;
    this.history?.forEach((t) => t.destroy());
    this.bloom?.forEach((t) => t.destroy());
    this.outW = outW; this.outH = outH;
    this.history = [0, 1].map((i) => texture2D(d, { width: outW, height: outH, format: 'rgba16float', usage: U.RT | U.TEX, label: `history-${i}` }));
    this.bloom = [];
    let w = outW, h = outH;
    for (let i = 0; i < this.bloomMips; i++) {
      w = Math.max(1, w >> 1); h = Math.max(1, h >> 1);
      this.bloom.push(texture2D(d, { width: w, height: h, format: this.bloomFormat, usage: U.RT | U.TEX, label: `bloom-${i}` }));
    }
    this.historyViews = this.history.map((t) => t.createView());
    this.bloomViews = this.bloom.map((t) => t.createView());
    // first down pass reads whichever history was just written; build both variants
    this.firstDownGroups = this.historyViews.map((v) => bindGroup(d, this.layouts.bloom, [v, this.sampler, this.downParams[1]]));
    this.upGroups = this.bloom.map((_, i) => (i === 0 ? null : bindGroup(d, this.layouts.bloom, [this.bloomViews[i], this.sampler, this.upParams])));
    this.histGroup = bindGroup(d, this.layouts.hist, [this.bloomViews[Math.min(1, this.bloomViews.length - 1)], this.bins]);
    this.compGroups = this.historyViews.map((v) => bindGroup(d, this.layouts.comp, [v, this.bloomViews[0], this.sampler, this.exposure, this.gradeBuffer]));
    this.historyValid = false;
  }

  /** Bind the internal-resolution inputs (called when internal targets change). */
  setInputs(frameBuffer, hdrView, depthView) {
    this.taaGroups = this.historyViews.map((prev) => bindGroup(this.device, this.layouts.taa, [frameBuffer, hdrView, depthView, prev, this.sampler, this.taaParams]));
    this.historyValid = false;
  }

  setGrade({ bloom = 0.6, saturation = 1, contrast = 1, vignette = 0.3, warmth = 0, sharpen = 0.5, grain = 0.15, exposure = 0 }, flash = [0, 0, 0, 0]) {
    this.time += 0.0161;
    this.device.queue.writeBuffer(this.gradeBuffer, 0, new Float32Array([
      bloom * 0.045, saturation, contrast, vignette,
      warmth, sharpen, grain, this.time,
      flash[0], flash[1], flash[2], flash[3],
    ]));
    this.exposureCompensation = exposure;
  }

  #fullscreen(encoder, view, pipeline, group, load = 'clear', label = '') {
    const pass = encoder.beginRenderPass({ label, colorAttachments: [{ view, loadOp: load, storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }] });
    pass.setPipeline(pipeline);
    pass.setBindGroup(0, group);
    pass.draw(3);
    pass.end();
  }

  /** Run TAA -> bloom -> exposure -> composite into the swapchain view. */
  run(encoder, swapView, dt, { feedback = 0.9, minEV = -6, maxEV = 5 } = {}) {
    const d = this.device;
    const cur = this.historyIndex ^ 1;
    d.queue.writeBuffer(this.taaParams, 0, new Float32Array([this.historyValid ? 1 : 0, feedback, 0, 0]));
    // taaGroups[i] reads history i as "previous"
    this.#fullscreen(encoder, this.historyViews[cur], this.pipes.taa, this.taaGroups[this.historyIndex], 'clear', 'taa');

    // bloom: downsample chain
    this.#fullscreen(encoder, this.bloomViews[0], this.pipes.down, this.firstDownGroups[cur], 'clear', 'bloom-down-0');
    for (let i = 1; i < this.bloom.length; i++) {
      const g = bindGroupCache(this, i);
      this.#fullscreen(encoder, this.bloomViews[i], this.pipes.down, g, 'clear', `bloom-down-${i}`);
    }
    // auto exposure from a low mip
    d.queue.writeBuffer(this.exposureParams, 0, new Float32Array([Math.min(dt, 0.1), this.exposureCompensation ?? 0, minEV, maxEV]));
    const cp = encoder.beginComputePass({ label: 'exposure' });
    cp.setPipeline(this.pipes.hist);
    cp.setBindGroup(0, this.histGroup);
    const src = this.bloom[Math.min(1, this.bloom.length - 1)];
    cp.dispatchWorkgroups(Math.ceil(src.width / 8), Math.ceil(src.height / 8));
    cp.setPipeline(this.pipes.exp);
    cp.setBindGroup(0, this.expGroup);
    cp.dispatchWorkgroups(1);
    cp.end();
    // bloom: upsample + accumulate
    for (let i = this.bloom.length - 1; i > 0; i--) {
      this.#fullscreen(encoder, this.bloomViews[i - 1], this.pipes.up, this.upGroups[i], 'load', `bloom-up-${i}`);
    }
    this.#fullscreen(encoder, swapView, this.pipes.comp, this.compGroups[cur], 'clear', 'composite');
    this.historyIndex = cur;
    this.historyValid = true;
  }
}

function bindGroupCache(post, i) {
  post._downCache ??= [];
  if (!post._downCache[i] || post._downCache[i].view !== post.bloomViews[i - 1]) {
    post._downCache[i] = { view: post.bloomViews[i - 1], group: bindGroup(post.device, post.layouts.bloom, [post.bloomViews[i - 1], post.sampler, post.downParams[0]]) };
  }
  return post._downCache[i].group;
}

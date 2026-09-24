// Froxel volumetrics: a camera-aligned 3D grid holding in-scattered light and
// transmittance for (a) aerial perspective from the physical atmosphere and
// (b) height fog lit by the sun through the shadow cascades (god rays), the
// sky, and point lights (glowing halos). Every surface and the sky apply it
// with a single 3D texture lookup.

import { bindLayout, bindGroup, createShader } from '../gpu/gpu.js';
import { FRAME, MATH_WGSL, ATMOSPHERE_WGSL, LIGHTING_WGSL } from './wgsl/common.js';

const DECLS = /* wgsl */ `
${FRAME.wgsl}
struct Light { posRadius: vec4f, color: vec4f };
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var linearSampler: sampler;
@group(0) @binding(2) var shadowSampler: sampler_comparison;
@group(0) @binding(3) var transmittanceLUT: texture_2d<f32>;
@group(0) @binding(4) var<storage, read> shCoeffs: array<vec4f, 9>;
@group(0) @binding(5) var shadowMap: texture_depth_2d_array;
@group(0) @binding(6) var<storage, read> lights: array<Light>;
@group(0) @binding(7) var repeatSampler: sampler;
@group(0) @binding(8) var weatherTex: texture_2d<f32>;
@group(0) @binding(9) var giTex: texture_2d_array<f32>;
`;

const SCATTER_CS = /* wgsl */ `
${DECLS}
@group(1) @binding(0) var outScatter: texture_storage_3d<rgba16float, write>;
@group(1) @binding(1) var<uniform> params: vec4f; // x = jitter, y = shadows on, z = light count limit
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${LIGHTING_WGSL}

fn volumeShadow(p: vec3f, viewDist: f32) -> f32 {
  if (params.y < 0.5 || frame.shadowInfo.z < 0.5) { return 1.0; }
  let c = cascadeFor(viewDist);
  if (c >= u32(frame.shadowInfo.x)) { return 1.0; }
  let lp = frame.shadowMats[c] * vec4f(p, 1.0);
  let uv = lp.xy * vec2f(0.5, -0.5) + 0.5;
  if (any(uv < vec2f(0.0)) || any(uv > vec2f(1.0))) { return 1.0; }
  return textureSampleCompareLevel(shadowMap, shadowSampler, uv, c, lp.z - 0.002);
}

@compute @workgroup_size(4, 4, 4)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(outScatter);
  if (any(id >= dims)) { return; }
  let uv = (vec2f(id.xy) + 0.5) / vec2f(dims.xy);
  let w = (f32(id.z) + params.x) / f32(dims.z);
  let dist = frame.lightInfo.w * pow(w, frame.volInfo.w);
  let ndc = vec4f(uv.x * 2.0 - 1.0, 1.0 - uv.y * 2.0, 1.0, 1.0);
  let nearP = frame.invViewProj * ndc;
  let dir = normalize(nearP.xyz / nearP.w - frame.camPos.xyz);
  let p = frame.camPos.xyz + dir * dist;
  let viewDist = dist * dot(dir, frame.camFwd.xyz);

  // participating media: scaled atmosphere + exponential height fog with drifting noise
  let m = sampleMedium(frame.atmos.y);
  let atmosScale = 0.001 * frame.atmos.x;
  let t = frame.time.x;
  let n = vnoise3(p * 0.045 + vec3f(frame.wind.x, 0.1, frame.wind.y) * t * 0.6) * 0.7 + vnoise3(p * 0.13 - vec3f(t * 0.2)) * 0.3;
  let fogDensity = frame.fog.x * exp(-max(p.y - frame.fog.z, 0.0) * frame.fog.y) * mix(1.0, n * 1.8, frame.fogAlbedo.w);
  let fogScatter = frame.fogAlbedo.rgb * fogDensity;
  let rayleigh = m.rayleigh * atmosScale;
  let mie = m.mie * atmosScale;
  let extinction = luminance(m.extinction * atmosScale) + fogDensity;

  // lighting
  let key = keyRadiance() * volumeShadow(p, viewDist) * cloudShadow(p);
  let cosT = dot(dir, frame.keyDir.xyz);
  // ambient from the irradiance field: fog in a canyon is darker, fog over lava glows
  let ambient = ambientIrradiance(p, vec3f(0.0, 1.0, 0.0)) * 0.8 + ambientIrradiance(p, vec3f(0.0, -1.0, 0.0)) * 0.2;
  var S = fogScatter * (key * phaseHG(cosT, frame.fog.w) + ambient * 0.5)
        + rayleigh * (key * phaseRayleigh(cosT) + ambient)
        + mie * (key * phaseMie(cosT, MIE_G) + ambient);
  // point lights glowing through the fog
  let count = min(u32(frame.lightInfo.x), u32(params.z));
  for (var i = 0u; i < count; i++) {
    let L = lights[i];
    let lv = L.posRadius.xyz - p;
    let d2 = dot(lv, lv);
    let r = L.posRadius.w;
    if (d2 < r * r) {
      let x = d2 / (r * r);
      let win = (1.0 - x) * (1.0 - x);
      S += (fogScatter + rayleigh + mie) * L.color.rgb * win / (d2 + 1.0) / (4.0 * PI) * 2.0;
    }
  }
  textureStore(outScatter, id, vec4f(S, extinction));
}
`;

const INTEGRATE_CS = /* wgsl */ `
${FRAME.wgsl}
@group(0) @binding(0) var<uniform> frame: Frame;
@group(0) @binding(1) var inScatter: texture_3d<f32>;
@group(0) @binding(2) var outVolume: texture_storage_3d<rgba16float, write>;
@compute @workgroup_size(8, 8)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let dims = textureDimensions(inScatter);
  if (id.x >= dims.x || id.y >= dims.y) { return; }
  var accum = vec3f(0.0);
  var T = 1.0;
  var prevDist = 0.0;
  for (var z = 0u; z < dims.z; z++) {
    let w = (f32(z) + 1.0) / f32(dims.z);
    let dist = frame.lightInfo.w * pow(w, frame.volInfo.w);
    let len = dist - prevDist;
    prevDist = dist;
    let v = textureLoad(inScatter, vec3u(id.xy, z), 0);
    let ext = max(v.a, 1e-7);
    let sliceT = exp(-ext * len);
    // energy conserving integration (Hillaire 2015)
    accum += T * (v.rgb - v.rgb * sliceT) / ext;
    T *= sliceT;
    textureStore(outVolume, vec3u(id.xy, z), vec4f(accum, T));
  }
}
`;

export class Volumetrics {
  constructor(renderer) {
    this.renderer = renderer;
    const d = (this.device = renderer.device);
    const tier = renderer.tier;
    this.dims = tier.froxels;
    this.shadows = tier.volShadows;
    const usage = GPUTextureUsage.STORAGE_BINDING | GPUTextureUsage.TEXTURE_BINDING;
    const make = (label) => d.createTexture({ label, size: this.dims, dimension: '3d', format: 'rgba16float', usage });
    this.scatter = make('froxel-scatter');
    this.volume = make('froxel-volume');
    this.params = d.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
    const globals = bindLayout(d, 'vol-globals', [['C', 'uniform'], ['C', 'sampler'], ['C', 'csampler'], ['C', 'texture'], ['C', 'read'], ['C', 'depth-array'], ['C', 'read'], ['C', 'sampler'], ['C', 'texture'], ['C', 'texture-array']]);
    const outL = bindLayout(d, 'vol-out', [['C', 'storage-texture:rgba16float:3d'], ['C', 'uniform']]);
    const intL = bindLayout(d, 'vol-int', [['C', 'uniform'], ['C', 'texture3d'], ['C', 'storage-texture:rgba16float:3d']]);
    this.scatterPipe = d.createComputePipeline({ label: 'froxel-scatter', layout: d.createPipelineLayout({ bindGroupLayouts: [globals, outL] }), compute: { module: createShader(d, SCATTER_CS, 'froxel-scatter'), entryPoint: 'main' } });
    this.integratePipe = d.createComputePipeline({ label: 'froxel-integrate', layout: d.createPipelineLayout({ bindGroupLayouts: [intL] }), compute: { module: createShader(d, INTEGRATE_CS, 'froxel-integrate'), entryPoint: 'main' } });
    const a = renderer.atmosphere;
    this.globalGroup = bindGroup(d, globals, [renderer.frameBuffer, renderer.samplers.linear, renderer.samplers.shadow, a.transmittance.createView(), a.shBuffer, renderer.shadowArrayView, renderer.lightBuffer, renderer.samplers.repeat, renderer.weatherView, renderer.giView]);
    this.outGroup = bindGroup(d, outL, [this.scatter.createView(), this.params]);
    this.intGroup = bindGroup(d, intL, [renderer.frameBuffer, this.scatter.createView(), this.volume.createView()]);
    this.frame = 0;
  }

  attach(renderer) {
    renderer.froxelDims = this.dims;
    renderer.setVolumeView(this.volume.createView(), true);
  }

  setMaxDistance(meters) { this.renderer.volumeDistance = meters; }

  compute(encoder) {
    const jitter = ((this.frame++ * 0.618034) % 1);
    this.device.queue.writeBuffer(this.params, 0, new Float32Array([jitter, this.shadows ? 1 : 0, this.renderer.tier.lights > 8 ? 8 : 4, 0]));
    const pass = encoder.beginComputePass({ label: 'volumetrics' });
    pass.setPipeline(this.scatterPipe);
    pass.setBindGroup(0, this.globalGroup);
    pass.setBindGroup(1, this.outGroup);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] / 4), Math.ceil(this.dims[1] / 4), Math.ceil(this.dims[2] / 4));
    pass.setPipeline(this.integratePipe);
    pass.setBindGroup(0, this.intGroup);
    pass.dispatchWorkgroups(Math.ceil(this.dims[0] / 8), Math.ceil(this.dims[1] / 8));
    pass.end();
  }
}

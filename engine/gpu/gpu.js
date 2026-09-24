// WebGPU bootstrap, device-class detection and small resource helpers.

/**
 * Quality tiers. The renderer picks one automatically from the device class
 * and then fine-tunes internal resolution every frame (dynamic resolution +
 * temporal upscaling), so phones and gaming PCs both hold their frame rate.
 */
export const TIERS = {
  low: {
    name: 'low', renderScale: [0.5, 0.75], maxOutputPixels: 1280 * 720, targetMs: 33.3,
    shadowSize: 1024, cascades: 2, shadowDistance: 60, gtao: false,
    froxels: [64, 36, 32], volShadows: false, grassRadius: 24, grassDensity: 5, particles: 4096,
    envSize: 32, bloomMips: 5, lights: 8, drawDistance: 0.6, clouds: 0, cloudPano: [1, 1], cloudSteps: [0, 0], giProbes: 48, giRays: 8,
  },
  medium: {
    name: 'medium', renderScale: [0.6, 0.85], maxOutputPixels: 1920 * 1080, targetMs: 16.7,
    shadowSize: 2048, cascades: 3, shadowDistance: 100, gtao: false,
    froxels: [96, 54, 48], volShadows: true, grassRadius: 38, grassDensity: 8, particles: 12288,
    envSize: 64, bloomMips: 6, lights: 16, drawDistance: 0.85, clouds: 1, cloudPano: [1536, 384], cloudSteps: [40, 72], giProbes: 64, giRays: 16,
  },
  high: {
    name: 'high', renderScale: [0.67, 1.0], maxOutputPixels: 2560 * 1440, targetMs: 16.7,
    shadowSize: 2048, cascades: 4, shadowDistance: 150, gtao: true,
    froxels: [160, 90, 64], volShadows: true, grassRadius: 55, grassDensity: 11, particles: 24576,
    envSize: 64, bloomMips: 6, lights: 32, drawDistance: 1.0, clouds: 1, cloudPano: [2560, 640], cloudSteps: [56, 96], giProbes: 96, giRays: 16,
  },
  ultra: {
    name: 'ultra', renderScale: [0.8, 1.0], maxOutputPixels: 3840 * 2160, targetMs: 16.7,
    shadowSize: 4096, cascades: 4, shadowDistance: 220, gtao: true,
    froxels: [192, 108, 96], volShadows: true, grassRadius: 75, grassDensity: 15, particles: 49152,
    envSize: 128, bloomMips: 7, lights: 32, drawDistance: 1.3, clouds: 1, cloudPano: [4096, 1024], cloudSteps: [72, 128], giProbes: 128, giRays: 16,
  },
};

export function isMobileDevice() {
  if (typeof navigator === 'undefined') return false;
  if (navigator.userAgentData?.mobile) return true;
  return /Android|iPhone|iPad|iPod|Mobile|Silk/i.test(navigator.userAgent) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(navigator.userAgent));
}

export function pickTier(adapter) {
  const mobile = isMobileDevice();
  const info = adapter.info ?? {};
  const desc = `${info.vendor ?? ''} ${info.architecture ?? ''} ${info.description ?? ''}`.toLowerCase();
  if (mobile) return /apple|m1|m2|m3|m4/.test(desc) ? 'medium' : 'low';
  if (/swiftshader|llvmpipe|software/.test(desc)) return 'low';
  if (/intel/.test(desc) && !/arc/.test(desc)) return 'medium';
  return 'high';
}

export async function initGPU(canvas, { powerPreference = 'high-performance' } = {}) {
  if (!navigator.gpu) throw new Error('WebGPU is not available in this browser. Try the latest Chrome, Edge or Safari.');
  const adapter = await navigator.gpu.requestAdapter({ powerPreference });
  if (!adapter) throw new Error('No compatible GPU adapter was found.');
  const wanted = ['rg11b10ufloat-renderable', 'float32-filterable', 'timestamp-query'];
  const requiredFeatures = wanted.filter((f) => adapter.features.has(f));
  const device = await adapter.requestDevice({
    requiredFeatures,
    requiredLimits: {
      maxStorageBufferBindingSize: Math.min(adapter.limits.maxStorageBufferBindingSize, 256 * 1024 * 1024),
      maxBufferSize: Math.min(adapter.limits.maxBufferSize, 256 * 1024 * 1024),
      maxStorageBuffersPerShaderStage: Math.min(adapter.limits.maxStorageBuffersPerShaderStage, 8),
      maxSampledTexturesPerShaderStage: Math.min(adapter.limits.maxSampledTexturesPerShaderStage, 16),
    },
  });
  device.lost.then((info) => console.error(`WebGPU device lost: ${info.message}`));
  const context = canvas.getContext('webgpu');
  const format = navigator.gpu.getPreferredCanvasFormat();
  context.configure({ device, format, alphaMode: 'opaque' });
  return { adapter, device, context, format, features: new Set(requiredFeatures), tier: pickTier(adapter) };
}

// ---------------------------------------------------------------- struct layouts

const SIZES = { f32: 1, u32: 1, vec4: 4, mat4: 16 };

/**
 * Declare a uniform struct once, get both the WGSL text and a writer with
 * matching offsets. Only 16-byte aligned members (vec4/mat4, scalars padded)
 * are used so the std140-like WGSL layout rules can never drift.
 */
export function defineStruct(name, fields) {
  const offsets = {};
  let cursor = 0;
  const lines = [];
  for (const [field, type, count = 1] of fields) {
    offsets[field] = cursor;
    const wgslType = { vec4: 'vec4f', mat4: 'mat4x4f', f32: 'vec4f', u32: 'vec4u' }[type];
    lines.push(count > 1 ? `  ${field}: array<${wgslType}, ${count}>,` : `  ${field}: ${wgslType},`);
    cursor += Math.max(4, SIZES[type]) * count;
  }
  const floats = cursor;
  return {
    name,
    floats,
    byteSize: floats * 4,
    offsets,
    wgsl: `struct ${name} {\n${lines.join('\n')}\n};\n`,
  };
}

// ---------------------------------------------------------------- helpers

export function createShader(device, code, label) {
  const module = device.createShaderModule({ code, label });
  module.getCompilationInfo?.().then((info) => {
    for (const m of info.messages) {
      if (m.type === 'error') {
        const lines = code.split('\n');
        const ctx = lines.slice(Math.max(0, m.lineNum - 3), m.lineNum + 2).map((l, i) => `${m.lineNum - 2 + i}: ${l}`).join('\n');
        console.error(`[WGSL ${label}] ${m.lineNum}:${m.linePos} ${m.message}\n${ctx}`);
      }
    }
  });
  return module;
}

const VIS = { V: GPUShaderStageFlags('VERTEX'), F: GPUShaderStageFlags('FRAGMENT'), C: GPUShaderStageFlags('COMPUTE') };
function GPUShaderStageFlags(n) { return typeof GPUShaderStage !== 'undefined' ? GPUShaderStage[n] : 0; }
function visibility(v) { return [...v].reduce((acc, c) => acc | VIS[c], 0); }

/**
 * Compact bind group layout declaration:
 *   bindLayout(device, 'name', [['VF', 'uniform'], ['F', 'texture'], ['F', 'sampler'], ...])
 * Types: uniform, uniform-dyn, storage, read, texture, utexture, depth, depth-array, texture-array,
 * texture3d, cube, sampler, nsampler, csampler, storage-texture:<format>:<dim>
 */
export function bindLayout(device, label, entries) {
  return device.createBindGroupLayout({
    label,
    entries: entries.map(([vis, type, explicit], index) => {
      const e = { binding: explicit ?? index, visibility: visibility(vis) };
      const [kind, fmt, dim] = type.split(':');
      switch (kind) {
        case 'uniform': e.buffer = { type: 'uniform' }; break;
        case 'uniform-dyn': e.buffer = { type: 'uniform', hasDynamicOffset: true }; break;
        case 'storage': e.buffer = { type: 'storage' }; break;
        case 'read': e.buffer = { type: 'read-only-storage' }; break;
        case 'texture': e.texture = { sampleType: 'float' }; break;
        case 'utexture': e.texture = { sampleType: 'unfilterable-float' }; break;
        case 'depth': e.texture = { sampleType: 'depth' }; break;
        case 'depth-array': e.texture = { sampleType: 'depth', viewDimension: '2d-array' }; break;
        case 'texture-array': e.texture = { sampleType: 'float', viewDimension: '2d-array' }; break;
        case 'texture3d': e.texture = { sampleType: 'float', viewDimension: '3d' }; break;
        case 'cube': e.texture = { sampleType: 'float', viewDimension: 'cube' }; break;
        case 'sampler': e.sampler = { type: 'filtering' }; break;
        case 'nsampler': e.sampler = { type: 'non-filtering' }; break;
        case 'csampler': e.sampler = { type: 'comparison' }; break;
        case 'storage-texture': e.storageTexture = { access: 'write-only', format: fmt, viewDimension: dim ?? '2d' }; break;
        default: throw new Error(`Unknown binding type ${type}`);
      }
      return e;
    }),
  });
}

/**
 * Create a bind group from resources in binding order. A resource may be
 * wrapped as { binding, resource } to target an explicit binding index.
 */
export function bindGroup(device, layout, resources, label) {
  return device.createBindGroup({
    label,
    layout,
    entries: resources.map((r, index) => {
      let binding = index;
      if (r && typeof r === 'object' && 'binding' in r && 'resource' in r) { binding = r.binding; r = r.resource; }
      if (r instanceof GPUBuffer) return { binding, resource: { buffer: r } };
      return { binding, resource: r };
    }),
  });
}

export function createBuffer(device, size, usage, label, data = null) {
  const buffer = device.createBuffer({ size: Math.max(16, Math.ceil(size / 4) * 4), usage, label, mappedAtCreation: !!data });
  if (data) {
    const Ctor = data.constructor;
    new Ctor(buffer.getMappedRange()).set(data);
    buffer.unmap();
  }
  return buffer;
}

export function texture2D(device, { width, height, format, usage, label, mips = 1, layers = 1, dimension = '2d' }) {
  return device.createTexture({
    label, format, usage, mipLevelCount: mips, dimension,
    size: { width: Math.max(1, width | 0), height: Math.max(1, height | 0), depthOrArrayLayers: layers },
  });
}

export const U = {
  get TEX() { return GPUTextureUsage.TEXTURE_BINDING; },
  get RT() { return GPUTextureUsage.RENDER_ATTACHMENT; },
  get STO() { return GPUTextureUsage.STORAGE_BINDING; },
  get CSRC() { return GPUTextureUsage.COPY_SRC; },
  get CDST() { return GPUTextureUsage.COPY_DST; },
};

/** A full-screen-triangle render pipeline with a single target. */
export function fullscreenPipeline(device, { label, module, layouts, format, blend, fragment = 'fs', depth = null, targets = null }) {
  return device.createRenderPipeline({
    label,
    layout: device.createPipelineLayout({ bindGroupLayouts: layouts }),
    vertex: { module, entryPoint: 'vs' },
    fragment: { module, entryPoint: fragment, targets: targets ?? [{ format, blend }] },
    primitive: { topology: 'triangle-list' },
    depthStencil: depth ?? undefined,
  });
}

export const FULLSCREEN_VS = /* wgsl */ `
struct FsOut { @builtin(position) pos: vec4f, @location(0) uv: vec2f };
@vertex fn vs(@builtin(vertex_index) i: u32) -> FsOut {
  var o: FsOut;
  let p = vec2f(f32((i << 1u) & 2u), f32(i & 2u));
  o.pos = vec4f(p * 2.0 - 1.0, 0.0, 1.0);
  o.uv = vec2f(p.x, 1.0 - p.y);
  return o;
}
`;

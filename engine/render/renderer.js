// The Reverie renderer: a WebGPU, GPU-driven, physically based pipeline.
//
// Frame outline
//   1. atmosphere     sky-view LUT every frame, sky IBL when lighting changes
//   2. culling        compute shader culls all instances for camera + cascades
//   3. shadows        cascaded shadow maps
//   4. volumetrics    froxel fog + aerial perspective (optional per tier)
//   5. prepass + AO   depth prepass and GTAO (optional per tier)
//   6. main           forward PBR, GPU grass, sky
//   7. water          refraction + screen-space reflections
//   8. particles      GPU simulated
//   9. post           TAA upscale, bloom, auto exposure, AgX, grading
//
// Internal resolution adapts every frame to hold the tier's frame budget and
// the TAA pass reconstructs full output resolution.

import { initGPU, TIERS, bindLayout, bindGroup, createShader, createBuffer, texture2D, U, fullscreenPipeline } from '../gpu/gpu.js';
import { FRAME, GLOBAL_LAYOUT } from './wgsl/common.js';
import { MESH_WGSL, MESH_DEPTH_WGSL, MESH_SHADOW_WGSL } from './wgsl/mesh.js';
import { SKY_WGSL } from './wgsl/sky.js';
import { Atmosphere } from './atmosphere.js';
import { PostProcess } from './post.js';
import { GpuScene } from './scene.js';
import { computeCascades } from './shadows.js';
import { VERTEX_STRIDE } from './meshes.js';
import { mat4, frustumPlanes, halton, hexToLinear, DEG, clamp, smoothstep } from '../core/math.js';

const VERTEX_LAYOUT = [{
  arrayStride: VERTEX_STRIDE,
  attributes: [
    { shaderLocation: 0, offset: 0, format: 'float32x3' },
    { shaderLocation: 1, offset: 12, format: 'float32x3' },
    { shaderLocation: 2, offset: 24, format: 'unorm8x4' },
  ],
}];

const LIGHT_FLOATS = 8;

export class Renderer {
  static async create(canvas, options = {}) {
    const gpu = await initGPU(canvas, options);
    return new Renderer(canvas, gpu, options);
  }

  constructor(canvas, gpu, options = {}) {
    this.canvas = canvas;
    this.device = gpu.device;
    this.context = gpu.context;
    this.format = gpu.format;
    this.features = gpu.features;
    this.adapter = gpu.adapter;
    this.tierName = options.tier ?? gpu.tier;
    this.tier = { ...TIERS[this.tierName] };
    this.fixedScale = options.renderScale ?? null;
    this.renderScale = this.fixedScale ?? this.tier.renderScale[1];
    this.pixelRatio = options.pixelRatio ?? Math.min(globalThis.devicePixelRatio || 1, 2);
    this.frameIndex = 0;
    this.time = 0;
    this.frameMsAvg = this.tier.targetMs;
    this.scaleCooldown = 0;
    this.stats = { internal: [0, 0], output: [0, 0], scale: this.renderScale, instances: 0, fps: 0 };
    this.lights = [];
    this.hooks = { beforeMain: [], main: [], afterMain: [], compute: [] };

    this.env = {
      timeOfDay: 16, sunAzimuth: 210, cloudCover: 0.3, fogDensity: 0.2, fogColor: null, skyTint: [1, 1, 1],
      wind: 0.3, windDir: [0.8, 0.6], aerialScale: 22, groundAlbedo: 0.3,
    };
    this.grade = { bloom: 0.6, saturation: 1, contrast: 1, vignette: 0.3, warmth: 0, sharpen: 0.5, grain: 0.12, exposure: 0 };
    this.flash = [0, 0, 0, 0];
    this.cloudOffset = [0, 0];
    this.player = [0, -1000, 0, 1];

    this.#createStatic();
    this.#createPipelines();
    this.setTerrain(null);
  }

  // ------------------------------------------------------------------ setup

  #createStatic() {
    const d = this.device;
    this.frameData = new Float32Array(FRAME.floats);
    this.frameBuffer = createBuffer(d, FRAME.byteSize, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'frame');
    this.samplers = {
      linear: d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'clamp-to-edge', addressModeV: 'clamp-to-edge', addressModeW: 'clamp-to-edge' }),
      repeat: d.createSampler({ magFilter: 'linear', minFilter: 'linear', mipmapFilter: 'linear', addressModeU: 'repeat', addressModeV: 'repeat' }),
      shadow: d.createSampler({ compare: 'less', magFilter: 'linear', minFilter: 'linear' }),
    };
    this.atmosphere = new Atmosphere(d, this.frameBuffer, this.tier);
    this.atmosphere.setGroundAlbedo(this.env.groundAlbedo);
    this.post = new PostProcess(d, this.format, this.features, this.tier);

    const cascades = this.tier.cascades;
    this.shadowMap = texture2D(d, { width: this.tier.shadowSize, height: this.tier.shadowSize, layers: cascades, format: 'depth32float', usage: U.RT | U.TEX, label: 'shadow-cascades' });
    this.shadowLayerViews = Array.from({ length: cascades }, (_, i) => this.shadowMap.createView({ dimension: '2d', baseArrayLayer: i, arrayLayerCount: 1 }));
    this.shadowArrayView = this.shadowMap.createView({ dimension: '2d-array' });
    this.cascadeBuffer = createBuffer(d, 256 * 4, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'cascades');
    this.lightData = new Float32Array(Math.max(1, this.tier.lights) * LIGHT_FLOATS);
    this.lightBuffer = createBuffer(d, this.lightData.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'lights');

    // Neutral placeholders for optional effects.
    this.dummyAO = texture2D(d, { width: 1, height: 1, format: 'rgba8unorm', usage: U.TEX | U.CDST, label: 'ao-dummy' });
    d.queue.writeTexture({ texture: this.dummyAO }, new Uint8Array([255, 255, 255, 255]), { bytesPerRow: 4 }, { width: 1, height: 1 });
    this.dummyVolume = d.createTexture({ size: [1, 1, 1], dimension: '3d', format: 'rgba16float', usage: U.TEX | U.CDST, label: 'volume-dummy' });
    this.aoView = this.dummyAO.createView();
    this.volumeView = this.dummyVolume.createView({ dimension: '3d' });
    this.volumeEnabled = false;
    this.aoEnabled = false;
  }

  #createPipelines() {
    const d = this.device;
    this.globalLayout = bindLayout(d, 'globals', GLOBAL_LAYOUT);
    this.drawLayout = GpuScene.drawLayout(d);
    this.shadowGlobalLayout = bindLayout(d, 'shadow-globals', [['V', 'uniform', 0], ['V', 'utexture', 13]]);
    this.cascadeLayout = bindLayout(d, 'cascade', [['V', 'uniform-dyn']]);
    this.cascadeGroup = bindGroup(d, this.cascadeLayout, [{ buffer: this.cascadeBuffer, size: 64 }]);

    const meshModule = createShader(d, MESH_WGSL, 'mesh');
    const layout = d.createPipelineLayout({ bindGroupLayouts: [this.globalLayout, this.drawLayout] });
    this.pipes = {};
    this.pipes.mesh = d.createRenderPipeline({
      label: 'mesh-main', layout,
      vertex: { module: meshModule, entryPoint: 'vs', buffers: VERTEX_LAYOUT },
      fragment: { module: meshModule, entryPoint: 'fsMain', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });
    this.pipes.meshAfterPrepass = d.createRenderPipeline({
      label: 'mesh-main-eq', layout,
      vertex: { module: meshModule, entryPoint: 'vs', buffers: VERTEX_LAYOUT },
      fragment: { module: meshModule, entryPoint: 'fsMain', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'equal' },
    });
    const depthModule = createShader(d, MESH_DEPTH_WGSL, 'mesh-depth');
    this.pipes.prepass = d.createRenderPipeline({
      label: 'mesh-prepass', layout,
      vertex: { module: depthModule, entryPoint: 'vs', buffers: VERTEX_LAYOUT },
      primitive: { topology: 'triangle-list', cullMode: 'back' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });
    const shadowModule = createShader(d, MESH_SHADOW_WGSL, 'mesh-shadow');
    this.pipes.shadow = d.createRenderPipeline({
      label: 'mesh-shadow',
      layout: d.createPipelineLayout({ bindGroupLayouts: [this.shadowGlobalLayout, this.drawLayout, this.cascadeLayout] }),
      vertex: { module: shadowModule, entryPoint: 'vs', buffers: VERTEX_LAYOUT },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'less', depthBias: 2, depthBiasSlopeScale: 2.0, depthBiasClamp: 0.01 },
    });
    this.pipes.sky = fullscreenPipeline(d, {
      label: 'sky', module: createShader(d, SKY_WGSL, 'sky'), layouts: [this.globalLayout], format: 'rgba16float',
      depth: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater-equal' },
    });
    this.meshVertexLayout = VERTEX_LAYOUT;
  }

  /** Upload a Heightfield (or null for none) as the GPU heightmap. */
  setTerrain(heightfield, { waterLevel = null } = {}) {
    const d = this.device;
    this.heightmap?.destroy();
    const res = heightfield ? heightfield.res : 1;
    this.heightmap = texture2D(d, { width: res, height: res, format: 'r32float', usage: U.TEX | U.CDST, label: 'heightmap' });
    const data = heightfield ? heightfield.heights : new Float32Array([0]);
    d.queue.writeTexture({ texture: this.heightmap }, data, { bytesPerRow: res * 4 }, { width: res, height: res });
    this.terrain = heightfield
      ? { min: heightfield.minHeight, max: heightfield.maxHeight, water: waterLevel ?? -1000, hasWater: waterLevel !== null, grid: [heightfield.origin, heightfield.origin, heightfield.spacing, heightfield.res] }
      : { min: 0, max: 1, water: -1000, hasWater: false, grid: [0, 0, 1, 1] };
    this.heightfield = heightfield;
    this.#rebuildGlobals();
  }

  setPalette({ low, mid, high, cliff }) {
    this.palette = { low: hexToLinear(low), mid: hexToLinear(mid), high: hexToLinear(high), cliff: hexToLinear(cliff) };
  }

  /** Environment parameters from a game spec (see shared/spec.js). */
  setEnvironment(env) {
    Object.assign(this.env, env);
    if (env.skyTint && typeof env.skyTint === 'string') this.env.skyTint = hexToLinear(env.skyTint).map((c) => Math.pow(c, 0.45));
    if (env.fogColor && typeof env.fogColor === 'string') this.env.fogColor = env.fogColor === 'auto' ? null : hexToLinear(env.fogColor);
    this.atmosphere.invalidate();
  }

  setGrade(grade) { Object.assign(this.grade, grade); }

  setScene(scene) {
    this.scene = scene;
    this.stats.instances = scene?.count ?? 0;
  }

  createScene() { return new GpuScene(this.device); }

  /** Register an extra effect (grass, water, particles, volumetrics...). */
  addFeature(feature) {
    this.features_ = this.features_ ?? [];
    this.features_.push(feature);
    feature.attach?.(this);
    if (this.internalW) feature.resize?.(this.internalW, this.internalH, this.outW, this.outH);
    this.#rebuildGlobals();
  }

  setVolumeView(view, enabled) { this.volumeView = view ?? this.dummyVolume.createView({ dimension: '3d' }); this.volumeEnabled = !!enabled; this.#rebuildGlobals(); }
  setAOView(view, enabled) { this.aoView = view ?? this.dummyAO.createView(); this.aoEnabled = !!enabled; this.#rebuildGlobals(); }

  #rebuildGlobals() {
    if (!this.heightmap) return;
    const d = this.device;
    const a = this.atmosphere;
    this.globalGroup = bindGroup(d, this.globalLayout, [
      this.frameBuffer, this.samplers.linear, this.samplers.repeat, this.samplers.shadow,
      a.transmittance.createView(), a.multiscatter.createView(), a.skyview.createView(), this.volumeView,
      a.envView, a.shBuffer, a.brdf.createView(), this.shadowArrayView, this.lightBuffer,
      this.heightmap.createView(), this.aoView,
    ], 'globals');
    this.shadowGlobalGroup = bindGroup(d, this.shadowGlobalLayout, [
      { binding: 0, resource: this.frameBuffer }, { binding: 13, resource: this.heightmap.createView() },
    ]);
  }

  // ------------------------------------------------------------------ sizing

  #resize() {
    const cw = Math.max(1, Math.floor((this.canvas.clientWidth || this.canvas.width) * this.pixelRatio));
    const ch = Math.max(1, Math.floor((this.canvas.clientHeight || this.canvas.height) * this.pixelRatio));
    let ow = cw, oh = ch;
    const maxPx = this.tier.maxOutputPixels;
    if (ow * oh > maxPx) { const s = Math.sqrt(maxPx / (ow * oh)); ow = Math.floor(ow * s); oh = Math.floor(oh * s); }
    const iw = Math.max(8, Math.round(ow * this.renderScale));
    const ih = Math.max(8, Math.round(oh * this.renderScale));
    if (ow !== this.outW || oh !== this.outH) {
      this.canvas.width = ow;
      this.canvas.height = oh;
      this.outW = ow; this.outH = oh;
      this.post.resize(ow, oh);
      this.internalW = 0; // force internal rebuild
    }
    if (iw !== this.internalW || ih !== this.internalH) {
      this.internalW = iw; this.internalH = ih;
      this.hdr?.destroy();
      this.depth?.destroy();
      this.hdr = texture2D(this.device, { width: iw, height: ih, format: 'rgba16float', usage: U.RT | U.TEX | U.CSRC, label: 'hdr' });
      this.depth = texture2D(this.device, { width: iw, height: ih, format: 'depth32float', usage: U.RT | U.TEX, label: 'depth' });
      this.hdrView = this.hdr.createView();
      this.depthView = this.depth.createView();
      this.post.setInputs(this.frameBuffer, this.hdrView, this.depthView);
      for (const f of this.features_ ?? []) f.resize?.(iw, ih, ow, oh);
    }
    this.stats.internal = [iw, ih];
    this.stats.output = [ow, oh];
  }

  /** Dynamic resolution: trade pixels for frame rate, reconstructed by TAA. */
  #adaptResolution(dt) {
    const ms = dt * 1000;
    this.frameMsAvg += (ms - this.frameMsAvg) * 0.05;
    this.stats.fps = 1000 / Math.max(this.frameMsAvg, 1);
    if (this.fixedScale !== null) return;
    this.scaleCooldown -= dt;
    if (this.scaleCooldown > 0) return;
    const [lo, hi] = this.tier.renderScale;
    const target = this.tier.targetMs;
    let next = this.renderScale;
    if (this.frameMsAvg > target * 1.12) next = Math.max(lo, this.renderScale - 0.05);
    else if (this.frameMsAvg < target * 0.75) next = Math.min(hi, this.renderScale + 0.05);
    if (Math.abs(next - this.renderScale) > 1e-3) {
      this.renderScale = next;
      this.scaleCooldown = 1.0;
      this.stats.scale = next;
    }
  }

  // ------------------------------------------------------------------ lighting helpers

  /** Sun rises ~5:30 and sets ~19:30; peaks at 12:30. */
  static sunDirection(timeOfDay, azimuthDeg) {
    const angle = ((timeOfDay - 5.5) / 14) * Math.PI;
    const elev = Math.sin(angle) * 62 * DEG;
    const az = azimuthDeg * DEG + ((timeOfDay - 12) / 12) * Math.PI;
    return [Math.cos(elev) * Math.sin(az), Math.sin(elev), Math.cos(elev) * Math.cos(az)];
  }

  #lighting() {
    const e = this.env;
    const sun = Renderer.sunDirection(e.timeOfDay, e.sunAzimuth);
    const sunElev = Math.asin(sun[1]) / DEG;
    // the moon rides opposite the sun in azimuth (keeps the sky LUT symmetric)
    const angle = ((e.timeOfDay - 5.5) / 14) * Math.PI + Math.PI;
    const moonElev = Math.max(Math.sin(angle), 0.18) * 55 * DEG;
    const h = Math.hypot(sun[0], sun[2]) || 1;
    const moon = [-(sun[0] / h) * Math.cos(moonElev), Math.sin(moonElev), -(sun[2] / h) * Math.cos(moonElev)];
    const night = smoothstep(-2, -10, sunElev);
    const cloudDim = 1 - e.cloudCover * 0.55;
    return {
      sun, moon, sunElev,
      sunE: 10 * cloudDim,
      moonE: 0.09 * night * cloudDim,
      keyIsMoon: sunElev < -4,
      stars: smoothstep(-2, -12, sunElev) * (1 - e.cloudCover * 0.8),
    };
  }

  // ------------------------------------------------------------------ frame

  #writeFrame(camera, cascades, L) {
    const f = this.frameData;
    const o = FRAME.offsets;
    const put = (name, values, extra = 0) => f.set(values, o[name] + extra);
    put('viewProj', this.viewProj);
    put('viewProjNJ', this.viewProjNJ);
    put('prevViewProj', this.prevViewProj ?? this.viewProjNJ);
    put('invViewProj', this.invViewProj);
    put('view', this.view);
    put('proj', this.proj);
    put('invProj', this.invProj);
    put('camPos', [...camera.position, camera.near]);
    put('camFwd', [...camera.forward, Math.tan(camera.fovY / 2)]);
    put('time', [this.time, this.dt, this.frameIndex, this.env.wind]);
    put('resolution', [this.internalW, this.internalH, 1 / this.internalW, 1 / this.internalH]);
    put('jitter', [this.jitter[0], this.jitter[1], this.prevJitter?.[0] ?? 0, this.prevJitter?.[1] ?? 0]);
    put('sunDir', [...L.sun, L.sunE]);
    put('moonDir', [...L.moon, L.moonE]);
    put('keyDir', [...(L.keyIsMoon ? L.moon : L.sun), L.keyIsMoon ? 1 : 0]);
    const altitudeKm = 0.2 + Math.max(0, camera.position[1]) * 0.001;
    put('atmos', [this.env.aerialScale, altitudeKm, this.env.cloudCover, L.stars]);
    put('skyTint', [...this.env.skyTint, this.env.groundAlbedo]);
    const fd = this.env.fogDensity;
    put('fog', [0.0004 + fd * fd * 0.045, 0.07, this.terrain.hasWater ? this.terrain.water : this.terrain.min, 0.55]);
    put('fogAlbedo', [...(this.env.fogColor ?? [0.9, 0.93, 1.0]), 0.6]);
    const wl = Math.hypot(...this.env.windDir) || 1;
    put('wind', [this.env.windDir[0] / wl, this.env.windDir[1] / wl, this.cloudOffset[0], this.cloudOffset[1]]);
    const t = this.terrain;
    put('terrain', [t.min, t.max, t.water, t.hasWater ? 1 : 0]);
    put('terrainGrid', t.grid);
    const p = this.palette ?? { low: [0.6, 0.55, 0.4], mid: [0.12, 0.25, 0.06], high: [0.9, 0.9, 0.95], cliff: [0.25, 0.2, 0.17] };
    put('palLow', [...p.low, 0]); put('palMid', [...p.mid, 0]); put('palHigh', [...p.high, 0]); put('palCliff', [...p.cliff, 0]);
    put('water', this.waterParams ?? [0.02, 0.1, 0.14, 0]);
    put('grass', this.grassParams ?? [0.2, 0.35, 0.08, 0]);
    put('player', this.player);
    cascades.forEach((c, i) => put('shadowMats', c.viewProj, i * 16));
    put('cascadeSplits', [0, 1, 2, 3].map((i) => cascades[i]?.split ?? 1e9));
    put('cascadeTexel', [0, 1, 2, 3].map((i) => cascades[i]?.texel ?? 1));
    put('shadowInfo', [cascades.length, this.tier.shadowSize, cascades.length ? 1 : 0, 2.4]);
    put('lightInfo', [this.lightCount ?? 0, this.aoEnabled ? 1 : 0, this.volumeEnabled ? 1 : 0, this.volumeDistance ?? 600]);
    put('volInfo', [...(this.froxelDims ?? [1, 1, 1]), 2.0]);
    this.device.queue.writeBuffer(this.frameBuffer, 0, f);
  }

  #packLights(camPos) {
    const max = this.tier.lights;
    const list = this.lights
      .map((l) => ({ l, d: Math.hypot(l.position[0] - camPos[0], l.position[1] - camPos[1], l.position[2] - camPos[2]) - l.radius }))
      .sort((a, b) => a.d - b.d)
      .slice(0, max);
    list.forEach(({ l }, i) => {
      this.lightData.set([l.position[0], l.position[1], l.position[2], l.radius, l.color[0], l.color[1], l.color[2], 0], i * LIGHT_FLOATS);
    });
    this.lightCount = list.length;
    if (list.length) this.device.queue.writeBuffer(this.lightBuffer, 0, this.lightData, 0, list.length * LIGHT_FLOATS);
  }

  /**
   * Render one frame.
   * camera: { position: [x,y,z], target: [x,y,z], fovY: radians, near }
   */
  render(camera, dt) {
    this.dt = Math.min(dt, 0.1);
    this.time += this.dt;
    this.#adaptResolution(dt);
    this.#resize();
    const d = this.device;

    // camera basis
    const fwd = norm(sub(camera.target, camera.position));
    const right = norm(cross(fwd, [0, 1, 0]));
    const up = cross(right, fwd);
    const cam = { ...camera, forward: fwd, right, up, aspect: this.internalW / this.internalH, near: camera.near ?? 0.1 };
    this.view ??= mat4.create(); this.proj ??= mat4.create(); this.viewProj ??= mat4.create();
    this.viewProjNJ ??= mat4.create(); this.invViewProj ??= mat4.create(); this.invProj ??= mat4.create();
    this.projNJ ??= mat4.create(); this.cullProj ??= mat4.create(); this.cullVP ??= mat4.create();
    this.cameraPlanes ??= new Float32Array(24);
    mat4.lookAt(this.view, cam.position, camera.target, [0, 1, 0]);
    mat4.perspectiveReversedInfinite(this.projNJ, cam.fovY, cam.aspect, cam.near);
    // sub-pixel jitter for temporal anti-aliasing
    this.prevJitter = this.jitter;
    const k = (this.frameIndex % 8) + 1;
    this.jitter = [((halton(k, 2) - 0.5) * 2) / this.internalW, ((halton(k, 3) - 0.5) * 2) / this.internalH];
    this.proj.set(this.projNJ);
    this.proj[8] -= this.jitter[0];
    this.proj[9] -= this.jitter[1];
    this.prevViewProj = this.viewProjNJ ? Float32Array.from(this.viewProjNJ) : null;
    if (this.frameIndex === 0) this.prevViewProj = null;
    mat4.multiply(this.viewProjNJ, this.projNJ, this.view);
    mat4.multiply(this.viewProj, this.proj, this.view);
    mat4.invert(this.invViewProj, this.viewProj);
    mat4.invert(this.invProj, this.proj);
    if (!this.prevViewProj) this.prevViewProj = Float32Array.from(this.viewProjNJ);
    // culling frustum: finite far plane from the tier's draw distance
    mat4.perspectiveZO(this.cullProj, cam.fovY, cam.aspect, cam.near, 2000 * this.tier.drawDistance);
    mat4.multiply(this.cullVP, this.cullProj, this.view);
    frustumPlanes(this.cameraPlanes, this.cullVP);

    const L = this.#lighting();
    this.cloudOffset[0] += this.env.windDir[0] * this.env.wind * this.dt * 0.004;
    this.cloudOffset[1] += this.env.windDir[1] * this.env.wind * this.dt * 0.004;
    const keyDir = L.keyIsMoon ? L.moon : L.sun;
    const shadowsOn = keyDir[1] > 0.02;
    this.cascades = shadowsOn ? computeCascades(cam, keyDir, this.tier.cascades, this.tier.shadowDistance, this.tier.shadowSize, this.cascades) : [];
    this.#packLights(cam.position);
    this.#writeFrame(cam, this.cascades, L);
    this.camera = cam;
    if (this.lastSun === undefined || Math.abs(this.lastSun - L.sun[1]) > 0.002 || this.lastCloud !== this.env.cloudCover) {
      this.atmosphere.invalidate();
      this.lastSun = L.sun[1];
      this.lastCloud = this.env.cloudCover;
    }

    const encoder = d.createCommandEncoder({ label: 'frame' });
    this.atmosphere.update(encoder, this.dt);
    for (const f of this.features_ ?? []) f.update?.(encoder, this);

    const scene = this.scene;
    if (scene?.built) {
      scene.lodScale = this.tier.drawDistance;
      scene.upload();
      const views = [{ planes: this.cameraPlanes, planeCount: 6, lodPos: cam.position, shadow: false }];
      for (const c of this.cascades) views.push({ planes: c.planes, planeCount: 4, lodPos: cam.position, shadow: true });
      scene.cull(encoder, views);
    }

    // shadow cascades
    this.cascades.forEach((c, i) => d.queue.writeBuffer(this.cascadeBuffer, i * 256, c.viewProj));
    this.cascades.forEach((c, i) => {
      const pass = encoder.beginRenderPass({
        label: `shadow-${i}`,
        colorAttachments: [],
        depthStencilAttachment: { view: this.shadowLayerViews[i], depthClearValue: 1, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      if (scene?.built) {
        pass.setPipeline(this.pipes.shadow);
        pass.setBindGroup(0, this.shadowGlobalGroup);
        pass.setBindGroup(2, this.cascadeGroup, [i * 256]);
        scene.draw(pass, i + 1);
      }
      for (const f of this.features_ ?? []) f.shadow?.(pass, this, i);
      pass.end();
    });

    for (const f of this.features_ ?? []) f.compute?.(encoder, this);

    // optional depth prepass (enables GTAO and removes overdraw)
    const prepass = this.aoEnabled && scene?.built;
    if (prepass) {
      const pass = encoder.beginRenderPass({
        label: 'prepass', colorAttachments: [],
        depthStencilAttachment: { view: this.depthView, depthClearValue: 0, depthLoadOp: 'clear', depthStoreOp: 'store' },
      });
      pass.setPipeline(this.pipes.prepass);
      pass.setBindGroup(0, this.globalGroup);
      scene.draw(pass, 0);
      pass.end();
      for (const f of this.features_ ?? []) f.afterPrepass?.(encoder, this);
    }

    const main = encoder.beginRenderPass({
      label: 'main',
      colorAttachments: [{ view: this.hdrView, loadOp: 'clear', storeOp: 'store', clearValue: { r: 0, g: 0, b: 0, a: 1 } }],
      depthStencilAttachment: { view: this.depthView, depthClearValue: 0, depthLoadOp: prepass ? 'load' : 'clear', depthStoreOp: 'store' },
    });
    main.setBindGroup(0, this.globalGroup);
    if (scene?.built) {
      main.setPipeline(prepass ? this.pipes.meshAfterPrepass : this.pipes.mesh);
      scene.draw(main, 0);
    }
    for (const f of this.features_ ?? []) f.main?.(main, this);
    main.setPipeline(this.pipes.sky);
    main.setBindGroup(0, this.globalGroup);
    main.draw(3);
    main.end();

    for (const f of this.features_ ?? []) f.afterMain?.(encoder, this);

    this.post.setGrade(this.grade, this.flash);
    const night = smoothstep(-2, -10, L.sunElev);
    this.post.run(encoder, this.context.getCurrentTexture().createView(), this.dt, {
      feedback: 0.9,
      minEV: -3.2 - night * 2.0,
      maxEV: 4,
    });
    d.queue.submit([encoder.finish()]);
    this.frameIndex++;
  }
}

function sub(a, b) { return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]; }
function cross(a, b) { return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]; }
function norm(a) { const l = Math.hypot(a[0], a[1], a[2]) || 1; return [a[0] / l, a[1] / l, a[2] / l]; }
export { clamp };

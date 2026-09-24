// GPU-driven instancing.
//
// Every visible thing except the terrain heightfield, grass, water and
// particles is an instance in one global storage buffer. Each frame a compute
// shader culls all instances against every view (camera + shadow cascades),
// including distance-based LOD selection, and writes compact visible lists and
// indirect draw arguments. The CPU issues one indirect draw per batch per view
// no matter how many thousands of objects exist, so the CPU cost stays flat on
// weak mobile CPUs.

import { bindLayout, bindGroup, createBuffer, createShader } from '../gpu/gpu.js';

export const INSTANCE_FLOATS = 32; // model(16) color+metal(4) emissive+rough(4) params(4) bounds(4)
const INSTANCE_BYTES = INSTANCE_FLOATS * 4;
const DRAW_STRIDE = 256;
export const MAX_VIEWS = 5;

export const KIND = { standard: 0, terrain: 1, foliage: 3 };

export const INSTANCE_WGSL = /* wgsl */ `
struct Instance { model: mat4x4f, color: vec4f, emissive: vec4f, params: vec4f, bounds: vec4f };
struct DrawInfo { base: u32, p0: u32, p1: u32, p2: u32 };
@group(1) @binding(0) var<storage, read> instances: array<Instance>;
@group(1) @binding(1) var<storage, read> visible: array<u32>;
@group(1) @binding(2) var<uniform> drawInfo: DrawInfo;
`;

const CULL_CS = /* wgsl */ `
struct Instance { model: mat4x4f, color: vec4f, emissive: vec4f, params: vec4f, bounds: vec4f };
struct Batch { base: u32, minDist: f32, maxDist: f32, flags: u32 };
struct View { planes: array<vec4f, 6>, lodPos: vec4f, counts: vec4u };
@group(0) @binding(0) var<uniform> view: View;
@group(0) @binding(1) var<storage, read> instances: array<Instance>;
@group(0) @binding(2) var<storage, read> batches: array<Batch>;
@group(0) @binding(3) var<storage, read_write> indirect: array<atomic<u32>>;
@group(0) @binding(4) var<storage, read_write> visibleOut: array<u32>;

@compute @workgroup_size(64)
fn main(@builtin(global_invocation_id) id: vec3u) {
  let i = id.x;
  if (i >= view.counts.x) { return; }
  let inst = instances[i];
  let r = inst.bounds.w;
  if (r <= 0.0) { return; }
  let b = u32(inst.params.w);
  let batch = batches[b];
  let isShadow = view.counts.y == 1u;
  if (isShadow && (batch.flags & 1u) == 0u) { return; }
  let c = inst.bounds.xyz;
  let d = distance(c, view.lodPos.xyz) * view.lodPos.w;
  if (d < batch.minDist || d >= batch.maxDist) { return; }
  for (var p = 0u; p < view.counts.z; p++) {
    let pl = view.planes[p];
    if (dot(pl.xyz, c) + pl.w < -r) { return; }
  }
  let slot = atomicAdd(&indirect[b * 5u + 1u], 1u);
  visibleOut[batch.base + slot] = i;
}
`;

export class GpuScene {
  constructor(device) {
    this.device = device;
    this.meshes = new Map();
    this.batches = [];
    this.count = 0;
    this.capacity = 1024;
    this.data = new Float32Array(this.capacity * INSTANCE_FLOATS);
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
    this.built = false;
    this.lodScale = 1;
  }

  /** Register a mesh from Geo.finish() output. */
  addMesh(key, geo) {
    if (this.meshes.has(key)) return this.meshes.get(key);
    const d = this.device;
    const vb = createBuffer(d, geo.vertices.byteLength, GPUBufferUsage.VERTEX | GPUBufferUsage.COPY_DST, `vb:${key}`);
    d.queue.writeBuffer(vb, 0, geo.vertices);
    const indexData = geo.indices.length % 2 && geo.indices instanceof Uint16Array ? new Uint16Array([...geo.indices, 0]) : geo.indices;
    const ib = createBuffer(d, indexData.byteLength, GPUBufferUsage.INDEX | GPUBufferUsage.COPY_DST, `ib:${key}`);
    d.queue.writeBuffer(ib, 0, indexData);
    const mesh = { key, vb, ib, indexCount: geo.indices.length, indexFormat: geo.indices instanceof Uint32Array ? 'uint32' : 'uint16', radius: geo.radius };
    this.meshes.set(key, mesh);
    return mesh;
  }

  hasMesh(key) { return this.meshes.has(key); }

  /**
   * A batch = one mesh drawn with one indirect call per view.
   * minDist/maxDist select LODs (a mesh can have several batches with
   * disjoint ranges); shadows toggles shadow casting.
   */
  addBatch(meshKey, { minDist = 0, maxDist = 1e9, shadows = true, alpha = false, label = meshKey } = {}) {
    if (this.built) throw new Error('Scene already built');
    const mesh = this.meshes.get(meshKey);
    if (!mesh) throw new Error(`Unknown mesh ${meshKey}`);
    const id = this.batches.length;
    this.batches.push({ id, mesh, minDist, maxDist, shadows, alpha, label, count: 0 });
    return id;
  }

  #grow(n) {
    if (n <= this.capacity) return;
    while (this.capacity < n) this.capacity *= 2;
    const next = new Float32Array(this.capacity * INSTANCE_FLOATS);
    next.set(this.data);
    this.data = next;
  }

  /** Add an instance; returns its index. Write its transform/material with setInstance. */
  addInstance(batchId) {
    if (this.built) throw new Error('Scene already built');
    const i = this.count++;
    this.#grow(this.count);
    this.batches[batchId].count++;
    this.data[i * INSTANCE_FLOATS + 27] = batchId;
    return i;
  }

  /** Float view of one instance's 32 floats (model at 0, color 16, emissive 20, params 24, bounds 28). */
  instance(i) { return this.data.subarray(i * INSTANCE_FLOATS, (i + 1) * INSTANCE_FLOATS); }

  markDirty(i) {
    if (i < this.dirtyMin) this.dirtyMin = i;
    if (i > this.dirtyMax) this.dirtyMax = i;
  }

  /** Recompute the world bounding sphere from the model matrix and mesh radius. */
  updateBounds(i, extra = 0) {
    const o = i * INSTANCE_FLOATS;
    const m = this.data;
    const batch = this.batches[m[o + 27]];
    const s = Math.max(Math.hypot(m[o], m[o + 1], m[o + 2]), Math.hypot(m[o + 4], m[o + 5], m[o + 6]), Math.hypot(m[o + 8], m[o + 9], m[o + 10]));
    m[o + 28] = m[o + 12]; m[o + 29] = m[o + 13]; m[o + 30] = m[o + 14];
    m[o + 31] = batch.mesh.radius * s + extra;
  }

  setVisible(i, visible) {
    const o = i * INSTANCE_FLOATS + 31;
    const r = Math.abs(this.data[o]) || 1e-3;
    this.data[o] = visible ? r : -r;
    this.markDirty(i);
  }

  build() {
    const d = this.device;
    this.built = true;
    this.markDirty(0);
    this.markDirty(Math.max(0, this.count - 1));
    const n = Math.max(1, this.count);
    this.instanceBuffer = createBuffer(d, n * INSTANCE_BYTES, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'instances');

    let base = 0;
    const batchData = new ArrayBuffer(Math.max(1, this.batches.length) * 16);
    const bu = new Uint32Array(batchData), bf = new Float32Array(batchData);
    const indirectTemplate = new Uint32Array(Math.max(1, this.batches.length) * 5);
    for (const b of this.batches) {
      b.base = base;
      base += b.count;
      bu[b.id * 4] = b.base;
      bf[b.id * 4 + 1] = b.minDist;
      bf[b.id * 4 + 2] = b.maxDist;
      bu[b.id * 4 + 3] = b.shadows ? 1 : 0;
      indirectTemplate.set([b.mesh.indexCount, 0, 0, 0, 0], b.id * 5);
    }
    this.batchBuffer = createBuffer(d, batchData.byteLength, GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, 'batches');
    d.queue.writeBuffer(this.batchBuffer, 0, batchData);
    this.indirectTemplate = createBuffer(d, indirectTemplate.byteLength, GPUBufferUsage.COPY_SRC | GPUBufferUsage.COPY_DST, 'indirect-template');
    d.queue.writeBuffer(this.indirectTemplate, 0, indirectTemplate);

    const drawData = new Uint32Array(Math.max(1, this.batches.length) * (DRAW_STRIDE / 4));
    for (const b of this.batches) drawData[b.id * (DRAW_STRIDE / 4)] = b.base;
    this.drawBuffer = createBuffer(d, drawData.byteLength, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'draw-info');
    d.queue.writeBuffer(this.drawBuffer, 0, drawData);

    this.cullPipeline = d.createComputePipeline({
      label: 'cull',
      layout: 'auto',
      compute: { module: createShader(d, CULL_CS, 'cull'), entryPoint: 'main' },
    });
    this.drawLayout = GpuScene.drawLayout(d);
    this.views = [];
    for (let v = 0; v < MAX_VIEWS; v++) {
      const indirect = createBuffer(d, indirectTemplate.byteLength, GPUBufferUsage.INDIRECT | GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST, `indirect-${v}`);
      const visibleBuf = createBuffer(d, n * 4, GPUBufferUsage.STORAGE, `visible-${v}`);
      const uniform = createBuffer(d, 128, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, `cull-view-${v}`);
      const cullGroup = bindGroup(d, this.cullPipeline.getBindGroupLayout(0), [uniform, this.instanceBuffer, this.batchBuffer, indirect, visibleBuf]);
      const drawGroup = bindGroup(d, this.drawLayout, [this.instanceBuffer, visibleBuf, { buffer: this.drawBuffer, size: 16 }]);
      this.views.push({ indirect, visible: visibleBuf, uniform, cullGroup, drawGroup, data: new ArrayBuffer(128) });
    }
    return this;
  }

  static drawLayout(device) {
    return bindLayout(device, 'instances', [['V', 'read'], ['V', 'read'], ['V', 'uniform-dyn']]);
  }

  /** Upload changed instance data. */
  upload() {
    if (this.dirtyMax < this.dirtyMin || !this.count) return;
    const start = this.dirtyMin * INSTANCE_FLOATS;
    const end = (this.dirtyMax + 1) * INSTANCE_FLOATS;
    this.device.queue.writeBuffer(this.instanceBuffer, start * 4, this.data, start, end - start);
    this.dirtyMin = Infinity;
    this.dirtyMax = -1;
  }

  /**
   * Cull all instances for a list of views:
   * { planes: Float32Array(24), planeCount, lodPos: [x,y,z], shadow: bool }
   */
  cull(encoder, views) {
    if (!this.count) return;
    const q = this.device.queue;
    views.forEach((v, idx) => {
      const view = this.views[idx];
      const f = new Float32Array(view.data);
      const u = new Uint32Array(view.data);
      f.set(v.planes.subarray(0, 24), 0);
      f[24] = v.lodPos[0]; f[25] = v.lodPos[1]; f[26] = v.lodPos[2]; f[27] = 1 / this.lodScale;
      u[28] = this.count; u[29] = v.shadow ? 1 : 0; u[30] = v.planeCount ?? 6; u[31] = 0;
      q.writeBuffer(view.uniform, 0, view.data);
      encoder.copyBufferToBuffer(this.indirectTemplate, 0, view.indirect, 0, this.indirectTemplate.size);
    });
    const pass = encoder.beginComputePass({ label: 'cull' });
    pass.setPipeline(this.cullPipeline);
    views.forEach((_, idx) => {
      pass.setBindGroup(0, this.views[idx].cullGroup);
      pass.dispatchWorkgroups(Math.ceil(this.count / 64));
    });
    pass.end();
  }

  /** Issue one indirect draw per batch for a view. The pipeline and group 0 must already be set. */
  draw(pass, viewIndex, filter = null) {
    const view = this.views[viewIndex];
    for (const b of this.batches) {
      if (!b.count || (filter && !filter(b))) continue;
      pass.setBindGroup(1, view.drawGroup, [b.id * DRAW_STRIDE]);
      pass.setVertexBuffer(0, b.mesh.vb);
      pass.setIndexBuffer(b.mesh.ib, b.mesh.indexFormat);
      pass.drawIndexedIndirect(view.indirect, b.id * 20);
    }
  }

  destroy() {
    for (const m of this.meshes.values()) { m.vb.destroy(); m.ib.destroy(); }
    for (const v of this.views ?? []) { v.indirect.destroy(); v.visible.destroy(); v.uniform.destroy(); }
    this.instanceBuffer?.destroy();
    this.batchBuffer?.destroy();
    this.drawBuffer?.destroy();
    this.indirectTemplate?.destroy();
  }
}

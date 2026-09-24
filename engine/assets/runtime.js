import { ProgressiveAssetManager } from './manager.js';
import { loadGLB } from './gltf.js';

/**
 * Bridges cloud manifests to a live GpuScene. A request may be bound to one
 * or more existing procedural batches; when the GLB is ready those batches
 * switch mesh in place, preserving instance indices, physics and behaviours.
 */
export class AssetRuntime extends EventTarget {
  constructor(scene, options = {}) {
    super();
    this.scene = scene;
    this.bindings = new Map();
    this.manager = new ProgressiveAssetManager(options);
    this.manager.addEventListener('upgrade', (e) => this.#install(e.detail).catch((error) =>
      this.dispatchEvent(new CustomEvent('error', { detail: { ...e.detail, error } }))));
  }

  resolve(request, fallback, { batchId = null } = {}) {
    if (batchId !== null) {
      const set = this.bindings.get(request.key) ?? new Set();
      set.add(batchId);
      this.bindings.set(request.key, set);
    }
    return this.manager.resolve(request, fallback);
  }

  async #install({ request, manifest }) {
    if (manifest?.format !== 'glb' || !manifest.url) return;
    const geo = await loadGLB(manifest.url);
    const key = `asset:${request.key}`;
    if (!this.scene.hasMesh(key)) this.scene.addMesh(key, geo);
    let swaps = 0;
    for (const batchId of this.bindings.get(request.key) ?? []) {
      if (this.scene.replaceBatchMesh(batchId, key)) swaps++;
    }
    this.dispatchEvent(new CustomEvent('ready', { detail: { request, manifest, meshKey: key, swaps } }));
  }
}

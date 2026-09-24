import { ProgressiveAssetManager } from './manager.js';
import { loadGLB } from './gltf.js';

/**
 * Bridges cloud manifests to a live GpuScene.
 * Existing procedural meshes remain valid until an enhanced mesh is decoded.
 */
export class AssetRuntime extends EventTarget {
  constructor(scene, options = {}) {
    super();
    this.scene = scene;
    this.manager = new ProgressiveAssetManager(options);
    this.manager.addEventListener('upgrade', (e) => this.#install(e.detail).catch((error) =>
      this.dispatchEvent(new CustomEvent('error', { detail: { ...e.detail, error } }))));
  }

  resolve(request, fallback) { return this.manager.resolve(request, fallback); }

  async #install({ request, manifest }) {
    if (manifest?.format !== 'glb' || !manifest.url) return;
    const geo = await loadGLB(manifest.url);
    const key = `asset:${request.key}`;
    if (!this.scene.hasMesh(key)) this.scene.addMesh(key, geo);
    this.dispatchEvent(new CustomEvent('ready', { detail: { request, manifest, meshKey: key } }));
  }
}

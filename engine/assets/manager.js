import { qualityBudget } from '../../shared/assets.js';
import { AssetCache } from './cache.js';
import { normalizeQualityTier } from './quality.js';

const DEFAULT_MAX_BYTES = 512 * 1024 * 1024;

/**
 * ProgressiveAssetManager keeps generation out of the rendering hot path.
 * resolve() returns a procedural fallback immediately and upgrades in the
 * background when a cached/CDN/generated asset exists.
 */
export class ProgressiveAssetManager extends EventTarget {
  constructor({ endpoint = '/api/assets', quality = null, maxCacheBytes = DEFAULT_MAX_BYTES } = {}) {
    super();
    this.endpoint = endpoint;
    this.quality = normalizeQualityTier(quality);
    this.budget = qualityBudget(quality);
    this.maxCacheBytes = maxCacheBytes;
    this.memory = new Map();
    this.pending = new Map();
    this.persistent = new AssetCache({ maxBytes: Math.max(maxCacheBytes, this.budget.memoryMB * 1024 * 1024) });
  }

  resolve(request, fallback) {
    const cached = this.memory.get(request.key);
    if (cached) {
      cached.lastUsed = performance.now();
      return cached.value;
    }
    this.#upgrade(request).catch(() => {});
    return fallback;
  }

  async #upgrade(request) {
    if (this.pending.has(request.key)) return this.pending.get(request.key);
    const job = (async () => {
      const disk = await this.persistent.get(request.key);
      if (disk) {
        this.#remember(request.key, disk, Number(disk.bytes) || 0);
        this.dispatchEvent(new CustomEvent('upgrade', { detail: { request, manifest: disk, source: 'cache' } }));
        return disk;
      }
      const url = `${this.endpoint}/${encodeURIComponent(request.key)}?quality=${this.quality}`;
      const res = await fetch(url, {
        headers: { 'x-reverie-asset': btoa(unescape(encodeURIComponent(JSON.stringify(request)))) },
      });
      if (res.status === 404 || res.status === 204) return null;
      if (!res.ok) throw new Error(`asset service ${res.status}`);
      const manifest = await res.json();
      this.#remember(request.key, manifest, Number(manifest.bytes) || 0);
      await this.persistent.put(request.key, manifest, Number(manifest.bytes) || 0);
      this.dispatchEvent(new CustomEvent('upgrade', { detail: { request, manifest } }));
      return manifest;
    })().finally(() => this.pending.delete(request.key));
    this.pending.set(request.key, job);
    return job;
  }

  #remember(key, value, bytes) {
    this.memory.set(key, { value, bytes, lastUsed: performance.now() });
    let total = [...this.memory.values()].reduce((n, x) => n + x.bytes, 0);
    if (total <= this.maxCacheBytes) return;
    const oldest = [...this.memory.entries()].sort((a, b) => a[1].lastUsed - b[1].lastUsed);
    for (const [k, entry] of oldest) {
      this.memory.delete(k);
      total -= entry.bytes;
      if (total <= this.maxCacheBytes) break;
    }
  }
}

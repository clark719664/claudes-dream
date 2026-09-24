// Cloud asset-service boundary.
//
// Production providers can generate an asset, optimize it to GLB/KTX2/Opus,
// upload immutable outputs to object storage/CDN, then store the manifest.
// This module intentionally has no GPU-provider dependency: Reverie remains
// free to self-host and the browser never requires an AI-capable GPU.

const manifests = new Map();
const jobs = new Map();

export function getAssetManifest(key) {
  return manifests.get(key) ?? null;
}

export function putAssetManifest(key, manifest) {
  manifests.set(key, Object.freeze({ ...manifest, key }));
  jobs.delete(key);
  return manifests.get(key);
}

export function requestAssetJob(key, request, quality = 'medium') {
  if (manifests.has(key)) return { status: 'ready', manifest: manifests.get(key) };
  if (!jobs.has(key)) jobs.set(key, {
    key, request, quality, status: 'queued', createdAt: Date.now(),
  });
  return jobs.get(key);
}

export function listAssetJobs() {
  return [...jobs.values()];
}

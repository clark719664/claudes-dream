// Reverie progressive asset contract.
// The browser always has a procedural fallback. Enhanced assets are optional
// and may arrive later from a local cache, CDN, or generation service.

export const ASSET_VERSION = 1;
export const ASSET_KINDS = ['mesh', 'material', 'texture', 'audio', 'sky', 'foliage'];
export const ASSET_SOURCES = ['procedural', 'cache', 'cdn', 'generated'];
export const QUALITY_TIERS = ['low', 'medium', 'high', 'ultra'];

export function semanticAssetKey(request = {}) {
  const { fallback: _fallback, key: _key, ...identity } = request;
  const stable = JSON.stringify(sortObject(identity));
  let h = 2166136261;
  for (let i = 0; i < stable.length; i++) {
    h ^= stable.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return `rv1-${(h >>> 0).toString(36)}`;
}

function sortObject(value) {
  if (Array.isArray(value)) return value.map(sortObject);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map((k) => [k, sortObject(value[k])]));
}

export function assetRequest({
  kind = 'mesh', archetype = 'prop', description = '', style = {},
  seed = 1, importance = 0.5, fallback = null,
} = {}) {
  const request = {
    version: ASSET_VERSION,
    kind: ASSET_KINDS.includes(kind) ? kind : 'mesh',
    archetype: String(archetype).slice(0, 48),
    description: String(description).slice(0, 500),
    style,
    seed: Number.isFinite(seed) ? Math.trunc(seed) : 1,
    importance: Math.max(0, Math.min(1, Number(importance) || 0)),
    fallback,
  };
  return { ...request, key: semanticAssetKey(request) };
}

export function qualityBudget(tier = 'medium') {
  const table = {
    low:    { texture: 512,  triangles: 8000,   generatedAssets: 8,  memoryMB: 192 },
    medium: { texture: 1024, triangles: 24000,  generatedAssets: 16, memoryMB: 384 },
    high:   { texture: 2048, triangles: 60000,  generatedAssets: 28, memoryMB: 768 },
    ultra:  { texture: 4096, triangles: 120000, generatedAssets: 40, memoryMB: 1536 },
  };
  return table[QUALITY_TIERS.includes(tier) ? tier : 'medium'];
}

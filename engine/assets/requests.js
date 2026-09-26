// Turns semantic prefab visuals into provider-neutral enhancement requests.
// Kept separate from world construction so a generation outage can never block play.

import { assetRequest } from '../../shared/assets.js';

export function prefabAssetRequest(prefab, seed = 1) {
  const v = prefab?.visual;
  if (!v?.description || v.archetype === 'primitive') return null;
  return assetRequest({
    kind: 'mesh',
    archetype: v.archetype,
    description: v.description,
    style: {
      surface: v.surface,
      color: prefab.color,
      metallic: prefab.metallic,
      roughness: prefab.roughness,
      variation: v.variation,
    },
    seed: seed + stableIdNumber(String(prefab.id ?? '')),
    importance: v.detail,
    fallback: { shape: prefab.shape, size: prefab.size },
  });
}

export function collectAssetRequests(spec) {
  return (spec?.prefabs ?? []).map((p) => prefabAssetRequest(p, spec.seed)).filter(Boolean);
}

function stableIdNumber(value) {
  let h = 0;
  for (let i = 0; i < value.length; i++) h = (Math.imul(h, 31) + value.charCodeAt(i)) >>> 0;
  return h;
}

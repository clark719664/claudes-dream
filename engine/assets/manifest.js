export function normalizeAssetManifest(input, expectedKey = '') {
  if (!input || typeof input !== 'object') throw new Error('Invalid asset manifest');
  if (input.key && expectedKey && input.key !== expectedKey) throw new Error('Asset manifest key mismatch');
  if (input.format !== 'glb') throw new Error('Unsupported asset format');
  const material = input.material && typeof input.material === 'object' ? {
    baseColorFactor: vec(input.material.baseColorFactor, [1,1,1,1], 4, 0, 1),
    metallicFactor: num(input.material.metallicFactor, 1, 0, 1),
    roughnessFactor: num(input.material.roughnessFactor, 1, .02, 1),
    emissiveFactor: vec(input.material.emissiveFactor, [0,0,0], 3, 0, 32),
    normalScale: num(input.material.normalScale, 1, 0, 4),
    occlusionStrength: num(input.material.occlusionStrength, 1, 0, 1),
    textures: cleanTextures(input.material.textures),
  } : null;
  return {
    key: expectedKey || String(input.key || ''),
    version: 1, kind: 'mesh', format: 'glb',
    url: String(input.url || '').slice(0, 2048),
    bytes: Math.trunc(num(input.bytes, 0, 0, 512 * 1024 * 1024)),
    material,
  };
}
function cleanTextures(value) {
  const allowed = ['baseColor','normal','metallicRoughness','emissive','occlusion'];
  const out = {};
  if (!value || typeof value !== 'object') return out;
  for (const k of allowed) if (typeof value[k] === 'string') out[k] = value[k].slice(0,2048);
  return out;
}
function num(v,d,lo,hi){v=Number(v);return Number.isFinite(v)?Math.min(hi,Math.max(lo,v)):d;}
function vec(v,d,n,lo,hi){return Array.from({length:n},(_,i)=>num(Array.isArray(v)?v[i]:undefined,d[i],lo,hi));}

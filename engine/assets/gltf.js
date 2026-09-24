// Minimal dependency-free glTF 2.0/GLB geometry loader for Reverie.
// Converts the first triangle primitive into the engine's packed Geo format.
// Materials/textures remain manifest metadata for the next renderer stage.

import { Geo } from '../render/meshes.js';

const COMPONENT = {
  5121: { bytes: 1, ctor: Uint8Array },
  5123: { bytes: 2, ctor: Uint16Array },
  5125: { bytes: 4, ctor: Uint32Array },
  5126: { bytes: 4, ctor: Float32Array },
};
const WIDTH = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };

export async function loadGLB(url, { signal } = {}) {
  const res = await fetch(url, { signal });
  if (!res.ok) throw new Error(`GLB fetch failed: ${res.status}`);
  return parseGLB(await res.arrayBuffer());
}

export function parseGLB(buffer) {
  const dv = new DataView(buffer);
  if (dv.byteLength < 20 || dv.getUint32(0, true) !== 0x46546c67) throw new Error('Not a GLB file');
  if (dv.getUint32(4, true) !== 2) throw new Error('Only glTF 2.0 is supported');
  let p = 12, json = null, bin = null;
  while (p + 8 <= dv.byteLength) {
    const len = dv.getUint32(p, true), type = dv.getUint32(p + 4, true); p += 8;
    const chunk = buffer.slice(p, p + len); p += len;
    if (type === 0x4e4f534a) json = JSON.parse(new TextDecoder().decode(chunk).replace(/\0+$/g, ''));
    if (type === 0x004e4942) bin = chunk;
  }
  if (!json || !bin) throw new Error('GLB must contain JSON and BIN chunks');
  return gltfToGeo(json, bin);
}

export function gltfToGeo(gltf, bin) {
  const primitive = gltf.meshes?.flatMap((m) => m.primitives ?? []).find((p) => (p.mode ?? 4) === 4);
  if (!primitive || primitive.attributes?.POSITION === undefined) throw new Error('GLB has no triangle POSITION primitive');
  const pos = accessor(gltf, bin, primitive.attributes.POSITION);
  const normal = primitive.attributes.NORMAL === undefined ? null : accessor(gltf, bin, primitive.attributes.NORMAL);
  const uv = primitive.attributes.TEXCOORD_0 === undefined ? null : accessor(gltf, bin, primitive.attributes.TEXCOORD_0);
  const idx = primitive.indices === undefined ? null : accessor(gltf, bin, primitive.indices);
  const g = new Geo();
  const count = pos.length / 3;
  for (let i = 0; i < count; i++) {
    g.vertex(pos[i*3], pos[i*3+1], pos[i*3+2],
      normal?.[i*3] ?? 0, normal?.[i*3+1] ?? 1, normal?.[i*3+2] ?? 0,
      undefined, uv?.[i*2] ?? 0, uv?.[i*2+1] ?? 0);
  }
  if (idx) for (const i of idx) g.indices.push(i);
  else for (let i = 0; i < count; i++) g.indices.push(i);
  if (!normal) recomputeNormals(g);
  return g.finish();
}

function accessor(gltf, bin, id) {
  const a = gltf.accessors[id], v = gltf.bufferViews[a.bufferView];
  if (!a || !v) throw new Error('Sparse/external glTF accessors are not supported yet');
  const c = COMPONENT[a.componentType], width = WIDTH[a.type];
  if (!c || !width) throw new Error('Unsupported glTF accessor format');
  const stride = v.byteStride ?? c.bytes * width;
  const start = (v.byteOffset ?? 0) + (a.byteOffset ?? 0);
  const packed = stride === c.bytes * width;
  if (packed && start % c.bytes === 0) return new c.ctor(bin, start, a.count * width);
  const out = new c.ctor(a.count * width), dv = new DataView(bin);
  const read = c.ctor === Float32Array ? 'getFloat32' : c.bytes === 4 ? 'getUint32' : c.bytes === 2 ? 'getUint16' : 'getUint8';
  for (let i=0;i<a.count;i++) for(let k=0;k<width;k++) out[i*width+k]=dv[read](start+i*stride+k*c.bytes,true);
  return out;
}

function recomputeNormals(g) {
  const n = new Float32Array(g.positions.length);
  for (let t=0;t<g.indices.length;t+=3) {
    const ia=g.indices[t]*3, ib=g.indices[t+1]*3, ic=g.indices[t+2]*3;
    const ax=g.positions[ib]-g.positions[ia], ay=g.positions[ib+1]-g.positions[ia+1], az=g.positions[ib+2]-g.positions[ia+2];
    const bx=g.positions[ic]-g.positions[ia], by=g.positions[ic+1]-g.positions[ia+1], bz=g.positions[ic+2]-g.positions[ia+2];
    const x=ay*bz-az*by, y=az*bx-ax*bz, z=ax*by-ay*bx;
    for(const i of [ia,ib,ic]) { n[i]+=x; n[i+1]+=y; n[i+2]+=z; }
  }
  for(let i=0;i<n.length;i+=3){const l=Math.hypot(n[i],n[i+1],n[i+2])||1;g.normals[i]=n[i]/l;g.normals[i+1]=n[i+1]/l;g.normals[i+2]=n[i+2]/l;}
}

// Cascaded shadow maps with stable, texel-snapped cascades.
import { mat4, frustumPlanes } from '../core/math.js';

const tmpView = mat4.create();
const tmpProj = mat4.create();
const ORIGIN = [0, 0, 0];

/**
 * Compute cascade matrices for a camera.
 * camera: { position, forward, right, up, fovY, aspect, near }
 * Returns [{ viewProj, planes, split, texel }]
 */
export function computeCascades(camera, lightDir, count, maxDistance, mapSize, out = []) {
  const near = camera.near;
  const lambda = 0.72;
  const splits = [];
  for (let i = 1; i <= count; i++) {
    const t = i / count;
    const log = near * Math.pow(maxDistance / near, t);
    const uni = near + (maxDistance - near) * t;
    splits.push(lambda * log + (1 - lambda) * uni);
  }
  const tanY = Math.tan(camera.fovY / 2);
  const tanX = tanY * camera.aspect;
  const [px, py, pz] = camera.position;
  const f = camera.forward, r = camera.right, u = camera.up;
  const up = Math.abs(lightDir[1]) > 0.99 ? [1, 0, 0] : [0, 1, 0];

  let prev = near;
  for (let c = 0; c < count; c++) {
    const n = prev, fa = splits[c];
    prev = fa;
    // bounding sphere of the frustum slice (rotation invariant => no shimmering)
    const corners = [];
    for (const d of [n, fa]) {
      for (const sx of [-1, 1]) for (const sy of [-1, 1]) {
        corners.push([
          px + f[0] * d + r[0] * sx * tanX * d + u[0] * sy * tanY * d,
          py + f[1] * d + r[1] * sx * tanX * d + u[1] * sy * tanY * d,
          pz + f[2] * d + r[2] * sx * tanX * d + u[2] * sy * tanY * d,
        ]);
      }
    }
    const center = [0, 0, 0];
    for (const p of corners) { center[0] += p[0] / 8; center[1] += p[1] / 8; center[2] += p[2] / 8; }
    let radius = 0;
    for (const p of corners) radius = Math.max(radius, Math.hypot(p[0] - center[0], p[1] - center[1], p[2] - center[2]));
    radius = Math.ceil(radius * 4) / 4;

    const back = radius + 250;
    // light view anchored at the world origin so snapping in light space is stable
    mat4.lookAt(tmpView, lightDir, ORIGIN, up);
    const texel = (2 * radius) / mapSize;
    const cx = tmpView[0] * center[0] + tmpView[4] * center[1] + tmpView[8] * center[2] + tmpView[12];
    const cy = tmpView[1] * center[0] + tmpView[5] * center[1] + tmpView[9] * center[2] + tmpView[13];
    const cz = tmpView[2] * center[0] + tmpView[6] * center[1] + tmpView[10] * center[2] + tmpView[14];
    const sx = Math.round(cx / texel) * texel;
    const sy = Math.round(cy / texel) * texel;
    const cascade = out[c] ?? { viewProj: mat4.create(), planes: new Float32Array(24) };
    mat4.orthoZO(tmpProj, sx - radius, sx + radius, sy - radius, sy + radius, -cz - back, -cz + radius + 60);
    mat4.multiply(cascade.viewProj, tmpProj, tmpView);
    frustumPlanes(cascade.planes, cascade.viewProj);
    cascade.split = fa;
    cascade.texel = texel;
    out[c] = cascade;
  }
  out.length = count;
  return out;
}

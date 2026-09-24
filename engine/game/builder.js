// Turns a normalized game spec into a live world: heightfield, GPU scene
// (terrain, vegetation, entities, avatar), physics colliders, and renderer
// configuration (sky, fog, water, grass, weather, grading).

import { Heightfield } from '../world/terrain.js';
import { addTerrain } from '../render/terrainBatches.js';
import { SCATTER, scatterMesh, shapeMesh, avatarMesh } from '../render/meshes.js';
import { KIND } from '../render/scene.js';
import { Physics } from './physics.js';
import { hexToLinear, hexToRgb, mat4, DEG } from '../core/math.js';
import { Rng } from '../../shared/rng.js';

/** Scatter density -> instances per square meter at density 1. */
const SCATTER_RATE = { pine: 0.017, oak: 0.013, palm: 0.009, rock: 0.01, flower: 0.04, crystal: 0.007, cactus: 0.008, mushroom: 0.025, pillar: 0.004 };
const SCATTER_CAP = { low: 1600, medium: 3500, high: 6000, ultra: 9000 };
/** Collider half-width and height (unscaled) for props the player bumps into. */
const PROP_COLLIDER = { pine: [0.3, 4], oak: [0.35, 3], palm: [0.3, 3], rock: [0.85, 0.75], pillar: [0.5, 4], cactus: [0.35, 2.5], crystal: [0.45, 1.6] };

export const PROJECTILES = 48;

export function isLava(hex) {
  const [r, g, b] = hexToRgb(hex);
  return r > 0.6 && g < 0.55 && b < 0.35 && r > g * 1.4;
}

export function buildWorld(renderer, spec, { tier = 'high' } = {}) {
  const rng = new Rng(spec.seed);
  const spawnXZ = [spec.player.spawn[0], spec.player.spawn[2]];
  const hf = new Heightfield(spec.terrain, spec.seed, spawnXZ);
  const waterLevel = spec.water.enabled ? hf.minHeight + spec.water.level : null;
  const lava = spec.water.enabled && isLava(spec.water.color);
  const physics = new Physics(hf, { waterLevel, lava });
  const surface = (x, z) => physics.surfaceAt(x, z);

  // ---------------------------------------------------------------- renderer setup
  renderer.setTerrain(hf, { waterLevel });
  renderer.setPalette(spec.terrain.palette);
  const env = spec.environment;
  renderer.setEnvironment({
    timeOfDay: env.timeOfDay, sunAzimuth: env.sunAzimuth, cloudCover: env.cloudCover, fogDensity: env.fogDensity,
    fogColor: env.fogColor, skyTint: env.skyTint, wind: env.wind,
    windDir: [Math.cos(spec.seed % 6.28), Math.sin(spec.seed % 6.28)],
  });
  renderer.setGrade({ ...spec.post });

  const scene = renderer.createScene();
  addTerrain(scene, hf);

  // ---------------------------------------------------------------- scatter
  const half = hf.playSize / 2;
  const scatterHalf = Math.min(hf.worldSize / 2 - 4, half * 1.35);
  let budget = SCATTER_CAP[tier] ?? 4000;
  const range = hf.maxHeight - hf.minHeight || 1;
  for (const layer of spec.scatter) {
    if (layer.kind === 'grass') continue;
    const def = SCATTER[layer.kind];
    if (!def) continue;
    const area = (scatterHalf * 2) ** 2;
    let count = Math.min(budget, Math.round(area * SCATTER_RATE[layer.kind] * layer.density));
    budget -= count;
    if (count <= 0) continue;
    const batches = [];
    for (let v = 0; v < def.variants; v++) {
      batches.push(def.lods.map((min, lod) => {
        const key = `${layer.kind}:${v}:${lod}`;
        if (!scene.hasMesh(key)) scene.addMesh(key, scatterMesh(layer.kind, v, lod));
        return scene.addBatch(key, { minDist: min, maxDist: def.lods[lod + 1] ?? 480, alpha: def.alpha, shadows: true });
      }));
    }
    const tint = hexToLinear(layer.color);
    const lr = rng.fork(layer.kind.length * 97);
    const maxSlope = layer.kind === 'rock' || layer.kind === 'crystal' ? 0.55 : 0.78;
    let placed = 0, attempts = 0;
    while (placed < count && attempts < count * 6) {
      attempts++;
      const x = lr.range(-scatterHalf, scatterHalf);
      const z = lr.range(-scatterHalf, scatterHalf);
      if (Math.hypot(x - spawnXZ[0], z - spawnXZ[1]) < (def.alpha ? 12 : 6)) continue;
      const y = hf.heightAt(x, z);
      if (waterLevel !== null && y < waterLevel + (layer.kind === 'palm' ? 0.2 : 0.5)) continue;
      const n = hf.normalAt(x, z);
      if (n[1] < maxSlope) continue;
      const hn = (y - hf.minHeight) / range;
      if ((layer.kind === 'pine' || layer.kind === 'oak' || layer.kind === 'flower') && hn > 0.78) continue;
      // clumping: forests are denser in some places than others
      if (lr.float() > 0.35 + 0.65 * clump(x, z, spec.seed + layer.kind.length)) continue;
      const v = lr.int(0, def.variants - 1);
      const s = lr.range(def.scale[0], def.scale[1]) * layer.scale;
      const yaw = lr.range(0, Math.PI * 2);
      const c = tint.map((t) => t * lr.range(0.82, 1.15));
      for (const b of batches[v]) {
        const i = scene.addInstance(b);
        const m = scene.instance(i);
        mat4.compose(m, 0, x, y - 0.05, z, 0, yaw, 0, s, s, s);
        m.set([...c, 0], 16);
        m.set([0, 0, 0, layer.kind === 'rock' || layer.kind === 'pillar' ? 0.85 : 0.7], 20);
        m[24] = def.kind; m[25] = def.wind; m[26] = 0;
        scene.updateBounds(i);
      }
      const col = PROP_COLLIDER[layer.kind];
      if (col && Math.abs(x) < half && Math.abs(z) < half) {
        const w = col[0] * s;
        physics.addStatic({ min: [x - w, y - 1, z - w], max: [x + w, y + col[1] * s, z + w] });
      }
      placed++;
    }
  }

  // ---------------------------------------------------------------- grass
  const grassLayer = spec.scatter.find((s) => s.kind === 'grass');

  // ---------------------------------------------------------------- entities
  const prefabs = new Map(spec.prefabs.map((p) => [p.id, p]));
  const prefabBatch = new Map();
  for (const p of spec.prefabs) {
    const sm = shapeMesh(p.shape, p.size);
    if (!scene.hasMesh(sm.key)) scene.addMesh(sm.key, sm.build());
    prefabBatch.set(p.id, { batch: scene.addBatch(sm.key, { shadows: true, maxDist: 600 }), scale: sm.scale });
  }
  const entities = [];
  const addEntity = (prefabId, x, yAbove, z, yaw, scale) => {
    const p = prefabs.get(prefabId);
    if (!p) return null;
    // y is the height of the object's base above the ground/water surface
    const y = surface(x, z) + yAbove + (p.size[1] * scale) / 2;
    const pb = prefabBatch.get(prefabId);
    const e = {
      id: entities.length,
      prefab: p,
      home: [x, y, z],
      base: [x, y, z],
      pos: [x, y, z],
      prev: [x, y, z],
      delta: [0, 0, 0],
      yaw: yaw * DEG,
      scale,
      size: p.size.map((v) => v * scale),
      meshScale: pb.scale.map((v) => v * scale),
      color: hexToLinear(p.color),
      emissive: hexToLinear(p.color).map((c) => c * p.emissive * 2.2),
      behaviors: p.behaviors.map((b) => ({ ...b, state: {} })),
      alive: true,
      flash: 0,
      bob: 0,
      instance: scene.addInstance(pb.batch),
    };
    const has = (t) => e.behaviors.some((b) => b.type === t);
    e.trigger = ['collectible', 'hazard', 'goal', 'checkpoint', 'bounce', 'heal'].some(has);
    e.moving = ['patrol', 'chase', 'orbit'].some(has);
    if (p.solid) {
      e.box = { min: [0, 0, 0], max: [0, 0, 0], entity: e };
      updateBox(e);
      if (e.moving) physics.addDynamic(e.box); else physics.addStatic(e.box);
    }
    entities.push(e);
    return e;
  };

  for (const pl of spec.placements) addEntity(pl.prefab, pl.position[0], pl.position[1], pl.position[2], pl.rotationY, pl.scale);
  for (const sp of spec.spawns) {
    const pts = spawnPattern(sp, spec, hf, waterLevel, rng.fork(sp.count * 31 + sp.prefab.length));
    for (const [x, yOff, z] of pts) addEntity(sp.prefab, x, yOff, z, rng.range(0, 360), 1);
  }

  // ---------------------------------------------------------------- avatar + projectiles
  scene.addMesh('avatar', avatarMesh());
  const avatarBatch = scene.addBatch('avatar', { shadows: true });
  const avatar = scene.addInstance(avatarBatch);
  const projMesh = shapeMesh('sphere', [0.5, 0.5, 0.5]);
  if (!scene.hasMesh(projMesh.key)) scene.addMesh(projMesh.key, projMesh.build());
  const projBatch = scene.addBatch(projMesh.key, { shadows: false });
  const projectiles = [];
  for (let k = 0; k < PROJECTILES; k++) {
    const i = scene.addInstance(projBatch);
    projectiles.push({ instance: i, alive: false, pos: [0, -100, 0], vel: [0, 0, 0], life: 0, color: [4, 1, 0.3] });
  }

  // write initial transforms, then upload everything once
  for (const e of entities) writeEntity(scene, e);
  writeInstance(scene, avatar, [0, -100, 0], 0, [1, 1, 1], hexToLinear(spec.player.color), [0, 0, 0], 0.45, 0.1);
  for (const pr of projectiles) { writeInstance(scene, pr.instance, pr.pos, 0, projMesh.scale, [1, 0.3, 0.1], [6, 1.5, 0.3], 0.4, 0); scene.setVisible(pr.instance, false); }
  scene.build();
  renderer.setScene(scene);

  const spawnY = surface(spec.player.spawn[0], spec.player.spawn[2]) + Math.max(0.1, spec.player.spawn[1] - 1);
  return {
    spec, hf, physics, scene, entities, avatar, projectiles, projectileScale: projMesh.scale,
    waterLevel, lava, grassLayer,
    spawn: [spec.player.spawn[0], spawnY, spec.player.spawn[2]],
    center: [0, hf.heightAt(0, 0), 0],
  };
}

function clump(x, z, seed) {
  const s = Math.sin(x * 0.045 + seed) * Math.cos(z * 0.05 - seed * 0.7) + Math.sin((x + z) * 0.021 + seed * 1.3) * 0.6;
  return Math.min(1, Math.max(0, s * 0.5 + 0.5));
}

export function updateBox(e) {
  const [sx, sy, sz] = e.size;
  const c = Math.abs(Math.cos(e.yaw)), s = Math.abs(Math.sin(e.yaw));
  const hx = (c * sx + s * sz) / 2, hz = (s * sx + c * sz) / 2;
  const cy = e.pos[1];
  e.box.min[0] = e.pos[0] - hx; e.box.max[0] = e.pos[0] + hx;
  e.box.min[2] = e.pos[2] - hz; e.box.max[2] = e.pos[2] + hz;
  e.box.min[1] = cy - sy / 2; e.box.max[1] = cy + sy / 2;
}

export function writeInstance(scene, i, pos, yaw, scale, color, emissive, rough, metal, flash = 0, kind = KIND.standard) {
  const m = scene.instance(i);
  mat4.compose(m, 0, pos[0], pos[1], pos[2], 0, yaw, 0, scale[0], scale[1], scale[2]);
  m[16] = color[0]; m[17] = color[1]; m[18] = color[2]; m[19] = metal;
  m[20] = emissive[0]; m[21] = emissive[1]; m[22] = emissive[2]; m[23] = rough;
  m[24] = kind; m[25] = 0; m[26] = flash;
  const visible = m[31] >= 0;
  scene.updateBounds(i);
  if (!visible) m[31] = -Math.abs(m[31]);
  scene.markDirty(i);
}

export function writeEntity(scene, e) {
  const p = e.prefab;
  const pos = [e.pos[0], e.pos[1] + e.bob, e.pos[2]];
  const kind = p.shape === 'gem' || p.shape === 'crystal' ? KIND.standard : KIND.standard;
  writeInstance(scene, e.instance, pos, e.yaw, e.meshScale, e.color, e.emissive, p.roughness, p.metallic, e.flash, kind);
  if (!e.alive) scene.setVisible(e.instance, false);
}

/** Positions for a spawn group: [x, heightAboveSurface, z][] */
export function spawnPattern(sp, spec, hf, waterLevel, rng) {
  const out = [];
  const [cx, cy, cz] = sp.center;
  const half = hf.playSize / 2 - 3;
  const clampXZ = (v) => Math.max(-half, Math.min(half, v));
  const n = sp.count;
  const jitterY = () => cy + rng.range(0, sp.height);
  const spawn = [spec.player.spawn[0], spec.player.spawn[2]];
  const hazard = spec.prefabs.find((p) => p.id === sp.prefab)?.behaviors.some((b) => b.type === 'hazard');
  const ok = (x, z) => {
    if (hazard && Math.hypot(x - spawn[0], z - spawn[1]) < 14) return false;
    if (waterLevel !== null && hf.heightAt(x, z) < waterLevel - 2.5 && !hazard) return false;
    return true;
  };
  switch (sp.pattern) {
    case 'ring':
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        out.push([clampXZ(cx + Math.cos(a) * sp.radius), jitterY(), clampXZ(cz + Math.sin(a) * sp.radius)]);
      }
      break;
    case 'line':
    case 'path': {
      const wobble = sp.pattern === 'path' ? 1 : 0;
      for (let i = 0; i < n; i++) {
        const t = (i + 1) / (n + 1);
        const x = spawn[0] + (cx - spawn[0]) * t, z = spawn[1] + (cz - spawn[1]) * t;
        const dx = cz - spawn[1], dz = -(cx - spawn[0]);
        const l = Math.hypot(dx, dz) || 1;
        const off = Math.sin(t * Math.PI * 3) * 10 * wobble;
        out.push([clampXZ(x + (dx / l) * off), jitterY(), clampXZ(z + (dz / l) * off)]);
      }
      break;
    }
    case 'cluster': {
      const clusters = Math.max(1, Math.round(n / 6));
      const centers = Array.from({ length: clusters }, () => [cx + rng.range(-sp.radius, sp.radius), cz + rng.range(-sp.radius, sp.radius)]);
      for (let i = 0; i < n; i++) {
        const c = centers[i % clusters];
        out.push([clampXZ(c[0] + rng.range(-3, 3)), jitterY(), clampXZ(c[1] + rng.range(-3, 3))]);
      }
      break;
    }
    case 'grid': {
      const side = Math.ceil(Math.sqrt(n));
      for (let i = 0; i < n; i++) {
        const gx = (i % side) / Math.max(1, side - 1) - 0.5, gz = Math.floor(i / side) / Math.max(1, side - 1) - 0.5;
        out.push([clampXZ(cx + gx * sp.radius * 2), jitterY(), clampXZ(cz + gz * sp.radius * 2)]);
      }
      break;
    }
    default: // scatter
      for (let i = 0; i < n; i++) {
        let x = 0, z = 0;
        for (let a = 0; a < 12; a++) {
          const ang = rng.range(0, Math.PI * 2), r = Math.sqrt(rng.float()) * sp.radius;
          x = clampXZ(cx + Math.cos(ang) * r);
          z = clampXZ(cz + Math.sin(ang) * r);
          if (ok(x, z)) break;
        }
        out.push([x, jitterY(), z]);
      }
  }
  return out;
}

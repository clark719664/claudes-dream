// Renderer testbed: a fixed scene used for visual verification and screenshots.
// URL params: tier, scale, time, clouds, fog, frames, cam (x,y,z), look (x,y,z)
import { Renderer } from '../engine/render/renderer.js';
import { Heightfield } from '../engine/world/terrain.js';
import { addTerrain } from '../engine/render/terrainBatches.js';
import { scatterMesh, shapeMesh, SCATTER } from '../engine/render/meshes.js';
import { mat4, hexToLinear } from '../engine/core/math.js';
import { Rng } from '../shared/rng.js';
import { Volumetrics } from '../engine/render/volumetrics.js';
import { Clouds } from '../engine/render/clouds.js';
import { GI } from '../engine/render/gi.js';
import { Interaction } from '../engine/render/interaction.js';
import { GTAO } from '../engine/render/gtao.js';
import { Grass } from '../engine/render/grass.js';
import { Water } from '../engine/render/water.js';
import { Particles } from '../engine/render/particles.js';

const q = new URLSearchParams(location.search);
const num = (k, d) => (q.has(k) ? Number(q.get(k)) : d);
const vec = (k, d) => (q.has(k) ? q.get(k).split(',').map(Number) : d);
window.__frames = 0;
window.__errors = [];

async function main() {
  const canvas = document.getElementById('c');
  const renderer = await Renderer.create(canvas, { tier: q.get('tier') ?? undefined, renderScale: q.has('scale') ? num('scale', 1) : undefined, pixelRatio: 1 });
  renderer.device.onuncapturederror = (e) => { window.__errors.push(e.error.message); console.error(e.error.message); };
  const terrainSpec = { style: q.get('style') ?? 'hills', size: 140, height: num('height', 14), roughness: 0.5 };
  const hf = new Heightfield(terrainSpec, 42, [0, 0]);
  const water = q.has('water') ? num('water', 2) : null;
  renderer.setTerrain(hf, { waterLevel: water });
  renderer.setPalette(q.get('palette') === 'snow'
    ? { low: '#e8eef5', mid: '#f4f8fc', high: '#ffffff', cliff: '#7d8792' }
    : q.get('palette') === 'sand' ? { low: '#e2c48f', mid: '#d9b77e', high: '#c9a06a', cliff: '#9a6b45' }
      : { low: '#c9b98a', mid: '#4f7a2e', high: '#eef2f5', cliff: '#6b5d52' });
  if (renderer.tier.clouds && !q.has('noclouds')) renderer.addFeature(new Clouds(renderer));
  if (!q.has('nogi')) renderer.addFeature(new GI(renderer));
  const interaction = new Interaction(renderer);
  renderer.addFeature(interaction);
  const vol = new Volumetrics(renderer);
  vol.setMaxDistance(hf.worldSize * 1.1);
  if (!q.has('novol')) renderer.addFeature(vol);
  if (renderer.tier.gtao && !q.has('noao')) renderer.addFeature(new GTAO(renderer));
  if (!q.has('nograss')) renderer.addFeature(new Grass(renderer, { color: hexToLinear('#6f9a3c').map((c) => c * 0.9) }));
  renderer.player = [0, hf.heightAt(0, 8), 8, 1.2];
  const waterFx = new Water(renderer);
  renderer.addFeature(waterFx);
  waterFx.configure({ enabled: water !== null, level: water ?? 0, color: hexToLinear(q.get('watercolor') ? '#' + q.get('watercolor') : '#1b5d6b'), lava: q.has('lava'), span: hf.worldSize });
  const particles = new Particles(renderer);
  renderer.addFeature(particles);
  particles.setAmbient(q.get('particles') ?? 'none');
  window.__particles = particles;
  window.__renderer = renderer;
  // weather inputs for testing: fx = wetness, rain, flash, aurora; flash = direction x, y, z, seed
  if (q.has('fx')) renderer.weatherFx = vec('fx', [0, 0, 0, 0]);
  if (q.has('flash')) renderer.flashPos = vec('flash', [0, 0, 0, 0]);
  renderer.setEnvironment({ timeOfDay: num('time', 16.5), sunAzimuth: num('az', 210), cloudCover: num('clouds', 0.35), fogDensity: num('fog', 0.2), wind: 0.4 });

  const scene = renderer.createScene();
  addTerrain(scene, hf);
  const rng = new Rng(7);
  // props
  const put = (batch, x, z, s, ry, color, metal, rough, kind = 0, wind = 0, emissive = [0, 0, 0], y = null) => {
    const i = scene.addInstance(batch);
    const m = scene.instance(i);
    const gy = y ?? hf.heightAt(x, z);
    mat4.compose(m, 0, x, gy, z, 0, ry, 0, s[0], s[1], s[2]);
    m.set([...color, metal], 16);
    m.set([...emissive, rough], 20);
    m[24] = kind; m[25] = wind; m[26] = 0;
    scene.updateBounds(i);
    return i;
  };
  const kinds = ['pine', 'oak', 'rock', 'flower'];
  const lodBatches = {};
  for (const kind of kinds) {
    const def = SCATTER[kind];
    for (let v = 0; v < def.variants; v++) {
      lodBatches[`${kind}:${v}`] = def.lods.map((min, lod) => {
        const key = `${kind}:${v}:${lod}`;
        scene.addMesh(key, scatterMesh(kind, v, lod));
        const max = def.lods[lod + 1] ?? 450;
        return scene.addBatch(key, { minDist: min, maxDist: max, alpha: def.alpha, shadows: true });
      });
    }
  }
  const colors = { pine: '#2d5a33', oak: '#4f8a2f', rock: '#8a8680', flower: '#ff8fb8' };
  for (let n = 0; n < num('trees', 900); n++) {
    const x = rng.range(-110, 110), z = rng.range(-110, 110);
    if (Math.hypot(x, z) < 10) continue;
    const nrm = hf.normalAt(x, z);
    if (nrm[1] < 0.8) continue;
    if (water !== null && hf.heightAt(x, z) < water + 0.5) continue;
    const r = rng.float();
    const kind = r < 0.45 ? 'pine' : r < 0.75 ? 'oak' : r < 0.88 ? 'rock' : 'flower';
    const def = SCATTER[kind];
    const v = rng.int(0, def.variants - 1);
    const sc = rng.range(def.scale[0], def.scale[1]);
    const tint = hexToLinear(colors[kind]).map((c) => c * rng.range(0.85, 1.15));
    const ry = rng.range(0, 6.28);
    for (const b of lodBatches[`${kind}:${v}`]) put(b, x, z, [sc, sc, sc], ry, tint, 0, kind === 'rock' ? 0.85 : 0.7, def.kind, def.wind);
  }
  // hero objects near the camera
  const shapes = [['sphere', [1.6, 1.6, 1.6], '#ffd23b', 1, 0.2], ['gem', [1.2, 1.8, 1.2], '#7dfcff', 0.1, 0.1], ['box', [2, 2, 2], '#e8e2d4', 0, 0.6], ['torus', [2, 2, 0.5], '#ff5ab0', 0.3, 0.3], ['sphere', [1.6, 1.6, 1.6], '#dde3ea', 1, 0.05], ['capsule', [1, 1.8, 1], '#ff7a3d', 0, 0.45]];
  shapes.forEach(([shape, size, hex, metal, rough], idx) => {
    const sm = shapeMesh(shape, size);
    if (!scene.hasMesh(sm.key)) scene.addMesh(sm.key, sm.build());
    const b = scene.addBatch(sm.key);
    const x = -7.5 + idx * 3, z = 8;
    const emissive = shape === 'gem' ? hexToLinear('#7dfcff').map((c) => c * 3) : [0, 0, 0];
    put(b, x, z, sm.scale, 0.4, hexToLinear(hex), metal, rough, 0, 0, emissive, hf.heightAt(x, z) + size[1] / 2 + 0.05);
  });
  scene.build();
  renderer.setScene(scene);
  renderer.setGrade({ bloom: 0.8, saturation: 1.05, contrast: 1.05, vignette: 0.3, warmth: 0.1 });

  const camPos = vec('cam', [0, 0, -9]);
  const look = vec('look', [0, 0, 14]);
  const camY = hf.heightAt(camPos[0], camPos[2]) + (q.has('cam') ? camPos[1] : 4);
  const lookY = hf.heightAt(look[0], look[2]) + (q.has('look') ? look[1] : 2);
  const frames = num('frames', 0);
  const orbit = q.has('orbit');
  let last = performance.now();
  const stats = document.getElementById('stats');
  function frame(now) {
    const dt = frames ? 1 / 60 : Math.min((now - last) / 1000, 0.1);
    last = now;
    let position = [camPos[0], camY, camPos[2]];
    if (orbit) {
      const a = renderer.time * 0.1;
      position = [Math.sin(a) * 30, camY + 8, Math.cos(a) * 30];
    }
    // walk=1: a scripted walker leaves footprints (and wakes in water) in front of the camera
    if (q.has('walk')) {
      const ff = num('ff', 5); // fast-forward so a short capture shows a long trail
      const t = window.__frames * dt * ff;
      const speed = 3;
      const s = -8 + ((t * speed) % 22);
      const wx = Math.sin(s * 0.25) * 3, wz = 4 + s;
      const pos = [wx, hf.heightAt(wx, wz), wz];
      const inWater = water !== null && pos[1] < water - 0.4;
      if (inWater) pos[1] = water;
      interaction.trackPlayer({ pos, vel: [Math.cos(s * 0.25) * 0.75 * speed, 0, speed], grounded: !inWater, inWater }, dt * ff, (x, z) => hf.heightAt(x, z), water);
      renderer.player = [pos[0], pos[1], pos[2], 1.1];
    }
    renderer.render({ position, target: [look[0], lookY, look[2]], fovY: 60 * Math.PI / 180, near: 0.1 }, dt);
    window.__frames++;
    const s = renderer.stats;
    stats.textContent = `${renderer.tierName} | ${s.internal.join('x')} -> ${s.output.join('x')} | ${s.fps.toFixed(0)} fps | ${s.instances} instances`;
    if (!frames || window.__frames < frames) requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}
main().catch((e) => { window.__errors.push(String(e.stack || e)); console.error(e); });

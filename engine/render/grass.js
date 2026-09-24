// GPU grass: hundreds of thousands of individual blades generated entirely in
// the vertex shader around the camera. Blades follow the heightmap, grow only
// where the terrain material is "grass", bend in layered wind gusts, part
// around the player, and thin out with distance. Tiles are frustum culled on
// the CPU and drawn with two geometric LODs.

import { bindLayout, bindGroup, createShader, createBuffer } from '../gpu/gpu.js';
import { GLOBALS_WGSL, MATH_WGSL, ATMOSPHERE_WGSL, SHADING_WGSL } from './wgsl/common.js';
import { sphereInFrustum } from '../core/math.js';

const TILE = 8;

const GRASS_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${SHADING_WGSL}

struct GrassParams {
  origin: vec4f,     // grid origin x, z, tile size, tiles per row
  blades: vec4f,     // blades per tile row, cell size, radius, height scale
  color: vec4f,      // base color rgb, density mask strength
};
@group(1) @binding(0) var<uniform> grass: GrassParams;

override SEGMENTS: u32 = 3u;

struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec3f,
  @location(3) t: f32,
};

fn heightAt(x: f32, z: f32) -> f32 {
  let g = frame.terrainGrid;
  let fx = (x - g.x) / g.z;
  let fz = (z - g.y) / g.z;
  let i = vec2i(floor(vec2f(fx, fz)));
  let f = vec2f(fx, fz) - vec2f(i);
  let n = i32(g.w) - 1;
  let h00 = textureLoad(heightmap, clamp(i, vec2i(0), vec2i(n)), 0).r;
  let h10 = textureLoad(heightmap, clamp(i + vec2i(1, 0), vec2i(0), vec2i(n)), 0).r;
  let h01 = textureLoad(heightmap, clamp(i + vec2i(0, 1), vec2i(0), vec2i(n)), 0).r;
  let h11 = textureLoad(heightmap, clamp(i + vec2i(1, 1), vec2i(0), vec2i(n)), 0).r;
  if (f.x >= f.y) { return h00 + (h10 - h00) * f.x + (h11 - h10) * f.y; }
  return h00 + (h01 - h00) * f.y + (h11 - h01) * f.x;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32, @builtin(instance_index) ii: u32) -> VOut {
  var o: VOut;
  let perRow = u32(grass.blades.x);
  let perTile = perRow * perRow;
  let tile = ii / perTile;
  let local = ii % perTile;
  let tilesPerRow = u32(grass.origin.w);
  let tx = f32(tile % tilesPerRow);
  let tz = f32(tile / tilesPerRow);
  let cell = grass.blades.y;
  let cellId = vec2f(grass.origin.x + tx * grass.origin.z, grass.origin.y + tz * grass.origin.z) / cell + vec2f(f32(local % perRow), f32(local / perRow));
  let rnd = hash22(cellId);
  let rnd2 = hash22(cellId + 17.31);
  var base = (cellId + rnd) * cell;
  let y = heightAt(base.x, base.y);
  let dist = distance(vec3f(base.x, y, base.y), frame.camPos.xyz);

  // where does grass grow? mirror the terrain material's grass band
  let g = frame.terrainGrid;
  let hx = heightAt(base.x + g.z, base.y) - heightAt(base.x - g.z, base.y);
  let hz = heightAt(base.x, base.y + g.z) - heightAt(base.x, base.y - g.z);
  let tn = normalize(vec3f(-hx, 2.0 * g.z, -hz));
  let range = max(frame.terrain.y - frame.terrain.x, 0.001);
  let macroN = fbm(base * 0.015, 3);
  let hn = (y - frame.terrain.x) / range + (macroN - 0.5) * 0.12;
  var grow = 1.0 - smoothstep(0.28, 0.4, 1.0 - tn.y);
  grow *= 1.0 - smoothstep(0.6, 0.7, hn);
  if (frame.terrain.w > 0.5) { grow *= smoothstep(frame.terrain.z + 0.6, frame.terrain.z + 1.8, y); }
  else { grow *= smoothstep(0.05, 0.14, hn); }
  let patchy = smoothstep(0.25, 0.6, fbm(base * 0.07 + 3.0, 3));
  grow *= mix(1.0, patchy, grass.color.a);
  // thin out with distance
  let fade = 1.0 - smoothstep(grass.blades.z * 0.55, grass.blades.z, dist);
  let keep = select(0.0, 1.0, rnd2.x < grow * mix(0.35, 1.0, fade));
  let heightScale = grass.blades.w * mix(0.55, 1.15, rnd2.y) * mix(0.6, 1.0, grow) * keep * max(fade, 0.2);

  // blade geometry (triangle strip: left/right pairs then the tip)
  let segs = SEGMENTS;
  let level = min(vi / 2u, segs);
  let t = f32(level) / f32(segs);
  let isTip = vi >= segs * 2u;
  let side = select(-1.0, 1.0, (vi & 1u) == 1u);
  let width = 0.045 * (1.0 - t * 0.85) * mix(0.8, 1.3, rnd.x) * select(1.0, 0.0, isTip);
  let yaw = rnd.y * TAU;
  let facing = vec2f(cos(yaw), sin(yaw));
  let across = vec2f(-facing.y, facing.x);
  let h = t * heightScale;

  // wind: large rolling gusts + per-blade flutter; player pushes blades aside
  let time = frame.time.x;
  let gust = fbm(base * 0.04 - frame.wind.xy * time * 0.6, 2);
  let strength = (0.15 + frame.time.w * 0.9) * (gust * 1.4 + 0.2);
  let flutter = sin(time * 4.0 + rnd.x * 30.0) * 0.08;
  var bend = frame.wind.xy * strength + facing * (0.25 + flutter);
  let toPlayer = base - frame.player.xz;
  let pd = length(toPlayer);
  let push = (1.0 - smoothstep(0.2, frame.player.w, pd)) * select(0.0, 1.0, abs(y - frame.player.y) < 2.0);
  bend += normalize(toPlayer + vec2f(1e-4)) * push * 1.6;
  let curve = t * t;
  var p = vec3f(base.x, y, base.y);
  p += vec3f(across.x, 0.0, across.y) * width * side;
  p += vec3f(bend.x, 0.0, bend.y) * curve * heightScale * 0.6;
  p.y += h * (1.0 - 0.25 * curve * min(length(bend), 1.5));

  // rounded normal: lean the blade normal outwards so the clump shades like a volume
  let bladeN = normalize(vec3f(facing.x, 0.4, facing.y) + vec3f(across.x, 0.0, across.y) * side * 0.6);
  o.normal = normalize(mix(tn, bladeN, 0.45));
  o.world = p;
  o.pos = frame.viewProj * vec4f(p, 1.0);
  if (keep < 0.5) { o.pos = vec4f(2.0, 2.0, 2.0, 1.0); }
  let dry = smoothstep(0.45, 0.8, fbm(base * 0.03 + 11.0, 3));
  var col = mix(grass.color.rgb, grass.color.rgb * vec3f(1.55, 1.25, 0.55), dry * 0.6);
  col *= mix(0.9, 1.1, rnd2.x);
  o.color = col * mix(0.35, 1.05, t);
  o.t = t;
  return o;
}

@fragment
fn fs(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  var n = normalize(in.normal);
  let v = normalize(frame.camPos.xyz - in.world);
  let s = makeSurface(in.color, 0.0, 0.55, n, v);
  let uv = in.pos.xy * frame.resolution.zw;
  let shadow = shadowAt(in.world, n, in.pos.xy) * cloudShadow(in.world);
  let key = keyRadiance();
  var col = directLight(s, frame.keyDir.xyz, key * shadow);
  let back = pow(clamp(dot(-frame.keyDir.xyz, v), 0.0, 1.0), 3.0);
  col += in.color * key * shadow * (back * 0.7 + 0.1) * in.t * vec3f(0.9, 1.0, 0.55);
  col += pointLights(s, in.world);
  col += ambientLight(s, mix(0.45, 1.0, in.t), 1.0);
  col = applyVolumetrics(col, uv, length(in.world - frame.camPos.xyz));
  return vec4f(col, 1.0);
}
`;

export class Grass {
  constructor(renderer, { color = [0.18, 0.32, 0.07], height = 0.7, patchiness = 0.35 } = {}) {
    const d = (this.device = renderer.device);
    this.renderer = renderer;
    this.radius = renderer.tier.grassRadius;
    this.density = renderer.tier.grassDensity;
    this.perRow = Math.max(2, Math.round(TILE * Math.sqrt(this.density)));
    this.cell = TILE / this.perRow;
    this.tilesPerRow = Math.ceil((this.radius * 2) / TILE) + 1;
    this.color = color;
    this.height = height;
    this.patchiness = patchiness;
    this.enabled = true;
    this.uniform = createBuffer(d, 48, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'grass');
    this.layout = bindLayout(d, 'grass', [['VF', 'uniform']]);
    this.group = bindGroup(d, this.layout, [this.uniform]);
    const module = createShader(d, GRASS_WGSL, 'grass');
    const make = (segments, label) => d.createRenderPipeline({
      label,
      layout: d.createPipelineLayout({ bindGroupLayouts: [renderer.globalLayout, this.layout] }),
      vertex: { module, entryPoint: 'vs', constants: { SEGMENTS: segments } },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-strip', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: true, depthCompare: 'greater' },
    });
    this.near = make(3, 'grass-near');
    this.far = make(1, 'grass-far');
    this.tmp = [0, 0, 0];
  }

  setStyle({ color, height, patchiness }) {
    if (color) this.color = color;
    if (height !== undefined) this.height = height;
    if (patchiness !== undefined) this.patchiness = patchiness;
  }

  main(pass, r) {
    const hf = r.heightfield;
    if (!this.enabled || !hf || this.height <= 0.01) return;
    const cam = r.camera.position;
    const originX = Math.floor((cam[0] - this.radius) / TILE) * TILE;
    const originZ = Math.floor((cam[2] - this.radius) / TILE) * TILE;
    this.device.queue.writeBuffer(this.uniform, 0, new Float32Array([
      originX, originZ, TILE, this.tilesPerRow,
      this.perRow, this.cell, this.radius, this.height,
      ...this.color, this.patchiness,
    ]));
    const perTile = this.perRow * this.perRow;
    const planes = r.cameraPlanes;
    const nearTiles = [], farTiles = [];
    for (let tz = 0; tz < this.tilesPerRow; tz++) {
      for (let tx = 0; tx < this.tilesPerRow; tx++) {
        const cx = originX + (tx + 0.5) * TILE, cz = originZ + (tz + 0.5) * TILE;
        const dist = Math.hypot(cx - cam[0], cz - cam[2]);
        if (dist - TILE * 0.71 > this.radius) continue;
        const cy = hf.heightAt(cx, cz);
        if (!sphereInFrustum(planes, cx, cy + 0.5, cz, TILE * 0.75 + 1.5)) continue;
        (dist < this.radius * 0.4 ? nearTiles : farTiles).push(tz * this.tilesPerRow + tx);
      }
    }
    pass.setBindGroup(0, r.globalGroup);
    pass.setBindGroup(1, this.group);
    pass.setPipeline(this.near);
    for (const t of nearTiles) pass.draw(7, perTile, 0, t * perTile);
    pass.setPipeline(this.far);
    for (const t of farTiles) pass.draw(3, perTile, 0, t * perTile);
    this.stats = { tiles: nearTiles.length + farTiles.length, blades: (nearTiles.length + farTiles.length) * perTile };
  }
}

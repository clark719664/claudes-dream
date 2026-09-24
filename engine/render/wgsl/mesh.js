// Mesh shaders: GPU-displaced terrain chunks, wind-animated foliage and PBR
// props, drawn through the GPU-culled instance lists.
import { GLOBALS_WGSL, MATH_WGSL, ATMOSPHERE_WGSL, SHADING_WGSL } from './common.js';
import { INSTANCE_WGSL } from '../scene.js';

const VERTEX_COMMON = /* wgsl */ `
struct VIn {
  @location(0) pos: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
  @location(3) uv: vec2f,
  @builtin(instance_index) ii: u32,
};
struct VOut {
  @builtin(position) pos: vec4f,
  @location(0) world: vec3f,
  @location(1) normal: vec3f,
  @location(2) color: vec4f,
  @location(3) emissive: vec4f,
  @location(4) @interpolate(flat) params: vec4f,
  @location(5) uv: vec2f,
  @location(6) card: f32,
  @location(7) local: vec3f,
};
struct DepthOut {
  @builtin(position) pos: vec4f,
  @location(0) uv: vec2f,
  @location(1) card: f32,
};

fn terrainTexel(t: vec2i) -> f32 {
  let n = i32(frame.terrainGrid.w) - 1;
  return textureLoad(heightmap, clamp(t, vec2i(0), vec2i(n)), 0).r;
}

struct Placed { world: vec3f, normal: vec3f };

fn placeVertex(v: VIn, inst: Instance) -> Placed {
  var o: Placed;
  let kind = inst.params.x;
  if (kind == 1.0) {
    // Terrain chunk: local xz are texel offsets, displaced from the heightmap on the GPU.
    let texel = vec2i(round(v.pos.xz + inst.model[3].xz));
    let spacing = frame.terrainGrid.z;
    var h = terrainTexel(texel);
    if (v.pos.y < -0.5) { h -= 3.0; }
    o.world = vec3f(frame.terrainGrid.x + f32(texel.x) * spacing, h, frame.terrainGrid.y + f32(texel.y) * spacing);
    let hx = terrainTexel(texel + vec2i(1, 0)) - terrainTexel(texel - vec2i(1, 0));
    let hz = terrainTexel(texel + vec2i(0, 1)) - terrainTexel(texel - vec2i(0, 1));
    o.normal = normalize(vec3f(-hx, 2.0 * spacing, -hz));
    return o;
  }
  var wp = (inst.model * vec4f(v.pos, 1.0)).xyz;
  if (kind == 3.0 || kind == 4.0) {
    // Foliage sway: layered gusts that grow with height above the instance origin.
    let h = max(v.pos.y, 0.0);
    let t = frame.time.x;
    let gust = vnoise(wp.xz * 0.05 + frame.wind.xy * t * 0.35) * 1.4 + 0.3;
    let phase = t * 1.9 + wp.x * 0.23 + wp.z * 0.17;
    let w = (sin(phase) + 0.45 * sin(phase * 2.3 + 1.7)) * gust;
    let bend = h * h * 0.006 * (0.25 + frame.time.w * 1.6) * inst.params.y;
    wp += vec3f(frame.wind.x * (0.6 + w), 0.0, frame.wind.y * (0.6 + w)) * bend;
    wp.y -= bend * 0.15;
    if (kind == 4.0 && v.color.a > 0.5) {
      // leaf flutter on the cards
      let f = sin(t * 7.0 + dot(wp, vec3f(1.7, 2.3, 1.1))) * 0.035 * (0.3 + frame.time.w) * gust;
      wp += vec3f(f, f * 0.6, -f);
    }
  }
  let m = inst.model;
  let s2 = vec3f(dot(m[0].xyz, m[0].xyz), dot(m[1].xyz, m[1].xyz), dot(m[2].xyz, m[2].xyz));
  o.world = wp;
  o.normal = normalize(mat3x3f(m[0].xyz, m[1].xyz, m[2].xyz) * (v.normal / s2));
  return o;
}
`;

export const MESH_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
${INSTANCE_WGSL}
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${SHADING_WGSL}
${VERTEX_COMMON}

@vertex
fn vs(v: VIn) -> VOut {
  let inst = instances[visible[drawInfo.base + v.ii]];
  let p = placeVertex(v, inst);
  var o: VOut;
  o.pos = frame.viewProj * vec4f(p.world, 1.0);
  o.world = p.world;
  o.normal = p.normal;
  // vertex alpha 1 = tinted by the instance, 0 = keeps its own color (tree bark...)
  o.color = vec4f(mix(v.color.rgb, v.color.rgb * inst.color.rgb, v.color.a), inst.color.a);
  o.emissive = inst.emissive;
  o.params = inst.params;
  o.uv = v.uv;
  o.card = select(0.0, 1.0, inst.params.x == 4.0 && v.color.a > 0.5);
  o.local = v.pos;
  return o;
}

struct TerrainMat { albedo: vec3f, rough: f32, n: vec3f };

fn terrainMaterial(world: vec3f, nIn: vec3f) -> TerrainMat {
  var m: TerrainMat;
  let p = world.xz;
  // procedural micro relief (bump) for close-up detail
  let e = 0.15;
  let b0 = fbm(p * 0.9, 3);
  let bx = fbm((p + vec2f(e, 0.0)) * 0.9, 3);
  let bz = fbm((p + vec2f(0.0, e)) * 0.9, 3);
  let slope0 = 1.0 - nIn.y;
  let bumpAmt = mix(0.25, 0.9, smoothstep(0.2, 0.5, slope0));
  let n = normalize(nIn + vec3f(b0 - bx, 0.0, b0 - bz) / e * bumpAmt * 0.35);
  let range = max(frame.terrain.y - frame.terrain.x, 0.001);
  let macroN = fbm(p * 0.015, 4);
  let detail = vnoise(p * 3.1);
  let hn = (world.y - frame.terrain.x) / range + (macroN - 0.5) * 0.12;
  let slope = 1.0 - n.y;
  var low: f32;
  if (frame.terrain.w > 0.5) {
    low = 1.0 - smoothstep(frame.terrain.z + 0.4, frame.terrain.z + 1.6 + macroN, world.y);
  } else {
    low = 1.0 - smoothstep(0.03, 0.16, hn);
  }
  var c = mix(frame.palMid.rgb, frame.palLow.rgb, low);
  let snow = smoothstep(0.66, 0.8, hn + (b0 - 0.5) * 0.15) * (1.0 - smoothstep(0.35, 0.55, slope));
  c = mix(c, frame.palHigh.rgb, snow);
  let rock = smoothstep(0.26, 0.46, slope + (b0 - 0.5) * 0.25);
  let strata = 0.85 + 0.3 * vnoise(vec2f(world.y * 1.7, p.x * 0.05 + p.y * 0.05));
  c = mix(c, frame.palCliff.rgb * strata, rock);
  c *= 0.78 + 0.3 * macroN + 0.14 * detail;
  var rough = mix(0.95, 0.82, rock);
  rough = mix(rough, 0.55, snow);
  if (frame.terrain.w > 0.5) {
    let wet = 1.0 - smoothstep(frame.terrain.z - 0.1, frame.terrain.z + 0.5, world.y);
    c *= mix(1.0, 0.55, wet);
    rough = mix(rough, 0.25, wet);
  }
  m.albedo = c;
  m.rough = rough;
  m.n = n;
  return m;
}

fn rockMaterial(world: vec3f, local: vec3f, nIn: vec3f, base: vec3f) -> TerrainMat {
  var m: TerrainMat;
  let p = world * 1.3;
  let e = 0.08;
  let b0 = vnoise3(p) * 0.6 + vnoise3(p * 3.1) * 0.3 + vnoise3(p * 9.0) * 0.1;
  let bx = vnoise3(p + vec3f(e, 0.0, 0.0)) * 0.6 + vnoise3((p + vec3f(e, 0.0, 0.0)) * 3.1) * 0.3 + vnoise3((p + vec3f(e, 0.0, 0.0)) * 9.0) * 0.1;
  let by = vnoise3(p + vec3f(0.0, e, 0.0)) * 0.6 + vnoise3((p + vec3f(0.0, e, 0.0)) * 3.1) * 0.3 + vnoise3((p + vec3f(0.0, e, 0.0)) * 9.0) * 0.1;
  let bz = vnoise3(p + vec3f(0.0, 0.0, e)) * 0.6 + vnoise3((p + vec3f(0.0, 0.0, e)) * 3.1) * 0.3 + vnoise3((p + vec3f(0.0, 0.0, e)) * 9.0) * 0.1;
  let grad = vec3f(bx - b0, by - b0, bz - b0) / e;
  var n = normalize(nIn - (grad - nIn * dot(grad, nIn)) * 0.22);
  let cavity = smoothstep(0.25, 0.65, b0);
  var c = base * (0.6 + 0.55 * cavity) * (0.9 + 0.2 * vnoise3(world * 0.35));
  // moss / dust settles on upward facing surfaces, matching the surrounding ground
  let moss = smoothstep(0.55, 0.85, n.y + (b0 - 0.5) * 0.4) * smoothstep(0.0, 0.25, local.y);
  c = mix(c, frame.palMid.rgb * 0.9, moss * 0.85);
  m.albedo = c;
  m.rough = mix(0.8, 0.95, moss);
  m.n = n;
  return m;
}

@fragment
fn fsMain(in: VOut, @builtin(front_facing) front: bool) -> @location(0) vec4f {
  // derivatives in uniform control flow, used by the alpha-tested foliage below
  let duvx = dpdx(in.uv);
  let duvy = dpdy(in.uv);
  let kind = in.params.x;
  var albedo = in.color.rgb;
  if (in.card > 0.5) {
    let leaf = textureSampleGrad(foliageAtlas, repeatSampler, in.uv, duvx, duvy);
    if (leaf.a < 0.5) { discard; }
    albedo *= leaf.rgb;
    // dissolve foliage right in front of the camera so it never blocks the view
    let camDist = length(in.world - frame.camPos.xyz);
    if (camDist < 2.5 && ign(in.pos.xy + frame.time.z * 3.1) > (camDist - 0.8) / 1.7) { discard; }
  }
  var n = normalize(in.normal);
  if (!front && in.card < 0.5) { n = -n; }
  let v = normalize(frame.camPos.xyz - in.world);
  var metallic = in.color.a;
  var rough = in.emissive.a;
  if (kind == 1.0) {
    let m = terrainMaterial(in.world, n);
    albedo = m.albedo;
    rough = m.rough;
    n = m.n;
    metallic = 0.0;
  } else if (kind == 5.0) {
    let m = rockMaterial(in.world, in.local, n, albedo);
    albedo = m.albedo;
    rough = m.rough;
    n = m.n;
  }
  let s = makeSurface(albedo, metallic, rough, n, v);
  let uv = in.pos.xy * frame.resolution.zw;
  let shadow = shadowAt(in.world, normalize(in.normal) * select(-1.0, 1.0, front), in.pos.xy) * cloudShadow(in.world);
  var ao = 1.0;
  if (frame.lightInfo.y > 0.5) { ao = textureSampleLevel(aoTex, linearSampler, uv, 0.0).r; }
  let key = keyRadiance();
  var col = directLight(s, frame.keyDir.xyz, key * shadow);
  if (kind == 3.0 || in.card > 0.5) {
    // leaves: light transmitted through the canopy when backlit
    let back = pow(clamp(dot(-frame.keyDir.xyz, v), 0.0, 1.0), 4.0);
    let wrap = clamp(dot(-n, frame.keyDir.xyz) * 0.5 + 0.5, 0.0, 1.0);
    col += albedo * key * shadow * (back * 0.9 + wrap * 0.18) * vec3f(0.9, 1.0, 0.55);
  }
  col += pointLights(s, in.world);
  col += ambientLight(s, ao, ao);
  col += in.emissive.rgb;
  col = mix(col, vec3f(8.0, 2.0, 2.0), in.params.z);
  col = applyVolumetrics(col, uv, length(in.world - frame.camPos.xyz));
  // alpha is a "reactive" mask for TAA: 0 marks moving objects so history is trusted less
  return vec4f(col, select(1.0, 0.0, in.params.y < 0.0));
}
`;

/** Depth-only variants: prepass (reversed-Z camera) and shadow cascades. */
export const MESH_DEPTH_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
${INSTANCE_WGSL}
${MATH_WGSL}
${VERTEX_COMMON}
@vertex
fn vs(v: VIn) -> DepthOut {
  let inst = instances[visible[drawInfo.base + v.ii]];
  let p = placeVertex(v, inst);
  var o: DepthOut;
  o.pos = frame.viewProj * vec4f(p.world, 1.0);
  o.uv = v.uv;
  o.card = select(0.0, 1.0, inst.params.x == 4.0 && v.color.a > 0.5);
  return o;
}
@fragment
fn fsAlpha(in: DepthOut) {
  if (in.card > 0.5 && textureSampleLevel(foliageAtlas, repeatSampler, in.uv, 1.0).a < 0.5) { discard; }
}
`;

export const MESH_SHADOW_WGSL = /* wgsl */ `
${GLOBALS_WGSL.replace(/@group\(0\) @binding\((?!0\)|2\)|13\)|15\))\d+\)[^\n]*\n/g, '')}
@group(2) @binding(0) var<uniform> cascadeVP: mat4x4f;
${INSTANCE_WGSL}
${MATH_WGSL}
${VERTEX_COMMON}
@vertex
fn vs(v: VIn) -> DepthOut {
  let inst = instances[visible[drawInfo.base + v.ii]];
  let p = placeVertex(v, inst);
  var o: DepthOut;
  o.pos = cascadeVP * vec4f(p.world, 1.0);
  o.uv = v.uv;
  o.card = select(0.0, 1.0, inst.params.x == 4.0 && v.color.a > 0.5);
  return o;
}
@fragment
fn fsAlpha(in: DepthOut) {
  if (in.card > 0.5 && textureSampleLevel(foliageAtlas, repeatSampler, in.uv, 2.0).a < 0.5) { discard; }
}
`;

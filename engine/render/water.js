// Water: Gerstner-style waves, depth-based absorption and refraction of the
// scene below, screen-space reflections with a physically based sky fallback,
// sharp sun glints and shoreline foam. A lava mode swaps the optics for an
// emissive, crusting surface.

import { bindLayout, bindGroup, createShader, createBuffer, texture2D, U } from '../gpu/gpu.js';
import { GLOBALS_WGSL, MATH_WGSL, ATMOSPHERE_WGSL, SHADING_WGSL, RECONSTRUCT_WGSL } from './wgsl/common.js';
import { SKY_FUNCTIONS_WGSL } from './atmosphere.js';

const WATER_WGSL = /* wgsl */ `
${GLOBALS_WGSL}
@group(1) @binding(0) var sceneColor: texture_2d<f32>;
@group(1) @binding(1) var sceneDepth: texture_depth_2d;
@group(1) @binding(2) var<uniform> water: vec4f; // level, size, wave strength, lava
${MATH_WGSL}
${ATMOSPHERE_WGSL}
${SHADING_WGSL}
${RECONSTRUCT_WGSL}
${SKY_FUNCTIONS_WGSL}

struct VOut { @builtin(position) pos: vec4f, @location(0) world: vec3f };

fn waves(p: vec2f, t: f32) -> vec3f {
  // returns height and analytic slope (dh/dx, dh/dz)
  var h = 0.0;
  var d = vec2f(0.0);
  var dirs = array<vec2f, 4>(vec2f(0.8, 0.6), vec2f(-0.45, 0.89), vec2f(0.3, -0.95), vec2f(-0.9, -0.2));
  var freq = array<f32, 4>(0.35, 0.62, 1.1, 1.9);
  var amp = array<f32, 4>(0.22, 0.12, 0.06, 0.03);
  var speed = array<f32, 4>(1.1, 1.5, 2.1, 2.9);
  for (var i = 0; i < 4; i++) {
    let x = dot(p, dirs[i]) * freq[i] + t * speed[i];
    h += sin(x) * amp[i];
    d += dirs[i] * cos(x) * amp[i] * freq[i];
  }
  return vec3f(h, d) * water.z;
}

@vertex
fn vs(@builtin(vertex_index) vi: u32) -> VOut {
  let res = 160u;
  let quad = vi / 6u;
  let corner = vi % 6u;
  var offs = array<vec2u, 6>(vec2u(0u, 0u), vec2u(1u, 0u), vec2u(1u, 1u), vec2u(0u, 0u), vec2u(1u, 1u), vec2u(0u, 1u));
  let cell = vec2u(quad % res, quad / res) + offs[corner];
  // grid follows the camera (snapped) so detail stays where the player looks
  let span = water.y;
  let step = span / f32(res);
  let snap = floor(frame.camPos.xz / step) * step;
  var p = snap + (vec2f(cell) / f32(res) - 0.5) * span;
  let w = waves(p, frame.time.x);
  var o: VOut;
  o.world = vec3f(p.x, water.x + w.x, p.y);
  o.pos = frame.viewProj * vec4f(o.world, 1.0);
  return o;
}

fn detailNormal(p: vec2f, t: f32) -> vec2f {
  let e = 0.05;
  let a = vnoise(p * 1.7 + vec2f(t * 0.45, t * 0.2)) + vnoise(p * 4.3 - vec2f(t * 0.3, t * 0.55)) * 0.5;
  let bx = vnoise((p + vec2f(e, 0.0)) * 1.7 + vec2f(t * 0.45, t * 0.2)) + vnoise((p + vec2f(e, 0.0)) * 4.3 - vec2f(t * 0.3, t * 0.55)) * 0.5;
  let bz = vnoise((p + vec2f(0.0, e)) * 1.7 + vec2f(t * 0.45, t * 0.2)) + vnoise((p + vec2f(0.0, e)) * 4.3 - vec2f(t * 0.3, t * 0.55)) * 0.5;
  return vec2f(bx - a, bz - a) / e;
}

fn screenUV(world: vec3f) -> vec3f {
  let c = frame.viewProj * vec4f(world, 1.0);
  let ndc = c.xyz / c.w;
  return vec3f(ndc.x * 0.5 + 0.5, 0.5 - ndc.y * 0.5, ndc.z);
}

@fragment
fn fs(in: VOut) -> @location(0) vec4f {
  let size = vec2f(textureDimensions(sceneDepth));
  let uv = in.pos.xy / size;
  let t = frame.time.x;
  let w = waves(in.world.xz, t);
  let dist = length(in.world - frame.camPos.xyz);
  let detail = detailNormal(in.world.xz, t) * mix(0.35, 0.08, clamp(dist / 80.0, 0.0, 1.0)) * (0.4 + frame.time.w);
  // raindrops ring the surface near the camera
  let rip = rainRipples(in.world.xz, frame.weatherFx.y) * (1.0 - smoothstep(20.0, 40.0, dist)) * (1.0 - water.w);
  let n = normalize(vec3f(-w.y - detail.x + rip.x, 1.0, -w.z - detail.y + rip.y));
  let v = normalize(frame.camPos.xyz - in.world);
  // specular anti-aliasing: ripples smaller than a pixel widen the highlights instead of sparkling
  let dnx = dpdx(n);
  let dny = dpdy(n);
  let normalVariance = min(2.0 * (dot(dnx, dnx) + dot(dny, dny)), 0.3);

  let sceneD = textureLoad(sceneDepth, vec2i(in.pos.xy), 0);
  let sceneDist = linearDepth(sceneD);
  let waterDist = linearDepth(in.pos.z);
  let thickness = max(sceneDist - waterDist, 0.0);

  if (water.w > 0.5) {
    // lava: dark cooling crust plates separated by glowing, slowly flowing cracks
    let p = in.world.xz;
    let flow = vec2f(t * 0.03, -t * 0.02);
    let plates = fbm(p * 0.22 + flow, 5);
    let cells = abs(fbm(p * 0.6 - flow * 1.7, 4) - 0.5) * 2.0;
    let crack = (1.0 - smoothstep(0.02, 0.16, cells)) * smoothstep(0.35, 0.6, plates);
    let pool = 1.0 - smoothstep(0.28, 0.42, plates);
    let heat = clamp(crack + pool, 0.0, 1.0);
    let pulse = 0.75 + 0.25 * sin(t * 1.3 + plates * 12.0);
    let hot = mix(frame.water.rgb * vec3f(0.9, 0.35, 0.15), vec3f(1.0, 0.55, 0.12), heat * heat);
    let glow = hot * heat * pulse * 2.6;
    let crustN = normalize(n + vec3f(plates - 0.5, 0.0, cells - 0.5) * 0.6);
    let rock = vec3f(0.05, 0.04, 0.035) * (0.3 + 0.7 * max(dot(crustN, frame.keyDir.xyz), 0.0)) * keyRadiance() * 0.2 + skyIrradiance(crustN) * 0.04;
    var col = mix(rock, glow, heat) + frame.water.rgb * 0.15 * (1.0 - heat);
    col = applyVolumetrics(col, uv, dist);
    return vec4f(col, 1.0);
  }

  // refraction with a check that the refracted sample is really under water
  let strength = clamp(thickness * 0.6, 0.0, 1.0) * 0.035;
  var ruv = uv + n.xz * strength;
  let rd = textureLoad(sceneDepth, vec2i(clamp(ruv * size, vec2f(0.0), size - 1.0)), 0);
  if (linearDepth(rd) < waterDist) { ruv = uv; }
  let refrDist = max(linearDepth(textureLoad(sceneDepth, vec2i(clamp(ruv * size, vec2f(0.0), size - 1.0)), 0)) - waterDist, 0.0);
  var refr = textureSampleLevel(sceneColor, linearSampler, ruv, 0.0).rgb;
  let absorb = (1.0 - frame.water.rgb) * 0.45 + vec3f(0.05, 0.02, 0.01);
  let trans = exp(-absorb * refrDist);
  let irr = ambientIrradiance(in.world, vec3f(0.0, 1.0, 0.0)) + keyRadiance() * max(frame.keyDir.y, 0.0) * 0.12;
  let inscatter = frame.water.rgb * irr * 0.9;
  refr = refr * trans + inscatter * (1.0 - trans);

  // reflections: screen-space march, falling back to the physical sky
  let r = reflect(-v, n);
  let rsky = normalize(vec3f(r.x, max(r.y, 0.01), r.z));
  var refl = applyClouds(skyLUT(rsky), rsky);
  var hit = 0.0;
  var stepLen = 0.6;
  var pos = in.world + r * 0.3;
  for (var i = 0; i < 24; i++) {
    pos += r * stepLen;
    stepLen *= 1.18;
    let s = screenUV(pos);
    if (any(s.xy < vec2f(0.0)) || any(s.xy > vec2f(1.0))) { break; }
    let d = textureLoad(sceneDepth, vec2i(s.xy * size), 0);
    if (d > s.z) {
      let behind = linearDepth(s.z) - linearDepth(d);
      if (behind < stepLen * 2.0 + 0.5) {
        let edge = smoothstep(0.0, 0.1, min(min(s.x, 1.0 - s.x), min(s.y, 1.0 - s.y)));
        refl = mix(refl, textureSampleLevel(sceneColor, linearSampler, s.xy, 0.0).rgb, edge);
        hit = 1.0;
      }
      break;
    }
  }
  let NoV = max(dot(n, v), 0.0);
  let fres = 0.02 + 0.98 * pow(1.0 - NoV, 5.0);
  var col = mix(refr, refl, fres);
  // sun / moon glint
  let h = normalize(v + frame.keyDir.xyz);
  let glintA = sqrt(0.012 * 0.012 + normalVariance);
  let spec = D_GGX(max(dot(n, h), 0.0), glintA) * 0.25 * (0.012 / glintA);
  col += keyRadiance() * spec * shadowAt(in.world, vec3f(0.0, 1.0, 0.0), in.pos.xy) * fres * 4.0;
  col += pointLights(makeSurface(vec3f(0.0), 0.0, sqrt(sqrt(0.08 * 0.08 * 0.08 * 0.08 + normalVariance)), n, v), in.world);
  // shoreline foam
  let foamNoise = fbm(in.world.xz * 1.6 + vec2f(t * 0.3, t * 0.1), 3);
  let foam = (1.0 - smoothstep(0.0, 0.7, thickness)) * smoothstep(0.35, 0.65, foamNoise + 0.25 * sin(t * 1.5 + thickness * 6.0));
  col = mix(col, vec3f(0.9) * (irr + keyRadiance() * max(frame.keyDir.y, 0.0) * 0.3), foam * 0.8);
  // soft edge where water meets the shore
  col = mix(textureSampleLevel(sceneColor, linearSampler, uv, 0.0).rgb, col, smoothstep(0.0, 0.08, thickness));
  col = applyVolumetrics(col, uv, dist);
  return vec4f(col, 1.0);
}
`;

export class Water {
  constructor(renderer) {
    const d = (this.device = renderer.device);
    this.renderer = renderer;
    this.level = 0;
    this.enabled = false;
    this.lava = false;
    this.span = 400;
    this.uniform = createBuffer(d, 16, GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST, 'water');
    this.layout = bindLayout(d, 'water', [['F', 'texture'], ['F', 'depth'], ['VF', 'uniform']]);
    const module = createShader(d, WATER_WGSL, 'water');
    this.pipeline = d.createRenderPipeline({
      label: 'water',
      layout: d.createPipelineLayout({ bindGroupLayouts: [renderer.globalLayout, this.layout] }),
      vertex: { module, entryPoint: 'vs' },
      fragment: { module, entryPoint: 'fs', targets: [{ format: 'rgba16float' }] },
      primitive: { topology: 'triangle-list', cullMode: 'none' },
      depthStencil: { format: 'depth32float', depthWriteEnabled: false, depthCompare: 'greater' },
    });
  }

  configure({ enabled, level, color, lava = false, span = 400, waves = 1 }) {
    this.enabled = enabled;
    this.level = level;
    this.lava = lava;
    this.span = span;
    this.waves = waves;
    this.renderer.waterParams = [...color, lava ? 1 : 0];
  }

  resize(iw, ih) {
    this.copy?.destroy();
    this.copy = texture2D(this.device, { width: iw, height: ih, format: 'rgba16float', usage: U.TEX | U.CDST, label: 'scene-copy' });
    this.group = bindGroup(this.device, this.layout, [this.copy.createView(), this.renderer.depthView, this.uniform]);
  }

  afterMain(encoder, r) {
    if (!this.enabled) return;
    this.device.queue.writeBuffer(this.uniform, 0, new Float32Array([this.level, this.span, (0.35 + r.env.wind * 0.9) * this.waves, this.lava ? 1 : 0]));
    encoder.copyTextureToTexture({ texture: r.hdr }, { texture: this.copy }, [r.internalW, r.internalH]);
    const pass = encoder.beginRenderPass({
      label: 'water',
      colorAttachments: [{ view: r.hdrView, loadOp: 'load', storeOp: 'store' }],
      depthStencilAttachment: { view: r.depthView, depthReadOnly: true },
    });
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, r.globalGroup);
    pass.setBindGroup(1, this.group);
    pass.draw(160 * 160 * 6);
    pass.end();
  }
}

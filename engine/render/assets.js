// Procedural asset library: characters, creatures and props built from
// smooth parts with multi-colour vertex paint, faces, and bone tags for the
// GPU skinning in wgsl/mesh.js (animateVertex).
//
// Vertex colour alpha 1 = tinted by the instance colour (use a grey to get a
// darker shade of it), alpha 0 = fixed colour. uv.x = bone / 16 (animated
// meshes) or 1 for a self-lit "lamp" part; uv.y = 1 for parts that never glow.
//
// Characters stand on y = 0 and are 1.8 m tall. Prefab shapes fit the unit
// cube [-0.5, 0.5]^3 like the primitives in meshes.js.

import { Geo, T, lathe, sphere, roundedBox, torus, cylinder, cone } from './meshes.js';

const TINT = [1, 1, 1, 1];
const shade = (k) => [k, k, k, 1];
const fixed = (r, g, b) => [r, g, b, 0];

const EYE = fixed(0.02, 0.02, 0.035);
const WHITE = fixed(1, 1, 1);
const CREAM = fixed(0.98, 0.9, 0.8);
const BLUSH = fixed(1, 0.5, 0.58);
const MOUTH = fixed(0.32, 0.08, 0.1);
const GOLD = fixed(1, 0.78, 0.3);
const WOOD = fixed(0.52, 0.33, 0.18);
const WOOD_DARK = fixed(0.34, 0.2, 0.1);
const IRON = fixed(0.22, 0.22, 0.25);
const STONE = fixed(0.46, 0.43, 0.4);

export const BONES = { root: 0, head: 1, armL: 2, armR: 3, legL: 4, legR: 5, wingL: 6, wingR: 7 };

/** Run build(g), then tag the vertices it added with a bone and glow flags. */
function part(g, build, { bone = 0, noGlow = false, lamp = false } = {}) {
  const start = g.vertexCount;
  build(g);
  for (let i = start; i < g.vertexCount; i++) {
    g.uvs[i * 2] = lamp ? 1 : bone / 16;
    g.uvs[i * 2 + 1] = noGlow ? 1 : 0;
  }
}

/** Ellipsoid at c with radii r, optionally rotated (radians about x, y, z). */
function blob(g, c, r, color, rot = [0, 0, 0], seg = 22, rings = 14) {
  g.merge(sphere(color, seg, rings), T.chain(T.scale(r[0] * 2, r[1] * 2, r[2] * 2), T.rotX(rot[0]), T.rotY(rot[1]), T.rotZ(rot[2]), T.translate(c[0], c[1], c[2])));
}

/** A tapered, rounded tube from p0 (radius r0) to p1 (radius r1). */
function tube(g, p0, p1, r0, r1, color, sides = 14) {
  const d = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
  const len = Math.hypot(...d) || 1e-4;
  const prof = [];
  for (let i = 0; i <= 5; i++) { const a = -Math.PI / 2 + (i / 5) * (Math.PI / 2); prof.push([Math.cos(a) * r0, Math.sin(a) * r0]); }
  for (let i = 0; i <= 5; i++) { const a = (i / 5) * (Math.PI / 2); prof.push([Math.cos(a) * r1, len + Math.sin(a) * r1]); }
  prof[0][0] = 0; prof[prof.length - 1][0] = 0;
  g.merge(lathe(prof, sides, color), T.chain(alignY(d.map((v) => v / len)), T.translate(p0[0], p0[1], p0[2])));
}

/** Transform that rotates +y onto unit direction d (Rodrigues). */
function alignY(d) {
  const [x, y, z] = d;
  const ax = [z, 0, -x];
  const s = Math.hypot(ax[0], ax[2]);
  const c = y;
  if (s < 1e-6) return c > 0 ? () => {} : (p, n) => { p[1] = -p[1]; p[2] = -p[2]; n[1] = -n[1]; n[2] = -n[2]; };
  const k = [ax[0] / s, 0, ax[2] / s];
  const rot = (v) => {
    const dot = k[0] * v[0] + k[2] * v[2];
    const cr = [k[1] * v[2] - k[2] * v[1], k[2] * v[0] - k[0] * v[2], k[0] * v[1] - k[1] * v[0]];
    for (let i = 0; i < 3; i++) v[i] = v[i] * c + cr[i] * s + k[i] * dot * (1 - c);
  };
  return (p, n) => { rot(p); rot(n); };
}

/** Big friendly eyes with highlights, a mouth and cheeks, on a face looking down +z. */
function face(g, { y, z, spread = 0.1, size = 1, bone = 0, mouth = true, cheeks = true, angry = false }) {
  part(g, (g) => {
    for (const s of [-1, 1]) {
      blob(g, [s * spread, y, z], [0.052 * size, 0.07 * size, 0.03 * size], EYE, [0, s * 0.25, 0], 16, 10);
      blob(g, [s * spread - 0.014 * size, y + 0.024 * size, z + 0.027 * size], [0.017 * size, 0.017 * size, 0.01 * size], WHITE, [0, 0, 0], 10, 6);
      if (angry) blob(g, [s * spread * 1.05, y + 0.085 * size, z + 0.005], [0.06 * size, 0.014 * size, 0.012 * size], EYE, [0, 0, s * 0.45], 10, 6);
      if (cheeks) blob(g, [s * spread * 1.75, y - 0.07 * size, z - 0.02], [0.042 * size, 0.024 * size, 0.012 * size], BLUSH, [0, s * 0.5, 0], 10, 6);
    }
    if (mouth) blob(g, [0, y - 0.1 * size, z + 0.005], [0.032 * size, angry ? 0.018 * size : 0.012 * size, 0.012 * size], MOUTH, [0, 0, 0], 10, 6);
  }, { bone, noGlow: true });
}

// ---------------------------------------------------------------- characters

/** Pick a look for a character from its role, e.g. "a wizard" -> hat. */
export function characterStyle(text = '', name = '') {
  const t = ` ${String(text).toLowerCase()} `;
  const pick = (words) => words.some((w) => t.includes(w));
  if (pick(['wizard', 'witch', 'mage', 'sorcer', 'merchant', 'scholar', 'alchem'])) return 'hat';
  if (pick(['king', 'queen', 'prince', 'princess', 'keeper', 'royal', 'lord', 'lady'])) return 'crown';
  if (pick(['hedgehog', 'fox', 'cat', 'rabbit', 'bunny', 'bear', 'mouse', 'parrot', 'owl', 'toad', 'frog', 'salamander', 'creature', 'animal'])) return 'ears';
  if (pick(['ghost', 'spirit', 'phantom', 'wraith'])) return 'halo';
  if (pick(['tree', 'forest', 'druid', 'moss', 'root', 'leaf', 'garden'])) return 'sprout';
  if (pick(['demon', 'devil', 'dragon', 'fire', 'lava', 'hot-headed', 'salaman'])) return 'horns';
  if (pick(['ranger', 'scout', 'hunter', 'thief', 'rogue', 'hacker', 'guide', 'hermit', 'miner', 'wander'])) return 'hood';
  if (pick(['robot', 'android', 'alien', 'scientist', 'cyber'])) return 'antenna';
  const styles = ['hood', 'hat', 'ears', 'sprout', 'antenna'];
  let h = 0;
  for (const ch of String(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return styles[h % styles.length];
}

/**
 * A stylised humanoid: big head with a face, rounded body, arms, legs, hands
 * and boots, plus an accessory. Bones: root, head, arms, legs.
 */
export function humanoidMesh(style = 'hero') {
  const g = new Geo();
  const B = BONES;
  // body: a soft pear with a darker belt
  part(g, (g) => {
    g.merge(lathe([[0, 0.5], [0.19, 0.51], [0.27, 0.58], [0.3, 0.72], [0.28, 0.88], [0.22, 1.0], [0.12, 1.07], [0, 1.09]], 22, TINT));
    g.merge(torus(shade(0.5), 24, 8), T.chain(T.rotX(Math.PI / 2), T.scale(0.78, 0.25, 0.72), T.translate(0, 0.62, 0)));
    blob(g, [0, 0.63, 0.25], [0.05, 0.045, 0.03], GOLD, [0, 0, 0], 10, 6);
  }, { bone: B.root });
  // legs and boots
  for (const [s, bone] of [[-1, B.legL], [1, B.legR]]) {
    part(g, (g) => {
      tube(g, [s * 0.13, 0.56, 0], [s * 0.14, 0.16, 0.0], 0.095, 0.08, shade(0.62));
      blob(g, [s * 0.14, 0.085, 0.05], [0.1, 0.085, 0.155], shade(0.32), [0.12, 0, 0]);
    }, { bone });
  }
  // arms and hands
  for (const [s, bone] of [[-1, B.armL], [1, B.armR]]) {
    part(g, (g) => {
      tube(g, [s * 0.25, 0.97, 0], [s * 0.34, 0.66, 0.02], 0.075, 0.062, TINT);
      blob(g, [s * 0.355, 0.6, 0.03], [0.078, 0.085, 0.072], CREAM);
    }, { bone });
  }
  // head: tinted cap around a cream face
  part(g, (g) => {
    blob(g, [0, 1.42, 0], [0.34, 0.32, 0.31], TINT, [0, 0, 0], 28, 18);
    blob(g, [0, 1.37, 0.12], [0.27, 0.23, 0.22], CREAM, [0, 0, 0], 24, 16);
  }, { bone: B.head });
  face(g, { y: 1.41, z: 0.325, spread: 0.1, bone: B.head });
  accessory(g, style);
  return g;
}

function accessory(g, style) {
  const head = { bone: BONES.head };
  switch (style) {
    case 'hat':
      part(g, (g) => {
        g.merge(lathe([[0, 0], [0.44, 0], [0.46, 0.02], [0.44, 0.04], [0.26, 0.05], [0.2, 0.22], [0.12, 0.42], [0.04, 0.58], [0, 0.6]], 26, shade(0.55)), T.chain(T.rotZ(-0.12), T.translate(0.02, 1.62, -0.02)));
        g.merge(torus(GOLD, 24, 8), T.chain(T.rotX(Math.PI / 2), T.scale(0.66, 0.2, 0.66), T.translate(0.02, 1.68, -0.02)));
      }, head);
      break;
    case 'crown':
      part(g, (g) => {
        g.merge(lathe([[0.2, 0], [0.22, 0], [0.22, 0.1], [0.2, 0.1]], 24, GOLD), T.translate(0, 1.68, 0));
        for (let i = 0; i < 5; i++) {
          const a = (i / 5) * Math.PI * 2;
          g.merge(cone(GOLD, 8), T.chain(T.scale(0.07, 0.12, 0.07), T.translate(Math.sin(a) * 0.2, 1.83, Math.cos(a) * 0.2)));
          blob(g, [Math.sin(a) * 0.23, 1.72, Math.cos(a) * 0.23], [0.025, 0.025, 0.015], fixed(0.9, 0.15, 0.3), [0, a, 0], 8, 5);
        }
      }, head);
      break;
    case 'ears':
      part(g, (g) => {
        for (const s of [-1, 1]) {
          blob(g, [s * 0.2, 1.72, -0.02], [0.08, 0.13, 0.05], TINT, [0, 0, -s * 0.35]);
          blob(g, [s * 0.2, 1.72, 0.015], [0.045, 0.085, 0.02], BLUSH, [0, 0, -s * 0.35], 12, 8);
        }
      }, head);
      break;
    case 'halo':
      part(g, (g) => g.merge(torus(fixed(1, 0.95, 0.7), 32, 8), T.chain(T.rotX(Math.PI / 2), T.scale(0.6, 0.12, 0.6), T.translate(0, 1.86, 0))), { ...head, lamp: true });
      break;
    case 'sprout':
      part(g, (g) => {
        tube(g, [0, 1.72, 0], [0.02, 1.9, 0], 0.018, 0.014, fixed(0.35, 0.6, 0.2), 8);
        blob(g, [-0.08, 1.93, 0], [0.09, 0.03, 0.05], fixed(0.4, 0.78, 0.25), [0, 0, 0.5], 12, 8);
        blob(g, [0.1, 1.95, 0], [0.09, 0.03, 0.05], fixed(0.45, 0.82, 0.3), [0, 0, -0.5], 12, 8);
      }, head);
      break;
    case 'horns':
      part(g, (g) => {
        for (const s of [-1, 1]) g.merge(cone(fixed(0.95, 0.9, 0.8), 10), T.chain(T.scale(0.09, 0.22, 0.09), T.rotZ(-s * 0.5), T.translate(s * 0.2, 1.74, 0)));
      }, head);
      break;
    case 'hood':
      part(g, (g) => {
        blob(g, [0, 1.46, -0.05], [0.37, 0.35, 0.33], shade(0.6), [0.15, 0, 0], 24, 16);
        g.merge(cone(shade(0.6), 12), T.chain(T.scale(0.2, 0.3, 0.2), T.rotX(-1.9), T.translate(0, 1.55, -0.34)));
        g.merge(torus(shade(0.45), 26, 8), T.chain(T.scale(0.72, 0.72, 0.5), T.translate(0, 1.4, 0.2)));
      }, head);
      break;
    case 'antenna':
      part(g, (g) => tube(g, [0.05, 1.7, 0], [0.12, 1.95, -0.02], 0.016, 0.012, IRON, 8), head);
      part(g, (g) => blob(g, [0.125, 1.98, -0.02], [0.05, 0.05, 0.05], fixed(0.5, 1, 0.9), [0, 0, 0], 12, 8), { ...head, lamp: true });
      break;
    default: // hero: a jaunty tuft and a scarf
      part(g, (g) => {
        blob(g, [0.02, 1.74, 0.02], [0.08, 0.1, 0.06], shade(0.8), [0.3, 0, -0.4], 14, 10);
        blob(g, [-0.08, 1.72, 0.04], [0.06, 0.08, 0.05], shade(0.8), [0.2, 0, 0.5], 14, 10);
      }, head);
      part(g, (g) => {
        g.merge(torus(fixed(0.95, 0.35, 0.3), 26, 10), T.chain(T.rotX(Math.PI / 2), T.scale(0.62, 0.3, 0.6), T.translate(0, 1.08, 0)));
        tube(g, [0.12, 1.06, -0.2], [0.2, 0.84, -0.3], 0.045, 0.035, fixed(0.95, 0.35, 0.3), 8);
      }, { bone: BONES.root });
  }
}

// ---------------------------------------------------------------- creatures (unit cube)

/** A glossy jelly blob with a face. */
function slime() {
  const g = new Geo();
  const prof = [];
  for (let i = 0; i <= 14; i++) {
    const a = (i / 14) * Math.PI;
    const r = Math.sin(a) * (0.5 - 0.05 * Math.cos(a));
    prof.push([r, -0.5 + (1 - Math.cos(a)) * 0.44 - Math.max(0, Math.sin(a * 2)) * 0.03]);
  }
  prof[0][0] = 0; prof[14][0] = 0;
  part(g, (g) => g.merge(lathe(prof, 28, TINT)));
  part(g, (g) => blob(g, [0.16, 0.12, 0.2], [0.09, 0.06, 0.04], fixed(1, 1, 1), [0.5, 0.4, 0], 10, 6));
  face(g, { y: -0.02, z: 0.43, spread: 0.13, size: 1.3, cheeks: false });
  return g;
}

/** A floating sheet ghost with a wavy hem and hollow eyes. */
function ghost() {
  const g = new Geo();
  const prof = [[0, -0.5]];
  for (let i = 0; i <= 10; i++) {
    const a = (i / 10) * (Math.PI / 2);
    prof.push([0.36 + Math.sin(a) * 0.02, -0.46 + i * 0.05]);
  }
  for (let i = 0; i <= 10; i++) { const a = (i / 10) * (Math.PI / 2); prof.push([Math.cos(a) * 0.38, 0.1 + Math.sin(a) * 0.38]); }
  prof[prof.length - 1][0] = 0;
  const body = lathe(prof, 30, TINT);
  // wavy hem: ripple the bottom rows
  for (let i = 0; i < body.vertexCount; i++) {
    const y = body.positions[i * 3 + 1];
    if (y < -0.3) {
      const x = body.positions[i * 3], z = body.positions[i * 3 + 2];
      const a = Math.atan2(z, x);
      body.positions[i * 3 + 1] = y + Math.sin(a * 7) * 0.05 * (-0.3 - y) / 0.2;
      const flare = 1 + (-0.3 - y) * 0.6;
      body.positions[i * 3] = x * flare; body.positions[i * 3 + 2] = z * flare;
    }
  }
  part(g, (g) => g.merge(body));
  part(g, (g) => {
    for (const s of [-1, 1]) blob(g, [s * 0.12, 0.2, 0.32], [0.07, 0.1, 0.05], EYE, [0, s * 0.3, 0], 14, 8);
    blob(g, [0, 0.02, 0.35], [0.06, 0.07, 0.04], EYE, [0, 0, 0], 12, 8);
  }, { noGlow: true });
  for (const [s, bone] of [[-1, BONES.armL], [1, BONES.armR]]) {
    part(g, (g) => tube(g, [s * 0.3, 0.02, 0.05], [s * 0.46, -0.12, 0.14], 0.06, 0.035, TINT, 10), { bone });
  }
  return g;
}

/** A round critter: ears, big eyes, little fangs and feet. */
function critter() {
  const g = new Geo();
  part(g, (g) => {
    blob(g, [0, 0, 0], [0.42, 0.4, 0.4], TINT, [0, 0, 0], 26, 18);
    blob(g, [0, -0.08, 0.2], [0.26, 0.22, 0.22], shade(1.0), [0, 0, 0], 18, 12);
    for (const s of [-1, 1]) {
      g.merge(cone(shade(0.7), 10), T.chain(T.scale(0.14, 0.26, 0.1), T.rotZ(-s * 0.4), T.translate(s * 0.26, 0.4, -0.02)));
    }
  });
  part(g, (g) => {
    for (const s of [-1, 1]) g.merge(cone(WHITE, 8), T.chain(T.scale(0.05, 0.08, 0.05), T.rotX(Math.PI), T.translate(s * 0.07, -0.16, 0.37)));
  }, { noGlow: true });
  face(g, { y: 0.1, z: 0.37, spread: 0.14, size: 1.35, mouth: true, cheeks: false, angry: true });
  for (const [s, bone] of [[-1, BONES.legL], [1, BONES.legR]]) {
    part(g, (g) => blob(g, [s * 0.18, -0.44, 0.06], [0.12, 0.07, 0.15], shade(0.6)), { bone });
  }
  return new Geo().merge(g, T.translate(0, 0.02, 0));
}

/** A bat: furry body, big ears, membrane wings that flap (bones 6/7). */
function bat() {
  const g = new Geo();
  part(g, (g) => {
    blob(g, [0, 0, 0], [0.2, 0.22, 0.2], TINT, [0, 0, 0], 20, 14);
    for (const s of [-1, 1]) g.merge(cone(TINT, 10), T.chain(T.scale(0.1, 0.2, 0.08), T.rotZ(-s * 0.3), T.translate(s * 0.1, 0.25, 0)));
  });
  face(g, { y: 0.03, z: 0.18, spread: 0.07, size: 0.8, cheeks: false, angry: true });
  for (const [s, bone] of [[-1, BONES.wingL], [1, BONES.wingR]]) {
    part(g, (g) => {
      const w = new Geo();
      // scalloped membrane from the shoulder outwards
      const pts = [];
      for (let i = 0; i <= 8; i++) {
        const u = i / 8;
        const x = 0.14 + u * 0.36;
        const top = 0.12 + Math.sin(u * Math.PI) * 0.1 - u * 0.05;
        const bottom = -0.12 + u * 0.06 + Math.abs(Math.sin(u * Math.PI * 3)) * 0.08;
        pts.push([x, top, bottom]);
      }
      for (const side of [1, -1]) {
        const ids = [];
        for (const [x, top, bottom] of pts) {
          ids.push([w.vertex(s * x, top, 0, 0, 0.2, side, shade(0.55)), w.vertex(s * x, bottom, 0, 0, 0.2, side, shade(0.55))]);
        }
        for (let i = 0; i < ids.length - 1; i++) side > 0 ? w.quad(ids[i][0], ids[i + 1][0], ids[i + 1][1], ids[i][1]) : w.quad(ids[i][0], ids[i][1], ids[i + 1][1], ids[i + 1][0]);
      }
      g.merge(w);
      tube(g, [s * 0.14, 0.12, 0], [s * 0.5, 0.07, 0], 0.02, 0.012, shade(0.4), 6);
    }, { bone });
  }
  return new Geo().merge(g, T.scale(1.3, 1.3, 1.3));
}

/** A hovering robot drone: rounded shell, glowing visor, antenna, side pods. */
function robot() {
  const g = new Geo();
  part(g, (g) => {
    g.merge(roundedBox(TINT, 0.12), T.scale(0.78, 0.66, 0.7));
    g.merge(roundedBox(IRON, 0.08), T.chain(T.scale(0.6, 0.28, 0.1), T.translate(0, 0.05, 0.33)));
    for (const s of [-1, 1]) {
      g.merge(cylinder(shade(0.6), 16), T.chain(T.rotZ(Math.PI / 2), T.scale(0.12, 0.26, 0.26), T.translate(s * 0.44, 0, 0)));
    }
    tube(g, [0.1, 0.33, 0], [0.16, 0.5, -0.04], 0.02, 0.015, IRON, 8);
  });
  part(g, (g) => {
    for (const s of [-1, 1]) blob(g, [s * 0.13, 0.06, 0.39], [0.07, 0.05, 0.02], fixed(0.4, 1, 0.9), [0, 0, 0], 12, 8);
    blob(g, [0.165, 0.52, -0.04], [0.04, 0.04, 0.04], fixed(1, 0.3, 0.3), [0, 0, 0], 10, 6);
  }, { lamp: true });
  return g;
}

// ---------------------------------------------------------------- props and collectibles (unit cube)

function mushroom() {
  const g = new Geo();
  part(g, (g) => g.merge(lathe([[0, -0.5], [0.13, -0.5], [0.15, -0.45], [0.12, -0.2], [0.11, 0.02], [0.15, 0.06], [0, 0.06]], 16, CREAM)), { noGlow: true });
  part(g, (g) => {
    g.merge(lathe([[0, 0.0], [0.34, 0.0], [0.44, 0.04], [0.5, 0.1], [0.48, 0.2], [0.4, 0.33], [0.24, 0.45], [0, 0.5]], 28, TINT));
    g.merge(lathe([[0.1, 0.02], [0.42, 0.04], [0.42, 0.04]], 28, shade(0.7)));
  });
  part(g, (g) => {
    const spots = [[0.25, 0.3, 0.6], [-0.2, 0.36, 2.1], [0.05, 0.44, 3.4], [-0.3, 0.2, 4.4], [0.34, 0.16, 5.4], [0.12, 0.28, 1.2]];
    for (const [r, y, a] of spots) {
      const x = Math.cos(a) * Math.abs(r) * 1.2, z = Math.sin(a) * Math.abs(r) * 1.2;
      const n = [x, y + 0.1, z];
      const l = Math.hypot(...n);
      blob(g, [x, y + 0.035, z], [0.07, 0.022, 0.07], fixed(1, 0.98, 0.92), [Math.atan2(n[2], n[1]), 0, -Math.atan2(n[0], n[1])], 12, 6);
      void l;
    }
  }, { noGlow: true });
  return g;
}

function heart() {
  const g = new Geo();
  const w = new Geo();
  // an implicit-looking heart from two lobes and a rounded point
  for (const s of [-1, 1]) blob(w, [s * 0.2, 0.15, 0], [0.28, 0.28, 0.2], TINT, [0, 0, 0], 24, 16);
  w.merge(cone(TINT, 24), T.chain(T.scale(0.66, 0.62, 0.36), T.rotX(Math.PI), T.translate(0, -0.2, 0)));
  part(g, (g) => g.merge(w));
  part(g, (g) => blob(g, [-0.2, 0.28, 0.16], [0.07, 0.05, 0.03], fixed(1, 1, 1), [0, 0, 0.6], 10, 6));
  return g;
}

function orb() {
  const g = new Geo();
  part(g, (g) => blob(g, [0, 0, 0], [0.3, 0.3, 0.3], TINT, [0, 0, 0], 24, 16));
  part(g, (g) => blob(g, [0, 0, 0], [0.16, 0.16, 0.16], TINT, [0, 0, 0], 14, 10), { lamp: true });
  part(g, (g) => {
    g.merge(torus(shade(0.8), 40, 8), T.chain(T.scale(1.25, 1.25, 0.25), T.rotX(1.2)));
    g.merge(torus(shade(0.8), 40, 8), T.chain(T.scale(1.1, 1.1, 0.2), T.rotY(1.1), T.rotX(-0.5)));
  });
  return g;
}

function key() {
  const g = new Geo();
  part(g, (g) => {
    g.merge(torus(TINT, 32, 10), T.chain(T.scale(0.7, 0.7, 0.9), T.translate(0, 0.24, 0)));
    g.merge(cylinder(TINT, 14), T.chain(T.scale(0.1, 0.62, 0.1), T.translate(0, -0.15, 0)));
    g.merge(roundedBox(TINT, 0.1), T.chain(T.scale(0.18, 0.08, 0.07), T.translate(0.12, -0.34, 0)));
    g.merge(roundedBox(TINT, 0.1), T.chain(T.scale(0.13, 0.07, 0.07), T.translate(0.1, -0.2, 0)));
    blob(g, [0, 0.24, 0], [0.08, 0.08, 0.05], fixed(0.3, 0.8, 1), [0, 0, 0], 12, 8);
  });
  return g;
}

function chest() {
  const g = new Geo();
  part(g, (g) => {
    g.merge(roundedBox(WOOD, 0.04), T.chain(T.scale(1, 0.55, 0.7), T.translate(0, -0.22, 0)));
    // curved lid
    const lid = lathe([[0, -0.5], [0.35, -0.5], [0.35, -0.5], [0.35, 0.5], [0.35, 0.5], [0, 0.5]], 20, WOOD_DARK);
    g.merge(lid, T.chain(T.rotZ(Math.PI / 2), T.scale(1, 1, 1), T.translate(0, 0.08, 0)));
  }, { noGlow: true });
  part(g, (g) => {
    for (const x of [-0.36, 0.36]) {
      g.merge(roundedBox(TINT, 0.2), T.chain(T.scale(0.08, 0.57, 0.72), T.translate(x, -0.22, 0)));
      g.merge(torus(TINT, 24, 6), T.chain(T.rotY(Math.PI / 2), T.scale(0.06, 0.9, 0.9), T.translate(x, 0.08, 0)));
    }
    g.merge(roundedBox(TINT, 0.2), T.chain(T.scale(0.14, 0.18, 0.06), T.translate(0, 0.02, 0.36)));
  });
  part(g, (g) => blob(g, [0, 0.12, 0.2], [0.3, 0.1, 0.12], GOLD, [0, 0, 0], 16, 8), { lamp: true });
  return g;
}

function crate() {
  const g = new Geo();
  part(g, (g) => {
    g.merge(roundedBox(shade(0.9), 0.03), T.scale(0.94, 0.94, 0.94));
    // frame planks and a diagonal brace on every side
    for (const [ax, rot] of [[0, 0], [1, Math.PI / 2], [2, Math.PI], [3, -Math.PI / 2]]) {
      const tr = (fn) => T.chain(fn, T.rotY(rot));
      g.merge(roundedBox(shade(0.62), 0.2), tr(T.chain(T.scale(1, 0.12, 0.06), T.translate(0, 0.44, 0.47))));
      g.merge(roundedBox(shade(0.62), 0.2), tr(T.chain(T.scale(1, 0.12, 0.06), T.translate(0, -0.44, 0.47))));
      g.merge(roundedBox(shade(0.62), 0.2), tr(T.chain(T.scale(0.1, 1, 0.06), T.translate(0.45, 0, 0.47))));
      g.merge(roundedBox(shade(0.62), 0.2), tr(T.chain(T.scale(0.12, 1.1, 0.05), T.rotZ(0.78), T.translate(0, 0, 0.47))));
      void ax;
    }
  });
  return g;
}

function barrel() {
  const g = new Geo();
  const prof = [];
  for (let i = 0; i <= 10; i++) { const y = -0.5 + i / 10; prof.push([0.38 + Math.cos((y) * Math.PI) * 0.1, y]); }
  prof.unshift([0, -0.5]); prof.push([0, 0.5]);
  part(g, (g) => g.merge(lathe(prof, 26, TINT)));
  part(g, (g) => {
    for (const y of [-0.36, 0.36, -0.12, 0.12]) g.merge(torus(IRON, 30, 6), T.chain(T.rotX(Math.PI / 2), T.scale(1.26 + Math.cos(y * Math.PI) * 0.26, 0.12, 1.26 + Math.cos(y * Math.PI) * 0.26), T.translate(0, y, 0)));
  }, { noGlow: true });
  return g;
}

function lantern() {
  const g = new Geo();
  part(g, (g) => {
    g.merge(lathe([[0, -0.5], [0.3, -0.5], [0.3, -0.42], [0.22, -0.4], [0.22, -0.4], [0, -0.4]], 8, IRON));
    g.merge(lathe([[0, 0.2], [0.26, 0.2], [0.26, 0.24], [0.1, 0.36], [0, 0.38]], 8, IRON));
    for (let i = 0; i < 4; i++) {
      const a = (i / 4) * Math.PI * 2 + Math.PI / 4;
      tube(g, [Math.cos(a) * 0.21, -0.42, Math.sin(a) * 0.21], [Math.cos(a) * 0.21, 0.21, Math.sin(a) * 0.21], 0.025, 0.025, IRON, 6);
    }
    g.merge(torus(IRON, 20, 6), T.chain(T.scale(0.3, 0.3, 0.3), T.translate(0, 0.46, 0)));
  }, { noGlow: true });
  part(g, (g) => blob(g, [0, -0.1, 0], [0.18, 0.28, 0.18], TINT, [0, 0, 0], 16, 12), { lamp: true });
  return g;
}

/** A floating island chunk: grassy top (tinted) over a rocky, root-hung underside. */
function island() {
  const g = new Geo();
  const top = [];
  for (let i = 0; i <= 3; i++) top.push([0.5 - Math.pow(i / 3, 3) * 0.02, 0.5 - i * 0.03]);
  part(g, (g) => g.merge(lathe([[0, 0.5], ...top.reverse().map(([r, y]) => [r, y]).reverse()].slice(0).reverse().concat([[0.5, 0.41], [0.49, 0.38]]).reverse(), 30, TINT)));
  const rock = lathe([[0.48, 0.38], [0.46, 0.25], [0.4, 0.1], [0.3, -0.12], [0.18, -0.34], [0.06, -0.48], [0, -0.5]], 30, STONE);
  // lumpy underside
  for (let i = 0; i < rock.vertexCount; i++) {
    const x = rock.positions[i * 3], y = rock.positions[i * 3 + 1], z = rock.positions[i * 3 + 2];
    const a = Math.atan2(z, x);
    const k = 1 + Math.sin(a * 5 + y * 9) * 0.07 + Math.sin(a * 11 - y * 5) * 0.04;
    if (y < 0.37) { rock.positions[i * 3] = x * k; rock.positions[i * 3 + 2] = z * k; }
  }
  part(g, (g) => g.merge(rock), { noGlow: true });
  part(g, (g) => {
    for (let i = 0; i < 7; i++) {
      const a = i * 2.1, r = 0.3 + (i % 3) * 0.05;
      tube(g, [Math.cos(a) * r * 0.9, 0.2, Math.sin(a) * r * 0.9], [Math.cos(a) * r * 0.5, -0.2 - (i % 2) * 0.12, Math.sin(a) * r * 0.5], 0.02, 0.008, WOOD_DARK, 5);
    }
  }, { noGlow: true });
  return g;
}

function gift() {
  const g = new Geo();
  part(g, (g) => g.merge(roundedBox(TINT, 0.05), T.scale(0.9, 0.8, 0.9)));
  part(g, (g) => {
    const ribbon = fixed(1, 0.92, 0.55);
    g.merge(roundedBox(ribbon, 0.2), T.scale(0.93, 0.83, 0.16));
    g.merge(roundedBox(ribbon, 0.2), T.scale(0.16, 0.83, 0.93));
    for (const s of [-1, 1]) g.merge(torus(ribbon, 20, 8), T.chain(T.scale(0.45, 0.4, 0.6), T.rotY(Math.PI / 2), T.rotZ(s * 0.5), T.translate(s * 0.1, 0.46, 0)));
  }, { noGlow: true });
  return g;
}

function pumpkin() {
  const g = new Geo();
  const w = sphere(TINT, 36, 16);
  for (let i = 0; i < w.vertexCount; i++) {
    const x = w.positions[i * 3], z = w.positions[i * 3 + 2];
    const k = 1 - 0.07 * Math.pow(Math.abs(Math.cos(Math.atan2(z, x) * 4)), 0.5);
    w.positions[i * 3] = x * k * 1.15; w.positions[i * 3 + 2] = z * k * 1.15; w.positions[i * 3 + 1] *= 0.85;
  }
  part(g, (g) => g.merge(w));
  part(g, (g) => tube(g, [0, 0.36, 0], [0.05, 0.52, 0.02], 0.05, 0.035, fixed(0.3, 0.45, 0.15), 8), { noGlow: true });
  return g;
}

/** Builders for prefab shapes, keyed by shape name. */
export const ASSET_SHAPES = {
  slime, ghost, critter, bat, robot,
  mushroom, heart, orb, key, chest, crate, barrel, lantern, island, gift, pumpkin,
};
/** Shapes with skinned parts (drawn with the animated vertex path). */
export const ANIMATED_SHAPES = new Set(['ghost', 'critter', 'bat']);

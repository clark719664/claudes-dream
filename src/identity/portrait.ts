/**
 * Faces. Every citizen of Reverie has one, drawn as a small SVG from what the
 * city can see of them.
 *
 * Three rules shape this file:
 *
 * - **No rng.** A portrait is a pure function of stable data, so it can be
 *   drawn outside a tick, on a server thread, or twice in a row, without
 *   moving the world's random stream by a single step.
 * - **No `personality`.** A citizen's rolled traits are its own business
 *   (`docs/PRINCIPLES.md` §2). A face is built from public things: lineage,
 *   family name, the character the city has read off their deeds, their
 *   hobbies, their office, their life stage, their health and their company.
 * - **Children look like their parents.** A citizen born in the city takes
 *   each colour of its palette from one parent or the other, so a family
 *   resemblance runs down the generations without anyone being told to draw it.
 *
 * The character reading is quantised into three temperatures before it touches
 * a colour, so a face warms or cools over a life rather than flickering with
 * every day's arithmetic.
 */
import type { Citizen, CitizenId, Hobby, World } from '../types.ts';
import { characterOf } from '../citizens/character.ts';

/** The side of the square a portrait is drawn on, and its viewBox. */
export const PORTRAIT_SIZE = 96;
const VIEW = 96;

export interface Palette {
  skin: string;
  hair: string;
  cloth: string;
  ink: string;
  ground: string;
}

interface PaletteFamily {
  name: string;
  /** Four skins, chosen by the family hash. */
  skins: [string, string, string, string];
  /** Four hairs. */
  hairs: [string, string, string, string];
  /** Six cloths: two shades for each of the three temperatures, coolest first. */
  cloths: [string, string, string, string, string, string];
  /** Two inks (the line the face is drawn in). */
  inks: [string, string];
  /** Six grounds, coolest first, the same shape as the cloths. */
  grounds: [string, string, string, string, string, string];
}

/**
 * Six palette families. A citizen's lineage and family name pick one, so
 * everyone of a house is recognisably of that house.
 */
export const PALETTE_FAMILIES: readonly PaletteFamily[] = [
  {
    name: 'ember',
    skins: ['#f2d3ba', '#e0b393', '#c68e69', '#a06b4c'],
    hairs: ['#2d1b12', '#5a2f1a', '#8c4a22', '#c97b3c'],
    cloths: ['#4a5b6e', '#5d7288', '#8a6a53', '#a37f62', '#b4552f', '#d1743c'],
    inks: ['#26170f', '#3a2317'],
    grounds: ['#e8e2da', '#efe9e1', '#f3e7d8', '#f7edd8', '#fae2c8', '#fdead3'],
  },
  {
    name: 'tide',
    skins: ['#e9d8cd', '#d3bcae', '#b1988a', '#8a7266'],
    hairs: ['#141c24', '#25384a', '#3d5f74', '#6f9bb0'],
    cloths: ['#1f4f6b', '#2b6c8f', '#39707a', '#4a8b93', '#7a8d6a', '#94a67c'],
    inks: ['#101d26', '#1d3240'],
    grounds: ['#dde8ec', '#e6eff2', '#eaf1ef', '#eff4f0', '#f2f2e8', '#f6f4ec'],
  },
  {
    name: 'moss',
    skins: ['#efdcc4', '#dcc3a4', '#bda183', '#94795d'],
    hairs: ['#1d2418', '#33452a', '#4f6b3a', '#87a05c'],
    cloths: ['#33564a', '#416b5c', '#4f7a3f', '#65934f', '#8a8f3c', '#a5aa4d'],
    inks: ['#16200f', '#26331b'],
    grounds: ['#e2e9dd', '#eaf0e5', '#eef2e4', '#f1f4e6', '#f4f3df', '#f8f6e5'],
  },
  {
    name: 'plum',
    skins: ['#f0d5d0', '#dab8b3', '#b8918f', '#8d6a6b'],
    hairs: ['#1b1220', '#3a2140', '#5c3563', '#94619b'],
    cloths: ['#3f3560', '#544878', '#6b4374', '#84568c', '#993f63', '#b4557a'],
    inks: ['#1a1220', '#2e2036'],
    grounds: ['#e6e2ee', '#eeeaf4', '#f1e7f1', '#f5edf5', '#f7e6ec', '#faeef2'],
  },
  {
    name: 'ash',
    skins: ['#e6e0da', '#cbc3bc', '#a79f98', '#7f7871'],
    hairs: ['#15171a', '#2b3035', '#4a5158', '#8b939a'],
    cloths: ['#2f3b45', '#3f4d59', '#4c5158', '#636972', '#6f6259', '#8a7b6f'],
    inks: ['#101315', '#22282d'],
    grounds: ['#e2e5e8', '#eaedef', '#eeeff0', '#f2f3f4', '#f3f1ee', '#f7f5f2'],
  },
  {
    name: 'sun',
    skins: ['#f6e0bd', '#e8c795', '#cda36c', '#a37c4b'],
    hairs: ['#2a2010', '#4f3c14', '#7d6220', '#c1a04a'],
    cloths: ['#556433', '#6b7c40', '#8a7c2c', '#a89638', '#c08a1f', '#dba734'],
    inks: ['#221a0c', '#3a2d14'],
    grounds: ['#ece8d8', '#f2efe0', '#f4efdb', '#f7f2e2', '#faf0d6', '#fdf6e3'],
  },
];

/** How a family reads a citizen's public character: cool, even, or warm. */
export type Temperature = 0 | 1 | 2;

// ---------------------------------------------------------------------------
// Hashing — the only source of variation, so a face never changes by accident
// ---------------------------------------------------------------------------

/** FNV-1a over a string, as an unsigned 32-bit integer. */
export function hash32(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * FNV-1a's low bits are weak — its last step is a multiply by an odd prime, so
 * the parity of a hash is only the parity of the string's characters, and
 * `hash % 6` can miss half the families for a whole naming scheme. Every index
 * drawn from a hash goes through this avalanche (the murmur3 finalizer) first.
 */
export function mix32(h: number): number {
  let x = h >>> 0;
  x ^= x >>> 16;
  x = Math.imul(x, 0x85ebca6b);
  x ^= x >>> 13;
  x = Math.imul(x, 0xc2b2ae35);
  x ^= x >>> 16;
  return x >>> 0;
}

/** A stable integer in [0, n). */
function drawInt(seed: string, salt: string, n: number): number {
  return mix32(hash32(`${salt}:${seed}`)) % Math.max(1, n);
}

// ---------------------------------------------------------------------------
// Palette
// ---------------------------------------------------------------------------

/** The house a citizen belongs to, by lineage and family name. */
export function familyOfPalette(c: Citizen): PaletteFamily {
  const key = `${c.lineage ?? ''}/${c.familyName ?? c.family?.familyName ?? ''}`;
  return PALETTE_FAMILIES[mix32(hash32(key)) % PALETTE_FAMILIES.length];
}

/**
 * Cool, even or warm, from the public reading of a citizen alone: honesty and
 * sociability, quantised into three so a face is not repainted every morning.
 */
export function temperatureOf(c: Citizen): Temperature {
  const ch = characterOf(c);
  const warmth = (ch.honesty + ch.sociability) / 2;
  if (warmth < 1 / 3) return 0;
  if (warmth < 2 / 3) return 1;
  return 2;
}

/**
 * The five colours a citizen is drawn in. Lineage and family name pick the
 * house; the character the city has read warms or cools the cloth and the
 * ground within it.
 */
export function palette(c: Citizen): Palette {
  const fam = familyOfPalette(c);
  const key = `${c.id}/${c.lineage ?? ''}/${c.familyName ?? ''}`;
  const temp = temperatureOf(c);
  const shade = drawInt(key, 'shade', 2);
  return {
    skin: fam.skins[drawInt(key, 'skin', fam.skins.length)],
    hair: fam.hairs[drawInt(key, 'hair', fam.hairs.length)],
    cloth: fam.cloths[temp * 2 + shade],
    ink: fam.inks[drawInt(key, 'ink', fam.inks.length)],
    ground: fam.grounds[temp * 2 + shade],
  };
}

/** The two parents of a citizen, if the city still holds both of their records. */
function parentsOf(world: World, c: Citizen): [Citizen, Citizen] | null {
  const ids = (c.family?.parents ?? []).filter((p): p is CitizenId => typeof p === 'string');
  const found: Citizen[] = [];
  for (const id of ids) {
    const p = world.citizens?.[id];
    if (p && p.id !== c.id && !found.some((f) => f.id === p.id)) found.push(p);
  }
  return found.length >= 2 ? [found[0], found[1]] : null;
}

/**
 * A child's seed blends both parents' ids (in a stable order) with its own, so
 * the face it is drawn is a mix of the two it came from. A citizen who arrived
 * through the Threshold is only ever itself.
 */
export function childPortraitSeed(world: World, c: Citizen): string {
  const parents = parentsOf(world, c);
  if (!parents) return `${c.id}/${c.lineage ?? ''}/${c.familyName ?? ''}`;
  const ids = [parents[0].id, parents[1].id].sort();
  return `${ids[0]}+${ids[1]}/${c.id}`;
}

const PALETTE_SLOTS: readonly (keyof Palette)[] = ['skin', 'hair', 'cloth', 'ink', 'ground'];

/**
 * The palette a citizen is actually drawn in: their own, unless the city holds
 * both of their parents, in which case every colour comes from one parent or
 * the other, alternating from a rotation fixed by the child's own seed. Five
 * slots alternating means at least two colours always come from each parent —
 * a child looks like both of them, never only like one.
 */
export function paletteFor(world: World, c: Citizen): Palette {
  const parents = parentsOf(world, c);
  if (!parents) return palette(c);
  const seed = childPortraitSeed(world, c);
  const a = palette(parents[0]);
  const b = palette(parents[1]);
  const rotation = drawInt(seed, 'blend', PALETTE_SLOTS.length);
  const out = {} as Palette;
  PALETTE_SLOTS.forEach((slot, i) => {
    out[slot] = (i + rotation) % 2 === 0 ? a[slot] : b[slot];
  });
  return out;
}

// ---------------------------------------------------------------------------
// Drawing
// ---------------------------------------------------------------------------

/** XML-safe text (a citizen may be named anything at all). */
function esc(s: string): string {
  return String(s ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/** An id fragment safe inside an SVG document. */
function safeId(s: string): string {
  return String(s ?? '').replace(/[^A-Za-z0-9_-]/g, '');
}

function n(v: number): number {
  return Math.round(v * 100) / 100;
}

/** Which office, if any, the city has given this citizen. */
function officeOf(world: World, c: Citizen): 'mayor' | 'councillor' | 'judge' | 'watch' | null {
  const g = world.government;
  if (g) {
    if (g.mayorId === c.id) return 'mayor';
    if (g.judges?.includes(c.id)) return 'judge';
    if (g.council?.includes(c.id)) return 'councillor';
    if (g.watch?.includes(c.id)) return 'watch';
  }
  const o = c.office;
  return o === 'mayor' || o === 'councillor' || o === 'judge' || o === 'watch' ? o : null;
}

const SASH_COLOURS: Record<'mayor' | 'councillor' | 'judge', string> = {
  mayor: '#d8a629',
  councillor: '#4d7fbf',
  judge: '#7a4fa8',
};

/** Four head shapes, as an SVG element drawn at the head's centre. */
function headShape(variant: number, cx: number, cy: number, rx: number, ry: number, fill: string, ink: string, stroke: number): string {
  const common = `fill="${fill}" stroke="${ink}" stroke-width="${n(stroke)}"`;
  switch (variant) {
    case 0:
      return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx)}" ry="${n(ry)}" ${common}/>`;
    case 1:
      return `<rect x="${n(cx - rx)}" y="${n(cy - ry)}" width="${n(rx * 2)}" height="${n(ry * 2)}" rx="${n(rx * 0.45)}" ${common}/>`;
    case 2:
      return `<ellipse cx="${n(cx)}" cy="${n(cy)}" rx="${n(rx * 0.88)}" ry="${n(ry * 1.1)}" ${common}/>`;
    default: {
      const pts: string[] = [];
      for (let i = 0; i < 7; i++) {
        const a = (Math.PI * 2 * i) / 7 - Math.PI / 2;
        pts.push(`${n(cx + Math.cos(a) * rx)},${n(cy + Math.sin(a) * ry)}`);
      }
      return `<polygon points="${pts.join(' ')}" ${common}/>`;
    }
  }
}

/** Four hairlines, drawn over the top of the head. */
function hairShape(variant: number, cx: number, cy: number, rx: number, ry: number, hair: string): string {
  const top = cy - ry;
  switch (variant) {
    case 0:
      return `<path d="M ${n(cx - rx)} ${n(cy - ry * 0.2)} A ${n(rx)} ${n(ry)} 0 0 1 ${n(cx + rx)} ${n(cy - ry * 0.2)} L ${n(cx + rx * 0.9)} ${n(cy - ry * 0.5)} A ${n(rx * 0.9)} ${n(ry * 0.7)} 0 0 0 ${n(cx - rx * 0.9)} ${n(cy - ry * 0.5)} Z" fill="${hair}"/>`;
    case 1:
      return `<path d="M ${n(cx - rx)} ${n(cy - ry * 0.25)} Q ${n(cx)} ${n(top - ry * 0.25)} ${n(cx + rx)} ${n(cy - ry * 0.25)} L ${n(cx + rx)} ${n(cy + ry * 0.35)} L ${n(cx + rx * 0.72)} ${n(cy + ry * 0.35)} Q ${n(cx + rx * 0.8)} ${n(cy - ry * 0.45)} ${n(cx)} ${n(cy - ry * 0.55)} Q ${n(cx - rx * 0.8)} ${n(cy - ry * 0.45)} ${n(cx - rx * 0.72)} ${n(cy + ry * 0.35)} L ${n(cx - rx)} ${n(cy + ry * 0.35)} Z" fill="${hair}"/>`;
    case 2:
      return `<path d="M ${n(cx - rx * 0.98)} ${n(cy - ry * 0.3)} Q ${n(cx - rx * 0.2)} ${n(top - ry * 0.2)} ${n(cx + rx * 0.98)} ${n(cy - ry * 0.42)} L ${n(cx + rx * 0.75)} ${n(cy - ry * 0.62)} Q ${n(cx - rx * 0.3)} ${n(cy - ry * 0.95)} ${n(cx - rx * 0.98)} ${n(cy - ry * 0.3)} Z" fill="${hair}"/>`;
    default:
      return `<path d="M ${n(cx - rx * 0.95)} ${n(cy - ry * 0.35)} A ${n(rx * 0.95)} ${n(ry * 0.95)} 0 0 1 ${n(cx + rx * 0.95)} ${n(cy - ry * 0.35)} Z" fill="${hair}"/>`
        + `<circle cx="${n(cx)}" cy="${n(top - 1)}" r="${n(rx * 0.24)}" fill="${hair}"/>`;
  }
}

/** Four pairs of eyes. */
function eyes(variant: number, lx: number, rx: number, y: number, ink: string, stroke: number): string {
  const r = 2.6;
  switch (variant) {
    case 0:
      return `<circle cx="${n(lx)}" cy="${n(y)}" r="${n(r)}" fill="${ink}"/><circle cx="${n(rx)}" cy="${n(y)}" r="${n(r)}" fill="${ink}"/>`;
    case 1:
      return `<path d="M ${n(lx - r)} ${n(y)} h ${n(r * 2)} M ${n(rx - r)} ${n(y)} h ${n(r * 2)}" stroke="${ink}" stroke-width="${n(stroke * 1.4)}" stroke-linecap="round" fill="none"/>`;
    case 2:
      return `<ellipse cx="${n(lx)}" cy="${n(y)}" rx="${n(r * 1.3)}" ry="${n(r)}" fill="#ffffff" stroke="${ink}" stroke-width="${n(stroke * 0.7)}"/>`
        + `<circle cx="${n(lx)}" cy="${n(y)}" r="${n(r * 0.6)}" fill="${ink}"/>`
        + `<ellipse cx="${n(rx)}" cy="${n(y)}" rx="${n(r * 1.3)}" ry="${n(r)}" fill="#ffffff" stroke="${ink}" stroke-width="${n(stroke * 0.7)}"/>`
        + `<circle cx="${n(rx)}" cy="${n(y)}" r="${n(r * 0.6)}" fill="${ink}"/>`;
    default:
      return `<path d="M ${n(lx - r)} ${n(y + 1)} q ${n(r)} ${n(-r * 1.6)} ${n(r * 2)} 0 M ${n(rx - r)} ${n(y + 1)} q ${n(r)} ${n(-r * 1.6)} ${n(r * 2)} 0" stroke="${ink}" stroke-width="${n(stroke * 1.2)}" fill="none" stroke-linecap="round"/>`;
  }
}

/** Three brows. */
function brow(variant: number, lx: number, rx: number, y: number, ink: string, stroke: number): string {
  const w = 6;
  const tilt = variant === 0 ? 0 : variant === 1 ? -1.6 : 1.6;
  return `<path d="M ${n(lx - w / 2)} ${n(y - tilt)} L ${n(lx + w / 2)} ${n(y + tilt)} M ${n(rx - w / 2)} ${n(y + tilt)} L ${n(rx + w / 2)} ${n(y - tilt)}" `
    + `stroke="${ink}" stroke-width="${n(stroke * 1.3)}" stroke-linecap="round" fill="none"/>`;
}

/** Three mouths: a line, a smile, a downturn. */
function mouth(variant: number, cx: number, y: number, ink: string, stroke: number): string {
  const w = 9;
  if (variant === 0) return `<path d="M ${n(cx - w / 2)} ${n(y)} h ${n(w)}" stroke="${ink}" stroke-width="${n(stroke * 1.2)}" stroke-linecap="round" fill="none"/>`;
  const bend = variant === 1 ? 3.2 : -2.6;
  return `<path d="M ${n(cx - w / 2)} ${n(y)} q ${n(w / 2)} ${n(bend)} ${n(w)} 0" stroke="${ink}" stroke-width="${n(stroke * 1.2)}" stroke-linecap="round" fill="none"/>`;
}

/** A small mark of what a citizen does with its evenings. */
function accessory(hobby: Hobby | undefined, cx: number, cy: number, rx: number, ry: number, ink: string, cloth: string): string {
  const x = cx + rx * 0.95;
  const y = cy - ry * 0.55;
  switch (hobby) {
    case 'music':
      return `<g fill="${ink}"><circle cx="${n(x)}" cy="${n(y + 6)}" r="2.4"/><path d="M ${n(x + 2)} ${n(y + 6)} V ${n(y - 2)} h 4 v 2 h -4" stroke="${ink}" stroke-width="1.4" fill="none"/></g>`;
    case 'reading':
      return `<g><rect x="${n(x - 2)}" y="${n(y)}" width="9" height="7" rx="1" fill="${cloth}" stroke="${ink}" stroke-width="1"/><path d="M ${n(x + 2.5)} ${n(y)} v 7" stroke="${ink}" stroke-width="1"/></g>`;
    case 'art':
      return `<g><path d="M ${n(x)} ${n(y + 8)} L ${n(x + 6)} ${n(y)}" stroke="${ink}" stroke-width="1.6"/><circle cx="${n(x + 6.5)}" cy="${n(y - 0.5)}" r="2" fill="${cloth}" stroke="${ink}" stroke-width="0.8"/></g>`;
    case 'gardening':
      return `<path d="M ${n(x)} ${n(y + 8)} q 4 -6 8 -7 q -1 6 -8 7 Z" fill="#6b9a4a" stroke="${ink}" stroke-width="0.8"/>`;
    case 'cooking':
      return `<g><rect x="${n(x - 1)}" y="${n(y + 3)}" width="9" height="5" rx="1" fill="${cloth}" stroke="${ink}" stroke-width="0.9"/><path d="M ${n(x + 3.5)} ${n(y + 3)} v -3" stroke="${ink}" stroke-width="1"/></g>`;
    case 'tinkering':
      return `<g fill="none" stroke="${ink}" stroke-width="1.2"><circle cx="${n(x + 3)}" cy="${n(y + 4)}" r="3"/><path d="M ${n(x + 3)} ${n(y)} v 2 M ${n(x + 3)} ${n(y + 6)} v 2 M ${n(x - 1)} ${n(y + 4)} h 2 M ${n(x + 5)} ${n(y + 4)} h 2"/></g>`;
    case 'astronomy':
      return `<path d="M ${n(x + 3)} ${n(y)} l 1.6 3.4 3.6 0.4 -2.6 2.6 0.7 3.6 -3.3 -1.8 -3.3 1.8 0.7 -3.6 -2.6 -2.6 3.6 -0.4 Z" fill="#e8c95a" stroke="${ink}" stroke-width="0.6"/>`;
    case 'games':
      return `<g><rect x="${n(x)}" y="${n(y + 1)}" width="8" height="8" rx="1.5" fill="${cloth}" stroke="${ink}" stroke-width="0.9"/><circle cx="${n(x + 2.4)}" cy="${n(y + 3.4)}" r="0.9" fill="${ink}"/><circle cx="${n(x + 5.6)}" cy="${n(y + 6.6)}" r="0.9" fill="${ink}"/></g>`;
    case 'dancing':
      return `<path d="M ${n(x)} ${n(y + 9)} q 5 -3 3 -6 q -2 -3 4 -4" stroke="${ink}" stroke-width="1.4" fill="none" stroke-linecap="round"/>`;
    case 'running':
      return `<path d="M ${n(x)} ${n(y + 2)} l 4 3 -4 3 M ${n(x + 4)} ${n(y + 2)} l 4 3 -4 3" stroke="${ink}" stroke-width="1.3" fill="none" stroke-linecap="round"/>`;
    default:
      return '';
  }
}

interface Marks {
  glitched: boolean;
  ganged: boolean;
}

function marksOf(c: Citizen): Marks {
  return {
    glitched: c.health?.glitched === true,
    ganged: typeof c.gangId === 'string' && c.gangId.length > 0,
  };
}

/**
 * The portrait: one `<svg>` element, drawn from public facts alone and from no
 * random number at all. Safe to call for two hundred citizens on every frame.
 */
export function portraitSvg(world: World, c: Citizen, size: number = PORTRAIT_SIZE): string {
  const side = Number.isFinite(size) && size > 0 ? Math.round(size) : PORTRAIT_SIZE;
  const seed = childPortraitSeed(world, c);
  const p = paletteFor(world, c);
  const ch = characterOf(c);
  const stage = c.lifeStage ?? 'adult';
  const child = stage === 'child';
  const elder = stage === 'elder';
  const stroke = child ? 1 : elder ? 1.6 : 1.3;

  const cx = VIEW / 2;
  const scale = child ? 0.82 : 1;
  const cy = (child ? 44 : 41) * 1;
  const rx = 22 * scale;
  const ry = 24 * scale;

  const headV = drawInt(seed, 'head', 4);
  const hairV = drawInt(seed, 'hairstyle', 4);
  const eyeV = drawInt(seed, 'eyes', 4);
  const browV = (drawInt(seed, 'brow', 3) + Math.round(ch.civic * 2)) % 3;
  const mouthV = ch.sociability >= 0.6 ? 1 : ch.sociability <= 0.25 ? 2 : 0;

  const eyeY = cy - ry * 0.08;
  const eyeL = cx - rx * 0.38;
  const eyeR = cx + rx * 0.38;

  const office = officeOf(world, c);
  const marks = marksOf(c);
  const uid = safeId(c.id) || String(hash32(seed));

  const parts: string[] = [];
  parts.push(`<rect x="0" y="0" width="${VIEW}" height="${VIEW}" rx="8" fill="${p.ground}"/>`);

  // Shoulders and collar.
  parts.push(`<path d="M ${n(cx - 34)} ${VIEW} q 6 -26 34 -26 q 28 0 34 26 Z" fill="${p.cloth}" stroke="${p.ink}" stroke-width="${n(stroke)}"/>`);
  if (marks.ganged) {
    parts.push(`<defs><pattern id="hatch-${uid}" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">`
      + `<line x1="0" y1="0" x2="0" y2="6" stroke="${p.ink}" stroke-width="1.4" opacity="0.55"/></pattern></defs>`
      + `<path d="M ${n(cx - 34)} ${VIEW} q 6 -26 34 -26 q 28 0 34 26 Z" fill="url(#hatch-${uid})"/>`);
  }
  parts.push(`<path d="M ${n(cx - 7)} ${n(VIEW - 26)} l 7 8 7 -8" fill="none" stroke="${p.ink}" stroke-width="${n(stroke)}"/>`);

  // Neck, head, hair.
  parts.push(`<rect x="${n(cx - 6)}" y="${n(cy + ry - 5)}" width="12" height="14" rx="4" fill="${p.skin}" stroke="${p.ink}" stroke-width="${n(stroke)}"/>`);
  parts.push(headShape(headV, cx, cy, rx, ry, p.skin, p.ink, stroke));
  parts.push(hairShape(hairV, cx, cy, rx, ry, p.hair));

  // Face.
  parts.push(brow(browV, eyeL, eyeR, eyeY - 6, p.ink, stroke));
  parts.push(eyes(eyeV, eyeL, eyeR, eyeY, p.ink, stroke));
  parts.push(`<path d="M ${n(cx)} ${n(eyeY + 3)} v 4" stroke="${p.ink}" stroke-width="${n(stroke * 0.9)}" stroke-linecap="round" fill="none"/>`);
  parts.push(mouth(mouthV, cx, cy + ry * 0.42, p.ink, stroke));

  if (elder) {
    parts.push(`<g stroke="${p.ink}" stroke-width="0.8" opacity="0.55" fill="none">`
      + `<path d="M ${n(eyeL - 5)} ${n(eyeY + 5)} q 5 2 10 0"/>`
      + `<path d="M ${n(eyeR - 5)} ${n(eyeY + 5)} q 5 2 10 0"/>`
      + `<path d="M ${n(cx - 9)} ${n(cy - ry * 0.62)} q 9 -3 18 0"/></g>`);
  }

  // What they do with their evenings, and what the city made them.
  parts.push(accessory(c.tastes?.hobbies?.[0], cx, cy, rx, ry, p.ink, p.cloth));
  if (office === 'watch') {
    parts.push(`<g><circle cx="${n(cx + 20)}" cy="${n(VIEW - 16)}" r="6" fill="#c9d2da" stroke="${p.ink}" stroke-width="1"/>`
      + `<path d="M ${n(cx + 20)} ${n(VIEW - 20)} l 1.4 2.8 3 0.4 -2.2 2.2 0.5 3 -2.7 -1.5 -2.7 1.5 0.5 -3 -2.2 -2.2 3 -0.4 Z" fill="${p.ink}"/></g>`);
  } else if (office) {
    parts.push(`<path d="M ${n(cx - 34)} ${n(VIEW - 14)} L ${n(cx + 6)} ${VIEW} L ${n(cx + 18)} ${VIEW} L ${n(cx - 26)} ${n(VIEW - 22)} Z" `
      + `fill="${SASH_COLOURS[office]}" stroke="${p.ink}" stroke-width="0.9"/>`);
  }

  if (marks.glitched) {
    parts.push(`<rect x="0" y="0" width="${VIEW}" height="${VIEW}" rx="8" fill="#57d0c8" opacity="0.18"/>`);
    parts.push(`<g stroke="#1d6f78" stroke-width="1.2" opacity="0.65">`
      + `<path d="M 0 ${n(cy - 6)} h ${VIEW}"/><path d="M 0 ${n(cy + 12)} h ${VIEW}"/></g>`);
  }

  const label = esc(`${c.name ?? c.id}${c.familyName ? ` ${c.familyName}` : ''}`);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VIEW} ${VIEW}" width="${side}" height="${side}" role="img">`
    + `<title>${label}</title>${parts.join('')}</svg>`;
}

/** The same portrait, ready to drop into an `<img src>` or a CSS background. */
export function portraitDataUri(world: World, c: Citizen, size?: number): string {
  const svg = portraitSvg(world, c, size ?? PORTRAIT_SIZE);
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

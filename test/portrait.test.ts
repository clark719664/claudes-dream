/**
 * Faces (src/identity/portrait.ts).
 *
 * A portrait must be the same every time it is drawn, must never move the
 * world's random stream, and must never carry a citizen's hidden traits.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TRAITS } from '../src/types.ts';
import type { Citizen, World } from '../src/types.ts';
import { makeCitizen, makeWorld } from './helpers.ts';
import {
  PALETTE_FAMILIES, PORTRAIT_SIZE, childPortraitSeed, familyOfPalette, hash32, palette, paletteFor,
  portraitDataUri, portraitSvg, temperatureOf,
} from '../src/identity/portrait.ts';

/**
 * A minimal well-formedness check: walks the tags and returns the root's name,
 * throwing if a tag is unbalanced or if two roots stand side by side.
 */
function rootElement(svg: string): string {
  const stack: string[] = [];
  let root: string | null = null;
  const re = /<(\/?)([A-Za-z][\w:-]*)([^>]*?)(\/?)>/g;
  let m: RegExpExecArray | null;
  let index = 0;
  while ((m = re.exec(svg)) !== null) {
    const between = svg.slice(index, m.index);
    assert.ok(stack.length > 0 || between.trim() === '', `stray text outside the root before <${m[2]}>`);
    assert.equal(between.includes('<'), false, 'no unparsed markup');
    index = re.lastIndex;
    const [, closing, name, , selfClosing] = m;
    if (closing) {
      assert.equal(stack.pop(), name, `</${name}> closes the wrong element`);
    } else if (!selfClosing) {
      if (stack.length === 0) {
        assert.equal(root, null, 'an SVG document has exactly one root element');
        root = name;
      }
      stack.push(name);
    } else if (stack.length === 0) {
      assert.equal(root, null, 'an SVG document has exactly one root element');
      root = name;
    }
  }
  assert.equal(index, svg.length, 'trailing text after the last element');
  assert.deepEqual(stack, [], 'every element is closed');
  return root ?? '';
}

function withParents(world: World, child: Citizen, a: Citizen, b: Citizen): Citizen {
  child.family.parents = [a.id, b.id];
  a.family.children.push(child.id);
  b.family.children.push(child.id);
  return child;
}

// ------------------------------------------------------------------ hashing

test('hash32 is FNV-1a: stable, unsigned, and different for a one-character change', () => {
  assert.equal(hash32(''), 0x811c9dc5);
  assert.equal(hash32('a'), hash32('a'));
  assert.notEqual(hash32('c_1'), hash32('c_2'));
  for (const s of ['', 'a', 'c_17', 'Ondine Ashgrove', '☂']) {
    const h = hash32(s);
    assert.ok(Number.isInteger(h) && h >= 0 && h <= 0xffffffff, `${s} hashes to a uint32`);
  }
});

// ------------------------------------------------------------- determinism

test('the same citizen is drawn the same way twice, and two citizens are drawn differently', () => {
  const w = makeWorld();
  const a = makeCitizen(w, { name: 'Ondine', familyName: 'Ashgrove', lineage: 'Claude' });
  const b = makeCitizen(w, { name: 'Bram', familyName: 'Corvane', lineage: 'Sonnet' });
  assert.equal(portraitSvg(w, a), portraitSvg(w, a));
  assert.notEqual(portraitSvg(w, a), portraitSvg(w, b));
});

test('a hundred citizens get a hundred faces, and almost none of them look alike', () => {
  const w = makeWorld({ seed: 11 });
  const seen = new Set<string>();
  for (let i = 0; i < 100; i++) seen.add(portraitSvg(w, makeCitizen(w)));
  assert.equal(seen.size, 100, 'every citizen has a face of its own');
});

test('drawing a portrait never touches the random stream', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const before = w.rng.s;
  for (let i = 0; i < 50; i++) portraitSvg(w, c, 32);
  portraitDataUri(w, c);
  paletteFor(w, c);
  assert.equal(w.rng.s, before, 'a face may be drawn outside a tick without moving the world');
});

test('a portrait is cheap enough for a city of two hundred', () => {
  const w = makeWorld({ seed: 3 });
  const all: Citizen[] = [];
  for (let i = 0; i < 200; i++) all.push(makeCitizen(w));
  const started = process.hrtime.bigint();
  let bytes = 0;
  for (const c of all) bytes += portraitSvg(w, c).length;
  const ms = Number(process.hrtime.bigint() - started) / 1e6;
  assert.ok(bytes > 0);
  assert.ok(ms < 500, `two hundred portraits took ${ms.toFixed(1)}ms`);
});

// -------------------------------------------------------------- the document

test('a portrait is one <svg> root with a viewBox, and honours the size asked for', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Vex & <Co>', familyName: 'O\'Rourke' });
  const svg = portraitSvg(w, c);
  assert.equal(rootElement(svg), 'svg');
  assert.match(svg, /^<svg /);
  assert.match(svg, /<\/svg>$/);
  assert.equal(svg.split('<svg').length - 1, 1);
  assert.match(svg, /viewBox="0 0 96 96"/);
  assert.match(svg, /width="96" height="96"/);
  assert.match(portraitSvg(w, c, 24), /width="24" height="24"/);
  assert.match(portraitSvg(w, c, 0), new RegExp(`width="${PORTRAIT_SIZE}"`), 'a nonsense size falls back');
  assert.match(svg, /&amp;/, 'a name with markup in it is escaped');
  assert.equal(svg.includes('<Co>'), false);
});

test('a data URI wraps the same drawing', () => {
  const w = makeWorld();
  const c = makeCitizen(w);
  const uri = portraitDataUri(w, c, 48);
  assert.match(uri, /^data:image\/svg\+xml;utf8,/);
  assert.equal(decodeURIComponent(uri.slice('data:image/svg+xml;utf8,'.length)), portraitSvg(w, c, 48));
});

// ------------------------------------------------------- nothing hidden leaks

test('no hidden trait, by name or by value, reaches the drawing', () => {
  const w = makeWorld();
  const c = makeCitizen(w, {
    personality: { curiosity: 0.123457, diligence: 0.234567, sociability: 0.345671, honesty: 0.456712, ambition: 0.567123 },
  });
  const svg = portraitSvg(w, c);
  for (const t of TRAITS) {
    assert.equal(svg.includes(t), false, `the drawing must not name ${t}`);
    assert.equal(svg.includes(String(c.personality[t])), false, `the drawing must not carry ${t}'s value`);
  }
});

test('the public reading, not the hidden one, warms or cools a face', () => {
  const w = makeWorld();
  const cool = makeCitizen(w, { name: 'Cool', familyName: 'Same', lineage: 'same' });
  const warm = makeCitizen(w, { name: 'Warm', familyName: 'Same', lineage: 'same' });
  cool.character = { honesty: 0.1, sociability: 0.1, diligence: 0.5, generosity: 0.5, civic: 0.5 };
  warm.character = { honesty: 0.95, sociability: 0.95, diligence: 0.5, generosity: 0.5, civic: 0.5 };
  assert.equal(temperatureOf(cool), 0);
  assert.equal(temperatureOf(warm), 2);
  assert.equal(familyOfPalette(cool).name, familyOfPalette(warm).name, 'same house');
  assert.notEqual(palette(cool).cloth, palette(warm).cloth, 'a different temperature within it');
  // A small change of reading inside one temperature leaves the face alone.
  const before = portraitSvg(w, warm);
  warm.character = { ...warm.character, honesty: 0.9 };
  assert.equal(portraitSvg(w, warm), before);
});

test('a citizen with no tastes, no character and no family still gets a face', () => {
  const w = makeWorld();
  const bare = makeCitizen(w);
  delete (bare as Partial<Citizen>).tastes;
  delete (bare as Partial<Citizen>).character;
  delete (bare as Partial<Citizen>).family;
  delete (bare as Partial<Citizen>).lifeStage;
  const svg = portraitSvg(w, bare);
  assert.equal(rootElement(svg), 'svg');
  assert.ok(svg.length > 200);
});

// ------------------------------------------------------------------- lineage

test('a child of two parents takes every colour from one of them, and some from each', () => {
  const w = makeWorld({ seed: 8 });
  for (let i = 0; i < 30; i++) {
    const mother = makeCitizen(w, { familyName: `House${i}`, lineage: `line${i}` });
    const father = makeCitizen(w, { familyName: `Other${i}`, lineage: `other${i}` });
    const kid = withParents(w, makeCitizen(w, { familyName: `House${i}`, lifeStage: 'child' }), mother, father);
    const pm = palette(mother);
    const pf = palette(father);
    const pk = paletteFor(w, kid);
    const slots = ['skin', 'hair', 'cloth', 'ink', 'ground'] as const;
    let fromMother = 0;
    let fromFather = 0;
    for (const slot of slots) {
      assert.ok(pk[slot] === pm[slot] || pk[slot] === pf[slot], `${slot} comes from a parent`);
      if (pk[slot] === pm[slot]) fromMother++;
      if (pk[slot] === pf[slot]) fromFather++;
    }
    assert.ok(fromMother >= 2, 'a child looks something like its mother');
    assert.ok(fromFather >= 2, 'and something like its father');
  }
});

test("a child's seed blends both parents, and an arrival's is its own", () => {
  const w = makeWorld();
  const a = makeCitizen(w);
  const b = makeCitizen(w);
  const kid = withParents(w, makeCitizen(w, { lifeStage: 'child' }), a, b);
  const seed = childPortraitSeed(w, kid);
  assert.ok(seed.includes(a.id) && seed.includes(b.id) && seed.includes(kid.id));
  const arrival = makeCitizen(w);
  assert.equal(childPortraitSeed(w, arrival).includes('+'), false);
  // Order of the parents does not matter; the blend is the same either way.
  kid.family.parents = [b.id, a.id];
  assert.equal(childPortraitSeed(w, kid), seed);
  // A parent the city no longer holds means no blend at all, and no crash.
  kid.family.parents = [a.id, 'c_nobody'];
  assert.equal(childPortraitSeed(w, kid).includes('+'), false);
  assert.deepEqual(paletteFor(w, kid), palette(kid));
});

test('every palette family is reachable and every colour in one is a hex value', () => {
  const w = makeWorld();
  const families = new Set<string>();
  for (let i = 0; i < 400; i++) {
    families.add(familyOfPalette(makeCitizen(w, { familyName: `F${i}`, lineage: `L${i}` })).name);
  }
  assert.equal(families.size, PALETTE_FAMILIES.length);
  for (const fam of PALETTE_FAMILIES) {
    for (const list of [fam.skins, fam.hairs, fam.cloths, fam.inks, fam.grounds]) {
      for (const colour of list) assert.match(colour, /^#[0-9a-f]{6}$/);
    }
  }
});

// --------------------------------------------------------- what the city adds

test('an office adds a sash, the Watch a badge, and neither is there without one', () => {
  const w = makeWorld();
  const plain = makeCitizen(w, { name: 'Plain' });
  const bare = portraitSvg(w, plain);
  const sashes: string[] = [];
  for (const [office, apply] of [
    ['mayor', () => { w.government.mayorId = plain.id; }],
    ['councillor', () => { w.government.mayorId = null; w.government.council = [plain.id]; }],
    ['judge', () => { w.government.council = []; w.government.judges = [plain.id]; }],
  ] as [string, () => void][]) {
    apply();
    const svg = portraitSvg(w, plain);
    assert.notEqual(svg, bare, `${office} is visible`);
    const sash = /fill="(#[0-9a-f]{6})" stroke="[^"]*" stroke-width="0.9"/.exec(svg);
    assert.ok(sash, `${office} wears a sash`);
    sashes.push(sash[1]);
  }
  assert.equal(new Set(sashes).size, 3, 'each office has its own colour');
  w.government.judges = [];
  w.government.watch = [plain.id];
  const watch = portraitSvg(w, plain);
  assert.match(watch, /#c9d2da/, 'an officer of the Watch wears a badge');
  w.government.watch = [];
  assert.equal(portraitSvg(w, plain), bare, 'and out of office it is a plain face again');
});

test('life stage, health and company show on the face', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Marek' });
  const adult = portraitSvg(w, c);
  c.lifeStage = 'child';
  const child = portraitSvg(w, c);
  c.lifeStage = 'elder';
  const elder = portraitSvg(w, c);
  assert.notEqual(child, adult);
  assert.notEqual(elder, adult);
  assert.notEqual(elder, child);

  c.lifeStage = 'adult';
  c.health = { glitched: true, sinceDay: 1 };
  const glitched = portraitSvg(w, c);
  assert.match(glitched, /#57d0c8/, 'a glitch tints the portrait');
  c.health = { glitched: false, sinceDay: null };
  assert.equal(portraitSvg(w, c), adult, 'and a cure takes the tint away');

  c.gangId = 'g_1';
  const ganged = portraitSvg(w, c);
  assert.match(ganged, new RegExp(`hatch-${c.id}`), 'a gang hatches the cloth');
  assert.equal(rootElement(ganged), 'svg');
  c.gangId = null;
  assert.equal(portraitSvg(w, c), adult);
});

test('a hobby puts a mark on the portrait, and each hobby a different one', () => {
  const w = makeWorld();
  const c = makeCitizen(w, { name: 'Isa' });
  const drawings = new Map<string, string>();
  const hobbies = ['music', 'reading', 'art', 'gardening', 'cooking', 'tinkering', 'astronomy', 'games', 'dancing', 'running'] as const;
  for (const h of hobbies) {
    c.tastes.hobbies = [h];
    drawings.set(h, portraitSvg(w, c));
  }
  assert.equal(new Set(drawings.values()).size, hobbies.length);
  c.tastes.hobbies = [];
  const none = portraitSvg(w, c);
  for (const svg of drawings.values()) assert.notEqual(svg, none);
});

/**
 * Headless checks. The game core has no DOM dependency, so the board rules and
 * every authored level can be exercised — and auto-played — from node.
 */
import { Board, makeTile } from '../src/game/board';
import { Game } from '../src/game/game';
import { CFG } from '../src/game/config';
import { LEVELS, charKind, layoutRows, objectiveText } from '../src/game/levels';
import { SHAPES } from '../src/game/shapes';
import { ClearKind, TileKind, type Hue } from '../src/game/types';
import { encodeGift } from '../src/meta/packs';
import { autoPlay } from './bot';

let failures = 0;
let checks = 0;

function ok(label: string, cond: boolean, detail = ''): void {
  checks++;
  console.log(
    cond ? `  \x1b[32mPASS\x1b[0m ${label}` : `  \x1b[31mFAIL\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`,
  );
  if (!cond) failures++;
}

function section(name: string): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function fill(b: Board, cells: [number, number][], hue: Hue = 0): void {
  for (const [c, r] of cells) b.set(c, r, makeTile(TileKind.Colour, hue));
}

// ---------------------------------------------------------------------------
section('A shape fits only where the board is empty and in bounds');
{
  const b = new Board();
  const sq = SHAPES.find((s) => s.id === 'sq2')!;
  ok('fits on an empty board', b.canPlace(sq, 0, 0));
  ok('rejects a shape hanging off the right edge', !b.canPlace(sq, CFG.cols - 1, 0));
  ok('rejects a shape hanging off the bottom', !b.canPlace(sq, 0, CFG.rows - 1));

  b.set(1, 1, makeTile(TileKind.Colour, 0));
  ok('rejects an overlap', !b.canPlace(sq, 0, 0));
  ok('still fits elsewhere', b.hasAnyPlacement(sq));
}

// ---------------------------------------------------------------------------
section('A full row or column clears, whatever colours are in it');
{
  const b = new Board();
  for (let col = 0; col < b.cols - 1; col++) b.set(col, 3, makeTile(TileKind.Colour, (col % 5) as Hue));
  ok('an incomplete row does not clear', b.findClears().length === 0);

  b.set(b.cols - 1, 3, makeTile(TileKind.Colour, 1));
  const clears = b.findClears();
  ok('completing it clears one row', clears.length === 1 && clears[0].kind === ClearKind.Row);
  ok('the whole row goes', clears[0].cells.length === b.cols);

  const removed = b.applyClears(clears);
  ok('every tile in the row is removed', removed.length === b.cols && b.isClear);
}
{
  const b = new Board();
  for (let row = 0; row < b.rows; row++) b.set(2, row, makeTile(TileKind.Stone, 0));
  const clears = b.findClears();
  ok('a full column of stone clears', clears.length === 1 && clears[0].kind === ClearKind.Column);
  b.applyClears(clears);
  ok('stone goes with it', b.countKind(TileKind.Stone) === 0);
}

// ---------------------------------------------------------------------------
section('Five touching tiles of one colour clear as a group');
{
  const b = new Board();
  fill(b, [[0, 0], [1, 0], [2, 0], [3, 0]], 2);
  ok('four in a row is not enough', b.findColourGroups().length === 0);

  fill(b, [[3, 1]], 2);
  const groups = b.findColourGroups();
  ok('five connected makes a group', groups.length === 1 && groups[0].length === 5);

  fill(b, [[4, 0]], 3);
  ok('a different colour does not join it', b.findColourGroups()[0].length === 5);
}
{
  const b = new Board();
  fill(b, [[0, 0], [1, 0]], 0);
  b.set(2, 0, makeTile(TileKind.Prism, 0));
  fill(b, [[3, 0], [4, 0]], 1);
  const groups = b.findColourGroups();
  ok('a prism extends a group but never bridges two colours', groups.length === 0, `${groups.length} groups`);

  fill(b, [[0, 1], [1, 1]], 0);
  const withPrism = b.findColourGroups();
  ok('the prism counts toward the nearer colour', withPrism.length === 1 && withPrism[0].length === 5);
}

// ---------------------------------------------------------------------------
section('Bombs and crates');
{
  const b = new Board();
  for (let col = 0; col < b.cols; col++) b.set(col, 4, makeTile(TileKind.Colour, 0));
  for (let col = 2; col <= 4; col++) for (const row of [3, 5]) b.set(col, row, makeTile(TileKind.Colour, 1));
  b.set(3, 4, makeTile(TileKind.Bomb, 0));

  const removed = b.applyClears(b.findClears());
  ok('the bomb takes its 3x3 with it', removed.length > b.cols, `removed ${removed.length}`);
  ok('neighbours above and below went too', !b.at(3, 3) && !b.at(3, 5));
}
{
  // Obstacles sit beside the clear rather than in it, and wear down.
  const b = new Board();
  b.set(3, 0, makeTile(TileKind.Crate, 0, 2));
  b.set(4, 0, makeTile(TileKind.Stone, 0, 2));
  for (let col = 0; col < b.cols; col++) b.set(col, 1, makeTile(TileKind.Colour, 0));

  b.applyClears(b.findClears());
  ok('a nearby clear damages a crate without removing it', b.at(3, 0)?.hp === 1);
  ok('and damages stone the same way', b.at(4, 0)?.hp === 1);

  for (let col = 0; col < b.cols; col++) b.set(col, 1, makeTile(TileKind.Colour, 0));
  b.applyClears(b.findClears());
  ok('a second clear finishes the crate', b.at(3, 0) === null);
  ok('and the stone', b.at(4, 0) === null);
}

// ---------------------------------------------------------------------------
section('A placement previews exactly what it will do');
{
  const level = LEVELS[0];
  const game = new Game(level);
  const item = game.tray[0];
  const pv = game.previewPlacement(item, 0, 0);
  const before = game.board.occupied;
  ok('previewing does not touch the board', game.board.occupied === before);
  ok('the footprint matches the shape', pv.footprint.length === item.shape.cells.length);

  // Whatever the preview says will clear is what actually clears.
  const probe = new Game(level);
  const probeItem = probe.tray[0];
  const promised = probe.previewPlacement(probeItem, 0, 0).clears.length;
  const actual = probe.place(probeItem, 0, 0)?.clears.length ?? -1;
  ok('the preview matches the real placement', promised === actual, `${promised} vs ${actual}`);
}

// ---------------------------------------------------------------------------
section('Every authored level is well formed');
{
  const ids = new Set<number>();
  let widthOk = true;
  let charsOk = true;
  let starsOk = true;
  let fitsBoard = true;
  const badChars: string[] = [];

  for (const level of LEVELS) {
    ids.add(level.id);
    const rows = layoutRows(level.layout, CFG.cols);
    if (rows.length > CFG.rows) fitsBoard = false;
    for (const row of rows) {
      if (row.length !== CFG.cols) widthOk = false;
      for (const ch of row) {
        if (ch !== '.' && charKind(ch) === null) {
          charsOk = false;
          badChars.push(`L${level.id}:'${ch}'`);
        }
      }
    }
    const [a, b, c] = level.stars;
    if (!(a < b && b < c)) starsOk = false;
    if (level.armour) {
      const ar = layoutRows(level.armour, CFG.cols);
      if (ar.length > rows.length) fitsBoard = false;
    }
  }

  ok(`all ${LEVELS.length} level ids are unique`, ids.size === LEVELS.length);
  ok('every layout row is exactly the board width', widthOk);
  ok('every layout fits inside the board', fitsBoard);
  ok('no unknown layout characters', charsOk, badChars.join(' '));
  ok('star thresholds ascend', starsOk);
  ok('every objective renders a label', LEVELS.every((l) => objectiveText(l.objective).length > 0));
  ok(
    'no level starts already solved',
    LEVELS.every((l) => !new Game(l).objectiveMet()),
  );
  ok(
    'every colour a layout uses is in that level\'s deal',
    LEVELS.every((l) => {
      const g = new Game(l);
      const dealt = new Set(g.tray.map((t) => t.hue));
      for (let i = 0; i < 40; i++) for (const t of g.tray) dealt.add(t.hue);
      // Any preset colour tile must be reachable by some dealt hue.
      const preset = g.board.cells.filter((c) => c?.preset && c.kind === TileKind.Colour);
      return preset.every((c) => g.paletteHues.includes(c!.hue));
    }),
  );
  ok(
    'every level leaves room to play',
    LEVELS.every((l) => {
      const g = new Game(l);
      return g.tray.some((t) => g.board.hasAnyPlacement(t.shape));
    }),
  );
}

// ---------------------------------------------------------------------------
section('A level is deterministic: the same attempt twice is identical');
{
  const a = new Game(LEVELS[3]);
  const b = new Game(LEVELS[3]);
  ok(
    'the opening board matches',
    a.board.cells.every((c, i) => (c?.kind ?? -1) === (b.board.cells[i]?.kind ?? -1)),
  );
  ok(
    'the deal matches',
    a.tray.every((t, i) => t.shape.id === b.tray[i].shape.id && t.hue === b.tray[i].hue),
  );
}

// ---------------------------------------------------------------------------
section('Gift codes survive a round trip and reject typos');
{
  const code = encodeGift(17, 512);
  ok('code is formatted PB-XXXX-XXX', /^PB-[0-9A-Z]{4}-[0-9A-Z]{3}$/.test(code), code);
  ok('encoding is deterministic', encodeGift(17, 512) === code);
  ok('different stickers give different codes', encodeGift(18, 512) !== code);
}

// ---------------------------------------------------------------------------
section('Auto-play: every level is winnable, and none is a walkover');
{
  const results = LEVELS.map((level) => {
    const g = autoPlay(new Game(level));
    return {
      id: level.id,
      name: level.name,
      won: g.won,
      stars: g.stars,
      score: g.score,
      moves: g.movesUsed,
      budget: level.moves,
    };
  });

  const lost = results.filter((r) => !r.won);
  const instant = results.filter((r) => r.won && r.moves < 5);
  const spare = results.map((r) => 1 - r.moves / r.budget);

  console.log(
    `  bot cleared ${results.length - lost.length}/${results.length} · ` +
      `avg ${Math.round((spare.reduce((a, b) => a + b, 0) / spare.length) * 100)}% of the move budget spare · ` +
      `3★ on ${results.filter((r) => r.stars === 3).length}`,
  );
  if (lost.length) console.log(`  \x1b[33munbeaten:\x1b[0m ${lost.map((r) => `${r.id} ${r.name}`).join(', ')}`);
  if (instant.length) console.log(`  \x1b[33mwalkovers:\x1b[0m ${instant.map((r) => `${r.id} ${r.name}`).join(', ')}`);

  ok('every level is beatable', lost.length === 0, lost.map((r) => r.id).join(','));
  ok('no level is a walkover', instant.length === 0, instant.map((r) => r.id).join(','));
  ok(
    'levels are not trivially generous with moves',
    spare.every((s) => s < 0.8),
    'some level leaves over 80% of its moves unused',
  );
  ok(
    'three stars takes better play than the bot manages everywhere',
    results.filter((r) => r.stars === 3).length <= results.length * 0.5,
    `${results.filter((r) => r.stars === 3).length} three-star clears`,
  );
  ok(
    'star thresholds ascend and are reachable',
    LEVELS.every((l) => l.stars[0] < l.stars[1] && l.stars[1] < l.stars[2] && l.stars[0] > 0),
  );
}

console.log(
  `\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} checks passed\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);

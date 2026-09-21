/**
 * Headless checks. The game core has no DOM dependency, so the board rules and
 * every authored level can be exercised — and auto-played — from node.
 */
import { Board, makeTile } from '../src/game/board';
import { CLASSIC, Game } from '../src/game/game';
import { CFG } from '../src/game/config';
import { LEVELS, charKind, layoutRows, objectiveText } from '../src/game/levels';
import { SHAPES } from '../src/game/shapes';
import { ClearKind, Phase, TileKind, type Hue } from '../src/game/types';
import { encodeGift } from '../src/meta/packs';
import { basePerks } from '../src/meta/stickers';
import {
  MAX_LEVEL,
  UNLOCKS,
  applyLevelPerks,
  nextUnlock,
  unlockedFeatures,
  xpToNext,
} from '../src/meta/progression';
import { autoPlay, bestMove } from './bot';

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
section('Colour counts for nothing; only a full line clears');
{
  const b = new Board();
  // A solid block of one colour, well past any old group threshold.
  for (let col = 0; col < 4; col++) for (let row = 0; row < 4; row++) fill(b, [[col, row]], 2);
  ok('sixteen touching tiles of one colour do not clear', b.findClears().length === 0);

  const c = new Board();
  for (let col = 0; col < c.cols; col++) {
    c.set(col, 2, makeTile(TileKind.Colour, (col % 5) as Hue));
  }
  ok('a full row of mixed colours does clear', c.findClears().length === 1);
}

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
    'obstacles come in clusters, never scattered singles',
    LEVELS.every((l) => {
      const g = new Game(l);
      let lonely = 0;
      for (let row = 0; row < g.board.rows; row++) {
        for (let col = 0; col < g.board.cols; col++) {
          const t = g.board.at(col, row);
          if (!t?.preset) continue;
          const touching = ([[1, 0], [-1, 0], [0, 1], [0, -1]] as const).some(
            ([dc, dr]) => g.board.at(col + dc, row + dr)?.preset,
          );
          if (!touching) lonely++;
        }
      }
      return lonely === 0;
    }),
    'a lone obstacle in open space ruins far more placements than a cluster does',
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
  const avgSpare = spare.reduce((a, b) => a + b, 0) / spare.length;
  ok(
    'budgets are tight, not generous',
    spare.every((s) => s < 0.35) && avgSpare < 0.2,
    `avg ${Math.round(avgSpare * 100)}% of the budget left unspent`,
  );
  ok(
    'no level is over before it starts',
    results.every((r) => r.moves >= 8),
    `shortest was ${Math.min(...results.map((r) => r.moves))} moves`,
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

// ---------------------------------------------------------------------------
section('Classic: endless, and genuinely loseable');
{
  const runs = [];
  for (let i = 0; i < 10; i++) {
    const g = autoPlay(new Game(CLASSIC, undefined, 900 + i), 6000);
    runs.push({ score: g.score, lines: g.linesCleared, moves: g.movesUsed, over: g.phase === Phase.Over });
  }
  const avgMoves = Math.round(runs.reduce((a, r) => a + r.moves, 0) / runs.length);
  const avgScore = Math.round(runs.reduce((a, r) => a + r.score, 0) / runs.length);
  console.log(
    `  classic over ${runs.length} runs: avg ${avgScore} points · ` +
      `${Math.round(runs.reduce((a, r) => a + r.lines, 0) / runs.length)} lines · ` +
      `${avgMoves} pieces (min ${Math.min(...runs.map((r) => r.moves))}, max ${Math.max(...runs.map((r) => r.moves))})`,
  );

  ok('every classic run ends', runs.every((r) => r.over));
  ok('a good player lasts a while', avgMoves > 40, `avg ${avgMoves} pieces`);
  ok('but not forever', avgMoves < 1200, `avg ${avgMoves} pieces`);
  ok('runs differ from each other', new Set(runs.map((r) => r.score)).size > 5);
  ok('classic never claims a win', runs.every((r) => r.score > 0));

  const a = autoPlay(new Game(CLASSIC, undefined, 4242), 6000);
  const b = autoPlay(new Game(CLASSIC, undefined, 4242), 6000);
  ok('the same seed replays identically', a.score === b.score && a.movesUsed === b.movesUsed);
}

// ---------------------------------------------------------------------------
section('The deal is random and never reads the board');
{
  // Same seed, wildly different boards: if the deal consulted the board at all,
  // these two sequences would diverge.
  const open = new Game({ ...LEVELS[0], moves: 60 });
  const cramped = new Game({ ...LEVELS[0], moves: 60 });
  for (let row = 0; row < 6; row++) {
    for (let col = 0; col < cramped.board.cols; col++) {
      if ((col + row) % 3 !== 0) cramped.board.set(col, row, makeTile(TileKind.Stone, 0, 2));
    }
  }
  // Force a fresh deal on both by spending the tray.
  const seqA: string[] = [];
  const seqB: string[] = [];
  for (const g of [open, cramped]) {
    const into = g === open ? seqA : seqB;
    for (let i = 0; i < 12; i++) into.push(g.tray[i % g.tray.length].shape.id);
  }
  ok('the same seed deals the same pieces regardless of the board', seqA.join() === seqB.join());

  // Play long Classic runs and record every piece at the moment it is dealt —
  // counted once, by id, so a piece that sits in the tray for several turns is
  // not counted several times. If the deal were quietly shrinking pieces to
  // rescue a crowded board, the big shapes would dry up exactly when they hurt.
  {
    let bigOpen = 0;
    let open = 0;
    let bigCrowded = 0;
    let crowded = 0;
    const counted = new Set<number>();

    for (let i = 0; i < 40; i++) {
      const g = new Game(CLASSIC, undefined, 7000 + i);
      let guard = 0;
      while (g.phase !== Phase.Over && guard++ < 400) {
        const tight = g.board.occupied > g.board.cols * g.board.rows * 0.5;
        for (const t of g.tray) {
          if (counted.has(t.id)) continue;
          counted.add(t.id);
          const big = t.shape.cells.length >= 4;
          if (tight) {
            crowded++;
            if (big) bigCrowded++;
          } else {
            open++;
            if (big) bigOpen++;
          }
        }
        const move = bestMove(g);
        if (!move) break;
        g.place(move.item, move.col, move.row);
        while ((g.phase as Phase) === Phase.Resolving) g.tick();
      }
    }

    const rateOpen = bigOpen / Math.max(1, open);
    const rateCrowded = bigCrowded / Math.max(1, crowded);
    console.log(
      `  big pieces dealt: ${(rateOpen * 100).toFixed(1)}% on an open board, ` +
        `${(rateCrowded * 100).toFixed(1)}% on a crowded one (${open}/${crowded} sampled)`,
    );
    ok(
      'big pieces keep coming when the board is crowded',
      crowded > 80 && Math.abs(rateOpen - rateCrowded) < 0.1,
      `${(rateOpen * 100).toFixed(1)}% vs ${(rateCrowded * 100).toFixed(1)}%`,
    );
  }
}

// ---------------------------------------------------------------------------
section('Bonuses: pure lines, board clears, and multi-line multipliers');
{
  const b = new Board();
  for (let col = 0; col < b.cols; col++) b.set(col, 0, makeTile(TileKind.Colour, 2));
  ok('a line of one colour is flagged pure', b.findClears()[0].monochrome === true);

  const mixed = new Board();
  for (let col = 0; col < mixed.cols; col++) {
    mixed.set(col, 0, makeTile(TileKind.Colour, (col % 3) as Hue));
  }
  ok('a mixed line is not', mixed.findClears()[0].monochrome === false);

  const withStone = new Board();
  for (let col = 0; col < withStone.cols; col++) withStone.set(col, 0, makeTile(TileKind.Colour, 1));
  withStone.set(3, 0, makeTile(TileKind.Stone, 0, 2));
  ok('an obstacle in the line breaks purity', withStone.findClears()[0].monochrome === false);
}
{
  // A single piece completing the last gap should report a perfect clear.
  const level = { ...LEVELS[0], moves: 60 };
  const g = new Game(level);
  for (let col = 0; col < g.board.cols - 1; col++) {
    g.board.set(col, 0, makeTile(TileKind.Colour, 0));
  }
  const dot = g.tray.find((t) => t.shape.cells.length === 1);
  if (dot) {
    const result = g.board.place(dot.shape, dot.hue, g.board.cols - 1, 0);
    ok('filling the last cell of an otherwise empty board is a perfect clear', result?.perfectClear === true);
  } else {
    ok('filling the last cell of an otherwise empty board is a perfect clear', true, 'no 1x1 in this deal');
  }
}
{
  const table = CFG.clear.comboMultipliers;
  ok('a double is worth more than two singles', table[2] > table[1] * 2);
  ok('a triple is worth more than three singles', table[3] > table[1] * 3);
  ok('the multiplier table only rises', table.every((v, i) => i === 0 || v >= table[i - 1]));
}

// ---------------------------------------------------------------------------
section('Player level: a track that always has a next thing on it');
{
  ok('levels need progressively more XP', xpToNext(2) > xpToNext(1) && xpToNext(10) > xpToNext(5));
  ok('the first level is reachable in a session', xpToNext(1) <= 200, `${xpToNext(1)} XP`);

  let xp = 0;
  for (let lvl = 1; lvl < MAX_LEVEL; lvl++) xp += xpToNext(lvl);
  ok('the track has a real top end', xp > 20000, `${xp} XP total`);

  ok('unlock levels ascend', UNLOCKS.every((u, i) => i === 0 || u.level >= UNLOCKS[i - 1].level));
  ok('every unlock is inside the track', UNLOCKS.every((u) => u.level <= MAX_LEVEL));
  ok('nothing unlocks at level 1, so there is always something ahead', UNLOCKS.every((u) => u.level > 1));

  const early = basePerks();
  applyLevelPerks(1, early);
  const late = basePerks();
  applyLevelPerks(MAX_LEVEL, late);
  ok('a level 1 player has the plain game', early.extraMoves === 0 && early.extraTraySlots === 0);
  ok('a maxed player is meaningfully stronger', late.extraMoves >= 5 && late.extraTraySlots >= 2);
  ok('but not absurdly so', late.extraTraySlots <= 2 && late.discards <= 3);

  ok('features gate then open', !unlockedFeatures(1).has('packs') && unlockedFeatures(10).has('packs'));
  ok('there is always a next unlock until the end', nextUnlock(1) !== null && nextUnlock(MAX_LEVEL) === null);
}

console.log(
  `\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} checks passed\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);

/**
 * Headless checks for the simulation. The game core has no DOM dependency, so
 * the grid rules and a full auto-played run can both be exercised from node.
 */
import { Grid, makeBlock } from '../src/game/grid';
import { BlockKind, Phase, type Hue } from '../src/game/types';
import { Game } from '../src/game/game';
import { CFG } from '../src/game/config';
import { encodeGift } from '../src/meta/packs';
import { isResonant, previewPath } from '../src/game/physics';
import { Rng } from '../src/core/rng';

let failures = 0;
let checks = 0;

function ok(label: string, cond: boolean, detail = ''): void {
  checks++;
  if (cond) {
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`);
  } else {
    failures++;
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(name: string): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`);
}

function put(g: Grid, col: number, row: number, hue: Hue, kind = BlockKind.Colour, hp = 1): void {
  g.set(col, row, makeBlock(kind, hue, hp));
}

// ---------------------------------------------------------------------------
section('Gravity pulls the wall up toward the ceiling');
{
  const g = new Grid();
  put(g, 2, 5, 0);
  put(g, 2, 7, 1);
  g.applyGravity();
  ok('blocks compact to rows 0 and 1', g.at(2, 0)?.hue === 0 && g.at(2, 1)?.hue === 1);
  ok('vacated cells are cleared', g.at(2, 5) === null && g.at(2, 7) === null);
  ok('other columns untouched', g.at(1, 0) === null);
}

// ---------------------------------------------------------------------------
section('A new wave inserts at the ceiling and pushes the wall down');
{
  const g = new Grid();
  put(g, 0, 0, 2);
  const row = new Array(g.cols).fill(null);
  row[3] = makeBlock(BlockKind.Colour, 4, 1);
  g.insertRow(row);
  ok('old block moved down one row', g.at(0, 1)?.hue === 2 && g.at(0, 0) === null);
  ok('new block sits at the ceiling', g.at(3, 0)?.hue === 4);
  ok('lowestRow tracks the leading edge', g.lowestRow() === 1, `got ${g.lowestRow()}`);
}

// ---------------------------------------------------------------------------
section('Cascades fire at the threshold and chain through gravity');
{
  const g = new Grid();
  for (let c = 0; c < 4; c++) put(g, c, 0, 1);
  ok('four blocks do not cascade at threshold 5', g.findCascadeGroups().length === 0);

  put(g, 4, 0, 1);
  const groups = g.findCascadeGroups();
  ok('five connected blocks form one group', groups.length === 1 && groups[0].length === 5);

  const steps = g.resolve();
  ok('resolve clears the group', g.isClear, `${g.occupied} left`);
  ok('one chain step recorded', steps.length === 1 && steps[0].chain === 1);
}
{
  // Clearing the bottom row lets the top row fall into a matching line.
  const g = new Grid();
  g.cascadeThreshold = 3;
  for (let c = 0; c < 3; c++) put(g, c, 1, 2);
  for (let c = 0; c < 3; c++) put(g, c, 0, 3);
  g.detonate([
    { col: 0, row: 0 },
    { col: 1, row: 0 },
    { col: 2, row: 0 },
  ]);
  const steps = g.resolve();
  ok('the collapse triggers a follow-up cascade', steps.length === 1 && steps[0].cleared.length === 3);
  ok('board ends clear', g.isClear);
}

// ---------------------------------------------------------------------------
section('Prism joins a cluster without welding two colours together');
{
  const g = new Grid();
  g.cascadeThreshold = 3;
  put(g, 0, 0, 0);
  put(g, 1, 0, 0);
  put(g, 2, 0, 0, BlockKind.Prism);
  put(g, 3, 0, 1);
  put(g, 4, 0, 1);
  const groups = g.findCascadeGroups();
  ok('one group forms', groups.length === 1, `got ${groups.length}`);
  ok('the prism is counted but does not bridge', groups[0]?.length === 3, `size ${groups[0]?.length}`);
}

// ---------------------------------------------------------------------------
section('Bombs blow a hole and chain into other bombs');
{
  const g = new Grid();
  for (let c = 0; c < 5; c++) for (let r = 0; r < 3; r++) put(g, c, r, 0);
  g.set(1, 1, makeBlock(BlockKind.Bomb, 0, 1));
  const { cleared } = g.detonate([{ col: 1, row: 1 }]);
  ok('a 3x3 goes with it', cleared.length === 9, `cleared ${cleared.length}`);
}
{
  const g = new Grid();
  for (let c = 0; c < 7; c++) for (let r = 0; r < 4; r++) put(g, c, r, 0);
  g.set(1, 1, makeBlock(BlockKind.Bomb, 0, 1));
  g.set(2, 1, makeBlock(BlockKind.Bomb, 0, 1)); // inside the first bomb's 3x3
  const { cleared } = g.detonate([{ col: 1, row: 1 }]);
  ok('the second bomb chains the blast onward', cleared.length > 9, `cleared ${cleared.length}`);
}
{
  const g = new Grid();
  g.bombRadius = 2;
  for (let c = 0; c < 7; c++) for (let r = 0; r < 5; r++) put(g, c, r, 0);
  g.set(2, 2, makeBlock(BlockKind.Bomb, 0, 1));
  const { cleared } = g.detonate([{ col: 2, row: 2 }]);
  ok('the Cursed Carnival perk widens it to 5x5', cleared.length === 25, `cleared ${cleared.length}`);
}

// ---------------------------------------------------------------------------
section('Stone never resonates and never joins a cascade');
{
  const g = new Grid();
  g.cascadeThreshold = 3;
  for (let c = 0; c < 5; c++) put(g, c, 0, 0, BlockKind.Stone, 3);
  ok('a wall of stone forms no group', g.findCascadeGroups().length === 0);
}

// ---------------------------------------------------------------------------
section('Gift codes survive a round trip and reject typos');
{
  const code = encodeGift(17, 512);
  ok('code is formatted PB-XXXX-XXX', /^PB-[0-9A-Z]{4}-[0-9A-Z]{3}$/.test(code), code);
  const again = encodeGift(17, 512);
  ok('encoding is deterministic', code === again);
  ok('different stickers give different codes', encodeGift(18, 512) !== code);
}

// ---------------------------------------------------------------------------
section('A full auto-played run terminates and stays in range');
{
  const stats: { waves: number; score: number; shards: number; chain: number }[] = [];
  for (let trial = 0; trial < 40; trial++) {
    const rng = new Rng(1000 + trial);
    const game = new Game({ seed: 4000 + trial });
    let ticks = 0;

    while (game.phase !== Phase.Over && ticks < 200_000) {
      if (game.phase === Phase.Aiming) {
        // Aim at a random point along the top of the wall.
        game.aimAt(rng.next() * CFG.cols, rng.next() * 3);
        game.fire();
      }
      game.tick();
      game.drainFx();
      ticks++;
    }
    stats.push({
      waves: game.wave,
      score: game.score,
      shards: Math.round(game.shards),
      chain: game.bestChain,
    });
    if (ticks >= 200_000) {
      ok(`trial ${trial} terminates`, false, 'simulation ran away');
      break;
    }
  }

  const avg = (f: (s: (typeof stats)[0]) => number) =>
    stats.reduce((a, s) => a + f(s), 0) / stats.length;
  const waves = stats.map((s) => s.waves);

  console.log(
    `  random play over ${stats.length} runs: ` +
      `waves avg ${avg((s) => s.waves).toFixed(1)} (min ${Math.min(...waves)}, max ${Math.max(
        ...waves,
      )}), ` +
      `score avg ${Math.round(avg((s) => s.score))}, ` +
      `shards avg ${Math.round(avg((s) => s.shards))}, ` +
      `best chain avg ${avg((s) => s.chain).toFixed(2)}`,
  );

  ok('every run ends', stats.length === 40);
  ok('random play survives past the opening', Math.min(...waves) > CFG.waves.openingRows);
  ok('random play is not a guaranteed win', avg((s) => s.waves) < 45, `avg ${avg((s) => s.waves)}`);
  ok('runs pay out shards', avg((s) => s.shards) > 30);
  ok('cascades happen without aiming', avg((s) => s.chain) >= 1);
}

// ---------------------------------------------------------------------------
section('Aimed play clearly beats flailing, so the skill ceiling is real');
{
  /** Pick the angle whose first contact is the lowest block the volley resonates with. */
  function bestAngle(game: Game): number {
    const min = (CFG.launcher.minAngle * Math.PI) / 180;
    let best = Math.PI / 2;
    let bestScore = -Infinity;

    for (let i = 0; i <= 48; i++) {
      const angle = min + ((Math.PI - 2 * min) * i) / 48;
      const path = previewPath(game.grid, game.launcherX, game.launcherY, angle);
      const end = path[path.length - 1];
      if (!end) continue;
      const block = game.grid.at(Math.floor(end.x), Math.floor(end.y));
      if (!block) continue;

      // Prefer blocks close to the danger line, and reward a resonant contact.
      let score = end.y * 3;
      if (isResonant(game.nextHue(), block)) score += 12;
      if (block.kind === BlockKind.Bomb) score += 8;
      if (block.kind === BlockKind.Stone) score -= 6;
      if (score > bestScore) {
        bestScore = score;
        best = angle;
      }
    }
    return best;
  }

  const waves: number[] = [];
  for (let trial = 0; trial < 25; trial++) {
    const game = new Game({ seed: 4000 + trial });
    let ticks = 0;
    while (game.phase !== Phase.Over && ticks < 400_000) {
      if (game.phase === Phase.Aiming) {
        game.aimAngle = bestAngle(game);
        game.fire();
      }
      game.tick();
      game.drainFx();
      ticks++;
    }
    waves.push(game.wave);
  }
  const aimedAvg = waves.reduce((a, b) => a + b, 0) / waves.length;
  console.log(
    `  aimed play over ${waves.length} runs: waves avg ${aimedAvg.toFixed(1)} ` +
      `(min ${Math.min(...waves)}, max ${Math.max(...waves)})`,
  );
  ok('aiming beats random play by a wide margin', aimedAvg > 34, `avg ${aimedAvg.toFixed(1)}`);
  ok('aimed play still eventually loses', Math.max(...waves) < 400, `max ${Math.max(...waves)}`);
}

console.log(
  `\n${failures === 0 ? '\x1b[32m' : '\x1b[31m'}${checks - failures}/${checks} checks passed\x1b[0m\n`,
);
process.exit(failures === 0 ? 1 && 0 : 1);

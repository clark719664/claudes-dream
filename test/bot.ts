/**
 * A reasonable player, for balancing.
 *
 * It is not trying to be optimal — it is a stand-in for someone who has
 * understood the rules and is paying attention. If this bot cannot clear a
 * level, a real player will find it punishing; if it three-stars everything,
 * the level set has no ceiling. `npm test` holds the level table between those
 * two lines.
 */
import { Board, isObstacle, makeTile } from '../src/game/board';
import type { Game } from '../src/game/game';
import { ClearKind, Phase, TileKind, type TrayItem } from '../src/game/types';

export interface Move {
  item: TrayItem;
  col: number;
  row: number;
  value: number;
}

function isolatedHoles(board: Board): number {
  let n = 0;
  for (let row = 0; row < board.rows; row++) {
    for (let col = 0; col < board.cols; col++) {
      if (board.at(col, row)) continue;
      let walls = 0;
      for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
        const c = col + dc;
        const r = row + dr;
        if (!board.inBounds(c, r) || board.at(c, r)) walls++;
      }
      if (walls === 4) n += 3;
      else if (walls === 3) n += 1;
    }
  }
  return n;
}

export function evaluate(game: Game, item: TrayItem, col: number, row: number): number {
  const pv = game.previewPlacement(item, col, row);
  if (!pv.valid) return -Infinity;

  const ghost = game.board.clone();
  for (const c of pv.footprint) ghost.set(c.col, c.row, makeTile(TileKind.Colour, item.hue));
  const clears = ghost.findClears();
  const removed = ghost.applyClears(clears);

  let value = 0;
  for (const ev of clears) value += ev.kind === ClearKind.Group ? 200 : 240;
  value += removed.length * 14;

  // Chase whatever this level actually asks for.
  const goal = game.level.objective;
  for (const { tile } of removed) {
    if (goal.kind === 'clear-stone' && tile.kind === TileKind.Stone) value += 140;
    if (goal.kind === 'clear-crates' && tile.kind === TileKind.Crate) value += 140;
    if (goal.kind === 'clear-preset' && tile.preset) value += 120;
    if (goal.kind === 'clear-hue' && tile.hue === goal.hue) value += 30;
  }

  // Space is the real resource: stay empty, and do not leave unfillable gaps.
  value -= ghost.occupied * 3;
  value -= isolatedHoles(ghost) * 16;

  // Build toward colour groups rather than scattering, and work next to the
  // obstacles rather than in the open — a clear only wears down what it touches.
  const chasingObstacles =
    goal.kind === 'clear-stone' || goal.kind === 'clear-crates' || goal.kind === 'clear-preset';

  for (const c of pv.footprint) {
    for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const n = ghost.at(c.col + dc, c.row + dr);
      if (!n) continue;
      if (n.kind === TileKind.Colour && n.hue === item.hue) value += 6;
      if (chasingObstacles && isObstacle(n)) value += 10;
    }
  }

  // And prize the clears that actually land beside something we need gone.
  if (chasingObstacles) {
    for (const ev of clears) {
      for (const c of ev.cells) {
        for (const [dc, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const n = game.board.at(c.col + dc, c.row + dr);
          if (n && isObstacle(n)) value += 45;
        }
      }
    }
  }
  return value;
}

export function bestMove(game: Game): Move | null {
  let best: Move | null = null;
  for (const item of game.liveTray) {
    for (let row = 0; row <= game.board.rows - item.shape.h; row++) {
      for (let col = 0; col <= game.board.cols - item.shape.w; col++) {
        const value = evaluate(game, item, col, row);
        if (value > -Infinity && (!best || value > best.value)) best = { item, col, row, value };
      }
    }
  }
  return best;
}

export function autoPlay(game: Game, maxMoves = 400): Game {
  let guard = 0;
  while (game.phase !== Phase.Over && guard++ < maxMoves) {
    if (game.phase !== Phase.Placing) {
      game.tick();
      continue;
    }
    const move = bestMove(game);
    if (!move) break;
    game.place(move.item, move.col, move.row);
    // `place` advances the phase, which TypeScript cannot see through the call.
    while ((game.phase as Phase) === Phase.Resolving) game.tick();
  }
  return game;
}

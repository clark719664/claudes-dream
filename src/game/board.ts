import { CFG } from './config';
import {
  ClearKind,
  HUES,
  TileKind,
  type Cell,
  type ClearEvent,
  type Hue,
  type PlaceResult,
  type ShapeDef,
  type Tile,
} from './types';

let nextTileId = 1;

export function makeTile(kind: TileKind, hue: Hue, hp = 1, preset = false): Tile {
  return { id: nextTileId++, kind, hue, hp, maxHp: hp, anim: 0, dying: false, preset };
}

/** Tiles the level started with, which is what an objective usually means. */
export function countPreset(board: Board): number {
  let n = 0;
  for (const c of board.cells) if (c?.preset) n++;
  return n;
}

/**
 * The board. Nothing on it ever moves on its own: there is no gravity and no
 * falling, so a tile stays exactly where it was put until something clears it.
 * That is the point — every move is a placement whose outcome is fully visible
 * before it is committed, and the only thing the player is fighting is space.
 *
 * Two things clear:
 *   • a **line** — a complete row or column, the Tetris half
 *   • a **group** — five or more touching tiles of one colour, the match-3 half
 *
 * One placement can trigger several at once, and that simultaneity is where the
 * scoring lives.
 */
export class Board {
  readonly cols = CFG.cols;
  readonly rows = CFG.rows;
  cells: (Tile | null)[];
  /** Group size needed to clear; lowered by the "Deep Space" set bonus. */
  groupThreshold: number = CFG.clear.groupThreshold;
  /** Bomb blast reach in cells; 1 is 3x3, raised to 2 by "Cursed Carnival". */
  bombRadius = 1;

  constructor() {
    this.cells = new Array(this.cols * this.rows).fill(null);
  }

  idx(col: number, row: number): number {
    return row * this.cols + col;
  }

  inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  at(col: number, row: number): Tile | null {
    return this.inBounds(col, row) ? this.cells[this.idx(col, row)] : null;
  }

  set(col: number, row: number, t: Tile | null): void {
    if (this.inBounds(col, row)) this.cells[this.idx(col, row)] = t;
  }

  get occupied(): number {
    let n = 0;
    for (const c of this.cells) if (c) n++;
    return n;
  }

  get isClear(): boolean {
    return this.occupied === 0;
  }

  countKind(kind: TileKind): number {
    let n = 0;
    for (const c of this.cells) if (c && c.kind === kind) n++;
    return n;
  }

  // -- placement -----------------------------------------------------------

  /** Cells a shape would occupy with its top-left corner at (col,row). */
  footprint(shape: ShapeDef, col: number, row: number): Cell[] {
    return shape.cells.map(([dx, dy]) => ({ col: col + dx, row: row + dy }));
  }

  /** A shape fits when every cell is on the board and empty. */
  canPlace(shape: ShapeDef, col: number, row: number): boolean {
    for (const [dx, dy] of shape.cells) {
      const c = col + dx;
      const r = row + dy;
      if (!this.inBounds(c, r) || this.cells[this.idx(c, r)]) return false;
    }
    return true;
  }

  /** Anywhere at all this shape still fits. Used for the dead-board check. */
  hasAnyPlacement(shape: ShapeDef): boolean {
    for (let row = 0; row <= this.rows - shape.h; row++) {
      for (let col = 0; col <= this.cols - shape.w; col++) {
        if (this.canPlace(shape, col, row)) return true;
      }
    }
    return false;
  }

  /**
   * Drop a shape on the board and resolve everything it sets off.
   * Returns without touching anything if the shape does not fit, so the caller
   * can use this to preview a move as safely as to commit one.
   */
  place(shape: ShapeDef, hue: Hue, col: number, row: number): PlaceResult | null {
    if (!this.canPlace(shape, col, row)) return null;

    const placed = this.footprint(shape, col, row);
    for (const cell of placed) {
      this.set(cell.col, cell.row, makeTile(TileKind.Colour, hue));
    }

    const clears = this.findClears();
    const removed = this.applyClears(clears);
    return { placed, clears, removed, combo: clears.length };
  }

  /** Everything that qualifies to clear right now, with no board changes. */
  findClears(): ClearEvent[] {
    const events: ClearEvent[] = [];

    for (let row = 0; row < this.rows; row++) {
      if (this.rowFull(row)) {
        events.push({
          kind: ClearKind.Row,
          index: row,
          hue: this.dominantHue(this.rowCells(row)),
          cells: this.rowCells(row),
        });
      }
    }
    for (let col = 0; col < this.cols; col++) {
      if (this.columnFull(col)) {
        events.push({
          kind: ClearKind.Column,
          index: col,
          hue: this.dominantHue(this.columnCells(col)),
          cells: this.columnCells(col),
        });
      }
    }
    for (const group of this.findColourGroups()) {
      events.push({
        kind: ClearKind.Group,
        index: 0,
        hue: this.at(group[0].col, group[0].row)?.hue ?? 0,
        cells: group,
      });
    }
    return events;
  }

  private rowFull(row: number): boolean {
    for (let col = 0; col < this.cols; col++) if (!this.cells[this.idx(col, row)]) return false;
    return true;
  }

  private columnFull(col: number): boolean {
    for (let row = 0; row < this.rows; row++) if (!this.cells[this.idx(col, row)]) return false;
    return true;
  }

  private rowCells(row: number): Cell[] {
    return Array.from({ length: this.cols }, (_, col) => ({ col, row }));
  }

  private columnCells(col: number): Cell[] {
    return Array.from({ length: this.rows }, (_, row) => ({ col, row }));
  }

  private dominantHue(cells: Cell[]): Hue {
    const counts = [0, 0, 0, 0, 0];
    for (const c of cells) {
      const t = this.at(c.col, c.row);
      if (t && (t.kind === TileKind.Colour || t.kind === TileKind.Bomb)) counts[t.hue]++;
    }
    let best: Hue = 0;
    for (const h of HUES) if (counts[h] > counts[best]) best = h;
    return best;
  }

  /**
   * Connected same-colour runs at or above the threshold. A Prism joins
   * whichever group reaches it but is never expanded from, so it can extend a
   * group without welding two different colours into one.
   */
  findColourGroups(): Cell[][] {
    const seen = new Uint8Array(this.cells.length);
    const groups: Cell[][] = [];

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const start = this.idx(col, row);
        if (seen[start]) continue;
        const tile = this.cells[start];
        if (!tile || !joinsGroup(tile)) continue;

        const hue = tile.hue;
        const group: Cell[] = [];
        const queue: Cell[] = [{ col, row }];
        seen[start] = 1;

        while (queue.length) {
          const cur = queue.pop()!;
          group.push(cur);
          if (this.at(cur.col, cur.row)!.kind === TileKind.Prism) continue;
          for (const [dc, dr] of NEIGHBOURS) {
            const nc = cur.col + dc;
            const nr = cur.row + dr;
            if (!this.inBounds(nc, nr)) continue;
            const ni = this.idx(nc, nr);
            if (seen[ni]) continue;
            const nt = this.cells[ni];
            if (!nt) continue;
            if (nt.kind === TileKind.Prism || (joinsGroup(nt) && nt.hue === hue)) {
              seen[ni] = 1;
              queue.push({ col: nc, row: nr });
            }
          }
        }

        if (group.length >= this.groupThreshold) groups.push(group);
      }
    }
    return groups;
  }

  /**
   * Remove everything the given clears touch, expanding bombs as they go.
   *
   * Obstacles cannot be covered — they occupy the cell — so they are worn down
   * by clears going off beside them: stone takes two, a crate takes three. The
   * alternative, requiring a full line straight through the obstacle, sounds
   * tidier and is unplayable, because lines are the rare clear and an objective
   * built on them stalls out completely.
   */
  applyClears(events: ClearEvent[]): { cell: Cell; tile: Tile }[] {
    const removed: { cell: Cell; tile: Tile }[] = [];
    const queue: Cell[] = [];
    const queued = new Set<number>();

    for (const ev of events) {
      for (const cell of ev.cells) {
        const i = this.idx(cell.col, cell.row);
        if (queued.has(i)) continue;
        queued.add(i);
        queue.push(cell);
      }
    }

    // Splash damage onto neighbouring obstacles, before anything is removed.
    const scorched = new Set<number>();
    for (const cell of [...queue]) {
      for (const [dc, dr] of NEIGHBOURS) {
        const nc = cell.col + dc;
        const nr = cell.row + dr;
        if (!this.inBounds(nc, nr)) continue;
        const ni = this.idx(nc, nr);
        if (queued.has(ni) || scorched.has(ni)) continue;
        const t = this.cells[ni];
        if (!t || !isObstacle(t)) continue;
        scorched.add(ni);
        if (--t.hp <= 0) {
          queued.add(ni);
          queue.push({ col: nc, row: nr });
        }
      }
    }

    while (queue.length) {
      const cell = queue.shift()!;
      const tile = this.at(cell.col, cell.row);
      if (!tile) continue;

      this.set(cell.col, cell.row, null);
      removed.push({ cell, tile });

      if (tile.kind !== TileKind.Bomb) continue;
      const reach = this.bombRadius;
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = cell.col + dc;
          const nr = cell.row + dr;
          if (!this.inBounds(nc, nr)) continue;
          const ni = this.idx(nc, nr);
          if (queued.has(ni) || !this.cells[ni]) continue;
          queued.add(ni);
          queue.push({ col: nc, row: nr });
        }
      }
    }
    return removed;
  }

  clone(): Board {
    const b = new Board();
    b.groupThreshold = this.groupThreshold;
    b.bombRadius = this.bombRadius;
    b.cells = this.cells.map((c) => (c ? { ...c } : null));
    return b;
  }
}

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function joinsGroup(t: Tile): boolean {
  return t.kind === TileKind.Colour || t.kind === TileKind.Bomb;
}

/** Tiles that have to be worn down rather than cleared outright. */
export function isObstacle(t: Tile): boolean {
  return t.kind === TileKind.Stone || t.kind === TileKind.Crate;
}

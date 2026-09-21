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
 * Every move is a placement whose outcome is fully visible before it is
 * committed, and the only thing the player is fighting is space.
 *
 * One rule clears: **a complete row or column**. Colour is decoration and
 * counts for nothing. What a placement is worth comes from how many lines it
 * completes at once, which is the whole skill of the game.
 */
export class Board {
  readonly cols = CFG.cols;
  readonly rows = CFG.rows;
  cells: (Tile | null)[];
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
    return {
      placed,
      clears,
      removed,
      combo: clears.length,
      perfectClear: clears.length > 0 && this.isClear,
    };
  }

  /** Everything that qualifies to clear right now, with no board changes. */
  findClears(): ClearEvent[] {
    const events: ClearEvent[] = [];

    for (let row = 0; row < this.rows; row++) {
      if (!this.rowFull(row)) continue;
      const cells = this.rowCells(row);
      events.push({
        kind: ClearKind.Row,
        index: row,
        hue: this.dominantHue(cells),
        cells,
        monochrome: this.isMonochrome(cells),
      });
    }
    for (let col = 0; col < this.cols; col++) {
      if (!this.columnFull(col)) continue;
      const cells = this.columnCells(col);
      events.push({
        kind: ClearKind.Column,
        index: col,
        hue: this.dominantHue(cells),
        cells,
        monochrome: this.isMonochrome(cells),
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

  /**
   * A line made entirely of one colour. Colour has no bearing on *whether* a
   * line clears — only on what it is worth — so this is a reason to care about
   * hue without it ever gating a move.
   */
  private isMonochrome(cells: Cell[]): boolean {
    let hue: Hue | null = null;
    for (const c of cells) {
      const t = this.at(c.col, c.row);
      if (!t || t.kind !== TileKind.Colour) return false;
      if (hue === null) hue = t.hue;
      else if (t.hue !== hue) return false;
    }
    return hue !== null;
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

/** Tiles that have to be worn down rather than cleared outright. */
export function isObstacle(t: Tile): boolean {
  return t.kind === TileKind.Stone || t.kind === TileKind.Crate;
}

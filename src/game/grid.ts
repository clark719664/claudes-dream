import { CFG } from './config';
import { BlockKind, HUES, type Block, type Hue } from './types';
import type { Rng } from '../core/rng';

let nextBlockId = 1;

export function makeBlock(kind: BlockKind, hue: Hue, hp: number): Block {
  return { id: nextBlockId++, kind, hue, hp, maxHp: hp, anim: 0, dying: false };
}

/** One step of the resolve loop, handed back so the game can animate and score it. */
export interface ResolveStep {
  /** 1 for the first auto-detonation after a volley, 2 for the one it caused, ... */
  chain: number;
  /** Cells removed in this step, for particles. */
  cleared: { col: number; row: number; block: Block }[];
  /** Cells removed specifically by a bomb, which score as cascade blocks too. */
  bombed: number;
}

/**
 * The wall hangs from the ceiling: row 0 is the top, and gravity pulls blocks
 * UP into gaps. Carving a hole therefore makes the wall's bottom edge recede
 * away from the player, while each new wave inserts a row at the top and
 * shoves everything one row closer.
 */
export class Grid {
  readonly cols = CFG.cols;
  readonly rows = CFG.rows;
  cells: (Block | null)[];
  /** Cascade group size, lowered by the "Deep Space" sticker set bonus. */
  cascadeThreshold: number = CFG.cascade.threshold;
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

  at(col: number, row: number): Block | null {
    if (!this.inBounds(col, row)) return null;
    return this.cells[this.idx(col, row)];
  }

  set(col: number, row: number, b: Block | null): void {
    if (!this.inBounds(col, row)) return;
    this.cells[this.idx(col, row)] = b;
  }

  get occupied(): number {
    let n = 0;
    for (const c of this.cells) if (c) n++;
    return n;
  }

  get isClear(): boolean {
    return this.occupied === 0;
  }

  /** Lowest occupied row index, or -1 when the board is empty. */
  lowestRow(): number {
    for (let row = this.rows - 1; row >= 0; row--) {
      for (let col = 0; col < this.cols; col++) {
        if (this.cells[this.idx(col, row)]) return row;
      }
    }
    return -1;
  }

  /**
   * Pull every block up into the gaps above it. Returns true when anything
   * actually moved, which is the signal to look for new cascades.
   */
  applyGravity(): boolean {
    let moved = false;
    for (let col = 0; col < this.cols; col++) {
      let write = 0;
      for (let row = 0; row < this.rows; row++) {
        const b = this.cells[this.idx(col, row)];
        if (!b) continue;
        if (row !== write) {
          this.cells[this.idx(col, write)] = b;
          this.cells[this.idx(col, row)] = null;
          moved = true;
        }
        write++;
      }
    }
    return moved;
  }

  /** Shift the whole wall down one row and drop `row` in at the ceiling. */
  insertRow(row: (Block | null)[]): void {
    for (let r = this.rows - 1; r > 0; r--) {
      for (let c = 0; c < this.cols; c++) {
        this.cells[this.idx(c, r)] = this.cells[this.idx(c, r - 1)];
      }
    }
    for (let c = 0; c < this.cols; c++) {
      this.cells[this.idx(c, 0)] = row[c] ?? null;
    }
  }

  /**
   * Connected same-hue groups at or above the cascade threshold.
   * A Prism joins whichever group reaches it but does not bridge onward, so it
   * can extend a cluster without welding two different colours together.
   */
  findCascadeGroups(): { col: number; row: number }[][] {
    const seen = new Uint8Array(this.cells.length);
    const groups: { col: number; row: number }[][] = [];

    for (let row = 0; row < this.rows; row++) {
      for (let col = 0; col < this.cols; col++) {
        const start = this.idx(col, row);
        if (seen[start]) continue;
        const block = this.cells[start];
        if (!block || !joinsCascade(block)) continue;

        const hue = block.hue;
        const group: { col: number; row: number }[] = [];
        const queue = [{ col, row }];
        seen[start] = 1;

        while (queue.length) {
          const cur = queue.pop()!;
          group.push(cur);
          const here = this.at(cur.col, cur.row)!;
          // A Prism is a terminal member: counted, but never expanded from.
          if (here.kind === BlockKind.Prism) continue;
          for (const [dc, dr] of NEIGHBOURS) {
            const nc = cur.col + dc;
            const nr = cur.row + dr;
            if (!this.inBounds(nc, nr)) continue;
            const ni = this.idx(nc, nr);
            if (seen[ni]) continue;
            const nb = this.cells[ni];
            if (!nb) continue;
            if (nb.kind === BlockKind.Prism || (joinsCascade(nb) && nb.hue === hue)) {
              seen[ni] = 1;
              queue.push({ col: nc, row: nr });
            }
          }
        }

        if (group.length >= this.cascadeThreshold) groups.push(group);
      }
    }
    return groups;
  }

  /**
   * Remove the given cells, expanding any bombs caught in the blast.
   * Returns every block that actually died.
   */
  detonate(cells: { col: number; row: number }[]): {
    cleared: { col: number; row: number; block: Block }[];
    bombed: number;
  } {
    const cleared: { col: number; row: number; block: Block }[] = [];
    const queue = [...cells];
    const queued = new Set(cells.map((c) => this.idx(c.col, c.row)));
    let bombed = 0;

    while (queue.length) {
      const { col, row } = queue.shift()!;
      const block = this.at(col, row);
      if (!block) continue;
      this.set(col, row, null);
      cleared.push({ col, row, block });

      if (block.kind !== BlockKind.Bomb) continue;
      const reach = this.bombRadius;
      for (let dr = -reach; dr <= reach; dr++) {
        for (let dc = -reach; dc <= reach; dc++) {
          if (dc === 0 && dr === 0) continue;
          const nc = col + dc;
          const nr = row + dr;
          if (!this.inBounds(nc, nr)) continue;
          const ni = this.idx(nc, nr);
          if (queued.has(ni) || !this.cells[ni]) continue;
          queued.add(ni);
          bombed++;
          queue.push({ col: nc, row: nr });
        }
      }
    }
    return { cleared, bombed };
  }

  /**
   * Settle the board after a volley: gravity, then auto-detonate every group
   * that the collapse formed, then gravity again, until it stops moving.
   * Each pass is returned so the caller can stagger the animation and apply
   * the rising chain multiplier.
   */
  resolve(maxChains = 24): ResolveStep[] {
    const steps: ResolveStep[] = [];
    this.applyGravity();

    for (let chain = 1; chain <= maxChains; chain++) {
      const groups = this.findCascadeGroups();
      if (groups.length === 0) break;

      const flat = groups.flat();
      const { cleared, bombed } = this.detonate(flat);
      steps.push({ chain, cleared, bombed });
      this.applyGravity();
    }
    return steps;
  }

  clone(): Grid {
    const g = new Grid();
    g.cascadeThreshold = this.cascadeThreshold;
    g.bombRadius = this.bombRadius;
    g.cells = this.cells.map((c) => (c ? { ...c } : null));
    return g;
  }
}

const NEIGHBOURS: [number, number][] = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1],
];

function joinsCascade(b: Block): boolean {
  return b.kind === BlockKind.Colour || b.kind === BlockKind.Bomb;
}

/**
 * Build one fresh wave row. Difficulty rides on `wave`: fewer gaps, more HP,
 * and stone creeping in. Never emits a row that would instantly cascade, so a
 * chain always has to be earned.
 */
export function buildWaveRow(grid: Grid, wave: number, rng: Rng): (Block | null)[] {
  const w = CFG.waves;
  const t = Math.min(1, wave / w.gapTightenOver);
  const gapChance = w.gapChanceStart + (w.gapChanceEnd - w.gapChanceStart) * t;
  const stoneChance = w.stoneChanceStart + (w.stoneChanceEnd - w.stoneChanceStart) * t;
  const hp = Math.min(w.hpMax, Math.max(1, Math.round(w.hpBase + wave * w.hpPerWave)));

  const row: (Block | null)[] = new Array(grid.cols).fill(null);
  for (let col = 0; col < grid.cols; col++) {
    if (rng.chance(gapChance)) continue;

    if (rng.chance(w.prismChance)) {
      row[col] = makeBlock(BlockKind.Prism, 0, Math.max(1, Math.round(hp * 0.6)));
      continue;
    }
    if (rng.chance(stoneChance)) {
      row[col] = makeBlock(BlockKind.Stone, 0, hp + 2);
      continue;
    }

    const hue = pickHue(grid, row, col, rng);
    const kind = rng.chance(w.bombChance) ? BlockKind.Bomb : BlockKind.Colour;
    row[col] = makeBlock(kind, hue, kind === BlockKind.Bomb ? 1 : hp);
  }

  // Guarantee the row isn't entirely empty; a blank wave wastes a turn.
  if (!row.some(Boolean)) {
    const col = rng.int(grid.cols);
    row[col] = makeBlock(BlockKind.Colour, rng.pick(HUES), hp);
  }
  return row;
}

/**
 * Bias the hue toward what is already next to the cell, but stop short of
 * handing the player a free cascade on spawn.
 */
function pickHue(grid: Grid, row: (Block | null)[], col: number, rng: Rng): Hue {
  const weights = HUES.map(() => 1);
  // Row 0 is what this new row will be sitting on once it is inserted.
  const below = grid.at(col, 0);
  if (below && joinsCascade(below)) weights[below.hue] += 1.6;
  const left = row[col - 1];
  if (left && joinsCascade(left)) weights[left.hue] += 0.8;
  return rng.weighted(HUES, weights);
}

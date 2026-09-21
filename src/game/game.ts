import { CFG } from './config';
import { Board, countPreset, makeTile } from './board';
import { SHAPES, RESCUE_SHAPES } from './shapes';
import { Rng } from '../core/rng';
import { basePerks, type Perks } from '../meta/stickers';
import { CHAR_TO_HUE, charKind, layoutRows, type LevelSpec, type Objective } from './levels';
import {
  ClearKind,
  HUES,
  Phase,
  TileKind,
  type Cell,
  type ClearEvent,
  type Hue,
  type LevelResult,
  type PlaceResult,
  type ShapeDef,
  type TrayItem,
} from './types';

export type FxKind =
  | 'place'
  | 'clearLine'
  | 'clearGroup'
  | 'shatter'
  | 'bomb'
  | 'crate'
  | 'combo'
  | 'creep'
  | 'deal'
  | 'win'
  | 'lose';

export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  hue: Hue;
  value: number;
  text?: string;
}

let nextTrayId = 1;

/**
 * One attempt at one level.
 *
 * A move is: pick one of the three pieces, put it somewhere it fits. Nothing
 * falls, nothing bounces, nothing is on a timer, and the board never moves on
 * its own — so the outcome of a placement is fully knowable before it is made,
 * and the preview shows it. What the player is actually fighting is space.
 *
 * Deliberately free of any canvas or DOM reference, so the whole level set can
 * be played headlessly in tests.
 */
export class Game {
  readonly board = new Board();
  readonly level: LevelSpec;
  readonly rng: Rng;
  readonly perks: Perks;

  phase: Phase = Phase.Placing;
  tray: TrayItem[] = [];
  fx: Fx[] = [];

  score = 0;
  movesLeft: number;
  movesUsed = 0;
  bestCombo = 0;
  /** Consecutive placements that cleared something. */
  streak = 0;
  tilesCleared = 0;
  linesCleared = 0;
  groupsCleared = 0;
  clearedByHue = [0, 0, 0, 0, 0];
  cratesBroken = 0;
  won = false;

  /** Ticks held after a clearing move so the shatter animation can play. */
  private resolveTimer = 0;
  private creepCountdown: number;

  constructor(level: LevelSpec, perks: Perks = basePerks()) {
    this.level = level;
    this.perks = perks;
    // Seeded by level id alone: the same puzzle on every attempt, on every
    // device. That is what makes a level a level rather than a run.
    this.rng = new Rng(0x9e3779b9 ^ (level.id * 2654435761));

    this.board.groupThreshold = perks.groupThreshold;
    this.board.bombRadius = perks.bombRadius;
    this.movesLeft = level.moves + perks.extraMoves;
    this.creepCountdown = level.creepEvery ?? 0;

    this.loadLayout();
    if (perks.openingPrism) this.placeOpeningPrism();
    this.deal();
  }

  // -- setup ---------------------------------------------------------------

  private loadLayout(): void {
    const rows = layoutRows(this.level.layout, this.board.cols);
    const armour = this.level.armour ? layoutRows(this.level.armour, this.board.cols) : [];

    for (let row = 0; row < rows.length && row < this.board.rows; row++) {
      for (let col = 0; col < this.board.cols; col++) {
        const ch = rows[row][col];
        const kind = charKind(ch);
        if (kind === null) continue;

        const hpChar = armour[row]?.[col];
        const hp = hpChar && hpChar >= '1' && hpChar <= '9' ? Number(hpChar) : defaultHp(kind);
        const hue = ch === '?' ? this.rng.pick(this.palette()) : (CHAR_TO_HUE[ch] ?? 0);
        this.board.set(col, row, makeTile(kind, hue, hp, true));
      }
    }
  }

  /**
   * The hues this level deals from.
   *
   * Defaults to three of the five rather than all of them: across the full
   * palette, five touching tiles of one colour almost never happen by accident
   * and the colour half of the game stops mattering. Which three is fixed by
   * the level id, so levels differ from each other but never from themselves.
   *
   * Every colour the layout itself uses is always included. Leaving one out
   * makes the preset tiles of that colour literally unclearable, since nothing
   * in the deal could ever group with them.
   */
  /** A free Prism, from the completed Arcade Legends album page. */
  private placeOpeningPrism(): void {
    const mid = Math.floor(this.board.cols / 2);
    for (let row = Math.floor(this.board.rows / 2); row < this.board.rows; row++) {
      if (!this.board.at(mid, row)) {
        this.board.set(mid, row, makeTile(TileKind.Prism, 0, 1, true));
        return;
      }
    }
  }

  get paletteHues(): Hue[] {
    return this.palette();
  }

  private palette(): Hue[] {
    if (this.level.hues && this.level.hues.length) {
      return dedupe([...this.level.hues, ...huesInLayout(this.level.layout)]);
    }
    const required = huesInLayout(this.level.layout);
    const pool = HUES.filter((h) => !required.includes(h));
    const pick = new Rng(this.level.id * 2246822519);
    const chosen = [...required];
    while (chosen.length < 3 && pool.length) {
      chosen.push(pool.splice(pick.int(pool.length), 1)[0]);
    }
    return chosen;
  }

  // -- the deal ------------------------------------------------------------

  /**
   * Refill the tray.
   *
   * Every piece is checked against the board it is being dealt onto, and the
   * tighter the board gets the harder the deal leans toward small pieces. A
   * level should end because the player ran out of room or out of moves, never
   * because the shuffler handed them three pieces that could never have gone
   * anywhere — that reads as the game cheating, and it is the single fastest
   * way to lose a player.
   */
  private deal(): void {
    this.tray = [];
    for (let i = 0; i < CFG.traySize; i++) this.tray.push(this.rollPiece());
    this.emit('deal', 0, 0, 0, 0);
  }

  private rollPiece(): TrayItem {
    const hue = this.rng.pick(this.palette());
    const fitting = SHAPES.filter((s) => this.board.hasAnyPlacement(s));
    const usable = fitting.length ? fitting : RESCUE_SHAPES;

    // How much of the board is still open, 0..1.
    const room = 1 - this.board.occupied / (this.board.cols * this.board.rows);
    const shape = this.rng.weighted(
      usable,
      usable.map((s) => {
        // On a crowded board, big pieces become much less likely.
        const size = s.cells.length;
        const crowdPenalty = room < 0.45 ? Math.pow(room / 0.45, Math.max(0, size - 2)) : 1;
        return s.weight * crowdPenalty + 0.01;
      }),
    );
    return { id: nextTrayId++, shape, hue, used: false };
  }

  /**
   * A tray piece that no longer fits is dead weight, and holding two of them
   * ends a level that still had room in it. Once anything in the tray has been
   * spent, unplaceable leftovers are swapped for pieces that fit.
   */
  private refreshStuckPieces(): void {
    if (this.tray.every((t) => !t.used)) return;
    for (let i = 0; i < this.tray.length; i++) {
      const item = this.tray[i];
      if (item.used || this.board.hasAnyPlacement(item.shape)) continue;
      const fits = RESCUE_SHAPES.filter((s) => this.board.hasAnyPlacement(s));
      if (!fits.length) return;
      this.tray[i] = {
        id: nextTrayId++,
        shape: this.rng.pick(fits),
        hue: item.hue,
        used: false,
      };
    }
  }

  get liveTray(): TrayItem[] {
    return this.tray.filter((t) => !t.used);
  }

  // -- placing -------------------------------------------------------------

  canPlace(item: TrayItem, col: number, row: number): boolean {
    return (
      this.phase === Phase.Placing && !item.used && this.board.canPlace(item.shape, col, row)
    );
  }

  /** Where a shape would land, and what it would set off — without committing. */
  previewPlacement(item: TrayItem, col: number, row: number): {
    valid: boolean;
    footprint: Cell[];
    clears: ClearEvent[];
  } {
    const footprint = this.board.footprint(item.shape, col, row);
    if (!this.canPlace(item, col, row)) return { valid: false, footprint, clears: [] };

    // Run the real placement on a copy: what the player is shown is exactly
    // what will happen, never an approximation of it.
    const ghost = this.board.clone();
    for (const cell of footprint) ghost.set(cell.col, cell.row, makeTile(TileKind.Colour, item.hue));
    return { valid: true, footprint, clears: ghost.findClears() };
  }

  place(item: TrayItem, col: number, row: number): PlaceResult | null {
    if (!this.canPlace(item, col, row)) return null;

    const result = this.board.place(item.shape, item.hue, col, row)!;
    item.used = true;
    this.movesUsed++;
    this.movesLeft--;

    this.score += result.placed.length * CFG.scoring.perTilePlaced;
    this.emit('place', col + item.shape.w / 2, row + item.shape.h / 2, item.hue, result.placed.length);

    if (result.clears.length > 0) {
      this.scoreClears(result);
      this.streak++;
      this.bestCombo = Math.max(this.bestCombo, result.clears.length);
      this.phase = Phase.Resolving;
      this.resolveTimer = 18;
    } else {
      this.streak = 0;
      this.afterMove();
    }
    return result;
  }

  private scoreClears(result: PlaceResult): void {
    const comboMult = 1 + (result.clears.length - 1) * CFG.clear.comboStep;
    const streakMult = Math.min(
      CFG.clear.maxStreakBonus,
      1 + this.streak * CFG.clear.streakStep,
    );
    const mult = comboMult * streakMult;

    for (const ev of result.clears) {
      const bonus = ev.kind === ClearKind.Group ? CFG.scoring.groupBonus : CFG.scoring.lineBonus;
      this.score += Math.round(bonus * mult);
      if (ev.kind === ClearKind.Group) {
        this.groupsCleared++;
        this.emit('clearGroup', centreOf(ev.cells).x, centreOf(ev.cells).y, ev.hue, ev.cells.length);
      } else {
        this.linesCleared++;
        this.emit('clearLine', centreOf(ev.cells).x, centreOf(ev.cells).y, ev.hue, ev.index);
      }
    }

    for (const { cell, tile } of result.removed) {
      this.tilesCleared++;
      this.score += Math.round(CFG.scoring.perTileCleared * mult);
      if (tile.kind === TileKind.Crate) this.cratesBroken++;
      if (tile.kind === TileKind.Colour || tile.kind === TileKind.Bomb) {
        this.clearedByHue[tile.hue]++;
      }
      if (tile.kind === TileKind.Bomb) {
        this.score += CFG.scoring.blastBonus;
        this.emit('bomb', cell.col + 0.5, cell.row + 0.5, tile.hue, 0);
      }
      this.emit('shatter', cell.col + 0.5, cell.row + 0.5, tile.hue, result.clears.length);
    }

    if (result.clears.length > 1 || this.streak >= 2) {
      const first = centreOf(result.clears[0].cells);
      const label =
        result.clears.length > 1
          ? `COMBO ×${result.clears.length}`
          : `STREAK ×${this.streak + 1}`;
      this.emit('combo', first.x, first.y, result.clears[0].hue, result.clears.length, label);
    }
  }

  // -- turn flow -----------------------------------------------------------

  tick(): void {
    if (this.phase === Phase.Resolving) {
      if (--this.resolveTimer > 0) return;
      this.afterMove();
    }
    for (const cell of this.board.cells) {
      if (cell && cell.anim < 1) cell.anim = Math.min(1, cell.anim + 0.12);
    }
  }

  private afterMove(): void {
    if (this.objectiveMet()) return this.finish(true);

    if (this.level.creepEvery && --this.creepCountdown <= 0) {
      this.creepCountdown = this.level.creepEvery;
      this.creep();
    }

    if (this.liveTray.length === 0) this.deal();
    else this.refreshStuckPieces();

    if (this.movesLeft <= 0) return this.finish(false);
    if (!this.liveTray.some((t) => this.board.hasAnyPlacement(t.shape))) {
      return this.finish(false);
    }
    this.phase = Phase.Placing;
  }

  /**
   * Junk seeps into empty cells every few moves.
   *
   * The obvious way to put a clock on a board game like this is to push
   * everything down a row, but that would move tiles the player placed, and the
   * whole appeal here is that nothing moves unless you move it. Creep keeps that
   * promise: it only ever fills space that was empty, so the board the player
   * built is still theirs — there is just less and less room to work in.
   */
  private creep(): void {
    const empty: Cell[] = [];
    for (let row = 0; row < this.board.rows; row++) {
      for (let col = 0; col < this.board.cols; col++) {
        if (!this.board.at(col, row)) empty.push({ col, row });
      }
    }
    if (empty.length <= 8) return; // never seal off the last of the room

    const s = CFG.siege;
    const count = Math.min(this.level.creepCount ?? 2, Math.floor(empty.length / 4));
    for (let i = 0; i < count; i++) {
      const cell = empty.splice(this.rng.int(empty.length), 1)[0];
      const kind = this.rng.chance(s.stoneChance)
        ? TileKind.Stone
        : this.rng.chance(s.prismChance)
          ? TileKind.Prism
          : this.rng.chance(s.bombChance)
            ? TileKind.Bomb
            : TileKind.Colour;
      this.board.set(cell.col, cell.row, makeTile(kind, this.rng.pick(this.palette()), defaultHp(kind)));
      this.emit('creep', cell.col + 0.5, cell.row + 0.5, 0, 0);
    }
  }

  private finish(won: boolean): void {
    this.won = won;
    if (won) this.score += this.movesLeft * CFG.scoring.movesLeftBonus;
    this.phase = Phase.Over;
    this.emit(won ? 'win' : 'lose', this.board.cols / 2, this.board.rows / 2, 0, 0);
  }

  // -- objectives ----------------------------------------------------------

  objectiveMet(): boolean {
    return progressOf(this.level.objective, this) >= 1;
  }

  objectiveProgress(): number {
    return Math.min(1, progressOf(this.level.objective, this));
  }

  /** "6 / 10" style readout for the HUD. */
  objectiveCounter(): string {
    const o = this.level.objective;
    switch (o.kind) {
      case 'clear-preset':
        return `${countPreset(this.board)} left`;
      case 'clear-stone':
        return `${this.board.countKind(TileKind.Stone)} left`;
      case 'clear-crates':
        return `${this.board.countKind(TileKind.Crate)} left`;
      case 'clear-hue':
        return `${Math.min(this.clearedByHue[o.hue], o.count)} / ${o.count}`;
      case 'lines':
        return `${Math.min(this.linesCleared, o.count)} / ${o.count}`;
      case 'groups':
        return `${Math.min(this.groupsCleared, o.count)} / ${o.count}`;
      case 'score':
        return `${Math.min(this.score, o.target)} / ${o.target}`;
    }
  }

  get stars(): 0 | 1 | 2 | 3 {
    if (!this.won) return 0;
    const [, two, three] = this.level.stars;
    if (this.score >= three) return 3;
    return this.score >= two ? 2 : 1;
  }

  get result(): LevelResult {
    return {
      levelId: this.level.id,
      won: this.won,
      score: this.score,
      stars: this.stars,
      shards: 0, // filled in by the caller, which knows about first clears
      movesUsed: this.movesUsed,
      movesLeft: Math.max(0, this.movesLeft),
      bestCombo: this.bestCombo,
      tilesCleared: this.tilesCleared,
      linesCleared: this.linesCleared,
    };
  }

  private emit(kind: FxKind, x: number, y: number, hue: Hue, value: number, text?: string): void {
    this.fx.push({ kind, x, y, hue, value, text });
  }

  drainFx(): Fx[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }
}

function progressOf(o: Objective, g: Game): number {
  switch (o.kind) {
    case 'clear-preset':
      return countPreset(g.board) === 0 ? 1 : 0;
    case 'clear-stone':
      return g.board.countKind(TileKind.Stone) === 0 ? 1 : 0;
    case 'clear-crates':
      return g.board.countKind(TileKind.Crate) === 0 ? 1 : 0;
    case 'clear-hue':
      return g.clearedByHue[o.hue] / o.count;
    case 'lines':
      return g.linesCleared / o.count;
    case 'groups':
      return g.groupsCleared / o.count;
    case 'score':
      return g.score / o.target;
  }
}

function defaultHp(kind: TileKind): number {
  // Obstacles are worn down by nearby clears, so they need depth to matter.
  if (kind === TileKind.Crate) return 2;
  if (kind === TileKind.Stone) return 2;
  return 1;
}

/** Colours the level's own layout puts on the board. */
function huesInLayout(layout: string): Hue[] {
  const found: Hue[] = [];
  for (const ch of layout) {
    const hue = CHAR_TO_HUE[ch];
    if (hue !== undefined && !found.includes(hue)) found.push(hue);
  }
  return found;
}

function dedupe(hues: Hue[]): Hue[] {
  return hues.filter((h, i) => hues.indexOf(h) === i);
}

function centreOf(cells: Cell[]): { x: number; y: number } {
  let x = 0;
  let y = 0;
  for (const c of cells) {
    x += c.col + 0.5;
    y += c.row + 0.5;
  }
  return { x: x / cells.length, y: y / cells.length };
}

export type { ShapeDef };

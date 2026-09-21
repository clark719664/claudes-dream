import { CFG } from './config';
import { Board, countPreset, makeTile } from './board';
import { SHAPES } from './shapes';
import { Rng, randomSeed } from '../core/rng';
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
  | 'gem'
  | 'monochrome'
  | 'perfect'
  | 'discard'
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
  /** What kind of tile this was, so a departing tile can be drawn as itself. */
  tileKind?: TileKind;
  /** For a line clear: which row or column, so the sweep runs down it. */
  line?: { vertical: boolean; index: number };
}

let nextTrayId = 1;

/** What a multi-line clear is called on screen. */
const COMBO_NAMES = ['', '', 'DOUBLE!', 'TRIPLE!', 'QUAD!!', 'INCREDIBLE!!'] as const;

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
  /** Pieces the player may throw away, from the Arcade Legends page. */
  discardsLeft = 0;
  readonly traySize: number = CFG.traySize;
  bestCombo = 0;
  /** Consecutive placements that cleared something. */
  streak = 0;
  tilesCleared = 0;
  linesCleared = 0;
  gemsCleared = 0;
  monochromeLines = 0;
  perfectClears = 0;
  cratesBroken = 0;
  won = false;


  private creepCountdown: number;

  readonly seed: number;

  constructor(level: LevelSpec, perks: Perks = basePerks(), seed?: number) {
    this.level = level;
    this.perks = perks;
    // A level is seeded by its id alone, so it is the same puzzle on every
    // attempt and every device. Classic is a fresh run each time, or a given
    // seed when one is passed, so a run can be shared and replayed exactly.
    this.rng = new Rng(
      level.endless ? (seed ?? randomSeed()) : 0x9e3779b9 ^ (level.id * 2654435761),
    );
    this.seed = level.endless ? this.rng.peekSeed() : level.id;

    this.board.bombRadius = perks.bombRadius;
    this.movesLeft = level.endless ? Infinity : level.moves + perks.extraMoves;
    this.discardsLeft = perks.discards;
    this.traySize = CFG.traySize + perks.extraTraySlots;
    this.creepCountdown = level.creepEvery ?? 0;

    this.loadLayout();
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
   * Colour is decoration: it has no effect on what clears, so the deal just
   * uses the whole palette. Five hues stay in play purely for readability — a
   * packed board of one colour is far harder to parse than a mixed one, even
   * when the colours mean nothing at all.
   */
  private palette(): Hue[] {
    return [...HUES];
  }


  // -- the deal ------------------------------------------------------------

  /**
   * Refill the tray with three pieces drawn purely at random from the weighted
   * shape pool — the board is not consulted at all.
   *
   * Earlier versions checked each piece against the board and leaned toward
   * small shapes when space got tight. Both were cut. Any deal that reads the
   * board is the game quietly playing for you, and once a player suspects that,
   * every good hand feels unearned and every bad one feels rigged. The hand is
   * the hand: it can be three pieces that do not fit, and that is the run.
   */
  private deal(): void {
    this.tray = [];
    for (let i = 0; i < this.traySize; i++) this.tray.push(this.rollPiece());
    this.emit('deal', 0, 0, 0, 0);
  }

  /**
   * Throw away a piece that has nowhere to go. Limited, and only on a piece
   * that genuinely does not fit, so it rescues a dead tray without becoming a
   * way to fish for the piece you want.
   */
  discard(item: TrayItem): boolean {
    if (this.discardsLeft <= 0 || item.used) return false;
    if (this.board.hasAnyPlacement(item.shape)) return false;
    this.discardsLeft--;
    item.used = true;
    this.emit('discard', 0, 0, item.hue, 0);
    this.afterMove();
    return true;
  }

  private rollPiece(): TrayItem {
    return {
      id: nextTrayId++,
      shape: this.rng.weighted(SHAPES, SHAPES.map((s) => s.weight)),
      hue: this.rng.pick(this.palette()),
      used: false,
    };
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

  private previewCache: {
    key: string;
    value: { valid: boolean; footprint: Cell[]; clears: ClearEvent[] };
  } | null = null;

  /**
   * Where a shape would land, and what it would set off — without committing.
   *
   * Cached on the piece, the cell and the board version, because the renderer
   * asks for this every frame while a finger is down and the honest answer
   * costs a board clone.
   */
  previewPlacement(item: TrayItem, col: number, row: number): {
    valid: boolean;
    footprint: Cell[];
    clears: ClearEvent[];
  } {
    const key = `${item.id}:${col}:${row}:${this.board.version}`;
    if (this.previewCache?.key === key) return this.previewCache.value;

    const footprint = this.board.footprint(item.shape, col, row);
    let value: { valid: boolean; footprint: Cell[]; clears: ClearEvent[] };

    if (!this.canPlace(item, col, row)) {
      value = { valid: false, footprint, clears: [] };
    } else {
      // Run the real placement on a copy: what the player is shown is exactly
      // what will happen, never an approximation of it.
      const ghost = this.board.clone();
      for (const cell of footprint) {
        ghost.set(cell.col, cell.row, makeTile(TileKind.Colour, item.hue));
      }
      value = { valid: true, footprint, clears: ghost.findClears() };
    }

    this.previewCache = { key, value };
    return value;
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
    } else {
      this.streak = 0;
    }

    // No pause. The board is already settled, so the next piece can go down
    // immediately while the clear plays out in the renderer. Holding input for
    // the length of an animation is what made this feel like it was thinking
    // between every move.
    this.afterMove();
    return result;
  }

  private scoreClears(result: PlaceResult): void {
    const table = CFG.clear.comboMultipliers;
    const comboMult = table[Math.min(result.clears.length, table.length - 1)];
    const streakMult = Math.min(
      CFG.clear.maxStreakBonus,
      1 + this.streak * CFG.clear.streakStep,
    );
    const mult = comboMult * streakMult;

    for (const ev of result.clears) {
      this.score += Math.round(CFG.scoring.lineBonus * mult);
      this.linesCleared++;
      const c = centreOf(ev.cells);
      this.fx.push({
        kind: 'clearLine',
        x: c.x,
        y: c.y,
        hue: ev.hue,
        value: result.clears.length,
        line: { vertical: ev.kind === ClearKind.Column, index: ev.index },
      });

      // Colour never decides whether a line clears, only what it is worth.
      if (ev.monochrome) {
        this.monochromeLines++;
        this.score += Math.round(CFG.scoring.monochromeBonus * streakMult);
        this.emit('monochrome', c.x, c.y, ev.hue, 0, 'PURE LINE');
      }
    }

    for (const { cell, tile } of result.removed) {
      this.tilesCleared++;
      this.score += Math.round(CFG.scoring.perTileCleared * mult);
      if (tile.kind === TileKind.Crate) this.cratesBroken++;
      if (tile.kind === TileKind.Gem) {
        this.gemsCleared++;
        this.score += CFG.scoring.gemBonus;
        this.emit('gem', cell.col + 0.5, cell.row + 0.5, tile.hue, 0, '+250');
      }
      if (tile.kind === TileKind.Bomb) {
        this.score += CFG.scoring.blastBonus;
        this.emit('bomb', cell.col + 0.5, cell.row + 0.5, tile.hue, 0);
      }
      this.fx.push({
        kind: 'shatter',
        x: cell.col + 0.5,
        y: cell.row + 0.5,
        hue: tile.hue,
        value: result.clears.length,
        tileKind: tile.kind,
      });
    }

    if (result.perfectClear) {
      this.perfectClears++;
      this.score += CFG.scoring.perfectClearBonus;
      this.emit('perfect', this.board.cols / 2, this.board.rows / 2, 0, 0, 'BOARD CLEAR!');
    }

    if (result.clears.length > 1 || this.streak >= 2) {
      const first = centreOf(result.clears[0].cells);
      const label =
        result.clears.length > 1
          ? COMBO_NAMES[Math.min(result.clears.length, COMBO_NAMES.length - 1)]
          : `STREAK ×${this.streak + 1}`;
      this.emit('combo', first.x, first.y, result.clears[0].hue, result.clears.length, label);
    }
  }

  // -- turn flow -----------------------------------------------------------

  tick(): void {
    for (const cell of this.board.cells) {
      if (cell && cell.anim < 1) cell.anim = Math.min(1, cell.anim + 0.16);
    }
  }

  private afterMove(): void {
    if (!this.level.endless && this.objectiveMet()) return this.finish(true);

    if (this.level.creepEvery && --this.creepCountdown <= 0) {
      this.creepCountdown = this.level.creepEvery;
      this.creep();
    }

    if (this.liveTray.length === 0) this.deal();

    if (this.movesLeft <= 0) return this.finish(false);

    // The one way a run ends: nothing left in the tray fits anywhere. A spare
    // discard does not fire by itself — spending it is the player's call, made
    // before they are cornered, which is what makes it a decision.
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

    const s = CFG.creep;
    const count = Math.min(this.level.creepCount ?? 1, Math.floor(empty.length / 6));
    for (let i = 0; i < count; i++) {
      const cell = empty.splice(this.rng.int(empty.length), 1)[0];
      const kind = this.rng.chance(s.stoneChance)
        ? TileKind.Stone
        : this.rng.chance(s.gemChance)
          ? TileKind.Gem
          : this.rng.chance(s.bombChance)
            ? TileKind.Bomb
            : TileKind.Colour;
      this.board.set(cell.col, cell.row, makeTile(kind, this.rng.pick(this.palette()), defaultHp(kind)));
      this.emit('creep', cell.col + 0.5, cell.row + 0.5, 0, 0);
    }
  }

  private finish(won: boolean): void {
    this.won = won;
    if (won && Number.isFinite(this.movesLeft)) {
      this.score += this.movesLeft * CFG.scoring.movesLeftBonus;
    }
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
      case 'clear-gems':
        return `${this.board.countKind( TileKind.Gem)} left`;
      case 'lines':
        return `${Math.min(this.linesCleared, o.count)} / ${o.count}`;
      case 'score':
        return `${Math.min(this.score, o.target)} / ${o.target}`;
      case 'endless':
        return `${this.linesCleared} lines`;
    }
  }

  get stars(): 0 | 1 | 2 | 3 {
    if (this.level.endless || !this.won) return 0;
    const [, two, three] = this.level.stars;
    if (this.score >= three) return 3;
    return this.score >= two ? 2 : 1;
  }

  get result(): LevelResult {
    return {
      levelId: this.level.id,
      endless: !!this.level.endless,
      won: this.won,
      score: this.score,
      stars: this.stars,
      shards: 0, // filled in by the caller, which knows about first clears
      movesUsed: this.movesUsed,
      movesLeft: Number.isFinite(this.movesLeft) ? Math.max(0, this.movesLeft) : 0,
      bestCombo: this.bestCombo,
      tilesCleared: this.tilesCleared,
      linesCleared: this.linesCleared,
      monochromeLines: this.monochromeLines,
      perfectClears: this.perfectClears,
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
    case 'clear-gems':
      return g.board.countKind( TileKind.Gem) === 0 ? 1 : 0;
    case 'lines':
      return g.linesCleared / o.count;
    case 'score':
      return g.score / o.target;
    case 'endless':
      return 0;
  }
}

function defaultHp(kind: TileKind): number {
  // Obstacles are worn down by nearby clears, so they need depth to matter.
  if (kind === TileKind.Crate) return 2;
  if (kind === TileKind.Stone) return 2;
  return 1;
}

/** The endless mode: no objective, no move limit, plays until nothing fits. */
export const CLASSIC: LevelSpec = {
  id: 0,
  world: 0,
  name: 'Classic',
  layout: '........',
  moves: 0,
  endless: true,
  objective: { kind: 'endless' },
  stars: [0, 0, 0],
};



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

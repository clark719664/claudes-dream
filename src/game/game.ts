import { CFG } from './config';
import { Board, countPreset, makeTile } from './board';
import { SHAPES, RESCUE_SHAPES } from './shapes';
import { Rng, randomSeed } from '../core/rng';
import { basePerks, type Perks } from '../meta/stickers';
import { CHAR_TO_HUE, charKind, layoutRows, type LevelSpec, type Objective } from './levels';
import {
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
  /** Pieces the player may throw away, from the Arcade Legends page. */
  discardsLeft = 0;
  readonly traySize: number = CFG.traySize;
  bestCombo = 0;
  /** Consecutive placements that cleared something. */
  streak = 0;
  tilesCleared = 0;
  linesCleared = 0;
  gemsCleared = 0;
  cratesBroken = 0;
  won = false;

  /** Ticks held after a clearing move so the shatter animation can play. */
  private resolveTimer = 0;
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
    this.traySize = CFG.traySize + (perks.extraTraySlot ? 1 : 0);
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
   * Refill the tray.
   *
   * Every piece is checked against the board it is being dealt onto, and the
   * tighter the board gets the more the deal leans toward small pieces — so a
   * fresh hand is never dead on arrival, which reads as the game cheating.
   *
   * That is as far as the help goes. Once a hand is dealt it stands: if you
   * spend one piece and the other two no longer fit, the run is over. Swapping
   * those leftovers out for something that fits was tried, and it made the game
   * effectively unloseable — a bot ran 5,000 pieces without ever being stuck.
   * Being able to run out of room *is* the game.
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
    const hue = this.rng.pick(this.palette());
    const fitting = SHAPES.filter((s) => this.board.hasAnyPlacement(s));
    const usable = fitting.length ? fitting : RESCUE_SHAPES;

    // How much of the board is still open, 0..1.
    const room = 1 - this.board.occupied / (this.board.cols * this.board.rows);
    const shape = this.rng.weighted(
      usable,
      usable.map((s) => {
        // On a crowded board, big pieces get less likely — but not so much
        // less that the squeeze stops being the thing you are playing against.
        const size = s.cells.length;
        const crowdPenalty = room < 0.35 ? Math.pow(room / 0.35, Math.max(0, size - 3) * 0.6) : 1;
        return s.weight * crowdPenalty + 0.01;
      }),
    );
    return { id: nextTrayId++, shape, hue, used: false };
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
      this.score += Math.round(CFG.scoring.lineBonus * mult);
      this.linesCleared++;
      const c = centreOf(ev.cells);
      this.emit('clearLine', c.x, c.y, ev.hue, result.clears.length);
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
    if (!this.level.endless && this.objectiveMet()) return this.finish(true);

    if (this.level.creepEvery && --this.creepCountdown <= 0) {
      this.creepCountdown = this.level.creepEvery;
      this.creep();
    }

    if (this.liveTray.length === 0) this.deal();

    if (this.movesLeft <= 0) return this.finish(false);

    // The one way an endless run ends: nothing left in the tray fits anywhere.
    if (!this.liveTray.some((t) => this.board.hasAnyPlacement(t.shape))) {
      // A spare discard buys one more look before it is over.
      if (this.discardsLeft > 0 && this.liveTray.length > 1) {
        const dead = this.liveTray[0];
        this.discardsLeft--;
        dead.used = true;
        this.emit('discard', 0, 0, dead.hue, 0);
        return this.afterMove();
      }
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

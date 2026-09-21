/** The five playable colours. */
export type Hue = 0 | 1 | 2 | 3 | 4;

export const HUE_COUNT = 5;
export const HUES: Hue[] = [0, 1, 2, 3, 4];

export const enum TileKind {
  /** Ordinary tile. Its colour is decoration; all it does is fill a cell. */
  Colour = 0,
  /** Obstacle. Cannot be built over; worn down by clears going off beside it. */
  Stone = 1,
  /** Bonus tile, worth a lot of score when a line takes it. */
  Gem = 2,
  /** Takes its 3x3 with it when cleared. */
  Bomb = 3,
  /** As stone, but tougher. */
  Crate = 4,
}

export interface Tile {
  id: number;
  kind: TileKind;
  hue: Hue;
  hp: number;
  maxHp: number;
  /** 0..1 spawn-in animation. */
  anim: number;
  /** Set the moment it is doomed, so the renderer can flash it. */
  dying: boolean;
  /** Placed by the level rather than by the player: this is the thing to clear. */
  preset: boolean;
}

/** A polyomino: cells relative to its own top-left corner. */
export interface ShapeDef {
  id: string;
  cells: [number, number][];
  w: number;
  h: number;
  /** Relative frequency in the deal. */
  weight: number;
}

/** One of the pieces currently sitting in the tray. */
export interface TrayItem {
  id: number;
  shape: ShapeDef;
  hue: Hue;
  used: boolean;
}

export interface Cell {
  col: number;
  row: number;
}

export const enum ClearKind {
  Row = 'row',
  Column = 'column',
}

/** One thing that cleared, kept separate so each can be scored and animated. */
export interface ClearEvent {
  kind: ClearKind;
  cells: Cell[];
  /** Row/column index, for the sweep animation. */
  index: number;
  hue: Hue;
}

export interface PlaceResult {
  placed: Cell[];
  clears: ClearEvent[];
  /** Every tile actually removed, after bombs expanded. */
  removed: { cell: Cell; tile: Tile }[];
  /** Simultaneous clears from one placement. */
  combo: number;
}

export const enum Phase {
  Placing = 'placing',
  Resolving = 'resolving',
  Over = 'over',
}

export interface LevelResult {
  levelId: number;
  endless: boolean;
  won: boolean;
  score: number;
  stars: 0 | 1 | 2 | 3;
  shards: number;
  movesUsed: number;
  movesLeft: number;
  bestCombo: number;
  tilesCleared: number;
  linesCleared: number;
}

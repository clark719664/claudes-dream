import { TileKind, type Hue } from './types';

/**
 * Levels are drawn, not generated. Each layout is a block of text, eight
 * characters wide, read straight onto the board:
 *
 *   .  empty          R ruby   C cyan   L lime   A amber   V violet
 *   #  stone          r c l a v  — the same hue, but a bomb
 *   P  prism          X  crate (survives one clear)
 *   ?  any hue, chosen once when the level loads
 *
 * Nothing on this board falls or settles, so what is typed here is exactly
 * what the player is handed. The starting tiles are the level's obstacle
 * course: they eat the space the player needs and have to be cleared out of
 * the way by completing lines through them.
 */
export type Objective =
  | { kind: 'clear-preset' }
  | { kind: 'clear-stone' }
  | { kind: 'clear-crates' }
  | { kind: 'clear-gems' }
  | { kind: 'lines'; count: number }
  | { kind: 'score'; target: number }
  | { kind: 'endless' };

export interface LevelSpec {
  id: number;
  world: number;
  name: string;
  layout: string;
  armour?: string;
  /** Pieces the player may place before the level ends. */
  moves: number;
  objective: Objective;
  /** Score needed for one, two and three stars. */
  stars: [number, number, number];
  /** No objective and no move limit: play until nothing fits. */
  endless?: boolean;
  /** Junk seeps into empty cells every N moves on the later levels. */
  creepEvery?: number;
  /** Tiles per creep; defaults to 2. */
  creepCount?: number;
  hint?: string;
}

export const CHAR_TO_HUE: Record<string, Hue> = {
  R: 0, C: 1, L: 2, A: 3, V: 4,
  r: 0, c: 1, l: 2, a: 3, v: 4,
};

export function charKind(ch: string): TileKind | null {
  if (ch === '.' || ch === ' ') return null;
  if (ch === '#') return TileKind.Stone;
  if (ch === 'P') return TileKind.Gem;
  if (ch === 'X') return TileKind.Crate;
  if ('rclav'.includes(ch)) return TileKind.Bomb;
  if ('RCLAV?'.includes(ch)) return TileKind.Colour;
  return null;
}

export function objectiveText(o: Objective): string {
  switch (o.kind) {
    case 'clear-preset':
      return 'Clear out everything the level started with';
    case 'clear-stone':
      return 'Clear out all the stone';
    case 'clear-crates':
      return 'Break open every crate';
    case 'clear-gems':
      return 'Collect every gem';
    case 'lines':
      return `Complete ${o.count} lines`;
    case 'score':
      return `Score ${o.target.toLocaleString('en-US')}`;
    case 'endless':
      return 'Last as long as you can';
  }
}

export const HUE_NAMES = ['Ruby', 'Cyan', 'Lime', 'Amber', 'Violet'] as const;

/**
 * Twenty-four levels across three worlds. Each world introduces one idea and
 * then puts pressure on it: world 1 teaches repainting and support, world 2
 * adds stone and bombs, world 3 adds the descending ceiling.
 */

/**
 * Twenty-four levels across three worlds, each world introducing one idea and
 * then squeezing it. World 1 teaches lines and colour groups on an open board,
 * world 2 fills the board with things that get in the way, world 3 keeps
 * pushing new rows in while you work.
 */
/**
 * Twenty-four levels across three worlds.
 *
 * One rule governs every layout here: **obstacles come in clusters, never
 * scattered or striped.** In a game that is purely about fitting, a lone tile
 * in open space ruins far more placements than a 2x2 block against a wall does
 * — a checkerboard of single stones looks like a fair puzzle and is actually
 * unplayable, which is exactly what the first pass at this table was.
 */
const LEVEL_TABLE: LevelSpec[] = [
  // ---- World 1 · Fitting and lines --------------------------------------
  {
    id: 1, world: 1, name: 'First Fit',
    layout: `........`,
    moves: 12,
    objective: { kind: 'lines', count: 3 },
    stars: [900, 1400, 2000],
    hint: 'Drag a piece from the tray onto the board. Fill a whole row or column and it clears.',
  },
  {
    id: 2, world: 1, name: 'Double Up',
    layout: `........`,
    moves: 21,
    objective: { kind: 'lines', count: 5 },
    stars: [1450, 2300, 3300],
    hint: 'One piece that finishes two lines at once is worth far more than two that finish one each.',
  },
  {
    id: 3, world: 1, name: 'Corner Office',
    layout: `
##......
##......
........
........
........
........
........
........
`,
    moves: 13,
    objective: { kind: 'clear-stone' },
    stars: [700, 1100, 1550],
    hint: 'Stone cannot be built over. Clear a line beside it and it wears away.',
  },
  {
    id: 4, world: 1, name: 'Tight Corner',
    layout: `
##......
##......
........
........
........
........
......##
......##
`,
    moves: 28,
    objective: { kind: 'clear-stone' },
    stars: [2950, 4700, 6650],
  },
  {
    id: 5, world: 1, name: 'Spring Clean',
    layout: `
..RR....
..RR....
....CC..
....CC..
VV......
VV......
........
........
`,
    moves: 36,
    objective: { kind: 'clear-preset' },
    stars: [2450, 3850, 5450],
    hint: 'Only the tiles the level started with count. Yours are just raw material.',
  },
  {
    id: 6, world: 1, name: 'Crate Expectations',
    layout: `
........
........
...XX...
...XX...
........
........
........
........
`,
    moves: 12,
    objective: { kind: 'clear-crates' },
    stars: [950, 1550, 2200],
    hint: 'A crate takes two clears going off beside it. Watch it crack.',
  },
  {
    id: 7, world: 1, name: 'Gemcutter',
    layout: `
........
........
...PP...
...PP...
........
........
........
........
`,
    moves: 15,
    objective: { kind: 'clear-gems' },
    stars: [1650, 2600, 3700],
    hint: 'Gems are worth a lot, but only a line can reach one.',
  },
  {
    id: 8, world: 1, name: 'Housekeeping',
    layout: `
VV......
VV......
........
........
........
........
......AA
......AA
`,
    moves: 15,
    objective: { kind: 'clear-preset' },
    stars: [1100, 1750, 2450],
  },

  // ---- World 2 · Less room ----------------------------------------------
  {
    id: 9, world: 2, name: 'Bedrock',
    layout: `
........
........
..####..
..####..
........
........
........
........
`,
    moves: 12,
    objective: { kind: 'clear-stone' },
    stars: [950, 1450, 2100],
  },
  {
    id: 10, world: 2, name: 'Short Fuse',
    layout: `
........
........
..rr....
..rr....
....##..
....##..
........
........
`,
    moves: 15,
    objective: { kind: 'clear-stone' },
    stars: [1000, 1600, 2250],
    hint: 'A bomb takes its whole neighbourhood with it when a line clears it.',
  },
  {
    id: 11, world: 2, name: 'The Vault',
    layout: `
XX......
XX......
....XX..
....XX..
..XX....
..XX....
........
........
`,
    moves: 19,
    objective: { kind: 'clear-crates' },
    stars: [1350, 2100, 3000],
  },
  {
    id: 12, world: 2, name: 'Four Corners',
    layout: `
##....##
##....##
........
........
........
........
##....##
##....##
`,
    moves: 12,
    objective: { kind: 'clear-stone' },
    stars: [1450, 2300, 3300],
  },
  {
    id: 13, world: 2, name: 'Minefield',
    layout: `
........
..ll....
..ll....
........
........
....aa..
....aa..
........
`,
    moves: 40,
    objective: { kind: 'clear-preset' },
    stars: [3000, 4750, 6800],
  },
  {
    id: 14, world: 2, name: 'Narrow Margins',
    layout: `
..##....
..##....
......##
......##
........
........
........
........
`,
    moves: 13,
    objective: { kind: 'clear-stone' },
    stars: [850, 1400, 1950],
    hint: 'Two blocks, one lane between them. Keep it open.',
  },
  {
    id: 15, world: 2, name: 'Deep Pockets',
    layout: `
PP......
PP......
....PP..
....PP..
........
........
........
........
`,
    moves: 41,
    objective: { kind: 'clear-gems' },
    stars: [4550, 7250, 10250],
  },
  {
    id: 16, world: 2, name: 'Quarantine',
    layout: `
........
.XX.....
.XX.....
........
........
.....PP.
.....PP.
........
`,
    moves: 51,
    objective: { kind: 'clear-preset' },
    stars: [4600, 7250, 10350],
  },

  // ---- World 3 · Creep --------------------------------------------------
  {
    id: 17, world: 3, name: 'Encroach',
    layout: `........`,
    moves: 35, creepEvery: 6,
    objective: { kind: 'lines', count: 9 },
    stars: [2500, 3950, 5650],
    hint: 'Junk now seeps into empty cells every few moves. Nothing you placed moves — you just get less room.',
  },
  {
    id: 18, world: 3, name: 'Tidewater',
    layout: `........`,
    moves: 26, creepEvery: 10,
    objective: { kind: 'lines', count: 6 },
    stars: [1750, 2750, 3950],
  },
  {
    id: 19, world: 3, name: 'Quarry',
    layout: `
........
........
........
..####..
..####..
........
........
........
`,
    moves: 28, creepEvery: 6,
    objective: { kind: 'clear-stone' },
    stars: [2100, 3350, 4750],
  },
  {
    id: 20, world: 3, name: 'Chain Reaction',
    layout: `
........
..vv....
..vv....
........
........
....cc..
....cc..
........
`,
    moves: 31, creepEvery: 6,
    objective: { kind: 'score', target: 3000 },
    stars: [2750, 4300, 6150],
  },
  {
    id: 21, world: 3, name: 'Cathedral',
    layout: `
........
.XX.....
.XX.....
........
........
........
....PP..
....PP..
`,
    moves: 21, creepEvery: 8,
    objective: { kind: 'clear-crates' },
    stars: [2850, 4550, 6450],
  },
  {
    id: 22, world: 3, name: 'Scaffold',
    layout: `
##......
##......
......##
......##
....##..
....##..
........
........
`,
    moves: 27, creepEvery: 9,
    objective: { kind: 'clear-stone' },
    stars: [1850, 2950, 4200],
  },
  {
    id: 23, world: 3, name: 'Kiln',
    layout: `
XX......
XX......
....rr..
....rr..
..##....
..##....
........
........
`,
    moves: 18, creepEvery: 9,
    objective: { kind: 'clear-preset' },
    stars: [1850, 2950, 4200],
  },
  {
    id: 24, world: 3, name: 'The Long Dark',
    layout: `
XX......
XX......
....PP..
....PP..
..##....
..##....
......XX
......XX
`,
    moves: 44, creepEvery: 9,
    objective: { kind: 'clear-preset' },
    stars: [4250, 6750, 9550],
    hint: 'Everything you have learned, at once.',
  },
];

export const LEVELS: LevelSpec[] = LEVEL_TABLE;

export const WORLDS = [
  { id: 1, name: 'Shallows', accent: '#4cc9f0' },
  { id: 2, name: 'The Quarry', accent: '#ffb703' },
  { id: 3, name: 'Deep Dark', accent: '#c77dff' },
];

export function levelById(id: number): LevelSpec | undefined {
  return LEVELS.find((l) => l.id === id);
}

/** Rows of the layout, padded to the board width and stripped of blank lines. */
export function layoutRows(layout: string, cols: number): string[] {
  return layout
    .split('\n')
    .map((r) => r.replace(/\s+$/, ''))
    .filter((r) => r.length > 0)
    .map((r) => r.padEnd(cols, '.').slice(0, cols));
}

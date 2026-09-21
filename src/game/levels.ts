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
  | { kind: 'clear-hue'; hue: Hue; count: number }
  | { kind: 'lines'; count: number }
  | { kind: 'groups'; count: number }
  | { kind: 'score'; target: number };

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
  /** Junk seeps into empty cells every N moves on the later levels. */
  creepEvery?: number;
  /** Tiles per creep; defaults to 2. */
  creepCount?: number;
  /** Restrict the deal to these hues, to make a level's colour puzzle tighter. */
  hues?: Hue[];
  hint?: string;
}

export const CHAR_TO_HUE: Record<string, Hue> = {
  R: 0, C: 1, L: 2, A: 3, V: 4,
  r: 0, c: 1, l: 2, a: 3, v: 4,
};

export function charKind(ch: string): TileKind | null {
  if (ch === '.' || ch === ' ') return null;
  if (ch === '#') return TileKind.Stone;
  if (ch === 'P') return TileKind.Prism;
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
    case 'clear-hue':
      return `Clear ${o.count} ${HUE_NAMES[o.hue]} tiles`;
    case 'lines':
      return `Complete ${o.count} lines`;
    case 'groups':
      return `Make ${o.count} colour groups`;
    case 'score':
      return `Score ${o.target.toLocaleString('en-US')}`;
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
const LEVEL_TABLE: LevelSpec[] = [
  // ---- World 1 · Lines and groups ---------------------------------------
  {
    id: 1, world: 1, name: 'First Fit',
    layout: `........`,
    moves: 16,
    objective: { kind: 'lines', count: 2 },
    stars: [1650, 2550, 3500],
    hint: 'Drag a piece from the tray onto the board. Fill a whole row or column and it clears.',
  },
  {
    id: 2, world: 1, name: 'Birds of a Feather',
    layout: `
........
........
..RRR...
...R....
........
........
........
........
`,
    moves: 16, hues: [0, 1],
    objective: { kind: 'groups', count: 4 },
    stars: [1600, 2450, 3350],
    hint: 'Five touching tiles of one colour also clear. Build onto what is already there.',
  },
  {
    id: 3, world: 1, name: 'Both at Once',
    layout: `
........
........
....CC..
....CC..
........
........
........
........
`,
    moves: 18, hues: [1, 2, 4],
    objective: { kind: 'groups', count: 6 },
    stars: [1600, 2500, 3400],
    hint: 'A placement that finishes a line AND a colour group at once scores far more.',
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
    moves: 18,
    objective: { kind: 'clear-stone' },
    stars: [1800, 2750, 3750],
    hint: 'Stone cannot be covered. Clear next to it and it wears away.',
  },
  {
    id: 5, world: 1, name: 'Colour Blind',
    layout: `
........
...VV...
...VV...
........
........
........
........
........
`,
    moves: 18, hues: [4, 3],
    objective: { kind: 'clear-hue', hue: 4, count: 26 },
    stars: [1650, 2500, 3450],
  },
  {
    id: 6, world: 1, name: 'Crate Expectations',
    layout: `
........
..X..X..
........
........
........
..X..X..
........
........
`,
    moves: 20,
    objective: { kind: 'clear-crates' },
    stars: [1600, 2450, 3350],
    hint: 'A crate has to be caught inside a clear, twice, before it breaks open.',
  },
  {
    id: 7, world: 1, name: 'Scattered',
    layout: `
.#....#.
........
....##..
........
..##....
........
.#....#.
........
`,
    moves: 22,
    objective: { kind: 'clear-stone' },
    stars: [1700, 2600, 3550],
  },
  {
    id: 8, world: 1, name: 'Housekeeping',
    layout: `
RRC.....
RRC.....
........
........
........
.....LVV
.....LVV
........
`,
    moves: 20,
    objective: { kind: 'clear-preset' },
    stars: [2250, 3450, 4750],
    hint: 'Only the tiles the level started with count. Yours are just raw material.',
  },

  // ---- World 2 · Things in the way --------------------------------------
  {
    id: 9, world: 2, name: 'Bedrock',
    layout: `
........
..####..
..####..
........
........
........
........
........
`,
    moves: 20,
    objective: { kind: 'clear-stone' },
    stars: [2150, 3300, 4550],
  },
  {
    id: 10, world: 2, name: 'Short Fuse',
    layout: `
........
...rr...
...rr...
........
..####..
........
........
........
`,
    moves: 18,
    objective: { kind: 'clear-stone' },
    stars: [2000, 3050, 4200],
    hint: 'A bomb takes its whole neighbourhood with it when something clears it.',
  },
  {
    id: 11, world: 2, name: 'Prism Cut',
    layout: `
........
...PP...
..PLLP..
...PP...
........
........
........
........
`,
    moves: 20, hues: [2, 0],
    objective: { kind: 'groups', count: 8 },
    stars: [1850, 2850, 3900],
    hint: 'A prism counts as whatever colour is touching it.',
  },
  {
    id: 12, world: 2, name: 'The Vault',
    layout: `
........
.XX..XX.
........
...##...
...##...
........
.XX..XX.
........
`,
    moves: 26,
    objective: { kind: 'clear-crates' },
    stars: [2150, 3300, 4500],
  },
  {
    id: 13, world: 2, name: 'Checkmate',
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
    moves: 24, hues: [1, 3],
    objective: { kind: 'clear-hue', hue: 1, count: 30 },
    stars: [2400, 3650, 5000],
  },
  {
    id: 14, world: 2, name: 'Minefield',
    layout: `
.r....l.
........
..#..#..
........
..#..#..
........
.l....r.
........
`,
    moves: 22,
    objective: { kind: 'clear-preset' },
    stars: [2300, 3550, 4850],
  },
  {
    id: 15, world: 2, name: 'Narrow Margins',
    layout: `
..#..#..
..#..#..
........
........
........
..#..#..
..#..#..
........
`,
    moves: 24,
    objective: { kind: 'clear-stone' },
    stars: [2350, 3600, 4900],
    hint: 'Two stone columns split the board. Work the open lanes.',
  },
  {
    id: 16, world: 2, name: 'Quarantine',
    layout: `
........
.X....X.
..#PP#..
..#PP#..
........
.X....X.
........
........
`,
    moves: 28,
    objective: { kind: 'clear-preset' },
    stars: [2550, 3950, 5400],
  },

  // ---- World 3 · Creep --------------------------------------------------
  {
    id: 17, world: 3, name: 'Encroach',
    layout: `........`,
    moves: 26, creepEvery: 5,
    objective: { kind: 'groups', count: 10 },
    stars: [2400, 3700, 5050],
    hint: 'Junk now seeps into empty cells every few moves. Nothing you placed moves — you just get less room.',
  },
  {
    id: 18, world: 3, name: 'Tidewater',
    layout: `
........
........
...CC...
...CC...
........
........
........
........
`,
    moves: 28, creepEvery: 5, hues: [1, 4],
    objective: { kind: 'clear-hue', hue: 1, count: 38 },
    stars: [2650, 4100, 5600],
  },
  {
    id: 19, world: 3, name: 'Quarry',
    layout: `
........
........
.##..##.
.##..##.
........
........
........
........
`,
    moves: 26, creepEvery: 6,
    objective: { kind: 'clear-stone' },
    stars: [2550, 3900, 5300],
  },
  {
    id: 20, world: 3, name: 'Chain Reaction',
    layout: `
........
..a..c..
........
...PP...
........
..l..v..
........
........
`,
    moves: 24, creepEvery: 6,
    objective: { kind: 'clear-preset' },
    stars: [2550, 3950, 5400],
  },
  {
    id: 21, world: 3, name: 'Cathedral',
    layout: `
........
.X.##.X.
...##...
........
........
...##...
.X.##.X.
........
`,
    moves: 30, creepEvery: 6,
    objective: { kind: 'clear-crates' },
    stars: [3200, 4900, 6750],
  },
  {
    id: 22, world: 3, name: 'Scaffold',
    layout: `
.######.
........
........
.######.
........
........
.######.
........
`,
    moves: 30, creepEvery: 6,
    objective: { kind: 'clear-stone' },
    stars: [2650, 4050, 5550],
  },
  {
    id: 23, world: 3, name: 'Kiln',
    layout: `
.r....r.
........
..XX....
..##....
....##..
....XX..
........
.l....l.
`,
    moves: 30, creepEvery: 5,
    objective: { kind: 'clear-preset' },
    stars: [3500, 5350, 7350],
  },
  {
    id: 24, world: 3, name: 'The Long Dark',
    layout: `
.X....X.
..####..
..#PP#..
..#PP#..
..####..
.X....X.
........
........
`,
    moves: 34, creepEvery: 5,
    objective: { kind: 'clear-preset' },
    stars: [3650, 5600, 7650],
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

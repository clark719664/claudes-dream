/** The five playable colours plus the two colourless block kinds. */
export type Hue = 0 | 1 | 2 | 3 | 4;

export const HUE_COUNT = 5;
export const HUES: Hue[] = [0, 1, 2, 3, 4];

export const enum BlockKind {
  /** Ordinary coloured block. Resonates with a ball of the same hue. */
  Colour = 0,
  /** Colourless. Never resonates, never joins a cascade cluster. Pure HP wall. */
  Stone = 1,
  /** Resonates with every hue, and leaves the ball's hue untouched. */
  Prism = 2,
  /** Coloured, but detonates a 3x3 when it dies. */
  Bomb = 3,
}

export interface Block {
  id: number;
  kind: BlockKind;
  /** Meaningless for Stone/Prism; the match hue otherwise. */
  hue: Hue;
  hp: number;
  maxHp: number;
  /** Animation state, 0..1, drives the spawn-drop and the shatter. */
  anim: number;
  dying: boolean;
}

export const enum PickupKind {
  ExtraBall = 0,
  Shards = 1,
}

export interface Pickup {
  id: number;
  kind: PickupKind;
  col: number;
  row: number;
  taken: boolean;
  anim: number;
}

export interface Ball {
  x: number;
  y: number;
  vx: number;
  vy: number;
  hue: Hue;
  /** Consecutive resonance hits without touching a wall. Drives pierce speed. */
  streak: number;
  /** Bounces left before the ball burns out. Resonance pierces refund it. */
  energy: number;
  alive: boolean;
  /** Frames of invulnerability to re-colliding with the block just pierced. */
  pierceCooldown: number;
  trail: { x: number; y: number }[];
}

export const enum Phase {
  Aiming = 'aiming',
  Firing = 'firing',
  Settling = 'settling',
  Advancing = 'advancing',
  Over = 'over',
}

export interface RunResult {
  score: number;
  shards: number;
  waves: number;
  bestChain: number;
  blocksBroken: number;
}

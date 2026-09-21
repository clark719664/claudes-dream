import { CFG } from './config';
import { Grid } from './grid';
import { BlockKind, type Ball, type Block, type Hue } from './types';

export const FIELD = {
  width: CFG.cols,
  gridHeight: CFG.rows,
  /** Empty aiming space between the lowest block row and the launcher. */
  floorGap: 2.0,
  get height(): number {
    return CFG.rows + this.floorGap;
  },
};

export interface HitEvent {
  col: number;
  row: number;
  block: Block;
  /** Same-hue (or Prism) contact: instant kill, no bounce, speed up. */
  resonance: boolean;
  killed: boolean;
  /** The hue the ball absorbed, when it changed. */
  absorbed: Hue | null;
  streak: number;
  x: number;
  y: number;
}

export interface StepResult {
  hits: HitEvent[];
  bouncedWall: boolean;
  /** Ball fell past the launcher line and should be recalled. */
  recalled: boolean;
  /** Ball ran out of energy mid-flight and burned out where it was. */
  burnedOut: boolean;
}

export function makeBall(x: number, y: number, angleRad: number, hue: Hue, speed: number): Ball {
  return {
    x,
    y,
    vx: Math.cos(angleRad) * speed,
    vy: -Math.sin(angleRad) * speed,
    hue,
    streak: 0,
    energy: CFG.ball.energy,
    alive: true,
    pierceCooldown: 0,
    trail: [],
  };
}

/**
 * Advance one ball by a tick. Movement is substepped so a fast ball can never
 * tunnel through a block, and the two axes are resolved separately so bounces
 * off block corners read the way a player expects.
 */
export function stepBall(ball: Ball, grid: Grid): StepResult {
  const r = CFG.ball.radius;
  const speed = Math.hypot(ball.vx, ball.vy);
  const steps = Math.max(1, Math.ceil(speed / (r * 0.8)));
  const result: StepResult = { hits: [], bouncedWall: false, recalled: false, burnedOut: false };

  for (let s = 0; s < steps && ball.alive; s++) {
    const dx = ball.vx / steps;
    const dy = ball.vy / steps;

    ball.x += dx;
    if (ball.x - r < 0) {
      ball.x = r;
      ball.vx = Math.abs(ball.vx);
      result.bouncedWall = true;
      ball.streak = 0;
      ball.energy--;
    } else if (ball.x + r > FIELD.width) {
      ball.x = FIELD.width - r;
      ball.vx = -Math.abs(ball.vx);
      result.bouncedWall = true;
      ball.streak = 0;
      ball.energy--;
    } else {
      resolveAxis(ball, grid, result, 'x', dx);
    }

    ball.y += dy;
    if (ball.y - r < 0) {
      ball.y = r;
      ball.vy = Math.abs(ball.vy);
      result.bouncedWall = true;
      ball.streak = 0;
      ball.energy--;
    } else if (ball.y - r > FIELD.height) {
      ball.alive = false;
      result.recalled = true;
      break;
    } else {
      resolveAxis(ball, grid, result, 'y', dy);
    }

    if (ball.energy <= 0) {
      ball.alive = false;
      result.burnedOut = true;
      break;
    }
  }

  if (ball.alive) {
    ball.trail.push({ x: ball.x, y: ball.y });
    if (ball.trail.length > CFG.ball.maxTrail) ball.trail.shift();
    preventFlatOrbit(ball);
  }
  return result;
}

/**
 * Check the cells the ball now overlaps on one axis. A resonance hit lets the
 * ball carry straight on through; anything else bounces it and repaints it.
 */
function resolveAxis(
  ball: Ball,
  grid: Grid,
  result: StepResult,
  axis: 'x' | 'y',
  delta: number,
): void {
  if (delta === 0) return;
  const r = CFG.ball.radius;
  const minCol = Math.floor(ball.x - r);
  const maxCol = Math.floor(ball.x + r);
  const minRow = Math.floor(ball.y - r);
  const maxRow = Math.floor(ball.y + r);
  let bounced = false;

  for (let row = minRow; row <= maxRow; row++) {
    for (let col = minCol; col <= maxCol; col++) {
      const block = grid.at(col, row);
      if (!block || block.dying) continue;
      if (!overlaps(ball.x, ball.y, r, col, row)) continue;

      const hit = applyHit(ball, col, row, block);
      result.hits.push(hit);

      if (hit.resonance) continue; // pierce: keep the current heading

      if (!bounced) {
        bounced = true;
        ball.energy--;
        if (axis === 'x') {
          ball.vx = -ball.vx;
          ball.x = delta > 0 ? col - r - 1e-4 : col + 1 + r + 1e-4;
        } else {
          ball.vy = -ball.vy;
          ball.y = delta > 0 ? row - r - 1e-4 : row + 1 + r + 1e-4;
        }
      }
    }
  }
}

function applyHit(ball: Ball, col: number, row: number, block: Block): HitEvent {
  const resonance = isResonant(ball.hue, block);
  let killed = false;
  let absorbed: Hue | null = null;

  if (resonance) {
    killed = true;
    block.hp = 0;
    ball.streak++;
    ball.energy = Math.min(CFG.ball.energyCap, ball.energy + CFG.ball.resonanceRefund);
    const speed = Math.hypot(ball.vx, ball.vy);
    const boosted = Math.min(CFG.ball.maxSpeed, speed * CFG.ball.pierceBoost);
    const scale = boosted / (speed || 1);
    ball.vx *= scale;
    ball.vy *= scale;
  } else {
    block.hp -= 1;
    killed = block.hp <= 0;
    ball.streak = 0;
    if (block.kind === BlockKind.Colour || block.kind === BlockKind.Bomb) {
      if (block.hue !== ball.hue) {
        absorbed = block.hue;
        ball.hue = block.hue;
      }
    }
  }

  if (killed) block.dying = true;

  return { col, row, block, resonance, killed, absorbed, streak: ball.streak, x: ball.x, y: ball.y };
}

export function isResonant(hue: Hue, block: Block): boolean {
  if (block.kind === BlockKind.Prism) return true;
  if (block.kind === BlockKind.Stone) return false;
  return block.hue === hue;
}

function overlaps(bx: number, by: number, r: number, col: number, row: number): boolean {
  const nx = Math.max(col, Math.min(bx, col + 1));
  const ny = Math.max(row, Math.min(by, row + 1));
  const dx = bx - nx;
  const dy = by - ny;
  return dx * dx + dy * dy < r * r;
}

/**
 * A ball trapped in a near-horizontal bounce can ping-pong forever. Nudge it
 * back toward vertical whenever it flattens out.
 */
function preventFlatOrbit(ball: Ball): void {
  const speed = Math.hypot(ball.vx, ball.vy);
  if (speed === 0) return;
  const minVy = speed * 0.16;
  if (Math.abs(ball.vy) < minVy) {
    const sign = ball.vy === 0 ? (Math.random() < 0.5 ? -1 : 1) : Math.sign(ball.vy);
    ball.vy = sign * minVy;
    const vxMag = Math.sqrt(Math.max(0, speed * speed - ball.vy * ball.vy));
    ball.vx = Math.sign(ball.vx || 1) * vxMag;
  }
}

/**
 * Dotted aim line: walk a ghost ball until it meets a block or runs out of
 * length, reflecting off the side walls on the way.
 */
export function previewPath(
  grid: Grid,
  originX: number,
  originY: number,
  angleRad: number,
  maxLength = 26,
): { x: number; y: number }[] {
  const r = CFG.ball.radius;
  const pts = [{ x: originX, y: originY }];
  let x = originX;
  let y = originY;
  let vx = Math.cos(angleRad) * 0.06;
  let vy = -Math.sin(angleRad) * 0.06;
  let travelled = 0;
  let bounces = 0;

  while (travelled < maxLength) {
    x += vx;
    y += vy;
    travelled += 0.06;

    if (x - r < 0) {
      x = r;
      vx = Math.abs(vx);
      if (++bounces > CFG.launcher.maxPreviewBounces) break;
    } else if (x + r > FIELD.width) {
      x = FIELD.width - r;
      vx = -Math.abs(vx);
      if (++bounces > CFG.launcher.maxPreviewBounces) break;
    }
    if (y - r < 0) {
      y = r;
      vy = Math.abs(vy);
      if (++bounces > CFG.launcher.maxPreviewBounces) break;
    }
    if (y > FIELD.height) break;

    const col = Math.floor(x);
    const row = Math.floor(y);
    if (grid.at(col, row) && overlaps(x, y, r, col, row)) {
      pts.push({ x, y });
      break;
    }
    pts.push({ x, y });
  }
  return pts;
}

import { CFG } from './config';
import { Grid, buildWaveRow, makeBlock } from './grid';
import { FIELD, makeBall, previewPath, stepBall } from './physics';
import { Rng, randomSeed } from '../core/rng';
import { basePerks, type Perks } from '../meta/stickers';
import {
  BlockKind,
  HUES,
  Phase,
  PickupKind,
  type Ball,
  type Block,
  type Hue,
  type Pickup,
  type RunResult,
} from './types';

export type FxKind =
  | 'shatter'
  | 'resonate'
  | 'cascade'
  | 'bomb'
  | 'pickup'
  | 'chip'
  | 'wave'
  | 'launch'
  | 'recall'
  | 'burnout'
  | 'gameover';

export interface Fx {
  kind: FxKind;
  x: number;
  y: number;
  hue: Hue;
  /** Extra payload: chain depth, shard count, streak length, ... */
  value: number;
  text?: string;
}

export interface GameOptions {
  seed?: number;
  perks?: Perks;
  /** Set for the daily challenge so the result can be filed under the day. */
  dailyKey?: string | null;
}

let nextPickupId = 1;

/**
 * The whole run: a fixed-step simulation that emits FX events for the renderer
 * to drain. Deliberately free of any canvas or DOM reference so the balance can
 * be exercised headlessly in tests.
 */
export class Game {
  readonly grid = new Grid();
  readonly rng: Rng;
  readonly seed: number;
  readonly perks: Perks;
  readonly dailyKey: string | null;

  phase: Phase = Phase.Aiming;
  balls: Ball[] = [];
  pickups: Pickup[] = [];
  fx: Fx[] = [];

  score = 0;
  shards = 0;
  wave = 0;
  bestChain = 0;
  blocksBroken = 0;

  /** Balls in the volley, and how many are still waiting to launch. */
  ballCount: number;
  pendingLaunch = 0;

  launcherX: number;
  readonly launcherY = FIELD.height - 0.35;
  /** Where the first returning ball touched down; the launcher slides there. */
  nextLauncherX: number | null = null;

  aimAngle = Math.PI / 2;
  aiming = false;

  private launchTimer = 0;
  private fireTicks = 0;
  private settleQueue: { chain: number; cleared: { col: number; row: number; block: Block }[] }[] = [];
  private settleTimer = 0;

  constructor(opts: GameOptions = {}) {
    this.seed = opts.seed ?? randomSeed();
    this.rng = new Rng(this.seed);
    this.perks = opts.perks ?? basePerks();
    this.dailyKey = opts.dailyKey ?? null;

    this.grid.cascadeThreshold = this.perks.cascadeThreshold;
    this.grid.bombRadius = this.perks.bombRadius;
    this.ballCount = CFG.waves.startingBalls + this.perks.extraBalls;
    this.launcherX = FIELD.width / 2;

    this.openBoard();
  }

  private openBoard(): void {
    if (this.perks.openingPrismRow) {
      const row: (Block | null)[] = new Array(this.grid.cols).fill(null);
      for (let c = 0; c < this.grid.cols; c++) {
        if (this.rng.chance(0.55)) row[c] = makeBlock(BlockKind.Prism, 0, 1);
      }
      this.grid.insertRow(row);
    }
    for (let i = 0; i < CFG.waves.openingRows; i++) {
      this.wave++;
      this.grid.insertRow(buildWaveRow(this.grid, this.wave, this.rng));
    }
    this.grid.applyGravity();
  }

  // -- input ---------------------------------------------------------------

  /** Aim at a point in field coordinates. Clamped so you can't shoot sideways. */
  aimAt(x: number, y: number): void {
    const dx = x - this.launcherX;
    const dy = y - this.launcherY;
    let angle = Math.atan2(-dy, dx);
    const min = (CFG.launcher.minAngle * Math.PI) / 180;
    if (angle < min) angle = min;
    if (angle > Math.PI - min) angle = Math.PI - min;
    this.aimAngle = angle;
  }

  get canFire(): boolean {
    return this.phase === Phase.Aiming;
  }

  fire(): boolean {
    if (!this.canFire) return false;
    this.phase = Phase.Firing;
    this.pendingLaunch = this.ballCount;
    this.launchTimer = 0;
    this.fireTicks = 0;
    this.nextLauncherX = null;
    this.balls = [];
    return true;
  }

  aimPreview(): { x: number; y: number }[] {
    return previewPath(this.grid, this.launcherX, this.launcherY, this.aimAngle);
  }

  // -- simulation ----------------------------------------------------------

  tick(): void {
    switch (this.phase) {
      case Phase.Firing:
        this.tickFiring();
        break;
      case Phase.Settling:
        this.tickSettling();
        break;
      case Phase.Advancing:
        this.advance();
        break;
      default:
        break;
    }
    for (const p of this.pickups) if (p.anim < 1) p.anim = Math.min(1, p.anim + 0.08);
  }

  private tickFiring(): void {
    this.fireTicks++;

    if (this.pendingLaunch > 0) {
      if (this.launchTimer <= 0) {
        this.balls.push(
          makeBall(
            this.launcherX,
            this.launcherY,
            this.aimAngle,
            this.currentLaunchHue(),
            CFG.ball.baseSpeed,
          ),
        );
        this.pendingLaunch--;
        this.launchTimer = CFG.ball.launchGap;
        this.emit('launch', this.launcherX, this.launcherY, 0, 0);
      } else {
        this.launchTimer--;
      }
    }

    for (const ball of this.balls) {
      if (!ball.alive) continue;
      const res = stepBall(ball, this.grid);

      for (const hit of res.hits) {
        if (hit.resonance) {
          this.score += CFG.scoring.resonance + hit.streak * CFG.scoring.pierceStreakBonus;
          this.emit('resonate', hit.x, hit.y, ball.hue, hit.streak);
        } else if (!hit.killed) {
          // Survived the hit: chip feedback, and the ball wears its new colour.
          this.emit('chip', hit.x, hit.y, hit.block.hue, hit.absorbed === null ? 0 : 1);
        }
        if (hit.killed) this.killBlock(hit.col, hit.row, ball.hue);
      }

      this.collectPickups(ball);

      if (res.burnedOut) {
        this.emit('burnout', ball.x, ball.y, ball.hue, 0);
      } else if (res.recalled) {
        // Only a ball that actually made it back down moves the launcher.
        if (this.nextLauncherX === null) {
          this.nextLauncherX = clamp(ball.x, 0.5, FIELD.width - 0.5);
          this.emit('recall', this.nextLauncherX, this.launcherY, 0, 0);
        }
      }
    }

    const timedOut = this.fireTicks > CFG.ball.timeoutTicks;
    const allDone = this.pendingLaunch === 0 && this.balls.every((b) => !b.alive);
    if (allDone || timedOut) {
      this.balls = [];
      if (this.nextLauncherX !== null) this.launcherX = this.nextLauncherX;
      this.beginSettle();
    }
  }

  /** The volley's hue rotates so a player always has a way into every colour. */
  private currentLaunchHue(): Hue {
    const fired = this.ballCount - this.pendingLaunch;
    return HUES[(fired + this.wave) % HUES.length];
  }

  /** Hue of the first ball in the next volley, shown on the launcher. */
  nextHue(): Hue {
    return HUES[this.wave % HUES.length];
  }

  /** The whole upcoming volley, for the on-screen queue. */
  upcomingHues(): Hue[] {
    return Array.from({ length: this.ballCount }, (_, i) => HUES[(i + this.wave) % HUES.length]);
  }

  private killBlock(col: number, row: number, hue: Hue): void {
    const { cleared, bombed } = this.grid.detonate([{ col, row }]);
    for (const c of cleared) {
      this.blocksBroken++;
      this.score += CFG.scoring.block;
      this.shards += CFG.shards.perBlock;
      this.emit('shatter', c.col + 0.5, c.row + 0.5, c.block.hue, 0);
    }
    if (bombed > 0) this.emit('bomb', col + 0.5, row + 0.5, hue, bombed);
  }

  private collectPickups(ball: Ball): void {
    for (const p of this.pickups) {
      if (p.taken) continue;
      const dx = ball.x - (p.col + 0.5);
      const dy = ball.y - (p.row + 0.5);
      if (dx * dx + dy * dy > 0.34 * 0.34) continue;

      p.taken = true;
      if (p.kind === PickupKind.ExtraBall && this.ballCount < CFG.waves.maxBalls) {
        this.ballCount++;
        this.emit('pickup', p.col + 0.5, p.row + 0.5, 0, 1, '+1 BALL');
      } else if (p.kind === PickupKind.ExtraBall) {
        this.shards += 40;
        this.emit('pickup', p.col + 0.5, p.row + 0.5, 3, 40, '+40');
      } else {
        const amount = 25 + this.wave * 2;
        this.shards += amount;
        this.emit('pickup', p.col + 0.5, p.row + 0.5, 3, amount, `+${amount}`);
      }
    }
    this.pickups = this.pickups.filter((p) => !p.taken);
  }

  private beginSettle(): void {
    this.phase = Phase.Settling;
    this.settleQueue = this.grid.resolve();
    this.settleTimer = 0;
  }

  /** Cascade steps play back one at a time so the chain reads on screen. */
  private tickSettling(): void {
    if (this.settleTimer > 0) {
      this.settleTimer--;
      return;
    }
    const step = this.settleQueue.shift();
    if (!step) {
      this.phase = Phase.Advancing;
      return;
    }

    const multiplier = 1 + (step.chain - 1) * CFG.cascade.chainStep;
    this.bestChain = Math.max(this.bestChain, step.chain);

    for (const c of step.cleared) {
      this.blocksBroken++;
      this.score += Math.round(CFG.scoring.cascadeBlock * multiplier);
      this.shards += CFG.shards.perCascadeBlock;
      this.emit('shatter', c.col + 0.5, c.row + 0.5, c.block.hue, step.chain);
    }

    const focus = step.cleared[0];
    if (focus) {
      this.emit(
        'cascade',
        focus.col + 0.5,
        focus.row + 0.5,
        focus.block.hue,
        step.chain,
        step.chain > 1 ? `CHAIN ×${step.chain}` : `CASCADE ×${step.cleared.length}`,
      );
    }
    this.settleTimer = 14;
  }

  private advance(): void {
    if (this.grid.isClear) {
      this.score += CFG.scoring.waveClear;
      this.shards += CFG.shards.perfectClear;
      this.emit('wave', FIELD.width / 2, FIELD.height / 2, 3, 0, 'PERFECT CLEAR');
    }

    if (this.grid.lowestRow() >= CFG.dangerRow) {
      this.phase = Phase.Over;
      this.emit('gameover', FIELD.width / 2, FIELD.height / 2, 0, 0);
      return;
    }

    this.wave++;
    this.shards += CFG.shards.perWave;

    // The wall speeds up over time: deeper waves push more than one row a turn.
    const rows = this.rowsPerWave();
    for (let i = 0; i < rows; i++) {
      for (const p of this.pickups) p.row++;
      this.pickups = this.pickups.filter((p) => p.row < this.grid.rows);

      const row = buildWaveRow(this.grid, this.wave, this.rng);
      this.grid.insertRow(row);
      this.spawnPickups(row);
    }
    this.grid.applyGravity();

    this.emit('wave', FIELD.width / 2, 0.5, 0, this.wave);
    this.phase = Phase.Aiming;
  }

  rowsPerWave(): number {
    return Math.min(
      CFG.waves.maxRowsPerWave,
      1 + Math.floor(this.wave / CFG.waves.doubleRowEvery),
    );
  }

  private spawnPickups(row: (Block | null)[]): void {
    const free: number[] = [];
    for (let c = 0; c < this.grid.cols; c++) if (!row[c]) free.push(c);
    if (!free.length) return;

    if (this.wave % CFG.waves.extraBallEvery === 0) {
      this.pickups.push(pickup(PickupKind.ExtraBall, this.rng.pick(free), 0));
    } else if (this.rng.chance(0.22)) {
      this.pickups.push(pickup(PickupKind.Shards, this.rng.pick(free), 0));
    }
  }

  private emit(kind: FxKind, x: number, y: number, hue: Hue, value: number, text?: string): void {
    this.fx.push({ kind, x, y, hue, value, text });
  }

  /** Renderer calls this once a frame and consumes what it gets. */
  drainFx(): Fx[] {
    const out = this.fx;
    this.fx = [];
    return out;
  }

  get result(): RunResult {
    return {
      score: this.score,
      shards: Math.round(this.shards * this.perks.shardMultiplier),
      waves: this.wave,
      bestChain: this.bestChain,
      blocksBroken: this.blocksBroken,
    };
  }
}

function pickup(kind: PickupKind, col: number, row: number): Pickup {
  return { id: nextPickupId++, kind, col, row, taken: false, anim: 0 };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

import { CFG, PALETTE } from './config';
import { FIELD } from './physics';
import type { Fx, Game } from './game';
import { BlockKind, PickupKind, type Block, type Hue } from './types';

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  colour: string;
}

interface Floater {
  x: number;
  y: number;
  text: string;
  life: number;
  colour: string;
  size: number;
}

export interface Layout {
  cell: number;
  ox: number;
  oy: number;
}

export class Renderer {
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private shake = 0;
  private flash = 0;
  private t = 0;
  dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {}

  resize(): void {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2.5);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
  }

  layout(): Layout {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const cell = Math.min(w / FIELD.width, h / FIELD.height);
    return { cell, ox: (w - cell * FIELD.width) / 2, oy: (h - cell * FIELD.height) / 2 };
  }

  /** Convert a pointer position on the canvas into field coordinates. */
  toField(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, ox, oy } = this.layout();
    return { x: (clientX - rect.left - ox) / cell, y: (clientY - rect.top - oy) / cell };
  }

  ingest(events: Fx[]): void {
    for (const fx of events) {
      switch (fx.kind) {
        case 'shatter':
          this.burst(fx.x, fx.y, hueColour(fx.hue), 9 + fx.value * 3);
          break;
        case 'resonate':
          this.burst(fx.x, fx.y, hueGlow(fx.hue), 6);
          this.shake = Math.min(9, this.shake + 0.7 + fx.value * 0.35);
          if (fx.value >= 3) {
            this.float(fx.x, fx.y, `×${fx.value} PIERCE`, hueGlow(fx.hue), 15);
          }
          break;
        case 'cascade':
          this.shake = Math.min(16, this.shake + 4 + fx.value * 1.6);
          this.flash = Math.min(0.5, this.flash + 0.12 * fx.value);
          if (fx.text) this.float(fx.x, fx.y, fx.text, hueGlow(fx.hue), 20 + fx.value * 2);
          break;
        case 'bomb':
          this.burst(fx.x, fx.y, '#ffd978', 26);
          this.shake = Math.min(18, this.shake + 7);
          break;
        case 'pickup':
          if (fx.text) this.float(fx.x, fx.y, fx.text, '#fff3c4', 18);
          this.burst(fx.x, fx.y, '#ffe08a', 12);
          break;
        case 'chip':
          this.burst(fx.x, fx.y, hueColour(fx.hue), 3);
          break;
        case 'burnout':
          this.burst(fx.x, fx.y, hueColour(fx.hue), 5);
          break;
        case 'wave':
          if (fx.text) this.float(fx.x, fx.y, fx.text, '#ffffff', 26);
          break;
        case 'gameover':
          this.shake = 20;
          this.flash = 0.6;
          break;
        default:
          break;
      }
    }
  }

  draw(game: Game): void {
    const ctx = this.ctx;
    const { cell, ox, oy } = this.layout();
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    this.t += 1 / 60;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    ctx.clearRect(0, 0, w, h);
    this.drawBackground(ctx, w, h);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    ctx.translate(ox + sx, oy + sy);
    this.shake *= 0.86;
    if (this.shake < 0.1) this.shake = 0;

    this.drawField(ctx, cell);
    this.drawDangerLine(ctx, cell, game);
    this.drawBlocks(ctx, cell, game);
    this.drawPickups(ctx, cell, game);
    this.drawAim(ctx, cell, game);
    this.drawBalls(ctx, cell, game);
    this.drawLauncher(ctx, cell, game);
    this.drawParticles(ctx, cell);
    this.drawFloaters(ctx, cell);

    ctx.restore();

    if (this.flash > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.25})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
      this.flash *= 0.85;
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    const g = ctx.createLinearGradient(0, 0, 0, h);
    g.addColorStop(0, '#0d1024');
    g.addColorStop(0.55, PALETTE.bg);
    g.addColorStop(1, '#05060e');
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, w, h);
  }

  private drawField(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.045)';
    ctx.lineWidth = 1;
    for (let c = 1; c < CFG.cols; c++) {
      ctx.beginPath();
      ctx.moveTo(c * cell, 0);
      ctx.lineTo(c * cell, CFG.rows * cell);
      ctx.stroke();
    }
    ctx.strokeStyle = 'rgba(255,255,255,0.09)';
    ctx.strokeRect(0, 0, CFG.cols * cell, FIELD.height * cell);
    ctx.restore();
  }

  private drawDangerLine(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    const y = (CFG.dangerRow + 1) * cell;
    const lowest = game.grid.lowestRow();
    const close = lowest >= CFG.dangerRow - 2;
    const pulse = close ? 0.35 + Math.sin(this.t * 7) * 0.25 : 0.16;

    ctx.save();
    ctx.strokeStyle = PALETTE.danger;
    ctx.globalAlpha = pulse;
    ctx.lineWidth = 2;
    ctx.setLineDash([cell * 0.22, cell * 0.16]);
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(CFG.cols * cell, y);
    ctx.stroke();
    ctx.restore();
  }

  private drawBlocks(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    const grid = game.grid;
    for (let row = 0; row < grid.rows; row++) {
      for (let col = 0; col < grid.cols; col++) {
        const b = grid.at(col, row);
        if (b) this.drawBlock(ctx, cell, col, row, b);
      }
    }
  }

  private drawBlock(
    ctx: CanvasRenderingContext2D,
    cell: number,
    col: number,
    row: number,
    b: Block,
  ): void {
    const pad = cell * 0.06;
    const x = col * cell + pad;
    const y = row * cell + pad;
    const s = cell - pad * 2;
    const radius = cell * 0.18;

    let core: string;
    let glow: string;
    if (b.kind === BlockKind.Stone) {
      core = PALETTE.stone.core;
      glow = PALETTE.stone.glow;
    } else if (b.kind === BlockKind.Prism) {
      // Near-white so it never gets mistaken for a hue; the shimmer is a rim.
      core = PALETTE.prism.core;
      glow = PALETTE.prism.glow;
    } else {
      core = hueColour(b.hue);
      glow = hueGlow(b.hue);
    }

    ctx.save();
    roundRect(ctx, x, y, s, s, radius);
    const grad = ctx.createLinearGradient(x, y, x, y + s);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, core);
    ctx.fillStyle = grad;
    ctx.shadowColor = core;
    ctx.shadowBlur = cell * 0.3;
    ctx.fill();
    ctx.shadowBlur = 0;

    // Inner bevel so the blocks read as solid rather than flat.
    ctx.globalAlpha = 0.28;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, cell * 0.035);
    roundRect(ctx, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, radius * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;

    // A prism gets a rotating spectrum rim, so "matches everything" is legible.
    if (b.kind === BlockKind.Prism) {
      const rim = ctx.createLinearGradient(x, y, x + s, y + s);
      const shift = (this.t * 90 + col * 40 + row * 25) % 360;
      for (let i = 0; i <= 5; i++) {
        rim.addColorStop(i / 5, `hsl(${(shift + i * 60) % 360}, 95%, 65%)`);
      }
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.5, cell * 0.07);
      roundRect(ctx, x, y, s, s, radius);
      ctx.stroke();
    }

    if (b.kind === BlockKind.Bomb) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.font = `${Math.round(cell * 0.46)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', col * cell + cell / 2, row * cell + cell / 2);
    } else if (b.kind === BlockKind.Prism) {
      ctx.fillStyle = 'rgba(30,34,60,0.85)';
      ctx.font = `${Math.round(cell * 0.4)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('◈', col * cell + cell / 2, row * cell + cell / 2);
    }
    ctx.restore();

    if (b.hp > 1) this.drawArmour(ctx, cell, col, row, b.hp);
  }

  /**
   * Health without digits. The board is read, never counted:
   *
   *   • each stud is worth 1        • a plate frame is worth 4
   *
   * so 3 = two studs, 5 = a plate, 7 = a plate and two studs, 9 = two plates.
   * A hit visibly strips a stud or a plate, which teaches the scheme without
   * a tutorial line. This is placeholder art — see docs/GEMINI_ART_BRIEF.md
   * for the spec a designed block set has to satisfy in its place.
   */
  private drawArmour(
    ctx: CanvasRenderingContext2D,
    cell: number,
    col: number,
    row: number,
    hp: number,
  ): void {
    const plates = Math.min(2, Math.floor((hp - 1) / 4));
    const studs = hp - 1 - plates * 4;
    const x = col * cell;
    const y = row * cell;
    const ink = 'rgba(8,10,24,0.72)';

    ctx.save();
    ctx.strokeStyle = ink;
    ctx.fillStyle = ink;

    for (let i = 0; i < plates; i++) {
      const inset = cell * (0.17 + i * 0.1);
      ctx.lineWidth = Math.max(1.5, cell * 0.055);
      roundRect(ctx, x + inset, y + inset, cell - inset * 2, cell - inset * 2, cell * 0.11);
      ctx.stroke();
    }

    if (studs > 0) {
      const r = cell * 0.052;
      const gap = cell * 0.16;
      const cx = x + cell / 2;
      const cy = y + cell * (plates > 0 ? 0.5 : 0.72);
      const start = cx - ((studs - 1) * gap) / 2;
      for (let i = 0; i < studs; i++) {
        ctx.beginPath();
        ctx.arc(start + i * gap, cy, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawPickups(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    for (const p of game.pickups) {
      const cx = (p.col + 0.5) * cell;
      const cy = (p.row + 0.5) * cell + Math.sin(this.t * 3 + p.id) * cell * 0.06;
      const r = cell * 0.3 * (0.6 + 0.4 * p.anim);

      ctx.save();
      ctx.shadowColor = '#ffe08a';
      ctx.shadowBlur = cell * 0.5;
      ctx.strokeStyle = '#ffe08a';
      ctx.lineWidth = Math.max(1.5, cell * 0.05);
      ctx.beginPath();
      ctx.arc(cx, cy, r, 0, Math.PI * 2);
      ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = '#ffe08a';
      ctx.font = `700 ${Math.round(cell * 0.3)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(p.kind === PickupKind.ExtraBall ? '+1' : '◆', cx, cy);
      ctx.restore();
    }
  }

  private drawAim(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    if (!game.aiming || !game.canFire) return;
    const pts = game.aimPreview();
    ctx.save();
    ctx.fillStyle = hueGlow(game.nextHue());
    for (let i = 4; i < pts.length; i += 7) {
      const fade = 1 - i / pts.length;
      ctx.globalAlpha = 0.18 + fade * 0.6;
      ctx.beginPath();
      ctx.arc(pts[i].x * cell, pts[i].y * cell, cell * 0.055, 0, Math.PI * 2);
      ctx.fill();
    }
    const end = pts[pts.length - 1];
    if (end) {
      ctx.globalAlpha = 0.85;
      ctx.strokeStyle = hueGlow(game.nextHue());
      ctx.lineWidth = Math.max(1.5, cell * 0.04);
      ctx.beginPath();
      ctx.arc(end.x * cell, end.y * cell, cell * 0.17, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  }

  private drawBalls(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    const r = CFG.ball.radius * cell;
    for (const ball of game.balls) {
      if (!ball.alive) continue;
      const colour = hueColour(ball.hue);
      const glow = hueGlow(ball.hue);
      const fatigue = Math.max(0.25, Math.min(1, ball.energy / CFG.ball.energy));

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      for (let i = 0; i < ball.trail.length; i++) {
        const p = ball.trail[i];
        const a = (i / ball.trail.length) * 0.35 * fatigue;
        ctx.globalAlpha = a;
        ctx.fillStyle = glow;
        ctx.beginPath();
        ctx.arc(p.x * cell, p.y * cell, r * (0.35 + (i / ball.trail.length) * 0.8), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();

      ctx.save();
      ctx.shadowColor = glow;
      ctx.shadowBlur = cell * (0.25 + 0.4 * fatigue) * (1 + ball.streak * 0.25);
      ctx.fillStyle = ball.streak > 0 ? glow : colour;
      ctx.beginPath();
      ctx.arc(ball.x * cell, ball.y * cell, r * (1 + ball.streak * 0.06), 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
    }
  }

  private drawLauncher(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    const x = game.launcherX * cell;
    const y = game.launcherY * cell;

    ctx.save();
    ctx.strokeStyle = 'rgba(255,255,255,0.18)';
    ctx.lineWidth = Math.max(1, cell * 0.03);
    ctx.beginPath();
    ctx.moveTo(0, y + cell * 0.3);
    ctx.lineTo(CFG.cols * cell, y + cell * 0.3);
    ctx.stroke();

    const hues = game.upcomingHues();
    const spacing = cell * 0.17;
    const start = x - ((hues.length - 1) * spacing) / 2;
    for (let i = 0; i < hues.length; i++) {
      ctx.globalAlpha = game.canFire ? 1 : 0.25;
      ctx.fillStyle = hueColour(hues[i]);
      ctx.beginPath();
      ctx.arc(start + i * spacing, y, cell * 0.06, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.globalAlpha = 1;
    ctx.shadowColor = hueGlow(game.nextHue());
    ctx.shadowBlur = cell * 0.5;
    ctx.fillStyle = hueGlow(game.nextHue());
    ctx.beginPath();
    ctx.arc(x, y, cell * 0.13, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.008;
      p.vx *= 0.97;
      p.vy *= 0.97;
      p.life--;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = (p.life / p.maxLife) * 0.9;
      ctx.fillStyle = p.colour;
      ctx.beginPath();
      ctx.arc(p.x * cell, p.y * cell, p.size * cell, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawFloaters(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y -= 0.012;
      f.life--;
      if (f.life <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      const a = Math.min(1, f.life / 28);
      ctx.globalAlpha = a;
      ctx.font = `900 ${Math.round(f.size * (cell / 40))}px system-ui, -apple-system, sans-serif`;
      // Dark outline first: the field behind these is busy with particles.
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = 'rgba(4,6,16,0.9)';
      ctx.lineJoin = 'round';
      ctx.strokeText(f.text, f.x * cell, f.y * cell);
      ctx.fillStyle = f.colour;
      ctx.shadowColor = f.colour;
      ctx.shadowBlur = cell * 0.45;
      ctx.fillText(f.text, f.x * cell, f.y * cell);
    }
    ctx.restore();
  }

  private burst(x: number, y: number, colour: string, count: number): void {
    // Cap the pool so a huge cascade can't tank the frame rate on a phone.
    if (this.particles.length > 700) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.02 + Math.random() * 0.07;
      const life = 22 + Math.random() * 26;
      this.particles.push({
        x,
        y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life,
        maxLife: life,
        size: 0.02 + Math.random() * 0.045,
        colour,
      });
    }
  }

  private float(x: number, y: number, text: string, colour: string, size: number): void {
    this.floaters.push({ x, y, text, colour, size, life: 60 });
  }
}

export function hueColour(h: Hue): string {
  return PALETTE.hues[h].core;
}

export function hueGlow(h: Hue): string {
  return PALETTE.hues[h].glow;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

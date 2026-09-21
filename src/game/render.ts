import { CFG, PALETTE } from './config';
import type { Fx, Game } from './game';
import { ClearKind, TileKind, type Cell, type Hue, type Tile, type TrayItem } from './types';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; colour: string;
}

interface Floater {
  x: number; y: number; text: string; life: number; colour: string; size: number;
}

/** Where the board and the tray sit, in CSS pixels. */
export interface Layout {
  cell: number;
  ox: number;
  oy: number;
  trayY: number;
  trayBand: number;
  trayCell: number;
  traySlot: number;
}

/** What the player is currently dragging. */
export interface DragState {
  item: TrayItem;
  /** Pointer position in CSS pixels. */
  px: number;
  py: number;
  /** Board cell the shape's top-left would land on, or null when off-board. */
  target: Cell | null;
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

  /**
   * Board above, tray pinned to the bottom where a thumb reaches it.
   *
   * On a phone an 8x8 board is limited by width, so it can never fill the
   * height — pinning the tray to the bottom and centring the board in what is
   * left puts the slack between the two, rather than stranding it all above the
   * board where it just reads as a hole in the screen.
   */
  layout(): Layout {
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    const gutter = 10;
    const trayBand = Math.min(168, Math.max(120, h * 0.2));

    const cell = Math.min((w - gutter * 2) / CFG.cols, (h - trayBand - gutter * 2) / CFG.rows);
    const boardH = cell * CFG.rows;
    const trayY = h - trayBand;
    const ox = (w - cell * CFG.cols) / 2;
    // Biased upward: the slack is more useful between board and tray, where
    // the drag happens and the lifted piece needs somewhere to be seen.
    const oy = Math.max(gutter, gutter + (trayY - boardH - gutter) * 0.3);

    return {
      cell,
      ox,
      oy,
      trayY,
      trayBand,
      trayCell: cell * 0.62,
      traySlot: (w - gutter * 2) / CFG.traySize,
    };
  }

  /** Pointer position → board cell (may be off-board). */
  toCell(clientX: number, clientY: number): Cell {
    const rect = this.canvas.getBoundingClientRect();
    const { cell, ox, oy } = this.layout();
    return {
      col: Math.floor((clientX - rect.left - ox) / cell),
      row: Math.floor((clientY - rect.top - oy) / cell),
    };
  }

  toLocal(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    return { x: clientX - rect.left, y: clientY - rect.top };
  }

  /** Which tray slot a pointer is over, or -1. */
  traySlotAt(clientX: number, clientY: number): number {
    const { trayY, traySlot } = this.layout();
    const p = this.toLocal(clientX, clientY);
    if (p.y < trayY - 8) return -1;
    const slot = Math.floor((p.x - 10) / traySlot);
    return slot >= 0 && slot < CFG.traySize ? slot : -1;
  }

  /**
   * How big a tray piece is drawn. A long bar has to shrink to fit its slot,
   * but shrinking every piece to the size of the worst case makes the common
   * small ones needlessly fiddly to grab, so each piece is scaled to its own
   * footprint.
   */
  private trayScale(L: Layout, item: TrayItem): number {
    const span = Math.max(item.shape.w, item.shape.h);
    return Math.min(L.trayCell, (L.traySlot - 22) / span, (L.trayBand - 34) / span);
  }

  ingest(events: Fx[]): void {
    for (const fx of events) {
      switch (fx.kind) {
        case 'place':
          this.shake = Math.min(5, this.shake + 1.5);
          break;
        case 'shatter':
          this.burst(fx.x, fx.y, hueColour(fx.hue), 8 + fx.value * 2);
          break;
        case 'clearLine':
          this.shake = Math.min(14, this.shake + 5);
          this.flash = Math.min(0.4, this.flash + 0.12);
          break;
        case 'clearGroup':
          this.shake = Math.min(16, this.shake + 5);
          this.flash = Math.min(0.45, this.flash + 0.14);
          this.float(fx.x, fx.y, `×${fx.value}`, hueGlow(fx.hue), 20);
          break;
        case 'combo':
          if (fx.text) this.float(fx.x, fx.y - 0.6, fx.text, '#ffffff', 26);
          this.shake = Math.min(20, this.shake + 6);
          break;
        case 'bomb':
          this.burst(fx.x, fx.y, '#ffd978', 24);
          this.shake = Math.min(20, this.shake + 7);
          break;
        case 'creep':
          this.shake = Math.min(12, this.shake + 5);
          break;
        case 'win':
          this.flash = 0.7;
          break;
        case 'lose':
          this.shake = 18;
          this.flash = 0.5;
          break;
        default:
          break;
      }
    }
  }

  draw(game: Game, drag: DragState | null): void {
    const ctx = this.ctx;
    const L = this.layout();
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;
    this.t += 1 / 60;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.drawBackground(ctx, w, h);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;
    this.shake *= 0.85;
    if (this.shake < 0.1) this.shake = 0;

    ctx.save();
    ctx.translate(L.ox + sx, L.oy + sy);
    this.drawGrid(ctx, L.cell);
    this.drawTiles(ctx, L.cell, game);
    if (drag) this.drawDropPreview(ctx, L.cell, game, drag);
    this.drawParticles(ctx, L.cell);
    this.drawFloaters(ctx, L.cell);
    ctx.restore();

    this.drawTray(ctx, L, game, drag);
    if (drag) this.drawHeldPiece(ctx, L, drag);
    ctx.restore();

    if (this.flash > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.22})`;
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

  private drawGrid(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    for (let row = 0; row < CFG.rows; row++) {
      for (let col = 0; col < CFG.cols; col++) {
        const pad = cell * 0.06;
        roundRect(ctx, col * cell + pad, row * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.18);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawTiles(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    for (let row = 0; row < game.board.rows; row++) {
      for (let col = 0; col < game.board.cols; col++) {
        const t = game.board.at(col, row);
        if (t) this.drawTile(ctx, cell, col * cell, row * cell, t, t.anim);
      }
    }
  }

  private drawTile(
    ctx: CanvasRenderingContext2D,
    cell: number,
    x0: number,
    y0: number,
    tile: Tile,
    anim = 1,
  ): void {
    const grow = 0.86 + 0.14 * anim;
    const pad = cell * 0.06 + (cell * (1 - grow)) / 2;
    const x = x0 + pad;
    const y = y0 + pad;
    const s = cell - pad * 2;
    const radius = cell * 0.18;

    let core: string;
    let glow: string;
    if (tile.kind === TileKind.Stone) {
      core = PALETTE.stone.core;
      glow = PALETTE.stone.glow;
    } else if (tile.kind === TileKind.Prism) {
      core = PALETTE.prism.core;
      glow = PALETTE.prism.glow;
    } else if (tile.kind === TileKind.Crate) {
      core = PALETTE.crate.core;
      glow = PALETTE.crate.glow;
    } else {
      core = hueColour(tile.hue);
      glow = hueGlow(tile.hue);
    }

    ctx.save();
    roundRect(ctx, x, y, s, s, radius);
    const grad = ctx.createLinearGradient(x, y, x, y + s);
    grad.addColorStop(0, glow);
    grad.addColorStop(1, core);
    ctx.fillStyle = grad;
    ctx.shadowColor = core;
    ctx.shadowBlur = cell * 0.28;
    ctx.fill();
    ctx.shadowBlur = 0;

    ctx.globalAlpha = 0.26;
    ctx.strokeStyle = '#ffffff';
    ctx.lineWidth = Math.max(1, cell * 0.035);
    roundRect(ctx, x + s * 0.08, y + s * 0.08, s * 0.84, s * 0.84, radius * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (tile.kind === TileKind.Prism) {
      const rim = ctx.createLinearGradient(x, y, x + s, y + s);
      const shift = (this.t * 90 + x * 0.6 + y * 0.4) % 360;
      for (let i = 0; i <= 5; i++) rim.addColorStop(i / 5, `hsl(${(shift + i * 60) % 360}, 95%, 65%)`);
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.5, cell * 0.07);
      roundRect(ctx, x, y, s, s, radius);
      ctx.stroke();
    }

    if (tile.kind === TileKind.Bomb) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.font = `${Math.round(cell * 0.44)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', x0 + cell / 2, y0 + cell / 2);
    }
    ctx.restore();

    this.drawDamage(ctx, cell, x0, y0, tile);
  }

  /**
   * Health shown as damage, never as a number. A crate that has taken a hit
   * splits; nothing on the board asks to be counted, so the player's attention
   * stays on colour and space, which is what the game is actually about. Crack
   * geometry comes from the tile id, so a tile always breaks the same way
   * instead of shimmering frame to frame.
   */
  private drawDamage(
    ctx: CanvasRenderingContext2D,
    cell: number,
    x0: number,
    y0: number,
    tile: Tile,
  ): void {
    const taken = tile.maxHp - tile.hp;
    if (taken <= 0) return;
    const fractures = Math.max(1, Math.round((taken / tile.maxHp) * 4));

    ctx.save();
    ctx.strokeStyle = 'rgba(6,8,18,0.8)';
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';
    for (let i = 0; i < fractures; i++) {
      ctx.lineWidth = Math.max(1, cell * (0.06 - i * 0.008));
      const pts = crackPath(tile.id, i);
      ctx.beginPath();
      ctx.moveTo(x0 + pts[0].x * cell, y0 + pts[0].y * cell);
      for (let p = 1; p < pts.length; p++) ctx.lineTo(x0 + pts[p].x * cell, y0 + pts[p].y * cell);
      ctx.stroke();
    }
    ctx.restore();
  }

  /**
   * The drop preview. A ghost of the piece sits in the cells it would occupy,
   * and anything the placement would clear is outlined right then — so the
   * consequence of a move is visible before the finger lifts, and a move is a
   * decision rather than a guess.
   */
  private drawDropPreview(
    ctx: CanvasRenderingContext2D,
    cell: number,
    game: Game,
    drag: DragState,
  ): void {
    if (!drag.target) return;
    const { valid, footprint, clears } = game.previewPlacement(
      drag.item,
      drag.target.col,
      drag.target.row,
    );

    ctx.save();
    if (!valid) {
      ctx.globalAlpha = 0.35;
      ctx.fillStyle = PALETTE.danger;
      for (const c of footprint) {
        if (!game.board.inBounds(c.col, c.row)) continue;
        const pad = cell * 0.1;
        roundRect(ctx, c.col * cell + pad, c.row * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.16);
        ctx.fill();
      }
      ctx.restore();
      return;
    }

    ctx.globalAlpha = 0.5;
    for (const c of footprint) {
      const pad = cell * 0.06;
      roundRect(ctx, c.col * cell + pad, c.row * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.18);
      ctx.fillStyle = hueGlow(drag.item.hue);
      ctx.fill();
    }

    // Everything this move takes out, ringed in advance.
    if (clears.length) {
      const pulse = 0.6 + Math.sin(this.t * 10) * 0.3;
      ctx.globalAlpha = pulse;
      ctx.lineWidth = Math.max(2, cell * 0.07);
      for (const ev of clears) {
        ctx.strokeStyle = ev.kind === ClearKind.Group ? hueGlow(ev.hue) : '#ffffff';
        for (const c of ev.cells) {
          const pad = cell * 0.1;
          roundRect(ctx, c.col * cell + pad, c.row * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.16);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  private drawTray(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    game: Game,
    drag: DragState | null,
  ): void {
    // A panel under the tray so it reads as a separate place from the board.
    ctx.save();
    ctx.fillStyle = 'rgba(255,255,255,0.035)';
    roundRect(ctx, 10, L.trayY, L.traySlot * CFG.traySize, L.trayBand - 10, 18);
    ctx.fill();
    ctx.restore();

    for (let i = 0; i < game.tray.length; i++) {
      const item = game.tray[i];
      if (item.used || drag?.item.id === item.id) continue;

      const cx = 10 + i * L.traySlot + L.traySlot / 2;
      const cy = L.trayY + (L.trayBand - 10) / 2;
      const fits = game.board.hasAnyPlacement(item.shape);

      ctx.save();
      // A piece that no longer fits anywhere goes dim, so a dead tray is
      // visible before it is fatal.
      ctx.globalAlpha = fits ? 1 : 0.28;
      this.drawShape(ctx, item, cx, cy, this.trayScale(L, item));
      ctx.restore();
    }
  }

  /** A shape drawn centred on a point, for the tray and the dragged ghost. */
  private drawShape(
    ctx: CanvasRenderingContext2D,
    item: TrayItem,
    cx: number,
    cy: number,
    cell: number,
  ): void {
    const ox = cx - (item.shape.w * cell) / 2;
    const oy = cy - (item.shape.h * cell) / 2;
    for (const [dx, dy] of item.shape.cells) {
      this.drawTile(
        ctx,
        cell,
        ox + dx * cell,
        oy + dy * cell,
        { id: item.id * 31 + dx * 7 + dy, kind: TileKind.Colour, hue: item.hue, hp: 1, maxHp: 1, anim: 1, dying: false, preset: false },
      );
    }
  }

  /** The piece under the finger, lifted clear of it so it stays visible. */
  private drawHeldPiece(ctx: CanvasRenderingContext2D, L: Layout, drag: DragState): void {
    ctx.save();
    ctx.globalAlpha = 0.95;
    this.drawShape(ctx, drag.item, drag.px, drag.py - L.cell * 1.6, L.cell);
    ctx.restore();
  }

  private drawParticles(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx;
      p.y += p.vy;
      p.vy += 0.01;
      p.vx *= 0.97;
      p.vy *= 0.97;
      if (--p.life <= 0) {
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
    ctx.lineJoin = 'round';
    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y -= 0.014;
      if (--f.life <= 0) {
        this.floaters.splice(i, 1);
        continue;
      }
      ctx.globalAlpha = Math.min(1, f.life / 26);
      ctx.font = `900 ${Math.round(f.size * (cell / 44))}px system-ui, -apple-system, sans-serif`;
      ctx.lineWidth = Math.max(2, cell * 0.09);
      ctx.strokeStyle = 'rgba(4,6,16,0.9)';
      ctx.strokeText(f.text, f.x * cell, f.y * cell);
      ctx.fillStyle = f.colour;
      ctx.shadowColor = f.colour;
      ctx.shadowBlur = cell * 0.45;
      ctx.fillText(f.text, f.x * cell, f.y * cell);
    }
    ctx.restore();
  }

  private burst(x: number, y: number, colour: string, count: number): void {
    // Capped so a big combo cannot tank the frame rate on a phone.
    if (this.particles.length > 700) return;
    for (let i = 0; i < count; i++) {
      const a = Math.random() * Math.PI * 2;
      const sp = 0.02 + Math.random() * 0.07;
      const life = 22 + Math.random() * 26;
      this.particles.push({
        x, y,
        vx: Math.cos(a) * sp,
        vy: Math.sin(a) * sp,
        life, maxLife: life,
        size: 0.02 + Math.random() * 0.045,
        colour,
      });
    }
  }

  private float(x: number, y: number, text: string, colour: string, size: number): void {
    this.floaters.push({ x, y, text, colour, size, life: 62 });
  }
}

export function hueColour(h: Hue): string {
  return PALETTE.hues[h].core;
}

export function hueGlow(h: Hue): string {
  return PALETTE.hues[h].glow;
}

/**
 * A jagged line across a tile, derived from the tile id so the same tile always
 * fractures the same way. Points are in 0..1 cell space.
 */
function crackPath(id: number, index: number): { x: number; y: number }[] {
  const a = hash2(id, index * 2 + 1);
  const b = hash2(id, index * 2 + 2);
  const angle = (a % 360) * (Math.PI / 180);
  const cx = 0.5 + ((b % 100) / 100) * 0.3 - 0.15;
  const cy = 0.5 + ((a % 97) / 97) * 0.3 - 0.15;

  const pts: { x: number; y: number }[] = [];
  for (let i = 0; i <= 4; i++) {
    const t = i / 4 - 0.5;
    const wobble = ((hash2(id, index * 8 + i) % 100) / 100 - 0.5) * 0.22;
    pts.push({
      x: clamp01(cx + Math.cos(angle) * t * 0.96 - Math.sin(angle) * wobble),
      y: clamp01(cy + Math.sin(angle) * t * 0.96 + Math.cos(angle) * wobble),
    });
  }
  return pts;
}

function hash2(a: number, b: number): number {
  let h = (a * 374761393 + b * 668265263) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 1274126177) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

function clamp01(v: number): number {
  return v < 0.06 ? 0.06 : v > 0.94 ? 0.94 : v;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number, y: number, w: number, h: number, r: number,
): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

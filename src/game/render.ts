import { CFG, PALETTE } from './config';
import type { Fx, Game } from './game';
import { TileKind, type Cell, type Hue, type Tile, type TrayItem } from './types';

interface Particle {
  x: number; y: number; vx: number; vy: number;
  life: number; maxLife: number; size: number; colour: string;
}

interface Floater {
  x: number; y: number; text: string; life: number; colour: string; size: number;
}

/** A tile that has already left the board but is still on screen. */
interface Departing {
  col: number;
  row: number;
  kind: TileKind;
  hue: Hue;
  life: number;
  maxLife: number;
  delay: number;
}

/** The bright wipe that runs down a line as it clears. */
interface Sweep {
  vertical: boolean;
  index: number;
  life: number;
  maxLife: number;
  colour: string;
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

/** What the player is currently dragging. Pointer position is canvas-local. */
export interface DragState {
  item: TrayItem;
  px: number;
  py: number;
}

/**
 * How far above the finger the piece rides, in cells. Enough that a thumb does
 * not cover the piece or the cells it is about to land on.
 */
export const DRAG_LIFT = 1.35;

export class Renderer {
  private particles: Particle[] = [];
  private floaters: Floater[] = [];
  private departing: Departing[] = [];
  private sweeps: Sweep[] = [];
  /**
   * Tiles are pre-rendered once each and then blitted.
   *
   * Drawing them live cost a fresh gradient and a `shadowBlur` fill per tile
   * per frame. With a full board that alone put frame times at 50ms on a
   * throttled phone — which was the entire reason this felt sluggish. A glow is
   * cheap once and ruinous sixty-four times a frame.
   */
  private sprites = new Map<string, HTMLCanvasElement>();
  private gridSprite: HTMLCanvasElement | null = null;
  private spriteCell = 48;
  private bgGradient: CanvasGradient | null = null;
  /**
   * Where the dragged piece is actually drawn, eased toward where it belongs.
   *
   * The piece is one object for the whole gesture. It never switches between a
   * copy under the finger and a separate ghost in the grid — that swap is what
   * made dragging feel like two different interactions stitched together.
   * Instead it is magnetic: over a legal spot it eases onto the grid, and
   * elsewhere it follows the hand.
   */
  private dragDraw = { x: 0, y: 0, scale: 1, itemId: -1 };
  /** Per tray item, 0..1, so a fresh hand arrives rather than appearing. */
  private trayIn = new Map<number, number>();
  private shake = 0;
  private flash = 0;
  private t = 0;
  dpr = 1;

  constructor(
    private canvas: HTMLCanvasElement,
    private ctx: CanvasRenderingContext2D,
  ) {}

  resize(): void {
    // Capped at 2: a 3x phone would be rasterising over four megapixels a
    // frame for detail nobody can see at this tile size.
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    this.canvas.width = Math.round(rect.width * this.dpr);
    this.canvas.height = Math.round(rect.height * this.dpr);
    // Cached art is resolution-specific, so it goes when the canvas changes.
    this.sprites.clear();
    this.gridSprite = null;
    this.bgGradient = null;
    this.spriteCell = Math.round(this.layout().cell);
  }

  /**
   * Glow needs room to spill past the cell, but every pixel of margin is
   * overdraw on sixty-four sprites a frame, so it is kept tight.
   */
  private spritePad(cell: number): number {
    return Math.ceil(cell * 0.16);
  }

  /**
   * One tile, rendered once at board size and scaled on the way out.
   *
   * Sprites are deliberately NOT keyed by the size they are drawn at. The tray
   * draws small, and a piece being picked up animates its scale every frame —
   * keying on size meant the cache invalidated itself sixty times a second and
   * every glow was being re-rendered live, which was slower than never caching
   * at all.
   */
  private tileSprite(kind: TileKind, hue: Hue): HTMLCanvasElement {
    const key = `${kind}:${hue}`;
    const cached = this.sprites.get(key);
    if (cached) return cached;

    const cell = this.spriteCell;
    const pad = this.spritePad(cell);
    const box = cell + pad * 2;
    const canvas = document.createElement('canvas');
    canvas.width = Math.ceil(box * this.dpr);
    canvas.height = Math.ceil(box * this.dpr);
    const c = canvas.getContext('2d')!;
    c.scale(this.dpr, this.dpr);
    this.paintTile(c, cell, pad, pad, kind, hue);
    this.sprites.set(key, canvas);
    return canvas;
  }

  /** The actual tile art. Runs once per sprite, never per frame. */
  private paintTile(
    ctx: CanvasRenderingContext2D,
    cell: number,
    x0: number,
    y0: number,
    kind: TileKind,
    hue: Hue,
  ): void {
    const pad = cell * 0.06;
    const x = x0 + pad;
    const y = y0 + pad;
    const size = cell - pad * 2;
    const radius = cell * 0.18;

    let core: string;
    let glow: string;
    if (kind === TileKind.Stone) {
      core = PALETTE.stone.core;
      glow = PALETTE.stone.glow;
    } else if (kind === TileKind.Gem) {
      core = PALETTE.gem.core;
      glow = PALETTE.gem.glow;
    } else if (kind === TileKind.Crate) {
      core = PALETTE.crate.core;
      glow = PALETTE.crate.glow;
    } else {
      core = hueColour(hue);
      glow = hueGlow(hue);
    }

    ctx.save();
    roundRect(ctx, x, y, size, size, radius);
    const grad = ctx.createLinearGradient(x, y, x, y + size);
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
    roundRect(ctx, x + size * 0.08, y + size * 0.08, size * 0.84, size * 0.84, radius * 0.7);
    ctx.stroke();
    ctx.globalAlpha = 1;

    if (kind === TileKind.Gem) {
      const rim = ctx.createLinearGradient(x, y, x + size, y + size);
      for (let i = 0; i <= 5; i++) rim.addColorStop(i / 5, `hsl(${i * 60}, 95%, 65%)`);
      ctx.strokeStyle = rim;
      ctx.lineWidth = Math.max(1.5, cell * 0.07);
      roundRect(ctx, x, y, size, size, radius);
      ctx.stroke();
    }

    if (kind === TileKind.Bomb) {
      ctx.fillStyle = 'rgba(0,0,0,0.75)';
      ctx.font = `${Math.round(cell * 0.44)}px system-ui, sans-serif`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText('✦', x0 + cell / 2, y0 + cell / 2);
    }
    ctx.restore();
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

  /**
   * Where a dragged piece would land: the cell its top-left corner occupies.
   * Both the renderer and the input code go through this, so what is drawn and
   * what is placed can never disagree.
   */
  dragTarget(drag: DragState): Cell {
    const { cell, ox, oy } = this.layout();
    const shape = drag.item.shape;
    const cx = drag.px - ox;
    const cy = drag.py - oy - cell * DRAG_LIFT;
    return {
      col: Math.round(cx / cell - shape.w / 2),
      row: Math.round(cy / cell - shape.h / 2),
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
        case 'shatter': {
          this.burst(fx.x, fx.y, hueColour(fx.hue), 5 + fx.value);
          // Keep drawing the tile for a few frames after the board drops it,
          // so a clear reads as tiles leaving rather than tiles vanishing.
          const col = Math.floor(fx.x);
          const row = Math.floor(fx.y);
          this.departing.push({
            col,
            row,
            kind: fx.tileKind ?? TileKind.Colour,
            hue: fx.hue,
            life: 17,
            maxLife: 17,
            // Stagger along the line so the clear travels instead of blinking.
            delay: ((col + row) % 8) * 1.4,
          });
          break;
        }
        case 'clearLine':
          // More lines at once means more of everything.
          this.shake = Math.min(20, this.shake + 4 + fx.value * 2);
          this.flash = Math.min(0.5, this.flash + 0.1 * fx.value);
          if (fx.line) {
            this.sweeps.push({
              vertical: fx.line.vertical,
              index: fx.line.index,
              life: 16,
              maxLife: 16,
              colour: hueGlow(fx.hue),
            });
          }
          break;
        case 'gem':
          this.burst(fx.x, fx.y, '#ffffff', 14);
          if (fx.text) this.float(fx.x, fx.y, fx.text, '#ffffff', 20);
          break;
        case 'combo':
          if (fx.text) this.float(fx.x, fx.y - 0.6, fx.text, '#ffffff', 26);
          this.shake = Math.min(20, this.shake + 6);
          break;
        case 'bomb':
          this.burst(fx.x, fx.y, '#ffd978', 16);
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

  /**
   * Advance every animation by `frames` sixtieths of a second.
   *
   * Animation used to tick once per rendered frame, which meant that on a
   * device managing 30fps every effect in the game ran at half speed — the
   * clear sweeps, the piece settling, the drag magnet, all of it. Driving them
   * from elapsed time instead makes the game feel the same whatever the device
   * is doing.
   */
  advance(frames: number): void {
    const dt = Math.min(frames, 4); // a long stall must not teleport everything
    this.t += dt / 60;
    this.shake *= Math.pow(0.85, dt);
    if (this.shake < 0.1) this.shake = 0;
    this.flash *= Math.pow(0.85, dt);

    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vy += 0.01 * dt;
      p.vx *= Math.pow(0.97, dt);
      p.vy *= Math.pow(0.97, dt);
      p.life -= dt;
      if (p.life <= 0) this.particles.splice(i, 1);
    }

    for (let i = this.floaters.length - 1; i >= 0; i--) {
      const f = this.floaters[i];
      f.y -= 0.014 * dt;
      f.life -= dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }

    for (let i = this.departing.length - 1; i >= 0; i--) {
      const d = this.departing[i];
      if (d.delay > 0) {
        d.delay -= dt;
        continue;
      }
      d.life -= dt;
      if (d.life <= 0) this.departing.splice(i, 1);
    }

    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const sw = this.sweeps[i];
      sw.life -= dt;
      if (sw.life <= 0) this.sweeps.splice(i, 1);
    }

    for (const [id, v] of this.trayIn) {
      if (v < 1) this.trayIn.set(id, Math.min(1, v + 0.11 * dt));
    }
    this.dragDt = dt;
  }

  private dragDt = 1;

  draw(game: Game, drag: DragState | null): void {
    const ctx = this.ctx;
    const L = this.layout();
    const w = this.canvas.width / this.dpr;
    const h = this.canvas.height / this.dpr;

    ctx.save();
    ctx.scale(this.dpr, this.dpr);
    this.drawBackground(ctx, w, h);

    const sx = (Math.random() - 0.5) * this.shake;
    const sy = (Math.random() - 0.5) * this.shake;

    ctx.save();
    ctx.translate(L.ox + sx, L.oy + sy);
    this.drawGrid(ctx, L.cell);
    this.drawTiles(ctx, L.cell, game);
    this.drawDeparting(ctx, L.cell);
    this.drawSweeps(ctx, L.cell);
    if (drag) this.drawDragShadow(ctx, L.cell, game, drag);
    this.drawParticles(ctx, L.cell);
    this.drawFloaters(ctx, L.cell);
    if (drag) this.drawDraggedPiece(ctx, L, game, drag);
    ctx.restore();

    this.drawTray(ctx, L, game, drag);
    ctx.restore();

    if (this.flash > 0.001) {
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      ctx.fillStyle = `rgba(255,255,255,${this.flash * 0.22})`;
      ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.restore();
    }
  }

  private drawBackground(ctx: CanvasRenderingContext2D, w: number, h: number): void {
    if (!this.bgGradient) {
      const g = ctx.createLinearGradient(0, 0, 0, h);
      g.addColorStop(0, '#0d1024');
      g.addColorStop(0.55, PALETTE.bg);
      g.addColorStop(1, '#05060e');
      this.bgGradient = g;
    }
    ctx.fillStyle = this.bgGradient;
    ctx.fillRect(0, 0, w, h);
  }

  /** The empty grid never changes, so it is painted once and blitted. */
  private drawGrid(ctx: CanvasRenderingContext2D, cell: number): void {
    const w = cell * CFG.cols;
    const h = cell * CFG.rows;
    if (!this.gridSprite) {
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(w * this.dpr);
      canvas.height = Math.ceil(h * this.dpr);
      const c = canvas.getContext('2d')!;
      c.scale(this.dpr, this.dpr);
      c.fillStyle = 'rgba(255,255,255,0.035)';
      const pad = cell * 0.06;
      for (let row = 0; row < CFG.rows; row++) {
        for (let col = 0; col < CFG.cols; col++) {
          roundRect(c, col * cell + pad, row * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.18);
          c.fill();
        }
      }
      this.gridSprite = canvas;
    }
    ctx.drawImage(this.gridSprite, 0, 0, w, h);
  }

  private drawTiles(ctx: CanvasRenderingContext2D, cell: number, game: Game): void {
    for (let row = 0; row < game.board.rows; row++) {
      for (let col = 0; col < game.board.cols; col++) {
        const t = game.board.at(col, row);
        if (t) this.drawTile(ctx, cell, col * cell, row * cell, t, t.anim);
      }
    }
  }

  /** Blit a cached tile. Scale comes from the placement animation. */
  private drawTile(
    ctx: CanvasRenderingContext2D,
    cell: number,
    x0: number,
    y0: number,
    tile: Tile,
    anim = 1,
  ): void {
    // Overshoot then settle: a tile that eases straight to size reads as
    // appearing, one that overshoots reads as being put down.
    const grow = anim >= 1 ? 1 : 0.8 + 0.28 * anim - 0.08 * anim * anim;
    const sprite = this.tileSprite(tile.kind, tile.hue);
    // The sprite's margin is proportional, so it scales with the blit.
    const pad = cell * 0.16;
    const box = (cell + pad * 2) * grow;
    const offset = pad * grow + (cell * (1 - grow)) / 2;

    ctx.drawImage(sprite, x0 - offset, y0 - offset, box, box);
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

  /** Tiles the board has already released, shrinking and flashing out. */
  private drawDeparting(ctx: CanvasRenderingContext2D, cell: number): void {
    for (let i = this.departing.length - 1; i >= 0; i--) {
      const d = this.departing[i];
      if (d.delay > 0) continue;
      const t = Math.max(0, d.life / d.maxLife);
      ctx.save();
      ctx.globalAlpha = t;
      const grow = 1 + (1 - t) * 0.45;
      const inset = (cell * (grow - 1)) / 2;
      ctx.translate(d.col * cell - inset, d.row * cell - inset);
      ctx.scale(grow, grow);
      this.drawTile(ctx, cell, 0, 0, {
        id: d.col * 97 + d.row,
        kind: d.kind,
        hue: d.hue,
        hp: 1,
        maxHp: 1,
        anim: 1,
        dying: true,
        preset: false,
      });
      // Blown out toward white as it goes, which is what sells the pop.
      ctx.globalCompositeOperation = 'lighter';
      ctx.globalAlpha = (1 - t) * 0.8;
      ctx.fillStyle = '#ffffff';
      roundRect(ctx, cell * 0.06, cell * 0.06, cell * 0.88, cell * 0.88, cell * 0.18);
      ctx.fill();
      ctx.restore();
    }
  }

  /** A bright wipe travelling down the row or column that just cleared. */
  private drawSweeps(ctx: CanvasRenderingContext2D, cell: number): void {
    for (let i = this.sweeps.length - 1; i >= 0; i--) {
      const sw = this.sweeps[i];
      const t = 1 - Math.max(0, sw.life) / sw.maxLife;
      const span = (sw.vertical ? CFG.rows : CFG.cols) * cell;
      const head = t * span;

      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      const grad = sw.vertical
        ? ctx.createLinearGradient(0, head - cell * 1.6, 0, head + cell * 0.4)
        : ctx.createLinearGradient(head - cell * 1.6, 0, head + cell * 0.4, 0);
      grad.addColorStop(0, 'rgba(255,255,255,0)');
      grad.addColorStop(1, sw.colour);
      ctx.fillStyle = grad;
      ctx.globalAlpha = (1 - t) * 0.85;
      if (sw.vertical) ctx.fillRect(sw.index * cell, 0, cell, span);
      else ctx.fillRect(0, sw.index * cell, span, cell);
      ctx.restore();
    }
  }

  /**
   * The dark footprint the piece is about to occupy, drawn under everything so
   * the target reads even while the piece itself is still easing into place.
   */
  private drawDragShadow(
    ctx: CanvasRenderingContext2D,
    cell: number,
    game: Game,
    drag: DragState,
  ): void {
    const target = this.dragTarget(drag);
    const { valid, footprint, clears } = game.previewPlacement(drag.item, target.col, target.row);

    ctx.save();
    for (const c of footprint) {
      if (!game.board.inBounds(c.col, c.row)) continue;
      const pad = cell * 0.06;
      ctx.fillStyle = valid ? 'rgba(0,0,0,0.5)' : 'rgba(255,46,99,0.28)';
      roundRect(ctx, c.col * cell + pad, c.row * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.18);
      ctx.fill();
    }

    // Everything this placement would clear, ringed before the finger lifts.
    if (valid && clears.length) {
      const pulse = 0.55 + Math.sin(this.t * 9) * 0.3;
      ctx.globalAlpha = pulse;
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = Math.max(2, cell * 0.07);
      for (const ev of clears) {
        for (const c of ev.cells) {
          const pad = cell * 0.1;
          roundRect(ctx, c.col * cell + pad, c.row * cell + pad, cell - pad * 2, cell - pad * 2, cell * 0.16);
          ctx.stroke();
        }
      }
    }
    ctx.restore();
  }

  /**
   * The piece itself. One object for the whole gesture: it eases onto the grid
   * when it is over a legal spot and follows the hand when it is not, so there
   * is never a moment where it jumps between two representations.
   */
  private drawDraggedPiece(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    game: Game,
    drag: DragState,
  ): void {
    const target = this.dragTarget(drag);
    const valid = game.previewPlacement(drag.item, target.col, target.row).valid;
    const shape = drag.item.shape;

    // Freehand position, in board space, with the lift already applied.
    const freeX = drag.px - L.ox - (shape.w * L.cell) / 2;
    const freeY = drag.py - L.oy - L.cell * DRAG_LIFT - (shape.h * L.cell) / 2;
    const wantX = valid ? target.col * L.cell : freeX;
    const wantY = valid ? target.row * L.cell : freeY;

    // A new gesture starts from the tray, at tray size, and grows in.
    if (this.dragDraw.itemId !== drag.item.id) {
      this.dragDraw = {
        itemId: drag.item.id,
        x: freeX,
        y: freeY,
        scale: this.trayScale(L, drag.item) / L.cell,
      };
    }

    // Snapping pulls harder than free movement: that difference is the magnet.
    const ease = 1 - Math.pow(1 - (valid ? 0.45 : 0.6), this.dragDt);
    this.dragDraw.x += (wantX - this.dragDraw.x) * ease;
    this.dragDraw.y += (wantY - this.dragDraw.y) * ease;
    this.dragDraw.scale += (1 - this.dragDraw.scale) * (1 - Math.pow(0.7, this.dragDt));

    const cell = L.cell * this.dragDraw.scale;
    const ox = this.dragDraw.x + (shape.w * L.cell - shape.w * cell) / 2;
    const oy = this.dragDraw.y + (shape.h * L.cell - shape.h * cell) / 2;

    ctx.save();
    ctx.globalAlpha = valid ? 1 : 0.72;
    for (const [dx, dy] of shape.cells) {
      this.drawTile(ctx, cell, ox + dx * cell, oy + dy * cell, {
        id: drag.item.id * 31 + dx * 7 + dy,
        kind: TileKind.Colour,
        hue: drag.item.hue,
        hp: 1,
        maxHp: 1,
        anim: 1,
        dying: false,
        preset: false,
      });
    }
    ctx.restore();
  }

  private drawTray(
    ctx: CanvasRenderingContext2D,
    L: Layout,
    game: Game,
    drag: DragState | null,
  ): void {
    // Forget pieces that have left the tray, so the map cannot grow forever.
    if (this.trayIn.size > 24) {
      const live = new Set(game.tray.map((t) => t.id));
      for (const id of this.trayIn.keys()) if (!live.has(id)) this.trayIn.delete(id);
    }

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
      const fits = game.board.hasAnyPlacementCached(item.shape);

      // A newly dealt piece rises into its slot, staggered across the tray.
      let intro = this.trayIn.get(item.id);
      if (intro === undefined) {
        intro = -i * 0.18;
        this.trayIn.set(item.id, intro);
      }
      const eased = intro <= 0 ? 0 : 1 - Math.pow(1 - intro, 3);
      const cy = L.trayY + (L.trayBand - 10) / 2 + (1 - eased) * L.trayBand * 0.5;

      ctx.save();
      ctx.globalAlpha = eased;
      // A piece that no longer fits anywhere goes dim, so a dead tray is
      // visible before it is fatal.
      ctx.globalAlpha *= fits ? 1 : 0.28;
      this.drawShape(ctx, item, cx, cy, this.trayScale(L, item) * (0.6 + 0.4 * eased));
      ctx.restore();

      // ...and if a discard is spare, it is marked as tappable to throw away.
      if (!fits && game.discardsLeft > 0) {
        ctx.save();
        ctx.fillStyle = '#ffe08a';
        ctx.font = `700 ${Math.round(L.trayBand * 0.14)}px system-ui, sans-serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('🗑 tap to bin', cx, L.trayY + L.trayBand - 26);
        ctx.restore();
      }
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

  private drawParticles(ctx: CanvasRenderingContext2D, cell: number): void {
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      ctx.globalAlpha = Math.max(0, p.life / p.maxLife) * 0.9;
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
      ctx.globalAlpha = Math.min(1, Math.max(0, f.life) / 26);
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
    // Capped so a big combo cannot tank the frame rate on a phone. Each one is
    // an alpha-blended arc under 'lighter', which is not cheap in bulk.
    if (this.particles.length > 260) return;
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

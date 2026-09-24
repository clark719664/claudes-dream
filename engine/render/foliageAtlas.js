// Procedural foliage texture atlas, painted at startup with Canvas 2D:
//   tile 0 (top-left)     broadleaf twig cluster
//   tile 1 (top-right)    conifer needle frond
//   tile 2 (bottom-left)  palm leaflet frond
//   tile 3 (bottom-right) flowering shrub
// RGB is a neutral albedo that instances tint; alpha is leaf coverage.
// Mip levels boost alpha so cards keep their silhouette at a distance.

import { Rng } from '../../shared/rng.js';

const SIZE = 1024;
const TILE = SIZE / 2;

export const ATLAS_TILES = {
  broadleaf: [0, 0],
  needles: [0.5, 0],
  palm: [0, 0.5],
  shrub: [0.5, 0.5],
};

function leaf(ctx, x, y, angle, len, width, shade) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  const g = ctx.createLinearGradient(0, -width, 0, width);
  const c = Math.round(shade * 255);
  const d = Math.round(shade * 200);
  g.addColorStop(0, `rgb(${d},${c},${d})`);
  g.addColorStop(0.5, `rgb(${c},${c},${Math.round(c * 0.85)})`);
  g.addColorStop(1, `rgb(${Math.round(d * 0.8)},${Math.round(c * 0.85)},${Math.round(d * 0.7)})`);
  ctx.fillStyle = g;
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.quadraticCurveTo(len * 0.35, -width, len, 0);
  ctx.quadraticCurveTo(len * 0.35, width, 0, 0);
  ctx.fill();
  ctx.strokeStyle = `rgba(${Math.round(c * 0.7)},${Math.round(c * 0.75)},${Math.round(c * 0.55)},0.8)`;
  ctx.lineWidth = Math.max(1, width * 0.12);
  ctx.beginPath();
  ctx.moveTo(0, 0);
  ctx.lineTo(len * 0.9, 0);
  ctx.stroke();
  ctx.restore();
}

function stem(ctx, x0, y0, x1, y1, w, color = 'rgb(120,95,70)') {
  ctx.strokeStyle = color;
  ctx.lineWidth = w;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.quadraticCurveTo((x0 + x1) / 2 + (y1 - y0) * 0.08, (y0 + y1) / 2, x1, y1);
  ctx.stroke();
}

function paintBroadleaf(ctx, rng) {
  const cx = TILE / 2, base = TILE * 0.97;
  const twigs = [];
  for (let i = 0; i < 7; i++) {
    const a = -Math.PI / 2 + rng.range(-1.0, 1.0);
    const l = rng.range(TILE * 0.25, TILE * 0.45);
    const sx = cx + rng.range(-20, 20), sy = base - rng.range(0, TILE * 0.35);
    twigs.push([sx, sy, sx + Math.cos(a) * l, sy + Math.sin(a) * l]);
  }
  stem(ctx, cx, base, cx, TILE * 0.35, 7);
  for (const [x0, y0, x1, y1] of twigs) stem(ctx, x0, y0, x1, y1, 3.5);
  for (let i = 0; i < 150; i++) {
    const t = twigs[i % twigs.length];
    const f = rng.range(0.2, 1.05);
    const x = t[0] + (t[2] - t[0]) * f + rng.range(-18, 18);
    const y = t[1] + (t[3] - t[1]) * f + rng.range(-18, 18);
    const a = Math.atan2(t[3] - t[1], t[2] - t[0]) + rng.range(-1.4, 1.4);
    leaf(ctx, x, y, a, rng.range(38, 62), rng.range(12, 19), rng.range(0.62, 1.0));
  }
}

function paintNeedles(ctx, rng) {
  const y0 = TILE * 0.5;
  stem(ctx, TILE * 0.03, y0, TILE * 0.97, y0, 6, 'rgb(105,80,60)');
  for (let s = 0; s < 9; s++) {
    const sx = TILE * (0.12 + s * 0.095);
    const dir = s % 2 ? 1 : -1;
    const len = TILE * (0.3 - s * 0.018);
    const ex = sx + len * 0.55, ey = y0 + dir * len * 0.75;
    stem(ctx, sx, y0, ex, ey, 2.5, 'rgb(105,85,60)');
    for (let k = 0; k < 30; k++) {
      const f = k / 30;
      const px = sx + (ex - sx) * f, py = y0 + (ey - y0) * f;
      for (const side of [-1, 1]) {
        const a = Math.atan2(ey - y0, ex - sx) + side * rng.range(0.5, 0.9);
        const l = rng.range(22, 34) * (1 - f * 0.4);
        const shade = rng.range(0.55, 0.95);
        ctx.strokeStyle = `rgb(${Math.round(shade * 190)},${Math.round(shade * 255)},${Math.round(shade * 190)})`;
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(px, py);
        ctx.lineTo(px + Math.cos(a) * l, py + Math.sin(a) * l);
        ctx.stroke();
      }
    }
  }
  for (let k = 0; k < 200; k++) {
    const px = rng.range(TILE * 0.05, TILE * 0.97);
    const a = (k % 2 ? 1 : -1) * rng.range(0.4, 1.0) + (rng.chance(0.5) ? 0 : Math.PI);
    const l = rng.range(20, 36);
    const shade = rng.range(0.55, 0.95);
    ctx.strokeStyle = `rgb(${Math.round(shade * 190)},${Math.round(shade * 255)},${Math.round(shade * 190)})`;
    ctx.lineWidth = 2.2;
    ctx.beginPath();
    ctx.moveTo(px, y0);
    ctx.lineTo(px + Math.cos(a) * l * 0.4, y0 + Math.sin(a) * l);
    ctx.stroke();
  }
}

function paintPalm(ctx, rng) {
  const y0 = TILE * 0.5;
  stem(ctx, TILE * 0.02, y0, TILE * 0.98, y0, 7, 'rgb(150,140,90)');
  for (let i = 0; i < 44; i++) {
    const f = i / 44;
    const x = TILE * (0.05 + f * 0.9);
    const len = TILE * 0.46 * Math.sin(Math.PI * (0.1 + f * 0.85)) + 10;
    for (const side of [-1, 1]) leaf(ctx, x, y0, side * (Math.PI / 2 - 0.55) + rng.range(-0.1, 0.1), len, 9, rng.range(0.65, 1.0));
  }
}

function paintShrub(ctx, rng) {
  paintBroadleaf(ctx, rng);
  for (let i = 0; i < 26; i++) {
    const x = rng.range(TILE * 0.15, TILE * 0.85), y = rng.range(TILE * 0.1, TILE * 0.7);
    for (let p = 0; p < 5; p++) {
      const a = (p / 5) * Math.PI * 2;
      ctx.fillStyle = 'rgb(255,250,245)';
      ctx.beginPath();
      ctx.ellipse(x + Math.cos(a) * 7, y + Math.sin(a) * 7, 7, 4, a, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = 'rgb(255,215,80)';
    ctx.beginPath();
    ctx.arc(x, y, 3.5, 0, Math.PI * 2);
    ctx.fill();
  }
}

function makeCanvas(w, h) {
  if (typeof OffscreenCanvas !== 'undefined') return new OffscreenCanvas(w, h);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  return c;
}

export function createFoliageAtlas(device) {
  const canvas = makeCanvas(SIZE, SIZE);
  const ctx = canvas.getContext('2d');
  ctx.clearRect(0, 0, SIZE, SIZE);
  const painters = [paintBroadleaf, paintNeedles, paintPalm, paintShrub];
  painters.forEach((paint, i) => {
    ctx.save();
    ctx.translate((i % 2) * TILE, Math.floor(i / 2) * TILE);
    ctx.beginPath();
    ctx.rect(2, 2, TILE - 4, TILE - 4);
    ctx.clip();
    paint(ctx, new Rng(101 + i * 13));
    ctx.restore();
  });

  const mips = Math.floor(Math.log2(SIZE)) + 1;
  const texture = device.createTexture({
    label: 'foliage-atlas', size: [SIZE, SIZE], format: 'rgba8unorm', mipLevelCount: mips,
    usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
  });
  let src = canvas;
  for (let level = 0; level < mips; level++) {
    const s = Math.max(1, SIZE >> level);
    let c = src;
    if (level > 0) {
      c = makeCanvas(s, s);
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(src, 0, 0, s, s);
    }
    const data = c.getContext('2d').getImageData(0, 0, s, s).data;
    // un-premultiply bleed: spread colour into transparent texels so filtering stays green, boost alpha in mips
    const boost = 1 + level * 0.28;
    for (let i = 0; i < data.length; i += 4) {
      data[i + 3] = Math.min(255, data[i + 3] * boost);
      if (data[i + 3] < 8) { data[i] = 150; data[i + 1] = 175; data[i + 2] = 120; }
    }
    device.queue.writeTexture({ texture, mipLevel: level }, data, { bytesPerRow: s * 4 }, { width: s, height: s });
    src = c;
  }
  return texture;
}

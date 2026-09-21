import { chromium } from 'playwright';
import { chromiumOptions } from './browser.mjs';
const browser = await chromium.launch(chromiumOptions());
// Throttle CPU to something phone-like; a desktop core hides frame cost.
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const client = await page.context().newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('prismbreak.save.v1', JSON.stringify({ seenIntro: true })));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-act="classic"]').click();
await page.waitForTimeout(600);

// Fill the board so we measure the worst case, not an empty grid.
const box = await page.locator('#stage').boundingBox();
const geom = await page.evaluate(() => {
  const r = document.getElementById('stage').getBoundingClientRect();
  const gutter = 10, trayBand = Math.min(168, Math.max(120, r.height * 0.2));
  const cell = Math.min((r.width - gutter * 2) / 8, (r.height - trayBand - gutter * 2) / 8);
  const trayY = r.height - trayBand;
  return { left: r.left, top: r.top, cell, ox: (r.width - cell * 8) / 2,
           oy: Math.max(gutter, gutter + (trayY - cell * 8 - gutter) * 0.3), trayY, trayBand, width: r.width };
});
const trayY = geom.top + geom.trayY + (geom.trayBand - 10) / 2;

async function drop(slot, gx, gy) {
  const fromX = geom.left + 10 + slot * ((geom.width - 20) / 3) + (geom.width - 20) / 6;
  const toX = geom.left + geom.ox + (gx + 0.5) * geom.cell;
  const toY = geom.top + geom.oy + (gy + 0.5) * geom.cell + geom.cell * 1.35;
  await page.mouse.move(fromX, trayY);
  await page.mouse.down();
  await page.mouse.move(toX, toY, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(120);
}
for (let i = 0; i < 18; i++) await drop(i % 3, (i * 3) % 7, (i * 5) % 7);

// Measure frame times while dragging across the board.
await page.evaluate(() => {
  window.__frames = [];
  let last = performance.now();
  const tick = (t) => { window.__frames.push(t - last); last = t; requestAnimationFrame(tick); };
  requestAnimationFrame(tick);
});
const fromX = geom.left + 10 + (geom.width - 20) / 6;
await page.mouse.move(fromX, trayY);
await page.mouse.down();
for (let i = 0; i < 40; i++) {
  await page.mouse.move(geom.left + geom.ox + ((i % 8) + 0.5) * geom.cell,
                        geom.top + geom.oy + ((i % 6) + 0.5) * geom.cell + geom.cell * 1.35);
  await page.waitForTimeout(30);
}
await page.mouse.up();
await page.waitForTimeout(400);

const stats = await page.evaluate(() => {
  const f = window.__frames.slice(5).sort((a, b) => a - b);
  const pct = (p) => f[Math.floor(f.length * p)];
  return { n: f.length, median: pct(0.5), p90: pct(0.9), p99: pct(0.99), worst: f[f.length - 1],
           over33: f.filter((x) => x > 33).length };
});
console.log(`frames ${stats.n} · median ${stats.median.toFixed(1)}ms · p90 ${stats.p90.toFixed(1)}ms · p99 ${stats.p99.toFixed(1)}ms · worst ${stats.worst.toFixed(1)}ms · ${stats.over33} frames over 33ms`);
await browser.close();

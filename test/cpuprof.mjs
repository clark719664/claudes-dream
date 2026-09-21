/** Where the frame actually goes, from a real CPU profile rather than a guess. */
import { chromium } from 'playwright';
import { chromiumOptions } from './browser.mjs';
const browser = await chromium.launch(chromiumOptions());
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const client = await page.context().newCDPSession(page);
await client.send('Emulation.setCPUThrottlingRate', { rate: 6 });
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('prismbreak.save.v1', JSON.stringify({ seenIntro: true })));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await page.locator('[data-act="classic"]').click();
await page.waitForTimeout(500);

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
  await page.mouse.move(fromX, trayY);
  await page.mouse.down();
  await page.mouse.move(geom.left + geom.ox + (gx + 0.5) * geom.cell,
                        geom.top + geom.oy + (gy + 0.5) * geom.cell + geom.cell * 1.35, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(110);
}
for (let i = 0; i < 18; i++) await drop(i % 3, (i * 3) % 7, (i * 5) % 7);

await client.send('Profiler.enable');
await client.send('Profiler.setSamplingInterval', { interval: 200 });
await client.send('Profiler.start');
const fromX = geom.left + 10 + (geom.width - 20) / 6;
await page.mouse.move(fromX, trayY);
await page.mouse.down();
for (let i = 0; i < 36; i++) {
  await page.mouse.move(geom.left + geom.ox + ((i % 8) + 0.5) * geom.cell,
                        geom.top + geom.oy + ((i % 6) + 0.5) * geom.cell + geom.cell * 1.35);
  await page.waitForTimeout(30);
}
await page.mouse.up();
const { profile } = await client.send('Profiler.stop');

const self = new Map();
const byId = new Map(profile.nodes.map((n) => [n.id, n]));
const total = profile.samples.length;
for (const id of profile.samples) {
  const n = byId.get(id);
  if (!n) continue;
  const f = n.callFrame;
  const name = `${f.functionName || '(anon)'}  ${f.url.split('/').pop()}:${f.lineNumber}`;
  self.set(name, (self.get(name) ?? 0) + 1);
}
console.log(`samples ${total}`);
for (const [name, n] of [...self.entries()].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
  console.log(`  ${((n / total) * 100).toFixed(1).padStart(5)}%  ${name}`);
}
await browser.close();

/** Drives the real game in a mobile-sized browser: drag pieces, clear, finish. */
import { chromium } from 'playwright';

const out = process.argv[2];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

console.log('intro shown:', await page.locator('text=How to play').first().isVisible());
await page.screenshot({ path: `${out}/01-intro.png` });
await page.locator('button:has-text("Got it")').click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${out}/02-home.png` });

await page.locator('[data-act="map"]').click();
await page.waitForTimeout(350);
console.log('map nodes:', await page.locator('.node').count());
await page.screenshot({ path: `${out}/03-map.png`, fullPage: true });

await page.locator('[data-act="back"]').click();
await page.waitForTimeout(250);
await page.locator('[data-act="play"]').click();
await page.waitForTimeout(600);
console.log('hud visible:', await page.locator('#hud').isVisible());
await page.screenshot({ path: `${out}/04-level.png` });

// Play by dragging tray pieces onto the board.
const box = await page.locator('#stage').boundingBox();
const trayY = box.y + box.height * 0.88;
let placed = 0;

/**
 * Mirrors the layout maths in src/game/render.ts so drops actually land on
 * cells. Duplicated on purpose: the point is to drive the real canvas through
 * real pointer events, which means computing where the cells are the same way
 * the renderer does.
 */
const geom = await page.evaluate(() => {
  const r = document.getElementById('stage').getBoundingClientRect();
  const gutter = 10;
  const trayBand = Math.min(168, Math.max(120, r.height * 0.2));
  const cell = Math.min((r.width - gutter * 2) / 8, (r.height - trayBand - gutter * 2) / 8);
  const boardH = cell * 8;
  const trayY = r.height - trayBand;
  return {
    left: r.left,
    top: r.top,
    cell,
    ox: (r.width - cell * 8) / 2,
    oy: Math.max(gutter, gutter + (trayY - boardH - gutter) * 0.3),
    trayY,
    trayBand,
    width: r.width,
  };
});

const trayCentreY = geom.top + geom.trayY + (geom.trayBand - 10) / 2;

/** The piece is drawn a cell and a half above the finger, so aim compensates. */
async function dropAt(slot, gx, gy, shot) {
  const fromX = geom.left + 10 + slot * ((geom.width - 20) / 3) + (geom.width - 20) / 6;
  const toX = geom.left + geom.ox + (gx + 0.5) * geom.cell;
  const toY = geom.top + geom.oy + (gy + 0.5) * geom.cell + geom.cell * 1.6;

  await page.mouse.move(fromX, trayCentreY);
  await page.mouse.down();
  await page.mouse.move((fromX + toX) / 2, (trayCentreY + toY) / 2, { steps: 3 });
  await page.mouse.move(toX, toY, { steps: 4 });
  await page.waitForTimeout(70);
  if (shot) await page.screenshot({ path: shot });
  await page.mouse.up();
  await page.waitForTimeout(200);
}

let shotTaken = false;
outer: for (let pass = 0; pass < 14; pass++) {
  for (let gy = 0; gy < 7; gy++) {
    for (let gx = 0; gx < 7; gx++) {
      if (await page.locator('.screen-title').count()) break outer;
      const shot = !shotTaken && placed === 2 ? `${out}/05-dragging.png` : null;
      if (shot) shotTaken = true;
      await dropAt(placed % 3, (gx + pass) % 7, (gy + pass * 2) % 7, shot);
      placed++;
      if (placed === 12) await page.screenshot({ path: `${out}/06-midlevel.png` });
    }
  }
}

const state = await page.evaluate(() => ({
  score: document.getElementById('hud-score')?.textContent,
  moves: document.getElementById('hud-shots')?.textContent,
  goal: document.getElementById('hud-goal-count')?.textContent,
}));
console.log(`after ${placed} drags:`, JSON.stringify(state));

await page.waitForTimeout(1400);
console.log('outcome:', await page.locator('.screen-title').first().textContent().catch(() => 'none'));
await page.screenshot({ path: `${out}/07-outcome.png` });

console.log('\nERRORS:', errors.length ? errors.join('\n  ') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);

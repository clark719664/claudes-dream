import { chromium } from 'playwright';

const out = process.argv[2];
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

// First launch shows the tutorial.
console.log('intro visible:', await page.locator('text=How to play').first().isVisible());
await page.screenshot({ path: `${out}/01-intro.png` });
await page.locator('button:has-text("Got it")').click();
await page.waitForTimeout(400);

console.log('home title:', await page.locator('.title').textContent());
await page.screenshot({ path: `${out}/02-home.png` });

// Claim the day-1 reward, then start a run.
const claim = page.locator('[data-act="daily-claim"]');
if (await claim.count()) { await claim.click(); await page.waitForTimeout(300); }

await page.locator('[data-act="play"]').click();
await page.waitForTimeout(600);
console.log('hud visible:', await page.locator('#hud').isVisible());
await page.screenshot({ path: `${out}/03-board.png` });

// Play ~25 volleys by dragging on the canvas.
const box = await page.locator('#stage').boundingBox();
for (let i = 0; i < 25; i++) {
  const x = box.x + box.width * (0.12 + 0.76 * Math.random());
  const y = box.y + box.height * (0.12 + 0.35 * Math.random());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.88);
  await page.mouse.down();
  await page.mouse.move(x, y, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  if (await page.locator('text=Run over').count()) break;
  if (await page.locator('text=New best').count()) break;
}
await page.screenshot({ path: `${out}/04-midrun.png` });

const state = await page.evaluate(() => ({
  score: document.getElementById('hud-score')?.textContent,
  wave: document.getElementById('hud-wave')?.textContent,
  shards: document.getElementById('hud-shards')?.textContent,
  overlay: document.getElementById('overlay')?.classList.contains('open'),
}));
console.log('after 25 volleys:', JSON.stringify(state));

// Drive to the end of the run so the results screen renders.
await page.waitForFunction(() => document.getElementById('overlay')?.classList.contains('open'), null, { timeout: 5000 }).catch(() => {});
for (let i = 0; i < 60 && !(await page.locator('.screen-title').count()); i++) {
  const x = box.x + box.width * (0.12 + 0.76 * Math.random());
  await page.mouse.move(box.x + box.width / 2, box.y + box.height * 0.88);
  await page.mouse.down();
  await page.mouse.move(x, box.y + box.height * 0.2, { steps: 3 });
  await page.mouse.up();
  await page.waitForTimeout(800);
}
await page.waitForTimeout(500);
console.log('end screen:', await page.locator('.screen-title').first().textContent().catch(() => 'none'));
await page.screenshot({ path: `${out}/05-results.png` });

console.log('\nERRORS:', errors.length ? errors.join('\n  ') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);

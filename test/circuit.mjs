/** Drives the Circuit: surge, collect, build a Beacon, finish a Sector. */
import { chromium } from 'playwright';
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
await page.evaluate(() => localStorage.setItem('prismbreak.save.v1', JSON.stringify({
  seenIntro: true, charges: 30, lumens: 0, xp: 5000, chargedAt: Date.now(),
})));
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);

await page.locator('[data-act="circuit"]').click();
await page.waitForTimeout(400);
console.log('sector:', (await page.locator('.screen-title').textContent()).trim());
console.log('ring nodes:', await page.locator('.circuit-ring .node').count());
await page.screenshot({ path: `${process.argv[2]}/20-circuit.png`, fullPage: true });

let surges = 0;
for (let i = 0; i < 14; i++) {
  const btn = page.locator('[data-act="surge"]');
  if (!(await btn.count()) || (await btn.isDisabled())) break;
  await btn.click();
  await page.waitForTimeout(1200);
  surges++;
}
const state = await page.evaluate(() => JSON.parse(localStorage.getItem('prismbreak.save.v1')));
console.log(`after ${surges} surges: node ${state.node} · ${state.lumens} lumens · ${state.charges} charges`);
await page.screenshot({ path: `${process.argv[2]}/21-circuit-played.png`, fullPage: true });

// Hand over enough Lumens to light the whole Sector and check it rolls over.
await page.evaluate(() => {
  const s = JSON.parse(localStorage.getItem('prismbreak.save.v1'));
  s.lumens = 500000;
  localStorage.setItem('prismbreak.save.v1', JSON.stringify(s));
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await page.locator('[data-act="circuit"]').click();
await page.waitForTimeout(400);
for (let i = 0; i < 5; i++) {
  const b = page.locator('[data-build]');
  if (!(await b.count()) || (await b.isDisabled())) break;
  await b.click();
  await page.waitForTimeout(500);
}
const after = await page.evaluate(() => JSON.parse(localStorage.getItem('prismbreak.save.v1')));
console.log(`beacons: sector now ${after.sector} · beacons ${after.beacons} · packs queued ${(after.unopened || []).length}`);
await page.screenshot({ path: `${process.argv[2]}/22-sector-done.png`, fullPage: true });

console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);

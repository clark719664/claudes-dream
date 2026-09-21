/** Walks the collectible loop in a real browser: packs, album, gifting, redeem. */
import { chromium } from 'playwright';
import { chromiumOptions } from './browser.mjs';

const out = process.argv[2];
const browser = await chromium.launch(chromiumOptions());
const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });

const errors = [];
page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
page.on('console', (m) => { if (m.type() === 'error') errors.push(`console: ${m.text()}`); });

await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
// Skip the tutorial and hand the player enough shards to exercise the shop.
await page.evaluate(() => {
  localStorage.setItem(
    'prismbreak.save.v1',
    JSON.stringify({ version: 1, playerId: 'TEST01', shards: 12000, dust: 3000, seenIntro: true }),
  );
});
await page.reload({ waitUntil: 'networkidle' });
await page.waitForTimeout(300);

await page.locator('[data-act="shop"]').click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/10-shop.png` });

// Buy a run of packs so duplicates build up.
for (let i = 0; i < 8; i++) {
  const btn = page.locator('[data-buy="standard"]');
  if (await btn.isDisabled()) break;
  await btn.click();
  await page.waitForTimeout(80);
}
await page.locator('[data-buy="premium"]').click();
await page.waitForTimeout(150);
console.log('packs queued:', await page.locator('[data-open]').count());

// Open one and step through the reveals.
await page.locator('[data-open]').first().click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${out}/11-reveal.png` });
console.log('first card:', (await page.locator('.card .nm').textContent()).trim());
for (let i = 0; i < 8; i++) {
  const next = page.locator('[data-act="next"]');
  if (!(await next.count())) break;
  await next.click();
  await page.waitForTimeout(220);
}
await page.screenshot({ path: `${out}/12-pack-summary.png` });
console.log('summary shown:', await page.locator('.screen-title').textContent());

// Open the rest so the album fills out.
await page.locator('[data-act="done"]').click();
await page.waitForTimeout(200);
for (let p = 0; p < 9; p++) {
  const open = page.locator('[data-open]');
  if (!(await open.count())) break;
  await open.first().click();
  await page.waitForTimeout(250);
  for (let i = 0; i < 8; i++) {
    const next = page.locator('[data-act="next"]');
    if (!(await next.count())) break;
    await next.click();
    await page.waitForTimeout(90);
  }
  await page.locator('[data-act="done"]').click();
  await page.waitForTimeout(150);
}

await page.locator('[data-act="back"]').click();
await page.waitForTimeout(200);
await page.locator('[data-act="album"]').click();
await page.waitForTimeout(350);
await page.screenshot({ path: `${out}/13-album.png`, fullPage: true });
const collected = await page.locator('.sticker.owned').count();
console.log('stickers collected:', collected, 'of', await page.locator('.sticker').count());

// Sticker detail.
await page.locator('.sticker.owned').first().click();
await page.waitForTimeout(250);
await page.screenshot({ path: `${out}/14-sticker.png` });
await page.locator('[data-act="back"]').click();
await page.waitForTimeout(200);
await page.locator('[data-act="back"]').click();
await page.waitForTimeout(200);

// Gifting: mint a code from a duplicate, then redeem it.
await page.locator('[data-act="gift"]').click();
await page.waitForTimeout(250);
const spares = await page.locator('[data-mint]').count();
console.log('giftable duplicates:', spares);
await page.screenshot({ path: `${out}/15-gift.png` });

if (spares > 0) {
  await page.locator('[data-mint]').first().click();
  await page.waitForTimeout(300);
  const code = (await page.locator('.code').textContent()).trim();
  console.log('minted code:', code);
  await page.screenshot({ path: `${out}/16-code.png` });

  await page.locator('[data-act="back"]').click();
  await page.waitForTimeout(250);
  await page.fill('#code-in', code);
  await page.locator('[data-act="redeem"]').click();
  await page.waitForTimeout(400);
  console.log('redeem 1:', (await page.locator('.toast').textContent().catch(() => 'no toast')).trim());

  // The same code a second time must be refused.
  await page.fill('#code-in', code);
  await page.locator('[data-act="redeem"]').click();
  await page.waitForTimeout(400);
  console.log('redeem 2:', (await page.locator('.toast').textContent().catch(() => 'no toast')).trim());

  // A typo must be refused too.
  await page.fill('#code-in', 'PB-ZZZZ-ZZZ');
  await page.locator('[data-act="redeem"]').click();
  await page.waitForTimeout(400);
  console.log('bad code:', (await page.locator('.toast').textContent().catch(() => 'no toast')).trim());
}

console.log('\nERRORS:', errors.length ? errors.join('\n  ') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);

/** Verifies the app actually installs: manifest, icons, offline, standalone. */
import { chromium } from 'playwright';
import { chromiumOptions } from './browser.mjs';

const browser = await chromium.launch(chromiumOptions());
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
});
const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });

const manifest = await page.evaluate(async () => {
  const link = document.querySelector('link[rel=manifest]');
  if (!link) return null;
  const r = await fetch(link.href);
  return r.ok ? r.json() : null;
});
console.log(
  'manifest:',
  manifest
    ? `${manifest.name} · ${manifest.display} · ${manifest.orientation} · ${manifest.icons.length} icons`
    : 'MISSING',
);
console.log('apple-touch-icon:', !!(await page.$('link[rel="apple-touch-icon"]')));

for (const icon of ['./icon-180.png', './icon-192.png', './icon-512.png']) {
  const ok = await page.evaluate((u) => fetch(u).then((r) => r.ok).catch(() => false), icon);
  if (!ok) console.log(`ICON MISSING ${icon}`);
}

await page.waitForTimeout(2000);
const sw = await page.evaluate(async () => {
  const reg = await navigator.serviceWorker.getRegistration();
  const keys = await caches.keys();
  const cached = keys.length ? (await (await caches.open(keys[0])).keys()).length : 0;
  return { registered: !!reg, cached };
});
console.log('service worker:', sw.registered ? `registered · ${sw.cached} assets cached` : 'NOT REGISTERED');

// Pull the plug and reload: an installed app has to still start.
await ctx.setOffline(true);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(1000);
const offlineOk = await page.evaluate(
  () => !!document.getElementById('stage') && !!document.querySelector('.screen'),
);
console.log('offline reload:', offlineOk ? 'plays' : 'FAILED');
await ctx.setOffline(false);

console.log('errors:', errors.length ? errors.join(' | ') : 'none');
await browser.close();
process.exit(offlineOk && sw.registered && manifest ? 0 : 1);

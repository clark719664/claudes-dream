/**
 * Renders the app icon at the sizes iOS and Android need for a home-screen
 * install. Uses the Chromium that already ships with the dev tooling rather
 * than adding an image library.
 */
import { chromium } from 'playwright';
import { mkdirSync } from 'node:fs';

const ICON = (size) => `<!doctype html><html><body style="margin:0">
<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 512 512">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#151a33"/><stop offset="1" stop-color="#080a14"/>
    </linearGradient>
    <linearGradient id="a" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#8ae3ff"/><stop offset="1" stop-color="#4cc9f0"/>
    </linearGradient>
    <linearGradient id="b" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ffd978"/><stop offset="1" stop-color="#ffb703"/>
    </linearGradient>
    <linearGradient id="c" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#e2b8ff"/><stop offset="1" stop-color="#c77dff"/>
    </linearGradient>
    <linearGradient id="d" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#ff8fa3"/><stop offset="1" stop-color="#ff4d6d"/>
    </linearGradient>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#bg)"/>
  <g>
    <rect x="96"  y="96"  width="150" height="150" rx="34" fill="url(#a)"/>
    <rect x="266" y="96"  width="150" height="150" rx="34" fill="url(#b)"/>
    <rect x="96"  y="266" width="150" height="150" rx="34" fill="url(#c)"/>
    <rect x="266" y="266" width="150" height="150" rx="34" fill="url(#d)" opacity="0.28"/>
  </g>
</svg></body></html>`;

mkdirSync(new URL('../public', import.meta.url), { recursive: true });
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_PATH ?? '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  await page.setContent(ICON(size));
  await page.screenshot({
    path: new URL(`../public/icon-${size}.png`, import.meta.url).pathname,
    omitBackground: false,
  });
  await page.close();
  console.log(`public/icon-${size}.png`);
}
await browser.close();

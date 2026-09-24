// Screenshot the Studio: starts the dev server, generates a game from an
// idea chip, and captures the whole UI.
//   node tools/studio-shot.mjs out.png [width] [height] [quality]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import { createServer } from '../server/index.js';

const [out = 'test-output/studio.png', width = '1400', height = '860', quality = 'low'] = process.argv.slice(2);
const server = createServer().listen(0);
await new Promise((r) => server.on('listening', r));
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
await page.addInitScript((q) => { localStorage.clear(); localStorage.setItem('reverie.quality', q); }, quality);
await page.goto(`http://localhost:${server.address().port}/`);
await page.waitForSelector('#ideas .chip');
await page.click('#ideas .chip');
await page.waitForFunction(() => document.querySelector('#game-title').textContent !== 'No game yet', null, { timeout: 120000 });
// let a few frames render (menu runs at 30 fps; the software GPU is much slower)
await page.waitForFunction(() => /fps/.test(document.querySelector('#stats').textContent), null, { timeout: 400000 });
await page.waitForTimeout(5000);
await page.screenshot({ path: out, timeout: 300000 });
console.log(JSON.stringify({ title: await page.textContent('#game-title'), stats: await page.textContent('#stats'), log: await page.$$eval('#log .entry', (els) => els.map((e) => e.textContent)), errors: [...new Set(errors)].slice(0, 6) }, null, 1));
await browser.close();
server.close();

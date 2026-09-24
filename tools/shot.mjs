// Headless WebGPU screenshot harness.
//   node tools/shot.mjs <page relative to repo> <out.png> [frames] [width] [height]
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [page = 'tools/testbed.html', out = 'shot.png', frames = '30', width = '960', height = '540'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png' };
const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const file = path.join(root, decodeURIComponent(url.pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const port = server.address().port;
const browser = await chromium.launch({
  headless: true,
  args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'],
});
const tab = await browser.newPage({ viewport: { width: Number(width), height: Number(height) } });
const logs = [];
tab.on('console', (m) => { if (m.type() === 'error' || m.type() === 'warning') logs.push(`[${m.type()}] ${m.text()}`); });
tab.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
const sep = page.includes('?') ? '&' : '?';
const t0 = Date.now();
await tab.goto(`http://localhost:${port}/${page}${sep}frames=${frames}`);
try {
  await tab.waitForFunction((n) => window.__frames >= n || (window.__errors && window.__errors.length), Number(frames), { timeout: 240000, polling: 250 });
} catch (e) { logs.push(`[timeout] ${e.message.split('\n')[0]}`); }
await tab.waitForTimeout(300);
await tab.screenshot({ path: out });
const info = await tab.evaluate(() => ({ frames: window.__frames, errors: [...new Set(window.__errors)].slice(0, 6), stats: document.getElementById('stats')?.textContent }));
console.log(JSON.stringify({ ...info, ms: Date.now() - t0 }, null, 1));
for (const l of [...new Set(logs)].filter((l) => !l.startsWith('[warning]')).slice(0, 12)) console.log(l.slice(0, 1500));
await browser.close();
server.close();

// Scripted, deterministic play-through in headless WebGPU.
//   node tools/playtest.mjs "<play page query>" <out-prefix>
// Loads the game, presses Play, walks forward, jumps, teleports onto a
// collectible to verify scoring, and captures screenshots along the way.
import { chromium } from '/opt/node22/lib/node_modules/playwright/index.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const [query = 'prompt=forest coin hunt', prefix = 'test-output/playtest', w = '960', h = '540'] = process.argv.slice(2);
const types = { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css' };
const server = http.createServer((req, res) => {
  const file = path.join(root, decodeURIComponent(new URL(req.url, 'http://x').pathname));
  if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'content-type': types[path.extname(file)] ?? 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
}).listen(0);
const browser = await chromium.launch({ headless: true, args: ['--enable-unsafe-webgpu', '--enable-features=Vulkan', '--use-vulkan=swiftshader', '--use-webgpu-adapter=swiftshader', '--use-angle=swiftshader'] });
const page = await browser.newPage({ viewport: { width: Number(w), height: Number(h) } });
const logs = [];
page.on('console', (m) => { if (m.type() === 'error') logs.push(m.text()); });
page.on('pageerror', (e) => logs.push(`[pageerror] ${e.message}`));
await page.goto(`http://localhost:${server.address().port}/play/index.html?${query}&frames=1&tier=${process.env.TIER ?? 'medium'}&scale=1&dpr=1`);
await page.waitForFunction(() => window.__engine || window.__errors.length, null, { timeout: 180000 });
const step = async (n, keys = []) => page.evaluate(async ({ n, keys }) => {
  const e = window.__engine;
  for (const k of keys) { e.input.keys.add(k); e.input.pressed.add(k); }
  for (let i = 0; i < n; i++) { e.frame(1 / 30); await e.renderer.device.queue.onSubmittedWorkDone(); }
  for (const k of keys) e.input.keys.delete(k);
  const g = e.game;
  return { state: g.state, score: g.score, lives: g.lives, pos: g.player.pos.map((v) => +v.toFixed(2)), grounded: g.player.grounded };
}, { n, keys });
const shot = async (name) => { await page.screenshot({ path: `${prefix}-${name}.png`, timeout: 240000 }); };

const report = {};
const t0 = Date.now();
await page.evaluate(async () => { await window.__engine.renderer.device.queue.onSubmittedWorkDone(); });
report.bootMs = Date.now() - t0;
report.start = await page.evaluate(() => { window.__engine.play(); return window.__engine.game.state; });
let t1 = Date.now();
report.settle = await step(4);
report.msPerFrame = Math.round((Date.now() - t1) / 4);
await shot('1-start');
report.walk = await step(20, ['KeyW']);
report.jump = await step(8, ['Space', 'KeyW']);
await shot('2-walk');
// teleport next to the nearest collectible and walk into it
report.collect = await page.evaluate(async () => {
  const e = window.__engine;
  const g = e.game;
  const c = e.world.entities.find((x) => x.alive && x.behaviors.some((b) => b.type === 'collectible'));
  if (!c) return 'no collectibles';
  const before = g.score;
  g.player.pos = [c.pos[0], e.world.physics.surfaceAt(c.pos[0], c.pos[2]), c.pos[2] - 1.2];
  g.player.vel = [0, 0, 0];
  for (let i = 0; i < 20; i++) { g.player.pos[0] = c.pos[0]; g.player.pos[2] += 0.08; e.frame(1 / 30); await e.renderer.device.queue.onSubmittedWorkDone(); }
  return { before, after: g.score, collectedAlive: c.alive };
});
await shot('3-collect');
report.errors = await page.evaluate(() => [...new Set(window.__errors)].slice(0, 5));
report.logs = [...new Set(logs)].slice(0, 8);
console.log(JSON.stringify(report, null, 1));
await browser.close();
server.close();

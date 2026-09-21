import { chromium } from 'playwright';
import { chromiumOptions } from './browser.mjs';
const browser = await chromium.launch(chromiumOptions());
for (const rate of [1, 4, 6]) {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true });
  const client = await page.context().newCDPSession(page);
  await client.send('Emulation.setCPUThrottlingRate', { rate });
  await page.goto('http://127.0.0.1:4173/', { waitUntil: 'networkidle' });
  await page.evaluate(() => localStorage.setItem('prismbreak.save.v1', JSON.stringify({ seenIntro: true })));
  await page.reload({ waitUntil: 'networkidle' });
  await page.waitForTimeout(300);
  await page.locator('[data-act="classic"]').click();
  await page.waitForTimeout(500);

  // Measure the actual JS+raster cost of a frame, not the vsync interval:
  // how long the main thread is busy between rAF entry and the next macrotask.
  const busy = await page.evaluate(() => new Promise((resolve) => {
    const samples = [];
    let n = 0;
    const measure = () => {
      const t0 = performance.now();
      // The page's own rAF has already run for this frame by the time a second
      // rAF registered later fires, so schedule ours after it and time to the
      // following microtask drain.
      requestAnimationFrame(() => {
        const t1 = performance.now();
        samples.push(t1 - t0);
        if (++n < 90) measure();
        else {
          samples.sort((a, b) => a - b);
          resolve({ median: samples[45], p90: samples[80], worst: samples[89] });
        }
      });
    };
    measure();
  }));
  const mem = await page.evaluate(() => performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : -1);
  console.log(`throttle ${rate}x · frame interval median ${busy.median.toFixed(1)}ms p90 ${busy.p90.toFixed(1)}ms worst ${busy.worst.toFixed(1)}ms · heap ${mem}MB`);
  await page.close();
}
await browser.close();

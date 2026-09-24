// Standalone player. Loads a game from:
//   #g=<packed spec>   (share links from the Studio)
//   ?example=<name>    (examples/<name>.json)
//   ?prompt=<text>     (offline designer, no server needed)
import { Engine } from '../engine/engine.js';
import { designFromPrompt } from '../shared/designer.js';
import { decodeSpec } from '../shared/share.js';

const q = new URLSearchParams(location.search);
window.__frames = 0;
window.__errors = [];

async function loadSpec() {
  const hash = new URLSearchParams(location.hash.slice(1));
  if (hash.get('g')) return decodeSpec(hash.get('g'));
  if (q.get('example')) {
    const res = await fetch(`../examples/${encodeURIComponent(q.get('example'))}.json`);
    if (!res.ok) throw new Error(`Example "${q.get('example')}" not found`);
    return res.json();
  }
  if (q.get('prompt')) return designFromPrompt(q.get('prompt'));
  const res = await fetch('../examples/golden-grove.json');
  return res.ok ? res.json() : designFromPrompt('A cozy forest at golden hour with glowing mushrooms to collect');
}

async function main() {
  const stage = document.getElementById('stage');
  const boot = document.getElementById('boot');
  let engine;
  try {
    engine = await Engine.create(stage, {
      tier: q.get('tier') ?? 'auto',
      renderScale: q.has('scale') ? Number(q.get('scale')) : undefined,
      pixelRatio: q.has('dpr') ? Number(q.get('dpr')) : undefined,
    });
  } catch (e) {
    boot.innerHTML = `<div><h2>This device can't run Reverie yet</h2><p>${e.message}</p><p>Reverie uses WebGPU: try the latest Chrome, Edge or Safari.</p></div>`;
    return;
  }
  engine.renderer.device.onuncapturederror = (e) => { window.__errors.push(e.error.message); console.error(e.error.message); };
  const spec = await loadSpec();
  const { warnings } = engine.load(spec);
  if (warnings.length) console.info('Spec adjusted:', warnings);
  boot.remove();
  window.__engine = engine;
  if (q.get('hud') === '0') { engine.hud.root.style.display = 'none'; document.getElementById('stats').style.display = 'none'; }
  if (q.has('time')) engine.setEnvironment({ timeOfDay: Number(q.get('time')) });
  // capture helper: make lightning strike after N frames
  if (q.has('strike')) engine.weather.nextStrike = Number(q.get('strike')) / 60;
  const stats = document.getElementById('stats');
  engine.on('frame', (s) => {
    window.__frames++;
    if (window.__frames % 15 === 0) stats.textContent = `${engine.tier} · ${s.internal.join('×')} → ${s.output.join('×')} · ${s.fps.toFixed(0)} fps`;
  });
  if (q.has('frames')) {
    // deterministic capture mode for automated screenshots
    const n = Number(q.get('frames'));
    if (q.has('autoplay')) engine.play();
    for (let i = 0; i < n; i++) {
      engine.frame(1 / 60);
      await new Promise((r) => requestAnimationFrame(r));
    }
  } else {
    engine.start();
    if (q.has('autoplay')) engine.play();
  }
}
main().catch((e) => { window.__errors.push(String(e.stack || e)); console.error(e); });

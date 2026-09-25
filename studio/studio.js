// Reverie Studio: describe a game, watch the AI design it, play it, tweak it
// with sliders or plain language, and share it as a link.

import { Engine } from '../engine/engine.js';
import { designFromPrompt, refineSpec } from '../shared/designer.js';
import { normalizeSpec } from '../shared/spec.js';
import { encodeSpec, decodeSpec } from '../shared/share.js';
import { artDirect } from '../engine/ai/director.js';

const $ = (s) => document.querySelector(s);
const IDEAS = [
  ['🌲 Golden forest', 'A cozy forest at golden hour where you collect glowing mushrooms while avoiding sneaky slimes'],
  ['🌃 Neon parkour', 'Neon cyberpunk rooftop parkour at midnight in the rain'],
  ['👻 Haunted night', 'Survive the haunted graveyard until dawn, ghosts are hunting you'],
  ['🏝️ Island race', 'Race through the rings across tropical islands before sunset'],
  ['🪐 Alien planet', 'Collect star shards on a purple alien planet with crystal forests'],
  ['🌋 Volcano escape', 'Escape the volcano: jump across lava with fireballs flying'],
  ['❄️ Snowy peaks', 'A peaceful snowy mountain walk collecting lost mittens'],
  ['🏛️ Desert ruins', 'Treasure hunt in ancient desert ruins at dawn'],
];
const TWEAKS = ['Make it night', 'Add more enemies', 'Make it snowy', 'Make it harder', 'Add rain and fog', 'First person', 'More glow', 'Bigger world'];
const STORE_KEY = 'reverie.studio.spec';

const state = {
  engine: null,
  spec: null,
  history: [],
  future: [],
  busy: false,
  aiMode: 'offline',
  intent: '',
};

// ---------------------------------------------------------------- helpers

function toast(text, ms = 2200) {
  const t = $('#toast');
  t.textContent = text;
  t.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => t.classList.remove('show'), ms);
}

function log(text, kind = '') {
  const el = document.createElement('div');
  el.className = `entry ${kind}`;
  el.textContent = text;
  $('#log').appendChild(el);
  $('#log').scrollTop = $('#log').scrollHeight;
  return el;
}

function setBusy(on, text = 'Designing…') {
  state.busy = on;
  $('#busy').hidden = !on;
  $('#busy-text').textContent = text;
  $('#generate').disabled = on;
  $('#refine-btn').disabled = on;
  $('#art-director').disabled = on;
}

function save() {
  try { localStorage.setItem(STORE_KEY, JSON.stringify(state.spec)); } catch { /* storage unavailable */ }
}

// ---------------------------------------------------------------- game loading

function applySpec(spec, { record = true } = {}) {
  const { spec: clean, warnings } = normalizeSpec(spec);
  if (record && state.spec) { state.history.push(state.spec); state.future = []; }
  state.spec = clean;
  $('#empty').hidden = true;
  $('#game-title').textContent = clean.title;
  if (state.engine) state.engine.load(structuredClone(clean));
  syncControls();
  renderObjects();
  $('#json').value = JSON.stringify(clean, null, 2);
  $('#undo').disabled = !state.history.length;
  $('#redo').disabled = !state.future.length;
  save();
  if (warnings.length) log(`Adjusted ${warnings.length} value(s) to keep the game playable and fast.`);
  return clean;
}

/** Take a spec the engine already loaded (e.g. the game master's next level) into the Studio. */
function adoptSpec(spec) {
  if (state.spec) { state.history.push(state.spec); state.future = []; }
  state.spec = spec;
  $('#game-title').textContent = spec.title;
  syncControls();
  renderObjects();
  $('#json').value = JSON.stringify(spec, null, 2);
  $('#undo').disabled = !state.history.length;
  $('#redo').disabled = true;
  save();
}

/** Human-readable list of what changed in the look between two specs. */
function lookChanges(a, b) {
  const out = [];
  const num = (label, x, y, digits = 2) => { if (Math.abs(x - y) > 1e-3) out.push(`${label} ${x.toFixed(digits)} → ${y.toFixed(digits)}`); };
  num('time', a.environment.timeOfDay, b.environment.timeOfDay, 1);
  num('clouds', a.environment.cloudCover, b.environment.cloudCover);
  num('fog', a.environment.fogDensity, b.environment.fogDensity);
  num('rain', a.environment.rain, b.environment.rain);
  if (a.environment.skyTint !== b.environment.skyTint) out.push(`sky tint ${b.environment.skyTint}`);
  if (a.environment.particles !== b.environment.particles) out.push(`particles ${b.environment.particles}`);
  for (const k of ['low', 'mid', 'high', 'cliff']) if (a.terrain.palette[k] !== b.terrain.palette[k]) out.push(`${k} ground ${b.terrain.palette[k]}`);
  for (const k of ['bloom', 'exposure', 'saturation', 'contrast', 'warmth', 'vignette']) num(k, a.post[k], b.post[k]);
  const prefabColors = b.prefabs.filter((p) => { const o = a.prefabs.find((q) => q.id === p.id); return o && (o.color !== p.color || o.emissive !== p.emissive); });
  if (prefabColors.length) out.push(`recoloured ${prefabColors.map((p) => p.id).join(', ')}`);
  if (JSON.stringify(a.scatter) !== JSON.stringify(b.scatter)) out.push('reworked the vegetation');
  if (a.audio.music !== b.audio.music) out.push(`music ${b.audio.music}`);
  return out;
}

async function runArtDirector() {
  if (state.busy || !state.spec || !state.engine) return toast('Generate a game first');
  setBusy(true, 'The art director is reviewing your game…');
  log('🎨 Art director: rendering screenshots of your game…');
  let thinking = null;
  try {
    const before = state.spec;
    const r = await artDirect({
      engine: state.engine, intent: state.intent || before.tagline,
      onEvent: (type, data) => {
        if (type === 'status') log(data.message);
        if (type === 'thinking') {
          thinking ??= log('', 'think');
          thinking.textContent += data.text;
          $('#log').scrollTop = $('#log').scrollHeight;
        }
      },
    });
    const shots = log('');
    shots.classList.add('shots');
    for (const img of r.images) {
      const el = document.createElement('img');
      el.src = img.data;
      el.alt = img.label;
      el.title = img.label;
      shots.appendChild(el);
    }
    const changes = lookChanges(before, r.spec);
    if (r.source === 'router') {
      applySpec(r.spec);
      log(`✓ AI polished the look${changes.length ? `: ${changes.slice(0, 8).join(', ')}` : ''}.`, 'ok');
    } else {
      if (changes.length) applySpec(r.spec);
      log(`✓ Offline grading from the screenshots: ${(r.notes ?? []).join(', ')}.`, 'ok');
    }
  } catch (err) {
    log(`The art director could not finish: ${err.message}`, 'err');
  } finally {
    setBusy(false);
  }
}

/** Speech-to-text into a field, then run a callback with the words. */
function bindMic(button, field, onDone) {
  const SR = globalThis.SpeechRecognition || globalThis.webkitSpeechRecognition;
  if (!SR) return;
  button.hidden = false;
  let rec = null;
  button.addEventListener('click', () => {
    if (rec) { rec.stop(); return; }
    rec = new SR();
    rec.lang = navigator.language || 'en-US';
    rec.interimResults = true;
    let final = '';
    const prefix = field.value.trim() ? `${field.value.trim()} ` : '';
    rec.onresult = (e) => {
      let interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        if (e.results[i].isFinal) final += e.results[i][0].transcript;
        else interim += e.results[i][0].transcript;
      }
      field.value = prefix + (final + interim).trim();
    };
    rec.onend = () => { button.classList.remove('listening'); rec = null; if (final.trim()) onDone(field.value); };
    rec.onerror = (e) => { if (e.error === 'not-allowed') toast('Microphone access was blocked'); };
    button.classList.add('listening');
    rec.start();
  });
}

async function generate(prompt, base = null) {
  if (state.busy || !prompt.trim()) return;
  if (!base) state.intent = prompt.trim();
  setBusy(true, base ? 'Reworking your game…' : 'Designing your game…');
  log(base ? `✎ ${prompt}` : `✦ ${prompt}`);
  let thinking = null;
  try {
    const res = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ prompt, spec: base }),
    });
    if (!res.ok || !res.body) throw new Error(`server ${res.status}`);
    const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
    let buffer = '';
    let result = null;
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += value;
      let idx;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const chunk = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        const type = /^event: (.*)$/m.exec(chunk)?.[1];
        const data = JSON.parse(/^data: (.*)$/m.exec(chunk)?.[1] ?? 'null');
        if (type === 'status') log(data.message);
        if (type === 'thinking') {
          thinking ??= log('', 'think');
          thinking.textContent += data.text;
          $('#log').scrollTop = $('#log').scrollHeight;
        }
        if (type === 'progress') $('#busy-text').textContent = `Writing the game… ${Math.round(data.chars / 100) / 10}k chars`;
        if (type === 'spec') result = data;
      }
    }
    if (!result) throw new Error('no design received');
    applySpec(result.spec);
    const who = result.source === 'router' ? `AI${result.model ? ` (${result.model})` : ''}` : 'the offline designer';
    log(`✓ "${result.spec.title}" designed by ${who}.${result.changes ? ` ${capitalize(result.changes.join(', '))}.` : ''}`, 'ok');
  } catch (err) {
    // No server (e.g. static hosting): design locally in the browser.
    if (base) {
      const { spec, changes } = refineSpec(base, prompt);
      applySpec(spec);
      log(`✓ ${capitalize(changes.join(', '))}. (offline designer)`, 'ok');
    } else {
      const spec = applySpec(designFromPrompt(prompt));
      log(`✓ "${spec.title}" designed offline. (${err.message})`, 'ok');
    }
  } finally {
    setBusy(false);
  }
}

function capitalize(s) { return s ? s[0].toUpperCase() + s.slice(1) : s; }

// ---------------------------------------------------------------- world controls

const ENV_CONTROLS = [
  ['time', 'timeOfDay', (v) => `${Math.floor(v)}:${String(Math.round((v % 1) * 60)).padStart(2, '0')}`],
  ['clouds', 'cloudCover', (v) => `${Math.round(v * 100)}%`],
  ['fog', 'fogDensity', (v) => `${Math.round(v * 100)}%`],
  ['wind', 'wind', (v) => `${Math.round(v * 100)}%`],
  ['rain', 'rain', (v) => `${Math.round(v * 100)}%`],
  ['lightning', 'lightning', (v) => `${Math.round(v * 100)}%`],
  ['aurora', 'aurora', (v) => `${Math.round(v * 100)}%`],
];
const POST_CONTROLS = [
  ['bloom', 'bloom', (v) => v.toFixed(2)],
  ['exposure', 'exposure', (v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} EV`],
  ['saturation', 'saturation', (v) => v.toFixed(2)],
  ['contrast', 'contrast', (v) => v.toFixed(2)],
  ['warmth', 'warmth', (v) => v.toFixed(2)],
  ['vignette', 'vignette', (v) => v.toFixed(2)],
];

function syncControls() {
  const s = state.spec;
  if (!s) return;
  for (const [id, key, fmt] of ENV_CONTROLS) { $(`#c-${id}`).value = s.environment[key]; $(`#o-${id}`).textContent = fmt(s.environment[key]); }
  for (const [id, key, fmt] of POST_CONTROLS) { $(`#c-${id}`).value = s.post[key]; $(`#o-${id}`).textContent = fmt(s.post[key]); }
  $('#c-particles').value = s.environment.particles;
  $('#c-sky').value = s.environment.skyTint;
}

function bindControls() {
  let saveTimer = null;
  const commit = () => { clearTimeout(saveTimer); saveTimer = setTimeout(() => { $('#json').value = JSON.stringify(state.spec, null, 2); save(); }, 300); };
  for (const [id, key, fmt] of ENV_CONTROLS) {
    $(`#c-${id}`).addEventListener('input', (e) => {
      if (!state.spec) return;
      const v = Number(e.target.value);
      state.spec.environment[key] = v;
      $(`#o-${id}`).textContent = fmt(v);
      state.engine?.setEnvironment({ [key]: v });
      commit();
    });
  }
  for (const [id, key, fmt] of POST_CONTROLS) {
    $(`#c-${id}`).addEventListener('input', (e) => {
      if (!state.spec) return;
      const v = Number(e.target.value);
      state.spec.post[key] = v;
      $(`#o-${id}`).textContent = fmt(v);
      state.engine?.setGrade({ [key]: v });
      commit();
    });
  }
  $('#c-particles').addEventListener('change', (e) => {
    if (!state.spec) return;
    state.spec.environment.particles = e.target.value;
    state.engine?.setEnvironment({ particles: e.target.value });
    commit();
  });
  $('#c-sky').addEventListener('input', (e) => {
    if (!state.spec) return;
    state.spec.environment.skyTint = e.target.value;
    state.engine?.setEnvironment({ skyTint: e.target.value });
    commit();
  });
}

// ---------------------------------------------------------------- objects tab

function describe(p) {
  const kinds = p.behaviors.map((b) => b.type).filter((t) => !['spin', 'bob', 'light'].includes(t));
  const role = kinds.length ? kinds.join(', ') : p.solid ? 'solid' : 'decoration';
  return `${p.shape} · ${role}`;
}

function renderObjects() {
  const root = $('#objects');
  root.innerHTML = '';
  if (!state.spec?.prefabs.length) { root.innerHTML = '<p class="hint">This game has no objects yet.</p>'; return; }
  let rebuild = null;
  for (const p of state.spec.prefabs) {
    const el = document.createElement('div');
    el.className = 'obj';
    el.innerHTML = `
      <input type="color" value="${p.color}" aria-label="Colour of ${p.id}">
      <div><div class="name"></div></div>
      <div class="meta"></div>
      <label class="glow">Glow <input type="range" min="0" max="8" step="0.1" value="${p.emissive}"></label>`;
    el.querySelector('.name').textContent = p.id.replace(/_/g, ' ');
    el.querySelector('.meta').textContent = describe(p);
    const schedule = () => {
      clearTimeout(rebuild);
      rebuild = setTimeout(() => applySpec(structuredClone(state.spec)), 350);
    };
    el.querySelector('input[type=color]').addEventListener('input', (e) => { p.color = e.target.value; schedule(); });
    el.querySelector('input[type=range]').addEventListener('input', (e) => { p.emissive = Number(e.target.value); schedule(); });
    root.appendChild(el);
  }
}

// ---------------------------------------------------------------- boot

async function boot() {
  $('#ideas').append(...IDEAS.map(([label, idea]) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = label;
    b.title = idea;
    b.addEventListener('click', () => { $('#prompt').value = idea; generate(idea); });
    return b;
  }));
  $('#tweaks').append(...TWEAKS.map((t) => {
    const b = document.createElement('button');
    b.className = 'chip';
    b.textContent = t;
    b.addEventListener('click', () => state.spec ? generate(t, state.spec) : toast('Generate a game first'));
    return b;
  }));

  $('#generate').addEventListener('click', () => generate($('#prompt').value));
  $('#prompt').addEventListener('keydown', (e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) generate($('#prompt').value); });
  $('#refine-form').addEventListener('submit', (e) => {
    e.preventDefault();
    const text = $('#refine').value;
    if (!state.spec) return toast('Generate a game first');
    $('#refine').value = '';
    generate(text, state.spec);
  });
  $('#art-director').addEventListener('click', runArtDirector);
  bindMic($('#mic-prompt'), $('#prompt'), (text) => generate(text));
  bindMic($('#mic-refine'), $('#refine'), (text) => { if (state.spec) { $('#refine').value = ''; generate(text, state.spec); } });
  $('#play').addEventListener('click', () => state.engine?.play());
  $('#stop').addEventListener('click', () => state.engine?.stop());
  $('#undo').addEventListener('click', undo);
  $('#redo').addEventListener('click', redo);
  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  });
  for (const tab of document.querySelectorAll('.tab')) {
    tab.addEventListener('click', () => {
      for (const t of document.querySelectorAll('.tab')) t.classList.toggle('active', t === tab);
      for (const b of document.querySelectorAll('.tab-body')) b.hidden = b.dataset.body !== tab.dataset.tab;
    });
  }
  $('#apply-json').addEventListener('click', () => {
    try {
      applySpec(JSON.parse($('#json').value));
      $('#json-status').textContent = 'Applied ✓';
    } catch (e) {
      $('#json-status').textContent = `Invalid JSON: ${e.message}`;
    }
  });
  $('#share').addEventListener('click', share);
  $('#export').addEventListener('click', () => {
    if (!state.spec) return toast('Nothing to export yet');
    const blob = new Blob([JSON.stringify(state.spec, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${state.spec.title.toLowerCase().replace(/[^a-z0-9]+/g, '-')}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#import').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    try { applySpec(JSON.parse(await file.text())); toast(`Loaded ${file.name}`); } catch (err) { toast(`Could not read that file: ${err.message}`); }
    e.target.value = '';
  });
  const quality = localStorage.getItem('reverie.quality') ?? 'auto';
  $('#quality').value = quality;
  $('#quality').addEventListener('change', (e) => { localStorage.setItem('reverie.quality', e.target.value); location.reload(); });
  $('#mute').addEventListener('click', () => {
    const a = state.engine?.audio;
    if (!a) return;
    a.setMuted(!a.muted);
    $('#mute').textContent = a.muted ? '🔇' : '🔊';
  });
  $('#fullscreen').addEventListener('click', () => $('#viewport').requestFullscreen?.());
  bindControls();

  fetch('/api/status').then((r) => r.json()).then((s) => {
    state.aiMode = s.ai;
    $('#ai-badge').textContent = s.ai === 'router' ? `🟢 AI Designer — ${s.model}` : '🟡 Offline Fallback';
    $('#ai-badge').classList.toggle('offline', s.ai === 'offline');
    if (s.ai === 'offline') log('Running with the built-in offline designer. Configure GROQ_API_KEY, OPENROUTER_API_KEY, or LOCAL_AI_URL to use the AI Designer.');
  }).catch(() => {
    $('#ai-badge').textContent = '🟡 Offline Fallback';
    $('#ai-badge').classList.add('offline');
  });

  try {
    state.engine = await Engine.create($('#viewport'), { tier: quality });
    state.engine.start();
    window.__reverie = state.engine; // handy for the console and automated checks
    state.engine.on('level', ({ spec, source, level, notes }) => {
      adoptSpec(spec);
      log(`✦ Level ${level}: "${spec.title}", designed by ${source === 'router' ? 'the AI game master' : 'the offline game master'}${notes?.length ? ` (${notes.join('; ')})` : ''}.`, 'ok');
    });
    let n = 0;
    state.engine.on('frame', (s) => {
      if (++n % 20) return;
      $('#stats').textContent = `${state.engine.tier} · ${s.internal.join('×')}→${s.output.join('×')} · ${s.fps.toFixed(0)} fps`;
    });
  } catch (err) {
    $('#empty').querySelector('h1').textContent = "This browser can't run the engine";
    $('#empty').querySelector('p').textContent = `${err.message} You can still design games and export them.`;
  }

  // restore: shared link > last session > nothing
  const hash = new URLSearchParams(location.hash.slice(1)).get('g');
  let initial = null;
  if (hash) { try { initial = await decodeSpec(hash); } catch { toast('That share link looks broken'); } }
  if (!initial) { try { initial = JSON.parse(localStorage.getItem(STORE_KEY) ?? 'null'); } catch { initial = null; } }
  if (!initial) {
    // first visit: open a showcase world so there is something to explore right away
    try { initial = await (await fetch('../examples/golden-grove.json')).json(); } catch { initial = null; }
    if (initial) log('Welcome! This is an example world. Press Play to explore it, or describe your own game above.');
  }
  if (initial) applySpec(initial, { record: false });
  $('#prompt').focus();
}

function undo() {
  if (!state.history.length) return;
  state.future.push(state.spec);
  applySpec(state.history.pop(), { record: false });
}
function redo() {
  if (!state.future.length) return;
  state.history.push(state.spec);
  applySpec(state.future.pop(), { record: false });
}

async function share() {
  if (!state.spec) return toast('Generate a game first');
  const packed = await encodeSpec(state.spec);
  const url = new URL(`../play/#g=${packed}`, location.href).href;
  try {
    await navigator.clipboard.writeText(url);
    toast('Link copied: anyone can play it in their browser');
  } catch {
    prompt('Copy this link:', url);
  }
}

boot();

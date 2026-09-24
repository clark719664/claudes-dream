// Reverie dev server: serves the Studio and engine, and streams AI game
// generation over Server-Sent Events. Zero configuration: without an
// Anthropic API key it falls back to the offline designer.
//
//   ANTHROPIC_API_KEY=... npm start      ->  http://localhost:5173

import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateWithClaude, hasCredentials, MODEL } from './claude.js';
import { designFromPrompt, refineSpec } from '../shared/designer.js';
import { normalizeSpec } from '../shared/spec.js';
import { talkToCharacter } from './npc.js';
import { offlineReply } from '../shared/npc.js';
import { artDirect, nextLevel } from './director.js';
import { planNextLevel } from '../shared/gamemaster.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC_DIRS = ['studio', 'engine', 'shared', 'play', 'examples', 'docs', 'tools'];
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.md': 'text/markdown; charset=utf-8', '.ico': 'image/x-icon',
};
const MAX_BODY = 512 * 1024;

function send(res, status, body, type = 'application/json; charset=utf-8') {
  res.writeHead(status, { 'content-type': type, 'cache-control': 'no-store' });
  res.end(typeof body === 'string' ? body : JSON.stringify(body));
}

function serveStatic(req, res, pathname) {
  if (pathname === '/' || pathname === '/studio') {
    res.writeHead(302, { location: '/studio/' });
    return res.end();
  }
  if (pathname === '/play') {
    res.writeHead(302, { location: '/play/' });
    return res.end();
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const top = pathname.split('/')[1];
  if (!PUBLIC_DIRS.includes(top)) return send(res, 404, { error: 'Not found' });
  const file = path.normalize(path.join(ROOT, decodeURIComponent(pathname)));
  if (!file.startsWith(ROOT + path.sep)) return send(res, 403, { error: 'Forbidden' });
  fs.stat(file, (err, st) => {
    if (err || !st.isFile()) return send(res, 404, { error: 'Not found' });
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
    fs.createReadStream(file).pipe(res);
  });
}

function readJSON(req, limit = MAX_BODY) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) { reject(new Error('Request too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); } catch { reject(new Error('Invalid JSON')); }
    });
    req.on('error', reject);
  });
}

/** POST /api/generate { prompt, spec? }  ->  text/event-stream */
async function generate(req, res) {
  let body;
  try { body = await readJSON(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const prompt = typeof body.prompt === 'string' ? body.prompt.trim().slice(0, 2000) : '';
  if (!prompt) return send(res, 400, { error: 'Describe the game you want.' });
  const baseSpec = body.spec ? normalizeSpec(body.spec).spec : null;

  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  res.on('close', () => controller.abort());

  const offline = () => {
    if (baseSpec) {
      const { spec, changes } = refineSpec(baseSpec, prompt);
      event('spec', { spec, warnings: [], source: 'offline', changes });
    } else {
      event('spec', { spec: designFromPrompt(prompt), warnings: [], source: 'offline' });
    }
  };

  if (!hasCredentials() || body.offline) {
    offline();
    return res.end();
  }
  try {
    const result = await generateWithClaude({ prompt, baseSpec, onEvent: event, signal: controller.signal });
    event('spec', { ...result, source: 'claude' });
  } catch (err) {
    if (controller.signal.aborted) return res.end();
    console.error('[generate]', err?.status ?? '', err?.message ?? err);
    event('status', { message: `Claude is unavailable (${friendly(err)}). Using the offline designer instead.` });
    offline();
  }
  res.end();
}

/**
 * POST /api/npc { character, world: { title, summary, objective, hasGoal }, history, message }
 *   ->  text/event-stream of 'text' deltas, 'action' tool calls and 'done'
 */
async function npc(req, res) {
  let body;
  try { body = await readJSON(req); } catch (e) { return send(res, 400, { error: e.message }); }
  const message = typeof body.message === 'string' ? body.message.trim().slice(0, 600) : '';
  if (!message) return send(res, 400, { error: 'Say something.' });
  // the character comes from the player's own game spec: sanitize it like any spec field
  const character = normalizeSpec({ characters: [body.character ?? {}] }).spec.characters[0];
  const w = body.world ?? {};
  const world = {
    title: String(w.title ?? 'Untitled').slice(0, 80),
    summary: String(w.summary ?? '').slice(0, 4000),
    objective: String(w.objective ?? '').slice(0, 200),
    hasGoal: !!w.hasGoal,
  };
  const history = Array.isArray(body.history) ? body.history.slice(-16) : [];

  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const offline = () => {
    const reply = offlineReply(character, world, message, history);
    event('text', { text: reply.text });
    for (const a of reply.actions) event('action', a);
    event('done', { source: 'offline' });
  };
  if (!hasCredentials() || body.offline) {
    offline();
    return res.end();
  }
  let spoke = false;
  try {
    await talkToCharacter({
      character, world, history, message, signal: controller.signal,
      onEvent: (type, data) => { if (type === 'text') spoke = true; event(type, data); },
    });
    event('done', { source: 'claude' });
  } catch (err) {
    if (controller.signal.aborted) return res.end();
    console.error('[npc]', err?.status ?? '', err?.message ?? err);
    if (!spoke) offline();
    else event('done', { source: 'claude', error: friendly(err) });
  }
  res.end();
}

/**
 * Shared shape of the spec-producing AI endpoints: stream status/thinking,
 * then a 'spec' event from Claude, or from the offline fallback.
 */
async function specEndpoint(req, res, { limit, prepare, claude, offline }) {
  let body;
  try { body = await readJSON(req, limit); } catch (e) { return send(res, 400, { error: e.message }); }
  let input;
  try { input = prepare(body); } catch (e) { return send(res, 400, { error: e.message }); }
  res.writeHead(200, { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive' });
  const event = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
  const controller = new AbortController();
  res.on('close', () => controller.abort());
  const fallback = () => event('spec', { ...offline(input), warnings: [], source: 'offline' });
  if (!hasCredentials() || body.offline) { fallback(); return res.end(); }
  try {
    const result = await claude(input, event, controller.signal);
    event('spec', { ...result, source: 'claude' });
  } catch (err) {
    if (controller.signal.aborted) return res.end();
    console.error('[ai]', err?.status ?? '', err?.message ?? err);
    event('status', { message: `Claude is unavailable (${friendly(err)}). Using the offline version instead.` });
    fallback();
  }
  res.end();
}

/** POST /api/art-director { spec, images: [{ label, data: dataURL }], intent, stats } */
const artDirector = (req, res) => specEndpoint(req, res, {
  limit: 8 * 1024 * 1024,
  prepare: (b) => ({ spec: normalizeSpec(b.spec ?? {}).spec, images: b.images ?? [], intent: String(b.intent ?? '').slice(0, 600), stats: b.stats ?? null }),
  claude: ({ spec, images, intent }, onEvent, signal) => artDirect({ spec, images, intent, onEvent, signal }),
  // the browser grades from pixel statistics itself; offline, the look is left as it is
  offline: ({ spec }) => ({ spec, notes: ['Claude is offline: graded from screenshot statistics in the browser'] }),
});

/** POST /api/next-level { spec, telemetry } */
const nextLevelEndpoint = (req, res) => specEndpoint(req, res, {
  prepare: (b) => ({ spec: normalizeSpec(b.spec ?? {}).spec, telemetry: typeof b.telemetry === 'object' && b.telemetry ? b.telemetry : {} }),
  claude: ({ spec, telemetry }, onEvent, signal) => nextLevel({ spec, telemetry, onEvent, signal }),
  offline: ({ spec, telemetry }) => planNextLevel(spec, telemetry),
});

function friendly(err) {
  const status = err?.status;
  if (status === 401) return 'invalid API key';
  if (status === 429) return 'rate limited';
  if (status === 529 || status >= 500) return 'service busy';
  return err?.message?.slice(0, 120) ?? 'error';
}

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/api/status' && req.method === 'GET') {
      return send(res, 200, { ai: hasCredentials() ? 'claude' : 'offline', model: hasCredentials() ? MODEL : null });
    }
    if (url.pathname === '/api/generate' && req.method === 'POST') return void generate(req, res);
    if (url.pathname === '/api/npc' && req.method === 'POST') return void npc(req, res);
    if (url.pathname === '/api/art-director' && req.method === 'POST') return void artDirector(req, res);
    if (url.pathname === '/api/next-level' && req.method === 'POST') return void nextLevelEndpoint(req, res);
    if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'Method not allowed' });
    return serveStatic(req, res, url.pathname);
  });
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = Number(process.env.PORT) || 5173;
  createServer().listen(port, () => {
    const mode = hasCredentials() ? `Claude (${MODEL})` : 'offline designer (set ANTHROPIC_API_KEY to use Claude)';
    console.log(`\n  Reverie Studio  →  http://localhost:${port}\n  AI designer     →  ${mode}\n`);
  });
}

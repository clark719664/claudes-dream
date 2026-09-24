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

function readJSON(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new Error('Request too large')); req.destroy(); return; }
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

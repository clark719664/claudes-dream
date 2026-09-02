/**
 * VaporDep API — Cloudflare Worker entry point.
 *
 * Routes
 *   GET  /                 service description + endpoint list
 *   GET  /v1/health        { ok: true }
 *   GET  /v1/check?name=&ecosystem=
 *   POST /v1/batch         { "packages": [{ "name", "ecosystem" }] }
 *
 * Every error is JSON `{ "error": { "code", "message" } }` with a matching
 * status. CORS is wide open (GET/POST/OPTIONS from any origin).
 *
 * The module uses only web-standard APIs (Request/Response/URL/TextDecoder) so
 * it runs unchanged on Cloudflare Workers and plain Node >= 18.
 *
 * Test hooks (read from `env`, harmless in production):
 *   env.__fetchImpl  — fetch-compatible function used for registry lookups
 *   env.__topLists   — replaces data/top-lists.mjs
 * Config:
 *   env.API_KEYS, env.RAPIDAPI_PROXY_SECRET — see tiers.js
 *   env.DOCS_URL — link advertised on GET /
 */

import { createRegistryClient } from './registries.js';
import { ECOSYSTEMS, checkPackage } from './check.js';
import { resolveTier, TIERS } from './tiers.js';

const VERSION = '0.1.0';
const MAX_BODY_BYTES = 100 * 1024;
// Kept low on purpose: each in-flight lookup may buffer up to
// MAX_UPSTREAM_BYTES (registries.js) of registry JSON.
const BATCH_CONCURRENCY = 4;
const CHECK_CACHE_CONTROL = 'public, max-age=300';
const DEFAULT_DOCS_URL = 'https://github.com/clark719664/claudes-dream#readme';

const CORS_HEADERS = Object.freeze({
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-allow-headers': 'Content-Type, X-Api-Key, X-RapidAPI-Proxy-Secret, X-RapidAPI-Key, X-RapidAPI-Host',
  'access-control-max-age': '86400',
});

class HttpError extends Error {
  constructor(status, code, message, headers = {}) {
    super(message);
    this.status = status;
    this.code = code;
    this.headers = headers;
  }
}

function json(body, { status = 200, headers = {} } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', ...CORS_HEADERS, ...headers },
  });
}

function errorResponse(status, code, message, headers = {}) {
  return json({ error: { code, message } }, { status, headers: { 'cache-control': 'no-store', ...headers } });
}

// The top lists are loaded lazily so a missing data file only fails requests
// that need it (and tests can inject env.__topLists without touching disk).
// Bundlers inline the static path, so this costs nothing on Workers.
let topListsPromise = null;
function getTopLists(env) {
  if (env.__topLists) return Promise.resolve(env.__topLists);
  topListsPromise ??= import('../data/top-lists.mjs')
    .then((mod) => mod.default)
    .catch((err) => {
      topListsPromise = null; // allow a retry on the next request
      throw err;
    });
  return topListsPromise;
}

function normalizeEcosystem(value) {
  if (typeof value !== 'string') return null;
  const eco = value.trim().toLowerCase();
  return ECOSYSTEMS.includes(eco) ? eco : null;
}

function ecosystemList() {
  return ECOSYSTEMS.join(', ');
}

/** Read the request body as text, refusing anything over MAX_BODY_BYTES. */
async function readBodyText(request) {
  const tooLarge = () =>
    new HttpError(413, 'PAYLOAD_TOO_LARGE', `Request body must be at most ${MAX_BODY_BYTES} bytes`);

  const declared = Number(request.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) throw tooLarge();
  if (!request.body) return '';

  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel().catch(() => {});
      throw tooLarge();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Run `fn` over `items` with at most `limit` in flight; stops early on failure. */
async function mapLimit(items, limit, fn) {
  const results = new Array(items.length);
  let next = 0;
  let failure = null;

  async function runner() {
    while (next < items.length && failure === null) {
      const i = next++;
      try {
        results[i] = await fn(items[i], i);
      } catch (err) {
        failure ??= err;
        return;
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, runner));
  if (failure !== null) throw failure;
  return results;
}

function indexDocument(env) {
  return {
    name: 'vapordep',
    version: VERSION,
    description:
      'Dependency hallucination firewall: verifies that package names actually exist on their registry and scores their slopsquatting/typosquatting risk.',
    docs: typeof env.DOCS_URL === 'string' && env.DOCS_URL ? env.DOCS_URL : DEFAULT_DOCS_URL,
    ecosystems: [...ECOSYSTEMS],
    tiers: {
      free: { batchLimit: TIERS.free.batchLimit },
      pro: { batchLimit: TIERS.pro.batchLimit, auth: 'x-api-key header, or subscribe via RapidAPI' },
    },
    endpoints: [
      { method: 'GET', path: '/v1/health', description: 'Liveness probe; returns { ok: true }.' },
      {
        method: 'GET',
        path: '/v1/check',
        query: { name: 'package name', ecosystem: ecosystemList() },
        description: 'Verify one package and return its verdict.',
      },
      {
        method: 'POST',
        path: '/v1/batch',
        body: { packages: [{ name: 'package name', ecosystem: ecosystemList() }] },
        description: 'Verify many packages at once; returns { results: [verdict...], tier }.',
      },
    ],
  };
}

async function handleCheck(url, env) {
  const name = url.searchParams.get('name');
  const rawEcosystem = url.searchParams.get('ecosystem');
  if (!name) throw new HttpError(400, 'MISSING_NAME', 'Query parameter "name" is required');
  if (!rawEcosystem) {
    throw new HttpError(400, 'MISSING_ECOSYSTEM', `Query parameter "ecosystem" is required (one of: ${ecosystemList()})`);
  }
  const ecosystem = normalizeEcosystem(rawEcosystem);
  if (!ecosystem) {
    throw new HttpError(400, 'INVALID_ECOSYSTEM', `Unknown ecosystem "${rawEcosystem}"; expected one of: ${ecosystemList()}`);
  }

  const verdict = await checkPackage({
    name,
    ecosystem,
    client: createRegistryClient(env.__fetchImpl ?? undefined),
    topLists: await getTopLists(env),
  });
  return json(verdict, { headers: { 'cache-control': CHECK_CACHE_CONTROL } });
}

async function handleBatch(request, env) {
  const text = await readBodyText(request);
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    throw new HttpError(400, 'INVALID_JSON', 'Request body must be valid JSON');
  }
  if (!body || typeof body !== 'object' || !Array.isArray(body.packages)) {
    throw new HttpError(400, 'BAD_REQUEST', 'Body must be {"packages":[{"name":"...","ecosystem":"..."}]}');
  }
  if (body.packages.length === 0) {
    throw new HttpError(400, 'BAD_REQUEST', '"packages" must contain at least one entry');
  }

  const { tier, batchLimit } = resolveTier(request, env);
  if (body.packages.length > batchLimit) {
    const hint =
      tier === 'free'
        ? ` Send an x-api-key header (or subscribe via RapidAPI) for the pro tier limit of ${TIERS.pro.batchLimit}.`
        : '';
    throw new HttpError(
      402,
      'BATCH_LIMIT',
      `Batch of ${body.packages.length} packages exceeds the ${tier} tier limit of ${batchLimit}.${hint}`,
    );
  }

  const packages = body.packages.map((entry, i) => {
    if (!entry || typeof entry !== 'object') {
      throw new HttpError(400, 'BAD_REQUEST', `packages[${i}] must be an object with "name" and "ecosystem"`);
    }
    if (typeof entry.name !== 'string' || entry.name.length === 0) {
      throw new HttpError(400, 'BAD_REQUEST', `packages[${i}].name must be a non-empty string`);
    }
    const ecosystem = normalizeEcosystem(entry.ecosystem);
    if (!ecosystem) {
      throw new HttpError(400, 'INVALID_ECOSYSTEM', `packages[${i}].ecosystem must be one of: ${ecosystemList()}`);
    }
    return { name: entry.name, ecosystem };
  });

  const client = createRegistryClient(env.__fetchImpl ?? undefined);
  const topLists = await getTopLists(env);
  const memo = new Map(); // identical entries in one batch share a single lookup
  const results = await mapLimit(packages, BATCH_CONCURRENCY, ({ name, ecosystem }) => {
    const key = `${ecosystem} ${name}`;
    if (!memo.has(key)) memo.set(key, checkPackage({ name, ecosystem, client, topLists }));
    return memo.get(key);
  });

  return json({ results, tier }, { headers: { 'cache-control': 'no-store' } });
}

function requireMethod(request, allowed) {
  if (request.method === allowed) return;
  throw new HttpError(405, 'METHOD_NOT_ALLOWED', `Use ${allowed} for this route`, { allow: `${allowed}, OPTIONS` });
}

async function route(request, env) {
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, '') || '/';

  if (request.method === 'OPTIONS') {
    const requested = request.headers.get('access-control-request-headers');
    return new Response(null, {
      status: 204,
      headers: requested ? { ...CORS_HEADERS, 'access-control-allow-headers': requested } : CORS_HEADERS,
    });
  }

  switch (path) {
    case '/':
      requireMethod(request, 'GET');
      return json(indexDocument(env), { headers: { 'cache-control': 'public, max-age=3600' } });
    case '/v1/health':
      requireMethod(request, 'GET');
      return json({ ok: true }, { headers: { 'cache-control': 'no-store' } });
    case '/v1/check':
      requireMethod(request, 'GET');
      return handleCheck(url, env);
    case '/v1/batch':
      requireMethod(request, 'POST');
      return handleBatch(request, env);
    default:
      throw new HttpError(404, 'NOT_FOUND', `No route for ${request.method} ${path}`);
  }
}

export default {
  async fetch(request, env, ctx) {
    void ctx;
    try {
      return await route(request, env ?? {});
    } catch (err) {
      if (err instanceof HttpError) return errorResponse(err.status, err.code, err.message, err.headers);
      if (err?.code === 'UPSTREAM') return errorResponse(502, 'UPSTREAM', err.message);
      console.error('vapordep: unexpected error', err);
      return errorResponse(500, 'INTERNAL', 'Unexpected internal error');
    }
  },
};

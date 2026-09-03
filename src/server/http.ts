/**
 * Small HTTP helpers for the Reverie server: JSON responses with CORS, a
 * bounded JSON body reader, Bearer token extraction and a static file server
 * that cannot be walked out of its root. Only node builtins.
 */
import type { IncomingMessage, ServerResponse } from 'node:http';
import * as fs from 'node:fs';
import * as path from 'node:path';

/** Request bodies above this size are refused with 413. */
export const MAX_BODY_BYTES = 64 * 1024;

const CORS_HEADERS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '600',
};

const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
};

/** An error that already knows its HTTP status and JSON body. */
export class HttpError extends Error {
  status: number;
  body: Record<string, unknown>;

  constructor(status: number, body: Record<string, unknown> | string) {
    const obj = typeof body === 'string' ? { error: body } : body;
    super(String(obj.error ?? status));
    this.status = status;
    this.body = obj;
  }
}

export function setCors(res: ServerResponse): void {
  for (const [k, v] of Object.entries(CORS_HEADERS)) res.setHeader(k, v);
}

export function sendJson(res: ServerResponse, status: number, body: unknown): void {
  if (res.writableEnded || res.destroyed) return;
  const text = JSON.stringify(body);
  setCors(res);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  if (status === 413) res.setHeader('Connection', 'close');
  res.writeHead(status);
  res.end(text);
}

export function sendError(res: ServerResponse, status: number, error: string, extra: Record<string, unknown> = {}): void {
  sendJson(res, status, { error, ...extra });
}

/** Send an HttpError or a generic 500 for anything else. */
export function sendFailure(res: ServerResponse, e: unknown, log: (msg: string) => void): void {
  if (e instanceof HttpError) {
    sendJson(res, e.status, e.body);
    return;
  }
  log(`[reverie] request failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
  sendError(res, 500, 'internal error');
}

/**
 * Read and parse a JSON request body. An empty body parses as {}. Rejects
 * with HttpError 413 when the body exceeds MAX_BODY_BYTES (the request is
 * paused so no more of it is read) and 400 when it is not valid JSON.
 */
export function readJson(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (fn: () => void) => {
      if (settled) return;
      settled = true;
      fn();
    };
    req.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        req.pause();
        finish(() => reject(new HttpError(413, { error: 'payload too large', limit: MAX_BODY_BYTES })));
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => finish(() => {
      const text = Buffer.concat(chunks).toString('utf8').trim();
      if (!text) { resolve({}); return; }
      try {
        resolve(JSON.parse(text));
      } catch {
        reject(new HttpError(400, 'invalid JSON body'));
      }
    }));
    req.on('error', () => finish(() => reject(new HttpError(400, 'request error'))));
    req.on('aborted', () => finish(() => reject(new HttpError(400, 'request aborted'))));
  });
}

/** True when the parsed body is a plain object. */
export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

/** The token from `Authorization: Bearer <token>`, or null. */
export function bearerToken(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (!header) return null;
  const m = /^\s*Bearer\s+(\S+)\s*$/i.exec(header);
  return m ? m[1] : null;
}

/**
 * Map a URL path to a file under `root`, or null when the path is not a
 * plain relative file path (dot segments, odd characters, escapes from the
 * root). `/` maps to index.html.
 */
export function resolveStatic(root: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  if (decoded === '/' || decoded === '') decoded = '/index.html';
  const segments = decoded.split(/[\\/]+/).filter((s) => s.length > 0);
  if (segments.length === 0) return null;
  for (const s of segments) {
    if (s === '.' || s === '..' || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(s)) return null;
  }
  const rootAbs = path.resolve(root);
  const full = path.resolve(rootAbs, ...segments);
  const rel = path.relative(rootAbs, full);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return null;
  return full;
}

/** Serve a static file; resolves false (nothing sent) when there is no such file. */
export async function serveStatic(res: ServerResponse, root: string, urlPath: string, headOnly = false): Promise<boolean> {
  const file = resolveStatic(root, urlPath);
  if (!file) return false;
  let data: Buffer;
  try {
    const st = await fs.promises.stat(file);
    if (!st.isFile()) return false;
    data = await fs.promises.readFile(file);
  } catch {
    return false;
  }
  const type = CONTENT_TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream';
  setCors(res);
  res.setHeader('Content-Type', type);
  res.setHeader('Content-Length', String(data.length));
  res.setHeader('Cache-Control', 'no-cache');
  res.writeHead(200);
  res.end(headOnly ? undefined : data);
  return true;
}

/** One Server-Sent Events frame. JSON never contains raw newlines, so a single data line suffices. */
export function sseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

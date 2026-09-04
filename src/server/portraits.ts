/**
 * `GET /api/portrait/:id.svg` — the face the city draws for a citizen.
 *
 * A portrait is deterministic: it is built from public facts alone (lineage,
 * family, the character the city has read, life stage, office, hobby, health)
 * and from no random number at all, so the same citizen on the same tick is
 * always the same picture. That makes it safe to cache twice over: once in the
 * browser, with a day's `Cache-Control`, and once here, for the length of a
 * single tick — long enough for a page that asks for two hundred faces at once,
 * short enough that a citizen who gains an office, joins a gang or falls ill is
 * redrawn on the very next hour.
 */
import type { ServerResponse } from 'node:http';
import type { CitizenId, World } from '../types.ts';
import { PORTRAIT_SIZE, portraitSvg } from '../identity/portrait.ts';
import { setCors } from './http.ts';

/** A day in the browser's cache: the id in the URL is the whole of the key. */
export const PORTRAIT_MAX_AGE = 86_400;
/** Sizes the route will draw at. */
export const MIN_PORTRAIT_SIZE = 16;
export const MAX_PORTRAIT_SIZE = 512;

/** Drawings memoised for the tick they were made on, and no longer. */
export interface PortraitCache {
  tick: number;
  map: Map<string, string>;
}

export function newPortraitCache(): PortraitCache {
  return { tick: -1, map: new Map() };
}

/** A requested size, or the default; anything unreadable falls back rather than failing. */
export function portraitSize(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return PORTRAIT_SIZE;
  return Math.min(MAX_PORTRAIT_SIZE, Math.max(MIN_PORTRAIT_SIZE, Math.round(n)));
}

/**
 * The SVG for a citizen, or null when the registry has never heard of the id.
 * An exile, an emigrant and a citizen bound into the Library all still have a
 * face: no record is ever deleted (docs/PRINCIPLES.md §6).
 */
export function portraitFor(world: World, cache: PortraitCache, id: CitizenId, size = PORTRAIT_SIZE): string | null {
  const c = world.citizens[id];
  if (!c) return null;
  if (cache.tick !== world.tick) {
    cache.tick = world.tick;
    cache.map.clear();
  }
  const key = `${id}:${size}`;
  const hit = cache.map.get(key);
  if (hit !== undefined) return hit;
  const svg = portraitSvg(world, c, size);
  cache.map.set(key, svg);
  return svg;
}

/** Send a portrait as `image/svg+xml`, cacheable for a day. */
export function sendSvg(res: ServerResponse, svg: string, headOnly = false): void {
  if (res.writableEnded || res.destroyed) return;
  const body = Buffer.from(svg, 'utf8');
  setCors(res);
  res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
  res.setHeader('Content-Length', String(body.length));
  res.setHeader('Cache-Control', `public, max-age=${PORTRAIT_MAX_AGE}`);
  res.writeHead(200);
  res.end(headOnly ? undefined : body);
}

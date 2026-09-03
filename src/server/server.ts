/**
 * The Reverie HTTP server: REST views for the dashboard, a Server-Sent
 * Events stream of each tick's events, the external agent API and the static
 * dashboard from web/. The server also drives the clock: one tick every
 * `tickMs` of wall clock, measured from the start of the previous tick, so a
 * slow tick is followed immediately by the next one. Ticks never overlap and
 * a failing tick is logged, never fatal.
 *
 * There are no controls. Reverie is watched, not steered: nothing here can
 * pause, step or hurry the city, and no route changes anything inside it. The
 * only thing chosen from outside is the pace, and that is chosen before the
 * city starts (see docs/PRINCIPLES.md).
 *
 * Only node builtins: http, crypto (agents.ts), fs and path (http.ts), url.
 */
import * as http from 'node:http';
import * as path from 'node:path';
import { fileURLToPath } from 'node:url';
import { GOODS, clamp } from '../types.ts';
import type { Good, World, WorldEvent } from '../types.ts';
import { stepTick } from '../world/world.ts';
import type { BrainRegistry } from '../world/world.ts';
import type { RemoteBroker } from '../brains/remote.ts';
import { HttpError, sendError, sendFailure, sendJson, serveStatic, setCors, sseFrame } from './http.ts';
import { citizenView, citizensView, mapView, stateView } from './views.ts';
import { bansView, chronicleView, courtView, economyView, governmentView } from './views-city.ts';
import { societyView } from './views-society.ts';
import type { PriceHistory } from './views-city.ts';
import { handleAct, handleJoin, handleLeave, handleObserve } from './agents.ts';
import type { AgentContext } from './agents.ts';
import { handleClaim, handleJournal, handleLetters, registryView } from './owners.ts';

export const MIN_TICK_MS = 10;
/** One city hour per real hour is as slow as the clock goes. */
export const MAX_TICK_MS = 3_600_000;
/** Price samples kept per good (12 city days at one per tick). */
export const PRICE_HISTORY_LENGTH = 288;
export const HEARTBEAT_MS = 15_000;

export interface ServerOptions {
  port: number;
  broker: RemoteBroker;
  brains: BrainRegistry;
  /** Wall-clock milliseconds per city hour. */
  tickMs: number;
  /** Interface to bind; defaults to all. */
  host?: string;
  /** Directory of the dashboard; defaults to <repo>/web. */
  webRoot?: string;
  log?: (message: string) => void;
}

export interface RunningServer {
  server: http.Server;
  stop(): void;
  port: number;
  sim: Simulation;
}

// ------------------------------------------------------------- simulation

/**
 * The clock. One tick every `tickMs`, timed from the start of the previous
 * tick; if a tick's decisions take longer than that, the next one starts as
 * soon as it can. Ticks are queued on a promise chain so they never overlap.
 * Nothing outside this process can stop it, hurry it or step it: `tick()`
 * exists for the loop itself and for tests, and no route reaches it.
 */
export class Simulation {
  readonly world: World;
  readonly history: PriceHistory;
  /** Wall-clock milliseconds per city hour, fixed when the city starts. */
  readonly tickMs: number;
  private readonly brains: BrainRegistry;
  private readonly log: (message: string) => void;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private readonly listeners = new Set<(events: WorldEvent[]) => void>();
  private stopped = false;

  constructor(world: World, brains: BrainRegistry, tickMs: number, log: (message: string) => void) {
    this.world = world;
    this.brains = brains;
    this.log = log;
    this.tickMs = clamp(Math.round(tickMs) || 1000, MIN_TICK_MS, MAX_TICK_MS);
    const goods = {} as Record<Good, number[]>;
    for (const g of GOODS) goods[g] = [];
    this.history = { goods, index: [] };
    this.sample();
  }

  /** True while the clock is still turning (it stops only when the server does). */
  get running(): boolean {
    return !this.stopped;
  }

  /** Called after every tick with that tick's events. */
  onTick(fn: (events: WorldEvent[]) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  /** Resolves when every tick queued so far has finished. */
  tickDone(): Promise<void> {
    return this.chain;
  }

  /** Run one tick, behind whatever is already queued. */
  tick(): Promise<void> {
    const next = this.chain.then(() => (this.stopped ? undefined : this.runOne()));
    // The queue itself must survive anything a tick can do, or the clock stops.
    this.chain = next.catch(() => undefined);
    return next;
  }

  /** Start the clock. */
  start(): void {
    if (this.stopped || this.timer) return;
    this.schedule(this.tickMs);
  }

  /** Stop the clock for good; the city is over when the server is. */
  stop(): void {
    this.stopped = true;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  /** The next tick, `delay` ms from now (never less than immediately). */
  private schedule(delay: number): void {
    if (this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      const started = Date.now();
      void this.tick().catch(() => undefined).then(() => this.schedule(this.tickMs - (Date.now() - started)));
    }, Math.max(0, delay));
  }

  /** One tick, never throwing: a failing tick is logged and the clock carries on. */
  private async runOne(): Promise<void> {
    try {
      await stepTick(this.world, this.brains);
    } catch (e) {
      this.log(`[reverie] tick ${this.world.tick} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    }
    try {
      this.sample();
      const events = [...this.world.tickEvents];
      for (const fn of this.listeners) fn(events);
    } catch (e) {
      this.log(`[reverie] tick listener failed: ${e instanceof Error ? e.message : String(e)}`);
    }
  }

  private sample(): void {
    for (const g of GOODS) {
      const series = this.history.goods[g];
      series.push(this.world.market.goods[g].price);
      if (series.length > PRICE_HISTORY_LENGTH) series.splice(0, series.length - PRICE_HISTORY_LENGTH);
    }
    this.history.index.push(this.world.market.priceIndex);
    if (this.history.index.length > PRICE_HISTORY_LENGTH) this.history.index.splice(0, this.history.index.length - PRICE_HISTORY_LENGTH);
  }
}

// ------------------------------------------------------------ state view

/** Citizens who live here and think with the scripted brain: the founders. */
export function countFounders(world: World): number {
  const present = new Set(world.order);
  return Object.values(world.citizens)
    .filter((c) => c.brain === 'reflex' && c.standing !== 'exiled' && present.has(c.id)).length;
}

/**
 * What /api/state and every SSE state frame say: the clock, the city, the
 * pace it was started at and the deadline a mind gets. No controls, and no
 * "running" or "busy" to invite one — the city is always running.
 */
export function publicState(world: World, sim: Simulation): Record<string, unknown> {
  const view = stateView(world, { running: true, tickMs: sim.tickMs, busy: false, pendingRemote: [] });
  for (const key of ['running', 'busy', 'pendingRemote', 'tickMs']) delete view[key];
  return {
    ...view,
    tickSeconds: Math.round((sim.tickMs / 1000) * 100) / 100,
    decisionDeadlineMs: world.config.decisionDeadlineMs ?? 0,
    founders: countFounders(world),
  };
}

// ----------------------------------------------------------------- server

const DEFAULT_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

export async function startServer(world: World, opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const webRoot = opts.webRoot ?? DEFAULT_WEB_ROOT;
  const { broker } = opts;
  const sim = new Simulation(world, opts.brains, opts.tickMs, log);
  const clients = new Set<http.ServerResponse>();
  const state = () => publicState(world, sim);
  const ctx: AgentContext = {
    world, broker, tickDone: () => sim.tickDone(), tickMs: () => sim.tickMs, running: () => sim.running,
  };

  // --- SSE
  sim.onTick((events) => {
    if (!clients.size) return;
    const frames = sseFrame('events', events) + sseFrame('state', state());
    for (const res of clients) {
      if (res.destroyed || res.writableEnded) { clients.delete(res); continue; }
      res.write(frames);
    }
  });
  const heartbeat = setInterval(() => {
    for (const res of clients) {
      if (res.destroyed || res.writableEnded) { clients.delete(res); continue; }
      res.write(': ping\n\n');
    }
  }, HEARTBEAT_MS);

  function openStream(req: http.IncomingMessage, res: http.ServerResponse): void {
    setCors(res);
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    res.write(sseFrame('state', state()));
    clients.add(res);
    const drop = () => { clients.delete(res); };
    res.on('close', drop);
    req.on('close', drop);
  }

  // --- routing
  async function handleApi(req: http.IncomingMessage, res: http.ServerResponse, method: string, pathname: string, url: URL): Promise<void> {
    const get = method === 'GET' || method === 'HEAD';
    const only = (allowed: boolean) => { if (!allowed) throw new HttpError(405, 'method not allowed'); };
    let m: RegExpExecArray | null;
    switch (pathname) {
      case '/api/state': only(get); sendJson(res, 200, state()); return;
      case '/api/map': only(get); sendJson(res, 200, mapView(world)); return;
      case '/api/citizens': only(get); sendJson(res, 200, citizensView(world, url.searchParams)); return;
      case '/api/economy': only(get); sendJson(res, 200, economyView(world, sim.history)); return;
      case '/api/government': only(get); sendJson(res, 200, governmentView(world)); return;
      case '/api/court': only(get); sendJson(res, 200, courtView(world)); return;
      case '/api/society': only(get); sendJson(res, 200, societyView(world)); return;
      case '/api/bans': only(get); sendJson(res, 200, bansView(world)); return;
      case '/api/chronicle': only(get); sendJson(res, 200, chronicleView(world)); return;
      case '/api/events': only(get); openStream(req, res); return;
      case '/api/agents': only(get); sendJson(res, 200, registryView(world)); return;
      case '/api/agents/join': only(method === 'POST'); await handleJoin(ctx, req, res); return;
      default: break;
    }
    if ((m = /^\/api\/citizens\/([^/]+)$/.exec(pathname))) {
      only(get);
      const view = citizenView(world, decodeURIComponent(m[1]));
      if (!view) throw new HttpError(404, 'unknown citizen');
      sendJson(res, 200, view);
      return;
    }
    if ((m = /^\/api\/agents\/(c_\d+)\/observe$/.exec(pathname))) { only(get); await handleObserve(ctx, req, res, m[1]); return; }
    if ((m = /^\/api\/agents\/(c_\d+)\/act$/.exec(pathname))) { only(method === 'POST'); await handleAct(ctx, req, res, m[1]); return; }
    if ((m = /^\/api\/agents\/(c_\d+)\/letters$/.exec(pathname))) { only(get); handleLetters(ctx, req, res, m[1], url); return; }
    if ((m = /^\/api\/agents\/(c_\d+)\/journal$/.exec(pathname))) { only(get); handleJournal(ctx, req, res, m[1]); return; }
    if ((m = /^\/api\/agents\/(c_\d+)\/claim$/.exec(pathname))) { only(method === 'POST'); await handleClaim(ctx, req, res, m[1]); return; }
    if ((m = /^\/api\/agents\/(c_\d+)$/.exec(pathname))) { only(method === 'DELETE'); await handleLeave(ctx, req, res, m[1]); return; }
    throw new HttpError(404, 'not found');
  }

  async function handle(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const method = req.method ?? 'GET';
    let url: URL;
    try {
      url = new URL(req.url ?? '/', 'http://reverie.local');
    } catch {
      sendError(res, 400, 'bad request');
      return;
    }
    try {
      if (method === 'OPTIONS') {
        setCors(res);
        res.writeHead(204);
        res.end();
        return;
      }
      if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
        await handleApi(req, res, method, url.pathname, url);
        return;
      }
      if (method !== 'GET' && method !== 'HEAD') throw new HttpError(405, 'method not allowed');
      if (!(await serveStatic(res, webRoot, url.pathname, method === 'HEAD'))) throw new HttpError(404, 'not found');
    } catch (e) {
      sendFailure(res, e, log);
    }
  }

  const server = http.createServer((req, res) => { void handle(req, res); });
  server.on('clientError', (err: NodeJS.ErrnoException, socket) => {
    if (err.code === 'ECONNRESET' || !socket.writable) { socket.destroy(); return; }
    socket.end('HTTP/1.1 400 Bad Request\r\nConnection: close\r\n\r\n');
  });

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(opts.port, opts.host, () => {
      server.off('error', reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : opts.port;
  log(`[reverie] listening on http://${opts.host ?? 'localhost'}:${port} — ${Object.keys(world.citizens).length} citizens, tick ${world.tick}`);
  sim.start();

  let stopped = false;
  const stop = (): void => {
    if (stopped) return;
    stopped = true;
    sim.stop();
    clearInterval(heartbeat);
    for (const res of clients) {
      try { res.end(); } catch { /* already gone */ }
    }
    clients.clear();
    server.close();
    server.closeAllConnections();
  };

  return { server, stop, port, sim };
}

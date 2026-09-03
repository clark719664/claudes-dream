/**
 * The Reverie HTTP server: REST views for the dashboard, a Server-Sent
 * Events stream of each tick's events, simulation controls, the external
 * agent API and the static dashboard from web/. The server also drives the
 * simulation loop: while running, one tick every `tickMs` of wall clock,
 * serialised so ticks never overlap. A failing tick is logged, never fatal.
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
import { HttpError, isRecord, readJson, sendError, sendFailure, sendJson, serveStatic, setCors, sseFrame } from './http.ts';
import { citizenView, citizensView, mapView, stateView } from './views.ts';
import type { SimStatus } from './views.ts';
import { bansView, chronicleView, courtView, economyView, governmentView } from './views-city.ts';
import { societyView } from './views-society.ts';
import type { PriceHistory } from './views-city.ts';
import { handleAct, handleJoin, handleLeave, handleObserve } from './agents.ts';
import type { AgentContext } from './agents.ts';

export const MIN_TICK_MS = 10;
export const MAX_TICK_MS = 60_000;
/** Ticks a single /api/sim/step call may run. */
export const MAX_STEP_TICKS = 24 * 28;
/** Price samples kept per good (12 city days at one per tick). */
export const PRICE_HISTORY_LENGTH = 288;
export const HEARTBEAT_MS = 15_000;

export interface ServerOptions {
  port: number;
  broker: RemoteBroker;
  brains: BrainRegistry;
  tickMs: number;
  autoRun: boolean;
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

/** Owns the tick loop. Ticks are queued on a promise chain so they never overlap. */
export class Simulation {
  readonly world: World;
  readonly history: PriceHistory;
  running = false;
  busy = false;
  tickMs: number;
  private readonly brains: BrainRegistry;
  private readonly log: (message: string) => void;
  private timer: NodeJS.Timeout | null = null;
  private chain: Promise<void> = Promise.resolve();
  private inFlight: Promise<void> | null = null;
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

  /** Called after every tick with that tick's events. */
  onTick(fn: (events: WorldEvent[]) => void): () => void {
    this.listeners.add(fn);
    return () => { this.listeners.delete(fn); };
  }

  status(pendingRemote: string[]): SimStatus {
    return { running: this.running, tickMs: this.tickMs, busy: this.busy, pendingRemote };
  }

  /** Resolves when the tick in progress (if any) has finished. */
  tickDone(): Promise<void> {
    return this.inFlight ?? Promise.resolve();
  }

  /** Queue `n` ticks behind whatever is already queued; resolves with the number run. */
  step(n: number): Promise<number> {
    const count = clamp(Math.round(n) || 1, 1, MAX_STEP_TICKS);
    let ran = 0;
    for (let i = 0; i < count; i++) {
      this.chain = this.chain.then(() => {
        if (this.stopped) return;
        const p = this.runOne();
        this.inFlight = p;
        return p.then(() => {
          ran++;
          if (this.inFlight === p) this.inFlight = null;
        });
      });
    }
    return this.chain.then(() => ran);
  }

  resume(): void {
    if (this.stopped) return;
    this.running = true;
    this.schedule();
  }

  pause(): void {
    this.running = false;
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  setSpeed(tickMs: number): void {
    this.tickMs = clamp(Math.round(tickMs), MIN_TICK_MS, MAX_TICK_MS);
    if (this.running) {
      this.pause();
      this.resume();
    }
  }

  stop(): void {
    this.pause();
    this.stopped = true;
  }

  private schedule(): void {
    if (!this.running || this.timer || this.stopped) return;
    this.timer = setTimeout(() => {
      this.timer = null;
      this.step(1).finally(() => { if (this.running) this.schedule(); });
    }, this.tickMs);
  }

  /** One tick, never throwing: a failing tick is logged and the loop carries on. */
  private async runOne(): Promise<void> {
    this.busy = true;
    try {
      await stepTick(this.world, this.brains);
    } catch (e) {
      this.log(`[reverie] tick ${this.world.tick} failed: ${e instanceof Error ? e.stack ?? e.message : String(e)}`);
    } finally {
      this.busy = false;
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

// ----------------------------------------------------------------- server

const DEFAULT_WEB_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'web');

export async function startServer(world: World, opts: ServerOptions): Promise<RunningServer> {
  const log = opts.log ?? ((m: string) => console.log(m));
  const webRoot = opts.webRoot ?? DEFAULT_WEB_ROOT;
  const { broker } = opts;
  const sim = new Simulation(world, opts.brains, opts.tickMs, log);
  const clients = new Set<http.ServerResponse>();
  const status = () => sim.status(broker.pending());
  const state = () => stateView(world, status());
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

  // --- simulation controls
  async function handleSim(action: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const body = await readJson(req);
    const params = isRecord(body) ? body : {};
    switch (action) {
      case 'step': {
        const ticks = params.ticks === undefined ? 1 : Number(params.ticks);
        if (!Number.isFinite(ticks) || ticks < 1) throw new HttpError(400, `ticks must be a number between 1 and ${MAX_STEP_TICKS}`);
        const ran = await sim.step(ticks);
        sendJson(res, 200, { ...state(), ran });
        return;
      }
      case 'pause': sim.pause(); break;
      case 'resume': sim.resume(); break;
      case 'speed': {
        const tickMs = Number(params.tickMs);
        if (!Number.isFinite(tickMs)) throw new HttpError(400, `tickMs must be a number between ${MIN_TICK_MS} and ${MAX_TICK_MS}`);
        sim.setSpeed(tickMs);
        break;
      }
      default: throw new HttpError(404, 'not found');
    }
    sendJson(res, 200, state());
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
    if ((m = /^\/api\/sim\/(step|pause|resume|speed)$/.exec(pathname))) {
      only(method === 'POST');
      await handleSim(m[1], req, res);
      return;
    }
    if ((m = /^\/api\/agents\/(c_\d+)\/observe$/.exec(pathname))) { only(get); await handleObserve(ctx, req, res, m[1]); return; }
    if ((m = /^\/api\/agents\/(c_\d+)\/act$/.exec(pathname))) { only(method === 'POST'); await handleAct(ctx, req, res, m[1]); return; }
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
  if (opts.autoRun) sim.resume();

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

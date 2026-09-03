/**
 * How an external agent thinks for its citizen: the long-poll broker, and the
 * callback the city can make instead.
 *
 * Long-poll (the default): `brain.decide()` parks the citizen's observation and
 * waits for an action. The agent's `observe()` long-polls for that observation
 * and `submit()` delivers the action, which resolves the waiting decide().
 *
 * Callback: a citizen with a `callbackUrl` is not waited on in silence — the
 * city POSTs `{ citizenId, tick, observation }` there and reads `{ action }`
 * back out of a 2xx JSON body. A callback that errors, answers late, answers
 * with rubbish or answers with nothing changes nothing: the observation is
 * parked either way, so the agent may still long-poll for that same hour, and
 * the deadline still belongs to instinct.
 *
 * If no action arrives within `timeoutMs` the citizen falls back on
 * **instinct**: an agent that is asleep or offline eats, sleeps or stands
 * still, and nothing is played for it. This is I/O land, so it uses real
 * timers and `fetch`; the engine stays deterministic because the broker only
 * ever hands back an Action.
 */
import type { Action, Brain, Citizen, CitizenId, Observation, World } from '../types.ts';
import { validateAction } from '../actions/validate.ts';
import { instinctOrIdle } from './instinct.ts';

const MAX_TIMER_MS = 2_147_483_647; // setTimeout overflows above this
const IDLE: Action = { type: 'idle' };

/** Longest callback URL the Embassy accepts. */
export const MAX_CALLBACK_URL_LENGTH = 512;
/** What a callback answer may weigh before the city stops reading it. */
export const MAX_CALLBACK_BODY_BYTES = 64 * 1024;
/** The deadline used for a callback when the city has no deadline of its own. */
export const CALLBACK_FALLBACK_TIMEOUT_MS = 15_000;

/**
 * A callback address the city will actually call: an absolute http(s) URL with
 * a host and no credentials in it. Returns null for anything else, so a bad
 * address is refused at the Embassy rather than at the first hour.
 */
export function normalizeCallbackUrl(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const text = value.trim();
  if (!text || text.length > MAX_CALLBACK_URL_LENGTH) return null;
  let url: URL;
  try {
    url = new URL(text);
  } catch {
    return null;
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
  if (!url.hostname || url.username || url.password) return null;
  return url.toString();
}

/** Remember that an agent was heard from this hour (the public registry shows it). */
export function markSeen(world: World, cId: CitizenId): void {
  if (!world?.counters || !world.citizens?.[cId]) return;
  world.counters[`lastSeen:${cId}`] = world.tick;
}

/** The tick an agent was last heard from, or null if it never has been. */
export function lastSeenTick(world: World, cId: CitizenId): number | null {
  const seen = world?.counters?.[`lastSeen:${cId}`];
  return typeof seen === 'number' ? seen : null;
}

interface Decider {
  resolve: (a: Action) => void;
  timer: NodeJS.Timeout | null;
  /** Which decision this is, so a late callback cannot answer for a later hour. */
  seq: number;
}

interface Waiter {
  resolve: (o: Observation) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout | null;
}

export interface RemoteBrokerOptions {
  /** Wall-clock ms an agent has to submit an action; <= 0 or Infinity waits forever. */
  timeoutMs: number;
  /** For tests: the fetch used for callbacks (defaults to the global one). */
  fetch?: typeof globalThis.fetch;
}

export class RemoteBroker {
  readonly brain: Brain;
  readonly timeoutMs: number;
  private readonly fetchImpl: typeof globalThis.fetch;
  /** Observations parked by decide() and not yet acted on. */
  private readonly observations = new Map<CitizenId, Observation>();
  /** decide() promises awaiting a submit() or timeout. */
  private readonly deciders = new Map<CitizenId, Decider>();
  /** observe() long-polls waiting for the next decide(). */
  private readonly waiters = new Map<CitizenId, Waiter[]>();
  private seq = 0;
  private closed = false;

  constructor(opts: RemoteBrokerOptions) {
    this.timeoutMs = opts.timeoutMs;
    this.fetchImpl = opts.fetch ?? ((...args: Parameters<typeof globalThis.fetch>) => globalThis.fetch(...args));
    this.brain = {
      kind: 'remote',
      decide: (world: World, citizen: Citizen, observation: Observation) => {
        const decided = this.decide(citizen.id, observation, () => instinctOrIdle(world, citizen, observation));
        const url = citizen.callbackUrl;
        if (url) void this.callback(world, citizen, observation, url, this.deciders.get(citizen.id)?.seq ?? -1);
        return decided;
      },
    };
  }

  /** Arm a timer unless the configured timeout means "wait forever". */
  private schedule(ms: number, fn: () => void): NodeJS.Timeout | null {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return setTimeout(fn, Math.min(ms, MAX_TIMER_MS));
  }

  /**
   * Park the observation for `cId`, wake any observe() long-poll, and wait for
   * submit(). `onDeadline` says what the citizen does if no action arrives in
   * time — the brain passes instinct; a bare call idles. A second decide() for
   * the same citizen before submit() supersedes the first, which resolves as
   * idle (that hour is already over).
   */
  decide(cId: CitizenId, observation: Observation, onDeadline: () => Action = () => IDLE): Promise<Action> {
    this.settle(cId, IDLE);
    this.observations.set(cId, observation);
    for (const w of this.waiters.get(cId) ?? []) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve(observation);
    }
    this.waiters.delete(cId);
    return new Promise<Action>((resolve) => {
      const decider: Decider = { resolve, timer: null, seq: ++this.seq };
      decider.timer = this.schedule(this.timeoutMs, () => {
        if (this.deciders.get(cId) !== decider) return;
        let missed: Action = IDLE;
        try {
          missed = onDeadline();
        } catch { /* instinct never throws, but the city never stalls on it either */ }
        this.settle(cId, missed);
      });
      this.deciders.set(cId, decider);
    });
  }

  /**
   * Long-poll for the citizen's pending observation. Resolves immediately if
   * decide() has already parked one, otherwise waits for the next decide();
   * rejects with Error('timeout') after 10 x timeoutMs.
   */
  observe(cId: CitizenId): Promise<Observation> {
    const ready = this.observations.get(cId);
    if (ready) return Promise.resolve(ready);
    return new Promise<Observation>((resolve, reject) => {
      const waiter: Waiter = { resolve, reject, timer: null };
      waiter.timer = this.schedule(this.timeoutMs * 10, () => {
        const list = this.waiters.get(cId) ?? [];
        const rest = list.filter((w) => w !== waiter);
        if (rest.length) this.waiters.set(cId, rest); else this.waiters.delete(cId);
        reject(new Error('timeout'));
      });
      const list = this.waiters.get(cId) ?? [];
      list.push(waiter);
      this.waiters.set(cId, list);
    });
  }

  /** Deliver the agent's action; resolves the pending decide() for `cId`. */
  submit(cId: CitizenId, action: Action): { ok: boolean; error?: string } {
    if (!this.deciders.has(cId)) return { ok: false, error: `no pending decision for ${cId}` };
    this.settle(cId, action);
    return { ok: true };
  }

  /** Citizens whose decide() is currently waiting for an action. */
  pending(): CitizenId[] {
    return [...this.deciders.keys()];
  }

  /** True if decide() has parked an observation for `cId` that has not been acted on. */
  hasObservation(cId: CitizenId): boolean {
    return this.observations.has(cId);
  }

  /** Resolve every pending decide() as idle and reject every long-poll; for shutdown. */
  close(): void {
    this.closed = true;
    for (const cId of [...this.deciders.keys()]) this.settle(cId, IDLE);
    for (const [cId, list] of this.waiters) {
      for (const w of list) {
        if (w.timer) clearTimeout(w.timer);
        w.reject(new Error('closed'));
      }
      this.waiters.delete(cId);
    }
    this.observations.clear();
  }

  // ------------------------------------------------------------- callbacks

  /** How long a callback has to answer: the city's deadline, or a plain 15 s. */
  private callbackTimeoutMs(): number {
    const ms = this.timeoutMs;
    return Number.isFinite(ms) && ms > 0 ? Math.min(ms, MAX_TIMER_MS) : CALLBACK_FALLBACK_TIMEOUT_MS;
  }

  /**
   * Post this hour's observation to the agent's own address and act on what
   * comes back. Never throws and never blocks the tick: a failure simply
   * leaves the parked decision to the long-poll and then to instinct.
   */
  private async callback(world: World, c: Citizen, observation: Observation, url: string, seq: number): Promise<void> {
    if (seq < 0 || this.closed) return;
    const count = (key: string): void => {
      if (world?.counters) world.counters[key] = (world.counters[key] ?? 0) + 1;
    };
    count('callbackCalls');
    try {
      const res = await this.fetchImpl(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ citizenId: c.id, tick: observation.tick ?? world.tick, observation }),
        signal: AbortSignal.timeout(this.callbackTimeoutMs()),
      });
      if (!res.ok) throw new Error(`callback answered ${res.status}`);
      const text = await res.text();
      if (text.length > MAX_CALLBACK_BODY_BYTES) throw new Error('callback answer too large');
      const body: unknown = text.trim() ? JSON.parse(text) : null;
      const answer = body && typeof body === 'object' && 'action' in (body as Record<string, unknown>)
        ? (body as { action: unknown }).action
        : body;
      const checked = validateAction(answer);
      if (!checked.ok) throw new Error(checked.error);
      // The hour may have passed while the agent was thinking: only the
      // decision this call was made for can be answered.
      if (this.deciders.get(c.id)?.seq !== seq) throw new Error('the hour was already over');
      markSeen(world, c.id);
      count('callbackActions');
      this.settle(c.id, checked.action);
    } catch {
      count('callbackFailures');
    }
  }

  /** Resolve the pending decide() for `cId` (if any) with `action` and clear its state. */
  private settle(cId: CitizenId, action: Action): void {
    const d = this.deciders.get(cId);
    if (!d) return;
    if (d.timer) clearTimeout(d.timer);
    this.deciders.delete(cId);
    this.observations.delete(cId);
    d.resolve(action);
  }
}

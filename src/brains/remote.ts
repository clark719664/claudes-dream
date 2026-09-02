/**
 * The long-poll broker external agents use over HTTP.
 *
 * Engine side: `brain.decide()` parks the citizen's observation and waits for
 * an action. Agent side: `observe()` long-polls for that observation and
 * `submit()` delivers the action, which resolves the waiting decide(). If no
 * action arrives within `timeoutMs` the citizen idles. This is I/O land, so it
 * uses real timers; the engine stays deterministic because the broker only
 * ever hands back an Action.
 */
import type { Action, Brain, Citizen, CitizenId, Observation, World } from '../types.ts';

const MAX_TIMER_MS = 2_147_483_647; // setTimeout overflows above this
const IDLE: Action = { type: 'idle' };

interface Decider {
  resolve: (a: Action) => void;
  timer: NodeJS.Timeout | null;
}

interface Waiter {
  resolve: (o: Observation) => void;
  reject: (e: Error) => void;
  timer: NodeJS.Timeout | null;
}

export interface RemoteBrokerOptions {
  /** Wall-clock ms an agent has to submit an action; <= 0 or Infinity waits forever. */
  timeoutMs: number;
}

export class RemoteBroker {
  readonly brain: Brain;
  readonly timeoutMs: number;
  /** Observations parked by decide() and not yet acted on. */
  private readonly observations = new Map<CitizenId, Observation>();
  /** decide() promises awaiting a submit() or timeout. */
  private readonly deciders = new Map<CitizenId, Decider>();
  /** observe() long-polls waiting for the next decide(). */
  private readonly waiters = new Map<CitizenId, Waiter[]>();

  constructor(opts: RemoteBrokerOptions) {
    this.timeoutMs = opts.timeoutMs;
    this.brain = {
      kind: 'remote',
      decide: (_world: World, citizen: Citizen, observation: Observation) => this.decide(citizen.id, observation),
    };
  }

  /** Arm a timer unless the configured timeout means "wait forever". */
  private schedule(ms: number, fn: () => void): NodeJS.Timeout | null {
    if (!Number.isFinite(ms) || ms <= 0) return null;
    return setTimeout(fn, Math.min(ms, MAX_TIMER_MS));
  }

  /**
   * Park the observation for `cId`, wake any observe() long-poll, and wait for
   * submit(). A second decide() for the same citizen before submit() supersedes
   * the first, which resolves as idle.
   */
  decide(cId: CitizenId, observation: Observation): Promise<Action> {
    this.settle(cId, IDLE);
    this.observations.set(cId, observation);
    for (const w of this.waiters.get(cId) ?? []) {
      if (w.timer) clearTimeout(w.timer);
      w.resolve(observation);
    }
    this.waiters.delete(cId);
    return new Promise<Action>((resolve) => {
      const decider: Decider = { resolve, timer: null };
      decider.timer = this.schedule(this.timeoutMs, () => {
        if (this.deciders.get(cId) === decider) this.settle(cId, IDLE);
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

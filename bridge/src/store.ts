import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { EventEmitter } from "node:events";
import type {
  BridgeEvent,
  DeviceInfo,
  NowPlaying,
  PlaybackState,
  SessionSummary,
} from "@dmb/shared";
import { config } from "./config.js";
import { LiveAudioStream, makeLiveAudioStream } from "./liveAudio.js";
import { logger } from "./log.js";

const log = logger("store");

/** Unambiguous alphabet: no O/0, I/1, so codes are easy to read off a screen. */
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function makeCode(length = 6): string {
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += CODE_ALPHABET[bytes[i]! % CODE_ALPHABET.length];
  }
  return out;
}

/** Constant-time compare that tolerates length mismatch without throwing. */
export function secretsMatch(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

interface PendingPairing {
  code: string;
  guildId: string;
  userId: string;
  expiresAt: number;
}

export interface DeviceConnection {
  send(payload: unknown): void;
  close(reason: string): void;
}

export class Session {
  nowPlaying: NowPlaying | null = null;
  connection: DeviceConnection | null = null;
  private listeners = new Set<LiveAudioStream>();
  private expiryTimer: NodeJS.Timeout | null = null;

  constructor(
    readonly id: string,
    readonly guildId: string,
    readonly userId: string,
    readonly deviceToken: string,
    public device: DeviceInfo,
  ) {}

  get online(): boolean {
    return this.connection !== null;
  }

  get listenerCount(): number {
    return this.listeners.size;
  }

  get bufferedMs(): number {
    let max = 0;
    for (const listener of this.listeners) max = Math.max(max, listener.bufferedMs);
    return max;
  }

  /** Open a paced PCM stream for one consumer (in practice, the bot). */
  addListener(): LiveAudioStream {
    const stream = makeLiveAudioStream(config.prebufferMs, config.maxBufferMs);
    this.listeners.add(stream);
    stream.once("close", () => {
      this.listeners.delete(stream);
      this.notifyListenerCount();
    });
    this.notifyListenerCount();
    return stream;
  }

  writeAudio(chunk: Buffer): void {
    for (const listener of this.listeners) listener.push_pcm(chunk);
  }

  private notifyListenerCount(): void {
    this.connection?.send({ t: "listeners", count: this.listeners.size });
  }

  /** Start the grace period after the device socket drops. */
  scheduleExpiry(onExpire: () => void): void {
    this.clearExpiry();
    this.expiryTimer = setTimeout(onExpire, config.sessionGraceMs);
    this.expiryTimer.unref?.();
  }

  clearExpiry(): void {
    if (this.expiryTimer) {
      clearTimeout(this.expiryTimer);
      this.expiryTimer = null;
    }
  }

  teardown(): void {
    this.clearExpiry();
    for (const listener of this.listeners) listener.close();
    this.listeners.clear();
  }

  summary(): SessionSummary {
    return {
      sessionId: this.id,
      guildId: this.guildId,
      userId: this.userId,
      device: this.device,
      nowPlaying: this.nowPlaying,
      online: this.online,
      bufferedMs: this.bufferedMs,
    };
  }
}

/**
 * All bridge state, in memory. Sessions are ephemeral by design: if the
 * bridge restarts, phones re-pair. Persisting device tokens would mean
 * storing credentials, which is not worth it for this.
 */
export class Store extends EventEmitter {
  private pairings = new Map<string, PendingPairing>();
  private sessions = new Map<string, Session>();
  private byToken = new Map<string, Session>();

  override emit(event: "event", payload: BridgeEvent): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: "event", listener: (payload: BridgeEvent) => void): this;
  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  createPairingCode(guildId: string, userId: string): PendingPairing {
    this.sweepPairings();
    // One live code per user; asking again replaces the old one.
    for (const [code, pending] of this.pairings) {
      if (pending.userId === userId && pending.guildId === guildId) this.pairings.delete(code);
    }
    let code = makeCode();
    while (this.pairings.has(code)) code = makeCode();

    const pending: PendingPairing = {
      code,
      guildId,
      userId,
      expiresAt: Date.now() + config.pairingTtlMs,
    };
    this.pairings.set(code, pending);
    return pending;
  }

  redeemPairingCode(code: string, device: DeviceInfo): Session | null {
    this.sweepPairings();
    const pending = this.pairings.get(code.trim().toUpperCase());
    if (!pending) return null;
    this.pairings.delete(pending.code);

    // A user gets one device at a time; re-pairing replaces the previous one.
    for (const existing of this.sessions.values()) {
      if (existing.userId === pending.userId && existing.guildId === pending.guildId) {
        this.dropSession(existing.id, "replaced by a new device");
      }
    }

    const session = new Session(
      randomUUID(),
      pending.guildId,
      pending.userId,
      randomBytes(32).toString("base64url"),
      device,
    );
    this.sessions.set(session.id, session);
    this.byToken.set(session.deviceToken, session);
    log.info(`paired ${device.name} -> session ${session.id} (guild ${session.guildId})`);
    this.emit("event", { t: "session.up", session: session.summary() });
    return session;
  }

  private sweepPairings(): void {
    const now = Date.now();
    for (const [code, pending] of this.pairings) {
      if (pending.expiresAt <= now) this.pairings.delete(code);
    }
  }

  getByToken(token: string): Session | undefined {
    return this.byToken.get(token);
  }

  get(sessionId: string): Session | undefined {
    return this.sessions.get(sessionId);
  }

  forGuild(guildId: string): Session[] {
    return [...this.sessions.values()].filter((s) => s.guildId === guildId);
  }

  forUser(guildId: string, userId: string): Session | undefined {
    return this.forGuild(guildId).find((s) => s.userId === userId);
  }

  all(): Session[] {
    return [...this.sessions.values()];
  }

  attach(session: Session, connection: DeviceConnection): void {
    session.clearExpiry();
    session.connection?.close("replaced by a newer connection");
    session.connection = connection;
    this.emit("event", { t: "session.up", session: session.summary() });
  }

  detach(session: Session): void {
    session.connection = null;
    this.emit("event", { t: "session.down", sessionId: session.id });
    session.scheduleExpiry(() => this.dropSession(session.id, "device did not reconnect"));
  }

  setNowPlaying(session: Session, nowPlaying: NowPlaying): void {
    session.nowPlaying = nowPlaying;
    this.emit("event", { t: "session.nowplaying", sessionId: session.id, nowPlaying });
  }

  setState(session: Session, state: PlaybackState): void {
    if (session.nowPlaying) session.nowPlaying = { ...session.nowPlaying, state };
    this.emit("event", { t: "session.state", sessionId: session.id, state });
  }

  dropSession(sessionId: string, reason: string): void {
    const session = this.sessions.get(sessionId);
    if (!session) return;
    log.info(`dropping session ${sessionId}: ${reason}`);
    session.connection?.close(reason);
    session.teardown();
    this.sessions.delete(sessionId);
    this.byToken.delete(session.deviceToken);
    this.emit("event", { t: "session.down", sessionId });
  }
}

export const store = new Store();

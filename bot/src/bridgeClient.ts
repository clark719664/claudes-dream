import { EventEmitter } from "node:events";
import { Readable } from "node:stream";
import WebSocket from "ws";
import type {
  BridgeEvent,
  PairingCodeResponse,
  RemoteCommandName,
  SessionSummary,
} from "@dmb/shared";
import { config } from "./config.js";
import { logger } from "./log.js";

const log = logger("bridge-client");

/** Reconnect backoff bounds, in milliseconds. */
const RECONNECT_MIN_MS = 1_000;
const RECONNECT_MAX_MS = 30_000;

export class BridgeClient extends EventEmitter {
  private socket: WebSocket | null = null;
  private reconnectDelay = RECONNECT_MIN_MS;
  private closing = false;
  /** Last known state per session, kept so commands can answer instantly. */
  readonly sessions = new Map<string, SessionSummary>();

  override emit(event: "event", payload: BridgeEvent): boolean;
  override emit(event: string, ...args: unknown[]): boolean {
    return super.emit(event, ...args);
  }

  override on(event: "event", listener: (payload: BridgeEvent) => void): this;
  override on(event: string, listener: (...args: never[]) => void): this {
    return super.on(event, listener as (...args: unknown[]) => void);
  }

  connect(): void {
    this.closing = false;
    const url = `${config.bridgeWs}/v1/bot?secret=${encodeURIComponent(config.bridgeSecret)}`;
    const socket = new WebSocket(url);
    this.socket = socket;

    socket.on("open", () => {
      log.info("connected to bridge");
      this.reconnectDelay = RECONNECT_MIN_MS;
    });

    socket.on("message", (raw) => {
      let event: BridgeEvent;
      try {
        event = JSON.parse(raw.toString()) as BridgeEvent;
      } catch {
        log.warn("ignoring malformed bridge event");
        return;
      }
      this.applyEvent(event);
      this.emit("event", event);
    });

    socket.on("error", (error) => log.warn(`bridge socket error: ${error.message}`));

    socket.on("close", () => {
      this.socket = null;
      this.sessions.clear();
      if (this.closing) return;
      log.warn(`bridge disconnected, retrying in ${this.reconnectDelay}ms`);
      setTimeout(() => this.connect(), this.reconnectDelay).unref?.();
      this.reconnectDelay = Math.min(this.reconnectDelay * 2, RECONNECT_MAX_MS);
    });
  }

  close(): void {
    this.closing = true;
    this.socket?.close();
  }

  private applyEvent(event: BridgeEvent): void {
    switch (event.t) {
      case "session.up":
        this.sessions.set(event.session.sessionId, event.session);
        break;
      case "session.down":
        this.sessions.delete(event.sessionId);
        break;
      case "session.nowplaying": {
        const current = this.sessions.get(event.sessionId);
        if (current) current.nowPlaying = event.nowPlaying;
        break;
      }
      case "session.state": {
        const current = this.sessions.get(event.sessionId);
        if (current?.nowPlaying) current.nowPlaying.state = event.state;
        break;
      }
    }
  }

  sessionForUser(guildId: string, userId: string): SessionSummary | undefined {
    for (const session of this.sessions.values()) {
      if (session.guildId === guildId && session.userId === userId) return session;
    }
    return undefined;
  }

  private async call<T>(path: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(`${config.bridgeHttp}${path}`, {
      ...init,
      headers: {
        ...(init.headers ?? {}),
        authorization: `Bearer ${config.bridgeSecret}`,
        ...(init.body ? { "content-type": "application/json" } : {}),
      },
    });
    const text = await response.text();
    const body = text ? (JSON.parse(text) as unknown) : {};
    if (!response.ok) {
      const message =
        typeof body === "object" && body !== null && "error" in body
          ? String((body as { error: unknown }).error)
          : `bridge returned ${response.status}`;
      throw new Error(message);
    }
    return body as T;
  }

  requestPairingCode(guildId: string, userId: string): Promise<PairingCodeResponse> {
    return this.call<PairingCodeResponse>("/v1/pairing/code", {
      method: "POST",
      body: JSON.stringify({ guildId, userId }),
    });
  }

  sendCommand(
    sessionId: string,
    name: RemoteCommandName,
    requestedBy: { userId: string; username: string },
    positionMs?: number,
  ): Promise<{ commandId: string }> {
    return this.call(`/v1/sessions/${sessionId}/command`, {
      method: "POST",
      body: JSON.stringify({ name, positionMs, requestedBy }),
    });
  }

  unlink(sessionId: string): Promise<{ ok: boolean }> {
    return this.call(`/v1/sessions/${sessionId}`, { method: "DELETE" });
  }

  /**
   * Open the live PCM stream for a session. The bridge paces this in real
   * time and never ends it, so the caller owns closing it.
   */
  async openAudioStream(sessionId: string): Promise<Readable> {
    const response = await fetch(`${config.bridgeHttp}/v1/sessions/${sessionId}/stream`, {
      headers: { authorization: `Bearer ${config.bridgeSecret}` },
    });
    if (!response.ok || !response.body) {
      throw new Error(`could not open audio stream (${response.status})`);
    }
    return Readable.fromWeb(response.body as Parameters<typeof Readable.fromWeb>[0]);
  }
}

export const bridge = new BridgeClient();

import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { WebSocketServer, type WebSocket } from "ws";
import {
  PROTOCOL_VERSION,
  isDeviceMessage,
  type BridgeEvent,
  type DeviceMessage,
} from "@dmb/shared";
import { config } from "./config.js";
import { logger } from "./log.js";
import { secretsMatch, store, type Session } from "./store.js";

const log = logger("ws");

/** Sockets that miss two heartbeats are assumed dead and closed. */
const HEARTBEAT_MS = 30_000;

const deviceControl = new WebSocketServer({ noServer: true });
const deviceAudio = new WebSocketServer({ noServer: true });
const botEvents = new WebSocketServer({ noServer: true });

const botSockets = new Set<WebSocket>();

function send(socket: WebSocket, payload: unknown): void {
  if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(payload));
}

/** Fan every store change out to the bot so its embeds stay live. */
store.on("event", (event: BridgeEvent) => {
  for (const socket of botSockets) send(socket, event);
});

deviceControl.on("connection", (socket: WebSocket, _req: IncomingMessage, session: Session) => {
  store.attach(session, {
    send: (payload) => send(socket, payload),
    close: (reason) => {
      send(socket, { t: "bye", reason });
      socket.close(1000, reason.slice(0, 120));
    },
  });

  send(socket, { t: "welcome", protocol: PROTOCOL_VERSION, sessionId: session.id });
  log.info(`device control connected for session ${session.id}`);

  socket.on("message", (raw) => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      send(socket, { t: "error", message: "malformed JSON" });
      return;
    }
    if (!isDeviceMessage(parsed)) {
      send(socket, { t: "error", message: "unrecognised message" });
      return;
    }
    handleDeviceMessage(session, parsed as DeviceMessage);
  });

  socket.on("close", () => {
    // Only detach if this socket is still the live one; a reconnect may
    // already have replaced it.
    if (session.connection && store.get(session.id)) store.detach(session);
    log.info(`device control disconnected for session ${session.id}`);
  });
});

function handleDeviceMessage(session: Session, message: DeviceMessage): void {
  switch (message.t) {
    case "hello":
      session.device = message.device;
      break;
    case "nowplaying":
      store.setNowPlaying(session, message.nowPlaying);
      break;
    case "state":
      store.setState(session, message.state);
      break;
    case "position":
      if (session.nowPlaying) {
        session.nowPlaying = { ...session.nowPlaying, positionMs: message.positionMs };
      }
      break;
    case "ack":
      if (!message.ok) log.warn(`device rejected command ${message.commandId}: ${message.error}`);
      break;
    case "bye":
      store.dropSession(session.id, message.reason ?? "device said goodbye");
      break;
  }
}

deviceAudio.on("connection", (socket: WebSocket, _req: IncomingMessage, session: Session) => {
  log.info(`device audio connected for session ${session.id}`);
  socket.on("message", (raw, isBinary) => {
    if (!isBinary) return;
    const chunk = Array.isArray(raw) ? Buffer.concat(raw) : Buffer.from(raw as Buffer);
    session.writeAudio(chunk);
  });
  socket.on("close", () => log.info(`device audio disconnected for session ${session.id}`));
});

botEvents.on("connection", (socket: WebSocket) => {
  botSockets.add(socket);
  log.info(`bot connected (${botSockets.size} total)`);
  // Replay current state so a restarted bot immediately knows what exists.
  for (const session of store.all()) {
    send(socket, { t: "session.up", session: session.summary() });
  }
  socket.on("close", () => {
    botSockets.delete(socket);
    log.info(`bot disconnected (${botSockets.size} left)`);
  });
});

function reject(socket: Duplex, status: number, reason: string): void {
  socket.write(`HTTP/1.1 ${status} ${reason}\r\nConnection: close\r\n\r\n`);
  socket.destroy();
}

export function handleUpgrade(req: IncomingMessage, socket: Duplex, head: Buffer): void {
  const url = new URL(req.url ?? "/", "http://bridge.local");
  const path = url.pathname;

  if (path === "/v1/bot") {
    const secret = url.searchParams.get("secret") ?? "";
    if (!secretsMatch(secret, config.secret)) return reject(socket, 401, "Unauthorized");
    botEvents.handleUpgrade(req, socket, head, (ws) => botEvents.emit("connection", ws, req));
    return;
  }

  if (path === "/v1/device" || path === "/v1/device/audio") {
    const token = url.searchParams.get("token") ?? "";
    const session = store.getByToken(token);
    if (!session) return reject(socket, 401, "Unauthorized");
    const server = path === "/v1/device" ? deviceControl : deviceAudio;
    server.handleUpgrade(req, socket, head, (ws) => server.emit("connection", ws, req, session));
    return;
  }

  reject(socket, 404, "Not Found");
}

/**
 * Mobile sockets die silently all the time (dozing, network handover), so we
 * ping everything and drop anything that stops answering.
 */
export function startHeartbeat(): NodeJS.Timeout {
  const alive = new WeakSet<WebSocket>();
  for (const server of [deviceControl, deviceAudio, botEvents]) {
    server.on("connection", (socket: WebSocket) => {
      alive.add(socket);
      socket.on("pong", () => alive.add(socket));
    });
  }

  const timer = setInterval(() => {
    for (const server of [deviceControl, deviceAudio, botEvents]) {
      for (const socket of server.clients) {
        if (!alive.has(socket)) {
          socket.terminate();
          continue;
        }
        alive.delete(socket);
        socket.ping();
      }
    }
  }, HEARTBEAT_MS);
  timer.unref?.();
  return timer;
}

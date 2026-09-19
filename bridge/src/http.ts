import type { IncomingMessage, ServerResponse } from "node:http";
import type {
  PairRequest,
  PairResponse,
  PairingCodeResponse,
  RemoteCommandName,
  SessionSummary,
} from "@dmb/shared";
import { randomUUID } from "node:crypto";
import { config } from "./config.js";
import { logger } from "./log.js";
import { secretsMatch, store } from "./store.js";

const log = logger("http");

const MAX_BODY_BYTES = 64 * 1024;

function json(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(payload),
  });
  res.end(payload);
}

async function readJson<T>(req: IncomingMessage): Promise<T> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = chunk as Buffer;
    size += buf.length;
    if (size > MAX_BODY_BYTES) throw new Error("request body too large");
    chunks.push(buf);
  }
  if (size === 0) throw new Error("request body is empty");
  return JSON.parse(Buffer.concat(chunks).toString("utf8")) as T;
}

/** Bot-only endpoints carry the shared secret; device endpoints never do. */
function isBot(req: IncomingMessage): boolean {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return false;
  return secretsMatch(header.slice("Bearer ".length), config.secret);
}

const COMMANDS: readonly RemoteCommandName[] = [
  "play",
  "pause",
  "skip",
  "previous",
  "seek",
  "stop",
];

export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? "/", "http://bridge.local");
  const path = url.pathname;
  const method = req.method ?? "GET";

  if (method === "GET" && path === "/healthz") {
    json(res, 200, { ok: true, sessions: store.all().length });
    return;
  }

  // --- device-facing, authenticated by the pairing code itself -----------
  if (method === "POST" && path === "/v1/pair") {
    const body = await readJson<PairRequest>(req);
    if (typeof body.code !== "string" || typeof body.device?.name !== "string") {
      json(res, 400, { error: "expected { code, device: { name } }" });
      return;
    }
    const session = store.redeemPairingCode(body.code, body.device);
    if (!session) {
      json(res, 404, { error: "that code is wrong or has expired" });
      return;
    }
    const response: PairResponse = {
      sessionId: session.id,
      deviceToken: session.deviceToken,
      guildId: session.guildId,
      userId: session.userId,
    };
    json(res, 200, response);
    return;
  }

  // --- everything below is bot-only --------------------------------------
  if (!isBot(req)) {
    json(res, 401, { error: "unauthorized" });
    return;
  }

  if (method === "POST" && path === "/v1/pairing/code") {
    const body = await readJson<{ guildId?: string; userId?: string }>(req);
    if (!body.guildId || !body.userId) {
      json(res, 400, { error: "expected { guildId, userId }" });
      return;
    }
    const pending = store.createPairingCode(body.guildId, body.userId);
    const response: PairingCodeResponse = { code: pending.code, expiresAt: pending.expiresAt };
    json(res, 200, response);
    return;
  }

  if (method === "GET" && path === "/v1/sessions") {
    const guildId = url.searchParams.get("guildId");
    const sessions = guildId ? store.forGuild(guildId) : store.all();
    const summaries: SessionSummary[] = sessions.map((s) => s.summary());
    json(res, 200, { sessions: summaries });
    return;
  }

  const streamMatch = /^\/v1\/sessions\/([^/]+)\/stream$/.exec(path);
  if (method === "GET" && streamMatch) {
    const session = store.get(streamMatch[1]!);
    if (!session) {
      json(res, 404, { error: "no such session" });
      return;
    }
    // Raw PCM, paced in real time, and deliberately never-ending: the bot
    // keeps this open for as long as it stays in the voice channel.
    res.writeHead(200, {
      "content-type": "audio/L16; rate=48000; channels=2",
      "cache-control": "no-store",
      connection: "close",
    });
    const stream = session.addListener();
    stream.pipe(res);
    const stop = () => stream.close();
    res.on("close", stop);
    res.on("error", stop);
    log.info(`bot attached to audio for session ${session.id}`);
    return;
  }

  const commandMatch = /^\/v1\/sessions\/([^/]+)\/command$/.exec(path);
  if (method === "POST" && commandMatch) {
    const session = store.get(commandMatch[1]!);
    if (!session) {
      json(res, 404, { error: "no such session" });
      return;
    }
    if (!session.online) {
      json(res, 409, { error: "the device is not connected right now" });
      return;
    }
    const body = await readJson<{
      name?: RemoteCommandName;
      positionMs?: number;
      requestedBy?: { userId: string; username: string };
    }>(req);
    if (!body.name || !COMMANDS.includes(body.name)) {
      json(res, 400, { error: `name must be one of ${COMMANDS.join(", ")}` });
      return;
    }
    const commandId = randomUUID();
    session.connection?.send({
      t: "command",
      commandId,
      name: body.name,
      positionMs: body.positionMs,
      requestedBy: body.requestedBy ?? { userId: "0", username: "unknown" },
    });
    json(res, 202, { commandId });
    return;
  }

  const sessionMatch = /^\/v1\/sessions\/([^/]+)$/.exec(path);
  if (method === "DELETE" && sessionMatch) {
    store.dropSession(sessionMatch[1]!, "unlinked from Discord");
    json(res, 200, { ok: true });
    return;
  }

  json(res, 404, { error: "not found" });
}

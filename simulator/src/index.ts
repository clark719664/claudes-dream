/**
 * A stand-in for your Android app.
 *
 * It speaks the same bridge protocol your app will, so you can prove the
 * Discord half works — bot joins, audio plays, /skip arrives — before wiring
 * anything into your own codebase. When something breaks after you swap your
 * app in, this tells you which side broke.
 *
 *   node simulator/dist/index.js --code ABC123
 *   node simulator/dist/index.js --code ABC123 --file ./track.mp3
 *   node simulator/dist/index.js --code ABC123 --url https://example.com/s.mp3
 */
import { setTimeout as delay } from "node:timers/promises";
import WebSocket from "ws";
import {
  PROTOCOL_VERSION,
  type BridgeMessage,
  type DeviceInfo,
  type NowPlaying,
  type PairResponse,
  type TrackSource,
} from "@dmb/shared";
import { ffmpegSource, toneSource } from "./audioSources.js";

interface Options {
  bridge: string;
  code: string;
  file?: string;
  url?: string;
  name: string;
}

function parseArgs(argv: string[]): Options {
  const args = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg?.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      args.set(key, next);
      i += 1;
    } else {
      args.set(key, "true");
    }
  }

  const code = args.get("code");
  if (!code) {
    console.error(
      [
        "Usage: node simulator/dist/index.js --code <PAIRING CODE> [options]",
        "",
        "  --code <code>     the code /link gave you in Discord (required)",
        "  --bridge <url>    bridge base URL (default http://127.0.0.1:8080)",
        "  --file <path>     stream this audio file instead of a test tone",
        "  --url <url>       publish a url source; the bot fetches it directly",
        "  --name <name>     device name shown in Discord",
      ].join("\n"),
    );
    process.exit(1);
  }

  return {
    code,
    bridge: args.get("bridge") ?? "http://127.0.0.1:8080",
    file: args.get("file"),
    url: args.get("url"),
    name: args.get("name") ?? "Simulator",
  };
}

async function pair(options: Options, device: DeviceInfo): Promise<PairResponse> {
  const response = await fetch(`${options.bridge}/v1/pair`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ code: options.code, device }),
  });
  const body = (await response.json()) as PairResponse & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `pairing failed (${response.status})`);
  return body;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const device: DeviceInfo = {
    name: options.name,
    appVersion: "simulator-0.1.0",
    platform: `node-${process.versions.node}`,
  };

  const session = await pair(options, device);
  console.log(`paired as session ${session.sessionId} (guild ${session.guildId})`);

  const wsBase = options.bridge.replace(/^http/, "ws");
  const control = new WebSocket(`${wsBase}/v1/device?token=${encodeURIComponent(session.deviceToken)}`);

  const source: TrackSource = options.url ? { kind: "url", url: options.url } : { kind: "relay" };
  const track: NowPlaying = {
    trackId: "sim-001",
    title: options.file ? options.file.split("/").pop()! : "Bridge Test Tone",
    artist: "Simulator",
    album: "Diagnostics",
    durationMs: 0,
    positionMs: 0,
    state: "playing",
    source,
  };

  control.on("open", () => {
    console.log("control channel open");
    control.send(JSON.stringify({ t: "hello", protocol: PROTOCOL_VERSION, device }));
    control.send(JSON.stringify({ t: "nowplaying", nowPlaying: track }));
  });

  control.on("message", (raw) => {
    const message = JSON.parse(raw.toString()) as BridgeMessage;
    if (message.t === "command") {
      // Your real app would act on this. Here we just acknowledge it so you
      // can confirm /skip and /pause actually reach the device.
      console.log(`<- command ${message.name} from ${message.requestedBy.username}`);
      control.send(JSON.stringify({ t: "ack", commandId: message.commandId, ok: true }));
    } else if (message.t === "listeners") {
      console.log(`<- ${message.count} listener(s) attached`);
    } else if (message.t === "error") {
      console.error(`<- bridge error: ${message.message}`);
    }
  });

  control.on("close", () => {
    console.log("control channel closed");
    process.exit(0);
  });

  // Report a moving playhead so the Discord embed looks alive.
  let positionMs = 0;
  const ticker = setInterval(() => {
    positionMs += 1000;
    if (control.readyState === WebSocket.OPEN) {
      control.send(JSON.stringify({ t: "position", positionMs }));
    }
  }, 1000);
  ticker.unref();

  if (source.kind === "url") {
    console.log(`published url source: ${options.url}`);
    return;
  }

  // Relay mode: push PCM up the audio socket in real time.
  await delay(250);
  const audio = new WebSocket(`${wsBase}/v1/device/audio?token=${encodeURIComponent(session.deviceToken)}`);

  audio.on("open", () => {
    console.log(options.file ? `streaming ${options.file}` : "streaming test tone");
    const pcm = options.file ? ffmpegSource(options.file) : toneSource();

    pcm.on("data", (chunk: Buffer) => {
      if (audio.readyState !== WebSocket.OPEN) return;
      // Don't queue without bound if the network stalls; live audio should
      // be dropped rather than delayed.
      if (audio.bufferedAmount > 512 * 1024) return;
      audio.send(chunk);
    });

    pcm.on("end", () => {
      console.log("source ended");
      control.send(JSON.stringify({ t: "state", state: "stopped" }));
      audio.close();
    });
  });

  audio.on("error", (error) => console.error(`audio channel error: ${error.message}`));
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});

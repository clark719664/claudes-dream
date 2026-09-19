/**
 * The bridge protocol.
 *
 * Three parties speak it:
 *   - a DEVICE (your Android app) authenticated with a device token,
 *   - the BOT, authenticated with the shared bridge secret,
 *   - the BRIDGE itself, which sits between them and owns all state.
 *
 * Your app only ever needs the DEVICE half.
 */

export const PROTOCOL_VERSION = 1;

/** How your app hands audio to the bridge. */
export type SourceKind =
  /** You give a URL the bot can fetch directly. Cheapest and best quality. */
  | "url"
  /** You stream raw PCM up from the device in real time. Works for anything. */
  | "relay"
  /** You publish metadata only; nothing is played into voice. */
  | "metadata";

export interface TrackSource {
  kind: SourceKind;
  /** Required when kind === "url". Must be reachable from the bot's host. */
  url?: string;
  /** Optional headers the bot should send when fetching `url` (e.g. auth). */
  headers?: Record<string, string>;
}

export type PlaybackState = "playing" | "paused" | "stopped";

export interface NowPlaying {
  /** Stable id from your app. Used to detect track changes. */
  trackId: string;
  title: string;
  artist?: string;
  album?: string;
  /** Total track length in milliseconds, if known. */
  durationMs?: number;
  /** Playhead in milliseconds at the moment this message was sent. */
  positionMs?: number;
  /** Publicly fetchable image URL, used for the Discord embed thumbnail. */
  artworkUrl?: string;
  state: PlaybackState;
  source: TrackSource;
}

export interface DeviceInfo {
  /** Shown in Discord, e.g. "Pixel 8 - Stash". */
  name: string;
  /** Your app's version, for your own debugging. */
  appVersion?: string;
  platform?: string;
}

/* ------------------------------------------------------------------ *
 * Pairing (device <-> Discord user), over plain HTTP.
 * ------------------------------------------------------------------ */

export interface PairingCodeResponse {
  code: string;
  expiresAt: number;
}

export interface PairRequest {
  code: string;
  device: DeviceInfo;
}

export interface PairResponse {
  sessionId: string;
  deviceToken: string;
  /** Echoed back so your app can show "linked to #general in My Server". */
  guildId: string;
  userId: string;
}

/* ------------------------------------------------------------------ *
 * Device -> bridge, over WebSocket.
 * ------------------------------------------------------------------ */

export type DeviceMessage =
  | { t: "hello"; protocol: number; device: DeviceInfo }
  | { t: "nowplaying"; nowPlaying: NowPlaying }
  | { t: "position"; positionMs: number }
  | { t: "state"; state: PlaybackState }
  /** Acknowledges a command the bridge forwarded from Discord. */
  | { t: "ack"; commandId: string; ok: boolean; error?: string }
  | { t: "bye"; reason?: string };

/* ------------------------------------------------------------------ *
 * Bridge -> device, over the same WebSocket.
 * ------------------------------------------------------------------ */

export type RemoteCommandName = "play" | "pause" | "skip" | "previous" | "seek" | "stop";

export interface RemoteCommand {
  t: "command";
  commandId: string;
  name: RemoteCommandName;
  /** Present for "seek". */
  positionMs?: number;
  /** The Discord user who asked, so your app can show or ignore it. */
  requestedBy: { userId: string; username: string };
}

export type BridgeMessage =
  | { t: "welcome"; protocol: number; sessionId: string }
  | RemoteCommand
  | { t: "listeners"; count: number }
  | { t: "error"; message: string }
  | { t: "bye"; reason?: string };

/* ------------------------------------------------------------------ *
 * Bridge -> bot, over WebSocket. The bot subscribes to every session.
 * ------------------------------------------------------------------ */

export interface SessionSummary {
  sessionId: string;
  guildId: string;
  userId: string;
  device: DeviceInfo;
  nowPlaying: NowPlaying | null;
  online: boolean;
  /** Milliseconds of relayed audio currently buffered, 0 for non-relay sources. */
  bufferedMs: number;
}

export type BridgeEvent =
  | { t: "session.up"; session: SessionSummary }
  | { t: "session.down"; sessionId: string }
  | { t: "session.nowplaying"; sessionId: string; nowPlaying: NowPlaying }
  | { t: "session.state"; sessionId: string; state: PlaybackState };

export function isDeviceMessage(value: unknown): value is DeviceMessage {
  return typeof value === "object" && value !== null && typeof (value as { t?: unknown }).t === "string";
}

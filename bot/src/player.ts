import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type VoiceConnection,
} from "@discordjs/voice";
import type { VoiceBasedChannel } from "discord.js";
import type { Readable } from "node:stream";
import type { NowPlaying, SessionSummary } from "@dmb/shared";
import { bridge } from "./bridgeClient.js";
import { logger } from "./log.js";

const log = logger("player");

/**
 * One of these per guild. It owns the voice connection and whatever audio is
 * currently feeding it, so commands never have to reason about voice state.
 */
export class GuildPlayer {
  private connection: VoiceConnection | null = null;
  private readonly player: AudioPlayer;
  private current: Readable | null = null;
  /** The bridge session this guild is listening to. */
  sessionId: string | null = null;
  channelId: string | null = null;

  constructor(readonly guildId: string) {
    this.player = createAudioPlayer({
      behaviors: {
        // Keep playing to an empty channel rather than pausing: the stream is
        // live, so pausing would only make us fall behind the phone.
        noSubscriber: NoSubscriberBehavior.Play,
      },
    });

    this.player.on("error", (error) => log.error(`audio error in ${guildId}: ${error.message}`));
    this.player.on(AudioPlayerStatus.Idle, () => {
      log.debug(`player idle in ${guildId}`);
    });
  }

  get isConnected(): boolean {
    return this.connection !== null;
  }

  async join(channel: VoiceBasedChannel): Promise<void> {
    if (this.connection && this.channelId === channel.id) return;

    this.connection?.destroy();
    const connection = joinVoiceChannel({
      channelId: channel.id,
      guildId: channel.guild.id,
      adapterCreator: channel.guild.voiceAdapterCreator,
      selfDeaf: true,
    });
    this.connection = connection;
    this.channelId = channel.id;

    connection.on(VoiceConnectionStatus.Disconnected, async () => {
      // Discord moves or briefly drops connections routinely. Try to recover
      // before tearing everything down.
      try {
        await Promise.race([
          entersState(connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        log.info(`connection lost in ${this.guildId}, leaving`);
        this.stop();
      }
    });

    await entersState(connection, VoiceConnectionStatus.Ready, 20_000);
    connection.subscribe(this.player);
    log.info(`joined ${channel.id} in ${this.guildId}`);
  }

  /** Point this guild's playback at a bridge session. */
  async play(session: SessionSummary): Promise<void> {
    const nowPlaying = session.nowPlaying;
    if (!nowPlaying) throw new Error("that device has not reported a track yet");

    this.sessionId = session.sessionId;
    this.closeCurrent();

    switch (nowPlaying.source.kind) {
      case "relay": {
        const stream = await bridge.openAudioStream(session.sessionId);
        this.current = stream;
        // Raw PCM from the bridge: already 48 kHz stereo, so no transcode.
        this.player.play(createAudioResource(stream, { inputType: StreamType.Raw }));
        break;
      }
      case "url": {
        const url = nowPlaying.source.url;
        if (!url) throw new Error("the device sent a url source without a url");
        // ffmpeg handles the fetch and decode, so any format Discord can't
        // take natively still works.
        this.player.play(createAudioResource(url, { inputType: StreamType.Arbitrary }));
        break;
      }
      case "metadata":
        throw new Error(
          "that track is metadata-only, so there is no audio to play. Switch the source to `url` or `relay` in your app.",
        );
    }
  }

  pause(): boolean {
    return this.player.pause();
  }

  resume(): boolean {
    return this.player.unpause();
  }

  private closeCurrent(): void {
    this.current?.destroy();
    this.current = null;
  }

  stop(): void {
    this.player.stop(true);
    this.closeCurrent();
    this.connection?.destroy();
    this.connection = null;
    this.channelId = null;
    this.sessionId = null;
  }
}

const players = new Map<string, GuildPlayer>();

export function playerFor(guildId: string): GuildPlayer {
  let player = players.get(guildId);
  if (!player) {
    player = new GuildPlayer(guildId);
    players.set(guildId, player);
  }
  return player;
}

export function existingPlayer(guildId: string): GuildPlayer | undefined {
  return players.get(guildId);
}

export function destroyAllPlayers(): void {
  for (const player of players.values()) player.stop();
  players.clear();
}

/** Keep the embed text in one place so every command agrees on wording. */
export function describeTrack(nowPlaying: NowPlaying): string {
  const artist = nowPlaying.artist ? ` — ${nowPlaying.artist}` : "";
  return `**${nowPlaying.title}**${artist}`;
}

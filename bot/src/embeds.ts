import { EmbedBuilder } from "discord.js";
import type { NowPlaying, SessionSummary } from "@dmb/shared";

function formatDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const minutes = Math.floor(total / 60);
  const seconds = total % 60;
  return `${minutes}:${seconds.toString().padStart(2, "0")}`;
}

/** A text progress bar, because Discord embeds have no real progress widget. */
function progressBar(positionMs: number, durationMs: number, width = 18): string {
  const ratio = Math.min(1, Math.max(0, positionMs / durationMs));
  const filled = Math.round(ratio * width);
  return `${"─".repeat(filled)}●${"─".repeat(Math.max(0, width - filled))}`;
}

const STATE_LABEL: Record<NowPlaying["state"], string> = {
  playing: "▶ Playing",
  paused: "⏸ Paused",
  stopped: "⏹ Stopped",
};

export function nowPlayingEmbed(session: SessionSummary): EmbedBuilder {
  const embed = new EmbedBuilder()
    .setColor(session.online ? 0x5865f2 : 0x747f8d)
    .setFooter({ text: `${session.device.name}${session.online ? "" : " (offline)"}` })
    .setTimestamp();

  const track = session.nowPlaying;
  if (!track) {
    return embed.setTitle("Nothing playing").setDescription("Your app hasn't reported a track yet.");
  }

  embed.setTitle(track.title);
  if (track.artist) embed.setAuthor({ name: track.artist });
  if (track.album) embed.addFields({ name: "Album", value: track.album, inline: true });
  if (track.artworkUrl) embed.setThumbnail(track.artworkUrl);

  embed.addFields({ name: "Status", value: STATE_LABEL[track.state], inline: true });

  if (track.durationMs && track.durationMs > 0) {
    const position = track.positionMs ?? 0;
    embed.setDescription(
      `\`${formatDuration(position)}\` ${progressBar(position, track.durationMs)} \`${formatDuration(track.durationMs)}\``,
    );
  }

  return embed;
}

export function linkInstructionsEmbed(code: string, expiresAt: number): EmbedBuilder {
  const relative = `<t:${Math.floor(expiresAt / 1000)}:R>`;
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setTitle("Link your music app")
    .setDescription(
      [
        `Open your app, go to its Discord settings, and enter this code:`,
        "",
        `# \`${code}\``,
        "",
        `It expires ${relative}. Nobody else can see this message.`,
      ].join("\n"),
    );
}

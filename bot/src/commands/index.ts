import {
  ChannelType,
  MessageFlags,
  SlashCommandBuilder,
  type ChatInputCommandInteraction,
  type GuildMember,
} from "discord.js";
import type { RemoteCommandName } from "@dmb/shared";
import { bridge } from "../bridgeClient.js";
import { linkInstructionsEmbed, nowPlayingEmbed } from "../embeds.js";
import { existingPlayer, playerFor } from "../player.js";

type Handler = (interaction: ChatInputCommandInteraction) => Promise<void>;

interface Command {
  data: SlashCommandBuilder;
  handler: Handler;
}

/** Reply only to the person who ran the command. */
function ephemeral(interaction: ChatInputCommandInteraction, content: string): Promise<unknown> {
  if (interaction.deferred || interaction.replied) {
    return interaction.editReply({ content });
  }
  return interaction.reply({ content, flags: MessageFlags.Ephemeral });
}

/** Resolve the caller's linked session, or explain how to get one. */
function requireSession(interaction: ChatInputCommandInteraction) {
  const session = bridge.sessionForUser(interaction.guildId!, interaction.user.id);
  if (!session) throw new Error("You haven't linked a device yet. Run `/link` first.");
  return session;
}

function requireVoiceChannel(interaction: ChatInputCommandInteraction) {
  const member = interaction.member as GuildMember | null;
  const channel = member?.voice.channel;
  if (!channel) throw new Error("Join a voice channel first, then run this again.");
  if (channel.type !== ChannelType.GuildVoice && channel.type !== ChannelType.GuildStageVoice) {
    throw new Error("That channel isn't a voice channel I can join.");
  }
  const me = interaction.guild?.members.me;
  if (me && !channel.permissionsFor(me).has(["Connect", "Speak"])) {
    throw new Error(`I need **Connect** and **Speak** permissions in ${channel.name}.`);
  }
  return channel;
}

/** /skip, /pause and friends all do the same thing with a different verb. */
function remoteCommand(name: RemoteCommandName, past: string): Handler {
  return async (interaction) => {
    const session = requireSession(interaction);
    await bridge.sendCommand(session.sessionId, name, {
      userId: interaction.user.id,
      username: interaction.user.username,
    });
    await interaction.reply({ content: `${past} — asked your app to ${name}.` });
  };
}

const commands: Command[] = [
  {
    data: new SlashCommandBuilder()
      .setName("link")
      .setDescription("Get a code to connect your music app to this server"),
    handler: async (interaction) => {
      const { code, expiresAt } = await bridge.requestPairingCode(
        interaction.guildId!,
        interaction.user.id,
      );
      await interaction.reply({
        embeds: [linkInstructionsEmbed(code, expiresAt)],
        flags: MessageFlags.Ephemeral,
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("unlink")
      .setDescription("Disconnect your music app from this server"),
    handler: async (interaction) => {
      const session = requireSession(interaction);
      await bridge.unlink(session.sessionId);
      const player = existingPlayer(interaction.guildId!);
      if (player?.sessionId === session.sessionId) player.stop();
      await ephemeral(interaction, "Unlinked. Your app can no longer play here.");
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("play")
      .setDescription("Bring your app's audio into your voice channel"),
    handler: async (interaction) => {
      const session = requireSession(interaction);
      const channel = requireVoiceChannel(interaction);

      // Joining and buffering both take a moment; defer so Discord doesn't
      // time the interaction out at 3 seconds.
      await interaction.deferReply();
      const player = playerFor(interaction.guildId!);
      await player.join(channel);
      await player.play(session);

      await interaction.editReply({
        content: `Playing from **${session.device.name}** in ${channel.name}.`,
        embeds: [nowPlayingEmbed(session)],
      });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("stop")
      .setDescription("Stop playing and leave the voice channel"),
    handler: async (interaction) => {
      const player = existingPlayer(interaction.guildId!);
      if (!player?.isConnected) throw new Error("I'm not in a voice channel here.");
      player.stop();
      await interaction.reply({ content: "Stopped and left the channel." });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("nowplaying")
      .setDescription("Show what your app is playing"),
    handler: async (interaction) => {
      const session = requireSession(interaction);
      await interaction.reply({ embeds: [nowPlayingEmbed(session)] });
    },
  },
  {
    data: new SlashCommandBuilder()
      .setName("status")
      .setDescription("Show the devices linked to this server"),
    handler: async (interaction) => {
      const sessions = [...bridge.sessions.values()].filter(
        (s) => s.guildId === interaction.guildId,
      );
      if (sessions.length === 0) {
        await ephemeral(interaction, "No devices are linked here yet. Run `/link` to add one.");
        return;
      }
      const lines = sessions.map((s) => {
        const state = s.online ? "online" : "offline";
        const track = s.nowPlaying ? `${s.nowPlaying.title}` : "nothing";
        return `• **${s.device.name}** (${state}) — ${track}`;
      });
      await ephemeral(interaction, lines.join("\n"));
    },
  },
  {
    data: new SlashCommandBuilder().setName("skip").setDescription("Skip to the next track"),
    handler: remoteCommand("skip", "Skipped"),
  },
  {
    data: new SlashCommandBuilder().setName("previous").setDescription("Go to the previous track"),
    handler: remoteCommand("previous", "Went back"),
  },
  {
    data: new SlashCommandBuilder().setName("pause").setDescription("Pause playback"),
    handler: async (interaction) => {
      const session = requireSession(interaction);
      existingPlayer(interaction.guildId!)?.pause();
      await bridge.sendCommand(session.sessionId, "pause", {
        userId: interaction.user.id,
        username: interaction.user.username,
      });
      await interaction.reply({ content: "Paused." });
    },
  },
  {
    data: new SlashCommandBuilder().setName("resume").setDescription("Resume playback"),
    handler: async (interaction) => {
      const session = requireSession(interaction);
      existingPlayer(interaction.guildId!)?.resume();
      await bridge.sendCommand(session.sessionId, "play", {
        userId: interaction.user.id,
        username: interaction.user.username,
      });
      await interaction.reply({ content: "Resumed." });
    },
  },
];

export const commandData = commands.map((c) => c.data.toJSON());

const byName = new Map(commands.map((c) => [c.data.name, c]));

export async function dispatch(interaction: ChatInputCommandInteraction): Promise<void> {
  const command = byName.get(interaction.commandName);
  if (!command) {
    await ephemeral(interaction, "That command no longer exists. Try re-inviting the bot.");
    return;
  }
  await command.handler(interaction);
}

export { ephemeral };

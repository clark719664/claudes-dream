import { Client, Events, GatewayIntentBits, MessageFlags } from "discord.js";
import { bridge } from "./bridgeClient.js";
import { commandData, dispatch } from "./commands/index.js";
import { config } from "./config.js";
import { logger } from "./log.js";
import { destroyAllPlayers, existingPlayer } from "./player.js";

const log = logger("bot");

const client = new Client({
  // Voice needs GuildVoiceStates; nothing here reads message content.
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});

client.once(Events.ClientReady, async (ready) => {
  log.info(`logged in as ${ready.user.tag}`);
  try {
    if (config.devGuildId) {
      const guild = await ready.guilds.fetch(config.devGuildId);
      await guild.commands.set(commandData);
      log.info(`registered ${commandData.length} guild commands in ${config.devGuildId}`);
    } else {
      await ready.application.commands.set(commandData);
      log.info(`registered ${commandData.length} global commands`);
    }
  } catch (error) {
    log.error(`could not register commands: ${(error as Error).message}`);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand()) return;
  if (!interaction.inGuild()) {
    await interaction.reply({
      content: "This only works inside a server, not in DMs.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    await dispatch(interaction);
  } catch (error) {
    // Handlers throw plain Errors with user-facing wording; anything else is
    // a bug and gets a generic message plus a log line.
    const message =
      error instanceof Error ? error.message : "Something went wrong running that command.";
    log.warn(`/${interaction.commandName} failed: ${message}`);
    const payload = { content: `⚠️ ${message}` };
    try {
      if (interaction.deferred || interaction.replied) await interaction.editReply(payload);
      else await interaction.reply({ ...payload, flags: MessageFlags.Ephemeral });
    } catch {
      // The interaction expired; nothing more we can do.
    }
  }
});

// If the phone disappears, don't sit in the channel playing silence forever.
bridge.on("event", (event) => {
  if (event.t !== "session.down") return;
  for (const guild of client.guilds.cache.values()) {
    const player = existingPlayer(guild.id);
    if (player?.sessionId === event.sessionId) {
      log.info(`session ${event.sessionId} went away, leaving ${guild.id}`);
      player.stop();
    }
  }
});

bridge.connect();
await client.login(config.token);

function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  destroyAllPlayers();
  bridge.close();
  void client.destroy().finally(() => process.exit(0));
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

/**
 * Registers slash commands without starting the bot. The bot also does this
 * on startup, so this is only needed when you want to push a command change
 * without a restart, or to clear commands.
 */
import { REST, Routes } from "discord.js";
import { commandData } from "./commands/index.js";
import { config } from "./config.js";
import { logger } from "./log.js";

const log = logger("deploy");
const rest = new REST().setToken(config.token);

const route = config.devGuildId
  ? Routes.applicationGuildCommands(config.clientId, config.devGuildId)
  : Routes.applicationCommands(config.clientId);

await rest.put(route, { body: commandData });
log.info(
  `registered ${commandData.length} commands ${config.devGuildId ? `to guild ${config.devGuildId}` : "globally"}`,
);

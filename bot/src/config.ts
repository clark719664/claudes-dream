function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example for what it should contain.`,
    );
  }
  return value;
}

const bridgeUrl = new URL(process.env.BRIDGE_URL ?? "http://127.0.0.1:8080");

export const config = {
  token: required("DISCORD_TOKEN"),
  clientId: required("DISCORD_CLIENT_ID"),
  /**
   * Set this while developing: guild commands appear instantly, whereas
   * global commands can take up to an hour to propagate.
   */
  devGuildId: process.env.DISCORD_GUILD_ID ?? null,
  bridgeHttp: bridgeUrl.origin,
  bridgeWs: `${bridgeUrl.protocol === "https:" ? "wss:" : "ws:"}//${bridgeUrl.host}`,
  bridgeSecret: required("BRIDGE_SECRET"),
};

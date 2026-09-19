function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. See .env.example for what it should contain.`,
    );
  }
  return value;
}

function int(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) throw new Error(`${name} must be an integer, got "${raw}"`);
  return parsed;
}

export const config = {
  port: int("BRIDGE_PORT", 8080),
  /** Shared secret the bot presents. The device never sees this. */
  secret: required("BRIDGE_SECRET"),
  /** How long a pairing code stays valid. */
  pairingTtlMs: int("BRIDGE_PAIRING_TTL_MS", 5 * 60 * 1000),
  /**
   * How much relayed audio to hold before playing. Higher survives worse
   * mobile networks at the cost of latency. 1500 ms is a sane phone default.
   */
  prebufferMs: int("BRIDGE_PREBUFFER_MS", 1500),
  /** Hard cap on queued audio per listener; beyond this we drop oldest frames. */
  maxBufferMs: int("BRIDGE_MAX_BUFFER_MS", 10_000),
  /** Drop a device session this long after its socket goes away. */
  sessionGraceMs: int("BRIDGE_SESSION_GRACE_MS", 60_000),
};

export type Config = typeof config;

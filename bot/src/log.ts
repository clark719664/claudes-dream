type Level = "debug" | "info" | "warn" | "error";

const levels: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = levels[(process.env.LOG_LEVEL as Level) ?? "info"] ?? levels.info;

function emit(level: Level, scope: string, message: string, extra?: unknown): void {
  if (levels[level] < threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} [${scope}] ${message}`;
  if (extra === undefined) console.log(line);
  else console.log(line, extra);
}

export function logger(scope: string) {
  return {
    debug: (m: string, e?: unknown) => emit("debug", scope, m, e),
    info: (m: string, e?: unknown) => emit("info", scope, m, e),
    warn: (m: string, e?: unknown) => emit("warn", scope, m, e),
    error: (m: string, e?: unknown) => emit("error", scope, m, e),
  };
}

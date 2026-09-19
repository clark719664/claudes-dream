import { createServer } from "node:http";
import { config } from "./config.js";
import { handleRequest } from "./http.js";
import { logger } from "./log.js";
import { handleUpgrade, startHeartbeat } from "./ws.js";

const log = logger("bridge");

const server = createServer((req, res) => {
  handleRequest(req, res).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : "unknown error";
    log.error(`${req.method} ${req.url} failed: ${message}`);
    if (!res.headersSent) {
      res.writeHead(400, { "content-type": "application/json" });
      res.end(JSON.stringify({ error: message }));
    } else {
      res.destroy();
    }
  });
});

server.on("upgrade", handleUpgrade);

const heartbeat = startHeartbeat();

server.listen(config.port, () => {
  log.info(`listening on :${config.port}`);
});

function shutdown(signal: string): void {
  log.info(`${signal} received, shutting down`);
  clearInterval(heartbeat);
  server.close(() => process.exit(0));
  // Don't let a stuck socket hold the process open forever.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on("SIGINT", () => shutdown("SIGINT"));
process.on("SIGTERM", () => shutdown("SIGTERM"));

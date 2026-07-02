import app from "./app";
import { logger } from "./lib/logger";
import { startBot } from "./bot/index";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");

  // Start Discord bot alongside the HTTP server
  startBot().catch((err) => {
    logger.error({ err }, "Failed to start Discord bot");
  });

  // Self-ping every 4 minutes to prevent Replit from sleeping
  const selfPingUrl = `http://localhost:${port}/api/healthz`;
  setInterval(() => {
    fetch(selfPingUrl).catch(() => {
      // silently ignore — server might be momentarily busy
    });
  }, 4 * 60 * 1000);
});

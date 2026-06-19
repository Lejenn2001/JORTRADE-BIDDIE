import app from "./app";
import { logger } from "./lib/logger";
import { startPaperTradeMonitor } from "./lib/paperTradeMonitor";
import { refreshMarketCalendarFromPolygon } from "./lib/marketHours";

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

  setTimeout(async () => {
    try {
      const res = await fetch(`http://localhost:${port}/api/whale/signals`);
      const data = await res.json();
      logger.info({ count: data.count }, "Cache pre-warmed on startup");
    } catch (e) {
      logger.warn("Cache pre-warm failed (non-critical)");
    }
  }, 1000);

  startPaperTradeMonitor();

  // Seed the holiday / early-close calendar from Polygon's official feed, then
  // refresh once a day. Static table is the fallback if this never succeeds.
  void refreshMarketCalendarFromPolygon();
  setInterval(
    () => void refreshMarketCalendarFromPolygon(),
    24 * 60 * 60 * 1000,
  );
});

import app from "./app";
import { logger } from "./lib/logger";
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { config as radarConfig } from "../radar-core/src/config.js";
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { getDb as getRadarDb, closeDb as closeRadarDb } from "../radar-core/src/db/index.js";
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { startScheduler } from "../radar-core/src/services/connector-runner.js";
// @ts-expect-error The uploaded JavaScript core intentionally has no TS declarations.
import { schemaReady } from "../radar-core/src/app.js";

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

type SchedulerEvent = {
  level: "debug" | "info" | "error";
  event: string;
  [key: string]: unknown;
};

const server = app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

// The radar core's connector schedules and due-score refresh (time decay)
// only happen when something ticks the in-process scheduler. This host is
// the only runtime for the core, so it owns that responsibility.
let stopScheduler: () => Promise<void> = async () => {};
const radarDb = getRadarDb();
if (radarConfig.schedulerEnabled && !schemaReady(radarDb)) {
  // Production never runs DDL; /api/ready already reports schema_out_of_date.
  // Running connectors or rescoring against a stale schema would fail on
  // missing columns, so leave the scheduler off until the schema is migrated.
  logger.error(
    "Radar scheduler not started: database schema is out of date (see /api/ready)",
  );
} else if (radarConfig.schedulerEnabled) {
  const intervalMs: number = radarConfig.schedulerIntervalMs;
  stopScheduler = startScheduler(radarDb, intervalMs, {
    onEvent: ({ level, event, ...details }: SchedulerEvent) => {
      logger[level]({ ...details, event }, `scheduler: ${event}`);
    },
  });
  logger.info(
    { interval_ms: intervalMs },
    "Radar scheduler started (connector schedules + due-score refresh)",
  );
} else {
  logger.warn(
    "Radar scheduler disabled by SCHEDULER_ENABLED; connector schedules and due-score refresh will not run automatically",
  );
}

let shuttingDown = false;
async function shutdown(signal: NodeJS.Signals) {
  if (shuttingDown) return;
  shuttingDown = true;
  logger.info({ signal }, "Server stopping");
  const forceExit = setTimeout(() => {
    logger.error("Shutdown timed out; exiting");
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  try {
    await stopScheduler();
  } catch (err) {
    logger.error({ err }, "Error stopping scheduler");
  }

  server.close(() => {
    try {
      closeRadarDb();
    } catch (err) {
      logger.error({ err }, "Error closing radar database");
    }
    process.exit(0);
  });
  server.closeIdleConnections?.();
}

process.on("SIGTERM", () => void shutdown("SIGTERM"));
process.on("SIGINT", () => void shutdown("SIGINT"));

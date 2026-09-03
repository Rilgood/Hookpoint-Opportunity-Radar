import http from 'node:http';
import { config } from './config.js';
import { getDb, closeDb } from './db/index.js';
import { createApp, log } from './app.js';
import { startScheduler } from './services/connector-runner.js';

const db = getDb();
const handler = createApp(db, { serveStaticAssets: true });
const server = http.createServer(handler);
const stopScheduler = config.schedulerEnabled ? startScheduler(db, config.schedulerIntervalMs) : () => {};

server.listen(config.port, config.host, () => log('info', 'server_started', {
  host: config.host,
  port: config.port,
  env: config.env,
  auth_required: config.authRequired
}));

function shutdown(signal) {
  log('info', 'server_stopping', { signal });
  stopScheduler();
  server.close(() => { closeDb(); process.exit(0); });
  setTimeout(() => process.exit(1), 10_000).unref();
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

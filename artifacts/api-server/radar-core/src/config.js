import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function loadDotEnv(file = path.join(rootDir, '.env')) {
  if (!fs.existsSync(file)) return;
  for (const rawLine of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const equal = line.indexOf('=');
    if (equal < 1) continue;
    const key = line.slice(0, equal).trim();
    let value = line.slice(equal + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const boolean = (value, fallback = false) => {
  if (value == null || value === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase());
};

const databaseSetting = process.env.DATABASE_PATH || './data/hookpoint-radar.sqlite';
const databasePath = databaseSetting === ':memory:' ? ':memory:' : path.resolve(rootDir, databaseSetting);
// A Postgres URL (Replit injects DATABASE_URL for its managed database) takes
// precedence over the embedded SQLite file: it is the only store that survives
// restarts and scale-out of the published API.
const databaseUrl = /^postgres(ql)?:\/\//i.test(String(process.env.DATABASE_URL || '')) ? String(process.env.DATABASE_URL).trim() : '';
const isEphemeralDatabase = !databaseUrl && (databasePath === ':memory:' || databasePath === '/tmp' || databasePath.startsWith('/tmp/'));
const storageMode = databaseUrl ? 'postgres' : (isEphemeralDatabase ? 'ephemeral_sqlite' : 'persistent_sqlite');

export const config = Object.freeze({
  rootDir,
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8787),
  databasePath,
  databaseUrl,
  databaseTarget: databaseUrl || databasePath,
  databaseSchema: String(process.env.RADAR_DB_SCHEMA || 'radar').trim(),
  databaseStatementTimeoutMs: Number(process.env.DB_STATEMENT_TIMEOUT_MS || 30_000),
  // Schema ownership: outside production the process applies schema.js and
  // pending migrations on start. In production the publish flow copies the
  // development schema to the production database, so the process only
  // verifies it (see src/db/index.js) and never issues DDL.
  manageSchema: process.env.NODE_ENV !== 'production',
  storageMode,
  isEphemeralDatabase,
  allowEphemeralStorage: boolean(process.env.ALLOW_EPHEMERAL_STORAGE, process.env.NODE_ENV !== 'production'),
  // Managed Postgres is durable by construction; the confirmation flag only
  // guards SQLite files, whose durability depends on where they are mounted.
  durableStorageConfirmed: Boolean(databaseUrl) || boolean(process.env.DURABLE_STORAGE_CONFIRMED, process.env.NODE_ENV !== 'production'),
  logLevel: process.env.LOG_LEVEL || 'info',
  authRequired: boolean(process.env.AUTH_REQUIRED, process.env.NODE_ENV === 'production'),
  defaultTenantId: process.env.DEFAULT_TENANT_ID || 'tenant_hookpoint',
  adminApiKey: String(process.env.ADMIN_API_KEY || '').trim(),
  webhookSecret: String(process.env.CONNECTOR_WEBHOOK_SECRET || '').trim(),
  hashSalt: String(process.env.HASH_SALT || '').trim(),
  allowedOrigins: (process.env.ALLOWED_ORIGINS || 'http://localhost:8787').split(',').map((x) => x.trim()).filter(Boolean),
  schedulerEnabled: boolean(process.env.SCHEDULER_ENABLED, true),
  schedulerIntervalMs: Number(process.env.SCHEDULER_INTERVAL_MS || 60_000),
  maxBodyBytes: Number(process.env.MAX_BODY_BYTES || 5_000_000),
  maxBatchRecords: Number(process.env.MAX_BATCH_RECORDS || 5_000),
  maxExportRows: Number(process.env.MAX_EXPORT_ROWS || 50_000),
  maxFutureSkewMinutes: Number(process.env.MAX_FUTURE_SKEW_MINUTES || 60),
  connectorTimeoutMs: Number(process.env.CONNECTOR_TIMEOUT_MS || 45_000),
  connectorMaxRecords: Number(process.env.CONNECTOR_MAX_RECORDS || 5_000),
  rescoreBatchSize: Number(process.env.RESCORE_BATCH_SIZE || 500),
  rateLimitPerMinute: Number(process.env.RATE_LIMIT_PER_MINUTE || 600),
  trustProxy: boolean(process.env.TRUST_PROXY, Boolean(process.env.VERCEL)),
  publicDir: path.join(rootDir, 'public'),
  signalCatalogPath: path.join(rootDir, 'config', 'signal-catalog.json'),
  connectorCatalogPath: path.join(rootDir, 'config', 'connector-catalog.json'),
  scoringConfigPath: path.join(rootDir, 'config', 'scoring.json')
});

export function runtimeIssues(db) {
  const issues = [];
  if (config.env === 'production' && !config.authRequired) issues.push({ code: 'authentication_disabled', severity: 'critical', message: 'AUTH_REQUIRED must be true in production.' });
  if (config.authRequired && (!config.hashSalt || config.hashSalt.length < 32)) issues.push({ code: 'weak_hash_salt', severity: 'critical', message: 'HASH_SALT must contain at least 32 characters when authentication is enabled.' });
  if (config.adminApiKey && config.adminApiKey.length < 32) issues.push({ code: 'weak_admin_api_key', severity: 'critical', message: 'ADMIN_API_KEY must contain at least 32 characters.' });
  if (config.webhookSecret && config.webhookSecret.length < 32) issues.push({ code: 'weak_webhook_secret', severity: 'critical', message: 'CONNECTOR_WEBHOOK_SECRET must contain at least 32 characters.' });
  if (config.env === 'production' && config.isEphemeralDatabase && !config.allowEphemeralStorage) issues.push({ code: 'ephemeral_storage', severity: 'critical', message: 'Durable storage is required before production ingestion.' });
  if (config.env === 'production' && !config.isEphemeralDatabase && !config.durableStorageConfirmed) issues.push({ code: 'durability_unconfirmed', severity: 'critical', message: 'Set DURABLE_STORAGE_CONFIRMED=true only after verifying the database path is on a backed-up durable volume.' });
  if (db?.schemaStatus && !db.schemaStatus.ok) issues.push({ code: 'schema_out_of_date', severity: 'critical', message: `The database schema is behind migration ${db.schemaStatus.expectedVersion} (missing ${db.schemaStatus.missing.slice(0, 3).join(', ')}${db.schemaStatus.missing.length > 3 ? ', …' : ''}). Publish again so the development schema is applied to production.` });
  // Every check below reads application tables; skip them while the schema is
  // behind so a missing table reports schema_out_of_date instead of a 500.
  const schemaUsable = !db?.schemaStatus || db.schemaStatus.ok;
  if (config.authRequired && db && schemaUsable) {
    const count = db.get('SELECT COUNT(*) count FROM api_keys WHERE revoked_at IS NULL')?.count || 0;
    if (!count) issues.push({ code: 'no_active_api_key', severity: 'critical', message: 'Configure ADMIN_API_KEY or provision an API key before use.' });
  }
  if (config.allowedOrigins.includes('*')) issues.push({ code: 'wildcard_cors', severity: 'warning', message: 'Use explicit ALLOWED_ORIGINS values.' });
  if (config.env === 'production' && config.allowedOrigins.some((origin) => origin.includes('localhost'))) issues.push({ code: 'development_cors_origin', severity: 'warning', message: 'Replace localhost in ALLOWED_ORIGINS for production.' });
  const positiveIntegers = [config.maxBodyBytes, config.maxBatchRecords, config.maxExportRows, config.connectorTimeoutMs,
    config.connectorMaxRecords, config.rescoreBatchSize, config.rateLimitPerMinute];
  const numericValid = Number.isInteger(config.port) && config.port >= 1 && config.port <= 65_535
    && Number.isFinite(config.schedulerIntervalMs) && config.schedulerIntervalMs >= 5_000
    && Number.isFinite(config.maxFutureSkewMinutes) && config.maxFutureSkewMinutes > 0
    && positiveIntegers.every((value) => Number.isInteger(value) && value > 0);
  if (!numericValid) issues.push({ code: 'invalid_numeric_configuration', severity: 'critical', message: 'Numeric environment settings are outside their supported ranges.' });
  return issues;
}

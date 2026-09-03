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
const isEphemeralDatabase = databasePath === ':memory:' || databasePath === '/tmp' || databasePath.startsWith('/tmp/');

export const config = Object.freeze({
  rootDir,
  env: process.env.NODE_ENV || 'development',
  host: process.env.HOST || '0.0.0.0',
  port: Number(process.env.PORT || 8787),
  databasePath,
  storageMode: isEphemeralDatabase ? 'ephemeral_sqlite' : 'persistent_sqlite',
  isEphemeralDatabase,
  allowEphemeralStorage: boolean(process.env.ALLOW_EPHEMERAL_STORAGE, process.env.NODE_ENV !== 'production'),
  durableStorageConfirmed: boolean(process.env.DURABLE_STORAGE_CONFIRMED, process.env.NODE_ENV !== 'production'),
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
  if (config.authRequired && db) {
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

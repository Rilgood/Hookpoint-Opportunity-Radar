#!/usr/bin/env node
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { schemaManifest } from '../artifacts/api-server/radar-core/src/db/schema-manifest.js';
import { isEphemeralSqlitePath } from '../artifacts/api-server/radar-core/src/storage-path.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const booleanValues = new Set(['true', 'false', '1', '0', 'yes', 'no', 'on', 'off']);
const truthy = new Set(['true', '1', 'yes', 'on']);
const placeholder = (value) => /replace|placeholder|change.?me|your[_-]|<[^>]+>/i.test(value);

/** Pure configuration inspection: no dotenv loading, DB connections or provider calls. */
export function inspectProductionEnv(env, { runtimeOnly = false, firstDeploy = false, nodeMajor = Number(process.versions.node.split('.')[0]) } = {}) {
  const issues = [];
  const value = (key) => String(env[key] ?? '').trim();
  const add = (severity, field, code, message, action) => issues.push({ severity, field, code, message, action });
  const error = (field, code, message, action) => add('error', field, code, message, action);
  const warn = (field, code, message, action) => add('warning', field, code, message, action);
  const bool = (field, fallback) => {
    const raw = value(field).toLowerCase();
    const whitespace = env[field] != null && String(env[field]) !== String(env[field]).trim();
    if (whitespace || (raw && !booleanValues.has(raw))) error(field, 'invalid_boolean', `${field} is not a recognized boolean.`, 'Use true or false without surrounding whitespace.');
    if (!raw) return fallback;
    return truthy.has(raw);
  };
  const integer = (field, fallback, min = 1, max = Number.MAX_SAFE_INTEGER) => {
    const raw = value(field);
    const parsed = Number(raw || fallback);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) error(field, 'invalid_integer', `${field} is outside its supported range.`, `Set an integer from ${min} to ${max === Number.MAX_SAFE_INTEGER ? 'the safe integer maximum' : max}.`);
    return parsed;
  };
  const secret = (field, { required = true, pattern } = {}) => {
    const raw = value(field);
    if (!raw) {
      if (required) error(field, 'missing_setting', `${field} is missing.`, `Provision ${field} in your deployment's secret manager.`);
      return false;
    }
    if (placeholder(raw) || raw.length < 32 || (pattern && !pattern.test(raw))) {
      error(field, 'invalid_secret_shape', `${field} is a placeholder, too short or has an invalid format.`, `Provision a valid ${field}; values are never printed by this command.`);
      return false;
    }
    return true;
  };
  const publicKey = (field) => {
    const raw = value(field);
    if (!raw) return error(field, 'missing_setting', `${field} is missing.`, `Set the Clerk publishable key for ${field}; publishable keys belong to the same Clerk instance as the server secret.`);
    const match = /^pk_(live|test)_([A-Za-z0-9+/_=-]+)$/.exec(raw);
    const decoded = match ? Buffer.from(match[2], 'base64').toString('utf8') : '';
    if (!match || !/^[a-z0-9.-]+\$$/i.test(decoded) || placeholder(raw)) error(field, 'invalid_publishable_key', `${field} has an invalid publishable-key shape.`, 'Copy the publishable key from the intended Clerk instance.');
    else if (match[1] !== 'live') error(field, 'development_clerk_key', `${field} is a development key.`, 'Use the production Clerk instance for a production launch; local rehearsals use separate placeholders.');
  };

  if (nodeMajor < 24) error('NODE_VERSION', 'unsupported_node', 'The runtime needs Node.js 24 or newer.', 'Use the same supported Node.js major version for build, migration and API startup.');
  if (value('NODE_ENV') !== 'production') error('NODE_ENV', 'production_mode_required', 'NODE_ENV must be production for this preflight.', 'Run this command with the production deployment environment.');
  if (!bool('AUTH_REQUIRED', true)) error('AUTH_REQUIRED', 'authentication_disabled', 'The API cannot serve production traffic with authentication disabled.', 'Set AUTH_REQUIRED=true.');
  for (const field of ['HOOKPOINT_LOCAL_DEMO', 'VITE_LOCAL_DEMO']) if (bool(field, false)) error(field, 'demo_mode_enabled', `${field} is enabled.`, 'Remove local-workspace flags from production build and runtime environments.');
  integer('PORT', NaN, 1, 65535);
  secret('HASH_SALT');
  if (value('ADMIN_API_KEY')) secret('ADMIN_API_KEY');
  else if (firstDeploy) secret('ADMIN_API_KEY');
  else warn('ADMIN_API_KEY', 'bootstrap_key_absent', 'No bootstrap key is supplied; readiness requires an existing active API key in the database.', 'For a first deployment, provision ADMIN_API_KEY and run with --first-deploy. For an existing database, verify its active-key readiness via /api/ready.');
  secret('CLERK_SECRET_KEY', { pattern: /^sk_(live|test)_[A-Za-z0-9_-]+$/ });
  if (value('CLERK_SECRET_KEY').startsWith('sk_test_')) error('CLERK_SECRET_KEY', 'development_clerk_key', 'CLERK_SECRET_KEY belongs to a development instance.', 'Provision the production Clerk secret before launch.');
  publicKey('CLERK_PUBLISHABLE_KEY');
  if (!runtimeOnly) {
    publicKey('VITE_CLERK_PUBLISHABLE_KEY');
    if (value('VITE_CLERK_PUBLISHABLE_KEY') && value('CLERK_PUBLISHABLE_KEY') && value('VITE_CLERK_PUBLISHABLE_KEY') !== value('CLERK_PUBLISHABLE_KEY')) warn('VITE_CLERK_PUBLISHABLE_KEY', 'clerk_key_mismatch', 'Browser and server publishable keys differ.', 'Confirm both target the same Clerk instance and intended custom-domain setup.');
    const basePath = value('BASE_PATH') || '/';
    if (!basePath.startsWith('/') || basePath.startsWith('//') || /[?#]/.test(basePath)) error('BASE_PATH', 'invalid_base_path', 'BASE_PATH must be an absolute URL path.', 'Use / for the standard path-routed deployment.');
    const proxy = value('VITE_CLERK_PROXY_URL');
    if (proxy && !(proxy.startsWith('/') && !proxy.startsWith('//')) && !/^https:\/\//.test(proxy)) error('VITE_CLERK_PROXY_URL', 'invalid_clerk_proxy', 'The browser Clerk proxy must be a same-origin path or HTTPS URL.', 'Use the proxy URL supplied by the deployment integration.');
  }

  let storageMode = 'unconfigured';
  const databaseUrl = value('DATABASE_URL');
  if (databaseUrl) {
    let parsed;
    try { parsed = new URL(databaseUrl); } catch { /* Report only a field name, never the URL. */ }
    if (!parsed || !['postgres:', 'postgresql:'].includes(parsed.protocol) || !parsed.hostname || !parsed.pathname.slice(1) || placeholder(databaseUrl) || String(env.DATABASE_URL) !== databaseUrl) {
      error('DATABASE_URL', 'invalid_database_url', 'DATABASE_URL must be a PostgreSQL URL naming a database.', 'Provision the target Postgres database and inject its connection URL without surrounding whitespace.');
    } else {
      storageMode = 'postgres';
      if (!['localhost', '127.0.0.1', '[::1]'].includes(parsed.hostname) && !parsed.searchParams.has('sslmode')) warn('DATABASE_URL', 'database_tls_unverified', 'The Postgres URL does not state a TLS mode.', 'Confirm the provider requires and verifies TLS; this command does not connect to the database.');
      if (parsed.searchParams.get('sslmode') === 'disable') warn('DATABASE_URL', 'database_tls_disabled', 'The Postgres URL explicitly disables TLS.', 'Use a secured private transport or the database provider’s verified TLS configuration.');
    }
  } else {
    const rawPath = value('DATABASE_PATH');
    if (!rawPath) error('DATABASE_URL', 'storage_not_explicit', 'Production storage has not been explicitly configured.', 'Set DATABASE_URL for durable Postgres, or configure a verified persistent SQLite volume explicitly.');
    else {
      const resolved = rawPath === ':memory:' ? rawPath : path.resolve(root, 'artifacts/api-server', rawPath);
      if (isEphemeralSqlitePath(resolved)) {
        storageMode = 'ephemeral_sqlite';
        error('DATABASE_PATH', 'ephemeral_production_storage', 'SQLite is configured in memory or a temporary directory.', 'Use durable Postgres or a backed-up persistent volume. Rehearsal storage is intentionally temporary and cannot pass launch preflight.');
      } else {
        storageMode = 'persistent_sqlite_candidate';
        if (!bool('DURABLE_STORAGE_CONFIRMED', false)) error('DURABLE_STORAGE_CONFIRMED', 'durability_unconfirmed', 'SQLite durability has not been confirmed.', 'Confirm the mount survives restarts and is backed up before setting DURABLE_STORAGE_CONFIRMED=true.');
        warn('DATABASE_PATH', 'sqlite_operational_check', 'A path cannot prove persistent storage or backup coverage.', 'Use one persistent host; do not put SQLite on autoscaling ephemeral instances. Verify restore procedures before launch.');
      }
    }
  }
  if (bool('ALLOW_EPHEMERAL_STORAGE', false)) error('ALLOW_EPHEMERAL_STORAGE', 'ephemeral_exception_enabled', 'The temporary-storage exception is enabled.', 'Remove this rehearsal-only exception from production.');
  const schema = value('RADAR_DB_SCHEMA') || 'radar';
  if (!/^[a-z_][a-z0-9_]*$/.test(schema) || schema === 'public') error('RADAR_DB_SCHEMA', 'invalid_radar_schema', 'The radar schema must be a dedicated lowercase SQL identifier outside public.', 'Use RADAR_DB_SCHEMA=radar unless a dedicated alternate schema is deliberately configured.');
  const origins = value('ALLOWED_ORIGINS').split(',').map((item) => item.trim()).filter(Boolean);
  if (!origins.length) error('ALLOWED_ORIGINS', 'missing_origins', 'No production browser origin is configured.', 'Set a comma-separated list of exact HTTPS origins serving the browser app.');
  else if (origins.some((origin) => {
    try { const url = new URL(origin); return url.protocol !== 'https:' || url.origin !== origin || Boolean(url.username || url.password) || ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) || origin.includes('*'); }
    catch { return true; }
  })) error('ALLOWED_ORIGINS', 'invalid_origins', 'ALLOWED_ORIGINS contains a wildcard, non-HTTPS URL, local address or non-origin value.', 'Supply exact HTTPS origins with no path, credentials or trailing slash.');

  const schedulerEnabled = bool('SCHEDULER_ENABLED', true);
  if (!schedulerEnabled) warn('SCHEDULER_ENABLED', 'scheduler_disabled', 'Automatic connector schedules and due-score refresh are disabled.', 'Enable the scheduler with an awake API instance, or operate and verify an external worker schedule.');
  integer('SCHEDULER_INTERVAL_MS', 60000, 5000);
  const connectorTimeout = integer('CONNECTOR_TIMEOUT_MS', 45000);
  const lease = integer('CONNECTOR_LEASE_MS', 300000);
  if (lease < connectorTimeout * 2) error('CONNECTOR_LEASE_MS', 'lease_too_short', 'Connector leases must outlast two provider request timeouts.', 'Set CONNECTOR_LEASE_MS to at least twice CONNECTOR_TIMEOUT_MS.');
  for (const [field, fallback] of Object.entries({ DB_STATEMENT_TIMEOUT_MS: 30000, MAX_BODY_BYTES: 5000000, MAX_BATCH_RECORDS: 5000, MAX_EXPORT_ROWS: 50000, CONNECTOR_MAX_RECORDS: 5000, RESCORE_BATCH_SIZE: 500, RATE_LIMIT_PER_MINUTE: 600 })) integer(field, fallback);
  const futureSkew = Number(value('MAX_FUTURE_SKEW_MINUTES') || 60);
  if (!Number.isFinite(futureSkew) || futureSkew <= 0) error('MAX_FUTURE_SKEW_MINUTES', 'invalid_time_window', 'The permitted future-event window must be a positive finite number.', 'Use a positive MAX_FUTURE_SKEW_MINUTES consistent with provider timestamps.');
  if (value('CONNECTOR_WEBHOOK_SECRET')) secret('CONNECTOR_WEBHOOK_SECRET', { required: false });
  if (bool('TRUST_PROXY', Boolean(value('VERCEL')))) warn('TRUST_PROXY', 'trusted_ingress_required', 'Forwarded client addresses are trusted.', 'Restrict access to the trusted ingress; process-local rate limiting is not shared across replicas.');

  const errors = issues.filter((issue) => issue.severity === 'error').length;
  const warnings = issues.filter((issue) => issue.severity === 'warning').length;
  return {
    status: errors ? 'configuration_blocked' : 'configuration_checked',
    scope: runtimeOnly ? 'runtime' : 'build_and_runtime',
    errors, warnings, storage_mode: storageMode, scheduler_enabled: schedulerEnabled,
    schema: { expected_version: schemaManifest.version, database_verified: false },
    issues,
    not_verified: ['Credential validity and Clerk browser sessions', 'Database connectivity, applied schema and storage durability', 'Postgres backup and restore', 'Provider connections and live source data'],
    next_steps: ['Run the credential-free production rehearsal for local code verification.', 'Prepare the target schema in a separate migration job before starting the production API.', 'Check /api/ready after deployment; a successful preflight is not a substitute for runtime readiness.', 'Complete the authenticated browser and database restore gates with the connected deployment.'],
  };
}

function main() {
  const args = process.argv.slice(2);
  if (args.includes('--help')) {
    console.log('Usage: node scripts/production-preflight.mjs [--json] [--runtime-only] [--first-deploy]\nReads the supplied process environment only. Does not load .env files or connect to services.\nExits 1 for configuration blockers, 0 for a configuration check with no blockers, and 2 for invalid options.\nNo environment values are printed. Runtime/schema/credential checks remain separate.');
    return;
  }
  if (args.some((arg) => !['--json', '--runtime-only', '--first-deploy'].includes(arg))) { console.error('Unknown option. Use --help.'); process.exitCode = 2; return; }
  const report = inspectProductionEnv(process.env, { runtimeOnly: args.includes('--runtime-only'), firstDeploy: args.includes('--first-deploy') });
  if (args.includes('--json')) console.log(JSON.stringify(report, null, 2));
  else {
    console.log(`Production preflight: ${report.status} (${report.errors} blockers, ${report.warnings} warnings)`);
    for (const issue of report.issues) console.log(`${issue.severity.toUpperCase()} ${issue.field}: ${issue.message}\n  ${issue.action}`);
    console.log(`Expected schema migration: ${report.schema.expected_version}. Database and external credentials have not been verified.`);
    console.log('Missing provider connections are intentionally not configuration blockers at this stage.');
  }
  process.exitCode = report.errors ? 1 : 0;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) main();

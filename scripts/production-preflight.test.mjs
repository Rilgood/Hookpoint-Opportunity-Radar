import test from 'node:test';
import assert from 'node:assert/strict';
import { inspectProductionEnv } from './production-preflight.mjs';

const pk = `pk_live_${Buffer.from('clerk.company.net$').toString('base64')}`;
const clerkSecret = (environment = 'live') =>
  ['sk', environment, 'fixture-value-not-a-secret-1234567890'].join('_');
const readyEnv = () => ({
  NODE_ENV: 'production', PORT: '8080', AUTH_REQUIRED: 'true',
  ADMIN_API_KEY: 'a-secure-test-value-that-is-more-than-32-characters',
  HASH_SALT: 'a-separate-test-value-that-is-more-than-32-characters',
  CLERK_SECRET_KEY: clerkSecret(),
  CLERK_PUBLISHABLE_KEY: pk, VITE_CLERK_PUBLISHABLE_KEY: pk,
  DATABASE_URL: 'postgresql://operator:secret@database.company.net/radar?sslmode=verify-full',
  ALLOWED_ORIGINS: 'https://radar.company.net', SCHEDULER_ENABLED: 'true',
});

test('a well-shaped deployment passes configuration inspection without claiming runtime readiness', () => {
  const report = inspectProductionEnv(readyEnv(), { firstDeploy: true });
  assert.equal(report.errors, 0);
  assert.equal(report.status, 'configuration_checked');
  assert.equal(report.schema.database_verified, false);
  assert.ok(report.not_verified.some((item) => item.includes('Clerk')));
});

test('preflight reports missing settings and never serializes provided environment values', () => {
  const env = { NODE_ENV: 'development', PORT: 'bad-sensitive-value', DATABASE_URL: 'not-a-url-with-private-token', CLERK_SECRET_KEY: 'private-token-short' };
  const report = inspectProductionEnv(env, { firstDeploy: true });
  assert.ok(report.errors > 0);
  assert.ok(report.issues.some((item) => item.field === 'HASH_SALT'));
  const rendered = JSON.stringify(report);
  for (const value of Object.values(env).filter((item) => item !== 'development')) assert.equal(rendered.includes(value), false);
});

test('production rejects local auth bypasses, development Clerk keys and temporary storage exceptions', () => {
  const report = inspectProductionEnv({ ...readyEnv(), AUTH_REQUIRED: 'false', VITE_LOCAL_DEMO: 'true', CLERK_SECRET_KEY: clerkSecret('test'), DATABASE_URL: '', DATABASE_PATH: ':memory:', ALLOW_EPHEMERAL_STORAGE: 'true' });
  for (const code of ['authentication_disabled', 'demo_mode_enabled', 'development_clerk_key', 'ephemeral_production_storage', 'ephemeral_exception_enabled']) assert.ok(report.issues.some((issue) => issue.code === code), code);
});

test('invalid boolean/numeric settings and short leases fail rather than silently taking defaults', () => {
  const report = inspectProductionEnv({ ...readyEnv(), PORT: '65536', SCHEDULER_ENABLED: 'maybe', CONNECTOR_TIMEOUT_MS: '45000', CONNECTOR_LEASE_MS: '5000', RADAR_DB_SCHEMA: 'public', MAX_FUTURE_SKEW_MINUTES: '-1' });
  for (const code of ['invalid_integer', 'invalid_boolean', 'lease_too_short', 'invalid_radar_schema', 'invalid_time_window']) assert.ok(report.issues.some((issue) => issue.code === code), code);
});

test('first deployment requires bootstrap credentials while an existing deployment gets an actionable warning', () => {
  const env = readyEnv();
  delete env.ADMIN_API_KEY;
  const existing = inspectProductionEnv(env);
  assert.equal(existing.errors, 0);
  assert.ok(existing.issues.some((issue) => issue.code === 'bootstrap_key_absent'));
  assert.ok(inspectProductionEnv(env, { firstDeploy: true }).issues.some((issue) => issue.field === 'ADMIN_API_KEY' && issue.severity === 'error'));
});

test('runtime-only inspection does not require browser build variables', () => {
  const env = readyEnv();
  delete env.VITE_CLERK_PUBLISHABLE_KEY;
  assert.equal(inspectProductionEnv(env, { runtimeOnly: true }).errors, 0);
  assert.ok(inspectProductionEnv(env).errors > 0);
});

test('wildcard/non-origin URLs and unconfirmed SQLite storage cannot pass launch preflight', () => {
  const report = inspectProductionEnv({ ...readyEnv(), DATABASE_URL: '', DATABASE_PATH: '/data/radar.sqlite', ALLOWED_ORIGINS: 'https://radar.company.net/path,*' });
  assert.ok(report.issues.some((issue) => issue.code === 'invalid_origins'));
  assert.ok(report.issues.some((issue) => issue.code === 'durability_unconfirmed'));
});

test('preflight rejects whitespace that would change the effective runtime auth or storage configuration', () => {
  const env = readyEnv();
  const report = inspectProductionEnv({ ...env, AUTH_REQUIRED: ' true ', SCHEDULER_ENABLED: '   ', DATABASE_URL: ` ${env.DATABASE_URL}` });
  assert.ok(report.issues.some((issue) => issue.field === 'AUTH_REQUIRED' && issue.code === 'invalid_boolean'));
  assert.ok(report.issues.some((issue) => issue.field === 'SCHEDULER_ENABLED' && issue.code === 'invalid_boolean'));
  assert.ok(report.issues.some((issue) => issue.field === 'DATABASE_URL' && issue.code === 'invalid_database_url'));
});

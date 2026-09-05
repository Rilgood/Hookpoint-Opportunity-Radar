#!/usr/bin/env node
// Disposable production-mode code rehearsal. Uses no deployment credentials,
// no live providers and no existing database. This is not a Clerk login test.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { randomBytes, createHash } from 'node:crypto';
import { spawn } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { schemaManifest } from '../artifacts/api-server/radar-core/src/db/schema-manifest.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const apiRoot = path.join(root, 'artifacts', 'api-server');
const frontendRoot = path.join(root, 'artifacts', 'hookpoint-radar');
const apiRequire = createRequire(path.join(apiRoot, 'package.json'));
const frontendRequire = createRequire(path.join(frontendRoot, 'package.json'));
const children = new Set();
let workDir;
const completed = [];
const args = process.argv.slice(2);
const jsonOutput = args.includes('--json');

function cleanEnvironment() {
  return Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
}

function launch(argv, env, ipc = false) {
  const child = spawn(process.execPath, argv, { cwd: root, env, stdio: ['ignore', 'pipe', 'pipe', ...(ipc ? ['ipc'] : [])] });
  children.add(child);
  child.output = '';
  for (const stream of [child.stdout, child.stderr]) stream.on('data', (data) => { child.output = `${child.output}${data}`.slice(-24000); });
  child.done = new Promise((resolve) => {
    child.once('error', (error) => { child.output += error.message; resolve(1); });
    child.once('exit', (code) => { children.delete(child); resolve(code ?? 1); });
  });
  return child;
}

async function command(argv, env, label) {
  const child = launch(argv, env);
  const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
  try {
    const code = await child.done;
    if (code !== 0) throw new Error(`${label} failed (exit ${code}).\n${child.output.slice(0, 4000)}`);
  } finally { clearTimeout(timer); }
}

async function stop(child) {
  if (!children.has(child)) return;
  child.kill('SIGTERM');
  const timer = setTimeout(() => child.kill('SIGKILL'), 5000);
  try { await child.done; } finally { clearTimeout(timer); }
}

async function startHost(env) {
  const child = launch([path.join(workDir, 'app', 'host.mjs')], env, true);
  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('The rehearsal host did not start within 20 seconds.')), 20000);
    child.once('message', (message) => { clearTimeout(timer); resolve(message); });
    child.done.then(() => { clearTimeout(timer); reject(new Error(`The rehearsal host exited before startup.\n${child.output}`)); });
  });
  return { child, origin: `http://127.0.0.1:${ready.port}` };
}

function schemaFingerprint(databasePath) {
  const db = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return createHash('sha256').update(JSON.stringify(db.prepare("SELECT name,type,sql FROM sqlite_master WHERE name NOT LIKE 'sqlite_%' ORDER BY name").all())).digest('hex');
  } finally { db.close(); }
}

async function main() {
  if (args.includes('--help')) {
    console.log('Usage: node scripts/production-rehearsal.mjs [--json]\nBuilds the UI and real Express app into a disposable directory; tests production-mode schema/auth/API behavior on loopback.\nRequires Node.js 24+ and installed workspace dependencies. No Clerk login, provider access, existing data or deployment credentials are used.\nThe visible local workspace is untouched. Temporary processes and data are removed on exit.');
    return;
  }
  if (args.some((arg) => arg !== '--json')) throw new Error('Unknown option. Use --help.');
  if (Number(process.versions.node.split('.')[0]) < 24) throw new Error('Node.js 24 or newer is required.');
  workDir = fs.mkdtempSync(path.join(os.tmpdir(), 'hookpoint-production-rehearsal-'));
  const appDir = path.join(workDir, 'app');
  fs.mkdirSync(appDir);
  fs.symlinkSync(path.join(apiRoot, 'node_modules'), path.join(appDir, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir');
  const publicDir = path.join(workDir, 'public');
  const databasePath = path.join(workDir, 'rehearsal.sqlite');
  const apiKey = randomBytes(32).toString('hex');
  const publishableKey = `pk_test_${Buffer.from('clerk.rehearsal.invalid$').toString('base64')}`;
  const env = {
    ...cleanEnvironment(), NODE_ENV: 'production', DATABASE_URL: '', DATABASE_PATH: databasePath,
    RADAR_CONFIG_DIR: path.join(apiRoot, 'radar-core', 'config'), DEFAULT_TENANT_ID: 'tenant_disposable_rehearsal',
    AUTH_REQUIRED: 'true', ADMIN_API_KEY: apiKey, HASH_SALT: randomBytes(32).toString('hex'),
    CLERK_SECRET_KEY: ['sk', 'test', 'rehearsal_only_never_a_real_clerk_secret'].join('_'), CLERK_PUBLISHABLE_KEY: publishableKey,
    CLERK_TELEMETRY_DISABLED: 'true', VITE_CLERK_TELEMETRY_DISABLED: 'true',
    SCHEDULER_ENABLED: 'false', ALLOW_EPHEMERAL_STORAGE: 'true', DURABLE_STORAGE_CONFIRMED: 'false',
    ALLOWED_ORIGINS: 'http://127.0.0.1', LOG_LEVEL: 'silent', PORT: '8080', BASE_PATH: '/',
    REHEARSAL_PUBLIC_DIR: publicDir, HOOKPOINT_LOCAL_DEMO: 'false', VITE_LOCAL_DEMO: 'false',
  };
  const { build: esbuild } = await import(pathToFileURL(apiRequire.resolve('esbuild')).href);
  await esbuild({
    stdin: {
      contents: `import app from ${JSON.stringify(path.join(apiRoot, 'src', 'app.ts'))};
import express from 'express';
import path from 'node:path';
import { closeDb } from ${JSON.stringify(path.join(apiRoot, 'radar-core', 'src', 'db', 'index.js'))};
app.use(express.static(process.env.REHEARSAL_PUBLIC_DIR));
app.get(/^\\/(?!api(?:\\/|$)).*/, (_req,res) => res.sendFile(path.join(process.env.REHEARSAL_PUBLIC_DIR, 'index.html')));
const server = app.listen(0, '127.0.0.1', () => process.send?.({ port: server.address().port }));
for (const signal of ['SIGINT','SIGTERM']) process.on(signal, () => { server.close(() => { closeDb(); process.exit(0); }); server.closeIdleConnections(); });`,
      resolveDir: apiRoot, sourcefile: 'production-rehearsal-entry.ts', loader: 'ts',
    },
    outfile: path.join(appDir, 'host.mjs'), bundle: true, platform: 'node', format: 'esm', target: 'node24',
    external: ['express', 'cors', 'pino', 'pino-http', '@clerk/express', '@clerk/shared/keys', 'http-proxy-middleware'],
    define: { 'process.env.NODE_ENV': '"production"' },
    banner: { js: "import { createRequire as _createRequire } from 'node:module'; const require = _createRequire(import.meta.url);" },
    logLevel: 'silent',
  });
  completed.push('Real Express application compiled for Node.js production mode');

  const viteBuilder = path.join(workDir, 'build-ui.mjs');
  fs.writeFileSync(viteBuilder, `import { build } from ${JSON.stringify(pathToFileURL(frontendRequire.resolve('vite')).href)};
await build({ root: ${JSON.stringify(frontendRoot)}, configFile: ${JSON.stringify(path.join(frontendRoot, 'vite.config.ts'))}, envDir: false, logLevel: 'silent',
define: { 'import.meta.env.VITE_CLERK_PUBLISHABLE_KEY': ${JSON.stringify(JSON.stringify(publishableKey))}, 'import.meta.env.VITE_LOCAL_DEMO': '"false"' },
build: { outDir: ${JSON.stringify(publicDir)}, emptyOutDir: true } });`);
  await command([viteBuilder], env, 'Production browser build');
  completed.push('Production UI built without local demo mode or deployment environment files');

  const unprepared = await startHost(env);
  try {
    assert.equal((await fetch(`${unprepared.origin}/api/health`)).status, 200);
    const ready = await fetch(`${unprepared.origin}/api/ready`);
    assert.equal(ready.status, 503);
    const readyBody = await ready.json();
    assert.ok(readyBody.data.issues.some((issue) => issue.code === 'schema_out_of_date'));
    assert.equal((await fetch(`${unprepared.origin}/api/v1/companies`, { headers: { 'x-api-key': apiKey } })).status, 503);
  } finally { await stop(unprepared.child); }
  completed.push('Unmigrated production database refuses readiness and protected traffic');

  await command([path.join(apiRoot, 'radar-core', 'src', 'db', 'migrate.js')], { ...env, NODE_ENV: 'development', HOOKPOINT_LOCAL_DEMO: 'true' }, 'Separate schema migration');
  const schemaBefore = schemaFingerprint(databasePath);
  const unsafeStorage = await startHost({ ...env, ALLOW_EPHEMERAL_STORAGE: 'false' });
  try {
    const response = await fetch(`${unsafeStorage.origin}/api/ready`);
    assert.equal(response.status, 503);
    const ready = await response.json();
    assert.ok(ready.data.issues.some((issue) => issue.code === 'ephemeral_storage'));
    assert.equal((await fetch(`${unsafeStorage.origin}/api/v1/companies`, { headers: { 'x-api-key': apiKey } })).status, 503);
  } finally { await stop(unsafeStorage.child); }
  completed.push('Production rejects temporary storage unless the disposable-only exception is explicitly enabled');
  const host = await startHost(env);
  const request = async (route, { method = 'GET', data, key = apiKey, expected = 200 } = {}) => {
    const response = await fetch(`${host.origin}${route}`, { method, headers: { ...(key ? { 'x-api-key': key } : {}), ...(data === undefined ? {} : { 'content-type': 'application/json' }) }, ...(data === undefined ? {} : { body: JSON.stringify(data) }) });
    const body = await response.text();
    assert.equal(response.status, expected, `${method} ${route} returned ${response.status}: ${body.slice(0, 500)}`);
    return response.headers.get('content-type')?.includes('application/json') ? JSON.parse(body) : body;
  };
  try {
    const ready = await request('/api/ready');
    assert.equal(ready.data.status, 'ready');
    assert.equal(ready.data.schema_version, schemaManifest.version);
    assert.equal(ready.data.storage_mode, 'ephemeral_sqlite');
    completed.push(`Migrated schema ${schemaManifest.version} passes production verification with explicit disposable storage`);
    await request('/api/v1/companies', { key: null, expected: 401 });
    await request('/api/v1/companies', { key: 'invalid-rehearsal-key', expected: 401 });
    const scoped = await request('/api/v1/api-keys', { method: 'POST', data: { name: 'Disposable reader', scopes: ['read'] }, expected: 201 });
    const readKey = scoped.data.token;
    assert.ok(readKey, 'A scoped API key must be returned once when created.');
    await request('/api/v1/companies', { key: readKey });
    await request('/api/v1/companies', { method: 'POST', key: readKey, data: { name: 'Must not be created' }, expected: 403 });
    completed.push('Anonymous and invalid-key requests rejected; read-only API key cannot mutate');

    const observation = { source: 'disposable_rehearsal', external_id: 'fixture-1', type: 'funding', title: 'Synthetic rehearsal funding event', observed_at: new Date().toISOString(), confidence: 0.9, company: { name: 'Disposable Rehearsal Company', domain: 'rehearsal.example', industry: 'Technology' }, attributes: { amount: 1000000, synthetic: true } };
    const ingested = await request('/api/v1/ingest', { method: 'POST', data: { records: [observation] } });
    assert.equal(ingested.data.inserted, 1);
    assert.equal(ingested.data.rejected, 0);
    const duplicate = await request('/api/v1/ingest', { method: 'POST', data: { records: [observation] } });
    assert.equal(duplicate.data.duplicates, 1);
    const companyId = ingested.data.companies[0];
    await request(`/api/v1/companies/${companyId}`, { method: 'PATCH', data: { owner_name: 'Rehearsal operator', status: 'accepted' } });
    const detail = await request(`/api/v1/companies/${companyId}`);
    assert.equal(detail.data.company.owner_name, 'Rehearsal operator');
    assert.equal(detail.data.company.status, 'accepted');
    await request(`/api/v1/companies/${companyId}/outcomes`, { method: 'POST', data: { outcome_type: 'meeting', note: 'Disposable code verification only' }, expected: 201 });
    const csv = await request('/api/v1/export/companies.csv');
    assert.ok(csv.includes('Disposable Rehearsal Company'));
    await request(`/api/v1/companies/${companyId}`, { method: 'DELETE' });
    assert.equal((await request('/api/v1/companies')).data.total, 0);
    completed.push('Ingest/deduplication, persisted workflow, outcome recording, CSV export and privacy deletion');

    const index = await request('/dashboard', { key: null });
    assert.ok(index.includes('<html') && index.includes('/assets/'));
    assert.equal(index.includes('/@vite/client'), false);
    const scriptAsset = /src="([^"]+\.js)"/.exec(index)?.[1];
    assert.ok(scriptAsset, 'Built UI entry must be referenced.');
    const asset = await request(scriptAsset, { key: null });
    assert.ok(asset.length > 1000);
    completed.push('Production static document, deep-link fallback and built JavaScript served');
    assert.equal(schemaFingerprint(databasePath), schemaBefore);
    completed.push('Production startup and workflows did not change the schema');
  } finally { await stop(host.child); }
  const report = { status: 'passed', completed, not_verified: ['Real Clerk login, logout and revocation', 'Postgres and backup/restore', 'TLS, deployment ingress and durable storage', 'Live provider connections', 'Production index scheduler lifecycle'], visible_workspace_modified: false };
  console.log(jsonOutput ? JSON.stringify(report, null, 2) : `Production code rehearsal PASSED\n${completed.map((item) => `  ✓ ${item}`).join('\n')}\nNot verified: ${report.not_verified.join('; ')}.\nThe visible local workspace was not changed.`);
}

async function cleanup() {
  await Promise.all([...children].map(stop));
  if (workDir) fs.rmSync(workDir, { recursive: true, force: true });
}
for (const [signal, code] of [['SIGINT', 130], ['SIGTERM', 143]]) process.on(signal, () => { void cleanup().finally(() => process.exit(code)); });
try { await main(); }
catch (error) { console.error(jsonOutput ? JSON.stringify({ status: 'failed', completed, message: error.message }) : `Production code rehearsal FAILED: ${error.message}`); process.exitCode = 1; }
finally { await cleanup(); }

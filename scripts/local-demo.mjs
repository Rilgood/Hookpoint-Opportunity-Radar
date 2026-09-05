#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const demoDir = path.join(root, '.local', 'demo');
const databasePath = path.join(demoDir, 'workspace.sqlite');
const modePath = path.join(demoDir, 'mode');
const tenant = 'tenant_fictional_local_demo';

function fail(message) { throw new Error(message); }
function port(value, fallback) {
  const parsed = Number(value || fallback);
  if (!Number.isInteger(parsed) || parsed < 1024 || parsed > 65535) fail('Demo ports must be integers between 1024 and 65535.');
  return parsed;
}

async function startApi() {
  if (process.env.HOOKPOINT_LOCAL_DEMO !== 'true' || process.env.NODE_ENV !== 'development'
    || process.env.DATABASE_PATH !== databasePath || process.env.DATABASE_URL !== ''
    || process.env.HOST !== '127.0.0.1' || process.env.AUTH_REQUIRED !== 'true'
    || process.env.DEFAULT_TENANT_ID !== tenant || process.env.SCHEDULER_ENABLED !== 'false'
    || !['empty', 'seed'].includes(process.env.HOOKPOINT_DEMO_SEED_MODE)) {
    fail('The demo API must be started through node scripts/local-demo.mjs.');
  }
  const [{ getDb, closeDb }, { createApp }, { ingestBatch }, { recordOutcome }, { updateCompany }, fixtures] = await Promise.all([
    import('../artifacts/api-server/radar-core/src/db/index.js'),
    import('../artifacts/api-server/radar-core/src/app.js'),
    import('../artifacts/api-server/radar-core/src/services/ingestion.js'),
    import('../artifacts/api-server/radar-core/src/services/outcomes.js'),
    import('../artifacts/api-server/radar-core/src/services/entities.js'),
    import('./demo-data.mjs'),
  ]);
  const db = getDb();
  const handler = createApp(db, { serveStaticAssets: false });
  if (process.env.HOOKPOINT_DEMO_SEED_MODE === 'seed' && !db.get('SELECT id FROM companies WHERE tenant_id=? LIMIT 1', [tenant])) {
    const result = ingestBatch(db, tenant, fixtures.demoObservations(Date.now(), Number(process.env.HOOKPOINT_DEMO_WEB_PORT)));
    if (result.rejected) fail(`Demo fixtures were rejected: ${JSON.stringify(result.errors)}`);
    for (const assignment of fixtures.demoAssignments) {
      const company = db.get('SELECT id FROM companies WHERE tenant_id=? AND domain=?', [tenant, assignment.domain]);
      db.transaction(() => updateCompany(db, tenant, company.id, { owner_name: assignment.owner_name }, { actor: 'Fictional demo setup' }));
    }
    for (const outcome of fixtures.demoOutcomes) {
      const company = db.get('SELECT id FROM companies WHERE tenant_id=? AND domain=?', [tenant, outcome.domain]);
      db.transaction(() => recordOutcome(db, tenant, company.id, outcome, 'Fictional demo setup'));
    }
    console.log(`Seeded ${result.companies.length} fictional accounts through the real evidence engine.`);
  }
  const allowedOrigins = new Set(process.env.ALLOWED_ORIGINS.split(','));
  const escape = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    const reject = (message) => {
      res.writeHead(403, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      res.end(JSON.stringify({ error: { code: 'local_demo_boundary', message } }));
    };
    if (req.headers.origin && !allowedOrigins.has(req.headers.origin)) return reject('Only the local demo workspace may access this API.');
    if (req.method !== 'GET' && /^\/api\/v1\/(connectors|webhooks)(\/|$)/.test(url.pathname)) {
      return reject('Live connector execution is disabled in the fictional demo. Use a configured authenticated deployment for real sources.');
    }
    if (url.pathname.startsWith('/api/demo/evidence/')) {
      if (req.headers['x-api-key'] !== process.env.ADMIN_API_KEY) return reject('Use the local workspace to view this fictional evidence.');
      const observation = db.get('SELECT * FROM observations WHERE tenant_id=? AND external_id=?', [tenant, url.pathname.split('/').at(-1)]);
      if (!observation) { res.writeHead(404); return res.end('Fictional evidence not found.'); }
      res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff', 'content-security-policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'" });
      return res.end(`<!doctype html><html lang="en"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>Fictional evidence snapshot · Hookpoint</title><style>body{margin:0;background:#eef2f6;color:#172b46;font:16px/1.65 system-ui}main{max-width:800px;margin:7vh auto;padding:36px;background:white;border-radius:20px}small{color:#957023;font-weight:700;letter-spacing:.1em}h1{line-height:1.2}pre{background:#f3f6f8;padding:20px;white-space:pre-wrap;overflow-wrap:anywhere}dt{font-weight:700}dd{margin:0 0 12px}</style><main><small>LOCAL DEMO · FICTIONAL EVIDENCE</small><h1>${escape(observation.title)}</h1><p>${escape(observation.body)}</p><dl><dt>Source</dt><dd>${escape(observation.source)}</dd><dt>Event time</dt><dd>${escape(observation.observed_at)}</dd><dt>Retrieved</dt><dd>${escape(observation.retrieved_at)}</dd><dt>Normalizer</dt><dd>${escape(observation.normalizer_version)}</dd></dl><h2>Recorded attributes</h2><pre>${escape(JSON.stringify(JSON.parse(observation.attributes_json), null, 2))}</pre><p>This is an inspectable local fixture. It does not establish any real-world event, buying intent or commercial relationship.</p></main></html>`);
    }
    return handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(Number(process.env.PORT), '127.0.0.1', resolve); });
  if (process.send) process.send({ ready: true });
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => {
    server.close(() => { closeDb(); process.exit(0); });
    server.closeIdleConnections();
  });
}

async function startDemo() {
  if (Number(process.versions.node.split('.')[0]) < 24) fail('Node.js 24 or newer is required for the built-in SQLite database.');
  if (process.argv.includes('--help')) {
    console.log('Usage: node scripts/local-demo.mjs [--reset] [--empty | --seed]\nRequires installed workspace dependencies. Binds only 127.0.0.1.\nOptional: HOOKPOINT_DEMO_WEB_PORT=5173 HOOKPOINT_DEMO_API_PORT=8787\n--reset removes only .local/demo/workspace.sqlite.\n--empty disables automatic fixture seeding and remembers this choice across restarts.\n--seed explicitly opts into fictional fixtures when the workspace has no companies.\nNew workspaces start empty; without a mode flag the saved choice is preserved.');
    return;
  }
  if (process.argv.slice(2).some((arg) => !['--reset', '--empty', '--seed'].includes(arg))) fail('Unknown option. Use --help.');
  if (process.argv.includes('--empty') && process.argv.includes('--seed')) fail('Choose either --empty or --seed, not both.');
  if (process.env.NODE_ENV === 'production') fail('The isolated demo cannot run with NODE_ENV=production.');
  const webPort = port(process.env.HOOKPOINT_DEMO_WEB_PORT, 5173);
  const apiPort = port(process.env.HOOKPOINT_DEMO_API_PORT, 8787);
  if (webPort === apiPort) fail('The web and API ports must be different.');
  const frontend = path.join(root, 'artifacts', 'hookpoint-radar');
  const require = createRequire(path.join(frontend, 'package.json'));
  let viteCli;
  try { viteCli = path.join(path.dirname(require.resolve('vite/package.json')), 'bin', 'vite.js'); }
  catch { fail('Workspace dependencies are missing. Run pnpm install, then node scripts/local-demo.mjs.'); }
  fs.mkdirSync(demoDir, { recursive: true });
  const lockFile = path.join(demoDir, 'runner.lock');
  if (fs.existsSync(lockFile)) {
    const pid = Number(fs.readFileSync(lockFile, 'utf8'));
    let running = false;
    try { if (Number.isInteger(pid) && pid > 0) { process.kill(pid, 0); running = true; } }
    catch (error) { if (error.code !== 'ESRCH') running = true; }
    if (running) fail('A demo is already running. Stop it with Ctrl+C before restarting or resetting.');
    fs.unlinkSync(lockFile);
  }
  fs.writeFileSync(lockFile, String(process.pid), { flag: 'wx' });
  process.on('exit', () => { try { fs.unlinkSync(lockFile); } catch {} });
  const savedMode = fs.existsSync(modePath) ? fs.readFileSync(modePath, 'utf8').trim() : 'empty';
  const seedMode = process.argv.includes('--empty') ? 'empty' : process.argv.includes('--seed') ? 'seed' : savedMode;
  if (!['empty', 'seed'].includes(seedMode)) fail('The saved workspace mode is invalid. Choose --empty or --seed explicitly.');
  fs.writeFileSync(modePath, `${seedMode}\n`);
  if (process.argv.includes('--reset')) for (const suffix of ['', '-wal', '-shm']) fs.rmSync(`${databasePath}${suffix}`, { force: true });

  // Use an allowlist, not a copy of process.env: no cloud database, Clerk,
  // connector secret, dotenv override or NODE_OPTIONS enters either child.
  const env = Object.fromEntries(['PATH', 'HOME', 'USERPROFILE', 'SystemRoot', 'WINDIR', 'PATHEXT', 'TEMP', 'TMP', 'TMPDIR'].filter((key) => process.env[key]).map((key) => [key, process.env[key]]));
  const apiKey = randomBytes(32).toString('hex');
  Object.assign(env, {
    NODE_ENV: 'development', HOOKPOINT_LOCAL_DEMO: 'true', HOST: '127.0.0.1',
    DATABASE_URL: '', DATABASE_PATH: databasePath, DEFAULT_TENANT_ID: tenant,
    AUTH_REQUIRED: 'true', ADMIN_API_KEY: apiKey, HASH_SALT: randomBytes(32).toString('hex'),
    SCHEDULER_ENABLED: 'false', LOG_LEVEL: 'error', BASE_PATH: '/',
    ALLOWED_ORIGINS: `http://127.0.0.1:${webPort},http://localhost:${webPort}`,
    HOOKPOINT_DEMO_WEB_PORT: String(webPort), HOOKPOINT_DEMO_API_PORT: String(apiPort),
    HOOKPOINT_DEMO_API_KEY: apiKey,
    HOOKPOINT_DEMO_SEED_MODE: seedMode,
  });
  const children = [];
  let stopping = false;
  const stop = (code = 0) => {
    if (stopping) return;
    stopping = true;
    for (const child of children) if (child.exitCode === null) child.kill('SIGTERM');
    const timer = setTimeout(() => { for (const child of children) if (child.exitCode === null) child.kill('SIGKILL'); process.exit(code); }, 4000);
    timer.unref();
    Promise.all(children.map((child) => child.exitCode !== null ? Promise.resolve() : new Promise((resolve) => child.once('exit', resolve)))).then(() => process.exit(code));
  };
  for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => stop());
  const api = spawn(process.execPath, [fileURLToPath(import.meta.url), '--api'], { cwd: root, env: { ...env, PORT: String(apiPort) }, stdio: ['ignore', 'inherit', 'inherit', 'ipc'] });
  children.push(api);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('The local API did not become ready within 20 seconds.')), 20_000);
    api.once('message', () => { clearTimeout(timeout); resolve(); });
    api.once('error', (error) => { clearTimeout(timeout); reject(error); });
    api.once('exit', (code) => { clearTimeout(timeout); reject(new Error(`The local API exited before startup (code ${code}).`)); });
  }).catch((error) => { console.error(error.message); stop(1); });
  if (stopping) return;
  const web = spawn(process.execPath, [viteCli], { cwd: frontend, env: { ...env, PORT: String(webPort) }, stdio: 'inherit' });
  children.push(web);
  console.log(`\nHookpoint local workspace: http://127.0.0.1:${webPort}/dashboard`);
  console.log(`${seedMode === 'seed' ? 'Fictional fixtures enabled' : 'Automatic fixtures disabled'} · real scoring and workflow · live connectors disabled`);
  console.log(`Changes persist in ${databasePath}\nCtrl+C stops both services.\n`);
  for (const child of children) {
    child.once('exit', (code) => { if (!stopping) stop(code || 0); });
    child.once('error', (error) => { console.error(error.message); stop(1); });
  }
}

try { await (process.argv[2] === '--api' ? startApi() : startDemo()); }
catch (error) { console.error(`Local demo: ${error.message}`); process.exitCode = 1; }

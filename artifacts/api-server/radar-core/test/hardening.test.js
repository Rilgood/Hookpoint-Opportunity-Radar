import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { Worker } from 'node:worker_threads';
import { openDatabase, wrapDriver } from '../src/db/index.js';
import { openSqlite } from '../src/db/sqlite.js';
import { attachOptions, openTestDatabase, testDatabaseTarget } from './helpers/database.js';
import { schema } from '../src/db/schema.js';
import { applyMigrations } from '../src/db/migrations.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { config } from '../src/config.js';
import { scoringConfig } from '../src/services/catalog.js';
import { createApp } from '../src/app.js';
import { ingestBatch, ingestOne } from '../src/services/ingestion.js';
import { companyDetail, connectorRuns, exportCompaniesCsv, ingestionRejections, listConnectors } from '../src/services/queries.js';
import { describeConnectorSchedule } from '../src/services/connector-schedule.js';
import { deleteCompany, updateCompany } from '../src/services/entities.js';
import { runConnector, setConnectorEnabled, startScheduler } from '../src/services/connector-runner.js';
import { recoverExpiredLeases } from '../src/services/connector-leases.js';
import { approveScoreCalibration, recordOutcome } from '../src/services/outcomes.js';
import { rescoreCompany, rescoreDueCompanies } from '../src/services/signals.js';
import { consumeWebhookReceipt } from '../src/services/webhooks.js';
import { BaseConnector } from '../src/connectors/base.js';
import { GdeltConnector } from '../src/connectors/news.js';
import { authenticate, setTrustedPrincipal } from '../src/http/security.js';
import { id, nowIso, sha256 } from '../src/lib.js';

function setup() { const db = openTestDatabase(); bootstrap(db); return db; }

const approvalWorkerSource = `
  import { parentPort, workerData } from 'node:worker_threads';

  const { openDatabase } = await import(workerData.dbModule);
  const { approveScoreCalibration } = await import(workerData.outcomesModule);
  const { recordAudit } = await import(workerData.auditModule);
  const db = openDatabase(workerData.databaseTarget, workerData.databaseOptions);

  parentPort.postMessage({ type: 'ready' });
  parentPort.once('message', () => {
    try {
      const approved = db.transaction(() => approveScoreCalibration(
        db, workerData.tenantId, workerData.recommendationId, workerData.actor
      ));
      recordAudit(db, workerData.tenantId, {
        action: 'scoring.version_approved',
        actor: workerData.actor,
        resourceType: 'scoring_version',
        resourceId: approved.id,
        details: { version: approved.version },
      });
      parentPort.postMessage({
        type: 'result',
        result: { status: 'fulfilled', recommendationId: workerData.recommendationId, approved },
      });
    } catch (error) {
      parentPort.postMessage({
        type: 'result',
        result: {
          status: 'rejected',
          recommendationId: workerData.recommendationId,
          error: { code: error.code, message: error.message },
        },
      });
    } finally {
      db.close();
    }
  });
`;

function concurrentApprovalWorker(workerData) {
  const worker = new Worker(new URL(`data:text/javascript,${encodeURIComponent(approvalWorkerSource)}`), {
    type: 'module',
    workerData,
  });
  let resolveReady;
  let resolveResult;
  let reject;
  const ready = new Promise((resolve, rejectReady) => {
    resolveReady = resolve;
    reject = rejectReady;
  });
  const result = new Promise((resolve, rejectResult) => {
    resolveResult = resolve;
    reject = rejectResult;
  });
  worker.on('message', (message) => {
    if (message.type === 'ready') resolveReady();
    if (message.type === 'result') resolveResult(message.result);
  });
  worker.once('error', (error) => reject(error));
  return { worker, ready, result };
}

async function submitCompetingApprovals(workerData) {
  const contenders = workerData.map(concurrentApprovalWorker);
  try {
    await Promise.all(contenders.map(({ ready }) => ready));
    contenders.forEach(({ worker }) => worker.postMessage({ type: 'approve' }));
    return await Promise.all(contenders.map(({ result }) => result));
  } finally {
    await Promise.all(contenders.map(async ({ worker }) => {
      if (worker.threadId !== -1) await worker.terminate();
    }));
  }
}

async function startApp(db) {
  const handler = createApp(db, { serveStaticAssets: false });
  const server = http.createServer((req, res) => {
    const browserUserId = req.headers['x-test-browser-user'];
    if (browserUserId) setTrustedPrincipal(req, { userId: String(browserUserId) });
    return handler(req, res);
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    request(path, { method = 'POST', headers = {}, body } = {}) {
      return fetch(`http://127.0.0.1:${port}${path}`, {
        method,
        headers: { 'content-type': 'application/json', ...headers },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
    },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

function addCalibrationData(db, tenantId) {
  for (let index = 0; index < 120; index += 1) {
    const companyId = `calibration-${index}`;
    const occurredAt = new Date(Date.UTC(2021, 0, index + 1)).toISOString();
    const now = new Date().toISOString();
    const qualified = index >= 90 ? index % 2 === 0 : index % 3 === 0;
    db.run(`INSERT INTO companies(id, tenant_id, name, normalized_name, domain, opportunity_score, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [companyId, tenantId, companyId, companyId, `${companyId}.test`, 10, now, now]);
    db.run(`INSERT INTO score_snapshots(id, tenant_id, company_id, score_version, opportunity_score, opportunity_tier,
      fit_score, need_score, intent_score, timing_score, risk_score, active_signal_count, components_json, computed_at)
      VALUES (?, ?, ?, 'rules-1.1', 10, 'cold', ?, ?, 0, 0, 0, 0, '{}', ?)`,
    [`snapshot-${companyId}`, tenantId, companyId, qualified ? 0 : 100, qualified ? 70 : 0, occurredAt]);
    db.run(`INSERT INTO outcomes(id, tenant_id, company_id, outcome_type, score_at_outcome, metadata_json, occurred_at, created_at)
      VALUES (?, ?, ?, ?, 10, '{}', ?, ?)`,
    [`outcome-${companyId}`, tenantId, companyId, qualified ? 'meeting' : 'lost', occurredAt, now]);
  }
}

test('derives a private tenant only from the trusted Clerk principal', () => {
  const db = setup();
  const req = { headers: { 'x-tenant-id': config.defaultTenantId, 'x-role': 'owner' } };
  setTrustedPrincipal(req, { userId: 'user_clerk_verified' });
  const auth = authenticate(db, req);
  assert.equal(auth.tenantId, 'user_clerk_verified');
  assert.equal(auth.actor, 'clerk:user_clerk_verified');
  assert.deepEqual(auth.scopes, ['read', 'write', 'admin']);
  assert.equal(db.get('SELECT name FROM tenants WHERE id=?', [auth.tenantId]).name, 'Private workspace');
  db.close();
});

test('ignores spoofed tenant and role headers without a trusted principal', () => {
  const db = setup();
  const auth = authenticate(db, {
    headers: { 'x-tenant-id': 'user_other_person', 'x-role': 'admin' },
    socket: {},
  });
  assert.equal(auth.tenantId, config.defaultTenantId);
  assert.equal(db.get('SELECT id FROM tenants WHERE id=?', ['user_other_person']), undefined);
  db.close();
});

test('authenticates a direct API key through the existing core path', () => {
  const db = setup();
  const token = 'hp_live_direct_client_regression';
  db.run(
    `INSERT INTO api_keys(id, tenant_id, name, key_prefix, key_hash, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['key_direct_regression', config.defaultTenantId, 'Direct regression client', token.slice(0, 16), sha256(token), 'read,write', new Date().toISOString()]
  );
  const auth = authenticate(db, {
    headers: { 'x-api-key': token, 'x-tenant-id': 'user_spoofed', 'x-role': 'admin' },
  });
  assert.equal(auth.authType, 'apiKey');
  assert.equal(auth.tenantId, config.defaultTenantId);
  assert.deepEqual(auth.scopes, ['read', 'write']);
  db.close();
});

test('rejects a stale score approval after another administrator approves a newer version', async () => {
  const db = setup();
  const tenantId = 'browser_admin';
  const apiKey = 'hp_live_calibration_admin';
  const now = new Date().toISOString();
  db.run(`INSERT INTO tenants(id, name, slug, settings_json, created_at, updated_at)
    VALUES (?, 'Browser admin', 'browser-admin', '{}', ?, ?)`, [tenantId, now, now]);
  db.run(`INSERT INTO api_keys(id, tenant_id, name, key_prefix, key_hash, scopes, created_at)
    VALUES (?, ?, ?, ?, ?, 'admin', ?)`,
  ['key_calibration_admin', tenantId, 'Calibration API key', apiKey.slice(0, 16), sha256(apiKey), now]);
  addCalibrationData(db, tenantId);
  const app = await startApp(db);

  try {
    const evaluation = await app.request('/api/v1/analytics/outcomes/evaluate', {
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(evaluation.status, 200);
    const original = (await evaluation.json()).data.recommendation;
    assert.equal(original.status, 'proposed');

    const alternativeId = id('score_version');
    const alternativeVersion = `${scoringConfig.version}-independent-review`;
    db.run(`INSERT INTO scoring_versions(id, tenant_id, version, status, base_version, config_json, evaluation_json, created_at, created_by)
      VALUES (?, ?, ?, 'proposed', ?, ?, '{}', ?, 'other-operator')`,
    [alternativeId, tenantId, alternativeVersion, scoringConfig.version, JSON.stringify({ ...original.config, version: alternativeVersion }), now]);

    const approved = await app.request(`/api/v1/analytics/outcomes/recommendations/${alternativeId}/approve`, {
      headers: { 'x-test-browser-user': tenantId },
    });
    assert.equal(approved.status, 200);
    assert.equal((await approved.json()).data.status, 'approved');

    const stale = await app.request(`/api/v1/analytics/outcomes/recommendations/${original.id}/approve`, {
      headers: { 'x-api-key': apiKey },
    });
    assert.equal(stale.status, 409);
    assert.equal((await stale.json()).error.code, 'score_recommendation_stale');
    assert.equal(db.get('SELECT status FROM scoring_versions WHERE id=?', [original.id]).status, 'proposed');

    const audits = db.all(`SELECT action, actor, resource_id FROM audit_events
      WHERE tenant_id=? AND action IN ('scoring.evaluation_created', 'scoring.version_approved') ORDER BY created_at, id`, [tenantId]);
    assert.deepEqual(audits, [
      { action: 'scoring.evaluation_created', actor: 'Calibration API key', resource_id: original.id },
      { action: 'scoring.version_approved', actor: `clerk:${tenantId}`, resource_id: alternativeId },
    ]);
  } finally {
    await app.close();
    db.close();
  }
});

test('allows only one concurrent score approval from separate database connections', async () => {
  // Contenders must use separate connections to the same database: a file for
  // SQLite, a shared schema when the suite runs against Postgres.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hookpoint-score-approval-'));
  const databaseTarget = process.env.RADAR_TEST_DATABASE_URL || path.join(directory, 'radar.sqlite');
  const tenantId = 'concurrent_approval_tenant';
  const now = new Date().toISOString();
  const proposals = [
    { id: 'score_version_concurrent_a', version: `${scoringConfig.version}-concurrent-a`, actor: 'admin-a' },
    { id: 'score_version_concurrent_b', version: `${scoringConfig.version}-concurrent-b`, actor: 'admin-b' },
  ];
  const db = databaseTarget.startsWith('postgres') ? openTestDatabase() : openDatabase(databaseTarget);

  try {
    bootstrap(db);
    db.run(`INSERT INTO tenants(id, name, slug, settings_json, created_at, updated_at)
      VALUES (?, 'Concurrent approval tenant', 'concurrent-approval-tenant', '{}', ?, ?)`, [tenantId, now, now]);
    for (const proposal of proposals) {
      db.run(`INSERT INTO scoring_versions(id, tenant_id, version, status, base_version, config_json, evaluation_json, created_at, created_by)
        VALUES (?, ?, ?, 'proposed', ?, ?, '{}', ?, ?)`, [
        proposal.id,
        tenantId,
        proposal.version,
        scoringConfig.version,
        JSON.stringify({ ...scoringConfig, version: proposal.version }),
        now,
        proposal.actor,
      ]);
    }

    const results = await submitCompetingApprovals(proposals.map((proposal) => ({
      databaseTarget,
      databaseOptions: attachOptions(db),
      tenantId,
      recommendationId: proposal.id,
      actor: proposal.actor,
      dbModule: new URL('../src/db/index.js', import.meta.url).href,
      outcomesModule: new URL('../src/services/outcomes.js', import.meta.url).href,
      auditModule: new URL('../src/services/audit.js', import.meta.url).href,
    })));

    const approved = results.filter((result) => result.status === 'fulfilled');
    const rejected = results.filter((result) => result.status === 'rejected');
    assert.equal(approved.length, 1);
    assert.equal(rejected.length, 1);
    // SQLite serialises the whole transaction, so the loser re-reads a stale
    // proposal; Postgres lets both proceed until the single-active-version
    // index rejects the second approval. Either way exactly one wins.
    assert.ok(['score_recommendation_stale', 'score_recommendation_not_pending', 'score_approval_conflict'].includes(rejected[0].error.code), rejected[0].error.code);

    const versions = db.all(`SELECT id, status FROM scoring_versions WHERE tenant_id=? ORDER BY id`, [tenantId]);
    assert.equal(versions.filter((version) => version.status === 'approved').length, 1);
    assert.equal(versions.find((version) => version.id === approved[0].approved.id).status, 'approved');

    const approvalAudits = db.all(`SELECT actor, resource_id FROM audit_events
      WHERE tenant_id=? AND action='scoring.version_approved' ORDER BY resource_id`, [tenantId]);
    assert.deepEqual(approvalAudits, [{ actor: approved[0].approved.approved_by, resource_id: approved[0].approved.id }]);
    assert.equal(approvalAudits.some((audit) => audit.resource_id === rejected[0].recommendationId), false);
  } finally {
    db.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('migration preserves the newest approved score version and prevents further conflicts', () => {
  const db = wrapDriver(openSqlite(':memory:'));
  const native = db.native;
  const now = new Date().toISOString();
  try {
    db.exec(schema);
    db.exec(`
      CREATE TABLE scoring_versions (
        id TEXT PRIMARY KEY,
        tenant_id TEXT NOT NULL,
        version TEXT NOT NULL,
        status TEXT NOT NULL,
        base_version TEXT NOT NULL,
        config_json TEXT NOT NULL,
        evaluation_json TEXT NOT NULL,
        created_at TEXT NOT NULL,
        created_by TEXT NOT NULL,
        approved_at TEXT,
        approved_by TEXT,
        UNIQUE(tenant_id, version)
      );
      INSERT INTO scoring_versions(id, tenant_id, version, status, base_version, config_json, evaluation_json, created_at, created_by, approved_at)
        VALUES
          ('approved-old', 'legacy-tenant', 'rules-1.1', 'approved', 'rules-1.0', '{}', '{}', '2025-01-01T00:00:00.000Z', 'admin-a', '2025-01-02T00:00:00.000Z'),
          ('approved-new', 'legacy-tenant', 'rules-1.2', 'approved', 'rules-1.1', '{}', '{}', '2025-02-01T00:00:00.000Z', 'admin-b', '2025-02-02T00:00:00.000Z');
    `);
    for (let version = 1; version <= 8; version += 1) db.run('INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)', [version, now]);
    applyMigrations(db);

    assert.deepEqual(
      native.prepare(`SELECT id, status FROM scoring_versions WHERE tenant_id='legacy-tenant' ORDER BY id`).all().map((row) => ({ ...row })),
      [{ id: 'approved-new', status: 'approved' }, { id: 'approved-old', status: 'superseded' }]
    );
    assert.throws(
      () => native.prepare(`UPDATE scoring_versions SET status='approved' WHERE id='approved-old'`).run(),
      (error) => error.code === 'ERR_SQLITE_ERROR' && error.errcode === 2067
    );
  } finally {
    db.close();
  }
});

test('reports a clear conflict when the active score version constraint rejects approval', () => {
  const proposal = {
    id: 'proposed-version',
    status: 'proposed',
    base_version: scoringConfig.version,
  };
  const uniqueConstraint = Object.assign(
    new Error('UNIQUE constraint failed: scoring_versions.tenant_id'),
    { code: 'ERR_SQLITE_ERROR', errcode: 2067 }
  );
  const db = {
    get(sql) {
      if (sql.includes('SELECT * FROM scoring_versions')) return proposal;
      return undefined;
    },
    run(sql) {
      if (sql.includes("SET status='approved'")) throw uniqueConstraint;
    },
  };

  assert.throws(
    () => approveScoreCalibration(db, 'tenant', proposal.id, 'admin'),
    (error) => error.status === 409
      && error.code === 'score_approval_conflict'
      && error.message === 'Another scoring version is already active for this workspace. Refresh and try again.'
  );
});

test('starts with an empty company dataset and no runtime sample connector', () => {
  const db = setup();
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 0);
  assert.equal(db.get("SELECT COUNT(*) count FROM connectors WHERE connector_key='demo'").count, 0);
  db.close();
});

test('preserves the canonical domain when an old domain alias reappears', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Identity Systems', domain: 'identity-old.test' }, source: 'registry', external_id: 'one',
    type: 'news', title: 'Company profile created', observed_at: new Date().toISOString()
  });
  updateCompany(db, config.defaultTenantId, first.company.id, { domain: 'identity-new.test' });
  const second = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Identity Systems', domain: 'identity-old.test' }, source: 'archive', external_id: 'two',
    type: 'news', title: 'Archived company mention', observed_at: new Date().toISOString()
  });
  assert.equal(second.company.id, first.company.id);
  assert.equal(second.company.domain, 'identity-new.test');
  db.close();
});

test('provider enrichment cannot overwrite an established canonical company name or workflow state', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Canonical Brand', domain: 'canonical.test' }, source: 'registry', type: 'news', title: 'Initial record', observed_at: new Date().toISOString()
  });
  updateCompany(db, config.defaultTenantId, first.company.id, { status: 'accepted', owner_name: 'Account Owner' });
  const second = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Canonical Brand - Social Page', domain: 'canonical.test', status: 'customer', owner_name: 'Provider Value' },
    source: 'social_platform', external_id: 'profile-2', type: 'social_metric', title: 'Profile metric', observed_at: new Date().toISOString(), attributes: {}
  });
  assert.equal(second.company.name, 'Canonical Brand');
  assert.equal(second.company.status, 'accepted');
  assert.equal(second.company.owner_name, 'Account Owner');
  db.close();
});

test('does not merge name-only identities across unrelated sources', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Common Market' }, source: 'registry_a', external_id: 'a-1', type: 'news',
    title: 'First source mention', observed_at: new Date().toISOString()
  });
  const second = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Common Market' }, source: 'registry_b', external_id: 'b-1', type: 'news',
    title: 'Second source mention', observed_at: new Date().toISOString()
  });
  const repeat = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Common Market' }, source: 'registry_a', external_id: 'a-2', type: 'news',
    title: 'First source follow-up', observed_at: new Date().toISOString()
  });
  assert.notEqual(first.company.id, second.company.id);
  assert.equal(first.company.id, repeat.company.id);
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 2);
  db.close();
});

test('preserves non-Latin company names during identity normalization', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, { company: { name: '株式会社ひかり' }, source: 'jp_registry', external_id: 'jp-1', type: 'news', title: '会社情報' });
  const second = ingestOne(db, config.defaultTenantId, { company: { name: '北京创新科技' }, source: 'cn_registry', external_id: 'cn-1', type: 'news', title: '公司更新' });
  assert.notEqual(first.company.normalized_name, '');
  assert.notEqual(second.company.normalized_name, '');
  assert.notEqual(first.company.normalized_name, second.company.normalized_name);
  db.close();
});

test('caps an ambiguous high-scoring identity until an operator adds an authoritative identifier', () => {
  const db = setup();
  const company = { name: 'Ambiguous Opportunity' };
  const result = ingestBatch(db, config.defaultTenantId, [
    { company, source: 'combined_feed', external_id: 'identity-1', type: 'web_intent', title: 'High intent', attributes: { intent_score: 95 } },
    { company, source: 'combined_feed', external_id: 'identity-2', type: 'creative_metric', title: 'Creative fatigue', attributes: { duplicate_creative_ratio: 0.9 } },
    { company, source: 'combined_feed', external_id: 'identity-3', type: 'product_launch', title: 'New launch', attributes: { is_new: true } }
  ]);
  const companyId = result.companies[0];
  let detail = companyDetail(db, config.defaultTenantId, companyId);
  assert.ok(detail.company.opportunity_score >= 48);
  assert.equal(detail.company.opportunity_tier, 'watch');
  assert.equal(detail.recommendation.offer, 'Identity verification required');
  updateCompany(db, config.defaultTenantId, companyId, { domain: 'ambiguous-opportunity.test' });
  rescoreCompany(db, config.defaultTenantId, companyId);
  detail = companyDetail(db, config.defaultTenantId, companyId);
  assert.ok(detail.company.identity_confidence >= 0.98);
  assert.ok(['warm','hot'].includes(detail.company.opportunity_tier));
  assert.notEqual(detail.recommendation.offer, 'Identity verification required');
  db.close();
});

test('rejects future evidence and records non-sensitive rejection telemetry', () => {
  const db = setup();
  const result = ingestBatch(db, config.defaultTenantId, [{
    company: { name: 'Future Signal', domain: 'future.test' }, source: 'provider', type: 'news',
    title: 'Impossible future event', observed_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  }]);
  assert.equal(result.rejected, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM ingestion_rejections').count, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 0);
  const ledger = ingestionRejections(db, config.defaultTenantId);
  assert.equal(ledger.total, 1);
  assert.equal(ledger.data[0].error_code, 'future_observed_at');
  db.close();
});

test('does not treat an event in the past as an upcoming event window', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Past Events', domain: 'past-events.test' }, source: 'calendar', type: 'event',
    title: 'Conference ended', observed_at: new Date().toISOString(), attributes: { days_until: -2, is_material: true }
  });
  assert.equal(result.signals.includes('event_window'), false);
  db.close();
});

test('does not coerce null metrics into numeric signal matches', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Null Metrics', domain: 'null-metrics.test' }, source: 'creative_analytics', type: 'creative_metric',
    title: 'Metric unavailable', observed_at: new Date().toISOString(), attributes: { hook_diversity_score: null }
  });
  assert.equal(result.signals.includes('low_hook_diversity'), false);
  db.close();
});

test('derives ad-volume change from successive account snapshots', () => {
  const db = setup();
  const company = { name: 'Snapshot Metrics', domain: 'snapshot-metrics.test' };
  ingestOne(db, config.defaultTenantId, {
    company, source: 'meta_ad_library', external_id: 'snapshot-day-1', type: 'ad_snapshot', title: 'Ten active ads',
    observed_at: '2026-09-01T12:00:00.000Z', attributes: { metric_scope: 'account_snapshot', active_ads: 10 }
  });
  const second = ingestOne(db, config.defaultTenantId, {
    company, source: 'meta_ad_library', external_id: 'snapshot-day-2', type: 'ad_snapshot', title: 'Twenty active ads',
    observed_at: '2026-09-02T12:00:00.000Z', attributes: { metric_scope: 'account_snapshot', active_ads: 20 }
  });
  const stored = db.get("SELECT attributes_json FROM observations WHERE external_id='snapshot-day-2'");
  assert.equal(JSON.parse(stored.attributes_json).previous_active_ads, 10);
  assert.equal(JSON.parse(stored.attributes_json).active_ads_delta_pct, 100);
  assert.equal(second.signals.includes('ad_volume_spike'), true);
  db.close();
});

test('risk suppression replaces any sales recommendation with a human-review hold', () => {
  const db = setup();
  const company = { name: 'Suppression Control', domain: 'suppression.test', industry: 'Technology', employee_count: 100 };
  ingestOne(db, config.defaultTenantId, { company, source: 'crm', type: 'web_intent', title: 'Pricing interest', observed_at: new Date().toISOString(), attributes: { intent_score: 90 } });
  const crisis = ingestOne(db, config.defaultTenantId, { company, source: 'risk_feed', type: 'crisis', title: 'Material data breach', observed_at: new Date().toISOString(), confidence: .95, attributes: { severity: 'critical' } });
  const detail = companyDetail(db, config.defaultTenantId, crisis.company.id);
  assert.equal(detail.company.opportunity_tier, 'suppressed');
  assert.equal(detail.recommendation.offer, 'Outreach paused');
  assert.match(detail.recommendation.outreach_angle, /Do not trigger automated outreach/);
  db.close();
});

test('closed workflow states remove sales recommendations but preserve score history', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Workflow Control', domain: 'workflow.test', industry: 'Retail', employee_count: 75 },
    source: 'crm', type: 'web_intent', title: 'High intent visit', observed_at: new Date().toISOString(), attributes: { intent_score: 95 }
  });
  assert.ok(companyDetail(db, config.defaultTenantId, result.company.id).recommendation);
  assert.ok(db.get('SELECT COUNT(*) count FROM score_snapshots WHERE company_id=?', [result.company.id]).count >= 1);
  recordOutcome(db, config.defaultTenantId, result.company.id, { outcome_type: 'rejected' });
  const detail = companyDetail(db, config.defaultTenantId, result.company.id);
  assert.equal(detail.company.status, 'rejected');
  assert.equal(detail.recommendation, null);
  assert.ok(detail.score_history.length >= 1);
  db.close();
});

test('manual workflow closure removes a sales recommendation immediately', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Manual Closure', domain: 'manual-closure.test' }, source: 'crm', type: 'web_intent',
    title: 'High intent account', attributes: { intent_score: 95 }
  });
  assert.ok(companyDetail(db, config.defaultTenantId, result.company.id).recommendation);
  updateCompany(db, config.defaultTenantId, result.company.id, { status: 'customer' });
  assert.equal(companyDetail(db, config.defaultTenantId, result.company.id).recommendation, null);
  assert.equal(db.get("SELECT COUNT(*) count FROM lead_events WHERE company_id=? AND event_type='workflow_status_changed'", [result.company.id]).count, 1);
  db.close();
});

test('privacy deletion removes a company, its evidence and associated contacts', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Delete Control', domain: 'delete-control.test' }, source: 'crm', external_id: 'delete-1',
    type: 'web_intent', title: 'Known account activity', attributes: { intent_score: 80 },
    people: [{ full_name: 'Delete Me', email: 'delete@example.test', external_id: 'contact-1' }]
  });
  deleteCompany(db, config.defaultTenantId, result.company.id);
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM observations').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM people').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM signals').count, 0);
  db.close();
});

test('CSV export neutralizes spreadsheet formulas and includes activation fields', () => {
  const db = setup();
  ingestOne(db, config.defaultTenantId, {
    company: { name: '=DANGEROUS()', domain: 'csv-safety.test' }, source: 'crm', type: 'web_intent',
    title: 'Known account activity', attributes: { intent_score: 80 },
    people: [{ full_name: 'Buyer', title: 'CMO', email: 'buyer@csv-safety.test', is_decision_maker: true }]
  });
  const csv = exportCompaniesCsv(db, config.defaultTenantId);
  assert.match(csv, /recommended_offer/);
  assert.match(csv, /buyer_email/);
  assert.match(csv, /'=DANGEROUS\(\)/);
  db.close();
});

test('refuses credentials inside persisted connector schedule input', () => {
  const db = setup();
  assert.throws(() => setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, {
    schedule_input: { company: { name: 'Target', domain: 'target.test' }, nested: { api_key: 'must-not-persist' } }
  }), /environment variables/i);
  db.close();
});

test('requires schedule input before enabling a recurring pull connector', () => {
  const db = setup();
  assert.throws(() => setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true), /schedule_input/i);
  db.close();
});

test('rejects schedule input the adapter would refuse when the cadence is saved, not when it first runs', () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const gdeltRow = () => db.get("SELECT enabled, status, next_run_at, config_json FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);

  // GDELT refuses to run without a target company; the same adapter check now fails the PATCH.
  assert.throws(() => setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { query: 'no company here' } }),
    (error) => error.status === 400 && error.code === 'company_required' && /GDELT requires a target company/.test(error.message));
  // Other adapter input rules apply too (bounded limit, parseable start time).
  assert.throws(() => setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Target' }, limit: 9999 } }),
    (error) => error.status === 400 && error.code === 'invalid_connector_limit');
  assert.throws(() => setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Target' }, start_datetime: 'not-a-date' } }),
    (error) => error.status === 400 && error.code === 'invalid_connector_cursor');
  const untouched = gdeltRow();
  assert.equal(untouched.enabled, 0, 'a rejected save leaves the connector disabled');
  assert.equal(untouched.next_run_at, null, 'a rejected save schedules nothing');
  assert.equal(JSON.parse(untouched.config_json).scheduleInput, undefined, 'a rejected schedule_input is not persisted');
  assert.equal(db.get("SELECT COUNT(*) count FROM connector_runs WHERE connector_key='gdelt'").count, 0, 'validation never starts a run');

  // Valid schedule input still saves and arms the cadence.
  const saved = setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Target' }, limit: 5 } });
  assert.equal(saved.enabled, true);
  assert.deepEqual(saved.config.scheduleInput, { company: { name: 'Target' }, limit: 5 });
  assert.ok(gdeltRow().next_run_at, 'a valid save arms the schedule');

  // Disabling never re-validates: an operator can always switch a cadence off.
  const disabled = setConnectorEnabled(db, config.defaultTenantId, 'gdelt', false);
  assert.equal(disabled.enabled, false);
  db.close();
});

test('save-time validation leaves manual one-time runs to the adapter at run time', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  // A manual run with bad input still fails through runConnector (the adapter rejects it) and records the run.
  await assert.rejects(() => runConnector(db, config.defaultTenantId, 'gdelt', { query: 'no company here' }), { code: 'company_required', status: 400 });
  assert.equal(db.get("SELECT COUNT(*) count FROM connector_runs WHERE connector_key='gdelt' AND status='failed'").count, 1);
  db.close();
});

test('scheduler runs an enabled cadence and refreshes due scores without a manual trigger', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  const received = [];
  GdeltConnector.prototype.run = async function (input) {
    received.push(input);
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  const decaying = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Scheduled Decay', domain: 'scheduled-decay.test' }, source: 'launch_feed', type: 'product_launch',
    title: 'Launch announced', observed_at: new Date().toISOString(), attributes: { is_new: true }
  });
  db.run("UPDATE companies SET next_refresh_at='2024-03-02T00:00:00.000Z' WHERE id=?", [decaying.company.id]);
  const events = [];
  let stop;
  try {
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Target' }, limit: 5 } });
    assert.equal(db.get("SELECT COUNT(*) count FROM connector_runs WHERE connector_key='gdelt'").count, 0);

    stop = startScheduler(db, 60_000, { onEvent: (event) => events.push(event) });
    await waitFor(() => events.some((event) => event.event === 'scheduler_tick'));

    assert.equal(received.length, 1, 'the due connector ran exactly once on the first tick');
    assert.deepEqual(received[0].company, { name: 'Target' });
    const runs = db.all("SELECT status, tenant_id FROM connector_runs WHERE connector_key='gdelt'");
    assert.equal(runs.length, 1);
    assert.equal(runs[0].status, 'succeeded');
    assert.equal(runs[0].tenant_id, config.defaultTenantId);
    const connector = db.get("SELECT status, next_run_at, last_run_at FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(connector.status, 'ready');
    assert.ok(connector.last_run_at);
    assert.ok(connector.next_run_at > connector.last_run_at, 'the next run is scheduled after the cadence');

    const refreshed = db.get('SELECT next_refresh_at FROM companies WHERE id=?', [decaying.company.id]);
    assert.ok(refreshed.next_refresh_at > '2024-03-02T00:00:00.000Z', 'the due company was rescored by the tick');
    assert.ok(events.some((event) => event.event === 'scheduled_connector_run' && event.connector === 'gdelt'));
    assert.equal(events.filter((event) => event.level === 'error').length, 0);
  } finally {
    if (stop) await stop();
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('scheduler keeps ticking after an idle tick and picks up a cadence enabled later', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let runs = 0;
  GdeltConnector.prototype.run = async function () {
    runs += 1;
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  const originalSetInterval = globalThis.setInterval;
  let scheduledTick;
  globalThis.setInterval = (fn) => { scheduledTick = fn; return { unref() {} }; };
  const originalClearInterval = globalThis.clearInterval;
  globalThis.clearInterval = () => {};
  const events = [];
  let stop;
  try {
    stop = startScheduler(db, 60_000, { onEvent: (event) => events.push(event) });
    globalThis.setInterval = originalSetInterval;
    // First tick: nothing enabled, nothing to await, must not wedge the scheduler.
    await waitFor(() => events.filter((event) => event.event === 'scheduler_tick').length === 1);
    assert.equal(runs, 0);

    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Later' } } });
    await scheduledTick();
    assert.equal(runs, 1, 'the interval tick after an idle tick still runs the newly due connector');
    assert.equal(db.get("SELECT COUNT(*) count FROM connector_runs WHERE connector_key='gdelt' AND status='succeeded'").count, 1);
    assert.equal(events.filter((event) => event.event === 'scheduler_tick').length, 2);
  } finally {
    globalThis.setInterval = originalSetInterval;
    globalThis.clearInterval = originalClearInterval;
    if (stop) await stop();
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('scheduler defers a cadence whose schedule input is rejected instead of retrying every tick', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const events = [];
  let stop;
  try {
    // GDELT rejects schedule input without a target company (a 400-class AppError from the adapter).
    // setConnectorEnabled now refuses such input on save, so write the row directly to model a
    // cadence persisted before the adapter tightened its rules.
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Target' } } });
    db.run("UPDATE connectors SET config_json=? WHERE tenant_id=? AND connector_key='gdelt'",
      [JSON.stringify({ ...JSON.parse(db.get("SELECT config_json FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]).config_json), scheduleInput: { query: 'no company here' } }), config.defaultTenantId]);
    const before = db.get("SELECT next_run_at FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]).next_run_at;
    stop = startScheduler(db, 60_000, { onEvent: (event) => events.push(event) });
    await waitFor(() => events.some((event) => event.event === 'scheduler_tick'));

    const failure = events.find((event) => event.event === 'connector_run_failed');
    assert.ok(failure, 'the rejected run is reported');
    assert.equal(failure.deferred_to_next_cadence, true);
    assert.equal(db.get("SELECT COUNT(*) count FROM connector_runs WHERE connector_key='gdelt' AND status='failed'").count, 1);
    const after = db.get("SELECT next_run_at, backoff_until FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.ok(after.next_run_at > before, 'next_run_at moved to the next cadence slot');
    assert.ok(after.next_run_at > new Date().toISOString(), 'the connector is no longer due');
    assert.equal(after.backoff_until, null, 'validation rejections do not trigger operational backoff');
  } finally {
    if (stop) await stop();
    db.close();
  }
});

test('a rejected schedule input is visible on the connector as schedule_rejected until the next run', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const events = [];
  let stop;
  try {
    // Save-time validation refuses company-less GDELT input, so model a cadence persisted
    // before the adapter tightened its rules by writing the stored input directly.
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Target' } } });
    db.run("UPDATE connectors SET config_json=? WHERE tenant_id=? AND connector_key='gdelt'",
      [JSON.stringify({ ...JSON.parse(db.get("SELECT config_json FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]).config_json), scheduleInput: { query: 'no company here' } }), config.defaultTenantId]);
    stop = startScheduler(db, 60_000, { onEvent: (event) => events.push(event) });
    await waitFor(() => events.some((event) => event.event === 'scheduler_tick'));
    await stop();
    stop = null;

    const connector = listConnectors(db, config.defaultTenantId).find((item) => item.connector_key === 'gdelt');
    assert.equal(connector.status, 'schedule_rejected');
    assert.ok(connector.last_error, 'the rejection message is kept on the connector');
    assert.equal(connector.last_run.status, 'failed');
    assert.equal(connector.last_run.trigger, 'scheduled', 'the failed run is attributed to the scheduler');
    const schedule = describeConnectorSchedule({ ...connector, implemented: true });
    assert.equal(schedule.state, 'input_rejected');
    assert.equal(schedule.will_run, false);
    assert.match(schedule.reason, /schedule input was rejected/);

    // Listing the catalog again (which resyncs connector rows) must not erase the marker.
    const apiKey = `test_${id('key')}`;
    db.run(`INSERT INTO api_keys(id, tenant_id, name, key_prefix, key_hash, scopes, created_at) VALUES (?, ?, ?, ?, ?, 'admin', ?)`,
      ['key_schedule_admin', config.defaultTenantId, 'Schedule API key', apiKey.slice(0, 16), sha256(apiKey), nowIso()]);
    const app = await startApp(db);
    try {
      const listed = await app.request('/api/v1/connectors', { method: 'GET', headers: { 'x-api-key': apiKey } });
      assert.equal(listed.status, 200);
      const gdelt = (await listed.json()).data.find((item) => item.connector_key === 'gdelt');
      assert.equal(gdelt.status, 'schedule_rejected');
      assert.equal(gdelt.schedule.state, 'input_rejected');
      assert.equal(gdelt.schedule.will_run, false);
      assert.equal(gdelt.last_run.trigger, 'scheduled');
      const history = await app.request('/api/v1/connectors/runs?connector_key=gdelt', { method: 'GET', headers: { 'x-api-key': apiKey } });
      assert.equal(history.status, 200);
      assert.deepEqual((await history.json()).data.map((run) => [run.connector_key, run.status, run.trigger]), [['gdelt', 'failed', 'scheduled']]);
    } finally {
      await app.close();
    }

    // Fixing the input and re-enabling clears the rejection and makes the cadence due again.
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Fixed' } } });
    const fixed = listConnectors(db, config.defaultTenantId).find((item) => item.connector_key === 'gdelt');
    assert.equal(fixed.status, 'ready');
    assert.equal(describeConnectorSchedule({ ...fixed, implemented: true }).state, 'due');
  } finally {
    if (stop) await stop();
    db.close();
  }
});

test('connector runs record whether the scheduler or an operator started them', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  GdeltConnector.prototype.run = async () => ({ records: [], normalizationErrors: [], cursor: null, usage: {} });
  const events = [];
  let stop;
  try {
    const manualRun = await runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'Manual Co' } });
    // Distinct fixture times: two fast empty runs can otherwise start in the same millisecond.
    db.run('UPDATE connector_runs SET started_at=? WHERE id=?', [new Date(Date.now() - 1000).toISOString(), manualRun.run_id]);
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Scheduled Co' } } });
    stop = startScheduler(db, 60_000, { onEvent: (event) => events.push(event) });
    await waitFor(() => events.some((event) => event.event === 'scheduled_connector_run'));
    await stop();
    stop = null;

    const runs = connectorRuns(db, config.defaultTenantId, { connector_key: 'gdelt' });
    assert.deepEqual(runs.map((run) => run.trigger), ['scheduled', 'manual'], 'newest first, each attributed to its trigger');
    assert.deepEqual(runs.map((run) => run.metadata.trigger), ['scheduled', 'manual']);
    assert.equal(connectorRuns(db, config.defaultTenantId, { connector_key: 'sec_edgar' }).length, 0, 'connector_key filters the history');

    const connector = listConnectors(db, config.defaultTenantId).find((item) => item.connector_key === 'gdelt');
    assert.equal(connector.last_run.trigger, 'scheduled');
    assert.equal(connector.last_run.status, 'succeeded');
    const schedule = describeConnectorSchedule({ ...connector, implemented: true });
    assert.equal(schedule.state, 'waiting');
    assert.equal(schedule.next_run_at, connector.next_run_at);

    // Runs recorded before the trigger flag existed are reported as unknown, never guessed.
    db.run("UPDATE connector_runs SET metadata_json='{}' WHERE connector_key='gdelt'");
    assert.deepEqual(connectorRuns(db, config.defaultTenantId, { connector_key: 'gdelt' }).map((run) => run.trigger), [null, null]);
  } finally {
    if (stop) await stop();
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('describeConnectorSchedule explains every reason a cadence is not running', () => {
  const now = '2026-09-04T12:00:00.000Z';
  const base = { label: 'GDELT', mode: 'pull', cadence: 'hourly', implemented: true, configured: true, enabled: true, status: 'ready',
    next_run_at: '2026-09-04T13:00:00.000Z', backoff_until: null, consecutive_failures: 0, last_error: null };
  assert.equal(describeConnectorSchedule({ ...base, mode: 'push' }, now).state, 'push');
  assert.equal(describeConnectorSchedule({ ...base, implemented: false }, now).state, 'adapter_pending');
  assert.equal(describeConnectorSchedule({ ...base, configured: false }, now).state, 'needs_configuration');
  assert.equal(describeConnectorSchedule({ ...base, enabled: false }, now).state, 'disabled');
  assert.equal(describeConnectorSchedule({ ...base, status: 'running' }, now).state, 'running');
  const backoff = describeConnectorSchedule({ ...base, status: 'error', consecutive_failures: 3, backoff_until: '2026-09-04T16:00:00.000Z' }, now);
  assert.equal(backoff.state, 'backoff');
  assert.equal(backoff.will_run, true);
  assert.match(backoff.reason, /3 consecutive failures/);
  assert.match(backoff.reason, /2026-09-04T16:00:00.000Z/);
  const expiredBackoff = describeConnectorSchedule({ ...base, status: 'error', consecutive_failures: 3, backoff_until: '2026-09-04T11:00:00.000Z', next_run_at: '2026-09-04T11:00:00.000Z' }, now);
  assert.equal(expiredBackoff.state, 'due');
  assert.match(expiredBackoff.reason, /while the service is active/);
  assert.equal(describeConnectorSchedule({ ...base, cadence: 'manual', next_run_at: null }, now).state, 'manual');
  const waiting = describeConnectorSchedule(base, now);
  assert.equal(waiting.state, 'waiting');
  assert.match(waiting.reason, /hourly cadence/);
  assert.equal(describeConnectorSchedule({ ...base, next_run_at: null }, now).state, 'due');
});

test('stopping the scheduler waits for the in-flight run and starts nothing new', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let release;
  let started = false;
  let finished = false;
  GdeltConnector.prototype.run = async function () {
    started = true;
    await new Promise((resolve) => { release = resolve; });
    finished = true;
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  try {
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Target' } } });
    const stop = startScheduler(db, 60_000, { onEvent: () => {} });
    await waitFor(() => started);
    const stopping = stop();
    let stopped = false;
    stopping.then(() => { stopped = true; });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(stopped, false, 'stop waits for the in-flight connector run');
    release();
    await stopping;
    assert.equal(finished, true);
    assert.equal(db.get("SELECT status FROM connector_runs WHERE connector_key='gdelt'").status, 'succeeded');
  } finally {
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('two schedulers sharing one database run a due connector exactly once', async () => {
  // Two instances = two connections to the same store: a SQLite file, or the
  // same private schema when the suite runs against Postgres.
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'hookpoint-scheduler-lease-'));
  const primary = testDatabaseTarget() === ':memory:' ? openDatabase(path.join(directory, 'radar.sqlite')) : openTestDatabase();
  const secondary = openDatabase(testDatabaseTarget() === ':memory:' ? path.join(directory, 'radar.sqlite') : testDatabaseTarget(), attachOptions(primary));
  bootstrap(primary);
  primary.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let invocations = 0;
  let concurrent = 0;
  let maxConcurrent = 0;
  GdeltConnector.prototype.run = async function () {
    invocations += 1;
    concurrent += 1;
    maxConcurrent = Math.max(maxConcurrent, concurrent);
    // Stay in flight long enough for the other scheduler's tick to observe the lease.
    await new Promise((resolve) => setTimeout(resolve, 60));
    concurrent -= 1;
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  const events = { a: [], b: [] };
  const stops = [];
  try {
    setConnectorEnabled(primary, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Shared target' } } });
    stops.push(startScheduler(primary, 60_000, { instanceId: 'instance-a', onEvent: (event) => events.a.push(event) }));
    stops.push(startScheduler(secondary, 60_000, { instanceId: 'instance-b', onEvent: (event) => events.b.push(event) }));
    await waitFor(() => events.a.some((event) => event.event === 'scheduler_tick') && events.b.some((event) => event.event === 'scheduler_tick'));

    assert.equal(invocations, 1, 'the connector ran on exactly one instance');
    assert.equal(maxConcurrent, 1);
    const runs = primary.all("SELECT status, metadata_json FROM connector_runs WHERE connector_key='gdelt'");
    assert.equal(runs.length, 1, 'exactly one connector_runs row');
    assert.equal(runs[0].status, 'succeeded');
    const scheduled = [...events.a, ...events.b].filter((event) => event.event === 'scheduled_connector_run');
    assert.equal(scheduled.length, 1);
    const winner = events.a.includes(scheduled[0]) ? 'instance-a' : 'instance-b';
    assert.equal(JSON.parse(runs[0].metadata_json).instance, winner);
    const connector = primary.get("SELECT status, lease_owner, lease_token, lease_expires_at, next_run_at FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(connector.status, 'ready');
    assert.equal(connector.lease_owner, null, 'the lease is released when the run finishes');
    assert.equal(connector.lease_token, null);
    assert.equal(connector.lease_expires_at, null);
    assert.ok(connector.next_run_at > new Date().toISOString(), 'the connector is no longer due');
    assert.equal([...events.a, ...events.b].filter((event) => event.level === 'error').length, 0);

    // While a run holds the lease, a manual run (from any instance) is refused
    // and a scheduler tick treats the connector as not due.
    let release;
    GdeltConnector.prototype.run = async function () {
      await new Promise((resolve) => { release = resolve; });
      return { records: [], normalizationErrors: [], cursor: null, usage: {} };
    };
    const held = runConnector(primary, config.defaultTenantId, 'gdelt', { company: { name: 'Manual' } });
    await waitFor(() => Boolean(release));
    await assert.rejects(runConnector(secondary, config.defaultTenantId, 'gdelt', { company: { name: 'Manual' } }),
      (error) => error.code === 'connector_already_running' && error.status === 409);
    await assert.rejects(runConnector(secondary, config.defaultTenantId, 'gdelt', { company: { name: 'Manual' } }, { requireDue: true }),
      (error) => error.code === 'connector_not_due');
    release();
    const manual = await held;
    assert.equal(manual.status, 'succeeded');
    assert.equal(primary.get("SELECT error_message FROM connector_runs WHERE id=?", [manual.run_id]).error_message, null);
    assert.equal(primary.get("SELECT COUNT(*) count FROM connector_runs WHERE connector_key='gdelt'").count, 2);
  } finally {
    for (const stop of stops) await stop();
    GdeltConnector.prototype.run = originalRun;
    secondary.close();
    primary.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('scheduler recovers an expired lease, marks the run abandoned and backs the connector off', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let invocations = 0;
  GdeltConnector.prototype.run = async function () {
    invocations += 1;
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  const events = [];
  let stop;
  try {
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Crashed target' } } });
    // Simulate an instance that claimed the connector, started a run and died:
    // the lease was never renewed or released.
    const staleStart = new Date(Date.now() - 20 * 60_000).toISOString();
    const expired = new Date(Date.now() - 60_000).toISOString();
    db.run(`INSERT INTO connector_runs(id, tenant_id, connector_key, status, started_at, metadata_json)
      VALUES ('run_crashed', ?, 'gdelt', 'running', ?, '{}')`, [config.defaultTenantId, staleStart]);
    db.run(`UPDATE connectors SET status='running', lease_owner='dead-instance', lease_token='run_crashed', lease_expires_at=?
      WHERE tenant_id=? AND connector_key='gdelt'`, [expired, config.defaultTenantId]);
    // A live lease held by another instance must be left alone.
    db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='sec_edgar'", [config.defaultTenantId]);
    const live = new Date(Date.now() + 10 * 60_000).toISOString();
    db.run(`INSERT INTO connector_runs(id, tenant_id, connector_key, status, started_at, metadata_json)
      VALUES ('run_live', ?, 'sec_edgar', 'running', ?, '{}')`, [config.defaultTenantId, new Date().toISOString()]);
    db.run(`UPDATE connectors SET status='running', lease_owner='busy-instance', lease_token='run_live', lease_expires_at=?
      WHERE tenant_id=? AND connector_key='sec_edgar'`, [live, config.defaultTenantId]);

    stop = startScheduler(db, 60_000, { onEvent: (event) => events.push(event) });
    await waitFor(() => events.some((event) => event.event === 'scheduler_tick'));

    const abandoned = events.find((event) => event.event === 'connector_run_abandoned');
    assert.ok(abandoned, 'the recovery is reported');
    assert.equal(abandoned.level, 'warn');
    assert.equal(abandoned.connector, 'gdelt');
    assert.equal(abandoned.run_id, 'run_crashed');
    assert.equal(abandoned.lease_owner, 'dead-instance');
    assert.equal(events.filter((event) => event.event === 'connector_run_abandoned').length, 1, 'the live lease is not recovered');

    const run = db.get("SELECT status, finished_at, error_message FROM connector_runs WHERE id='run_crashed'");
    assert.equal(run.status, 'abandoned');
    assert.ok(run.finished_at);
    assert.match(run.error_message, /lease expired/i);
    assert.equal(db.get("SELECT status FROM connector_runs WHERE id='run_live'").status, 'running');

    const connector = db.get("SELECT status, lease_owner, lease_token, lease_expires_at, consecutive_failures, backoff_until, last_error FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(connector.status, 'error');
    assert.equal(connector.lease_owner, null);
    assert.equal(connector.lease_token, null);
    assert.equal(connector.lease_expires_at, null);
    assert.equal(connector.consecutive_failures, 1);
    assert.ok(connector.backoff_until > new Date().toISOString(), 'an abandoned run counts as an operational failure');
    assert.match(connector.last_error, /lease expired/i);
    assert.equal(invocations, 0, 'the recovered connector is in backoff and not re-run in the same tick');
    const busy = db.get("SELECT status, lease_owner, lease_expires_at FROM connectors WHERE tenant_id=? AND connector_key='sec_edgar'", [config.defaultTenantId]);
    assert.deepEqual(busy, { status: 'running', lease_owner: 'busy-instance', lease_expires_at: live });

    // Once the backoff passes the connector is claimable again and runs normally.
    db.run("UPDATE connectors SET backoff_until=NULL WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    const outcome = await runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'Crashed target' } }, { requireDue: true });
    assert.equal(outcome.status, 'succeeded');
    assert.equal(invocations, 1);
    assert.equal(db.get("SELECT consecutive_failures FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]).consecutive_failures, 0);
  } finally {
    if (stop) await stop();
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('a run that outlives its lease discards its results instead of overwriting the recovered state', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let release;
  GdeltConnector.prototype.run = async function () {
    await new Promise((resolve) => { release = resolve; });
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  try {
    setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, { schedule_input: { company: { name: 'Slow target' } } });
    const running = runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'Slow target' } });
    await waitFor(() => Boolean(release));
    const runId = db.get("SELECT lease_token FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]).lease_token;
    assert.ok(runId, 'the run holds the lease while in flight');
    // The instance stalls: its lease lapses and another instance recovers it.
    db.run("UPDATE connectors SET lease_expires_at=? WHERE tenant_id=? AND connector_key='gdelt'", [new Date(Date.now() - 1_000).toISOString(), config.defaultTenantId]);
    const recovered = recoverExpiredLeases(db);
    assert.equal(recovered.length, 1);
    assert.equal(recovered[0].run_id, runId);
    const afterRecovery = db.get("SELECT status, backoff_until, lease_token FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(afterRecovery.status, 'error');
    assert.equal(afterRecovery.lease_token, null);

    release();
    await assert.rejects(running, (error) => error.code === 'connector_lease_lost' && error.status === 409);
    const run = db.get('SELECT status, finished_at, error_message FROM connector_runs WHERE id=?', [runId]);
    assert.equal(run.status, 'abandoned', 'the late result is discarded, not stored on top of the recovery');
    assert.ok(run.finished_at);
    assert.match(run.error_message, /lease expired/i);
    const connector = db.get("SELECT status, backoff_until, lease_token, last_run_at FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(connector.status, 'error', 'the late finish did not clobber the recovered connector state');
    assert.equal(connector.backoff_until, afterRecovery.backoff_until);
    assert.equal(connector.lease_token, null);
    assert.equal(connector.last_run_at, null);
  } finally {
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('a lease that expires during a long ingestion stops the run before it can report success', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const records = Array.from({ length: 60 }, (_, index) => ({
    company: { name: 'Long Ingest Co', domain: 'long-ingest.test' }, source: 'gdelt', external_id: `long-${index}`,
    type: 'news', title: `Mention ${index}`, observed_at: new Date().toISOString(),
  }));
  const originalRun = GdeltConnector.prototype.run;
  GdeltConnector.prototype.run = async () => ({ records, normalizationErrors: [], cursor: null, usage: {} });
  // Ingestion is synchronous, so the lease is expired from inside it: after a
  // handful of per-record transactions the clock (as far as the row is
  // concerned) has passed lease_expires_at.
  const originalTransaction = db.transaction.bind(db);
  let recordTransactions = 0;
  db.transaction = (fn) => {
    const result = originalTransaction(fn);
    recordTransactions += 1;
    if (recordTransactions === 10) db.run("UPDATE connectors SET lease_expires_at=? WHERE tenant_id=? AND connector_key='gdelt'", [new Date(Date.now() - 1_000).toISOString(), config.defaultTenantId]);
    return result;
  };
  try {
    await assert.rejects(runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'Long Ingest Co' } }), (error) => error.code === 'connector_lease_lost');
    const run = db.get("SELECT id, status FROM connector_runs WHERE connector_key='gdelt' ORDER BY started_at DESC LIMIT 1");
    assert.equal(run.status, 'abandoned');
    const stored = db.get("SELECT COUNT(*) AS n FROM observations WHERE tenant_id=? AND source='gdelt'", [config.defaultTenantId]).n;
    assert.ok(stored > 0 && stored < records.length, `ingestion stopped part-way (${stored} of ${records.length})`);
    const connector = db.get("SELECT status, lease_token, last_run_at FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(connector.lease_token, run.id, 'the expired holder did not clear or close the lease');
    assert.equal(connector.last_run_at, null, 'no success was recorded on the connector');

    // Recovery hands the connector to the next claimant, which re-ingests
    // the same records without duplicates once its backoff has passed.
    db.transaction = originalTransaction;
    assert.equal(recoverExpiredLeases(db).length, 1);
    db.run("UPDATE connectors SET backoff_until=NULL WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    const rerun = await runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'Long Ingest Co' } });
    assert.equal(rerun.status, 'succeeded');
    assert.equal(rerun.inserted + rerun.duplicates, records.length);
    assert.equal(rerun.duplicates, stored);
    assert.equal(db.get("SELECT COUNT(*) AS n FROM observations WHERE tenant_id=? AND source='gdelt'", [config.defaultTenantId]).n, records.length);
  } finally {
    db.transaction = originalTransaction;
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('an expired lease cannot be revived by its holder even before anyone recovers it', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let release;
  GdeltConnector.prototype.run = async function () {
    await new Promise((resolve) => { release = resolve; });
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  try {
    const running = runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'Slow target' } });
    await waitFor(() => Boolean(release));
    const runId = db.get("SELECT lease_token FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]).lease_token;
    const expired = new Date(Date.now() - 1_000).toISOString();
    db.run("UPDATE connectors SET lease_expires_at=? WHERE tenant_id=? AND connector_key='gdelt'", [expired, config.defaultTenantId]);
    release();
    await assert.rejects(running, (error) => error.code === 'connector_lease_lost');
    assert.equal(db.get('SELECT status FROM connector_runs WHERE id=?', [runId]).status, 'abandoned');
    // The stale lease is left for recovery, which then applies the backoff.
    const stale = db.get("SELECT lease_token, lease_expires_at, status FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(stale.lease_token, runId);
    assert.equal(stale.lease_expires_at, expired);
    assert.equal(stale.status, 'running');
    const recovered = recoverExpiredLeases(db);
    assert.deepEqual(recovered.map((item) => item.run_id), [runId]);
    assert.equal(recovered[0].runs_abandoned, 0, 'the run was already closed as abandoned by its own instance');
    const after = db.get("SELECT lease_token, status FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
    assert.equal(after.lease_token, null);
    assert.equal(after.status, 'error');
  } finally {
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('bootstrap recovers expired leases but leaves live ones to their instance', () => {
  const db = setup();
  const expired = new Date(Date.now() - 60_000).toISOString();
  const live = new Date(Date.now() + 60_000).toISOString();
  // Enabled, configured connectors keep an 'error' status through the catalog sync.
  db.run("UPDATE connectors SET enabled=1, configured=1 WHERE tenant_id=? AND connector_key IN ('gdelt','sec_edgar','usa_spending')", [config.defaultTenantId]);
  db.run(`INSERT INTO connector_runs(id, tenant_id, connector_key, status, started_at, metadata_json)
    VALUES ('run_old', ?, 'gdelt', 'running', ?, '{}'), ('run_live', ?, 'sec_edgar', 'running', ?, '{}')`,
    [config.defaultTenantId, expired, config.defaultTenantId, live]);
  db.run("UPDATE connectors SET status='running', lease_owner='gone', lease_token='run_old', lease_expires_at=? WHERE tenant_id=? AND connector_key='gdelt'", [expired, config.defaultTenantId]);
  db.run("UPDATE connectors SET status='running', lease_owner='alive', lease_token='run_live', lease_expires_at=? WHERE tenant_id=? AND connector_key='sec_edgar'", [live, config.defaultTenantId]);
  // A row from before leases existed: running with no lease at all.
  db.run(`INSERT INTO connector_runs(id, tenant_id, connector_key, status, started_at, metadata_json)
    VALUES ('run_legacy', ?, 'usa_spending', 'running', ?, '{}')`, [config.defaultTenantId, expired]);
  db.run("UPDATE connectors SET status='running' WHERE tenant_id=? AND connector_key='usa_spending'", [config.defaultTenantId]);
  try {
    bootstrap(db);
    assert.equal(db.get("SELECT status FROM connector_runs WHERE id='run_old'").status, 'abandoned');
    assert.equal(db.get("SELECT status FROM connector_runs WHERE id='run_legacy'").status, 'abandoned');
    assert.equal(db.get("SELECT status FROM connector_runs WHERE id='run_live'").status, 'running');
    assert.equal(db.get("SELECT status FROM connectors WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]).status, 'error');
    assert.equal(db.get("SELECT status FROM connectors WHERE tenant_id=? AND connector_key='usa_spending'", [config.defaultTenantId]).status, 'error');
    assert.equal(db.get("SELECT status, lease_token FROM connectors WHERE tenant_id=? AND connector_key='sec_edgar'", [config.defaultTenantId]).lease_token, 'run_live');
  } finally {
    db.close();
  }
});

async function waitFor(predicate, timeoutMs = 2_000) {
  const deadline = Date.now() + timeoutMs;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('Timed out waiting for condition');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

test('expires stale signals when their score refresh becomes due', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Decay Control', domain: 'decay.test' }, source: 'launch_feed', type: 'product_launch',
    title: 'Launch announced', observed_at: new Date().toISOString(), attributes: { is_new: true }
  });
  db.run("UPDATE signals SET last_seen_at='2024-01-01T00:00:00.000Z', expires_at='2024-03-01T00:00:00.000Z' WHERE company_id=?", [result.company.id]);
  db.run("UPDATE observations SET observed_at='2024-01-01T00:00:00.000Z' WHERE company_id=?", [result.company.id]);
  db.run("UPDATE companies SET next_refresh_at='2024-03-02T00:00:00.000Z' WHERE id=?", [result.company.id]);
  const rescored = rescoreDueCompanies(db, config.defaultTenantId, 10);
  assert.equal(rescored.length, 1);
  assert.equal(db.get("SELECT COUNT(*) count FROM signals WHERE company_id=? AND status='active'", [result.company.id]).count, 0);
  assert.equal(companyDetail(db, config.defaultTenantId, result.company.id).recommendation, null);
  db.close();
});

test('rejects a replayed webhook receipt', () => {
  const db = setup();
  const receipt = { signatureHash: 'a'.repeat(64) };
  consumeWebhookReceipt(db, config.defaultTenantId, receipt);
  assert.throws(() => consumeWebhookReceipt(db, config.defaultTenantId, receipt), /already been processed/i);
  db.close();
});

test('fails a connector run when the provider payload has no item array', async () => {
  class InvalidPayloadConnector extends BaseConnector {
    validateConfiguration() { return true; }
    async collect() { return { unexpected: true }; }
  }
  const connector = new InvalidPayloadConnector({ label: 'Invalid provider' });
  await assert.rejects(() => connector.run({}), /did not return an item array/i);
});

test('preserves provider cursor and usage metadata from a bounded connector result', async () => {
  class CursorConnector extends BaseConnector {
    validateConfiguration() { return true; }
    async collect() { return { items: [{ id: 'one' }], cursor: { page: 2 }, usage: { records: 1 } }; }
    normalize(item) {
      return { source: 'cursor_test', external_id: item.id, type: 'news', title: 'Cursor fixture', company: { name: 'Cursor Fixture' } };
    }
  }
  const result = await new CursorConnector({ label: 'Cursor provider' }).run({});
  assert.deepEqual(result.cursor, { page: 2 });
  assert.deepEqual(result.usage, { records: 1 });
  assert.equal(result.records.length, 1);
});

test('resumes a provider cursor only for the same connector input', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const received = [];
  const originalRun = GdeltConnector.prototype.run;
  GdeltConnector.prototype.run = async function (input) {
    received.push(input);
    return {
      records: [],
      normalizationErrors: [],
      cursor: { page: received.length + 1 },
      usage: {},
    };
  };
  try {
    const first = await runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'First target' }, limit: 10 });
    const second = await runConnector(db, config.defaultTenantId, 'gdelt', { limit: 10, company: { name: 'First target' } });
    const changed = await runConnector(db, config.defaultTenantId, 'gdelt', { company: { name: 'Different target' }, limit: 10 });

    assert.equal(first.resumed, false);
    assert.equal(second.resumed, true);
    assert.deepEqual(received[1].cursor, { page: 2 });
    assert.equal(changed.resumed, false);
    assert.equal(received[2].cursor, undefined);
  } finally {
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('rejects secret-bearing manual connector input before persistence or invocation', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let invoked = false;
  GdeltConnector.prototype.run = async function () {
    invoked = true;
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  try {
    await assert.rejects(
      runConnector(db, config.defaultTenantId, 'gdelt', { company: 'Target', api_key: 'must-not-be-here' }),
      { code: 'unsafe_connector_input' }
    );
    assert.equal(invoked, false);
    assert.equal(db.get("SELECT COUNT(*) count FROM connector_runs WHERE connector_key='gdelt'").count, 0);
  } finally {
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('overwrites spoofed trusted tenant input without persisting it', async () => {
  const db = setup();
  db.run("UPDATE connectors SET configured=1 WHERE tenant_id=? AND connector_key='gdelt'", [config.defaultTenantId]);
  const originalRun = GdeltConnector.prototype.run;
  let received;
  GdeltConnector.prototype.run = async function (input) {
    received = input;
    return { records: [], normalizationErrors: [], cursor: null, usage: {} };
  };
  try {
    await runConnector(db, config.defaultTenantId, 'gdelt', {
      company: 'Target',
      trustedTenantId: 'tenant_spoofed',
      trusted_tenant_id: 'tenant_also_spoofed',
    });
    assert.equal(received.trustedTenantId, config.defaultTenantId);
    assert.equal(received.trusted_tenant_id, config.defaultTenantId);
    assert.equal(Object.keys(received).includes('trustedTenantId'), false);
    assert.equal(Object.keys(received).includes('trusted_tenant_id'), false);
    const stored = db.get("SELECT metadata_json, cursor_json FROM connector_runs WHERE connector_key='gdelt'");
    assert.doesNotMatch(stored.metadata_json, /tenant_spoofed|trustedTenant|trusted_tenant/);
    assert.doesNotMatch(stored.cursor_json, /tenant_spoofed|trustedTenant|trusted_tenant/);
  } finally {
    GdeltConnector.prototype.run = originalRun;
    db.close();
  }
});

test('redacts credentials from connector normalization errors', async () => {
  class SecretErrorConnector extends BaseConnector {
    validateConfiguration() { return true; }
    async collect() { return [{ id: 'one' }]; }
    normalize() { throw new Error('authorization=Bearer super-secret-token'); }
  }
  const result = await new SecretErrorConnector({ label: 'Secret error provider' }).run({});
  assert.doesNotMatch(result.normalizationErrors[0].message, /super-secret-token/);
  assert.match(result.normalizationErrors[0].message, /REDACTED/);
});

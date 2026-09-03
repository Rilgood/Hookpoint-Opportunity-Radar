import { config, runtimeIssues } from './config.js';
import { AppError, id, isPlainObject, json, nowIso } from './lib.js';
import { bootstrap } from './services/bootstrap.js';
import { createCompany, deleteCompany, updateCompany } from './services/entities.js';
import { ingestBatch } from './services/ingestion.js';
import { companyDetail, connectorRuns, dashboardSummary, dataQuality, exportCompaniesCsv, ingestionRejections, listCompanies, listConnectors, listSignals, reviewQueue } from './services/queries.js';
import { rescoreAll, rescoreCompany, rescoreDueCompanies } from './services/signals.js';
import { scoringConfig, signalCatalog } from './services/catalog.js';
import { implementedConnectorKeys } from './connectors/index.js';
import { runConnector, setConnectorEnabled } from './services/connector-runner.js';
import { recordAudit } from './services/audit.js';
import { outcomeAnalytics, recordOutcome } from './services/outcomes.js';
import { createApiKey, listApiKeys, revokeApiKey } from './services/api-keys.js';
import { consumeWebhookReceipt, verifyWebhook } from './services/webhooks.js';
import { Router } from './http/router.js';
import { readBody, sendJson, sendText, serveStatic } from './http/io.js';
import { authenticate, enforceRateLimit, requireScope, securityHeaders } from './http/security.js';
import { observationTypes } from './observation-contract.js';

export function createApp(db, { serveStaticAssets = true } = {}) {
  bootstrap(db);
  const router = new Router();

  const health = async () => ({ status: 'ok', service: 'hookpoint-opportunity-radar', version: '1.1.0', time: nowIso() });
  const readiness = async () => {
    const migration = db.get('SELECT MAX(version) version FROM schema_migrations');
    const issues = runtimeIssues(db);
    const ready = Boolean(migration?.version) && !issues.some((issue) => issue.severity === 'critical');
    return { status: ready ? 200 : 503, data: { status: ready ? 'ready' : 'not_ready', schema_version: migration?.version || 0, storage_mode: config.storageMode, issues } };
  };
  router.get('/health', health, { publicRoute: true });
  router.get('/ready', readiness, { publicRoute: true });
  router.get('/api/health', health, { publicRoute: true });
  router.get('/api/ready', readiness, { publicRoute: true });

  router.get('/api/v1/meta', async () => ({
    name: 'Hook Point Opportunity Radar', version: '1.1.0', scoring_version: scoringConfig.version, storage_mode: config.storageMode,
    observation_types: observationTypes, implemented_connectors: [...implementedConnectorKeys]
  }));
  router.get('/api/v1/dashboard', async ({ auth }) => dashboardSummary(db, auth.tenantId));
  router.get('/api/v1/companies', async ({ auth, query }) => listCompanies(db, auth.tenantId, query));
  router.get('/api/v1/companies/:id', async ({ auth, params }) => companyDetail(db, auth.tenantId, params.id));
  router.post('/api/v1/companies', async ({ auth, body, requestId }) => {
    requireScope(auth, 'write');
    const company = db.transaction(() => {
      const created = createCompany(db, auth.tenantId, body);
      return rescoreCompany(db, auth.tenantId, created.id);
    });
    recordAudit(db, auth.tenantId, { action: 'company.created', actor: auth.actor, resourceType: 'company', resourceId: company.id, requestId });
    return { status: 201, data: company };
  });
  router.patch('/api/v1/companies/:id', async ({ auth, params, body, requestId }) => {
    requireScope(auth, 'write');
    const company = db.transaction(() => {
      const updated = updateCompany(db, auth.tenantId, params.id, body, { actor: auth.actor });
      return rescoreCompany(db, auth.tenantId, updated.id);
    });
    recordAudit(db, auth.tenantId, { action: 'company.updated', actor: auth.actor, resourceType: 'company', resourceId: company.id, requestId, details: { fields: Object.keys(body) } });
    return company;
  });
  router.delete('/api/v1/companies/:id', async ({ auth, params, requestId }) => {
    requireScope(auth, 'admin');
    const deleted = db.transaction(() => deleteCompany(db, auth.tenantId, params.id));
    recordAudit(db, auth.tenantId, { action: 'company.deleted', actor: auth.actor, resourceType: 'company', resourceId: params.id, requestId });
    return deleted;
  });
  router.post('/api/v1/companies/:id/outcomes', async ({ auth, params, body, requestId }) => {
    requireScope(auth, 'write');
    const outcome = db.transaction(() => recordOutcome(db, auth.tenantId, params.id, body, auth.actor));
    recordAudit(db, auth.tenantId, { action: 'outcome.recorded', actor: auth.actor, resourceType: 'company', resourceId: params.id, requestId, details: { outcome_type: body.outcome_type, signal_key: body.signal_key } });
    return { status: 201, data: outcome };
  });
  router.post('/api/v1/ingest', async ({ auth, body, requestId }) => {
    requireScope(auth, 'write');
    const records = Array.isArray(body) ? body : body?.records;
    const outcome = ingestBatch(db, auth.tenantId, records, { source: Array.isArray(body) ? undefined : body?.source });
    recordAudit(db, auth.tenantId, { action: 'observations.ingested', actor: auth.actor, resourceType: 'observation_batch', requestId, details: { seen: outcome.seen, inserted: outcome.inserted, duplicates: outcome.duplicates, rejected: outcome.rejected, signals: outcome.signals, signals_created: outcome.signals_created } });
    return { status: outcome.rejected ? 207 : 200, data: outcome };
  });
  router.post('/api/v1/webhooks/:source', async ({ auth, params, body, rawBody, req, requestId }) => {
    requireScope(auth, 'write');
    const receipt = verifyWebhook(req, params.source, rawBody);
    consumeWebhookReceipt(db, auth.tenantId, receipt);
    if (!body || typeof body !== 'object') throw new AppError(400, 'invalid_webhook_body', 'Webhook body must be a JSON object or array.');
    const suppliedRecords = Array.isArray(body) ? body : body.records === undefined ? [body] : body.records;
    if (!Array.isArray(suppliedRecords)) throw new AppError(400, 'invalid_webhook_records', 'Webhook records must be an array.');
    const records = suppliedRecords.map((record) => ({ ...record, source: params.source }));
    const outcome = ingestBatch(db, auth.tenantId, records, { source: params.source });
    recordAudit(db, auth.tenantId, { action: 'webhook.ingested', actor: auth.actor, resourceType: 'connector', resourceId: params.source, requestId, details: outcome });
    return { status: outcome.rejected ? 207 : 200, data: outcome };
  });
  router.get('/api/v1/signals', async ({ auth, query }) => listSignals(db, auth.tenantId, query));
  router.get('/api/v1/signal-catalog', async () => signalCatalog);
  router.get('/api/v1/connectors', async ({ auth }) => listConnectors(db, auth.tenantId).map((item) => ({ ...item, implemented: implementedConnectorKeys.has(item.connector_key) })));
  router.get('/api/v1/connectors/runs', async ({ auth, query }) => {
    requireScope(auth, 'admin');
    return connectorRuns(db, auth.tenantId, query);
  });
  router.patch('/api/v1/connectors/:key', async ({ auth, params, body, requestId }) => {
    requireScope(auth, 'admin');
    if (!body || typeof body !== 'object' || Array.isArray(body) || typeof body.enabled !== 'boolean') throw new AppError(400, 'invalid_connector_settings', 'enabled must be a boolean.');
    const connector = setConnectorEnabled(db, auth.tenantId, params.key, body.enabled, body);
    recordAudit(db, auth.tenantId, { action: body.enabled ? 'connector.enabled' : 'connector.disabled', actor: auth.actor, resourceType: 'connector', resourceId: params.key, requestId });
    return connector;
  });
  router.post('/api/v1/connectors/:key/run', async ({ auth, params, body, requestId }) => {
    requireScope(auth, 'admin');
    const outcome = await runConnector(db, auth.tenantId, params.key, body || {});
    recordAudit(db, auth.tenantId, { action: 'connector.run', actor: auth.actor, resourceType: 'connector', resourceId: params.key, requestId,
      details: { run_id: outcome.run_id, status: outcome.status, seen: outcome.seen, inserted: outcome.inserted, rejected: outcome.rejected,
        signals: outcome.signals, signals_created: outcome.signals_created } });
    return { status: 200, data: outcome };
  });
  router.post('/api/v1/rescore', async ({ auth, body, requestId }) => {
    requireScope(auth, 'write');
    if (!isPlainObject(body) || (body.due_only !== undefined && typeof body.due_only !== 'boolean')) {
      throw new AppError(400, 'invalid_rescore_request', 'Request body must be an object and due_only must be a boolean.');
    }
    const limit = boundedInteger(body?.limit, 1_000, 5_000, 'limit');
    const dueOnly = body?.due_only !== false;
    const companies = db.transaction(() => dueOnly
      ? rescoreDueCompanies(db, auth.tenantId, limit)
      : rescoreAll(db, auth.tenantId, limit));
    recordAudit(db, auth.tenantId, { action: 'companies.rescored', actor: auth.actor, resourceType: 'company_batch', requestId, details: { count: companies.length, due_only: dueOnly, limit } });
    return { rescored: companies.length, due_only: dueOnly, limit };
  });
  router.get('/api/v1/export/companies.csv', async ({ auth, query }) => ({ raw: exportCompaniesCsv(db, auth.tenantId, query), contentType: 'text/csv; charset=utf-8', filename: 'hookpoint-opportunities.csv' }));
  router.get('/api/v1/audit', async ({ auth, query }) => {
    requireScope(auth, 'admin');
    const requested = Number(query.limit || 100);
    const limit = Number.isInteger(requested) && requested > 0 ? Math.min(200, requested) : 100;
    return db.all('SELECT * FROM audit_events WHERE tenant_id=? ORDER BY created_at DESC LIMIT ?', [auth.tenantId, limit]).map((row) => {
      const { details_json: detailsJson, ...event } = row;
      return { ...event, details: json(detailsJson) };
    });
  });
  router.get('/api/v1/analytics/outcomes', async ({ auth }) => {
    requireScope(auth, 'read');
    return outcomeAnalytics(db, auth.tenantId);
  });
  router.get('/api/v1/data-quality', async ({ auth }) => dataQuality(db, auth.tenantId));
  router.get('/api/v1/ingestion/rejections', async ({ auth, query }) => {
    requireScope(auth, 'admin');
    return ingestionRejections(db, auth.tenantId, query);
  });
  router.get('/api/v1/review-queue', async ({ auth, query }) => reviewQueue(db, auth.tenantId, query));
  router.get('/api/v1/api-keys', async ({ auth }) => {
    rejectBrowserApiKeyManagement(auth);
    requireScope(auth, 'admin');
    return listApiKeys(db, auth.tenantId);
  });
  router.post('/api/v1/api-keys', async ({ auth, body, requestId }) => {
    rejectBrowserApiKeyManagement(auth);
    requireScope(auth, 'admin');
    const created = db.transaction(() => createApiKey(db, auth.tenantId, body));
    recordAudit(db, auth.tenantId, { action: 'api_key.created', actor: auth.actor, resourceType: 'api_key', resourceId: created.id, requestId, details: { name: created.name, scopes: created.scopes } });
    return { status: 201, data: created };
  });
  router.delete('/api/v1/api-keys/:id', async ({ auth, params, requestId }) => {
    rejectBrowserApiKeyManagement(auth);
    requireScope(auth, 'admin');
    const revoked = db.transaction(() => revokeApiKey(db, auth.tenantId, params.id, auth.keyId));
    recordAudit(db, auth.tenantId, { action: 'api_key.revoked', actor: auth.actor, resourceType: 'api_key', resourceId: params.id, requestId });
    return revoked;
  });

  return async function handler(req, res) {
    const suppliedRequestId = String(req.headers['x-request-id'] || '');
    const requestId = /^[A-Za-z0-9._:-]{1,128}$/.test(suppliedRequestId) ? suppliedRequestId : id('req');
    const started = Date.now();
    res.setHeader('x-request-id', requestId);
    securityHeaders(req, res);
    try {
      enforceRateLimit(req, res);
      if (req.method === 'OPTIONS') { res.writeHead(204); return res.end(); }
      const url = new URL(req.url, 'http://localhost');
      if (!url.pathname.startsWith('/api/') && !['/health','/ready'].includes(url.pathname)) {
        if (!serveStaticAssets) throw new AppError(404, 'route_not_found', 'Route not found.');
        if (serveStatic(res, url.pathname)) return;
        if (!url.pathname.includes('.')) { serveStatic(res, '/'); return; }
        throw new AppError(404, 'asset_not_found', 'Asset not found.');
      }
      const route = router.match(req.method, url.pathname);
      const auth = authenticate(db, req, route.options);
      if (config.env === 'production' && url.pathname.startsWith('/api/') && !route.options.publicRoute) {
        const apiKeyOnlyIssues = new Set(['weak_hash_salt', 'no_active_api_key']);
        const critical = runtimeIssues(db).filter((issue) =>
          issue.severity === 'critical' && !(auth.authType === 'clerk' && apiKeyOnlyIssues.has(issue.code)));
        if (critical.length) throw new AppError(503, 'runtime_not_ready', 'The service is not ready for production traffic.', critical.map(({ code }) => code));
      }
      if (req.method === 'GET' && !route.options.publicRoute) requireScope(auth, 'read');
      const payload = ['POST','PATCH','PUT'].includes(req.method) ? await readBody(req) : { raw: '', data: {} };
      const query = Object.fromEntries(url.searchParams.entries());
      const output = await route.handler({ req, res, auth, params: route.params, query, body: payload.data, rawBody: payload.raw, requestId });
      if (res.writableEnded) return;
      const status = output?.status && output?.data !== undefined ? output.status : 200;
      const data = output?.status && output?.data !== undefined ? output.data : output;
      if (data?.raw !== undefined) {
        const headers = data.filename ? { 'content-disposition': `attachment; filename="${data.filename}"` } : {};
        sendText(res, status, data.raw, data.contentType, headers);
      } else sendJson(res, status, { data, meta: { request_id: requestId, duration_ms: Date.now() - started } });
      log('info', 'request', { request_id: requestId, method: req.method, path: url.pathname, status, duration_ms: Date.now() - started });
    } catch (error) {
      const status = error.status || 500;
      const productionFailure = status >= 500 && config.env === 'production';
      if (!res.headersSent) sendJson(res, status, { error: { code: error.code || 'internal_error', message: productionFailure ? 'Service unavailable.' : error.message, details: productionFailure ? undefined : error.details }, meta: { request_id: requestId } });
      log(status >= 500 ? 'error' : 'warn', 'request_failed', { request_id: requestId, status, code: error.code || 'internal_error',
        message: productionFailure ? 'Request failed.' : error.message, stack: status >= 500 && config.env !== 'production' ? error.stack : undefined });
    }
  };
}

function boundedInteger(value, fallback, maximum, field) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > maximum) throw new AppError(400, `invalid_${field}`, `${field} must be an integer between 1 and ${maximum}.`);
  return number;
}

function rejectBrowserApiKeyManagement(auth) {
  if (auth.authType === 'clerk') {
    throw new AppError(403, 'browser_api_key_management_disabled', 'API keys are available only to direct API clients.');
  }
}

export function log(level, event, details) {
  const priority = { debug: 10, info: 20, warn: 30, error: 40 };
  if ((priority[level] || 20) < (priority[config.logLevel] || 20)) return;
  console.log(JSON.stringify({ level, event, time: nowIso(), ...details }));
}

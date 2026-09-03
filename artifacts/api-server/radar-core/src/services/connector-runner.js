import { connectorFor, implementedConnectorKeys } from '../connectors/index.js';
import { AppError, addDays, containsSecretFields, id, isPlainObject, json, nowIso, redactSecrets, redactText, sha256, stableJson } from '../lib.js';
import { ingestBatch } from './ingestion.js';
import { rescoreDueCompanies } from './signals.js';
import { config } from '../config.js';
import { hasGoogleSheetsTenantBinding } from '../connectors/google-sheets.js';

const inFlight = new Set();
const trustedTenantFields = new Set(['trustedTenantId', 'trusted_tenant_id']);

export async function runConnector(db, tenantId, key, input = {}) {
  if (!isPlainObject(input)) throw new AppError(400, 'invalid_connector_input', 'Connector input must be a JSON object.');
  if (input.reset_cursor !== undefined && typeof input.reset_cursor !== 'boolean') throw new AppError(400, 'invalid_reset_cursor', 'reset_cursor must be a boolean.');
  if (containsSecretFields(input)) throw new AppError(400, 'unsafe_connector_input', 'Store credentials in environment variables and keep connector input nesting to eight levels or fewer.');
  if (Buffer.byteLength(stableJson(input)) > 1_000_000) throw new AppError(413, 'connector_input_too_large', 'Connector input may not exceed 1 MB.');
  const row = db.get('SELECT * FROM connectors WHERE tenant_id=? AND connector_key=?', [tenantId, key]);
  if (!row) throw new AppError(404, 'connector_not_found', `Unknown connector: ${key}`);
  if (!implementedConnectorKeys.has(key)) throw new AppError(501, 'adapter_pending', `${row.label} has a registered contract but still needs its source-specific adapter.`);
  if (row.mode === 'push') throw new AppError(409, 'push_connector', `${row.label} receives data through its webhook endpoint and cannot be run as a pull job.`);
  if (!row.configured) throw new AppError(409, 'connector_not_configured', `${row.label} is missing required environment configuration.`);
  if (row.backoff_until && row.backoff_until > nowIso()) throw new AppError(429, 'connector_backoff', `${row.label} is in failure backoff until ${row.backoff_until}.`);

  const lockKey = `${tenantId}:${key}`;
  if (inFlight.has(lockKey)) throw new AppError(409, 'connector_already_running', `${row.label} already has an active run.`);
  inFlight.add(lockKey);
  const runId = id('run');
  const started = nowIso();
  const startedMs = Date.now();
  const resetCursor = input.reset_cursor || false;
  const requestedInput = withoutInternalFields(input, { includeCursor: true });
  const inputFingerprint = sha256(stableJson(withoutInternalFields(input)));
  const priorRun = resetCursor ? null : db.get(`SELECT provider_cursor_json, cursor_json FROM connector_runs
    WHERE tenant_id=? AND connector_key=? AND status IN ('succeeded','partial')
    ORDER BY finished_at DESC LIMIT 1`, [tenantId, key]);
  const previousCursor = priorRun ? json(priorRun.provider_cursor_json, null) : null;
  const previousFingerprint = priorRun ? json(priorRun.cursor_json, null)?.input_fingerprint : null;
  const resumed = requestedInput.cursor === undefined && previousFingerprint === inputFingerprint && hasCursor(previousCursor);
  const connectorInput = resumed ? { ...requestedInput, cursor: previousCursor } : requestedInput;
  Object.defineProperties(connectorInput, {
    trustedTenantId: { value: tenantId },
    trusted_tenant_id: { value: tenantId },
  });
  db.run(`INSERT INTO connector_runs(id, tenant_id, connector_key, status, started_at, metadata_json)
    VALUES (?, ?, ?, 'running', ?, ?)`, [runId, tenantId, key, started, stableJson({ input: redactSecrets(requestedInput), resumed })]);
  db.run(`UPDATE connectors SET status='running', last_error=NULL, updated_at=? WHERE tenant_id=? AND connector_key=?`, [started, tenantId, key]);
  try {
    const connector = connectorFor(key);
    const collected = await connector.run(connectorInput);
    const records = Array.isArray(collected) ? collected : collected.records;
    const normalizationErrors = Array.isArray(collected.normalizationErrors) ? collected.normalizationErrors : [];
    const outcome = records.length ? ingestBatch(db, tenantId, records, { source: key, connectorRunId: runId })
      : { seen: 0, inserted: 0, duplicates: 0, rejected: 0, signals: 0, signals_created: 0, people: 0, companies: [], errors: [] };
    for (const item of normalizationErrors) storeNormalizationRejection(db, tenantId, key, runId, item);
    outcome.seen += normalizationErrors.length;
    outcome.rejected += normalizationErrors.length;
    outcome.errors = [...outcome.errors, ...normalizationErrors].slice(0, 100);
    const finished = nowIso();
    const runStatus = outcome.rejected ? 'partial' : 'succeeded';
    const lastError = outcome.rejected ? `${outcome.rejected} record(s) rejected; inspect ingestion_rejections.` : null;
    const nextCursor = collected.cursor ?? null;
    db.run(`UPDATE connector_runs SET status=?, finished_at=?, records_seen=?, records_inserted=?, records_rejected=?,
      signals_created=?, duration_ms=?, provider_cursor_json=?, cursor_json=?, metadata_json=? WHERE id=?`,
      [runStatus, finished, outcome.seen, outcome.inserted, outcome.rejected, outcome.signals_created, Date.now() - startedMs,
        stableJson(nextCursor), stableJson({ input_fingerprint: inputFingerprint }),
        stableJson({ input: redactSecrets(requestedInput), resumed, usage: redactSecrets(collected.usage || {}) }), runId]);
    db.run(`UPDATE connectors SET status=?, last_run_at=?, next_run_at=?, last_error=?, consecutive_failures=0,
      backoff_until=NULL, updated_at=? WHERE tenant_id=? AND connector_key=?`,
      [row.enabled ? (outcome.rejected ? 'degraded' : 'ready') : 'disabled', finished, nextRun(finished, row.cadence), lastError, finished, tenantId, key]);
    return { run_id: runId, connector: key, status: runStatus, cursor: nextCursor, resumed, ...outcome };
  } catch (error) {
    const finished = nowIso();
    const operationalFailure = !error.status || error.status >= 500 || error.status === 429;
    const failures = operationalFailure ? Number(row.consecutive_failures || 0) + 1 : Number(row.consecutive_failures || 0);
    const backoffUntil = operationalFailure ? addDays(finished, Math.min(24, 2 ** Math.min(8, failures - 1)) / 24) : null;
    const safeMessage = redactText(error.message || 'Connector run failed');
    db.run(`UPDATE connector_runs SET status='failed', finished_at=?, error_message=?, duration_ms=? WHERE id=?`, [finished, safeMessage, Date.now() - startedMs, runId]);
    db.run(`UPDATE connectors SET status=?, last_error=?, consecutive_failures=?, backoff_until=?, updated_at=?
      WHERE tenant_id=? AND connector_key=?`, [operationalFailure ? 'error' : (row.enabled ? 'ready' : 'disabled'), safeMessage, failures, backoffUntil, finished, tenantId, key]);
    throw error;
  } finally {
    inFlight.delete(lockKey);
  }
}

export function setConnectorEnabled(db, tenantId, key, enabled, settings = {}) {
  const connector = db.get('SELECT * FROM connectors WHERE tenant_id=? AND connector_key=?', [tenantId, key]);
  if (!connector) throw new AppError(404, 'connector_not_found', 'Connector not found.');
  if (enabled && key === 'google_sheets' && !hasGoogleSheetsTenantBinding(tenantId)) {
    const now = nowIso();
    db.run(`UPDATE connectors SET enabled=0, configured=0, status='needs_configuration', next_run_at=NULL, updated_at=?
      WHERE tenant_id=? AND connector_key=?`, [now, tenantId, key]);
    throw new AppError(409, 'connector_not_configured', 'Bind at least one Google Sheet to this workspace before enabling this connector.');
  }
  if (enabled && !connector.configured) throw new AppError(409, 'connector_not_configured', 'Add the required environment configuration before enabling this connector.');
  if (enabled && !implementedConnectorKeys.has(key)) throw new AppError(409, 'adapter_pending', 'Implement the provider adapter before enabling this connector.');
  if (settings.schedule_input !== undefined && !isPlainObject(settings.schedule_input)) throw new AppError(400, 'invalid_schedule_input', 'schedule_input must be a JSON object.');
  if (containsSecretFields(settings.schedule_input)) throw new AppError(400, 'unsafe_schedule_input', 'Store credentials in environment variables and keep schedule_input nesting to eight levels or fewer.');
  if (settings.schedule_input?.reset_cursor !== undefined) throw new AppError(400, 'reserved_schedule_input', 'reset_cursor is reserved for one-time manual runs.');
  const now = nowIso();
  const currentConfig = json(connector.config_json);
  const nextConfig = settings.schedule_input === undefined ? currentConfig : { ...currentConfig, scheduleInput: settings.schedule_input };
  if (enabled && connector.mode !== 'push' && connector.cadence !== 'manual'
    && (!isPlainObject(nextConfig.scheduleInput) || Object.keys(nextConfig.scheduleInput).length === 0)) {
    throw new AppError(400, 'schedule_input_required', 'Configure non-secret schedule_input before enabling this recurring connector.');
  }
  db.run(`UPDATE connectors SET enabled=?, status=?, next_run_at=?, config_json=?, backoff_until=NULL, updated_at=?
    WHERE tenant_id=? AND connector_key=?`, [enabled ? 1 : 0, enabled ? 'ready' : (connector.configured ? 'disabled' : 'needs_configuration'), enabled ? now : null, stableJson(nextConfig), now, tenantId, key]);
  const stored = db.get('SELECT * FROM connectors WHERE tenant_id=? AND connector_key=?', [tenantId, key]);
  const { config_json: configJson, ...fields } = stored;
  return { ...fields, enabled: Boolean(stored.enabled), configured: Boolean(stored.configured), config: json(configJson) };
}

export function startScheduler(db, intervalMs = 60_000) {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const due = db.all(`SELECT tenant_id, connector_key, config_json FROM connectors
        WHERE enabled=1 AND mode!='push' AND cadence!='manual' AND (backoff_until IS NULL OR backoff_until<=?)
          AND (next_run_at IS NULL OR next_run_at<=?) ORDER BY COALESCE(next_run_at, created_at) ASC LIMIT 20`, [nowIso(), nowIso()]);
      for (const row of due) {
        if (!implementedConnectorKeys.has(row.connector_key)) continue;
        const scheduleInput = json(row.config_json).scheduleInput;
        if (!scheduleInput) continue;
        try { await runConnector(db, row.tenant_id, row.connector_key, scheduleInput); }
        catch (error) { console.error(JSON.stringify({ level: 'error', event: 'connector_run_failed', tenant_id: row.tenant_id, connector: row.connector_key, message: redactText(error.message) })); }
      }
      try { db.transaction(() => rescoreDueCompanies(db, null, config.rescoreBatchSize)); }
      catch (error) { console.error(JSON.stringify({ level: 'error', event: 'scheduled_rescore_failed', message: error.message })); }
    } finally { running = false; }
  };
  const timer = setInterval(tick, Math.max(5_000, intervalMs));
  timer.unref();
  queueMicrotask(tick);
  return () => clearInterval(timer);
}

function hasCursor(value) {
  if (value == null) return false;
  if (Array.isArray(value)) return value.length > 0;
  if (isPlainObject(value)) return Object.keys(value).length > 0;
  return String(value).length > 0;
}

function withoutInternalFields(input, { includeCursor = false } = {}) {
  return Object.fromEntries(Object.entries(input).filter(([key]) =>
    key !== 'reset_cursor' && (includeCursor || key !== 'cursor') && !trustedTenantFields.has(key) && !key.startsWith('__')));
}

function nextRun(iso, cadence) {
  return addDays(iso, { hourly: 1 / 24, realtime: 1 / 24, daily: 1, weekly: 7, monthly: 30, quarterly: 90, manual: 3650 }[cadence] || 7);
}

function storeNormalizationRejection(db, tenantId, source, runId, error) {
  db.run(`INSERT INTO ingestion_rejections(id, tenant_id, source, record_index, error_code, error_message, payload_hash, connector_run_id, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id('reject'), tenantId, source, error.index, error.code,
    redactText(error.message), sha256(`${runId}:${error.index}`), runId, nowIso()]);
}

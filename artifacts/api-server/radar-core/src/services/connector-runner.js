import { connectorFor, implementedConnectorKeys } from '../connectors/index.js';
import { AppError, addDays, containsSecretFields, id, isPlainObject, json, nowIso, redactSecrets, redactText, sha256, stableJson } from '../lib.js';
import { ingestBatch } from './ingestion.js';
import { rescoreDueCompanies } from './signals.js';
import { config } from '../config.js';
import { hasGoogleSheetsTenantBinding } from '../connectors/google-sheets.js';
import { claimConnectorLease, instanceId, recoverExpiredLeases, renewConnectorLease } from './connector-leases.js';

const trustedTenantFields = new Set(['trustedTenantId', 'trusted_tenant_id']);
const claimMissCodes = new Set(['connector_already_running', 'connector_not_due']);

const LEASE_CHECK_EVERY_RECORDS = 25;

class LeaseLostError extends Error {
  constructor(label) {
    super(`${label} run exceeded its lease before its results could be stored; the results were discarded and the connector was recovered by another instance.`);
    this.name = 'LeaseLostError';
  }
}

/**
 * Runs one pull connector for a tenant.
 *
 * The connector row is claimed in the database before anything else happens
 * (see connector-leases.js), so two API instances, or a scheduled and a
 * manual run, cannot execute the same connector at once even though they
 * share nothing but the database. Options:
 * - `requireDue`: only claim while the connector is still enabled, due and out
 *   of backoff (the scheduler's atomic "pick a due connector"); rejects with
 *   `connector_not_due` when another instance got there first.
 * - `leaseMs`, `owner`: lease length and instance label (defaults from config).
 */
export async function runConnector(db, tenantId, key, input = {}, { requireDue = false, leaseMs = config.connectorLeaseMs, owner = instanceId } = {}) {
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

  const runId = id('run');
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
  const started = nowIso();
  const startedMs = Date.now();
  // Claim and ledger row commit together: a lease never exists without its run
  // row, and a run row is never left behind without the lease that owns it.
  const claimed = db.transaction(() => {
    if (!claimConnectorLease(db, tenantId, key, { runId, owner, leaseMs, requireDue, now: started })) return false;
    db.run(`INSERT INTO connector_runs(id, tenant_id, connector_key, status, started_at, metadata_json)
      VALUES (?, ?, ?, 'running', ?, ?)`, [runId, tenantId, key, started, stableJson({ input: redactSecrets(requestedInput), resumed, instance: owner })]);
    return true;
  });
  if (!claimed) {
    if (requireDue) throw new AppError(409, 'connector_not_due', `${row.label} is no longer due; another instance claimed it or its schedule changed.`);
    throw new AppError(409, 'connector_already_running', `${row.label} already has an active run.`);
  }
  // Keep the lease alive while the provider call is in flight so a legitimately
  // long run is not mistaken for a crashed one; a lease that stops being
  // renewed is recovered by whichever instance ticks next.
  const heartbeat = setInterval(() => {
    try { renewConnectorLease(db, tenantId, key, runId, { leaseMs }); } catch { /* the final update reports a lost lease */ }
  }, Math.max(1_000, Math.floor(leaseMs / 3)));
  heartbeat.unref?.();
  // Every closing write on the connector row is conditional on still holding
  // the lease: if it expired and another instance re-claimed the connector,
  // that instance owns the row now and this run must not overwrite its state.
  const releaseLease = ', lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL';
  try {
    const connector = connectorFor(key);
    let collected;
    try {
      collected = await connector.run(connectorInput);
    } finally {
      clearInterval(heartbeat);
    }
    // Fence: results are only stored while this run still owns the lease. If
    // the lease lapsed (stalled event loop, unreachable database, a lease
    // shorter than the provider call) another instance may already have
    // recovered or re-run the connector, so this run's results are discarded
    // and the connector row is left to its new owner.
    const assertLeaseHeld = () => {
      if (!renewConnectorLease(db, tenantId, key, runId, { leaseMs })) throw new LeaseLostError(row.label);
    };
    assertLeaseHeld();
    const records = Array.isArray(collected) ? collected : collected.records;
    const normalizationErrors = Array.isArray(collected.normalizationErrors) ? collected.normalizationErrors : [];
    // Ingestion is synchronous (the heartbeat timer cannot fire while it
    // runs), so the lease is renewed and re-checked between records instead.
    const outcome = records.length ? ingestBatch(db, tenantId, records, { source: key, connectorRunId: runId, checkpoint: assertLeaseHeld, checkpointEvery: LEASE_CHECK_EVERY_RECORDS })
      : { seen: 0, inserted: 0, duplicates: 0, rejected: 0, signals: 0, signals_created: 0, people: 0, companies: [], errors: [] };
    for (const item of normalizationErrors) storeNormalizationRejection(db, tenantId, key, runId, item);
    outcome.seen += normalizationErrors.length;
    outcome.rejected += normalizationErrors.length;
    outcome.errors = [...outcome.errors, ...normalizationErrors].slice(0, 100);
    const finished = nowIso();
    const runStatus = outcome.rejected ? 'partial' : 'succeeded';
    const lastError = outcome.rejected ? `${outcome.rejected} record(s) rejected; inspect ingestion_rejections.` : null;
    const nextCursor = collected.cursor ?? null;
    // Release and ledger close commit together, and only if this run still
    // owns the lease. Ingestion ran outside this transaction (it commits per
    // record); when the lease was lost meanwhile the connector row already
    // belongs to another instance, so the run stays 'abandoned' as recovery
    // recorded it and the caller learns that instead of a success.
    const closed = db.transaction(() => {
      const released = db.run(`UPDATE connectors SET status=?, last_run_at=?, next_run_at=?, last_error=?, consecutive_failures=0,
        backoff_until=NULL, updated_at=?${releaseLease} WHERE tenant_id=? AND connector_key=? AND lease_token=? AND lease_expires_at>?`,
        [row.enabled ? (outcome.rejected ? 'degraded' : 'ready') : 'disabled', finished, nextRun(finished, row.cadence), lastError, finished, tenantId, key, runId, finished]);
      if (!released.changes) return false;
      db.run(`UPDATE connector_runs SET status=?, finished_at=?, records_seen=?, records_inserted=?, records_rejected=?,
        signals_created=?, duration_ms=?, provider_cursor_json=?, cursor_json=?, metadata_json=? WHERE id=?`,
        [runStatus, finished, outcome.seen, outcome.inserted, outcome.rejected, outcome.signals_created, Date.now() - startedMs,
          stableJson(nextCursor), stableJson({ input_fingerprint: inputFingerprint }),
          stableJson({ input: redactSecrets(requestedInput), resumed, instance: owner, usage: redactSecrets(collected.usage || {}) }), runId]);
      return true;
    });
    if (!closed) throw new LeaseLostError(row.label);
    return { run_id: runId, connector: key, status: runStatus, cursor: nextCursor, resumed, ...outcome };
  } catch (error) {
    const finished = nowIso();
    if (error instanceof LeaseLostError) {
      // Recovery (or the claim that replaced this run) already closed the run
      // row as abandoned; make sure of it without touching the connector row.
      markRunAbandoned(db, runId, finished, error.message, Date.now() - startedMs);
      throw new AppError(409, 'connector_lease_lost', error.message);
    }
    const operationalFailure = !error.status || error.status >= 500 || error.status === 429;
    const failures = operationalFailure ? Number(row.consecutive_failures || 0) + 1 : Number(row.consecutive_failures || 0);
    const backoffUntil = operationalFailure ? addDays(finished, Math.min(24, 2 ** Math.min(8, failures - 1)) / 24) : null;
    const safeMessage = redactText(error.message || 'Connector run failed');
    const closed = db.transaction(() => {
      const released = db.run(`UPDATE connectors SET status=?, last_error=?, consecutive_failures=?, backoff_until=?, updated_at=?${releaseLease}
        WHERE tenant_id=? AND connector_key=? AND lease_token=? AND lease_expires_at>?`, [operationalFailure ? 'error' : (row.enabled ? 'ready' : 'disabled'), safeMessage, failures, backoffUntil, finished, tenantId, key, runId, finished]);
      if (!released.changes) return false;
      db.run(`UPDATE connector_runs SET status='failed', finished_at=?, error_message=?, duration_ms=? WHERE id=?`, [finished, safeMessage, Date.now() - startedMs, runId]);
      return true;
    });
    // A failure after the lease was lost keeps the recovery's 'abandoned'
    // verdict in the ledger; the original error is still what the caller sees.
    if (!closed) markRunAbandoned(db, runId, finished, `${safeMessage} (the run lease had already expired and was recovered by another instance.)`, Date.now() - startedMs);
    throw error;
  } finally {
    clearInterval(heartbeat);
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
  if (enabled && connector.mode !== 'push' && connector.cadence !== 'manual') {
    assertScheduleInputAccepted(tenantId, key, nextConfig.scheduleInput);
  }
  db.run(`UPDATE connectors SET enabled=?, status=?, next_run_at=?, config_json=?, backoff_until=NULL, updated_at=?
    WHERE tenant_id=? AND connector_key=?`, [enabled ? 1 : 0, enabled ? 'ready' : (connector.configured ? 'disabled' : 'needs_configuration'), enabled ? now : null, stableJson(nextConfig), now, tenantId, key]);
  const stored = db.get('SELECT * FROM connectors WHERE tenant_id=? AND connector_key=?', [tenantId, key]);
  const { config_json: configJson, ...fields } = stored;
  return { ...fields, enabled: Boolean(stored.enabled), configured: Boolean(stored.configured), config: json(configJson) };
}

/**
 * Runs due pull connectors and refreshes due scores on a fixed interval.
 *
 * The first tick runs immediately (asynchronously) and a tick is never
 * started while a previous one is still in flight. The returned `stop`
 * function cancels future ticks, prevents any further connector or rescore
 * work from starting and resolves once the in-flight tick (if any) has
 * finished, so callers can close the database safely afterwards.
 *
 * Any number of instances may run this scheduler against one shared
 * database. A tick first recovers leases that expired without being released
 * (their runs are marked `abandoned`), then claims each due connector with a
 * conditional UPDATE before running it, so a connector that is due in the
 * same tick on two instances runs on exactly one of them; the other sees it
 * as no longer due and moves on. Options: `onEvent` receives structured log
 * events, `leaseMs` and `instanceId` override the lease length and label.
 */
export function startScheduler(db, intervalMs = 60_000, { onEvent, leaseMs = config.connectorLeaseMs, instanceId: owner = instanceId } = {}) {
  let stopped = false;
  let inFlight = null;
  const emit = (level, event, details) => {
    if (onEvent) onEvent({ level, event, ...details });
    else if (level === 'error') console.error(JSON.stringify({ level, event, ...details }));
    else if (level === 'warn') console.warn(JSON.stringify({ level, event, ...details }));
  };
  const work = async () => {
    let connectorsRun = 0;
    let rescored = 0;
    let claimedElsewhere = 0;
    try {
      for (const item of recoverExpiredLeases(db)) {
        emit('warn', 'connector_run_abandoned', { tenant_id: item.tenant_id, connector: item.connector_key, run_id: item.run_id, lease_owner: item.lease_owner, backoff_until: item.backoff_until });
      }
    } catch (error) {
      emit('error', 'lease_recovery_failed', { message: redactText(error?.message || String(error)) });
    }
    const now = nowIso();
    const due = db.all(`SELECT tenant_id, connector_key, cadence, config_json FROM connectors
      WHERE enabled=1 AND mode!='push' AND cadence!='manual' AND (backoff_until IS NULL OR backoff_until<=?)
        AND (next_run_at IS NULL OR next_run_at<=?) AND (lease_expires_at IS NULL OR lease_expires_at<=?)
      ORDER BY COALESCE(next_run_at, created_at) ASC LIMIT 20`, [now, now, now]);
    for (const row of due) {
      if (stopped) break;
      if (!implementedConnectorKeys.has(row.connector_key)) continue;
      const scheduleInput = json(row.config_json).scheduleInput;
      if (!scheduleInput) continue;
      try {
        const outcome = await runConnector(db, row.tenant_id, row.connector_key, scheduleInput, { requireDue: true, leaseMs, owner });
        connectorsRun += 1;
        emit('info', 'scheduled_connector_run', { tenant_id: row.tenant_id, connector: row.connector_key, run_id: outcome.run_id, status: outcome.status });
      } catch (error) {
        if (claimMissCodes.has(error.code)) {
          // Another instance claimed this connector between our SELECT and
          // our claim (or it is mid-run there). Nothing to do on this side.
          claimedElsewhere += 1;
          emit('debug', 'connector_claimed_elsewhere', { tenant_id: row.tenant_id, connector: row.connector_key });
          continue;
        }
        if (error.code === 'connector_lease_lost') {
          // The provider call outlived the lease; another instance recovered
          // the connector (backoff applied there). The results were discarded.
          emit('warn', 'connector_lease_lost', { tenant_id: row.tenant_id, connector: row.connector_key, message: redactText(error.message) });
          continue;
        }
        // Operational failures (5xx/429/unknown) already set exponential
        // backoff inside runConnector. A validation-style rejection (4xx)
        // means the stored schedule input is wrong; it will not fix itself, so
        // defer to the next cadence slot instead of retrying every tick.
        // setConnectorEnabled runs the adapter's validateInput at save time,
        // so this branch is the safety net for rows saved before an adapter
        // tightened its rules or for environment drift (revoked bindings).
        const rejected = Boolean(error.status) && error.status < 500 && error.status !== 429;
        if (rejected) {
          db.run('UPDATE connectors SET next_run_at=? WHERE tenant_id=? AND connector_key=?', [nextRun(nowIso(), row.cadence), row.tenant_id, row.connector_key]);
        }
        emit('error', 'connector_run_failed', { tenant_id: row.tenant_id, connector: row.connector_key, message: redactText(error.message), deferred_to_next_cadence: rejected });
      }
    }
    if (stopped) return;
    try {
      const result = db.transaction(() => rescoreDueCompanies(db, null, config.rescoreBatchSize));
      rescored = Array.isArray(result) ? result.length : 0;
    } catch (error) {
      emit('error', 'scheduled_rescore_failed', { message: redactText(error.message) });
    }
    emit('debug', 'scheduler_tick', { due: due.length, connectors_run: connectorsRun, claimed_elsewhere: claimedElsewhere, rescored });
  };
  const tick = () => {
    if (stopped || inFlight) return inFlight ?? Promise.resolve();
    // Clear the in-flight marker in a chained `.finally` rather than inside
    // the async body: a tick with nothing to await would otherwise finish
    // synchronously, before this assignment lands, and leave `inFlight` set
    // forever so no later tick could run.
    inFlight = work()
      .catch((error) => emit('error', 'scheduler_tick_failed', { message: redactText(error?.message || String(error)) }))
      .finally(() => { inFlight = null; });
    return inFlight;
  };
  const timer = setInterval(tick, Math.max(5_000, intervalMs));
  timer.unref();
  queueMicrotask(tick);
  return async function stop() {
    stopped = true;
    clearInterval(timer);
    if (inFlight) await inFlight.catch(() => {});
  };
}

/**
 * Runs the adapter's own input validation against a schedule_input at save
 * time, with the same shape the scheduler will hand to runConnector, so an
 * operator learns about a missing target company (or an out-of-range limit,
 * an invalid date, an unauthorized sheet) when they enable the cadence
 * rather than when the first scheduled run fails an hour later.
 */
function assertScheduleInputAccepted(tenantId, key, scheduleInput) {
  const candidate = withoutInternalFields(scheduleInput, { includeCursor: true });
  Object.defineProperties(candidate, {
    trustedTenantId: { value: tenantId },
    trusted_tenant_id: { value: tenantId },
  });
  try {
    connectorFor(key).validateInput(candidate);
  } catch (error) {
    if (error instanceof AppError) {
      throw new AppError(error.status >= 400 && error.status < 500 ? error.status : 400, error.code, `schedule_input rejected: ${error.message}`, error.details);
    }
    throw new AppError(400, 'invalid_schedule_input', `schedule_input rejected: ${redactText(error?.message || String(error), 500)}`);
  }
}

function markRunAbandoned(db, runId, finished, message, durationMs) {
  db.run(`UPDATE connector_runs SET status='abandoned', finished_at=?, error_message=?, duration_ms=? WHERE id=? AND status='running'`,
    [finished, message, durationMs, runId]);
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

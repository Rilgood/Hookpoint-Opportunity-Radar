import os from 'node:os';
import { randomBytes } from 'node:crypto';
import { config } from '../config.js';
import { addDays, nowIso } from '../lib.js';

/**
 * Database-backed run leases for pull connectors.
 *
 * Several API instances share one database, and each of them runs the
 * scheduler and serves manual `run` requests. A connector may only be
 * executed by one of them at a time, so every run starts by claiming the
 * connector row with a single conditional UPDATE: it succeeds for exactly one
 * caller because the row is locked for the duration of the statement on both
 * SQLite and Postgres. The claim stamps `lease_owner` (the instance),
 * `lease_token` (the run id) and `lease_expires_at`; the holder renews the
 * expiry while the provider call is in flight and clears the lease when the
 * run finishes.
 *
 * A lease that reaches its expiry without being renewed belonged to an
 * instance that crashed, hung or was killed mid-run. `recoverExpiredLeases`
 * marks its run `abandoned`, applies the same exponential backoff as an
 * operational failure (so a crashing connector cannot be re-claimed in a hot
 * loop) and frees the row for the next claim.
 */

export const instanceId = `${os.hostname()}:${process.pid}:${randomBytes(3).toString('hex')}`;

export const ABANDONED_RUN_MESSAGE = 'Connector run lease expired before the run completed (instance crashed, hung or was stopped).';

export function leaseExpiry(fromIso, leaseMs) {
  return new Date(Date.parse(fromIso) + leaseMs).toISOString();
}

/**
 * Claims `tenantId/key` for the run `runId`. Returns true when this call won
 * the claim; false when another instance holds a live lease (or, with
 * `requireDue`, when the connector is no longer due: another instance already
 * ran it, it was disabled, or it entered backoff since it was listed).
 */
export function claimConnectorLease(db, tenantId, key, { runId, owner = instanceId, leaseMs = config.connectorLeaseMs, requireDue = false, now = nowIso() } = {}) {
  if (!runId) throw new Error('claimConnectorLease requires a run id as the lease token.');
  const conditions = ['tenant_id=?', 'connector_key=?', '(lease_expires_at IS NULL OR lease_expires_at<=?)'];
  const params = [owner, runId, leaseExpiry(now, leaseMs), now, tenantId, key, now];
  if (requireDue) {
    conditions.push('enabled=1', "mode!='push'", "cadence!='manual'", '(backoff_until IS NULL OR backoff_until<=?)', '(next_run_at IS NULL OR next_run_at<=?)');
    params.push(now, now);
  }
  const { changes } = db.run(`UPDATE connectors SET status='running', last_error=NULL, lease_owner=?, lease_token=?, lease_expires_at=?, updated_at=?
    WHERE ${conditions.join(' AND ')}`, params);
  if (!changes) return false;
  // Holding the lease proves no other run of this connector is live, so any
  // run row still marked running was left behind by an expired lease (or by a
  // process that predates leases) and is closed as abandoned.
  db.run(`UPDATE connector_runs SET status='abandoned', finished_at=?, error_message=?
    WHERE tenant_id=? AND connector_key=? AND status='running'`, [now, ABANDONED_RUN_MESSAGE, tenantId, key]);
  return true;
}

/**
 * Extends the lease held by `runId`. Returns false when the lease was lost:
 * released, taken over, or already expired. An expired lease cannot be revived
 * by its holder even if nobody has recovered it yet, so expiry is decided by
 * the clock alone and never by which instance happens to get to the row first.
 */
export function renewConnectorLease(db, tenantId, key, runId, { leaseMs = config.connectorLeaseMs, now = nowIso() } = {}) {
  const { changes } = db.run('UPDATE connectors SET lease_expires_at=? WHERE tenant_id=? AND connector_key=? AND lease_token=? AND lease_expires_at>?',
    [leaseExpiry(now, leaseMs), tenantId, key, runId, now]);
  return changes > 0;
}

/**
 * Frees connectors whose lease expired without being released and marks their
 * runs abandoned. Safe to call from every instance on every tick: the UPDATE
 * is guarded by the lease it observed, so a lease renewed or re-claimed in
 * the meantime is left alone, and a connector is recovered by exactly one
 * caller. Returns the recovered connectors.
 */
export function recoverExpiredLeases(db, { now = nowIso() } = {}) {
  const expired = db.all(`SELECT tenant_id, connector_key, lease_owner, lease_token, lease_expires_at, consecutive_failures FROM connectors
    WHERE (lease_expires_at IS NOT NULL AND lease_expires_at<=?) OR (status='running' AND lease_expires_at IS NULL)`, [now]);
  const recovered = [];
  for (const row of expired) {
    const failures = Number(row.consecutive_failures || 0) + 1;
    const backoffUntil = addDays(now, Math.min(24, 2 ** Math.min(8, failures - 1)) / 24);
    const guard = row.lease_expires_at ? 'lease_token=? AND lease_expires_at<=?' : "status='running' AND lease_expires_at IS NULL";
    const guardParams = row.lease_expires_at ? [row.lease_token, now] : [];
    const outcome = db.transaction(() => {
      const { changes } = db.run(`UPDATE connectors SET status='error', last_error=?, consecutive_failures=?, backoff_until=?,
        lease_owner=NULL, lease_token=NULL, lease_expires_at=NULL, updated_at=?
        WHERE tenant_id=? AND connector_key=? AND ${guard}`, [ABANDONED_RUN_MESSAGE, failures, backoffUntil, now, row.tenant_id, row.connector_key, ...guardParams]);
      if (!changes) return null;
      const runs = db.run(`UPDATE connector_runs SET status='abandoned', finished_at=?, error_message=?
        WHERE tenant_id=? AND connector_key=? AND status='running'`, [now, ABANDONED_RUN_MESSAGE, row.tenant_id, row.connector_key]);
      return { tenant_id: row.tenant_id, connector_key: row.connector_key, lease_owner: row.lease_owner, run_id: row.lease_token, runs_abandoned: runs.changes, backoff_until: backoffUntil };
    });
    if (outcome) recovered.push(outcome);
  }
  return recovered;
}

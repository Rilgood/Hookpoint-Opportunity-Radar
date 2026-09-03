import { config } from '../config.js';
import { connectorCatalog } from './catalog.js';
import { hashSecret, id, nowIso, stableJson } from '../lib.js';

export function bootstrap(db, { withAdminKey = true } = {}) {
  const now = nowIso();
  const staleRunCutoff = new Date(Date.now() - Math.max(config.connectorTimeoutMs * 2, 10 * 60_000)).toISOString();
  db.run(
    `INSERT OR IGNORE INTO tenants(id, name, slug, settings_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?)`,
    [config.defaultTenantId, 'Hook Point', 'hook-point', stableJson({ brand: 'Hook Point × Hyper Ads', scoreVersion: 'rules-1.1' }), now, now]
  );

  db.run(`UPDATE connector_runs SET status='abandoned', finished_at=?, error_message='Process ended before the connector run completed.'
    WHERE status='running' AND started_at<?`, [now, staleRunCutoff]);
  db.run(`UPDATE connectors SET status='error', last_error='Previous connector run did not complete.', updated_at=?
    WHERE status='running' AND EXISTS (SELECT 1 FROM connector_runs r WHERE r.tenant_id=connectors.tenant_id
      AND r.connector_key=connectors.connector_key AND r.status='abandoned')`, [now]);

  if (withAdminKey && config.adminApiKey.length >= 32 && config.hashSalt.length >= 32) {
    const bootstrapKeyId = `key_bootstrap_${config.defaultTenantId}`;
    db.run(`DELETE FROM api_keys WHERE tenant_id=? AND name IN ('Local administrator','Bootstrap administrator') AND id<>?`, [config.defaultTenantId, bootstrapKeyId]);
    db.run(
      `INSERT INTO api_keys(id, tenant_id, name, key_prefix, key_hash, scopes, created_at)
       VALUES (?, ?, ?, ?, ?, 'read,write,admin', ?)
       ON CONFLICT(id) DO UPDATE SET key_prefix=excluded.key_prefix, key_hash=excluded.key_hash, revoked_at=NULL`,
      [bootstrapKeyId, config.defaultTenantId, 'Bootstrap administrator', config.adminApiKey.slice(0, 12), hashSecret(config.adminApiKey, config.hashSalt), now]
    );
  }

  syncConnectorCatalog(db, config.defaultTenantId, now);
  return { tenantId: config.defaultTenantId, connectorCount: connectorCatalog.length };
}

export function syncConnectorCatalog(db, tenantId, now = nowIso()) {
  for (const item of connectorCatalog) {
    const configured = requiredEnvironment(item).every((name) => configuredValue(name));
    const status = configured ? 'disabled' : 'needs_configuration';
    db.run(
      `INSERT OR IGNORE INTO connectors(
        id, tenant_id, connector_key, label, category, provider, mode, cadence,
        enabled, configured, status, config_json, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [id('con'), tenantId, item.key, item.label, item.category, item.provider, item.mode,
        item.cadence, 0, configured ? 1 : 0, status, stableJson({ costTier: item.costTier, keyEnv: item.keyEnv, actorEnv: item.actorEnv }), now, now]
    );
    db.run(
      `UPDATE connectors SET label=?, category=?, provider=?, mode=?, cadence=?, configured=?,
       status=CASE WHEN ?=0 THEN 'needs_configuration' WHEN enabled=0 THEN 'disabled'
         WHEN status IN ('error','degraded','running') THEN status ELSE 'ready' END, updated_at=?
       WHERE tenant_id = ? AND connector_key = ?`,
      [item.label, item.category, item.provider, item.mode, item.cadence, configured ? 1 : 0,
        configured ? 1 : 0, now, tenantId, item.key]
    );
  }
}

function requiredEnvironment(item) {
  return [item.keyEnv, item.actorEnv].filter(Boolean);
}

function configuredValue(name) {
  const value = String(process.env[name] || '');
  return name === 'CONNECTOR_WEBHOOK_SECRET' ? value.length >= 32 : Boolean(value);
}

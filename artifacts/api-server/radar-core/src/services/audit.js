import { id, nowIso, redactSecrets, stableJson } from '../lib.js';

export function recordAudit(db, tenantId, { action, actor = 'system', resourceType, resourceId = null, requestId = null, details = {} }) {
  const safeDetails = stableJson(redactSecrets(details));
  db.run(`INSERT INTO audit_events(id, tenant_id, action, actor, resource_type, resource_id, request_id, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id('audit'), tenantId, String(action).slice(0, 200), String(actor).slice(0, 200),
    String(resourceType).slice(0, 200), resourceId == null ? null : String(resourceId).slice(0, 500), requestId == null ? null : String(requestId).slice(0, 128),
    safeDetails.length > 100_000 ? stableJson({ truncated: true }) : safeDetails, nowIso()]);
}

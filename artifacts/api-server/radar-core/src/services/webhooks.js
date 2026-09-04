import { config } from '../config.js';
import { addDays, AppError, hmac, id, nowIso, safeEqual, sha256 } from '../lib.js';
import { isUniqueViolation } from '../db/index.js';

const replayWindowMs = 5 * 60_000;

export function verifyWebhook(req, source, rawBody, nowMs = Date.now()) {
  if (config.webhookSecret.length < 32) {
    throw new AppError(409, 'webhook_not_configured', 'CONNECTOR_WEBHOOK_SECRET must contain at least 32 characters before accepting webhooks.');
  }
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(source)) {
    throw new AppError(400, 'invalid_source', 'Webhook source must be a lowercase identifier using letters, numbers, underscores or hyphens.');
  }
  const signature = String(req.headers['x-hookpoint-signature'] || '').replace(/^sha256=/i, '').toLowerCase();
  const timestamp = String(req.headers['x-hookpoint-timestamp'] || '');
  const numeric = Number(timestamp);
  const timestampMs = /^\d+$/.test(timestamp) ? (numeric > 1e12 ? numeric : numeric * 1_000) : new Date(timestamp).getTime();
  if (!/^[a-f0-9]{64}$/.test(signature) || !timestamp || !Number.isFinite(timestampMs) || Math.abs(nowMs - timestampMs) > replayWindowMs) {
    throw new AppError(401, 'invalid_webhook_signature', 'Webhook timestamp or signature is invalid.');
  }
  // Binding the path source prevents a valid payload from being replayed under a
  // different provider identity.
  const expected = hmac(`${timestamp}.${source}.${rawBody}`, config.webhookSecret);
  if (!safeEqual(signature, expected)) throw new AppError(401, 'invalid_webhook_signature', 'Webhook signature is invalid.');
  return { signatureHash: sha256(signature), timestampMs };
}

export function consumeWebhookReceipt(db, tenantId, receipt, now = nowIso()) {
  db.run('DELETE FROM webhook_receipts WHERE expires_at<?', [now]);
  try {
    db.run(`INSERT INTO webhook_receipts(id, tenant_id, signature_hash, received_at, expires_at)
      VALUES (?, ?, ?, ?, ?)`, [id('webhook'), tenantId, receipt.signatureHash, now, addDays(now, 10 / 1_440)]);
  } catch (error) {
    if (isUniqueViolation(error)) {
      throw new AppError(409, 'webhook_replayed', 'This signed webhook request has already been processed.');
    }
    throw error;
  }
}

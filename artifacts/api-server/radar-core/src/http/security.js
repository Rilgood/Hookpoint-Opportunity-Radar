import { config } from '../config.js';
import { AppError, hashSecret, nowIso, safeEqual, sha256, stableJson } from '../lib.js';
import { syncConnectorCatalog } from '../services/bootstrap.js';

const windows = new Map();
const trustedPrincipals = new WeakMap();

export function setTrustedPrincipal(req, { userId }) {
  if (!req || typeof req !== 'object' || typeof userId !== 'string' || !userId.trim()) {
    throw new TypeError('A verified user ID is required.');
  }
  trustedPrincipals.set(req, Object.freeze({ userId: userId.trim() }));
}

export function securityHeaders(req, res) {
  const origin = req.headers.origin;
  if (origin && config.allowedOrigins.includes(origin)) {
    res.setHeader('access-control-allow-origin', origin);
    res.setHeader('vary', 'Origin');
  }
  res.setHeader('access-control-allow-methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('access-control-allow-headers', 'content-type,x-api-key,x-tenant-id,x-hookpoint-signature,x-hookpoint-timestamp,x-request-id');
  res.setHeader('x-content-type-options', 'nosniff');
  res.setHeader('x-frame-options', 'DENY');
  res.setHeader('referrer-policy', 'strict-origin-when-cross-origin');
  res.setHeader('permissions-policy', 'camera=(), microphone=(), geolocation=()');
  res.setHeader('content-security-policy', "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'self'; frame-ancestors 'none'");
  if (String(req.url || '').startsWith('/api/') || ['/ready','/health'].some((path) => String(req.url || '').startsWith(path))) res.setHeader('cache-control', 'no-store');
}

export function enforceRateLimit(req, res) {
  const forwarded = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim();
  const key = (config.trustProxy ? forwarded : '') || req.socket.remoteAddress || 'unknown';
  const minute = Math.floor(Date.now() / 60_000);
  const item = windows.get(key);
  if (!item || item.minute !== minute) windows.set(key, { minute, count: 1 });
  else item.count += 1;
  const current = windows.get(key);
  res.setHeader('x-ratelimit-limit', String(config.rateLimitPerMinute));
  res.setHeader('x-ratelimit-remaining', String(Math.max(0, config.rateLimitPerMinute - current.count)));
  res.setHeader('x-ratelimit-reset', String((minute + 1) * 60));
  if (current.count > config.rateLimitPerMinute) {
    res.setHeader('retry-after', String((minute + 1) * 60 - Math.floor(Date.now() / 1_000)));
    throw new AppError(429, 'rate_limited', 'Too many requests.');
  }
  if (windows.size > 10_000) for (const [entry, value] of windows) if (value.minute < minute) windows.delete(entry);
}

export function authenticate(db, req, { publicRoute = false } = {}) {
  if (publicRoute) return { tenantId: config.defaultTenantId, actor: 'public', authType: 'public', scopes: [] };
  const principal = trustedPrincipals.get(req);
  if (principal) {
    const tenantId = principal.userId;
    if (!db.get('SELECT id FROM tenants WHERE id=?', [tenantId])) {
      const now = nowIso();
      db.run(
        `INSERT OR IGNORE INTO tenants(id, name, slug, settings_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, 'Private workspace', `clerk-${sha256(tenantId).slice(0, 24)}`, stableJson({ workspaceType: 'private' }), now, now]
      );
      syncConnectorCatalog(db, tenantId, now);
    }
    return { tenantId, actor: `clerk:${principal.userId}`, authType: 'clerk', keyId: null, scopes: ['read','write','admin'] };
  }
  const provided = req.headers['x-api-key'];
  if (!config.authRequired && !provided) {
    const tenantId = config.defaultTenantId;
    if (!db.get('SELECT id FROM tenants WHERE id=?', [tenantId])) throw new AppError(403, 'unknown_tenant', 'The requested tenant does not exist.');
    return { tenantId, actor: 'local-development', authType: 'local', keyId: null, scopes: ['read','write','admin'] };
  }
  if (!provided) throw new AppError(401, 'api_key_required', 'Provide X-API-Key.');
  const currentHash = hashSecret(provided, config.hashSalt);
  const legacyHash = sha256(provided);
  const record = db.get(`SELECT * FROM api_keys WHERE key_hash IN (?, ?) AND revoked_at IS NULL`, [currentHash, legacyHash]);
  if (!record || (!safeEqual(record.key_hash, currentHash) && !safeEqual(record.key_hash, legacyHash))) throw new AppError(401, 'invalid_api_key', 'API key is invalid.');
  if (record.key_hash === legacyHash) db.run('UPDATE api_keys SET key_hash=? WHERE id=?', [currentHash, record.id]);
  if (!record.last_used_at || Date.now() - new Date(record.last_used_at).getTime() > 5 * 60_000) {
    db.run('UPDATE api_keys SET last_used_at=? WHERE id=?', [nowIso(), record.id]);
  }
  return { tenantId: record.tenant_id, actor: record.name, authType: 'apiKey', keyId: record.id, scopes: record.scopes.split(',').map((scope) => scope.trim()).filter(Boolean) };
}

export function requireScope(auth, scope) {
  if (!auth.scopes.includes(scope) && !auth.scopes.includes('admin')) throw new AppError(403, 'insufficient_scope', `${scope} permission is required.`);
}

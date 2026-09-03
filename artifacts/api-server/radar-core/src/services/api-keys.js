import { config } from '../config.js';
import { AppError, hashSecret, id, nowIso } from '../lib.js';

const allowedScopes = new Set(['read','write','admin']);

export function listApiKeys(db, tenantId) {
  return db.all(`SELECT id, name, key_prefix, scopes, created_at, last_used_at, revoked_at
    FROM api_keys WHERE tenant_id=? ORDER BY created_at DESC`, [tenantId])
    .map((key) => ({ ...key, scopes: key.scopes.split(',').map((scope) => scope.trim()).filter(Boolean) }));
}

export function createApiKey(db, tenantId, input = {}) {
  if (!config.hashSalt || config.hashSalt.length < 32) throw new AppError(409, 'hash_salt_required', 'Configure HASH_SALT with at least 32 characters before creating API keys.');
  const name = String(input.name || '').trim().slice(0, 200);
  if (!name) throw new AppError(400, 'api_key_name_required', 'API key name is required.');
  const requested = Array.isArray(input.scopes) ? input.scopes : String(input.scopes || 'read').split(',');
  const scopes = [...new Set(requested.map((scope) => String(scope).trim()).filter(Boolean))];
  if (!scopes.length || scopes.some((scope) => !allowedScopes.has(scope))) throw new AppError(400, 'invalid_api_key_scopes', 'Scopes may contain read, write and admin only.');
  const token = id('hp_live');
  const keyId = id('key');
  const now = nowIso();
  db.run(`INSERT INTO api_keys(id, tenant_id, name, key_prefix, key_hash, scopes, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)`, [keyId, tenantId, name, token.slice(0, 16), hashSecret(token, config.hashSalt), scopes.join(','), now]);
  return { id: keyId, name, key_prefix: token.slice(0, 16), scopes, created_at: now, token };
}

export function revokeApiKey(db, tenantId, keyId, currentKeyId) {
  if (keyId === currentKeyId) throw new AppError(409, 'cannot_revoke_current_key', 'Use a different administrator key to revoke the current key.');
  const key = db.get('SELECT id, revoked_at FROM api_keys WHERE tenant_id=? AND id=?', [tenantId, keyId]);
  if (!key) throw new AppError(404, 'api_key_not_found', 'API key not found.');
  if (!key.revoked_at) db.run('UPDATE api_keys SET revoked_at=? WHERE tenant_id=? AND id=?', [nowIso(), tenantId, keyId]);
  return { id: keyId, revoked: true };
}

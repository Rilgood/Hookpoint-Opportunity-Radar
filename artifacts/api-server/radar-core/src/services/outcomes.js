import { AppError, id, isPlainObject, json, nowIso, redactSecrets, stableJson } from '../lib.js';
import { config } from '../config.js';
import { scoringConfig } from './catalog.js';

const types = new Set(['accepted','rejected','contacted','positive_reply','negative_reply','meeting','opportunity','won','lost','disqualified','suppression_correct','suppression_wrong']);
const statusByOutcome = { accepted: 'accepted', rejected: 'rejected', contacted: 'contacted', positive_reply: 'replied', negative_reply: 'contacted', meeting: 'meeting', opportunity: 'opportunity', won: 'customer', lost: 'lost', disqualified: 'disqualified' };

export function recordOutcome(db, tenantId, companyId, input, actor = 'operator') {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'invalid_outcome', 'Outcome must be a JSON object.');
  if (!types.has(input.outcome_type)) throw new AppError(400, 'invalid_outcome_type', `outcome_type must be one of: ${[...types].join(', ')}`);
  const company = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!company) throw new AppError(404, 'company_not_found', 'Company not found.');
  const occurred = new Date(input.occurred_at || Date.now());
  if (Number.isNaN(occurred.getTime())) throw new AppError(400, 'invalid_occurred_at', 'occurred_at must be a valid date.');
  if (occurred.getTime() > Date.now() + config.maxFutureSkewMinutes * 60_000) throw new AppError(400, 'future_occurred_at', `occurred_at may not be more than ${config.maxFutureSkewMinutes} minutes in the future.`);
  const amount = input.amount == null ? null : Number(input.amount);
  if (amount != null && (!Number.isFinite(amount) || amount < 0 || amount > 1e15)) throw new AppError(400, 'invalid_amount', 'amount must be a non-negative finite number no greater than 1e15.');
  if (input.signal_key && !db.get('SELECT id FROM signals WHERE tenant_id=? AND company_id=? AND signal_key=?', [tenantId, companyId, input.signal_key])) {
    throw new AppError(400, 'invalid_signal_key', 'signal_key is not associated with this company.');
  }
  if (input.metadata !== undefined && !isPlainObject(input.metadata)) throw new AppError(400, 'invalid_outcome_metadata', 'metadata must be a JSON object.');
  const metadata = stableJson(redactSecrets(input.metadata || {}));
  if (Buffer.byteLength(metadata) > 100_000) throw new AppError(413, 'outcome_metadata_too_large', 'metadata may not exceed 100 KB.');
  const outcomeId = id('outcome');
  const now = nowIso();
  db.run(`INSERT INTO outcomes(id, tenant_id, company_id, outcome_type, signal_key, score_at_outcome, amount, note, metadata_json, occurred_at, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [outcomeId, tenantId, companyId, input.outcome_type, input.signal_key || null,
    company.opportunity_score, amount, input.note ? String(input.note).slice(0, 2_000) : null, metadata, occurred.toISOString(), now]);
  const nextStatus = statusByOutcome[input.outcome_type];
  if (nextStatus) db.run('UPDATE companies SET status=?, updated_at=? WHERE tenant_id=? AND id=?', [nextStatus, now, tenantId, companyId]);
  if (['rejected','customer','lost','disqualified'].includes(nextStatus)) db.run('DELETE FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, companyId]);
  db.run(`INSERT INTO lead_events(id, tenant_id, company_id, event_type, from_value, to_value, actor, note, occurred_at)
    VALUES (?, ?, ?, 'outcome_recorded', ?, ?, ?, ?, ?)`, [id('evt'), tenantId, companyId, company.status, nextStatus || company.status, actor, input.note || input.outcome_type, occurred.toISOString()]);
  const stored = db.get('SELECT * FROM outcomes WHERE tenant_id=? AND id=?', [tenantId, outcomeId]);
  const { metadata_json: metadataJson, ...outcome } = stored;
  return { ...outcome, metadata: json(metadataJson) };
}

export function outcomeAnalytics(db, tenantId) {
  const totals = db.all(`SELECT outcome_type, COUNT(*) count, COALESCE(SUM(amount),0) amount FROM outcomes WHERE tenant_id=? GROUP BY outcome_type ORDER BY count DESC`, [tenantId]);
  const scoreBands = db.all(`SELECT
      CASE WHEN score_at_outcome>=? THEN 'hot' WHEN score_at_outcome>=? THEN 'warm' WHEN score_at_outcome>=? THEN 'watch' ELSE 'cold' END score_band,
      COUNT(*) labeled,
      SUM(CASE WHEN outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) positive,
      ROUND(100.0 * SUM(CASE WHEN outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) / COUNT(*), 1) positive_rate
    FROM outcomes WHERE tenant_id=? GROUP BY score_band ORDER BY MIN(score_at_outcome) DESC`,
  [scoringConfig.tierThresholds.hot, scoringConfig.tierThresholds.warm, scoringConfig.tierThresholds.watch, tenantId]);
  const signalPerformance = db.all(`SELECT o.signal_key, s.label, COUNT(*) labeled,
      SUM(CASE WHEN o.outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) positive,
      ROUND(100.0 * SUM(CASE WHEN o.outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) / COUNT(*), 1) positive_rate
    FROM outcomes o LEFT JOIN signals s ON s.tenant_id=o.tenant_id AND s.company_id=o.company_id AND s.signal_key=o.signal_key
    WHERE o.tenant_id=? AND o.signal_key IS NOT NULL GROUP BY o.signal_key, s.label ORDER BY positive_rate DESC, labeled DESC`, [tenantId]);
  return { totals, score_bands: scoreBands, signal_performance: signalPerformance };
}

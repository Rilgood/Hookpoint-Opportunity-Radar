import { AppError, id, isPlainObject, json, nowIso, redactSecrets, stableJson } from '../lib.js';
import { config } from '../config.js';
import { scoringConfig } from './catalog.js';

const types = new Set(['accepted','rejected','contacted','positive_reply','negative_reply','meeting','opportunity','won','lost','disqualified','suppression_correct','suppression_wrong']);
const statusByOutcome = { accepted: 'accepted', rejected: 'rejected', contacted: 'contacted', positive_reply: 'replied', negative_reply: 'contacted', meeting: 'meeting', opportunity: 'opportunity', won: 'customer', lost: 'lost', disqualified: 'disqualified' };
const qualifiedOutcomes = new Set(['meeting', 'opportunity', 'won']);
const calibrationBands = ['hot', 'warm', 'watch', 'cold'];
const calibrationMinimumSample = 30;
const calibrationMinEachClass = 10;

function roundPercent(value) {
  if (!Number.isFinite(value)) return 0;
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function wilsonBounds(qualified, labeled) {
  if (!labeled) return { lower: 0, upper: 0 };
  const z = 1.96;
  const rate = qualified / labeled;
  const denominator = 1 + (z * z) / labeled;
  const center = (rate + (z * z) / (2 * labeled)) / denominator;
  const margin = z * Math.sqrt((rate * (1 - rate) + (z * z) / (4 * labeled)) / labeled) / denominator;
  return {
    lower: roundPercent(Math.max(0, center - margin) * 100),
    upper: roundPercent(Math.min(1, center + margin) * 100)
  };
}

function calibrationBand(score) {
  if (score >= scoringConfig.tierThresholds.hot) return 'hot';
  if (score >= scoringConfig.tierThresholds.warm) return 'warm';
  if (score >= scoringConfig.tierThresholds.watch) return 'watch';
  return 'cold';
}

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
  const labelEvents = db.all(`SELECT company_id, outcome_type, score_at_outcome
    FROM outcomes
    WHERE tenant_id=? AND outcome_type IN ('meeting', 'opportunity', 'won', 'lost', 'disqualified')
    ORDER BY company_id ASC, occurred_at ASC, created_at ASC, id ASC`, [tenantId]);
  const firstLabelByCompany = new Map();
  for (const event of labelEvents) {
    if (!firstLabelByCompany.has(event.company_id)) firstLabelByCompany.set(event.company_id, event);
  }
  const countsByBand = Object.fromEntries(calibrationBands.map((band) => [band, { labeled: 0, qualified: 0, negative: 0 }]));
  for (const event of firstLabelByCompany.values()) {
    const counts = countsByBand[calibrationBand(event.score_at_outcome)];
    counts.labeled += 1;
    if (qualifiedOutcomes.has(event.outcome_type)) counts.qualified += 1;
    else counts.negative += 1;
  }
  const cold = countsByBand.cold;
  const coldRawRate = cold.labeled ? (cold.qualified / cold.labeled) * 100 : null;
  const calibrationScoreBands = calibrationBands.map((scoreBand) => {
    const counts = countsByBand[scoreBand];
    const rawQualifiedRate = counts.labeled ? roundPercent((counts.qualified / counts.labeled) * 100) : 0;
    const bounds = wilsonBounds(counts.qualified, counts.labeled);
    return {
      score_band: scoreBand,
      labeled: counts.labeled,
      qualified: counts.qualified,
      negative: counts.negative,
      raw_qualified_rate: rawQualifiedRate,
      smoothed_qualified_rate: roundPercent(((counts.qualified + 1) / (counts.labeled + 2)) * 100),
      wilson_95_lower: bounds.lower,
      wilson_95_upper: bounds.upper,
      qualified_rate_lift_vs_cold: coldRawRate === null ? null : roundPercent(rawQualifiedRate - coldRawRate)
    };
  });
  const labeledAccounts = firstLabelByCompany.size;
  const qualifiedAccounts = [...firstLabelByCompany.values()].filter((event) => qualifiedOutcomes.has(event.outcome_type)).length;
  const negativeAccounts = labeledAccounts - qualifiedAccounts;
  return {
    totals,
    score_bands: scoreBands,
    signal_performance: signalPerformance,
    calibration: {
      summary: {
        labeled_accounts: labeledAccounts,
        qualified_accounts: qualifiedAccounts,
        negative_accounts: negativeAccounts,
        minimum_sample: calibrationMinimumSample,
        min_each_class: calibrationMinEachClass,
        sufficient_sample: labeledAccounts >= calibrationMinimumSample && qualifiedAccounts >= calibrationMinEachClass && negativeAccounts >= calibrationMinEachClass,
        cohort_note: 'Results cover only accounts with a qualifying or negative outcome label; they are observational and do not establish causality.',
        recommendation: 'Use this calibration to monitor lead quality only; do not change score weights from these results alone.'
      },
      score_bands: calibrationScoreBands
    }
  };
}

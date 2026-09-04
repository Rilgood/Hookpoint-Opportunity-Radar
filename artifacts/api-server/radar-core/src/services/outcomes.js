import { AppError, id, isPlainObject, json, nowIso, redactSecrets, round, stableJson } from '../lib.js';
import { config } from '../config.js';
import { activeScoringConfig, scoringConfig } from './catalog.js';
import { isUniqueViolation } from '../db/index.js';

const types = new Set(['accepted','rejected','contacted','positive_reply','negative_reply','meeting','opportunity','won','lost','disqualified','suppression_correct','suppression_wrong']);
const statusByOutcome = { accepted: 'accepted', rejected: 'rejected', contacted: 'contacted', positive_reply: 'replied', negative_reply: 'contacted', meeting: 'meeting', opportunity: 'opportunity', won: 'customer', lost: 'lost', disqualified: 'disqualified' };
const qualifiedOutcomes = new Set(['meeting', 'opportunity', 'won']);
const calibrationBands = ['hot', 'warm', 'watch', 'cold'];

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
  const activeConfig = activeScoringConfig(db, tenantId);
  const policy = activeConfig.calibrationPolicy || scoringConfig.calibrationPolicy;
  const totals = db.all(`SELECT outcome_type, COUNT(*) count, COALESCE(SUM(amount),0) amount FROM outcomes WHERE tenant_id=? GROUP BY outcome_type ORDER BY count DESC`, [tenantId]);
  const scoreBands = db.all(`SELECT
      CASE WHEN score_at_outcome>=? THEN 'hot' WHEN score_at_outcome>=? THEN 'warm' WHEN score_at_outcome>=? THEN 'watch' ELSE 'cold' END score_band,
      COUNT(*) labeled,
      SUM(CASE WHEN outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) positive,
      ROUND(CAST(100.0 * SUM(CASE WHEN outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) / COUNT(*) AS NUMERIC), 1) positive_rate
    FROM outcomes WHERE tenant_id=? GROUP BY 1 ORDER BY MIN(score_at_outcome) DESC`,
  [scoringConfig.tierThresholds.hot, scoringConfig.tierThresholds.warm, scoringConfig.tierThresholds.watch, tenantId]);
  const signalPerformance = db.all(`SELECT o.signal_key, s.label, COUNT(*) labeled,
      SUM(CASE WHEN o.outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) positive,
      ROUND(CAST(100.0 * SUM(CASE WHEN o.outcome_type IN ('positive_reply','meeting','opportunity','won') THEN 1 ELSE 0 END) / COUNT(*) AS NUMERIC), 1) positive_rate
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
        minimum_sample: policy.minimumSample,
        min_each_class: policy.minEachClass,
        sufficient_sample: labeledAccounts >= policy.minimumSample && qualifiedAccounts >= policy.minEachClass && negativeAccounts >= policy.minEachClass,
        cohort_note: 'Results cover only accounts with a qualifying or negative outcome label; they are observational and do not establish causality.',
        recommendation: 'Use this calibration to monitor lead quality only; do not change score weights from these results alone.'
      },
      score_bands: calibrationScoreBands
    }
  };
}

export function evaluateScoreCalibration(db, tenantId, actor) {
  const activeConfig = activeScoringConfig(db, tenantId);
  const policy = activeConfig.calibrationPolicy || scoringConfig.calibrationPolicy;
  const labels = firstOutcomeLabels(db, tenantId);
  const holdoutSize = Math.ceil(labels.length * policy.holdoutFraction);
  const holdout = labels.slice(-holdoutSize);
  const training = labels.slice(0, -holdoutSize);
  const qualified = holdout.filter((row) => qualifiedOutcomes.has(row.outcome_type)).length;
  const negative = holdout.length - qualified;
  const trainingQualified = training.filter((row) => qualifiedOutcomes.has(row.outcome_type)).length;
  const trainingNegative = training.length - trainingQualified;
  const guardrails = {
    cohort: `Most recent ${Math.round(policy.holdoutFraction * 100)}% of first qualifying or negative labels, held out from the proposal calculation.`,
    holdout_accounts: holdout.length,
    qualified_accounts: qualified,
    negative_accounts: negative,
    minimum_sample: policy.minimumSample,
    min_each_class: policy.minEachClass,
    training_accounts: training.length,
    training_qualified_accounts: trainingQualified,
    training_negative_accounts: trainingNegative,
    minimum_training_sample: policy.minimumTrainingSample,
    min_training_each_class: policy.minTrainingEachClass
  };
  if (holdout.length < policy.minimumSample || qualified < policy.minEachClass || negative < policy.minEachClass
    || training.length < policy.minimumTrainingSample || trainingQualified < policy.minTrainingEachClass || trainingNegative < policy.minTrainingEachClass) {
    return { status: 'blocked', guardrails, reason: `Holdout needs ${policy.minimumSample} labels with ${policy.minEachClass} qualified and ${policy.minEachClass} negative outcomes; training needs ${policy.minimumTrainingSample} labels with ${policy.minTrainingEachClass} in each class.` };
  }
  const trainingRows = training.map((label) => ({ ...label, snapshot: snapshotAtOutcome(db, tenantId, label) })).filter((row) => row.snapshot);
  const holdoutRows = holdout.map((label) => ({ ...label, snapshot: snapshotAtOutcome(db, tenantId, label) })).filter((row) => row.snapshot);
  if (trainingRows.length !== training.length || holdoutRows.length !== holdout.length) {
    return { status: 'blocked', guardrails: { ...guardrails, scored_training_accounts: trainingRows.length, scored_holdout_accounts: holdoutRows.length }, reason: 'Every training and holdout label needs a historic score snapshot. Rescore and collect new labeled outcomes before evaluating.' };
  }
  const baseline = activeConfig.dimensionWeights;
  const proposed = proposeWeights(trainingRows, baseline, policy.maxWeightShift);
  const before = evaluationMetrics(holdoutRows, baseline);
  const after = evaluationMetrics(holdoutRows, proposed);
  if (after.auc - before.auc < policy.minimumAucLift) {
    return { status: 'blocked', guardrails, reason: `The candidate did not improve holdout discrimination by the required ${(policy.minimumAucLift * 100).toFixed(0)} percentage point AUC margin.`, before, after };
  }
  const version = `${activeConfig.version}-cal-${new Date().toISOString().slice(0, 10).replaceAll('-', '')}`;
  const uniqueVersion = db.get('SELECT id FROM scoring_versions WHERE tenant_id=? AND version=?', [tenantId, version]);
  if (uniqueVersion) return { status: 'ready', recommendation: scoringVersion(db, tenantId, uniqueVersion.id) };
  const candidate = { ...activeConfig, version, dimensionWeights: proposed };
  const evaluation = { guardrails, before, after, explanation: weightExplanation(baseline, proposed) };
  const createdAt = nowIso();
  const recommendationId = id('score_version');
  db.run(`INSERT INTO scoring_versions(id, tenant_id, version, status, base_version, config_json, evaluation_json, created_at, created_by)
    VALUES (?, ?, ?, 'proposed', ?, ?, ?, ?, ?)`, [recommendationId, tenantId, version, activeConfig.version,
    stableJson(candidate), stableJson(evaluation), createdAt, actor]);
  return { status: 'ready', recommendation: scoringVersion(db, tenantId, recommendationId) };
}

export function approveScoreCalibration(db, tenantId, recommendationId, actor) {
  const proposal = db.get(`SELECT * FROM scoring_versions WHERE tenant_id=? AND id=?`, [tenantId, recommendationId]);
  if (!proposal) throw new AppError(404, 'score_recommendation_not_found', 'Score recommendation not found.');
  if (proposal.status !== 'proposed') throw new AppError(409, 'score_recommendation_not_pending', 'Only a pending score recommendation can be approved.');
  const latest = activeScoringConfig(db, tenantId);
  if (proposal.base_version !== latest.version) throw new AppError(409, 'score_recommendation_stale', 'This recommendation was evaluated against an older scoring version. Run a new evaluation.');
  const now = nowIso();
  db.run(`UPDATE scoring_versions SET status='superseded' WHERE tenant_id=? AND status='approved'`, [tenantId]);
  try {
    db.run(`UPDATE scoring_versions SET status='approved', approved_at=?, approved_by=? WHERE id=?`, [now, actor, recommendationId]);
  } catch (error) {
    if (isActiveScoreVersionConflict(error)) {
      throw new AppError(409, 'score_approval_conflict', 'Another scoring version is already active for this workspace. Refresh and try again.');
    }
    throw error;
  }
  return scoringVersion(db, tenantId, recommendationId);
}

function isActiveScoreVersionConflict(error) {
  return isUniqueViolation(error, { table: 'scoring_versions', column: 'tenant_id' });
}

function firstOutcomeLabels(db, tenantId) {
  const events = db.all(`SELECT company_id, outcome_type, score_at_outcome, occurred_at, created_at, id FROM outcomes
    WHERE tenant_id=? AND outcome_type IN ('meeting', 'opportunity', 'won', 'lost', 'disqualified')
    ORDER BY company_id ASC, occurred_at ASC, created_at ASC, id ASC`, [tenantId]);
  const first = new Map();
  for (const event of events) if (!first.has(event.company_id)) first.set(event.company_id, event);
  return [...first.values()].sort((a, b) => a.occurred_at.localeCompare(b.occurred_at) || a.id.localeCompare(b.id));
}

function snapshotAtOutcome(db, tenantId, outcome) {
  return db.get(`SELECT fit_score, need_score, intent_score, timing_score, opportunity_score FROM score_snapshots
    WHERE tenant_id=? AND company_id=? AND computed_at<=? ORDER BY computed_at DESC, id DESC LIMIT 1`,
  [tenantId, outcome.company_id, outcome.occurred_at]);
}

function proposeWeights(rows, baseline, maxShift) {
  const keys = ['fit', 'need', 'intent', 'timing'];
  const mean = (items, key) => items.reduce((sum, item) => sum + Number(item.snapshot[`${key}_score`]), 0) / items.length;
  const positive = rows.filter((row) => qualifiedOutcomes.has(row.outcome_type));
  const negative = rows.filter((row) => !qualifiedOutcomes.has(row.outcome_type));
  const effects = Object.fromEntries(keys.map((key) => [key, (mean(positive, key) - mean(negative, key)) / 100]));
  const averageEffect = keys.reduce((sum, key) => sum + effects[key], 0) / keys.length;
  const raw = Object.fromEntries(keys.map((key) => [key, baseline[key] + Math.max(-maxShift, Math.min(maxShift, (effects[key] - averageEffect) * maxShift))]));
  const total = keys.reduce((sum, key) => sum + raw[key], 0);
  return Object.fromEntries(keys.map((key) => [key, round(raw[key] / total, 4)]));
}

function evaluationMetrics(rows, weights) {
  const scored = rows.map((row) => ({ qualified: qualifiedOutcomes.has(row.outcome_type), score: ['fit', 'need', 'intent', 'timing']
    .reduce((sum, key) => sum + Number(row.snapshot[`${key}_score`]) * weights[key], 0) }));
  const positives = scored.filter((row) => row.qualified);
  const negatives = scored.filter((row) => !row.qualified);
  let wins = 0;
  for (const positive of positives) for (const negative of negatives) wins += positive.score > negative.score ? 1 : positive.score === negative.score ? 0.5 : 0;
  const ordered = [...scored].sort((a, b) => b.score - a.score);
  const top = ordered.slice(0, Math.max(1, Math.ceil(ordered.length / 4)));
  return { auc: round(wins / (positives.length * negatives.length), 3), top_quartile_qualified_rate: round(100 * top.filter((row) => row.qualified).length / top.length, 1) };
}

function weightExplanation(before, after) {
  return Object.keys(before).map((dimension) => ({
    dimension, before: before[dimension], after: after[dimension], change: round(after[dimension] - before[dimension], 4)
  })).filter((item) => item.change !== 0);
}

function scoringVersion(db, tenantId, id) {
  const row = db.get('SELECT * FROM scoring_versions WHERE tenant_id=? AND id=?', [tenantId, id]);
  if (!row) return null;
  return { id: row.id, version: row.version, status: row.status, base_version: row.base_version, config: json(row.config_json),
    evaluation: json(row.evaluation_json), created_at: row.created_at, created_by: row.created_by, approved_at: row.approved_at, approved_by: row.approved_by };
}

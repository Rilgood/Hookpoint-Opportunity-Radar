import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { ingestBatch, ingestOne } from '../src/services/ingestion.js';
import { companyDetail } from '../src/services/queries.js';
import { config } from '../src/config.js';
import { approveScoreCalibration, evaluateScoreCalibration, outcomeAnalytics, recordOutcome } from '../src/services/outcomes.js';
import { activeScoringConfig } from '../src/services/catalog.js';

function setup() { const db = openDatabase(':memory:'); bootstrap(db); return db; }
function addCompany(db, tenantId, companyId, score) {
  const now = new Date().toISOString();
  db.run(`INSERT INTO companies(id, tenant_id, name, normalized_name, domain, opportunity_score, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [companyId, tenantId, companyId, companyId.toLowerCase(), `${companyId}.example`, score, now, now]);
}
function addOutcome(db, tenantId, companyId, score, outcomeType, occurredAt) {
  db.run('UPDATE companies SET opportunity_score=? WHERE tenant_id=? AND id=?', [score, tenantId, companyId]);
  return recordOutcome(db, tenantId, companyId, { outcome_type: outcomeType, occurred_at: occurredAt });
}

function addSnapshot(db, tenantId, companyId, occurredAt, { fit, need, intent = 0, timing = 0 }) {
  db.run(`INSERT INTO score_snapshots(id, tenant_id, company_id, score_version, opportunity_score, opportunity_tier,
    fit_score, need_score, intent_score, timing_score, risk_score, active_signal_count, components_json, computed_at)
    VALUES (?, ?, ?, 'rules-1.1', 0, 'cold', ?, ?, ?, ?, 0, 0, '{}', ?)`,
  [`snapshot-${companyId}`, tenantId, companyId, fit, need, intent, timing, occurredAt]);
}

test('resolves two sources to one company and corroborates a signal', () => {
  const db = setup();
  const base = { company: { name: 'Acme Health', domain: 'https://www.acme.example', industry: 'Healthcare', employee_count: 120 }, type: 'product_launch', title: 'Acme launches a new care platform', attributes: { is_new: true }, observed_at: new Date().toISOString() };
  const one = ingestOne(db, config.defaultTenantId, { ...base, source: 'company_news', external_id: '1' });
  const two = ingestOne(db, config.defaultTenantId, { ...base, source: 'trade_press', external_id: '2', title: 'Acme unveils its care platform' });
  assert.equal(one.company.id, two.company.id);
  const detail = companyDetail(db, config.defaultTenantId, one.company.id);
  assert.equal(detail.signals[0].signal_key, 'product_launch');
  assert.equal(detail.signals[0].source_count, 2);
  assert.equal(detail.observations.length, 2);
  db.close();
});

test('is idempotent for repeated source records', () => {
  const db = setup();
  const record = { company: { name: 'North Co', domain: 'north.example' }, source: 'news', external_id: 'same', type: 'funding', title: 'North raises a seed round', observed_at: '2026-08-20T12:00:00Z', attributes: { amount: 3000000 } };
  const result = ingestBatch(db, config.defaultTenantId, [record, record]);
  assert.equal(result.inserted, 1);
  assert.equal(result.duplicates, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM observations').count, 1);
  db.close();
});

test('combines creative need and ad intent into a priority opportunity', () => {
  const db = setup();
  const company = { name: 'Velocity Goods', domain: 'velocity.example', industry: 'Consumer Products', employee_count: 90 };
  const now = new Date().toISOString();
  const result = ingestBatch(db, config.defaultTenantId, [
    { company, source: 'meta_ad_library', type: 'ad_snapshot', title: 'Ad count surged with repeated creative', observed_at: now, confidence: .95, attributes: { active_ads: 40, active_ads_delta_pct: 80, duplicate_creative_ratio: .75, median_creative_age_days: 40 } },
    { company, source: 'instagram', type: 'social_metric', title: 'Engagement rate declined', observed_at: now, confidence: .9, attributes: { engagement_rate_delta_pct: -35 } }
  ]);
  const scored = db.get('SELECT * FROM companies WHERE id=?', [result.companies[0]]);
  assert.ok(scored.opportunity_score >= 65, `expected >=65, got ${scored.opportunity_score}`);
  assert.equal(scored.opportunity_tier, 'hot');
  assert.ok(companyDetail(db, config.defaultTenantId, scored.id).recommendation);
  db.close();
});

test('suppresses automated outreach during a severe crisis', () => {
  const db = setup();
  const outcome = ingestOne(db, config.defaultTenantId, { company: { name: 'Risk Corp', domain: 'risk.example', industry: 'Technology', employee_count: 500 }, source: 'news', type: 'crisis', title: 'Risk Corp reports data breach', observed_at: new Date().toISOString(), confidence: .95, attributes: { severity: 'critical' } });
  assert.equal(outcome.company.opportunity_tier, 'suppressed');
  assert.ok(outcome.company.risk_score >= 45);
  assert.equal(companyDetail(db, config.defaultTenantId, outcome.company.id).recommendation.offer, 'Outreach paused');
  db.close();
});

test('rejects an observation without company identity', () => {
  const db = setup();
  assert.throws(() => ingestOne(db, config.defaultTenantId, { source: 'test', type: 'news', title: 'Missing company' }), /company identity is required/i);
  db.close();
});

test('records closed-loop sales outcomes for score calibration', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, { company: { name: 'Feedback Co', domain: 'feedback.example', industry: 'Retail', employee_count: 50 }, source: 'crm', type: 'web_intent', title: 'Requested a demonstration', observed_at: new Date().toISOString(), attributes: { demo_requested: true } });
  const outcome = recordOutcome(db, config.defaultTenantId, result.company.id, { outcome_type: 'meeting', signal_key: 'high_first_party_intent', amount: 25000 });
  assert.equal(outcome.outcome_type, 'meeting');
  assert.equal(db.get('SELECT status FROM companies WHERE id=?', [result.company.id]).status, 'meeting');
  assert.equal(outcomeAnalytics(db, config.defaultTenantId).totals[0].count, 1);
  db.close();
});

test('calibration uses only earliest qualifying or negative label per tenant account', () => {
  const db = setup();
  const tenant = config.defaultTenantId;
  addCompany(db, tenant, 'hot-qualified', 80);
  addCompany(db, tenant, 'warm-negative', 55);
  addCompany(db, tenant, 'watch-qualified', 40);
  addCompany(db, tenant, 'cold-negative', 10);
  addCompany(db, tenant, 'hot-opportunity', 80);
  addCompany(db, tenant, 'excluded', 80);
  addOutcome(db, tenant, 'hot-qualified', 80, 'meeting', '2020-01-01T00:00:00Z');
  addOutcome(db, tenant, 'hot-qualified', 10, 'lost', '2020-01-02T00:00:00Z');
  addOutcome(db, tenant, 'warm-negative', 55, 'disqualified', '2020-01-01T00:00:00Z');
  addOutcome(db, tenant, 'watch-qualified', 40, 'won', '2020-01-01T00:00:00Z');
  addOutcome(db, tenant, 'cold-negative', 10, 'lost', '2020-01-01T00:00:00Z');
  addOutcome(db, tenant, 'hot-opportunity', 80, 'opportunity', '2020-01-01T00:00:00Z');
  for (const outcomeType of ['contacted', 'accepted', 'rejected', 'positive_reply', 'negative_reply', 'suppression_correct', 'suppression_wrong']) {
    addOutcome(db, tenant, 'excluded', 80, outcomeType, '2020-01-01T00:00:00Z');
  }
  db.run(`INSERT INTO tenants(id, name, slug, created_at, updated_at) VALUES ('other', 'Other', 'other', '2020-01-01T00:00:00Z', '2020-01-01T00:00:00Z')`);
  addCompany(db, 'other', 'other-qualified', 80);
  addOutcome(db, 'other', 'other-qualified', 80, 'opportunity', '2020-01-01T00:00:00Z');

  const analytics = outcomeAnalytics(db, tenant);
  assert.deepEqual(analytics.calibration.score_bands.map(({ score_band, labeled, qualified, negative }) => ({ score_band, labeled, qualified, negative })), [
    { score_band: 'hot', labeled: 2, qualified: 2, negative: 0 },
    { score_band: 'warm', labeled: 1, qualified: 0, negative: 1 },
    { score_band: 'watch', labeled: 1, qualified: 1, negative: 0 },
    { score_band: 'cold', labeled: 1, qualified: 0, negative: 1 }
  ]);
  assert.deepEqual(analytics.calibration.summary.labeled_accounts, 5);
  assert.deepEqual(analytics.calibration.summary.qualified_accounts, 3);
  assert.deepEqual(analytics.calibration.summary.negative_accounts, 2);
  assert.equal(analytics.calibration.summary.sufficient_sample, false);
  assert.ok(analytics.calibration.summary.cohort_note.includes('only accounts'));
  assert.ok(analytics.calibration.summary.recommendation.includes('do not change score weights'));
  assert.ok(Array.isArray(analytics.totals));
  assert.ok(Array.isArray(analytics.score_bands));
  assert.ok(Array.isArray(analytics.signal_performance));
  db.close();
});

test('calibration returns safe zero bands, finite intervals, and threshold metadata', () => {
  const empty = setup();
  const emptyCalibration = outcomeAnalytics(empty, config.defaultTenantId).calibration;
  assert.deepEqual(emptyCalibration.score_bands.map((row) => row.labeled), [0, 0, 0, 0]);
  for (const row of emptyCalibration.score_bands) {
    assert.equal(row.raw_qualified_rate, 0);
    assert.equal(row.qualified_rate_lift_vs_cold, null);
    assert.ok(Number.isFinite(row.smoothed_qualified_rate));
    assert.ok(Number.isFinite(row.wilson_95_lower));
    assert.ok(Number.isFinite(row.wilson_95_upper));
  }
  empty.close();

  const db = setup();
  const tenant = config.defaultTenantId;
  for (let index = 0; index < 29; index += 1) {
    const companyId = `insufficient-${index}`;
    addCompany(db, tenant, companyId, 10);
    addOutcome(db, tenant, companyId, 10, index < 10 ? 'meeting' : 'lost', `2020-01-${String(index + 1).padStart(2, '0')}T00:00:00Z`);
  }
  assert.equal(outcomeAnalytics(db, tenant).calibration.summary.sufficient_sample, false);
  addCompany(db, tenant, 'sufficient-29', 10);
  addOutcome(db, tenant, 'sufficient-29', 10, 'lost', '2020-02-01T00:00:00Z');
  const calibration = outcomeAnalytics(db, tenant).calibration;
  assert.equal(calibration.summary.sufficient_sample, true);
  const cold = calibration.score_bands.find((row) => row.score_band === 'cold');
  assert.equal(cold.raw_qualified_rate, 33.3);
  assert.equal(cold.qualified_rate_lift_vs_cold, 0);
  assert.ok(cold.wilson_95_lower >= 0 && cold.wilson_95_upper <= 100);
  db.close();
});

test('score recommendations require a balanced holdout and only change versions after approval', () => {
  const db = setup();
  const tenant = config.defaultTenantId;
  for (let index = 0; index < 120; index += 1) {
    const companyId = `holdout-${index}`;
    const occurredAt = new Date(Date.UTC(2021, 0, index + 1)).toISOString();
    addCompany(db, tenant, companyId, 10);
    const isQualified = index >= 90 ? index % 2 === 0 : index % 3 === 0;
    addSnapshot(db, tenant, companyId, occurredAt, isQualified ? { fit: 0, need: 70 } : { fit: 100, need: 0 });
    addOutcome(db, tenant, companyId, 10, isQualified ? 'meeting' : 'lost', occurredAt);
  }
  const evaluation = evaluateScoreCalibration(db, tenant, 'operator-a');
  assert.equal(evaluation.status, 'ready');
  assert.equal(evaluation.recommendation.status, 'proposed');
  assert.ok(evaluation.recommendation.evaluation.after.auc > evaluation.recommendation.evaluation.before.auc);
  assert.equal(activeScoringConfig(db, tenant).version, 'rules-1.1');
  const approved = approveScoreCalibration(db, tenant, evaluation.recommendation.id, 'operator-b');
  assert.equal(approved.status, 'approved');
  assert.equal(activeScoringConfig(db, tenant).version, approved.version);
  assert.equal(db.get('SELECT COUNT(*) count FROM score_snapshots').count, 120);
  db.close();
});

test('an insufficient holdout is reported as a blocked evaluation with the counts the dashboard explains', () => {
  const db = setup();
  const tenant = config.defaultTenantId;
  // 40 labels -> a 25% holdout of 10, below the 30-label minimum. The dashboard
  // derives "not enough held-out labels" from these guardrail counts, so this
  // pins the response shape it depends on: a 200 with status "blocked", not an
  // error envelope.
  for (let index = 0; index < 40; index += 1) {
    const companyId = `short-holdout-${index}`;
    addCompany(db, tenant, companyId, 10);
    addOutcome(db, tenant, companyId, 10, index % 2 === 0 ? 'meeting' : 'lost', new Date(Date.UTC(2021, 0, index + 1)).toISOString());
  }
  const evaluation = evaluateScoreCalibration(db, tenant, 'operator-a');
  assert.equal(evaluation.status, 'blocked');
  assert.equal(evaluation.recommendation, undefined);
  assert.equal(evaluation.guardrails.holdout_accounts, 10);
  assert.equal(evaluation.guardrails.qualified_accounts, 5);
  assert.equal(evaluation.guardrails.negative_accounts, 5);
  assert.equal(evaluation.guardrails.minimum_sample, 30);
  assert.equal(evaluation.guardrails.min_each_class, 10);
  assert.ok(evaluation.guardrails.holdout_accounts < evaluation.guardrails.minimum_sample);
  assert.match(evaluation.reason, /Holdout needs 30 labels/);
  assert.equal(activeScoringConfig(db, tenant).version, 'rules-1.1');
  db.close();
});

test('score recommendations reject a training-only pattern that fails the independent holdout', () => {
  const db = setup();
  const tenant = config.defaultTenantId;
  for (let index = 0; index < 120; index += 1) {
    const companyId = `mismatch-${index}`;
    const occurredAt = new Date(Date.UTC(2022, 0, index + 1)).toISOString();
    const isQualified = index % 2 === 0;
    const trainingPattern = index < 90;
    addCompany(db, tenant, companyId, 10);
    addSnapshot(db, tenant, companyId, occurredAt,
      trainingPattern === isQualified ? { fit: 0, need: 70 } : { fit: 100, need: 0 });
    addOutcome(db, tenant, companyId, 10, isQualified ? 'meeting' : 'lost', occurredAt);
  }
  const evaluation = evaluateScoreCalibration(db, tenant, 'operator-a');
  assert.equal(evaluation.status, 'blocked');
  assert.ok(evaluation.reason.includes('did not improve holdout'));
  db.close();
});

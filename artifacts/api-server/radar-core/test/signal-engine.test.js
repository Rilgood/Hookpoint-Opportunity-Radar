import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { ingestBatch, ingestOne } from '../src/services/ingestion.js';
import { companyDetail } from '../src/services/queries.js';
import { config } from '../src/config.js';
import { outcomeAnalytics, recordOutcome } from '../src/services/outcomes.js';

function setup() { const db = openDatabase(':memory:'); bootstrap(db); return db; }

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

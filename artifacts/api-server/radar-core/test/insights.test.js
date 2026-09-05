import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './helpers/database.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { ingestOne } from '../src/services/ingestion.js';
import { recordOutcome } from '../src/services/outcomes.js';
import { activeScoringConfig } from '../src/services/catalog.js';
import { computeScore, rescoreCompany } from '../src/services/signals.js';
import { analyticsInsights, companyInsights } from '../src/services/insights.js';
import { config } from '../src/config.js';

function setup() {
  const db = openTestDatabase();
  bootstrap(db);
  return db;
}

function knownHistoricalScore(db, companyId, score, at) {
  db.run(`INSERT INTO score_snapshots(id,tenant_id,company_id,score_version,opportunity_score,opportunity_tier,
    fit_score,need_score,intent_score,timing_score,risk_score,active_signal_count,components_json,computed_at)
    VALUES (?,?,?,'historical-fixture',?,'cold',0,0,0,0,0,0,'{}',?)`,
  [`history-${companyId}-${at}`, config.defaultTenantId, companyId, score, at]);
}

function launch(db, name, domain, observedAt = new Date().toISOString(), source = 'news') {
  return ingestOne(db, config.defaultTenantId, {
    company: { name, domain, industry: 'Technology', employee_count: 40 },
    source, type: 'product_launch', title: `${name} launches a new product`,
    observed_at: observedAt, confidence: .9, attributes: { is_new: true }
  });
}

test('company insights are ordered, evidence-based, and projections do not write', () => {
  const db = setup();
  const now = new Date();
  const observedAt = new Date(now.getTime() - 10 * 86_400_000).toISOString();
  const result = launch(db, 'Insight Co', 'insight.example', observedAt);
  launch(db, 'Insight Co', 'insight.example', observedAt, 'trade_press');
  recordOutcome(db, config.defaultTenantId, result.company.id, { outcome_type: 'contacted', occurred_at: new Date(now.getTime() - 2 * 86_400_000).toISOString() });
  const before = db.get('SELECT * FROM companies WHERE id=?', [result.company.id]);
  const insight = companyInsights(db, config.defaultTenantId, result.company.id, now.toISOString());
  const after = db.get('SELECT * FROM companies WHERE id=?', [result.company.id]);
  assert.deepEqual(after, before);
  assert.deepEqual([...insight.story].sort((a, b) => a.at.localeCompare(b.at)), insight.story);
  assert.ok(insight.story.some((entry) => entry.kind === 'signal_detected'));
  assert.ok(insight.story.some((entry) => entry.kind === 'signal_corroborated'));
  assert.ok(insight.story.some((entry) => entry.kind === 'outcome_recorded'));
  assert.ok(Math.abs(insight.why_now.drivers.reduce((sum, driver) => sum + driver.share_of_positive_contribution, 0) - 100) <= .2);
  assert.ok(insight.action_window.projected_score_in_30_days.score <= insight.action_window.projected_score_in_14_days.score);
  assert.equal(insight.comparable_accounts.sufficient_sample, false);
  db.close();
});

test('counter evidence and deterministic changes reflect identity and fit data', () => {
  const db = setup();
  const result = launch(db, 'Review Co', 'review.example');
  db.run('UPDATE companies SET identity_confidence=.5, domain=NULL WHERE id=?', [result.company.id]);
  rescoreCompany(db, config.defaultTenantId, result.company.id);
  const insight = companyInsights(db, config.defaultTenantId, result.company.id);
  assert.ok(insight.counter_evidence.some((item) => item.code === 'identity_unverified'));
  assert.ok(insight.what_would_change.some((item) => item.expected_effect.score_delta > 0));
  db.run('UPDATE companies SET identity_confidence=.95 WHERE id=?', [result.company.id]);
  assert.ok(!companyInsights(db, config.defaultTenantId, result.company.id).counter_evidence.some((item) => item.code === 'identity_unverified'));
  db.close();
});

test('pure computeScore matches the persisted scorer', () => {
  const db = setup();
  const result = launch(db, 'Parity Co', 'parity.example');
  const stored = rescoreCompany(db, config.defaultTenantId, result.company.id);
  const signals = db.all(`SELECT * FROM signals WHERE tenant_id=? AND company_id=? AND status='active'`, [config.defaultTenantId, stored.id]);
  const computed = computeScore({ company: stored, signals, buyerCount: 0, scoringConfig: activeScoringConfig(db, config.defaultTenantId), asOf: stored.updated_at });
  assert.equal(computed.score, stored.opportunity_score);
  assert.equal(computed.tier, stored.opportunity_tier);
  db.close();
});

test('analytics uses earliest labels, sample guardrails, priorities, and tenant isolation', () => {
  const db = setup();
  const first = launch(db, 'False Confidence', 'false.example');
  db.run(`UPDATE companies SET opportunity_score=80, opportunity_tier='hot' WHERE id=?`, [first.company.id]);
  knownHistoricalScore(db, first.company.id, 80, new Date(Date.now() - 3 * 86_400_000).toISOString());
  recordOutcome(db, config.defaultTenantId, first.company.id, { outcome_type: 'lost', note: 'Budget was unavailable.', occurred_at: new Date(Date.now() - 2 * 86_400_000).toISOString() });
  recordOutcome(db, config.defaultTenantId, first.company.id, { outcome_type: 'meeting', occurred_at: new Date(Date.now() - 86_400_000).toISOString() });
  const second = launch(db, 'Hidden Win', 'hidden.example');
  db.run(`UPDATE companies SET opportunity_score=20, opportunity_tier='cold' WHERE id=?`, [second.company.id]);
  recordOutcome(db, config.defaultTenantId, second.company.id, { outcome_type: 'meeting' });
  const stamp = new Date().toISOString();
  db.run(`INSERT INTO tenants(id,name,slug,created_at,updated_at) VALUES ('tenant-other','Other','other',?,?)`, [stamp, stamp]);
  db.run(`INSERT INTO companies(id,tenant_id,name,normalized_name,domain,created_at,updated_at)
    VALUES ('other-company','tenant-other','Other Secret','other secret','other.example',?,?)`, [stamp, stamp]);
  const analytics = analyticsInsights(db, config.defaultTenantId);
  assert.deepEqual(analytics.base_rate, { labeled: 2, qualified: 1, negative: 1, qualified_rate: 50 });
  assert.equal(analytics.signal_effectiveness[0].verdict, 'insufficient');
  assert.equal(analytics.false_confidence[0].company_id, first.company.id);
  assert.equal(analytics.hidden_wins[0].company_id, second.company.id);
  assert.equal(analytics.focus_list_policy.new_signal_14d, 8);
  assert.ok(analytics.focus_list.some((item) => item.reasons.some((reason) => reason.includes('New positive signal'))));
  assert.ok(!JSON.stringify(analytics).includes('Other Secret'));
  db.close();
});
test('evidence observed after the earliest label never enters cohorts, source attribution, or timing', () => {
  const db = setup();
  const tenant = config.defaultTenantId;
  const now = new Date();
  const daysAgo = (days) => new Date(now.getTime() - days * 86_400_000).toISOString();
  // Subject account: signal active now.
  const subject = launch(db, 'Subject Co', 'subject.example', daysAgo(3));
  // Peer A: signal seen 20 days ago, qualified 5 days ago -> legitimate comparable, 15 days signal->qualified.
  const peerA = launch(db, 'Peer A', 'peer-a.example', daysAgo(20));
  knownHistoricalScore(db, peerA.company.id, peerA.company.opportunity_score, daysAgo(6));
  recordOutcome(db, tenant, peerA.company.id, { outcome_type: 'meeting', occurred_at: daysAgo(5) });
  // Peer B: qualified 30 days ago, signal only observed 2 days ago -> post-outcome evidence, must be excluded everywhere.
  const peerB = launch(db, 'Peer B', 'peer-b.example', daysAgo(2), 'late_source');
  knownHistoricalScore(db, peerB.company.id, 20, daysAgo(31));
  recordOutcome(db, tenant, peerB.company.id, { outcome_type: 'won', occurred_at: daysAgo(30) });

  const comparable = companyInsights(db, tenant, subject.company.id, now.toISOString()).comparable_accounts;
  assert.equal(comparable.labeled, 1, 'only Peer A shared the signal before its label');
  assert.equal(comparable.qualified, 1);
  assert.equal(comparable.median_days_signal_to_qualified, 15);

  const analytics = analyticsInsights(db, tenant, now.toISOString());
  assert.equal(analytics.timing.sample, 1, 'Peer B has no pre-label signal and is excluded from timing');
  assert.equal(analytics.timing.median_days_first_signal_to_qualified, 15);
  const launchRow = analytics.signal_effectiveness.find((row) => row.signal_key === peerA.signals?.[0]?.signal_key || row.label === 'Product launch');
  assert.ok(launchRow);
  assert.equal(launchRow.labeled, 1, 'signal effectiveness only counts labels where the signal predates the label');
  const lateSource = analytics.source_effectiveness.find((row) => row.source === 'late_source');
  assert.ok(lateSource);
  assert.equal(lateSource.accounts_touched, 1);
  assert.equal(lateSource.labeled_accounts, 0, 'a source that only observed the account after its label gets no attribution');
  const newsSource = analytics.source_effectiveness.find((row) => row.source === 'news');
  assert.equal(newsSource.labeled_accounts, 1);
  db.close();
});

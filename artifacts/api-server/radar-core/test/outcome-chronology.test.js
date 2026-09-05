import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './helpers/database.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { config } from '../src/config.js';
import { createCompany, updateCompany } from '../src/services/entities.js';
import { ingestOne } from '../src/services/ingestion.js';
import { outcomeAnalytics, recordOutcome } from '../src/services/outcomes.js';
import { analyticsInsights } from '../src/services/insights.js';

function setup(t) {
  const db = openTestDatabase();
  t.after(() => db.close());
  bootstrap(db);
  return db;
}

function addSnapshot(db, companyId, score, at, id = 'before-event') {
  db.run(`INSERT INTO score_snapshots(id,tenant_id,company_id,score_version,opportunity_score,opportunity_tier,
    fit_score,need_score,intent_score,timing_score,risk_score,active_signal_count,components_json,computed_at)
    VALUES (?,?,?,'historical-test',?,'cold',0,0,0,0,0,0,'{}',?)`, [id, config.defaultTenantId, companyId, score, at]);
}

test('a historic outcome uses the last pre-event score and cannot inherit later evidence', (t) => {
  const db = setup(t);
  const company = createCompany(db, config.defaultTenantId, { name: 'Historic Buyer', domain: 'historic-buyer.example' });
  addSnapshot(db, company.id, 24, '2020-01-01T00:00:00.000Z', 'early-score');
  addSnapshot(db, company.id, 80, '2020-03-01T00:00:00.000Z', 'late-score');
  db.run('UPDATE companies SET opportunity_score=80 WHERE id=?', [company.id]);
  const outcome = recordOutcome(db, config.defaultTenantId, company.id, { outcome_type: 'meeting', occurred_at: '2020-02-01T00:00:00.000Z' });
  assert.equal(outcome.score_at_outcome, 24);
  assert.deepEqual(outcome.metadata.score_provenance, { basis: 'historical_snapshot', calibration_eligible: true, snapshot_id: 'early-score', scored_at: '2020-01-01T00:00:00.000Z' });
  const analytics = outcomeAnalytics(db, config.defaultTenantId);
  assert.equal(analytics.calibration.score_bands.find((row) => row.score_band === 'cold').qualified, 1);
  assert.equal(analytics.calibration.score_bands.find((row) => row.score_band === 'hot').qualified, 0);
});

test('unknown-score historical wins retain revenue while spoofed provenance and later labels cannot enter calibration', (t) => {
  const db = setup(t);
  const company = createCompany(db, config.defaultTenantId, { name: 'Imported Customer', domain: 'imported-customer.example' });
  const imported = recordOutcome(db, config.defaultTenantId, company.id, {
    outcome_type: 'won', amount: 9_500, occurred_at: '2020-01-01T00:00:00.000Z',
    metadata: { score_provenance: { basis: 'historical_snapshot', calibration_eligible: true, snapshot_id: 'forged' } }
  });
  assert.equal(imported.metadata.score_provenance.basis, 'unavailable_historical');
  assert.equal(imported.metadata.score_provenance.calibration_eligible, false);
  addSnapshot(db, company.id, 30, '2020-01-01T00:00:00.000Z');
  recordOutcome(db, config.defaultTenantId, company.id, { outcome_type: 'meeting' });
  const analytics = outcomeAnalytics(db, config.defaultTenantId);
  assert.equal(analytics.totals.find((row) => row.outcome_type === 'won').amount, 9_500);
  assert.equal(analytics.calibration.summary.labeled_accounts, 0);
  assert.match(analytics.calibration.summary.cohort_note, /1 account excluded/);
  assert.equal(analyticsInsights(db, config.defaultTenantId).base_rate.labeled, 0);
});

test('legacy backfills with today\'s score are excluded unless that value matches the latest pre-event snapshot', (t) => {
  const db = setup(t);
  const bad = createCompany(db, config.defaultTenantId, { name: 'Legacy Lookahead', domain: 'lookahead.example' });
  const good = createCompany(db, config.defaultTenantId, { name: 'Legacy Historic Score', domain: 'historic-score.example' });
  for (const company of [bad, good]) {
    addSnapshot(db, company.id, 20, '2020-01-01T00:00:00.000Z', `early-${company.id}`);
    addSnapshot(db, company.id, 35, '2020-01-15T00:00:00.000Z', `latest-${company.id}`);
    db.run(`INSERT INTO outcomes(id,tenant_id,company_id,outcome_type,score_at_outcome,amount,metadata_json,occurred_at,created_at)
      VALUES (?,?,?,'won',?,1000,'{}','2020-02-01T00:00:00.000Z','2021-01-01T00:00:00.000Z')`,
    [`legacy-${company.id}`, config.defaultTenantId, company.id, company.id === good.id ? 35 : 80]);
  }
  const analytics = outcomeAnalytics(db, config.defaultTenantId);
  assert.equal(analytics.totals.find((row) => row.outcome_type === 'won').amount, 2_000);
  assert.equal(analytics.calibration.summary.labeled_accounts, 1);
  assert.equal(analytics.calibration.score_bands.find((row) => row.score_band === 'watch').qualified, 1);
  assert.equal(analytics.score_bands.some((row) => row.score_band === 'hot'), false);
  assert.equal(analyticsInsights(db, config.defaultTenantId).base_rate.labeled, 1);
});

test('backfilled negative outcomes do not undo a newer manual stage or remove its current recommendation', (t) => {
  const db = setup(t);
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Active Pipeline', domain: 'active-pipeline.example' }, source: 'first_party', type: 'web_intent',
    title: 'Direct inquiry', attributes: { demo_requested: true }
  });
  updateCompany(db, config.defaultTenantId, result.company.id, { status: 'meeting' });
  assert.ok(db.get('SELECT id FROM recommendations WHERE company_id=?', [result.company.id]));
  recordOutcome(db, config.defaultTenantId, result.company.id, { outcome_type: 'lost', occurred_at: '2020-01-01T00:00:00.000Z' });
  assert.equal(db.get('SELECT status FROM companies WHERE id=?', [result.company.id]).status, 'meeting');
  assert.ok(db.get('SELECT id FROM recommendations WHERE company_id=?', [result.company.id]));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './helpers/database.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { config } from '../src/config.js';
import { ingestOne } from '../src/services/ingestion.js';
import { rescoreCompany } from '../src/services/signals.js';

const day = 86_400_000;

function setup(t) {
  const db = openTestDatabase();
  t.after(() => db.close());
  bootstrap(db);
  return db;
}

function launch(db, overrides = {}) {
  return ingestOne(db, config.defaultTenantId, {
    company: { name: 'Evidence Controls', domain: 'evidence-controls.example' },
    source: 'company_news', type: 'product_launch', title: 'Company launches a product',
    observed_at: new Date().toISOString(), confidence: 0.72,
    attributes: { is_new: true }, ...overrides
  });
}

function signal(db, companyId) {
  return db.get("SELECT * FROM signals WHERE company_id=? AND signal_key='product_launch'", [companyId]);
}

test('source confidence and strength age out relative to the scoring date without new ingestion', (t) => {
  const db = setup(t);
  const now = Date.now();
  const first = launch(db, {
    source: 'primary', external_id: 'old-report', url: 'https://primary.example/launch',
    observed_at: new Date(now - 59 * day).toISOString(), confidence: 0.95,
    attributes: { is_new: true, strength: 1.5 }
  });
  launch(db, {
    source: 'secondary', external_id: 'recent-report', url: 'https://secondary.example/launch',
    observed_at: new Date(now).toISOString(), confidence: 0.55,
    attributes: { is_new: true, strength: 0.5 }
  });
  const before = signal(db, first.company.id);
  assert.equal(before.evidence_count, 2);
  assert.equal(before.source_count, 2);
  assert.equal(before.strength, 1.5);

  rescoreCompany(db, config.defaultTenantId, first.company.id, new Date(now + 2 * day).toISOString());
  const after = signal(db, first.company.id);
  assert.equal(after.status, 'active');
  assert.equal(after.evidence_count, 1);
  assert.equal(after.source_count, 1);
  assert.equal(after.confidence, 0.55);
  assert.equal(after.strength, 0.5);
  assert.ok(after.contribution < before.contribution / 2);
  assert.equal(db.get('SELECT COUNT(*) count FROM signal_evidence').count, 2, 'aging preserves audit lineage');
});

test('expiration clears current evidence counts as well as score contribution', (t) => {
  const db = setup(t);
  const now = Date.now();
  const result = launch(db, { observed_at: new Date(now).toISOString() });
  rescoreCompany(db, config.defaultTenantId, result.company.id, new Date(now + 61 * day).toISOString());
  const expired = signal(db, result.company.id);
  assert.equal(expired.status, 'expired');
  assert.equal(expired.evidence_count, 0);
  assert.equal(expired.source_count, 0);
  assert.equal(expired.contribution, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM observations').count, 1);
});

test('evidence ahead of the scoring date becomes eligible when its event time arrives', (t) => {
  const db = setup(t);
  const observed = new Date(Date.now() + 60_000).toISOString();
  const result = launch(db, { observed_at: observed, retrieved_at: observed });
  assert.equal(signal(db, result.company.id).evidence_count, 0);
  rescoreCompany(db, config.defaultTenantId, result.company.id, observed);
  const current = signal(db, result.company.id);
  assert.equal(current.status, 'active');
  assert.equal(current.evidence_count, 1);
  assert.equal(current.confidence, 0.72);
  assert.ok(current.contribution > 0);
});

test('one article syndicated through multiple connectors cannot increase corroboration', (t) => {
  const db = setup(t);
  const observed = new Date(Date.now() - 1_000).toISOString();
  const result = launch(db, {
    source: 'gdelt', external_id: 'gdelt-copy', observed_at: observed,
    url: 'http://www.publisher.example/launch?edition=us&utm_source=gdelt#story'
  });
  const before = signal(db, result.company.id);
  launch(db, {
    source: 'newsapi', external_id: 'newsapi-copy', observed_at: observed,
    url: 'https://publisher.example/launch?utm_medium=feed&edition=us&fbclid=tracking'
  });
  launch(db, {
    source: 'gdelt', external_id: 'another-copy', observed_at: observed,
    url: 'https://publisher.example/launch?edition=us'
  });
  const after = signal(db, result.company.id);
  assert.equal(after.evidence_count, 1);
  assert.equal(after.source_count, 1);
  assert.equal(after.confidence, before.confidence);
  assert.equal(after.strength, before.strength);
  assert.equal(after.contribution, before.contribution);
  assert.equal(db.get('SELECT COUNT(*) count FROM observations').count, 3);
  assert.equal(db.get('SELECT COUNT(*) count FROM signal_evidence').count, 3);
});

test('two articles from one publisher do not become independent sources through separate transports', (t) => {
  const db = setup(t);
  const result = launch(db, { source: 'gdelt', external_id: 'story-one', url: 'https://press.example/story?id=1' });
  launch(db, { source: 'newsapi', external_id: 'story-two', url: 'https://www.press.example/story?id=2' });
  const current = signal(db, result.company.id);
  assert.equal(current.evidence_count, 2, 'content-identifying query parameters must not be discarded');
  assert.equal(current.source_count, 1);
  assert.equal(current.confidence, 0.72);
});

test('independent publishers collected by one transport can corroborate an event', (t) => {
  const db = setup(t);
  const result = launch(db, { source: 'newsapi', external_id: 'publisher-one', url: 'https://first.example/launch' });
  launch(db, { source: 'newsapi', external_id: 'publisher-two', url: 'https://second.example/launch' });
  const current = signal(db, result.company.id);
  assert.equal(current.evidence_count, 2);
  assert.equal(current.source_count, 2);
  assert.ok(current.confidence > 0.72);
});

test('evidence without a URL retains connector provenance and repeated records cannot create another source', (t) => {
  const db = setup(t);
  const result = launch(db, { source: 'official_feed', external_id: 'one' });
  launch(db, { source: 'official_feed', external_id: 'two' });
  assert.equal(signal(db, result.company.id).source_count, 1);
  launch(db, { source: 'trade_feed', external_id: 'three' });
  assert.equal(signal(db, result.company.id).source_count, 2);
});

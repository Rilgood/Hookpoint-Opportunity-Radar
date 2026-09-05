import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './helpers/database.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { config } from '../src/config.js';
import { ingestOne } from '../src/services/ingestion.js';
import { detectSignals, rescoreCompany } from '../src/services/signals.js';
import { scoringConfig } from '../src/services/catalog.js';
import { resolveCompany, updateCompany } from '../src/services/entities.js';

const day = 86_400_000;

function setup(t) {
  const db = openTestDatabase();
  t.after(() => db.close());
  bootstrap(db);
  return db;
}

function adSnapshot(db, daysAgo, count, externalId, attributes = {}) {
  return ingestOne(db, config.defaultTenantId, {
    company: { name: 'Chronology Controls', domain: 'chronology.example' },
    source: 'meta_ad_library', type: 'ad_snapshot', title: 'Account ad snapshot', external_id: externalId,
    observed_at: new Date(Date.now() - daysAgo * day).toISOString(),
    attributes: { metric_scope: 'account_snapshot', active_ads: count, ...attributes }
  });
}

function storedAttributes(db, externalId) {
  return JSON.parse(db.get('SELECT attributes_json FROM observations WHERE external_id=?', [externalId]).attributes_json);
}

test('a backfilled ad snapshot cannot compare itself to a later observation', (t) => {
  const db = setup(t);
  adSnapshot(db, 1, 10, 'newer');
  const backfill = adSnapshot(db, 3, 100, 'older');
  const attributes = storedAttributes(db, 'older');
  assert.equal(attributes.previous_active_ads, undefined);
  assert.equal(attributes.active_ads_delta_pct, undefined);
  assert.equal(backfill.signals.includes('ad_volume_spike'), false);
});

test('a backfilled ad snapshot uses its nearest preceding baseline and preserves reported deltas', (t) => {
  const db = setup(t);
  adSnapshot(db, 4, 20, 'baseline');
  adSnapshot(db, 1, 10, 'newest');
  adSnapshot(db, 2, 40, 'between');
  assert.equal(storedAttributes(db, 'between').previous_active_ads, 20);
  assert.equal(storedAttributes(db, 'between').active_ads_delta_pct, 100);
  adSnapshot(db, 1.5, 80, 'reported', { previous_active_ads: 75, active_ads_delta_pct: 6.7, is_new_advertiser: false });
  assert.equal(storedAttributes(db, 'reported').previous_active_ads, 75);
  assert.equal(storedAttributes(db, 'reported').active_ads_delta_pct, 6.7);
});

test('a single marketing vacancy is not a hiring surge, while an explicit opening count still qualifies', () => {
  for (const openings of [undefined, null, 0, 1, 2]) {
    const signals = detectSignals({ type: 'job_posting', title: 'Performance marketing manager', attributes: { role: 'performance marketing', marketing_openings_30d: openings } });
    assert.equal(signals.some(({ key }) => key === 'marketing_hiring_surge'), false, `openings=${openings}`);
  }
  const signals = detectSignals({ type: 'hiring_metric', attributes: { marketing_openings_30d: 3 } });
  assert.equal(signals.some(({ key }) => key === 'marketing_hiring_surge'), true);
});

test('partnership descriptions, unrelated RFPs, negation and hypothetical advice do not assert buying intent', () => {
  const negatives = [
    'Our longstanding agency partner will continue to support us.',
    'Meet our creative partner and marketing consultant.',
    'A request for proposal for office cleaning has been published.',
    'We are not seeking an agency at this time.',
    'We are not\nlooking for an agency at this time.',
    'We are no longer looking for an agency.',
    'We aren’t looking for a marketing agency.',
    'We do not plan on seeking a creative partner.',
    'We have no need for a creative request for proposal.',
    'If you are looking for an agency, consider these tips.',
    'We are deciding whether we should be seeking an agency.'
  ];
  for (const body of negatives) {
    assert.equal(detectSignals({ type: 'news', body, attributes: {} }).some(({ key }) => key === 'agency_search'), false, body);
  }
});

test('explicit search requests qualify and structured agency intent remains authoritative', () => {
  for (const body of [
    'We are seeking an agency to lead our next campaign.',
    'We are looking for a creative partner for our launch.',
    'We are not hiring internally, but we are looking for an agency.',
    'The team is issuing a marketing request for proposal.',
    'We are seeking\n an agency for paid media.'
  ]) {
    assert.equal(detectSignals({ type: 'news', body, attributes: {} }).some(({ key }) => key === 'agency_search'), true, body);
  }
  const verified = detectSignals({ type: 'rfp', body: 'Earlier this year we were not seeking an agency.', attributes: { explicit_agency_search: true } });
  assert.equal(verified.some(({ key }) => key === 'agency_search'), true);
});

test('creative repetition remains a review hypothesis rather than a claim of proven fatigue', (t) => {
  const db = setup(t);
  const result = adSnapshot(db, 0, 20, 'creative', { median_creative_age_days: 40, duplicate_creative_ratio: 0.7 });
  assert.ok(result.signals.includes('creative_fatigue'));
  db.run("UPDATE signals SET label='Creative fatigue', metadata_json='{}' WHERE company_id=?", [result.company.id]);
  rescoreCompany(db, config.defaultTenantId, result.company.id);
  const signal = db.get("SELECT * FROM signals WHERE company_id=? AND signal_key='creative_fatigue'", [result.company.id]);
  assert.equal(signal.label, 'Creative refresh hypothesis');
  assert.match(signal.summary, /^Creative refresh hypothesis/);
  assert.match(JSON.parse(signal.metadata_json).description, /do not establish fatigue/);
  const recommendation = db.get('SELECT outreach_angle FROM recommendations WHERE company_id=?', [result.company.id]);
  assert.match(recommendation.outreach_angle, /performance data/);
});

test('rescoring retires linked evidence that no longer meets the current intent rules while retaining lineage', (t) => {
  const db = setup(t);
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Legacy Intent', domain: 'legacy-intent.example' }, source: 'official_feed', type: 'rfp',
    title: 'Agency relationship update', observed_at: new Date().toISOString(), attributes: { explicit_agency_search: true }
  });
  // Model a previously accepted generic phrase stored before rules-1.2.
  db.run("UPDATE observations SET attributes_json='{}', body='Our agency partner renewed the agreement.' WHERE company_id=?", [result.company.id]);
  rescoreCompany(db, config.defaultTenantId, result.company.id);
  const signal = db.get("SELECT * FROM signals WHERE company_id=? AND signal_key='agency_search'", [result.company.id]);
  assert.equal(signal.status, 'expired');
  assert.equal(signal.evidence_count, 0);
  assert.equal(signal.contribution, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM signal_evidence').count, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM recommendations WHERE company_id=?', [result.company.id]).count, 0);
});

test('a model-version change is recorded even when the numeric score is unchanged', (t) => {
  const db = setup(t);
  const result = adSnapshot(db, 0, 10, 'no-trigger');
  const before = db.get('SELECT COUNT(*) count FROM score_snapshots WHERE company_id=?', [result.company.id]).count;
  db.run("UPDATE companies SET score_version='rules-1.1' WHERE id=?", [result.company.id]);
  rescoreCompany(db, config.defaultTenantId, result.company.id);
  assert.equal(db.get('SELECT COUNT(*) count FROM score_snapshots WHERE company_id=?', [result.company.id]).count, before + 1);
  assert.equal(db.get('SELECT score_version FROM companies WHERE id=?', [result.company.id]).score_version, scoringConfig.version);
});

test('repeated name and country evidence stays below activation confidence until stronger identity is supplied', (t) => {
  const db = setup(t);
  const identity = { name: 'Common Studio', country: 'US' };
  const first = resolveCompany(db, config.defaultTenantId, identity, 'registry_a');
  const repeated = resolveCompany(db, config.defaultTenantId, identity, 'registry_a');
  assert.equal(repeated.id, first.id);
  assert.ok(repeated.identity_confidence < 0.8);
  assert.equal(repeated.identity_method, 'source_name_exact');
  const otherSource = resolveCompany(db, config.defaultTenantId, { ...identity, industry: 'Other business' }, 'registry_b');
  assert.notEqual(otherSource.id, first.id);
  assert.ok(otherSource.identity_confidence < 0.8);
  assert.equal(db.get('SELECT industry FROM companies WHERE id=?', [first.id]).industry, 'Unknown');
  const confirmed = updateCompany(db, config.defaultTenantId, first.id, { domain: 'verified-studio.example' });
  assert.ok(confirmed.identity_confidence >= 0.8);
});

test('a real city or state match can corroborate identity while placeholder locations cannot', (t) => {
  const db = setup(t);
  for (const location of [{ city: 'Brooklyn', state: 'NY' }, { state: 'Oregon' }]) {
    const name = `Local Studio ${location.city || location.state}`;
    const identity = { name, country: 'US', ...location };
    const first = resolveCompany(db, config.defaultTenantId, identity, 'registry_a');
    const corroborated = resolveCompany(db, config.defaultTenantId, identity, 'registry_b');
    assert.equal(corroborated.id, first.id);
    assert.equal(corroborated.identity_method, 'name_location');
    assert.ok(corroborated.identity_confidence >= 0.8);
  }
  const placeholder = { name: 'Placeholder Studio', country: 'US', city: 'Unknown' };
  const first = resolveCompany(db, config.defaultTenantId, placeholder, 'registry_a');
  const repeat = resolveCompany(db, config.defaultTenantId, placeholder, 'registry_a');
  assert.equal(repeat.id, first.id);
  assert.ok(repeat.identity_confidence < 0.8);
});

test('a same-name fallback cannot attach another company with conflicting authoritative identity or location', (t) => {
  const db = setup(t);
  const first = resolveCompany(db, config.defaultTenantId, { name: 'Shared Name', domain: 'first-company.example', city: 'Austin', country: 'US' }, 'registry');
  const otherDomain = resolveCompany(db, config.defaultTenantId, { name: 'Shared Name', domain: 'second-company.example', city: 'Austin', country: 'US' }, 'registry');
  assert.notEqual(otherDomain.id, first.id);
  const otherLocation = resolveCompany(db, config.defaultTenantId, { name: 'Shared Name', city: 'Toronto', country: 'CA' }, 'registry');
  assert.notEqual(otherLocation.id, first.id);
  assert.notEqual(otherLocation.id, otherDomain.id);
  const unchanged = db.get('SELECT domain, city, country FROM companies WHERE id=?', [first.id]);
  assert.deepEqual(unchanged, { domain: 'first-company.example', city: 'Austin', country: 'US' });
});

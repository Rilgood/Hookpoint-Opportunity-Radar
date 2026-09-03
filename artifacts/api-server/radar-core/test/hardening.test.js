import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { config } from '../src/config.js';
import { ingestBatch, ingestOne } from '../src/services/ingestion.js';
import { companyDetail, exportCompaniesCsv, ingestionRejections } from '../src/services/queries.js';
import { deleteCompany, updateCompany } from '../src/services/entities.js';
import { setConnectorEnabled } from '../src/services/connector-runner.js';
import { recordOutcome } from '../src/services/outcomes.js';
import { rescoreCompany, rescoreDueCompanies } from '../src/services/signals.js';
import { consumeWebhookReceipt } from '../src/services/webhooks.js';
import { BaseConnector } from '../src/connectors/base.js';
import { authenticate, setTrustedPrincipal } from '../src/http/security.js';
import { sha256 } from '../src/lib.js';

function setup() { const db = openDatabase(':memory:'); bootstrap(db); return db; }

test('derives a private tenant only from the trusted Clerk principal', () => {
  const db = setup();
  const req = { headers: { 'x-tenant-id': config.defaultTenantId, 'x-role': 'owner' } };
  setTrustedPrincipal(req, { userId: 'user_clerk_verified' });
  const auth = authenticate(db, req);
  assert.equal(auth.tenantId, 'user_clerk_verified');
  assert.equal(auth.actor, 'clerk:user_clerk_verified');
  assert.deepEqual(auth.scopes, ['read', 'write', 'admin']);
  assert.equal(db.get('SELECT name FROM tenants WHERE id=?', [auth.tenantId]).name, 'Private workspace');
  db.close();
});

test('ignores spoofed tenant and role headers without a trusted principal', () => {
  const db = setup();
  const auth = authenticate(db, {
    headers: { 'x-tenant-id': 'user_other_person', 'x-role': 'admin' },
    socket: {},
  });
  assert.equal(auth.tenantId, config.defaultTenantId);
  assert.equal(db.get('SELECT id FROM tenants WHERE id=?', ['user_other_person']), undefined);
  db.close();
});

test('authenticates a direct API key through the existing core path', () => {
  const db = setup();
  const token = 'hp_live_direct_client_regression';
  db.run(
    `INSERT INTO api_keys(id, tenant_id, name, key_prefix, key_hash, scopes, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ['key_direct_regression', config.defaultTenantId, 'Direct regression client', token.slice(0, 16), sha256(token), 'read,write', new Date().toISOString()]
  );
  const auth = authenticate(db, {
    headers: { 'x-api-key': token, 'x-tenant-id': 'user_spoofed', 'x-role': 'admin' },
  });
  assert.equal(auth.authType, 'apiKey');
  assert.equal(auth.tenantId, config.defaultTenantId);
  assert.deepEqual(auth.scopes, ['read', 'write']);
  db.close();
});

test('starts with an empty company dataset and no runtime sample connector', () => {
  const db = setup();
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 0);
  assert.equal(db.get("SELECT COUNT(*) count FROM connectors WHERE connector_key='demo'").count, 0);
  db.close();
});

test('preserves the canonical domain when an old domain alias reappears', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Identity Systems', domain: 'identity-old.test' }, source: 'registry', external_id: 'one',
    type: 'news', title: 'Company profile created', observed_at: new Date().toISOString()
  });
  updateCompany(db, config.defaultTenantId, first.company.id, { domain: 'identity-new.test' });
  const second = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Identity Systems', domain: 'identity-old.test' }, source: 'archive', external_id: 'two',
    type: 'news', title: 'Archived company mention', observed_at: new Date().toISOString()
  });
  assert.equal(second.company.id, first.company.id);
  assert.equal(second.company.domain, 'identity-new.test');
  db.close();
});

test('provider enrichment cannot overwrite an established canonical company name or workflow state', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Canonical Brand', domain: 'canonical.test' }, source: 'registry', type: 'news', title: 'Initial record', observed_at: new Date().toISOString()
  });
  updateCompany(db, config.defaultTenantId, first.company.id, { status: 'accepted', owner_name: 'Account Owner' });
  const second = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Canonical Brand - Social Page', domain: 'canonical.test', status: 'customer', owner_name: 'Provider Value' },
    source: 'social_platform', external_id: 'profile-2', type: 'social_metric', title: 'Profile metric', observed_at: new Date().toISOString(), attributes: {}
  });
  assert.equal(second.company.name, 'Canonical Brand');
  assert.equal(second.company.status, 'accepted');
  assert.equal(second.company.owner_name, 'Account Owner');
  db.close();
});

test('does not merge name-only identities across unrelated sources', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Common Market' }, source: 'registry_a', external_id: 'a-1', type: 'news',
    title: 'First source mention', observed_at: new Date().toISOString()
  });
  const second = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Common Market' }, source: 'registry_b', external_id: 'b-1', type: 'news',
    title: 'Second source mention', observed_at: new Date().toISOString()
  });
  const repeat = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Common Market' }, source: 'registry_a', external_id: 'a-2', type: 'news',
    title: 'First source follow-up', observed_at: new Date().toISOString()
  });
  assert.notEqual(first.company.id, second.company.id);
  assert.equal(first.company.id, repeat.company.id);
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 2);
  db.close();
});

test('preserves non-Latin company names during identity normalization', () => {
  const db = setup();
  const first = ingestOne(db, config.defaultTenantId, { company: { name: '株式会社ひかり' }, source: 'jp_registry', external_id: 'jp-1', type: 'news', title: '会社情報' });
  const second = ingestOne(db, config.defaultTenantId, { company: { name: '北京创新科技' }, source: 'cn_registry', external_id: 'cn-1', type: 'news', title: '公司更新' });
  assert.notEqual(first.company.normalized_name, '');
  assert.notEqual(second.company.normalized_name, '');
  assert.notEqual(first.company.normalized_name, second.company.normalized_name);
  db.close();
});

test('caps an ambiguous high-scoring identity until an operator adds an authoritative identifier', () => {
  const db = setup();
  const company = { name: 'Ambiguous Opportunity' };
  const result = ingestBatch(db, config.defaultTenantId, [
    { company, source: 'combined_feed', external_id: 'identity-1', type: 'web_intent', title: 'High intent', attributes: { intent_score: 95 } },
    { company, source: 'combined_feed', external_id: 'identity-2', type: 'creative_metric', title: 'Creative fatigue', attributes: { duplicate_creative_ratio: 0.9 } },
    { company, source: 'combined_feed', external_id: 'identity-3', type: 'product_launch', title: 'New launch', attributes: { is_new: true } }
  ]);
  const companyId = result.companies[0];
  let detail = companyDetail(db, config.defaultTenantId, companyId);
  assert.ok(detail.company.opportunity_score >= 48);
  assert.equal(detail.company.opportunity_tier, 'watch');
  assert.equal(detail.recommendation.offer, 'Identity verification required');
  updateCompany(db, config.defaultTenantId, companyId, { domain: 'ambiguous-opportunity.test' });
  rescoreCompany(db, config.defaultTenantId, companyId);
  detail = companyDetail(db, config.defaultTenantId, companyId);
  assert.ok(detail.company.identity_confidence >= 0.98);
  assert.ok(['warm','hot'].includes(detail.company.opportunity_tier));
  assert.notEqual(detail.recommendation.offer, 'Identity verification required');
  db.close();
});

test('rejects future evidence and records non-sensitive rejection telemetry', () => {
  const db = setup();
  const result = ingestBatch(db, config.defaultTenantId, [{
    company: { name: 'Future Signal', domain: 'future.test' }, source: 'provider', type: 'news',
    title: 'Impossible future event', observed_at: new Date(Date.now() + 2 * 60 * 60_000).toISOString()
  }]);
  assert.equal(result.rejected, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM ingestion_rejections').count, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 0);
  const ledger = ingestionRejections(db, config.defaultTenantId);
  assert.equal(ledger.total, 1);
  assert.equal(ledger.data[0].error_code, 'future_observed_at');
  db.close();
});

test('does not treat an event in the past as an upcoming event window', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Past Events', domain: 'past-events.test' }, source: 'calendar', type: 'event',
    title: 'Conference ended', observed_at: new Date().toISOString(), attributes: { days_until: -2, is_material: true }
  });
  assert.equal(result.signals.includes('event_window'), false);
  db.close();
});

test('does not coerce null metrics into numeric signal matches', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Null Metrics', domain: 'null-metrics.test' }, source: 'creative_analytics', type: 'creative_metric',
    title: 'Metric unavailable', observed_at: new Date().toISOString(), attributes: { hook_diversity_score: null }
  });
  assert.equal(result.signals.includes('low_hook_diversity'), false);
  db.close();
});

test('derives ad-volume change from successive account snapshots', () => {
  const db = setup();
  const company = { name: 'Snapshot Metrics', domain: 'snapshot-metrics.test' };
  ingestOne(db, config.defaultTenantId, {
    company, source: 'meta_ad_library', external_id: 'snapshot-day-1', type: 'ad_snapshot', title: 'Ten active ads',
    observed_at: '2026-09-01T12:00:00.000Z', attributes: { metric_scope: 'account_snapshot', active_ads: 10 }
  });
  const second = ingestOne(db, config.defaultTenantId, {
    company, source: 'meta_ad_library', external_id: 'snapshot-day-2', type: 'ad_snapshot', title: 'Twenty active ads',
    observed_at: '2026-09-02T12:00:00.000Z', attributes: { metric_scope: 'account_snapshot', active_ads: 20 }
  });
  const stored = db.get("SELECT attributes_json FROM observations WHERE external_id='snapshot-day-2'");
  assert.equal(JSON.parse(stored.attributes_json).previous_active_ads, 10);
  assert.equal(JSON.parse(stored.attributes_json).active_ads_delta_pct, 100);
  assert.equal(second.signals.includes('ad_volume_spike'), true);
  db.close();
});

test('risk suppression replaces any sales recommendation with a human-review hold', () => {
  const db = setup();
  const company = { name: 'Suppression Control', domain: 'suppression.test', industry: 'Technology', employee_count: 100 };
  ingestOne(db, config.defaultTenantId, { company, source: 'crm', type: 'web_intent', title: 'Pricing interest', observed_at: new Date().toISOString(), attributes: { intent_score: 90 } });
  const crisis = ingestOne(db, config.defaultTenantId, { company, source: 'risk_feed', type: 'crisis', title: 'Material data breach', observed_at: new Date().toISOString(), confidence: .95, attributes: { severity: 'critical' } });
  const detail = companyDetail(db, config.defaultTenantId, crisis.company.id);
  assert.equal(detail.company.opportunity_tier, 'suppressed');
  assert.equal(detail.recommendation.offer, 'Outreach paused');
  assert.match(detail.recommendation.outreach_angle, /Do not trigger automated outreach/);
  db.close();
});

test('closed workflow states remove sales recommendations but preserve score history', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Workflow Control', domain: 'workflow.test', industry: 'Retail', employee_count: 75 },
    source: 'crm', type: 'web_intent', title: 'High intent visit', observed_at: new Date().toISOString(), attributes: { intent_score: 95 }
  });
  assert.ok(companyDetail(db, config.defaultTenantId, result.company.id).recommendation);
  assert.ok(db.get('SELECT COUNT(*) count FROM score_snapshots WHERE company_id=?', [result.company.id]).count >= 1);
  recordOutcome(db, config.defaultTenantId, result.company.id, { outcome_type: 'rejected' });
  const detail = companyDetail(db, config.defaultTenantId, result.company.id);
  assert.equal(detail.company.status, 'rejected');
  assert.equal(detail.recommendation, null);
  assert.ok(detail.score_history.length >= 1);
  db.close();
});

test('manual workflow closure removes a sales recommendation immediately', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Manual Closure', domain: 'manual-closure.test' }, source: 'crm', type: 'web_intent',
    title: 'High intent account', attributes: { intent_score: 95 }
  });
  assert.ok(companyDetail(db, config.defaultTenantId, result.company.id).recommendation);
  updateCompany(db, config.defaultTenantId, result.company.id, { status: 'customer' });
  assert.equal(companyDetail(db, config.defaultTenantId, result.company.id).recommendation, null);
  assert.equal(db.get("SELECT COUNT(*) count FROM lead_events WHERE company_id=? AND event_type='workflow_status_changed'", [result.company.id]).count, 1);
  db.close();
});

test('privacy deletion removes a company, its evidence and associated contacts', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Delete Control', domain: 'delete-control.test' }, source: 'crm', external_id: 'delete-1',
    type: 'web_intent', title: 'Known account activity', attributes: { intent_score: 80 },
    people: [{ full_name: 'Delete Me', email: 'delete@example.test', external_id: 'contact-1' }]
  });
  deleteCompany(db, config.defaultTenantId, result.company.id);
  assert.equal(db.get('SELECT COUNT(*) count FROM companies').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM observations').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM people').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM signals').count, 0);
  db.close();
});

test('CSV export neutralizes spreadsheet formulas and includes activation fields', () => {
  const db = setup();
  ingestOne(db, config.defaultTenantId, {
    company: { name: '=DANGEROUS()', domain: 'csv-safety.test' }, source: 'crm', type: 'web_intent',
    title: 'Known account activity', attributes: { intent_score: 80 },
    people: [{ full_name: 'Buyer', title: 'CMO', email: 'buyer@csv-safety.test', is_decision_maker: true }]
  });
  const csv = exportCompaniesCsv(db, config.defaultTenantId);
  assert.match(csv, /recommended_offer/);
  assert.match(csv, /buyer_email/);
  assert.match(csv, /'=DANGEROUS\(\)/);
  db.close();
});

test('refuses credentials inside persisted connector schedule input', () => {
  const db = setup();
  assert.throws(() => setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true, {
    schedule_input: { company: { name: 'Target', domain: 'target.test' }, nested: { api_key: 'must-not-persist' } }
  }), /environment variables/i);
  db.close();
});

test('requires schedule input before enabling a recurring pull connector', () => {
  const db = setup();
  assert.throws(() => setConnectorEnabled(db, config.defaultTenantId, 'gdelt', true), /schedule_input/i);
  db.close();
});

test('expires stale signals when their score refresh becomes due', () => {
  const db = setup();
  const result = ingestOne(db, config.defaultTenantId, {
    company: { name: 'Decay Control', domain: 'decay.test' }, source: 'launch_feed', type: 'product_launch',
    title: 'Launch announced', observed_at: new Date().toISOString(), attributes: { is_new: true }
  });
  db.run("UPDATE signals SET last_seen_at='2024-01-01T00:00:00.000Z', expires_at='2024-03-01T00:00:00.000Z' WHERE company_id=?", [result.company.id]);
  db.run("UPDATE companies SET next_refresh_at='2024-03-02T00:00:00.000Z' WHERE id=?", [result.company.id]);
  const rescored = rescoreDueCompanies(db, config.defaultTenantId, 10);
  assert.equal(rescored.length, 1);
  assert.equal(db.get("SELECT COUNT(*) count FROM signals WHERE company_id=? AND status='active'", [result.company.id]).count, 0);
  assert.equal(companyDetail(db, config.defaultTenantId, result.company.id).recommendation, null);
  db.close();
});

test('rejects a replayed webhook receipt', () => {
  const db = setup();
  const receipt = { signatureHash: 'a'.repeat(64) };
  consumeWebhookReceipt(db, config.defaultTenantId, receipt);
  assert.throws(() => consumeWebhookReceipt(db, config.defaultTenantId, receipt), /already been processed/i);
  db.close();
});

test('fails a connector run when the provider payload has no item array', async () => {
  class InvalidPayloadConnector extends BaseConnector {
    validateConfiguration() { return true; }
    async collect() { return { unexpected: true }; }
  }
  const connector = new InvalidPayloadConnector({ label: 'Invalid provider' });
  await assert.rejects(() => connector.run({}), /did not return an item array/i);
});

test('preserves provider cursor and usage metadata from a bounded connector result', async () => {
  class CursorConnector extends BaseConnector {
    validateConfiguration() { return true; }
    async collect() { return { items: [{ id: 'one' }], cursor: { page: 2 }, usage: { records: 1 } }; }
    normalize(item) {
      return { source: 'cursor_test', external_id: item.id, type: 'news', title: 'Cursor fixture', company: { name: 'Cursor Fixture' } };
    }
  }
  const result = await new CursorConnector({ label: 'Cursor provider' }).run({});
  assert.deepEqual(result.cursor, { page: 2 });
  assert.deepEqual(result.usage, { records: 1 });
  assert.equal(result.records.length, 1);
});

test('redacts credentials from connector normalization errors', async () => {
  class SecretErrorConnector extends BaseConnector {
    validateConfiguration() { return true; }
    async collect() { return [{ id: 'one' }]; }
    normalize() { throw new Error('authorization=Bearer super-secret-token'); }
  }
  const result = await new SecretErrorConnector({ label: 'Secret error provider' }).run({});
  assert.doesNotMatch(result.normalizationErrors[0].message, /super-secret-token/);
  assert.match(result.normalizationErrors[0].message, /REDACTED/);
});

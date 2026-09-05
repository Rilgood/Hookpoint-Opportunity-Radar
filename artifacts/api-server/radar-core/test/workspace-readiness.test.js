import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './helpers/database.js';
import { bootstrap, syncConnectorCatalog } from '../src/services/bootstrap.js';
import { config } from '../src/config.js';
import { workspaceReadiness } from '../src/services/workspace-readiness.js';
import { createCompany } from '../src/services/entities.js';
import { createWorkItem, updateWorkItem } from '../src/services/work-items.js';
import { reviewEvidence } from '../src/services/evidence-reviews.js';
import { ingestOne } from '../src/services/ingestion.js';
import { googleSheetsTenantBindingKey } from '../src/connectors/google-sheets.js';

const tenant = config.defaultTenantId;
const other = 'readiness-other';
function setup(t) {
  const db = openTestDatabase();
  t.after(() => db.close());
  bootstrap(db);
  const now = new Date().toISOString();
  db.run('INSERT INTO tenants(id,name,slug,created_at,updated_at) VALUES (?,?,?,?,?)', [other, 'Other workspace', other, now, now]);
  syncConnectorCatalog(db, other);
  return db;
}
function step(result, key) { return result.steps.find((item) => item.key === key); }

test('readiness is read-only and public connector prerequisites do not invent collected evidence or verification', (t) => {
  const db = setup(t);
  const before = JSON.stringify(db.all('SELECT * FROM connectors ORDER BY id'));
  const result = workspaceReadiness(db, tenant);
  assert.ok(result.steps.every((item) => !item.complete && item.value === 0));
  assert.equal(result.counts.assigned_work, 0);
  assert.equal(result.counts.reviewed_evidence, 0);
  const publicSource = result.sources.find((source) => source.key === 'gdelt');
  assert.equal(publicSource.configured, true, 'GDELT needs no API key');
  assert.equal(publicSource.enabled, false);
  assert.equal(publicSource.latest_run, null, 'configuration alone is not a successful collection');
  assert.equal(JSON.stringify(db.all('SELECT * FROM connectors ORDER BY id')), before);
  assert.equal(db.get('SELECT COUNT(*) count FROM work_items').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM evidence_reviews').count, 0);
});

test('readiness respects workspace-specific Sheets binding and never returns configured secret values', (t) => {
  const previous = process.env.GOOGLE_SHEETS_TENANT_BINDINGS;
  const secret = process.env.NEWS_API_KEY;
  t.after(() => {
    if (previous === undefined) delete process.env.GOOGLE_SHEETS_TENANT_BINDINGS; else process.env.GOOGLE_SHEETS_TENANT_BINDINGS = previous;
    if (secret === undefined) delete process.env.NEWS_API_KEY; else process.env.NEWS_API_KEY = secret;
  });
  process.env.GOOGLE_SHEETS_TENANT_BINDINGS = JSON.stringify({ [googleSheetsTenantBindingKey(other)]: ['readiness_example_sheet_id_1234567890'] });
  process.env.NEWS_API_KEY = 'readiness-secret-value-must-not-appear';
  const db = setup(t);
  const result = workspaceReadiness(db, tenant);
  assert.equal(result.sources.find((source) => source.key === 'google_sheets').configured, false);
  assert.equal(workspaceReadiness(db, other).sources.find((source) => source.key === 'google_sheets').configured, true);
  assert.equal(result.sources.find((source) => source.key === 'newsapi').configured, true);
  assert.ok(!JSON.stringify(result).includes(process.env.NEWS_API_KEY));
  assert.ok(!JSON.stringify(result).includes('readiness_example_sheet_id_1234567890'));
});

test('readiness counts only completed review decisions and assigned dated work, with tenant isolation', (t) => {
  const db = setup(t);
  const company = createCompany(db, tenant, { name: 'Readiness Account', domain: 'readiness-account.example' });
  ingestOne(db, tenant, { company: { name: company.name, domain: company.domain }, source: 'readiness', type: 'news', title: 'Account event', observed_at: new Date().toISOString() });
  const observation = db.get('SELECT id FROM observations WHERE company_id=?', [company.id]);
  const task = createWorkItem(db, tenant, { company_id: company.id, title: 'Readiness follow-up' });
  reviewEvidence(db, tenant, company.id, { observation_id: observation.id, status: 'needs_review', note: 'Relevance still uncertain.' });
  let result = workspaceReadiness(db, tenant);
  assert.equal(result.counts.work_items, 1);
  assert.equal(result.counts.reviewed_evidence, 0);
  assert.equal(step(result, 'review').complete, false);
  assert.equal(step(result, 'act').complete, false);
  updateWorkItem(db, tenant, task.id, { owner_name: 'Alex' });
  assert.equal(step(workspaceReadiness(db, tenant), 'act').complete, false, 'owner without a due date is not a dated plan');
  updateWorkItem(db, tenant, task.id, { due_at: '2030-01-01T09:00:00Z' });
  reviewEvidence(db, tenant, company.id, { observation_id: observation.id, status: 'rejected', note: 'Checked and found unrelated.' });
  result = workspaceReadiness(db, tenant);
  assert.equal(result.counts.assigned_work, 1);
  assert.equal(result.counts.reviewed_evidence, 1);
  assert.equal(step(result, 'review').complete, true);
  assert.equal(step(result, 'act').complete, true);
  const isolated = workspaceReadiness(db, other);
  assert.ok(isolated.steps.every((item) => !item.complete));
  assert.equal(isolated.counts.companies, 0);
});

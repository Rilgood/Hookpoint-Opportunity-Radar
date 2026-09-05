import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { openTestDatabase } from './helpers/database.js';
import { openDatabase } from '../src/db/index.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { config } from '../src/config.js';
import { createCompany, deleteCompany, mergeCompanies, updateCompany } from '../src/services/entities.js';
import { createWorkItem, getWorkItem, listWorkItems, updateWorkItem } from '../src/services/work-items.js';
import { listEvidenceReviews, reviewEvidence } from '../src/services/evidence-reviews.js';
import { ingestOne } from '../src/services/ingestion.js';
import { rescoreCompany } from '../src/services/signals.js';
import { companyDetail } from '../src/services/queries.js';
import { companyInsights, analyticsInsights } from '../src/services/insights.js';
import { recordOutcome, outcomeAnalytics } from '../src/services/outcomes.js';
import { Router } from '../src/http/router.js';
import { registerWorkflowRoutes } from '../src/services/workflow-routes.js';
import { createApp } from '../src/app.js';
import { setTrustedPrincipal } from '../src/http/security.js';

const tenant = config.defaultTenantId;
const otherTenant = 'workflow_other_tenant';
const now = '2026-03-08T06:30:00.000Z';
const day = 86_400_000;

function setup(t) {
  t.mock.timers.enable({ apis: ['Date'], now: new Date(now) });
  const db = openTestDatabase();
  t.after(() => db.close());
  bootstrap(db);
  db.run('INSERT INTO tenants(id, name, slug, created_at, updated_at) VALUES (?, ?, ?, ?, ?)', [otherTenant, 'Other team', 'workflow-other', now, now]);
  const company = createCompany(db, tenant, { name: 'Harbor Retail', domain: 'harbor-workflow.example', owner_name: 'Alex' });
  const otherCompany = createCompany(db, otherTenant, { name: 'Other Retail', domain: 'harbor-workflow.example' });
  return { db, company, otherCompany };
}
function task(db, company, extra = {}) {
  return createWorkItem(db, tenant, { company_id: company.id, title: 'Review the launch evidence', ...extra }, 'sales@example.test', 'request-create');
}
function launch(db, company, extra = {}) {
  return ingestOne(db, tenant, { company: { name: company.name, domain: company.domain }, source: 'press', type: 'product_launch',
    title: 'New product launch', observed_at: new Date().toISOString(), confidence: .8, attributes: { is_new: true }, ...extra });
}

test('empty work/review reads never create work and counts remain authoritative across pages and tenants', (t) => {
  const { db, company, otherCompany } = setup(t);
  assert.equal(listWorkItems(db, tenant).total, 0);
  assert.equal(listEvidenceReviews(db, tenant, company.id).total, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM work_items').count, 0);
  task(db, company, { title: 'Review 50%_ offer', due_at: '2026-03-08T08:00:00Z' });
  task(db, company, { title: 'Review 50%_ positioning', due_at: '2026-03-08T09:00:00Z' });
  task(db, company, { title: 'Review 500X decoy', owner_name: 'Morgan' });
  createWorkItem(db, otherTenant, { company_id: otherCompany.id, title: 'Review 50%_ secret' }, 'other-actor');
  const results = listWorkItems(db, tenant, { q: '50%_', owner_name: 'alex', limit: '1', offset: '1' });
  assert.equal(results.data.length, 1);
  assert.equal(results.total, 2);
  assert.equal(results.counts.all, 2);
  assert.equal(results.counts.open, 2);
  assert.equal(results.data[0].company_id, company.id);
  assert.equal(results.as_of, now);
  assert.equal(results.time_zone, 'UTC');
});

test('daily queue uses local DST boundaries, excludes snoozed work and wakes it when due', (t) => {
  const { db, company } = setup(t);
  task(db, company, { title: 'Before local midnight', due_at: '2026-03-08T04:59:59Z' });
  task(db, company, { title: 'At local midnight', due_at: '2026-03-08T05:00:00Z' });
  task(db, company, { title: 'End of 23-hour day', due_at: '2026-03-09T03:59:59Z' });
  task(db, company, { title: 'Next local day', due_at: '2026-03-09T04:00:00Z' });
  task(db, company, { title: 'Unscheduled research' });
  const sleeping = task(db, company, { title: 'Snoozed review', due_at: '2026-03-08T05:15:00Z' });
  updateWorkItem(db, tenant, sleeping.id, { snoozed_until: '2026-03-08T07:00:00Z' });
  const today = listWorkItems(db, tenant, { view: 'today', time_zone: 'America/New_York' });
  assert.deepEqual(today.data.map((item) => item.title), ['At local midnight', 'End of 23-hour day']);
  assert.deepEqual(today.counts, { all: 6, open: 5, due: 3, today: 2, upcoming: 1, overdue: 2, snoozed: 1, completed: 0, dismissed: 0 });
  assert.equal(listWorkItems(db, tenant, { view: 'today', time_zone: 'UTC' }).total, 2, 'UTC day boundaries differ from the user calendar');
  t.mock.timers.setTime(Date.parse('2026-03-08T07:00:00Z'));
  assert.equal(listWorkItems(db, tenant, { view: 'snoozed' }).total, 0);
  assert.equal(getWorkItem(db, tenant, sleeping.id).is_actionable, true);
});

test('local Today also handles a 25-hour autumn day and rejects invalid timezone/pagination', (t) => {
  const { db, company } = setup(t);
  t.mock.timers.setTime(Date.parse('2026-11-01T16:00:00Z'));
  task(db, company, { title: 'Late long day', due_at: '2026-11-02T04:59:59Z' });
  task(db, company, { title: 'After long day', due_at: '2026-11-02T05:00:00Z' });
  assert.equal(listWorkItems(db, tenant, { view: 'today', time_zone: 'America/New_York' }).total, 1);
  for (const query of [{ time_zone: 'Mars/Olympus' }, { limit: 0 }, { offset: -1 }, { view: 'secret' }]) assert.throws(() => listWorkItems(db, tenant, query), { status: 400 });
});

test('complete, dismiss and reopen preserve actor audit and clear incompatible state', (t) => {
  const { db, company } = setup(t);
  const item = task(db, company);
  assert.equal(item.owner_name, 'Alex');
  assert.equal(item.created_by, 'sales@example.test');
  updateWorkItem(db, tenant, item.id, { snoozed_until: '2026-03-10T10:00:00Z' }, 'second@example.test');
  const done = updateWorkItem(db, tenant, item.id, { status: 'done', resolution_note: 'Buyer research is complete.' }, 'second@example.test');
  assert.equal(done.completed_at, now);
  assert.equal(done.snoozed_until, null);
  assert.equal(done.is_actionable, false);
  assert.equal(listWorkItems(db, tenant, { view: 'done' }).total, 1);
  assert.throws(() => updateWorkItem(db, tenant, item.id, { status: 'dismissed' }), { code: 'dismissal_reason_required' });
  const reopened = updateWorkItem(db, tenant, item.id, { status: 'open' }, 'third@example.test');
  assert.equal(reopened.completed_at, null);
  assert.equal(reopened.resolution_note, null);
  assert.equal(reopened.updated_by, 'third@example.test');
  assert.equal(reopened.created_by, 'sales@example.test');
  assert.throws(() => updateWorkItem(db, tenant, item.id, { status: 'dismissed', resolution_note: '  ' }), { code: 'dismissal_reason_required' });
  updateWorkItem(db, tenant, item.id, { status: 'dismissed', resolution_note: 'No longer relevant to this account.' }, 'third@example.test');
  const audit = db.all("SELECT * FROM audit_events WHERE resource_type='work_item' ORDER BY created_at, id");
  assert.equal(audit.length, 5);
  assert.ok(audit.some((event) => event.actor === 'third@example.test' && JSON.parse(event.details_json).changes.status?.to === 'dismissed'));
});

test('work validation rejects malformed/spoofed fields and keeps dates explicit without banning future due dates', (t) => {
  const { db, company } = setup(t);
  const good = task(db, company, { due_at: '2035-12-01T10:00:00-05:00', owner_name: null });
  assert.equal(good.due_at, '2035-12-01T15:00:00.000Z');
  assert.equal(good.owner_name, null);
  for (const due_at of ['2026-02-30T09:00:00Z', '2026-03-08', '2026-03-08T10:00', 'yesterday', 12]) assert.throws(() => task(db, company, { due_at }), { status: 400 });
  for (const input of [{ title: '' }, { title: 12 }, { title: 'x'.repeat(241) }, { created_by: 'spoof' }, { status: 'done' }]) assert.throws(() => task(db, company, input), { status: 400 });
  assert.throws(() => updateWorkItem(db, tenant, good.id, { snoozed_until: now }), { code: 'invalid_snoozed_until' });
  assert.throws(() => updateWorkItem(db, tenant, good.id, {}), { status: 400 });
  const cleared = updateWorkItem(db, tenant, good.id, { due_at: null, owner_name: 'Taylor', note: 'Review with sales' });
  assert.equal(cleared.due_at, null);
  assert.equal(cleared.note, 'Review with sales');
});

test('work is tenant-scoped and closed accounts cannot acquire or reopen sales actions', (t) => {
  const { db, company, otherCompany } = setup(t);
  const item = task(db, company);
  for (const call of [() => getWorkItem(db, otherTenant, item.id), () => updateWorkItem(db, otherTenant, item.id, { status: 'done' }),
    () => createWorkItem(db, tenant, { company_id: otherCompany.id, title: 'Leak' }), () => listWorkItems(db, tenant, { company_id: otherCompany.id })]) assert.throws(call, { status: 404 });
  updateCompany(db, tenant, company.id, { status: 'customer' });
  assert.equal(getWorkItem(db, tenant, item.id).is_actionable, false);
  assert.throws(() => task(db, company), { code: 'company_workflow_closed' });
  updateWorkItem(db, tenant, item.id, { status: 'done' });
  assert.throws(() => updateWorkItem(db, tenant, item.id, { status: 'open' }), { code: 'company_workflow_closed' });
  assert.equal(getWorkItem(db, tenant, item.id).status, 'done');
});

test('rejecting evidence immediately removes score contribution and proof, and verification restores only original confidence', (t) => {
  const { db, company } = setup(t);
  launch(db, company, { external_id: 'launch-one', url: 'https://publisher-one.example/news' });
  const initial = rescoreCompany(db, tenant, company.id);
  const observation = listEvidenceReviews(db, tenant, company.id).data[0];
  assert.equal(observation.status, 'unreviewed');
  assert.equal(db.get('SELECT COUNT(*) count FROM evidence_reviews').count, 0);
  const rejected = reviewEvidence(db, tenant, company.id, { observation_id: observation.observation_id, status: 'rejected', note: 'This article concerns a different company.' }, 'reviewer@example.test');
  assert.ok(rejected.company.opportunity_score < initial.opportunity_score);
  const signal = db.get('SELECT * FROM signals WHERE company_id=?', [company.id]);
  assert.equal(signal.status, 'expired');
  assert.equal(signal.contribution, 0);
  assert.equal(signal.evidence_count, 0);
  assert.equal(companyInsights(db, tenant, company.id).why_now.drivers.length, 0);
  assert.equal(companyDetail(db, tenant, company.id).recommendation, null);
  assert.equal(companyDetail(db, tenant, company.id).observations[0].review_status, 'rejected');
  assert.equal(db.get('SELECT COUNT(*) count FROM signal_evidence').count, 1, 'review preserves lineage');
  const verified = reviewEvidence(db, tenant, company.id, { observation_id: observation.observation_id, status: 'verified', note: 'Confirmed authoritative source.' }, 'another-reviewer@example.test');
  assert.equal(verified.company.opportunity_score, initial.opportunity_score);
  assert.equal(db.get('SELECT confidence FROM signals WHERE company_id=?', [company.id]).confidence, .8);
  assert.equal(db.get("SELECT COUNT(*) count FROM audit_events WHERE action='evidence.reviewed'").count, 2);
  assert.equal(verified.review.reviewed_by, 'another-reviewer@example.test');
});

test('reviewing one observation adjusts corroboration while needs-review adds no score boost', (t) => {
  const { db, company } = setup(t);
  launch(db, company, { source: 'first', external_id: 'one', url: 'https://one.example/news' });
  launch(db, company, { source: 'second', external_id: 'two', url: 'https://two.example/news' });
  const [observation] = listEvidenceReviews(db, tenant, company.id).data;
  const initial = rescoreCompany(db, tenant, company.id);
  assert.equal(db.get('SELECT source_count FROM signals WHERE company_id=?', [company.id]).source_count, 2);
  const pending = reviewEvidence(db, tenant, company.id, { observation_id: observation.observation_id, status: 'needs_review', note: 'Check source ownership.' });
  assert.equal(pending.company.opportunity_score, initial.opportunity_score);
  reviewEvidence(db, tenant, company.id, { observation_id: observation.observation_id, status: 'rejected', note: 'Copy is incorrect.' });
  assert.equal(db.get('SELECT source_count FROM signals WHERE company_id=?', [company.id]).source_count, 1);
  assert.equal(listEvidenceReviews(db, tenant, company.id, { status: 'rejected' }).total, 1);
  assert.equal(listEvidenceReviews(db, tenant, company.id, { status: 'unreviewed' }).total, 1);
});

test('evidence review validates identity, notes, state and server-owned provenance without cross-tenant leaks', (t) => {
  const { db, company, otherCompany } = setup(t);
  launch(db, company);
  const observationId = listEvidenceReviews(db, tenant, company.id).data[0].observation_id;
  const base = { observation_id: observationId, status: 'verified' };
  for (const input of [{ ...base, status: 'rejected' }, { ...base, status: 'needs_review', note: ' ' }, { ...base, status: 'approved' }, { ...base, reviewed_by: 'spoof' }]) assert.throws(() => reviewEvidence(db, tenant, company.id, input), { status: 400 });
  assert.throws(() => reviewEvidence(db, otherTenant, otherCompany.id, base), { status: 404 });
  assert.throws(() => listEvidenceReviews(db, otherTenant, company.id), { status: 404 });
  assert.equal(db.get('SELECT COUNT(*) count FROM evidence_reviews').count, 0);
});

test('verification does not refresh an old observation or revive expired evidence', (t) => {
  const { db, company } = setup(t);
  launch(db, company, { observed_at: new Date(Date.now() - 120 * day).toISOString() });
  const observation = listEvidenceReviews(db, tenant, company.id).data[0];
  reviewEvidence(db, tenant, company.id, { observation_id: observation.observation_id, status: 'verified' });
  const signal = db.get('SELECT * FROM signals WHERE company_id=?', [company.id]);
  assert.equal(signal.status, 'expired');
  assert.equal(signal.contribution, 0);
  assert.equal(listEvidenceReviews(db, tenant, company.id).data[0].observed_at, observation.observed_at);
});

test('rejected pre-outcome evidence cannot remain a comparable-account feature through a later valid observation', (t) => {
  const { db, company } = setup(t);
  launch(db, company, { source: 'original', external_id: 'before' });
  const original = listEvidenceReviews(db, tenant, company.id).data[0];
  recordOutcome(db, tenant, company.id, { outcome_type: 'meeting', signal_key: 'product_launch' }, 'seller');
  const snapshotCount = db.get('SELECT COUNT(*) count FROM score_snapshots WHERE company_id=?', [company.id]).count;
  t.mock.timers.setTime(Date.now() + 2 * day);
  launch(db, company, { source: 'later', external_id: 'after' });
  const prospect = createCompany(db, tenant, { name: 'Comparable prospect', domain: 'comparable-review.example' });
  launch(db, prospect, { source: 'prospect', external_id: 'prospect' });
  assert.equal(companyInsights(db, tenant, prospect.id).comparable_accounts.labeled, 1);
  reviewEvidence(db, tenant, company.id, { observation_id: original.observation_id, status: 'rejected', note: 'Original item was misattributed.' });
  assert.equal(companyInsights(db, tenant, prospect.id).comparable_accounts.labeled, 0);
  const analytics = analyticsInsights(db, tenant);
  assert.equal(analytics.signal_effectiveness.length, 0);
  assert.ok(!analytics.source_effectiveness.some((source) => source.source === 'original'));
  assert.equal(analytics.source_effectiveness.find((source) => source.source === 'later').labeled_accounts, 0);
  assert.equal(outcomeAnalytics(db, tenant).signal_performance.length, 0);
  assert.ok(db.get('SELECT COUNT(*) count FROM score_snapshots WHERE company_id=?', [company.id]).count >= snapshotCount, 'prior recorded scores remain intact');
});

test('merging moves work and review history; explicit deletion cascades stored workflow records', (t) => {
  const { db, company } = setup(t);
  const target = createCompany(db, tenant, { name: 'Merged Harbor', domain: 'merged-harbor.example' });
  const item = task(db, company);
  launch(db, company);
  const observationId = listEvidenceReviews(db, tenant, company.id).data[0].observation_id;
  reviewEvidence(db, tenant, company.id, { observation_id: observationId, status: 'rejected', note: 'Incorrect source.' });
  db.transaction(() => mergeCompanies(db, tenant, company.id, { target_company_id: target.id, confirmed: true }, 'reviewer'));
  assert.equal(getWorkItem(db, tenant, item.id).company_id, target.id);
  assert.equal(listEvidenceReviews(db, tenant, target.id).data[0].status, 'rejected');
  deleteCompany(db, tenant, target.id);
  assert.equal(db.get('SELECT COUNT(*) count FROM work_items').count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM evidence_reviews').count, 0);
});

test('workflow route module enforces write scope and returns the agreed response contract', async (t) => {
  const { db, company } = setup(t);
  const router = new Router();
  registerWorkflowRoutes(router, db);
  const auth = { tenantId: tenant, actor: 'trusted-session', scopes: ['read', 'write'] };
  const post = router.match('POST', '/api/v1/work-items');
  const body = { company_id: company.id, title: 'Route-created follow-up' };
  await assert.rejects(() => post.handler({ auth: { ...auth, scopes: ['read'] }, body }), { status: 403 });
  const created = await post.handler({ auth, body, requestId: 'workflow-http' });
  assert.equal(created.status, 201);
  assert.equal(created.data.created_by, 'trusted-session');
  const get = router.match('GET', `/api/v1/work-items/${created.data.id}`);
  assert.equal((await get.handler({ auth, params: get.params })).title, body.title);
  const list = router.match('GET', '/api/v1/work-items');
  assert.equal((await list.handler({ auth, query: {} })).counts.open, 1);
});

test('saved workflow survives database restart without using the local demo database', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'radar-workflow-'));
  const filename = path.join(directory, 'isolated.sqlite');
  let db;
  try {
    db = openDatabase(filename, { manageSchema: true });
    bootstrap(db);
    const company = createCompany(db, tenant, { name: 'Persistent task', domain: 'persistent-task.example' });
    const item = task(db, company);
    db.close();
    db = openDatabase(filename, { manageSchema: true });
    assert.equal(getWorkItem(db, tenant, item.id).title, item.title);
    assert.equal(listWorkItems(db, tenant).total, 1);
  } finally {
    db?.close();
    fs.rmSync(directory, { recursive: true, force: true });
  }
});

test('HTTP journey saves, snoozes, completes and reopens work, then rejects evidence with tenant isolation', async (t) => {
  const db = openDatabase(':memory:', { manageSchema: true });
  const handler = createApp(db, { serveStaticAssets: false });
  const server = http.createServer((req, res) => {
    // This test-only identity bridge stands in for the host's verified session.
    setTrustedPrincipal(req, { userId: req.headers['x-workflow-test-user'] === 'other' ? 'workflow-http-other' : 'workflow-http-team' });
    return handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  const base = `http://127.0.0.1:${server.address().port}/api/v1`;
  const request = async (endpoint, { method = 'GET', body, user = 'team', expected = 200 } = {}) => {
    const response = await fetch(`${base}${endpoint}`, { method, headers: { 'content-type': 'application/json', 'x-workflow-test-user': user }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, JSON.stringify(result));
    return expected < 400 ? result.data : result.error;
  };
  assert.equal((await request('/work-items')).total, 0);
  const ingested = await request('/ingest', { method: 'POST', body: { records: [{ company: { name: 'HTTP Harbor', domain: 'http-harbor.example' }, source: 'workflow-test', external_id: 'http-launch', type: 'product_launch', title: 'Launch announcement', attributes: { is_new: true }, observed_at: new Date().toISOString() }] } });
  const companyId = ingested.companies[0];
  const item = await request('/work-items', { method: 'POST', expected: 201, body: { company_id: companyId, title: 'Confirm the business identity', due_at: new Date(Date.now() + day).toISOString() } });
  await request(`/work-items/${item.id}`, { user: 'other', expected: 404 });
  await request(`/work-items/${item.id}`, { method: 'PATCH', user: 'other', expected: 404, body: { status: 'done' } });
  await request(`/work-items/${item.id}`, { method: 'PATCH', body: { snoozed_until: new Date(Date.now() + day).toISOString() } });
  assert.equal((await request('/work-items?view=snoozed')).total, 1);
  await request(`/work-items/${item.id}`, { method: 'PATCH', body: { status: 'done', resolution_note: 'Reviewed source.' } });
  assert.equal((await request('/work-items?view=completed')).total, 1);
  const reopened = await request(`/work-items/${item.id}`, { method: 'PATCH', body: { status: 'open' } });
  assert.equal(reopened.completed_at, null);
  assert.equal(reopened.snoozed_until, null);
  const evidence = (await request(`/companies/${companyId}/evidence-reviews`)).data[0];
  await request(`/companies/${companyId}/evidence-reviews`, { method: 'POST', expected: 404, user: 'other', body: { observation_id: evidence.observation_id, status: 'rejected', note: 'Unauthorized attempt' } });
  const reviewed = await request(`/companies/${companyId}/evidence-reviews`, { method: 'POST', body: { observation_id: evidence.observation_id, status: 'rejected', note: 'This source refers to a different company.' } });
  assert.equal(reviewed.review.status, 'rejected');
  const detail = await request(`/companies/${companyId}`);
  assert.equal(detail.signals.filter((signal) => signal.status === 'active').length, 0);
  assert.equal(detail.observations[0].review_status, 'rejected');
  assert.equal((await request('/work-items', { user: 'other' })).total, 0);
});

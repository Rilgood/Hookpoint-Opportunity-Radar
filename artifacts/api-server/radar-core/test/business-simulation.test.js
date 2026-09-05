import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openDatabase } from '../src/db/index.js';
import { createApp } from '../src/app.js';
import { setTrustedPrincipal } from '../src/http/security.js';

// An executable business journey: all product actions cross the HTTP boundary.
// The two trusted identities stand in for an already-verified host session.
// Storage is explicitly memory-only, regardless of DATABASE_URL; no provider,
// messaging, scheduler, persisted demo workspace or external service is used.
test('business simulation: evidence to qualified account to revenue, with trust boundaries intact', { timeout: 20_000 }, async (t) => {
  const db = openDatabase(':memory:', { manageSchema: true });
  const handler = createApp(db, { serveStaticAssets: false });
  const allowedUsers = new Set(['simulation-team-a', 'simulation-team-b']);
  const server = http.createServer((req, res) => {
    const user = String(req.headers['x-simulation-user'] || '');
    if (allowedUsers.has(user)) setTrustedPrincipal(req, { userId: user });
    return handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    db.close();
  });
  const origin = `http://127.0.0.1:${server.address().port}`;
  const day = 86_400_000;
  let clock = Date.parse('2026-09-01T12:00:00.000Z');
  t.mock.timers.enable({ apis: ['Date'], now: clock });
  let requests = 0;
  const now = () => new Date(clock).toISOString();
  const ago = (days) => new Date(clock - days * day).toISOString();
  const advance = (milliseconds) => { clock += milliseconds; t.mock.timers.setTime(clock); };
  async function request(path, { method = 'GET', body, user = 'simulation-team-a', expected = 200, headers = {} } = {}) {
    requests += 1;
    const response = await fetch(`${origin}/api/v1${path}`, {
      method, headers: { 'content-type': 'application/json', 'x-simulation-user': user, ...headers },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = response.headers.get('content-type')?.includes('application/json') ? await response.json() : await response.text();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return typeof result === 'string' ? result : expected >= 400 ? result.error : result.data;
  }
  const ingest = (records, options = {}) => request('/ingest', { method: 'POST', body: { records }, ...options });
  const detail = (id, options) => request(`/companies/${id}`, options);
  const company = { name: 'Simulation Meridian Goods', domain: 'meridian-simulation.example', industry: 'Consumer Products', employee_count: 85, annual_revenue: 12_000_000, city: 'Chicago', state: 'IL', country: 'US' };
  const launch = {
    company, source: 'newsapi', external_id: 'launch-origin', type: 'product_launch',
    title: 'Meridian announces its fall product range', body: 'The company introduces a new range in September.',
    url: 'https://meridian-simulation.example/news/fall-launch', observed_at: ago(2), confidence: 0.9, attributes: { is_new: true }
  };
  let mainId;
  let launchOnlyScore;
  let launchConfidence;
  let qualifiedScore;
  let ambiguousId;
  let researchScore;
  let researchTime;

  await t.test('1. A real event is reviewable evidence; one launch alone is not claimed as a ready buyer', async () => {
    assert.equal((await request('/dashboard')).companies, 0);
    const result = await ingest([launch]);
    assert.equal(result.inserted, 1);
    mainId = result.companies[0];
    const account = await detail(mainId);
    launchOnlyScore = account.company.opportunity_score;
    launchConfidence = account.signals.find((signal) => signal.signal_key === 'product_launch').confidence;
    assert.equal(account.observations[0].url, launch.url);
    assert.equal(account.observations[0].observed_at, launch.observed_at);
    assert.equal(account.signals.find((signal) => signal.signal_key === 'product_launch').source_count, 1);
    assert.ok(!['hot', 'warm'].includes(account.company.opportunity_tier), 'a launch alone should not assert buying readiness');
    assert.equal((await request('/analytics/outcomes')).calibration.summary.labeled_accounts, 0);
  });

  await t.test('2. Replays cannot create accounts; syndicated copies preserve provenance without inventing independent support', async () => {
    const repeated = await ingest([{ ...launch, company: { name: 'Replayed Wrong Company', domain: 'replay-decoy.example', annual_revenue: 1_000_000_000 } }]);
    assert.equal(repeated.duplicates, 1);
    assert.equal((await request('/companies?q=Replayed')).total, 0, 'an already-seen provider ID must not create a ghost account');
    assert.equal((await detail(mainId)).company.annual_revenue, company.annual_revenue);
    await ingest([{ ...launch, source: 'gdelt', external_id: 'syndicated-copy', url: `${launch.url}?utm_source=gdelt#article` }]);
    const copied = await detail(mainId);
    const copiedSignal = copied.signals.find((signal) => signal.signal_key === 'product_launch');
    assert.equal(copied.observations.length, 2, 'both retrievals remain auditable');
    assert.equal(copiedSignal.source_count, 1);
    assert.equal(copiedSignal.evidence_count, 1);
    assert.equal(copiedSignal.confidence, launchConfidence);
    assert.equal(copied.company.opportunity_score, launchOnlyScore);
    advance(60_000);
    await ingest([{ ...launch, source: 'newsapi', external_id: 'independent-trade-report', url: 'https://trade-simulation.example/meridian-launch', confidence: 0.8 }]);
    const corroborated = await detail(mainId);
    assert.equal(corroborated.signals.find((signal) => signal.signal_key === 'product_launch').source_count, 2);
    researchScore = corroborated.company.opportunity_score;
    researchTime = clock;
  });

  await t.test('3. Direct evaluation behavior and a measurable creative issue make a researched account eligible', async () => {
    advance(60 * 60_000);
    await ingest([
      { company, source: 'crm', external_id: 'verified-demo-request', type: 'web_intent', title: 'Company buyer requested a strategy session', observed_at: ago(0.5), confidence: 0.98, attributes: { demo_requested: true } },
      { company, source: 'meta_ad_library', external_id: 'creative-review', type: 'creative_metric', title: 'Observed creative repetition', url: 'https://www.facebook.com/ads/library/?id=meridian-test', observed_at: ago(1), confidence: 0.9, attributes: { duplicate_creative_ratio: 0.75 } }
    ]);
    const account = await detail(mainId);
    qualifiedScore = account.company.opportunity_score;
    assert.ok(qualifiedScore > launchOnlyScore);
    assert.ok(['hot', 'warm'].includes(account.company.opportunity_tier));
    assert.ok(account.recommendation);
    assert.equal(account.signals.find((signal) => signal.signal_key === 'creative_fatigue').label, 'Creative refresh hypothesis');
    const insights = await request(`/companies/${mainId}/insights`);
    assert.ok(insights.why_now.drivers.some((driver) => driver.signal_key === 'high_first_party_intent'));
    assert.equal(insights.comparable_accounts.sufficient_sample, false, 'no sales history means no proven conversion rate');
  });

  await t.test('4. High commercial evidence cannot bypass ambiguous identity; explicit confirmation immediately clears the hold', async () => {
    const ambiguous = { name: 'Simulation Common Studio', country: 'US', employee_count: 80, industry: 'Retail' };
    const result = await ingest([
      { company: ambiguous, source: 'combined_feed', external_id: 'ambiguous-intent', type: 'web_intent', title: 'Verified inquiry', observed_at: now(), attributes: { demo_requested: true } },
      { company: ambiguous, source: 'combined_feed', external_id: 'ambiguous-creative', type: 'creative_metric', title: 'Creative repetition', observed_at: now(), attributes: { duplicate_creative_ratio: 0.9 } },
      { company: ambiguous, source: 'combined_feed', external_id: 'ambiguous-launch', type: 'product_launch', title: 'Launch announced', observed_at: now(), attributes: { is_new: true } }
    ]);
    ambiguousId = result.companies[0];
    const held = await detail(ambiguousId);
    assert.ok(held.company.opportunity_score >= 48);
    assert.ok(held.company.identity_confidence < 0.8);
    assert.equal(held.company.opportunity_tier, 'watch');
    assert.equal(held.recommendation.offer, 'Identity verification required');
    const confirmed = await request(`/companies/${ambiguousId}/identity/confirm`, { method: 'POST', body: { identity_type: 'domain', value: 'confirmed-studio.example' } });
    assert.ok(['hot', 'warm'].includes(confirmed.opportunity_tier), 'confirmation must return a freshly eligible account');
    const released = await detail(ambiguousId);
    assert.notEqual(released.recommendation.offer, 'Identity verification required');
    await ingest([{ company: { ...ambiguous, domain: 'different-studio.example' }, source: 'combined_feed', external_id: 'different-identity', type: 'news', title: 'Different company with the same name', observed_at: now() }]);
    assert.equal((await detail(ambiguousId)).company.domain, 'confirmed-studio.example');
    const conflicts = await request('/companies?q=Simulation%20Common%20Studio');
    assert.equal(conflicts.total, 2, 'conflicting authoritative domains must remain separate');
  });

  await t.test('5. A severe risk overrides commercial readiness and cannot produce a sales playbook', async () => {
    const result = await ingest([{ company: { name: 'Simulation Risk Account', domain: 'risk-simulation.example' }, source: 'official_notice', external_id: 'risk-notice', type: 'crisis', title: 'Material security incident confirmed', observed_at: now(), confidence: 0.95, attributes: { severity: 'critical' } }]);
    const account = await detail(result.companies[0]);
    assert.equal(account.company.opportunity_tier, 'suppressed');
    assert.equal(account.recommendation.offer, 'Outreach paused');
    assert.match(account.recommendation.next_action, /verify|review/i);
  });

  await t.test('6. Pipeline progression records revenue once per event, unique account calibration, and no outreach to a customer', async () => {
    for (const outcome_type of ['accepted', 'contacted', 'positive_reply', 'meeting', 'opportunity', 'won']) {
      advance(60_000);
      const body = { outcome_type, occurred_at: now(), note: 'Synthetic business simulation only.', ...(outcome_type === 'won' ? { amount: 45_000 } : {}) };
      await request(`/companies/${mainId}/outcomes`, { method: 'POST', body, expected: 201 });
    }
    const customer = await detail(mainId);
    assert.equal(customer.company.status, 'customer');
    assert.equal(customer.recommendation, null);
    const analytics = await request('/analytics/outcomes');
    assert.equal(analytics.totals.find((row) => row.outcome_type === 'won').amount, 45_000);
    assert.equal(analytics.calibration.summary.labeled_accounts, 1, 'meeting, opportunity and won are one labeled account');
    assert.equal(analytics.calibration.summary.qualified_accounts, 1);
    assert.equal(analytics.calibration.summary.sufficient_sample, false);
    const evaluation = await request('/analytics/outcomes/evaluate', { method: 'POST', body: {} });
    assert.equal(evaluation.status, 'blocked', 'one simulated customer cannot justify weight tuning');
    await request(`/companies/${mainId}/outcomes`, { method: 'POST', body: { outcome_type: 'contacted', occurred_at: ago(1), note: 'Backfilled CRM activity predates the win.' }, expected: 201 });
    assert.equal((await detail(mainId)).company.status, 'customer', 'backfilled older contact must not reopen a customer');
    const backfilledMeeting = await request(`/companies/${mainId}/outcomes`, { method: 'POST', expected: 201,
      body: { outcome_type: 'meeting', occurred_at: new Date(researchTime + 30 * 60_000).toISOString(), note: 'Meeting occurred before the later intent evidence was ingested.' } });
    assert.equal(backfilledMeeting.score_at_outcome, researchScore, 'historic calibration must use the score known before later evidence arrived');
    assert.equal(backfilledMeeting.metadata.score_provenance.basis, 'historical_snapshot');
    assert.equal((await detail(mainId)).company.status, 'customer');
  });

  await t.test('7. Tenant isolation and filtered CSV exports agree with the visible pipeline across pages', async () => {
    const create = (name, domain, user = 'simulation-team-a') => request('/companies', { method: 'POST', user, expected: 201, body: { name, domain, status: 'contacted', industry: 'Retail' } });
    await create('Simulation 100%_One', 'export-one.example');
    await create('Simulation 100%_Two', 'export-two.example');
    await create('Simulation 100ABDecoy', 'export-decoy.example');
    await create('Simulation 100%_Other Tenant', 'export-private.example', 'simulation-team-b');
    const otherIngest = await ingest([launch], { user: 'simulation-team-b' });
    const otherId = otherIngest.companies[0];
    assert.notEqual(otherId, mainId, 'the same provider record belongs independently to each tenant');
    await request(`/companies/${otherId}/outcomes`, { method: 'POST', user: 'simulation-team-b', expected: 201, body: { outcome_type: 'won', amount: 999_000 } });
    assert.equal((await request('/analytics/outcomes')).totals.find((row) => row.outcome_type === 'won').amount, 45_000);
    assert.equal((await detail(mainId, { user: 'simulation-team-b', expected: 404 })).code, 'company_not_found');
    await request(`/companies/${mainId}/outcomes`, { method: 'POST', user: 'simulation-team-b', expected: 404, body: { outcome_type: 'lost' } });
    assert.equal((await detail(mainId)).company.status, 'customer');
    const query = new URLSearchParams({ q: '100%_', status: 'contacted', industry: 'Retail', page: '1', limit: '1' });
    const pageOne = await request(`/companies?${query}`, { headers: { 'x-tenant-id': 'simulation-team-b' } });
    query.set('page', '2');
    const pageTwo = await request(`/companies?${query}`);
    assert.equal(pageOne.total, 2);
    const csv = await request(`/export/companies.csv?${query}`);
    const rows = parseCsv(csv);
    const expected = [...pageOne.data, ...pageTwo.data].map((row) => row.name).sort();
    assert.deepEqual(rows.map((row) => row.name).sort(), expected, 'export includes every filtered row, not just the last page');
    assert.ok(rows.every((row) => row.status === 'contacted'));
    assert.ok(!csv.includes('Other Tenant') && !csv.includes('Decoy'));
  });

  await t.test('8. Imported historical revenue is retained while unknown historical scores stay out of calibration', async () => {
    const imported = await request('/companies', { method: 'POST', expected: 201, body: { name: 'Simulation Historical Import', domain: 'historical-import.example' } });
    const outcome = await request(`/companies/${imported.id}/outcomes`, { method: 'POST', expected: 201, body: {
      outcome_type: 'won', amount: 12_000, occurred_at: ago(30),
      metadata: { score_provenance: { basis: 'historical_snapshot', calibration_eligible: true, snapshot_id: 'spoofed' } }
    } });
    assert.equal(outcome.metadata.score_provenance.basis, 'unavailable_historical');
    assert.equal(outcome.metadata.score_provenance.calibration_eligible, false);
    assert.equal(outcome.metadata.score_provenance.snapshot_id, undefined, 'caller-supplied score provenance must never be trusted');
    await request(`/companies/${imported.id}/outcomes`, { method: 'POST', expected: 201, body: { outcome_type: 'meeting' } });
    const analytics = await request('/analytics/outcomes');
    assert.equal(analytics.totals.find((row) => row.outcome_type === 'won').amount, 57_000, 'historical revenue is still a business fact');
    assert.equal(analytics.calibration.summary.labeled_accounts, 1, 'a later known-score label cannot replace an unknown first conversion');
    assert.match(analytics.calibration.summary.cohort_note, /1 account excluded/);
    assert.equal((await request('/analytics/insights')).base_rate.labeled, 1);
  });

  await t.test('9. Old, prematurely dated and invalid evidence cannot create present buying readiness', async () => {
    const mixed = await ingest([
      { company: { name: 'Simulation Old Launch', domain: 'old-launch.example' }, source: 'archive', external_id: 'stale', type: 'product_launch', title: 'Launch from four months ago', observed_at: ago(120), attributes: { is_new: true } },
      { company: { name: 'Simulation Future Invalid', domain: 'future-invalid.example' }, source: 'bad_clock', external_id: 'future', type: 'product_launch', title: 'Incorrectly future-dated evidence', observed_at: new Date(clock + day).toISOString(), attributes: { is_new: true } }
    ], { expected: 207 });
    assert.equal(mixed.inserted, 1);
    assert.equal(mixed.rejected, 1);
    assert.equal(mixed.errors[0].code, 'future_observed_at');
    assert.equal((await request('/companies?q=Future%20Invalid')).total, 0);
    const stale = await detail(mixed.companies[0]);
    assert.ok(!['hot', 'warm'].includes(stale.company.opportunity_tier));
    assert.equal(stale.recommendation, null);
    assert.ok(stale.signals.every((signal) => signal.status !== 'active' && signal.contribution === 0));
    const futureTime = new Date(clock + 120_000).toISOString();
    const nearFuture = await ingest([{ company: { name: 'Simulation Clock Skew', domain: 'clock-skew.example' }, source: 'provider_clock', external_id: 'near-future', type: 'product_launch', title: 'Provider timestamp ahead of local time', observed_at: futureTime, retrieved_at: futureTime, attributes: { is_new: true } }]);
    assert.ok((await detail(nearFuture.companies[0])).signals.every((signal) => signal.status !== 'active'));
    advance(180_000);
    await request('/rescore', { method: 'POST', body: { due_only: false } });
    assert.ok((await detail(nearFuture.companies[0])).signals.some((signal) => signal.status === 'active'));
    advance(61 * day);
    await request('/rescore', { method: 'POST', body: { due_only: false } });
    const aged = await detail(mainId);
    assert.ok(aged.company.opportunity_score < qualifiedScore);
    assert.ok(!['hot', 'warm'].includes(aged.company.opportunity_tier));
    assert.equal(aged.recommendation, null);
  });

  t.diagnostic(`Business simulation completed: 9 stages, ${requests} HTTP requests, 2 isolated tenants, memory-only SQLite, no external service calls or sends.`);
});

test('business simulation: readiness advances only after collected evidence, a review decision, owned dated work and a real outcome', { timeout: 20_000 }, async (t) => {
  const db = openDatabase(':memory:', { manageSchema: true });
  const handler = createApp(db, { serveStaticAssets: false });
  const server = http.createServer((req, res) => {
    setTrustedPrincipal(req, { userId: req.headers['x-readiness-test-user'] === 'other' ? 'readiness-simulation-other' : 'readiness-simulation-team' });
    return handler(req, res);
  });
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', resolve); });
  t.after(async () => { await new Promise((resolve) => server.close(resolve)); db.close(); });
  const origin = `http://127.0.0.1:${server.address().port}/api/v1`;
  let requests = 0;
  async function request(path, { method = 'GET', body, user = 'team', expected = 200 } = {}) {
    requests += 1;
    const response = await fetch(`${origin}${path}`, { method, headers: { 'content-type': 'application/json', 'x-readiness-test-user': user }, body: body === undefined ? undefined : JSON.stringify(body) });
    const result = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(result)}`);
    return result.data;
  }
  const completion = (result) => Object.fromEntries(result.steps.map((step) => [step.key, step.complete]));
  const empty = await request('/workspace-readiness');
  assert.deepEqual(completion(empty), { collect: false, review: false, act: false, learn: false });
  assert.equal(empty.sources.find((source) => source.key === 'gdelt').configured, true);
  assert.equal(empty.sources.find((source) => source.key === 'gdelt').latest_run, null);
  const company = await request('/companies', { method: 'POST', expected: 201, body: { name: 'Readiness Simulation Account', domain: 'readiness-simulation.example' } });
  assert.equal((await request('/workspace-readiness')).steps.find((step) => step.key === 'collect').complete, false, 'an account record alone is not collected evidence');
  await request('/ingest', { method: 'POST', body: { records: [{ company: { name: company.name, domain: company.domain }, source: 'readiness-simulation', external_id: 'launch', type: 'product_launch', title: 'Company introduces a new range', attributes: { is_new: true }, observed_at: new Date().toISOString() }] } });
  const observation = (await request(`/companies/${company.id}/evidence-reviews`)).data[0];
  await request(`/companies/${company.id}/evidence-reviews`, { method: 'POST', body: { observation_id: observation.observation_id, status: 'needs_review', note: 'Check whether this names the same company.' } });
  const pending = await request('/workspace-readiness');
  assert.deepEqual(completion(pending), { collect: true, review: false, act: false, learn: false });
  assert.equal(pending.counts.reviewed_evidence, 0);
  const item = await request('/work-items', { method: 'POST', expected: 201, body: { company_id: company.id, title: 'Review launch with the account owner' } });
  const unassigned = await request('/workspace-readiness');
  assert.equal(unassigned.counts.work_items, 1);
  assert.equal(unassigned.counts.assigned_work, 0);
  assert.equal(unassigned.steps.find((step) => step.key === 'act').complete, false);
  await request(`/work-items/${item.id}`, { method: 'PATCH', body: { owner_name: 'Alex', due_at: new Date(Date.now() + 86_400_000).toISOString() } });
  await request(`/companies/${company.id}/evidence-reviews`, { method: 'POST', body: { observation_id: observation.observation_id, status: 'verified', note: 'Checked company domain and publication date.' } });
  const assigned = await request('/workspace-readiness');
  assert.deepEqual(completion(assigned), { collect: true, review: true, act: true, learn: false });
  assert.equal(assigned.counts.assigned_work, 1);
  assert.equal(assigned.counts.reviewed_evidence, 1);
  await request(`/companies/${company.id}/outcomes`, { method: 'POST', expected: 201, body: { outcome_type: 'meeting', note: 'Discovery meeting booked after reviewing the account.' } });
  const finished = await request('/workspace-readiness');
  assert.deepEqual(completion(finished), { collect: true, review: true, act: true, learn: true });
  assert.equal(finished.counts.outcomes, 1);
  assert.equal(finished.calibration.labeled_accounts, 1, 'one outcome remains one label, not model validation');
  const isolated = await request('/workspace-readiness', { user: 'other' });
  assert.ok(Object.values(isolated.counts).every((value) => value === 0));
  assert.deepEqual(completion(isolated), { collect: false, review: false, act: false, learn: false });
  t.diagnostic(`Readiness simulation completed: ${requests} HTTP requests, 2 isolated tenants, all four evidence-backed milestones, no external collection or sends.`);
});

function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"' && quoted && text[index + 1] === '"') { field += '"'; index += 1; }
    else if (character === '"') quoted = !quoted;
    else if (character === ',' && !quoted) { row.push(field); field = ''; }
    else if ((character === '\n' || character === '\r') && !quoted) {
      if (character === '\r' && text[index + 1] === '\n') index += 1;
      row.push(field); rows.push(row); row = []; field = '';
    } else field += character;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const headers = rows.shift() || [];
  return rows.filter((values) => values.length === headers.length).map((values) => Object.fromEntries(headers.map((header, index) => [header, values[index]])));
}

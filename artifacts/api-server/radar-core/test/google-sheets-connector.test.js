import test from 'node:test';
import assert from 'node:assert/strict';
import { GoogleSheetsConnector, googleSheetsTenantBindingKey } from '../src/connectors/google-sheets.js';
import { openDatabase } from '../src/db/index.js';
import { bootstrap, syncConnectorCatalog } from '../src/services/bootstrap.js';
import { setConnectorEnabled } from '../src/services/connector-runner.js';
import { listConnectors } from '../src/services/queries.js';
import { nowIso, stableJson } from '../src/lib.js';

const ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz_1234567890';
const OTHER_ID = '9ZyXwVuTsRqPoNmLkJiHgFeDcBa_0987654321';
const TENANT = 'tenant_google_sheets_test';
const manifest = { label: 'Google Sheets' };
const response = (values, status = 200) => new Response(JSON.stringify({ values }), { status });
const authorized = (input = {}) => ({ ...input, trustedTenantId: TENANT });

process.env.GOOGLE_SHEETS_TENANT_BINDINGS = JSON.stringify({
  [googleSheetsTenantBindingKey(TENANT)]: [ID]
});

test('Google Sheets validates IDs, URLs, and bounded finite ranges before transport', async () => {
  let calls = 0;
  const connector = new GoogleSheetsConnector(manifest, { proxy: async () => { calls += 1; return response([]); } });
  await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: 'short', range: 'A1:B2' })), { code: 'invalid_spreadsheet_id' });
  await assert.rejects(() => connector.collect(authorized({ spreadsheet_url: `https://evil.test/spreadsheets/d/${ID}`, range: 'A1:B2' })), { code: 'invalid_spreadsheet_url' });
  await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: ID, range: 'A:B' })), { code: 'invalid_sheet_range' });
  await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: ID, range: '1:10' })), { code: 'invalid_sheet_range' });
  await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: ID, range: '=A1:B2' })), { code: 'invalid_sheet_range' });
  await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: ID, range: "'bad\u0001name'!A1:B2" })), { code: 'invalid_sheet_range' });
  await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: ID, range: 'A1:CV5001' })), { code: 'sheet_range_too_large' });
  assert.equal(calls, 0);
});

test('Google Sheets maps aliases, lineage, safe extras, and stable row identity', async () => {
  let request;
  const transport = { proxy: async (...args) => {
    request = args;
    return response([
      ['Company', 'Domain', 'Observation Type', 'Headline', 'Description', 'Event Date', 'Confidence', 'Industry', 'Campaign'],
      ['Acme', 'https://www.acme.test/path', 'product launch', 'Acme launches', 'A new product', '2026-01-02T03:04:05Z', 0.91, 'Software', 'Spring']
    ]);
  } };
  const connector = new GoogleSheetsConnector(manifest, transport);
  const result = await connector.run(authorized({ spreadsheet_url: `https://docs.google.com/spreadsheets/d/${ID}/edit#gid=0`, range: "'Signals'!A1:I10" }));
  assert.equal(request[0], 'google-sheet');
  assert.match(request[1], /^\/v4\/spreadsheets\//);
  assert.deepEqual(request[2], { method: 'GET' });
  assert.equal(result.normalizationErrors.length, 0);
  const record = result.records[0];
  assert.equal(record.source, 'google_sheets');
  assert.equal(record.type, 'product_launch');
  assert.equal(record.title, 'Acme launches');
  assert.equal(record.company.domain, 'acme.test');
  assert.equal(record.url, `https://docs.google.com/spreadsheets/d/${ID}`);
  assert.equal(record.event_time_quality, 'reported');
  assert.equal(record.normalizer_version, 'google_sheets-v1');
  assert.equal(record.attributes.campaign, 'Spring');
  assert.match(record.external_id, /^sheet-row:/);
  assert.match(record.raw_ref, /row:2$/);
});

test('Google Sheets reports row-level normalization failures without dropping valid rows', async () => {
  const connector = new GoogleSheetsConnector(manifest, { proxy: async () => response([
    ['company_name', 'type', 'title'],
    ['Acme', 'not_real', 'Bad type'],
    ['', 'news', 'No identity'],
    ['Acme', 'news', '=IMPORTXML("x")'],
    ['Acme', 'news', 'Valid']
  ]) });
  const result = await connector.run(authorized({ spreadsheet_id: ID, range: 'A1:C5' }));
  assert.equal(result.records.length, 1);
  assert.equal(result.normalizationErrors.length, 3);
  assert.equal(result.records[0].title, 'Valid');
});

test('Google Sheets parses currency and abbreviated amounts', async () => {
  const connector = new GoogleSheetsConnector(manifest, { proxy: async () => response([
    ['company', 'type', 'title', 'amount'],
    ['Acme', 'funding', 'Raised capital', '$1.25M'],
    ['Beta', 'contract_award', 'Won contract', '€2,500']
  ]) });
  const result = await connector.run(authorized({ spreadsheet_id: ID, range: 'A1:D3' }));
  assert.equal(result.records[0].attributes.amount, 1_250_000);
  assert.equal(result.records[1].attributes.amount, 2_500);
});

test('Google Sheets redacts provider failures and transport exceptions', async () => {
  const bodySecret = 'token=super-secret-value';
  const failed = new GoogleSheetsConnector(manifest, { proxy: async () => new Response(bodySecret, { status: 403, headers: { authorization: 'Bearer hidden' } }) });
  await assert.rejects(
    () => failed.collect(authorized({ spreadsheet_id: ID, range: 'A1:B2' })),
    (error) => error.code === 'google_sheets_request_failed' && error.message === 'Google Sheets request failed with status 403.' && !error.message.includes(bodySecret)
  );
  const thrown = new GoogleSheetsConnector(manifest, { proxy: async () => { throw new Error('Bearer secret-token'); } });
  await assert.rejects(
    () => thrown.collect(authorized({ spreadsheet_id: ID, range: 'A1:B2' })),
    (error) => error.code === 'google_sheets_request_failed' && error.message === 'Google Sheets request failed.'
  );
});

test('Google Sheets requires strict tenant bindings and rejects unbound tenants and sheets', async () => {
  const connector = new GoogleSheetsConnector(manifest, { proxy: async () => response([]) });
  const valid = process.env.GOOGLE_SHEETS_TENANT_BINDINGS;
  try {
    delete process.env.GOOGLE_SHEETS_TENANT_BINDINGS;
    await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: ID, range: 'A1:B2' })), { code: 'google_sheets_bindings_required' });
    process.env.GOOGLE_SHEETS_TENANT_BINDINGS = '{"raw-tenant-id":["bad"]}';
    await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: ID, range: 'A1:B2' })), { code: 'google_sheets_bindings_invalid' });
    process.env.GOOGLE_SHEETS_TENANT_BINDINGS = valid;
    await assert.rejects(() => connector.collect({ spreadsheet_id: ID, range: 'A1:B2' }), { code: 'google_sheets_tenant_required' });
    await assert.rejects(() => connector.collect({ spreadsheet_id: ID, range: 'A1:B2', tenant_id: TENANT }), { code: 'google_sheets_tenant_required' });
    await assert.rejects(() => connector.collect({ spreadsheet_id: ID, range: 'A1:B2', trustedTenantId: 'wrong-tenant' }), { code: 'google_sheets_sheet_forbidden' });
    await assert.rejects(() => connector.collect(authorized({ spreadsheet_id: OTHER_ID, range: 'A1:B2' })), { code: 'google_sheets_sheet_forbidden' });
  } finally {
    process.env.GOOGLE_SHEETS_TENANT_BINDINGS = valid;
  }
});

test('Google Sheets permits an allowlisted sheet for its hashed workspace binding', async () => {
  let calls = 0;
  const connector = new GoogleSheetsConnector(manifest, { proxy: async () => { calls += 1; return response([]); } });
  await connector.collect(authorized({ spreadsheet_id: ID, range: 'A1:B2' }));
  assert.equal(calls, 1);
  assert.match(googleSheetsTenantBindingKey(TENANT), /^[a-f0-9]{24}$/);
  assert.ok(!process.env.GOOGLE_SHEETS_TENANT_BINDINGS.includes(TENANT));
});

test('Google Sheets readiness is tenant-specific and stale configuration cannot enable an unbound tenant', async () => {
  const tenantA = 'tenant_sheets_bound_a';
  const tenantB = 'tenant_sheets_unbound_b';
  const original = process.env.GOOGLE_SHEETS_TENANT_BINDINGS;
  const db = openDatabase(':memory:');
  try {
    process.env.GOOGLE_SHEETS_TENANT_BINDINGS = JSON.stringify({
      [googleSheetsTenantBindingKey(tenantA)]: [ID]
    });
    bootstrap(db, { withAdminKey: false });
    const now = nowIso();
    for (const tenantId of [tenantA, tenantB]) {
      db.run(`INSERT INTO tenants(id, name, slug, settings_json, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)`,
        [tenantId, 'Test workspace', googleSheetsTenantBindingKey(tenantId), stableJson({}), now, now]);
      syncConnectorCatalog(db, tenantId, now);
    }
    const sheetRow = (tenantId) => listConnectors(db, tenantId).find((item) => item.connector_key === 'google_sheets');
    assert.equal(sheetRow(tenantA).configured, true);
    assert.equal(sheetRow(tenantB).configured, false);

    db.run(`UPDATE connectors SET configured=1, status='disabled' WHERE tenant_id=? AND connector_key='google_sheets'`, [tenantB]);
    assert.throws(() => setConnectorEnabled(db, tenantB, 'google_sheets', true, {
      schedule_input: { spreadsheet_id: ID, range: 'A1:B2' }
    }), { code: 'connector_not_configured' });
    assert.equal(sheetRow(tenantB).configured, false);

    const connector = new GoogleSheetsConnector(manifest, { proxy: async () => response([]) });
    await assert.rejects(() => connector.collect({ spreadsheet_id: ID, range: 'A1:B2', trustedTenantId: tenantB }), { code: 'google_sheets_sheet_forbidden' });
    await connector.collect({ spreadsheet_id: ID, range: 'A1:B2', trustedTenantId: tenantA });
  } finally {
    db.close();
    if (original === undefined) delete process.env.GOOGLE_SHEETS_TENANT_BINDINGS;
    else process.env.GOOGLE_SHEETS_TENANT_BINDINGS = original;
  }
});
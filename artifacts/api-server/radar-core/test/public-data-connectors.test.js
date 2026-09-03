import test from 'node:test';
import assert from 'node:assert/strict';
import { NppesConnector, SecEdgarConnector, UsaSpendingConnector } from '../src/connectors/public-data.js';
import { detectSignals } from '../src/services/signals.js';

async function withFetch(payload, run) {
  const original = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options = {}) => {
    request = { url: new URL(url), options };
    return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try { return await run(() => request); } finally { globalThis.fetch = original; }
}

test('SEC uses the padded submissions endpoint and normalizes filing evidence without scoring it', async () => {
  const today = new Date().toISOString().slice(0, 10);
  await withFetch({ name: 'ACME, INC.', sic: '1234', filings: { recent: {
    accessionNumber: ['0000001234-25-000001'], filingDate: [today], reportDate: [today],
    acceptanceDateTime: [`${today}T12:00:00.000Z`], form: ['8-K'], primaryDocument: ['acme-8k.htm']
  } } }, async (requested) => {
    const result = await new SecEdgarConnector({ label: 'SEC EDGAR' }).run({
      cik: '1234', forms: ['8-K'], start_date: today, end_date: today, limit: 1, company: { name: 'Acme' }
    });
    assert.equal(requested().url.href, 'https://data.sec.gov/submissions/CIK0000001234.json');
    assert.match(requested().options.headers['User-Agent'], /Hookpoint Opportunity Radar/);
    assert.equal(result.records[0].type, 'sec_filing');
    assert.equal(result.records[0].url, 'https://www.sec.gov/Archives/edgar/data/1234/000000123425000001/acme-8k.htm');
    assert.deepEqual(detectSignals(result.records[0]), []);
    assert.equal(result.cursor.high_water.accession_number, '0000001234-25-000001');
  });
});

test('SEC rejects malformed CIKs and cursors before making a request', async () => {
  const connector = new SecEdgarConnector({ label: 'SEC EDGAR' });
  await assert.rejects(connector.collect({ cik: '12-34' }), { code: 'invalid_cik' });
  await assert.rejects(connector.collect({ cik: '1234', cursor: { filed_at: '2025-01-01' } }), { code: 'invalid_connector_cursor' });
});

test('SEC drains a greater-than-limit backlog without skipping filings that arrive between pages', async () => {
  const original = globalThis.fetch;
  const today = new Date().toISOString().slice(0, 10);
  let accessions = [5, 4, 3, 2, 1].map((number) => `0000001234-25-${String(number).padStart(6, '0')}`);
  globalThis.fetch = async () => new Response(JSON.stringify({
    name: 'ACME, INC.',
    filings: { recent: {
      accessionNumber: accessions,
      filingDate: accessions.map(() => today),
      form: accessions.map(() => '8-K'),
      primaryDocument: accessions.map((accession) => `${accession}.htm`)
    } }
  }), { status: 200 });
  try {
    const connector = new SecEdgarConnector({ label: 'SEC EDGAR' });
    const input = { cik: '1234', start_date: today, end_date: today, limit: 2 };
    const first = await connector.collect(input);
    assert.deepEqual(first.items.map((item) => item.accessionNumber), accessions.slice(0, 2));
    assert.equal(first.cursor.high_water, null);
    assert.equal(first.cursor.pending_high_water.accession_number, accessions[0]);
    assert.equal(first.cursor.page_after.accession_number, accessions[1]);

    const arrival = '0000001234-25-000006';
    accessions = [arrival, ...accessions];
    const second = await connector.collect({ ...input, cursor: first.cursor });
    assert.deepEqual(second.items.map((item) => item.accessionNumber), accessions.slice(3, 5));
    assert.equal(second.cursor.page_after.accession_number, accessions[4]);

    const third = await connector.collect({ ...input, cursor: second.cursor });
    assert.deepEqual(third.items.map((item) => item.accessionNumber), [accessions[5]]);
    assert.equal(third.cursor.high_water.accession_number, '0000001234-25-000005');
    assert.equal(third.cursor.page_after, undefined);

    const fourth = await connector.collect({ ...input, cursor: third.cursor });
    assert.deepEqual(fourth.items.map((item) => item.accessionNumber), [arrival]);
    assert.equal(fourth.cursor.high_water.accession_number, arrival);
    const processed = [...first.items, ...second.items, ...third.items, ...fourth.items].map((item) => item.accessionNumber);
    assert.deepEqual(new Set(processed), new Set(accessions));
  } finally {
    globalThis.fetch = original;
  }
});

test('NPPES fixes v2.1 and NPI-2 request shape, then advances bounded skip cursor', async () => {
  await withFetch({ result_count: 1, results: [{
    number: '1234567893', enumeration_type: 'NPI-2', last_updated_epoch: 1704067200,
    basic: { organization_name: 'Acme Health', status: 'A' },
    addresses: [{ address_purpose: 'LOCATION', city: 'Austin', state: 'TX', country_code: 'US' }],
    taxonomies: [{ code: '261Q00000X', desc: 'Clinic/Center', primary: true }]
  }] }, async (requested) => {
    const result = await new NppesConnector({ label: 'NPPES' }).run({
      organization_name: 'Acme Health', state: 'tx', limit: 1, cursor: { skip: 20 }
    });
    assert.equal(requested().url.origin, 'https://npiregistry.cms.hhs.gov');
    assert.equal(requested().url.searchParams.get('version'), '2.1');
    assert.equal(requested().url.searchParams.get('enumeration_type'), 'NPI-2');
    assert.equal(requested().url.searchParams.get('skip'), '20');
    assert.deepEqual(result.cursor, { skip: 21 });
    assert.equal(result.records[0].type, 'provider_profile');
    assert.deepEqual(detectSignals(result.records[0]), []);
  });
});

test('NPPES requires a target and validates state and cursor bounds', async () => {
  const connector = new NppesConnector({ label: 'NPPES' });
  await assert.rejects(connector.collect({}), { code: 'company_required' });
  await assert.rejects(connector.collect({ organization_name: 'Acme', state: 'Texas' }), { code: 'invalid_state' });
  await assert.rejects(connector.collect({ organization_name: 'Acme', cursor: { skip: 1001 } }), { code: 'invalid_connector_skip' });
});

test('USAspending sends a bounded award search, cursors pages, and yields the existing award signal', async () => {
  const today = new Date().toISOString().slice(0, 10);
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (url, options) => {
    const body = JSON.parse(options.body);
    requests.push({ url: new URL(url), options, body });
    const contract = body.filters.award_type_codes.includes('A');
    const results = contract ? [{
      'Award ID': 'CONT_AWARD_1', 'Recipient Name': 'Acme Federal', 'Award Amount': '75000',
      'Start Date': today, 'End Date': today, 'Award Type': null,
      'Awarding Agency': 'Department of Testing', generated_internal_id: 'CONT_AWARD_1_INTERNAL'
    }] : [{
      'Award ID': 'GRANT_1', 'Recipient Name': 'Acme Federal', 'Award Amount': 50000,
      'Start Date': today, 'End Date': today, 'Award Type': 'Project Grant',
      generated_internal_id: 'ASST_NON_1'
    }, {
      'Award ID': 'DUPLICATE', 'Recipient Name': 'Acme Federal', 'Award Amount': 50000,
      'Start Date': today, 'Award Type': 'Formula Grant', generated_internal_id: 'CONT_AWARD_1_INTERNAL'
    }];
    return new Response(JSON.stringify({ results, page_metadata: { hasNext: !contract, total: results.length } }), { status: 200 });
  };
  try {
    const result = await new UsaSpendingConnector({ label: 'USAspending' }).run({
      company: { name: 'Acme Federal' }, start_date: today, end_date: today, page: 2, limit: 2
    });
    assert.equal(requests.length, 2);
    assert.equal(result.usage.requests, 2);
    for (const request of requests) {
      assert.equal(request.url.href, 'https://api.usaspending.gov/api/v2/search/spending_by_award/');
      assert.equal(request.options.method, 'POST');
      assert.deepEqual(request.body.filters.recipient_search_text, ['Acme Federal']);
      assert.equal(request.body.page, 2);
      assert.equal(request.body.subawards, false);
      const codes = request.body.filters.award_type_codes;
      assert.ok(codes.every((code) => ['A', 'B', 'C', 'D'].includes(code))
        || codes.every((code) => ['02', '03', '04', '05'].includes(code)));
      assert.deepEqual(request.body.fields, ['Award ID', 'Recipient Name', 'Start Date', 'End Date', 'Award Amount', 'Awarding Agency', 'Awarding Sub Agency', 'Award Type']);
    }
    assert.deepEqual(result.cursor, { grant_page: 3 });
    assert.deepEqual(result.records.map((record) => record.type), ['contract_award', 'grant_award']);
    assert.equal(result.records[0].attributes.amount, 75000);
    assert.equal(result.records[0].title, 'Acme Federal — Federal contract award');
    assert.equal(detectSignals(result.records[0])[0].key, 'contract_award');
    assert.equal(new Set(result.records.map((record) => record.external_id)).size, 2);
    requests.length = 0;
    const continuation = await new UsaSpendingConnector({ label: 'USAspending' }).collect({
      company: { name: 'Acme Federal' }, start_date: today, end_date: today, cursor: result.cursor, limit: 2
    });
    assert.equal(requests.length, 1);
    assert.ok(requests[0].body.filters.award_type_codes.every((code) => ['02', '03', '04', '05'].includes(code)));
    assert.deepEqual(continuation.cursor, { grant_page: 4 });
    assert.equal(continuation.usage.requests, 1);
  } finally {
    globalThis.fetch = original;
  }
});

test('USAspending rejects unknown award types instead of guessing', () => {
  const connector = new UsaSpendingConnector({ label: 'USAspending' });
  assert.throws(() => connector.normalize({
    'Award ID': 'LOAN-1', 'Award Type Code': '07', 'Award Amount': 100000
  }, { company: { name: 'Acme' } }), { code: 'unsupported_award_type' });
  assert.throws(() => connector.normalize({
    'Award ID': 'MISMATCH-1', 'Award Type': 'Project Grant', 'Award Amount': 100000, _radar_award_group: 'contract'
  }, { company: { name: 'Acme' } }), { code: 'award_type_group_mismatch' });
  const providerSpecificLabel = connector.normalize({
    'Award ID': 'CONTRACT-1', 'Award Type': 'Other Contract Display', 'Award Amount': 100000, _radar_award_group: 'contract'
  }, { company: { name: 'Acme' } });
  assert.equal(providerSpecificLabel.type, 'contract_award');
});
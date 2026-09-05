import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './helpers/database.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { createCompany } from '../src/services/entities.js';
import { exportCompaniesCsv, listCompanies } from '../src/services/queries.js';
import { config } from '../src/config.js';

function setup() {
  const db = openTestDatabase();
  bootstrap(db);
  return db;
}

function seed(db, tenantId, input, identity = 'unreviewed') {
  const company = createCompany(db, tenantId, input);
  db.run('UPDATE companies SET identity_review_status=?, opportunity_score=72, opportunity_tier=? WHERE id=?', [identity, 'hot', company.id]);
  return company;
}

function exportedNames(csv) {
  return csv.split('\r\n').slice(1).map((line) => line.split(',')[0]);
}

test('CSV export matches combined search, stage, identity, and tier filters across list pages', () => {
  const db = setup();
  const tenantId = config.defaultTenantId;
  try {
    seed(db, tenantId, { name: 'Acme One', domain: 'acme-one.test', status: 'contacted', industry: 'Retail' }, 'needs_review');
    seed(db, tenantId, { name: 'Acme Two', domain: 'acme-two.test', status: 'contacted', industry: 'Retail' }, 'needs_review');
    seed(db, tenantId, { name: 'Acme Confirmed', domain: 'acme-confirmed.test', status: 'contacted', industry: 'Retail' }, 'confirmed');
    seed(db, tenantId, { name: 'Acme Prospect', domain: 'acme-prospect.test', industry: 'Retail' }, 'needs_review');
    seed(db, tenantId, { name: 'Other Account', domain: 'other-account.test', status: 'contacted', industry: 'Retail' }, 'needs_review');
    const query = { q: 'ACME', tier: 'hot', status: 'contacted', identity_review_status: 'needs_review', industry: 'Retail', min_score: '70', page: '1', limit: '1' };
    const first = listCompanies(db, tenantId, query);
    const second = listCompanies(db, tenantId, { ...query, page: '2' });
    assert.equal(first.total, 2);
    assert.equal(first.data.length, 1);
    assert.deepEqual(exportedNames(exportCompaniesCsv(db, tenantId, query)), [...first.data, ...second.data].map((row) => row.name));
  } finally { db.close(); }
});

test('CSV search uses literal wildcard characters and preserves tenant isolation', () => {
  const db = setup();
  const tenantId = config.defaultTenantId;
  try {
    seed(db, tenantId, { name: '100%_Match', domain: 'literal-match.test', city: 'Boston' });
    seed(db, tenantId, { name: '100XXMatch', domain: 'wildcard-decoy.test', city: 'Denver' });
    db.run(`INSERT INTO tenants(id,name,slug,created_at,updated_at) VALUES ('export-other','Other','export-other',?,?)`, [new Date().toISOString(), new Date().toISOString()]);
    seed(db, 'export-other', { name: '100%_Other Tenant', domain: 'private.test', city: 'Boston' });
    for (const q of ['%_', 'BOSTON', 'literal-match.test']) {
      assert.deepEqual(exportedNames(exportCompaniesCsv(db, tenantId, { q })), ['100%_Match']);
      assert.equal(listCompanies(db, tenantId, { q }).total, 1);
    }
    assert.deepEqual(exportedNames(exportCompaniesCsv(db, tenantId, { q: "' OR 1=1 --" })), []);
  } finally { db.close(); }
});

test('CSV and list reject the same invalid identity and score filters', () => {
  const db = setup();
  try {
    for (const query of [{ identity_review_status: 'invalid' }, { min_score: 'NaN' }, { min_score: 101 }]) {
      for (const read of [listCompanies, exportCompaniesCsv]) {
        assert.throws(() => read(db, config.defaultTenantId, query), (error) => error.status === 400);
      }
    }
  } finally { db.close(); }
});

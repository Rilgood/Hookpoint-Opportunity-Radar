import http from 'node:http';
import test from 'node:test';
import assert from 'node:assert/strict';
import { openTestDatabase } from './helpers/database.js';
import { createApp } from '../src/app.js';
import { config } from '../src/config.js';
import { bootstrap } from '../src/services/bootstrap.js';
import { createCompany, mergeCompanies, separateCompany, upsertPeople } from '../src/services/entities.js';
import { ingestOne } from '../src/services/ingestion.js';
import { companyDetail } from '../src/services/queries.js';

function setup() {
  const db = openTestDatabase();
  bootstrap(db);
  return db;
}

async function startApp(db) {
  const server = http.createServer(createApp(db, { serveStaticAssets: false }));
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address();
  return {
    request(path, body) {
      return fetch(`http://127.0.0.1:${port}${path}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
      });
    },
    close: () => new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve())),
  };
}

test('merging accounts retains aliases, contacts, observations, signal evidence, and both recommendation contexts', () => {
  const db = setup();
  const tenantId = config.defaultTenantId;
  const source = createCompany(db, tenantId, { name: 'Source Identity', domain: 'source-identity.test', crm_id: 'source-crm' });
  const target = createCompany(db, tenantId, { name: 'Target Identity', domain: 'target-identity.test', crm_id: 'target-crm' });
  const observedAt = new Date().toISOString();

  ingestOne(db, tenantId, {
    company: { name: source.name, domain: source.domain },
    source: 'source_feed', external_id: 'source-observation', type: 'product_launch',
    title: 'Source launched a product', observed_at: observedAt, attributes: { is_new: true },
  });
  ingestOne(db, tenantId, {
    company: { name: target.name, domain: target.domain },
    source: 'target_feed', external_id: 'target-observation', type: 'product_launch',
    title: 'Target launched a product', observed_at: observedAt, attributes: { is_new: true },
  });
  upsertPeople(db, tenantId, source.id, [{ full_name: 'Source Contact', external_id: 'source-contact' }], 'source_crm');
  upsertPeople(db, tenantId, target.id, [{ full_name: 'Target Contact', external_id: 'target-contact' }], 'target_crm');
  const targetRecommendation = db.get('SELECT id FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, target.id]);
  assert.ok(targetRecommendation, 'target has a recommendation before the merge');
  const sourceRecommendation = db.get('SELECT * FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, source.id]);
  assert.ok(sourceRecommendation, 'source has a recommendation before the merge');
  const sourceProofPoints = [{ label: 'Source proof point', summary: 'Source proof that must survive.' }];
  db.run(`UPDATE recommendations SET rationale=?, proof_points_json=? WHERE id=?`,
    ['Source rationale that must survive the merge.', JSON.stringify(sourceProofPoints), sourceRecommendation.id]);

  assert.throws(
    () => mergeCompanies(db, tenantId, source.id, { target_company_id: target.id }),
    { code: 'merge_confirmation_required' },
  );
  assert.equal(db.get('SELECT COUNT(*) count FROM companies WHERE id=?', [source.id]).count, 1);

  const result = db.transaction(() => mergeCompanies(
    db, tenantId, source.id, { target_company_id: target.id, confirmed: true, note: 'Reviewed duplicate accounts' }, 'reviewer@example.test',
  ));

  assert.deepEqual(result, { source_company_id: source.id, target_company_id: target.id, merged: true });
  assert.equal(db.get('SELECT id FROM companies WHERE id=?', [source.id]), undefined);
  assert.equal(db.get('SELECT COUNT(*) count FROM company_aliases WHERE tenant_id=? AND company_id=?', [tenantId, target.id]).count, 6);
  assert.equal(db.get('SELECT COUNT(*) count FROM people WHERE tenant_id=? AND company_id=?', [tenantId, target.id]).count, 2);
  assert.equal(db.get('SELECT COUNT(*) count FROM observations WHERE tenant_id=? AND company_id=?', [tenantId, target.id]).count, 2);
  assert.equal(db.get('SELECT COUNT(*) count FROM signals WHERE tenant_id=? AND company_id=?', [tenantId, target.id]).count, 1);
  assert.equal(db.get('SELECT COUNT(*) count FROM signal_evidence WHERE signal_id=(SELECT id FROM signals WHERE company_id=? AND signal_key=?)', [target.id, 'product_launch']).count, 2);
  assert.equal(db.get('SELECT id FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, target.id]).id, targetRecommendation.id);
  assert.equal(db.get('SELECT COUNT(*) count FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, source.id]).count, 0);
  assert.equal(db.get('SELECT COUNT(*) count FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, target.id]).count, 1);
  const detail = companyDetail(db, tenantId, target.id);
  assert.equal(detail.recommendation.id, targetRecommendation.id);
  assert.deepEqual(detail.merged_recommendation_contexts.map(({ merged_at, ...context }) => context), [{
    source_company_id: source.id,
    source_name: source.name,
    source_recommendation_id: sourceRecommendation.id,
    offer: sourceRecommendation.offer,
    headline: sourceRecommendation.headline,
    rationale: 'Source rationale that must survive the merge.',
    outreach_angle: sourceRecommendation.outreach_angle,
    proof_points: sourceProofPoints,
    next_action: sourceRecommendation.next_action,
    generated_by: sourceRecommendation.generated_by,
    created_at: sourceRecommendation.created_at,
    updated_at: sourceRecommendation.updated_at,
  }]);

  const mergeAudit = db.get('SELECT * FROM identity_review_actions WHERE tenant_id=? AND company_id=? AND action=?', [tenantId, source.id, 'identity.merged']);
  assert.equal(mergeAudit.actor, 'reviewer@example.test');
  assert.equal(mergeAudit.note, 'Reviewed duplicate accounts');
  assert.equal(JSON.parse(mergeAudit.details_json).target_company_id, target.id);
  assert.equal(db.get('SELECT action FROM identity_review_actions WHERE tenant_id=? AND company_id=?', [tenantId, target.id]).action, 'identity.merge_received');
  db.close();
});

test('separating an identity moves only reviewer-selected aliases and keeps the source evidence in place', () => {
  const db = setup();
  const tenantId = config.defaultTenantId;
  const source = createCompany(db, tenantId, {
    name: 'Combined Identity', domain: 'combined-identity.test', crm_id: 'combined-crm',
    linkedin_url: 'https://www.linkedin.com/company/combined-identity',
  });
  const selectedAliases = db.all(`SELECT id, alias_type FROM company_aliases
    WHERE tenant_id=? AND company_id=? AND alias_type IN ('crm_id', 'linkedin_url')`, [tenantId, source.id]);
  const selectedIds = selectedAliases.map((alias) => alias.id);
  ingestOne(db, tenantId, {
    company: { name: source.name, domain: source.domain },
    source: 'separation_evidence', external_id: 'source-evidence', type: 'news',
    title: 'Evidence remains with original identity', observed_at: new Date().toISOString(),
  });

  assert.throws(
    () => separateCompany(db, tenantId, source.id, { name: 'Separated Identity', alias_ids: selectedIds }),
    { code: 'split_confirmation_required' },
  );

  const result = db.transaction(() => separateCompany(
    db, tenantId, source.id, { name: 'Separated Identity', alias_ids: selectedIds, confirmed: true, note: 'Reviewed distinct business unit' }, 'reviewer@example.test',
  ));
  const sourceAliases = db.all('SELECT alias_type FROM company_aliases WHERE tenant_id=? AND company_id=? ORDER BY alias_type', [tenantId, source.id]);
  const separatedAliases = db.all('SELECT alias_type FROM company_aliases WHERE tenant_id=? AND company_id=? ORDER BY alias_type', [tenantId, result.separated_company_id]);

  assert.deepEqual(sourceAliases.map((alias) => alias.alias_type), ['domain', 'name']);
  assert.deepEqual(separatedAliases.map((alias) => alias.alias_type), ['crm_id', 'linkedin_url', 'name']);
  assert.deepEqual(
    db.all('SELECT id FROM company_aliases WHERE tenant_id=? AND company_id=? AND alias_type IN (\'crm_id\', \'linkedin_url\') ORDER BY id', [tenantId, result.separated_company_id]).map((alias) => alias.id),
    [...selectedIds].sort(),
  );
  assert.equal(db.get('SELECT COUNT(*) count FROM observations WHERE tenant_id=? AND company_id=?', [tenantId, source.id]).count, 1);
  assert.equal(db.get('SELECT identity_review_status FROM companies WHERE id=?', [source.id]).identity_review_status, 'separated');
  assert.equal(db.get('SELECT identity_review_status FROM companies WHERE id=?', [result.separated_company_id]).identity_review_status, 'needs_review');
  assert.equal(db.get('SELECT action FROM identity_review_actions WHERE tenant_id=? AND company_id=?', [tenantId, source.id]).action, 'identity.separated');
  assert.equal(db.get('SELECT action FROM identity_review_actions WHERE tenant_id=? AND company_id=?', [tenantId, result.separated_company_id]).action, 'identity.separation_created');
  db.close();
});

test('identity review endpoints require confirmation and write reviewer audit records after a confirmed action', async () => {
  const db = setup();
  const tenantId = config.defaultTenantId;
  const source = createCompany(db, tenantId, { name: 'HTTP Source', domain: 'http-source.test' });
  const target = createCompany(db, tenantId, { name: 'HTTP Target', domain: 'http-target.test' });
  const app = await startApp(db);

  try {
    const rejected = await app.request(`/api/v1/companies/${source.id}/identity/merge`, { target_company_id: target.id });
    assert.equal(rejected.status, 400);
    assert.equal((await rejected.json()).error.code, 'merge_confirmation_required');
    assert.equal(db.get("SELECT COUNT(*) count FROM audit_events WHERE action='identity.merged'").count, 0);

    const merged = await app.request(`/api/v1/companies/${source.id}/identity/merge`, {
      target_company_id: target.id, confirmed: true, note: 'Approved by reviewer',
    });
    assert.equal(merged.status, 200);
    const audit = db.get("SELECT * FROM audit_events WHERE tenant_id=? AND action='identity.merged'", [tenantId]);
    assert.equal(audit.actor, 'local-development');
    assert.equal(audit.resource_id, source.id);
    assert.equal(JSON.parse(audit.details_json).target_company_id, target.id);
    assert.equal(db.get("SELECT actor FROM identity_review_actions WHERE company_id=? AND action='identity.merged'", [source.id]).actor, 'local-development');
  } finally {
    await app.close();
    db.close();
  }
});
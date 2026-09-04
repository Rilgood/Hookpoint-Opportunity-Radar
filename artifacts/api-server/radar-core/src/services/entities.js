import { AppError, clamp, id, normalizeDomain, normalizeName, nowIso, safeHttpUrl } from '../lib.js';

const companyFields = [
  'name', 'domain', 'website_url', 'linkedin_url', 'industry', 'subindustry', 'employee_count',
  'size_band', 'annual_revenue', 'city', 'state', 'country', 'status', 'monitoring_tier',
  'owner_name', 'crm_id'
];
const companyStatuses = new Set(['prospect','accepted','rejected','contacted','replied','meeting','opportunity','customer','lost','disqualified']);
const closedStatuses = new Set(['rejected','customer','lost','disqualified']);
const monitoringTiers = new Set(['universe','qualified','watchlist','hot']);

export function resolveCompany(db, tenantId, input = {}, source = 'manual') {
  const identity = normalizeIdentity(input);
  if (!identity.name && !identity.domain) throw new AppError(400, 'company_identity_required', 'Company name or domain is required.');

  let existing;
  let method;
  let confidence;
  if (identity.crm_id) {
    existing = db.get(`SELECT c.* FROM companies c LEFT JOIN company_aliases a ON a.company_id=c.id AND a.tenant_id=c.tenant_id
      WHERE c.tenant_id=? AND (c.crm_id=? OR (a.alias_type='crm_id' AND a.normalized_value=?)) LIMIT 1`,
    [tenantId, identity.crm_id, identity.crm_id.toLowerCase()]);
    if (existing) { method = existing.crm_id === identity.crm_id ? 'crm_id_exact' : 'crm_id_alias'; confidence = 1; }
  }
  if (!existing && identity.domain) {
    existing = db.get(`SELECT c.* FROM companies c LEFT JOIN company_aliases a ON a.company_id=c.id AND a.tenant_id=c.tenant_id
      WHERE c.tenant_id=? AND (c.domain=? OR (a.alias_type='domain' AND a.normalized_value=?)) LIMIT 1`, [tenantId, identity.domain, identity.domain]);
    if (existing) { method = existing.domain === identity.domain ? 'domain_exact' : 'domain_alias'; confidence = existing.domain === identity.domain ? 0.99 : 0.96; }
  }
  if (!existing && identity.linkedin_url) {
    existing = db.get(`SELECT c.* FROM companies c LEFT JOIN company_aliases a ON a.company_id=c.id AND a.tenant_id=c.tenant_id
      WHERE c.tenant_id=? AND (c.linkedin_url=? OR (a.alias_type='linkedin_url' AND a.normalized_value=?)) LIMIT 1`, [tenantId, identity.linkedin_url, identity.linkedin_url.toLowerCase()]);
    if (existing) { method = 'linkedin_url_exact'; confidence = 0.98; }
  }
  if (!existing && identity.name) {
    const normalizedName = normalizeName(identity.name);
    const candidates = db.all(`SELECT DISTINCT c.*,
        EXISTS(SELECT 1 FROM company_source_identities source_identity WHERE source_identity.tenant_id=c.tenant_id
          AND source_identity.company_id=c.id AND source_identity.identity_type='name'
          AND source_identity.normalized_value=? AND source_identity.source=?) source_name_match
      FROM companies c LEFT JOIN company_aliases a ON a.company_id=c.id AND a.tenant_id=c.tenant_id
      WHERE c.tenant_id=? AND (c.normalized_name=? OR (a.alias_type='name' AND a.normalized_value=?))`,
      [normalizedName, source, tenantId, normalizedName, normalizedName]);
    const located = candidates.filter((candidate) => locationAgreement(candidate, identity));
    if (located.length === 1) { existing = located[0]; method = 'name_location'; confidence = 0.88; }
    else {
      const sourceMatches = candidates.filter((candidate) => candidate.source_name_match);
      if (sourceMatches.length === 1) { existing = sourceMatches[0]; method = 'source_name_exact'; confidence = 0.76; }
    }
  }

  if (existing) {
    const canonicalDomain = method === 'domain_alias' ? existing.domain : identity.domain || existing.domain;
    const company = updateCompany(db, tenantId, existing.id, { ...input, domain: canonicalDomain }, { source, identityMethod: method, identityConfidence: confidence, mergeMode: 'enrichment' });
    recordResolution(db, tenantId, company.id, source, method, confidence, identity);
    return company;
  }
  const newMethod = identity.domain ? 'new_domain' : 'new_unverified';
  const newConfidence = identity.domain ? 0.92 : 0.5;
  const company = createCompany(db, tenantId, { ...input, domain: identity.domain }, { source, identityMethod: newMethod, identityConfidence: newConfidence, mergeMode: 'enrichment' });
  recordResolution(db, tenantId, company.id, source, newMethod, newConfidence, identity);
  return company;
}

export function createCompany(db, tenantId, input = {}, options = {}) {
  const clean = validateCompanyInput(input, { creating: true });
  const now = nowIso();
  const companyId = id('co');
  const name = clean.name || clean.domain;
  const manualIdentity = identityFromFields(clean);
  try {
    db.run(
      `INSERT INTO companies(
        id, tenant_id, name, normalized_name, domain, website_url, linkedin_url, industry, subindustry,
        employee_count, size_band, annual_revenue, city, state, country, status, monitoring_tier,
        fit_score, owner_name, crm_id, next_refresh_at, identity_confidence, identity_method, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [companyId, tenantId, name, normalizeName(name), clean.domain || null, clean.website_url || (clean.domain ? `https://${clean.domain}` : null),
        clean.linkedin_url || null, clean.industry || 'Unknown', clean.subindustry || null, clean.employee_count ?? null,
        clean.size_band || sizeBand(clean.employee_count), clean.annual_revenue ?? null, clean.city || null, clean.state || null,
        clean.country || null, options.mergeMode === 'enrichment' ? 'prospect' : clean.status || 'prospect',
        options.mergeMode === 'enrichment' ? 'universe' : clean.monitoring_tier || 'universe', 30,
        options.mergeMode === 'enrichment' ? null : clean.owner_name || null, clean.crm_id || null, now, options.identityConfidence ?? manualIdentity.confidence,
        options.identityMethod || manualIdentity.method, now, now]
    );
  } catch (error) {
    if (String(error.message).includes('UNIQUE constraint failed')) throw new AppError(409, 'company_conflict', 'A company with this identity already exists.');
    throw error;
  }
  addAliases(db, tenantId, companyId, clean, options.source || 'manual');
  return db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
}

export function confirmIdentity(db, tenantId, companyId, input = {}, actor = 'operator') {
  const company = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!company) throw new AppError(404, 'company_not_found', 'Company not found.');
  const identityType = String(input.identity_type || '');
  if (!['domain', 'crm_id', 'linkedin_url'].includes(identityType)) {
    throw new AppError(400, 'invalid_identity_type', 'identity_type must be domain, crm_id, or linkedin_url.');
  }
  const value = input.value;
  if (typeof value !== 'string' || !value.trim()) throw new AppError(400, 'identity_value_required', 'An authoritative identity value is required.');
  const updated = updateCompany(db, tenantId, companyId, { [identityType]: value }, {
    actor, source: 'identity_review', identityConfidence: 1, identityMethod: `reviewed_${identityType}`
  });
  setReviewStatus(db, tenantId, companyId, 'confirmed');
  recordReviewAction(db, tenantId, companyId, 'identity.confirmed', actor, input.note, { identity_type: identityType, value: updated[identityType] });
  return db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
}

export function mergeCompanies(db, tenantId, sourceCompanyId, input = {}, actor = 'operator') {
  if (input.confirmed !== true) throw new AppError(400, 'merge_confirmation_required', 'Set confirmed to true to merge accounts.');
  const targetCompanyId = String(input.target_company_id || '');
  if (!targetCompanyId || targetCompanyId === sourceCompanyId) throw new AppError(400, 'invalid_merge_target', 'Choose a different target account.');
  const source = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, sourceCompanyId]);
  const target = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, targetCompanyId]);
  if (!source || !target) throw new AppError(404, 'company_not_found', 'Both accounts must exist.');

  const sourceSignals = db.all('SELECT id, signal_key FROM signals WHERE tenant_id=? AND company_id=?', [tenantId, sourceCompanyId]);
  for (const signal of sourceSignals) {
    const duplicate = db.get('SELECT id FROM signals WHERE tenant_id=? AND company_id=? AND signal_key=?', [tenantId, targetCompanyId, signal.signal_key]);
    if (duplicate) {
      db.run(`INSERT OR IGNORE INTO signal_evidence(signal_id, observation_id, source, linked_at)
        SELECT ?, observation_id, source, linked_at FROM signal_evidence WHERE signal_id=?`, [duplicate.id, signal.id]);
      db.run('DELETE FROM signals WHERE id=?', [signal.id]);
    }
  }
  moveRows(db, 'people', tenantId, sourceCompanyId, targetCompanyId, ['source', 'external_id']);
  moveRows(db, 'observations', tenantId, sourceCompanyId, targetCompanyId, ['source', 'content_hash']);
  db.run('UPDATE signals SET company_id=? WHERE tenant_id=? AND company_id=?', [targetCompanyId, tenantId, sourceCompanyId]);
  for (const table of ['lead_events', 'outcomes', 'score_snapshots']) db.run(`UPDATE ${table} SET company_id=? WHERE tenant_id=? AND company_id=?`, [targetCompanyId, tenantId, sourceCompanyId]);
  const targetRecommendation = db.get('SELECT id FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, targetCompanyId]);
  const sourceRecommendation = db.get('SELECT * FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, sourceCompanyId]);
  if (targetRecommendation) db.run('DELETE FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, sourceCompanyId]);
  else db.run('UPDATE recommendations SET company_id=? WHERE tenant_id=? AND company_id=?', [targetCompanyId, tenantId, sourceCompanyId]);
  const aliases = db.all('SELECT * FROM company_aliases WHERE tenant_id=? AND company_id=?', [tenantId, sourceCompanyId]);
  for (const alias of aliases) {
    const exists = db.get('SELECT id FROM company_aliases WHERE tenant_id=? AND alias_type=? AND normalized_value=? AND company_id<>?', [tenantId, alias.alias_type, alias.normalized_value, sourceCompanyId]);
    if (exists) db.run('DELETE FROM company_aliases WHERE id=?', [alias.id]);
    else db.run('UPDATE company_aliases SET company_id=? WHERE id=?', [targetCompanyId, alias.id]);
  }
  db.run(`INSERT OR IGNORE INTO company_source_identities(id, tenant_id, company_id, source, identity_type, normalized_value, created_at)
    SELECT id, tenant_id, ?, source, identity_type, normalized_value, created_at FROM company_source_identities WHERE tenant_id=? AND company_id=?`, [targetCompanyId, tenantId, sourceCompanyId]);
  db.run('DELETE FROM company_source_identities WHERE tenant_id=? AND company_id=?', [tenantId, sourceCompanyId]);
  recordReviewAction(db, tenantId, sourceCompanyId, 'identity.merged', actor, input.note, { target_company_id: targetCompanyId, source_name: source.name });
  recordReviewAction(db, tenantId, targetCompanyId, 'identity.merge_received', actor, input.note, {
    source_company_id: sourceCompanyId,
    source_name: source.name,
    source_recommendation: targetRecommendation && sourceRecommendation ? recommendationContext(sourceRecommendation) : null
  });
  db.run('DELETE FROM companies WHERE tenant_id=? AND id=?', [tenantId, sourceCompanyId]);
  setReviewStatus(db, tenantId, targetCompanyId, 'confirmed');
  return { source_company_id: sourceCompanyId, target_company_id: targetCompanyId, merged: true };
}

export function separateCompany(db, tenantId, companyId, input = {}, actor = 'operator') {
  if (input.confirmed !== true) throw new AppError(400, 'split_confirmation_required', 'Set confirmed to true to separate account identities.');
  const source = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!source) throw new AppError(404, 'company_not_found', 'Company not found.');
  const aliasIds = Array.isArray(input.alias_ids) ? [...new Set(input.alias_ids.map(String))].slice(0, 20) : [];
  if (!aliasIds.length || !String(input.name || '').trim()) throw new AppError(400, 'split_identity_required', 'Provide a name and at least one alias to separate.');
  const placeholders = aliasIds.map(() => '?').join(',');
  const aliases = db.all(`SELECT * FROM company_aliases WHERE tenant_id=? AND company_id=? AND id IN (${placeholders})`, [tenantId, companyId, ...aliasIds]);
  if (aliases.length !== aliasIds.length) throw new AppError(400, 'invalid_split_aliases', 'Every selected alias must belong to this account.');
  const separated = createCompany(db, tenantId, { name: input.name, city: source.city, state: source.state, country: source.country, industry: source.industry }, { source: 'identity_review' });
  for (const alias of aliases) db.run('UPDATE company_aliases SET company_id=? WHERE id=?', [separated.id, alias.id]);
  const fields = {};
  for (const alias of aliases) if (['domain', 'crm_id', 'linkedin_url'].includes(alias.alias_type)) fields[alias.alias_type] = alias.alias_value;
  if (Object.keys(fields).length) updateCompany(db, tenantId, separated.id, fields, { source: 'identity_review', identityConfidence: 0.85, identityMethod: 'reviewed_separation' });
  setReviewStatus(db, tenantId, companyId, 'separated');
  setReviewStatus(db, tenantId, separated.id, 'needs_review');
  recordReviewAction(db, tenantId, companyId, 'identity.separated', actor, input.note, { separated_company_id: separated.id, alias_ids: aliasIds });
  recordReviewAction(db, tenantId, separated.id, 'identity.separation_created', actor, input.note, { source_company_id: companyId, alias_ids: aliasIds });
  return { source_company_id: companyId, separated_company_id: separated.id, separated: true };
}

export function updateCompany(db, tenantId, companyId, input = {}, options = {}) {
  const current = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!current) throw new AppError(404, 'company_not_found', 'Company not found.');
  const clean = validateCompanyInput(input, { creating: false });
  const updates = {};
  for (const field of companyFields) {
    if (!Object.hasOwn(clean, field)) continue;
    if (options.mergeMode !== 'enrichment' || shouldEnrich(field, current, clean[field])) updates[field] = clean[field];
  }
  if (updates.name) updates.normalized_name = normalizeName(updates.name);
  if (updates.employee_count !== undefined && !updates.size_band) updates.size_band = sizeBand(updates.employee_count);
  if (options.identityConfidence != null && Number(options.identityConfidence) > Number(current.identity_confidence || 0)) {
    updates.identity_confidence = clamp(options.identityConfidence, 0, 1);
    updates.identity_method = options.identityMethod || current.identity_method;
  } else if (options.mergeMode !== 'enrichment') {
    const manualIdentity = identityFromFields(clean);
    if (manualIdentity.confidence > Number(current.identity_confidence || 0)) {
      updates.identity_confidence = manualIdentity.confidence;
      updates.identity_method = manualIdentity.method;
    }
  }
  if (Object.keys(updates).length) {
    updates.updated_at = nowIso();
    const names = Object.keys(updates);
    try {
      db.run(`UPDATE companies SET ${names.map((key) => `${key}=?`).join(', ')} WHERE tenant_id=? AND id=?`, [...names.map((key) => updates[key]), tenantId, companyId]);
    } catch (error) {
      if (String(error.message).includes('UNIQUE constraint failed')) throw new AppError(409, 'company_conflict', 'The updated company identity conflicts with another company.');
      throw error;
    }
    if (closedStatuses.has(updates.status)) db.run('DELETE FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, companyId]);
    if (updates.status && updates.status !== current.status) db.run(`INSERT INTO lead_events(
      id, tenant_id, company_id, event_type, from_value, to_value, actor, occurred_at
    ) VALUES (?, ?, ?, 'workflow_status_changed', ?, ?, ?, ?)`,
    [id('evt'), tenantId, companyId, current.status, updates.status, String(options.actor || 'operator').slice(0, 200), nowIso()]);
  }
  addAliases(db, tenantId, companyId, clean, options.source || 'manual');
  return db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
}

export function deleteCompany(db, tenantId, companyId) {
  const company = db.get('SELECT id, name FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!company) throw new AppError(404, 'company_not_found', 'Company not found.');
  // The people foreign key is intentionally SET NULL for ordinary relationship
  // changes; an explicit privacy deletion must remove associated contacts too.
  db.run('DELETE FROM people WHERE tenant_id=? AND company_id=?', [tenantId, companyId]);
  db.run('DELETE FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  return { id: companyId, deleted: true };
}

export function upsertPeople(db, tenantId, companyId, people = [], source = 'manual') {
  const now = nowIso();
  let count = 0;
  for (const candidate of people.slice(0, 500)) {
    if (!candidate || typeof candidate !== 'object' || !String(candidate.full_name || '').trim()) continue;
    const fullName = text(candidate.full_name, 200);
    const title = nullableText(candidate.title, 200);
    const externalId = text(candidate.external_id || `${companyId}:${normalizeName(fullName)}:${normalizeName(title || '')}`, 500);
    const suppliedConfidence = Number(candidate.confidence ?? 0.7);
    const confidence = Number.isFinite(suppliedConfidence) ? clamp(suppliedConfidence, 0.05, 1) : 0.5;
    const linkedinUrl = candidate.linkedin_url ? normalizeLinkedInUrl(candidate.linkedin_url) : null;
    const email = normalizeEmail(candidate.email);
    const decisionMaker = candidate.is_decision_maker === true || candidate.is_decision_maker === 1 || String(candidate.is_decision_maker).toLowerCase() === 'true';
    db.run(`INSERT INTO people(id, tenant_id, company_id, full_name, title, seniority, department, email, linkedin_url, phone,
        is_decision_maker, confidence, source, external_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(tenant_id, source, external_id) DO UPDATE SET company_id=excluded.company_id, full_name=excluded.full_name,
        title=excluded.title, seniority=excluded.seniority, department=excluded.department, email=excluded.email,
        linkedin_url=excluded.linkedin_url, phone=excluded.phone, is_decision_maker=excluded.is_decision_maker,
        confidence=excluded.confidence, updated_at=excluded.updated_at`,
      [id('person'), tenantId, companyId, fullName, title, nullableText(candidate.seniority, 100), nullableText(candidate.department, 100),
        email, linkedinUrl, nullableText(candidate.phone, 80), decisionMaker ? 1 : 0,
        confidence, text(source, 100), externalId, now, now]);
    count += 1;
  }
  return count;
}

function normalizeIdentity(input) {
  const suppliedDomain = input.domain || input.website_url || '';
  const domain = normalizeDomain(suppliedDomain);
  if (suppliedDomain && !domain) throw new AppError(400, 'invalid_domain', 'Company domain is invalid.');
  return {
    name: nullableText(input.name, 300), domain,
    linkedin_url: input.linkedin_url ? normalizeLinkedInUrl(input.linkedin_url) : null,
    crm_id: nullableText(input.crm_id, 300), city: nullableText(input.city, 150),
    state: nullableText(input.state, 150), country: nullableText(input.country, 100)
  };
}

function validateCompanyInput(input, { creating }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new AppError(400, 'invalid_company', 'Company must be an object.');
  const clean = {};
  const stringLimits = { name:300, industry:150, subindustry:150, size_band:50, city:150, state:150, country:100, owner_name:200, crm_id:300 };
  for (const [field, limit] of Object.entries(stringLimits)) if (input[field] !== undefined) clean[field] = input[field] == null ? null : text(input[field], limit);
  if (input.domain !== undefined || input.website_url !== undefined) {
    const supplied = input.domain || input.website_url;
    clean.domain = supplied ? normalizeDomain(supplied) : null;
    if (supplied && !clean.domain) throw new AppError(400, 'invalid_domain', 'Company domain is invalid.');
  }
  if (input.website_url !== undefined) clean.website_url = input.website_url ? safeHttpUrl(input.website_url) : null;
  if (input.linkedin_url !== undefined) clean.linkedin_url = input.linkedin_url ? normalizeLinkedInUrl(input.linkedin_url) : null;
  if (input.employee_count !== undefined) clean.employee_count = finiteNumber(input.employee_count, 'employee_count', { integer: true, min: 0, max: 10_000_000 });
  if (input.annual_revenue !== undefined) clean.annual_revenue = finiteNumber(input.annual_revenue, 'annual_revenue', { min: 0, max: 1e15 });
  if (input.status !== undefined) {
    if (!companyStatuses.has(input.status)) throw new AppError(400, 'invalid_company_status', 'Unsupported company status.');
    clean.status = input.status;
  }
  if (input.monitoring_tier !== undefined) {
    if (!monitoringTiers.has(input.monitoring_tier)) throw new AppError(400, 'invalid_monitoring_tier', 'Unsupported monitoring tier.');
    clean.monitoring_tier = input.monitoring_tier;
  }
  if (creating && !clean.name && !clean.domain) throw new AppError(400, 'company_name_required', 'Company name or domain is required.');
  return clean;
}

function addAliases(db, tenantId, companyId, values, source) {
  const aliases = { name: values.name, domain: values.domain, linkedin_url: values.linkedin_url, crm_id: values.crm_id };
  for (const [type, value] of Object.entries(aliases)) {
    if (!value) continue;
    const normalized = type === 'domain' ? normalizeDomain(value) : type === 'name' ? normalizeName(value) : String(value).trim().toLowerCase();
    const existing = db.get(`SELECT company_id FROM company_aliases WHERE tenant_id=? AND alias_type=? AND normalized_value=?`, [tenantId, type, normalized]);
    if (type !== 'name' && existing?.company_id && existing.company_id !== companyId) {
      throw new AppError(409, 'company_alias_conflict', `The supplied ${type.replaceAll('_', ' ')} is already assigned to another company.`);
    }
    if (!existing) db.run(`INSERT INTO company_aliases(id, tenant_id, company_id, alias_type, alias_value, normalized_value, source, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id('alias'), tenantId, companyId, type, String(value), normalized, source, nowIso()]);
    if (type === 'name') db.run(`INSERT OR IGNORE INTO company_source_identities(id, tenant_id, company_id, source, identity_type, normalized_value, created_at)
      VALUES (?, ?, ?, ?, 'name', ?, ?)`, [id('source_identity'), tenantId, companyId, String(source).slice(0, 100), normalized, nowIso()]);
  }
}

function recordResolution(db, tenantId, companyId, source, method, confidence, identity) {
  db.run(`INSERT INTO entity_resolution_events(id, tenant_id, company_id, source, method, confidence, incoming_name, incoming_domain, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id('resolve'), tenantId, companyId, String(source).slice(0, 100), method, confidence, identity.name, identity.domain || null, nowIso()]);
}

function setReviewStatus(db, tenantId, companyId, status) {
  db.run('UPDATE companies SET identity_review_status=?, updated_at=? WHERE tenant_id=? AND id=?', [status, nowIso(), tenantId, companyId]);
}
function recordReviewAction(db, tenantId, companyId, action, actor, note, details) {
  db.run(`INSERT INTO identity_review_actions(id, tenant_id, company_id, action, actor, note, details_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id('identity_review'), tenantId, companyId, action, String(actor).slice(0, 200),
    nullableText(note, 2_000), JSON.stringify(details || {}), nowIso()]);
}
function recommendationContext(recommendation) {
  return {
    source_recommendation_id: recommendation.id,
    offer: recommendation.offer,
    headline: recommendation.headline,
    rationale: recommendation.rationale,
    outreach_angle: recommendation.outreach_angle,
    proof_points: JSON.parse(recommendation.proof_points_json || '[]'),
    next_action: recommendation.next_action,
    generated_by: recommendation.generated_by,
    created_at: recommendation.created_at,
    updated_at: recommendation.updated_at
  };
}
function moveRows(db, table, tenantId, sourceCompanyId, targetCompanyId, uniqueColumns) {
  const rows = db.all(`SELECT id, ${uniqueColumns.join(', ')} FROM ${table} WHERE tenant_id=? AND company_id=?`, [tenantId, sourceCompanyId]);
  for (const row of rows) {
    const match = db.get(`SELECT id FROM ${table} WHERE tenant_id=? AND company_id=? AND ${uniqueColumns.map((column) => `${column}=?`).join(' AND ')}`, [tenantId, targetCompanyId, ...uniqueColumns.map((column) => row[column])]);
    if (match) db.run(`DELETE FROM ${table} WHERE id=?`, [row.id]);
    else db.run(`UPDATE ${table} SET company_id=? WHERE id=?`, [targetCompanyId, row.id]);
  }
}

function locationAgreement(candidate, identity) {
  const supplied = ['city','state','country'].filter((field) => identity[field]);
  return supplied.length > 0 && supplied.every((field) => candidate[field] && normalizeName(candidate[field]) === normalizeName(identity[field]));
}

function shouldEnrich(field, current, incoming) {
  if (['status','monitoring_tier','owner_name'].includes(field)) return false;
  if (['employee_count','annual_revenue','size_band'].includes(field)) return incoming != null;
  if (field === 'industry') return (!current.industry || current.industry === 'Unknown') && incoming && incoming !== 'Unknown';
  if (field === 'name') return (!current.name || current.name === current.domain) && Boolean(incoming);
  if (field === 'domain') return !current.domain && Boolean(incoming);
  return (current[field] == null || current[field] === '') && incoming != null && incoming !== '';
}

function finiteNumber(value, field, { integer = false, min = -Infinity, max = Infinity } = {}) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number) || number < min || number > max) throw new AppError(400, `invalid_${field}`, `${field} must be a finite number between ${min} and ${max}.`);
  return integer ? Math.round(number) : number;
}

function identityFromFields(values) {
  if (values.crm_id) return { confidence: 1, method: 'manual_crm_id' };
  if (values.domain) return { confidence: 0.98, method: 'manual_domain' };
  if (values.linkedin_url) return { confidence: 0.96, method: 'manual_linkedin_url' };
  if (values.name && (values.city || values.state)) return { confidence: 0.85, method: 'manual_name_location' };
  return { confidence: 0.5, method: 'manual_unverified' };
}

function normalizeLinkedInUrl(value) {
  const parsed = new URL(safeHttpUrl(value));
  const hostname = parsed.hostname.toLowerCase().replace(/^www\./, '');
  if (hostname !== 'linkedin.com' && !hostname.endsWith('.linkedin.com')) throw new AppError(400, 'invalid_linkedin_url', 'LinkedIn URLs must use a linkedin.com host.');
  const pathname = parsed.pathname.replace(/\/+$/, '') || '/';
  return `https://www.linkedin.com${pathname}`.slice(0, 2_000);
}

function normalizeEmail(value) {
  const email = nullableText(value, 320)?.toLowerCase() || null;
  return email && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : null;
}

function text(value, max) { return String(value ?? '').trim().slice(0, max); }
function nullableText(value, max) { const output = text(value, max); return output || null; }

function sizeBand(value) {
  const count = Number(value);
  if (!Number.isFinite(count) || count < 1) return null;
  if (count < 10) return '1-9';
  if (count < 50) return '10-49';
  if (count < 200) return '50-199';
  if (count < 1000) return '200-999';
  if (count < 5000) return '1,000-4,999';
  return '5,000+';
}

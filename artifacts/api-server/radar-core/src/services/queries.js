import { AppError, escapeCsv, json } from '../lib.js';
import { config } from '../config.js';

export function dashboardSummary(db, tenantId) {
  const counts = db.get(`SELECT
    COUNT(*) companies,
    SUM(CASE WHEN opportunity_tier='hot' AND status NOT IN ('rejected','customer','lost','disqualified') THEN 1 ELSE 0 END) hot,
    SUM(CASE WHEN opportunity_tier='warm' AND status NOT IN ('rejected','customer','lost','disqualified') THEN 1 ELSE 0 END) warm,
    SUM(CASE WHEN opportunity_tier='watch' AND status NOT IN ('rejected','customer','lost','disqualified') THEN 1 ELSE 0 END) watch,
    ROUND(AVG(opportunity_score), 1) average_score
    FROM companies WHERE tenant_id=?`, [tenantId]);
  const activeSignals = db.get(`SELECT COUNT(*) count FROM signals WHERE tenant_id=? AND status='active'`, [tenantId]);
  const newSignals = db.get(`SELECT COUNT(*) count FROM signals WHERE tenant_id=? AND status='active'
    AND last_seen_at >= strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 day')`, [tenantId]);
  const configured = db.get(`SELECT SUM(configured) configured, SUM(enabled) enabled, COUNT(*) total FROM connectors WHERE tenant_id=?`, [tenantId]);
  const topIndustries = db.all(`SELECT industry, COUNT(*) companies, ROUND(AVG(opportunity_score),1) average_score
    FROM companies WHERE tenant_id=? GROUP BY industry ORDER BY average_score DESC, companies DESC LIMIT 8`, [tenantId]);
  const tiers = db.all(`SELECT opportunity_tier tier, COUNT(*) count FROM companies
    WHERE tenant_id=? AND status NOT IN ('rejected','customer','lost','disqualified') GROUP BY opportunity_tier`, [tenantId]);
  return {
    companies: counts?.companies || 0,
    hot: counts?.hot || 0,
    warm: counts?.warm || 0,
    watch: counts?.watch || 0,
    average_score: counts?.average_score || 0,
    active_signals: activeSignals?.count || 0,
    new_signals_7d: newSignals?.count || 0,
    connectors: configured || { configured: 0, enabled: 0, total: 0 },
    top_industries: topIndustries,
    tiers
  };
}

export function listCompanies(db, tenantId, query = {}) {
  const page = positiveInteger(query.page, 1, 1_000_000);
  const limit = positiveInteger(query.limit, 50, 200);
  const where = ['tenant_id = ?'];
  const params = [tenantId];
  if (query.tier) { where.push('opportunity_tier = ?'); params.push(query.tier); }
  if (query.industry) { where.push('industry = ?'); params.push(query.industry); }
  if (query.monitoring_tier) { where.push('monitoring_tier = ?'); params.push(query.monitoring_tier); }
  if (query.status) { where.push('status = ?'); params.push(query.status); }
  if (query.min_score != null) {
    const score = Number(query.min_score);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new AppError(400, 'invalid_min_score', 'min_score must be between 0 and 100.');
    where.push('opportunity_score >= ?'); params.push(score);
  }
  if (query.q) {
    where.push(`(name LIKE ? ESCAPE '\\' OR domain LIKE ? ESCAPE '\\' OR industry LIKE ? ESCAPE '\\' OR city LIKE ? ESCAPE '\\')`);
    const needle = `%${escapeLike(String(query.q).slice(0, 100))}%`;
    params.push(needle, needle, needle, needle);
  }
  const allowedSort = new Set(['opportunity_score','updated_at','name','last_observed_at','fit_score']);
  const sort = allowedSort.has(query.sort) ? query.sort : 'opportunity_score';
  const direction = String(query.direction).toLowerCase() === 'asc' ? 'ASC' : 'DESC';
  const clause = where.join(' AND ');
  const total = db.get(`SELECT COUNT(*) count FROM companies WHERE ${clause}`, params)?.count || 0;
  const rows = db.all(`SELECT * FROM companies WHERE ${clause} ORDER BY ${sort} ${direction}, name ASC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  return { data: rows, page, limit, total, pages: Math.ceil(total / limit) };
}

export function companyDetail(db, tenantId, companyId) {
  const company = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!company) throw new AppError(404, 'company_not_found', 'Company not found.');
  const signals = db.all(`SELECT * FROM signals WHERE tenant_id=? AND company_id=? ORDER BY status='active' DESC, contribution DESC`, [tenantId, companyId]).map(parseSignal);
  const observations = db.all(`SELECT * FROM observations WHERE tenant_id=? AND company_id=? ORDER BY observed_at DESC LIMIT 100`, [tenantId, companyId]).map(parseObservation);
  const people = db.all(`SELECT * FROM people WHERE tenant_id=? AND company_id=? ORDER BY is_decision_maker DESC, confidence DESC`, [tenantId, companyId]);
  const recommendation = db.get(`SELECT * FROM recommendations WHERE tenant_id=? AND company_id=?`, [tenantId, companyId]);
  const events = db.all(`SELECT * FROM lead_events WHERE tenant_id=? AND company_id=? ORDER BY occurred_at DESC LIMIT 50`, [tenantId, companyId]);
  const outcomes = db.all(`SELECT * FROM outcomes WHERE tenant_id=? AND company_id=? ORDER BY occurred_at DESC LIMIT 50`, [tenantId, companyId]).map((row) => {
    const { metadata_json: metadataJson, ...outcome } = row;
    return { ...outcome, metadata: json(metadataJson) };
  });
  const scoreHistory = db.all(`SELECT * FROM score_snapshots WHERE tenant_id=? AND company_id=? ORDER BY computed_at DESC LIMIT 25`, [tenantId, companyId])
    .map((row) => { const { components_json: componentsJson, ...snapshot } = row; return { ...snapshot, components: json(componentsJson) }; });
  let parsedRecommendation = null;
  if (recommendation) {
    const { proof_points_json: proofPointsJson, ...fields } = recommendation;
    parsedRecommendation = { ...fields, proof_points: json(proofPointsJson, []) };
  }
  return { company, signals, observations, people, recommendation: parsedRecommendation, events, outcomes, score_history: scoreHistory };
}

export function listSignals(db, tenantId, query = {}) {
  const limit = positiveInteger(query.limit, 50, 200);
  const where = ['s.tenant_id=?'];
  const params = [tenantId];
  if (query.status) { where.push('s.status=?'); params.push(query.status); }
  if (query.category) { where.push('s.category=?'); params.push(query.category); }
  if (query.company_id) { where.push('s.company_id=?'); params.push(query.company_id); }
  return db.all(`SELECT s.*, c.name company_name, c.domain, c.opportunity_score, c.opportunity_tier
    FROM signals s JOIN companies c ON c.id=s.company_id AND c.tenant_id=s.tenant_id WHERE ${where.join(' AND ')}
    ORDER BY s.last_seen_at DESC, s.contribution DESC LIMIT ?`, [...params, limit]).map(parseSignal);
}

export function listConnectors(db, tenantId) {
  return db.all(`SELECT c.*, (SELECT COUNT(*) FROM connector_runs r WHERE r.tenant_id=c.tenant_id AND r.connector_key=c.connector_key) run_count
    FROM connectors c WHERE c.tenant_id=? ORDER BY c.configured DESC, c.category, c.label`, [tenantId]).map((row) => {
      const { config_json: configJson, ...connector } = row;
      return { ...connector, config: json(configJson), enabled: Boolean(row.enabled), configured: Boolean(row.configured) };
    });
}

export function exportCompaniesCsv(db, tenantId, query = {}) {
  const where = ['tenant_id=?'];
  const params = [tenantId];
  if (query.tier) { where.push('opportunity_tier=?'); params.push(query.tier); }
  if (query.industry) { where.push('industry=?'); params.push(query.industry); }
  if (query.status) { where.push('status=?'); params.push(query.status); }
  if (query.min_score != null) {
    const score = Number(query.min_score);
    if (!Number.isFinite(score) || score < 0 || score > 100) throw new AppError(400, 'invalid_min_score', 'min_score must be between 0 and 100.');
    where.push('opportunity_score>=?'); params.push(score);
  }
  const rows = db.all(`SELECT c.*,
      r.offer recommended_offer, r.next_action recommended_next_action,
      (SELECT p.full_name FROM people p WHERE p.tenant_id=c.tenant_id AND p.company_id=c.id ORDER BY p.is_decision_maker DESC, p.confidence DESC LIMIT 1) buyer_name,
      (SELECT p.title FROM people p WHERE p.tenant_id=c.tenant_id AND p.company_id=c.id ORDER BY p.is_decision_maker DESC, p.confidence DESC LIMIT 1) buyer_title,
      (SELECT p.email FROM people p WHERE p.tenant_id=c.tenant_id AND p.company_id=c.id ORDER BY p.is_decision_maker DESC, p.confidence DESC LIMIT 1) buyer_email
    FROM companies c LEFT JOIN recommendations r ON r.tenant_id=c.tenant_id AND r.company_id=c.id
    WHERE ${where.map((condition) => `c.${condition}`).join(' AND ')} ORDER BY c.opportunity_score DESC, c.name ASC LIMIT ?`, [...params, config.maxExportRows]);
  const headers = ['name','domain','industry','subindustry','city','state','country','employee_count','annual_revenue','status',
    'identity_confidence','identity_method','opportunity_score','opportunity_tier','fit_score','need_score','intent_score','timing_score','risk_score',
    'score_version','monitoring_tier','recommended_offer','recommended_next_action','buyer_name','buyer_title','buyer_email','owner_name','last_observed_at','next_refresh_at'];
  return [headers.join(','), ...rows.map((row) => headers.map((key) => escapeCsv(row[key])).join(','))].join('\r\n');
}

export function dataQuality(db, tenantId) {
  const observations = db.get(`SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN ingested_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') THEN 1 ELSE 0 END),0) ingested_24h,
      COALESCE(SUM(CASE WHEN ingested_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 day') THEN 1 ELSE 0 END),0) ingested_7d,
      COALESCE(ROUND(AVG(confidence),3),0) average_confidence
    FROM observations WHERE tenant_id=?`, [tenantId]);
  const rejections = db.get(`SELECT COUNT(*) total,
      COALESCE(SUM(CASE WHEN created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-1 day') THEN 1 ELSE 0 END),0) rejected_24h,
      COALESCE(SUM(CASE WHEN created_at>=strftime('%Y-%m-%dT%H:%M:%fZ','now','-7 day') THEN 1 ELSE 0 END),0) rejected_7d
    FROM ingestion_rejections WHERE tenant_id=?`, [tenantId]);
  const identity = db.get(`SELECT COUNT(*) companies,
      COALESCE(SUM(CASE WHEN domain IS NULL THEN 1 ELSE 0 END),0) missing_domain,
      COALESCE(SUM(CASE WHEN identity_confidence<0.8 THEN 1 ELSE 0 END),0) needs_review,
      COALESCE(ROUND(AVG(identity_confidence),3),0) average_confidence
    FROM companies WHERE tenant_id=?`, [tenantId]);
  const stale = db.get(`SELECT COUNT(*) count FROM companies WHERE tenant_id=? AND
    (last_observed_at IS NULL OR last_observed_at<strftime('%Y-%m-%dT%H:%M:%fZ','now','-30 day'))`, [tenantId]);
  const sourceFreshness = db.all(`SELECT source, COUNT(*) observations, MAX(observed_at) latest_observation,
      MAX(COALESCE(retrieved_at, ingested_at)) latest_retrieval,
      ROUND(AVG(confidence),3) average_confidence,
      ROUND(100.0 * SUM(CASE WHEN event_time_quality='retrieval_time' THEN 1 ELSE 0 END) / COUNT(*),1) retrieval_time_pct
    FROM observations WHERE tenant_id=? GROUP BY source ORDER BY latest_retrieval DESC`, [tenantId]);
  const connectorHealth = db.get(`SELECT
      SUM(CASE WHEN status='error' THEN 1 ELSE 0 END) errors,
      SUM(CASE WHEN status='degraded' THEN 1 ELSE 0 END) degraded,
      SUM(CASE WHEN enabled=1 THEN 1 ELSE 0 END) enabled
    FROM connectors WHERE tenant_id=?`, [tenantId]);
  const accepted = Number(observations?.ingested_7d || 0);
  const rejected = Number(rejections?.rejected_7d || 0);
  return {
    observations: observations || { total: 0, ingested_24h: 0, ingested_7d: 0, average_confidence: 0 },
    rejections: { ...(rejections || {}), rejection_rate_7d: accepted + rejected ? Math.round((rejected / (accepted + rejected)) * 1000) / 10 : 0 },
    identity: identity || { companies: 0, missing_domain: 0, needs_review: 0, average_confidence: 0 },
    stale_companies: stale?.count || 0,
    connector_health: connectorHealth || { errors: 0, degraded: 0, enabled: 0 },
    source_freshness: sourceFreshness
  };
}

export function ingestionRejections(db, tenantId, query = {}) {
  const page = positiveInteger(query.page, 1, 1_000_000);
  const limit = positiveInteger(query.limit, 50, 200);
  const where = ['tenant_id=?'];
  const params = [tenantId];
  if (query.source) { where.push('source=?'); params.push(String(query.source).slice(0, 100)); }
  if (query.error_code) { where.push('error_code=?'); params.push(String(query.error_code).slice(0, 100)); }
  if (query.connector_run_id) { where.push('connector_run_id=?'); params.push(String(query.connector_run_id).slice(0, 200)); }
  const clause = where.join(' AND ');
  const total = db.get(`SELECT COUNT(*) count FROM ingestion_rejections WHERE ${clause}`, params)?.count || 0;
  const data = db.all(`SELECT id, source, record_index, error_code, error_message, payload_hash, connector_run_id, created_at
    FROM ingestion_rejections WHERE ${clause} ORDER BY created_at DESC LIMIT ? OFFSET ?`, [...params, limit, (page - 1) * limit]);
  return { data, page, limit, total, pages: Math.ceil(total / limit) };
}

export function reviewQueue(db, tenantId, query = {}) {
  const limit = positiveInteger(query.limit, 100, 200);
  return db.all(`SELECT id, name, domain, industry, city, state, identity_confidence, identity_method,
      opportunity_score, opportunity_tier, last_observed_at
    FROM companies WHERE tenant_id=? AND (identity_confidence<0.8 OR domain IS NULL OR opportunity_tier='suppressed')
    ORDER BY opportunity_tier='suppressed' DESC, identity_confidence ASC, opportunity_score DESC LIMIT ?`, [tenantId, limit]);
}

export function connectorRuns(db, tenantId, query = {}) {
  const limit = positiveInteger(query.limit, 50, 200);
  return db.all(`SELECT * FROM connector_runs WHERE tenant_id=? ORDER BY started_at DESC LIMIT ?`, [tenantId, limit])
    .map((row) => {
      const { provider_cursor_json: cursorJson, metadata_json: metadataJson, cursor_json: legacyCursorJson, ...run } = row;
      return { ...run, cursor: json(cursorJson, null), metadata: json(metadataJson) };
    });
}

function parseSignal(row) { const { metadata_json: metadataJson, ...signal } = row; return { ...signal, metadata: json(metadataJson) }; }
function parseObservation(row) { const { attributes_json: attributesJson, ...observation } = row; return { ...observation, attributes: json(attributesJson) }; }
function positiveInteger(value, fallback, maximum) {
  if (value == null || value === '') return fallback;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 1) throw new AppError(400, 'invalid_pagination', 'Pagination values must be positive integers.');
  return Math.min(maximum, number);
}
function escapeLike(value) { return value.replace(/[\\%_]/g, (character) => `\\${character}`); }

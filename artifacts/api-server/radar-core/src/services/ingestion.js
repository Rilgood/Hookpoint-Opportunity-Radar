import { config } from '../config.js';
import { AppError, assertJsonComplexity, clamp, containsSecretFields, id, isPlainObject, json, nowIso, round, safeHttpUrl, sha256, stableJson } from '../lib.js';
import { resolveCompany, upsertPeople } from './entities.js';
import { applySignals, detectSignals, rescoreCompany } from './signals.js';
import { observationTypeSet } from '../observation-contract.js';

export function ingestBatch(db, tenantId, records, context = {}) {
  if (!Array.isArray(records)) throw new AppError(400, 'records_must_be_array', 'records must be an array.');
  if (!records.length) throw new AppError(400, 'empty_batch', 'At least one observation is required.');
  if (records.length > config.maxBatchRecords) throw new AppError(413, 'batch_too_large', `Maximum batch size is ${config.maxBatchRecords} observations.`);
  const result = { seen: records.length, inserted: 0, duplicates: 0, rejected: 0, signals: 0, signals_created: 0, people: 0, companies: new Set(), errors: [] };
  for (let index = 0; index < records.length; index += 1) {
    try {
      const outcome = db.transaction(() => ingestOne(db, tenantId, records[index], context));
      if (outcome.duplicate) result.duplicates += 1;
      else {
        result.inserted += 1;
        result.signals += outcome.signals.length;
        result.signals_created += outcome.signalsCreated;
        result.people += outcome.people;
        result.companies.add(outcome.company.id);
      }
    } catch (error) {
      result.rejected += 1;
      const rejection = { index, code: error.code || 'ingestion_error', message: error.status >= 500 ? 'Unexpected ingestion failure.' : error.message };
      result.errors.push(rejection);
      storeRejection(db, tenantId, records[index], context, rejection);
    }
  }
  return { ...result, companies: [...result.companies], errors: result.errors.slice(0, 100) };
}

export function ingestOne(db, tenantId, raw, context = {}) {
  let observation = normalizeObservation(raw, context);
  const company = resolveCompany(db, tenantId, observation.company, observation.source);
  observation = { ...observation, attributes: deriveMetrics(db, tenantId, company.id, observation) };
  const hash = sha256(stableJson({ source: observation.source, external_id: observation.external_id, company: company.domain || company.name, type: observation.type, title: observation.title, observed_at: observation.observed_at, attributes: observation.attributes }));
  const duplicate = observation.external_id
    ? db.get('SELECT id FROM observations WHERE tenant_id=? AND source=? AND external_id=? AND type=?', [tenantId, observation.source, observation.external_id, observation.type])
    : db.get('SELECT id FROM observations WHERE tenant_id=? AND source=? AND content_hash=?', [tenantId, observation.source, hash]);
  if (duplicate) return { duplicate: true, observationId: duplicate.id, company, signals: [], people: 0 };

  const people = observation.people.length ? upsertPeople(db, tenantId, company.id, observation.people, observation.source) : 0;
  const observationId = id('obs');
  db.run(
    `INSERT INTO observations(id, tenant_id, company_id, source, external_id, type, title, body, url, attributes_json,
      confidence, observed_at, ingested_at, content_hash, raw_ref, retrieved_at, normalizer_version, event_time_quality)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [observationId, tenantId, company.id, observation.source, observation.external_id, observation.type, observation.title,
      observation.body, observation.url, stableJson(observation.attributes), observation.confidence, observation.observed_at,
      nowIso(), hash, observation.raw_ref, observation.retrieved_at, observation.normalizer_version, observation.event_time_quality]
  );
  db.run(`UPDATE companies SET last_observed_at=CASE WHEN last_observed_at IS NULL OR last_observed_at<? THEN ? ELSE last_observed_at END,
    updated_at=? WHERE tenant_id=? AND id=?`, [observation.observed_at, observation.observed_at, nowIso(), tenantId, company.id]);
  const stored = { ...observation, id: observationId };
  const definitions = detectSignals(stored);
  const existingSignalKeys = new Set(db.all('SELECT signal_key FROM signals WHERE tenant_id=? AND company_id=?', [tenantId, company.id]).map((signal) => signal.signal_key));
  const signals = applySignals(db, tenantId, company, stored, definitions);
  const signalsCreated = signals.filter((key) => !existingSignalKeys.has(key)).length;
  const scoredCompany = rescoreCompany(db, tenantId, company.id);
  return { duplicate: false, observationId, company: scoredCompany, signals, signalsCreated, people };
}

function deriveMetrics(db, tenantId, companyId, observation) {
  const attributes = { ...observation.attributes };
  if (observation.type !== 'ad_snapshot' || attributes.metric_scope !== 'account_snapshot' || !finite(attributes.active_ads)) return attributes;
  const previous = db.get(`SELECT attributes_json FROM observations WHERE tenant_id=? AND company_id=? AND source=? AND type='ad_snapshot'
    AND ${db.sql.jsonText('attributes_json', 'metric_scope')}='account_snapshot' ORDER BY observed_at DESC, ingested_at DESC LIMIT 1`,
  [tenantId, companyId, observation.source]);
  const previousAttributes = json(previous?.attributes_json, null);
  if (!previousAttributes || !finite(previousAttributes.active_ads)) return attributes;
  const currentCount = Number(attributes.active_ads);
  const previousCount = Number(previousAttributes.active_ads);
  if (attributes.previous_active_ads == null) attributes.previous_active_ads = previousCount;
  if (attributes.active_ads_delta_pct == null) {
    attributes.active_ads_delta_pct = previousCount === 0 ? (currentCount > 0 ? 100 : 0) : round(((currentCount - previousCount) / previousCount) * 100, 1);
  }
  if (attributes.is_new_advertiser == null) attributes.is_new_advertiser = previousCount === 0 && currentCount > 0;
  return attributes;
}

function finite(value) { return value != null && value !== '' && Number.isFinite(Number(value)); }

export function normalizeObservation(raw, context = {}) {
  if (!isPlainObject(raw)) throw new AppError(400, 'invalid_observation', 'Observation must be an object.');
  assertJsonComplexity(raw, { maxDepth: 30, maxNodes: 20_000 });
  const source = String(raw.source || context.source || '').trim().toLowerCase();
  const type = String(raw.type || '').trim().toLowerCase();
  if (!source) throw new AppError(400, 'source_required', 'Observation source is required.');
  if (!/^[a-z0-9][a-z0-9_-]{0,99}$/.test(source)) throw new AppError(400, 'invalid_source', 'source must be a lowercase identifier using letters, numbers, underscores or hyphens.');
  if (!observationTypeSet.has(type)) throw new AppError(400, 'unsupported_observation_type', `Unsupported observation type: ${type || '(empty)'}`);
  const title = String(raw.title || '').trim();
  if (!title) throw new AppError(400, 'title_required', 'Observation title is required.');
  if (!isPlainObject(raw.company) || (!raw.company.name && !raw.company.domain && !raw.company.website_url)) {
    throw new AppError(400, 'company_required', 'Observation company identity is required.');
  }
  if (raw.attributes != null && !isPlainObject(raw.attributes)) throw new AppError(400, 'invalid_attributes', 'attributes must be a JSON object.');
  const attributes = raw.attributes || {};
  if (Buffer.byteLength(stableJson(attributes)) > 100_000) throw new AppError(413, 'attributes_too_large', 'attributes may not exceed 100 KB.');

  const hasReportedTime = raw.observed_at != null && raw.observed_at !== '';
  const observed = parseDate(raw.observed_at || Date.now(), 'observed_at');
  if (observed.getTime() > Date.now() + config.maxFutureSkewMinutes * 60_000) throw new AppError(400, 'future_observed_at', `observed_at may not be more than ${config.maxFutureSkewMinutes} minutes in the future.`);
  const retrieved = parseDate(raw.retrieved_at || Date.now(), 'retrieved_at');
  if (retrieved.getTime() > Date.now() + config.maxFutureSkewMinutes * 60_000) throw new AppError(400, 'future_retrieved_at', `retrieved_at may not be more than ${config.maxFutureSkewMinutes} minutes in the future.`);
  if (observed.getTime() - retrieved.getTime() > config.maxFutureSkewMinutes * 60_000) throw new AppError(400, 'invalid_event_time_order', 'observed_at cannot occur materially after retrieved_at.');
  const eventTimeQuality = String(hasReportedTime ? (raw.event_time_quality || 'reported') : 'retrieval_time');
  if (!['reported','provider_estimated','retrieval_time'].includes(eventTimeQuality)) throw new AppError(400, 'invalid_event_time_quality', 'event_time_quality is invalid.');
  const baseConfidence = Number(raw.confidence ?? context.confidence ?? 0.75);
  if (!Number.isFinite(baseConfidence) || baseConfidence < 0.05 || baseConfidence > 1) throw new AppError(400, 'invalid_confidence', 'confidence must be between 0.05 and 1.');
  if (raw.raw_ref && containsSecretFields(String(raw.raw_ref))) throw new AppError(400, 'unsafe_raw_ref', 'raw_ref must not contain embedded credentials.');

  return {
    source,
    external_id: raw.external_id == null || raw.external_id === '' ? null : String(raw.external_id).trim().slice(0, 500),
    type,
    title: title.slice(0, 500),
    body: raw.body == null || raw.body === '' ? null : String(raw.body).slice(0, 20_000),
    url: raw.url ? safeHttpUrl(raw.url) : null,
    attributes,
    confidence: eventTimeQuality === 'retrieval_time' ? clamp(baseConfidence * 0.9, 0.05, 1) : baseConfidence,
    observed_at: observed.toISOString(),
    retrieved_at: retrieved.toISOString(),
    event_time_quality: eventTimeQuality,
    normalizer_version: String(raw.normalizer_version || context.normalizer_version || 'canonical-v1').slice(0, 100),
    raw_ref: raw.raw_ref || context.raw_ref ? String(raw.raw_ref || context.raw_ref).slice(0, 1_000) : null,
    company: raw.company,
    people: Array.isArray(raw.people) ? raw.people.slice(0, 500) : []
  };
}

function storeRejection(db, tenantId, raw, context, rejection) {
  try {
    const source = String(raw?.source || context.source || '').slice(0, 100) || null;
    db.run(`INSERT INTO ingestion_rejections(id, tenant_id, source, record_index, error_code, error_message, payload_hash, connector_run_id, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id('reject'), tenantId, source, rejection.index, rejection.code,
      String(rejection.message).slice(0, 1_000), sha256(stableJson(raw ?? null)), context.connectorRunId || null, nowIso()]);
  } catch {
    // Rejection telemetry must never turn an isolated bad record into a failed batch.
  }
}

function parseDate(value, field) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new AppError(400, `invalid_${field}`, `${field} must be a valid ISO date.`);
  return date;
}

import { addDays, clamp, daysBetween, earliestIso, id, json, nowIso, round, stableJson } from '../lib.js';
import { activeScoringConfig, scoringConfig, signalCatalog, signalByKey } from './catalog.js';

export function detectSignals(observation) {
  return signalCatalog.filter((definition) => matches(definition.match, observation));
}

export function applySignals(db, tenantId, company, observation, definitions = detectSignals(observation)) {
  const now = nowIso();
  const applied = [];
  for (const definition of definitions) {
    let signal = db.get('SELECT * FROM signals WHERE tenant_id = ? AND company_id = ? AND signal_key = ?', [tenantId, company.id, definition.key]);
    const summary = summarize(definition, company, observation);
    if (!signal) {
      const signalId = id('sig');
      db.run(
        `INSERT INTO signals(id, tenant_id, company_id, signal_key, label, category, dimension, polarity, base_weight,
          strength, confidence, summary, first_seen_at, last_seen_at, expires_at, metadata_json, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [signalId, tenantId, company.id, definition.key, definition.label, definition.category, definition.dimension,
          definition.polarity, definition.weight, strength(observation), observation.confidence, summary,
          observation.observed_at, observation.observed_at, addDays(observation.observed_at, definition.halfLifeDays * 2),
          stableJson({ offer: definition.offer, play: definition.play, description: definition.description }), now, now]
      );
      signal = db.get('SELECT * FROM signals WHERE id = ?', [signalId]);
    } else {
      const newer = new Date(observation.observed_at).getTime() >= new Date(signal.last_seen_at).getTime();
      const lastSeen = newer ? observation.observed_at : signal.last_seen_at;
      db.run(
        `UPDATE signals SET summary=?, status=CASE WHEN CAST(? AS TEXT)>=CAST(? AS TEXT) THEN 'active' ELSE status END,
          first_seen_at=?, last_seen_at=?, expires_at=?, updated_at=? WHERE id=?`,
        [newer ? summary : signal.summary, addDays(lastSeen, definition.halfLifeDays * 2), now,
          earliestIso(signal.first_seen_at, observation.observed_at), lastSeen, addDays(lastSeen, definition.halfLifeDays * 2), now, signal.id]
      );
    }
    db.run(`INSERT INTO signal_evidence(signal_id, observation_id, source, linked_at) VALUES (?, ?, ?, ?) ON CONFLICT DO NOTHING`, [signal.id, observation.id, observation.source, now]);
    refreshSignalEvidence(db, signal.id, definition, now);
    applied.push(definition.key);
  }
  return applied;
}

export function rescoreCompany(db, tenantId, companyId, asOf = nowIso()) {
  const scoringConfig = activeScoringConfig(db, tenantId);
  for (const signal of db.all('SELECT id, signal_key FROM signals WHERE tenant_id=? AND company_id=?', [tenantId, companyId])) {
    const definition = signalByKey.get(signal.signal_key);
    if (definition) refreshSignalEvidence(db, signal.id, definition, asOf);
  }
  db.run(`UPDATE signals SET status = 'expired', updated_at = ? WHERE tenant_id = ? AND company_id = ? AND expires_at < ? AND status = 'active'`, [asOf, tenantId, companyId, asOf]);
  const company = db.get('SELECT * FROM companies WHERE tenant_id = ? AND id = ?', [tenantId, companyId]);
  if (!company) return null;
  const signals = db.all(`SELECT * FROM signals WHERE tenant_id = ? AND company_id = ? AND status = 'active'`, [tenantId, companyId]);
  const buyer = db.get('SELECT COUNT(*) count FROM people WHERE tenant_id=? AND company_id=? AND is_decision_maker=1', [tenantId, company.id]);
  const computed = computeScore({ company, signals, buyerCount: buyer?.count || 0, scoringConfig, asOf });
  const { fit, need, intent, timing, risk, score, tier, commercialTier, identityReview, breadthBonus, dimensionBonus, raw } = computed;
  for (const signal of computed.signals) {
    db.run('UPDATE signals SET contribution = ?, updated_at = ? WHERE id = ?', [round(signal.contribution, 2), asOf, signal.id]);
  }
  const monitor = tier === 'hot' ? 'hot' : tier === 'warm' ? 'watchlist' : tier === 'watch' ? 'qualified' : 'universe';
  const refreshDays = scoringConfig.refreshDays[monitor];
  const previousTier = company.opportunity_tier;
  db.run(
    `UPDATE companies SET fit_score=?, need_score=?, intent_score=?, timing_score=?, risk_score=?, opportunity_score=?,
      opportunity_tier=?, monitoring_tier=?, next_refresh_at=?, score_version=?, updated_at=? WHERE tenant_id=? AND id=?`,
    [fit, need, intent, timing, risk, score, tier, monitor, addDays(asOf, refreshDays), scoringConfig.version, asOf, tenantId, companyId]
  );
  if (scoreChanged(company, { fit, need, intent, timing, risk, score, tier })) {
    db.run(`INSERT INTO score_snapshots(id, tenant_id, company_id, score_version, opportunity_score, opportunity_tier,
      fit_score, need_score, intent_score, timing_score, risk_score, active_signal_count, components_json, computed_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id('score'), tenantId, companyId, scoringConfig.version,
      score, tier, fit, need, intent, timing, risk, signals.length, stableJson({ breadth_bonus: breadthBonus, dimension_bonus: dimensionBonus,
        raw_score: round(raw, 3), commercial_tier: commercialTier, identity_gate_applied: identityReview && tier !== 'suppressed' }), asOf]);
  }
  if (previousTier !== tier) {
    db.run(`INSERT INTO lead_events(id, tenant_id, company_id, event_type, from_value, to_value, actor, occurred_at)
      VALUES (?, ?, ?, 'tier_changed', ?, ?, 'scoring_engine', ?)`, [id('evt'), tenantId, companyId, previousTier, tier, asOf]);
  }
  createRecommendation(db, tenantId, companyId, tier, score);
  return db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
}

export function computeScore({ company, signals, buyerCount = 0, scoringConfig, asOf = nowIso() }) {
  const dimensions = { need: 0, intent: 0, timing: 0, risk: 0 };
  const scoredSignals = signals
    .filter((signal) => signal.status === undefined || signal.status === 'active')
    .filter((signal) => !signal.expires_at || new Date(signal.expires_at).getTime() >= new Date(asOf).getTime())
    .map((signal) => {
      const definition = signalByKey.get(signal.signal_key);
      const halfLife = definition?.halfLifeDays || 30;
      const recency = Math.pow(0.5, daysBetween(asOf, signal.last_seen_at) / halfLife);
      const corroboration = Math.min(scoringConfig.corroboration.maximum,
        1 + Math.max(0, signal.source_count - 1) * scoringConfig.corroboration.sourceLift
        + Math.min(scoringConfig.corroboration.evidenceLiftLimit, Math.max(0, signal.evidence_count - 1)) * scoringConfig.corroboration.evidenceLift);
      const contribution = signal.base_weight * signal.strength * signal.confidence * recency * corroboration;
      dimensions[signal.dimension] = (dimensions[signal.dimension] || 0) + contribution;
      return { ...signal, contribution, recency_factor: recency, half_life_days: halfLife };
    });
  const fit = calculateFitFromInputs(company, buyerCount);
  const need = saturate(dimensions.need);
  const intent = saturate(dimensions.intent);
  const timing = saturate(dimensions.timing);
  const risk = saturate(dimensions.risk);
  const positiveCount = scoredSignals.filter((signal) => signal.polarity > 0).length;
  const activeDimensions = [need, intent, timing].filter((value) => value >= scoringConfig.activeDimensionThreshold).length;
  const breadthBonus = Math.min(scoringConfig.breadthBonusMaximum, Math.max(0, positiveCount - 1) * scoringConfig.breadthBonusPerSignal);
  const dimensionBonus = Math.max(0, activeDimensions - 1) * scoringConfig.dimensionBreadthBonus;
  const weights = scoringConfig.dimensionWeights;
  const raw = fit * weights.fit + need * weights.need + intent * weights.intent + timing * weights.timing + breadthBonus + dimensionBonus - risk * scoringConfig.riskPenalty;
  const score = round(clamp(raw), 1);
  const thresholds = scoringConfig.tierThresholds;
  const commercialTier = score >= thresholds.hot ? 'hot' : score >= thresholds.warm ? 'warm' : score >= thresholds.watch ? 'watch' : 'cold';
  const identityReview = Number(company.identity_confidence || 0) < 0.8;
  const tier = risk >= scoringConfig.riskSuppressionThreshold ? 'suppressed'
    : identityReview && ['hot','warm'].includes(commercialTier) ? 'watch' : commercialTier;
  return { fit, need, intent, timing, risk, score, tier, commercialTier, identityReview, breadthBonus, dimensionBonus, raw, dimensions, signals: scoredSignals };
}

export function rescoreAll(db, tenantId, limit = 5_000) {
  const ids = db.all('SELECT id FROM companies WHERE tenant_id=? ORDER BY updated_at ASC LIMIT ?', [tenantId, limit]);
  return ids.map(({ id: companyId }) => rescoreCompany(db, tenantId, companyId));
}

export function rescoreDueCompanies(db, tenantId = null, limit = 500, asOf = nowIso()) {
  const where = ['(next_refresh_at IS NULL OR next_refresh_at<=?)'];
  const params = [asOf];
  if (tenantId) { where.push('tenant_id=?'); params.push(tenantId); }
  const companies = db.all(`SELECT tenant_id, id FROM companies WHERE ${where.join(' AND ')}
    ORDER BY COALESCE(next_refresh_at, created_at) ASC LIMIT ?`, [...params, limit]);
  return companies.map((company) => rescoreCompany(db, company.tenant_id, company.id, asOf));
}

function createRecommendation(db, tenantId, companyId, tier, score) {
  const company = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  const now = nowIso();
  if (['rejected','customer','lost','disqualified'].includes(company.status)) {
    db.run('DELETE FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, companyId]);
    return;
  }
  if (tier === 'suppressed') {
    const risk = db.get(`SELECT * FROM signals WHERE tenant_id=? AND company_id=? AND status='active' AND polarity=-1 ORDER BY contribution DESC LIMIT 1`, [tenantId, companyId]);
    const reason = risk?.summary || 'A material risk condition requires human review.';
    db.run(
      `INSERT INTO recommendations(id, tenant_id, company_id, offer, headline, rationale, outreach_angle, proof_points_json, next_action, generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'risk_rules', ?, ?)
       ON CONFLICT(tenant_id, company_id) DO UPDATE SET offer=excluded.offer, headline=excluded.headline, rationale=excluded.rationale,
         outreach_angle=excluded.outreach_angle, proof_points_json=excluded.proof_points_json, next_action=excluded.next_action,
         generated_by=excluded.generated_by, updated_at=excluded.updated_at`,
      [id('rec'), tenantId, companyId, 'Outreach paused', `${company.name}: human review required`, reason,
        'Do not trigger automated outreach while this suppression is active.', stableJson(risk ? [{ label: risk.label, summary: risk.summary, contribution: risk.contribution }] : []),
        'Verify the situation manually and wait for the suppression window to expire or be explicitly cleared.', now, now]
    );
    return;
  }
  if (Number(company.identity_confidence || 0) < 0.8) {
    db.run(
      `INSERT INTO recommendations(id, tenant_id, company_id, offer, headline, rationale, outreach_angle, proof_points_json, next_action, generated_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'identity_rules', ?, ?)
       ON CONFLICT(tenant_id, company_id) DO UPDATE SET offer=excluded.offer, headline=excluded.headline, rationale=excluded.rationale,
         outreach_angle=excluded.outreach_angle, proof_points_json=excluded.proof_points_json, next_action=excluded.next_action,
         generated_by=excluded.generated_by, updated_at=excluded.updated_at`,
      [id('rec'), tenantId, companyId, 'Identity verification required', `${company.name}: verify company identity`,
        `The current identity match is ${round(Number(company.identity_confidence || 0) * 100, 0)}% confident, so commercial activation is capped at review.`,
        'Do not trigger outreach until the account is linked to an authoritative domain, CRM ID or LinkedIn company URL.', stableJson([]),
        'Resolve the identity in the review queue, then rescore the account.', now, now]
    );
    return;
  }
  const top = db.get(`SELECT * FROM signals WHERE tenant_id=? AND company_id=? AND status='active' AND polarity=1 ORDER BY contribution DESC LIMIT 1`, [tenantId, companyId]);
  if (!top) {
    db.run('DELETE FROM recommendations WHERE tenant_id=? AND company_id=?', [tenantId, companyId]);
    return;
  }
  const definition = signalByKey.get(top.signal_key);
  const proof = db.all(`SELECT label, summary, contribution, source_count, last_seen_at FROM signals WHERE tenant_id=? AND company_id=? AND status='active' AND polarity=1 ORDER BY contribution DESC LIMIT 3`, [tenantId, companyId]);
  const recommendation = {
    offer: definition?.offer || 'Hook Opportunity Diagnostic',
    headline: `${company.name}: ${top.label}`,
    rationale: `${top.summary} Opportunity score is ${score}/100 with ${top.source_count} source${top.source_count === 1 ? '' : 's'} supporting the leading signal.`,
    outreach: definition?.play || 'Lead with the observed trigger and a relevant creative performance hypothesis.',
    next: tier === 'hot' ? 'Human review, then contact within 24 hours.' : tier === 'warm' ? 'Research the buyer and contact within three business days.' : 'Continue monitoring until a second source or stronger trigger appears.'
  };
  db.run(
    `INSERT INTO recommendations(id, tenant_id, company_id, offer, headline, rationale, outreach_angle, proof_points_json, next_action, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(tenant_id, company_id) DO UPDATE SET offer=excluded.offer, headline=excluded.headline, rationale=excluded.rationale,
       outreach_angle=excluded.outreach_angle, proof_points_json=excluded.proof_points_json, next_action=excluded.next_action, updated_at=excluded.updated_at`,
    [id('rec'), tenantId, companyId, recommendation.offer, recommendation.headline, recommendation.rationale,
      recommendation.outreach, stableJson(proof), recommendation.next, now, now]
  );
}

function refreshSignalEvidence(db, signalId, definition, asOf) {
  const signal = db.get('SELECT * FROM signals WHERE id=?', [signalId]);
  if (!signal) return;
  const cutoff = addDays(signal.last_seen_at, -definition.halfLifeDays * 2);
  const evidence = db.all(`SELECT e.source, o.confidence, o.attributes_json, o.observed_at
    FROM signal_evidence e JOIN observations o ON o.id=e.observation_id
    WHERE e.signal_id=? AND o.observed_at>=? ORDER BY o.observed_at DESC`, [signalId, cutoff]);
  if (!evidence.length) {
    db.run(`UPDATE signals SET evidence_count=0, source_count=0, confidence=0.05, strength=0.25, status='expired', contribution=0, updated_at=? WHERE id=?`, [asOf, signalId]);
    return;
  }
  const bestBySource = new Map();
  let peakStrength = 0.25;
  for (const item of evidence) {
    bestBySource.set(item.source, Math.max(bestBySource.get(item.source) || 0, Number(item.confidence) || 0));
    peakStrength = Math.max(peakStrength, strength({ attributes: json(item.attributes_json) }));
  }
  const confidences = [...bestBySource.values()].sort((a, b) => b - a);
  const confidenceRules = scoringConfig.evidenceConfidence;
  const confidence = clamp(confidences[0] + (1 - confidences[0]) * Math.min(confidenceRules.maximumRemainingLift,
    Math.max(0, confidences.length - 1) * confidenceRules.additionalSourceLift), 0.05, confidenceRules.maximum);
  db.run(`UPDATE signals SET evidence_count=?, source_count=?, confidence=?, strength=?, updated_at=? WHERE id=?`,
    [evidence.length, bestBySource.size, round(confidence, 3), round(peakStrength, 2), asOf, signalId]);
}

function calculateFit(db, tenantId, company) {
  const buyer = db.get('SELECT COUNT(*) count FROM people WHERE tenant_id=? AND company_id=? AND is_decision_maker=1', [tenantId, company.id]);
  return calculateFitFromInputs(company, buyer?.count || 0);
}

export function calculateFitFromInputs(company, buyerCount = 0) {
  let score = 30;
  if (company.domain) score += 10;
  if (company.industry && company.industry !== 'Unknown') score += 10;
  if (company.employee_count >= 5) score += 8;
  if (company.employee_count >= 25) score += 7;
  if (company.employee_count > 10_000) score -= 5;
  if (company.annual_revenue >= 1_000_000) score += 8;
  if (company.annual_revenue >= 10_000_000) score += 5;
  if (company.city || company.state) score += 4;
  if (buyerCount) score += 13;
  return round(clamp(score), 1);
}

function saturate(total) { return round(clamp(100 * (1 - Math.exp(-Math.max(0, total) / 25))), 1); }

function scoreChanged(company, next) {
  return company.opportunity_tier !== next.tier || ['fit','need','intent','timing','risk','score'].some((key) => {
    const currentKey = key === 'score' ? 'opportunity_score' : `${key}_score`;
    return Math.abs(Number(company[currentKey] || 0) - Number(next[key] || 0)) >= 0.1;
  });
}

function summarize(definition, company, observation) {
  const sourceLabel = observation.source.replaceAll('_', ' ');
  return `${definition.label} detected for ${company.name} from ${sourceLabel}: ${observation.title}`;
}

function strength(observation) {
  const supplied = Number(observation.attributes?.strength ?? 1);
  if (!Number.isFinite(supplied)) return 1;
  return clamp(supplied, 0.25, 1.5);
}

function matches(match = {}, observation) {
  if (match.types?.length && !match.types.includes(observation.type)) return false;
  const all = !match.all?.length || match.all.every((condition) => test(condition, observation));
  const any = !match.any?.length || match.any.some((condition) => test(condition, observation));
  return all && any;
}

function test(condition, observation) {
  const actual = getPath(observation, condition.path);
  const expected = condition.value;
  switch (condition.op) {
    case 'eq': return actual === expected;
    case 'gte': return numeric(actual, expected, (left, right) => left >= right);
    case 'lte': return numeric(actual, expected, (left, right) => left <= right);
    case 'gt': return numeric(actual, expected, (left, right) => left > right);
    case 'lt': return numeric(actual, expected, (left, right) => left < right);
    case 'truthy': return Boolean(actual);
    case 'in': return expected.map(String).map((x) => x.toLowerCase()).includes(String(actual).toLowerCase());
    case 'contains_any': {
      const haystack = Array.isArray(actual) ? actual.join(' ').toLowerCase() : String(actual ?? '').toLowerCase();
      return expected.some((needle) => haystack.includes(String(needle).toLowerCase()));
    }
    default: return false;
  }
}

function numeric(actual, expected, compare) {
  if (actual == null || actual === '' || expected == null || expected === '') return false;
  const left = Number(actual);
  const right = Number(expected);
  return Number.isFinite(left) && Number.isFinite(right) && compare(left, right);
}

function getPath(object, path) {
  return String(path).split('.').reduce((value, key) => value?.[key], object);
}

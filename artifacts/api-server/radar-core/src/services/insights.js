import { AppError, addDays, daysBetween, json, nowIso, round } from '../lib.js';
import { activeScoringConfig, signalByKey } from './catalog.js';
import { computeScore } from './signals.js';
import { outcomeScoreEligibleSql } from './outcome-score.js';
import { nonRejectedObservation, reviewedSignalHistory } from './evidence-policy.js';

const QUALIFIED = new Set(['meeting', 'opportunity', 'won']);
const NEGATIVE = new Set(['lost', 'disqualified']);
const CLOSED = new Set(['rejected', 'lost', 'disqualified', 'customer']);
const MIN_SAMPLE = 5;

export function companyInsights(db, tenantId, companyId, asOf = nowIso()) {
  const company = db.get('SELECT * FROM companies WHERE tenant_id=? AND id=?', [tenantId, companyId]);
  if (!company) throw new AppError(404, 'company_not_found', 'Company not found.');
  const config = activeScoringConfig(db, tenantId);
  const signals = reviewedSignalHistory(db, tenantId, companyId);
  const active = signals.filter((signal) => signal.status === 'active' && signal.expires_at >= asOf);
  const buyerCount = db.get('SELECT COUNT(*) count FROM people WHERE tenant_id=? AND company_id=? AND is_decision_maker=1', [tenantId, companyId])?.count || 0;
  const current = computeScore({ company, signals: active, buyerCount, scoringConfig: config, asOf });
  const positive = current.signals.filter((signal) => signal.polarity > 0).sort((a, b) => b.contribution - a.contribution);
  const positiveTotal = positive.reduce((sum, signal) => sum + signal.contribution, 0);
  const drivers = positive.map((signal) => ({
    signal_key: signal.signal_key, label: signal.label, dimension: signal.dimension,
    contribution: round(signal.contribution, 2),
    share_of_positive_contribution: positiveTotal ? round(100 * signal.contribution / positiveTotal, 1) : 0,
    source_count: signal.source_count, evidence_count: signal.evidence_count, confidence: signal.confidence,
    days_since_last_seen: round(daysBetween(asOf, signal.last_seen_at), 1),
    half_life_days: signal.half_life_days, recency_factor: round(signal.recency_factor, 4),
    is_new: daysBetween(asOf, signal.first_seen_at) <= 14, is_corroborated: signal.source_count > 1
  }));
  const strongest = drivers[0] || null;
  const projection14 = computeScore({ company, signals: active, buyerCount, scoringConfig: config, asOf: addDays(asOf, 14) });
  const projection30 = computeScore({ company, signals: active, buyerCount, scoringConfig: config, asOf: addDays(asOf, 30) });
  const urgency = ['hot', 'warm'].includes(company.opportunity_tier) && projection14.score < config.tierThresholds.warm ? 'closing'
    : drivers.some((driver) => driver.is_new) && ['watch', 'warm'].includes(company.opportunity_tier) ? 'building' : 'stable';
  const activeDimensions = ['need', 'intent', 'timing'].filter((dimension) => current[dimension] >= config.activeDimensionThreshold);
  return {
    company_id: companyId,
    generated_at: asOf,
    story: buildStory(db, tenantId, companyId, signals),
    why_now: {
      headline: drivers.length
        ? `${drivers.length} active signal${drivers.length === 1 ? '' : 's'} across ${new Set(drivers.map((item) => item.dimension)).size} dimension${new Set(drivers.map((item) => item.dimension)).size === 1 ? '' : 's'}; strongest evidence is ${strongest.label} (${strongest.source_count} source${strongest.source_count === 1 ? '' : 's'}).`
        : 'No active positive signals are currently observed.',
      drivers, new_since_days: 14, new_signal_count: drivers.filter((item) => item.is_new).length,
      corroborated_signal_count: drivers.filter((item) => item.is_corroborated).length, active_dimensions: activeDimensions
    },
    action_window: {
      strongest_signal_key: strongest?.signal_key || null, strongest_signal_label: strongest?.label || null,
      half_life_days: strongest?.half_life_days || null,
      days_until_half_strength: strongest ? round(Math.max(0, strongest.half_life_days - strongest.days_since_last_seen), 1) : null,
      projected_score_in_14_days: { score: projection14.score, tier: projection14.tier },
      projected_score_in_30_days: { score: projection30.score, tier: projection30.tier },
      urgency
    },
    counter_evidence: counterEvidence(db, tenantId, company, signals, strongest, buyerCount, asOf),
    what_would_change: whatWouldChange(company, active, buyerCount, config, asOf, current, strongest),
    comparable_accounts: comparableAccounts(db, tenantId, companyId, active)
  };
}

export function analyticsInsights(db, tenantId, asOf = nowIso()) {
  const config = activeScoringConfig(db, tenantId);
  const labels = firstLabels(db, tenantId);
  const base = cohort(labels);
  const baseRate = rate(base.qualified, base.labeled);
  const signals = reviewedSignalHistory(db, tenantId);
  const companies = db.all('SELECT * FROM companies WHERE tenant_id=?', [tenantId]);
  const companyById = new Map(companies.map((company) => [company.id, company]));
  const byCompany = groupBy(signals, 'company_id');
  const signalGroups = new Map();
  for (const label of labels) {
    for (const signal of byCompany.get(label.company_id) || []) {
      if (signal.first_seen_at > label.occurred_at) continue;
      if (!signalGroups.has(signal.signal_key)) signalGroups.set(signal.signal_key, { signal, labels: [] });
      signalGroups.get(signal.signal_key).labels.push(label);
    }
  }
  const activity = db.all(`SELECT company_id, signal_key, outcome_type, occurred_at FROM outcomes
    WHERE tenant_id=? AND outcome_type IN ('accepted','contacted','positive_reply')`, [tenantId]);
  // Count each activity event once per signal key: either explicitly linked, or the signal was already present on the account.
  const activityBySignal = new Map();
  for (const event of activity) {
    const keys = new Set(event.signal_key ? [event.signal_key] : []);
    for (const item of byCompany.get(event.company_id) || []) if (item.first_seen_at <= event.occurred_at) keys.add(item.signal_key);
    for (const key of keys) activityBySignal.set(key, (activityBySignal.get(key) || 0) + 1);
  }
  const signal_effectiveness = [...signalGroups.values()].map(({ signal, labels: rows }) => {
    const counts = cohort(rows);
    const qualifiedRate = rate(counts.qualified, counts.labeled);
    const bounds = wilson(counts.qualified, counts.labeled);
    const activityCount = activityBySignal.get(signal.signal_key) || 0;
    const verdict = counts.labeled < MIN_SAMPLE ? 'insufficient'
      : bounds.lower > baseRate ? 'associated_with_pipeline'
        : activityCount >= 5 && qualifiedRate < baseRate ? 'activity_without_pipeline' : 'neutral';
    return { signal_key: signal.signal_key, label: signal.label, dimension: signal.dimension, ...counts,
      qualified_rate: qualifiedRate, wilson_95_lower: bounds.lower, wilson_95_upper: bounds.upper,
      lift_vs_base_pp: base.labeled ? round(qualifiedRate - baseRate, 1) : null, activity_count: activityCount, verdict };
  }).sort((a, b) => b.labeled - a.labeled || a.signal_key.localeCompare(b.signal_key));
  const source_effectiveness = sourceEffectiveness(db, tenantId, labels, asOf);
  const segments = {
    by_industry: segmentRows(companies, labels, (company) => company.industry || 'Unknown'),
    by_size_band: segmentRows(companies, labels, (company) => company.size_band || 'Unknown')
  };
  const shapeException = (label) => {
    const company = companyById.get(label.company_id);
    return {
      company_id: label.company_id, name: company?.name || label.company_id, score_at_outcome: label.score_at_outcome,
      outcome_type: label.outcome_type, occurred_at: label.occurred_at, note: label.note,
      top_signals_at_time: (byCompany.get(label.company_id) || []).filter((signal) => signal.first_seen_at <= label.occurred_at)
        .sort((a, b) => Number(b.contribution) - Number(a.contribution)).slice(0, 3).map((signal) => signal.label)
    };
  };
  // Only signals observed on/before the qualifying label count toward time-to-qualified; accounts whose
  // first signal arrived after conversion are excluded rather than reported as zero days.
  const timingDays = labels.filter((label) => QUALIFIED.has(label.outcome_type)).map((label) => {
    const earliest = (byCompany.get(label.company_id) || []).map((signal) => signal.first_seen_at)
      .filter((firstSeen) => firstSeen <= label.occurred_at).sort()[0];
    return earliest ? daysBetween(label.occurred_at, earliest) : null;
  }).filter((value) => value != null).sort((a, b) => a - b);
  return {
    generated_at: asOf, thresholds: { min_segment_sample: MIN_SAMPLE, min_signal_sample: MIN_SAMPLE },
    base_rate: { ...base, qualified_rate: baseRate },
    signal_effectiveness, source_effectiveness, segments,
    false_confidence: labels.filter((label) => NEGATIVE.has(label.outcome_type) && label.score_at_outcome >= config.tierThresholds.hot).slice(0, 10).map(shapeException),
    hidden_wins: labels.filter((label) => QUALIFIED.has(label.outcome_type) && label.score_at_outcome < config.tierThresholds.warm).slice(0, 10).map(shapeException),
    decayed_without_action: decayedAccounts(db, tenantId, asOf),
    timing: { median_days_first_signal_to_qualified: percentile(timingDays, .5), p25: percentile(timingDays, .25), p75: percentile(timingDays, .75), sample: timingDays.length },
    loss_reasons: db.all(`SELECT o.company_id, c.name, o.outcome_type, o.note, o.occurred_at FROM outcomes o
      JOIN companies c ON c.tenant_id=o.tenant_id AND c.id=o.company_id
      WHERE o.tenant_id=? AND o.outcome_type IN ('lost','disqualified') AND o.note IS NOT NULL AND TRIM(o.note)<>''
      ORDER BY o.occurred_at DESC LIMIT 20`, [tenantId]),
    focus_list: focusList(db, tenantId, config, asOf),
    focus_list_policy: { new_signal_14d: 8, corroborated_positive_signal: 6, identity_unverified: -10, closing_urgency: 5,
      note: 'Priority is the current opportunity score plus the listed evidence-based adjustments.' }
  };
}

function buildStory(db, tenantId, companyId, signals) {
  const entries = [];
  for (const signal of signals) {
    entries.push({ at: signal.first_seen_at, kind: 'signal_detected', title: `${signal.label} detected`, detail: `${signal.source_count} source${signal.source_count === 1 ? '' : 's'} and ${signal.evidence_count} evidence item${signal.evidence_count === 1 ? '' : 's'} observed.`, signal_key: signal.signal_key, weight: weight(signal.base_weight) });
    if (signal.source_count > 1) entries.push({ at: signal.last_seen_at, kind: 'signal_corroborated', title: `${signal.label} corroborated`, detail: `Observed across ${signal.source_count} sources.`, signal_key: signal.signal_key, weight: weight(signal.base_weight) });
    if (signal.status === 'expired') entries.push({ at: signal.expires_at, kind: 'signal_expired', title: `${signal.label} expired`, detail: 'The configured evidence window elapsed.', signal_key: signal.signal_key, weight: 'low' });
  }
  for (const event of db.all(`SELECT * FROM lead_events WHERE tenant_id=? AND company_id=? AND event_type='tier_changed'`, [tenantId, companyId])) {
    entries.push({ at: event.occurred_at, kind: 'tier_changed', title: `Tier changed to ${event.to_value}`, detail: `Tier moved from ${event.from_value || 'unscored'} to ${event.to_value}.` });
  }
  for (const action of db.all('SELECT * FROM identity_review_actions WHERE tenant_id=? AND company_id=?', [tenantId, companyId])) {
    entries.push({ at: action.created_at, kind: 'identity_reviewed', title: 'Identity reviewed', detail: action.note || action.action });
  }
  for (const outcome of db.all('SELECT * FROM outcomes WHERE tenant_id=? AND company_id=?', [tenantId, companyId])) {
    entries.push({ at: outcome.occurred_at, kind: 'outcome_recorded', title: `${outcome.outcome_type.replaceAll('_', ' ')} recorded`, detail: outcome.note || `Outcome recorded as ${outcome.outcome_type}.` });
  }
  return entries.sort((a, b) => a.at.localeCompare(b.at) || a.kind.localeCompare(b.kind)).slice(-60);
}

function counterEvidence(db, tenantId, company, signals, strongest, buyerCount, asOf) {
  const rows = [];
  const add = (code, severity, title, detail) => rows.push({ code, severity, title, detail });
  if (Number(company.identity_confidence || 0) < .8) add('identity_unverified', 'high', 'Identity is not verified', `Identity confidence is ${round(Number(company.identity_confidence || 0) * 100, 0)}%.`);
  const snapshot = db.get('SELECT components_json FROM score_snapshots WHERE tenant_id=? AND company_id=? ORDER BY computed_at DESC, id DESC LIMIT 1', [tenantId, company.id]);
  if (json(snapshot?.components_json, {}).identity_gate_applied) add('identity_gate_applied', 'high', 'Identity gate applied', 'The latest score snapshot capped the commercial tier pending identity review.');
  for (const signal of signals.filter((item) => item.status === 'active' && item.polarity < 0)) add('risk_signal_active', 'high', signal.label, signal.summary);
  const positives = signals.filter((item) => item.status === 'active' && item.polarity > 0);
  if (positives.length && positives.every((item) => item.source_count === 1)) add('single_source_only', 'medium', 'Evidence is single-source', `All ${positives.length} active positive signals have one source.`);
  if (strongest && strongest.days_since_last_seen > strongest.half_life_days) add('stale_evidence', 'medium', 'Strongest evidence is stale', `${strongest.label} was last seen ${strongest.days_since_last_seen} days ago, beyond its ${strongest.half_life_days}-day half-life.`);
  const qualifying = db.get(`SELECT COUNT(*) count FROM outcomes WHERE tenant_id=? AND company_id=? AND outcome_type IN ('meeting','opportunity','won')`, [tenantId, company.id])?.count || 0;
  const expired = signals.filter((item) => item.status === 'expired' && daysBetween(asOf, item.expires_at) <= 90).length;
  if (expired && !qualifying) add('expired_signals', 'medium', 'Signals expired without a qualifying outcome', `${expired} signal${expired === 1 ? '' : 's'} expired in the last 90 days; no qualifying outcome is recorded.`);
  if (CLOSED.has(company.status)) add('workflow_closed', 'high', 'Workflow is closed', `Account status is ${company.status}.`);
  if (!buyerCount) add('no_decision_maker', 'medium', 'No decision maker recorded', 'No person is currently marked as a decision maker.');
  const missing = [['domain', company.domain], ['industry', company.industry && company.industry !== 'Unknown'], ['employee_count', company.employee_count], ['city/state', company.city || company.state]].filter(([, value]) => !value).map(([field]) => field);
  if (missing.length) add('missing_firmographics', 'low', 'Firmographics are incomplete', `Missing: ${missing.join(', ')}.`);
  const conflicts = db.all('SELECT incoming_name, incoming_domain, source FROM entity_resolution_events WHERE tenant_id=? AND company_id=?', [tenantId, company.id])
    .flatMap((event) => [event.incoming_name && company.name && event.incoming_name.toLowerCase() !== company.name.toLowerCase(), event.incoming_domain && company.domain && event.incoming_domain.toLowerCase() !== company.domain.toLowerCase()]).filter(Boolean).length;
  if (conflicts) add('unresolved_identity_conflicts', 'high', 'Identity conflicts remain', `${conflicts} conflicting identity attribute${conflicts === 1 ? '' : 's'} observed.`);
  const loss = db.get(`SELECT outcome_type, note FROM outcomes WHERE tenant_id=? AND company_id=? AND outcome_type IN ('lost','disqualified') ORDER BY occurred_at DESC LIMIT 1`, [tenantId, company.id]);
  if (loss) add('negative_history', 'medium', 'Negative outcome history', loss.note || `Most recent negative outcome was ${loss.outcome_type}.`);
  return rows;
}

function whatWouldChange(company, signals, buyerCount, config, asOf, current, strongest) {
  const suggestions = [];
  const add = (action, dimension, next) => suggestions.push({ action, expected_effect: { score_delta: round(next.score - current.score, 1), projected_tier: next.tier }, dimension });
  if (!company.domain) add('Add an authoritative company domain', 'fit', computeScore({ company: { ...company, domain: 'verified.invalid' }, signals, buyerCount, scoringConfig: config, asOf }));
  if (!company.industry || company.industry === 'Unknown') add('Add a verified industry', 'fit', computeScore({ company: { ...company, industry: 'Verified' }, signals, buyerCount, scoringConfig: config, asOf }));
  if (!company.employee_count) add('Add a verified employee count of at least 5', 'fit', computeScore({ company: { ...company, employee_count: 5 }, signals, buyerCount, scoringConfig: config, asOf }));
  if (!company.city && !company.state) add('Add a verified city or state', 'fit', computeScore({ company: { ...company, city: 'Verified' }, signals, buyerCount, scoringConfig: config, asOf }));
  if (!buyerCount) add('Add a verified decision maker', 'fit', computeScore({ company, signals, buyerCount: 1, scoringConfig: config, asOf }));
  if (Number(company.identity_confidence || 0) < .8) add('Verify company identity', 'identity', computeScore({ company: { ...company, identity_confidence: .8 }, signals, buyerCount, scoringConfig: config, asOf }));
  if (strongest && strongest.source_count === 1) {
    const changed = signals.map((signal) => signal.signal_key === strongest.signal_key ? { ...signal, source_count: 2 } : signal);
    add(`Corroborate ${strongest.label} with a second source`, strongest.dimension, computeScore({ company, signals: changed, buyerCount, scoringConfig: config, asOf }));
  }
  return suggestions.filter((item) => item.expected_effect.score_delta > 0 || item.expected_effect.projected_tier !== current.tier);
}

function comparableAccounts(db, tenantId, companyId, active) {
  const keys = new Set(active.map((signal) => signal.signal_key));
  const labels = firstLabels(db, tenantId);
  const allSignals = reviewedSignalHistory(db, tenantId).filter((signal) => signal.company_id !== companyId);
  const byCompany = groupBy(allSignals, 'company_id');
  // A comparable account must have shared the signal before its earliest label; later evidence cannot inform the cohort.
  const matches = labels.map((label) => ({
    label,
    matched: [...new Set((byCompany.get(label.company_id) || [])
      .filter((signal) => keys.has(signal.signal_key) && signal.first_seen_at <= label.occurred_at)
      .map((signal) => signal.signal_key))]
  })).filter((item) => item.matched.length);
  const counts = cohort(matches.map((item) => item.label));
  const bounds = wilson(counts.qualified, counts.labeled);
  const timing = [];
  for (const item of matches.filter((item) => QUALIFIED.has(item.label.outcome_type))) {
    const first = (byCompany.get(item.label.company_id) || []).filter((signal) => item.matched.includes(signal.signal_key) && signal.first_seen_at <= item.label.occurred_at).map((signal) => signal.first_seen_at).sort()[0];
    if (first) timing.push(daysBetween(item.label.occurred_at, first));
  }
  const base = cohort(labels);
  return {
    matched_on: [...new Set(matches.flatMap((item) => item.matched))].sort(), ...counts,
    qualified_rate: rate(counts.qualified, counts.labeled), wilson_95_lower: bounds.lower, wilson_95_upper: bounds.upper,
    median_days_signal_to_qualified: percentile(timing.sort((a, b) => a - b), .5), sufficient_sample: counts.labeled >= MIN_SAMPLE,
    tenant_base_rate: { labeled: base.labeled, qualified_rate: rate(base.qualified, base.labeled) },
    note: 'These are observational associations among labeled accounts and do not establish that a signal caused an outcome.'
  };
}

function firstLabels(db, tenantId) {
  const rows = db.all(`SELECT company_id, outcome_type, score_at_outcome, occurred_at, created_at, id, note,
      ${outcomeScoreEligibleSql(db)} score_eligible FROM outcomes o
    WHERE tenant_id=? AND outcome_type IN ('meeting','opportunity','won','lost','disqualified')
    ORDER BY company_id, occurred_at, created_at, id`, [tenantId]);
  const first = new Map();
  for (const row of rows) if (!first.has(row.company_id)) first.set(row.company_id, row);
  return [...first.values()].filter((row) => row.score_eligible);
}

function cohort(labels) {
  const qualified = labels.filter((label) => QUALIFIED.has(label.outcome_type)).length;
  return { labeled: labels.length, qualified, negative: labels.length - qualified };
}

function sourceEffectiveness(db, tenantId, labels, asOf) {
  const labelMap = new Map(labels.map((label) => [label.company_id, label]));
  const observations = db.all(`SELECT source, company_id, observed_at FROM observations observation
    WHERE tenant_id=? AND ${nonRejectedObservation()}`, [tenantId]);
  const rejectionRows = db.all('SELECT source, COUNT(*) count FROM ingestion_rejections WHERE tenant_id=? GROUP BY source', [tenantId]);
  const rejections = new Map(rejectionRows.map((row) => [row.source, row.count]));
  const groups = groupBy(observations, 'source');
  return [...groups.entries()].map(([source, rows]) => {
    const accounts = new Set(rows.map((row) => row.company_id));
    // Attribute a labeled account to a source only when the source observed it on/before the earliest label.
    const labeledRows = [...accounts].map((id) => {
      const label = labelMap.get(id);
      return label && rows.some((row) => row.company_id === id && row.observed_at <= label.occurred_at) ? label : null;
    }).filter(Boolean);
    const counts = cohort(labeledRows);
    const last = rows.map((row) => row.observed_at).sort().at(-1);
    const days = round(daysBetween(asOf, last), 1);
    const qualifiedRate = rate(counts.qualified, counts.labeled);
    const verdict = days > 30 ? 'stale' : counts.labeled < MIN_SAMPLE ? 'insufficient' : counts.qualified ? 'producing_pipeline' : rows.length >= 5 ? 'activity_only' : 'insufficient';
    return { source, accounts_touched: accounts.size, labeled_accounts: counts.labeled, qualified_accounts: counts.qualified,
      qualified_rate: qualifiedRate, last_observed_at: last, days_since_last_observation: days, rejection_count: rejections.get(source) || 0, verdict };
  }).sort((a, b) => b.accounts_touched - a.accounts_touched);
}

function segmentRows(companies, labels, key) {
  const byId = new Map(companies.map((company) => [company.id, company]));
  const groups = new Map();
  for (const label of labels) {
    const segment = key(byId.get(label.company_id) || {});
    if (!groups.has(segment)) groups.set(segment, []);
    groups.get(segment).push(label);
  }
  return [...groups.entries()].map(([segment, rows]) => {
    const counts = cohort(rows);
    const bounds = wilson(counts.qualified, counts.labeled);
    return { segment, ...counts, qualified_rate: rate(counts.qualified, counts.labeled), wilson_95_lower: bounds.lower, wilson_95_upper: bounds.upper, sufficient_sample: counts.labeled >= MIN_SAMPLE };
  }).sort((a, b) => b.labeled - a.labeled || a.segment.localeCompare(b.segment));
}

function decayedAccounts(db, tenantId, asOf) {
  return db.all(`SELECT c.id company_id, c.name, s.label expired_signal_label, s.expires_at expired_at, c.opportunity_score
    FROM companies c JOIN signals s ON s.tenant_id=c.tenant_id AND s.company_id=c.id
    WHERE c.tenant_id=? AND c.status NOT IN ('rejected','lost','disqualified','customer') AND s.polarity>0 AND s.status='expired'
      AND s.expires_at>=? AND NOT EXISTS (SELECT 1 FROM outcomes o WHERE o.tenant_id=c.tenant_id AND o.company_id=c.id)
    ORDER BY s.expires_at DESC LIMIT 10`, [tenantId, addDays(asOf, -90)]);
}

function focusList(db, tenantId, config, asOf) {
  const candidates = db.all(`SELECT * FROM companies WHERE tenant_id=? AND status NOT IN ('rejected','lost','disqualified','customer')
    AND opportunity_tier<>'suppressed' ORDER BY opportunity_score DESC LIMIT 40`, [tenantId]);
  if (!candidates.length) return [];
  const ids = candidates.map((company) => company.id);
  const placeholders = ids.map(() => '?').join(',');
  const signalsByCompany = groupBy(db.all(`SELECT * FROM signals WHERE tenant_id=? AND status='active' AND company_id IN (${placeholders})`, [tenantId, ...ids]), 'company_id');
  const buyersByCompany = new Map(db.all(`SELECT company_id, COUNT(*) count FROM people WHERE tenant_id=? AND is_decision_maker=1 AND company_id IN (${placeholders}) GROUP BY company_id`, [tenantId, ...ids])
    .map((row) => [row.company_id, row.count]));
  return candidates.map((company) => {
    const signals = signalsByCompany.get(company.id) || [];
    const buyerCount = buyersByCompany.get(company.id) || 0;
    const reasons = [];
    let adjustment = 0;
    if (signals.some((signal) => signal.polarity > 0 && daysBetween(asOf, signal.first_seen_at) <= 14)) { adjustment += 8; reasons.push('New positive signal observed within 14 days (+8).'); }
    if (signals.some((signal) => signal.polarity > 0 && signal.source_count > 1)) { adjustment += 6; reasons.push('Positive signal has multiple sources (+6).'); }
    if (Number(company.identity_confidence || 0) < .8) { adjustment -= 10; reasons.push('Identity confidence is below 80% (-10).'); }
    const projected = computeScore({ company, signals, buyerCount, scoringConfig: config, asOf: addDays(asOf, 14) });
    if (['hot', 'warm'].includes(company.opportunity_tier) && projected.score < config.tierThresholds.warm) { adjustment += 5; reasons.push('Projected 14-day score falls below warm (+5).'); }
    return { company_id: company.id, name: company.name, opportunity_score: company.opportunity_score, opportunity_tier: company.opportunity_tier,
      priority_score: round(Number(company.opportunity_score) + adjustment, 1), reasons, identity_confidence: company.identity_confidence };
  }).sort((a, b) => b.priority_score - a.priority_score || b.opportunity_score - a.opportunity_score).slice(0, 8);
}

function groupBy(rows, key) {
  const map = new Map();
  for (const row of rows) { if (!map.has(row[key])) map.set(row[key], []); map.get(row[key]).push(row); }
  return map;
}
function rate(numerator, denominator) { return denominator ? round(100 * numerator / denominator, 1) : 0; }
function wilson(qualified, labeled) {
  if (!labeled) return { lower: 0, upper: 0 };
  const z = 1.96; const p = qualified / labeled; const d = 1 + z * z / labeled;
  const center = (p + z * z / (2 * labeled)) / d;
  const margin = z * Math.sqrt((p * (1 - p) + z * z / (4 * labeled)) / labeled) / d;
  return { lower: round(100 * Math.max(0, center - margin), 1), upper: round(100 * Math.min(1, center + margin), 1) };
}
function percentile(sorted, p) {
  if (!sorted.length) return null;
  const index = (sorted.length - 1) * p; const lower = Math.floor(index); const fraction = index - lower;
  return round(sorted[lower] + ((sorted[lower + 1] ?? sorted[lower]) - sorted[lower]) * fraction, 1);
}
function weight(value) { return value >= 25 ? 'high' : value >= 16 ? 'medium' : 'low'; }

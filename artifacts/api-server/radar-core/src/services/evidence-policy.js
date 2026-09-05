// SQL fragments only accept source-code aliases, never request values.
export function nonRejectedObservation(alias = 'observation') {
  return `NOT EXISTS (SELECT 1 FROM evidence_reviews evidence_review
    WHERE evidence_review.tenant_id=${alias}.tenant_id AND evidence_review.observation_id=${alias}.id AND evidence_review.status='rejected')`;
}

export function signalSupportedBefore(signalAlias, timestampSql) {
  return `(NOT EXISTS (SELECT 1 FROM signal_evidence lineage WHERE lineage.signal_id=${signalAlias}.id)
    OR EXISTS (SELECT 1 FROM signal_evidence lineage JOIN observations observation ON observation.id=lineage.observation_id
      WHERE lineage.signal_id=${signalAlias}.id AND observation.observed_at<=${timestampSql} AND ${nonRejectedObservation()}))`;
}

export function reviewedSignalHistory(db, tenantId, companyId = null) {
  // Retain historical, expired signals, but remove rejected observations from
  // feature presence and earliest-signal timing. Legacy signals with no stored
  // lineage retain their existing dates; rejecting evidence never rewrites scores.
  return db.all(`SELECT s.*,
    (SELECT COUNT(*) FROM signal_evidence lineage WHERE lineage.signal_id=s.id) lineage_count,
    (SELECT MIN(observation.observed_at) FROM signal_evidence lineage JOIN observations observation ON observation.id=lineage.observation_id
      WHERE lineage.signal_id=s.id AND ${nonRejectedObservation()}) supported_first_seen_at
    FROM signals s WHERE s.tenant_id=?${companyId ? ' AND s.company_id=?' : ''}`, companyId ? [tenantId, companyId] : [tenantId])
    .filter((signal) => !Number(signal.lineage_count) || signal.supported_first_seen_at)
    .map(({ lineage_count, supported_first_seen_at, ...signal }) => ({ ...signal, first_seen_at: supported_first_seen_at || signal.first_seen_at }));
}

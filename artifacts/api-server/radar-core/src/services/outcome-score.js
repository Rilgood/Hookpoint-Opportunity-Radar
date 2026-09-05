// Score provenance is written by the server, never accepted from outcome
// metadata supplied by a caller. The numeric compatibility field is not a
// historical prediction when no pre-event score is available.
export function scoreForOutcome(db, tenantId, company, occurredAt, recordedAt) {
  if (occurredAt >= recordedAt) return {
    score: company.opportunity_score,
    provenance: { basis: 'current_at_recording', calibration_eligible: true, scored_at: recordedAt }
  };
  const snapshot = db.get(`SELECT id, opportunity_score, computed_at FROM score_snapshots
    WHERE tenant_id=? AND company_id=? AND computed_at<=? ORDER BY computed_at DESC, id DESC LIMIT 1`,
  [tenantId, company.id, occurredAt]);
  if (snapshot) return {
    score: snapshot.opportunity_score,
    provenance: { basis: 'historical_snapshot', calibration_eligible: true, snapshot_id: snapshot.id, scored_at: snapshot.computed_at }
  };
  return {
    score: company.opportunity_score,
    provenance: { basis: 'unavailable_historical', calibration_eligible: false, scored_at: null }
  };
}

export function outcomeScoreEligibleSql(db, alias = 'o') {
  const basis = db.dialect === 'postgres'
    ? `((${alias}.metadata_json)::jsonb #>> '{score_provenance,basis}')`
    : `json_extract(${alias}.metadata_json, '$.score_provenance.basis')`;
  // Legacy rows without provenance qualify only if their recorded score agrees
  // with the latest pre-event snapshot, or the event was contemporaneous. An explicitly unknown
  // historical score remains excluded even if a later import adds snapshots.
  return `(${basis} IN ('historical_snapshot','current_at_recording') OR (${basis} IS NULL AND (
    ${alias}.occurred_at>=${alias}.created_at OR ${alias}.score_at_outcome=(
      SELECT score_at_event.opportunity_score FROM score_snapshots score_at_event WHERE score_at_event.tenant_id=${alias}.tenant_id
        AND score_at_event.company_id=${alias}.company_id AND score_at_event.computed_at<=${alias}.occurred_at
      ORDER BY score_at_event.computed_at DESC, score_at_event.id DESC LIMIT 1))))`;
}

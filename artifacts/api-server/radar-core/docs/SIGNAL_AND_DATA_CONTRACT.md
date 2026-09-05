# Signal and Data Contract

## Observation contract

Required fields:

| Field | Type | Rule |
|---|---|---|
| `source` | string | Lowercase identifier; letters, numbers, `_` and `-`; maximum 100 |
| `type` | enum | One supported observation type |
| `title` | string | Non-empty fact; maximum 500 characters |
| `company` | object | At least `name`, `domain` or `website_url` |

Production fields:

| Field | Purpose |
|---|---|
| `external_id` | Stable provider record/snapshot ID for idempotency |
| `url` | HTTP(S) evidence destination |
| `observed_at` | Actual event time; no more than configured clock skew into the future |
| `retrieved_at` | Collection time |
| `event_time_quality` | `reported`, `provider_estimated` or `retrieval_time` |
| `normalizer_version` | Version of provider-to-canonical mapping |
| `confidence` | Source and mapping certainty from 0.05 to 1.0 |
| `attributes` | Rule-ready JSON object, maximum 100 KB |
| `people` | Sourced buyer candidates; maximum 500 per observation |
| `raw_ref` | Pointer to separately governed raw data |

If `observed_at` is absent, ingestion uses retrieval time, forces `event_time_quality` to `retrieval_time`, and discounts confidence by 10%.

Raw provider payloads should live in encrypted object storage with retention/access controls. Store only a reference here.

## Supported types

`funding`, `leadership_change`, `product_launch`, `expansion`, `location_event`, `partnership`, `contract_award`, `grant_award`, `job_posting`, `hiring_metric`, `rfp`, `social_post`, `news`, `ad_snapshot`, `creative_metric`, `social_metric`, `search_trend`, `traffic_metric`, `conversion_metric`, `campaign_metric`, `website_change`, `technology_change`, `review_metric`, `competitor_event`, `event`, `seasonal_event`, `crm_activity`, `web_intent`, `permit`, `acquisition`, `merger`, `earnings`, `crisis`, `recall`, `legal_event`, `layoff`.

## Idempotency semantics

When `external_id` is present, `(tenant, source, external_id, type)` is treated as the logical record key. Replays are ignored even if presentation text changes. Therefore a provider that reuses one ID for changing metrics must append a snapshot/version key.

Without `external_id`, ingestion hashes source, resolved company, type, title, event time and normalized attributes. Identical replays are ignored; materially changed snapshots become new evidence.

Valid records commit independently. A bad record produces a rejection entry containing only source, input index, error, connector run ID and payload hash. The API returns at most 100 inline errors.

## Identity semantics

Canonical domains and URLs are validated before resolution. Match lineage records method and confidence. Domain aliases can locate a company but cannot replace its current canonical domain. Name-plus-location may resolve across sources only with a meaningful city or state match; a shared country or placeholder location is insufficient. Name matching cannot override conflicting domains, CRM IDs, LinkedIn URLs or supplied locations. Name-only matching is scoped to a source already associated with that company and remains low confidence. A name-only record from a new source creates a separate reviewable identity rather than risking a false merge.

Recommended activation policy:

| Identity confidence | Handling |
|---:|---|
| 0.95–1.00 | Stable authoritative identifier |
| 0.80–0.94 | Strong domain/location match |
| 0.60–0.79 | Human review before activation |
| Below 0.60 | Do not automate activation |

The scoring engine enforces this policy: identity confidence below 0.8 caps the commercial tier at `watch` and replaces sales guidance with an identity-verification hold. Adding a verified domain, CRM ID or LinkedIn company URL through the company update API raises identity confidence and an API-triggered update rescoring applies the new gate immediately.

## Evidence confidence

| Observation confidence | Meaning |
|---:|---|
| 0.95–1.00 | First-party or authoritative official record |
| 0.85–0.94 | Direct platform API or primary announcement |
| 0.70–0.84 | Reliable structured extraction/secondary source |
| 0.50–0.69 | Search/snippet inference requiring corroboration |
| Below 0.50 | Human review; insufficient alone for activation |

Signal confidence uses the best recent evidence per originating publisher host plus a bounded lift from additional hosts. Connector provenance is used when no evidence URL exists. The same canonical article URL counts once even when multiple connectors retrieve it; tracking parameters and fragments do not make another article. Content-identifying query parameters are preserved. Every original observation and signal-evidence link remains available for audit. This is a conservative proxy for independence: different accounts on one social platform share a host, and syndicated rewrites or shared ownership across different hosts are not yet detected.

## Signal lifecycle

A signal remains active for twice its catalog half-life after its latest qualifying evidence. Contribution decays continuously. Evidence/source counts, confidence and strength are recalculated relative to the scoring date, excluding future evidence and evidence older than twice the half-life. Linked observations are checked against the current catalog rules on refresh, so a corrected rule can retire a previous false match without deleting its lineage.

An older record can add lineage but cannot overwrite the latest summary or move expiry backward. A newly current observation can reactivate an expired signal.

## Scoring contract

Portfolio-level values live in `config/scoring.json` and individual rules in `config/signal-catalog.json`. The scoring version is stored on each company and score snapshot.

Every contribution is explainable from signal weight, strength, confidence, recency and corroboration. Dimension totals saturate, signal/dimension breadth bonuses are bounded, and risk is subtracted. Risk at the suppression threshold overrides the commercial tier.

Any threshold/weight change should increment the scoring version, rescore the portfolio, retain before/after snapshots and be evaluated against outcomes.

The default model `rules-1.2` adds originating-URL corroboration controls and current-window evidence revalidation, requires an observed count of at least three marketing openings for a hiring surge, and requires an actual unnegated search phrase for text-based agency intent. An explicit `explicit_agency_search: true` attribute remains authoritative. The stable `creative_fatigue` key is presented as **Creative refresh hypothesis**: creative age, repetition or frequency warrants review but does not establish poor performance. Ad-volume deltas use only strictly preceding account snapshots; reported baseline/delta attributes are retained. Scoring-version changes create a snapshot even when the numeric score is unchanged.

## Outcome chronology and score provenance

An imported outcome is retained at its reported event time. It updates the current pipeline stage only when it is at least as recent as the latest status-bearing outcome or manual stage change; importing an old contact or loss cannot reopen a current customer or remove a newer active recommendation.

The server owns `metadata.score_provenance` and overwrites any caller-supplied value. `basis` is `current_at_recording`, `historical_snapshot`, or `unavailable_historical`; the object also reports `calibration_eligible`, `scored_at`, and the `snapshot_id` when applicable. A backdated event uses the latest score snapshot at or before its event time. If no such snapshot exists, the legacy numeric `score_at_outcome` field is only a current reference value: display **Historical score unavailable**, never present that reference as a known historical prediction.

Unknown historical scores are excluded from calibration, score-band and effectiveness cohorts while their activity and revenue remain counted. The earliest qualifying/negative account label is selected before applying the eligibility check, so a later label cannot conceal an unknown first conversion. The calibration cohort note reports the excluded account count. Legacy outcomes without provenance require a contemporaneous record or a recorded score equal to the latest pre-event snapshot; the mere presence of an older snapshot does not establish a valid prediction.

## Activation safety

- Never infer or target health, race, religion, sexuality, disability or other protected/sensitive personal traits.
- Prefer company-level evidence over person-level inference.
- Suppress outreach for material safety, legal or reputational crises.
- Never recommend sales outreach for rejected, disqualified, lost or current-customer workflow states.
- Require human review for suppressed or ambiguous identities.
- Preserve source deletion, retention and opt-out handling in every connector.

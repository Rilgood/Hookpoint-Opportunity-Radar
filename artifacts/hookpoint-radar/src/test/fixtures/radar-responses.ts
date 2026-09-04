const meta = { request_id: "test-request", duration_ms: 3 };

export const company = {
  id: "company-1",
  name: "Acme Health",
  domain: "acme.test",
  crm_id: "crm-acme-1",
  linkedin_url: null,
  website_url: "https://acme.test",
  industry: "Healthcare",
  size_band: "51-200",
  city: "Boston",
  state: "MA",
  status: "new",
  opportunity_score: 82,
  opportunity_tier: "hot",
  fit_score: 28,
  need_score: 21,
  intent_score: 24,
  timing_score: 9,
  risk_score: 0,
  identity_confidence: 0.94,
  identity_method: "domain",
};

export const companyListResponse = {
  data: {
    data: [company],
    page: 1,
    limit: 20,
    total: 1,
    pages: 1,
  },
  meta,
};

export const mergeCandidateListResponse = {
  data: {
    ...companyListResponse.data,
    limit: 200,
    total: 2,
    pages: 1,
    data: [
      company,
      {
        ...company,
        id: "company-2",
        name: "Target Health",
        domain: "target-health.test",
      },
    ],
  },
  meta,
};

export const companyDetailResponse = {
  data: {
    company,
    signals: [],
    observations: [],
    recommendation: null,
    merged_recommendation_contexts: [],
    outcomes: [],
    identity_review: {
      status: "needs_review",
      aliases: [
        { id: "alias-domain", alias_type: "domain", alias_value: "acme.test", source: "crm" },
        { id: "alias-crm", alias_type: "crm_id", alias_value: "crm-acme-1", source: "crm" },
      ],
      conflicting_attributes: [],
      actions: [],
      resolution_events: [],
    },
  },
  meta,
};

export const confirmedCompanyDetailResponse = {
  ...companyDetailResponse,
  data: {
    ...companyDetailResponse.data,
    identity_review: {
      ...companyDetailResponse.data.identity_review,
      status: "confirmed",
    },
  },
};

export const outcomeAnalyticsResponse = {
  data: {
    totals: [],
    score_bands: [],
    signal_performance: [],
    calibration: {
      summary: {
        sufficient_sample: true,
        cohort_note: "A balanced held-out cohort is ready for review.",
        labeled_accounts: 120,
        qualified_accounts: 48,
        negative_accounts: 72,
        minimum_sample: 30,
        recommendation: "Evaluate a guarded score recommendation.",
      },
      score_bands: [
        {
          score_band: "hot",
          labeled: 40,
          qualified: 25,
          negative: 15,
          raw_qualified_rate: 62.5,
          smoothed_qualified_rate: 61.2,
          wilson_95_lower: 47.1,
          wilson_95_upper: 74.1,
          qualified_rate_lift_vs_cold: 28.6,
        },
      ],
    },
  },
  meta,
};

const evaluation = {
  guardrails: {
    holdout_accounts: 30,
    qualified_accounts: 12,
    negative_accounts: 18,
  },
  explanation: [{ dimension: "fit", before: 0.25, after: 0.35 }],
  before: { auc: 0.62, top_quartile_qualified_rate: 41.2 },
  after: { auc: 0.71, top_quartile_qualified_rate: 52.4 },
};

export const calibrationEvaluationResponse = {
  data: {
    status: "ready",
    recommendation: {
      id: "score-version-2",
      version: "rules-2.0",
      status: "proposed",
      evaluation,
    },
  },
  meta,
};

export const approvedCalibrationResponse = {
  data: {
    id: "score-version-2",
    version: "rules-2.0",
    status: "approved",
    base_version: "rules-1.1",
    config: { fit: 0.35 },
    evaluation,
  },
  meta,
};

export function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}
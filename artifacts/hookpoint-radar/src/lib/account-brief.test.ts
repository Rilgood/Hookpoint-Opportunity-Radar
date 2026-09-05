import { describe, expect, it } from "vitest";
import type {
  CompanyDetail,
  CompanyInsights,
} from "@workspace/api-client-react";
import { buildAccountBrief, safeEvidenceUrl } from "./account-brief";

const detail: CompanyDetail = {
  company: {
    id: "co",
    name: "Example Company",
    industry: "Retail",
    status: "prospect",
    monitoring_tier: "watchlist",
    identity_confidence: 0.94,
    identity_method: "domain",
    identity_review_status: "confirmed",
    fit_score: 75,
    need_score: 60,
    intent_score: 70,
    timing_score: 65,
    risk_score: 0,
    opportunity_score: 72,
    opportunity_tier: "hot",
  },
  signals: [],
  people: [],
  events: [],
  outcomes: [],
  score_history: [],
  merged_recommendation_contexts: [],
  observations: [
    {
      id: "o",
      source: "company_news",
      title: "Example opens a new location",
      type: "expansion",
      confidence: 0.9,
      observed_at: "2026-09-01T00:00:00Z",
      url: "https://example.com/news/expansion",
    },
  ],
  recommendation: {
    offer: "Creative testing",
    rationale: "Expansion may create a need for localized creative.",
    next_action: "Verify the current launch priorities.",
    outreach_angle: "Ask about the launch",
  },
  identity_review: {
    status: "confirmed",
    aliases: [],
    resolution_events: [],
    conflicting_attributes: [],
    actions: [],
  },
};
const insights: CompanyInsights = {
  company_id: "co",
  generated_at: "2026-09-05T00:00:00Z",
  story: [],
  counter_evidence: [],
  what_would_change: [],
  why_now: {
    headline: "Expansion",
    drivers: [
      {
        signal_key: "expansion",
        label: "Expansion",
        dimension: "timing",
        contribution: 12,
        share_of_positive_contribution: 100,
        source_count: 1,
        evidence_count: 1,
        confidence: 0.9,
        days_since_last_seen: 4,
        half_life_days: 30,
        recency_factor: 0.9,
        is_new: true,
        is_corroborated: false,
      },
    ],
    new_since_days: 14,
    new_signal_count: 1,
    corroborated_signal_count: 0,
    active_dimensions: ["timing"],
  },
  action_window: {
    strongest_signal_key: "expansion",
    strongest_signal_label: "Expansion",
    half_life_days: 30,
    days_until_half_strength: 26,
    projected_score_in_14_days: { score: 58, tier: "warm" },
    projected_score_in_30_days: { score: 39, tier: "watch" },
    urgency: "stable",
  },
  comparable_accounts: {
    matched_on: [],
    labeled: 0,
    qualified: 0,
    negative: 0,
    qualified_rate: 0,
    wilson_95_lower: 0,
    wilson_95_upper: 0,
    median_days_signal_to_qualified: null,
    sufficient_sample: false,
    tenant_base_rate: { labeled: 0, qualified_rate: 0 },
    note: "Insufficient sample",
  },
};

describe("account decision brief", () => {
  it("excludes rejected observations from supporting evidence and prevents an outreach draft when no usable observations remain", () => {
    const rejected = {
      ...detail.observations[0],
      review_status: "rejected" as const,
      review_note: "Wrong company",
    };
    const brief = buildAccountBrief(
      { ...detail, observations: [rejected] },
      insights,
    );
    expect(brief.evidence).toEqual([]);
    expect(brief.ready).toBe(false);
    expect(brief.draft).toBeNull();
    expect(brief.text).not.toContain(rejected.title);
    expect(brief.text).not.toContain(rejected.url);
    const mixed = buildAccountBrief(
      {
        ...detail,
        observations: [
          rejected,
          {
            ...detail.observations[0],
            id: "verified",
            title: "Verified account event",
            review_status: "verified",
          },
        ],
      },
      insights,
    );
    expect(mixed.evidence.map((observation) => observation.id)).toEqual([
      "verified",
    ]);
    expect(mixed.ready).toBe(true);
  });
  it("keeps observations separate from hypotheses and cites their source and date", () => {
    const brief = buildAccountBrief(detail, insights);
    expect(brief.text).toContain("OBSERVED — VERIFY AT SOURCE");
    expect(brief.text).toContain("https://example.com/news/expansion");
    expect(brief.text).toContain("Observed: 2026-09-01T00:00:00Z");
    expect(brief.text).toContain("OPPORTUNITY HYPOTHESIS");
    expect(brief.text).toContain("not a buyer deadline");
    expect(brief.draft).not.toContain("ready to buy");
  });
  it.each(["suppressed", "cold", "watch"] as const)(
    "does not prepare outreach from a %s tier",
    (tier) => {
      expect(
        buildAccountBrief(
          { ...detail, company: { ...detail.company, opportunity_tier: tier } },
          insights,
        ).draft,
      ).toBeNull();
    },
  );
  it.each(["customer", "disqualified", "lost", "rejected"] as const)(
    "keeps %s workflows closed",
    (status) => {
      const brief = buildAccountBrief(
        { ...detail, company: { ...detail.company, status } },
        insights,
      );
      expect(brief.status).toBe("Workflow closed");
      expect(brief.draft).toBeNull();
    },
  );
  it("blocks unresolved identity and active risk even for a hot account", () => {
    expect(
      buildAccountBrief(
        {
          ...detail,
          identity_review: {
            ...detail.identity_review,
            status: "needs_review",
          },
        },
        insights,
      ).draft,
    ).toBeNull();
    expect(
      buildAccountBrief(detail, {
        ...insights,
        counter_evidence: [
          {
            code: "risk_signal_active",
            severity: "high",
            title: "Risk",
            detail: "Review risk",
          },
        ],
      }).status,
    ).toBe("Hold outreach");
  });
  it("does not infer readiness when insights or observations are missing", () => {
    expect(buildAccountBrief(detail).ready).toBe(false);
    expect(
      buildAccountBrief({ ...detail, observations: [] }, insights).draft,
    ).toBeNull();
  });
  it("does not restart prospecting after an account has been contacted", () => {
    const brief = buildAccountBrief(
      { ...detail, company: { ...detail.company, status: "contacted" } },
      insights,
    );
    expect(brief.next).toContain("last outreach");
    expect(brief.draft).toBeNull();
  });
  it("does not block a confirmed identity on retained historical conflict records", () => {
    expect(
      buildAccountBrief(
        {
          ...detail,
          identity_review: {
            ...detail.identity_review,
            conflicting_attributes: [
              { field: "name", incoming_value: "Old name" },
            ],
          },
        },
        insights,
      ).ready,
    ).toBe(true);
  });
  it("excludes future observations from an actionable brief", () => {
    const brief = buildAccountBrief(
      {
        ...detail,
        observations: [
          { ...detail.observations[0], observed_at: "2030-01-01T00:00:00Z" },
        ],
      },
      insights,
    );
    expect(brief.ready).toBe(false);
    expect(brief.text).not.toContain("Example opens a new location");
  });
  it("rejects executable evidence links", () => {
    expect(safeEvidenceUrl("javascript:alert(1)")).toBeNull();
    expect(safeEvidenceUrl("data:text/html,hello")).toBeNull();
    expect(safeEvidenceUrl("https://example.com/proof")).toBe(
      "https://example.com/proof",
    );
  });
  it.each([
    ["contacted", "last outreach"],
    ["replied", "Review the reply"],
    ["meeting", "Prepare discovery"],
    ["opportunity", "open deal"],
  ] as const)(
    "keeps %s work moving even when market signals have decayed",
    (status, nextStep) => {
      const brief = buildAccountBrief({
        ...detail,
        company: {
          ...detail.company,
          status,
          opportunity_score: 15,
          opportunity_tier: "cold",
        },
        observations: [],
      });
      expect(brief.status).toBe("Review the next conversation");
      expect(brief.next).toContain(nextStep);
      expect(brief.draft).toBeNull();
    },
  );
  it("treats customers as a handoff instead of a new prospect", () => {
    const brief = buildAccountBrief(
      {
        ...detail,
        company: { ...detail.company, status: "customer" },
        recommendation: null,
      },
      insights,
    );
    expect(brief.next).toContain("coordinate the handoff");
    expect(brief.hypothesis).toContain("No active commercial recommendation");
    expect(brief.text).not.toContain(
      "Insufficient evidence for a commercial hypothesis",
    );
  });
  it("orders observations by actual time and accounts for unusable timestamps", () => {
    const brief = buildAccountBrief(
      {
        ...detail,
        observations: [
          {
            ...detail.observations[0],
            id: "earlier",
            observed_at: "2026-09-01T12:00:00+05:00",
          },
          {
            ...detail.observations[0],
            id: "later",
            observed_at: "2026-09-01T10:00:00Z",
          },
          { ...detail.observations[0], id: "undated", observed_at: "invalid" },
          {
            ...detail.observations[0],
            id: "future",
            observed_at: "2030-01-01T00:00:00Z",
          },
        ],
      },
      insights,
    );
    expect(brief.evidence.map((item) => item.id)).toEqual(["later", "earlier"]);
    expect(brief.excludedObservations).toBe(2);
    expect(brief.text).toContain(
      "2 future-dated or undated observations are excluded",
    );
  });
});

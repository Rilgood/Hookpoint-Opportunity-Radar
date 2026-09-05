import {
  CompanyStatus,
  IdentityReviewStatus,
  OpportunityTier,
  type Company,
} from "@workspace/api-client-react";

export type OpportunityFilters = {
  q: string;
  tier: OpportunityTier | "all";
  status: CompanyStatus | "all";
  identity: IdentityReviewStatus | "all";
  page: number;
};

export const DEFAULT_OPPORTUNITY_FILTERS: OpportunityFilters = {
  q: "",
  tier: "all",
  status: "all",
  identity: "all",
  page: 1,
};

function allowedValue<T extends string>(
  value: string | null,
  values: Record<string, T>,
): T | "all" {
  return (
    Object.values(values).find((candidate) => candidate === value) ?? "all"
  );
}

export function parseOpportunityFilters(search: string): OpportunityFilters {
  const params = new URLSearchParams(search);
  const page = Number(params.get("page") || 1);
  return {
    q: (params.get("q") || "").trim().slice(0, 100),
    tier: allowedValue(params.get("tier"), OpportunityTier),
    status: allowedValue(params.get("status"), CompanyStatus),
    identity: allowedValue(
      params.get("identity_review_status"),
      IdentityReviewStatus,
    ),
    page: Number.isInteger(page) && page > 0 && page <= 1_000_000 ? page : 1,
  };
}

export function opportunityFilterParams(
  filters: OpportunityFilters,
): URLSearchParams {
  return new URLSearchParams({
    ...(filters.q ? { q: filters.q } : {}),
    ...(filters.tier !== "all" ? { tier: filters.tier } : {}),
    ...(filters.status !== "all" ? { status: filters.status } : {}),
    ...(filters.identity !== "all"
      ? { identity_review_status: filters.identity }
      : {}),
  });
}

export function evidenceAge(
  lastObservedAt: string | null | undefined,
  now = Date.now(),
) {
  const timestamp = lastObservedAt ? Date.parse(lastObservedAt) : NaN;
  if (!Number.isFinite(timestamp))
    return { label: "No observation", stale: true, missing: true };
  const days = Math.floor((now - timestamp) / 86_400_000);
  if (days < 0) return { label: "Future-dated", stale: true, missing: false };
  return {
    label: days === 0 ? "Today" : days === 1 ? "1 day ago" : `${days} days ago`,
    stale: days >= 30,
    missing: false,
  };
}

export function opportunityReviewCue(company: Company) {
  if (
    ["customer", "lost", "disqualified", "rejected"].includes(company.status)
  ) {
    return {
      title:
        company.status === "customer"
          ? "Coordinate customer handoff"
          : "Review closed account",
      detail:
        company.status === "customer"
          ? "Review the customer record with the owner."
          : "Check the outcome before reopening.",
      attention: false,
    };
  }
  if (company.opportunity_tier === "suppressed") {
    return {
      title: "Review safety hold",
      detail: "Resolve the hold before outreach.",
      attention: true,
    };
  }
  if (
    company.identity_review_status === "needs_review" ||
    company.identity_confidence < 0.8
  ) {
    return {
      title: "Verify account identity",
      detail: "Check the company match before acting.",
      attention: true,
    };
  }
  if (["contacted", "replied"].includes(company.status)) {
    return {
      title: "Review the follow-up",
      detail:
        company.status === "contacted"
          ? "Check the last outreach before following up."
          : "Use the reply to plan the next conversation.",
      attention: false,
    };
  }
  if (company.status === "meeting")
    return {
      title: "Prepare discovery",
      detail: "Review the account and any meeting notes.",
      attention: false,
    };
  if (company.status === "opportunity")
    return {
      title: "Advance the deal",
      detail: "Review the open deal and next milestone.",
      attention: false,
    };
  const age = evidenceAge(company.last_observed_at);
  if (age.stale) {
    return {
      title: age.missing ? "Add source evidence" : "Check evidence freshness",
      detail: age.missing
        ? "No dated observations are available."
        : "Verify the latest event before acting.",
      attention: true,
    };
  }
  if (["hot", "warm"].includes(company.opportunity_tier))
    return {
      title: "Review the opportunity",
      detail: "Inspect the evidence and recommended offer.",
      attention: false,
    };
  return {
    title: "Monitor for stronger signals",
    detail: "Review evidence as the account develops.",
    attention: false,
  };
}

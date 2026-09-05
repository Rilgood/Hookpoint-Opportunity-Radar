import type {
  CompanyDetail,
  CompanyInsights,
} from "@workspace/api-client-react";

export function safeEvidenceUrl(value?: string | null) {
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}

export function buildAccountBrief(
  detail: CompanyDetail,
  insights?: CompanyInsights,
) {
  const { company, recommendation } = detail;
  const closed = ["rejected", "lost", "disqualified", "customer"].includes(
    company.status,
  );
  const review =
    company.identity_confidence < 0.8 ||
    detail.identity_review.status === "needs_review" ||
    (detail.identity_review.status !== "confirmed" &&
      detail.identity_review.conflicting_attributes.length > 0);
  const risk =
    company.opportunity_tier === "suppressed" ||
    insights?.counter_evidence.some(
      (item) => item.code === "risk_signal_active",
    );
  const asOf = Date.parse(insights?.generated_at || new Date().toISOString());
  const evidence = [...detail.observations]
    .filter((item) => item.review_status !== "rejected" && Date.parse(item.observed_at) <= asOf)
    .sort((a, b) => Date.parse(b.observed_at) - Date.parse(a.observed_at))
    .slice(0, 3);
  const excludedObservations = detail.observations.filter(
    (item) =>
      !Number.isFinite(Date.parse(item.observed_at)) ||
      Date.parse(item.observed_at) > asOf,
  ).length;
  const hasEvidence = !!insights?.why_now.drivers.length && evidence.length > 0;
  const inProgress = [
    "contacted",
    "replied",
    "meeting",
    "opportunity",
  ].includes(company.status);
  const ready =
    !closed &&
    !review &&
    !risk &&
    hasEvidence &&
    ["warm", "hot"].includes(company.opportunity_tier);
  const status = closed
    ? "Workflow closed"
    : risk
      ? "Hold outreach"
      : review
        ? "Verify identity first"
        : inProgress
          ? "Review the next conversation"
          : ready
            ? "Ready for human review"
            : "Research first";
  const workflowNext = {
    customer:
      "Review the customer record and coordinate the handoff with the account owner.",
    lost: "Review the loss reason before considering a new opportunity.",
    rejected: "Review why the account was rejected before reopening it.",
    disqualified:
      "Review the disqualification reason before reopening this account.",
    contacted:
      "Review the last outreach and decide whether a follow-up is appropriate.",
    replied:
      "Review the reply and agree on the next step with the account owner.",
    meeting:
      "Prepare discovery using the account context and any recorded meeting notes.",
    opportunity:
      "Review the open deal, blockers, and next milestone with the account owner.",
  };
  const workflowNextStep =
    workflowNext[company.status as keyof typeof workflowNext];
  const next = closed
    ? workflowNextStep
    : risk
      ? "Resolve the risk evidence before planning commercial outreach."
      : review
        ? "Confirm the authoritative identity and resolve conflicting attributes."
        : inProgress
          ? workflowNextStep
          : !hasEvidence
            ? "Collect current, attributable evidence before choosing an outreach angle."
            : recommendation?.next_action ||
              "Review the underlying sources and identify the relevant decision maker.";
  const questions = insights?.counter_evidence
    .slice(0, 4)
    .map((item) => item.detail) || [
    "Account insights have not been verified yet.",
  ];
  const draft =
    ready && !inProgress && recommendation
      ? `Hello,\n\nI'm researching ${company.name}'s current marketing priorities. Would a conversation about ${recommendation.offer.toLowerCase()} be useful to your team?\n\nI would like to understand what you are focused on before suggesting an approach. Is this relevant to your priorities, and who would be the right person to speak with?`
      : null;
  const hypothesis = closed
    ? "No active commercial recommendation for this closed workflow. Prior evidence is retained for reference."
    : recommendation?.rationale ||
      "Insufficient evidence for a commercial hypothesis.";
  const lines = [
    `${company.name} — account brief`,
    `Prepared: ${insights?.generated_at || "insights unavailable"}`,
    `Score: ${company.opportunity_score}/100 (${company.opportunity_tier}); a ranking hypothesis, not purchase probability.`,
    `Workflow: ${company.status} · Owner: ${company.owner_name || "Unassigned"}`,
    `Decision: ${status}`,
    "",
    "NEXT STEP",
    next,
    "",
    "OBSERVED — VERIFY AT SOURCE",
    ...evidence.map(
      (item, index) =>
        `[${index + 1}] ${item.title}\nSource: ${item.source} · Observed: ${item.observed_at}\n${safeEvidenceUrl(item.url) || "No source link supplied; verification required."}`,
    ),
    ...(evidence.length
      ? []
      : ["No dated observations are available as of this brief."]),
    ...(excludedObservations
      ? [
          `${excludedObservations} future-dated or undated observation${excludedObservations === 1 ? " is" : "s are"} excluded from this brief.`,
        ]
      : []),
    "",
    "OPPORTUNITY HYPOTHESIS",
    hypothesis,
    "",
    "OPEN QUESTIONS",
    ...(questions.length
      ? questions.map((item) => `- ${item}`)
      : ["Verify current priorities and decision-maker ownership directly."]),
    "",
    "TIMING ASSUMPTION",
    insights
      ? `If no new evidence arrives, the model projects ${insights.action_window.projected_score_in_14_days.score}/100 in 14 days and ${insights.action_window.projected_score_in_30_days.score}/100 in 30 days. This describes evidence decay, not a buyer deadline.`
      : "Timing projection unavailable.",
  ];
  return {
    ready,
    status,
    next,
    evidence,
    excludedObservations,
    hypothesis,
    questions,
    draft,
    text: lines.join("\n"),
  };
}

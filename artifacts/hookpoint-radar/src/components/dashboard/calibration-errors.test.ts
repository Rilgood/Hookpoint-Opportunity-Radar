import { describe, expect, it } from "vitest";
import { describeBlockedEvaluation, describeEvaluationFailure } from "./calibration-errors";
import { blockedHoldoutEvaluationResponse } from "@/test/fixtures/radar-responses";

const baseGuardrails = blockedHoldoutEvaluationResponse.data.guardrails;

describe("describeBlockedEvaluation", () => {
  it("reports a short holdout with the exact label shortfall", () => {
    const failure = describeBlockedEvaluation(blockedHoldoutEvaluationResponse.data);
    expect(failure.code).toBe("holdout_unavailable");
    expect(failure.kind).toBe("blocked");
    expect(failure.retryable).toBe(false);
    expect(failure.message).toContain("it currently has 10 (5 qualified / 5 negative)");
    expect(failure.message).toContain("At least 20 more labels and 5 more qualified outcomes and 5 more negative outcomes are required.");
  });

  it("names only the class that is short when the holdout is large enough but unbalanced", () => {
    const failure = describeBlockedEvaluation({
      status: "blocked",
      guardrails: { ...baseGuardrails, holdout_accounts: 30, qualified_accounts: 4, negative_accounts: 26 },
    });
    expect(failure.code).toBe("holdout_unavailable");
    expect(failure.message).toContain("At least 6 more qualified outcomes are required.");
    expect(failure.message).not.toContain("more labels");
  });

  it("reports a short training set once the holdout itself is sufficient", () => {
    const failure = describeBlockedEvaluation({
      status: "blocked",
      guardrails: {
        ...baseGuardrails,
        holdout_accounts: 30,
        qualified_accounts: 12,
        negative_accounts: 18,
        training_accounts: 20,
        training_qualified_accounts: 10,
        training_negative_accounts: 10,
      },
    });
    expect(failure.code).toBe("training_unavailable");
    expect(failure.title).toBe("Not enough earlier labels to propose new weights.");
    expect(failure.message).toContain("needs at least 30 labels with 10 in each class; it currently has 20 (10 qualified / 10 negative).");
    expect(failure.retryable).toBe(false);
  });

  it("explains missing score snapshots and tells the operator to rescore", () => {
    const failure = describeBlockedEvaluation({
      status: "blocked",
      reason: "Every training and holdout label needs a historic score snapshot.",
      guardrails: {
        ...baseGuardrails,
        holdout_accounts: 30,
        qualified_accounts: 12,
        negative_accounts: 18,
        training_accounts: 90,
        training_qualified_accounts: 40,
        training_negative_accounts: 50,
        scored_holdout_accounts: 28,
        scored_training_accounts: 90,
      },
    });
    expect(failure.code).toBe("snapshots_missing");
    expect(failure.message).toContain("Only 28 of 30 holdout labels and 90 of 90 training labels have one.");
    expect(failure.action).toContain("Rescore accounts");
  });

  it("treats a blocked result with before/after metrics as no improvement over the current version", () => {
    const reason = "The candidate did not improve holdout discrimination by the required 1 percentage point AUC margin.";
    const failure = describeBlockedEvaluation({
      status: "blocked",
      reason,
      guardrails: {
        ...baseGuardrails,
        holdout_accounts: 30,
        qualified_accounts: 12,
        negative_accounts: 18,
        training_accounts: 90,
        training_qualified_accounts: 40,
        training_negative_accounts: 50,
      },
      before: { auc: 0.6 },
      after: { auc: 0.6 },
    });
    expect(failure.code).toBe("no_improvement");
    expect(failure.message).toContain(reason);
    expect(failure.action).toContain("No action is needed");
  });

  it("falls back to the server's reason for an unrecognised guardrail", () => {
    const failure = describeBlockedEvaluation({ status: "blocked", reason: "Custom guardrail tripped.", guardrails: null });
    expect(failure.code).toBe("blocked");
    expect(failure.message).toBe("Custom guardrail tripped.");
  });
});

describe("describeEvaluationFailure", () => {
  it("maps a 429 without a code to rate limiting", () => {
    const failure = describeEvaluationFailure({ status: 429, data: {} });
    expect(failure.code).toBe("rate_limited");
    expect(failure.kind).toBe("error");
    expect(failure.retryable).toBe(true);
  });

  it("maps a network failure with no response to the generic explanation", () => {
    const failure = describeEvaluationFailure(new TypeError("Failed to fetch"));
    expect(failure.code).toBe("unknown");
    expect(failure.retryable).toBe(true);
  });
});

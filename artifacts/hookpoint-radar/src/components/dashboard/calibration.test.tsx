import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalibrationAnalytics } from "./calibration";
import {
  approvedCalibrationResponse,
  blockedHoldoutEvaluationResponse,
  calibrationEvaluationResponse,
  jsonResponse,
  outcomeAnalyticsResponse,
} from "@/test/fixtures/radar-responses";

function renderCalibration() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <CalibrationAnalytics />
    </QueryClientProvider>,
  );
}

describe("score calibration API integration", () => {
  it("evaluates, approves, renders the approved outcome, and refreshes analytics", async () => {
    let analyticsRequests = 0;
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      if (url === "/api/v1/analytics/outcomes") {
        analyticsRequests += 1;
        return jsonResponse(outcomeAnalyticsResponse);
      }
      if (url === "/api/v1/analytics/outcomes/evaluate") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeUndefined();
        return jsonResponse(calibrationEvaluationResponse);
      }
      if (url === "/api/v1/analytics/outcomes/recommendations/score-version-2/approve") {
        expect(init?.method).toBe("POST");
        expect(init?.body).toBeUndefined();
        return jsonResponse(approvedCalibrationResponse);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderCalibration();
    await screen.findByText("Outcome Calibration");
    await user.click(screen.getByRole("button", { name: "Evaluate holdout" }));
    await screen.findByText("Proposed rules-2.0");
    await user.click(screen.getByRole("button", { name: "Approve score version" }));

    await screen.findByText("Approved");
    await waitFor(() => expect(analyticsRequests).toBe(2));
  });

  describe("shows an operator-visible error when evaluation is rejected", () => {
    async function renderEvaluationOutcome(status: number, body: unknown) {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/v1/analytics/outcomes") return jsonResponse(outcomeAnalyticsResponse);
        if (url === "/api/v1/analytics/outcomes/evaluate") return jsonResponse(body, status);
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      renderCalibration();
      await screen.findByText("Outcome Calibration");
      await user.click(screen.getByRole("button", { name: "Evaluate holdout" }));
      const alert = await screen.findByTestId("evaluation-failure");
      return { alert, user, fetchMock };
    }

    it("explains how many more held-out labels are needed when the API blocks the evaluation, without suggesting a retry", async () => {
      // The real API answers 200 { status: "blocked", guardrails } for a short holdout.
      const { alert } = await renderEvaluationOutcome(200, blockedHoldoutEvaluationResponse);

      expect(alert.getAttribute("data-failure-kind")).toBe("blocked");
      expect(alert.getAttribute("data-failure-code")).toBe("holdout_unavailable");
      expect(alert.getAttribute("data-retryable")).toBe("false");
      expect(alert.textContent).toContain("Not enough recent held-out labels to evaluate.");
      expect(alert.textContent).toContain(
        "The holdout needs at least 30 labels with 10 qualified and 10 negative outcomes; it currently has 10 (5 qualified / 5 negative).",
      );
      expect(alert.textContent).toContain(
        "At least 20 more labels and 5 more qualified outcomes and 5 more negative outcomes are required.",
      );
      expect(alert.textContent).toContain("Re-running the evaluation will not change this until more outcomes are labeled.");
      expect(alert.textContent).toContain(
        "Next step: Keep recording qualifying and negative outcomes, then evaluate again once the holdout is large enough.",
      );
      expect(alert.textContent).not.toMatch(/please try again/i);
      expect(alert.textContent).not.toMatch(/try again/i);
      // The generic guardrail headline is replaced by the specific cause.
      expect(screen.queryByText("Recommendation blocked by guardrails")).toBeNull();
    });

    it("still explains a holdout_unavailable error envelope if the API ever rejects the request outright", async () => {
      const { alert } = await renderEvaluationOutcome(422, {
        error: { code: "holdout_unavailable", message: "No usable holdout." },
      });

      // No guardrail counts are available, so the explanation falls back to the
      // generic request-failure text rather than inventing numbers.
      expect(alert.getAttribute("data-failure-kind")).toBe("error");
      expect(alert.getAttribute("data-failure-code")).toBe("unknown");
      expect(alert.textContent).toContain("Unable to evaluate this cohort.");
    });

    it("explains that an administrator is required when the operator lacks permission", async () => {
      const { alert } = await renderEvaluationOutcome(403, {
        error: { code: "insufficient_scope", message: "admin permission is required." },
      });

      expect(alert.getAttribute("data-failure-kind")).toBe("error");
      expect(alert.getAttribute("data-failure-code")).toBe("insufficient_scope");
      expect(alert.getAttribute("data-retryable")).toBe("false");
      expect(alert.textContent).toContain("Administrator permission is required.");
      expect(alert.textContent).toContain("Your account can view calibration results but cannot run a holdout evaluation.");
      expect(alert.textContent).toContain("Next step: Ask a workspace administrator to run the evaluation.");
    });

    it("treats a 403 without a recognised code as a permission problem", async () => {
      const { alert } = await renderEvaluationOutcome(403, { error: { code: "forbidden", message: "Forbidden." } });

      expect(alert.getAttribute("data-failure-code")).toBe("insufficient_scope");
      expect(alert.textContent).toContain("Administrator permission is required.");
    });

    it("tells the operator to wait before retrying when rate limited", async () => {
      const { alert } = await renderEvaluationOutcome(429, {
        error: { code: "rate_limited", message: "Too many requests." },
      });

      expect(alert.getAttribute("data-failure-code")).toBe("rate_limited");
      expect(alert.getAttribute("data-retryable")).toBe("true");
      expect(alert.textContent).toContain("Too many requests in a short time.");
      expect(alert.textContent).toContain("Next step: Wait a minute, then evaluate again.");
    });

    it("falls back to a generic message for unrecognised failures", async () => {
      const { alert } = await renderEvaluationOutcome(500, {
        error: { code: "internal_error", message: "Service unavailable." },
      });

      expect(alert.getAttribute("data-failure-code")).toBe("unknown");
      expect(alert.getAttribute("data-retryable")).toBe("true");
      expect(alert.textContent).toContain("Unable to evaluate this cohort.");
      expect(alert.textContent).toContain("No recommendation was produced and the active score version is unchanged.");
      expect(alert.textContent).toContain("Next step: Try again in a moment.");
    });

    it("clears the failure once a later evaluation succeeds", async () => {
      let attempts = 0;
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/v1/analytics/outcomes") return jsonResponse(outcomeAnalyticsResponse);
        if (url === "/api/v1/analytics/outcomes/evaluate") {
          attempts += 1;
          return attempts === 1
            ? jsonResponse({ error: { code: "rate_limited", message: "Too many requests." } }, 429)
            : jsonResponse(calibrationEvaluationResponse);
        }
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      renderCalibration();
      await screen.findByText("Outcome Calibration");
      await user.click(screen.getByRole("button", { name: "Evaluate holdout" }));
      await screen.findByTestId("evaluation-failure");
      await user.click(screen.getByRole("button", { name: "Evaluate holdout" }));
      await screen.findByText("Proposed rules-2.0");
      expect(screen.queryByTestId("evaluation-failure")).toBeNull();
    });
  });

  describe("rejected approvals explain the cause and the next step", () => {
    const APPROVE_URL = "/api/v1/analytics/outcomes/recommendations/score-version-2/approve";

    async function renderRejectedApproval(status: number, body: unknown) {
      const fetchMock = vi.fn(async (url: string) => {
        if (url === "/api/v1/analytics/outcomes") return jsonResponse(outcomeAnalyticsResponse);
        if (url === "/api/v1/analytics/outcomes/evaluate") return jsonResponse(calibrationEvaluationResponse);
        if (url === APPROVE_URL) return jsonResponse(body, status);
        throw new Error(`Unexpected request: ${url}`);
      });
      vi.stubGlobal("fetch", fetchMock);
      const user = userEvent.setup();

      renderCalibration();
      await screen.findByText("Outcome Calibration");
      await user.click(screen.getByRole("button", { name: "Evaluate holdout" }));
      await screen.findByText("Proposed rules-2.0");
      await user.click(screen.getByRole("button", { name: "Approve score version" }));
      const alert = await screen.findByTestId("approval-rejection");
      return { alert, user, fetchMock };
    }

    it("tells the operator to re-evaluate when a newer score version was activated first", async () => {
      const { alert } = await renderRejectedApproval(409, {
        error: {
          code: "score_recommendation_stale",
          message: "This recommendation was evaluated against an older scoring version. Run a new evaluation.",
        },
      });

      expect(alert.getAttribute("data-rejection-code")).toBe("score_recommendation_stale");
      expect(alert.textContent).toContain("A newer score version was activated.");
      expect(alert.textContent).toContain("Next step: Re-run the evaluation to propose weights against the current version.");
      expect(alert.textContent).toContain("The current score version remains unchanged.");
      expect(screen.getByRole("button", { name: "Evaluate holdout" }).getAttribute("data-highlighted")).toBe("true");
      // The working view survives the rejection.
      expect(screen.getByText("Proposed rules-2.0")).toBeTruthy();
      expect(screen.getByRole("button", { name: "Approve score version" })).toBeTruthy();
    });

    it("explains that the recommendation is no longer pending", async () => {
      const { alert } = await renderRejectedApproval(409, {
        error: { code: "score_recommendation_not_pending", message: "Only a pending score recommendation can be approved." },
      });

      expect(alert.getAttribute("data-rejection-code")).toBe("score_recommendation_not_pending");
      expect(alert.textContent).toContain("This recommendation is no longer pending.");
      expect(alert.textContent).toContain("Next step: Refresh the dashboard to see the active score version");
    });

    it("explains that another approval won the race", async () => {
      const { alert } = await renderRejectedApproval(409, {
        error: { code: "score_approval_conflict", message: "Another scoring version is already active for this workspace." },
      });

      expect(alert.getAttribute("data-rejection-code")).toBe("score_approval_conflict");
      expect(alert.textContent).toContain("Another score version was approved first.");
      expect(alert.textContent).toContain("Next step: Re-run the evaluation so the proposal is based on the version that is now active.");
      expect(screen.getByRole("button", { name: "Evaluate holdout" }).getAttribute("data-highlighted")).toBe("true");
    });

    it("explains that an administrator is required when the operator lacks permission", async () => {
      const { alert } = await renderRejectedApproval(403, {
        error: { code: "insufficient_scope", message: "admin permission is required." },
      });

      expect(alert.getAttribute("data-rejection-code")).toBe("insufficient_scope");
      expect(alert.textContent).toContain("Administrator permission is required.");
      expect(alert.textContent).toContain("Your account can evaluate score recommendations but cannot approve them.");
      expect(alert.textContent).toContain("Next step: Ask a workspace administrator to approve this recommendation.");
      expect(screen.getByRole("button", { name: "Evaluate holdout" }).hasAttribute("data-highlighted")).toBe(false);
    });

    it("falls back to a generic message for unrecognised failures", async () => {
      const { alert } = await renderRejectedApproval(500, {
        error: { code: "internal_error", message: "Service unavailable." },
      });

      expect(alert.getAttribute("data-rejection-code")).toBe("unknown");
      expect(alert.textContent).toContain("Approval could not be saved.");
      expect(alert.textContent).toContain("The current score version remains unchanged.");
      expect(alert.textContent).toContain("Next step: Try again in a moment.");
    });

    it("clears the rejection once the operator re-runs the evaluation", async () => {
      const { user } = await renderRejectedApproval(409, {
        error: { code: "score_recommendation_stale", message: "stale" },
      });

      await user.click(screen.getByRole("button", { name: "Evaluate holdout" }));
      await screen.findByText("Proposed rules-2.0");
      expect(screen.queryByTestId("approval-rejection")).toBeNull();
      expect(screen.getByRole("button", { name: "Evaluate holdout" }).hasAttribute("data-highlighted")).toBe(false);
    });
  });
});
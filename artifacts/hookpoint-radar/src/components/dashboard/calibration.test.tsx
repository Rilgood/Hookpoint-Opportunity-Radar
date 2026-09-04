import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CalibrationAnalytics } from "./calibration";
import {
  approvedCalibrationResponse,
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

  it("shows an operator-visible error when evaluation is rejected", async () => {
    const fetchMock = vi.fn(async (url: string) => {
      if (url === "/api/v1/analytics/outcomes") return jsonResponse(outcomeAnalyticsResponse);
      if (url === "/api/v1/analytics/outcomes/evaluate") {
        return jsonResponse({ error: { code: "holdout_unavailable", message: "No usable holdout." } }, 422);
      }
      throw new Error(`Unexpected request: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderCalibration();
    await screen.findByText("Outcome Calibration");
    await user.click(screen.getByRole("button", { name: "Evaluate holdout" }));

    await screen.findByText("Unable to evaluate this cohort. Please try again.");
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
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
});
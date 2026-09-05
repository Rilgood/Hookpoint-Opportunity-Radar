import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { EvidenceReviewPanel } from "./evidence-review-panel";
import { jsonResponse } from "@/test/fixtures/radar-responses";

function mount() {
  return render(
    <QueryClientProvider
      client={
        new QueryClient({
          defaultOptions: {
            queries: { retry: false },
            mutations: { retry: false },
          },
        })
      }
    >
      <EvidenceReviewPanel companyId="account-1" />
    </QueryClientProvider>,
  );
}
const observation = {
  observation_id: "evidence-1",
  title: "A dated company announcement",
  source: "company_news",
  url: "https://example.com/news",
  observed_at: "2026-09-01T10:00:00Z",
  status: "unreviewed",
  note: null,
  reviewed_at: null,
  reviewed_by: null,
};
describe("evidence review", () => {
  it("requires a rejection reason, sends the exact observation and refreshes saved review state", async () => {
    const user = userEvent.setup();
    let saved = observation;
    let payload: unknown;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) => {
        if (init?.method === "POST") {
          payload = JSON.parse(String(init.body));
          saved = { ...saved, ...(payload as object) };
          return jsonResponse({ data: { review: saved, company: {} } });
        }
        return jsonResponse({
          data: { data: [saved], total: 1, limit: 5, offset: 0 },
        });
      }),
    );
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Review evidence" }),
    );
    await user.selectOptions(screen.getByLabelText("Decision"), "rejected");
    expect(
      screen
        .getByRole("button", { name: "Save evidence review" })
        .hasAttribute("disabled"),
    ).toBe(true);
    await user.type(
      screen.getByLabelText("Review note (required)"),
      "This announcement belongs to a different company.",
    );
    await user.click(
      screen.getByRole("button", { name: "Save evidence review" }),
    );
    await waitFor(() =>
      expect(payload).toEqual({
        observation_id: "evidence-1",
        status: "rejected",
        note: "This announcement belongs to a different company.",
      }),
    );
    expect(
      await screen.findByText("Rejected · Excluded from scoring"),
    ).toBeTruthy();
  });
  it("keeps the decision and note available when saving fails", async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_input, init) =>
        init?.method === "POST"
          ? new Response(
              JSON.stringify({
                error: { code: "unavailable", message: "Try again" },
              }),
              { status: 503, headers: { "content-type": "application/json" } },
            )
          : jsonResponse({
              data: { data: [observation], total: 1, limit: 5, offset: 0 },
            }),
      ),
    );
    mount();
    await user.click(
      await screen.findByRole("button", { name: "Review evidence" }),
    );
    await user.selectOptions(screen.getByLabelText("Decision"), "needs_review");
    await user.type(
      screen.getByLabelText("Review note (required)"),
      "Confirm the account identity.",
    );
    await user.click(
      screen.getByRole("button", { name: "Save evidence review" }),
    );
    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(
      (screen.getByLabelText("Review note (required)") as HTMLTextAreaElement)
        .value,
    ).toBe("Confirm the account identity.");
  });
  it("never renders an unsafe evidence URL", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          data: {
            data: [{ ...observation, url: "javascript:alert(1)" }],
            total: 1,
            limit: 5,
            offset: 0,
          },
        }),
      ),
    );
    mount();
    await screen.findByText(observation.title);
    expect(screen.queryByRole("link", { name: "View source" })).toBeNull();
  });
});

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Setup from "./setup";
import { jsonResponse } from "@/test/fixtures/radar-responses";

function fixture() {
  return {
    as_of: "2026-09-04T10:00:00Z",
    mode: "local",
    runtime: {
      ready: true,
      schema_version: 11,
      storage_mode: "persistent_sqlite",
      authenticated: true,
      scheduler_enabled: false,
      issues: [],
    },
    counts: {
      companies: 0,
      observations: 0,
      reviewed_evidence: 0,
      assigned_work: 0,
      work_items: 0,
      completed_work: 0,
      outcomes: 0,
      pending_identity: 0,
    },
    calibration: {
      labeled_accounts: 0,
      minimum_sample: 30,
      min_each_class: 10,
    },
    steps: [
      {
        key: "collect",
        title: "Bring in your first evidence",
        complete: false,
        value: 0,
        href: "/sources",
        detail: "Run a focused import.",
      },
    ],
    sources: [
      {
        key: "google_sheets",
        label: "Google Sheets",
        purpose: "Your research",
        description: "Import an authorized sheet.",
        inputs: ["Spreadsheet URL"],
        implemented: true,
        configured: false,
        enabled: false,
        mode: "pull",
        cadence: "daily",
        status: "needs_configuration",
        requirements: [
          { name: "GOOGLE_SHEETS_TENANT_BINDINGS", present: false },
        ],
        latest_run: null,
      },
      {
        key: "crm_hubspot",
        label: "HubSpot",
        purpose: "Planned",
        description: "Planned native adapter",
        inputs: [],
        implemented: false,
        configured: false,
        requirements: [],
        latest_run: null,
      },
    ],
  };
}
function mount() {
  render(
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retry: false } } })
      }
    >
      <Setup />
    </QueryClientProvider>,
  );
}
describe("guided workspace setup", () => {
  it("keeps empty local progress honest and live controls disabled", async () => {
    const payload = fixture();
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        jsonResponse({
          data: String(input).includes("workspace-readiness") ? payload : [],
        }),
      ),
    );
    mount();
    await screen.findByText("From signal to action");
    expect(screen.getByText("0 of 1 milestones observed")).toBeTruthy();
    expect(
      screen
        .getByRole("button", { name: "Configure first import" })
        .hasAttribute("disabled"),
    ).toBe(true);
    expect(screen.getByText("GOOGLE_SHEETS_TENANT_BINDINGS")).toBeTruthy();
    expect(screen.queryByRole("option", { name: "HubSpot" })).toBeNull();
    expect(
      screen.getByText(/They cannot be activated by adding a key/),
    ).toBeTruthy();
  });
  it("shows a failed readiness check and can recover without inventing zero progress", async () => {
    const user = userEvent.setup();
    let fail = true;
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input) =>
        String(input).includes("workspace-readiness")
          ? fail
            ? new Response("Unavailable", { status: 503 })
            : jsonResponse({ data: fixture() })
          : jsonResponse({ data: [] }),
      ),
    );
    mount();
    await screen.findByText("Setup status is unavailable");
    expect(screen.queryByText(/milestones observed/)).toBeNull();
    fail = false;
    await user.click(screen.getByRole("button", { name: "Retry setup check" }));
    expect(await screen.findByText("0 of 1 milestones observed")).toBeTruthy();
  });
});

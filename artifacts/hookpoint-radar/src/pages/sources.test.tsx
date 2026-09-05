import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { Connector, ConnectorRun } from "@workspace/api-client-react";
import Sources from "./sources";
import { jsonResponse } from "@/test/fixtures/radar-responses";
import { formatRunTime } from "@/lib/connector-schedule";

const meta = { request_id: "req_test", duration_ms: 1 };
afterEach(() => vi.unstubAllEnvs());

function connector(overrides: Partial<Connector>): Connector {
  return {
    connector_key: "gdelt",
    label: "GDELT",
    category: "news",
    provider: "gdelt",
    mode: "pull",
    cadence: "hourly",
    enabled: true,
    configured: true,
    implemented: true,
    status: "ready",
    run_count: 0,
    last_run_at: null,
    next_run_at: null,
    backoff_until: null,
    consecutive_failures: 0,
    last_error: null,
    config: { scheduleInput: { company: { name: "Acme" } } },
    last_run: null,
    schedule: {
      state: "due",
      reason:
        "Due now; runs on the next scheduler tick while the service is active.",
      will_run: true,
      next_run_at: null,
      backoff_until: null,
      consecutive_failures: 0,
    },
    ...overrides,
  };
}

const connectors: Connector[] = [
  connector({
    connector_key: "gdelt",
    label: "GDELT",
    last_run_at: "2026-09-04T10:00:00.000Z",
    next_run_at: "2026-09-04T11:00:00.000Z",
    last_run: {
      id: "run_sched",
      connector_key: "gdelt",
      status: "succeeded",
      trigger: "scheduled",
      started_at: "2026-09-04T09:59:00.000Z",
      finished_at: "2026-09-04T10:00:00.000Z",
      records_inserted: 3,
    },
    schedule: {
      state: "waiting",
      reason:
        "Waiting for its hourly cadence; next run at 2026-09-04T11:00:00.000Z.",
      will_run: true,
      next_run_at: "2026-09-04T11:00:00.000Z",
      backoff_until: null,
      consecutive_failures: 0,
    },
  }),
  connector({
    connector_key: "sec_edgar",
    label: "SEC EDGAR",
    cadence: "daily",
    status: "schedule_rejected",
    last_error: "GDELT requires a target company.",
    next_run_at: "2026-09-05T10:00:00.000Z",
    last_run: {
      id: "run_rej",
      connector_key: "sec_edgar",
      status: "failed",
      trigger: "scheduled",
      started_at: "2026-09-04T10:00:00.000Z",
      finished_at: "2026-09-04T10:00:01.000Z",
      error_message: "GDELT requires a target company.",
    },
    schedule: {
      state: "input_rejected",
      reason:
        "The saved schedule input was rejected (GDELT requires a target company.). Fix it under Configure; the daily cadence will try again at 2026-09-05T10:00:00.000Z.",
      will_run: false,
      next_run_at: "2026-09-05T10:00:00.000Z",
      backoff_until: null,
      consecutive_failures: 0,
    },
  }),
  connector({
    connector_key: "nppes",
    label: "NPPES",
    status: "error",
    last_error: "HTTP 429 from provider",
    consecutive_failures: 2,
    backoff_until: "2026-09-04T14:00:00.000Z",
    next_run_at: "2026-09-04T09:00:00.000Z",
    last_run: {
      id: "run_manual",
      connector_key: "nppes",
      status: "failed",
      trigger: "manual",
      started_at: "2026-09-04T08:00:00.000Z",
      finished_at: "2026-09-04T08:00:02.000Z",
      error_message: "HTTP 429 from provider",
    },
    schedule: {
      state: "backoff",
      reason:
        "Paused after 2 consecutive failures; retries automatically after 2026-09-04T14:00:00.000Z.",
      will_run: true,
      next_run_at: "2026-09-04T09:00:00.000Z",
      backoff_until: "2026-09-04T14:00:00.000Z",
      consecutive_failures: 2,
    },
  }),
  connector({
    connector_key: "usa_spending",
    label: "USAspending",
    next_run_at: "2026-09-04T09:00:00.000Z",
    schedule: {
      state: "due",
      reason:
        "Due now; runs on the next scheduler tick while the service is active.",
      will_run: true,
      next_run_at: "2026-09-04T09:00:00.000Z",
      backoff_until: null,
      consecutive_failures: 0,
    },
  }),
  connector({
    connector_key: "generic_webhook",
    label: "Generic Webhook",
    mode: "push",
    cadence: "realtime",
    enabled: false,
    status: "disabled",
    config: {},
    schedule: {
      state: "push",
      reason:
        "Generic Webhook receives data through its webhook endpoint; there is no pull schedule.",
      will_run: false,
      next_run_at: null,
      backoff_until: null,
      consecutive_failures: 0,
    },
  }),
  connector({
    connector_key: "google_sheets",
    label: "Google Sheets",
    enabled: false,
    status: "disabled",
    config: {},
    schedule: {
      state: "disabled",
      reason: "Disabled. Enable the connector to schedule it.",
      will_run: false,
      next_run_at: null,
      backoff_until: null,
      consecutive_failures: 0,
    },
  }),
];

const gdeltRuns: ConnectorRun[] = [
  {
    id: "run_sched",
    connector_key: "gdelt",
    status: "succeeded",
    trigger: "scheduled",
    started_at: "2026-09-04T09:59:00.000Z",
    finished_at: "2026-09-04T10:00:00.000Z",
    duration_ms: 1200,
    records_seen: 5,
    records_inserted: 3,
    records_rejected: 0,
    signals_created: 1,
    error_message: null,
    metadata: { trigger: "scheduled" },
  },
  {
    id: "run_manual_old",
    connector_key: "gdelt",
    status: "partial",
    trigger: "manual",
    started_at: "2026-09-03T15:00:00.000Z",
    finished_at: "2026-09-03T15:00:04.000Z",
    duration_ms: 4000,
    records_seen: 4,
    records_inserted: 2,
    records_rejected: 2,
    signals_created: 0,
    error_message: null,
    metadata: { trigger: "manual" },
  },
  {
    id: "run_legacy",
    connector_key: "gdelt",
    status: "failed",
    trigger: null,
    started_at: "2026-09-01T15:00:00.000Z",
    finished_at: "2026-09-01T15:00:01.000Z",
    duration_ms: 900,
    records_seen: 0,
    records_inserted: 0,
    records_rejected: 0,
    signals_created: 0,
    error_message: "HTTP 503 from provider",
    metadata: {},
  },
];

function renderSources() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Sources />
    </QueryClientProvider>,
  );
}

function stubApi() {
  const requestedUrls: string[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.startsWith("/api/v1/connectors/runs")) {
          const key = new URL(url, "http://localhost").searchParams.get(
            "connector_key",
          );
          return jsonResponse({
            data: gdeltRuns.filter((run) => run.connector_key === key),
            meta,
          });
        }
        if (url === "/api/v1/connectors")
          return jsonResponse({ data: connectors, meta });
        return jsonResponse(
          { error: { code: "not_found", message: `unexpected ${url}` } },
          404,
        );
      },
    ),
  );
  return requestedUrls;
}

describe("connector schedule visibility", () => {
  it("disables connector mutations in the isolated local workspace", async () => {
    vi.stubEnv("VITE_LOCAL_DEMO", "true");
    const requests = stubApi();
    const user = userEvent.setup();
    renderSources();
    await screen.findByText("GDELT");
    expect(screen.getByTestId("local-source-limit").textContent).toContain(
      "read-only locally",
    );
    const configure = screen.getByTestId("btn-configure-gdelt");
    expect((configure as HTMLButtonElement).disabled).toBe(true);
    expect(
      (screen.getByTestId("switch-gdelt") as HTMLButtonElement).disabled,
    ).toBe(true);
    await user.click(configure);
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(requests).toEqual(["/api/v1/connectors"]);
  });
  it("shows last run outcome and trigger, the next run, and why a cadence is waiting", async () => {
    stubApi();
    renderSources();
    await screen.findByText("GDELT");

    // Waiting on its cadence: last scheduled run succeeded, next run is a real timestamp.
    const gdeltLast = screen.getByTestId("text-last-run-gdelt");
    expect(
      within(gdeltLast).getByTestId("badge-last-run-outcome-gdelt").textContent,
    ).toBe("Succeeded");
    expect(
      within(gdeltLast).getByTestId("text-last-run-trigger-gdelt").textContent,
    ).toBe("Scheduled");
    expect(screen.getByTestId("text-next-run-gdelt").textContent).toBe(
      formatRunTime("2026-09-04T11:00:00.000Z"),
    );
    expect(screen.queryByTestId("schedule-notice-gdelt")).toBeNull();

    // Schedule input rejected: explicit reason, deferred next run.
    const rejected = screen.getByTestId("schedule-notice-sec_edgar");
    expect(rejected.textContent).toContain("Schedule input rejected:");
    expect(rejected.textContent).toContain("GDELT requires a target company.");
    expect(rejected.textContent).toContain(
      `daily cadence will try again at ${formatRunTime("2026-09-05T10:00:00.000Z")}`,
    );
    expect(rejected.textContent).not.toContain("2026-09-05T10:00:00.000Z");
    expect(screen.getByTestId("text-next-run-sec_edgar").textContent).toMatch(
      /^Deferred to /,
    );
    expect(
      screen.getByTestId("badge-last-run-outcome-sec_edgar").textContent,
    ).toBe("Failed");

    // Provider backoff: reason names the failure count and the retry time, last error shown once.
    const backoff = screen.getByTestId("schedule-notice-nppes");
    expect(backoff.textContent).toContain("In backoff:");
    expect(backoff.textContent).toContain("2 consecutive failures");
    expect(backoff.textContent).toContain(
      `after ${formatRunTime("2026-09-04T14:00:00.000Z")}`,
    );
    expect(backoff.textContent).toContain("HTTP 429 from provider");
    expect(screen.getByTestId("text-next-run-nppes").textContent).toMatch(
      /^After backoff/,
    );
    expect(screen.getByTestId("text-last-run-trigger-nppes").textContent).toBe(
      "Manual",
    );
    expect(screen.getAllByText(/HTTP 429 from provider/)).toHaveLength(1);

    // Due: no stale timestamp, the scheduler runs it when an instance is awake.
    expect(screen.getByTestId("text-next-run-usa_spending").textContent).toBe(
      "When the service is next active",
    );
    expect(screen.queryByTestId("schedule-notice-usa_spending")).toBeNull();
    expect(screen.getByTestId("text-last-run-usa_spending").textContent).toBe(
      "Never",
    );

    // Not schedulable at all.
    expect(
      screen.getByTestId("text-next-run-generic_webhook").textContent,
    ).toBe("Push (webhook)");
    expect(screen.getByTestId("text-next-run-google_sheets").textContent).toBe(
      "Disabled",
    );
  });

  it("lists a connector's recent runs and tells scheduled runs from manual ones", async () => {
    const requestedUrls = stubApi();
    const user = userEvent.setup();
    renderSources();
    await screen.findByText("GDELT");

    await user.click(screen.getByTestId("btn-configure-gdelt"));
    const history = await screen.findByTestId("run-history");
    await within(history).findByTestId("run-row-run_sched");

    expect(
      requestedUrls.some(
        (url) =>
          url.startsWith("/api/v1/connectors/runs?") &&
          url.includes("connector_key=gdelt"),
      ),
    ).toBe(true);
    expect(
      within(history).getByTestId("run-trigger-run_sched").textContent,
    ).toBe("Scheduled");
    expect(
      within(history).getByTestId("run-status-run_sched").textContent,
    ).toBe("Succeeded");
    expect(
      within(history).getByTestId("run-trigger-run_manual_old").textContent,
    ).toBe("Manual");
    expect(
      within(history).getByTestId("run-status-run_manual_old").textContent,
    ).toBe("Partial");
    expect(
      within(history).getByTestId("run-trigger-run_legacy").textContent,
    ).toBe("Unknown trigger");
    expect(within(history).getByText("HTTP 503 from provider")).toBeTruthy();
  });
});

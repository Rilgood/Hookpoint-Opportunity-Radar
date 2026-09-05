import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Connector } from "@workspace/api-client-react";
import { ConnectorDialog } from "./connector-dialog";
import { jsonResponse } from "@/test/fixtures/radar-responses";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
function connector(
  key: string,
  scheduleInput: Record<string, unknown> = {},
): Connector {
  return {
    connector_key: key,
    label: key,
    category: "news",
    provider: key,
    mode: "pull",
    cadence: "daily",
    enabled: true,
    configured: true,
    implemented: true,
    status: "ready",
    run_count: 0,
    config: { scheduleInput },
  };
}
function renderDialog(source: Connector) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={client}>
      <ConnectorDialog connector={source} open onOpenChange={vi.fn()} />
    </QueryClientProvider>,
  );
}
function mockRequests(
  result: Record<string, unknown> = {
    seen: 1,
    inserted: 1,
    duplicates: 0,
    rejected: 0,
    signals_created: 1,
  },
) {
  const writes: {
    url: string;
    method: string;
    body: Record<string, unknown>;
  }[] = [];
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.startsWith("/api/v1/connectors/runs"))
        return jsonResponse({ data: [] });
      if (init?.method === "POST" || init?.method === "PATCH") {
        writes.push({
          url,
          method: init.method,
          body: JSON.parse(String(init.body)),
        });
        return jsonResponse({ data: result });
      }
      return jsonResponse(
        { error: { message: `Unexpected request ${url}` } },
        404,
      );
    }),
  );
  return writes;
}
beforeEach(() => toast.mockClear());

describe("connector configuration requests", () => {
  it("sends the entered NewsAPI company, domain and focused query", async () => {
    const writes = mockRequests();
    const user = userEvent.setup();
    renderDialog(connector("newsapi"));
    await user.type(screen.getByLabelText("Company Name"), "Acme Health");
    await user.type(screen.getByLabelText("Company Domain"), "acme.test");
    await user.type(
      screen.getByLabelText("Focused Query (Optional)"),
      "new clinic",
    );
    await user.click(screen.getByRole("button", { name: "Run Now" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0]).toEqual({
      url: "/api/v1/connectors/newsapi/run",
      method: "POST",
      body: {
        company: { name: "Acme Health", domain: "acme.test" },
        query: "new clinic",
        limit: 10,
      },
    });
  });

  it.each(["Run Now", "Save & Schedule"])(
    "sends parsed actor JSON via %s while retaining advanced mapping settings",
    async (button) => {
      const writes = mockRequests();
      const user = userEvent.setup();
      const mapping = { title: "headline", url: "canonicalUrl" };
      renderDialog(
        connector("apify_news", {
          company: { name: "Acme", crm_id: "crm-123" },
          mapping,
          actor_input: { startUrls: [{ url: "https://old.test" }] },
          customDataset: "verified-feed",
        }),
      );
      const actorInput = {
        startUrls: [{ url: "https://acme.test/news" }],
        maxItems: 3,
      };
      fireEvent.change(screen.getByLabelText("Actor input JSON"), {
        target: { value: JSON.stringify(actorInput) },
      });
      await user.click(screen.getByRole("button", { name: button }));
      await waitFor(() => expect(writes).toHaveLength(1));
      const expectedInput = {
        company: { name: "Acme", crm_id: "crm-123" },
        mapping,
        actor_input: actorInput,
        customDataset: "verified-feed",
        limit: 10,
      };
      expect(writes[0]).toEqual(
        button === "Run Now"
          ? {
              url: "/api/v1/connectors/apify_news/run",
              method: "POST",
              body: expectedInput,
            }
          : {
              url: "/api/v1/connectors/apify_news",
              method: "PATCH",
              body: { enabled: true, schedule_input: expectedInput },
            },
      );
    },
  );

  it.each(['{"startUrls":', "[]", "null"])(
    "blocks invalid actor input %s before a run or saved schedule",
    async (invalid) => {
      const writes = mockRequests();
      const user = userEvent.setup();
      renderDialog(connector("apify_news"));
      fireEvent.change(screen.getByLabelText("Actor input JSON"), {
        target: { value: invalid },
      });
      await user.click(screen.getByRole("button", { name: "Run Now" }));
      await screen.findByText(
        "Enter a valid JSON object using your actor’s input schema.",
      );
      await user.click(screen.getByRole("button", { name: "Save & Schedule" }));
      expect(writes).toEqual([]);
    },
  );

  it("retains SEC form filters and identity hints while allowing visible fields to be cleared", async () => {
    const writes = mockRequests();
    const user = userEvent.setup();
    const forms = ["8-K", "10-K"];
    renderDialog(
      connector("sec_edgar", {
        company: { name: "Acme", domain: "old.test", crm_id: "crm-123" },
        forms,
        cik: "0000320193",
        limit: 7,
        cursor: { filingDate: "2026-09-01" },
      }),
    );
    await user.clear(screen.getByLabelText("Company Domain"));
    await user.clear(screen.getByLabelText("Company Name"));
    await user.type(screen.getByLabelText("Company Name"), "Acme Holdings");
    await user.click(screen.getByRole("button", { name: "Save & Schedule" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({
      enabled: true,
      schedule_input: {
        company: { name: "Acme Holdings", crm_id: "crm-123" },
        forms,
        cik: "0000320193",
        limit: 7,
        cursor: { filingDate: "2026-09-01" },
      },
    });
  });

  it("replaces a stored sheet ID with the entered URL without losing provider options", async () => {
    const writes = mockRequests();
    const user = userEvent.setup();
    renderDialog(
      connector("google_sheets", {
        spreadsheet_id: "old-sheet",
        range: "Data!A1:Z10",
        header_row: 3,
      }),
    );
    await user.clear(screen.getByLabelText("Spreadsheet URL or ID"));
    await user.type(
      screen.getByLabelText("Spreadsheet URL or ID"),
      "https://docs.google.com/spreadsheets/d/new-sheet/edit",
    );
    await user.click(screen.getByRole("button", { name: "Save & Schedule" }));
    await waitFor(() => expect(writes).toHaveLength(1));
    expect(writes[0].body).toEqual({
      enabled: true,
      schedule_input: {
        spreadsheet_url:
          "https://docs.google.com/spreadsheets/d/new-sheet/edit",
        range: "Data!A1:Z10",
        header_row: 3,
      },
    });
  });
});

describe("connector run results", () => {
  it.each([
    {
      seen: 4,
      inserted: 2,
      rejected: 2,
      duplicates: 0,
      signals: 8,
      signals_created: 1,
      heading: "Import needs review",
    },
    {
      seen: 3,
      inserted: 0,
      rejected: 0,
      duplicates: 3,
      signals: 8,
      signals_created: 0,
      heading: "No new evidence",
    },
  ])(
    "reports $heading truthfully and uses newly created signal counts",
    async ({ heading, ...stats }) => {
      mockRequests(stats);
      const user = userEvent.setup();
      renderDialog(connector("newsapi", { company: { name: "Acme" } }));
      await user.click(screen.getByRole("button", { name: "Run Now" }));
      await screen.findByRole("heading", { name: heading });
      expect(
        screen.queryByRole("heading", { name: "Evidence imported" }),
      ).toBeNull();
      expect(screen.queryByText(/successfully/i)).toBeNull();
      expect(screen.getByText("New signals").parentElement?.textContent).toBe(
        `New signals${stats.signals_created}`,
      );
      expect(toast).toHaveBeenCalledWith(
        expect.objectContaining({ title: heading }),
      );
      if (stats.rejected)
        expect(
          screen
            .getByRole("link", { name: "Review data quality" })
            .getAttribute("href"),
        ).toBe("/quality");
      else
        expect(
          screen.queryByRole("link", { name: "Review accounts" }),
        ).toBeNull();
    },
  );
});

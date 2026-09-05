import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import Opportunities from "./opportunities";
import {
  company,
  companyListResponse,
  jsonResponse,
} from "@/test/fixtures/radar-responses";
import {
  evidenceAge,
  opportunityReviewCue,
  parseOpportunityFilters,
} from "@/lib/opportunity-triage";
import type { Company } from "@workspace/api-client-react";

function renderOpportunities() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <Opportunities />
    </QueryClientProvider>,
  );
}

beforeEach(() => window.history.replaceState({}, "", "/opportunities"));

describe("opportunity workbench", () => {
  it("applies search, tier, and identity filters to both the API and the shareable URL", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return jsonResponse(companyListResponse);
      }),
    );
    const user = userEvent.setup();
    renderOpportunities();
    await screen.findByText("Acme Health");

    await user.click(screen.getByTestId("select-tier-filter"));
    await user.click(await screen.findByRole("option", { name: "Hot" }));
    await user.click(screen.getByTestId("select-identity-review-filter"));
    await user.click(
      await screen.findByRole("option", { name: "Needs review" }),
    );
    await user.type(screen.getByTestId("input-search-companies"), "Acme");
    await user.click(screen.getByTestId("button-apply-search"));

    await waitFor(() =>
      expect(requestedUrls).toContain(
        "/api/v1/companies?q=Acme&tier=hot&identity_review_status=needs_review&page=1&limit=20",
      ),
    );
    expect(window.location.search).toBe(
      "?q=Acme&tier=hot&identity_review_status=needs_review",
    );
    expect(screen.getByTestId("link-export-csv").getAttribute("href")).toBe(
      "/api/v1/export/companies.csv?q=Acme&tier=hot&identity_review_status=needs_review",
    );
    expect(screen.getByTestId("row-company-company-1")).toBeTruthy();
  });

  it("restores a bookmarked stage and page, then resets pagination when the stage changes", async () => {
    window.history.replaceState(
      {},
      "",
      "/opportunities?q=Acme&status=contacted&page=2",
    );
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return jsonResponse({
          ...companyListResponse,
          data: { ...companyListResponse.data, total: 41, pages: 3 },
        });
      }),
    );
    const user = userEvent.setup();
    renderOpportunities();
    await screen.findByText("Acme Health");
    expect(
      (screen.getByTestId("input-search-companies") as HTMLInputElement).value,
    ).toBe("Acme");
    expect(requestedUrls).toContain(
      "/api/v1/companies?q=Acme&status=contacted&page=2&limit=20",
    );
    expect(screen.getByTestId("link-export-csv").getAttribute("href")).toBe(
      "/api/v1/export/companies.csv?q=Acme&status=contacted",
    );

    await user.click(screen.getByTestId("select-status-filter"));
    await user.click(
      await screen.findByRole("option", { name: "Meeting booked" }),
    );
    await waitFor(() =>
      expect(requestedUrls).toContain(
        "/api/v1/companies?q=Acme&status=meeting&page=1&limit=20",
      ),
    );
    expect(window.location.search).toBe("?q=Acme&status=meeting");
  });

  it("keeps filters and search in sync after navigation and supports keyboard search", async () => {
    const requestedUrls: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requestedUrls.push(String(input));
        return jsonResponse(companyListResponse);
      }),
    );
    const user = userEvent.setup();
    renderOpportunities();
    await screen.findByText("Acme Health");
    await user.keyboard("/");
    expect(document.activeElement).toBe(
      screen.getByTestId("input-search-companies"),
    );
    await user.keyboard("Boston{Enter}");
    await waitFor(() => expect(window.location.search).toBe("?q=Boston"));

    act(() => {
      window.history.replaceState({}, "", "/opportunities?q=Health&tier=warm");
      window.dispatchEvent(new PopStateEvent("popstate"));
    });
    await waitFor(() =>
      expect(
        (screen.getByTestId("input-search-companies") as HTMLInputElement)
          .value,
      ).toBe("Health"),
    );
    expect(screen.getByTestId("select-tier-filter").textContent).toBe("Warm");
    await user.click(screen.getByTestId("input-search-companies"));
    await user.keyboard("{Escape}");
    await waitFor(() => expect(window.location.search).toBe("?tier=warm"));
    expect(requestedUrls).toContain(
      "/api/v1/companies?tier=warm&page=1&limit=20",
    );
    await user.type(
      screen.getByTestId("input-search-companies"),
      "Unsubmitted draft",
    );
    await user.click(screen.getByRole("button", { name: "All accounts" }));
    expect(
      (screen.getByTestId("input-search-companies") as HTMLInputElement).value,
    ).toBe("");
  });

  it("shows a recoverable error rather than an empty account list", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ error: { message: "Unavailable" } }, 503),
      )
      .mockImplementation(async () => jsonResponse(companyListResponse));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderOpportunities();
    await screen.findByRole("heading", {
      name: "Opportunities could not be loaded",
    });
    expect(
      screen.queryByText("Your next opportunity starts with evidence"),
    ).toBeNull();
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("Acme Health");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears an empty filtered view without losing the usable account workspace", async () => {
    window.history.replaceState({}, "", "/opportunities?q=missing");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) =>
        jsonResponse(
          String(input).includes("q=missing")
            ? {
                ...companyListResponse,
                data: {
                  ...companyListResponse.data,
                  data: [],
                  total: 0,
                  pages: 0,
                },
              }
            : companyListResponse,
        ),
      ),
    );
    const user = userEvent.setup();
    renderOpportunities();
    await screen.findByRole("heading", { name: "No accounts match this view" });
    await user.click(
      screen.getAllByRole("button", { name: "Clear filters" })[0],
    );
    await screen.findByText("Acme Health");
    expect(window.location.search).toBe("");
  });

  it("surfaces safety holds, missing observations, and identity matches without implying buyer intent", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ...companyListResponse,
          data: {
            ...companyListResponse.data,
            data: [
              {
                ...company,
                opportunity_tier: "suppressed",
                identity_review_status: "needs_review",
                last_observed_at: null,
                owner_name: "Jordan Lee",
              },
            ],
          },
        }),
      ),
    );
    renderOpportunities();
    const row = await screen.findByTestId("row-company-company-1");
    expect(
      within(row).getAllByText("Review safety hold").length,
    ).toBeGreaterThan(0);
    expect(within(row).getByText("No observation")).toBeTruthy();
    expect(within(row).getByText("94% identity match")).toBeTruthy();
    expect(within(row).getByText("Jordan Lee")).toBeTruthy();
    expect(
      within(row)
        .getByRole("link", { name: "Review Acme Health" })
        .getAttribute("href"),
    ).toBe("/opportunities/company-1");
  });
});

describe("opportunity URL and freshness boundaries", () => {
  it("preserves the sales workflow when external observations are missing", () => {
    const account: Company = {
      ...company,
      status: "contacted",
      monitoring_tier: "watchlist",
      identity_review_status: "confirmed",
      opportunity_tier: "cold",
      last_observed_at: null,
    };
    expect(opportunityReviewCue(account).title).toBe("Review the follow-up");
    expect(
      opportunityReviewCue({
        ...account,
        status: "customer",
        identity_confidence: 0.5,
        opportunity_tier: "suppressed",
      }).title,
    ).toBe("Coordinate customer handoff");
    expect(opportunityReviewCue({ ...account, status: "prospect" }).title).toBe(
      "Add source evidence",
    );
  });
  it("ignores unsupported filters and invalid pages rather than sending bad API parameters", () => {
    expect(
      parseOpportunityFilters(
        "q=%20Acme%20&tier=gold&status=new&identity_review_status=bogus&page=0",
      ),
    ).toEqual({
      q: "Acme",
      tier: "all",
      status: "all",
      identity: "all",
      page: 1,
    });
    expect(parseOpportunityFilters("page=1.5").page).toBe(1);
  });

  it("distinguishes fresh, stale, absent, malformed, and future observations", () => {
    const now = Date.parse("2026-09-05T12:00:00Z");
    expect(evidenceAge("2026-09-05T09:00:00Z", now)).toEqual({
      label: "Today",
      stale: false,
      missing: false,
    });
    expect(evidenceAge("2026-08-01T12:00:00Z", now)).toEqual({
      label: "35 days ago",
      stale: true,
      missing: false,
    });
    expect(evidenceAge(null, now).missing).toBe(true);
    expect(evidenceAge("invalid", now).missing).toBe(true);
    expect(evidenceAge("2026-09-06T12:00:00Z", now).label).toBe("Future-dated");
  });
});

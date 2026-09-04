import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import Opportunities from "./opportunities";
import { companyListResponse, jsonResponse } from "@/test/fixtures/radar-responses";

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

describe("opportunity list API integration", () => {
  it("renders the API envelope and applies search, tier, and identity filters to the request", async () => {
    const requestedUrls: string[] = [];
    const fetchMock = vi.fn<(input: RequestInfo | URL, init?: RequestInit) => Promise<Response>>(
      async (input) => {
        requestedUrls.push(String(input));
        return jsonResponse(companyListResponse);
      },
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();

    renderOpportunities();
    await screen.findByText("Acme Health");

    await user.click(screen.getByTestId("select-tier-filter"));
    await user.click(await screen.findByRole("option", { name: "Hot" }));
    await user.click(screen.getByTestId("select-identity-review-filter"));
    await user.click(await screen.findByRole("option", { name: "Needs review" }));
    await user.type(screen.getByTestId("input-search-companies"), "Acme");
    await user.click(screen.getByTestId("button-apply-search"));

    await waitFor(() => {
      expect(requestedUrls).toContain(
        "/api/v1/companies?q=Acme&tier=hot&identity_review_status=needs_review&page=1&limit=20",
      );
    });
    expect(screen.getByTestId("row-company-company-1")).toBeTruthy();
  });
});
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import OpportunityDetail from "./opportunity-detail";
import {
  companyDetailResponse,
  companyListResponse,
  confirmedCompanyDetailResponse,
  jsonResponse,
  mergeCandidateListResponse,
} from "@/test/fixtures/radar-responses";

const { navigate, toast } = vi.hoisted(() => ({
  navigate: vi.fn(),
  toast: vi.fn(),
}));

vi.mock("wouter", () => ({
  Link: ({ children, href, ...props }: { children: React.ReactNode; href: string }) => (
    <a href={href} {...props}>{children}</a>
  ),
  useLocation: () => ["/opportunities/company-1", navigate],
  useParams: () => ({ id: "company-1" }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast }),
}));

function renderDetail() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <OpportunityDetail />
    </QueryClientProvider>,
  );
}

function mockDetailApi({
  confirmation = "success",
  action = "confirm",
}: {
  confirmation?: "success" | "error";
  action?: "confirm" | "merge" | "separate";
} = {}) {
  let detailRequests = 0;
  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    if (url === "/api/v1/companies/company-1") {
      detailRequests += 1;
      return jsonResponse(detailRequests > 1 ? confirmedCompanyDetailResponse : companyDetailResponse);
    }
    if (url.startsWith("/api/v1/companies?")) {
      return jsonResponse(action === "merge" ? mergeCandidateListResponse : companyListResponse);
    }

    const identityPath = `/api/v1/companies/company-1/identity/${action}`;
    if (url === identityPath) {
      if (confirmation === "error") {
        return jsonResponse({ error: { code: "invalid_identity", message: "Identity cannot be confirmed." } }, 422);
      }
      expect(init?.method).toBe("POST");
      const data = action === "merge"
        ? { source_company_id: "company-1", target_company_id: "company-2", merged: true }
        : action === "separate"
          ? { source_company_id: "company-1", separated_company_id: "company-3", separated: true }
          : companyDetailResponse.data.company;
      return jsonResponse({ data, meta: { request_id: "mutation", duration_ms: 2 } });
    }
    throw new Error(`Unexpected request: ${url}`);
  });
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, getDetailRequests: () => detailRequests };
}

describe("identity review API integration", () => {
  it("submits an authoritative identifier and refreshes the detail after confirmation", async () => {
    const { fetchMock, getDetailRequests } = mockDetailApi();
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Acme Health");
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));

    await waitFor(() => {
      const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/v1/companies/company-1/identity/confirm")!;
      expect(JSON.parse(init?.body as string)).toEqual({ identity_type: "domain", value: "acme.test" });
      expect(getDetailRequests()).toBe(2);
    });
    expect(screen.getByText("Confirmed")).toBeTruthy();
  });

  it("sends explicit confirmation for a merge, refreshes cached data, and follows the returned target", async () => {
    const { fetchMock, getDetailRequests } = mockDetailApi({ action: "merge" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Acme Health");
    await user.click(screen.getByRole("button", { name: "Merge duplicate" }));
    await user.click(screen.getByRole("combobox"));
    await user.click(await screen.findByRole("option", { name: "Target Health — target-health.test" }));
    await user.click(screen.getByRole("button", { name: "Confirm merge" }));

    await waitFor(() => {
      const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/v1/companies/company-1/identity/merge")!;
      expect(JSON.parse(init?.body as string)).toEqual({ target_company_id: "company-2", confirmed: true });
      expect(getDetailRequests()).toBe(2);
      expect(navigate).toHaveBeenCalledWith("/opportunities/company-2");
    });
  });

  it("submits the selected aliases for a separation and refreshes the source detail", async () => {
    const { fetchMock, getDetailRequests } = mockDetailApi({ action: "separate" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Acme Health");
    await user.click(screen.getByRole("button", { name: "Separate" }));
    await user.type(screen.getByPlaceholderText("Name of the new account"), "Acme Division");
    await user.click(screen.getAllByRole("checkbox")[0]);
    await user.click(screen.getByRole("button", { name: "Confirm separation" }));

    await waitFor(() => {
      const [, init] = fetchMock.mock.calls.find(([url]) => url === "/api/v1/companies/company-1/identity/separate")!;
      expect(JSON.parse(init?.body as string)).toEqual({
        name: "Acme Division",
        alias_ids: ["alias-domain"],
        confirmed: true,
      });
      expect(getDetailRequests()).toBe(2);
    });
  });

  it("shows the identity-save error when the confirm endpoint rejects the request", async () => {
    mockDetailApi({ confirmation: "error" });
    const user = userEvent.setup();
    renderDetail();

    await screen.findByText("Acme Health");
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));
    await user.click(screen.getByRole("button", { name: "Confirm identity" }));

    await waitFor(() => {
      expect(toast).toHaveBeenCalledWith(expect.objectContaining({
        title: "Unable to confirm identity",
        variant: "destructive",
      }));
    });
  });
});
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import WorkQueue from "./work-queue";
import { WorkItemDialog } from "@/components/work-item-dialog";
import { localTimeZone, type WorkItem } from "@/lib/workflow-api";
import { jsonResponse } from "@/test/fixtures/radar-responses";

const { toast } = vi.hoisted(() => ({ toast: vi.fn() }));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast }) }));
const item: WorkItem = {
  id: "work-1",
  company_id: "company-1",
  company_name: "Acme Health",
  company_status: "contacted",
  title: "Review the buyer's reply",
  owner_name: "Jordan",
  due_at: "2026-09-04T10:00:00.000Z",
  note: "Bring the account brief.",
  status: "open",
  snoozed_until: null,
  resolution_note: null,
  completed_at: null,
  created_at: "2026-09-01T10:00:00.000Z",
  updated_at: "2026-09-01T10:00:00.000Z",
  created_by: "operator",
  updated_by: "operator",
  is_actionable: true,
  suggested_next_action: "Review reply before outreach.",
};
function queueResponse(items: WorkItem[] = [], counts = {}) {
  return {
    data: {
      data: items,
      total: items.length,
      limit: 20,
      offset: 0,
      counts: {
        all: items.length,
        open: items.length,
        due: 0,
        today: 0,
        overdue: 0,
        upcoming: 0,
        snoozed: 0,
        completed: 0,
        dismissed: 0,
        ...counts,
      },
      as_of: "2026-09-04T12:00:00.000Z",
      time_zone: localTimeZone(),
    },
  };
}
function renderWithQueries(element: React.ReactNode) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>{element}</QueryClientProvider>,
  );
}
beforeEach(() => {
  window.history.replaceState({}, "", "/work-queue");
  toast.mockClear();
});

describe("persistent work queue", () => {
  it("recovers an empty later page without discarding the account or owner filter", async () => {
    window.history.replaceState(
      {},
      "",
      "/work-queue?view=all&company_id=company-1&owner_name=Jordan&offset=20",
    );
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse({
          ...queueResponse([], { all: 1 }),
          data: { ...queueResponse([], { all: 1 }).data, total: 1 },
        }),
      ),
    );
    const user = userEvent.setup();
    renderWithQueries(<WorkQueue />);
    await screen.findByText("This page is now clear.");
    expect(screen.queryByText("No actions match this view.")).toBeNull();
    await user.click(screen.getByRole("button", { name: "First page" }));
    const search = new URLSearchParams(window.location.search);
    expect(search.get("offset")).toBeNull();
    expect(search.get("company_id")).toBe("company-1");
    expect(search.get("owner_name")).toBe("Jordan");
  });
  it("uses server counts and a local-day query, with shareable search and owner filters", async () => {
    const requests: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        requests.push(String(input));
        return jsonResponse(
          queueResponse([item], { all: 17, open: 9, today: 4, overdue: 2 }),
        );
      }),
    );
    const user = userEvent.setup();
    renderWithQueries(<WorkQueue />);
    await screen.findByText(item.title);
    expect(screen.getByTestId("queue-count-today").textContent).toBe("4");
    expect(screen.getByTestId("queue-count-open").textContent).toBe("9");
    const initial = new URL(requests[0], "https://radar.test");
    expect(initial.searchParams.get("view")).toBe("today");
    expect(initial.searchParams.get("time_zone")).toBe(localTimeZone());
    await user.type(
      screen.getByRole("textbox", { name: "Search actions and accounts" }),
      "buyer reply",
    );
    await user.type(
      screen.getByRole("textbox", { name: "Owner name" }),
      "Jordan",
    );
    await user.click(screen.getByRole("button", { name: "Apply filters" }));
    await user.click(screen.getByRole("button", { name: /^Upcoming/ }));
    await waitFor(() =>
      expect(
        requests.some((url) => {
          const params = new URL(url, "https://radar.test").searchParams;
          return (
            params.get("q") === "buyer reply" &&
            params.get("owner_name") === "Jordan" &&
            params.get("view") === "upcoming"
          );
        }),
      ).toBe(true),
    );
    expect(new URLSearchParams(window.location.search).get("owner_name")).toBe(
      "Jordan",
    );
    expect(
      screen.getByRole("link", { name: "Acme Health" }).getAttribute("href"),
    ).toBe("/opportunities/company-1");
  });

  it("completes an action on the server and refreshes the active list without recording an outcome", async () => {
    let complete = false;
    const mutations: { url: string; body: unknown }[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        if (init?.method === "PATCH") {
          mutations.push({ url, body: JSON.parse(String(init.body)) });
          complete = true;
          return jsonResponse({ data: { ...item, status: "done" } });
        }
        return jsonResponse(
          queueResponse(complete ? [] : [item], {
            all: 1,
            open: complete ? 0 : 1,
            completed: complete ? 1 : 0,
          }),
        );
      }),
    );
    const user = userEvent.setup();
    renderWithQueries(<WorkQueue />);
    await user.click(
      await screen.findByRole("button", { name: `Complete ${item.title}` }),
    );
    await waitFor(() => expect(screen.queryByText(item.title)).toBeNull());
    expect(mutations).toEqual([
      { url: "/api/v1/work-items/work-1", body: { status: "done" } },
    ]);
    expect(screen.getByTestId("queue-count-open").textContent).toBe("0");
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({
        description: expect.stringContaining("pipeline stage is unchanged"),
      }),
    );
  });

  it("keeps a failed load distinct from a measured empty queue and supports retry", async () => {
    let available = false;
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        available
          ? jsonResponse(queueResponse())
          : jsonResponse({ error: { message: "Unavailable" } }, 503),
      ),
    );
    const user = userEvent.setup();
    renderWithQueries(<WorkQueue />);
    await screen.findByRole("alert");
    expect(screen.getByTestId("queue-count-today").textContent).toBe("—");
    expect(screen.queryByText("A little space in your day.")).toBeNull();
    available = true;
    await user.click(screen.getByRole("button", { name: "Try again" }));
    await screen.findByText("A little space in your day.");
    expect(screen.getByTestId("queue-count-today").textContent).toBe("0");
  });

  it("does not surface a stale outreach recommendation for a closed account's remaining action", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        jsonResponse(
          queueResponse([
            {
              ...item,
              company_status: "lost",
              is_actionable: false,
              suggested_next_action: "Contact this buyer now",
            },
          ]),
        ),
      ),
    );
    const user = userEvent.setup();
    renderWithQueries(<WorkQueue />);
    await screen.findByText(/This account's workflow is closed/);
    expect(screen.queryByText("Contact this buyer now")).toBeNull();
    expect(
      (
        screen.getByRole("button", {
          name: `Complete ${item.title}`,
        }) as HTMLButtonElement
      ).disabled,
    ).toBe(false);
    await user.click(
      screen.getByRole("button", { name: `More options for ${item.title}` }),
    );
    expect(
      screen
        .getByRole("menuitem", { name: "Snooze" })
        .getAttribute("aria-disabled"),
    ).toBe("true");
  });
});

describe("work item planning dialog", () => {
  it.each(["create", "reschedule"] as const)(
    "submits the displayed native date for %s even when no React change event fires",
    async (mode) => {
      const writes: { method?: string; body: Record<string, unknown> }[] = [];
      vi.stubGlobal(
        "fetch",
        vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
          writes.push({
            method: init?.method,
            body: JSON.parse(String(init?.body)),
          });
          return jsonResponse({ data: item });
        }),
      );
      const user = userEvent.setup();
      renderWithQueries(
        <WorkItemDialog
          open
          onOpenChange={vi.fn()}
          mode={mode}
          item={mode === "reschedule" ? item : undefined}
          account={
            mode === "create"
              ? {
                  id: item.company_id,
                  name: item.company_name,
                  suggested_next_action: item.title,
                }
              : undefined
          }
        />,
      );
      const dateInput = screen.getByLabelText(
        "Due date and time",
      ) as HTMLInputElement;
      fireEvent.change(dateInput, { target: { value: "2030-09-05T23:00" } });
      const nativeValueSetter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value",
      )!.set!;
      nativeValueSetter.call(dateInput, "2030-09-05T22:00");
      expect(dateInput.value).toBe("2030-09-05T22:00");
      await user.click(
        screen.getByRole("button", {
          name: mode === "create" ? "Plan action" : "Save changes",
        }),
      );
      await waitFor(() => expect(writes).toHaveLength(1));
      expect(writes[0].method).toBe(mode === "create" ? "POST" : "PATCH");
      expect(writes[0].body.due_at).toBe(
        new Date("2030-09-05T22:00").toISOString(),
      );
      if (mode === "reschedule")
        expect(writes[0].body.snoozed_until).toBeNull();
    },
  );
  it("saves a preset account action with owner and a UTC due date; failed saves retain the draft", async () => {
    const close = vi.fn();
    let available = false;
    const payloads: unknown[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        expect(String(input)).toBe("/api/v1/work-items");
        expect(init?.method).toBe("POST");
        payloads.push(JSON.parse(String(init?.body)));
        return available
          ? jsonResponse({ data: item }, 201)
          : jsonResponse(
              { error: { message: "Workspace temporarily unavailable." } },
              503,
            );
      }),
    );
    const user = userEvent.setup();
    renderWithQueries(
      <WorkItemDialog
        open
        onOpenChange={close}
        account={{
          id: "company-1",
          name: "Acme Health",
          owner_name: "Jordan",
          suggested_next_action: item.title,
        }}
      />,
    );
    const title = screen.getByRole("textbox", {
      name: "Next action",
    }) as HTMLInputElement;
    expect(title.value).toBe(item.title);
    fireEvent.change(screen.getByLabelText("Due date and time"), {
      target: { value: "2030-09-05T09:30" },
    });
    await user.type(
      screen.getByRole("textbox", { name: /Context/ }),
      "Read the reply first",
    );
    await user.click(screen.getByRole("button", { name: "Plan action" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "Workspace temporarily unavailable.",
    );
    expect(close).not.toHaveBeenCalled();
    expect(title.value).toBe(item.title);
    available = true;
    await user.click(screen.getByRole("button", { name: "Plan action" }));
    await waitFor(() => expect(close).toHaveBeenCalledWith(false));
    expect(payloads).toEqual(
      [0, 1].map(() => ({
        company_id: "company-1",
        title: item.title,
        owner_name: "Jordan",
        due_at: new Date("2030-09-05T09:30").toISOString(),
        note: "Read the reply first",
      })),
    );
  });

  it("requires a dismissal reason and keeps dismissal separate from disqualifying the account", async () => {
    const fetchMock = vi.fn(async () =>
      jsonResponse({ data: { ...item, status: "dismissed" } }),
    );
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithQueries(
      <WorkItemDialog open onOpenChange={vi.fn()} mode="dismiss" item={item} />,
    );
    const submit = screen.getByRole("button", {
      name: "Dismiss with reason",
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
    await user.type(
      screen.getByRole("textbox", { name: "Reason for dismissal" }),
      "   ",
    );
    expect(submit.disabled).toBe(true);
    expect(fetchMock).not.toHaveBeenCalled();
    await user.type(
      screen.getByRole("textbox", { name: "Reason for dismissal" }),
      "Buyer already answered the question",
    );
    await user.click(submit);
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe("/api/v1/work-items/work-1");
    expect(JSON.parse(String(init.body))).toEqual({
      status: "dismissed",
      resolution_note: "Buyer already answered the question",
    });
  });

  it("rejects a past snooze and saves only the return time, preserving the due date", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: item }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithQueries(
      <WorkItemDialog open onOpenChange={vi.fn()} mode="snooze" item={item} />,
    );
    fireEvent.change(screen.getByLabelText("Snooze until"), {
      target: { value: "2020-01-01T09:00" },
    });
    await user.click(screen.getByRole("button", { name: "Snooze action" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "future date",
    );
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Snooze until"), {
      target: { value: "2030-09-05T09:00" },
    });
    await user.click(screen.getByRole("button", { name: "Snooze action" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body))).toEqual({
      snoozed_until: new Date("2030-09-05T09:00").toISOString(),
    });
  });

  it("preserves an undated action when editing its title", async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ data: item }));
    vi.stubGlobal("fetch", fetchMock);
    const user = userEvent.setup();
    renderWithQueries(
      <WorkItemDialog
        open
        onOpenChange={vi.fn()}
        mode="edit"
        item={{ ...item, due_at: null }}
      />,
    );
    expect(
      (screen.getByLabelText("Due date and time") as HTMLInputElement).value,
    ).toBe("");
    await user.clear(screen.getByRole("textbox", { name: "Next action" }));
    await user.type(
      screen.getByRole("textbox", { name: "Next action" }),
      "Review the updated reply",
    );
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledOnce());
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(JSON.parse(String(init.body)).due_at).toBeNull();
  });
});

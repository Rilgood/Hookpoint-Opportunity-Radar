import { useEffect, useState, type FormEvent } from "react";
import { Link, useLocation, useSearch } from "wouter";
import {
  AlertCircle,
  ArrowRight,
  CalendarCheck2,
  CalendarClock,
  Check,
  CheckCheck,
  Clock3,
  ListTodo,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  WorkItemDialog,
  type WorkItemDialogMode,
} from "@/components/work-item-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  formatWorkDate,
  localTimeZone,
  useSaveWorkItem,
  useWorkItems,
  workItemError,
  type WorkItem,
  type WorkQueueView,
} from "@/lib/workflow-api";
import { humanizeLabel } from "@/lib/utils";

const PAGE_SIZE = 20;
const VIEWS = [
  { key: "today", label: "Today", count: "today" },
  { key: "overdue", label: "Overdue", count: "overdue" },
  { key: "upcoming", label: "Upcoming", count: "upcoming" },
  { key: "snoozed", label: "Snoozed", count: "snoozed" },
  { key: "completed", label: "Done", count: "completed" },
  { key: "all", label: "All actions", count: "all" },
] as const;
const EMPTY_COPY: Record<string, { title: string; description: string }> = {
  today: {
    title: "A little space in your day.",
    description:
      "No open actions are due on today's date. Plan a next step or review the rest of your queue.",
  },
  overdue: {
    title: "Nothing past due.",
    description:
      "No open actions have passed their due time. Snoozed actions stay in their own view until they return.",
  },
  upcoming: {
    title: "Your next chapter is open.",
    description:
      "No actions are scheduled after today. Give the next important step a date and an owner.",
  },
  snoozed: {
    title: "Nothing on pause.",
    description:
      "Snoozed actions appear here until their return time. Their original due dates are preserved.",
  },
  completed: {
    title: "Progress will appear here.",
    description:
      "Complete an action to keep a durable record of the work you have finished.",
  },
  all: {
    title: "Make room for the next move.",
    description:
      "No actions are planned yet. Start from an account brief or create a next action here.",
  },
};

export default function WorkQueue() {
  const search = useSearch();
  const [, navigate] = useLocation();
  const query = new URLSearchParams(search);
  const view: WorkQueueView = VIEWS.some(
    (entry) => entry.key === query.get("view"),
  )
    ? (query.get("view") as WorkQueueView)
    : "today";
  const q = (query.get("q") || "").slice(0, 100);
  const owner = (query.get("owner_name") || "").slice(0, 200);
  const companyId = query.get("company_id") || undefined;
  const offsetRaw = Number(query.get("offset") || 0);
  const offset = Number.isInteger(offsetRaw) && offsetRaw >= 0 ? offsetRaw : 0;
  const [draftQuery, setDraftQuery] = useState(q);
  const [draftOwner, setDraftOwner] = useState(owner);
  const [dialog, setDialog] = useState<{
    mode: WorkItemDialogMode;
    item?: WorkItem;
  } | null>(null);
  const { toast } = useToast();
  const timeZone = localTimeZone();
  const queue = useWorkItems({
    view,
    q: q || undefined,
    owner_name: owner || undefined,
    company_id: companyId,
    limit: PAGE_SIZE,
    offset,
    time_zone: timeZone,
  });
  const complete = useSaveWorkItem();
  const data = queue.data?.data;
  const counts = data?.counts;
  const asOf = data?.as_of ? Date.parse(data.as_of) : Date.now();
  const hasFilters = Boolean(q || owner || companyId);
  useEffect(() => {
    setDraftQuery(q);
    setDraftOwner(owner);
  }, [q, owner]);
  const updateView = (patch: Record<string, string | number | undefined>) => {
    const next = new URLSearchParams(search);
    next.delete("offset");
    Object.entries(patch).forEach(([key, value]) => {
      if (value === undefined || value === "" || value === 0) next.delete(key);
      else next.set(key, String(value));
    });
    navigate(`/work-queue${next.size ? `?${next}` : ""}`);
  };
  const submitSearch = (event: FormEvent) => {
    event.preventDefault();
    updateView({ q: draftQuery.trim(), owner_name: draftOwner.trim() });
  };
  const clearFilters = () => {
    setDraftQuery("");
    setDraftOwner("");
    updateView({ q: undefined, owner_name: undefined, company_id: undefined });
  };
  const finish = (item: WorkItem) =>
    complete.mutate(
      { kind: "update", id: item.id, data: { status: "done" } },
      {
        onSuccess: () =>
          toast({
            title: "Action completed",
            description:
              "Saved in your queue history. The account's pipeline stage is unchanged.",
          }),
        onError: (error) =>
          toast({
            title: "Could not complete action",
            description: workItemError(error),
            variant: "destructive",
          }),
      },
    );
  const empty = EMPTY_COPY[view] || EMPTY_COPY.all;

  return (
    <div className="space-y-6 pb-8 animate-in fade-in duration-500">
      <header className="flex flex-wrap items-end justify-between gap-4 px-1 pt-2">
        <div>
          <p className="mb-3 flex items-center gap-2.5 text-[10px] font-semibold uppercase tracking-[.19em] text-slate-500">
            <span className="h-px w-6 bg-slate-400/60" />
            From insight to action
          </p>
          <h1 className="text-[36px] font-semibold leading-[1.08] tracking-[-.055em] text-slate-950 sm:text-[44px]">
            Your work queue<span className="text-primary">.</span>
          </h1>
          <p className="mt-3 max-w-xl text-sm leading-relaxed text-slate-500">
            A clear next step for every account. Keep the owner, timing, and
            context together.
          </p>
        </div>
        <Button
          onClick={() => setDialog({ mode: "create" })}
          className="h-11 gap-2 rounded-full px-5 text-sm"
        >
          <Plus className="size-4" />
          Plan next action
        </Button>
      </header>
      <dl
        className="glass-panel grid grid-cols-3 overflow-hidden rounded-[26px]"
        aria-label="Queue summary"
      >
        {[
          { label: "Due today", key: "today", icon: CalendarCheck2 },
          { label: "Past due", key: "overdue", icon: Clock3 },
          { label: "Open actions", key: "open", icon: ListTodo },
        ].map((metric, index) => (
          <div
            key={metric.key}
            className={`px-5 py-5 sm:px-7 ${index < 2 ? "border-r border-white/80" : ""}`}
          >
            <dt className="flex items-center gap-2 text-xs text-slate-500">
              <metric.icon
                className="hidden size-3.5 sm:block"
                strokeWidth={1.5}
              />
              {metric.label}
            </dt>
            <dd
              className="mt-3 text-[34px] font-medium leading-none tracking-[-.06em] text-slate-900 tabular-nums"
              data-testid={`queue-count-${metric.key}`}
            >
              {queue.isError
                ? "—"
                : (counts?.[metric.key as "today" | "overdue" | "open"] ?? "—")}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2" aria-label="Queue views">
        {VIEWS.map((entry) => (
          <Button
            key={entry.key}
            size="sm"
            variant={view === entry.key ? "default" : "outline"}
            className="gap-2 rounded-full"
            aria-pressed={view === entry.key}
            onClick={() => updateView({ view: entry.key })}
          >
            {entry.label}
            {counts && !queue.isError && (
              <span
                className={`rounded-full px-1.5 text-[10px] tabular-nums ${view === entry.key ? "bg-white/20" : "bg-slate-100/70 text-slate-500"}`}
              >
                {counts[entry.count]}
              </span>
            )}
          </Button>
        ))}
      </div>
      <section
        className="glass-panel overflow-hidden rounded-[28px]"
        aria-label="Work queue actions"
      >
        <form
          onSubmit={submitSearch}
          className="flex flex-col gap-3 border-b border-white/70 p-4 sm:flex-row sm:flex-wrap sm:p-5"
        >
          <div className="relative min-w-0 flex-1">
            <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Search actions and accounts"
              placeholder="Search actions or accounts…"
              value={draftQuery}
              onChange={(event) => setDraftQuery(event.target.value)}
              maxLength={100}
              className="pl-9"
            />
          </div>
          <div className="relative sm:w-[200px]">
            <UserRound className="absolute left-3 top-3 size-4 text-muted-foreground" />
            <Input
              aria-label="Owner name"
              title="Exact owner name; capitalization does not matter"
              placeholder="Owner name"
              value={draftOwner}
              onChange={(event) => setDraftOwner(event.target.value)}
              maxLength={200}
              className="pl-9"
            />
          </div>
          <Button type="submit" variant="secondary">
            Apply filters
          </Button>
          {hasFilters && (
            <Button
              type="button"
              variant="ghost"
              onClick={clearFilters}
              className="gap-1.5"
            >
              <X className="size-3.5" />
              Clear
            </Button>
          )}
        </form>
        <div className="flex items-center justify-between gap-3 border-b border-white/60 px-5 py-3 text-xs text-slate-500">
          <p aria-live="polite">
            {queue.isError ? (
              "Queue unavailable"
            ) : queue.isLoading ? (
              "Loading your actions…"
            ) : (
              <>
                <span className="font-medium text-slate-700">
                  {data?.total ?? 0}
                </span>{" "}
                {hasFilters ? "matching " : ""}action
                {data?.total === 1 ? "" : "s"} ·{" "}
                {data?.time_zone?.replaceAll("_", " ") ||
                  timeZone.replaceAll("_", " ")}
              </>
            )}
          </p>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-7 gap-1.5 px-2 text-xs"
            disabled={queue.isFetching}
            onClick={() => void queue.refetch()}
            aria-label="Refresh work queue"
          >
            <RefreshCw
              className={`size-3 ${queue.isFetching ? "animate-spin" : ""}`}
            />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>
        {queue.isError ? (
          <div className="px-6 py-16 text-center" role="alert">
            <AlertCircle className="mx-auto mb-4 size-8 text-amber-600" />
            <h2 className="text-xl font-medium tracking-tight">
              Your queue could not be loaded
            </h2>
            <p className="mx-auto mt-2 max-w-md text-sm leading-relaxed text-muted-foreground">
              Your saved actions have not been changed. Retry to reconnect to
              the workspace.
            </p>
            <Button
              variant="outline"
              className="mt-5 rounded-full"
              onClick={() => void queue.refetch()}
            >
              Try again
            </Button>
          </div>
        ) : queue.isLoading ? (
          <div
            className="space-y-4 p-6"
            role="status"
            aria-label="Loading actions"
          >
            {[1, 2, 3].map((item) => (
              <div
                key={item}
                className="h-24 animate-pulse rounded-2xl bg-white/45"
              />
            ))}
          </div>
        ) : !data?.data.length ? (
          <div className="relative px-6 py-14 text-center sm:py-20">
            <div className="glass-inset mx-auto mb-5 flex size-16 items-center justify-center rounded-[22px] text-primary">
              <CalendarClock className="size-7" strokeWidth={1.25} />
            </div>
            <h2 className="text-2xl font-medium tracking-[-.035em] text-slate-900">
              {offset > 0
                ? "This page is now clear."
                : hasFilters
                  ? "No actions match this view."
                  : empty.title}
            </h2>
            <p className="mx-auto mt-3 max-w-md text-sm leading-[1.8] text-slate-500">
              {offset > 0
                ? "The queue has changed. Return to the first page to see current actions."
                : hasFilters
                  ? "Try another account, action, or exact owner name. Counts above reflect these filters."
                  : empty.description}
            </p>
            <div className="mt-6 flex flex-wrap justify-center gap-2">
              {offset > 0 ? (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={() => updateView({ offset: 0 })}
                >
                  First page
                </Button>
              ) : hasFilters ? (
                <Button
                  variant="outline"
                  className="rounded-full"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              ) : (
                <>
                  <Button
                    variant="outline"
                    className="rounded-full"
                    onClick={() => setDialog({ mode: "create" })}
                  >
                    <Plus className="mr-2 size-4" />
                    Plan an action
                  </Button>
                  {view !== "all" && counts && counts.all > 0 && (
                    <Button
                      variant="ghost"
                      className="rounded-full"
                      onClick={() => updateView({ view: "all" })}
                    >
                      View all actions <ArrowRight className="ml-2 size-4" />
                    </Button>
                  )}
                </>
              )}
            </div>
          </div>
        ) : (
          <ol className="divide-y divide-white/75" aria-label="Planned actions">
            {data.data.map((item) => {
              const snoozed =
                item.status === "open" &&
                !!item.snoozed_until &&
                Date.parse(item.snoozed_until) > asOf;
              const overdue =
                item.status === "open" &&
                !snoozed &&
                !!item.due_at &&
                Date.parse(item.due_at) < asOf;
              return (
                <li
                  key={item.id}
                  className="group px-5 py-5 transition-colors hover:bg-white/25 sm:px-6"
                  data-testid={`work-item-${item.id}`}
                >
                  <div className="flex items-start gap-3 sm:gap-4">
                    <div
                      className={`glass-inset mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl ${item.status === "done" ? "text-emerald-600" : snoozed ? "text-slate-400" : overdue ? "text-amber-600" : "text-primary"}`}
                    >
                      {item.status === "done" ? (
                        <CheckCheck className="size-4" />
                      ) : (
                        <CalendarClock className="size-4" strokeWidth={1.5} />
                      )}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <Link
                          href={`/opportunities/${item.company_id}`}
                          className="text-xs font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {item.company_name}
                        </Link>
                        <span className="text-[10px] text-slate-400">
                          {humanizeLabel(item.company_status)}
                        </span>
                        {item.status !== "open" && (
                          <Badge
                            variant="outline"
                            className="rounded-full text-[10px] font-normal"
                          >
                            {item.status === "done" ? "Completed" : "Dismissed"}
                          </Badge>
                        )}
                        {snoozed && (
                          <Badge
                            variant="outline"
                            className="rounded-full text-[10px] font-normal"
                          >
                            Snoozed
                          </Badge>
                        )}
                      </div>
                      <h2
                        className={`mt-2 text-[15px] font-medium leading-snug tracking-[-.015em] ${item.status === "open" ? "text-slate-900" : "text-slate-500"}`}
                      >
                        {item.title}
                      </h2>
                      {item.note && (
                        <p className="mt-2 max-w-3xl whitespace-pre-wrap text-xs leading-relaxed text-slate-500">
                          {item.note}
                        </p>
                      )}
                      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-slate-500">
                        <span className="flex items-center gap-1.5">
                          <UserRound className="size-3" />
                          {item.owner_name || "Unassigned"}
                        </span>
                        <span
                          className={`flex items-center gap-1.5 ${overdue ? "font-medium text-amber-700" : ""}`}
                        >
                          <Clock3 className="size-3" />
                          {snoozed
                            ? `Returns ${formatWorkDate(item.snoozed_until, data.time_zone)}`
                            : item.status === "done" && item.completed_at
                              ? `Completed ${formatWorkDate(item.completed_at, data.time_zone)}`
                              : `${overdue ? "Past due · " : ""}${formatWorkDate(item.due_at, data.time_zone)}`}
                        </span>
                      </div>
                      {item.status === "dismissed" && item.resolution_note && (
                        <p className="mt-3 rounded-xl bg-white/35 px-3 py-2 text-xs leading-relaxed text-slate-500">
                          <span className="font-medium">Dismissal reason:</span>{" "}
                          {item.resolution_note}
                        </p>
                      )}
                      {item.status === "open" &&
                        [
                          "customer",
                          "lost",
                          "rejected",
                          "disqualified",
                        ].includes(item.company_status) && (
                          <p className="mt-3 text-xs leading-relaxed text-amber-700">
                            This account's workflow is closed. Review its status
                            before proceeding. You can still complete or dismiss
                            this action.
                          </p>
                        )}
                    </div>
                    {item.status === "open" && (
                      <div className="flex shrink-0 items-center gap-1">
                        <Button
                          variant="outline"
                          size="sm"
                          className="h-8 gap-1.5 rounded-full px-2.5 text-xs"
                          aria-label={`Complete ${item.title}`}
                          disabled={complete.isPending}
                          onClick={() => finish(item)}
                        >
                          <Check className="size-3.5" />
                          <span className="hidden sm:inline">Complete</span>
                        </Button>
                        <DropdownMenu>
                          <DropdownMenuTrigger asChild>
                            <Button
                              variant="ghost"
                              size="icon"
                              className="size-8 rounded-full"
                              aria-label={`More options for ${item.title}`}
                              disabled={complete.isPending}
                            >
                              <MoreHorizontal className="size-4" />
                            </Button>
                          </DropdownMenuTrigger>
                          <DropdownMenuContent align="end">
                            <DropdownMenuItem
                              onSelect={() => setDialog({ mode: "edit", item })}
                            >
                              <Pencil className="mr-2 size-3.5" />
                              Edit details
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              onSelect={() =>
                                setDialog({ mode: "reschedule", item })
                              }
                            >
                              <CalendarClock className="mr-2 size-3.5" />
                              Reschedule
                            </DropdownMenuItem>
                            <DropdownMenuItem
                              disabled={[
                                "customer",
                                "lost",
                                "rejected",
                                "disqualified",
                              ].includes(item.company_status)}
                              onSelect={() =>
                                setDialog({ mode: "snooze", item })
                              }
                            >
                              <Clock3 className="mr-2 size-3.5" />
                              Snooze
                            </DropdownMenuItem>
                            <DropdownMenuSeparator />
                            <DropdownMenuItem
                              onSelect={() =>
                                setDialog({ mode: "dismiss", item })
                              }
                              className="text-destructive"
                            >
                              <X className="mr-2 size-3.5" />
                              Dismiss with reason
                            </DropdownMenuItem>
                          </DropdownMenuContent>
                        </DropdownMenu>
                      </div>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        )}
        {!queue.isError && data && data.total > PAGE_SIZE && (
          <div className="flex items-center justify-between gap-3 border-t border-white/75 px-5 py-4 text-xs text-slate-500">
            <span>
              {Math.min(offset + 1, data.total)}–
              {Math.min(offset + data.data.length, data.total)} of {data.total}
            </span>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                disabled={offset === 0}
                onClick={() =>
                  updateView({ offset: Math.max(0, offset - PAGE_SIZE) })
                }
              >
                Previous
              </Button>
              <Button
                variant="outline"
                size="sm"
                disabled={offset + PAGE_SIZE >= data.total}
                onClick={() => updateView({ offset: offset + PAGE_SIZE })}
              >
                Next
              </Button>
            </div>
          </div>
        )}
      </section>
      <p className="flex items-start gap-2 px-1 text-xs leading-relaxed text-slate-500">
        <Clock3 className="mt-0.5 size-3.5 shrink-0" />
        Reminders appear in this workspace only. Completing an action does not
        change an account's sales outcome or send an email.
      </p>
      <WorkItemDialog
        open={dialog !== null}
        mode={dialog?.mode}
        item={dialog?.item}
        onOpenChange={(open) => {
          if (!open) setDialog(null);
        }}
      />
    </div>
  );
}

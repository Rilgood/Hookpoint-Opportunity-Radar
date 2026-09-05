import { Link } from "wouter";
import { ArrowRight, ListTodo } from "lucide-react";
import {
  useWorkItems,
  localTimeZone,
  formatWorkDate,
} from "@/lib/workflow-api";
import { Button } from "@/components/ui/button";

export function DailyWorkQueue() {
  const timeZone = localTimeZone();
  const queue = useWorkItems({ view: "due", limit: 3, time_zone: timeZone });
  const result = queue.data?.data;
  return (
    <section
      className="glass-panel rounded-[28px] p-6 sm:p-7"
      aria-labelledby="daily-work-title"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2
          id="daily-work-title"
          className="flex items-center gap-2 font-semibold"
        >
          <ListTodo className="size-4 text-primary" />
          Your next moves
        </h2>
        <Link
          href="/work-queue"
          className="inline-flex items-center gap-2 text-xs font-semibold text-primary"
        >
          Open work queue
          <ArrowRight className="size-3.5" />
        </Link>
      </div>
      {queue.isLoading && (
        <p className="mt-4 text-sm text-muted-foreground" role="status">
          Loading saved actions…
        </p>
      )}
      {queue.isError && (
        <p className="mt-4 text-sm text-muted-foreground">
          Saved actions could not load.{" "}
          <button className="underline" onClick={() => void queue.refetch()}>
            Retry
          </button>
        </p>
      )}
      {result && !queue.isError && (
        <>
          <p className="mt-2 text-xs text-muted-foreground">
            {result.counts.due} due by the end of today ·{" "}
            {result.counts.overdue} overdue
          </p>
          {result.data.length ? (
            <div className="mt-4 grid gap-3 md:grid-cols-3">
              {result.data.map((item) => (
                <Link
                  key={item.id}
                  href={`/opportunities/${item.company_id}`}
                  className="glass-inset p-4 hover:bg-white/80"
                >
                  <p className="text-[11px] font-medium text-primary">
                    {item.company_name}
                  </p>
                  <p className="mt-2 text-sm font-semibold leading-6">
                    {item.title}
                  </p>
                  <p className="mt-3 text-[11px] text-muted-foreground">
                    {item.owner_name || "Unassigned"} ·{" "}
                    {formatWorkDate(item.due_at, timeZone)}
                  </p>
                </Link>
              ))}
            </div>
          ) : (
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground">
                No saved actions are due today. Turn an account recommendation
                into an owned next step.
              </p>
              <Button
                variant="outline"
                size="sm"
                asChild
                className="rounded-full"
              >
                <Link href="/work-queue">Plan an action</Link>
              </Button>
            </div>
          )}
        </>
      )}
    </section>
  );
}

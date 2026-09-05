import { getListRadarConnectorRunsQueryKey, useListRadarConnectorRuns } from "@workspace/api-client-react";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/loading-states";
import { CalendarClock, User } from "lucide-react";
import {
  formatDuration,
  formatRunTime,
  runOutcomeLabel,
  runOutcomeTone,
  toneBadgeClasses,
  triggerLabel,
} from "@/lib/connector-schedule";

interface ConnectorRunHistoryProps {
  connectorKey: string;
  enabled: boolean;
  limit?: number;
}

/** Recent runs for one connector, each labelled by who started it (the scheduler or an operator). */
export function ConnectorRunHistory({ connectorKey, enabled, limit = 8 }: ConnectorRunHistoryProps) {
  const params = { connector_key: connectorKey, limit };
  const { data, isLoading, isError } = useListRadarConnectorRuns(params, {
    query: { enabled, queryKey: getListRadarConnectorRunsQueryKey(params) },
  });
  const runs = data?.data ?? [];

  return (
    <section className="space-y-2" data-testid="run-history">
      <h4 className="text-sm font-semibold text-foreground">Recent runs</h4>
      {isLoading && <Skeleton className="h-16 w-full" />}
      {isError && (
        <p className="text-xs text-destructive" data-testid="run-history-error">Could not load run history.</p>
      )}
      {!isLoading && !isError && runs.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="run-history-empty">No runs recorded yet.</p>
      )}
      {runs.length > 0 && (
        <ul className="divide-y divide-border/60 rounded-md border border-border/60 text-xs">
          {runs.map((run) => {
            const tone = runOutcomeTone(run.status);
            const duration = formatDuration(run.duration_ms);
            return (
              <li key={run.id} className="flex flex-col gap-1 px-3 py-2" data-testid={`run-row-${run.id}`}>
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2 min-w-0">
                    <Badge className={`${toneBadgeClasses[tone]} shrink-0`} data-testid={`run-status-${run.id}`}>
                      {runOutcomeLabel(run.status)}
                    </Badge>
                    <span
                      className="inline-flex items-center gap-1 text-muted-foreground shrink-0"
                      data-testid={`run-trigger-${run.id}`}
                    >
                      {run.trigger === "scheduled" ? <CalendarClock className="h-3 w-3" /> : <User className="h-3 w-3" />}
                      {triggerLabel(run.trigger)}
                    </span>
                  </div>
                  <span className="text-muted-foreground tabular-nums shrink-0">{formatRunTime(run.started_at)}</span>
                </div>
                <div className="flex items-center justify-between gap-2 text-muted-foreground">
                  <span>
                    {run.records_inserted ?? 0} inserted
                    {run.records_rejected ? ` · ${run.records_rejected} rejected` : ""}
                    {run.signals_created ? ` · ${run.signals_created} signals` : ""}
                  </span>
                  {duration && <span className="tabular-nums">{duration}</span>}
                </div>
                {run.error_message && (
                  <p className="text-destructive line-clamp-2" title={run.error_message}>{run.error_message}</p>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}

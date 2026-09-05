import type { Connector, ConnectorRunSummary, ConnectorRunTrigger, ConnectorSchedule } from "@workspace/api-client-react";

export type ScheduleTone = "info" | "warning" | "error" | "muted";

export interface ScheduleNotice {
  tone: ScheduleTone;
  title: string;
  body: string;
}

export function formatRunTime(value: string | null | undefined): string {
  if (!value) return "—";
  return new Date(value).toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export function formatDuration(ms: number | null | undefined): string | null {
  if (ms == null) return null;
  if (ms < 1000) return `${ms} ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  return `${Math.round(ms / 60_000)} min`;
}

export function triggerLabel(trigger: ConnectorRunTrigger | null | undefined): string {
  if (trigger === "scheduled") return "Scheduled";
  if (trigger === "manual") return "Manual";
  return "Unknown trigger";
}

export function runOutcomeLabel(status: string): string {
  switch (status) {
    case "succeeded": return "Succeeded";
    case "partial": return "Partial";
    case "failed": return "Failed";
    case "running": return "Running";
    case "abandoned": return "Abandoned";
    default: return status;
  }
}

export function runOutcomeTone(status: string): ScheduleTone {
  switch (status) {
    case "succeeded": return "info";
    case "partial": return "warning";
    case "failed":
    case "abandoned": return "error";
    default: return "muted";
  }
}

/**
 * What to print in the "Next Run" row. A due connector deliberately shows no
 * timestamp: the scheduler only ticks while a service instance is awake, so
 * a past `next_run_at` would read as stale rather than as "imminent".
 */
export function nextRunLabel(schedule: ConnectorSchedule | undefined): string {
  if (!schedule) return "—";
  switch (schedule.state) {
    case "waiting": return formatRunTime(schedule.next_run_at);
    case "due": return "When the service is next active";
    case "running": return "Running now";
    case "backoff": return `After backoff (${formatRunTime(schedule.backoff_until)})`;
    case "input_rejected": return schedule.next_run_at ? `Deferred to ${formatRunTime(schedule.next_run_at)}` : "Deferred";
    case "manual": return "Manual only";
    case "disabled": return "Disabled";
    case "needs_configuration": return "Needs configuration";
    case "adapter_pending": return "Not available yet";
    case "push": return "Push (webhook)";
    default: return "—";
  }
}

const cadenceWords: Record<string, string> = { hourly: "hourly", realtime: "hourly", daily: "daily", weekly: "weekly", monthly: "monthly", quarterly: "quarterly" };

function plural(count: number, noun: string): string {
  return `${count} consecutive ${noun}${count === 1 ? "" : "s"}`;
}

/**
 * The callout worth showing under the card; null when the Next Run row already
 * says everything. Bodies are rebuilt from the structured schedule fields so
 * timestamps render in the operator's locale rather than as raw ISO strings.
 */
export function scheduleNotice(connector: Connector): ScheduleNotice | null {
  const schedule = connector.schedule;
  if (!schedule) return null;
  const failureDetail = connector.last_error ? ` Last error: ${connector.last_error}` : "";
  const cadence = cadenceWords[connector.cadence] ?? connector.cadence;
  switch (schedule.state) {
    case "backoff":
      return {
        tone: "warning",
        title: "In backoff:",
        body: `Paused after ${plural(schedule.consecutive_failures, "failure")}; retries automatically after ${formatRunTime(schedule.backoff_until)}.${failureDetail}`,
      };
    case "input_rejected":
      return {
        tone: "error",
        title: "Schedule input rejected:",
        body: `${connector.last_error ?? "The saved schedule input was rejected."} Fix it under Configure; the ${cadence} cadence will try again ${schedule.next_run_at ? `at ${formatRunTime(schedule.next_run_at)}` : "at its next slot"}.`,
      };
    case "due":
      return schedule.consecutive_failures > 0
        ? { tone: "warning", title: "Retry pending:", body: `Due after ${plural(schedule.consecutive_failures, "failure")}; runs on the next scheduler tick while the service is active.${failureDetail}` }
        : null;
    case "running":
      return { tone: "info", title: "Running:", body: schedule.reason };
    default:
      return null;
  }
}

export function lastRunSummary(connector: Connector): { time: string; outcome: string | null; tone: ScheduleTone; trigger: string | null; run: ConnectorRunSummary | null } {
  const run = connector.last_run ?? null;
  if (run) {
    return {
      time: formatRunTime(run.finished_at ?? run.started_at),
      outcome: runOutcomeLabel(run.status),
      tone: runOutcomeTone(run.status),
      trigger: triggerLabel(run.trigger),
      run,
    };
  }
  if (connector.last_run_at) return { time: formatRunTime(connector.last_run_at), outcome: null, tone: "muted", trigger: null, run: null };
  return { time: "Never", outcome: null, tone: "muted", trigger: null, run: null };
}

export const toneClasses: Record<ScheduleTone, string> = {
  info: "bg-primary/5 text-foreground border-primary/20",
  warning: "bg-amber-50 dark:bg-amber-950/30 text-amber-800 dark:text-amber-400 border-amber-200 dark:border-amber-800/50",
  error: "bg-destructive/10 text-destructive border-destructive/20",
  muted: "bg-muted text-muted-foreground border-border",
};

export const toneBadgeClasses: Record<ScheduleTone, string> = {
  info: "bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-400 border-transparent",
  warning: "bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-400 border-transparent",
  error: "bg-destructive/15 text-destructive border-transparent",
  muted: "bg-muted text-muted-foreground border-transparent",
};

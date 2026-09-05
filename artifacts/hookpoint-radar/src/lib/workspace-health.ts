import type { Connector } from "@workspace/api-client-react";

// Configuration is not proof of a successful collection. Summarize persisted runs.
export function workspaceHealth(
  connectors: Connector[] | undefined,
  now = Date.now(),
) {
  if (!connectors)
    return {
      label: "Source status unavailable",
      detail: "Source health could not be verified.",
      tone: "unknown",
      successful: 0,
      attention: 0,
    };
  const enabled = connectors.filter(
    (source) => source.implemented && source.enabled,
  );
  const active = enabled.filter((source) => source.configured);
  const successful = active.filter(
    (source) =>
      source.last_run?.status === "succeeded" &&
      !!source.last_run.finished_at &&
      Date.parse(source.last_run.finished_at) <= now,
  ).length;
  const attention = enabled.filter(
    (source) =>
      !source.configured ||
      source.last_error ||
      (source.consecutive_failures || 0) > 0 ||
      ["backoff", "input_rejected"].includes(source.schedule?.state || "") ||
      ["partial", "failed"].includes(source.last_run?.status || ""),
  ).length;
  if (attention)
    return {
      label: "Sources need attention",
      detail: `${attention} enabled source${attention === 1 ? " needs" : "s need"} review. Check configuration, failed runs, and rejected records.`,
      tone: "warning",
      successful,
      attention,
    };
  if (!active.length)
    return {
      label: "No enabled data sources",
      detail:
        "Connect a source to collect new observations. Existing records may have been imported manually.",
      tone: "unknown",
      successful,
      attention,
    };
  if (!successful)
    return {
      label: "Waiting for verified collection",
      detail: `${active.length} source${active.length === 1 ? " is" : "s are"} enabled; no successful latest run has been verified.`,
      tone: "unknown",
      successful,
      attention,
    };
  return {
    label:
      successful === active.length
        ? "Source runs verified"
        : "Some source runs unverified",
    detail: `${successful} of ${active.length} enabled sources have a successful latest run. Check evidence freshness before acting.`,
    tone: successful === active.length ? "success" : "unknown",
    successful,
    attention,
  };
}

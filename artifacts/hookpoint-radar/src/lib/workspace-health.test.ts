import { describe, expect, it } from "vitest";
import type { Connector } from "@workspace/api-client-react";
import { workspaceHealth } from "./workspace-health";

const source: Connector = {
  connector_key: "news",
  label: "News",
  category: "news",
  provider: "News",
  mode: "pull",
  cadence: "daily",
  enabled: true,
  configured: true,
  implemented: true,
  status: "ready",
  run_count: 0,
};
describe("source status truthfulness", () => {
  it("does not call an enabled connector live before it succeeds", () => {
    expect(workspaceHealth([source]).label).toBe(
      "Waiting for verified collection",
    );
  });
  it("distinguishes a failed latest run from a configuration flag", () => {
    expect(
      workspaceHealth([
        { ...source, last_error: "rate limit", consecutive_failures: 1 },
      ]).tone,
    ).toBe("warning");
  });
  it("reports missing health as unknown rather than disconnected", () => {
    expect(workspaceHealth(undefined).label).toBe("Source status unavailable");
  });
  it("requires a completed, nonfuture success", () => {
    const last_run = {
      id: "r",
      connector_key: "news",
      status: "succeeded",
      trigger: null,
      started_at: "2026-01-01T00:00:00Z",
      finished_at: "2026-01-01T00:01:00Z",
    };
    expect(
      workspaceHealth([{ ...source, last_run }], Date.parse("2026-01-02"))
        .successful,
    ).toBe(1);
    expect(
      workspaceHealth([{ ...source, last_run }], Date.parse("2025-01-02"))
        .successful,
    ).toBe(0);
  });
  it("reads failed run history even when aggregate error flags are missing", () => {
    expect(
      workspaceHealth([
        {
          ...source,
          last_run: {
            id: "failed",
            connector_key: "news",
            status: "failed",
            trigger: null,
            started_at: "2026-01-01T00:00:00Z",
            finished_at: "2026-01-01T00:01:00Z",
          },
        },
      ]).tone,
    ).toBe("warning");
  });
  it("reports enabled but unconfigured sources as requiring attention", () => {
    const health = workspaceHealth([{ ...source, configured: false }]);
    expect(health.label).toBe("Sources need attention");
    expect(health.attention).toBe(1);
  });
  it("does not treat a partial collection history as complete verification", () => {
    const success = {
      ...source,
      last_run: {
        id: "ok",
        connector_key: "news",
        status: "succeeded",
        trigger: null,
        started_at: "2026-01-01T00:00:00Z",
        finished_at: "2026-01-01T00:01:00Z",
        records_inserted: 0,
      },
    };
    expect(
      workspaceHealth([success, { ...source, connector_key: "other" }]).label,
    ).toBe("Some source runs unverified");
    expect(workspaceHealth([success]).label).toBe("Source runs verified");
  });
});

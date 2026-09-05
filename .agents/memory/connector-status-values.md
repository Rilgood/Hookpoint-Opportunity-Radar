---
name: Connector status values and the console
description: What to do when adding a connector status or exposing scheduler state; why bootstrap and the console must be updated together.
---

**Rule:** A new connector `status` value must be added to the preserved-status `CASE` in `syncConnectorCatalog` (bootstrap), or the next `GET /api/v1/connectors` silently resets it to `ready`. Scheduling explanations belong server-side (`describeConnectorSchedule`), not reconstructed in the console.

**Why:** Bootstrap re-syncs the catalog on every list call and only keeps a whitelist of statuses. `schedule_rejected` was chosen over a new column because production never runs DDL; the console then needs one derived `schedule.state` plus `reason` rather than re-deriving "due / waiting / backoff / rejected" from raw timestamps in every view (the dashboard and connectors page would drift).

**How to apply:** When adding a status: update bootstrap's list, `describeConnectorSchedule`, the `ConnectorScheduleState` enum in `lib/api-spec/openapi.yaml`, regenerate the client, and the console helpers in `artifacts/hookpoint-radar/src/lib/connector-schedule.ts`. Run attribution lives in `connector_runs.metadata_json.trigger`; legacy rows report `null`, keep that honest instead of guessing "manual". The console is behind Clerk, so verify visuals with a Playwright spec using the e2e sign-in helpers (seed the e2e tenant directly in the DB), not the screenshot tool.

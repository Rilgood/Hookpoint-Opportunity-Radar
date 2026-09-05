---
name: Connector input validation contract
description: Where per-adapter input rules live and why save-time and run-time checks must stay one function.
---

**Rule:** Every pull adapter exposes its synchronous, network-free input rules through a single `validateInput` hook; `collect()` calls it first and the connector-settings save path calls it when a recurring cadence is enabled. Never add an input check inline in `collect()` — put it in `validateInput` or operators only learn about it when the scheduled run fails.

**Why:** Operators used to save a schedule GDELT could not use and only saw `last_error` an hour later after the scheduler deferred the cadence. The scheduler's "defer 4xx to next cadence" branch is now only a safety net for rows saved before a rule tightened or for environment drift (e.g. revoked sheet bindings).

**How to apply:**
- Cursor validation stays in `collect()`: cursors are run-time state and schedule_input normally has none.
- Save-time validation hands the adapter the same shape the scheduler will (internal fields stripped, trusted tenant id attached non-enumerably), so tenant-scoped checks like Google Sheets bindings behave identically in both places.
- Save-time rejections keep the adapter's code and 4xx status; the message is prefixed with "schedule_input rejected:" so the console can tell a save error from a run error.
- The dev host runs on Postgres (schema `radar`), not the SQLite file in `data/`; for curl smoke tests insert the temporary API key with `psql "$DATABASE_URL"` — the sync worker bridge times out when opened from an ad-hoc `node -e` script.

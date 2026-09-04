---
name: Scheduler live verification
description: How to prove the in-host radar scheduler works in the dev workspace, and why live GDELT runs fail here.
---

**Rule:** Verify scheduled connector runs by watching `connector_runs` rows / `next_run_at` / `backoff_until` change, not by expecting a successful provider fetch.

**Why:** The workspace sandbox gets HTTP 429 from GDELT (`api.gdeltproject.org`), so a real scheduled run ends as `failed: Provider request failed at the network layer` and puts the connector into a 1 h exponential backoff. That is the scheduler working correctly; the success path is covered by the mocked-adapter tests in radar-core.

**How to apply:**
- `/api/v1/*` on the host needs Clerk or `X-API-Key`; for a curl smoke test insert a temporary `api_keys` row (legacy `sha256(key)` hash is accepted and upgraded) into `artifacts/api-server/data/hookpoint-radar.sqlite`, then delete it afterwards.
- Do not copy the SQLite file without its `-wal` sidecar; recent writes live in the WAL and a bare copy looks stale.
- An async tick that has nothing to await finishes synchronously; clear "in-flight" guards in a chained `.finally`, never inside the async body, or the guard is set after it was cleared and the loop wedges silently (bit us once).

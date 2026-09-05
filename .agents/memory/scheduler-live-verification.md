---
name: Scheduler live verification
description: How to judge whether the in-host radar scheduler is working when live providers cannot be reached from the workspace.
---

**Rule:** prove scheduled connector runs by watching run rows, `next_run_at`
and `backoff_until` change, never by expecting a successful provider fetch.

**Why:** the workspace sandbox is rate-limited by public providers (GDELT
answers 429), so a real scheduled run ends as a network-layer failure and puts
the connector into exponential backoff. That is the scheduler working; the
success path is covered by the mocked-adapter tests in radar-core.

**How to apply:**
- Use an API key (or a Clerk session) for any curl smoke test of `/api/v1/*`;
  the host never serves those routes anonymously. A temporary key must go into
  the store the host is actually using — Postgres schema `radar` when
  `DATABASE_URL` is set, not the SQLite fallback file — and be deleted after.
- An async tick that has nothing to await finishes synchronously; clear
  "in-flight" guards in a chained `.finally`, never inside the async body, or
  the guard is set after it was cleared and the loop wedges silently.

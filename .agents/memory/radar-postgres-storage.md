---
name: Radar Postgres storage
description: Why radar-core talks to Postgres synchronously through a worker thread, why its tables live in a dedicated schema, and what that means when touching src/db or migrations.
---

# Radar operational store: Postgres behind the sync `src/db` boundary

**Rule:** radar-core services stay synchronous. Postgres is reached through a
worker-thread bridge (`Atomics.wait` + `receiveMessageOnPort`), one `pg.Client`
per worker, `?` placeholders translated to `$n`. Do not introduce async
database calls into services; do not swap the bridge for a pool without
rewriting the services first.

**Why:** the published API is Replit autoscale (no durable disk), so the
embedded SQLite file lost everything on restart. Every service and ~80 tests
assume synchronous `db.get/all/run/transaction`, and rewriting them async was
judged far riskier than a sync bridge. Measured round trip through the bridge
is ~0.3 ms, the same as a raw pg query, so latency is not a reason to change it.

**How to apply:**
- Engine is chosen by target string: `postgres(ql)://` → Postgres, anything
  else → SQLite. `DATABASE_URL` wins over `DATABASE_PATH`.
- Tables live in the Postgres schema `radar` (`RADAR_DB_SCHEMA`), never
  `public`: `scripts/post-merge.sh` runs `drizzle-kit push`, which drops any
  table in `public` that the (empty) Drizzle schema does not declare.
- SQL must stay portable across both engines: no `strftime`/`datetime('now')`,
  `INSERT OR IGNORE`, `json_extract`, bare `ROUND(float, n)`, `MIN(a, b)` on
  text, or `LIKE` relying on SQLite's case-insensitivity. Use `db.sql.jsonText`,
  `db.sql.randomHex`, `lib.daysAgo`, `lib.earliestIso`, `LOWER(col) LIKE`, and
  `isUniqueViolation(error)` instead of matching SQLite error text.
- The `pg` package is a dependency of the host (`artifacts/api-server`), not of
  radar-core; the core resolves it with `import.meta.resolve('pg')`, so the
  production image needs `node_modules` (it already does for express/clerk).
- Test suite runs on in-memory SQLite by default and again on Postgres when
  `DATABASE_URL`/`RADAR_TEST_DATABASE_URL` is set, using a throwaway
  `radar_test_<hex>` schema per test. A test that dies before `close()` leaves
  that schema behind; drop it by hand.
- Postgres answers `COMMIT` on an aborted transaction with a silent `ROLLBACK`
  tag, so the boundary's `transaction()` throws when that happens. Never swallow
  a statement error inside a transaction callback; rethrow so the wrapper rolls
  back (SQLite would have let the swallowed error slide).
- In production the schema gate must run before authentication: `authenticate`
  reads `api_keys`, so a stale schema would otherwise surface as a 500 instead
  of the intended 503 `schema_out_of_date`.

---
name: Radar schema and the publish flow
description: Production never runs DDL; the publish flow copies the dev schema and the API verifies it against a checked-in manifest. Read before adding a migration or changing schema.js.
---

# Schema ownership for radar-core on Replit

**Rule:** the production API never executes DDL. Outside production the core
applies `schema.js` + pending migrations at startup; in production it only
verifies the live schema against the generated `src/db/schema-manifest.js`
and, on mismatch, raises critical `schema_out_of_date` (503 `/api/ready`,
bootstrap and scheduler skipped).

**Why:** Replit applies production database schema only through the Publish
flow (dev schema copied to prod); startup/deploy-time DDL in production is not
allowed. Verifying against a manifest instead of trusting
`schema_migrations` catches a publish that happened before the dev DB was
migrated.

**How to apply:**
- After changing `schema.js` or adding a migration: run `pnpm run db:manifest`
  in `artifacts/api-server/radar-core` (the `schema-manifest` test fails
  otherwise), then make sure the dev DB is migrated (`pnpm --filter
  @workspace/api-server run db:migrate`, also run by `scripts/post-merge.sh`)
  **before** publishing.
- Migrations are `{ version, before?, run, after? }`. Put DDL in `run`; put data
  fix-ups in `before`/`after` so `recordManagedMigrations` can run them in
  production, where `run` is skipped because publish already created the
  columns.
- Production readiness can only be confirmed after a publish; the workspace
  simulation is `NODE_ENV=production` + strong secrets against the dev
  `DATABASE_URL`.

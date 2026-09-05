# Production preparation

The application can be built and rehearsed without connecting a provider or importing customer data. Code verification and a configuration check do not establish that a deployment, Clerk instance or database is ready. The commands below keep those results separate.

## Run the code rehearsal

Use Node.js 24 or newer and install the workspace dependencies with `pnpm install --frozen-lockfile`. From the repository root:

```sh
node scripts/production-rehearsal.mjs
node scripts/production-rehearsal.mjs --json
```

The rehearsal builds the real Express application and production Vite UI into a temporary directory. It starts a loopback-only server on an available port, creates a disposable SQLite database, and tests these boundaries:

- An unmigrated production database reports failed readiness and refuses protected traffic.
- The existing migration command prepares the schema in a separate process; production startup verifies it without applying DDL.
- Temporary storage refuses production readiness unless the disposable-only exception is explicitly enabled.
- Anonymous requests and invalid API keys fail; a read-only key cannot mutate data.
- Synthetic observations are deduplicated, ownership and status persist, an outcome can be recorded, CSV export works, and company deletion clears the account.
- The built browser document, JavaScript asset and dashboard deep link are served.
- Production startup and workflow operations leave the schema unchanged.

Normal API-key authentication stays enabled. The script generates temporary API credentials and uses deliberately invalid Clerk placeholders; it never tests or contacts Clerk. It passes an allowlisted process environment and disables connectors and the scheduler. The browser build does not load environment files or enable local demo mode. Temporary processes and data are removed after success or failure. The existing `.local/demo` workspace and running preview are untouched.

The disposable database uses `ALLOW_EPHEMERAL_STORAGE=true` only for this rehearsal. Launch preflight rejects that setting. Serving the built UI proves the artifact and route fallback; it does **not** prove a real browser login. The rehearsal wraps the exported Express app to bind loopback, so it does not exercise the production `src/index.ts` scheduler lifecycle.

## Inspect the intended deployment configuration

Provision the fields in [.env.production.example](.env.production.example) through the deployment's secret manager. The template contains no working credentials. The preflight can run against the process environment, or Node can explicitly load a local ignored file:

```sh
node scripts/production-preflight.mjs --first-deploy
node --env-file=.env.production scripts/production-preflight.mjs --first-deploy --json
```

The command itself does not load `.env` files, connect to services, inspect an existing database or print environment values. It checks Node version, production/auth flags, Clerk key formats, bootstrap and hashing settings, explicit storage configuration, origins, scheduler bounds and connector lease timing. Provider credentials are optional at this stage.

| Option or result | Meaning |
|---|---|
| `--first-deploy` | Requires a bootstrap `ADMIN_API_KEY`; an existing deployment may instead have active keys in its database. |
| `--runtime-only` | Checks the server environment without requiring browser build variables. |
| `--json` | Emits a structured report with field names, fixed explanations and actions; no setting values. |
| Exit `0` / `configuration_checked` | Configuration has no detected blockers. External systems and runtime readiness remain unverified. |
| Exit `1` / `configuration_blocked` | Fix the listed settings before launch. |
| Exit `2` | The command received an unsupported option. |

Build-time and runtime variables can be supplied in separate environments. Clerk secret keys, API keys, database URLs and `HASH_SALT` belong only on the server. The browser build receives the publishable key and, if needed, the Clerk proxy URL. Use matching production Clerk instances. `HASH_SALT` rotation invalidates existing non-bootstrap key hashes, so include key reissuance in a rotation plan.

## Build, prepare the schema and start

The checked-in deployment is a Replit Express API plus a static Vite application. Its service definitions are [the API artifact](artifacts/api-server/.replit-artifact/artifact.toml) and [the browser artifact](artifacts/hookpoint-radar/.replit-artifact/artifact.toml). The API serves `/api`; the static host serves `artifacts/hookpoint-radar/dist/public` with an SPA fallback to `index.html`. Other hosting must preserve that route split and supply TLS. No Docker deployment has been validated in this workspace.

1. Build and run the code gates from the repository root. `pnpm run verify:release` reports any skipped authenticated browser or Postgres checks; a skip is not a pass. The two credentials-free readiness commands can also run directly:

   ```sh
   node --test scripts/production-preflight.test.mjs
   node scripts/production-rehearsal.mjs
   pnpm run build
   ```

   The API contract gate compares generated-file contents before and after regeneration, so it works in source ZIPs and uncommitted workspaces. It fails when regeneration changes a file, then leaves the updated output available to review. On systems without `flock` (including a default macOS installation), keep code generation and browser checks sequential; the release runner already does this and reports the lock fallback.

2. Apply migrations in the existing schema preparation stage. In the checked-in Replit flow, `scripts/post-merge.sh` calls the API's `db:migrate` command for the development database, then publishing transfers the schema. The running production API never applies DDL. When operating a separate database, use a dedicated migration job with the target database explicitly configured and `NODE_ENV=development`; run `node artifacts/api-server/radar-core/src/db/migrate.js`. The command intentionally refuses `NODE_ENV=production`. Give the application runtime its own production environment afterward. Never run a development schema job against an unspecified database.

3. Regenerate and commit the schema manifest after changing migrations (`pnpm --dir artifacts/api-server/radar-core run db:manifest`). The preflight and rehearsal read the checked-in expected version automatically. Verify the manifest and database belong to the same release.

4. Supply the production environment and start the built API:

   ```sh
   node --enable-source-maps artifacts/api-server/dist/index.mjs
   ```

   `NODE_ENV=production` and `PORT` must already be set. The production host binds the port on its default interfaces; its current entry point does not use `HOST`. Restrict ingress at the platform/network boundary. The local rehearsal binds loopback independently.

5. Check both liveness and readiness. `/api/healthz` is the current platform startup probe; it proves the Express host responds. `/api/ready` must return `200`, the current schema version and the intended storage mode before serving business traffic. `503 schema_out_of_date` means prepare/publish the schema before restarting. Do not treat liveness as a readiness gate.

Use managed Postgres for the existing autoscale deployment. A SQLite path is appropriate only on a verified, backed-up persistent host. The preflight rejects memory and system temporary directories, including macOS and Windows temporary paths. A path and a flag cannot establish durability; prove a restart and restore with the actual volume.

The scheduler starts in the API process and only ticks while that process is awake. Lease coordination prevents duplicate connector claims across instances, but scale-to-zero does not provide exact scheduling. If timely unattended collection matters, configure always-on capacity or a verified wake/worker schedule. Rate limiting is process-local; use shared enforcement for a multi-instance deployment that needs a global quota.

## Gates that require connected infrastructure

Before live data is enabled, finish the checks that a local code rehearsal cannot establish:

| Gate | Verification |
|---|---|
| Clerk | Real sign-in, reload, sign-out, session revocation and tenant isolation in the deployed browser; run the existing authenticated E2E suite with an intended test account. |
| Postgres | Run the core Postgres test pass against an explicitly disposable target and verify current schema readiness after deployment. |
| Recovery | Run `pnpm run db:restore-rehearsal` with PostgreSQL client tools and approved source/scratch targets; record a new restore result for the current schema. |
| Hosting | HTTPS, origin policy, trusted ingress, durable storage, scheduler wake behavior and monitoring of `/api/ready`. |
| Sources | Connect each provider, verify its empty/error/rate-limit cases and permitted use, then deliberately enable its schedule. |

The current local tooling check found a Docker CLI but no running Docker daemon and no PostgreSQL server/client tools on the process path. No ephemeral PostgreSQL test or database restore was run here. The inherited deployment document contains an earlier drill record; that record does not verify this workstation, the current schema or a new deployment.

See [deployment and security](artifacts/api-server/radar-core/docs/DEPLOYMENT_AND_SECURITY.md) for the existing auth, tenant, scheduler and recovery contracts, and [local development](LOCAL_DEVELOPMENT.md) for the persistent empty preview and explicitly optional synthetic demo data.

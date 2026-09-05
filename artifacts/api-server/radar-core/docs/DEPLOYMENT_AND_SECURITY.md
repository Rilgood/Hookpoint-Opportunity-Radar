# Deployment and Security

## Supported deployment today

The only runtime for `radar-core` is the Express host in `artifacts/api-server`. The host imports `createApp` from `radar-core/src/app.js`, mounts it for `/api/v1/*`, `/api/health` and `/api/ready`, bridges Clerk browser sessions into the core's tenant model, and is published as a Replit autoscale service (`artifacts/api-server/.replit-artifact/artifact.toml`):

```bash
# build (NODE_ENV=production)
pnpm --filter @workspace/api-server run build
# run
NODE_ENV=production PORT=8080 node --enable-source-maps artifacts/api-server/dist/index.mjs
# probes
curl --fail http://localhost:8080/api/healthz   # host liveness (autoscale startup probe)
curl --fail http://localhost:8080/api/health    # core liveness
curl --fail http://localhost:8080/api/ready     # core readiness: schema, auth config, storage safety
```

The autoscale startup probe only checks `/api/healthz`, so an instance can come up while `/api/ready` is still `503`. Check `/api/ready` yourself after every publish; the core also refuses every non-public `/api/v1` request with `503 runtime_not_ready` while a critical issue is open, so unsafe configuration cannot serve data silently.

Operational data lives in the Replit-managed Postgres database (`DATABASE_URL`, injected by the platform in production and present in the workspace), inside the dedicated schema `radar` (`RADAR_DB_SCHEMA`). Autoscale instances have no durable filesystem, so the embedded SQLite engine is only the fallback when `DATABASE_URL` is unset (tests, offline development); it must never hold production data. Because the bundled host resolves the core's root to `artifacts/api-server/`, that fallback lives at `artifacts/api-server/data/hookpoint-radar.sqlite`. The catalog/scoring files are always read from `artifacts/api-server/radar-core/config/` (the host sets `RADAR_CONFIG_DIR` before importing the core), so the bundled API and the test suite share one rule set. There is no Docker image, Compose file or serverless adapter in this repository.

Schema changes reach production through the publish flow, never through the running API: publishing copies the development database schema to production, the production core verifies the live schema against the checked-in manifest (`radar-core/src/db/schema-manifest.js`) and refuses readiness with `schema_out_of_date` if anything is missing. Keep the development database current with `pnpm --filter @workspace/api-server run db:migrate` (run automatically by `scripts/post-merge.sh`) and regenerate the manifest with `pnpm run db:manifest` inside `radar-core` after every schema or migration change.

## Configuration

All settings are environment variables read in `radar-core/src/config.js`. There is no `.env.example`; in the Replit workspace set them as workspace secrets or environment variables (the core will also read a `.env` file next to its resolved root if one exists, but the project does not ship or commit one).

| Variable | Default | Purpose |
|---|---|---|
| `NODE_ENV` | `development` | `production` enables the production gate below |
| `PORT` / `HOST` | required by the host (no default) / `0.0.0.0` | Listening address. The host, not the core, binds the port and exits immediately if `PORT` is unset; the workflows and the production run config set `8080` |
| `AUTH_REQUIRED` | `true` in production, else `false` | Core-level switch. Through the host it only affects API-key handling: the host already answers `401` on `/api/v1` without a Clerk session or `X-API-Key`, so unauthenticated access to `DEFAULT_TENANT_ID` exists only when running the standalone `src/server.js` entry point |
| `DEFAULT_TENANT_ID` | `tenant_hookpoint` | Tenant that owns the bootstrap `ADMIN_API_KEY` |
| `ADMIN_API_KEY` | unset | Bootstrap API key for direct integrations; 32+ characters. The key record is only created when `HASH_SALT` is also 32+ characters |
| `HASH_SALT` | unset | Pepper for API-key hashes; 32+ characters whenever API keys are used |
| `CONNECTOR_WEBHOOK_SECRET` | unset | HMAC secret for `/api/v1/webhooks/:source`; 32+ characters |
| `ALLOWED_ORIGINS` | `http://localhost:8787` (core) / none (host CORS) | Explicit console origins; the host's `cors` middleware reads the same variable |
| `DATABASE_URL` | injected by Replit | Postgres connection string; when set, the core stores everything there and ignores `DATABASE_PATH` |
| `RADAR_DB_SCHEMA` | `radar` | Postgres schema that holds the radar tables, kept apart from the Drizzle-managed `public` schema |
| `DB_STATEMENT_TIMEOUT_MS` | `30000` | Per-statement timeout applied to the Postgres session |
| `DATABASE_PATH` | `./data/hookpoint-radar.sqlite` relative to the core's resolved root | SQLite fallback when `DATABASE_URL` is unset: a file, or `:memory:` |
| `RADAR_CONFIG_DIR` | `config/` next to the core's `src/`; the host sets it to `radar-core/config` | Directory holding `scoring.json`, `signal-catalog.json` and `connector-catalog.json`. Startup fails if any of the three is missing |
| `ALLOW_EPHEMERAL_STORAGE` | `false` in production | SQLite only: permits `:memory:`/`/tmp` storage in production; never for live data |
| `DURABLE_STORAGE_CONFIRMED` | `false` in production | SQLite only: operator assertion that `DATABASE_PATH` is on backed-up durable storage. Not needed with Postgres |
| `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MS` | `true`, `60000` | The host starts the in-process scheduler on boot (skipped, with an error log, while readiness reports `schema_out_of_date`) and stops it on shutdown. Each tick runs due enabled pull connectors with their stored `schedule_input` and refreshes a `RESCORE_BATCH_SIZE` batch of due company scores. Minimum interval 5000 ms; `false` disables it (logged as a warning) and leaves only the manual `run`/`rescore` endpoints |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting; set `true` behind a trusted reverse proxy such as the Replit deployment proxy |
| `RATE_LIMIT_PER_MINUTE`, `MAX_BODY_BYTES`, `MAX_BATCH_RECORDS`, `MAX_EXPORT_ROWS`, `MAX_FUTURE_SKEW_MINUTES`, `CONNECTOR_TIMEOUT_MS`, `CONNECTOR_MAX_RECORDS`, `RESCORE_BATCH_SIZE` | see `config.js` | Request, batch, export and connector bounds |
| `CONNECTOR_LEASE_MS` | `300000` | How long a connector run lease stays valid without a renewal before another instance may treat the run as abandoned (see "Scheduler and autoscale"). Renewed every third of this interval while a run is in flight; must be at least `2 × CONNECTOR_TIMEOUT_MS` or readiness reports `invalid_numeric_configuration` |
| `LOG_LEVEL` | `info` | Core log verbosity |

Generate secret values in the platform secret manager; never commit them. Rotating `HASH_SALT` invalidates non-bootstrap API-key hashes, so reissue tenant keys as part of that rotation.

`ADMIN_API_KEY` is a bootstrap credential. Its deterministic database record is updated on restart when the environment value changes, preventing old bootstrap keys from accumulating. Create least-privilege operational keys through `/api/v1/api-keys`; the plaintext token is returned once.

Authenticated `GET` routes require `read`; ingestion and workflow mutations require `write`; provider execution, connector configuration, key management, rejection/run ledgers and destructive deletion require `admin`. An `admin` scope satisfies the narrower checks, while `read` and `write` do not imply one another. Clerk-authenticated console users receive all three scopes inside their own private workspace tenant.

## Production gate

With `NODE_ENV=production` the core evaluates `runtimeIssues()` on every non-public `/api/v1` request and on `/api/ready`. Critical issues return `503` and name their codes:

- `authentication_disabled` – `AUTH_REQUIRED` must be true.
- `weak_hash_salt`, `weak_admin_api_key`, `weak_webhook_secret` – each secret must be an independent value of at least 32 characters.
- `no_active_api_key` – an `ADMIN_API_KEY` or provisioned key must exist. This and `weak_hash_salt` block API-key clients only; Clerk-authenticated console requests are still served.
- `schema_out_of_date` – the Postgres schema lacks tables or columns the code expects. Production runs no DDL; migrate the development database and publish again.
- `ephemeral_storage` – SQLite fallback on `:memory:` or `/tmp` in production without `ALLOW_EPHEMERAL_STORAGE=true`.
- `durability_unconfirmed` – SQLite fallback on any other path in production without `DURABLE_STORAGE_CONFIRMED=true`.
- `invalid_numeric_configuration` – a bound is outside its supported range.

With `DATABASE_URL` set the storage checks pass automatically: managed Postgres survives restarts and is shared by every instance. `DURABLE_STORAGE_CONFIRMED=true` remains an operator assertion for self-hosted SQLite only; Replit autoscale instances do not keep filesystem writes across restarts or across instances, so it must never be set there.

For a production topology:

1. Keep operational data in the managed Postgres database (point-in-time recovery and backups are the platform's; rehearse a restore with `pnpm run db:restore-rehearsal` before adding customer data, see Backup and recovery).
2. Apply schema changes by migrating the development database and publishing; watch `/api/ready` for `schema_out_of_date` after each publish.
3. Let every instance run the in-process scheduler: due connectors are claimed through the shared database, so more than one host instance is safe (see "Scheduler and autoscale" below). Autoscale still only ticks while an instance is awake.
4. Add shared rate limiting for cross-instance enforcement.
5. Configure production secrets and explicit `ALLOWED_ORIGINS`.
6. Verify `/api/ready`, tenant isolation and a dated backup/restore drill before adding connector credentials.

### Scheduler and autoscale

The host runs the core's scheduler in-process (`artifacts/api-server/src/index.ts`), so connector cadences enabled through `PATCH /api/v1/connectors/:key` and time-decay rescoring happen without an operator. Every instance runs it, and the shared database decides who does the work:

- **It only ticks while an instance is running.** Autoscale scales to zero when idle, so an hourly cadence fires on the first tick after the next request wakes the service, not at the top of the hour. Any request (including an external uptime ping) is enough to wake it; the startup tick runs immediately.
- **Due connectors are claimed in the database, so several instances are safe.** Before a run starts (scheduled or manual `POST /api/v1/connectors/:key/run`, on any instance) the connector row is claimed with one conditional `UPDATE` that stamps `lease_owner` (instance), `lease_token` (run id) and `lease_expires_at`, and for scheduled runs also re-checks that the connector is still enabled, due and out of backoff. Exactly one caller wins; the others see the connector as no longer due (`connector_not_due`, logged at debug level as `scheduler: connector_claimed_elsewhere`) or as `409 connector_already_running`. The holder renews the lease every `CONNECTOR_LEASE_MS / 3` while the provider call is in flight, renews and re-checks it every 25 records while ingesting the results, and requires an unexpired lease when closing the run (a run that finds its lease gone, or already expired, does not record a result: it stays `abandoned`, answers `409 connector_lease_lost` and the host logs `scheduler: connector_lease_lost`; records already ingested are deduplicated by the next run) and clears it when the run finishes. There is no need to cap the deployment at one instance or to run a separate worker for the scheduler.
- **Abandoned runs are recovered after a bounded timeout.** A lease that reaches `CONNECTOR_LEASE_MS` (default 300000 ms, five minutes) without being renewed belonged to an instance that crashed, hung or was killed mid-run. On its next tick (and at boot) any instance marks that run `abandoned` in `connector_runs`, sets the connector to `error` with the same exponential backoff as an operational failure, clears the lease and logs `scheduler: connector_run_abandoned` (warn) with the run id and the owning instance. A lease that is still live is never touched by other instances. On `SIGTERM` the host waits for the in-flight run (up to `CONNECTOR_TIMEOUT_MS` plus a margin) before exiting; if the platform kills the process sooner, the run is recovered as abandoned by the next tick anywhere.

The scheduler does not start while `/api/ready` reports `schema_out_of_date`; migrate and republish, then restart. Scheduler outcomes are visible in `/api/v1/connectors/runs` and in the host logs as `scheduler: scheduled_connector_run`, `scheduler: connector_run_failed`, `scheduler: connector_run_abandoned` and `scheduler: scheduled_rescore_failed` events. A scheduled run whose stored `schedule_input` is rejected by the adapter (a 4xx-class failure) is deferred to the next cadence slot rather than retried every tick; provider/network failures use the connector's exponential backoff.

### Scheduler and autoscale

The host runs the core's scheduler in-process (`artifacts/api-server/src/index.ts`), so connector cadences enabled through `PATCH /api/v1/connectors/:key` and time-decay rescoring happen without an operator. Every instance runs it, and the shared database decides who does the work:

- **It only ticks while an instance is running.** Autoscale scales to zero when idle, so an hourly cadence fires on the first tick after the next request wakes the service, not at the top of the hour. Any request (including an external uptime ping) is enough to wake it; the startup tick runs immediately.
- **Due connectors are claimed in the database, so several instances are safe.** Before a run starts (scheduled or manual `POST /api/v1/connectors/:key/run`, on any instance) the connector row is claimed with one conditional `UPDATE` that stamps `lease_owner` (instance), `lease_token` (run id) and `lease_expires_at`, and for scheduled runs also re-checks that the connector is still enabled, due and out of backoff. Exactly one caller wins; the others see the connector as no longer due (`connector_not_due`, logged at debug level as `scheduler: connector_claimed_elsewhere`) or as `409 connector_already_running`. The holder renews the lease every `CONNECTOR_LEASE_MS / 3` while the provider call is in flight, renews and re-checks it every 25 records while ingesting the results, and requires an unexpired lease when closing the run (a run that finds its lease gone, or already expired, does not record a result: it stays `abandoned`, answers `409 connector_lease_lost` and the host logs `scheduler: connector_lease_lost`; records already ingested are deduplicated by the next run) and clears it when the run finishes. There is no need to cap the deployment at one instance or to run a separate worker for the scheduler.
- **Abandoned runs are recovered after a bounded timeout.** A lease that reaches `CONNECTOR_LEASE_MS` (default 300000 ms, five minutes) without being renewed belonged to an instance that crashed, hung or was killed mid-run. On its next tick (and at boot) any instance marks that run `abandoned` in `connector_runs`, sets the connector to `error` with the same exponential backoff as an operational failure, clears the lease and logs `scheduler: connector_run_abandoned` (warn) with the run id and the owning instance. A lease that is still live is never touched by other instances. On `SIGTERM` the host waits for the in-flight run (up to `CONNECTOR_TIMEOUT_MS` plus a margin) before exiting; if the platform kills the process sooner, the run is recovered as abandoned by the next tick anywhere.

The scheduler does not start while `/api/ready` reports `schema_out_of_date`; migrate and republish, then restart. Scheduler outcomes are visible in `/api/v1/connectors/runs` and in the host logs as `scheduler: scheduled_connector_run`, `scheduler: connector_run_failed`, `scheduler: connector_run_abandoned` and `scheduler: scheduled_rescore_failed` events. A scheduled run whose stored `schedule_input` is rejected by the adapter (a 4xx-class failure) is deferred to the next cadence slot rather than retried every tick; provider/network failures use the connector's exponential backoff.

## Implemented controls

- HMAC-SHA256 API-key storage with a deployment pepper
- Backward migration of legacy SHA-256 hashes on successful authentication
- Constant-time credential/signature comparison
- Tenant filters at business-query boundaries
- Read, write and administrator scopes
- One-time API-key token delivery and revocation
- Webhook HMAC over `timestamp.source.raw_body`, a five-minute acceptance window and persisted single-use receipts
- Path-authoritative webhook source identity
- JSON media-type enforcement and body/batch/attribute limits
- Strict domain, URL, timestamp, type and numeric validation
- IP/proxy rate limits with response headers
- CSP, frame, MIME, referrer and permissions headers
- Parameterized SQL and constrained dynamic sort fields
- Safe static-file path resolution (unused when mounted; the host never serves static assets from the core)
- Recursive secret rejection/redaction in connector configuration and logs
- Provider timeout, response-size, record-count, run-lock and failure-backoff controls
- Per-record rejection isolation without raw payload retention
- Administrator-triggered company deletion that cascades evidence and removes associated contacts
- Mutation audit ledger and scoring history
- Risk-based outreach suppression
- Graceful shutdown and WAL tuning

## Infrastructure controls still required

- TLS, WAF and DDoS protection
- Enterprise SSO in front of Clerk for the operator console
- Short-lived tenant sessions instead of distributing admin keys
- Shared distributed rate limiting for multi-instance deployments
- Encrypted disks; a restore drill less than 30 days old (procedure and log: Backup and recovery)
- Centralized logs, traces, uptime and connector alerts
- Approved provider egress allowlist
- Container/source/dependency scanning
- Raw-object encryption, retention and deletion workflows
- Vendor permitted-use and downstream activation reviews
- Incident response, access reviews and secret rotation

## Webhook verification

Required headers:

- `X-API-Key`
- `X-Hookpoint-Timestamp` as Unix seconds, Unix milliseconds or ISO time
- `X-Hookpoint-Signature: sha256=<hex HMAC>`

The signed bytes are exactly `<timestamp>.<source>.<raw request body>`, where `source` is the URL path value. Proxies must not transform the body before it reaches the application. Accepted signature hashes are retained for ten minutes to reject in-window replay attempts.

## Backup and recovery

Production data is in the Replit-managed Postgres database, inside the `radar` schema, so one schema-level dump captures tenant, observation, evidence, scoring, outcome and audit tables together. Two recovery paths exist; both have been rehearsed with the procedure below and must be rehearsed again at least monthly and before every migration to a new database.

### Recovery objectives

| Objective | Target | How it is met |
|---|---|---|
| RPO (data loss) | ≤ 5 minutes | Production point-in-time restore (PITR): pick any timestamp inside the retention window (7 days by default; up to 28 days on Pro/Enterprise, configured in the production database settings). Scheduled daily backups (enable under **Settings → Advanced → Scheduled backups**) give a fallback restore point every 24 h; a logical dump taken with the script below is only as fresh as its last run. |
| RTO (time to serve again) | ≤ 60 minutes | Platform restore is minutes; the rest is the verification below and, when the restore point predates a schema-changing publish, a republish. The drill measured dump → restore → verified API at 3 s for a 22-table, 62-row store; re-measure and update the log as data grows. |

Do not enable first-party or paid provider connectors, or import customer data, until these objectives are accepted by the business owner and the drill log below has an entry newer than 30 days.

## Horizontal-scale gate

Operational data is already in managed Postgres. Move to durable workers and shared coordination before any of the following:

- more than one application replica needs writes;
- connector work must survive process restarts;
- sustained ingestion approaches 50 records/second;
- the database reaches tens of gigabytes;
- distributed rate limiting or strict enterprise failover is required.

## Go-live checklist

- `pnpm run verify:radar-core` (core syntax check and test suite) and `pnpm run typecheck` pass on the release commit
- `/api/ready` is `200` and reports no critical issue after the publish
- `/api/ready` reports `storage_mode: postgres` and `pnpm run db:restore-rehearsal` has passed within the last 30 days (entry in the drill log under Backup and recovery), with RPO/RTO accepted by the business owner
- Authentication and least-privilege key lifecycle work
- CORS contains only production origins
- Webhook stale timestamp and bad signature both fail
- Every enabled source has permitted-use documentation
- Connector empty, partial, timeout, rate-limit and cursor paths are tested
- Rejection and identity-review alerts are configured
- Suppressed/closed accounts cannot enter automated outreach
- CRM activation begins with human approval
- Scoring configuration has a named business owner and versioning process

The operator console (`artifacts/hookpoint-radar`) never handles API keys: it authenticates with a Clerk session cookie, and the host exchanges that session for a trusted principal inside the core. API keys exist only for direct integrations such as connector webhooks and CRM sync jobs. An enterprise deployment should put Clerk behind the customer's SSO provider and keep the private-workspace tenant model, or exchange the session for short-lived, tenant-scoped backend credentials.

Set `TRUST_PROXY=true` only when the service is behind a trusted proxy that overwrites `X-Forwarded-For`. The Replit deployment proxy does; without the flag every request shares the socket address for rate limiting.


### Drill log

| Date | Source | Target | Result | Duration | Notes |
|---|---|---|---|---|---|
| 2026-09-04 | workspace `DATABASE_URL` (PostgreSQL 16.10, schema version 9, 22 tables, 62 rows, 1 tenant, 3 companies) | ephemeral local PostgreSQL 16.10; repeated into a scratch database on the same managed server | passed | 3 s | `/api/ready` 200, `storage_mode: postgres`, no issues; API listed 3/3 companies. Negative check: dropping one index from the restored copy made production mode answer `503 schema_out_of_date`, as intended. |

For a self-hosted SQLite fallback, back up the volume with SQLite's online backup API or a coordinated snapshot; copying only the main file while WAL writes are active can be inconsistent. The drill script does not cover SQLite.

### Path B – logical dump and restore (scratch verification, second database, or off-platform copy)

`scripts/radar-restore-rehearsal.sh` (root: `pnpm run db:restore-rehearsal`) is the repeatable procedure. It never writes to the source and it fails loudly at the first step that does not hold:

1. `pg_dump --schema=radar --format=custom --no-owner --no-privileges` of `SOURCE_DATABASE_URL` (default `DATABASE_URL`).
2. `pg_restore --single-transaction --exit-on-error` into a scratch database: by default an ephemeral local Postgres it starts under `$TMPDIR` on a Unix socket (no port to collide with the workflows), or `SCRATCH_DATABASE_URL` when you provide one. The scratch database must be a different database from the source and must not already contain a `radar` schema, so the restore is always proven from nothing.
3. Per-table row counts and the `schema_migrations` version must match the source (set `ALLOW_ROW_COUNT_DRIFT=true` only for a live source that is taking writes while the dump runs; the drift is then reported instead of failing).
4. It builds the host and starts `dist/index.mjs` with `NODE_ENV=production` against the restored copy, with throwaway `ADMIN_API_KEY`/`HASH_SALT` written to the scratch copy only. The child process gets an allowlisted environment (`env -i`: database URL, the throwaway secrets, `SCHEDULER_ENABLED=false`, and the Clerk keys the host's session middleware insists on) rather than the caller's, so a production-derived copy with real connector rows can never reach a live provider with inherited credentials, and nothing mutates the copy while it is being checked. Production mode matters: the core does not repair the schema, it verifies it against `src/db/schema-manifest.js` exactly as the published service would, so a dump missing a table or index fails here with `schema_out_of_date` instead of being silently recreated.
5. `/api/ready` must be `200` with `storage_mode: postgres` and the source's schema version, and `GET /api/v1/companies` for `DEFAULT_TENANT_ID` (bootstrap key) must report the same total as the restored `companies` table; other restored tenants are listed with their counts.
6. The restored copy never outlives the run by default: the API is stopped, the local scratch Postgres is deleted or the restored `radar` schema is dropped from `SCRATCH_DATABASE_URL` (on success and on failure alike), and the dump is removed unless `DUMP_FILE` named it. `KEEP_SCRATCH=true` is the explicit opt-in to keep the restored copy (for inspection, or when the target is being seeded on purpose). A JSON report is written (`REPORT_FILE`, default inside the work directory; the path is printed); on failure the work directory with the API log is left in place. `scripts/radar-restore-rehearsal.test.sh` (`pnpm run db:restore-rehearsal:test`) proves these cleanup and retention semantics against a throwaway database on the workspace server.

Use it in three situations:

- **Monthly drill against the development database** (default invocation): proves the dump/restore path and that the checked-in manifest matches what a restore yields.
- **Drill against production data**: run it from the workspace with `SOURCE_DATABASE_URL` set to the production connection string from the **Database** tool (production database → **Settings**). `pg_dump` must be at least the server's major version (the workspace ships PostgreSQL 16 client tools); the production connection string usually requires `sslmode=require`. Treat the dump as production data: leave `DUMP_FILE` unset so it is deleted, or store it encrypted.
- **Moving or seeding a second database** (new region, provider migration, a customer's own Postgres): pass `SCRATCH_DATABASE_URL` pointing at the empty target **and `KEEP_SCRATCH=true`**, otherwise the verified copy is dropped again at the end; the same checks apply. Path B is also the fallback if the platform restore is unavailable, at an RPO equal to the age of the dump.

### Path A – production point-in-time restore (managed database)

1. Freeze writes: disable the connectors and stop operator activity (the API keeps answering, but every write after the chosen restore point is lost).
2. In the **Database** tool select the production database and open its rollback/restore view. Choose the point in time just before the incident (or **Scheduled backups → View all backups → Restore** for a daily restore point). The platform switches the database to the restored data without deleting the current data; connected services briefly reconnect.
3. Restart the API (redeploy, or publish again). Each autoscale instance holds one long-lived connection to the database, so do not rely on the reconnect.
4. Check `/api/ready`:
   - `200` with `storage_mode: postgres` and no critical issue → continue.
   - `503 schema_out_of_date` → the restore point predates a publish that changed the schema. Production never runs DDL, so publish again so the development schema is copied across (or roll the code back to the checkpoint that matched the restore point and publish that). The manifest check is exactly what the drill script exercises in production mode.
5. Sign in to the operator console and confirm the tenants and companies you expect; re-enable connectors last.

Restoring the database does not restore the code and rolling the code back does not restore the database. When both must move, restore the database first, then roll back to the matching checkpoint and publish again.

# Hook Point Opportunity Radar

An evidence-backed, connector-ready warm-lead intelligence system for Hook Point × Hyper Ads.

It converts real company changes into prioritized accounts: what changed, why the change suggests a Hook Point need, how trustworthy the inference is, which evidence supports it, who may own the problem, and what a human should do next.

The repository starts with an empty database. It contains no runtime placeholder companies, generated observations, or automatic seed path.

`radar-core` is the dependency-free JavaScript kernel of the product. It is not deployed on its own: the `@workspace/api-server` artifact imports it and serves it under `/api`, and the operator console is the React app in `artifacts/hookpoint-radar`. See [How this package is deployed](#how-this-package-is-deployed).

## Implemented product surface

- Tenant-scoped company, alias and decision-maker records
- Conservative resolution by CRM ID, domain, LinkedIn URL, aliases, name and location
- Identity confidence, resolution lineage and a human-review queue
- Identity safety gate that caps ambiguous accounts at review until an authoritative identifier is added
- Strict canonical observation validation with event-time quality and normalizer version
- Idempotency by provider external ID, with content-hash fallback
- Per-record rejection isolation and non-sensitive rejection telemetry
- 31 cross-industry opportunity and outreach-suppression rules
- Versioned scoring configuration in `config/scoring.json`
- Fit, need, intent, timing and risk scores with decay and bounded corroboration
- Time-windowed evidence confidence so old sources do not inflate current certainty
- Score snapshots, tier-change history and evidence-linked recommendations
- Risk-safe recommendations that replace sales outreach with a human-review hold
- Closed-loop outcomes for acceptance, replies, meetings, opportunities and revenue
- Twelve runnable adapter paths: signed webhook, GDELT, NewsAPI and nine Apify source types
- Stateful Meta ad snapshots with active-volume deltas, creative age and duplication metrics
- Registry contracts for 32 initial data sources
- Connector timeouts, bounded responses, run locking, partial-run handling and exponential failure backoff
- Automatic connector cursor resume, usage fields, run history and audit events
- Persistent webhook replay receipts and database-enforced provider-ID idempotency
- Scheduled due-score refresh so evidence decay changes rankings without new ingestion
- Scoped API-key creation, one-time token delivery, use tracking and revocation
- Authenticated CSV export up to a configurable limit
- Operator console (`artifacts/hookpoint-radar`) with server-side search, pagination, empty-state onboarding and data-quality monitoring
- One synchronous database boundary over managed Postgres (production and the workspace) or embedded SQLite (tests, offline development), with monotonic migrations, a checked-in schema manifest and release verification

## How this package is deployed

There is exactly one runtime for this code: the Express host in `artifacts/api-server`.

- `artifacts/api-server/src/app.ts` imports `createApp` from `radar-core/src/app.js` with `serveStaticAssets: false` and forwards `/api/v1/*`, `/api/health` and `/api/ready` to it. Everything else on the host (Clerk proxy, `/api/healthz`) is ordinary Express.
- Browser users sign in with Clerk. The host verifies the session and hands the Clerk user ID to the core through `setTrustedPrincipal`, which maps each user to a private workspace tenant with `read`, `write` and `admin` scopes. Requests that carry an `X-API-Key` header bypass Clerk entirely and are authenticated by the core's own API-key store.
- The operator console is the React/Vite app in `artifacts/hookpoint-radar`. `radar-core` ships no HTML, CSS or static assets, and the host never serves any from it.
- `artifacts/api-server` is bundled with esbuild into `artifacts/api-server/dist/index.mjs`. The core resolves its root directory relative to the running file, so the **bundled** runtime's root is `artifacts/api-server/` and, when no `DATABASE_URL` is set, its SQLite fallback lives at `artifacts/api-server/data/hookpoint-radar.sqlite`. The scoring, signal and connector catalogs are deliberately **not** root-relative: `config/` under this package is the only copy, and the host's first import (`artifacts/api-server/src/radarConfigDir.ts`) sets `RADAR_CONFIG_DIR` to `radar-core/config` before any core module loads, so the live API, `node --test` and a direct `node src/server.js` all read the same files. A `RADAR_CONFIG_DIR` that is missing any of the three catalog files makes the core throw at import rather than start with a different rule set. Edit a catalog or bump the scoring version in one place only.
- The host starts the core's in-process scheduler (`startScheduler` in `src/services/connector-runner.js`) from `artifacts/api-server/src/index.ts` once the schema check passes, and stops it on `SIGTERM`/`SIGINT` before closing the database. Every `SCHEDULER_INTERVAL_MS` (default 60 s, minimum 5 s) it runs each enabled pull connector whose `next_run_at` is due, using its stored non-secret `schedule_input`, and refreshes a batch of due company scores so time decay changes rankings without new evidence. Set `SCHEDULER_ENABLED=false` to turn this off (the host logs a warning); `POST /api/v1/connectors/:key/run` and `POST /api/v1/rescore` remain available for on-demand runs. The scheduler ticks only while a host process is alive; several instances may run it against the shared database because each due connector is claimed with a database lease before it runs (see `docs/DEPLOYMENT_AND_SECURITY.md`, "Scheduler and autoscale").
- Scheduling state is legible from the API rather than inferred by the console. Every run records who started it in `connector_runs.metadata_json.trigger` (`scheduled` or `manual`; older rows have no flag and are reported as `trigger: null`, never guessed), `GET /api/v1/connectors/runs?connector_key=` lists a connector's recent runs, and `GET /api/v1/connectors` returns each connector's `last_run` plus a server-derived `schedule` object (`src/services/connector-schedule.js`) whose `state` is one of `push`, `adapter_pending`, `needs_configuration`, `disabled`, `running`, `backoff`, `input_rejected`, `manual`, `due` or `waiting`, with a human-readable `reason`. A scheduled run whose stored `schedule_input` is rejected by the connector's contract sets the connector `status` to `schedule_rejected` (cleared by the next run that actually starts, or by saving new settings); new connector status values must also be added to the preserved-status list in `syncConnectorCatalog` or bootstrap resets them on the next list call.

The deployment target is the Replit autoscale publish described in `artifacts/api-server/.replit-artifact/artifact.toml`: build with `pnpm --filter @workspace/api-server run build`, run `node --enable-source-maps artifacts/api-server/dist/index.mjs` with `NODE_ENV=production`, and use `/api/healthz` as the startup probe. Replit injects the production `DATABASE_URL` of the managed Postgres database, which is where every table lives (see [Storage](#storage)).

## Storage

`radar-core/src/db/` is a synchronous boundary (`run`, `get`, `all`, `exec`, `transaction`) with two engines behind it:

- **Postgres** whenever `DATABASE_URL` is set. This is the workspace default and the only supported production store: autoscale instances have no durable disk, so the embedded file would be emptied on every restart or new instance. All tables live in the dedicated Postgres schema named by `RADAR_DB_SCHEMA` (default `radar`), separate from the `public` schema that `pnpm --filter db push` manages and would otherwise wipe. Postgres access goes through a worker thread so the core keeps its synchronous call style; the `pg` driver is a dependency of the host package, not of this directory.
- **SQLite** (`DATABASE_PATH`, or `:memory:`) when no `DATABASE_URL` is set. The test suite runs on in-memory SQLite by default and again on Postgres when `DATABASE_URL` is available.

Schema ownership follows the Replit publish flow:

- Outside production the core applies `schema.js` plus every pending migration on startup, and `pnpm run db:migrate` (or `pnpm --filter @workspace/api-server run db:migrate` from the repository root, which `scripts/post-merge.sh` runs after every merge) does the same without starting a server.
- In production the core **never runs DDL**. Publishing copies the development database schema to production; on startup the core verifies the live schema against the checked-in manifest `src/db/schema-manifest.js` and only records already-applied migrations. A missing table, column or named index raises the critical `schema_out_of_date` issue: `/api/ready` returns `503`, bootstrap and the scheduler stay off, and the message names what is missing. The fix is to migrate the development database and publish again.
- After changing `schema.js` or adding a migration, run `pnpm run db:manifest`; the `schema-manifest` test fails until the manifest is regenerated. Migrations may carry `before`/`after` data steps around their DDL so the same steps run as data-only work in production.

## Run locally

Requirements: Node.js 24 and pnpm. The core itself has no package dependencies; the host and console are pnpm workspace members, so run `pnpm install` once at the repository root.

**In the Replit workspace** start the `API Server` and `web` workflows. They inject the values both dev servers refuse to start without (`PORT=8080` for the host; `PORT=22502` and `BASE_PATH=/` for the console, from each artifact's `.replit-artifact/artifact.toml`), and the preview proxy serves the console at `/` and the host at `/api` on one origin, which is what the console expects. Open the preview root, sign in with Clerk, and you are on the default private workspace.

**Without the workflows** (a plain shell, CI, another machine) set those values yourself, in two terminals:

```bash
# terminal 1 – API host
PORT=8080 NODE_ENV=development pnpm --filter @workspace/api-server run dev
curl http://localhost:8080/api/health
curl http://localhost:8080/api/ready

# terminal 2 – operator console
PORT=22502 BASE_PATH=/ pnpm --filter @workspace/hookpoint-radar run dev
```

The console calls `/api/...` on its own origin, so on its own `http://localhost:22502` cannot reach the host. Put a reverse proxy in front that sends `/api/*` to `:8080` and everything else to `:22502`; `pnpm run verify:browser-smoke` (`scripts/src/browser-smoke.ts`) starts exactly that arrangement on free ports and is the reference for a self-contained local stack. The Clerk keys (`CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`, `VITE_CLERK_PUBLISHABLE_KEY`) must also be present in the environment for the host and console to boot.

**Calling the API from curl or a script.** The host requires a Clerk session for `/api/v1/*` unless the request carries `X-API-Key`; without either it answers `401` before the core is reached, whatever `AUTH_REQUIRED` says. To use API keys locally, start the host with both `ADMIN_API_KEY` and `HASH_SALT` set to independent values of at least 32 characters (the bootstrap key is only created when both are that long), then send `-H "x-api-key: $ADMIN_API_KEY"` as in the examples below. `/api/health` and `/api/ready` are public. The signed webhook stays unavailable until `CONNECTOR_WEBHOOK_SECRET` is configured.

Configuration is read from environment variables (full list in [docs/DEPLOYMENT_AND_SECURITY.md](docs/DEPLOYMENT_AND_SECURITY.md)). There is no `.env.example`; in the Replit workspace set values as workspace secrets or environment variables.

Verify a clean checkout from the repository root:

```bash
pnpm run verify:radar-core
```

That script runs this package's `check` (syntax-checks every file under `src/` and `test/`) and `test` (the `node --test` suite against in-memory SQLite, and a second pass against the workspace Postgres in disposable per-test schemas when `DATABASE_URL` is set: it confirms the starting dataset is empty, ingests canonical fixtures, and exercises entity resolution, scoring, crisis suppression, webhook replay defense, connector hardening and CSV export). Nothing is written to the working `radar` schema. The same command is registered as the `radar-core` validation workflow. You can also run `pnpm run check`, `pnpm run test` and `pnpm run test:postgres` from inside `artifacts/api-server/radar-core`; set `RADAR_TEST_DATABASE_URL` to point the Postgres pass at a different database.

Run the disposable HTTP business simulation on its own:

```bash
pnpm --dir artifacts/api-server/radar-core run test:simulation
```

It exercises nine connected stages and 63 HTTP requests across two isolated tenants: company evidence, syndication and replay handling, qualification, identity confirmation/conflicts, crisis suppression, pipeline and revenue, filtered CSV exports, historical-score provenance, and time-based expiration. The clock advances through a 61-day monitoring window. Storage is explicitly in-memory SQLite regardless of `DATABASE_URL`; the temporary localhost server closes after the test. All company identities and evidence are synthetic `.example` fixtures, no provider or messaging API is called, and the local demo workspace is never read or changed. This verifies application semantics; live provider extraction quality, actual prospect fit and predictive conversion accuracy require separately reviewed real evidence and outcomes.

A second, independent 15-request HTTP journey verifies all four workspace-readiness milestones. An account alone does not count as collected evidence; a needs-review flag is not a completed review; an unassigned, undated task is not an owned plan; and another tenant's activity cannot complete your milestones. Both journeys run with `test:simulation`. Saved-task and review contracts are documented in [WORKFLOW_CONTRACT.md](docs/WORKFLOW_CONTRACT.md).

To start over locally on Postgres, stop the API host and `DROP SCHEMA radar CASCADE` (or set `RADAR_DB_SCHEMA` to a fresh name); on SQLite delete `artifacts/api-server/data/hookpoint-radar.sqlite` along with its `-wal` and `-shm` companions. The schema is recreated on the next non-production start. The SQLite file is git-ignored.

## Production gate

The core refuses production traffic until its configuration is safe. When `NODE_ENV=production`, every non-public `/api/v1` request returns `503 runtime_not_ready` while any critical issue is open, and `/api/ready` lists the issue codes. The checks that matter for this deployment:

- `AUTH_REQUIRED` defaults to `true` in production and must stay there.
- `HASH_SALT`, `ADMIN_API_KEY` and `CONNECTOR_WEBHOOK_SECRET`, when set, must each be independent random values of at least 32 characters. `weak_hash_salt` and `no_active_api_key` block API-key clients but not Clerk-authenticated console users.
- `schema_out_of_date`: the Postgres schema is missing tables or columns the running code expects. Production never runs DDL; migrate the development database (`pnpm --filter @workspace/api-server run db:migrate`) and publish again so the schema is copied across.
- `ephemeral_storage` / `durability_unconfirmed`: these only apply when the core falls back to SQLite because `DATABASE_URL` is unset. Managed Postgres is durable, so `DURABLE_STORAGE_CONFIRMED` is unnecessary there. Replit autoscale instances do not keep filesystem writes across restarts or instances, so never assert durability for a SQLite file on autoscale.

`/api/health` is process liveness only. `/api/ready` also checks schema, authentication configuration and storage safety, and reports `storage_mode` (`postgres`, `persistent_sqlite` or `ephemeral_sqlite`).

## Canonical observation

```json
{
  "source": "meta_ad_library",
  "external_id": "ad-snapshot-4821",
  "type": "ad_snapshot",
  "title": "Active ad volume increased 78% in seven days",
  "url": "https://provider.example/evidence/4821",
  "observed_at": "2026-09-03T04:00:00Z",
  "retrieved_at": "2026-09-03T04:10:00Z",
  "event_time_quality": "reported",
  "normalizer_version": "meta-ads-v1",
  "confidence": 0.92,
  "company": {
    "name": "Example Company",
    "domain": "example.com",
    "industry": "Retail",
    "employee_count": 85,
    "city": "Brooklyn",
    "state": "NY"
  },
  "attributes": {
    "active_ads": 32,
    "active_ads_delta_pct": 78,
    "duplicate_creative_ratio": 0.71
  }
}
```

Ingest one to 5,000 records:

```bash
curl -X POST http://localhost:8080/api/v1/ingest \
  -H 'content-type: application/json' \
  -H "x-api-key: $ADMIN_API_KEY" \
  --data '{"records":[...records...]}'
```

Rejected records do not roll back valid records in the same batch. The response is `207` when any record is rejected, and the rejection ledger retains only source, index, error and payload hash—not the raw payload.

## Signed webhook

The generic webhook requires both an API key and a five-minute replay-protected signature:

```bash
timestamp="$(date +%s)"
body='{"records":[...]}'
source='my_source'
signature="$(printf '%s' "$timestamp.$source.$body" | openssl dgst -sha256 -hmac "$CONNECTOR_WEBHOOK_SECRET" -hex | awk '{print $2}')"

curl -X POST http://localhost:8080/api/v1/webhooks/my_source \
  -H 'content-type: application/json' \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "x-hookpoint-timestamp: $timestamp" \
  -H "x-hookpoint-signature: sha256=$signature" \
  --data "$body"
```

The signature binds the timestamp, URL source and exact request bytes. Its receipt is persisted for ten minutes, so the same valid request cannot be processed twice. The source in the URL is authoritative; a payload cannot relabel itself as another source.

## Scoring

The default model is explainable and versioned:

```text
opportunity = 24% fit + 32% need + 24% intent + 20% timing
              + bounded breadth bonuses - 65% risk
```

Signal contribution is `weight × confidence × strength × recency × bounded corroboration`. Evidence counts and confidence use only the active signal window. Thresholds are hot ≥65, warm ≥48, watch ≥32, and suppressed when risk reaches 45. Tune all model-level values in `config/scoring.json`; tune individual signals in `config/signal-catalog.json`.

Treat the score as a ranking hypothesis, not proof that a company requested services. Calibrate it against reviewed leads, meetings, opportunities and revenue.

An account below 0.8 identity confidence cannot become `warm` or `hot`, even when its raw score crosses those thresholds. It receives an identity-verification hold until an operator adds an authoritative domain, CRM ID or LinkedIn company URL and the account is rescored.

## Main API

All paths below are served by the host under its `/api` prefix; the core's bare `/health` and `/ready` aliases are not forwarded.

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/api/health`, `/api/ready` | Liveness and fail-closed readiness |
| `GET` | `/api/v1/dashboard` | Portfolio summary |
| `GET/POST` | `/api/v1/companies` | Ranked accounts and manual creation |
| `GET/PATCH/DELETE` | `/api/v1/companies/:id` | Evidence packet, workflow updates and admin privacy deletion |
| `POST` | `/api/v1/companies/:id/outcomes` | Record labels and sales outcomes |
| `POST` | `/api/v1/ingest` | Canonical batch ingestion |
| `GET` | `/api/v1/ingestion/rejections` | Admin-only rejected-record ledger |
| `POST` | `/api/v1/webhooks/:source` | Signed generic ingestion |
| `GET` | `/api/v1/signals` | Current signal feed |
| `GET` | `/api/v1/connectors` | Connector coverage and state |
| `GET` | `/api/v1/connectors/runs` | Admin-only run history, cursor and usage metadata |
| `PATCH` | `/api/v1/connectors/:key` | Enable and schedule a configured adapter |
| `POST` | `/api/v1/connectors/:key/run` | Admin-only execution of a pull adapter |
| `GET` | `/api/v1/data-quality` | Freshness, confidence and rejection health |
| `GET` | `/api/v1/review-queue` | Ambiguous identities and suppressed accounts |
| `GET/POST` | `/api/v1/api-keys` | List or create scoped keys |
| `DELETE` | `/api/v1/api-keys/:id` | Revoke a scoped key |
| `GET` | `/api/v1/analytics/outcomes` | Calibration metrics |
| `GET` | `/api/v1/export/companies.csv` | Authenticated ranked export |

See [docs/openapi.yaml](docs/openapi.yaml) for the full contract.

## Supported scope

The signal taxonomy is cross-industry. The deployment is intended for a controlled pilot of roughly 25,000–50,000 monitored companies, subject to observation volume and retention. Use cheap broad sources for the universe, then promote qualified accounts into costlier ads, social, review and first-party monitoring.

Operational data already lives in managed Postgres. Before horizontal scaling, move schedules to durable workers, rate limiting to a shared store, raw payloads to governed object storage, and API-key distribution to short-lived tenant credentials.

## Repository map

```text
artifacts/api-server/radar-core/
  config/               Connector, signal and scoring configuration (the only copy; the host reads it too)
  docs/                 Architecture, contracts, security and OpenAPI
  src/app.js            createApp(db, { serveStaticAssets }) – the HTTP handler the host mounts
  src/server.js         Bare node:http entry point (not used by the host)
  src/connectors/       Provider collectors and normalizers
  src/db/               Database boundary (index.js), Postgres worker bridge, SQLite driver, schema, migrations and manifest
  src/http/             Routing, I/O and security controls
  src/services/         Resolution, ingestion, scoring, outcomes and queries
  test/                 Domain, normalizer and hardening tests
artifacts/api-server/
  src/app.ts            Express host: Clerk session bridge and radar mount
  src/radarConfigDir.ts Points the bundled core at radar-core/config (RADAR_CONFIG_DIR)
  data/                 SQLite fallback database when DATABASE_URL is unset (git-ignored)
artifacts/hookpoint-radar/ Operator console (React + Vite + Clerk)
```

## Safety and data-use boundaries

- Keep source, external ID, event time, retrieval time, evidence reference, normalizer version and confidence with every inference.
- Do not use protected or sensitive personal traits for scoring or ad targeting.
- Require human review for ambiguous identity, low-confidence evidence and all suppressed accounts.
- Respect provider terms, robots directives, privacy law, deletion requests and retention limits.
- Never place credentials in connector schedule input; use managed environment secrets.

Further reading: [Architecture](docs/ARCHITECTURE.md), [Connector handoff](docs/CONNECTOR_HANDOFF.md), [Signal contract](docs/SIGNAL_AND_DATA_CONTRACT.md), and [Deployment/security](docs/DEPLOYMENT_AND_SECURITY.md).

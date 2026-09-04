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

The core's storage is one embedded SQLite/WAL database. Because the bundled host resolves the core's root to `artifacts/api-server/`, the default `DATABASE_PATH` is `artifacts/api-server/data/hookpoint-radar.sqlite` and the catalog/scoring files are read from `artifacts/api-server/config/`. There is no Docker image, Compose file or serverless adapter in this repository.

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
| `DATABASE_PATH` | `./data/hookpoint-radar.sqlite` relative to the core's resolved root | SQLite file, or `:memory:` |
| `ALLOW_EPHEMERAL_STORAGE` | `false` in production | Permits `:memory:`/`/tmp` storage in production; never for live data |
| `DURABLE_STORAGE_CONFIRMED` | `false` in production | Operator assertion that `DATABASE_PATH` is on backed-up durable storage |
| `SCHEDULER_ENABLED`, `SCHEDULER_INTERVAL_MS` | `true`, `60000` | Only honoured by the standalone `src/server.js` entry point; the host does not start the scheduler |
| `TRUST_PROXY` | `false` | Use `X-Forwarded-For` for rate limiting; set `true` behind a trusted reverse proxy such as the Replit deployment proxy |
| `RATE_LIMIT_PER_MINUTE`, `MAX_BODY_BYTES`, `MAX_BATCH_RECORDS`, `MAX_EXPORT_ROWS`, `MAX_FUTURE_SKEW_MINUTES`, `CONNECTOR_TIMEOUT_MS`, `CONNECTOR_MAX_RECORDS`, `RESCORE_BATCH_SIZE` | see `config.js` | Request, batch, export and connector bounds |
| `LOG_LEVEL` | `info` | Core log verbosity |

Generate secret values in the platform secret manager; never commit them. Rotating `HASH_SALT` invalidates non-bootstrap API-key hashes, so reissue tenant keys as part of that rotation.

`ADMIN_API_KEY` is a bootstrap credential. Its deterministic database record is updated on restart when the environment value changes, preventing old bootstrap keys from accumulating. Create least-privilege operational keys through `/api/v1/api-keys`; the plaintext token is returned once.

Authenticated `GET` routes require `read`; ingestion and workflow mutations require `write`; provider execution, connector configuration, key management, rejection/run ledgers and destructive deletion require `admin`. An `admin` scope satisfies the narrower checks, while `read` and `write` do not imply one another. Clerk-authenticated console users receive all three scopes inside their own private workspace tenant.

## Production gate

With `NODE_ENV=production` the core evaluates `runtimeIssues()` on every non-public `/api/v1` request and on `/api/ready`. Critical issues return `503` and name their codes:

- `authentication_disabled` – `AUTH_REQUIRED` must be true.
- `weak_hash_salt`, `weak_admin_api_key`, `weak_webhook_secret` – each secret must be an independent value of at least 32 characters.
- `no_active_api_key` – an `ADMIN_API_KEY` or provisioned key must exist. This and `weak_hash_salt` block API-key clients only; Clerk-authenticated console requests are still served.
- `ephemeral_storage` – `:memory:` or `/tmp` storage in production without `ALLOW_EPHEMERAL_STORAGE=true`.
- `durability_unconfirmed` – any other path in production without `DURABLE_STORAGE_CONFIRMED=true`.
- `invalid_numeric_configuration` – a bound is outside its supported range.

`DURABLE_STORAGE_CONFIRMED=true` is an operator assertion, not automatic detection. Replit autoscale instances do not keep filesystem writes across restarts or across instances, so the embedded SQLite file is not durable in the current publish target and the assertion must not be set there. Until operational data moves behind the database boundary onto managed Postgres (see the horizontal-scale gate), the production deployment is intentionally blocked from live connectors and customer data.

For a production topology:

1. Provision managed Postgres with point-in-time recovery.
2. Implement the existing database boundary (`radar-core/src/db/`) against it and run monotonic migrations.
3. Move connector schedules and due-score refresh to a durable worker; the host does not run the in-process scheduler.
4. Add shared rate limiting for cross-instance enforcement.
5. Configure production secrets and explicit `ALLOWED_ORIGINS`.
6. Verify `/api/ready`, tenant isolation and backup/restore before adding connector credentials.

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
- Encrypted disks, database point-in-time recovery and restore drills
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

For SQLite, back up the mounted volume using SQLite's online backup API or a coordinated filesystem snapshot. Copying only the main file while WAL writes are active can be inconsistent. Encrypt backups, test a restore at least monthly, and include tenant, observation, evidence, scoring, outcome and audit tables.

Define recovery point and recovery time objectives before enabling first-party or paid provider connectors.

## Horizontal-scale gate

Move to managed Postgres and durable workers before any of the following:

- more than one application replica needs writes;
- connector work must survive process restarts;
- sustained ingestion approaches 50 records/second;
- the database reaches tens of gigabytes;
- distributed rate limiting or strict enterprise failover is required.

## Go-live checklist

- `pnpm run verify:radar-core` (core syntax check and test suite) and `pnpm run typecheck` pass on the release commit
- `/api/ready` is `200` and reports no critical issue after the publish
- Database storage is durable and backups restore successfully
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

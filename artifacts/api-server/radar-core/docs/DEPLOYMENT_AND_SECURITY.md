# Deployment and Security

## Supported deployment today

The complete supported runtime is one Node.js process with SQLite/WAL on a durable mounted volume:

```bash
cp .env.example .env
# Set production values described below.
docker compose up --build -d
curl --fail http://localhost:8787/ready
```

The image health check calls `/ready`, not only `/health`. Missing authentication configuration or unsafe production storage keeps the container unhealthy.

## Required production settings

```dotenv
NODE_ENV=production
AUTH_REQUIRED=true
ADMIN_API_KEY=<independent-random-value-at-least-32-characters>
HASH_SALT=<independent-random-value-at-least-32-characters>
CONNECTOR_WEBHOOK_SECRET=<independent-random-value-at-least-32-characters>
ALLOWED_ORIGINS=https://operator-console.example
DATABASE_PATH=/app/data/hookpoint-radar.sqlite
ALLOW_EPHEMERAL_STORAGE=false
DURABLE_STORAGE_CONFIRMED=true
SCHEDULER_ENABLED=true
```

`DURABLE_STORAGE_CONFIRMED=true` is an operator assertion, not automatic detection. Set it only after verifying the SQLite path is mounted on durable storage and a restore has succeeded. The included Compose file declares a named volume but deliberately defaults this assertion to false; a standalone container must also opt in explicitly after mounting one.

Generate values in the platform secret manager. Never commit `.env`. Rotating `HASH_SALT` invalidates non-bootstrap API-key hashes, so reissue tenant keys as part of that rotation.

`ADMIN_API_KEY` is a bootstrap credential. Its deterministic database record is updated on restart when the environment value changes, preventing old bootstrap keys from accumulating. Create least-privilege operational keys through `/api/v1/api-keys`; the plaintext token is returned once.

Authenticated `GET` routes require `read`; ingestion and workflow mutations require `write`; provider execution, connector configuration, key management, rejection/run ledgers and destructive deletion require `admin`. An `admin` scope satisfies the narrower checks, while `read` and `write` do not imply one another.

## Vercel production gate

The included Vercel adapter uses function-local `/tmp` only to make the package buildable. It does not create records automatically, enables authentication by default and disables the process scheduler. In production, `/ready` returns `503` with `ephemeral_storage` until a durable database implementation is attached.

Vercel function filesystems are neither durable nor shared across instances. Never set `ALLOW_EPHEMERAL_STORAGE=true` for live data.

For a production Vercel topology:

1. Provision Neon Postgres through the Vercel Marketplace.
2. Implement the existing database boundary with the serverless Postgres driver and run monotonic migrations.
3. Move schedules to Vercel Cron/Queues or a durable external worker.
4. Add Upstash/gateway rate limiting for cross-instance enforcement.
5. Configure production secrets and explicit origins.
6. Verify `/ready`, tenant isolation and backup/restore before adding connector credentials.

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
- Safe static-file path resolution
- Recursive secret rejection/redaction in connector configuration and logs
- Provider timeout, response-size, record-count, run-lock and failure-backoff controls
- Per-record rejection isolation without raw payload retention
- Administrator-triggered company deletion that cascades evidence and removes associated contacts
- Mutation audit ledger and scoring history
- Risk-based outreach suppression
- Graceful shutdown and WAL tuning

## Infrastructure controls still required

- TLS, WAF and DDoS protection
- SSO/identity-aware proxy for the operator console
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

- `npm run check`, `npm test` and `npm run verify` pass in the release image
- `/ready` is `200` and reports no critical issue
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

The standalone console keeps an entered API key only in browser session storage. An enterprise deployment should put the UI behind SSO and exchange the session for short-lived, tenant-scoped backend credentials.

Set `TRUST_PROXY=true` only when the service is behind a trusted proxy that overwrites `X-Forwarded-For`. Vercel sets this default automatically; direct-container deployments use the socket address unless explicitly configured.

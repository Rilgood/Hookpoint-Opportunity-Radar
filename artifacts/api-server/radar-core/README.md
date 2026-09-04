# Hook Point Opportunity Radar

An evidence-backed, connector-ready warm-lead intelligence system for Hook Point × Hyper Ads.

It converts real company changes into prioritized accounts: what changed, why the change suggests a Hook Point need, how trustworthy the inference is, which evidence supports it, who may own the problem, and what a human should do next.

The repository starts with an empty database. It contains no runtime placeholder companies, generated observations, or automatic seed path.

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
- Operator dashboard with server-side search, pagination, empty-state onboarding and data-quality monitoring
- In-place SQLite schema migrations, WAL tuning, Docker packaging and release verification

## Run locally

Requirements: Node.js 24 or Docker. The local runtime has no package dependencies.

```bash
cp .env.example .env
node src/server.js
```

Open `http://localhost:8787`. With `AUTH_REQUIRED=false`, the local console uses the default tenant. The signed webhook remains unavailable until `CONNECTOR_WEBHOOK_SECRET` is configured.

Verify a clean checkout:

```bash
npm run check
npm test
```

`npm run check` syntax-checks every file under `src/` and `test/`. `npm test` runs the automated suite against in-memory and temporary SQLite databases: it confirms the starting dataset is empty, ingests canonical fixtures, and exercises entity resolution, scoring, crisis suppression, webhook replay defense, connector hardening and CSV export. Nothing is written to the working database.

To start over locally, stop the server and delete the SQLite file at `DATABASE_PATH` (default `./data/hookpoint-radar.sqlite`) along with its `-wal` and `-shm` companions; the schema is recreated on the next start.

## Secure single-instance deployment

Generate three independent random values of at least 32 characters and configure:

```dotenv
NODE_ENV=production
AUTH_REQUIRED=true
ADMIN_API_KEY=<random-bootstrap-key>
HASH_SALT=<random-hash-pepper>
CONNECTOR_WEBHOOK_SECRET=<random-webhook-secret>
ALLOWED_ORIGINS=https://your-console.example
DATABASE_PATH=/app/data/hookpoint-radar.sqlite
DURABLE_STORAGE_CONFIRMED=true
```

Then start with a durable volume:

```bash
docker compose up --build -d
curl --fail http://localhost:8787/ready
```

`/health` is process liveness. `/ready` also checks schema, authentication configuration and storage safety. The container health check uses `/ready` so unsafe configuration does not look production-ready.

## Vercel boundary

`api/index.js` and `vercel.json` package the UI and HTTP handler for Vercel, but Vercel function-local `/tmp` is not durable or shared. The source therefore:

- never auto-populates records;
- enables authentication by default;
- disables the in-process scheduler; and
- returns `503 not_ready` while production storage is ephemeral.

Do not attach live connectors or customer data to that configuration. For a Vercel production release, implement the database boundary against marketplace-managed Neon Postgres (preferred) or another durable transactional store, run migrations, and use Vercel Cron/Queues or an external worker for connector schedules. The existing embedded SQLite build is production-capable only as a single application instance with a backed-up persistent volume.

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
curl -X POST http://localhost:8787/api/v1/ingest \
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

curl -X POST http://localhost:8787/api/v1/webhooks/my_source \
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

| Method | Endpoint | Purpose |
|---|---|---|
| `GET` | `/health`, `/ready` | Liveness and fail-closed readiness |
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

The signal taxonomy is cross-industry. The embedded deployment is intended for a controlled, single-instance pilot of roughly 25,000–50,000 monitored companies, subject to observation volume and retention. Use cheap broad sources for the universe, then promote qualified accounts into costlier ads, social, review and first-party monitoring.

Before horizontal scaling, move operational data to Postgres, schedules to durable workers, rate limiting to a shared store, raw payloads to governed object storage, and authentication to SSO or short-lived tenant credentials.

## Repository map

```text
config/                 Connector, signal and scoring configuration
docs/                   Architecture, contracts, security and OpenAPI
public/                 Operator console
src/connectors/         Provider collectors and normalizers
src/db/                 SQLite schema, migrations and database boundary
src/http/               Routing, I/O and security controls
src/services/           Resolution, ingestion, scoring, outcomes and queries
test/                   Domain, normalizer and hardening tests
```

## Safety and data-use boundaries

- Keep source, external ID, event time, retrieval time, evidence reference, normalizer version and confidence with every inference.
- Do not use protected or sensitive personal traits for scoring or ad targeting.
- Require human review for ambiguous identity, low-confidence evidence and all suppressed accounts.
- Respect provider terms, robots directives, privacy law, deletion requests and retention limits.
- Never place credentials in connector schedule input; use managed environment secrets.

Further reading: [Architecture](docs/ARCHITECTURE.md), [Connector handoff](docs/CONNECTOR_HANDOFF.md), [Signal contract](docs/SIGNAL_AND_DATA_CONTRACT.md), and [Deployment/security](docs/DEPLOYMENT_AND_SECURITY.md).

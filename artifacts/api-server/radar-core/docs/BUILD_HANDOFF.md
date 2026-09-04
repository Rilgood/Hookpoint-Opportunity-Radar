# Engineering Handoff

## Release state

Version 1.1 is a clean, provider-ready application kernel. Runtime placeholder data and the internal generator have been removed. Startup creates only the default tenant, connector registry and an explicitly configured bootstrap administrator key.

Release verification is `pnpm run verify:radar-core` from the repository root (also registered as the `radar-core` validation workflow): a syntax check over `src/` and `test/` plus the `node --test` suite, currently 73 tests covering empty startup, authenticated ingestion, signed-webhook replay defense, entity resolution and identity merge, scoring/suppression, connector normalizers and hardening, quality telemetry, CSV export, insights and outcome calibration. The signed-in browser journey against the console lives in `artifacts/hookpoint-radar/e2e/`.

The core runs only inside the `@workspace/api-server` Express host (`artifacts/api-server/src/app.ts`), which mounts it under `/api`, bridges Clerk sessions into private workspace tenants and is published as a Replit autoscale service. The host does not start the core's in-process scheduler. The embedded SQLite database is functional for local development and the pilot, but autoscale storage is not durable, so the production gate (`durability_unconfirmed`) blocks live connectors and customer data until the database boundary is implemented on managed Postgres. See `DEPLOYMENT_AND_SECURITY.md`.

## First implementation sequence

1. Run `pnpm run verify:radar-core` and `pnpm run typecheck`.
2. Generate independent 32+ character admin, hash and webhook secrets as workspace secrets.
3. Provision durable storage (managed Postgres behind `src/db/`) and a tested backup/restore path.
4. Keep the console on Clerk sign-in; issue least-privilege API keys only to direct integrations.
5. Connect HubSpot/Salesforce first so model outcomes can be measured.
6. Configure Apify and pin the exact actor IDs/versions approved for use.
7. Run every new normalizer against a small, labeled set of known companies.
8. Inspect `/api/v1/data-quality`, `/api/v1/review-queue` and connector runs.
9. Enable schedules in bounded cohorts.
10. Calibrate `config/scoring.json` after 50–100 human-reviewed accounts, then retain the new version in score snapshots.

## Source acceptance gates

- ≥95% correct company resolution on a labeled evaluation set
- ≥90% actual event times rather than retrieval times
- <2% unintended duplicates after a replay
- ≥95% evidence URL or governed `raw_ref` coverage for commercial signals
- No credentials or sensitive raw payloads in logs, run metadata or rejection rows
- Pagination, provider cursor, empty-result, timeout and rate-limit cases verified
- Record-level failures produce `partial`, not silent success or whole-run loss
- Cost per accepted opportunity and cost per useful observation measured
- Permitted use, retention, deletion and downstream activation rights documented

## Accuracy workflow

For every connector cohort:

1. Compare canonical fields with the provider interface.
2. Review all identities below 0.8 confidence.
3. Review all suppressed accounts before any contact.
4. Label false-positive and false-negative signals.
5. Record accepted/rejected/contacted/reply/meeting/opportunity/won outcomes.
6. Compare positive rates by score band and leading signal.
7. Change thresholds only through a new scoring config version.

Optimize for accepted opportunities and revenue, with a hard constraint on suppression failures—not raw lead count.

## Operational gates

- `/api/ready` returns `ready` with no critical issues
- Production storage is durable and shared by every API/worker instance
- Authentication, least-privilege scopes and key revocation are verified
- CORS contains only explicit console origins
- Webhook timestamp/signature rejection is verified
- Connector timeout/backoff alerts exist
- Rejection rate and identity-review count have alert thresholds
- Backups are encrypted and restores are tested
- A delete/export/retention procedure covers company and person data
- CRM writes begin in dry-run or approval-required mode
- One named business owner approves signal and scoring changes

## Deliberate design choices

- Deterministic rules remain score truth; AI may summarize but cannot silently alter scores.
- Exact identifiers precede name matching, and uncertain identities enter review.
- Observations are immutable; provider updates should arrive as versioned snapshots.
- Pull execution is synchronous in the included pilot and bounded by connector timeout.
- Runtime schedule input is non-secret and credentials remain in managed environment storage.
- Successful connector cursors resume automatically; operators can reset a cursor only on a one-time run.
- Due scores refresh in scheduler batches so time decay and expiry do not depend on new evidence; because the host does not start the scheduler, `POST /api/v1/rescore` and `POST /api/v1/connectors/:key/run` are the current triggers.
- Accounts below 0.8 identity confidence cannot enter warm/hot activation until an operator resolves them.
- The core has no UI of its own and no framework dependencies. The operator console (`artifacts/hookpoint-radar`) talks to it only through the versioned HTTP API, so the core can be embedded into the Hyper Ads product without the console.

# Engineering Handoff

## Release state

Version 1.1 is a clean, provider-ready application kernel. Runtime placeholder data and the internal generator have been removed. Startup creates only the default tenant, connector registry and an explicitly configured bootstrap administrator key.

Release verification currently covers 35 automated tests plus a live HTTP golden path from empty startup through authenticated ingestion, signed-webhook replay defense, entity resolution, scoring/suppression, scoped-key lifecycle, quality telemetry, CSV export and unsafe-production-storage rejection.

The full local/Docker path is functional with persistent SQLite. The Vercel adapter is intentionally fail-closed on `/tmp`; a durable Neon/Postgres implementation remains the production gate for a Vercel-hosted API.

## First implementation sequence

1. Run `npm run check` and `npm test`.
2. Generate independent 32+ character admin, hash and webhook secrets.
3. Provision durable storage and a tested backup/restore path.
4. Put the console behind SSO or distribute least-privilege API keys.
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

- `/ready` returns `ready` with no critical issues
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
- Due scores refresh in scheduler batches so time decay and expiry do not depend on new evidence.
- Accounts below 0.8 identity confidence cannot enter warm/hot activation until an operator resolves them.
- The UI is framework-free so it can remain standalone or be embedded into the Hyper Ads product.

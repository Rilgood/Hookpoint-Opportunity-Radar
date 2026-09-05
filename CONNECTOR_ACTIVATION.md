# Connector activation handoff

The remaining hookup is to provision an authenticated deployment, configure one implemented source, and prove a small import against real evidence. No live provider collection, real Clerk browser session, production PostgreSQL pass or current-schema restore has been verified in this local work. Complete the connected-infrastructure gates in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md) before enabling business traffic.

The local workspace intentionally blocks live collection. Use **Source setup** to inspect requirements; perform activation in the configured deployment. A source marked configured has the required settings available. That does not establish that credentials work, a provider returned useful records, or account attribution is correct.

## Available hookup paths

The [connector registry](artifacts/api-server/radar-core/config/connector-catalog.json) contains **33 entries: 16 implemented paths and 17 planned integrations**. The executable inventory is [implementedConnectorKeys](artifacts/api-server/radar-core/src/connectors/index.js). Keep provider secrets in the server's managed environment.

| Implemented key | Server requirements | First focused input |
| --- | --- | --- |
| `generic_webhook` | `CONNECTOR_WEBHOOK_SECRET` with at least 32 characters; tenant-scoped API key with write scope; API-key hashing/auth configuration | Canonical records sent to the signed endpoint below |
| `gdelt` | No provider key | Target `company.name` or `company.domain`; optional `query`; small `limit` |
| `newsapi` | `NEWS_API_KEY` | Target company; optional query and date bound |
| `sec_edgar` | No provider key | Registrant `cik`; bounded dates and optional `forms` |
| `nppes` | No provider key | `organization_name` or `npi`; optional US `state` |
| `usa_spending` | No provider key | `company.name`; optional dates and `award_type_codes` |
| `google_sheets` | Replit-managed Google connection plus `GOOGLE_SHEETS_TENANT_BINDINGS` | Authorized `spreadsheet_id` or `spreadsheet_url`, bounded `range` |
| `apify_google_maps` | `APIFY_TOKEN`, `APIFY_GOOGLE_MAPS_ACTOR` | Selected actor's `actor_input` |
| `apify_website` | `APIFY_TOKEN`, `APIFY_WEBSITE_ACTOR` | Selected actor's input and target identity |
| `apify_google_search` | `APIFY_TOKEN`, `APIFY_GOOGLE_SEARCH_ACTOR` | Target company plus actor input |
| `apify_facebook_ads` | `APIFY_TOKEN`, `APIFY_FACEBOOK_ADS_ACTOR` | Target account and actor input |
| `apify_instagram` | `APIFY_TOKEN`, `APIFY_INSTAGRAM_ACTOR` | Target profile and actor input |
| `apify_tiktok` | `APIFY_TOKEN`, `APIFY_TIKTOK_ACTOR` | Target profile and actor input |
| `apify_linkedin_company` | `APIFY_TOKEN`, `APIFY_LINKEDIN_COMPANY_ACTOR` | Target company and actor input |
| `apify_linkedin_jobs` | `APIFY_TOKEN`, `APIFY_LINKEDIN_JOBS_ACTOR` | Target company/jobs and actor input |
| `apify_google_reviews` | `APIFY_TOKEN`, `APIFY_GOOGLE_REVIEWS_ACTOR` | Target business and actor input |

Apify actor references accept `owner/actor` or `owner~actor`. Confirm that the selected actor's returned fields match the existing normalizer before scheduling it. An Apify run may incur provider charges; the adapter deliberately does not automatically retry its collection POST. SEC currently sends the fixed contact-bearing User-Agent in [public-data.js](artifacts/api-server/radar-core/src/connectors/public-data.js); confirm that contact is accurate for the operator before activation.

The **17 planned integrations** are listed below. Their environment names are catalog metadata; adding those values does not implement a collector. Equivalent records can enter through the signed webhook or authorized Sheets path.

| Planned key | Catalog environment name |
| --- | --- |
| `open_corporates` | `OPEN_CORPORATES_API_KEY` |
| `crunchbase` | `CRUNCHBASE_API_KEY` |
| `apollo` | `APOLLO_API_KEY` |
| `people_data_labs` | `PEOPLE_DATA_LABS_API_KEY` |
| `builtwith` | `BUILTWITH_API_KEY` |
| `semrush` | `SEMRUSH_API_KEY` |
| `similarweb` | `SIMILARWEB_API_KEY` |
| `google_trends` | None declared |
| `youtube` | `YOUTUBE_API_KEY` |
| `hubspot` | `HUBSPOT_ACCESS_TOKEN` |
| `salesforce` | `SALESFORCE_CLIENT_ID` |
| `meta_ads` | `META_ACCESS_TOKEN` |
| `google_ads` | `GOOGLE_ADS_DEVELOPER_TOKEN` |
| `tiktok_ads` | `TIKTOK_ADS_ACCESS_TOKEN` |
| `linkedin_ads` | `LINKEDIN_ADS_ACCESS_TOKEN` |
| `ticketmaster` | `TICKETMASTER_API_KEY` |
| `sam_gov` | `SAM_GOV_API_KEY` |

## Google Sheets binding

Provision the Google connection used by `@replit/connectors-sdk`, whose proxy service key is `google-sheet`, and authorize access to the selected spreadsheet. This adapter depends on that Replit-managed connection; an environment binding alone does not prove the proxy connection works.

Set `GOOGLE_SHEETS_TENANT_BINDINGS` to a JSON object mapping each authorized workspace's binding key to an explicit array of spreadsheet IDs. The binding key is the first 24 lowercase hexadecimal characters of SHA-256 of the **trusted tenant ID**, computed by `googleSheetsTenantBindingKey()` in [google-sheets.js](artifacts/api-server/radar-core/src/connectors/google-sheets.js). Use the server's tenant identity, not a display name or a supplied tenant header. Other workspaces remain unconfigured even when a global binding variable exists.

Run a bounded range such as `Research!A1:L26`. Rows need `type`, `title`, and a company name or domain; include the actual event date, source URL and stable `external_id` wherever available. Review the accepted/rejected row counts. Without an event date, the adapter labels the timestamp as retrieval time; that is weaker evidence of when the event happened. Reusing an external ID for changed evidence is a replay, so changing snapshots need a new stable version ID. See the [data contract](artifacts/api-server/radar-core/docs/SIGNAL_AND_DATA_CONTRACT.md).

## Signed push delivery

Send to **`POST /api/v1/webhooks/{source}`**, for example `/api/v1/webhooks/crm_events`. The URL source must be a lowercase identifier of up to 100 characters using letters, numbers, underscores or hyphens. It becomes the authoritative source on every record.

Provide `X-API-Key`, `X-Hookpoint-Timestamp` and `X-Hookpoint-Signature`. Compute HMAC-SHA256 using `CONNECTOR_WEBHOOK_SECRET` over:

```text
timestamp + "." + source + "." + exact_request_body_bytes
```

The signature is hexadecimal, optionally prefixed `sha256=`. The timestamp must be within five minutes; Unix seconds, Unix milliseconds and ISO timestamps are accepted. Changing the path source or body requires a new signature. Reusing a consumed signature returns `409 webhook_replayed`; resend an intended logical replay with a fresh signed request and the same stable record IDs to test ingestion deduplication. See [webhooks.js](artifacts/api-server/radar-core/src/services/webhooks.js) and the [connector handoff](artifacts/api-server/radar-core/docs/CONNECTOR_HANDOFF.md).

The Generic Signed Webhook's disabled pull/schedule controls are expected: push delivery has no pull run or recurring schedule to activate. The receiving route depends on authentication and a valid signature, not the connector's enabled toggle. It requires the key for the intended workspace; a default-tenant bootstrap key cannot route records into an unrelated Clerk workspace. Follow the [tenant and key contract](artifacts/api-server/radar-core/docs/DEPLOYMENT_AND_SECURITY.md).

## One-source acceptance

1. Finish the real Clerk, storage, migration, recovery and hosting checks in [PRODUCTION_READINESS.md](PRODUCTION_READINESS.md). Confirm `/api/ready` reports the release's schema version and intended storage mode. Keep schedules disabled initially.
2. Configure one implemented source and run a small, targeted import. Pull execution is `POST /api/v1/connectors/{key}/run` and requires admin scope. Push delivery uses the signed path above. Use a known account and a narrow query/range so a person can check every result.
3. Inspect the run's seen, inserted and rejected counts, errors and actual records. A successful empty run establishes a completed request, not useful evidence; a partial run needs rejection review. Webhook requests report ingestion results directly rather than creating a pull-run entry. Replay stable record IDs and confirm there is no account or evidence inflation.
4. Open the account and check domain/authoritative identity, source URL, event date and relevance. Confirm ambiguous identity only from a defensible identifier. Verify or reject each relevant observation; marking needs-review leaves review work unfinished. Rejection removes that observation from scoring; verification neither raises confidence nor refreshes its event time.
5. Save a next action with a real owner and due date. Confirm it survives reload and appears in the correct local-day queue. Complete, reschedule or dismiss it as the work changes.
6. Record an actual reply, meeting, opportunity or won/lost result when it occurs. Check the account stage and analytics. An imported source, completed task or handful of outcomes does not establish predictive score accuracy.
7. Once the records and failure handling are accepted, deliberately enable a pull cadence with validated `schedule_input`. Keep secrets out of saved input. Confirm the next scheduled run, cursor behavior and error/backoff visibility; verify the deployment stays awake or has an appropriate worker/wake arrangement. Push integrations continue to deliver signed events without a pull schedule.

Record the source, operator, deployment, date, run/request IDs, counts, reviewed example URLs and unresolved exceptions as the acceptance evidence. Current workflow details are in [WORKFLOW_CONTRACT.md](artifacts/api-server/radar-core/docs/WORKFLOW_CONTRACT.md).

The canonical typed application API is [lib/api-spec/openapi.yaml](lib/api-spec/openapi.yaml): its `/api` server prefix combines with `/v1/...` paths. The older [core OpenAPI file](artifacts/api-server/radar-core/docs/openapi.yaml) is a partial historical reference and does not define the new workflow/readiness contract.

# Connector Handoff

## Definition of done

A production connector must:

1. Read credentials from managed environment secrets.
2. Fetch only eligible/due accounts and enforce a bounded record count.
3. Handle pagination, stable cursors, provider limits, timeouts and retry policy.
4. Normalize every provider record to the canonical observation contract.
5. Supply a stable `external_id`, actual event time, retrieval time and evidence reference.
6. Assign a defensible confidence and normalizer version.
7. Replay without unintended duplicate observations.
8. Isolate malformed records and produce a `partial` run when appropriate.
9. Persist run duration, counts, cursor and safe usage/cost metadata.
10. Include fixture tests and documented permitted use, retention and deletion rules.

## Fastest integration: signed webhook

```bash
body='{"records":[{"external_id":"123","type":"product_launch","title":"Example launches a new service","observed_at":"2026-09-03T04:00:00Z","retrieved_at":"2026-09-03T04:05:00Z","normalizer_version":"source-v1","confidence":0.9,"company":{"name":"Example","domain":"example.com"},"attributes":{"is_new":true}}]}'
timestamp="$(date +%s)"
source='my_source'
signature="$(printf '%s' "$timestamp.$source.$body" | openssl dgst -sha256 -hmac "$CONNECTOR_WEBHOOK_SECRET" -hex | awk '{print $2}')"

curl -X POST http://localhost:8787/api/v1/webhooks/my_source \
  -H 'content-type: application/json' \
  -H "x-api-key: $ADMIN_API_KEY" \
  -H "x-hookpoint-timestamp: $timestamp" \
  -H "x-hookpoint-signature: sha256=$signature" \
  --data "$body"
```

The timestamp must be within five minutes. The URL path supplies the authoritative source name and is part of the signed bytes. A persisted receipt makes each valid signature single-use.

## Native adapter pattern

```js
import { BaseConnector } from './base.js';
import { requestJson } from './http-client.js';

export class ExampleConnector extends BaseConnector {
  validateConfiguration() {
    this.key = this.requireEnv('EXAMPLE_API_KEY');
  }

  async collect(input) {
    return requestJson('https://provider.example/records', {
      headers: { authorization: `Bearer ${this.key}` },
      retries: 2
    });
  }

  normalize(item, input) {
    return {
      source: 'example',
      external_id: item.id,
      type: 'product_launch',
      title: item.headline,
      url: item.url,
      observed_at: item.published_at,
      retrieved_at: new Date().toISOString(),
      event_time_quality: 'reported',
      normalizer_version: 'example-v1',
      confidence: 0.85,
      company: { name: item.company.name, domain: item.company.domain },
      attributes: { is_new: true }
    };
  }
}
```

Register the manifest in `config/connector-catalog.json`, route it from `src/connectors/index.js`, add its key to `implementedConnectorKeys`, and add a normalizer fixture test. `BaseConnector` supplies item bounds and per-item normalization isolation. `requestJson` supplies response bounds, timeouts and safe GET retry behavior.

Do not automatically retry paid/non-idempotent POST collection calls. Apify actor runs intentionally use zero transport retries; rely on a stable provider run ID and explicit recovery if async actor orchestration is added.

## Implemented paths

| Source | Mode | Observation focus | Required environment |
|---|---|---|---|
| Generic signed webhook | Push | Any canonical type | Admin/scoped API key + webhook secret |
| GDELT | Pull | Target-company news | None; target company required in run input |
| NewsAPI | Pull | Target-company news | `NEWS_API_KEY`; target company required |
| Apify Google Maps | Pull | Reviews/local profile | Token + actor ID |
| Apify websites | Pull | Website changes | Token + actor ID |
| Apify Google Search | Pull | Targeted search evidence | Token + actor ID + target company input |
| Apify Facebook Ads | Pull | Ad snapshots | Token + actor ID |
| Apify Instagram/TikTok | Pull | Social metrics | Token + actor ID |
| Apify LinkedIn companies/jobs | Pull | Company/jobs | Token + actor ID |
| Apify Google Reviews | Pull | Review metrics | Token + actor ID |

Apify actor references may be entered as `owner/actor` or `owner~actor`; the adapter normalizes them to the API path form. Tokens are sent in the Authorization header, not URL query strings.

The Facebook Ads adapter aggregates each returned account collection into one daily account snapshot, deduplicates ad IDs, and derives active-ad count, seven-day creative starts, median creative age and exact-creative duplication. Ingestion compares the snapshot with the prior account snapshot to derive ad-volume change. Google Maps metrics use daily snapshot IDs; website snapshots version by checksum (or day when no checksum exists); LinkedIn company metrics version from material profile values. This prevents mutable provider entities from being mistaken for permanent duplicates.

The remaining registry entries are contracts awaiting vendor-specific collectors: SEC EDGAR, OpenCorporates, Crunchbase, Apollo, People Data Labs, BuiltWith, Semrush, Similarweb, Google Trends, YouTube, HubSpot, Salesforce, first-party ad platforms, Ticketmaster, NPPES, SAM.gov and USAspending.

## Run input and scheduling

Manual run:

```bash
curl -X POST http://localhost:8787/api/v1/connectors/gdelt/run \
  -H 'content-type: application/json' \
  -H "x-api-key: $ADMIN_API_KEY" \
  --data '{"company":{"name":"Target Company","domain":"target.example"},"query":"\"Target Company\"","limit":25}'
```

Enable a schedule:

```bash
curl -X PATCH http://localhost:8787/api/v1/connectors/gdelt \
  -H 'content-type: application/json' \
  -H "x-api-key: $ADMIN_API_KEY" \
  --data '{"enabled":true,"schedule_input":{"company":{"name":"Target Company","domain":"target.example"},"limit":25}}'
```

Schedule input is persisted, so any key named like a token, secret, password, credential or API key is rejected recursively. For large universes, implement a connector-side account iterator/checkpoint instead of storing thousands of companies in schedule input.

When a successful or partial run returns `cursor`, the next run receives it as top-level `input.cursor` unless the caller supplies a cursor explicitly. A one-time manual run may send `{"reset_cursor":true}` to start without the stored cursor; this reserved field cannot be saved in a recurring schedule.

NewsAPI advances `cursor.published_at`; GDELT advances `cursor.seen_at`. Both request from five minutes before the saved time so records with equal timestamps are not lost. Stable article URLs absorb that overlap through idempotency. Manual `from`/`start_datetime` values for these adapters use ISO date-time strings.

## Accuracy rules

- Never use a result/article URL as the target company's domain.
- News and search collectors must receive a target company unless they implement a separate discovery-and-review stage.
- Prefer provider entity IDs, canonical domains and CRM IDs over names.
- Mark crawl-time fallbacks as `event_time_quality: retrieval_time`; the ingestion layer discounts confidence.
- If a provider reuses an `external_id` for a changing snapshot, append a stable snapshot/version key or omit it and rely on content idempotency.
- Keep raw provider data in governed object storage and place only its pointer in `raw_ref`.
- Review source quality and rejection metrics before enabling automated activation.

## Cost control

- Enrich firmographics once and cache within license terms.
- Use low-cost registries/web monitoring to screen the universe.
- Run ads, jobs, social and review monitoring for qualified accounts.
- Run fast first-party intent and creative monitoring only for warm/hot accounts.
- Save provider cursors and deltas so unchanged history is not repurchased.
- Measure provider cost per accepted opportunity, not just cost per record.

Recommended implementation order: CRM, Apollo/contact enrichment, Crunchbase/SEC, technology/traffic, first-party ads, then industry-specific public feeds.

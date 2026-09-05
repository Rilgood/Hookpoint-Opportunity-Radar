# Saved work and evidence review

Migration 11 adds tenant-scoped `work_items` and `evidence_reviews`. The host registers these routes by calling `registerWorkflowRoutes(router, db)` from `src/services/workflow-routes.js`. Every write requires the existing `write` scope; actor and audit timestamps come from the authenticated server context. Reads do not create tasks or review records.

## Work items

- `GET /api/v1/work-items`: accepts `view`, `company_id`, `owner_name`, `q`, `time_zone`, `limit`, and `offset`.
- `GET /api/v1/work-items/:id`: one item in the authenticated tenant.
- `POST /api/v1/work-items`: requires `company_id` and `title`; accepts `note`, `owner_name`, and `due_at`. Creates an `open` item. If owner is omitted, use the company's current owner; explicit null leaves it unassigned.
- `PATCH /api/v1/work-items/:id`: accepts `title`, `note`, `owner_name`, `due_at`, `status`, `snoozed_until`, and `resolution_note`.

All responses use the host's normal `{data, meta}` envelope. The list's inner data is `{data: WorkItem[], total, limit, offset, counts, as_of, time_zone}`. Counts honor company, owner, and text filters before view selection or pagination. Owner matching is exact and case-insensitive. Text search is a literal substring of title or company name, including literal percent and underscore characters.

Available views and count keys:

| View | Meaning |
| --- | --- |
| `all` | Every saved item |
| `open` (default) | Open items whose snooze has ended, including undated work |
| `due` | Open, unsnoozed work due before the end of the user's current calendar day; includes overdue work |
| `today` | Open, unsnoozed work due during the user's current calendar day |
| `upcoming` | Open, unsnoozed work due after the user's current calendar day |
| `overdue` | Open, unsnoozed work due before `as_of` |
| `snoozed` | Open items with a future `snoozed_until` |
| `completed` (`done` alias) | Items with status `done` |
| `dismissed` | Items with status `dismissed` |

Today and overdue can overlap: a task due earlier today belongs to both. Snoozing suppresses an item from active date views until that instant. Undated work appears in open/all. A valid IANA `time_zone` defaults to UTC. Calendar boundaries account for daylight-saving changes, including 23- and 25-hour days.

An item exposes its stored fields plus `company_name`, `company_status`, `suggested_next_action` from the current recommendation, and `is_actionable`. Suggested actions do not create saved work automatically. `is_actionable` is false for completed/dismissed, future-snoozed, or closed-account items. Existing open items remain visible when an account closes; the user can finish or dismiss them.

Validation:

- Title: nonblank, at most 240 characters. Owner: at most 200. Note/resolution: at most 2,000.
- Date inputs must be valid ISO timestamps with explicit timezone. Due dates can be past or future. Null clears due date, owner, note, or snooze. A newly supplied snooze must be in the future and the item must be open.
- States are `open`, `done`, and `dismissed`. Dismissing requires an explicit, nonblank resolution note. Completing/dismissing clears snooze and records `completed_at`; reopening clears completion and resolution, plus snooze unless a new one is supplied.
- New or reopened work on rejected, customer, lost, or disqualified accounts is refused. Existing work can still be completed/dismissed.
- Unsupported and client-supplied provenance fields are rejected. Company/item IDs are checked within the authenticated tenant.

Work-item changes are recorded in `audit_events` with actor, request ID and field changes. Identity merges move saved work to the surviving company; explicit company deletion cascades saved work.

## Evidence review

- `GET /api/v1/companies/:id/evidence-reviews`: accepts `status=all|unreviewed|verified|rejected|needs_review`, `limit`, and `offset`. Returns `{data, total, limit, offset}` inside the standard envelope.
- `POST /api/v1/companies/:id/evidence-reviews`: accepts `observation_id`, `status=verified|rejected|needs_review`, and `note`. Rejected and needs-review decisions require a note. Returns `{review, company}` with the rescored company.

List items contain `observation_id`, title, source, URL, observation time, status, note, reviewer and review time. Unreviewed is synthesized for observations with no stored review. Company-detail observations also expose `review_status`, `review_note`, `reviewed_by`, and `reviewed_at` so evidence can remain inspectable without being presented as verified support.

Rejected observations remain stored as lineage but are excluded from current signal counts, confidence, contribution, recommendations, source attribution and comparable-account features. A rejected pre-outcome observation cannot be replaced by a later observation to imply the signal existed before conversion. Historical recorded scores are preserved. Verification restores eligibility only while the original evidence is timely and matches the signal rules; it does not boost confidence or refresh event time. Needs-review keeps the existing contribution while making the review state explicit.

Review decisions apply to the selected observation. Another observation from the same URL can still support a signal until it is reviewed; no automatic blanket rejection of independent records occurs. Identity merges preserve the observation and its review state. Every review transition is retained in the actor audit. Company deletion cascades observation reviews.

Run isolated regressions with `TZ=UTC LOG_LEVEL=error node --test --test-reporter=spec test/workflow.test.js` from radar-core. These checks use synthetic evidence and isolated databases; they do not validate live provider data or send outreach.

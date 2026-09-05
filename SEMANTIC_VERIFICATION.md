# End-to-end semantic verification

Run date: September 4, 2026 (America/New_York).

## Workspace cleanup

The local workspace was reset to empty and restarted without flags to verify that it does not repopulate itself. All 18 operational tables contain zero rows: companies, observations, signals, signal evidence, people, aliases, source identities, entity resolution history, identity reviews, outcomes, recommendations, score snapshots, scoring versions, lead events, audit events, ingestion rejections, connector runs, and webhook receipts. Only the tenant, authentication record, connector catalog and migration records remain.

New local workspaces default to empty. `node scripts/local-demo.mjs --reset --empty` clears local records and remembers empty mode. Fixture seeding requires explicit `--seed`. The dashboard no longer offers to insert sample companies.

## What the simulation establishes

The tested story is: dated evidence enters through HTTP, becomes a resolved account with explained signals, appears in the browser, supports a reviewed next step, and produces a recorded sales outcome that is reflected in the workbench, export and analytics.

The HTTP journey covers 9 business stages, 63 HTTP requests, two isolated tenants and 61 simulated days in an in-memory SQLite database. The browser journey uses another in-memory database on port 5174. Both use synthetic inputs and the actual application engine. The browser runs the actual React console against the actual core API through the normal local proxy. External connectors and messaging are disabled. Test inputs are not observations of real companies.

| Boundary | Verified behavior |
|---|---|
| Evidence intake | A single launch is research evidence; explicit evaluation behavior and measured creative issues can raise priority. |
| Replay and provenance | Repeated provider records cannot create ghost companies or alter their identity. Canonical article copies retain source records without increasing independent support. |
| Time | Old evidence expires; future evidence cannot support current scoring. |
| Identity | Ambiguous identity holds outreach. Confirmation immediately recalculates eligibility. |
| Risk | A crisis suppresses outreach. Disputing suppression records feedback without clearing the hold. |
| Browser brief | Source dates and URLs are visible; hypotheses and projections are qualified; an eligible prospect receives an editable draft. No message is sent. |
| Workflow | Saving Contacted persists after reload and replaces new-prospect advice with follow-up guidance. |
| Export | The contacted workbench and CSV contain the same account; other accounts are excluded. |
| Sales chronology | Backdated activity does not reopen a won account. Backfilled labels use a pre-event score when available. |
| Calibration | Unknown historical scores are marked and excluded; today's score cannot stand in as a historical prediction. Earliest-label exclusions cannot be bypassed with a later label. Activity and revenue records remain available. |
| Tenant boundary | Data and exports stay within the authenticated tenant. |
| Empty state | No fake metrics, leads, source runs or calibrated rates appear in the cleared workspace. |

## Defects corrected during verification

1. A duplicate provider record previously resolved its company before being recognized as a duplicate, creating ghost accounts on changed replays.
2. Identity confirmation did not immediately refresh the score and qualification state.
3. Older outcomes could overwrite newer pipeline states.
4. Backfilled outcomes used today's score, creating lookahead bias in historical analytics. Score provenance is now server-owned; legacy backfills need a matching pre-event snapshot.
5. Expired signals appeared among active drivers, and risk contributions could read like positive contributions.
6. Existing sales conversations sometimes received new-prospect advice. Stage-specific next steps now cover outreach, replies, discovery, deal review and customer handoff.
7. Suppression feedback implied that it lifted a hold; outcome feedback implied automatic model improvement. The UI now states the actual behavior.
8. Empty comparable cohorts displayed a measured-looking 0% rate and 0–0% interval. They now show unavailable statistics.
9. Saved outcome forms could retain prior values; local event dates could shift to the previous calendar day. Form reset and local-date conversion are covered by regression tests.
10. The local source screen offered actions that the local server blocks. Controls are now explicitly unavailable locally.
11. Two sibling components shared an account key, producing browser reconciliation errors. Their keys are now distinct.

## Original validation results

- Core domain and HTTP simulation suite: **130 passed**, zero failures.
- Frontend/component suite: **76 passed**, zero failures.
- Express API integration suite: **18 passed**, zero failures.
- Total automated tests: **224 passed**.
- Full workspace typecheck and production build: **passed**. Existing vendor sourcemap notices and a shared-bundle size advisory remain.
- Authenticated browser test definitions: typecheck and discovery passed (five tests); their in-memory calibration fixture rehearsal passed.
- Final browser confirmation: identity review changed the held account from watch to warm immediately; a subsequent Contacted outcome changed its next step, removed new-prospect drafting, and persisted server-owned score provenance. No new browser errors were reported during that final sequence.
- Source files used by the final core build were checked for subsequent edits; none had changed after the successful build.
- The simulation servers were stopped and their in-memory databases discarded. The main workspace remains running with zero operational records.

## Workflow and readiness follow-up

The subsequent backend pass completed **152 core tests with zero failures**, including 15 saved-work/evidence-review regressions and three workspace-readiness regressions. The earlier frontend, API, build and browser results above describe the original pass; this follow-up does not assert that those checks were rerun.

The saved-work HTTP journey verifies create, snooze, complete, reopen, tenant isolation and rejection-driven rescoring. Separate checks prove database-restart persistence, dismissal reasons, actor audit, closed-account restrictions, 23/25-hour local calendar days, and exclusion of rejected pre-outcome evidence from comparable-account features. Migration 11 and its generated schema manifest passed verification. All storage used for these tests was isolated SQLite; the persistent local workspace was not changed by this backend pass.

`test/business-simulation.test.js` now also contains an independent **15-request, two-tenant HTTP readiness journey**, alongside the original nine-stage, 63-request simulation. It verifies that an account alone is not collected evidence, needs-review is not a completed decision, undated/unassigned work does not complete the owned-action milestone, and only the intended tenant's work and outcomes advance its four milestones. Configured public-source prerequisites do not imply a successful provider run. One recorded meeting remains one labeled account, not validation of the ranking model.

These follow-up tests made no provider calls or sends and do not establish real Clerk login, PostgreSQL execution, restoration, live source relevance or predictive lead quality. See [CONNECTOR_ACTIVATION.md](CONNECTOR_ACTIVATION.md) for the remaining hookup and acceptance steps.

## Reproduction

```sh
# No persistent database or provider credentials used:
TZ=UTC node --test artifacts/api-server/radar-core/test/business-simulation.test.js

# Actual console/API browser fixture workspace; Ctrl+C discards all records:
node scripts/simulation-workspace.mjs
# Open http://127.0.0.1:5174/dashboard

# Normal local workspace stays separate and empty:
node scripts/local-demo.mjs
```

## Limits

These checks establish the tested software behavior and business semantics. They do not measure lead quality or conversion accuracy on real accounts. Live-provider attribution and coverage, authenticated Clerk browser login, production PostgreSQL behavior and recovery, and predictive validation on independently reviewed real outcomes were not exercised in this local simulation.

The existing authenticated E2E definitions were updated for the current scoring version and expandable calibration panel. Their types and test discovery were checked, and their calibration fixture was rehearsed against an in-memory database; the Clerk browser suite itself was not run.

Scores remain rules-based rankings, not purchase probabilities. Publisher hostnames approximate source independence. Human review is still required to determine whether an attributed event is true and commercially relevant.

### Browser workflow follow-up

The disposable in-memory browser simulation on port 5174 used the real UI and API. Created an owned action, verified it after reload, moved its date to 22:00 local (overdue), snoozed it (active counts dropped to zero), and completed it. Completion did not advance the account sales stage. Rejected the synthetic first-party observation with a reason: score changed99.4→93.1, active signals7→5, and the brief stopped citing that observation. Recorded a synthetic meeting outcome separately; setup then reported4/4 milestones from saved records.

A browser-native datetime fill revealed that React state could lag the displayed value. Work-item submission now reads the named native date field through FormData, with validation and regression tests for both create and reschedule. The fixed flow saved exactly the displayed time. Setup and completed queue screens were verified at375px with no horizontal overflow, and the simulation browser had no logged errors. Final frontend suite:104 passed.

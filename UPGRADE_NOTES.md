# September 2026 upgrade

## Delivered

- Guided workspace setup, with source-specific prerequisites, 16 implemented adapters separated from 17 planned integrations, and milestones derived from actual saved work.
- Persistent tenant-scoped work queue with owners, dates, search, local calendar-day filters, snooze, reschedule, completion, dismissal reasons and audit history. Native date submission uses the displayed input value.
- Evidence review with immediate rescoring and removal of rejected observations from current briefs, recommendations and peer analysis. Verification never inflates confidence.
- Source configuration now supports NewsAPI target/query and actor-specific Apify JSON, preserves advanced saved inputs, and reports partial/empty imports accurately.
- Production preflight, a real Express production-mode rehearsal, portable generated-contract checks, migration 11 and a blank deployment environment template.

- Daily priority workspace with a focused account brief, source history, real metrics and visible review work.
- Account briefs distinguish observations, hypotheses and open questions; source links and dates travel with copied notes. Projections describe evidence decay, not buyer deadlines. Outreach drafts require current evidence and respect identity, risk, closed-workflow and follow-up states.
- Searchable workbench with persistent URL filters, pipeline stages, owner context, evidence age, clear recovery states and matching CSV export.
- Keyboard account search, responsive navigation, reduced-motion support and route-level loading. Initial production JavaScript entry reduced from about 1,237 kB to 526 kB before compression by loading pages separately.
- Removed fabricated account growth, configuration-based live-ingestion claims, misleading recency labels and the unweighted risk-as-penalty display. Added the missing need dimension to the score breakdown.
- rules-1.2: evidence aging, canonical URL deduplication, publisher-origin corroboration, future-evidence eligibility, retrospective rule revalidation, prior-only ad baselines, narrower commercial-intent rules, and safer identity matching.
- One-command isolated local workspace that starts empty; fictional fixtures require explicit opt-in. Real persisted workflows and viewable fixture evidence snapshots remain available for development. macOS native build dependencies restored without changing the application architecture.

## Verified

- 152 core tests passed, including the original nine-stage/63-request business simulation and a 15-request setup/workflow milestone journey.
- 18 Express API integration tests passed, including auth and private workspace isolation.
- 104 frontend tests passed, covering workflow persistence, review decisions, date submission, connector inputs, partial results, setup states and existing business guidance.
- Shared libraries, console, browser-test definitions, API server and scripts typechecked. The complete release gate passed, with PostgreSQL and authenticated Clerk browser checks explicitly skipped.
- Eight preflight tests, two generated-contract snapshot tests and nine production-mode rehearsal checks passed. Rehearsal builds real Express/Vite artifacts and uses temporary API keys, a disposable database and no external services.
- Production console and API bundles built successfully. The console build retains vendor sourcemap notices and a size advisory for its shared entry chunk.
- Local browser verification covered desktop layout, the narrow viewport, account navigation, brief preparation, clipboard success feedback, filtered-view persistence and CSV links, and saving a fictional contacted outcome with subsequent persisted activity.
- Demo runtime API checks covered authentication (401 without a key), unrelated origins (403), live connector blocking (403), production-mode refusal, identity holds, suppression, and persisted account updates.

## Deployment and data dependencies

Live provider ingestion, authenticated Clerk browser journeys, and PostgreSQL recovery were not exercised here because this source export did not include their credentials/services. No production deployment or GitHub push was performed. The working preview is empty; all 20 operational tables contain zero records and seeding is disabled across restarts.

Publisher hostnames approximate independent sources: separately controlled accounts on one platform count conservatively as one source, while copied reporting across different domains is not automatically identified. News search results still require company/event attribution review; ad provider coverage must be comparable. Fit scoring remains the existing rules-based heuristic rather than a learned ideal-customer profile. Predictive accuracy requires a reviewed real-account dataset and held-out outcome evaluation.

Existing custom scoring versions are preserved. rules-1.2 is the default where no approved custom scoring version exists; deployments with previously approved versions retain their version lineage. Rescoring rechecks evidence against the current signal catalog.

## Semantic verification follow-up

See [the complete verification report](SEMANTIC_VERIFICATION.md) for cleanup evidence, business scenarios, reproduced defects and fixes. Replay side effects, identity-confirmation scoring, backdated workflow changes and historical-score lookahead were corrected. Unknown historical scores stay available as activity but are excluded from calibration. The disposable browser simulation is separate from the empty workspace and its data is discarded on shutdown.

## Liquid-glass visual redesign

The workspace now uses a pearl-and-blue atmospheric canvas, floating translucent navigation, capsule controls, native system typography, and a bespoke optical radar illustration. Shared cards, dialogs, search, inputs and menus use coordinated glass materials; dashboard metrics, opportunity filters, source cards and account briefs have been refined around the same design.

No backend rules or persisted business data changed. The main workspace still has zero companies, observations, signals and outcomes. Populated-screen visual checks used the disposable in-memory simulation, which was stopped afterward.

Validation: 76 frontend tests, frontend TypeScript and the production UI build passed. Browser review covered the desktop dashboard, sources, populated priorities and account brief, 375px mobile layout, mobile search dialog, and scrollable navigation at 667×375. Final browser logs contained no errors. Primary button text contrast was checked (at least 4.8:1 against its gradient); reduced-motion and reduced-transparency fallbacks are included. Existing vendor sourcemap and shared-bundle-size advisories remain.

## Connector-ready workflow verification

The isolated browser workspace completed the real API journey: create an owned action, reload it, reschedule it to an overdue local time, snooze it, complete it, reject mismatched evidence and record a synthetic meeting outcome. The setup page moved from one to four completed milestones only after those records existed. Rejecting the first-party observation changed the sample score from 99.4 to 93.1, removed its two active signals, and removed it from the current account brief. Native date input mismatch was reproduced, fixed and rechecked in the browser.

The setup and completed-work screens fit a 375px viewport without horizontal overflow. Browser logs contained no errors. The main workspace was never used for test records. See [connector activation](CONNECTOR_ACTIVATION.md), [production preparation](PRODUCTION_READINESS.md) and [semantic verification](SEMANTIC_VERIFICATION.md).

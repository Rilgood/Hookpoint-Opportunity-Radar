# Hookpoint Opportunity Radar

An evidence-led workspace for growth teams: identify promising accounts, understand the signals behind their ranking, review uncertainty, and track sales outcomes.

## Try it locally

Requires Node.js 24+ and pnpm. From the repository root:

```sh
pnpm install --frozen-lockfile
node scripts/local-demo.mjs
```

Open **http://127.0.0.1:5173/dashboard**. New local workspaces start empty, and records persist in `.local/demo/workspace.sqlite`. Live provider access is disabled in this isolated runtime. Stop with Ctrl+C. Run `node scripts/local-demo.mjs --reset --empty` to clear local records and remain empty across restarts. Fictional fixtures are available only through an explicit `--seed` run.

`pnpm demo` is an equivalent shortcut. See [local development](LOCAL_DEVELOPMENT.md) for ports and production setup.

## The workflow

1. Open **Workspace setup** for source prerequisites and milestones based on saved evidence, completed reviews, owned actions and outcomes.
2. Start with **Daily radar** for the prioritized shortlist, due work and data-quality checks.
3. Use **Opportunities** to filter by company, tier, pipeline stage or identity review. The URL preserves the view, and the CSV uses the same filters.
4. Open **The account brief** for observed facts, the opportunity hypothesis, current next step, missing evidence, and an evidence-decay projection. Copy the brief into account notes or adapt a draft for an eligible prospect.
5. Review the source evidence. Rejecting an observation immediately removes it from current scoring; verification records judgment without inflating confidence. Save an owned, dated next step in **Work queue**, then complete, snooze, reschedule or dismiss it with a reason.
6. Record a real outcome when one happens. Follow-ups and closed accounts receive different guidance from new prospects.
7. Use **Insights** and model calibration to assess performance against reviewed outcomes.

Press **Cmd/Ctrl+K** to find an account from anywhere. All draft preparation is local UI work; the app does not send outreach automatically.

## Accuracy and provenance

The rules-1.2 engine ages evidence relative to the scoring date, excludes future events from current scoring, deduplicates identical originating article URLs, and counts publisher hosts separately from feed transports. Hiring surges require an observed volume threshold. Agency searches require explicit, unnegated search language or a structured declaration. Creative age and repetition produce a refresh hypothesis, not a claim of proven performance fatigue. Ad baselines use preceding same-source observations, and country-only matches cannot verify account identity.

Scores are ranking hypotheses, not measured purchase probabilities. A successful test suite verifies software behavior; it does not establish predictive accuracy on real accounts. Live-source attribution, independent publisher ownership, and measured outcome calibration still need validation for each business deployment.

## Live deployment

The existing React/Vite console, Clerk-authenticated Express host, and PostgreSQL storage architecture are retained. Configure the Clerk keys, production database, and relevant connector credentials through the hosting environment. The local demo never reads those credentials and is unavailable in production builds.

Start with [connector activation](CONNECTOR_ACTIVATION.md) for the 16 implemented integration paths and [production preparation](PRODUCTION_READINESS.md) for environment checks, migration and deployment rehearsal. The 17 other catalog entries are explicitly planned adapters; they cannot be activated with credentials alone.

The detailed runtime and migration contract is in [the radar core README](artifacts/api-server/radar-core/README.md) and [deployment documentation](artifacts/api-server/radar-core/docs/DEPLOYMENT_AND_SECURITY.md).

## Validation

- Full release checks: `pnpm verify:release` (reports missing Postgres/Clerk integration gates as skipped)
- Redacted configuration check: `pnpm preflight:production --first-deploy`
- Production-mode code rehearsal: `pnpm verify:production-rehearsal`

- Disposable browser simulation: `node scripts/simulation-workspace.mjs` (port 5174, in-memory synthetic data; Ctrl+C discards it)
- Business HTTP simulation: `TZ=UTC node --test artifacts/api-server/radar-core/test/business-simulation.test.js`
- Core domain suite: `TZ=UTC pnpm --dir artifacts/api-server/radar-core test`
- API auth/workspace integration: `pnpm --filter @workspace/api-server test`
- Console integration: `pnpm --filter @workspace/hookpoint-radar test`
- Build and types: `PORT=5173 BASE_PATH=/ pnpm build`
- Generated contracts: `pnpm --filter @workspace/api-spec codegen`

The authenticated Clerk browser suite and PostgreSQL restore rehearsal need their configured services. See [upgrade notes](UPGRADE_NOTES.md) for the checks run on this revision and remaining deployment dependencies.

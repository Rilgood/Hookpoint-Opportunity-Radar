# [Project name]

_Replace the heading above with the project's name, and this line with one sentence describing what this app does for users._

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (binds `PORT`; 8080 in the `API Server` workflow). It mounts the dependency-free `artifacts/api-server/radar-core` kernel under `/api`; see `artifacts/api-server/radar-core/README.md` for how that is wired. Scoring/signal/connector catalogs live only in `radar-core/config/`; the host points the bundled core at them via `RADAR_CONFIG_DIR`.
- `pnpm run verify:api-server` — builds the shared libs, typechecks `@workspace/api-server`, then runs its Vitest suite (`pnpm --filter @workspace/api-server run test`; also the `api-server` validation workflow). The suite boots the real Express app on an ephemeral port against an in-memory SQLite radar database with `AUTH_REQUIRED=true` and a bootstrap admin API key (`src/test/setup.ts`), only mocks Clerk's `getAuth`, and covers the `/api/v1` auth gate (no session/key → 401, bad key → 401 even with a session), Clerk-session and API-key routes, per-user workspace isolation, and body validation (invalid JSON, missing fields, wrong types). It never touches `DATABASE_URL` and needs no Clerk secrets.
- `pnpm run verify:radar-core` — syntax check + `node --test` suite for the radar core, run on in-memory SQLite and again against the workspace Postgres in disposable schemas when `DATABASE_URL` is set (also the `radar-core` validation workflow)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push Drizzle schema changes to the `public` schema (dev only). Drizzle push drops anything in `public` it does not know about, which is why the radar tables live in their own `radar` schema.
- `pnpm --filter @workspace/api-server run db:migrate` — apply the radar core's schema + pending migrations to the dev database (also run by `scripts/post-merge.sh`). Production never runs DDL: publishing copies the dev schema, and the API refuses readiness with `schema_out_of_date` if it is behind. After changing `radar-core/src/db/schema.js` or adding a migration, run `pnpm run db:manifest` inside `artifacts/api-server/radar-core`.
- Required env: `DATABASE_URL` — Postgres connection string. The radar core stores all operational data there (schema `radar`); without it, it falls back to a SQLite file under `artifacts/api-server/data/`, which is fine for tests but is wiped on every autoscale restart.
- `pnpm --filter @workspace/hookpoint-radar run test` — component/integration suite (Vitest, no live session)
- `pnpm run verify:release` — runs every release gate in a fixed order (`api-contract` → `api-server` → `radar-core` → `browser-smoke`), stops at the first failure and names the failing check, then prints a PASSED/FAILED/SKIPPED summary. Also registered as the `release` validation. Run this before publishing; the individual `verify:*` scripts are for re-running one gate alone. `browser-smoke` is the only step that can be skipped, and only when `CLERK_SECRET_KEY` is absent (e.g. a fork without secrets); the skip is announced on stderr and in the summary, never silently. New gates go in `release_checks` in `scripts/verify-release.sh`.
- `pnpm run verify:browser-smoke` — release gate for the authenticated browser journey (also registered as the `browser-smoke` validation). Starts the API Server and web dev server on free ports behind a local same-origin proxy, waits for `/api/health`, runs the Playwright journey, tears everything down, and lists the traces/screenshots from `.e2e-artifacts/` on failure. Only needs `CLERK_SECRET_KEY`; it does not depend on (or collide with) the running workflows. Orchestrator: `scripts/src/browser-smoke.ts`.
- `pnpm --filter @workspace/hookpoint-radar run test:e2e` — the same journey against already-running services (Playwright only). Needs the `API Server` and `web` workflows running and `CLERK_SECRET_KEY`; it signs in a dedicated Clerk dev user (`e2e-decision-smoke@example.com`), resets that user's private workspace in the dev database (Postgres via `DATABASE_URL`, or the SQLite file when unset), then confirms an identity, provokes a stale-approval rejection, and approves a score version. Spec and helpers live in `artifacts/hookpoint-radar/e2e/`; traces/screenshots go to `.e2e-artifacts/` (must stay outside the Vite root or the dev server reload-loops).

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

_Populate as you build — short repo map plus pointers to the source-of-truth file for DB schema, API contracts, theme files, etc._

## Architecture decisions

_Populate as you build — non-obvious choices a reader couldn't infer from the code (3-5 bullets)._

## Product

_Describe the high-level user-facing capabilities of this app once they exist._

## User preferences

_Populate as you build — explicit user instructions worth remembering across sessions._

## Gotchas

_Populate as you build — sharp edges, "always run X before Y" rules._

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details

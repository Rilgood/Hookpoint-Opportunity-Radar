---
name: Browser e2e setup
description: How authenticated Playwright runs work in this workspace (Clerk ticket sign-in, system Chromium, artifact output placement).
---

**Rule:** Keep Playwright `outputDir` (traces, screenshots) outside any Vite artifact root, and sign in through Clerk's ticket strategy rather than the UI form.

**Why:** Playwright streams trace chunks into `outputDir` during the run; when that directory sat inside `artifacts/hookpoint-radar`, the Vite dev server reload-looped ("[vite] connecting..." forever) and the app never mounted, which looked like a Clerk boot failure. Clerk's hosted UI form is not scriptable for a dev instance without email codes, but the Backend API (`CLERK_SECRET_KEY`) can mint `sign_in_tokens` that the browser consumes via `window.Clerk.client.signIn.create({ strategy: "ticket" })` + `setActive`, producing the same cookies a real operator gets. `.test` emails are rejected by Clerk; use `@example.com`.

**How to apply:** Any new browser suite should reuse `artifacts/hookpoint-radar/e2e/clerk-session.ts` and the `.e2e-artifacts/` output location. Playwright's bundled browsers are not installed; the workspace Chromium at `/repl/tools/bin/chromium` works headless with `--no-sandbox`. The private-workspace model keys the tenant on the Clerk user id, so resetting a test account is `DELETE FROM tenants WHERE id = <userId>` (cascades) and the API recreates it on the next request.

**Release gate (isolated services):** The Clerk dev instance accepts `http://localhost:<port>` as an origin, so the smoke gate can start the API and web dev servers on free ports behind a tiny same-origin proxy (`/api` → API, rest → web, websocket upgrade relayed for Vite HMR) instead of depending on the workspace workflows or the `.replit.dev` domain. Spawn services `detached` and kill the process group, otherwise pnpm's shell wrappers outlive the node children. Both API instances may share the same SQLite file (WAL) without trouble.

**Concurrent validations race on the generated client:** the validation runner starts every registered check in parallel, and the API-contract check's Orval codegen deletes/rewrites `lib/api-zod/src/generated` mid-run. Any check that builds or serves code importing the generated client must share the `flock` used by `verify:api-contract` (`/tmp/hookpoint-radar-generated-api.lock`), or esbuild fails with "Cannot read file …/generated/types/…".

---
name: api-server test suite conventions
description: How the Express api-server vitest suite is set up and why (env in setupFiles, only getAuth mocked, no supertest).
---
- Env must be set in the vitest `setupFiles` (not inside a test): the radar core freezes its config at import time, and `app.ts` opens the DB singleton at import. Set `DATABASE_PATH=:memory:` and drop `DATABASE_URL` there so a run never touches the workspace Postgres.
- Only Clerk's `getAuth` is mocked; the real `clerkMiddleware` runs with placeholder `pk_test_/sk_test_` keys when the secrets are absent, so the suite passes on a fresh checkout.
  **Why:** the value is in the app's own gate (`/api/v1` → 401 without session/key, API key wins over a cookie), not in re-testing Clerk's JWT verification.
- Requests go through `http.createServer(app).listen(0)` + global `fetch`; no supertest dependency (the root installer cannot add shared dev tools, see workspace-test-tooling).
- `AUTH_REQUIRED=true` + `ADMIN_API_KEY`/`HASH_SALT` (≥32 chars) in setup give production-like auth semantics and a bootstrap admin key for the API-key path.
**How to apply:** add new api-server route tests to `src/*.test.ts` under the same setup; a mutation check (disable the 401 branch) should fail the suite.

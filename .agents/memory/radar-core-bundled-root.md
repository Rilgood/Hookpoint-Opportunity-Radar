---
name: radar-core config lives in two places
description: Rule for editing scoring/signal/connector catalogs — both copies must change together, because the bundled host resolves a different root than the tests.
---

**Rule:** change `scoring.json`, `signal-catalog.json` or `connector-catalog.json` in `artifacts/api-server/config/` **and** `artifacts/api-server/radar-core/config/` together. Likewise, keep the "How this package is deployed" section of radar-core's README in step if the way api-server mounts the core changes.

**Why:** the core computes its root from `import.meta.url`, and esbuild bundles the host to `artifacts/api-server/dist/`, so the live API resolves `../config` to the api-server copy while `node --test` uses the radar-core copy. Nothing enforces parity; drift means green tests and a differently-scoring production API. (A follow-up to enforce or remove the mirror was proposed in Sept 2026.)

**How to apply:** any scoring version bump, new signal rule or connector manifest change; any change to the mount in api-server's app.ts.

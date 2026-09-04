---
name: radar-core root vs config dir under the bundled host
description: Why the api-server host must set RADAR_CONFIG_DIR before importing radar-core, and why the core's root-relative paths (database, .env) still differ between the bundle and the tests.
---

**Rule:** radar-core's catalogs (`scoring.json`, `signal-catalog.json`, `connector-catalog.json`) live only in `artifacts/api-server/radar-core/config/`. The host's very first import in `app.ts` is a side-effect module that sets `RADAR_CONFIG_DIR` to that directory; keep it first, and never reintroduce a mirror copy under `artifacts/api-server/config/`.

**Why:** the core derives `rootDir` from `import.meta.url`, and esbuild bundles the host into `artifacts/api-server/dist/`, so root-relative paths point at `artifacts/api-server/` in the bundle but at `radar-core/` under `node --test`. A tracked mirror of the config directory used to paper over this, and drift between the two copies meant green tests with a differently-scoring production API. The core now fails at import if `RADAR_CONFIG_DIR` lacks any catalog file.

**How to apply:** the database path and `.env` lookup are still root-relative (dev DB at `artifacts/api-server/data/`), so any change to storage location must reason about the bundled root, not the package root. If the host ever stops bundling the core (esbuild `external`), `RADAR_CONFIG_DIR` becomes redundant but harmless. Keep the README "How this package is deployed" section in step with any change to the mount.

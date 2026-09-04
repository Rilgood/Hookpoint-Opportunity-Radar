#!/bin/sh

# Verifies the radar-core server (artifacts/api-server/radar-core), which is a
# plain Node.js package nested inside the api-server artifact rather than a
# pnpm workspace member. Runs the syntax check (node --check over src and test)
# and the node --test suite so a broken file fails project validation.
#
# The suite runs against in-memory SQLite, and a second time against the
# workspace's managed Postgres (the engine used by the published API) when
# DATABASE_URL is available. Each Postgres test uses a private, disposable
# schema, so the development data is never touched.

set -eu

radar_core_dir="artifacts/api-server/radar-core"

if [ ! -f "$radar_core_dir/package.json" ]; then
  echo "verify-radar-core: expected $radar_core_dir/package.json to exist" >&2
  exit 1
fi

pnpm --dir "$radar_core_dir" run check
pnpm --dir "$radar_core_dir" run test

if [ -n "${DATABASE_URL:-}" ]; then
  echo "verify-radar-core: running the suite against Postgres (DATABASE_URL)"
  pnpm --dir "$radar_core_dir" run test:postgres
else
  echo "verify-radar-core: DATABASE_URL is not set; skipping the Postgres pass" >&2
fi

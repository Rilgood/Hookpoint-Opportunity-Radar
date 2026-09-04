#!/bin/sh

# Verifies the Express API server (artifacts/api-server, @workspace/api-server)
# by running its TypeScript typecheck so a type error in route handlers, auth
# middleware, or DB access fails project validation instead of surfacing only
# when someone runs the typecheck by hand or the dev workflow crashes.
#
# The api-server tsconfig uses project references to lib/db and lib/api-zod,
# and `tsc -p --noEmit` resolves those through their emitted declaration files
# (dist/, which is gitignored). Build the shared libs first so the typecheck
# is reliable on a fresh checkout.

set -eu

api_server_dir="artifacts/api-server"

if [ ! -f "$api_server_dir/package.json" ]; then
  echo "verify-api-server: expected $api_server_dir/package.json to exist" >&2
  exit 1
fi

pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck

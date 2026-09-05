#!/bin/sh

# Verifies the Express API server (artifacts/api-server, @workspace/api-server)
# by running its TypeScript typecheck and then its vitest suite, so both a type
# error and a runtime regression (a route returning the wrong status, the auth
# gate letting unauthenticated requests through, a validation error no longer
# being rejected) fail project validation instead of surfacing only when
# someone exercises the API by hand.
#
# The api-server tsconfig uses project references to lib/db and lib/api-zod,
# and `tsc -p --noEmit` resolves those through their emitted declaration files
# (dist/, which is gitignored). Build the shared libs first so the typecheck
# is reliable on a fresh checkout.
#
# The test suite boots the real Express app against an in-memory SQLite radar
# database (see artifacts/api-server/src/test/setup.ts); it never touches
# DATABASE_URL and needs no Clerk secrets, so it is safe on any checkout.

set -eu

api_server_dir="artifacts/api-server"

if [ ! -f "$api_server_dir/package.json" ]; then
  echo "verify-api-server: expected $api_server_dir/package.json to exist" >&2
  exit 1
fi

pnpm run typecheck:libs
pnpm --filter @workspace/api-server run typecheck
pnpm --filter @workspace/api-server run test

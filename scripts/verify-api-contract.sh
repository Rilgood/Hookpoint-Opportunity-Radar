#!/bin/sh

set -eu

generated_paths="
lib/api-client-react/src/generated
lib/api-zod/src/generated
"

# Orval deletes and rewrites the generated client while it runs. Hold the shared
# lock so a concurrent release gate (verify:browser-smoke) that builds against the
# generated files never sees them half-written.
flock /tmp/hookpoint-radar-generated-api.lock pnpm --filter @workspace/api-spec run codegen

if [ -n "$(git status --porcelain -- $generated_paths)" ]; then
  echo "Generated API client files are out of date." >&2
  echo "Run pnpm --filter @workspace/api-spec run codegen and commit the generated outputs." >&2
  git status --short -- $generated_paths >&2
  exit 1
fi

# The web app tsconfig uses a project reference to lib/api-client-react, and
# `tsc -p --noEmit` resolves referenced projects through their emitted
# declaration files (dist/, which is gitignored). Build the shared libs first
# so the typecheck is reliable on a fresh checkout, not just a workspace where
# dist/ happens to exist (mirrors scripts/verify-api-server.sh).
#
# `tsc --build` decides whether a lib is up to date from its tsbuildinfo alone;
# it does not notice when dist/ was deleted out from under a still-present
# tsbuildinfo and would skip the emit. Drop the stale tsbuildinfo in that case
# so the libs are actually rebuilt.
for lib_dir in lib/*/; do
  if [ -f "${lib_dir}tsconfig.tsbuildinfo" ] && [ ! -d "${lib_dir}dist" ]; then
    rm -f "${lib_dir}tsconfig.tsbuildinfo"
  fi
done
pnpm run typecheck:libs
pnpm --filter @workspace/hookpoint-radar run typecheck
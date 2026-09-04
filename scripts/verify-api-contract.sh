#!/bin/sh

set -eu

generated_paths="
lib/api-client-react/src/generated
lib/api-zod/src/generated
"

pnpm --filter @workspace/api-spec run codegen

if [ -n "$(git status --porcelain -- $generated_paths)" ]; then
  echo "Generated API client files are out of date." >&2
  echo "Run pnpm --filter @workspace/api-spec run codegen and commit the generated outputs." >&2
  git status --short -- $generated_paths >&2
  exit 1
fi

pnpm --filter @workspace/hookpoint-radar run typecheck
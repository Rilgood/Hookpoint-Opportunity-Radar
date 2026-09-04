#!/bin/bash
set -e
pnpm install --frozen-lockfile
pnpm --filter db push
# Apply radar-core's schema and pending migrations to the development database.
# The publish flow copies the development schema to production, and the
# production API never runs DDL itself, so the dev database must be current
# even when the API Server workflow has not been started since the merge.
# radar tables live in their own Postgres schema ("radar"), so the Drizzle push
# above (which only manages "public") never touches them.
pnpm --filter @workspace/api-server run db:migrate

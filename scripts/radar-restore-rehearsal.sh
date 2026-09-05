#!/usr/bin/env bash

# Rehearses a backup and restore of the radar operational store.
#
# 1. Dumps the "radar" Postgres schema from the source database with pg_dump.
# 2. Restores the dump into a scratch database (an ephemeral local Postgres
#    started by this script, or SCRATCH_DATABASE_URL when the operator
#    provides one).
# 3. Compares per-table row counts between source and restored copy.
# 4. Builds the API host and starts it in production mode against the
#    restored copy, so the restored schema is *verified* against the checked-in
#    manifest exactly as the published service would (no DDL is run), and
#    checks /api/ready is 200 with storage_mode "postgres". The host runs with
#    an allowlisted environment and SCHEDULER_ENABLED=false, so no connector
#    can run against a live provider from the restored copy.
# 5. Reads the restored tenants and companies back through the API with a
#    throwaway bootstrap key and checks they match the restored tables.
# 6. Tears everything down (API process, restored schema or local scratch
#    Postgres, dump) unless asked to keep it, and writes a JSON report. The
#    restored copy never outlives the run by default, whichever target held it.
#
# The source database is never written to. See "Backup and recovery" in
# artifacts/api-server/radar-core/docs/DEPLOYMENT_AND_SECURITY.md for the
# runbook that wraps this script, including the production point-in-time
# restore path and the RPO/RTO it supports.
#
# Usage:
#   bash scripts/radar-restore-rehearsal.sh            # source = $DATABASE_URL
#
# Environment:
#   SOURCE_DATABASE_URL   Database to back up (default: DATABASE_URL).
#   RADAR_DB_SCHEMA       Schema holding the radar tables (default: radar).
#   SCRATCH_DATABASE_URL  Restore target. Must be a different database from the
#                         source and must not already contain the radar schema.
#                         Default: an ephemeral local Postgres under $TMPDIR.
#   ALLOW_ROW_COUNT_DRIFT When "true", a source/restore row-count mismatch is
#                         reported instead of failing (use for a live source
#                         that takes writes while the dump runs).
#   KEEP_SCRATCH          When "true", keep the restored copy: the local
#                         Postgres stays running, or the restored schema stays
#                         in SCRATCH_DATABASE_URL (the opt-in for seeding a
#                         second database). Default: the restored schema is
#                         dropped again on every exit, success or failure.
#   DUMP_FILE             Where to write the dump. Default: inside the work
#                         directory and deleted on every exit; set it to keep
#                         the dump (then treat the file as production data).
#   REPORT_FILE           Where to write the JSON report
#                         (default: <workdir>/report.json, printed at the end).

set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
api_server_dir="$root_dir/artifacts/api-server"
schema="${RADAR_DB_SCHEMA:-radar}"
source_url="${SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"
scratch_url="${SCRATCH_DATABASE_URL:-}"
allow_drift="${ALLOW_ROW_COUNT_DRIFT:-false}"
keep_scratch="${KEEP_SCRATCH:-false}"
started_epoch="$(date +%s)"
started_at="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

log() { printf '[restore-rehearsal] %s\n' "$*" >&2; }
fail() { log "FAIL: $*"; exit 1; }
redact() { printf '%s' "$1" | sed -E 's#://[^/@]*@#://***@#'; }
is_true() { case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in 1|true|yes|on) return 0 ;; *) return 1 ;; esac; }

for tool in pg_dump pg_restore psql node pnpm curl; do
  command -v "$tool" >/dev/null 2>&1 || fail "$tool is required on PATH"
done
[ -n "$source_url" ] || fail "set SOURCE_DATABASE_URL (or DATABASE_URL) to the Postgres database to back up"
case "$source_url" in postgres://*|postgresql://*) ;; *) fail "SOURCE_DATABASE_URL must be a postgres:// URL; the SQLite fallback is not covered by this rehearsal" ;; esac
case "$schema" in ''|*[!A-Za-z0-9_]*) fail "RADAR_DB_SCHEMA must be a simple identifier, got '$schema'" ;; esac
[ -f "$api_server_dir/package.json" ] || fail "expected $api_server_dir/package.json"
[ -n "${CLERK_SECRET_KEY:-}" ] || fail "CLERK_SECRET_KEY is required: the API host's session middleware refuses to start without it"

work_dir="$(mktemp -d "${TMPDIR:-/tmp}/radar-restore-rehearsal.XXXXXX")"
dump_file="${DUMP_FILE:-$work_dir/radar-${schema}.dump}"
report_file="${REPORT_FILE:-$work_dir/report.json}"
api_log="$work_dir/api.log"
api_pid=""
local_pgdata=""
scratch_external="false"
scratch_schema_restored="false"
step="setup"

drop_restored_schema() {
  # The API's worker-thread connection may take a moment to go away after the
  # process is killed; DROP SCHEMA waits on nothing else, so a short retry is
  # enough.
  local attempt
  for attempt in 1 2 3 4 5; do
    if sql "$scratch_url" "DROP SCHEMA IF EXISTS \"$schema\" CASCADE" >/dev/null 2>&1; then return 0; fi
    sleep 1
  done
  return 1
}

cleanup() {
  local status=$?
  if [ -n "$api_pid" ] && kill -0 "$api_pid" 2>/dev/null; then
    kill "$api_pid" 2>/dev/null || true
    wait "$api_pid" 2>/dev/null || true
  fi
  if is_true "$keep_scratch"; then
    if [ -n "$local_pgdata" ]; then
      log "KEEP_SCRATCH=true: scratch Postgres left running at $(redact "$scratch_url")"
      log "stop it later with: pg_ctl -D $local_pgdata -m fast stop && rm -rf $work_dir"
    elif [ "$scratch_schema_restored" = "true" ]; then
      log "KEEP_SCRATCH=true: restored schema \"$schema\" left in $(redact "$scratch_url"); drop it later with: DROP SCHEMA \"$schema\" CASCADE"
    fi
  else
    if [ -n "$local_pgdata" ]; then
      pg_ctl -D "$local_pgdata" -m fast -w stop >/dev/null 2>&1 || true
      rm -rf "$local_pgdata"
    elif [ "$scratch_external" = "true" ] && [ "$scratch_schema_restored" = "true" ]; then
      if drop_restored_schema; then
        log "dropped restored schema \"$schema\" from $(redact "$scratch_url")"
      else
        log "WARNING: could not drop schema \"$schema\" from $(redact "$scratch_url"); it still holds the restored copy, drop it by hand: DROP SCHEMA \"$schema\" CASCADE"
        [ "$status" -eq 0 ] && status=1
      fi
    fi
  fi
  # The dump is a copy of the source's data; it never outlives the run unless
  # the operator named a DUMP_FILE on purpose.
  if [ -z "${DUMP_FILE:-}" ]; then
    rm -f "$dump_file"
  fi
  # Row counts and API responses are copies of the source's data as well.
  rm -f "$work_dir/counts.source" "$work_dir/counts.scratch" "$work_dir/companies.json" "$work_dir/dashboard.json"
  if [ "$status" -ne 0 ]; then
    log "logs left in $work_dir (api log: $api_log)"
    log "rehearsal FAILED during step '$step' after $(( $(date +%s) - started_epoch ))s"
  fi
  exit "$status"
}
trap cleanup EXIT

sql() { # sql <url> <query>  -> rows, tab-separated, no header
  psql "$1" --no-psqlrc --quiet --tuples-only --no-align --field-separator=$'\t' --set ON_ERROR_STOP=1 -c "$2"
}

# Per-table exact counts for every base table in the radar schema, one
# "table<TAB>count" line each, sorted by table name.
table_counts() {
  local url="$1"
  local tables table
  tables="$(sql "$url" "SELECT table_name FROM information_schema.tables WHERE table_schema='$schema' AND table_type='BASE TABLE' ORDER BY table_name")"
  [ -n "$tables" ] || return 0
  local query="SELECT * FROM ("
  local first=1
  while IFS= read -r table; do
    [ -n "$table" ] || continue
    [ "$first" -eq 1 ] || query+=" UNION ALL "
    first=0
    query+="SELECT '$table' AS t, COUNT(*) AS c FROM \"$schema\".\"$table\""
  done <<< "$tables"
  query+=") x ORDER BY t"
  sql "$url" "$query"
}

# ---------------------------------------------------------------- source ----
step="inspect-source"
log "source: $(redact "$source_url") schema=$schema"
source_version="$(sql "$source_url" "SHOW server_version")"
source_schema_present="$(sql "$source_url" "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$schema'")"
[ "$source_schema_present" = "1" ] || fail "schema \"$schema\" does not exist in the source database; nothing to back up"
source_migration="$(sql "$source_url" "SELECT COALESCE(MAX(version), 0) FROM \"$schema\".schema_migrations" 2>/dev/null || echo 0)"
table_counts "$source_url" > "$work_dir/counts.source"
source_tables="$(wc -l < "$work_dir/counts.source" | tr -d ' ')"
source_rows="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$work_dir/counts.source")"
log "source server $source_version, schema_migrations at $source_migration, $source_tables tables, $source_rows rows"
[ "$source_tables" -gt 0 ] || fail "schema \"$schema\" has no tables in the source database"

# ------------------------------------------------------------------ dump ----
step="dump"
dump_started="$(date +%s)"
pg_dump --schema="$schema" --format=custom --no-owner --no-privileges --file="$dump_file" "$source_url"
dump_seconds=$(( $(date +%s) - dump_started ))
dump_bytes="$(wc -c < "$dump_file" | tr -d ' ')"
dump_sha256="$(sha256sum "$dump_file" | cut -d' ' -f1)"
log "dump written: $dump_file ($dump_bytes bytes, sha256 $dump_sha256, ${dump_seconds}s)"
pg_restore --list "$dump_file" >/dev/null || fail "pg_restore cannot read the dump it just wrote"

# --------------------------------------------------------------- scratch ----
step="scratch"
if [ -z "$scratch_url" ]; then
  command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1 \
    || fail "initdb/pg_ctl not found; set SCRATCH_DATABASE_URL to an empty scratch database instead"
  local_pgdata="$work_dir/pgdata"
  initdb -D "$local_pgdata" -U radar_restore --auth=trust --no-sync >"$work_dir/initdb.log" 2>&1 \
    || fail "initdb failed, see $work_dir/initdb.log"
  # Unix socket only: nothing else on the machine can reach it and no TCP
  # port can collide with the running API server workflow.
  pg_ctl -D "$local_pgdata" -w -l "$work_dir/postgres.log" \
    -o "-c listen_addresses='' -c unix_socket_directories='$work_dir' -c fsync=off -c full_page_writes=off" start >/dev/null \
    || fail "could not start the scratch Postgres, see $work_dir/postgres.log"
  sql "postgresql://radar_restore@/postgres?host=$work_dir" "CREATE DATABASE radar_restore" >/dev/null
  scratch_url="postgresql://radar_restore@/radar_restore?host=$work_dir"
  log "scratch: ephemeral local Postgres $(sql "$scratch_url" "SHOW server_version") at $work_dir"
else
  case "$scratch_url" in postgres://*|postgresql://*) ;; *) fail "SCRATCH_DATABASE_URL must be a postgres:// URL" ;; esac
  [ "$scratch_url" != "$source_url" ] || fail "SCRATCH_DATABASE_URL must not be the source database"
  source_identity="$(sql "$source_url" "SELECT system_identifier || ':' || current_database() FROM pg_control_system()")"
  scratch_identity="$(sql "$scratch_url" "SELECT system_identifier || ':' || current_database() FROM pg_control_system()")"
  [ "$source_identity" != "$scratch_identity" ] || fail "SCRATCH_DATABASE_URL resolves to the same database as the source"
  scratch_schema_present="$(sql "$scratch_url" "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$schema'")"
  [ "$scratch_schema_present" = "0" ] || fail "scratch database already has a \"$schema\" schema; drop it first (DROP SCHEMA \"$schema\" CASCADE) so the restore is proven from nothing"
  scratch_external="true"
  log "scratch: $(redact "$scratch_url") ($(sql "$scratch_url" "SHOW server_version"))"
fi

# --------------------------------------------------------------- restore ----
step="restore"
restore_started="$(date +%s)"
# From here on the scratch target may hold (part of) the copy; cleanup drops it.
scratch_schema_restored="true"
pg_restore --dbname="$scratch_url" --no-owner --no-privileges --exit-on-error --single-transaction "$dump_file" \
  || fail "pg_restore reported an error"
restore_seconds=$(( $(date +%s) - restore_started ))
table_counts "$scratch_url" > "$work_dir/counts.scratch"
restored_tables="$(wc -l < "$work_dir/counts.scratch" | tr -d ' ')"
restored_rows="$(awk -F'\t' '{ s += $2 } END { print s + 0 }' "$work_dir/counts.scratch")"
restored_migration="$(sql "$scratch_url" "SELECT COALESCE(MAX(version), 0) FROM \"$schema\".schema_migrations")"
log "restored in ${restore_seconds}s: $restored_tables tables, $restored_rows rows, schema_migrations at $restored_migration"

step="compare-row-counts"
row_count_drift="false"
if ! diff -u "$work_dir/counts.source" "$work_dir/counts.scratch" >"$work_dir/counts.diff"; then
  row_count_drift="true"
  log "row counts differ between source and restored copy:"
  sed 's/^/    /' "$work_dir/counts.diff" >&2
  if is_true "$allow_drift"; then
    log "ALLOW_ROW_COUNT_DRIFT=true: continuing (expected only when the source takes writes during the dump)"
  else
    fail "row counts differ (set ALLOW_ROW_COUNT_DRIFT=true only for a live source that is being written to)"
  fi
else
  log "row counts match for every table"
fi
[ "$restored_migration" = "$source_migration" ] || fail "schema_migrations version differs: source $source_migration, restored $restored_migration"

# Baseline before the API touches the copy: its bootstrap seeds the default
# tenant and connector catalog rows when they are missing, which must not be
# mistaken for restored data.
restored_tenants="$(sql "$scratch_url" "SELECT COUNT(*) FROM \"$schema\".tenants")"
restored_companies="$(sql "$scratch_url" "SELECT COUNT(*) FROM \"$schema\".companies")"
restored_tenant_rows="$(sql "$scratch_url" "SELECT t.id || E'\t' || t.name || E'\t' || (SELECT COUNT(*) FROM \"$schema\".companies c WHERE c.tenant_id=t.id) FROM \"$schema\".tenants t ORDER BY t.id")"

# ------------------------------------------------------------- api build ----
step="build-api"
(cd "$root_dir" && pnpm --filter @workspace/api-server run build >"$work_dir/build.log" 2>&1) \
  || fail "API build failed, see $work_dir/build.log"
[ -f "$api_server_dir/dist/index.mjs" ] || fail "build produced no dist/index.mjs"

# ------------------------------------------------------------- api start ----
step="start-api"
api_port="$(node -e "const s=require('net').createServer();s.listen(0,'127.0.0.1',()=>{console.log(s.address().port);s.close()})")"
# Throwaway credentials that satisfy the production gate. The bootstrap key is
# written to the *scratch* copy only.
rehearsal_admin_key="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
rehearsal_hash_salt="$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")"
default_tenant_id="${DEFAULT_TENANT_ID:-tenant_hookpoint}"

(
  cd "$api_server_dir"
  # Production mode: the core verifies the restored schema against
  # src/db/schema-manifest.js and refuses readiness instead of repairing it.
  #
  # The child gets an allowlisted environment, not the caller's: the host
  # starts an in-process connector scheduler by default, and a production
  # derived copy has real connector rows, so inherited provider credentials
  # would let the drill call live third-party APIs. The scheduler is switched
  # off explicitly as well, so the copy is not mutated while it is checked.
  # Clerk keys are passed through only because the host's session middleware
  # refuses to start without them; nothing in the drill uses a browser session.
  env -i \
    PATH="$PATH" HOME="$HOME" TMPDIR="${TMPDIR:-/tmp}" \
    NODE_ENV=production \
    PORT="$api_port" HOST=127.0.0.1 \
    DATABASE_URL="$scratch_url" \
    RADAR_DB_SCHEMA="$schema" \
    SCHEDULER_ENABLED=false \
    AUTH_REQUIRED=true \
    DEFAULT_TENANT_ID="$default_tenant_id" \
    ADMIN_API_KEY="$rehearsal_admin_key" \
    HASH_SALT="$rehearsal_hash_salt" \
    ALLOWED_ORIGINS="https://restore-rehearsal.invalid" \
    TRUST_PROXY=false \
    LOG_LEVEL="${LOG_LEVEL:-info}" \
    CLERK_SECRET_KEY="${CLERK_SECRET_KEY:-}" \
    CLERK_PUBLISHABLE_KEY="${CLERK_PUBLISHABLE_KEY:-}" \
    node --enable-source-maps ./dist/index.mjs >"$api_log" 2>&1
) &
api_pid=$!

base_url="http://127.0.0.1:$api_port"
for _ in $(seq 1 60); do
  if ! kill -0 "$api_pid" 2>/dev/null; then
    sed 's/^/    /' "$api_log" >&2
    fail "API process exited before it became reachable"
  fi
  if curl --silent --fail --max-time 2 "$base_url/api/healthz" >/dev/null 2>&1; then break; fi
  sleep 0.5
done
curl --silent --fail --max-time 2 "$base_url/api/healthz" >/dev/null 2>&1 || { sed 's/^/    /' "$api_log" >&2; fail "API did not answer /api/healthz within 30s"; }

# -------------------------------------------------------------- readiness ----
step="readiness"
ready_body="$work_dir/ready.json"
ready_status="$(curl --silent --output "$ready_body" --write-out '%{http_code}' --max-time 10 "$base_url/api/ready")"
ready_summary="$(node -e '
  const body = JSON.parse(require("fs").readFileSync(process.argv[1], "utf8"));
  const data = body.data || body;
  console.log(JSON.stringify({ status: data.status, storage_mode: data.storage_mode, schema_version: data.schema_version, issues: (data.issues || []).map((i) => `${i.severity}:${i.code}`) }));
' "$ready_body")"
log "/api/ready -> $ready_status $ready_summary"
[ "$ready_status" = "200" ] || { sed 's/^/    /' "$api_log" >&2; fail "/api/ready returned $ready_status against the restored copy"; }
ready_storage_mode="$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((b.data||b).storage_mode)' "$ready_body")"
[ "$ready_storage_mode" = "postgres" ] || fail "/api/ready reports storage_mode '$ready_storage_mode', expected 'postgres'"
ready_schema_version="$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((b.data||b).schema_version)' "$ready_body")"
[ "$ready_schema_version" = "$source_migration" ] || fail "/api/ready reports schema_version $ready_schema_version, source was at $source_migration"

# ------------------------------------------------------- restored data ----
step="read-restored-data"
tenants_after_boot="$(sql "$scratch_url" "SELECT COUNT(*) FROM \"$schema\".tenants")"
[ "$tenants_after_boot" -ge "$restored_tenants" ] || fail "tenant rows disappeared after the API started ($restored_tenants -> $tenants_after_boot)"
# The API answers per tenant; walk every restored tenant through the API with
# the bootstrap key for the default tenant and a direct query for the rest,
# then check the company totals it reports against the restored tables.
api_companies_total=""
api_checked_tenants=0
while IFS=$'\t' read -r tenant_id tenant_name tenant_companies; do
  [ -n "$tenant_id" ] || continue
  if [ "$tenant_id" = "$default_tenant_id" ]; then
    companies_body="$work_dir/companies.json"
    companies_status="$(curl --silent --output "$companies_body" --write-out '%{http_code}' --max-time 10 \
      -H "X-API-Key: $rehearsal_admin_key" "$base_url/api/v1/companies?limit=1")"
    [ "$companies_status" = "200" ] || { sed 's/^/    /' "$companies_body" >&2; fail "GET /api/v1/companies returned $companies_status for tenant $tenant_id"; }
    api_companies_total="$(node -e 'const b=JSON.parse(require("fs").readFileSync(process.argv[1],"utf8"));console.log((b.data||b).total)' "$companies_body")"
    [ "$api_companies_total" = "$tenant_companies" ] || fail "API lists $api_companies_total companies for $tenant_id, restored table holds $tenant_companies"
    dashboard_status="$(curl --silent --output "$work_dir/dashboard.json" --write-out '%{http_code}' --max-time 10 \
      -H "X-API-Key: $rehearsal_admin_key" "$base_url/api/v1/dashboard")"
    [ "$dashboard_status" = "200" ] || fail "GET /api/v1/dashboard returned $dashboard_status"
    log "tenant $tenant_id ($tenant_name): API lists $api_companies_total companies, matches restored copy"
    api_checked_tenants=$((api_checked_tenants + 1))
  else
    log "tenant $tenant_id ($tenant_name): $tenant_companies companies in the restored copy (not the bootstrap tenant; no API key available for it)"
  fi
done <<< "$restored_tenant_rows"
if [ "$restored_tenants" -gt 0 ] && [ "$api_checked_tenants" -eq 0 ]; then
  fail "none of the restored tenants is DEFAULT_TENANT_ID ($default_tenant_id); set DEFAULT_TENANT_ID to one of: $(printf '%s' "$restored_tenant_rows" | cut -f1 | tr '\n' ' ')"
fi
if [ "$restored_tenants" -eq 0 ]; then
  log "the source held no tenants; the API bootstrapped $default_tenant_id into the scratch copy only"
fi

# ---------------------------------------------------------------- report ----
step="report"
kill "$api_pid" 2>/dev/null || true
wait "$api_pid" 2>/dev/null || true
api_pid=""
total_seconds=$(( $(date +%s) - started_epoch ))
R_COUNTS_FILE="$work_dir/counts.scratch" R_REPORT_FILE="$report_file" \
  R_STARTED_AT="$started_at" R_TOTAL_SECONDS="$total_seconds" \
  R_SOURCE_URL="$(redact "$source_url")" R_SOURCE_VERSION="$source_version" R_SCHEMA="$schema" \
  R_SOURCE_MIGRATION="$source_migration" R_SOURCE_TABLES="$source_tables" R_SOURCE_ROWS="$source_rows" \
  R_DUMP_FILE="$dump_file" R_DUMP_BYTES="$dump_bytes" R_DUMP_SHA256="$dump_sha256" R_DUMP_SECONDS="$dump_seconds" \
  R_SCRATCH_URL="$(redact "$scratch_url")" R_RESTORE_SECONDS="$restore_seconds" R_RESTORED_TABLES="$restored_tables" R_RESTORED_ROWS="$restored_rows" \
  R_ROW_COUNT_DRIFT="$row_count_drift" R_READY_STATUS="$ready_status" R_READY_SUMMARY="$ready_summary" \
  R_RESTORED_TENANTS="$restored_tenants" R_RESTORED_COMPANIES="$restored_companies" R_API_COMPANIES="$api_companies_total" \
node -e '
  const env = process.env;
  const out = env.R_REPORT_FILE, countsFile = env.R_COUNTS_FILE;
  const counts = Object.fromEntries(require("fs").readFileSync(countsFile, "utf8").trim().split("\n").filter(Boolean).map((l) => { const [t, c] = l.split("\t"); return [t, Number(c)]; }));
  const report = {
    rehearsal: "radar-restore",
    started_at: env.R_STARTED_AT,
    finished_at: new Date().toISOString(),
    duration_seconds: Number(env.R_TOTAL_SECONDS),
    source: { url: env.R_SOURCE_URL, server_version: env.R_SOURCE_VERSION, schema: env.R_SCHEMA, schema_migrations_version: Number(env.R_SOURCE_MIGRATION), tables: Number(env.R_SOURCE_TABLES), rows: Number(env.R_SOURCE_ROWS) },
    dump: { file: env.R_DUMP_FILE, format: "custom", bytes: Number(env.R_DUMP_BYTES), sha256: env.R_DUMP_SHA256, seconds: Number(env.R_DUMP_SECONDS) },
    restore: { target: env.R_SCRATCH_URL, seconds: Number(env.R_RESTORE_SECONDS), tables: Number(env.R_RESTORED_TABLES), rows: Number(env.R_RESTORED_ROWS), row_counts: counts, row_count_drift: env.R_ROW_COUNT_DRIFT === "true" },
    api: { mode: "production", ready_status: Number(env.R_READY_STATUS), ready: JSON.parse(env.R_READY_SUMMARY), restored_tenants: Number(env.R_RESTORED_TENANTS), restored_companies: Number(env.R_RESTORED_COMPANIES), companies_listed_for_default_tenant: env.R_API_COMPANIES === "" ? null : Number(env.R_API_COMPANIES) },
    result: "passed"
  };
  require("fs").writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report, null, 2));
'
log "PASSED in ${total_seconds}s; report at $report_file"

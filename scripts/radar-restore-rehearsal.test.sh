#!/usr/bin/env bash

# Integration test for scripts/radar-restore-rehearsal.sh against an external
# scratch database (SCRATCH_DATABASE_URL), the path that holds a copy of real
# data on a real server. It proves the retention semantics the runbook
# promises:
#
#   1. default run  -> passes, and the restored "radar" schema is gone afterwards
#   2. KEEP_SCRATCH -> passes, and the restored schema (with its rows) remains
#   3. rerun into that non-empty scratch -> refused before anything is restored
#   4. a failure after the restore -> the restored schema is still dropped
#
# It creates a throwaway database on the server behind DATABASE_URL (the
# workspace role may CREATE DATABASE) and drops it at the end.
#
# Usage: pnpm run db:restore-rehearsal:test   (needs DATABASE_URL, CLERK_SECRET_KEY)

set -euo pipefail

root_dir="$(cd "$(dirname "$0")/.." && pwd)"
drill="$root_dir/scripts/radar-restore-rehearsal.sh"
source_url="${SOURCE_DATABASE_URL:-${DATABASE_URL:-}}"
schema="${RADAR_DB_SCHEMA:-radar}"

log() { printf '[restore-rehearsal-test] %s\n' "$*" >&2; }
fail() { log "FAIL: $*"; exit 1; }
sql() { psql "$1" --no-psqlrc --quiet --tuples-only --no-align --set ON_ERROR_STOP=1 -c "$2"; }

[ -n "$source_url" ] || fail "set DATABASE_URL (or SOURCE_DATABASE_URL)"
[ -f "$drill" ] || fail "missing $drill"

test_db="radar_restore_test_$(node -e "console.log(require('crypto').randomBytes(4).toString('hex'))")"
# Same server, different database: swap the path component of the URL.
scratch_url="$(printf '%s' "$source_url" | sed -E "s#^(postgres(ql)?://[^/]+/)[^?]*#\\1${test_db}#")"
[ "$scratch_url" != "$source_url" ] || fail "could not derive a scratch URL from the source URL"

cleanup() {
  local status=$?
  sql "$source_url" "SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname='$test_db' AND pid<>pg_backend_pid()" >/dev/null 2>&1 || true
  for _ in 1 2 3 4 5; do
    if sql "$source_url" "DROP DATABASE IF EXISTS \"$test_db\"" >/dev/null 2>&1; then break; fi
    sleep 1
  done
  rm -rf "${tmp:-}"
  [ "$status" -eq 0 ] && log "PASSED" || log "FAILED"
}
trap cleanup EXIT

tmp="$(mktemp -d "${TMPDIR:-/tmp}/radar-restore-rehearsal-test.XXXXXX")"
sql "$source_url" "CREATE DATABASE \"$test_db\"" >/dev/null
log "scratch database $test_db created"

schema_present() { sql "$scratch_url" "SELECT COUNT(*) FROM information_schema.schemata WHERE schema_name='$schema'"; }
source_companies="$(sql "$source_url" "SELECT COUNT(*) FROM \"$schema\".companies")"
source_tenants="$(sql "$source_url" "SELECT COUNT(*) FROM \"$schema\".tenants")"

run_drill() { # run_drill <logfile> [ENV=value ...]; returns the drill's exit status
  local logfile="$1"; shift
  local status=0
  env "$@" SCRATCH_DATABASE_URL="$scratch_url" REPORT_FILE="$tmp/report.json" bash "$drill" >"$logfile" 2>&1 || status=$?
  return $status
}

# 1. default run: passes and leaves nothing behind
log "case 1: default cleanup"
run_drill "$tmp/case1.log" || { cat "$tmp/case1.log" >&2; fail "default drill run failed"; }
grep -q '"result": "passed"' "$tmp/report.json" || fail "report does not say passed"
[ "$(schema_present)" = "0" ] || fail "schema \"$schema\" still present in the scratch database after a default run"
grep -q "dropped restored schema" "$tmp/case1.log" || fail "drill did not report dropping the restored schema"
log "case 1 ok: restored schema dropped after success"

# 2. KEEP_SCRATCH=true: passes and the copy remains
log "case 2: KEEP_SCRATCH=true retention"
run_drill "$tmp/case2.log" KEEP_SCRATCH=true || { cat "$tmp/case2.log" >&2; fail "KEEP_SCRATCH drill run failed"; }
[ "$(schema_present)" = "1" ] || fail "schema \"$schema\" missing from the scratch database although KEEP_SCRATCH=true"
kept_companies="$(sql "$scratch_url" "SELECT COUNT(*) FROM \"$schema\".companies")"
[ "$kept_companies" = "$source_companies" ] || fail "kept copy holds $kept_companies companies, source $source_companies"
log "case 2 ok: restored schema kept with $kept_companies companies"

# 3. rerun into the non-empty scratch: refused before any restore
log "case 3: refuse a non-empty scratch"
if run_drill "$tmp/case3.log"; then fail "drill accepted a scratch database that already holds \"$schema\""; fi
grep -q "already has a \"$schema\" schema" "$tmp/case3.log" || { cat "$tmp/case3.log" >&2; fail "unexpected failure reason for a non-empty scratch"; }
[ "$(sql "$scratch_url" "SELECT COUNT(*) FROM \"$schema\".companies")" = "$kept_companies" ] || fail "refused run touched the kept copy"
sql "$scratch_url" "DROP SCHEMA \"$schema\" CASCADE" >/dev/null
log "case 3 ok: refused, kept copy untouched"

# 4. failure after the restore still drops the copy
if [ "$source_tenants" -gt 0 ]; then
  log "case 4: cleanup after a post-restore failure"
  if run_drill "$tmp/case4.log" DEFAULT_TENANT_ID="tenant_does_not_exist_$$"; then fail "drill passed with a DEFAULT_TENANT_ID that is not in the restored copy"; fi
  # The unknown tenant breaks the run only once the copy is restored (the host
  # cannot bootstrap a key for it, or the tenant walk finds no match), which is
  # the case that matters: cleanup after data has landed in the scratch target.
  grep -Eq "rehearsal FAILED during step '(start-api|readiness|read-restored-data)'" "$tmp/case4.log" \
    || { cat "$tmp/case4.log" >&2; fail "expected the failure after the restore step"; }
  [ "$(schema_present)" = "0" ] || fail "schema \"$schema\" left behind after a failed run"
  log "case 4 ok: restored schema dropped after failure"
else
  log "case 4 skipped: source holds no tenants, so the post-restore failure cannot be provoked"
fi

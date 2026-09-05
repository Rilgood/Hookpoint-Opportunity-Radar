#!/bin/sh

# Single entry point for every release gate: `pnpm run verify:release`.
#
# Runs the registered checks in a fixed order (cheapest first, slowest last)
# and stops at the first failure, naming the check that failed so nobody has
# to scroll back through the combined log. Add new release gates to
# `release_checks` below (and register them as their own `verify:*` script and
# validation step) so they can never be forgotten before publishing.
#
# The browser smoke gate needs CLERK_SECRET_KEY to mint a Clerk sign-in ticket.
# When that secret is genuinely absent (a fork without secrets), the gate is
# skipped with a loud SKIPPED line instead of failing, and the summary at the
# end repeats which checks did not run. It is never skipped silently.
# The preflight gate tests the checker itself; inspecting real deployment
# settings is the separate `pnpm run preflight:production` command.

set -u

release_checks="production-preflight api-contract api-server radar-core production-rehearsal browser-smoke"

summary=""
started_at=$(date +%s)

banner() {
  printf '\n==> verify:release: %s\n' "$1"
}

record() {
  summary="${summary}
  $1"
}

elapsed_since() {
  echo $(( $(date +%s) - $1 ))
}

should_skip() {
  case "$1" in
    browser-smoke)
      if [ -z "${CLERK_SECRET_KEY:-}" ]; then
        skip_reason="CLERK_SECRET_KEY is not set, so the authenticated browser journey cannot sign in. This is expected on a fork without secrets; in the release workspace it means the gate did NOT run."
        return 0
      fi
      ;;
  esac
  return 1
}

for check in $release_checks; do
  if should_skip "$check"; then
    banner "SKIPPED $check"
    echo "verify:release: SKIPPED $check -- $skip_reason" >&2
    record "SKIPPED  $check ($skip_reason)"
    continue
  fi

  banner "running $check (pnpm run verify:$check)"
  check_started_at=$(date +%s)

  if pnpm run "verify:$check"; then
    echo "verify:release: PASSED $check in $(elapsed_since "$check_started_at")s"
    record "PASSED   $check ($(elapsed_since "$check_started_at")s)"
    if [ "$check" = "radar-core" ] && [ -z "${DATABASE_URL:-}" ]; then
      record "SKIPPED  radar-core-postgres (DATABASE_URL is not set; the SQLite pass does not verify PostgreSQL)"
    fi
  else
    status=$?
    record "FAILED   $check (exit $status, $(elapsed_since "$check_started_at")s)"
    banner "FAILED $check"
    echo "verify:release: check '$check' failed with exit code $status; remaining checks were not run." >&2
    echo "verify:release: re-run it alone with: pnpm run verify:$check" >&2
    printf 'verify:release summary:%s\n' "$summary" >&2
    exit "$status"
  fi
done

banner "all release checks finished in $(elapsed_since "$started_at")s"
printf 'verify:release summary:%s\n' "$summary"

case "$summary" in
  *SKIPPED*)
    echo "verify:release: at least one check was SKIPPED (see summary). The release is only fully verified where every check PASSED." >&2
    ;;
esac

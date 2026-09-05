#!/bin/sh
set -eu

# Linux release workers serialize Orval and browser builds. macOS does not
# include flock; release checks already run sequentially there.
if command -v flock >/dev/null 2>&1; then
  exec flock /tmp/hookpoint-radar-generated-api.lock "$@"
fi

echo 'Generated API lock: flock is unavailable; run code generation and browser checks sequentially.' >&2
exec "$@"

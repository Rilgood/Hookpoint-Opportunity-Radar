---
name: Radar restore drill
description: Constraints the backup/restore rehearsal must keep so it proves a restore rather than repairing one, and why it isolates the API it launches.
---

# Restore drill for the radar Postgres store

**Rule:** the rehearsal restores the dump into a database that starts empty
and launches the API in production mode, with an allowlisted environment and
the scheduler off. Do not relax any of the three.

**Why:**
- Outside production the core applies schema and migrations on open, so a
  dump missing a table or index would be silently repaired and the drill would
  pass anyway; production mode only verifies against the manifest and refuses
  readiness, which is the failure the drill exists to surface.
- A production-derived copy carries real connector rows. The host starts an
  in-process scheduler by default, so inherited provider credentials would let
  a drill call live third-party APIs and mutate the copy mid-check.
- Restoring from nothing is what makes the source/restore row-count comparison
  meaningful; compare before the API starts, because its bootstrap seeds the
  default tenant, key and connector catalog.

**How to apply:** an ephemeral local Postgres (initdb is on the workspace
PATH) on a Unix socket is the default scratch target and avoids port and
schema collisions; a scratch database on the managed server also works. The
runbook's dated drill log is the go-live evidence, and the written RPO/RTO
lean on platform point-in-time restore plus a republish when the restore point
predates a schema-changing publish.

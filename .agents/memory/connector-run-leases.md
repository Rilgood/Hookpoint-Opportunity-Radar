---
name: Connector run leases
description: Why connector runs are fenced by a clock-only database lease, and the constraints that must hold when changing runConnector, ingestion, or connector status writes.
---

# Connector run leases

**Rule:** a connector run may only write to its connector row while it holds an *unexpired* lease, and expiry is decided by the clock alone: a holder cannot renew or close a lease once `lease_expires_at` has passed, even if no other instance has recovered it yet.

**Why:** autoscale instances share nothing but the database, and an earlier in-memory guard let two instances double-ingest the same due connector. Making expiry clock-only (rather than "whoever reaches the row first") keeps the `abandoned` verdict deterministic and testable; a stalled holder that wakes late must lose, never revive.

**How to apply:**
- Ingestion is synchronous and blocks the event loop, so timer-based heartbeats cannot cover it; any long synchronous phase inside a run must renew/check the lease at bounded points and abort on loss (already ingested records are left in place; dedup handles the re-run).
- `CONNECTOR_LEASE_MS` must stay well above one provider request plus retries; readiness enforces >= 2x `CONNECTOR_TIMEOUT_MS`.
- Recovery deliberately sweeps every `running` run of the connector, not just the leased one, because pre-lease legacy rows exist; the invariant is one live run per connector.
- Reviewers rejected a version that fenced only the provider call and only checked `lease_token` (not expiry) on the closing write; keep both fences when refactoring.

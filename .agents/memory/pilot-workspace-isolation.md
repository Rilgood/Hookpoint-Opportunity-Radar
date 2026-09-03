---
name: Pilot workspace isolation
description: Why the initial external pilot uses private per-user workspaces instead of implicit shared tenants.
---

The initial pilot must derive one private workspace from each verified user identity. Do not infer shared access from email domains or trust client-provided tenant or role headers. Add team sharing only through explicit workspace membership and roles.

**Why:** The pilot includes internal and external participants, but no collaboration model or support-access policy has been defined. Per-user isolation prevents accidental cross-customer exposure while those decisions remain open.

**How to apply:** Preserve private defaults when changing authentication or tenancy. Any shared-workspace feature must define invitations, owner/operator/read-only roles, and auditable internal support access before allowing multiple users into one tenant.
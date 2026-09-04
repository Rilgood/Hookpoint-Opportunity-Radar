---
name: Workspace test tooling
description: Adding shared development dependencies to this pnpm workspace.
---

The managed package installer cannot add a package to the pnpm workspace root because pnpm requires an explicit root acknowledgement.

**Why:** Root developer dependencies such as test runners are intentionally shared across workspace packages, but the managed installer does not expose pnpm's workspace-root option.

**How to apply:** When shared tooling is needed, add it explicitly at the workspace root rather than duplicating it across artifacts.
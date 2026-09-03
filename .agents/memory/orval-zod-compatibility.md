---
name: Orval and Zod compatibility
description: Compatibility constraint between current OpenAPI generation and the workspace Zod version.
---

The current Orval generator emits Zod 4 root helpers for some OpenAPI formats, including integer and URI schemas, while the workspace validator library resolves Zod 3.

**Why:** Code generation succeeds, but the chained library typecheck fails on missing helpers such as `z.int()` and `z.url()`. This can make an otherwise valid contract change look like a broad set of unrelated TypeScript errors.

**How to apply:** When extending the OpenAPI contract, either keep generated schemas compatible with Zod 3 or upgrade only the generated validator package to a compatible Zod 4 setup. Treat a cluster of missing Zod root-helper errors as one version mismatch.
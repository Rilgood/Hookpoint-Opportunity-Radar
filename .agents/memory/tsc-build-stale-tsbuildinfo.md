---
name: tsc --build skips emit when dist is deleted
description: Why shared-lib dist folders can stay missing even after running typecheck:libs, and how the verify scripts guard against it.
---
Rule: never assume `tsc --build` (typecheck:libs) recreates `lib/*/dist`. TS 5.6+ judges "up to date" from `lib/*/tsconfig.tsbuildinfo` alone (the tsbuildinfo lives next to tsconfig, not in dist). If dist/ was deleted but the tsbuildinfo survived, `tsc --build` reports up to date and emits nothing, and downstream `tsc -p --noEmit` in artifacts fails with TS6305 "Output file ... has not been built from source file".

**Why:** discovered while making verify-api-contract reliable — deleting lib/api-client-react/dist alone did not trigger a rebuild; both dist and *.tsbuildinfo are gitignored, so a truly fresh clone is fine, but a partially cleaned workspace is not.

**How to apply:** release/verify scripts that depend on lib dist should drop any `lib/*/tsconfig.tsbuildinfo` whose sibling `dist/` is missing before running typecheck:libs (see scripts/verify-api-contract.sh), or use `tsc --build --force` (~5s). verify-api-server.sh currently lacks this guard.

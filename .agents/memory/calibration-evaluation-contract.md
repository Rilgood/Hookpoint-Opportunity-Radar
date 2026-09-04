---
name: Calibration evaluation contract
description: The score-calibration evaluate endpoint reports guardrail outcomes as a 200 "blocked" body, not as error codes; the dashboard must interpret guardrails counts.
---
Guardrail outcomes of the holdout evaluation (too few held-out labels, too few training labels, missing score snapshots, no AUC lift) are returned as a successful response with status "blocked" and a guardrails object of counts. Only permission (403 insufficient_scope), rate limiting (429 rate_limited) and generic failures arrive as error envelopes. There is no holdout_unavailable error code on the server, even though earlier plans and a UI test assumed one.

**Why:** A first attempt mapped only error-envelope codes; the code review rejected it because the "not enough labels" explanation was unreachable against the real API.

**How to apply:** When adding operator-facing explanations for the evaluate flow, derive the cause from the blocked response's guardrails (compare holdout/training counts to their minimums, check scored_* fields, check for before/after metrics) and pin the shape with a radar-core test plus a fixture copied from real server output. Verify any error code named in a plan actually exists in radar-core before mapping it.

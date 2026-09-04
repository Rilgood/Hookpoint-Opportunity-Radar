---
name: Outcome cohort analytics must respect label time
description: Rule for any Radar statistic that joins signals/observations/sources to outcome labels.
---

Any cohort statistic that attributes an outcome label to a signal, source, or segment must only use evidence observed on or before the account's earliest calibration label (`first_seen_at`/`observed_at` <= label `occurred_at`).

**Why:** The first insight implementation counted post-outcome signals as comparables and post-label observations as source attribution, and the timing metric reported 0 days for accounts whose first signal arrived after they converted (because `daysBetween` clamps negatives to zero). Code review caught it; a regression test now covers it.

**How to apply:** When adding any new "signal effectiveness", "comparable accounts", "source ROI", or time-to-outcome analytic, filter evidence by label time first and exclude (do not zero) accounts with no pre-label evidence. Also: tests that record two outcomes without explicit `occurred_at` are order-flaky because the earliest-label rule tie-breaks on id.

---
name: "steadyspec: archive"
description: "SteadySpec archive verb - close a change with no silent close, five gates all must pass"
category: Workflow
tags: [steadyspec, archive, workflow]
---

SteadySpec archive verb. Runs five gates in order, each must pass before the archive is written:

1. `review-against-intent` — implementation must match what the proposal promised
2. `doc-sync` auto-scan — must-update docs must be updated; should-check docs prompt the user
3. `confirmed_by` gate — any human-decision-records linked to this change must have human confirmation
4. completeness - every archive.md field must trace to real artifact source; partial archives are not created here
5. durable truth gates - citation anchors resolve, risk misclassification is caught, and fallback/debt is not turned into proof

If any gate fails, archive does not write and the verb reports what blocked. After gates pass, checks the rollup trigger (3 or more of the last 10 archived mention same module/keyword); if so, surfaces strategy-rollup and may auto-run per your standing preference.

---

For docs substrate, run `steadyspec check <change-id-or-path> --phase archive --substrate docs` after writing `archive.md` and before moving/closing the change. If it fails, leave the change active and report the checker errors.

---

**Input:** the argument after `/steadyspec:archive` is the change-id. If absent, archive-flow asks.

Follow the steps in the `steadyspec-archive-flow` SKILL.md exactly.

---
name: "steadyspec: apply"
description: "SteadySpec apply verb - implement slice-by-slice with proof-linked decisions and explicit re-slice events"
category: Workflow
tags: [steadyspec, apply, workflow]
---

SteadySpec apply verb. Loops slice-by-slice with TDD discipline (vertical slices via tracer bullets, no refactor while RED, no anticipating next slice, refactor only after all GREEN). TDD is the special case where the proof signal is an automated test; manual checks / fixture replay / runtime observation also count. Proofs are linked to decision ledger entries. Drift and re-slicing are recorded explicitly; re-slicing that changes scope, proof strategy, or user-visible outcome routes to the user.

---

For docs substrate, run `steadyspec check <change-id-or-path> --phase apply --substrate docs` after updating evidence and report the result.

---

**Input:** the argument after `/steadyspec:apply` is the change-id in your substrate (e.g. `099-unify-session-timeout` for OpenSpec, `001-improve-logging` for plain docs/changes). If absent, apply-flow asks for it.

Follow the steps in the `steadyspec-apply-flow` SKILL.md exactly.

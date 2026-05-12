---
name: "steadyspec: apply"
description: "SteadySpec apply verb — implement a recorded change slice-by-slice with proof-gated execution, pause on drift with four options"
category: Workflow
tags: [steadyspec, apply, workflow]
---

SteadySpec apply verb. Loops slice-by-slice with TDD discipline (vertical slices via tracer bullets, no refactor while RED, no anticipating next slice, refactor only after all GREEN). TDD is the special case where the proof signal is an automated test; manual checks / fixture replay / runtime observation also count. Detects drift between intent and implementation; on drift, pauses and offers four options (in-place patch / accept as known-limitation / revert this slice / STOP and open new change).

---

**Input:** the argument after `/steadyspec:apply` is the change-id in your substrate (e.g. `099-unify-session-timeout` for OpenSpec, `001-improve-logging` for plain docs/changes). If absent, apply-flow asks for it.

Follow the steps in the `steadyspec-apply-flow` SKILL.md exactly.

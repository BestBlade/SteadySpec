---
name: "steadyspec: propose"
description: "SteadySpec propose verb - write a proposal with decision ledger, risk routing, and attention report"
category: Workflow
tags: [steadyspec, propose, workflow]
---

SteadySpec propose verb. Treats the prompt as source material and records a delegation boundary: Authorized Outcome, Hard Constraints, Challengeable Assumptions, Proposed Means, Delegated Decisions, structured Challenge Resolution authority rows, and Delegation Status. Outcome/constraint changes require a concrete human-decision or prior-delegation reference in change-relative `path.md#markdown-anchor` form; read back the target and heading, with deterministic docs enforcement. Agent ownership cannot self-authorize them. It challenges assumptions and means without silently rewriting human-owned outcome or constraints, then runs history/grill/conditional debate and records decision/risk/attention evidence. It recommends `/steadyspec:apply` only when delegation is concretely ready.

Before writing context, grill, debate, or proposal artifacts, run the exact
code-derived `steadyspec delegation-path-check` preflight. A non-zero result,
identity mismatch, or linked/junction path component blocks every write.

On every substrate, run `steadyspec delegation-check --change <repo-relative-change-path> --phase proposal --json` after writing and do not recommend apply on non-zero. This is direct structural readback, not semantic truth or human acceptance.

For docs substrate, run `steadyspec check <change-id-or-path> --phase proposal --substrate docs` after writing the proposal and report the result.

---

**Input:** the argument after `/steadyspec:propose` is the user's own short statement of what this change is about (the intent string). If absent, propose-flow asks for it before continuing.

Follow the steps in the `steadyspec-propose-flow` SKILL.md exactly.

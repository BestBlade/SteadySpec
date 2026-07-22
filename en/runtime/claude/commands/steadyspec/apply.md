---
name: "steadyspec: apply"
description: "SteadySpec apply verb - implement slice-by-slice with proof-linked decisions and explicit re-slice events"
category: Workflow
tags: [steadyspec, apply, workflow]
---

SteadySpec apply verb. Requires concrete ready delegation before code: Authorized Outcome, Hard Constraints, Challengeable Assumptions, Proposed Means, Delegated Decisions, and structured challenge authority references in change-relative `path.md#markdown-anchor` form whose targets/headings are read back. Placeholder, unresolved, Agent-self-authorized outcome/constraint, malformed reference, or unbound delegation states block. Assumptions and means may change only within delegation; Authorized Outcome or Hard Constraints require explicit human decision or concrete prior delegation. Then it loops slice-by-slice with proof/TDD discipline and records drift/re-slicing.

On every substrate, run `steadyspec delegation-check --change <repo-relative-change-path> --phase apply --json` before implementation and stop on non-zero. It is direct structural artifact readback, not semantic proof or human acceptance.

---

For docs substrate, run `steadyspec check <change-id-or-path> --phase apply --substrate docs` after updating evidence and report the result.

---

**Input:** the argument after `/steadyspec:apply` is the change-id in your substrate (e.g. `099-unify-session-timeout` for OpenSpec, `001-improve-logging` for plain docs/changes). If absent, apply-flow asks for it.

Follow the steps in the `steadyspec-apply-flow` SKILL.md exactly.

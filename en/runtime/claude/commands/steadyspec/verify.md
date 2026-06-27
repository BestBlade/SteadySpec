---
name: "steadyspec: verify"
description: "SteadySpec verify verb - run a trust checkpoint before archive, handoff, or risky continuation"
category: Workflow
tags: [steadyspec, verify, workflow, trust-checkpoint]
---

SteadySpec verify verb. Runs a trust checkpoint without archiving:

1. output-vs-intent review
2. evidence credibility review
3. decision ownership and risk routing review
4. debt/fallback visibility review
5. next safest action recommendation

It may produce `trust-checkpoint.md` and a handoff snapshot. It must not write `archive.md` or move the change directory.

---

For docs substrate, run `steadyspec check <change-id-or-path> --phase verify --substrate docs` after writing `trust-checkpoint.md` and report the result.

---

**Input:** the argument after `/steadyspec:verify` is the change-id. If absent, verify-flow asks.

Follow the steps in the `steadyspec-verify-flow` SKILL.md exactly.

---
name: "steadyspec: verify"
description: "SteadySpec verify verb - run a trust checkpoint before archive, handoff, or risky continuation"
category: Workflow
tags: [steadyspec, verify, workflow, trust-checkpoint]
---

SteadySpec verify verb. Runs a trust checkpoint without archiving:

On every substrate, run `steadyspec delegation-check --change <repo-relative-change-path> --phase verify --json`; non-zero blocks verified/archive recommendations. It directly checks structural delegation lineage, not semantic truth or actor authentication.

1. output-vs-authorized-outcome and hard-constraints review, including delegation/challenge resolution
2. evidence credibility review
3. decision ownership and risk routing review
4. debt/fallback visibility review
5. next safest action recommendation

It may produce `trust-checkpoint.md` and a handoff snapshot. It must not write `archive.md` or move the change directory.
Any blocked trust dimension, or a misclassified Delegation/Risk Routing Review,
forces `re-open-intent`/`stop` and a blocked top-level result. Archive requires
all five trust dimensions to pass; no later evidence, closure, or cross-review
result may upgrade a failed gate.
Resolved authority refs must use change-relative `path.md#markdown-anchor` and
their targets/headings must be read back; docs mode enforces this deterministically.

---

After writing, rerun `delegation-check --phase verify` and require exact
Change/five-gate/Recommended-Next readback. For docs substrate, also require
`steadyspec check <change-id-or-path> --phase verify --substrate docs` to pass.

---

**Input:** the argument after `/steadyspec:verify` is the change-id. If absent, verify-flow asks.

Follow the steps in the `steadyspec-verify-flow` SKILL.md exactly.

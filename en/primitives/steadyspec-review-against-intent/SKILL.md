---
name: steadyspec-review-against-intent
description: Review completed SDD implementation against recorded intent before archive. Use after apply and before archive when the agent must verify promised behavior, scope, evidence, fallback, and drift handling before closing a change.
---

# SDD Review Against Intent

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 5, Output-Vs-Intent Review, applied to software SDD.

Use after `steadyspec-apply` and before `steadyspec-doc-sync` or `steadyspec-archive`.

1. Read intent, scope contract, non-goals, tasks, stop conditions, evidence, and fallback records.
2. Read the implementation diff or final behavior summary.
3. Check:
   - promised behavior missing or partial
   - extra behavior or scope creep
   - evidence weaker than required
   - fallback mislabeled as proof
   - drift discovered but not written back
   - accepted debt missing follow-up
4. Classify each finding as pass, blocker, accepted debt, or doc-sync required.
   Review intent fit, not only code style.
   Do not let passing tests hide missing promised behavior.
5. Block archive until blockers are fixed or explicitly accepted.
   Fallback is not full proof; silent drift blocks archive.

Report pass/blocker/debt/doc-sync findings, evidence gaps, drift status, and whether `steadyspec-doc-sync` or `steadyspec-archive` can run next.

## Failure Modes

- Fails when passing tests hide missing promised behavior.
- Fails when fallback is counted as full proof.
- Fails when review becomes style review instead of intent fit.

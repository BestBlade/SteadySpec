---
name: steadyspec-doc-sync
description: Sync durable docs after SDD implementation and review. Use after apply/review and before archive when specs, proposals, tasks, README, usage docs, changelog, ADRs, accepted debt, or fallback records may need to reflect what was actually built.
---

# SDD Doc Sync

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 6, Durable Record Sync, applied to software SDD.

Use after `steadyspec-review-against-intent` and before `steadyspec-archive`.

1. Read review findings, final behavior, evidence, drift updates, fallback, and accepted debt.
2. Check durable records:
   - proposal, design, spec, tasks, issue, or change notes
   - README or usage docs
   - changelog or release notes
   - ADR or decision record
   - human decision record
   - strategy or roadmap rollup
   - debt, fallback, or follow-up tracker
3. Update only records whose truth changed or whose absence would mislead future agents.
   Do not write aspirations that were not built.
4. Preserve rejected alternatives and historical constraints worth preventing rediscovery.
5. Mark no-op doc sync only with a reason.
   Do not create durable records for trivial facts that add noise.
   Do not archive while docs describe a world the implementation disproved.

Report docs updated, docs intentionally unchanged with reasons, accepted debt/fallback location, and whether archive can proceed.

## Failure Modes

- Fails when docs describe aspirations instead of implemented truth.
- Fails when stale docs survive because code tests passed.
- Fails when accepted debt or fallback remains only in chat.

---
name: steadyspec-archive
description: Archive or close an SDD change after review and doc sync. Use when implementation, evidence review, durable doc sync, accepted debt, and final truth are ready to be closed or marked paused.
---

# SDD Archive

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 7, Finalization Without Truth Drift, applied to software SDD.

Use when implementation is complete or intentionally paused, and review/doc-sync are complete or explicitly not applicable.

0. List all `steadyspec-human-decision-record` files linked by the change.
   For file-based substrates, grep/search for `confirmed_by:`.
   Stop if any required record lacks `confirmed_by: <human>`.
1. Read intent artifacts, tasks, evidence, decisions, and stop conditions.
2. Verify `steadyspec-review-against-intent` passed or is explicitly not applicable.
3. Verify `steadyspec-doc-sync` completed or is explicitly not applicable.
4. Verify tasks are complete or debt is explicitly accepted.
   Do not archive with silent incomplete tasks.
5. Verify evidence matches the selected level.
   Do not claim evidence exists unless it is recorded.
6. Record final decisions, rejected alternatives worth preserving, accepted debt, fallback, human decision records, strategy rollup links, and follow-up.
   Do not hide human-owned decisions, debt, fallback, or strategy signals inside archive prose.
7. Archive, close, or mark paused according to the substrate.

Report final status, archive/close location, review result, docs/spec sync result, evidence summary, human decisions, strategy signals, accepted debt, fallback, and follow-up items.

## Failure Modes

- Fails when archive prose hides unconfirmed human decisions.
- Fails when fallback or debt is named but has no follow-up.
- Fails when completed tasks are trusted without recorded proof.

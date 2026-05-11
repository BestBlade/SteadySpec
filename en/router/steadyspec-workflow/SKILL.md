---
name: steadyspec-workflow
description: Route and operate an SDD workflow with proof-gated execution. Use when a user wants spec-driven development, traceable changes, governance level selection, or coordination between explore, context archaeology, grill, debate, propose, apply, review, doc sync, archive, human decision record, and strategy rollup skills.
---

# SDD Workflow

Method link: This skill routes work across the portable mechanisms in [METHOD.md](../../../METHOD.md), applied to software SDD.

Use when the user wants an end-to-end SDD flow or is unsure which SDD skill to use.

1. Identify the substrate and governance level.
   Use `../../adoption/steadyspec-adopt/references/adoption-guide.md` and `../../adoption/steadyspec-adopt/references/substrates.md`.
   Do not force heavy governance onto low-risk work.
2. Select one change id before reading state.
   Use the active issue/change directory when unambiguous; ask when multiple changes or no target change are plausible.
3. Look for valid current-state artifacts for that change:
   - intent record
   - evidence record
   - review record
   - doc-sync record
   - decision records
   - strategy/roadmap notes
   Use `../../phases.md` for artifact names and record validity when the substrate has no project-local convention.
   Empty sections do not count as records. If intent changed after evidence/review, treat downstream records as stale.
4. Route by decision tree:
   - if no valid intent record: historical uncertainty -> `steadyspec-context-archaeology`; unclear plan -> `steadyspec-explore`; forked direction -> `steadyspec-debate`; otherwise -> `steadyspec-propose`
   - elif no valid evidence record -> `steadyspec-apply`
   - elif no valid review record -> `steadyspec-review-against-intent`
   - elif no valid doc-sync record and durable docs may be stale -> `steadyspec-doc-sync`
   - elif a human-owned decision is pending -> `steadyspec-human-decision-record`
   - elif repeated strategic signals appear -> `steadyspec-strategy-rollup`
   - else -> `steadyspec-archive`
   Do not start implementation before intent and evidence expectations exist.
   Do not archive before review and doc sync are complete or explicitly not applicable.
5. Escalate level only when ambiguity, drift, risk, or missing evidence appears.

Report selected level, substrate, artifacts found/missing, next skill, human decision needs, strategy rollup needs, and current stop condition.

## Failure Modes

- Fails when missing, empty, or stale artifacts are treated as completed phases.
- Fails when ambiguous state is routed by default instead of pausing.
- Fails when the router starts doing phase work instead of handing off.

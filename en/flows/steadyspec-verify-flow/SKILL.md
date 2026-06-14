---
name: steadyspec-verify-flow
description: SteadySpec verify verb. Run a trust checkpoint before archive, handoff, or risky continuation. Re-checks output against original intent, evidence credibility, decision ownership, risk routing, debt/fallback visibility, and next safest action. Triggers on `/steadyspec:verify <change-id>` and on user phrases like "verify this change", "trust checkpoint", "can we archive this", "is this still aligned", or "handoff status".
---

# verify-flow

The trust checkpoint for SteadySpec v0.3. This skill is an orchestration of primitives, not a primitive itself. It can run after apply, before archive, before handoff, or whenever the user asks whether current work is still trustworthy.

## When this verb runs

- User invokes `/steadyspec:verify <change-id>` - primary path.
- User invokes `/steadyspec:verify` without id - ask for the id, list active candidates if helpful.
- User says "verify this change", "trust checkpoint", "can we archive this", "is this still aligned", "handoff status", or equivalent.
- User just finished `apply-flow` and wants confidence before `archive-flow`.

## Inputs to gather

1. The change directory and its proposal.md, evidence.md, tasks.md if present, review.md if present, decision ledger, attention report, re-slice events, handoff snapshot, and any human-decision-records.
2. Current git diff or changed-file list when available.
3. The original intent, boundary, non-goals, evidence required, and stop conditions.
4. Proof signals that were claimed passed, failed, missing, blocked, fallback, or accepted as debt.

## Checkpoint gates

Run the gates in order. Do not write archive.md. Do not move the change directory.

### Gate 1: output-vs-intent

The situation calls for `steadyspec-review-against-intent` - surface this and let the agent reach for it based on its description.

Classify each intent/boundary point as pass, gap, accepted-debt, or blocker.

### Gate 2: evidence credibility

For each completed slice, compare the proof signal to the claim it supports.

- Passing tests prove only the behavior they actually cover.
- Manual checks must name who/what observed them.
- Fallback is residual risk, not proof.
- Missing proof is a gap even if the implementation looks plausible.

If all slices are already complete and the runtime supports it, verify-flow may use the apply workflow's `mode: "verify"` behavior to re-run proof signals without implementing new code.

### Gate 3: responsibility review

Review the decision ledger and risk routing:

- Every meaningful decision has owner, risk level, risk basis, reversibility, proof signal, override path, alternatives, and status.
- Hard high-risk triggers from `ARTIFACT_CONTRACT.md` are not downgraded by agent judgment.
- Any low-risk agent-owned decision that should be medium/high or user-owned is a misclassification.
- User-owned decisions are confirmed or listed as pending.

### Gate 4: debt and fallback visibility

Check that accepted debt, fallback, uncertainty, and reduced confidence remain visible in evidence, attention report, and the recommended next action.

### Gate 5: next safest action

Recommend exactly one of:

- `continue` - more apply slices remain and no blocker prevents safe continuation
- `archive` - intent, evidence, ownership, and debt visibility are sufficient for archive-flow
- `handoff` - state is clear enough for a successor but not ready to archive
- `re-open-intent` - implementation changed the target and proposal must be updated or replaced
- `stop` - blocker or unresolved user-owned high-risk decision prevents progress

## Output artifact

Write or update `<substrate>/changes/<change-id>/trust-checkpoint.md` when the substrate is file-based.

Minimum shape:

```markdown
## Trust Checkpoint

| Field | Value |
|-------|-------|
| Change | <change id> |
| Intent Match | pass|gap|blocked |
| Evidence Credibility | pass|gap|blocked |
| Risk Routing Review | pass|misclassified|blocked |
| Debt/Fallback Visibility | pass|gap|blocked |
| Recommended Next | continue|archive|handoff|re-open-intent|stop |
```

Also include:

- must-read decisions
- evidence gaps
- risk misclassifications
- pending user decisions
- next safest action rationale

## Handoff snapshot

If the recommended next action is `handoff`, or the user asked for handoff/status, write a handoff snapshot with:

- change id and location
- current intent
- boundary and non-goals
- ledger summary
- pending high-risk decisions
- proof signals passed/failed/missing
- drift events
- accepted debt and fallback
- next safest action

## Report

The verb's report contains:

- **Change id** and substrate location
- **Trust checkpoint result** (intent / evidence / risk routing / debt visibility / recommended next)
- **Attention report** (must-read first, needs-glance second, collapsed ledger count last)
- **Evidence gaps** and proof claims that are too broad
- **Pending user-owned decisions**
- **Handoff snapshot path** if generated

## Failure modes (consult while running)

- **FM-verify-becomes-archive:** verify-flow must not write archive.md or move the change.
- **FM-test-equals-truth:** a passing check does not prove broader intent unless the proof signal covers that intent.
- **FM-risk-rubberstamp:** do not accept agent-owned low-risk classification for a hard high-risk trigger.
- **FM-clean-handoff:** handoff must preserve debt, fallback, drift, and pending decisions instead of making the state look cleaner than it is.

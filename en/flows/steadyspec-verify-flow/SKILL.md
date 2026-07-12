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
5. Any v0.4 capability-lane artifacts: direction map, selection findings, evidence contract, mainline decision section, parked directions, rejected directions, and source labels for qualitative evidence.
6. Any cross-agent review artifacts under `cross-agent/`, especially `run.json`, `raw.md`, and `moderation.md`.

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

If the v0.4 capability lane exists, also check:

- selected mainline still matches the proposal intent and boundary
- evidence supports the mainline claim it names, not merely adjacent work
- parked directions remain preserved as parked, not rewritten as failures
- rejected directions have reasons and are not silently erased
- same-model debate is labeled as structured scrutiny, not independent validation
- qualitative evidence names source label and coverage limit

If the change claims external or cross-agent review was completed, run:

<!-- WINDOWS V0.5: cross-review is single-user Windows support; macOS/Linux reviewer execution is future cross-platform work. -->

```bash
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --check-latest --json
```

This v0.5 cross-review lane is single-user Windows support. On macOS/Linux,
carry missing POSIX smoke evidence as a future cross-platform limitation instead
of claiming cross-agent reviewer execution support. Two-agent consensus means
auxiliary raw findings plus primary moderation and same-peer final convergence
for any rejected or downgraded P1/P2; otherwise the claim remains incomplete
rather than invoking third-party arbitration. This is a flow obligation;
`--gate` alone does not prove cross-run convergence.

Resolve the opposite peer by host: Codex uses Claude; Claude uses Codex with
`--experimental-codex`. Preserve that reviewer across run, moderation, and
check-latest. A same-host second pass cannot satisfy cross-agent evidence.

Interpret exit codes explicitly: `0` is pass, `1` is pass-with-warning, and
`2`/`3`/`4` are gaps. A missing, skipped, failed, unstructured, or unmoderated
cross-agent run is not evidence. Warnings about advisory context boundaries must
be reported with the trust checkpoint as limitations. Prefer the JSON `status`,
`warnings`, and `errors` fields over parsing human-readable output.
For exit `1`, inspect JSON `warnings` before treating the run as usable
evidence. A warning that moderation rejected every finding is a review-quality
flag: surface it to the user or rerun/remoderate before claiming verification
confidence.

If `.steadyspec/cross-review.json` has `mode: gated`, run the gate even when the
change has not claimed cross-agent review yet:

<!-- WINDOWS V0.5: cross-review is single-user Windows support; macOS/Linux reviewer execution is future cross-platform work. -->
<!-- POSIX UNTESTED / CALIBRATION REQUIRED: gated mode is a v0.5 mechanism demo for a single operator; multi-user defaults are outside v0.5. -->

```bash
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --gate --json
```

Interpret gate JSON by status:

| status | Verify action |
|--------|---------------|
| `blocked` | WARN / claim-stop: do not claim cross-agent review is satisfied until a reviewer run exists and moderation is complete; in v0.5 do not use gated mode as a release or merge gate by itself. |
| `moderation-required` action on `blocked` | Moderate `moderation.md`, then rerun the same gate/check. |
| `needs-user` | STOP for the cross-agent claim: surface the P1/P2 `needs-user` moderation row to the user; do not claim cross-agent review is satisfied until the user confirms or the moderation is revised. |
| `satisfied` | Continue. |
| `satisfied-with-warning` | Continue only after inspecting `warnings`; carry ordinary limitations into the checkpoint, but surface all-rejected moderation warnings as review-quality flags. |
| `not-enforced` | Continue; report that policy is advisory/manual, not a gated pass. |
| `not-required` | Continue; report no recommendation signal fired. |
| `off` | Continue; report that cross-review is disabled. |

In auto flow execution, the agent may run:

<!-- WINDOWS V0.5: cross-review is single-user Windows support; macOS/Linux reviewer execution is future cross-platform work. -->
<!-- PLATFORM BRANCH: On Windows, run this command as written. On macOS/Linux, either add --experimental-posix and carry the smoke-untested limitation, or run --advice --json only and report that reviewer execution was skipped because POSIX smoke is open. -->

```bash
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --run-if-needed --json
```

If this starts a reviewer and returns `status: ran-reviewer-moderation-required`,
moderate the generated `moderation.md` before re-running `--gate` or
`--check-latest` with the same reviewer/mode/include-diff/packet-only scope. Do not treat
raw reviewer output as durable truth until moderation is complete.
Keep the trace intact: preserve which auxiliary agent finding ID produced each
accepted, carried-forward, rejected, or `needs-user` direction, and link the
specific `cross-agent/<timestamp>-<reviewer>-<mode>/` artifact path in the trust
checkpoint when verification claims cross-agent review.
Do not reuse the `--check-latest` exit-code table for `--run-if-needed`.
For `--run-if-needed --json`, drive flow control from JSON `status` and `action`:
`already-satisfied` means no run was needed, `already-satisfied-with-warning`
means carry warnings, `ran-reviewer-moderation-required` means moderate the new
run, and exit `3` means the attempted reviewer output was unusable rather than
an automatic retry signal.

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

If the substrate is docs mode and `steadyspec check` is available, run `steadyspec check <change-id-or-path> --phase verify --substrate docs` after writing `trust-checkpoint.md`. If it fails, report the checker errors and do not recommend archive until the trust checkpoint structure is fixed.

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
- **Docs check** (`steadyspec check --phase verify`) result when substrate is docs mode
- **Cross-review check** result when cross-agent artifacts or claims are present
- **Attention report** (must-read first, needs-glance second, collapsed ledger count last)
- **Evidence gaps** and proof claims that are too broad
- **Capability lane credibility** (mainline support / parked directions / qualitative evidence limits, when applicable)
- **Pending user-owned decisions**
- **Handoff snapshot path** if generated

## Failure modes (consult while running)

- **FM-verify-becomes-archive:** verify-flow must not write archive.md or move the change.
- **FM-test-equals-truth:** a passing check does not prove broader intent unless the proof signal covers that intent.
- **FM-risk-rubberstamp:** do not accept agent-owned low-risk classification for a hard high-risk trigger.
- **FM-clean-handoff:** handoff must preserve debt, fallback, drift, and pending decisions instead of making the state look cleaner than it is.
- **FM-mainline-unsupported:** a mainline decision is not credible just because work happened nearby. The evidence must name and support the actual claim, with limits.

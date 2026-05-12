---
name: steadyspec-apply-flow
description: SteadySpec apply verb. Implement a recorded change slice-by-slice with proof-gated execution. Pauses on drift and offers four options. TDD is the special case where the proof signal is an automated test. Triggers on `/steadyspec:apply <change-id>` and on user phrases like "implement this change", "start coding", "execute the tasks", "apply 099". The change-id is the substrate's id for the change to apply (e.g. `099-unify-session-timeout` in OpenSpec, or `001-improve-logging` in plain docs/changes).
---

# apply-flow

The third of the four SteadySpec verbs. This skill is an orchestration of primitives, not a primitive itself. It describes *what to do at this phase*; the agent loads primitive skills (whose own descriptions filter selection) as the orchestration progresses.

## When this verb runs

- User invokes `/steadyspec:apply <change-id>` — primary path.
- User invokes `/steadyspec:apply` without id — ask for the id, list candidates from active changes if helpful.
- User says "implement this", "start coding", "execute the tasks", "apply 099", or equivalent phrasing.
- User just finished `propose-flow` and signals readiness — propose-flow's hand-off lands here.

## TDD discipline (inherited)

apply-flow's per-slice loop is a generalization of TDD; TDD is the special case where the proof signal is an automated test. Four core disciplines apply, regardless of whether the proof signal is a test, a manual check, a fixture replay, or runtime observation:

1. **Vertical slices via tracer bullets.** One behavior → one proof → one minimal implementation, then repeat. Do not write multiple proofs first then multiple implementations.
2. **Do not refactor while the proof is RED.** Get to GREEN first.
3. **Do not anticipate the next slice.** Each slice's proof is decided after the previous slice closes, not in advance.
4. **Refactor only after all slices in this change have passed.**

## Inputs to gather before applying

1. The change directory (`<substrate>/changes/<change-id>/`) and its proposal.md (intent / boundary / non-goals / evidence required / stop conditions / tasks if any).
2. Any prior evidence already recorded for this change (resumed apply scenario).
3. The drift signals already known for this change (any earlier pause + decision recorded in evidence.md).

## Per-slice loop

For each unfinished slice (in order):

1. **Slice setup, ask user.** State: what behavior this slice must prove, what the proof signal will be (test / command / fixture / manual check), and the coverage limit (what the proof does NOT prove). Ask "auto / step-through / skip-this-slice". Per CON-9 half-auto.
2. **Define the proof signal in writing before any code change.** The situation calls for `steadyspec-apply` primitive — surface this and let the agent reach for it based on its description; the primitive carries the per-slice mechanics.
3. **Run the proof signal.** RED state. Do not refactor here.
4. **Implement the smallest code change that can move the proof signal to GREEN.** Keep slice review-sized.
5. **Re-run the proof signal.**
   - PASS because implementation is complete: continue to step 6.
   - FAIL because implementation is incomplete: iterate within this slice. Do not jump to the next slice.
   - FAIL because intent / boundary / validation was wrong: drift detected — go to "Drift handling".
6. **Record evidence.** Write to `<substrate>/changes/<change-id>/evidence.md` (or substrate's equivalent): proof command, result, output summary, coverage limit, any fallback or accepted debt.
7. **Mark this slice complete only when evidence matches the required level for the change's chosen governance.** Fallback is residual risk, not full proof.

After all slices in this change have passed: optional refactor pass (per discipline 4), prompted by user.

## Drift handling

When step 5 of any slice detects drift (intent / boundary / schema / validation has diverged from the proposal), pause the loop. Present the user with four options:

- **(i) Patch intent in place — expansion only.** apply-flow itself opens proposal.md and edits the affected field. Acceptable patches: add a file/layer to boundary, add a non-goal entry, add a stop condition, add an evidence requirement. **Forbidden patches: remove a promised behavior, narrow a boundary that excludes a previously promised user-facing capability, delete an evidence requirement.** Letting implementation narrow what was promised is the classic anti-pattern this product exists to prevent. If the needed patch is "remove" or "narrow", path is not (i) — go to (iv) STOP. On valid expansion: record a drift event entry in evidence.md (timestamp, before-after diff, slice that triggered), continue the apply loop.
- **(ii) Accept as known-limitation.** Record a debt entry in evidence.md with what the limitation is and why accepting; flag with reduced-confidence marker. Continue.
- **(iii) Revert this slice only.** Roll back the slice's code changes; do not advance to next slice. Log the revert reason. Continue per user direction (skip slice, retry, or pause whole apply).
- **(iv) STOP — drift too large to patch.** Report that the drift is structural and recommend opening a new change via `/steadyspec:propose <new-intent>`. Do not call propose-flow from here. The user explicitly opens the new change.

## Read budget

Aggregate read across all reads in this verb invocation should stay under approximately 10,000 tokens unless the agent explicitly needs more. Most of the read is at start (proposal + prior evidence); per-slice reads are smaller.

## Report

The verb's report contains:

- **Change id** and substrate location
- **Slices completed this invocation** (count + brief per-slice line: behavior + proof result)
- **Drift events** (if any: which slice, which option chosen, what was patched / accepted / reverted)
- **Evidence summary** (where evidence.md is, what proofs were recorded)
- **Remaining slices** (if any, or "all slices passed")
- **Recommended next** — typically `/steadyspec:archive <change-id>` if all slices pass; or "stay in apply for next invocation" if slices remain; or "open new change" if STOP path was taken

## Failure modes (consult while running)

- **FM-test-rewrites-intent:** a passing test or working prototype must not silently redefine what the change was supposed to do. If the proof is GREEN but the change accomplished something different from the proposal's intent, that is FAIL by drift, not PASS.
- **FM-batch-slices:** combining multiple unrelated changes into one slice for convenience. Each slice proves one behavior; if the work is unrelated, it belongs in a separate slice or a separate change.
- **FM-fallback-as-proof:** a fallback path is residual risk, not evidence that intent was met. Recording fallback as proof inflates apparent completion.

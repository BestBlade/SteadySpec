---
name: steadyspec-apply
description: Implement SDD tasks with proof-gated execution. Use when applying a recorded change, working through tasks, validating behavior, or stopping on drift before implementation silently changes intent.
---

# SDD Apply

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 4, Production With Nearby Checks, applied to software SDD.

Use when intent artifacts exist and the user wants implementation to begin or continue.

TDD is a special case of `steadyspec-apply`: use a TDD skill when the proof signal is an automated test.

1. Read intent, boundary, non-goals, tasks, evidence expectations, and stop conditions.
2. Pick the next vertical slice and name the behavior it must prove.
3. Define the proof signal before changing code:
   - pass/fail test, command, fixture replay, prototype check, or manual/runtime check
   - exact command or observation to run
   - coverage limit: what this signal does not prove
   - fallback only for design-outside tail, never as full proof
4. Establish the baseline:
   - for bugs, reproduce the failure first
   - for features, create or identify the smallest proof that can fail/pass
   Do not edit implementation until the proof path is clear.
5. Implement the smallest code change that can move the proof signal.
   Keep the slice small enough to review; do not batch unrelated work.
6. Run the proof signal.
   If it fails because implementation is incomplete, iterate within the same slice.
   If it fails because intent, boundary, or validation was wrong, stop and update intent.
7. Record evidence:
   - command/check run
   - result
   - output or observation summary
   - coverage limit
   - fallback/debt if any
   Do not mark manual/runtime validation complete unless it actually ran.
8. Mark the slice complete only when evidence matches the required level.
   Fallback is residual risk, not proof.
9. If behavior, boundary, schema, or validation drift appears, pause and update intent before continuing.

Report completed slices, evidence, missing evidence, intent updates, remaining tasks, and whether archive is appropriate.

## Failure Modes

- Fails when a test or prototype silently rewrites intent.
- Fails when fallback is recorded as proof.
- Fails when multiple slices are batched into an unreviewable change.
- Fails when code changes before the proof path is defined.

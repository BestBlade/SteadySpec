---
name: steadyspec-propose
description: Create SDD proposal artifacts from clear intent. Use when the problem, boundary, and evidence expectations are clear enough to record proposal, design, spec, issue, or task artifacts; use the governed proposal path when direction or implementation boundary is risky.
---

# SDD Propose

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 1, Intent Before Production, applied to software SDD.

Use when intent is clear enough to record before implementation.

Clear intent for consequential work means more than a polished prompt. Before
writing proposal artifacts, distinguish Authorized Outcome, Hard Constraints,
Challengeable Assumptions, Proposed Means, and Delegated Decisions. Record
Challenge Resolution and set Delegation Status to `ready` only when no
consequential challenge remains unresolved. The Agent may revise assumptions or
means within delegation, but MUST NOT silently change human-owned outcome or
hard constraints.

Challenge Resolution is structured, not free prose: finding ID, layer, owner,
status, authority basis, authority reference, and resolution. Outcome or hard
constraint changes require a concrete human-decision or prior-delegation
reference in change-relative `path.md#markdown-heading-anchor` form; read back
the target and heading, with deterministic docs enforcement. Agent ownership
cannot self-authorize them.

1. Identify substrate, select one change ID, and derive the exact
   repository-relative change base and active root. Custom bases must be
   supplied explicitly for this invocation.
2. Before writing any context, grill, debate, findings, proposal, design, spec,
   or task artifact, run `steadyspec delegation-path-check --change-id <id>
   --substrate <openspec|docs|meta|custom> --change-root <active-root>
   [--change-base <custom-base>] --json`. Non-zero, identity mismatch, or any
   symlink/junction component fails closed with zero proposal artifact writes.
   This is path readback at check time, not hostile-host attestation or
   post-check race prevention.
3. Read existing context and prior decisions.
4. If direction, boundary, validation, or architecture can drift, use [governed-proposal-path.md](references/governed-proposal-path.md) before writing artifacts.
5. Write intent and the delegation boundary defined in
   `ARTIFACT_CONTRACT.md`:
   - problem
   - desired behavior
   - boundary
   - non-goals
   - assumptions
   - evidence required
6. Write implementation tasks as vertical slices when possible.
   Do not write horizontal layers when one vertical slice can prove behavior.
7. Write stop conditions: what must pause apply and update intent.
8. Carry unresolved findings into design/tasks instead of hiding them in confident language.
   Do not invent decisions that exploration, debate, code, or user confirmation did not justify.

Report the pre-write path-preflight result, artifact locations, key boundary,
evidence plan, stop conditions, and readiness for `steadyspec-apply`.

## Failure Modes

- Fails when uncertainty is buried in confident artifact language.
- Fails when tasks encode horizontal layers instead of proofable slices.
- Fails when implementation detail is written as if it were a durable decision.
- Fails when any proposal artifact is written before a passing code-owned path preflight.

---
name: steadyspec-propose
description: Create SDD proposal artifacts from clear intent. Use when the problem, boundary, and evidence expectations are clear enough to record proposal, design, spec, issue, or task artifacts; use the governed proposal path when direction or implementation boundary is risky.
---

# SDD Propose

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 1, Intent Before Production, applied to software SDD.

Use when intent is clear enough to record before implementation.

1. Identify substrate: plain docs, OpenSpec, issue tracker, or existing docs.
2. Read existing context and prior decisions.
3. If direction, boundary, validation, or architecture can drift, use [governed-proposal-path.md](references/governed-proposal-path.md) before writing artifacts.
4. Write intent:
   - problem
   - desired behavior
   - boundary
   - non-goals
   - assumptions
   - evidence required
5. Write implementation tasks as vertical slices when possible.
   Do not write horizontal layers when one vertical slice can prove behavior.
6. Write stop conditions: what must pause apply and update intent.
7. Carry unresolved findings into design/tasks instead of hiding them in confident language.
   Do not invent decisions that exploration, debate, code, or user confirmation did not justify.

Report artifact locations, key boundary, evidence plan, stop conditions, and readiness for `steadyspec-apply`.

## Failure Modes

- Fails when uncertainty is buried in confident artifact language.
- Fails when tasks encode horizontal layers instead of proofable slices.
- Fails when implementation detail is written as if it were a durable decision.

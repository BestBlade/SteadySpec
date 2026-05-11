---
name: steadyspec-adopt
description: Bootstrap or operate a proof-gated change workflow. Use when a project needs lightweight or strong governance for planning, implementing, validating, and archiving changes without tying the workflow to one domain or spec tool.
---

# Proof-Gated Change

Method link: This skill adapts the portable method in [METHOD.md](../../../METHOD.md) to a project working medium and governance level.

Use when the user wants to start, adapt, or run a change workflow where implementation must preserve intent and completion must be backed by evidence.

1. Assess project risk and choose a level using [adoption-guide.md](references/adoption-guide.md).
   Do not install heavier governance than the project can sustain.
2. Keep the SDD/TDD boundary clear using [method-and-execution.md](references/method-and-execution.md).
   Tests, diagnosis, and prototypes produce evidence; they do not replace recorded intent.
3. Bind to the available substrate using [substrates.md](references/substrates.md): none, OpenSpec, or existing docs/issues.
   Substrates store the workflow; they are not the governance policy.
4. State intent before implementation: problem, boundary, non-goals, and evidence required.
5. Apply in narrow slices. If behavior, boundary, schema, or validation changes, stop and update the intent record first.
6. Complete only with evidence using [evidence-levels.md](references/evidence-levels.md).
7. For full SDD flow, route through `../../router/steadyspec-workflow`; see `../../phases.md` for the phase index.
8. If the workflow becomes project-specific, localize it using [project-localization.md](references/project-localization.md).

Report the selected level, substrate, intent record location, evidence produced, remaining uncertainty, and whether the change is complete, paused, or ready to archive.

## Failure Modes

- Fails when governance level is chosen by ambition instead of project risk.
- Fails when the substrate is treated as the governance policy.
- Fails when "complete" is declared without evidence at the selected level.

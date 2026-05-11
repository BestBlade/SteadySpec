# Adoption Guide

Generic principle:

```text
Use the lightest workflow that can still prevent expensive drift.
```

This is SDD first. SDD defines intent, boundary, and traceability. Test-first loops, diagnosis loops, and prototypes are execution proof tools inside the SDD lifecycle.

## Audience

Agents use this guide to configure and run the workflow.

Humans use this guide to judge the method: whether the governance weight matches project risk, whether SDD owns intent, and whether execution proof is strong enough before completion.

Human judgment is part of the workflow only when value, risk, debt, fallback, roadmap, or architecture responsibility must be owned. Agents prepare records and recommendations; humans confirm decisions.

## Levels

### Level 0: No Governance

Use for disposable experiments, tiny scripts, throwaway prototypes, or work where process would outlive the code.

Output: none, or a short note in the chat.

### Level 1: Proof-Gated Tasks

Use for small maintained projects or ordinary feature/bug work.

Output:

- task list
- evidence per completed task
- pause note when evidence is missing
- optional test, command, or manual check per task
- feedback loop or explicit fallback for each completed slice

### Level 2: Spec-Backed Changes

Use for long-lived projects, team work, user-facing behavior, data model changes, or public API changes.

Output:

- intent record: proposal, issue, design note, or spec
- context archaeology when old structure or project history affects safety
- grill when the plan has unresolved decision dependencies
- implementation tasks
- validation plan
- evidence before completion
- hard proof for in-scope design, fallback only for design-outside long tail
- drift rule: update the intent record before continuing if implementation changes the intended behavior or boundary
- review-against-intent before close
- doc sync before archive
- human decision record when risk, debt, fallback, or roadmap responsibility is accepted

Route with `steadyspec-workflow`; see `../../phases.md` for the phase index.

### Level 3: Governed Architecture Workflow

Use for architecture-sensitive work, risky migrations, multi-agent implementation, security-sensitive changes, or changes where direction can fork.

Output:

- direction decision
- confirmed historical constraints and unresolved context gaps when old decisions matter
- grilled decision dependencies and parked long-tail concerns
- rejected alternatives
- implementation boundary
- stop conditions
- review gate with evidence
- doc sync gate for implemented truth
- human decision records for accepted risk, fallback, debt, roadmap movement, or architecture direction
- execution proof strategy: tests, diagnosis loop, prototype, or manual validation chosen before implementation begins

Route with `steadyspec-workflow`; see `../../phases.md` for the phase index.

### Level 4: Project-Local Protocol

Use for mature systems with repeated agent work and recurring failure modes.

Output:

- project-local skills or workflow docs
- project-specific gates
- local glossary and decision records
- archive/review protocol
- periodic or triggered strategy rollups from repeated drift, fallback, debt, roadmap mismatch, or architecture-map deltas

Use `steadyspec-workflow` as the router. Use `steadyspec-strategy-rollup` for human-reviewable strategy signals. Localize only when repeated use proves stable needs.

## When Not To Use Heavy Governance

Do not use Level 3 or 4 when:

- the project is disposable
- the user needs a fast spike
- the change is obvious and local
- no architecture boundary exists yet
- evidence would cost more than the change
- the workflow would slow feedback without reducing risk

## Selection Rule

If unsure, start one level lighter. Escalate only when implementation reveals ambiguity, drift, risk, or missing evidence.

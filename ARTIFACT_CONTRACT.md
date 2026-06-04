# SteadySpec Workflow Artifact Contract

This file records the shared artifact contract for the Claude workflow scripts.
It is intentionally small and manual. The workflow scripts remain the source of
runtime behavior; this file names the formats they must agree on.

## Scope

Applies to:

- `en/runtime/claude/workflows/steadyspec-propose.js`
- `en/runtime/claude/workflows/steadyspec-apply.js`
- `en/runtime/claude/workflows/steadyspec-archive.js`
- `en/runtime/claude/workflows/steadyspec-explore.js`

Does not apply to Codex runtime descriptors, primitive SKILL bodies, or project
substrate selection.

## Schema Version

New workflow-authored artifacts should include a visible schema marker when the
artifact has a structured format:

```markdown
schemaVersion: 1
```

Existing artifacts without this marker remain valid input. Workflow scripts must
treat missing schemaVersion as legacy format, not as corruption.

## Evidence Table Format

Each completed slice in `evidence.md` must use this table shape:

```markdown
## Slice N: <behavior>

| Field | Value |
|-------|-------|
| Proof Command | <proofCommand> |
| Result | <pass|fail|drift|fallback|blocked> |
| Output Summary | <summary> |
| Coverage Limit | <what this proof does not prove> |
| Fallback | <fallback or None> |
| Accepted Debt | <debt or None> |
```

Fallback is residual risk, not full proof.

## Grill Question Schema

`GRILL_QUESTION_SCHEMA` must require:

- `question`
- `recommendedAnswer`
- `resolvedBranch`

It must also expose `category` as an enum so downstream artifacts can distinguish
boundary, evidence, stop-condition, non-goal, safety, dependency, and other
questions.

## Debate Findings Schema

`FINDINGS_SCHEMA` must require:

- `decision`
- `basis`
- `status`
- `blindSpotResult`
- `missingEvidence`

Templates must not silently default `blindSpotResult` or `missingEvidence` to
placeholder text.

## Migration Adapter Contract

Every Claude workflow script that reads change artifacts must apply a legacy
evidence migration rule at gather time:

- If `evidence.md` already contains `| Field | Value |`, treat it as structured
  table evidence.
- If the header is absent, treat the content as legacy free-form evidence.
- Extract what can be extracted without deleting or rewriting the source.
- Mark missing fields as `evidence-migration-unavailable`.
- Re-running the adapter must be idempotent.

## Patch Dependency Order

1. Establish this contract and legacy evidence migration adapters.
2. Update propose workflow shape, debate triggers, and grill budget.
3. Update apply evidence writing and refactor proof validation.
4. Restore archive Gate 2 half-auto user confirmation.
5. Add explore no-substrate and context archaeology guards.
6. Validate syntax and package consistency.

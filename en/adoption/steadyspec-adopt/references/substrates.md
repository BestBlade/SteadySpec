# Substrates

A substrate stores workflow state. It is not the governance policy.

## No Existing Substrate

Use plain files:

```text
docs/workflow.md
docs/changes/<change-id>/intent.md
docs/changes/<change-id>/evidence.md
docs/changes/<change-id>/review.md
docs/changes/<change-id>/doc-sync.md
docs/decisions/
```

Minimum intent record:

```markdown
# Change: <name>

## Intent
## Boundary
## Non-Goals
## Evidence Expected
## Pause Conditions
```

Evidence, review, and doc-sync records are separate files so `steadyspec-workflow` can distinguish missing, empty, and stale states.

## OpenSpec Substrate

Use OpenSpec for change directories, schema artifacts, status, and archive shape.

Rules:

- Read CLI/schema state before writing schema-owned artifacts.
- Treat local project conventions as governance policy.
- Do not assume upstream defaults if the project has local workflow docs.
- If implementation changes intent, update the relevant OpenSpec artifact before continuing.

## Existing Docs Or Issue Tracker

Use the existing issue, PRD, design doc, or decision log.

Rules:

- Do not create a parallel source of truth.
- Add missing fields only where the project already tracks work.
- Link evidence back to the original issue or doc.

## Choosing A Substrate

- Solo/blank project: plain docs.
- Project already using OpenSpec: OpenSpec.
- Team already using issues/PRDs: existing tracker plus evidence notes.
- Mature agent-heavy project: project-local protocol layered over the chosen substrate.

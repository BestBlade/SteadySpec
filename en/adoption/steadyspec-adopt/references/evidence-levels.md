# Evidence Levels

Evidence should match risk. More evidence is not automatically better.

## E0: Explanation

Use for exploratory or non-persistent work.

Evidence examples:

- reasoning summary
- open questions
- rejected option note

## E1: Local Check

Use for small implementation tasks.

Evidence examples:

- command output
- unit test result
- lint/typecheck result
- screenshot or manual verification note

## E2: Behavior Proof

Use for user-facing behavior, API contracts, data changes, or bug fixes.

Evidence examples:

- regression test
- integration test
- reproducible script
- before/after output
- trace or log proving the target behavior

## E3: Architecture Proof

Use when module boundaries, public contracts, persistence, concurrency, security, or cross-system behavior changes.

Evidence examples:

- design update
- alternative rejected with reason
- boundary review
- dependency direction check
- migration or rollback proof

## E4: Archive Proof

Use before finalizing a governed change.

Evidence examples:

- all tasks complete or accepted debt recorded
- specs/docs synced
- review gate evidence
- decision record updated
- archive path or release note

## Missing Evidence Rule

If evidence is required but unavailable, do not mark complete. Report:

```text
Missing evidence:
Why it matters:
What would produce it:
Proceeding risk:
```

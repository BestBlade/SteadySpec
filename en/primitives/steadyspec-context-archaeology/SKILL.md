---
name: steadyspec-context-archaeology
description: Reconstruct project history and rationale before an SDD decision. Use when code looks strange, old behavior may encode past constraints, a change would delete or replace existing structure, or the agent must avoid pretending to understand why the project evolved this way.
---

# SDD Context Archaeology

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 2, Context Before Confidence, applied to software SDD.

Use before grill, debate, propose, or apply when the current shape may have a history that affects safety.

1. Read the local substrate: specs, issues, decisions, changelog, commit messages, docs, and relevant code.
2. Identify unusual code shape, compatibility paths, migration traces, old bug defenses, naming drift, and implicit contracts.
3. Classify every rationale:
   - confirmed history
   - inferred rationale
   - obsolete rationale
   - unknown context
4. Turn confirmed history into constraints for `steadyspec-grill`, `steadyspec-debate`, `steadyspec-propose`, or `steadyspec-apply`.
5. Turn inferred or unknown history into explicit questions or evidence gaps.
   Do not turn inferred history into fact.
6. If a historical reason is obsolete, state what evidence makes it obsolete and what can be safely removed.
   Do not preserve or delete old structure just because it is old.

Report confirmed constraints, inferred rationale, obsolete rationale, unknown context, evidence sources, and the next recommended SDD skill.

## Failure Modes

- Fails when inferred rationale is promoted to confirmed history.
- Fails when old structure is preserved or deleted only because it is old.
- Fails when storytelling replaces cited evidence.

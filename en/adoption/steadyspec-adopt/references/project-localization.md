# Project Localization

Localize only after repeated use reveals stable project-specific needs.

## Localize When

- the same gate is repeated across changes
- agents repeatedly drift in the same way
- the project has domain terms that reduce ambiguity
- review requires project-specific evidence
- archive must update project-owned records

## Do Not Localize When

- the rule is useful for only one change
- the project is still exploring its shape
- the domain term is not stable
- the gate cannot be verified

## What To Create

For mature projects, the agent may create project-local artifacts:

```text
skills/<project-change-skill>/
docs/workflow.md
docs/glossary.md
docs/decisions/
```

Keep the generic skill clean. Put domain rules in the project-local layer. Ask the user before adding durable project-local rules unless the task explicitly requested workflow localization.

## Local Skill Shape

Use a compact action shape:

```text
When to use it.
1. Do the next action.
   Put the constraint directly under the action it limits.
2. Stop or hand off when the local action is done.
Report the result and next unblocker.
```

Keep hard gates local, evidence-backed, and close to the step they constrain.

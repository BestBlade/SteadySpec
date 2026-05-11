---
name: steadyspec-strategy-rollup
description: Roll up repeated SDD signals into human-reviewable strategy input. Use periodically or when repeated drift, fallback, accepted debt, roadmap mismatch, architecture-map delta, stale strategic assumptions, or recurring review findings suggest the roadmap or architecture direction may need human attention.
---

# SDD Strategy Rollup

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 8, Local Signals To Strategy, applied to software SDD.

Use periodically or when multiple local changes produce strategic signals.

1. Read recent changes, archives, drift/debt/fallback records, review findings, roadmap, architecture map, and strategy docs if present.
2. Collect signals:
   - repeated drift or evidence gaps
   - repeated fallback or accepted debt
   - roadmap or architecture mismatch
   - stale assumptions
   - recurring human decision points
3. Classify each signal as observation, proposed update, or human decision needed.
   Do not turn frequency into priority without human judgment.
4. Write a human-readable digest with links to source records.
   Every signal needs traceable evidence; omit noisy one-off facts unless they change risk or direction.
5. Recommend actions, but mark them as proposed, not decided.
   Do not update roadmap or strategy by implication.
6. If a value judgment is required, hand off to `steadyspec-human-decision-record`.

Report strategic signals, recommended human decisions, proposed doc updates, source links, and whether any `steadyspec-human-decision-record` is needed.

## Failure Modes

- Fails when frequency is treated as priority.
- Fails when repeated facts are treated as systemic without source links.
- Fails when a rollup hides the human decision owner.

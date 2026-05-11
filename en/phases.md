# Phases

Use this as the phase index. Individual skills keep the local loop.

Every skill must name its own local failure modes. A skill that only says how to succeed is an amplifier; a skill that names how it misfires has a feedback branch.

Before adding a new gate or constraint, answer:

- Does this reduce agent drift, or create form-filling inertia?
- Can the constraint move closer to the action it limits?
- Does this layer have more than one instance?
- Is this gate an evidence obligation, or a ritual check?

When re-entering unknown work, start at `steadyspec-workflow`.
When governance level is unknown, start at `steadyspec-adopt`.

## Runtime Modes

Runtime mode must be declared when it changes conclusion credibility or role isolation. Today this applies to `steadyspec-debate`: record whether it ran as `mode-1-local-dual-role`, `mode-2-pseudo-cross-debate`, or used external `mode-3-true-cross-debate` findings. Record the isolation limit when the mode is local or same-model.

For other primitives, subagents are execution aids, not proof. Use them only for breadth, parallel reading, or parallel sidecar review when the runtime and user/project allow it; do not treat same-model subagent output as independent validation unless the skill declares a debate mode.

## Artifact Conventions

- Plain docs: `docs/changes/<id>/{intent,evidence,review,doc-sync}.md`.
- OpenSpec substrate: `openspec/changes/<id>/{proposal,tasks}.md` plus `.agent/{evidence,review,doc-sync}.md` when no project-local names exist.
- Issue tracker: issue body sections `## Intent`, `## Evidence`, `## Review`, and `## Doc Sync`.

## Artifact State

- Select the change id before routing. Use the active issue/change directory when unambiguous; otherwise ask. Do not infer status across multiple changes.
- A record exists only when the file or issue section is non-empty and carries its minimum payload:
  - intent: problem, boundary, non-goals or assumptions, evidence expectation, stop condition
  - evidence: proof signal, result, coverage limit, and fallback/debt if any
  - review: pass/blocker/debt/doc-sync finding against intent
  - doc-sync: docs changed, or no-op reason
- If intent changes after evidence or review exists, downstream evidence/review/doc-sync records are stale until refreshed. Do not route past a stale record.

## Route

- `steadyspec-adopt`: choose governance strength and substrate.
- `steadyspec-workflow`: decide the next phase from existing artifacts and risk.

## Before Proposal

- `steadyspec-explore`: clarify intent.
- `steadyspec-context-archaeology`: recover confirmed history and unknown context.
- `steadyspec-grill`: harden the decision tree.
- `steadyspec-debate`: compare competing directions.
- `steadyspec-propose/references/governed-proposal-path.md`: high-risk proposal path.

## Change Record

- `steadyspec-propose`: write intent and stop conditions.
- `steadyspec-apply`: implement one slice with proof signal and evidence.
- `steadyspec-review-against-intent`: check implementation against intent.
- `steadyspec-doc-sync`: write implemented truth back to durable records.
- `steadyspec-archive`: close after truth is durable.

## Scale

- `steadyspec-human-decision-record`: record human-owned value/risk decisions.
- `steadyspec-strategy-rollup`: summarize repeated local signals for human review.

---
name: steadyspec-archive-flow
description: SteadySpec archive verb. Close a change with no silent close — runs review-against-intent, doc-sync auto-scan, confirmed_by gate, and rollup-trigger check, all gating the actual archive write. Triggers on `/steadyspec:archive <change-id>` and on user phrases like "close this change", "archive 099", "wrap up the change". The change-id is the substrate's id for the change to archive.
---

# archive-flow

The fourth of the four SteadySpec verbs. This skill is an orchestration of primitives, not a primitive itself. It describes *what to do at this phase*; the agent loads primitive skills (whose own descriptions filter selection) as the orchestration progresses.

## When this verb runs

- User invokes `/steadyspec:archive <change-id>` — primary path.
- User invokes `/steadyspec:archive` without id — ask for the id.
- User says "close this change", "wrap up", "archive 099", or equivalent.
- User just finished `apply-flow` with all slices passed — apply-flow's hand-off lands here.

## Inputs to gather

1. The change directory (`<substrate>/changes/<change-id>/`) and all artifacts in it: proposal.md, evidence.md, any debt / fallback / finding records, any human-decision-records linked to this change.
2. `git diff` between the change's start state and current HEAD — list of changed source files.
3. Substrate convention for archive location (e.g. OpenSpec moves to `openspec/changes/archive/<change-id>/`).

## Gates (must pass in order; any STOP halts archive write)

archive-flow runs four gates. Each gate has a real check, not a polite suggestion. If any gate fails, the verb reports the failure and does not write the archive.

### Gate 1: review-against-intent

The situation calls for `steadyspec-review-against-intent` — surface this; let the agent reach for it based on its description. Review classifies findings as pass / blocker / accepted-debt / doc-sync-required.

- If any blocker: STOP. Report blocker. User must address before re-running archive.

### Gate 2: doc-sync auto-scan

Run a 3-layer scan to identify candidate docs that may need updates:

- **Layer 1**: `git diff` between change-start and HEAD → list of changed source files.
- **Layer 2a**: For each changed source file, grep the project for markdown link references to the file path → candidate docs.
- **Layer 3**: Always-check convention list: README.md, CHANGELOG.md, docs/**/*.md, openspec/specs/**/*.md (if openspec substrate).

Classify each candidate doc with confidence: `must-update` (direct link or strong identifier match) / `should-check` (mentions identifier, weaker signal) / `unlikely` (convention only, no signal).

- For each `must-update` not yet updated in this change's commits: STOP. Report. User must update (typically via an extra apply slice).
- For each `should-check`: ask the user "is doc X still accurate?" Half-auto per CON-9.
- The situation calls for `steadyspec-doc-sync` — surface this for the user-confirmed must-update + should-check list.

If `--thorough` flag is passed, additionally run Layer 2b (parse changed source files for declarations and grep each as identifier reference). Default mode skips Layer 2b for performance (target: <5s on 100k-LOC project; if first-dogfood reveals >10s, escalate to v0.3 budget design).

### Gate 3: confirmed_by gate (human-decision)

List all human-decision-record files linked by this change. For file substrates, grep `confirmed_by:`. If any required record lacks `confirmed_by: <human>`: STOP. Ask the user to confirm before continuing.

### Gate 4: completeness check (no partial-archive)

archive-flow always writes a complete archive. Verify the archive.md fields can be filled from real artifacts: final decisions, preserved rejected alternatives, accepted debt + follow-up, fallback (if any), human-decision-record links, drift events from evidence, strategy-rollup link (if rollup ran). If any required field has no source: STOP. Report missing source. (Partial archives — specs-only or skeleton entries — are NOT created by archive-flow. If a user wants to preserve specs without a full archive, they manually move files and skip archive-flow.)

## Rollup trigger check (after gates pass, before write)

Read the last 10 archived changes' debt / fallback / finding fields. If 3 or more mention the same module or keyword, the situation calls for `steadyspec-strategy-rollup` — surface this; let the agent reach for rollup based on its description. Per CON-9 and the user's standing E=auto preference (recorded in v0.2-alpha grill answers), rollup may auto-run; record its output digest as a sibling artifact and reference it from the archive.md.

## Archive write

Per CON-9 half-auto, ask the user "ready to write archive? auto / step-through / cancel".

On auto / step-through:

1. Write `<substrate>/changes/<change-id>/archive.md` (or substrate's equivalent) with the complete fields verified in Gate 4 + rollup link if any.
2. Move the change directory to the substrate's archive location (e.g. `openspec/changes/archive/<change-id>/` for OpenSpec).

On cancel: do not write or move. Preserve gate outputs for resumed archive-flow invocation.

## Read budget

Aggregate read across all reads in this verb invocation should stay under approximately 10,000 tokens unless the agent explicitly needs more. Doc-sync Layer 2 is the largest variable; the <5s default-mode budget is the practical cap.

## Report

The verb's report contains:

- **Change id** and final archive location
- **Gate results**: review status / doc-sync touched-docs list / confirmed_by status / completeness verified
- **Rollup**: triggered? digest path if yes
- **Drift events** carried from evidence.md (summary)
- **Final decisions** + accepted debt + fallback + follow-up triggers
- **Recommended next** — typically "the next active change can begin"; or specific suggestion if rollup digest recommended a strategic action

## Failure modes (consult while running)

- **FM-prose-hides-decisions:** human-owned decisions, accepted debt, fallback, and strategy signals must be named items in archive.md, not buried in narrative paragraphs that read smoothly but hide responsibility.
- **FM-must-update-doc-skipped:** a `must-update` doc found in Gate 2 but unchecked is a Gate 2 STOP, not a "should-check" downgrade. Confidence levels are not negotiable to keep momentum.
- **FM-fallback-as-evidence:** a fallback path is residual risk, not evidence that intent was met. Same FM as apply-flow; restated here because archive is the last gate.

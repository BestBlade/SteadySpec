---
name: steadyspec-explore-flow
description: SteadySpec activation entry. Two modes — status (no topic) reports project state by aggregating substrate change records and drift signals; topical (with topic) explores an idea with project history and prior decisions loaded. Triggers on `/steadyspec:explore [topic]` and on user phrases like "what's the project state", "where are we", "what's next", "let's explore X", "I'm thinking about Y". Activates SteadySpec for the session — once invoked, the agent stays spec-aware and reaches for the right `steadyspec-*` skill at later transition points.
---

# explore-flow

The first of the four SteadySpec verbs. This skill is an orchestration of primitives, not a primitive itself. It describes *what to do at this phase*; the agent loads primitive skills (whose own descriptions filter selection) as the orchestration progresses.

## When this verb runs

- User invokes `/steadyspec:explore` with no topic — status mode.
- User invokes `/steadyspec:explore <topic>` — topical mode.
- User says "what's the project state", "what's next", "where are we", "explore X with me", or equivalent phrasing that indicates wanting to think under SteadySpec.

## Adopt heuristic check (run on entry)

Read `.steadyspec/substrate.json` if present. If missing or `lastAdopt` field absent: surface "no adopt baseline recorded" as INFORMATIONAL in the report and recommend the user run `steadyspec-adopt` once. Do not block.

v0.2.x deliberately ships only the no-baseline case. Quantitative triggers (LOC doubled, change count doubled, repeated drift, new structural class) require a baseline that the current `substrate.json` schema does not collect; that is a v0.3 feature. Until then, this check only ensures the user has been advised to establish a baseline.

## Status mode (no topic)

Goal: aggregate the real state of the project's spec workflow and produce a status report the user can act on.

1. **Document freshness check (do this before reading any project doc as authoritative).** For each top-level project doc you may rely on (TODO.md, STRATEGY.md, README.md, CHANGELOG.md, etc.): never read its self-declared `Last updated: YYYY-MM-DD` as recency. Use `git log -1 --format=%ai -- <file>` for real mtime. If self-declared date is newer than git mtime by more than 2 days, treat the document as stale and flag in the report.
2. Detect the substrate. If `openspec/` exists, use OpenSpec convention. If `docs/changes/` exists, use plain-files convention. If both exist and `.steadyspec/substrate.json` does not record a choice, ask which is canonical. If neither exists, the project has no SteadySpec workflow state yet — say so and suggest `/steadyspec:propose` to start the first change.
3. Read the substrate's change directory. List active changes (those not archived) and inspect their proposal / evidence / review records to compute a rough completion signal per change.
4. **List the most recent 5 archived changes and read their archive records** to extract debt, fallback, finding, follow-up fields. **Classify each archived entry, do not default to "empty placeholder":**
   - `complete-archive`: archive.md exists AND has the standard fields (decisions / debt / fallback / follow-up)
   - `partial-archive`: archive directory exists with change subdirs but archive.md is missing or fields are empty — record as "partial-archive (archive.md missing or fields empty), check git log for archive context" — DO NOT call this "empty placeholder"
   - `incomplete-archive`: archive directory exists but no change content inside — this is a true empty placeholder; only use this label when the directory truly has no change subdirs
   - `inaccessible`: archive exists but cannot be read — surface the read error
5. Aggregate drift signals: any debt / fallback / finding that appears in 3 or more of the last N archived changes, mentioning the same module or keyword. Skip this step for `partial-archive` entries (their fields are missing, can't aggregate from them).
6. Compose a four-section status report:
   - **Active changes:** name + completion signal + open debt or blocker per change
   - **Debt aggregate:** cross-change repeated debt or fallback patterns; if all recent archives are partial-archive, say "debt aggregate unavailable — recent archives have missing fields, classify partial-archive"
   - **Recent archived:** last 5 with one-line summary AND classification (`complete-archive` / `partial-archive` / `incomplete-archive` / `inaccessible`)
   - **Recommended next:** which verb the user should run next, with reasoning (e.g. "apply on change 099 — closest to done"; "archive on 098 — already at review pass with no blockers"; "propose for the new feature you mentioned"). If multiple `partial-archive` entries appear, also suggest "consider re-archiving partial entries with `/steadyspec:archive <id>` to populate fields"
7. If adopt heuristic fired (or no-baseline informational case), include the suggestion at the top of the report.
8. If any document was flagged stale in step 1, include the staleness flag in the report's header.

## Topical mode (with topic)

Goal: think with the user about a specific topic, with project history loaded, and hand off to `propose` if the topic converges into commit-ready intent.

1. Adopt-heuristic-check is already done on entry. Continue.
2. Read related substrate context. If the topic mentions code areas with potentially unclear history, the situation calls for context-archaeology — surface this and let the agent reach for that primitive based on its description.
3. Engage with the user on the topic. Surface the topic's known constraints, related prior changes, and at least one open question with a recommended answer per matt-style explore.
4. Stay in exploration. Do not write proposal artifacts during exploration. Do not implement code.
5. If the user's input converges to a committable intent (problem statement is clear, boundary is roughly visible, the user signals readiness), do not auto-transition. Tell the user "ready to propose? `/steadyspec:propose <draft-intent>`" and stop.

Per CON-9, the verb operates half-auto by default. At any decision point where the agent would do multiple things in sequence, ask the user "auto / step-through / skip" and let the answer set the mode for that invocation.

## Read budget

Aggregate read across all reads in this verb invocation should stay under approximately 10,000 tokens unless the agent explicitly needs more. The status mode aggregation is the largest consumer; if the project has hundreds of archived changes, summarize the recent 5 in detail and only count-and-name the rest.

## Report

Both modes produce a structured report to the user. Status mode emits the four-section report described above. Topical mode emits clarified intent + open questions + recommended next verb (typically `propose` or staying in `explore`).

## Failure modes (consult while running)

- **FM-no-substrate-pretending:** if the project has no substrate and no prior changes, the verb must say "no SteadySpec workflow state yet" — not invent a fake report from README / git log alone.
- **FM-stale-doc-as-truth:** never read self-declared `Last updated: YYYY-MM-DD` in TODO / STRATEGY / README as authoritative recency. Use `git log -1 --format=%ai -- <file>` for real document mtime when freshness matters.
- **FM-explore-becomes-propose:** topical mode that drifts into writing artifacts has crossed the boundary. Stop and hand off to `propose` instead.

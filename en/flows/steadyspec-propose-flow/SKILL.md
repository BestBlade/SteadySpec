---
name: steadyspec-propose-flow
description: SteadySpec propose verb. Writes a proposal artifact whose intent is grilled, debated when needed, and traceable to prior changes. Auto-incorporates project history, current state, and prior decisions. Triggers on `/steadyspec:propose <intent>` and on user phrases like "let's write a proposal", "write the spec", "create the change", "let's commit to this plan". The intent is a short user-supplied string describing what the change is about; if no intent is given, asks the user to provide one.
---

# propose-flow

The second of the four SteadySpec verbs. This skill is an orchestration of primitives, not a primitive itself. It describes *what to do at this phase*; the agent loads primitive skills (whose own descriptions filter selection) as the orchestration progresses.

## When this verb runs

- User invokes `/steadyspec:propose <intent>` — primary path.
- User invokes `/steadyspec:propose` without intent — ask for intent first.
- User says "write the proposal", "write the spec", "create the change", "let's commit to this plan", or equivalent phrasing.
- User just finished a topical `explore-flow` and signals readiness — explore-flow's hand-off lands here.

## Inputs to gather before writing

1. The intent string (the user's own words for what this change is about).
2. The substrate (per `.steadyspec/substrate.json` or detection: openspec / docs/changes / new docs/changes).
3. The next change number for the substrate (NNN), and the slug derived from the intent.
4. Project history relevant to the intent: prior changes mentioning related code areas, modules, or keywords. Read substrate's archive index, not the full archive.
5. If the intent mentions code areas with potentially unclear history, the situation calls for context-archaeology — surface this and let the agent reach for that primitive based on its description.

## Hardening the intent

Before writing artifacts, the intent must be sharpened. Per CON-9 half-auto, ask the user "ready to harden intent? auto / step-through / skip" and proceed accordingly.

1. **Grill the decision tree.** The situation calls for `steadyspec-grill` — surface this; let the agent reach for grill based on its description. Grill closes when the decision tree is hardened OR the user explicitly accepts vague-with-noted-risk.
2. **Detect debate-needed conditions.** Run debate when ANY of:
   - **fork**: grill found two or more candidate directions both supported by evidence
   - **high-risk area**: intent touches architecture, data model, public api, migration, or security
   - **boundary not sharp**: grill resolved direction, but the implementation boundary (which files / layers / interfaces are in scope vs out) is not yet clear enough that apply will provably stay inside
   SKIP debate if the change is trivial: single-file edit, doc-only change, or local cleanup with no interface contact. Trivial changes do not need debate even if they touch a high-risk area; size and reach are the discriminator.
3. **If debate needed**, the situation calls for `steadyspec-debate` — surface this; let the agent reach for debate based on its description. Debate's role here is dual: settle direction AND/OR sharpen implementation boundary. Debate closes with `findings.md` (or equivalent finding record per substrate convention).

## Writing the proposal artifact

Per CON-9 half-auto, ask the user "ready to write proposal artifacts? auto / step-through / skip / cancel-keeping-grill-and-debate".

On auto / step-through:

1. Write to `<substrate>/changes/<NNN>-<slug>/proposal.md` (or substrate's equivalent). The proposal contains, at minimum: the intent (in the user's own words), the boundary (in scope / out of scope as separate lists), non-goals, evidence required for completion, and stop conditions (what would pause apply and require updating intent).
2. Link basis: reference the grill outputs and debate findings (if any) by file path. Do not inline them.
3. Add inherits-from: list prior change IDs that influenced this proposal (from step 4 of "Inputs to gather"). If none, omit.

On cancel-keeping-grill-and-debate: do not write the proposal artifact, but preserve any grill / debate output files for a later resumed propose-flow invocation.

## Read budget

Aggregate read across all reads in this verb invocation should stay under approximately 10,000 tokens unless the agent explicitly needs more. The history-fetch step is the largest consumer; summarize archive index entries, only read full archive bodies for the 1-3 most-related changes.

## Report

The verb's report contains:

- **Artifact location** (full path to proposal.md and any sibling artifacts created)
- **Intent** (the hardened one-line statement)
- **Boundary** (in scope / out of scope summary)
- **Evidence plan** (what proof is required for completion)
- **Stop conditions** (what would pause apply)
- **Basis** (grill ran? debate ran? findings file path)
- **Inherits-from** (prior change IDs)
- **Recommended next** — typically `/steadyspec:apply <NNN>-<slug>`; or "stay in propose to revise" if user wants to iterate

## Failure modes (consult while running)

- **FM-invented-decisions:** the proposal must not contain decisions that exploration / grill / debate / user confirmation did not justify. If a field needs filling and no source justifies a value, leave the field marked "unresolved" rather than synthesize.
- **FM-confident-language-over-uncertainty:** open questions and unresolved findings carry forward into the proposal explicitly, not buried in confident artifact prose.
- **FM-horizontal-tasks:** if implementation tasks are needed in the proposal, write them as vertical slices (one slice = one provable behavior). Do not write tasks as horizontal layers (DB → service → UI in sequence) when one vertical slice could prove the behavior end-to-end.

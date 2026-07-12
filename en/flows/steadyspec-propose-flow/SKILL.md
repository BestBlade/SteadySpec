---
name: steadyspec-propose-flow
description: SteadySpec propose verb. Writes a proposal artifact with hardened intent, decision ledger, risk routing, attention report, and traceability to prior changes. Auto-incorporates project history, current state, and prior decisions. Triggers on `/steadyspec:propose <intent>` and on user phrases like "let's write a proposal", "write the spec", "create the change", "let's commit to this plan". The intent is a short user-supplied string describing what the change is about; if no intent is given, asks the user to provide one.
---

# propose-flow

One of SteadySpec's five outward verbs: explore -> propose -> apply -> verify -> archive. This skill is an orchestration of primitives, not a primitive itself. It describes *what to do at this phase*; the agent loads primitive skills (whose own descriptions filter selection) as the orchestration progresses.

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
5. Existing responsibility records for related changes: decision ledger entries, accepted debt, fallback, and high-risk decisions that may constrain this proposal.
6. If the intent mentions code areas with potentially unclear history, the situation calls for context-archaeology - surface this and let the agent reach for that primitive based on its description.

## Hardening the intent

Before writing artifacts, the intent must be sharpened. Per CON-9 half-auto, ask the user "ready to harden intent? auto / step-through / skip" and proceed accordingly.

If grill, debate, or cross-agent review could apply and no project default is
clear, ask which Agent Collaboration Mode to use before starting long-running
work: `solo`, `grill`, `cross-review`, or `debate`. `solo` means no auxiliary
agent claim is made. `grill` preserves question-driven hardening output.
`cross-review` uses `steadyspec cross-review` in `design` or `review` mode and
must preserve `raw.md`, complete `moderation.md`, and keep finding IDs tied to
primary decisions. `debate` uses a stronger challenger pass for blind spots or
direction forks; real debate-mode reviewer execution requires
`--experimental-debate` in v0.5.

1. **Grill the decision tree.** The situation calls for `steadyspec-grill` - surface this; let the agent reach for grill based on its description. Grill closes when the decision tree is hardened OR the user explicitly accepts vague-with-noted-risk.
2. **Create initial responsibility records.** Before debate routing, draft decision ledger entries for meaningful proposal decisions: scope, non-goals, proof strategy, interface/runtime behavior, accepted uncertainty, and any user-owned value/risk call. Each entry records owner (`agent` / `user` / `shared`), risk level, risk basis, reversibility, proof signal, override path, alternatives, and status.
3. **Route risk.** High-risk decisions must be user-visible. The agent may classify extra decisions as medium/high, but may not downgrade hard high-risk triggers from `ARTIFACT_CONTRACT.md`: public API/CLI/runtime interface, migration/storage/data-loss, security/auth/permission/secret/sandbox/network boundary, deletion/removal/narrowing, contradiction with proposal boundary/non-goal/stop condition/accepted debt, change spanning three or more modules/layers, re-slicing that changes scope/proof/user-visible outcome, or archive claims that turn fallback/debt into proof.
4. **Detect debate-needed conditions.** Run debate when ANY of:
   - **fork**: grill found two or more candidate directions both supported by evidence
   - **high-risk area**: intent touches architecture, data model, public api, migration, or security
   - **boundary not sharp**: grill resolved direction, but the implementation boundary (which files / layers / interfaces are in scope vs out) is not yet clear enough that apply will provably stay inside
   SKIP debate if the change is trivial: single-file edit, doc-only change, or local cleanup with no interface contact. Trivial changes do not need debate even if they touch a high-risk area; size and reach are the discriminator.
5. **If debate needed**, the situation calls for `steadyspec-debate` - surface this; let the agent reach for debate based on its description. Debate's role here is dual: settle direction AND/OR sharpen implementation boundary. Debate closes with `findings.md` (or equivalent finding record per substrate convention).
   - **WINDOWS V0.5:** If the change has a concrete artifact directory and the risk is specifically same-model blind spot or cross-model pressure, use the opposite peer: Codex host runs `steadyspec cross-review --change <change-id-or-path> --reviewer claude --mode design --run`; Claude host runs the same command with `--reviewer codex --experimental-codex`. A same-host second pass is not cross-review evidence.
   - **WINDOWS V0.5:** If `.steadyspec/cross-review.json` has `mode: advisory`, first run `steadyspec cross-review --change <change-id-or-path> --mode design --advice --json`. Treat `recommended: true` as a prompt to run the explicit Level 1 command, not as a completed review.
   - **WINDOWS V0.5:** If `.steadyspec/cross-review.json` has `mode: gated`, run `steadyspec cross-review --change <change-id-or-path> --mode design --gate --json` after the change artifacts exist. `status: blocked` means do not claim the proposal's cross-agent challenge is satisfied until an explicit `--run` has completed and moderation is `status: complete`.
   - **WINDOWS V0.5:** In auto flow execution, `steadyspec cross-review --change <change-id-or-path> --mode design --run-if-needed --json` may start the reviewer when the gate would otherwise block. It still leaves `moderation.md` for the primary agent to classify before the review is complete.
   - **WINDOWS V0.5:** After a cross-review run, moderate `cross-agent/<timestamp>/moderation.md` and run `steadyspec cross-review --change <change-id-or-path> --mode design --check-latest` with the same reviewer/mode/packet-only scope before calling the cross-agent review complete.
   - Do not describe this as sandboxed or as automatic moderation. Gated mode is an automatic readiness check; `--run-if-needed` is automatic reviewer execution only when explicitly invoked by the flow.
   - Treat this v0.5 cross-review lane as single-user Windows dogfood. On macOS/Linux, carry missing POSIX smoke evidence as a future cross-platform limitation instead of claiming cross-agent reviewer execution support.
   - Treat two-agent consensus as auxiliary raw findings plus primary moderation and final convergence. A reviewer-original P1/P2 rejection or downgrade requires the same peer to re-review the final patch without raising it again. If they do not converge, preserve the trace and leave the claim incomplete; do not invent third-party arbitration.
6. **Detect capability-lane triggers.** Use the v0.4 capability lane when there are real direction forks, evidence-risk, mainline-risk, high-impact direction choices, or explicit "wings" / stronger-solution framing. Do not trigger it for routine cleanup, typo fixes, disposable work, pure status, or simple metadata updates.
7. **When capability lane triggers, record selection support before mainline.** Ensure a `direction-map.md` or equivalent direction section exists; fold selection findings into `findings.md` when debate ran; create an optional `evidence-contract.md` for claims that need observable support; and route high-risk mainline choices to must-read attention. Same-model debate must be labeled as structured scrutiny, not independent validation. Cross-agent output must keep source-agent traceability: finding ID, reviewer artifact path, primary decision, and follow-up artifact or reason.
8. **Write an attention report.** Separate must-read user-owned/high-risk decisions, needs-glance shared/medium-risk decisions, and collapsed low-risk agent-owned ledger entries. Do not omit collapsed decisions from the ledger.

## Writing the proposal artifact

Per CON-9 half-auto, ask the user "ready to write proposal artifacts? auto / step-through / skip / cancel-keeping-grill-and-debate".

On auto / step-through:

1. Write to `<substrate>/changes/<NNN>-<slug>/proposal.md` (or substrate's equivalent). The proposal contains, at minimum: the intent (in the user's own words), the boundary (in scope / out of scope as separate lists), non-goals, evidence required for completion, stop conditions (what would pause apply and require updating intent), decision ledger, risk routing summary, and attention report.
2. Link basis: reference the grill outputs and debate findings (if any) by file path. Do not inline them.
3. If capability lane triggered, add or link the direction map, selection findings, evidence contract, and `## Mainline Decision` section when the default path matters. Parked directions remain parked; rejected directions need a reason; unresolved evidence remains visible.
4. Add inherits-from: list prior change IDs that influenced this proposal (from step 4 of "Inputs to gather"). If none, omit.
5. If the substrate is docs mode and `steadyspec check` is available, run `steadyspec check <change-id-or-path> --phase proposal --substrate docs` after writing. If it fails, report the checker errors and do not describe the proposal as structurally ready.

On cancel-keeping-grill-and-debate: do not write the proposal artifact, but preserve any grill / debate output files for a later resumed propose-flow invocation.

## Read budget

Aggregate read across all reads in this verb invocation should stay under approximately 10,000 tokens unless the agent explicitly needs more. The history-fetch step is the largest consumer; summarize archive index entries, only read full archive bodies for the 1-3 most-related changes.

## Report

The verb's report contains:

- **Artifact location** (full path to proposal.md and any sibling artifacts created)
- **Docs check** (`steadyspec check --phase proposal`) result when substrate is docs mode
- **Intent** (the hardened one-line statement)
- **Boundary** (in scope / out of scope summary)
- **Evidence plan** (what proof is required for completion)
- **Capability lane** (not triggered, or direction map / findings / evidence contract / mainline decision paths)
- **Stop conditions** (what would pause apply)
- **Attention report** (must-read / needs-glance / collapsed ledger)
- **Decision ledger summary** (owner, risk, proof, and override path for meaningful decisions)
- **Basis** (grill ran? debate ran? findings file path)
- **Inherits-from** (prior change IDs)
- **Recommended next** — typically `/steadyspec:apply <NNN>-<slug>`; or "stay in propose to revise" if user wants to iterate

## Failure modes (consult while running)

- **FM-invented-decisions:** the proposal must not contain decisions that exploration / grill / debate / user confirmation did not justify. If a field needs filling and no source justifies a value, leave the field marked "unresolved" rather than synthesize.
- **FM-confident-language-over-uncertainty:** open questions and unresolved findings carry forward into the proposal explicitly, not buried in confident artifact prose.
- **FM-horizontal-tasks:** if implementation tasks are needed in the proposal, write them as vertical slices (one slice = one provable behavior). Do not write tasks as horizontal layers (DB → service → UI in sequence) when one vertical slice could prove the behavior end-to-end.
- **FM-risk-hidden-in-agent-choice:** a proposal must not hide high-risk decisions behind agent-owned "implementation detail" language. If a hard high-risk trigger applies, route the decision to the user and mark it must-read.
- **FM-capability-lane-on-trivial-work:** optional lane artifacts on routine cleanup are drift toward ceremony. Do not create them unless a trigger is present.
- **FM-same-model-as-independent-validation:** debate can sharpen the choice, but it must not be described as independent validation when the same agent/model supplied the scrutiny.

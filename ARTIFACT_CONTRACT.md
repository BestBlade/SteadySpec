# SteadySpec Workflow Artifact Contract

This file records the shared artifact contract for the Claude workflow scripts.
It is intentionally small and manual. The workflow scripts remain the source of
runtime behavior; this file names the formats they must agree on.

## Scope

Applies to:

- `en/runtime/claude/workflows/steadyspec-propose.js`
- `en/runtime/claude/workflows/steadyspec-apply.js`
- `en/runtime/claude/workflows/steadyspec-verify.js`
- `en/runtime/claude/workflows/steadyspec-archive.js`
- `en/runtime/claude/workflows/steadyspec-explore.js`

Does not apply to Codex runtime descriptors, primitive SKILL bodies, or project
substrate selection.

## Schema Version

New workflow-authored artifacts should include a visible schema marker when the
artifact has a structured format:

```markdown
schemaVersion: 1
```

Existing artifacts without this marker remain valid input. Workflow scripts must
treat missing schemaVersion as legacy format, not as corruption.

## Native Docs Substrate Contract

When a project uses `docs/changes/` as its primary substrate, SteadySpec owns a
minimal structural contract for its own docs-mode artifacts. OpenSpec-backed
projects still use OpenSpec's schema and lifecycle.

Docs-mode `init` installs:

```text
.steadyspec/substrates/docs/
  contract.json
  templates/
    proposal.md
    tasks.md
    evidence.md
    trust-checkpoint.md
    archive.md
```

The substrate state records:

```json
{
  "contract": {
    "name": "steadyspec-docs",
    "version": 1,
    "path": ".steadyspec/substrates/docs/contract.json",
    "templates": ".steadyspec/substrates/docs/templates"
  }
}
```

`steadyspec check <change-id-or-path> --phase proposal|apply|verify|archive
--substrate docs` validates structure, not semantic truth. Missing
`schemaVersion: 1` is a legacy warning. Missing required phase anchors, missing
required evidence/trust fields, and archive claims that convert fallback/debt
into proof are errors.

The checker is a support command, not a sixth governed verb.

## v0.4 Capability Lane

v0.4 adds an optional capability lane for changes where the problem is not only
drift, but premature selection of a low-ceiling direction. The lane is part of
the existing five verbs. It does not add a public verb and does not let the
agent own high-risk direction choices.

Trigger the lane only when at least one of these applies:

- `fork`: two or more plausible directions have serious support
- `evidence-risk`: the proposal depends on claims that need observable support
- `mainline-risk`: selecting a default path parks or rejects meaningful options
- `high-impact-direction`: the choice changes product thesis, public surface,
  architecture, storage, security, or long-lived workflow behavior
- `low-ceiling-risk`: the user asks for stronger solution search, "wings", or
  equivalent capability-amplification framing

Do not trigger it for routine cleanup, typo fixes, simple metadata updates,
pure status reports, scratch notes, or disposable work.

### direction-map.md

`direction-map.md` is optional. It records pre-mainline solution space when a
real fork exists. The minimum useful shape is:

```markdown
## Direction Map

| Direction | Status | Basis | Evidence Needed | Reopen Trigger |
|-----------|--------|-------|-----------------|----------------|
| <name> | candidate|promoted|parked|rejected | <source or reasoning> | <proof needed or None> | <when to reconsider> |
```

Explore may create a direction map, but explore must not promote a direction to
mainline. Promotion belongs to propose, with risk routing.

### evidence-contract.md

`evidence-contract.md` is optional. It is used when a mainline claim needs proof
before it can be trusted.

```markdown
## Evidence Contract

| Claim | Support Required | Falsifier | Source Label | Coverage Limit | Status |
|-------|------------------|-----------|--------------|----------------|--------|
| <claim> | <observable support> | <what would disprove or weaken it> | deterministic-check|manual-check|user-report|same-agent-review|external-review | <what this cannot prove> | proposed|supported|weakened|blocked |
```

Qualitative evidence is allowed only when its source label and coverage limit
are explicit. Same-model debate is structured scrutiny, not independent
validation.

### Selection Findings

When debate or selection runs, record the selection result in `findings.md` or
the substrate's equivalent finding record. Do not create a default
`selection-findings.md` file if the substrate already has a finding artifact.
Selection findings must separate:

- promoted direction
- parked directions
- rejected directions
- missing evidence
- human-owned or high-risk decisions
- independence limit when the same agent or same model supplied the review

### Mainline Decision

Use a `## Mainline Decision` section in proposal or archive when the default
path matters. Do not create a default `mainline-decision.md` file.

The section should name:

- selected mainline
- why it was selected
- what evidence supports it
- what remains parked
- what was rejected and why
- fallback or reopen trigger
- owner of any high-risk direction decision

## v0.3 Responsibility Model

v0.3 adds a responsibility layer to every governed verb. The layer does not
replace proposal, evidence, review, or archive artifacts. It makes their
decision ownership explicit.

### Decision Ownership Ledger

Meaningful decisions must be recorded as ledger entries. A decision is
meaningful when it affects user-visible scope, proof strategy, risk acceptance,
public interfaces, security posture, data/storage behavior, deletion,
fallback/debt, or archive truth.

```markdown
## Decision Ledger

| decisionId | phase | decision | owner | riskLevel | riskBasis | reversibility | proofSignal | overridePath | status |
|------------|-------|----------|-------|-----------|-----------|---------------|-------------|--------------|--------|
| D1 | propose | <decision> | agent|user|shared | low|medium|high | <why> | easy|moderate|hard|irreversible | <proof or None> | <how to override> | proposed|accepted|overridden|superseded |
```

Ledger entries must preserve:

- basis: source, evidence, or reasoning used
- alternatives: serious alternatives considered
- fallback/debt: residual risk, not proof

Low-risk agent-owned decisions may be collapsed in reports, but they must not be
omitted from the ledger.

### Risk Routing

The agent may classify decisions as low, medium, or high risk, but these hard
triggers always route to the user:

- public API, CLI, or runtime interface change
- migration, schema, storage, data-loss, or irreversible state change
- security, auth, permission, secret, sandbox, or network trust boundary
- deletion, behavior removal, or narrowing of a promised capability
- contradiction with proposal boundary, non-goal, stop condition, or accepted debt
- change spanning three or more modules/layers
- re-slicing that changes scope, proof strategy, or user-visible outcome
- archive claim that turns fallback/debt into proof

Agent judgment may increase risk. It may not downgrade a hard trigger.

### Attention Report

Every user-facing verb report should separate immediate attention from audit
trail:

```markdown
## Attention Report

### Must-read
- <high-risk or user-owned decision>

### Needs glance
- <medium-risk or shared decision>

### Collapsed ledger
- <low-risk agent-owned decision with basis and override path>
```

The report may be short. The underlying ledger must remain complete.

### Apply Re-slice Event

Apply may re-slice work only by recording a re-slice event:

```markdown
## Re-slice Event

| Field | Value |
|-------|-------|
| Type | proposal-gap|implementation-discovery|proof-split|user-override |
| Slice | <slice id or description> |
| Before | <previous scope/proof/slice shape> |
| After | <new scope/proof/slice shape> |
| Risk Level | low|medium|high |
| Owner | agent|user|shared |
| Proof Impact | <what proof changed> |
| User Decision | <required if high-risk or user-owned> |
```

Re-slicing that changes scope, proof strategy, or user-visible outcome is
high-risk and user-owned.

### Trust Checkpoint

The trust checkpoint is a pre-archive verification artifact. It is not an
archive and does not replace tests.

```markdown
## Trust Checkpoint

| Field | Value |
|-------|-------|
| Change | <change id> |
| Intent Match | pass|gap|blocked |
| Evidence Credibility | pass|gap|blocked |
| Risk Routing Review | pass|misclassified|blocked |
| Debt/Fallback Visibility | pass|gap|blocked |
| Recommended Next | continue|archive|handoff|re-open-intent|stop |
```

The checkpoint must name any proof claim that is too broad for its evidence.

### Handoff Snapshot

When work pauses, changes thread, or a user asks for status, the agent should be
able to create a handoff snapshot:

```markdown
## Handoff Snapshot

| Field | Value |
|-------|-------|
| Change | <change id and path> |
| Current Intent | <one sentence> |
| Boundary | <in scope / out of scope summary> |
| Ledger Summary | <must-read plus collapsed count> |
| Pending User Decisions | <high-risk/user-owned items> |
| Proof Signals | <passed/failed/missing> |
| Drift Events | <events or None> |
| Debt/Fallback | <accepted debt, fallback, or None> |
| Next Safest Action | <action> |
```

### Durable Truth Gates

Archive and strategy surfaces must keep truth durable:

- Archive citations to document sections must resolve to existing headings or
  anchors before archive write.
- Cross-change doc staleness should be surfaced as strategy-rollup input, not
  auto-edited.
- Structural rot can be consumed as external proof input. SteadySpec does not
  own linter, complexity, or architecture metric design in v0.3.

## Evidence Table Format

Each completed slice in `evidence.md` must use this table shape:

```markdown
## Slice N: <behavior>

| Field | Value |
|-------|-------|
| Proof Command | <proofCommand> |
| Result | <pass|fail|drift|fallback|blocked> |
| Output Summary | <summary> |
| Coverage Limit | <what this proof does not prove> |
| Fallback | <fallback or None> |
| Accepted Debt | <debt or None> |
```

Fallback is residual risk, not full proof.

## Grill Question Schema

`GRILL_QUESTION_SCHEMA` must require:

- `question`
- `recommendedAnswer`
- `resolvedBranch`

It must also expose `category` as an enum so downstream artifacts can distinguish
boundary, evidence, stop-condition, non-goal, safety, dependency, and other
questions.

## Debate Findings Schema

`FINDINGS_SCHEMA` must require:

- `decision`
- `basis`
- `status`
- `blindSpotResult`
- `missingEvidence`

Templates must not silently default `blindSpotResult` or `missingEvidence` to
placeholder text.

## Migration Adapter Contract

Every Claude workflow script that reads change artifacts must apply a legacy
evidence migration rule at gather time:

- If `evidence.md` already contains `| Field | Value |`, treat it as structured
  table evidence.
- If the header is absent, treat the content as legacy free-form evidence.
- Extract what can be extracted without deleting or rewriting the source.
- Mark missing fields as `evidence-migration-unavailable`.
- Re-running the adapter must be idempotent.

## Patch Dependency Order

1. Establish this contract and legacy evidence migration adapters.
2. Update propose workflow shape, debate triggers, and grill budget.
3. Update apply evidence writing and refactor proof validation.
4. Restore archive Gate 2 half-auto user confirmation.
5. Add explore no-substrate and context archaeology guards.
6. Validate syntax and package consistency.

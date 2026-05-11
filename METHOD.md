# SteadySpec Method

SteadySpec is an anti-drift method. The v1 package applies it to software spec-driven development, but the method itself is about any long-running work where intent, decisions, outputs, validation, and final records can move apart.

The core claim is simple: work does not usually fail because people never wrote an intent. It fails because later execution quietly edits the intent, decisions lose their owner, validation is mistaken for truth, and the final record is cleaned up until it no longer describes what happened.

Use this document as the portable method. Use `recipes/software-sdd.md` as the software reference implementation.

## Vocabulary

- Intent record: the durable statement of what the work is trying to achieve.
- Working medium: the place where intent and records live. In software it may be OpenSpec, plain docs, or issues. In other domains it may be a brief, outline, protocol, contract draft, or research plan.
- Unit of work: the smallest slice being produced or changed.
- Observable check: a concrete signal that something happened. It can be a test, replay, reviewer check, citation audit, user interview result, clause comparison, or artifact inspection.
- Output-vs-intent check: a review that asks whether the output satisfies the intent instead of merely asking whether the output looks good.
- Human-owned decision: a value, risk, priority, legal, ethical, or strategic decision that a process must record but cannot own.
- Finalized record: the closing record that says what is true after the work, including residual risk and accepted debt.

## 1. Intent Before Production

### Mechanism

Before producing output, write the intent in a form that can later be checked. The intent record does not need to be large. It needs to name the desired change, the boundary of the work, the evidence expected before completion, and the stop condition.

This prevents the most common drift: output accumulates, then the team retrofits a story that makes the output look intended.

### Example In Software SDD

`steadyspec-propose` records the change intent, evidence plan, stop conditions, and implementation boundary before `steadyspec-apply` changes code or durable docs.

### Transferable Shape

Before starting:
1. State the intended outcome.
2. State what is outside the work.
3. State what observable checks would make completion credible.
4. State when to stop or re-open intent.

## 2. Context Before Confidence

### Mechanism

When history is unclear, recover confirmed context before proposing or changing direction. Unknown history must stay labeled as unknown. Do not turn plausible memory into durable fact.

This prevents context drift: the group acts as though it remembers why earlier choices were made, but the record no longer supports that confidence.

### Example In Software SDD

`steadyspec-context-archaeology` separates confirmed history, missing context, stale assumptions, and constraints before a proposal, debate, or implementation pass.

### Transferable Shape

Before relying on history:
1. List confirmed facts with source links.
2. List unknowns separately.
3. Convert confirmed history into constraints.
4. Keep guesses out of the durable record.

## 3. Decision Pressure Before Agreement

### Mechanism

Before locking a direction, pressure-test the decision tree. Ask one hard question at a time. When there are competing directions, run a structured debate. Require breaking scenarios, alternatives, and blind-spot checks.

This prevents consensus drift: a group confuses quick agreement with tested agreement.

### Example In Software SDD

`steadyspec-grill` hardens unresolved design branches. `steadyspec-debate` separates proposer, challenger, moderator, and expert blind-spot passes, while declaring runtime isolation limits.

### Transferable Shape

Before agreement:
1. Ask what would break the current direction.
2. Ask what alternative would be better under that failure.
3. Separate local objections from strategic objections.
4. Record unresolved human-owned decisions instead of hiding them in process language.

## 4. Production With Nearby Checks

### Mechanism

Produce one minimal unit of work, run the nearest credible observable check, and record the result before moving on. If the output reveals the intent was wrong or incomplete, stop and update the intent instead of silently widening the work.

This prevents execution drift: production changes the target, but the record still claims the original target was followed.

### Example In Software SDD

`steadyspec-apply` defines a proof signal, makes a minimal implementation slice, runs the check, records evidence, and stops on drift. TDD is one special case where the observable check is an automated test.

### Transferable Shape

During production:
1. Work in small units.
2. Attach each unit to an observable check.
3. Record pass, fail, fallback, or blocked explicitly.
4. Stop when the check shows the intent needs revision.

## 5. Output-Vs-Intent Review

### Mechanism

After producing output, review against the original intent. Do not let attractive output, passing checks, or reviewer preference replace the question: did this satisfy the intent and boundaries?

This prevents validation drift: evidence proves one thing, but the team uses it to claim a broader truth.

### Example In Software SDD

`steadyspec-review-against-intent` checks implementation against intent, evidence gaps, residual debt, and whether doc-sync or archive can proceed.

### Transferable Shape

Before accepting output:
1. Compare output to each intent point.
2. Compare output to each stated boundary.
3. Mark evidence gaps separately from defects.
4. Do not treat fallback as proof.

## 6. Durable Record Sync

### Mechanism

When output changes what is true, update the durable record before the next phase depends on old truth. The record should say what was implemented, what was not, what changed, and what remains uncertain.

This prevents record drift: the work is real, but the durable record keeps describing a previous world.

### Example In Software SDD

`steadyspec-doc-sync` writes implemented truth back to specs, change records, tasks, or project-local docs after review and before archive.

### Transferable Shape

Before moving on:
1. Identify durable records that future workers will trust.
2. Update them with implemented truth.
3. Separate completed work, accepted debt, fallback, and open risk.
4. Leave source links to the evidence.

## 7. Finalization Without Truth Drift

### Mechanism

Closing work is a high-risk moment. People want a clean story. The final record must resist that pressure by preserving what actually happened, including incomplete items, fallback decisions, and human-owned risk acceptance.

This prevents archive truth drift: the archive becomes a success narrative instead of a reusable record.

### Example In Software SDD

`steadyspec-archive` verifies human decision records, review status, doc-sync, accepted debt, and follow-up links before closing the change.

### Transferable Shape

Before declaring work finalized:
1. List all items claimed complete and verify evidence.
2. Separate process outputs from human-owned decisions.
3. Mark fallbacks as residual risk, not validation.
4. Preserve unresolved debt with an owner or follow-up.

## 8. Local Signals To Strategy

### Mechanism

Repeated local friction is not always local. When the same kind of drift appears across work items, roll it up as a strategy signal for human review rather than repeatedly fixing symptoms.

This prevents strategy drift: local patches accumulate while the real operating model remains wrong.

### Example In Software SDD

`steadyspec-strategy-rollup` gathers repeated local signals, proposes doc updates, and hands value judgments to `steadyspec-human-decision-record`.

### Transferable Shape

When patterns repeat:
1. Group repeated failures or exceptions.
2. Name the larger assumption they challenge.
3. Recommend a human decision or durable process update.
4. Avoid turning one local incident into strategy without evidence.

## Using This Method Outside Software

To adapt SteadySpec to a new domain, map the vocabulary first:

1. What is the intent record?
2. What is the working medium?
3. What is the unit of work?
4. What counts as an observable check?
5. Who owns value or risk decisions?
6. What record will future workers trust after finalization?

Then copy the eight mechanisms, not the software nouns. A research paper, contract, product brief, or novel outline can all use the same anti-drift shape while using different records and checks.

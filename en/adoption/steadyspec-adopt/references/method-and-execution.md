# SDD And Execution Proof

This skill is SDD-centered, not TDD-centered.

```text
SDD preserves the change.
TDD-style loops prove the implementation.
```

## SDD Owns Intent

SDD answers:

- what is changing
- why it is changing
- what is out of scope
- which decisions were accepted
- which alternatives were rejected
- what evidence will prove completion
- whether implementation drifted from the original intent
- which historical constraints still matter

SDD artifacts can be specs, proposals, issues, design notes, decision records, or plain change documents. The substrate can vary; the intent discipline does not.

## SDD Keeps Scope Hard

Inside the selected design scope, every important branch needs one of:

- accepted decision
- rejected alternative
- blocker
- evidence requirement

Design-outside long tail should not expand the current change by default. Park it with trigger, risk, follow-up, and stop condition.

## SDD Reconstructs History Carefully

Use context archaeology before decisions that touch old or strange structures. Classify rationale as confirmed history, inferred rationale, obsolete rationale, or unknown context.

Only confirmed history becomes a constraint. Inference becomes a question or evidence gap.

## Execution Loops Produce Evidence

Use execution loops inside SDD apply work:

- clarification loop: ask one blocking question at a time; recommend an answer; inspect code/docs when they can answer
- grill loop: walk the decision tree one blocking question at a time
- feedback loop: define pass, fail, coverage limits, and fallback before claiming evidence
- diagnosis loop: reproduce first; build a pass/fail signal before guessing
- test-first loop: one behavior, one failing test, minimal implementation, refactor
- prototype loop: answer one design question; delete or absorb the prototype; record the conclusion
- vertical-slice loop: implement a narrow end-to-end behavior, not a horizontal layer

These loops do not replace the spec. They create evidence that the implementation satisfies the recorded intent.

Fallback is not full proof. It is a named residual risk with manual check, monitoring, follow-up, or stop condition.

## Drift Rule

If execution discovers that the intent is wrong or incomplete, stop and update the intent record before continuing.

Do not let tests, prototypes, or implementation edits silently redefine the change.

## Truth Recovery

After apply, run review against intent before archive. Check missing promised behavior, scope creep, weak evidence, fallback mislabeled as proof, silent drift, and accepted debt.

Then run doc sync. Durable records must describe the implemented truth, not the pre-implementation guess.

```text
Apply proves behavior.
Review checks intent fit.
Doc sync writes truth back.
Archive closes only after truth is durable.
```

## Human Responsibility

Humans should not read every implementation detail. They should review the decisions that require responsibility:

- value trade-off
- accepted risk
- accepted debt
- fallback approval
- roadmap movement
- architecture direction

The agent may recommend, but the human decision record must mark recommendation and confirmation separately.

## Strategy Signals

Local changes can produce strategic pressure. Roll up repeated drift, fallback, accepted debt, roadmap mismatch, architecture-map deltas, stale assumptions, and recurring evidence gaps into human-reviewable strategy signals.

Strategy rollup proposes updates; it does not decide strategy.

## Useful Formula

```text
Intent first.
Feedback during apply.
Evidence before done.
Spec update before drift continues.
Archive records truth.
```

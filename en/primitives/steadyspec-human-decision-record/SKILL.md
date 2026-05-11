---
name: steadyspec-human-decision-record
description: Create a human-confirmed decision record for SDD value judgments. Use when a change requires human responsibility for product value, risk acceptance, accepted debt, fallback approval, roadmap movement, architecture direction, or any decision that should not be hidden inside implementation evidence.
---

# SDD Human Decision Record

Method link: This skill records human-owned decisions described across [METHOD.md](../../../METHOD.md) sections 3 and 7, applied to software SDD.

Use when technical evidence is not enough because a human must own a value or risk judgment.

1. State the decision in one sentence.
2. List options considered and the agent recommendation.
   Do not disguise value judgment as technical proof.
3. Link evidence, constraints, review findings, fallback, debt, and strategy signals.
4. Name the value judgment: benefit, risk, cost, timing, user impact, or roadmap trade-off.
5. Ask for human confirmation when the decision changes scope, risk, debt, or strategic direction.
   Do not mark approval if it was only inferred.
6. Record:
   - decision
   - options
   - recommendation
   - evidence
   - accepted risk/debt/fallback
   - revisit trigger
   - confirmed_by: <human>
   - date
   Keep it short; do not turn it into a debate transcript or require it for trivial local choices.

Report the record location or proposed record text, whether `confirmed_by` is pending or filled, and what workflow step it unblocks.

## Failure Modes

- Fails when cost, timing, or user-impact trade-off is disguised as technical proof.
- Fails when evidence-link length substitutes for value judgment.
- Fails when risk acceptance is hidden inside fallback wording.

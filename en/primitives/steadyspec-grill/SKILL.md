---
name: steadyspec-grill
description: Stress-test an SDD plan or design by walking the decision tree one branch at a time. Use when a user has a plan, proposal, interface, architecture idea, or scope boundary that may look understood but still has unresolved decision dependencies.
---

# SDD Grill

Method link: This skill supports [METHOD.md](../../../METHOD.md) section 3, Decision Pressure Before Agreement, applied to software SDD.

Use when a plan/proposal artifact already exists, but the decision tree needs sharper understanding before debate, proposal, or implementation.

1. State the plan, known constraints, and current decision tree.
2. Ask one blocking question at a time.
   Do not ask multiple questions at once.
3. For each question, provide the recommended answer and why.
4. If code, docs, specs, or history can answer the question, inspect them instead of asking.
5. Resolve dependencies between decisions before moving to dependent branches.
6. Keep in-scope branches hard: accepted answer, rejected alternative, or explicit blocker.
   Do not accept vague answers when they affect scope, correctness, evidence, or stop conditions.
7. Put design-outside long tail into a parking lot with trigger, risk, and follow-up owner.
   Do not force long-tail concerns into current scope or treat recommendations as fact without support.

Report resolved decisions, unresolved blockers, parked long-tail concerns, updated constraints, and whether the next skill is `steadyspec-context-archaeology`, `steadyspec-debate`, `steadyspec-propose`, or stop.

## Failure Modes

- Fails when the user's framing is accepted as the only decision tree.
- Fails when an unasked branch is treated as unnecessary.
- Fails when a recommended answer becomes fact without support.

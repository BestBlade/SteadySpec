---
name: steadyspec-explore
description: Explore and clarify intent before an SDD change is proposed. Use when there is no plan/proposal artifact yet and requirements, terminology, boundaries, risks, or project context are unclear.
---

# SDD Explore

Method link: This skill supports [METHOD.md](../../../METHOD.md) section 1, Intent Before Production, applied to software SDD.

Use before proposal when there is no plan/proposal artifact yet and intent, terms, scope, risks, or constraints are unclear.

1. Read existing substrate context: docs, issues, specs, decisions, or code.
2. Ask one blocking question at a time.
   If code/docs can answer the question, inspect them instead of asking.
3. For each question, give a recommended answer and why.
4. Challenge fuzzy words when they affect scope or correctness.
5. Capture terms, constraints, non-goals, evidence needs, and open risks.
6. Hand off to `steadyspec-context-archaeology` for unclear history, `steadyspec-grill` for under-tested decision trees, `steadyspec-debate` for forked direction, or `steadyspec-propose` when clear.
   Do not implement or write proposal artifacts until intent can be stated in one paragraph.

Report clarified intent, boundary, non-goals, evidence expectations, open questions, and recommended next skill.

## Failure Modes

- Fails when vague terms are accepted because they sound familiar.
- Fails when available artifacts could answer but the user is asked anyway.
- Fails when exploration turns into proposal or implementation too early.

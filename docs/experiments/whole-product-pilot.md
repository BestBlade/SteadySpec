# SteadySpec Whole-Product Experiment Design Candidate

Status: design candidate only, not pre-registered. Sample size, assignment,
scoring rubric, thresholds, evaluator identity, exclusions, analysis rules, and
a frozen commit/date remain unresolved. No dataset, run, causal result, or
adoption claim exists.

This pilot asks whether SteadySpec's whole current product adds measurable value
beyond a capable Agent's ordinary workflow. It is separate from
[`protocol/EXPERIMENT.md`](../../protocol/EXPERIMENT.md), which evaluates only
the incremental v0.7 assurance layer.

## Question

For the same consequential software task, Agent/model version, tools,
permissions, repository snapshot, resource budget, and human authority model,
does using SteadySpec reduce silent purpose loss, unsupported completion claims,
human responsibility-decision effort, or interruption-recovery cost without
making blind final quality materially worse than the baseline?

This question does not ask whether SteadySpec produces unbiased or globally
optimal work.

## Initial evidence boundary

- single human operator;
- software repositories only;
- long tasks spanning multiple files and more than one change;
- at least one context compression, interruption, or handoff;
- no claim about teams, medical/legal decisions, hostile hosts, or all models.

## Arms

1. Same Agent using its ordinary strongest available workflow.
2. Same Agent and task using SteadySpec.
3. Optional calibration arm: same Agent using ordinary single-change SDD,
   separating SteadySpec's incremental value from planning/specification alone.

Before this design may be called pre-registered, task count, task selection,
assignment/counterbalancing, evaluator instructions, scoring rubric, material-
worse threshold, stable-improvement threshold, exclusion rules, missing-data
treatment, analysis method, freeze date, and exact commit must be fixed. The
evaluator should receive final artifacts without being told the arm when the
artifact format does not reveal it.

## Primary outcomes

- confirmed purpose items silently omitted or changed;
- false, stale, or unsupported completion claims;
- successful recovery to the confirmed target after interruption;
- active human minutes, interruption count, and escalation count;
- blind final quality and maintainability assessment;
- total elapsed time, Agent usage, and rework cost.

Artifact count, number of alternatives, validator success, and Agent consensus
are process observations, not primary success outcomes.

## Falsifiers and stop rules

The product hypothesis is weakened when repeated paired tasks show no stable
improvement on purpose fidelity, claim honesty, human effort, or recovery cost;
when any improvement depends on materially worse final quality; or when added
time/usage exceeds the declared value of the avoided failures.

Stop a run when the arms no longer share the same task or authority boundary,
the Agent/model/tool version changes mid-pair, required evidence is lost, or a
real-world high-risk action would be needed. Do not repair a failed run by
silently changing the metric or baseline.

## Interpretation boundary

A positive pilot would support a bounded claim for its task/model/operator
sample. It would not prove semantic correctness, global optimality, legal
sufficiency, independent review, external adoption, or effectiveness in other
domains. A negative result should be preserved and may justify simplifying,
replacing, or retiring mechanisms under the Product Contract's evolution rule.

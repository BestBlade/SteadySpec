# v0.7 Counterfactual Pilot Preregistration

Status: protocol only. No dataset, run, result, or causal claim ships in v0.7.

## Question

For long, interruption-prone agent tasks, does an implementation conforming to
the SteadySpec Assurance Protocol reduce silent requirement drift, human review
burden, or recovery cost compared with the strongest unassisted agent available
at run time?

## Design

- Select real tasks before observing outcomes; include multi-file work,
  interruption/context-loss recovery, and at least one negative or blocked
  outcome.
- Pair tasks by repository snapshot and acceptance target.
- Randomize assisted/unassisted order where carry-over can be controlled.
- Keep model, tool permissions, time/token budget, and operator authority equal.
- Blind final artifact assessment to condition when practical.
- Preserve failures and abandoned runs; do not replace them with cleaner reruns.

## Primary measures

- required intent items silently lost or changed;
- human interventions needed before a trustworthy final decision;
- correction and interruption-recovery cost;
- total elapsed time and token/tool cost;
- false-positive burden and unnecessary blocks.

## Minimum reporting

Report task selection, model/runtime versions, protocol implementation/version,
all exclusions, missing observations, paired raw outcomes, and effect estimates.
Separate deterministic evidence, human ratings, and agent self-report.

## Falsifiers

The product-value hypothesis is weakened if differences are unstable, if review
burden merely moves into protocol maintenance, if false blocks erase any
recovery benefit, or if the unassisted condition matches assisted outcomes at
lower total cost.

## Claim boundary

Until this pilot is run across more than one real project and more than one
model strength, SteadySpec MUST describe v0.7 as an experimental assurance
protocol candidate. Passing conformance is not evidence of causal benefit.

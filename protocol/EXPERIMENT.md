# v0.7 Counterfactual Pilot Preregistration

Status: protocol only. No dataset, run, result, or causal claim ships in v0.7.

## Question

For long, interruption-prone agent tasks, does adding an implementation
conforming to the SteadySpec Assurance Protocol reduce overstated readiness,
human review burden, or recovery cost compared with the same agent, authority,
and host workflow without assurance augmentation?

This is not an experiment on the value of SteadySpec's canonical five-flow
lifecycle, attention/responsibility routing, or capability-without-drift. A
whole-product comparison against an unassisted agent requires a separate
preregistration and measures for direction quality and low-ceiling answers.

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

- under blinded final assessment, the rate of `ready-for-human` claims that
  still contain an unmet required intent item, stale binding, or unsupported
  evidence claim;
- the rate at which an otherwise silent false/stale/unsupported readiness claim
  is converted into a blocking or remediation state;
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

The assurance-augmentation hypothesis is weakened if differences are unstable,
if review burden merely moves into protocol maintenance, if false blocks erase
any recovery benefit, or if the same workflow without assurance matches the
augmented outcomes at lower total cost.

## Claim boundary

Until this pilot is run across more than one real project and more than one
model strength, SteadySpec MUST describe v0.7 as an experimental assurance
protocol candidate. Passing conformance is not evidence of causal benefit and
the pilot cannot by itself validate or reject the wider SteadySpec product.

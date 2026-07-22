# SteadySpec Product Purpose and Continuity Contract

Contract version: 2. Descriptor schema version: 1. Status: normative product
purpose, current reference architecture, and evolution boundary for the
SteadySpec 0.x line.

This contract supersedes the pre-release v1 contract preserved under
[`docs/product-contract-history/v1/`](docs/product-contract-history/v1/). v1
correctly prevented a silent demotion of the five-flow lifecycle, but placed the
current architecture too close to the product's ultimate purpose.

## Operating premise: accountability remains external

SteadySpec is used when consequential work is delegated to AI agents and their
throughput may exceed what the responsible person can practically reperform or
inspect item by item. A human principal or organization still holds real-world
authority and bears consequences under the surrounding social, organizational,
or legal arrangement.

That accountability is an external operating premise, not an output of
SteadySpec. The method does not create, transfer, authenticate, satisfy, or
discharge responsibility, liability, informed approval, or actual
understanding. It does not assume that the human is technically superior to the
Agent.

## Product purpose: purpose-faithful capability realization

SteadySpec governs delegation to help an Agent:

- remain faithful to authorized purpose and constraints;
- challenge questionable assumptions, framing, and proposed means without
  silently changing that purpose;
- reduce avoidable capability loss from incomplete prompting, stale experience,
  premature low-ceiling convergence, execution drift, and misleading closure;
- keep completion claims within observed evidence and preserve unknowns,
  fallback, debt, and residual risk; and
- return value choices, accepted risk, irreversible authority, and final
  acceptance to the responsible human in an attention-scalable form.

This is a design objective and unvalidated product hypothesis, not a guarantee
of unbiased, optimal, correct, safe, or high-quality results.

## Stable core principles

### PC-1: Authorized-purpose fidelity

The Agent must distinguish the authorized outcome and hard constraints from the
prompt's factual assumptions, problem framing, and suggested implementation
means. It may challenge any layer and recommend reopening it. It must not adopt
a change to human-owned purpose, value, risk, or irreversible constraints
without explicit approval or recorded prior delegation.

Literal compliance is not purpose fidelity when the prompt is incomplete or
internally inconsistent. Inference is not authority when the purpose is unclear.

### PC-2: Challenge without usurpation

The Agent should expose stronger alternatives, current technical options,
counter-cases, and missing expertise before commitment when they may materially
improve the result. Deference must not silently lower the answer ceiling.

Challenge does not authorize unilateral override. A conflict with confirmed
purpose or constraints must be surfaced, recorded, and resolved by the owner or
within a previously delegated decision boundary before execution continues.

### PC-3: Capability realization without premature convergence

SteadySpec should reduce preventable loss of available Agent capability within
declared time, cost, tool, evidence, risk, and authority constraints. A cleanly
governed but avoidably weak answer is not the desired outcome.

No process can prove the global optimum or manufacture reality that neither the
human nor the Agent can observe. More debate, artifacts, or compute is not
automatically better.

### PC-4: Evidence-bounded claim integrity

Tests, review, debate, cross-agent agreement, conformance, and human acceptance
are bounded evidence inputs. None is semantic truth. Completion must be bound to
the exact candidate and observed coverage; unknowns, fallback, debt, and
residual risk must not be rewritten as proof.

### PC-5: Human authority is not semantic truth

The responsible human owns delegation scope, value priorities, accepted risk,
irreversible actions, final acceptance, merge, deployment, and release under
the surrounding authority model. The Agent may perform most analysis and
execution and may own bounded reversible decisions.

A human decision authorizes action inside that relationship; it does not prove
technical correctness, complete understanding, or legal sufficiency.

### PC-6: Attention routing is triage, not responsibility discharge

SteadySpec should not require a person to redo every mechanical step. It should
route must-read decisions, proof limits, unresolved intent, risk classification
basis, unknowns, debt, fallback, and override paths to the responsible person
while retaining auditable detail.

If that person cannot understand the basis needed for a consequential decision,
the correct next action is deeper review, an appropriate expert, narrower
delegation, or stop—not a cleaner summary followed by ceremonial approval.

## Current reference architecture

The stable core above is the product purpose and evaluation boundary. The
following are current normative means. They are protected public architecture,
not metaphysically permanent ends.

### Portable method reference

The eight mechanisms in [METHOD.md](METHOD.md), together with its rails-and-wings
responsibility and capability framing, are the current domain-neutral reference
method. They may evolve if the covered failure modes, transition, and evidence
boundary remain explicit.

### Software lifecycle reference

The current normative, compatibility-protected software lifecycle is:

```text
explore -> propose -> apply -> verify -> archive
```

It governs one software change and remains the shipped public architecture for
the 0.x line unless an explicit versioned migration changes it. It is a means
of realizing the product purpose, not the purpose itself.

A host goal, task, or plan may sequence multiple changes. SteadySpec retains
each change's own records and aggregates strategy signals, but defines no
goal-to-change lineage or completion semantics and does not own, authenticate,
or guarantee the host goal state.

### Implementation and assurance mechanisms

Skills, context archaeology, grill, debate, direction maps, evidence contracts,
proof, cross-review, closure, protocols, checkers, and runtime adapters support
parts of the reference method. Removing or replacing one does not necessarily
change the stable core, but its covered failure mode and migration must not
silently disappear.

The v0.6 closure engine and experimental v0.7 assurance protocol are optional,
risk-triggered claim-integrity support beneath `verify`, handoff, truthful
finalization, and archive readiness. Protocol conformance is narrower than
SteadySpec product or method conformance and is not a successor to the method or
five verbs.

## Effectiveness and evidence boundary

SteadySpec has not demonstrated causal improvement over a strong Agent baseline.
Current implementation, conformance, and dogfood evidence is primarily bounded
to declared single-operator software environments. Transfer to teams,
non-software domains, or materially different authority models is an unvalidated
hypothesis.

A whole-product comparison must hold Agent, model version, tools, authority,
repository state, and task sufficiently constant and measure outcomes such as
silent purpose loss, unsupported completion claims, blind output quality,
human intervention time, recovery success/cost, and total task cost. Passing
repository validators does not answer that question.

## Evolution and authority boundary

Any change to the stable core or current reference architecture is a high-risk,
human-owned product decision. Before it is presented as product direction it
requires:

1. a product contract version change;
2. an explicit human decision record;
3. an old-to-new failure-mode and coverage map;
4. a compatibility, deprecation, or migration plan;
5. an evidence boundary and unresolved-risk record; and
6. changelog and release-evidence entries that preserve the prior contract.

Agents, reviewers, benchmarks, debate, and multi-Agent consensus may recommend
such a change but cannot authorize it. Deterministic validation makes declared
contract and architecture changes visible; it cannot authenticate the human,
prove informed approval, judge whether the new design is better, or transfer
liability.

## Explicit non-claims

SteadySpec does not promise unbiased output, the global optimum, semantic
correctness, safety, independent review, informed consent, legal sufficiency,
external adoption, or freedom from human or Agent error. It does not prove that
its current mechanisms are the best possible architecture. Its claim is
narrower: these are explicit principles and current means for governing
delegation, with bounded evidence and visible responsibility decisions.

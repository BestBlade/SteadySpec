# SteadySpec Product Continuity Contract

Contract version: 1. Status: normative product-identity boundary for the
SteadySpec 0.x line.

This compact contract exists because a technically consistent change can still
redefine the product it was supposed to improve. It binds the stable product
intent that each change must preserve or explicitly reopen. It does not prove
that SteadySpec is effective, that an agent followed the contract, or that a
person approved a change.

## PI-1: Long-running work, not only final claims

SteadySpec addresses long-running work in which intent, context, decisions,
outputs, evidence, responsibility, and durable records can drift apart. Its
scope is the governed path from exploration through truthful finalization and
cross-change strategy signals. Assurance of one final snapshot is useful but is
not the whole product problem.

## PI-2: Five canonical software change verbs

The canonical governed lifecycle for one software change is:

```text
explore -> propose -> apply -> verify -> archive
```

Primitives, checkers, cross-agent review, closure engines, protocols, and
runtime adapters support this lifecycle. They are not additional governed verbs
and do not replace or demote it.

A longer objective may use a host agent's goal, task, or planning facility to
sequence multiple changes. SteadySpec retains each change's own intent and
evidence records, handoff truth, and prior decisions, and aggregates
cross-change strategy signals. It does not define goal-to-change lineage or
completion semantics, and it does not own, authenticate, or guarantee the host
goal state.

## PI-3: Human attention and final responsibility

The human retains responsibility for value, risk, direction, accepted debt,
acceptance, archive, merge, and release decisions. Agents may own bounded,
reversible implementation detail. SteadySpec should concentrate human attention
on decisions that need it instead of requiring the person to inspect every
mechanical step.

Machine readiness, test success, same-model debate, cross-agent convergence,
and protocol conformance are evidence inputs. None is semantic truth or a
transfer of final responsibility.

## PI-4: Capability without drift

SteadySpec is not only a brake. Context archaeology, grill, debate, direction
mapping, evidence contracts, and cross-agent scrutiny help a capable agent avoid
a coherent but low-ceiling answer chosen too early. This matters when the human
cannot supply a perfect prompt, current technical options, implementation
expertise, or temporary cross-domain knowledge.

These mechanisms expand and pressure-test the answer space while keeping
high-risk direction choices human-visible. They cannot manufacture unprovided
reality or guarantee expert correctness.

## PI-5: Assurance is additive claim-integrity support

Review and proof are lifecycle quality mechanisms. The v0.6 closure engine and
experimental v0.7 assurance protocol add bounded automation and constrain what
may be claimed about an exact candidate. Closure and assurance are optional,
risk-triggered support for `verify`, handoff, truthful finalization, and archive
readiness. They do not govern the whole change lifecycle and are not successors
to the five verbs.

Assurance protocol conformance is narrower than SteadySpec method or product
conformance. The old v0.6 closure state format may be projected through a lossy,
non-conformant compatibility surface; that does not make the v0.6 closure
product, the five flows, or their workflow contracts legacy.

## PI-6: Product-identity changes are human-owned

Changing any of the following is a high-risk, human-owned product decision:

- the product problem or primary value proposition;
- the five canonical verbs or their lifecycle role;
- the human/agent responsibility boundary;
- the role of attention routing or capability without drift;
- whether a support mechanism replaces or demotes the governed lifecycle;
- a previously promised user-facing capability or stable public surface.

An agent, external review, benchmark, Critic, debate, or multi-agent consensus
may propose such a change but cannot authorize it. Approval must be explicit and
must be recorded in the proposal, changelog, and release evidence before the
change is presented as product direction.

Deterministic validation binds the contract version, exact normalized content,
canonical verb list, and additive assurance role so changes are visible. It
cannot authenticate the human actor or prove that approval was informed.

## Evolution boundary

This contract does not freeze implementation details or claim the five verbs
are metaphysically permanent. It prevents a routine or autonomous change from
silently redefining them. A future human-owned strategy decision may version
this contract, preserve the prior contract in history, state what is being
removed or demoted, and provide an explicit migration and evidence boundary.

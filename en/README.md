# SteadySpec

### Governed agent work with visible responsibility

Substrate-agnostic SDD methodology built around drift defense. This package is standalone: humans read it to understand the method; agents configure and install it for a target runtime.

SteadySpec v0.7.0 is source-distributed. The canonical software change lifecycle
is `explore -> propose -> apply -> verify -> archive`; attention/responsibility
and capability-without-drift remain part of the product. The experimental
assurance protocol is optional claim-integrity support, not a successor to the
five flows. Their relationship is bound by [../PRODUCT.md](../PRODUCT.md). It is not
published to the npm registry. Use only the official Git repository pinned to a
trusted tag or commit; do not use a registry install or `npx steadyspec`.

The normative protocol candidate is
[`../protocol/ASSURANCE_PROTOCOL.md`](../protocol/ASSURANCE_PROTOCOL.md). Its
strongest claim, `ready-for-human`, is bounded input to a human checkpoint, not
acceptance, semantic truth, merge, or release authority. Existing runtime
workflows are not yet claimed as thin conformant adapters.

The root README is the current English product overview. The `zh/` directory
contains the maintained Chinese overview and operating guide.

## Purpose

This package adds a drift-defense layer to SDD workflows with proof-gated execution:

```text
Intent first.
Feedback during apply.
Evidence before done.
Spec update before drift continues.
Archive records truth.
```

It is not tied to OpenSpec or any single spec substrate. It runs on plain docs, OpenSpec, issue trackers, or project-local protocols, and hardens the SDD lifecycle so agents do not silently turn intent, decisions, evidence, or archive truth into something else. TDD-style loops, diagnosis, prototypes, and vertical slices are execution proof tools inside this lifecycle.

For the domain-neutral method, read [../METHOD.md](../METHOD.md). For adaptations, see [software-sdd.md](../recipes/software-sdd.md) and [research-paper.md](../recipes/research-paper.md).

## Drift Covered

- Intent -> implementation drift: `steadyspec-apply`, `steadyspec-review-against-intent`.
- Decision -> record drift: `steadyspec-human-decision-record`, `steadyspec-doc-sync`.
- Context/history drift: `steadyspec-context-archaeology`, `steadyspec-grill`.
- Consensus/architecture drift: `steadyspec-debate`, governed proposal path.
- Archive truth drift: `steadyspec-archive`.
- Repeated local drift becoming strategy signal: `steadyspec-strategy-rollup`.

## Skill Layers

See [phases.md](phases.md). Keep this list single-source; do not duplicate the phase index in every skill.

## Agent Configuration

When a user asks an agent to use this package in a project, the agent should:

1. Clone the official repository, pin a trusted tag or commit, run
   `npm run validate`, build with `npm pack`, and install that local tarball.
2. Start from `steadyspec-adopt`.
3. Choose a governance level from [adoption-guide.md](adoption/steadyspec-adopt/references/adoption-guide.md).
4. Choose a substrate from [substrates.md](adoption/steadyspec-adopt/references/substrates.md): plain docs, OpenSpec, or existing issues/docs.
5. Use `steadyspec-workflow` when unsure which phase should run next.

The init command auto-detects `.claude/` or `.codex/`; pass `--runtime claude`
or `--runtime codex` to override. `assurance` is an independent experimental
protocol process with a narrower conformance boundary. The lifecycle support
CLI provides docs `check`,
`cross-review`, `closure`, and `hooks`; these are support commands, not new
governed verbs. There is no top-level `update`, project-level `uninstall`, or
general `status` command.

## Human Reading Path

For the assurance protocol, read
[`../protocol/ASSURANCE_PROTOCOL.md`](../protocol/ASSURANCE_PROTOCOL.md), its
[`schemas`](../protocol/schemas/), static
[`conformance cases`](../protocol/conformance/cases.jsonl), and the
[`preregistered experiment`](../protocol/EXPERIMENT.md). These pre-1.0 surfaces
are experimental and may change incompatibly under a new `protocolVersion`.

For method study, read:

1. [adoption-guide.md](adoption/steadyspec-adopt/references/adoption-guide.md)
2. [method-and-execution.md](adoption/steadyspec-adopt/references/method-and-execution.md)
3. [steadyspec-context-archaeology](primitives/steadyspec-context-archaeology/SKILL.md), to see how the workflow avoids pretending to know project history.
4. [steadyspec-grill](primitives/steadyspec-grill/SKILL.md), to see how in-scope design branches stay hard while long-tail concerns are parked.
5. [steadyspec-apply](primitives/steadyspec-apply/SKILL.md), to see how proof signals stay close to implementation.
6. [steadyspec-review-against-intent](primitives/steadyspec-review-against-intent/SKILL.md) and [steadyspec-doc-sync](primitives/steadyspec-doc-sync/SKILL.md), to see how truth is recovered after implementation.
7. [steadyspec-human-decision-record](primitives/steadyspec-human-decision-record/SKILL.md) and [steadyspec-strategy-rollup](primitives/steadyspec-strategy-rollup/SKILL.md), to see how human responsibility and strategy signals are handled.

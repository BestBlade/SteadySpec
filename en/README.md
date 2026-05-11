# SteadySpec

### Anti-drift methodology — packaged for software SDD, applicable beyond

Substrate-agnostic SDD methodology built around drift defense. This package is standalone: humans read it to understand the method; agents configure and install it for a target runtime.

SteadySpec v1 is a reference implementation of a general anti-drift method in the software spec-driven-development setting. The npm package is the fastest way to feel the method in a real code project; it is not the boundary of the method.

v0.1 ships in English. Chinese localization will be reintroduced through a generator path; do not hand-translate.

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

1. Run `npx steadyspec init`.
2. Start from `steadyspec-adopt`.
3. Choose a governance level from [adoption-guide.md](adoption/steadyspec-adopt/references/adoption-guide.md).
4. Choose a substrate from [substrates.md](adoption/steadyspec-adopt/references/substrates.md): plain docs, OpenSpec, or existing issues/docs.
5. Use `steadyspec-workflow` when unsure which phase should run next.

The init command auto-detects `.claude/` or `.codex/`; pass `--runtime claude` or `--runtime codex` to override. V1 supports `init` only. `check`, `upgrade`, and `uninstall` are not implemented; use normal file operations for those until the CLI grows those commands.

## Human Reading Path

For method study, read:

1. [adoption-guide.md](adoption/steadyspec-adopt/references/adoption-guide.md)
2. [method-and-execution.md](adoption/steadyspec-adopt/references/method-and-execution.md)
3. [steadyspec-context-archaeology](primitives/steadyspec-context-archaeology/SKILL.md), to see how the workflow avoids pretending to know project history.
4. [steadyspec-grill](primitives/steadyspec-grill/SKILL.md), to see how in-scope design branches stay hard while long-tail concerns are parked.
5. [steadyspec-apply](primitives/steadyspec-apply/SKILL.md), to see how proof signals stay close to implementation.
6. [steadyspec-review-against-intent](primitives/steadyspec-review-against-intent/SKILL.md) and [steadyspec-doc-sync](primitives/steadyspec-doc-sync/SKILL.md), to see how truth is recovered after implementation.
7. [steadyspec-human-decision-record](primitives/steadyspec-human-decision-record/SKILL.md) and [steadyspec-strategy-rollup](primitives/steadyspec-strategy-rollup/SKILL.md), to see how human responsibility and strategy signals are handled.

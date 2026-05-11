# SteadySpec

### Anti-drift methodology - packaged for software SDD, applicable beyond

SteadySpec v1 is a reference implementation of a general anti-drift method in the software spec-driven-development setting. The npm package is the fastest way to feel the method in a real code project; it is not the boundary of the method.

Use it with plain docs, OpenSpec, issue trackers, or project-local protocols when agents need guardrails against intent drift, evidence drift, decision drift, and archive drift. Humans read [METHOD.md](METHOD.md) to understand the portable method; agents configure and install the software SDD reference implementation for a target runtime.

v0.1 ships in English. Chinese localization will be reintroduced through a generator path; do not hand-translate.

## What This Is

- **A portable anti-drift method** — eight mechanisms that apply to any long-running work where intent, decisions, output, and records can diverge. The method lives in [METHOD.md](METHOD.md) and does not depend on this npm package.
- **A reference implementation for software SDD** — concrete agent skills (`steadyspec-*`) that apply the method to spec-driven development. This package is one way to use the method, not the only way.
- **Governance on a gradient** — four levels from zero-governance to project-local protocol. You choose the weight; the skills enforce what you chose, not what we prefer.
- **Substrate-agnostic** — works alongside OpenSpec, plain docs, or issue trackers. SteadySpec owns the anti-drift process; the substrate owns the records.

## What This Is Not

- **Not an OpenSpec replacement or competitor.** OpenSpec manages specs, proposals, and tasks. SteadySpec adds drift-defense guardrails that OpenSpec deliberately leaves open. The two are designed to coexist.
- **Not a project management tool.** No backlog, no sprints, no velocity tracking. SteadySpec only asks: did intent survive contact with reality?
- **Not a testing framework.** TDD, integration tests, and linters produce evidence. SteadySpec does not run them — it checks that evidence exists and matches intent.
- **Not production-grade software.** v0.1 is alpha. It ships `init` only. `check`, `upgrade`, and `uninstall` are not yet implemented. Breaking changes may occur before 1.0.
- **Not claiming universality.** The method is opinionated about drift prevention. The governance levels are configurable. Use what works; ignore what doesn't.

## Layout

```text
steadyspec/
  METHOD.md
  recipes/
    software-sdd.md
    research-paper.md
  en/
    adoption/
    router/
    primitives/
```

- `METHOD.md`: domain-neutral anti-drift method.
- `recipes/`: concrete mappings from the method to a working domain.
- `adoption/`: choose drift-defense strength, working medium, evidence level, and localization path.
- `router/`: route a request by observed SDD state and drift risk.
- `primitives/`: small phase skills for intent, history, decision, implementation, evidence, doc-sync, archive, human responsibility, and strategy drift.
- High-risk proposal work uses `steadyspec-propose/references/governed-proposal-path.md` instead of a separate flow layer.

## Drift Covered

- Intent -> implementation drift: `steadyspec-apply`, `steadyspec-review-against-intent`.
- Decision -> record drift: `steadyspec-human-decision-record`, `steadyspec-doc-sync`.
- Context/history drift: `steadyspec-context-archaeology`, `steadyspec-grill`.
- Consensus/architecture drift: `steadyspec-debate`, governed proposal path.
- Archive truth drift: `steadyspec-archive`.
- Repeated local drift becoming strategy signal: `steadyspec-strategy-rollup`.

## Agent Setup

When asked to use this package in a project, the agent should:

1. Run `npx steadyspec init`.
2. Start configuration from the installed `steadyspec-adopt`.
3. Use `steadyspec-workflow` when the next SDD phase is unclear.

The init command auto-detects `.claude/` or `.codex/`; pass `--runtime claude` or `--runtime codex` to override. V1 command scope is also shown by `npx steadyspec --help`. Current v1 ships `init`; `check`, `upgrade`, and `uninstall` are not implemented.

Init writes SteadySpec state to `.steadyspec/substrate.json`. This is SteadySpec-owned state, not substrate-owned state. It is safe to delete; rerun `npx steadyspec init` to recreate it.

## OpenSpec And Other Skills

SteadySpec is not an OpenSpec replacement. In an OpenSpec project, the recommended v0.1 posture is:

1. OpenSpec owns the substrate: proposal files, tasks, specs, and local OpenSpec conventions.
2. SteadySpec owns the anti-drift process: governance level, proof-gated apply, output-vs-intent review, doc sync, archive truth, human decisions, and strategy rollup.
3. If both OpenSpec and SteadySpec skills are installed and the next step is unclear, start with `steadyspec-workflow`.
4. Use native `openspec-*` skills for OpenSpec-only maintenance. Use `steadyspec-*` skills when drift defense is part of the work.

SteadySpec is compatible with general skill packs such as TDD, diagnosis, review, or productivity skills. Those skills can produce proof signals or execution help; they do not replace SteadySpec intent, review, and archive records.

## Upgrade And Uninstall

V0.1 does not ship `update` or `uninstall` commands.

To upgrade manually:

1. Remove installed SteadySpec skills: `.claude/skills/steadyspec-*` or `.codex/skills/steadyspec-*`.
2. Rerun `npx steadyspec@latest init`.
3. Keep `.steadyspec/substrate.json` unless you want init to re-detect the substrate from scratch.

To uninstall manually, remove the installed `steadyspec-*` skill directories, remove `.steadyspec/`, and delete the `<!-- steadyspec -->` block from `CLAUDE.md` or `AGENTS.md`.

## Stability

V0.1 is alpha. Before 1.0, breaking changes may still happen, but SteadySpec intends to keep these surfaces stable unless a release note explicitly says otherwise:

- Skill names: `steadyspec-adopt`, `steadyspec-workflow`, and the current `steadyspec-*` primitive names.
- METHOD.md structure: the eight mechanism sections remain addressable; content may expand.
- CLI meaning: `steadyspec init` installs the local runtime skills and writes project state.
- State schema: `.steadyspec/substrate.json` uses `schemaVersion: 1`; fields may be added, not silently removed, within that schema version.

Breaking changes are recorded in [CHANGELOG.md](CHANGELOG.md).

## Method First

Read [METHOD.md](METHOD.md) to learn the domain-neutral anti-drift mechanisms. Read [recipes/software-sdd.md](recipes/software-sdd.md) to see how this package maps the method into software SDD skills. Read [recipes/research-paper.md](recipes/research-paper.md) for a compact non-software transfer example.

## Human Reading Path

Inside the chosen language tree, read these first:

1. `en/adoption/steadyspec-adopt/references/adoption-guide.md`
2. `en/adoption/steadyspec-adopt/references/method-and-execution.md`
3. `README.md` inside the chosen language tree

## Acknowledgments

- Skill format and structure inspired by [Matt Pocock's agent skills](https://github.com/mattpocock/skills) (MIT).
- Runtime installation patterns learned from the OpenSpec CLI ecosystem.
- Anti-drift methodology is original work; any flaws in its application to SDD are ours.

## License

MIT — see [LICENSE](LICENSE).

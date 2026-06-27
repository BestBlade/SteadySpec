# SteadySpec

### A method for working with agents - and keeping responsibility visible

[中文版本](zh/README.md) | [中文方法论文档](zh/METHOD.md)

Long-running work with AI agents has a quiet failure mode: the agent slowly edits the intent, decisions lose their owner, validation is mistaken for truth, and the final record is cleaned up until it no longer describes what happened. SteadySpec is an anti-drift method that names eight mechanisms to prevent this. It was built by applying the method to itself.

> **Start here:** [METHOD.md](METHOD.md) — the portable thought (8 mechanisms, domain-neutral). Then [EVIDENCE.md](EVIDENCE.md) — the dogfood record (failure + success, compressed). If you want to try the method in a real project, this repo also ships a reference skill pack for software SDD: five verb-flows that orchestrate primitives with drift gates, responsibility routing, and trust checkpoints. See [SCOPE.md](SCOPE.md) for boundaries before installing.

The reference skill pack (`/steadyspec:explore` / `:propose` / `:apply` / `:verify` / `:archive`) wraps a spec workflow with closed-loop orchestration: explore routes attention to active risk, propose records a decision ledger and risk routing, apply executes slice-by-slice with proof-linked decisions and explicit re-slice events, verify runs a trust checkpoint before archive or handoff, and archive runs review + doc-sync + confirmed_by + durable truth gates before writing. It coexists with OpenSpec, plain docs, or issue trackers. The method is substrate-aware: OpenSpec owns its own schema, docs mode can use SteadySpec's native structural contract/checker, and issue trackers remain experimental.

## v0.3 Attention & Responsibility Model

v0.3 makes responsibility explicit. Meaningful decisions are recorded in a decision ownership ledger, routed by risk, and reported in attention-ranked form: must-read user-owned/high-risk decisions first, needs-glance shared/medium-risk items next, and low-risk agent-owned decisions collapsed but still auditable. The model is defined in [ARTIFACT_CONTRACT.md](ARTIFACT_CONTRACT.md).

## v0.4 Docs Contract And Capability Lane

v0.4 adds two guarded extensions. First, docs mode is now contract-backed for SteadySpec's own artifacts: `init` installs a native docs contract and templates, and `steadyspec check` rejects missing anchors, incomplete evidence fields, invalid trust checkpoint shape, and archive claims that turn fallback or debt into proof. Second, high-uncertainty work may use an optional capability lane inside the same five verbs: direction forks can be mapped, mainline choices can be pressure-tested, evidence contracts can bind claims to proof, and archive can preserve promoted, parked, and rejected directions.

The capability lane is not autonomy and not a sixth verb. High-risk direction, public surface, data, security, and mainline decisions remain user-owned or user-visible through the responsibility model.

## Docs substrate check

Docs-backed projects can use `steadyspec check <change-id-or-path> --phase proposal|apply|verify|archive --substrate docs` to validate SteadySpec's docs-mode artifact structure. This is a deterministic support check, not a sixth governed verb and not a semantic proof that the work is correct.

## Quick start

See [QUICKSTART.md](QUICKSTART.md) for install + the five verbs + manual cleanup checklist. Below is just enough to orient.

```bash
npm install -g steadyspec
cd my-project
steadyspec init
```

Then in your agent (Claude Code or Codex):

```
/steadyspec:explore           # status report (no topic) or topical exploration
/steadyspec:propose <intent>  # write a proposal with grill + debate when needed
/steadyspec:apply <change-id> # implement slice-by-slice with drift gates
/steadyspec:verify <change-id> # run a trust checkpoint before archive or handoff
/steadyspec:archive <change-id> # close with review + doc-sync + confirmed_by + durable truth gates
```

Vibe mode (no slash command) remains valid; SteadySpec stays out of the way.

## Reference implementation boundaries

The reference skill pack is alpha. Full matrix in [SCOPE.md](SCOPE.md).

- **Agent capability:** optimized for **Tier 2** agents (DeepSeek-V4-Pro, Claude Sonnet 4.5+, GPT-4o-class). Tier 3 is **not promised.**
- **Single developer:** designed for one author per change. "Human" means **future-you or a successor.**
- **User-invoked:** SteadySpec does not auto-detect drift. It provides verbs you call.
- **Small CLI:** `init` installs SteadySpec; `check` validates docs-mode artifact structure. There is no `update`, `uninstall`, or `status`. Removal is manual + `npm uninstall -g`.
- **Issue-tracker substrate remains experimental:** v0.4 adds docs-mode structure; GitHub issues / Jira / Linear are still external records.

## Layout

```text
steadyspec/
  METHOD.md             # domain-neutral anti-drift method
  SCOPE.md              # tier matrix, single-developer assumption, no-promise list
  QUICKSTART.md         # 5 verbs + install + manual cleanup
  README.md             # this file
  CHANGELOG.md
  recipes/
    software-sdd.md     # map the method to software SDD
    research-paper.md   # non-software transfer example
  en/
    flows/              # 5 verb-flow SKILLs
      steadyspec-explore-flow/
      steadyspec-propose-flow/
      steadyspec-apply-flow/
      steadyspec-verify-flow/
      steadyspec-archive-flow/
    primitives/         # 11 primitive SKILLs (sharp + lean, called by verb-flows)
    router/             # steadyspec-workflow (internal router, called by verb-flows)
    adoption/           # steadyspec-adopt (governance level chooser)
    runtime/
      claude/
        commands/steadyspec/         # 5 thin-pointer slash commands
        workflows/                   # 5 deterministic execution scripts
      codex/agents/                  # 5 yaml interface descriptors (Codex)
  bin/
    init.js             # CLI entrypoint: init + docs-mode check
    docs-check.js       # deterministic docs substrate checker
    validate.js         # internal package validator
  manifest.json         # install spec
  package.json
```

## Drift covered

The five verb-flows + their primitives address these drift kinds:

- **Intent → implementation drift:** propose-flow + apply-flow drift detection + archive-flow review-against-intent gate
- **Decision → record drift:** propose/apply maintain a decision ledger; verify/archive check ownership and confirmed_by records for human-owned decisions
- **Context / history drift:** propose-flow auto-loads context-archaeology; explore-flow status mode aggregates historical signals
- **Consensus / architecture drift:** propose-flow auto-runs debate when direction forks or boundary is unsharp
- **Doc / code drift:** archive-flow doc-sync auto-scan with `must-update` / `should-check` / `unlikely` confidence levels
- **Repeated local drift becoming strategy signal:** archive-flow rollup-trigger check (≥3 of last 10 archived mention same module/keyword) auto-surfaces strategy-rollup

## Coexistence with OpenSpec and other skill packs

In an OpenSpec project:

1. OpenSpec owns the substrate (proposal files, tasks, specs, archive structure).
2. SteadySpec owns the anti-drift orchestration (the five verb-flows).
3. SteadySpec writes change records into OpenSpec's substrate (`openspec/changes/<id>/`), respecting OpenSpec conventions.
4. If both `openspec/` and `docs/changes/` exist, init prompts you to choose — or pass `--substrate openspec` / `--substrate docs` to bypass the prompt.

SteadySpec is compatible with general skill packs (TDD, diagnosis, review, productivity). Those skills can produce proof signals or execution help; they do not replace SteadySpec intent, review, and archive records.

## Upgrade and removal

SteadySpec ships `init` and a docs-mode structural `check`. There is no `update` or `uninstall` CLI command. To upgrade or remove SteadySpec, see [QUICKSTART.md](QUICKSTART.md). Global package removal is `npm uninstall -g steadyspec`.

## Stability

v0.4-alpha is alpha. Before 1.0, breaking changes may still happen, but SteadySpec intends to keep these surfaces stable unless [CHANGELOG.md](CHANGELOG.md) says otherwise:

- Outward verb names: `/steadyspec:explore`, `/steadyspec:propose`, `/steadyspec:apply`, `/steadyspec:verify`, `/steadyspec:archive`.
- Verb-flow SKILL names: `steadyspec-<verb>-flow`.
- Primitive SKILL names: current `steadyspec-*` names.
- METHOD.md structure: the eight mechanism sections remain addressable; content may expand.
- CLI meaning: `steadyspec init` installs the runtime skills, verb-flows, runtime adapters, docs contract/templates when docs mode is selected, and writes project state. `steadyspec check` validates docs-mode artifact structure and known archive truth hazards.
- State schema: `.steadyspec/substrate.json` uses `schemaVersion: 1`; fields may be added, not silently removed, within that schema version.

## Method first

Read [METHOD.md](METHOD.md) to learn the domain-neutral anti-drift mechanisms. Read [recipes/software-sdd.md](recipes/software-sdd.md) to see how this package maps the method into software SDD verbs and primitives. Read [recipes/research-paper.md](recipes/research-paper.md) for a compact non-software transfer example.

## Human reading path

If you are evaluating the method:

1. [METHOD.md](METHOD.md) — the portable anti-drift thought (8 mechanisms, domain-neutral)
2. [EVIDENCE.md](EVIDENCE.md) — the dogfood record (what happened when the method was applied to itself)
3. [SCOPE.md](SCOPE.md) — does the reference skill pack fit your project?
4. [QUICKSTART.md](QUICKSTART.md) — what daily use looks like

If you are an agent inheriting a project with SteadySpec installed:

1. The installed `steadyspec-adopt` SKILL — to understand governance level
2. The installed `steadyspec-workflow` SKILL — to know which verb-flow runs next
3. The five `steadyspec-<verb>-flow` SKILLs in your runtime's `skills/` directory

# SteadySpec

### Opinionated drift-defense orchestration on top of OpenSpec — for Tier 1/2 single-author projects

> **Read [SCOPE.md](SCOPE.md) before adopting.** SteadySpec narrows OpenSpec's audience (Tier 2+ agents, single developer per change, no issue-tracker substrate yet) in exchange for stronger drift gates and a closed-loop verb-flow. If your project doesn't fit those boundaries, SteadySpec is not the right tool.

SteadySpec wraps OpenSpec's four outward verbs (`/steadyspec:explore` / `/steadyspec:propose` / `/steadyspec:apply` / `/steadyspec:archive`) with closed-loop orchestration. OpenSpec manages the artifact substrate (proposal / design / tasks / archive). SteadySpec adds anti-drift gates around each verb: explore auto-loads project history, propose runs grill + (optional) debate, apply executes slice-by-slice with TDD discipline and pauses on drift, archive runs review + doc-sync auto-scan + confirmed_by gate before writing.

The npm package is the fastest way to feel the method in a real code project. It is not the boundary of the method — read [METHOD.md](METHOD.md) for the domain-neutral anti-drift method underneath.

## Quick start

See [QUICKSTART.md](QUICKSTART.md) for install + the four verbs + manual cleanup checklist. Below is just enough to orient.

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
/steadyspec:archive <change-id> # close with review + doc-sync + confirmed_by gates
```

Vibe mode (no slash command) remains valid; SteadySpec stays out of the way.

## Boundaries (read before adopting)

SteadySpec v0.2-alpha is alpha. Boundaries are explicit. Full matrix in [SCOPE.md](SCOPE.md).

- **Agent capability:** optimized for **Tier 2** agents (DeepSeek-V4-Pro, Claude Sonnet 4.5+, GPT-4o-class). Tier 3 (smaller / older models) is **not promised** to trigger skills reliably.
- **Single developer:** designed for one author per change. "Human" in the skills means **future-you or a successor**, not a teammate. Multi-person team workflows are not validated.
- **User-invoked, not background:** SteadySpec does not auto-detect drift. It provides verbs you call when drift is suspected.
- **`init` only CLI:** no `update`, no `uninstall`, no `check` in v0.2-alpha. Removal is by manual checklist (in QUICKSTART) + `npm uninstall -g steadyspec`. Reason for no per-project uninstall: a file-touching uninstall is a data-loss risk we won't take in v0.2-alpha.
- **No issue-tracker substrate yet:** GitHub issues / Jira / Linear deferred to v0.3.

If any of these does not match your situation, see [SCOPE.md](SCOPE.md) for the decision checklist before installing.

## Layout

```text
steadyspec/
  METHOD.md             # domain-neutral anti-drift method
  SCOPE.md              # tier matrix, single-developer assumption, no-promise list
  QUICKSTART.md         # 4 verbs + install + manual cleanup
  README.md             # this file
  CHANGELOG.md
  recipes/
    software-sdd.md     # map the method to software SDD
    research-paper.md   # non-software transfer example
  en/
    flows/              # 4 verb-flow SKILLs (orchestration, NEW in v0.2-alpha)
      steadyspec-explore-flow/
      steadyspec-propose-flow/
      steadyspec-apply-flow/
      steadyspec-archive-flow/
    primitives/         # 11 primitive SKILLs (sharp + lean, called by verb-flows)
    router/             # steadyspec-workflow (internal router, called by verb-flows)
    adoption/           # steadyspec-adopt (governance level chooser)
    runtime/
      claude/commands/steadyspec/    # 4 thin-pointer slash commands (Claude)
      codex/agents/                  # 4 yaml interface descriptors (Codex)
  bin/
    init.js             # the only CLI command in v0.2-alpha
    validate.js         # internal package validator
  manifest.json         # install spec
  package.json
```

## Drift covered

The four verb-flows + their primitives address these drift kinds:

- **Intent → implementation drift:** propose-flow + apply-flow drift detection + archive-flow review-against-intent gate
- **Decision → record drift:** apply-flow records evidence per slice; archive-flow confirmed_by gate for human-owned decisions
- **Context / history drift:** propose-flow auto-loads context-archaeology; explore-flow status mode aggregates historical signals
- **Consensus / architecture drift:** propose-flow auto-runs debate when direction forks or boundary is unsharp
- **Doc / code drift:** archive-flow doc-sync auto-scan with `must-update` / `should-check` / `unlikely` confidence levels
- **Repeated local drift becoming strategy signal:** archive-flow rollup-trigger check (≥3 of last 10 archived mention same module/keyword) auto-surfaces strategy-rollup

## Coexistence with OpenSpec and other skill packs

In an OpenSpec project:

1. OpenSpec owns the substrate (proposal files, tasks, specs, archive structure).
2. SteadySpec owns the anti-drift orchestration (the four verb-flows).
3. SteadySpec writes change records into OpenSpec's substrate (`openspec/changes/<id>/`), respecting OpenSpec conventions.
4. If both `openspec/` and `docs/changes/` exist, init prompts you to choose — or pass `--substrate openspec` / `--substrate docs` to bypass the prompt.

SteadySpec is compatible with general skill packs (TDD, diagnosis, review, productivity). Those skills can produce proof signals or execution help; they do not replace SteadySpec intent, review, and archive records.

## Upgrade and removal

v0.2-alpha ships `init` only. There is no `update` or `uninstall` CLI command. To upgrade or remove SteadySpec, see [QUICKSTART.md](QUICKSTART.md). Global package removal is `npm uninstall -g steadyspec`.

## Stability

v0.2-alpha is alpha. Before 1.0, breaking changes may still happen, but SteadySpec intends to keep these surfaces stable unless [CHANGELOG.md](CHANGELOG.md) says otherwise:

- Outward verb names: `/steadyspec:explore`, `/steadyspec:propose`, `/steadyspec:apply`, `/steadyspec:archive`.
- Verb-flow SKILL names: `steadyspec-<verb>-flow`.
- Primitive SKILL names: current `steadyspec-*` names.
- METHOD.md structure: the eight mechanism sections remain addressable; content may expand.
- CLI meaning: `steadyspec init` installs the runtime skills, verb-flows, runtime adapters, and writes project state.
- State schema: `.steadyspec/substrate.json` uses `schemaVersion: 1`; fields may be added, not silently removed, within that schema version.

## Method first

Read [METHOD.md](METHOD.md) to learn the domain-neutral anti-drift mechanisms. Read [recipes/software-sdd.md](recipes/software-sdd.md) to see how this package maps the method into software SDD verbs and primitives. Read [recipes/research-paper.md](recipes/research-paper.md) for a compact non-software transfer example.

## Human reading path

If you are evaluating SteadySpec for adoption:

1. [SCOPE.md](SCOPE.md) — does this fit your project?
2. [QUICKSTART.md](QUICKSTART.md) — what does daily use look like?
3. [METHOD.md](METHOD.md) — what is the underlying method?
4. `recipes/software-sdd.md` — how does the method map to the four verbs?

If you are an agent inheriting an existing SteadySpec project:

1. The installed `steadyspec-adopt` SKILL — to understand governance level.
2. The installed `steadyspec-workflow` SKILL — to know which verb-flow runs next.
3. The four `steadyspec-<verb>-flow` SKILLs in your runtime's `skills/` directory.

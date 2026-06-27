# SteadySpec Quick Start

SteadySpec is a reference skill pack of the anti-drift method. Five outward verbs, each a small closed-loop with anti-drift gates and responsibility routing. Read [SCOPE.md](SCOPE.md) before adopting.

## Install

```bash
npm install -g steadyspec
```

Then in your project directory:

```bash
steadyspec init
```

Auto-detects `.claude/` or `.codex/` in your project. Pass `--runtime claude` or `--runtime codex` to override. If both `openspec/` and `docs/changes/` exist, init prompts which substrate is canonical (`--substrate openspec` or `--substrate docs` to bypass the prompt). For docs-mode projects, `init` also installs a structural contract and templates under `.steadyspec/substrates/docs/`.

## The five verbs

Run any of these once to enter spec-aware mode for the session. The agent stays SteadySpec-aware until the session ends.

| Verb | When to use | Example |
|------|-------------|---------|
| `/steadyspec:explore` | Ask "what's the project state, what debt, what's next" (no topic), OR think through a topic with project history loaded (with topic) | `/steadyspec:explore` for status; `/steadyspec:explore "refactor auth"` for topical |
| `/steadyspec:propose` | Record intent for new work; auto-runs context-archaeology + grill + (optionally) debate to converge on a verified direction | `/steadyspec:propose "unify session timeout"` |
| `/steadyspec:apply` | Implement a recorded change slice-by-slice; pauses on drift; offers in-place intent patch | `/steadyspec:apply 099` |
| `/steadyspec:verify` | Run a trust checkpoint before archive, handoff, or risky continuation | `/steadyspec:verify 099` |
| `/steadyspec:archive` | Close a change; auto-runs review-against-intent + doc-sync auto-scan + confirmed_by gate + durable truth gates + rollup-trigger check | `/steadyspec:archive 099` |

Vibe mode (no slash command) is also valid — SteadySpec stays out of the way.

## Docs-mode support check

For plain docs changes, run:

```bash
steadyspec check <change-id-or-path> --phase proposal --substrate docs
steadyspec check <change-id-or-path> --phase apply --substrate docs
steadyspec check <change-id-or-path> --phase verify --substrate docs
steadyspec check <change-id-or-path> --phase archive --substrate docs
```

`check` validates required docs-mode structure, evidence fields, trust checkpoint fields, and archive truth hazards such as fallback/debt being presented as proof. It is a support command, not a sixth governed verb and not a replacement for `/steadyspec:verify`.

## Optional capability lane

Most changes do not need extra artifacts. When a change has real direction forks, evidence-risk, mainline-risk, high-impact product or architecture choices, or the user explicitly asks for stronger solution search, the five verbs may use the v0.4 capability lane:

- `explore` or `propose` can create an optional `direction-map.md`.
- `propose` can add selection findings and an optional `evidence-contract.md`.
- `apply` records which evidence-contract claim each slice supports.
- `verify` checks whether evidence supports the mainline claim.
- `archive` preserves promoted, parked, and rejected directions, with a `Mainline Decision` section when the default path matters.

This lane is optional and should not appear on routine cleanup, typo fixes, or disposable work.

### Workflow scripts (Claude Code only, v0.2.1+)

After `init`, `.claude/workflows/` contains deterministic execution scripts (`steadyspec-*.js`) that mirror the verb-flow logic with explicit phase gating and schema-validated output. The package includes the trust-checkpoint workflow `steadyspec-verify.js`. These are invoked via Claude Code's Workflow tool rather than slash commands.

## Uninstall

SteadySpec does not provide a project-level uninstall command — it would risk deleting your work. Removal is two layers:

**Global package** (one command):

```bash
npm uninstall -g steadyspec
```

**Per-project residue** (manual cleanup, in each project where you ran `steadyspec init`):

```bash
# From the project root, remove SteadySpec's own files only
rm -rf .claude/skills/steadyspec-*
rm -rf .claude/commands/steadyspec
rm -rf .claude/workflows/steadyspec-*
rm -rf .codex/skills/steadyspec-*
rm -rf .steadyspec
# Then open CLAUDE.md and/or AGENTS.md and delete the block between
# <!-- steadyspec --> and <!-- /steadyspec --> if present.
```

**Do NOT delete** your own work: `openspec/` (if you use OpenSpec), `docs/changes/<NNN>-*` directories with your change records, your project's existing `CLAUDE.md` content outside the SteadySpec block.

## Read next

- [SCOPE.md](SCOPE.md) — agent tier matrix, single-developer assumption, what SteadySpec does NOT promise.
- [METHOD.md](METHOD.md) - the portable anti-drift method. The five verbs are one implementation; the method extends.
- [README.md](README.md) — full product overview, OpenSpec coexistence guidance, stability surface.

# SteadySpec Quick Start

SteadySpec is a reference skill pack of the anti-drift method. Four outward verbs, each a small closed-loop with anti-drift gates. Read [SCOPE.md](SCOPE.md) before adopting.

## Install

```bash
npm install -g steadyspec
```

Then in your project directory:

```bash
steadyspec init
```

Auto-detects `.claude/` or `.codex/` in your project. Pass `--runtime claude` or `--runtime codex` to override. If both `openspec/` and `docs/changes/` exist, init prompts which substrate is canonical (`--substrate openspec` or `--substrate docs` to bypass the prompt).

## The four verbs

Run any of these once to enter spec-aware mode for the session. The agent stays SteadySpec-aware until the session ends.

| Verb | When to use | Example |
|------|-------------|---------|
| `/steadyspec:explore` | Ask "what's the project state, what debt, what's next" (no topic), OR think through a topic with project history loaded (with topic) | `/steadyspec:explore` for status; `/steadyspec:explore "refactor auth"` for topical |
| `/steadyspec:propose` | Record intent for new work; auto-runs context-archaeology + grill + (optionally) debate to converge on a verified direction | `/steadyspec:propose "unify session timeout"` |
| `/steadyspec:apply` | Implement a recorded change slice-by-slice; pauses on drift; offers in-place intent patch | `/steadyspec:apply 099` |
| `/steadyspec:archive` | Close a change; auto-runs review-against-intent + doc-sync auto-scan + confirmed_by gate + rollup-trigger check | `/steadyspec:archive 099` |

Vibe mode (no slash command) is also valid — SteadySpec stays out of the way.

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
rm -rf .codex/skills/steadyspec-*
rm -rf .steadyspec
# Then open CLAUDE.md and/or AGENTS.md and delete the block between
# <!-- steadyspec --> and <!-- /steadyspec --> if present.
```

**Do NOT delete** your own work: `openspec/` (if you use OpenSpec), `docs/changes/<NNN>-*` directories with your change records, your project's existing `CLAUDE.md` content outside the SteadySpec block.

## Read next

- [SCOPE.md](SCOPE.md) — agent tier matrix, single-developer assumption, what SteadySpec does NOT promise.
- [METHOD.md](METHOD.md) — the portable anti-drift method. The four verbs are one implementation; the method extends.
- [README.md](README.md) — full product overview, OpenSpec coexistence guidance, stability surface.

# Changelog

## 0.2.0 (alpha)

- **NEW: 4 outward verb-flow SKILLs** under `en/flows/steadyspec-<verb>-flow/SKILL.md`. Each verb is a small closed-loop orchestrating primitives — `explore-flow` aggregates project status or thinks topically; `propose-flow` runs grill + (optional) debate before writing a proposal; `apply-flow` runs slice-by-slice with TDD discipline and 4-option drift handling; `archive-flow` runs review + doc-sync auto-scan + confirmed_by gate before writing the archive.
- **NEW: Claude slash commands** under `en/runtime/claude/commands/steadyspec/<verb>.md` (4 thin pointers to verb-flow SKILLs). Installs to `<project>/.claude/commands/steadyspec/`.
- **NEW: Codex yaml interface descriptors** under `en/runtime/codex/agents/steadyspec-<verb>-flow.yaml` (4, asymmetric — only verb-flows have yaml, primitives do not). Installs to `<project>/.codex/skills/<flow>/agents/openai.yaml`.
- **NEW: SCOPE.md** declaring Tier 1/2/3 agent matrix (DeepSeek-V4-Pro as Tier 2 baseline), single-developer assumption, no-promise list.
- **NEW: QUICKSTART.md** with install + 4 verbs + manual cleanup checklist.
- **NEW: `init.js` substrate-conflict prompt** — when both `openspec/` and populated `docs/changes/` exist and no `--substrate` flag is passed, init asks user which is canonical. `--substrate openspec` / `--substrate docs` bypasses the prompt.
- **NEW: `init.js` `docs/changes/` creation** when no substrate detected.
- **NEW: `init.js` quick-start output** — prints next-step commands after install.
- **NEW: validator rules** — CJK ban in `en/`; required root files (now 8); verb-flow SKILL must reference ≥1 primitive; primitive SKILL byte-equivalence to git HEAD. **The byte-equivalence rule enforces source-repo developer discipline; it does NOT protect end-user installations from skill modifications, since published packages do not contain `.git` and the rule is skipped there.**
- **NON-GOAL: no `steadyspec uninstall` CLI command.** Removal is by manual checklist in QUICKSTART.md + `npm uninstall -g steadyspec`. Reason: a per-project file-touching uninstall is a data-loss risk we won't take in v0.2-alpha.
- **NON-GOAL: no edits to existing primitive / router / adoption SKILLs in v0.2-alpha.** Source-repo validator enforces byte-equivalence (developer discipline; not user-facing).
- **NON-GOAL: issue-tracker as substrate.** Deferred to v0.3.
- **DEFERRED to v0.3:** quantitative adopt-heuristic triggers in `explore-flow` (require `lastAdopt` baseline schema); `archive-flow` Gate 4 schema-driven completeness check (currently best-effort agent judgment).
- **Stability surface:** see README.md "Stability" section.

## 0.1.0

- Initial alpha package for SteadySpec.
- Ships the domain-neutral anti-drift method in `METHOD.md`.
- Ships the software SDD reference implementation as `steadyspec-*` skills.
- Ships compact recipes for software SDD and research-paper transfer.
- Supports `steadyspec init` for Claude and Codex skill installation.

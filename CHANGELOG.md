# Changelog

## 0.2.1 (alpha)

- **NEW: 4 deterministic Workflow execution scripts** under `en/runtime/claude/workflows/steadyspec-*.js`. Each script mirrors its verb-flow SKILL.md logic but replaces agent-inferred orchestration with deterministic JavaScript execution: `pipeline()` / `parallel()` / `agent()` with JSON Schema-validated structured output. Installs to `<project>/.claude/workflows/` (Claude runtime only; Codex has no Workflow concept).
- **NEW: `manifest.json` `workflows` array** + `install.workflows.claude` source/target paths.
- **NEW: `init.js` `installClaudeWorkflows()`** — copies workflow `.js` files into the project for Claude runtime. Codex path unaffected.
- **NEW: apply workflow `verify` mode** (`--verify`, `args.mode: "verify"`) — re-runs proof signals for already-complete slices to verify they still pass without requiring new implementation.
- **NEW: all 4 workflows accept optional `changeDir` arg** — prioritizes explicit path over substrate.json over auto-detect. Auto-detect now includes `.meta/changes/` alongside `openspec/changes/` and `docs/changes/`.
- **FIXED: propose workflow grill prompt** — realigned with grill SKILL.md parking-lot semantics. Parked items are now explicitly NOT new questions; only genuinely unresolved dependencies qualify.
- **FIXED: archive workflow Gate 1** — now correctly identifies self-referential evidence (requirements that can only be satisfied by archive workflow's own completion) as PASS rather than blocker.
- **NON-GOAL: no edits to verb-flow or primitive SKILL files.** Workflows are a separate execution layer.

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

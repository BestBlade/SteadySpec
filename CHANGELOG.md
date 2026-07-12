# Changelog

## 0.5.0 (Windows single-user)

v0.5 ships the cross-agent lane for one operator on Windows. Codex and
Claude hosts route review work to the opposite agent family through short
project-scoped hooks and a file-coupled request. macOS/Linux execution,
multi-user defaults, crash-time run metadata, and branch-diff ancestry remain
future product-maturity work.

- **NEW (Windows single-user): project-scoped Claude and Codex host hooks.** Real `UserPromptSubmit` and `Stop` hooks remain silent outside explicitly opted-in repositories and turns. `--cross-review-hooks ask|auto` selects mode-choice or file-coupled peer routing; `steadyspec hooks install|status|uninstall` preserves sibling host settings. Hooks do not launch long reviewer processes.
- **NEW (Windows single-user): opposite-family peer routing.** Codex primary work routes to Claude, and Claude primary work routes to Codex with the explicit compatibility flag. A same-host second pass is not accepted as cross-agent evidence.
- **CHANGED: long Stop auto-runs replaced by file-coupled routing.** Draft prototypes allowed a Stop hook to launch a reviewer synchronously for up to nine minutes. v0.5 hooks return within 30 seconds, create durable state, and inject the exact peer command for the primary agent to execute in the same task. This avoids long lifecycle handlers while preserving one-conversation automation.
- **NEW (Windows single-user): `steadyspec cross-review`.** Level 1 cross-agent review runner that packages a change, invokes a local auxiliary reviewer, preserves raw output, and creates a moderation artifact.
- **NEW (Windows single-user): install-time cross-review config.** `steadyspec init --cross-review manual` writes `.steadyspec/cross-review.json` with reviewer defaults and env variable names.
- **NEW (Windows single-user): cross-agent artifact contract.** Adds `packet.md`, `prompt.md`, `raw.md`, streamed partial stdout/stderr, `moderation.md`, and `run.json` semantics, including an Agent Trace Record rule for who proposed each finding and how the primary agent resolved it.
- **NEW (Windows single-user): `--check-latest --json`.** Support check for reviewer success, structured output, completed moderation, scope freshness, warnings, and errors. macOS/Linux smoke testing remains a future cross-platform support task.
- **NEW (Windows single-user): `--advice --json`.** Lightweight Level 2 advisory check for hook/flow surfaces. It recommends whether to run cross-review without invoking a reviewer.
- **NEW (Windows single-user): `--gate --json`.** Minimal Level 3 gated check. In `--cross-review gated` mode, recommended reviews block with exit `5` until a successful moderated run exists; the gate still does not invoke the reviewer and is not a calibrated multi-user default.
- **NEW (Windows single-user): cross-review signal threshold.** `.steadyspec/cross-review.json` supports `minSignals`, and `steadyspec init --cross-review-min-signals <n>` can write it, so projects can observe and tune advisory/gated recommendations before adopting gated mode.
- **NEW (Windows single-user): verbose advice calibration.** `--advice --verbose --json` emits `signalDetails` so operators can inspect which recommendation signals fired and which high-risk terms were negated before tuning `minSignals` or enabling gated mode.
- **NEW (Windows single-user): batch advice calibration.** `--calibrate-dir <dir> --verbose --json` evaluates advice signals across a directory of changes without invoking reviewers and reports per-change `signalCount` plus a histogram for tuning `minSignals`.
- **NEW (Windows single-user): configurable risky path signals.** `.steadyspec/cross-review.json` supports `riskyPathPatterns` so other projects can tune path-based advice/gate signals to their own runtime, schema, migration, or public documentation surfaces.
- **NEW (Windows single-user): configurable scope noise filter.** `.steadyspec/cross-review.json` supports `scopeIgnorePatterns` for explicit generated working-tree noise. Matching repo-relative paths are omitted from packet git status, untracked diff sections, advice status signals, and scope fingerprints when the noise appears only through those sections; runtime and manual/advisory defaults remain empty, while gated init writes a starter OS/editor temp list.
- **NEW (Windows single-user): `--run-if-needed --json`.** Flow-friendly executor that invokes the reviewer only when recommendation signals require review and the latest run is missing or unusable. Add `--force` to refresh an already usable or warning-bearing run. It writes moderation artifacts but does not classify findings automatically.
- **NEW (Windows single-user): packet-only reviewer mode.** `--packet-only` inlines the review packet into the prompt and runs Claude with `--bare` plus disallowed file/edit/shell tools. `steadyspec init --cross-review gated` writes `packetOnly: true` by default. This reduces local-context contamination but is not an OS sandbox.
- **NEW (Windows single-user): packet scope transparency.** Review packets include active scope-ignore patterns, omitted git-status/untracked path counts, and sensitive/oversized/unreadable untracked omission counts so packet-only reviewers can challenge suspicious scope shaping.
- **NEW (Windows single-user): sanitized packet defaults.** `packet.md` and `prompt.md` use repo-relative paths by default; `run.json` remains a local audit artifact and may contain absolute paths.
- **UPDATED: diff-aware review scope.** `--include-diff` now packages branch, staged, unstaged, and untracked changes instead of only the unstaged tracked diff. Sensitive or oversized untracked file contents are omitted from packets.
- **UPDATED: scoped evidence checks.** `run.json` records a packet scope fingerprint and `diffCoherent`; latest checks, gates, and `--run-if-needed` only accept runs matching the current reviewer/mode/include-diff/packet-only scope, and non-coherent diff captures become pass-with-warning evidence.
- **UPDATED: diff evidence quality.** `run.json` records `diffAtomicity`; current `--include-diff` runs are `multi-command-status-only` and latest checks report pass-with-warning for diff-content quality until an atomic snapshot path exists.
- **UPDATED: gate routing.** Gate JSON reports `action: "moderation-required"` when a reviewer run exists but moderation is still incomplete.
- **UPDATED: moderation diagnostics.** `--check-latest` warns when reviewer finding IDs are missing from the moderation table, and reviewer-original P1/P2 checks now handle Markdown-emphasized finding IDs/severities.
- **UPDATED: moderation diagnostics.** P1/P2 rejected findings with weak or placeholder moderation reasons now make `--check-latest` pass with warning, and gated mode blocks them instead of silently treating the review as high-confidence evidence.
- **UPDATED: moderation parser.** Moderation decision rows now use the markdown table header to locate `Finding ID`, `Severity`, and `Moderator Decision`, so adding columns does not silently break latest checks.
- **UPDATED: raw output contract.** New runs record `rawSchemaVersion: 1`; versioned raw output requires the `## STDOUT` marker, and numbered-findings fallback now requires explicit numbered or labeled severity findings instead of loose severity tables or any free-text `P1`/`P2`/`P3`.
- **UPDATED: findings-table classifier.** Loose findings-table fallback now requires the finding ID and P1/P2/P3 severity to appear in the same table row, avoiding cross-table false positives.
- **UPDATED: review hardening.** Advisory negation handles common exclusion verbs, denied-context warnings return human-readable labels, obvious boundary-restatement lines are ignored by the denied-context scanner, sensitive untracked omission covers common package/cloud/IaC credential filenames without hiding arbitrary `auth`/`token` design files, heading-style `Severity: P1/P2/P3` findings are parsed, and implementation references fail closed when package identity cannot be verified.
- **UPDATED: advice term matching.** High-risk artifact terms now use word/phrase boundaries so substrings such as `author` or `archival` do not fire `auth` or `archive`.
- **UPDATED: advice command notes.** Advice JSON now includes `suggestedCommandNotes` so suggested implementation-review commands carry the `--include-diff`/`diffCoherent` caveat before a flow executes them.
- **UPDATED: debate advice signal.** Debate mode appears in `signalDetails`, but it contributes to `signalCount` only when `--experimental-debate` is present; non-experimental debate requests no longer inflate recommendations by themselves.
- **UPDATED: reviewer prompt contract.** Reviewer prompts now explicitly require `F1`, `F2`, ... finding IDs and ask for a `Boundary Disclosure` section when denied context was attempted, accidentally used, or unavoidable.
- **UPDATED: boundary-warning handling.** Denied-context scans now suppress pure boundary restatements but keep actual or possible access disclosures scannable, while public docs state that gated denied-context blocking is pattern-based evidence rather than sandbox proof.
- **UPDATED: validator messaging.** `npm run validate` now prints fixture-only cross-review coverage in stdout and stderr so package structural validity is not mistaken for real reviewer or POSIX smoke evidence.
- **UPDATED: POSIX command lookup and timeout hardening.** The POSIX `which` result is now verified as an executable file before use; otherwise the runner falls back to PATH scanning. Timeout cleanup now attempts POSIX process-group signaling, but macOS/Linux smoke evidence remains open.
- **UPDATED: output directory safety.** Runs with a custom `--output-dir` outside the repository now record a warning that init-time `**/cross-agent/` `.gitignore` protection does not cover those artifacts.
- **UPDATED: gate warning policy.** Gated mode now has an explicit `WARNING_CLASSIFICATION_MAP` for block/pass warning policy and blocks unrecognized latest-run warnings until they receive a documented gate decision.
- **UPDATED: gate warning policy.** Validator coverage now checks direct literal `warnings.push(...)` producers against `WARNING_CLASSIFICATION_MAP`, reducing drift between emitted warnings and gate policy. Generic warning-map entries with `policy: "block"` now block gated mode, including `--dangerously-inherit-env` and timeout-with-structured-output warnings.
- **UPDATED: run-if-needed docs.** README and Quickstart now state that `--run-if-needed` can launch the reviewer and consume Claude/Codex quota or API budget; use `--advice --json` for dry hook checks.
- **UPDATED: gated/runtime safety.** Non-Windows reviewer execution and gates now require explicit `--experimental-posix` while POSIX smoke remains open, Claude reviewer runs refuse CLI versions below the tested minimum, gated mode blocks conflicting `No findings: confirmed` moderation, sensitive untracked omissions include the omitted filename, and docs clarify that `--include-diff` is a hard scope discriminator but not atomic diff evidence.
- **UPDATED: moderation parsing.** Moderation decision tables now require a recognizable header; missing/malformed headers are unreadable instead of falling back to fixed column positions.
- **UPDATED: gated needs-user routing.** P1/P2 findings marked `needs-user`, or reviewer-original P1/P2 findings missing moderation rows, now produce gate JSON `status: "needs-user"` with `action: "user-confirmation-required"` instead of collapsing into generic blocked/no-accepted-finding states.
- **GUARDED: POSIX runtime path.** On non-Windows platforms, reviewer execution and gates require `--experimental-posix`; opted-in reviewer execution records a warning that POSIX support is implemented but smoke-untested for v0.5, and process-group timeout cleanup remains part of that smoke gap.
- **GUARDED: reviewer compatibility.** Claude CLI and Codex CLI reviewer paths both have completed Windows runs with structured output and primary moderation. Codex reviewer mode remains behind `--experimental-codex` because an automated Codex CLI version-safety check is not implemented.
- **GUARDED: debate reviewer execution.** Debate packets can be generated, and v0.5 has a completed Windows smoke, but real debate-mode reviewer execution still requires `--experimental-debate` until the mode is deliberately graduated. Advice and gate checks may inspect debate-mode scope without the flag because they do not invoke reviewers.
- **NEW: Agent Collaboration Mode selection.** Propose/debate/grill flows should ask whether to use `solo`, `grill`, `cross-review`, or `debate` when no project default is clear, and cross-agent modes must preserve traceable reviewer output plus primary moderation.
- **NON-GOAL: no automatic moderation.** v0.5 can advise, gate readiness claims, or run the reviewer when explicitly asked through `--run-if-needed`; moderation remains a primary-agent responsibility. Stronger high-risk classification and cross-platform proof remain future work.
- **NON-GOAL: no third-party arbitration.** v0.5 acceptance is two-agent convergence with preserved trace: auxiliary raw findings plus primary moderation, followed by peer re-review when a reviewer-original P1/P2 is rejected or downgraded. Independent third-agent or human audit is outside v0.5.
- **LIMIT: convergence is flow-enforced.** `--gate` validates the latest run and moderation but does not infer finding identity across runs; same-peer re-review for rejected or downgraded P1/P2 remains an explicit propose/verify/archive flow obligation.
- **LIMIT: scoped stable release.** v0.5.0 is stable only for the stated Windows single-user lane. POSIX reviewer execution, multi-user waiver calibration, crash-time atomic publication, and branch-diff release authority remain outside this release boundary.
- **NON-GOAL: not a sandbox.** Context restrictions are advisory and tool/prompt based; no OS-level filesystem isolation is promised.
- **LIMIT: timeout output is best effort.** Timeout classification and non-empty partial stdout preservation are Windows-tested with a controlled reviewer; Windows timeouts now attempt process-tree termination with `taskkill /T` and fall back to direct `taskkill /F /PID`, but real reviewers may still emit nothing before termination. Timeout-with-structured-output can be read as pass-with-warning evidence after moderation, but gated mode blocks it because the preserved findings may be incomplete. Non-Windows timeout runs record a warning that reviewer child processes may need manual inspection.
- **UPDATED: reviewer output guard.** `--max-output-bytes` bounds stdout/stderr kept in `raw.md` and `run.json` while streamed partial output files retain the full reviewer stream.
- **UPDATED: prompt-size guard.** `--max-prompt-bytes` now gates actual reviewer stdin (`stdinBytes`) while `run.json` records separate `auditBytes`; non-packet-only runs warn instead of blocking when only packet+prompt audit artifacts exceed the prompt limit.
- **UPDATED: calibration path-signal metadata.** `--calibrate-dir` now reports `pathSignalsAvailable` per change and `pathSignalsAvailableCount` overall so clean or already-committed historical changes do not look like zero path risk.
- **UPDATED: run metadata compatibility.** `run.json` now marks deprecated `inputBytes` with `_deprecatedInputBytes`; use `stdinBytes` for reviewer stdin size.
- **UPDATED: diff-base resolution.** `origin/HEAD` parsing now consumes git stdout only, so stderr warnings cannot pollute the resolved branch base.
- **UPDATED: reviewer prompt contract.** Non-packet-only reviewers are asked to spot-check manifest content/presence rather than claim SHA-256 verification they cannot compute with read/search tools.
- **UPDATED: moderation template.** New `moderation.md` templates use a concrete example row instead of a multi-value placeholder row.

## 0.4.0 (alpha)

- **NEW: docs substrate contract/checker.** Docs-mode init installs `.steadyspec/substrates/docs/contract.json` and templates, and substrate state records the contract path.
- **NEW: `steadyspec check`.** Deterministic support command for docs-mode proposal/apply/verify/archive artifact structure. It validates structure and known archive truth hazards; it is not a sixth governed verb and does not prove semantic correctness.
- **NEW: optional capability lane contract.** v0.4 defines the minimized "wings" lane for high-uncertainty direction choices: optional `direction-map.md`, optional `evidence-contract.md`, selection findings folded into `findings.md`, and a conditional `Mainline Decision` section when default-path selection matters.
- **UPDATED: docs-mode runtime surfaces.** Propose/apply/verify/archive flows, Claude commands, Codex descriptors, and Claude workflow scripts now surface docs-mode `steadyspec check` at their phase artifact boundaries; explore reports docs contract health.
- **UPDATED: validator.** Package validation now rejects stale active four-verb wording and verifies docs checker contract/surface integration.
- **NON-GOAL: capability lane is not autonomy.** Same-model debate remains structured scrutiny, not independent validation; high-risk direction and mainline decisions remain user-owned.
- **NON-GOAL: docs checker is not semantic truth.** It rejects missing structure and known archive truth hazards; it does not prove the work is correct.

## 0.3.0 (alpha)

- **NEW: Attention & Responsibility Model** across the public method and reference skill pack. v0.3 adds decision ownership ledger, risk routing, attention report, trust checkpoint, handoff snapshot, re-slice event, and durable truth gate contracts.
- **NEW: `/steadyspec:verify` trust checkpoint** with `steadyspec-verify-flow`, Claude slash command, Codex descriptor, and Claude workflow script. Verify checks output-vs-intent, evidence credibility, risk routing, debt/fallback visibility, and next safest action without archiving.
- **NEW: v0.3 artifact contract anchors** in `ARTIFACT_CONTRACT.md`, including machine-readable sections for ledger, risk routing, attention report, re-slice event, trust checkpoint, handoff snapshot, and durable truth gates.
- **UPDATED: propose/apply/explore/archive flows** now carry responsibility routing: propose writes ledger/risk/attention records; apply links proof to decisions and records re-slice events; explore emits attention-ranked status and handoff snapshots; archive adds responsibility drift review and durable truth gates.
- **UPDATED: runtime surfaces** for Claude and Codex now include the verify verb and install guidance.
- **UPDATED: validator** now checks the v0.3 responsibility contract and verify runtime surface.
- **NON-GOAL: ECC is not imported.** ECC remains prior art and optional lower-level proof/review material, not SteadySpec's product identity.
- **NON-GOAL: issue-tracker substrates remain experimental.** v0.3 prioritizes responsibility routing before substrate expansion.

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

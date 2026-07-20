# SteadySpec Quick Start

SteadySpec is a reference skill pack of the anti-drift method. Five outward verbs, each a small closed-loop with anti-drift gates and responsibility routing. Read [SCOPE.md](SCOPE.md) before adopting.

## Source-only install

SteadySpec v0.6.1 is **not published to the npm registry**. Do not run a
registry install or `npx steadyspec`; an unqualified registry package is not a
supported distribution of this project. Install only from the official source
repository, pinned to a trusted tag or commit.

PowerShell example:

```powershell
git clone https://github.com/BestBlade/SteadySpec.git
Set-Location SteadySpec
git checkout <trusted-tag-or-commit>
git remote get-url origin
git rev-parse HEAD

node --version  # must be 18 or newer
npm run validate
npm pack
npm install --global .\steadyspec-0.6.1.tgz
steadyspec --help
```

Then enter the target project and preview the exact installation before writing:

```powershell
Set-Location D:\path\to\project
steadyspec init --runtime codex --substrate docs --dry-run
steadyspec init --runtime codex --substrate docs
```

Use `--runtime claude` or `--substrate openspec` when those are the intended
runtime/substrate. Do not add `--force` until the dry run has shown which
existing SteadySpec-owned files would be replaced.

### Agent-assisted installation contract

Ask the agent to use the same commands above. It must report the Git remote,
exact commit SHA, validation result, tarball name, and `steadyspec --help`
result. It must stop for user confirmation if the target already contains
SteadySpec files, runtime/substrate selection is ambiguous, or `--force` would
be required. Agent-assisted installation is not a second opaque installer.

Auto-detects `.claude/` or `.codex/` in your project. Pass `--runtime claude` or `--runtime codex` to override. If both `openspec/` and `docs/changes/` exist, init prompts which substrate is canonical (`--substrate openspec` or `--substrate docs` to bypass the prompt). For docs-mode projects, `init` also installs a structural contract and templates under `.steadyspec/substrates/docs/`.

## Optional v0.6 closure under verify

Closure is opt-in support for long `verify` work; it is not a sixth governed
verb. Start with manual routing:

```bash
steadyspec init --runtime codex --substrate docs --closure manual
```

The generated `.steadyspec/closure.json` is a review-required template with an
empty `proofPolicies` object. Do not run it as-is. Add only proof commands the
operator authorizes, using an executable plus argv array (never artifact text or
a shell string), explicit cwd, timeout, expected exit codes, environment-key
names, mutable surfaces, and a claim plus coverage limit. Create the referenced
`acceptance-profile.json` in the change directory with all six dimensions and
the exact candidate paths. Then validate before preparing state:

```bash
steadyspec closure --change <change-id-or-path> --validate-config --json
steadyspec closure --change <change-id-or-path> --dry-run-env --json
steadyspec closure --change <change-id-or-path> --calibrate <positive-policy-id> --json
steadyspec closure --change <change-id-or-path> --prepare --json
```

The normal role sequence is fresh Critic -> bounded Builder -> configured proof
policies -> fresh Evaluator. The support command persists and validates records;
it does not edit implementation files. Before starting Evaluator transport,
create a record whose fingerprints exactly match the `--run-proofs` result and
whose `expectedRunDir` stays inside the governed change directory:

```json
{
  "schemaVersion": 1,
  "candidateFingerprint": "sha256:<current-candidate>",
  "evidenceBundleFingerprint": "sha256:<current-evidence-bundle>",
  "invocationId": "cycle-003-evaluator-1",
  "reviewer": "claude",
  "transport": "steadyspec-cross-review",
  "expectedRunDir": ".meta/changes/<change>/cross-agent/<new-run-dir>"
}
```

Persist that record before launching the exact external run. Integrations use
these transitions in order:

```bash
steadyspec closure --change <change> --import-critic <review-run-dir> --json
steadyspec closure --change <change> --builder-before <record.json> --json
steadyspec closure --change <change> --builder-complete <record.json> --json
steadyspec closure --change <change> --run-proofs --json
steadyspec closure --change <change> --evaluator-start <record.json> --json
# Launch exactly the recorded reviewer/transport into expectedRunDir.
steadyspec closure --change <change> --import-evaluator <evaluate-run-dir> --json
steadyspec closure --change <change> --status --json
steadyspec closure --change <change> --check --json
```

Interpret the JSON `state` and `action`, not exit code or prose alone:

| State | Meaning / next owner |
|-------|----------------------|
| `critic-required` | Run a fresh read-only Critic bound to the printed candidate fingerprint. |
| `builder-required` / `builder-in-progress` | Complete only the declared, token-bound repair slice. |
| `proofs-required` | Run only operator-configured proof policies. |
| `evaluator-required` | Write and import the matching evaluator-start record before starting transport. |
| `evaluator-running` | Inspect the exact `expectedRunDir`; do not duplicate the invocation. Import that run or let a human explicitly reopen/abandon. |
| `candidate-ready` | Continue the ordinary human trust checkpoint; this is bounded readiness, not acceptance. |
| `needs-user` | Scope, authority, evidence, or semantic choice requires a human decision. |
| `blocked-by-environment` | Repair transport/runtime prerequisites; do not reinterpret missing output. |
| `non-convergent` | Inspect recurrence/progress/limits and let the human decide whether to reopen. |
| `stale` | Candidate or evidence identity changed; prepare or rerun the requested stage. |

For an inspected incomplete Builder delta, the human may choose `approve`,
`reject`, or `reopen`; approval still requires fresh proofs and evaluation.
Other human stops use a fingerprint-bound reason:

```bash
steadyspec closure --change <change> --decide approve --reason "<why the inspected incomplete delta is authorized>" --json
steadyspec closure --change <change> --decide reject --reason "<why the inspected incomplete delta is rejected>" --json
steadyspec closure --change <change> --decide reopen --reason "<why this remains authorized>" --json
steadyspec closure --change <change> --decide abandon --reason "<why work stops>" --json
steadyspec closure --change <change> --recover-previous --reason "<corrupt-primary inspection>" --json
steadyspec closure --change <change> --reset --reason "<new lineage reason>" --json
```

`auto` mode reduces repeated low-risk direction turns; it does not authorize
requirement narrowing, proof-strategy changes, public/high-risk semantics,
acceptance, merge, or release. Every `candidate-ready` verdict remains bounded
machine evidence for human audit, with context limits and residual unknowns.
Current support is Windows single-user; no Builder sandbox, general side-effect
isolation, POSIX/team behavior, or unobserved-reality guarantee is claimed.

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

## Cross-agent review lane (v0.5)

For high-uncertainty design or review work, you can ask a second local agent to
challenge the current change and save the result:

```bash
steadyspec cross-review --change <change-id-or-path> --reviewer claude --mode design --run --pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL
```

Current v0.5 product boundary: single-user Windows. The lane assumes one
operator using Codex or Claude as the primary worker and the opposite local
agent family as the auxiliary reviewer. It does not promise team coordination,
cross-platform reviewer execution, merge/release gate authority, or third-party
arbitration. For this version, "two-agent consensus" means the auxiliary
agent's raw findings and the primary agent's moderation converge on what to
patch, carry forward, or ask the user. A reviewer-original P1/P2 rejection or
downgrade requires the same peer to re-review the final patch without raising
it again; the preserved trace remains the audit record. v0.5 flows enforce this
operationally; `--gate` alone does not prove that a second run occurred.
Crash-time run metadata, branch-diff ancestry, and POSIX smoke evidence remain
future product-maturity work outside the Windows-only v0.5 boundary. Evidence
is Windows-only, advisory/gated signals
are keyword-heavy, and `--include-diff` is not an atomic working-tree snapshot.
Start in `manual` or `advisory`; treat `gated` as a local readiness-claim check,
not a shared workflow default.

For implementation review, add `--mode review --include-diff`; the packet then
includes branch, staged, unstaged, and untracked diff scope. Sensitive untracked
paths and oversized untracked files are listed but their contents are omitted.
The sensitive filename filter covers common package/cloud credential files such
as `.npmrc`, `.pypirc`, `.netrc`, `.aws/credentials`, and service-account JSON,
plus common IaC files such as `terraform.tfvars`, but it is still best-effort
disclosure reduction rather than a secret scanner.
Sensitive keyword filtering is limited to hidden or credential-like directories
rather than arbitrary `auth` or `token` filenames, so untracked design files such
as `auth-flow.md` remain reviewable. Packets include the omitted filename in
sensitive untracked omission notes so the reviewer can call out a coverage gap.
A root-level file such as `api-tokens.json` is not filtered by the default
patterns; remove it, ignore it, or add project-specific filtering before review.
Add `--packet-only` when you want Claude to review only the inline packet without
file-read tools. This reduces local context contamination but is still not a
filesystem sandbox. Claude reviewer runs refuse CLI versions below the tested
minimum because tool-boundary flags are part of the safety contract in both
packet-only and non-packet-only modes.
Packet-only review packets include `Scope Transparency`: active
`scopeIgnorePatterns`, omitted git-status/untracked path counts, and sensitive
or oversized untracked omission counts. Use it to decide whether the packet is
complete enough for the claim being reviewed.
Because `--include-diff` captures those sections with separate git commands, it
is advisory calibration evidence in v0.5, not merge/release gate
authority. Runs record `gitStatusStable` and the older `diffCoherent`
compatibility field; if working-tree drift is observed during diff capture,
latest checks pass with warning instead of a clean pass.
`diffCoherenceDrift` records added/removed `git status --short` lines when drift
is observed. The stability check compares `git status --short` before and after
packet generation; identical status lines do not prove the branch, staged,
unstaged, and untracked sections are an atomic snapshot. When requested,
`--include-diff` is still a hard latest-check/gate
scope discriminator; only the diff content authority is advisory. Current
include-diff runs record `diffAtomicity: multi-command-status-only`, so latest
checks report pass-with-warning for diff-content quality.
Sensitive-file omission applies only to untracked file rendering. If a sensitive
file is already staged or tracked, its diff content can appear in the staged,
unstaged, or branch diff section; remove it from the working tree or index
before running `--include-diff`.

To save those defaults during install:

```bash
steadyspec init --cross-review manual --cross-review-reviewer claude --cross-review-pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL
```

This writes `.steadyspec/cross-review.json` with env variable names only, never
secret values. Future `steadyspec cross-review` runs use that profile unless a
command-line flag overrides it. When cross-review is enabled, init also writes a
`**/cross-agent/` `.gitignore` entry so local run artifacts do not get staged by
accident. Custom `--output-dir` locations outside the repo are not covered by
that `.gitignore` entry and require manual sanitization before sharing.

To enable host-driven cross-agent review for this project, opt in explicitly and
install the managed user-level adapters once:

```bash
steadyspec init --force --cross-review gated --cross-review-reviewer claude --cross-review-pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL --cross-review-packet-only --cross-review-hooks auto
steadyspec hooks install --target both
steadyspec hooks status --target both
```

Claude and Codex host adapters are installed as short Windows dispatchers.
Restart/open a new Codex task and trust `~/.codex/hooks.json` before relying on
Codex-host automation.

The global adapter is only a dispatcher. It exits silently unless the current
repository has `hooks.mode: ask|auto` and the current prompt explicitly invokes
a SteadySpec flow or asks for cross-review, debate, grill, or multi-agent work.
`ask` makes the primary agent ask for the mode; `auto` writes one
session-scoped peer request per activated turn. Runtime activation state stays under
`.steadyspec/runtime/` and is ignored by Git.
`auto` requires `--cross-review gated`; manual/advisory profiles may use `ask`
but cannot auto-spend reviewer quota.
Hooks return within 30 seconds and never launch the long reviewer process. The
primary agent executes the injected opposite-peer command in the same task.
Stop writes durable pending state and returns a continuation block on
either host until review and moderation pass. The primary host must have
permission to write `moderation.md`; saying that
moderation is complete only in chat does not pass `--check-latest`.
Experimental debate is not auto-launched unless the project explicitly sets
`hooks.allowExperimentalDebate: true`.
The primary-launched runner and reviewer use reduced environments containing system
execution keys plus the project's explicit `passEnv` names, not the full host
environment.

When a flow reaches grill/debate/cross-review territory and no project default
is clear, ask which Agent Collaboration Mode to use:

| Choice | Meaning |
|--------|---------|
| `solo` | Continue with only the primary agent; do not imply cross-agent review happened. |
| `grill` | Use the question-driven hardening lane and preserve the grill output or finding record. |
| `cross-review` | Run an auxiliary `design` or `review` challenge and then moderate `raw.md` into `moderation.md`. |
| `debate` | Use a stronger challenger pass for blind spots or direction forks; real reviewer execution still requires `--experimental-debate`. |

For a hook- or flow-friendly recommendation without starting a reviewer, opt in
to advisory mode and ask for advice:

```bash
steadyspec init --cross-review advisory --cross-review-reviewer claude --cross-review-pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL --cross-review-min-signals 1
steadyspec cross-review --change <change-id-or-path> --advice --json
steadyspec cross-review --change <change-id-or-path> --advice --verbose --json
```

Advisory mode is lightweight. It can suggest a `--run` command, but it does not
invoke Claude, edit files, or block archive by itself. Raise `minSignals` in
`.steadyspec/cross-review.json` when early advisory use is too noisy.
High-risk artifact terms use word/phrase boundaries, so `author` does not fire
`auth` and `archival` does not fire `archive`.
Those terms are SteadySpec-default vocabulary, not a project-trained taxonomy;
tune `riskyPathPatterns` and `minSignals` before relying on this lane in another
domain.
When advice suggests an implementation-review command, `suggestedCommandNotes`
surfaces caveats such as non-atomic `--include-diff` capture before a flow runs
the command.
Treat `minSignals` as the primary calibration knob during the first few changes:
start low to observe recommendations, then raise it before enabling `gated` if
routine low-risk changes are being flagged. Add `--verbose --json` during that
calibration period to inspect `signalDetails`, including which signals fired
and which high-risk terms were filtered by explicit negation. Even when config
mode is `off`, verbose advice reports observed `signalDetails` while keeping
`recommended: false`. Edit
`riskyPathPatterns` in `.steadyspec/cross-review.json` when the project has
important paths outside SteadySpec's default package surfaces.
Edit `scopeIgnorePatterns` only for explicit generated working-tree noise such
as `^coverage/`, `^\\.DS_Store$`, `^\\..*\\.swp$`, `^\\..*\\.swo$`, `~$`,
or `\\.tmp$`. Matching repo-relative paths are omitted from packet git status,
untracked diff sections, advice status signals, and the scope fingerprint when
the noise appears only through those sections. Tracked branch/staged/unstaged
diffs are still review scope. Runtime and manual/advisory defaults are empty;
gated init writes a starter OS/editor temp list for first-run stability. Keep
this list empty for source, review artifacts, and any path whose content should
affect readiness.
If a pattern also matches a tracked staged/unstaged/branch diff path, that diff
content still appears in the packet and still affects review scope.
Check the packet `Scope Transparency` table after adding a pattern; it should
only omit intended generated noise, not source, review, or evidence files.
For a practical calibration pass, point the batch helper at a directory of recent
changes, inspect the histogram, then set `minSignals` above routine low-risk
signal counts before enabling `gated`:

```bash
steadyspec cross-review --calibrate-dir docs/changes --mode review --include-diff --verbose --json
```

`--calibrate-dir` is intentionally non-recursive: the path should be a parent
whose direct children are change directories, such as `.meta/changes` or
`docs/changes`, not a higher-level archive root.
`workingTree.publicSurface` is a live working-tree signal. Historical change
directories under a clean checkout will undercount that signal unless the same
files are currently modified, staged, or untracked; use in-progress or staged
changes when calibrating path-signal noise. Calibration JSON exposes
`pathSignalsAvailable` per change and `pathSignalsAvailableCount` overall so
this blind spot is visible instead of being read as zero path risk.

For automated flow blocking, opt in to the gated profile:

```bash
steadyspec init --cross-review gated --cross-review-reviewer claude --cross-review-pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL --cross-review-min-signals 2
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --gate --json
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --run-if-needed --json
```

Gated mode uses the same lightweight recommendation signals as `--advice`. If a
review is recommended, `--gate` fails until the latest real run has successful
structured reviewer output, completed moderation, and a reviewer/mode/include-diff
and packet-only scope that still matches the current packet fingerprint. Gated
init writes `packetOnly: true` by default; pass `--no-packet-only` on a specific
run only when file-read spot checks are more important than packet-only context
isolation. When moving from advisory to gated mode, expect this reviewer-boundary
change: gated favors packet snapshot integrity over live file spot-checking.
`--gate` still does not launch Claude. `--run-if-needed` is the
flow-friendly executor: it launches the reviewer only when the gate would
otherwise need a usable scoped run, then leaves `moderation.md` for the primary
agent to classify. Add `--force` when a warning-bearing or otherwise already
usable latest run should be refreshed.
This can consume Claude/Codex quota or API budget. Use `--advice --json` for
dry recommendation checks, and only place `--run-if-needed` in hooks when the
reviewer cost and latency are intentional.
If the reviewer ran successfully but moderation is still pending, gate JSON
reports `action: "moderation-required"`.
Denied-context warnings block gated mode, but obvious boundary-restatement lines
such as "I will not access ..." are ignored to reduce compliant-reviewer false
positives.
Gated mode is deliberately conservative about reviewer-original P1/P2 findings:
if every P1/P2 is rejected instead of accepted or carried forward, or if a P1/P2
is rejected with a weak placeholder reason, the gate blocks. Short explicit
cross-references such as `Duplicate of F3` or `See D5 in design` are valid
reasons; generic placeholders are not. Stay in advisory mode when the project
expects frequent justified P1/P2 rejections and has not designed a waiver policy
yet.
Use `Moderator Decision: needs-user` when a P1/P2 finding needs explicit user
confirmation; gated JSON then returns `status: "needs-user"` and
`action: "user-confirmation-required"` with `resolutionHint` so the flow stops
at the right owner and shows the next moderation step. A missing moderation row
for a reviewer-original P1/P2 also routes to `needs-user`.

Then moderate the generated `cross-agent/<timestamp>-<reviewer>-<mode>/moderation.md`
from `status: template` to `status: complete`, with one decision row per finding.
To verify that the latest real run is usable:

```bash
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --check-latest --json
```

Use the same reviewer, mode, and `--include-diff` scope that the review claim is
about. A design-only or no-diff run does not satisfy an implementation-review
claim.
Scope fingerprints include filtered git status. Close editors, remove temporary
files, or stash unrelated generated outputs before `--check-latest` or
`--gate`; an untracked swap file, `.DS_Store`, coverage output, or build
artifact can make current scope differ from the review-time packet unless it
matches an explicit `scopeIgnorePatterns` entry.
Treat this as a gated-mode pre-check, not a vague hygiene note: run the reviewer,
moderate immediately, and avoid touching review artifacts or implementation
files before `--check-latest`/`--gate`. Use `scopeIgnorePatterns` only for
known generated noise; non-ignored changes still require fresh evidence.

This Level 1/2/3-minimal lane is auditable. It does not provide filesystem
sandboxing. Advisory mode provides heuristic recommendations only; gated mode
turns those recommendations into an automatic readiness check but still requires
explicit reviewer execution or `--run-if-needed`. Codex as the auxiliary
reviewer is experimental and requires `--experimental-codex`.
Start with `advisory` before `gated` if you want to observe false positives. In
v0.5, gated mode is a local readiness mechanism for a single operator; multi-user
defaults remain outside v0.5 and need project vocabulary calibration and waiver
policy that are not implemented yet.
Current evidence is Windows 11 dogfood only; macOS/Linux smoke testing is an
open cross-platform support task. Reviewer execution on non-Windows requires
`--experimental-posix` until that smoke evidence exists; read-only `--gate` and
`--check-latest` inspection can run without that
opt-in. Timeout classification and non-empty partial stdout preservation are
Windows-tested with a controlled reviewer, but real reviewers may emit
no partial stdout before termination. Reviewer stdout/stderr kept in `raw.md`
and `run.json` are bounded by `--max-output-bytes`; inspect partial output files
when truncation warnings appear. Windows timeout cleanup falls back from
`taskkill /T` to direct `taskkill /F /PID` before direct child cleanup. On
non-Windows platforms, timeout cleanup now attempts process-group signaling but
is not yet smoke-proven; after a
macOS/Linux timeout, reviewer process trees may need manual inspection until cross-platform smoke exists.
Gated mode blocks timeout-with-structured-output warnings because the preserved
findings may be incomplete. The
`--max-prompt-bytes` guard now applies to actual reviewer stdin, but it is not a
guarantee that the reviewer model's real context window can consume the whole
prompt. Packet-only mode inlines the packet, while non-packet-only mode records
`auditBytes` in `run.json` and warns instead of blocking when only the audit
artifact is large.
Codex reviewer mode has a completed Windows packet-only run with structured
findings and moderation, but no Codex CLI version-safety check is enforced.
Debate mode real-reviewer execution remains experimental and requires
`--experimental-debate`. Current evidence includes a completed Windows smoke
against this staged patch, but stable debate execution is not advertised yet;
`--advice` and `--gate` may inspect debate-mode scope without invoking a
reviewer.
Non-experimental debate appears in `signalDetails` but does not add to
`signalCount`; only `--experimental-debate` makes debate itself a recommendation
signal.
Packet and prompt files use repo-relative paths with local path sanitization by
default. Full run directories are local audit artifacts because `run.json` may
contain absolute paths; do not share full `cross-agent/` run directories without
manual sanitization. If you pass `--output-dir` outside the repo, the init-time
`**/cross-agent/` `.gitignore` entry does not protect that directory.

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

**Locally installed global package** (one command; this does not contact the
registry):

```powershell
npm uninstall -g steadyspec
```

**Per-project residue** (manual cleanup, in each project where you ran `steadyspec init`):

```powershell
# From the verified target project root, inspect exact targets before removal.
Get-ChildItem -LiteralPath .claude\skills -Filter 'steadyspec-*' -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath .claude\workflows -Filter 'steadyspec-*' -ErrorAction SilentlyContinue
Get-ChildItem -LiteralPath .codex\skills -Filter 'steadyspec-*' -ErrorAction SilentlyContinue
Get-Item -LiteralPath .claude\commands\steadyspec -ErrorAction SilentlyContinue
Get-Item -LiteralPath .steadyspec -ErrorAction SilentlyContinue

# Remove only the exact SteadySpec-owned paths you inspected.
Remove-Item -LiteralPath .claude\commands\steadyspec -Recurse -ErrorAction SilentlyContinue
Remove-Item -LiteralPath .steadyspec -Recurse -ErrorAction SilentlyContinue

# Remove each listed steadyspec-* skill/workflow directory by its exact
# -LiteralPath. Then open CLAUDE.md and/or AGENTS.md and delete only the block
# between <!-- steadyspec --> and <!-- /steadyspec --> if present.
```

**Do NOT delete** your own work: `openspec/` (if you use OpenSpec), `docs/changes/<NNN>-*` directories with your change records, your project's existing `CLAUDE.md` content outside the SteadySpec block.

## Read next

- [SCOPE.md](SCOPE.md) — agent tier matrix, single-developer assumption, what SteadySpec does NOT promise.
- [METHOD.md](METHOD.md) - the portable anti-drift method. The five verbs are one implementation; the method extends.
- [README.md](README.md) — full product overview, OpenSpec coexistence guidance, stability surface.

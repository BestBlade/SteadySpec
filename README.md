# SteadySpec

### Governing Agent delegation when real-world responsibility still belongs to people

[中文版本](zh/README.md) | [中文方法论文档](zh/METHOD.md)

AI agents can perform an increasing share of consequential software work, often
faster than the responsible person can practically reperform or inspect it.
That does not make the person technically superior, and it does not move the
surrounding organizational or legal responsibility to the Agent.

SteadySpec governs that delegation. It helps an Agent stay faithful to
authorized purpose, challenge questionable means without silently changing the
purpose, avoid premature low-ceiling convergence, and keep completion claims
inside observed evidence. Its stable product principles are:

1. purpose fidelity and challenge without usurpation;
2. capability realization without premature convergence;
3. evidence-bounded claim integrity;
4. human authority that is not confused with semantic truth; and
5. attention routing that triages responsibility decisions without discharging
   them.

The current reference architecture uses:

1. a domain-neutral [anti-drift method](METHOD.md);
2. the current normative, compatibility-protected software lifecycle
   `explore -> propose -> apply -> verify -> archive`;
3. skills and mechanisms such as context archaeology, grill, debate, proof,
   review, and strategy rollup; and
4. optional closure and assurance support at higher-risk finalization edges.

The stable relationship between these parts is recorded in the
[Product Purpose and Continuity Contract](PRODUCT.md). The five verbs and eight
mechanisms are current means, not SteadySpec's ultimate purpose. They remain
protected public architecture: changing them requires a versioned, human-owned
migration rather than an ordinary refactor.

v0.7 makes the purpose/means boundary executable in consequential proposals.
The Agent records the Authorized Outcome and Hard Constraints separately from
Challengeable Assumptions, Proposed Means, and Delegated Decisions. It is
expected to challenge weak assumptions and means, but it cannot use technical
confidence to silently replace human-owned purpose or constraints. Missing or
unresolved delegation is `needs-human` and blocks apply; this authority record
does not make the resulting decision true or correct.

Resolved challenge authority uses change-relative
`path.md#markdown-heading-anchor` references. Docs mode checks that the target
and heading exist inside the change. Verify binds the trust result; archive on
every substrate requires a ready boundary, all five persisted trust gates
`pass`, and
Recommended Next `archive`. These are structural lineage checks, not actor
authentication or proof that the referenced decision is sufficient.

A host agent's goal or planning
facility may sequence multiple changes. SteadySpec retains each change's own
records and aggregates strategy signals; it does not define goal-to-change
lineage or completion semantics, or claim to own or authenticate the host goal.

v0.7 adds an experimental [assurance protocol candidate](protocol/ASSURANCE_PROTOCOL.md)
as optional claim-integrity support for verification, handoff, and truthful
finalization. It constrains what a process may claim for one exact target,
candidate, evidence bundle, and assessment. It does not replace or demote the
five governed verbs.

`ready-for-human` is the protocol's strongest claim. It means the exact supplied
snapshot is suitable input to a human checkpoint within recorded coverage. It
does not mean truth, human acceptance, reviewer independence, merge, archive,
release, deployment, or risk authority.

Try the optional assurance layer without installing skills or editing closure
policy:

```bash
node bin/assurance.js reduce --trace protocol/examples/empty-trace.json --json
node bin/assurance.js reduce --trace protocol/examples/minimal-ready-trace.json --json
npm run validate:assurance
```

The first command returns `target-required`; the second returns
`ready-for-human` for a complete synthetic trace; the suite then runs the reusable
black-box conformance suite against the reference process and verifies that a
deliberately bad always-ready implementation and an incomplete/forged-result
implementation both fail mandatory cases. This proves
declared protocol behavior only. It does not prove lower drift or lower review
cost in real projects; that question is [pre-registered, not answered](protocol/EXPERIMENT.md).

For ordinary software work, start with the five-verb skill pack below. Adopt the
assurance layer only when the cost of an overstated closure claim justifies it.
See [SCOPE.md](SCOPE.md) for both boundaries and [EVIDENCE.md](EVIDENCE.md) for
bounded dogfood evidence.

The reference skill pack (`/steadyspec:explore` / `:propose` / `:apply` / `:verify` / `:archive`) wraps a spec workflow with closed-loop orchestration: explore routes attention to active risk, propose records a decision ledger and risk routing, apply executes slice-by-slice with proof-linked decisions and explicit re-slice events, verify runs a trust checkpoint before archive or handoff, and archive runs review + doc-sync + confirmed_by + durable truth gates before writing. It coexists with OpenSpec, plain docs, or issue trackers. The method is substrate-aware: OpenSpec owns its own schema, docs mode can use SteadySpec's native structural contract/checker, and issue trackers remain experimental.

## v0.6 Attention-Preserving Closure

This is an optional support engine beneath the canonical `verify` verb. Its old
v0.6 state format has a lossy compatibility projection into the experimental
v0.7 protocol, but the closure product and five-flow lifecycle are not legacy.

v0.6 adds an optional closure support engine under `verify`; the outward product
still has exactly five governed verbs. Closure coordinates a fingerprint-bound
Builder -> proof -> Evaluator loop after a fresh read-only Critic has identified
gaps. Its purpose is to automate low-risk repair and re-check turns without
silently changing intent, evidence expectations, or decision ownership.

Enable it explicitly during project installation:

```bash
steadyspec init --runtime codex --substrate docs --closure manual
```

This writes `.steadyspec/closure.json` as an intentionally incomplete review
template. The operator must define proof policies and each change must provide
the referenced `acceptance-profile.json`; generated templates contain no
inferred proof commands. `manual` records each transition without auto-routing.
`auto` may route only declared, mechanically bounded Builder slices. It stops
for scope expansion, requirement reduction, changed proof strategy, user-visible
or high-risk semantics, missing evidence, environment failure, recurrence,
no-progress, maximum-cycle or wall-clock limits, and residual human decisions.

The cycle binds the original intent files, acceptance profile, proof-policy
identity, exact candidate bytes, and proof evidence. A Critic emits stable
finding IDs; Builder-before declares paths, authority IDs, proof policies, and a
completion token; proofs run only operator-configured executable/argv policies;
the fresh Evaluator binds both `candidateFingerprint` and
`evidenceBundleFingerprint` and checks requirement completeness, logic,
edge cases, code quality, test coverage, actual runtime result, and whole intent.
Same-family agent runs are labelled as structured scrutiny, not independent
truth. One isolated formatting retry is permitted for malformed Evaluator
output; a second unusable result blocks on the environment rather than being
silently repaired.

Evaluator transport has a committed invocation boundary. After proofs produce
both current fingerprints, write a start record with `schemaVersion`,
`candidateFingerprint`, `evidenceBundleFingerprint`, `invocationId`, `reviewer`,
`transport`, and an `expectedRunDir` inside the governed change. Run
`--evaluator-start <record.json>` before launching that exact external run, then
import only that directory with `--import-evaluator <run-dir>`. The intervening
`evaluator-running` state rejects duplicate starts. If transport is interrupted,
the operator inspects the recorded run and either imports it or explicitly uses
`--decide reopen|abandon --reason <text>`; the agent cannot silently retry it.

```bash
steadyspec closure --change <change-id-or-path> --validate-config --json
steadyspec closure --change <change-id-or-path> --prepare --json
steadyspec closure --change <change-id-or-path> --evaluator-start <record.json> --json
steadyspec closure --change <change-id-or-path> --import-evaluator <run-dir> --json
steadyspec closure --change <change-id-or-path> --status --json
steadyspec closure --change <change-id-or-path> --check --json
```

`candidate-ready` means bounded machine readiness for the current candidate,
current evidence bundle, declared context, and recorded unknowns. It is audit
input for the ordinary human trust checkpoint: it is not human acceptance,
truth, correctness outside observed evidence, merge authority, or release
authority. Non-ready states block an archive recommendation without erasing
partial progress. Corrupt primary state may be inspected through
`--recover-previous --reason <text>` only when a separately validated previous
state exists; terminal reset/abandon and approve/reject/reopen decisions preserve
lineage and require an explicit reason.

The shipped boundary remains Windows single-user. There is no Builder OS
sandbox, no general proof side-effect isolation, no POSIX/team support claim,
and no promise that multiple agents know unprovided reality. See
[QUICKSTART.md](QUICKSTART.md) for operation and
[ARTIFACT_CONTRACT.md](ARTIFACT_CONTRACT.md) for the persistent contract.

## v0.3 Attention & Responsibility Model

v0.3 makes responsibility explicit. Meaningful decisions are recorded in a decision ownership ledger, routed by risk, and reported in attention-ranked form: must-read user-owned/high-risk decisions first, needs-glance shared/medium-risk items next, and low-risk agent-owned decisions collapsed but still auditable. The model is defined in [ARTIFACT_CONTRACT.md](ARTIFACT_CONTRACT.md).

## v0.4 Docs Contract And Capability Lane

v0.4 adds two guarded extensions. First, docs mode is now contract-backed for SteadySpec's own artifacts: `init` installs a native docs contract and templates, and `steadyspec check` rejects missing anchors, incomplete evidence fields, invalid trust checkpoint shape, and archive claims that turn fallback or debt into proof. Second, high-uncertainty work may use an optional capability lane inside the same five verbs: direction forks can be mapped, mainline choices can be pressure-tested, evidence contracts can bind claims to proof, and archive can preserve promoted, parked, and rejected directions.

The capability lane is not autonomy and not a sixth verb. High-risk direction, public surface, data, security, and mainline decisions remain user-owned or user-visible through the responsibility model.

## Docs substrate check

Docs-backed projects can use `steadyspec check <change-id-or-path> --phase proposal|apply|verify|archive --substrate docs` to validate SteadySpec's docs-mode artifact structure. This is a deterministic support check, not a sixth governed verb and not a semantic proof that the work is correct.

All substrates can use `steadyspec delegation-check --change
<repo-relative-change-path> --phase proposal|apply|verify|archive --json` for
model-independent readback of the active delegation artifacts. Archive phase
requires a ready proposal plus a passing archive recommendation, and the archive
transaction binds that artifact fingerprint across prepare, commit, and resume.
This proves structural lineage only, not correctness, actor identity, or human
acceptance.

Before `propose` writes any artifact, its runtime also invokes the read-only
`steadyspec delegation-path-check` preflight. It binds the code-derived active
root to the real project, rejects existing symlink/junction components, and
prevents a custom base from aliasing a built-in namespace. This is path-identity
evidence at check time, not protection against a hostile host or a later
filesystem race.

## v0.5 Cross-Agent Review Lane

v0.5 supports a Level 1/2/3-minimal cross-agent lane for a single operator on
Windows:

```bash
steadyspec init --cross-review manual --cross-review-reviewer claude --cross-review-pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL
steadyspec cross-review --change <change-id-or-path> --advice --json
steadyspec cross-review --change <change-id-or-path> --gate --json
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --packet-only --run-if-needed --json
steadyspec cross-review --change <change-id-or-path> --reviewer claude --mode design --run --pass-env ANTHROPIC_AUTH_TOKEN,ANTHROPIC_BASE_URL
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --check-latest --json
steadyspec hooks install --target both
```

Current v0.5 product boundary: single-user Windows. The lane assumes one
operator using Codex or Claude as the primary worker and the opposite local
agent family as the auxiliary reviewer. It does not promise team coordination,
cross-platform reviewer execution, merge/release gate authority, or third-party
arbitration. For this version, "two-agent consensus" means the auxiliary
agent's raw findings and the primary agent's moderation converge on what to
patch, carry forward, or ask the user. A reviewer-original P1/P2 rejection or
downgrade is not consensus until the same peer re-reviews the final patch and
no longer raises it; the preserved trace remains the audit record. This is a
flow requirement in v0.5, not something `--gate` can infer automatically from
one moderation table.
Crash-time run metadata, branch-diff ancestry, and POSIX smoke evidence remain
future product-maturity work outside the Windows-only v0.5 boundary. Evidence
is Windows-only, advisory/gated
recommendations are still keyword-heavy, and `--include-diff` packets are not
atomic working-tree snapshots. Start in `manual` or `advisory`; treat `gated`
as a local readiness-claim check, not a shared workflow default.

The lane packages a change, asks the opposite agent family for structured findings,
preserves raw output separately from moderation, and checks that moderation is
complete before a cross-agent review is treated as done. This is not a sandbox
or automatic moderation. Codex reviewer mode requires the explicit
`--experimental-codex` compatibility flag. No Codex CLI version-safety check is
enforced yet, so users must verify their installed Codex supports the isolation
flags before running it.
Install-time config writes `.steadyspec/cross-review.json` with reviewer defaults
and env variable names only, not secret values. Packet and prompt files use
repo-relative paths with local path sanitization by default; `run.json` remains a
local audit record and may contain absolute paths. Do not share full
`cross-agent/` run directories without sanitizing them first. Init writes a
`**/cross-agent/` `.gitignore` entry when cross-review is enabled. Custom
`--output-dir` locations outside the repo are not covered by that `.gitignore`
protection and need manual sanitization before sharing. For implementation review,
`--mode review --include-diff` packages branch, staged, unstaged, and untracked
changes. Sensitive untracked paths and oversized untracked files are listed but
their contents are omitted from the packet.
Host hooks are separately installed with `steadyspec hooks install --target
claude|codex|both`. The adapter is user-level, but reviewer execution is not:
projects default to `hooks.mode: off`, and an opted-in project activates a hook
run only after a prompt explicitly enters a SteadySpec flow or asks for
cross-review, debate, grill, or multi-agent work. Use
`--cross-review-hooks ask` to pause for a mode choice or
`--cross-review-hooks auto` with `--cross-review gated` to require one bounded
peer review per activated turn. Auto is rejected for manual/advisory profiles so those
profiles cannot unexpectedly spend reviewer quota.
Unrelated conversations and repositories without the project opt-in exit
silently and consume no reviewer quota.
The hook resolves an opposite-family peer by host: Codex routes to Claude and
Claude routes to Codex. It writes a session-scoped request and injects the exact
peer command; the primary agent executes that command in the same task. Hooks
stay below 30 seconds and never launch a long model process. Stop records
durable pending state and returns a continuation block on either host
until review and moderation pass.
The primary host still needs permission to write `moderation.md`; chat-only
moderation claims do not satisfy `--check-latest`.
Reviewer subprocesses receive reduced environments; only system execution keys
plus project-configured `passEnv` names are forwarded. Start with `ask` when
latency or quota is uncertain. A same-host second pass never satisfies
cross-agent evidence.

The sensitive untracked filter includes common package/cloud credential
filenames such as `.npmrc`, `.pypirc`, `.netrc`, `.aws/credentials`, and
service-account JSON, plus common IaC files such as `terraform.tfvars`; it
remains best-effort disclosure reduction rather than a secret scanner.
Sensitive keyword filtering is limited to hidden or credential-like directories
rather than arbitrary `auth` or `token` filenames, so untracked design files such
as `auth-flow.md` remain reviewable. Packets include the omitted filename in the
omission note so the reviewer can flag any remaining gap. A root-level file such
as `api-tokens.json` is not filtered by the default patterns; remove it, ignore
it, or add project-specific filtering before review.
Because those diff sections are captured with separate git commands,
`--include-diff` reviews are advisory calibration evidence in v0.5, not
merge/release gate authority. Runs record `gitStatusStable` and the older
`diffCoherent` compatibility field; when packet generation observes
working-tree drift during diff capture, latest checks pass with
warning instead of a clean pass. `diffCoherenceDrift` records added/removed
`git status --short` lines when drift is observed. `gitStatusStable` compares
`git status --short` before and after the multi-section capture; identical
status lines do not prove branch, staged, unstaged, and untracked sections are an atomic snapshot. When `--include-diff` is requested,
latest checks and gates require the latest run to match that scope; this is a
scope discriminator, not a claim that diff content is atomic release evidence.
Current include-diff runs record `diffAtomicity: multi-command-status-only`, so
latest checks report pass-with-warning for diff-content quality.
Sensitive-file omission applies only to untracked file rendering. If a sensitive
file is already staged or tracked, its diff content can appear in the staged,
unstaged, or branch diff section; remove it from the working tree or index
before running `--include-diff`.
Use `--packet-only` when the reviewer should receive the full packet inline
without file-read tools. This reduces local context contamination and is the
default written by `--cross-review gated`, but it is still not an OS sandbox.
Claude reviewer runs refuse CLI versions below the tested minimum because
tool-boundary flags are part of the safety contract in both packet-only and
non-packet-only modes.
Packet manifests include generation-time SHA-256 hashes for the artifact text
loaded into the packet; packet-only reviewers cannot independently verify
on-disk state. Packets also include a `Scope Transparency` section listing
active `scopeIgnorePatterns`, counts of git-status/untracked paths they omit,
and sensitive, oversized, or unreadable untracked omission counts so a
packet-only reviewer can challenge suspicious scope shaping.

Agent Collaboration Mode selection belongs to the flow layer. When grill,
debate, or a cross-agent blind-spot check could apply and no project default is
clear, ask the user which mode to use before starting long-running work:

| Choice | Meaning | Trace requirement |
|--------|---------|-------------------|
| `solo` | Primary agent works without auxiliary review. | Record that cross-agent review was skipped or not requested when a claim might otherwise imply it. |
| `grill` | Primary agent hardens the decision tree through questions. | Preserve grill output or a finding record before proposal mainline decisions. |
| `cross-review` | Auxiliary agent reviews/challenges in `design` or `review` mode. | Preserve `raw.md`, complete `moderation.md`, and keep finding IDs tied to primary decisions. |
| `debate` | A stronger challenger pass tries to expose blind spots or direction forks. | Preserve the debate findings and, for real reviewer execution, keep the `cross-agent/<timestamp>-<reviewer>-<mode>/` run directory. |

In v0.5, `design` and `review` are the stable cross-review modes. `debate`
packet generation is available, but real debate-mode reviewer execution still
requires `--experimental-debate`.

`--cross-review advisory` enables a Level 2 advisory profile: `--advice` can
recommend a run from lightweight change signals, but it does not invoke Claude
or block a flow. Reviewer execution remains explicit through `--run`. Set
`--cross-review-min-signals <n>` during init, or edit `minSignals` in
`.steadyspec/cross-review.json`, to require multiple recommendation signals
before advice/gate automation recommends review.
High-risk artifact terms use word/phrase boundaries, so `author` does not fire
`auth` and `archival` does not fire `archive`.
Those high-risk terms are SteadySpec-default vocabulary rather than a
project-trained taxonomy; tune `riskyPathPatterns` and `minSignals` before
relying on advice or gated recommendations in another domain.
When advice suggests an implementation-review command, `suggestedCommandNotes`
surfaces caveats such as non-atomic `--include-diff` capture before a flow runs
the command.
Use `--advice --verbose --json` during calibration to include `signalDetails`
for each recommendation signal, including fired signals and negated high-risk
terms. Even when config mode is `off`, verbose advice reports observed
`signalDetails` while keeping `recommended: false`. Edit `riskyPathPatterns` in
`.steadyspec/cross-review.json` so the path-based signal matches the project's
own runtime, schema, migration, and public documentation surfaces instead of
only SteadySpec package paths.
Edit `scopeIgnorePatterns` in the same config only for explicit working-tree
noise such as `^coverage/`, `^\\.DS_Store$`, `^\\..*\\.swp$`,
`^\\..*\\.swo$`, `~$`, or `\\.tmp$`. Matching repo-relative paths are omitted
from packet git status, untracked diff sections, advice status signals, and the
scope fingerprint when the noise appears only through those sections. Tracked
branch/staged/unstaged diffs are still review scope. Runtime and manual/advisory
defaults are `[]`; gated init writes a starter OS/editor temp list for first-run
stability. Do not use this for meaningful source, artifact, or review paths.
If a pattern also matches a tracked staged/unstaged/branch diff path, that diff
content still appears in the packet and still affects review scope.
The packet `Scope Transparency` section reports how many git-status and
untracked paths each pattern omits; nonzero counts should map to explicit
generated noise, not source, review, or evidence files.
Use `--calibrate-dir <changes-dir> --verbose --json` to evaluate the same advice
signals across multiple change directories without launching reviewers. The
helper is intentionally non-recursive: pass a parent directory whose direct
children are change directories, such as `.meta/changes` or `docs/changes`, not
a nested archive root. The output reports each change's `signalCount` plus a
histogram for choosing `minSignals` before enabling gated mode. It also reports
`pathSignalsAvailable` per change and `pathSignalsAvailableCount` overall so a
clean or already-committed historical checkout is not mistaken for zero path
risk.

`--cross-review gated` enables the smallest Level 3 automation point:
`--gate --json` turns the same recommendation signal into a blocking readiness
check. If review is recommended, the latest real run must have successful
reviewer output, completed moderation, and matching reviewer/mode/include-diff
and packet-only scope for the current packet fingerprint. The gate still does
not invoke Claude; it tells hooks and flows whether they may claim cross-agent
review is satisfied. Gated init writes `packetOnly: true` by default so the
reviewer consumes the packet inline instead of reading repo files.
If the latest run carries denied-context warnings, gated mode blocks instead of
treating the review as satisfied-with-warning.
If a reviewer run exists but `moderation.md` is still a template, gate JSON
reports `action: "moderation-required"`.
Obvious boundary-restatement lines such as "I will not access ..." are ignored
by the denied-context scanner to reduce compliant-reviewer false positives.
Simple scope-description lines such as "the .codex folder was outside scope" are
also filtered, but novel descriptive denied-path mentions can still warn or
block until scanner calibration improves.
Gated mode also blocks when reviewer-original P1/P2 findings have no accepted
or carried-forward P1/P2 row, or when a P1/P2 rejection uses a weak placeholder
reason. Short explicit cross-references such as `Duplicate of F3` or `See D5 in
design` are allowed, but generic placeholders are not. This is conservative on
purpose; stay in advisory mode until the project has a waiver policy for
justified P1/P2 rejections.
If a moderation row marks a P1/P2 finding as `needs-user`, gate JSON returns
`status: "needs-user"` with `action: "user-confirmation-required"`; automation
must stop and surface that decision instead of rerunning the reviewer or
claiming readiness. The JSON includes `resolutionHint` pointing back to
moderation. A missing moderation row for a reviewer-original P1/P2 is treated
the same way.
Gated mode is supported as a local readiness-claim mechanism for a single
operator; multi-user defaults are outside v0.5 and would need project vocabulary
calibration plus waiver policy that are not implemented yet.

`--run-if-needed --json` is the flow-friendly executor: it checks the same
recommendation signal and latest-run status, invokes the reviewer only when the
latest run is missing or unusable, and writes a moderation template. It does not
moderate findings automatically; `--check-latest` still fails until moderation
is completed by the primary agent and the run still matches the current review
scope. Add `--force` when an automation needs a fresh run despite an already
usable or warning-bearing latest run.
Because `--run-if-needed` can launch the configured reviewer, it can consume
Claude/Codex quota or API budget. Use `--advice --json` for dry recommendation
checks, and put `--run-if-needed` in hooks only when that cost and latency are
intentional.
Scope fingerprints include filtered git status. Before `--check-latest` or
`--gate`, make sure the working tree matches the review-time state; temporary
editor files, `.DS_Store`, coverage outputs, build outputs, or newly untracked
files can force a scope mismatch when they are not covered by an explicit
`scopeIgnorePatterns` entry.
For gated-mode trials, treat this as a concrete pre-check: close editors that
create swap files, remove `.DS_Store`/coverage/build artifacts, and avoid
touching `tasks.md`, `design.md`, or implementation files between the reviewer
run and moderation check. Use `scopeIgnorePatterns` for known generated noise;
any non-ignored working-tree change can still stale the scope fingerprint.

Current evidence is Windows 11 dogfood only; macOS/Linux smoke testing is an
open cross-platform support task. Reviewer execution on non-Windows requires
`--experimental-posix` until that smoke evidence exists; read-only `--gate` and
`--check-latest` inspection can run without that
opt-in. POSIX command resolution is implemented but untested. Timeout
classification and non-empty partial stdout preservation are Windows-tested with
a controlled reviewer; real reviewers may still emit no partial stdout before
termination. Reviewer stdout/stderr kept in `raw.md` and `run.json` are bounded
by `--max-output-bytes`; inspect partial output files when truncation warnings
appear. Windows timeout cleanup falls back from `taskkill /T` to direct
`taskkill /F /PID` before direct child cleanup. Non-Windows timeout cleanup now attempts process-group signaling,
but is not yet macOS/Linux smoke-proven; after a macOS/Linux timeout, reviewer
process trees may need manual inspection until cross-platform smoke exists.
Gated mode blocks timeout-with-structured-output warnings because the preserved
findings may be incomplete. The scrubbed reviewer
environment still passes `TEMP`/`TMP` for CLI compatibility; on Windows those
paths can reveal the OS username even though `HOME`/`USERPROFILE` are not passed
by default. `--max-prompt-bytes` is a conservative
reviewer-stdin guard, not a guarantee that the reviewer model's real context
window can consume the whole prompt. Packet-only prompts include the packet inline, while
non-packet-only prompts send only the packet path and record `auditBytes`
separately in `run.json`. When non-packet-only `auditBytes` exceeds
`--max-prompt-bytes`, the runner records a warning instead of blocking reviewer
execution.
Debate mode can package challenger prompts, but real debate-mode reviewer
execution remains experimental and requires `--experimental-debate`. Current
evidence includes a completed Windows smoke against this staged patch, but
stable debate execution is not advertised yet. `--advice` and `--gate` may
inspect debate-mode scope without that flag because they do not invoke a
reviewer.
Non-experimental debate appears in `signalDetails` but does not add to
`signalCount`; only `--experimental-debate` makes debate itself a recommendation
signal.

## Quick start

See [QUICKSTART.md](QUICKSTART.md) for the complete source-only installation,
verification, agent handoff, and manual cleanup contract. v0.7.0 is not
published to the npm registry; do not use a registry install or `npx`.

```powershell
git clone https://github.com/BestBlade/SteadySpec.git
Set-Location SteadySpec
git checkout <trusted-tag-or-commit>
git remote get-url origin
git rev-parse HEAD
npm run validate
npm pack
npm install --global .\steadyspec-0.7.0.tgz

Set-Location D:\path\to\my-project
steadyspec init --runtime codex --substrate docs --dry-run
steadyspec init --runtime codex --substrate docs
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
- **Independent assurance process:** `assurance` implements the experimental
  protocol candidate. It can be evaluated without installing or invoking the
  five software verbs.
- **Lifecycle support CLI:** `init`, docs `check`, `cross-review`, `closure`,
  and `hooks` support the five governed verbs. They are not additional
  methodology verbs. There is no top-level `update`, project-level `uninstall`,
  or general `status`; removal is manual plus `npm uninstall -g` for a local
  installation.
- **Issue-tracker substrate remains experimental:** v0.4 adds docs-mode structure; GitHub issues / Jira / Linear are still external records.

## Layout

```text
steadyspec/
  METHOD.md             # domain-neutral anti-drift method
  PRODUCT.md            # normative product purpose, reference architecture, and evolution boundary
  SCOPE.md              # tier matrix, single-developer assumption, no-promise list
  QUICKSTART.md         # 5 verbs + install + manual cleanup
  README.md             # this file
  CHANGELOG.md
  protocol/
    ASSURANCE_PROTOCOL.md    # experimental normative candidate
    EXPERIMENT.md            # preregistered value test, no result yet
    schemas/                 # strict trace/result JSON schemas
    conformance/             # static black-box cases
    examples/                # empty and complete synthetic traces
  .github/workflows/ci.yml  # Windows/Linux source validation
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
    init.js             # bounded CLI entrypoint and support-command dispatch
    assurance.js        # v0.7 reference reducer/fingerprint/projection process
    cross-review.js     # v0.5 Level 1 cross-agent review runner
    closure.js          # v0.6 closure state machine and evidence binding
    human-decision-transaction.js  # fail-closed human decision writes
    cross-review-hook.js  # optional cross-review hook integration
    docs-check.js       # deterministic docs substrate checker
    validate.js         # internal package validator
  tests/
    assurance-conformance.js  # reusable process-level conformance runner
    portability-fixtures.js  # CRLF, realpath, alias, and escape regressions
  release-evidence/
    v0.6.1/             # public candidate evidence and machine-readable state
    v0.7.0/             # public protocol-candidate evidence and residual unknowns
  docs/
    product-contract-history/  # recoverable superseded contracts and coverage maps
    experiments/               # product experiment designs; no implied preregistration or result
  schemas/              # closure/config/acceptance JSON schemas
  manifest.json         # install spec
  package.json
```

The source-repo validator ignores root-local agent workspace directories such as
`.agents/`, `.codex/`, `.claude/`, and `.steadyspec/`. They may exist in a
developer checkout, but they are not package payload.

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

SteadySpec is source-distributed. To upgrade, check out a new trusted tag or
commit, re-run validation, build a local tarball, and preview project changes
with `init --force --dry-run` before confirming replacement. There is no
top-level `update` or project-level `uninstall` command. See
[QUICKSTART.md](QUICKSTART.md); local global-package removal remains
`npm uninstall -g steadyspec`.

## Stability

v0.7.0 remains pre-1.0. The assurance protocol, schemas, conformance catalog,
and reference process are explicitly experimental. They may change
incompatibly before 1.0; a semantic change must use a new `protocolVersion` and
be recorded in [CHANGELOG.md](CHANGELOG.md). The following current normative,
compatibility-protected software surfaces remain stable unless an explicit
human-owned migration versions [PRODUCT.md](PRODUCT.md):

- Outward verb names: `/steadyspec:explore`, `/steadyspec:propose`, `/steadyspec:apply`, `/steadyspec:verify`, `/steadyspec:archive`.
- Verb-flow SKILL names: `steadyspec-<verb>-flow`.
- Primitive SKILL names: current `steadyspec-*` names.
- METHOD.md structure: the eight mechanism sections remain addressable; content may expand.
- CLI meaning: `steadyspec init` installs the runtime skills, verb-flows, runtime adapters, docs contract/templates when docs mode is selected, and writes project state. `steadyspec check` validates docs-mode artifact structure and known archive truth hazards. `steadyspec delegation-check` directly validates the current change's structural delegation lineage on every substrate; archive transactions bind its artifact fingerprint.
- State schema: `.steadyspec/substrate.json` uses `schemaVersion: 1`; fields may be added, not silently removed, within that schema version.

## Method first

Read [METHOD.md](METHOD.md) to learn the domain-neutral anti-drift mechanisms. Read [recipes/software-sdd.md](recipes/software-sdd.md) to see how this package maps the method into software SDD verbs and primitives. Read [recipes/research-paper.md](recipes/research-paper.md) for a compact non-software transfer example.

## Human reading path

If you are evaluating the method:

1. [PRODUCT.md](PRODUCT.md) — product purpose, stable principles, current reference architecture, and change authority
2. [METHOD.md](METHOD.md) — the portable anti-drift thought (8 mechanisms, domain-neutral)
3. [EVIDENCE.md](EVIDENCE.md) — the dogfood record (what happened when the method was applied to itself)
4. [SCOPE.md](SCOPE.md) — does the reference skill pack fit your project?
5. [QUICKSTART.md](QUICKSTART.md) — what daily use looks like

If you are evaluating the assurance protocol candidate:

1. [protocol/ASSURANCE_PROTOCOL.md](protocol/ASSURANCE_PROTOCOL.md) — normative state, binding, transition, and process contract
2. [protocol/schemas/](protocol/schemas/) — strict trace and result schemas
3. [protocol/conformance/cases.jsonl](protocol/conformance/cases.jsonl) — static black-box cases
4. [protocol/EXPERIMENT.md](protocol/EXPERIMENT.md) — preregistered value test; no result yet
5. [release-evidence/v0.7.0/](release-evidence/v0.7.0/README.md) — reproducible candidate evidence and remaining limits

If you are an agent inheriting a project with SteadySpec installed:

1. The installed `steadyspec-adopt` SKILL — to understand governance level
2. The installed `steadyspec-workflow` SKILL — to know which verb-flow runs next
3. The five `steadyspec-<verb>-flow` SKILLs in your runtime's `skills/` directory

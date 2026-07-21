# SteadySpec Workflow Artifact Contract

This file records the shared artifact contract for the legacy bundled software
workflow and closure recipe. Within that legacy surface, the workflow scripts
remain the source of runtime behavior and this file names the formats they must
agree on.

It is not the normative source for the experimental v0.7 assurance protocol.
That source is [protocol/ASSURANCE_PROTOCOL.md](protocol/ASSURANCE_PROTOCOL.md),
with strict trace/result schemas and process conformance under `protocol/`.
The legacy v0.6 closure lane has only a lossy state projection and is not
claimed to be a conformant thin adapter.

## Scope

Applies to:

- `en/runtime/claude/workflows/steadyspec-propose.js`
- `en/runtime/claude/workflows/steadyspec-apply.js`
- `en/runtime/claude/workflows/steadyspec-verify.js`
- `en/runtime/claude/workflows/steadyspec-archive.js`
- `en/runtime/claude/workflows/steadyspec-explore.js`

Does not apply to Codex runtime descriptors, primitive SKILL bodies, or project
substrate selection.

## Schema Version

New workflow-authored artifacts should include a visible schema marker when the
artifact has a structured format:

```markdown
schemaVersion: 1
```

Existing artifacts without this marker remain valid input. Workflow scripts must
treat missing schemaVersion as legacy format, not as corruption.

## v0.6 Closure Lane Artifact Contract

Closure is an optional support engine under the governed `verify` verb. It does
not add a sixth verb and does not own acceptance, merge, archive, or release
decisions. The supported public boundary is one operator on Windows. Runtime
checks do not imply a Builder sandbox, general side-effect isolation, POSIX or
team support, or knowledge of reality outside the supplied context.

### Opt-in and acceptance profile

Project opt-in is `.steadyspec/closure.json` (`schemaVersion: 1`). It names
`mode: off|manual|auto`, the per-change acceptance-profile filename, explicit
limits, and operator-authored proof policies. Generated configuration has
`generatedTemplate: true`, `reviewRequired: true`, and no proof policies; it is
not executable evidence until reviewed. Proof policies use direct executable
and argv fields, scrubbed environment-key names, expected exit codes, timeout,
declared dependencies/outputs/mutable surfaces, and an evidence contract. No
command may be inferred from a change artifact or Evaluator response.

Each opted-in change supplies `acceptance-profile.md` for human review and
`acceptance-profile.json` for the engine. The JSON closes the candidate path
set and the six dimensions: `requirement-completeness`, `logic-correctness`,
`edge-cases`, `code-quality`, `test-coverage`, and `actual-runtime-result`.
Every dimension names required proof-policy/source classes and a coverage
limit. Required dimensions cannot become `n/a` merely because evidence is
missing.

### Persistent state and cycle records

The change directory owns the following local audit lineage:

```text
closure/
  state.json
  state.prev.json
  calibration.json
  reset-in-progress.json
  archive/<reset-id>/
    reset-manifest.json
    reset-decision.json
    reset-journal-final.json
  cycles/<NNN>/
    candidate.json
    critic-ref.json
    builder-before.json
    builder-completion.json
    incomplete-repair-inspection.json
    proofs.json
    proofs/<policy-id>.stdout.txt
    proofs/<policy-id>.stderr.txt
    evidence-manifest.json
    evaluator-invocation.json
    evaluator-ref.json
    verdict.json
    human-decision-<decision-id>.json
```

In documentation, `closure/cycles/<NNN>/` denotes this versioned directory;
the runtime uses a zero-padded numeric cycle. `state.json` is the current
schema-valid snapshot and `state.prev.json` is the independently inspected
previous publication. Writes use a same-directory temporary file plus rename.
A validated previous state may be recovered only through the explicit
`--recover-previous --reason` route, which archives raw state bytes and records
a possible lost transition. Invalid previous state fails closed.

`reset-in-progress.json` is a recovery journal, not a completed decision. A
terminal reset inventories and hashes all source evidence, copies it to a
same-directory staging tree, verifies exact bytes, and commits the archive with
one directory rename before deleting live state. While the journal exists, all
other actions are blocked; rerunning `--reset --reason` resumes the recorded
operation. `human-decision-<decision-id>.json` uses a canonical ID bound to the
prior state identity, lineage/cycle, both fingerprints, decision, and reason.
An exact artifact-before-state or committed retry is reconciled idempotently;
any mismatch fails closed and never creates agent decision authority.

`candidate.json` binds intent files, acceptance profile, proof-policy identity,
and exact candidate bytes into `candidateFingerprint`. Builder-before binds
finding IDs, planned paths/summaries, authority IDs, proof policies, risk class,
and a completion token. Completion records exact path/hash deltas and finding
dispositions. An undeclared delta is preserved for an explicit
approve/reject/reopen decision; approval never skips fresh proof or evaluation.

`evidence-manifest.json` binds proof policy identity, execution result, captured
stdout/stderr hashes and artifacts, candidate identity, coverage claims, and
negative-control calibration into `evidenceBundleFingerprint`. Proof output is
data, never executable instruction. Candidate mutation, policy drift, unknown
proof result, timeout, truncation, or undeclared output overlap fails closed or
routes to a visible human/environment state.

### Critic, Builder, and Evaluator contracts

The Critic is read-only and emits stable findings with severity, claim/risk,
evidence, breaking scenario, alternative, and recommended action. Raw auxiliary
output is preserved separately from primary moderation. Same-family or
same-host review is structured scrutiny, not independence proof.

The Builder may address only `open` or `carried-forward` finding IDs and only
declared candidate paths within the configured auto-file limit. Fixed or
rejected findings cannot be silently reopened. Auto admission is mechanical;
it does not prove semantic adequacy.

Before Evaluator transport begins, `evaluator-invocation.json` commits the
`invocationId`, `reviewer`, `transport`, `expectedRunDir`,
`candidateFingerprint`, and `evidenceBundleFingerprint`. This changes state
from `evaluator-required` to `evaluator-running`; a duplicate start is rejected.
Import accepts only the exact recorded directory, reviewer, and fingerprints.
If that invocation is interrupted, no agent may infer permission to call it
again: a human must inspect it and explicitly `reopen` or `abandon`, or import
the exact completed run.

The resulting fresh Evaluator checks all six dimensions plus whole intent,
closes existing findings, may add structured findings, declares context and
independence limits, records unobserved reality/residual unknowns, and emits one
of exactly:

- `candidate-ready`
- `fix-required`
- `needs-user`
- `blocked-by-environment`
- `non-convergent`

Malformed Evaluator output may receive one fresh formatting-only retry over the
unchanged packet and fingerprints; the first output is not fed into the retry.
A second unusable result is recorded as an environment block, never repaired
into a semantic verdict by the primary.

### Progress, staleness, and authority

Each cycle records Critic-time open P1/P2 baseline, recurrence signatures,
verdict history, and progress diagnostics. Legacy state without that baseline
is explicitly `unknown-legacy-baseline`; it is not reconstructed from later
Builder dispositions and cannot invent a no-progress breach. Recurrence,
same-candidate verdict oscillation, configured no-progress, hard maximum-cycle,
and wall-clock bounds preserve artifacts and route to human inspection.

Any candidate/evidence/policy/fingerprint change makes downstream proof or
verdict stale. `candidate-ready` means the exact current candidate is ready for
a human trust checkpoint within recorded coverage. It is not human acceptance,
truth, correctness outside observed evidence, or merge/release authority. In
particular it is not merge or release authority. Scope expansion, requirement
reduction, proof-strategy change, public/high-risk semantics, unresolved value
or risk judgment, non-convergence, and residual acceptance remain human-owned.

## Native Docs Substrate Contract

When a project uses `docs/changes/` as its primary substrate, SteadySpec owns a
minimal structural contract for its own docs-mode artifacts. OpenSpec-backed
projects still use OpenSpec's schema and lifecycle.

Docs-mode `init` installs:

```text
.steadyspec/substrates/docs/
  contract.json
  templates/
    proposal.md
    tasks.md
    evidence.md
    trust-checkpoint.md
    archive.md
```

The substrate state records:

```json
{
  "contract": {
    "name": "steadyspec-docs",
    "version": 1,
    "path": ".steadyspec/substrates/docs/contract.json",
    "templates": ".steadyspec/substrates/docs/templates"
  }
}
```

`steadyspec check <change-id-or-path> --phase proposal|apply|verify|archive
--substrate docs` validates structure, not semantic truth. Missing
`schemaVersion: 1` is a legacy warning. Missing required phase anchors, missing
required evidence/trust fields, and archive claims that convert fallback/debt
into proof are errors.

The checker is a support command, not a sixth governed verb.

## v0.5 Cross-Agent Review Lane

`steadyspec cross-review` is a Level 1 support command for preserving an
auxiliary reviewer challenge. It is not a sixth governed verb, not a sandbox,
and not proof that two agents are correct.

The v0.5 path is a single-user Windows lane: one operator, one primary
agent, and one local auxiliary reviewer. It does not promise team coordination,
third-party arbitration, merge/release gate authority, or cross-platform
reviewer execution. In this boundary, two-agent consensus means the auxiliary
reviewer's preserved output and the primary moderator's decision table converge
on the next action. A reviewer-original P1/P2 rejection or downgrade requires
the same peer to re-review the final patch without repeating the objection; if
they do not converge, the trace stays visible and the claim remains incomplete.
This convergence rule is a propose/verify/archive flow obligation. `--gate`
checks the latest run and moderation structure; it does not infer finding
identity or prove convergence across historical runs.
This is a flow-level requirement in v0.5. The mechanical gate validates the
latest run and moderation table but does not infer cross-run finding identity.
POSIX command resolution exists, but macOS/Linux smoke evidence is a future
cross-platform support gap rather than a Windows v0.5 blocker. Timeout
classification and non-empty partial stdout preservation are Windows-tested
with a controlled fake reviewer; real reviewer partial output remains best
effort because a reviewer may emit nothing before termination.
On non-Windows platforms, timeout cleanup is not yet process-tree-proven and
must be carried as part of the open POSIX smoke gap. macOS/Linux reviewer
timeouts may leave reviewer child processes running; inspect process trees
manually after a timeout until cross-platform smoke exists.
Level 2 advisory, Level 3 gated, and `--run-if-needed` are supported local
calibration surfaces in v0.5. They should not be described as multi-user
defaults in v0.5; multi-user coordination, waiver policy, and false-positive
calibration remain outside this single-user lane.
`--include-diff` packets are advisory calibration evidence in v0.5, not
merge/release gate authority, because branch, staged, unstaged, and untracked
sections are captured with separate git commands until atomic snapshotting
exists.

Optional project config:

```json
{
  "schemaVersion": 1,
  "mode": "manual",
  "reviewer": "claude",
  "passEnv": ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
  "minSignals": 1,
  "packetOnly": false,
  "riskyPathPatterns": ["^bin/", "^en/flows/", "^ARTIFACT_CONTRACT\\.md$"],
  "scopeIgnorePatterns": [],
  "boundary": "Level 1 manual; advisory context restrictions; no sandbox or automatic gate."
}
```

`steadyspec init --cross-review manual` writes this file to
`.steadyspec/cross-review.json`. `passEnv` contains environment variable names
only; it must not contain secret values. `minSignals` is the minimum number of
recommendation signals required before `--advice`, `--gate`, or
`--run-if-needed` recommends review. `packetOnly` inlines `packet.md` into the
reviewer prompt and does not grant file-read tools; it reduces context leakage
but is not an OS sandbox. `riskyPathPatterns` is an array of JavaScript regular
expression strings matched against `git status --short` paths for the
`workingTree.publicSurface` advice signal; projects should tune it to their own
runtime, schema, migration, or public documentation paths. `scopeIgnorePatterns`
is an array of JavaScript regular expression strings matched against
repo-relative paths before packet git status, untracked diff sections, advice
status signals, and scope fingerprints are rendered. Runtime and
manual/advisory defaults are `[]`; gated init writes a starter OS/editor temp
list (`^\\.DS_Store$`, `^Thumbs\\.db$`, `^\\..*\\.swp$`, `^\\..*\\.swo$`, `~$`,
`\\.tmp$`) for first-run stability. Use it only for explicit generated noise,
not for meaningful source or review artifacts. Common calibration candidates may
also include generated paths such as `^coverage/`. Tracked branch/staged/unstaged
diffs remain review scope even when a path would match this status/untracked filter.
Despite the field name, this is a status/untracked noise filter; it does not
filter tracked diff content. Packet `Scope Transparency` reports per-pattern
omission counts so nonzero values can be checked against the intended generated
noise boundary.
Command-line flags override config defaults.
`boundary` is human-readable documentation only; automation must use the
structured `mode` field.

Gated config example:

```json
{
  "schemaVersion": 1,
  "mode": "gated",
  "reviewer": "claude",
  "passEnv": ["ANTHROPIC_AUTH_TOKEN", "ANTHROPIC_BASE_URL"],
  "minSignals": 2,
  "packetOnly": true,
  "riskyPathPatterns": ["^bin/", "^en/flows/", "^ARTIFACT_CONTRACT\\.md$"],
  "scopeIgnorePatterns": [],
  "boundary": "Level 3 gated; --gate can block flow claims until review is moderated; reviewer execution requires --run or --run-if-needed; packet-only reviewer prompts are enabled by default; no sandbox or automatic moderation."
}
```

Allowed config modes:

- `off`: no project-level cross-review lane; explicit `--reviewer` can still
  override for a one-off run.
- `manual`: stores reviewer/env defaults for explicit runs.
- `advisory`: enables `--advice` to recommend a run from lightweight change
  signals. It does not invoke a reviewer and does not gate by itself.
- `gated`: enables `--gate` to turn advisory recommendation signals into a
  blocking readiness check. It does not invoke a reviewer; it requires an
  existing successful moderated run when review is recommended.

`minSignals` defaults to `1` for manual/advisory config and to `2` for gated
init. Raising it remains the v0.5 calibration knob for projects that observe
too many low-risk advisory/gated recommendations.
High-risk artifact term matching uses word/phrase boundaries so substrings such
as `author` and `archival` do not fire `auth` or `archive`; this reduces obvious
noise but does not replace observed false-positive calibration. The term list is
SteadySpec-default vocabulary, not a project-trained taxonomy; cross-domain
projects should tune `riskyPathPatterns` and `minSignals` before using advice or
gated recommendations as workflow signals.
Debate mode is visible in `signalDetails`; it contributes to `signalCount` only
when `--experimental-debate` is present, because non-experimental debate advice
can inspect scope but cannot execute a reviewer.

Each run writes:

```text
<change>/cross-agent/<timestamp>-<reviewer>-<mode>/
  packet.md
  prompt.md
  raw.md
  stdout.partial.txt
  stderr.partial.txt
  moderation.md
  run.json
  skip.md              # only when review is intentionally skipped
```

Agent Trace Record requirement: every cross-agent use must preserve who said
what and how it was resolved. `raw.md` is the auxiliary agent's proposal or
review, `moderation.md` is the primary agent's per-finding decision, and
`run.json` records reviewer identity, mode, scope, status, and warnings. Do not
replace these with a summary-only note. When a flow folds cross-agent output
into `findings.md`, `proposal.md`, `trust-checkpoint.md`, or `archive.md`, keep
the finding IDs and source path so a reader can trace each accepted,
carried-forward, rejected, or `needs-user` direction back to the originating
agent artifact.

Artifact roles:

- `packet.md`: change artifacts, mode request, advisory context boundary, and
  optional diff content. With `--include-diff`, diff content covers branch,
  staged, unstaged, and untracked review scope. Packet paths are repo-relative
  and local-path-sanitized by default; `--no-sanitize-packet` is a local
  debugging escape hatch. Sensitive untracked paths and oversized untracked
  files are listed with an omission reason instead of embedding their contents.
  Best-effort sensitive filename filtering includes common package and cloud
  credential files such as `.npmrc`, `.yarnrc`, `.pypirc`, `.netrc`,
  `.aws/credentials`, `credentials.json`, `service-account*.json`,
  `terraform.tfvars`, `*.auto.tfvars`, `.secrets/`, `credentials.yml`, and
  `secrets.yml`; this is disclosure reduction, not a secret-scanning guarantee.
  Sensitive keyword filtering is limited to hidden or credential-like
  directories rather than arbitrary `auth` or `token` filenames, so untracked
  design/source files remain reviewable unless they match a more specific
  sensitive path pattern. This omission path applies only to untracked file
  rendering; staged, unstaged, and branch diffs are captured verbatim, so staged
  or tracked sensitive files can still be embedded in packet diff content. A
  root-level file such as `api-tokens.json` is not filtered by the default
  patterns unless a project adds a custom ignore/filter policy.
  When the SteadySpec package reviews itself, packets may bundle
  `bin/cross-review.js` as an implementation reference. That self-referential
  evidence is a snapshot of the runner that generated the packet; after later
  runner edits, code-level findings are reproducible from the packet, not
  necessarily from the current working tree.
  `--include-diff` also compares working-tree status before and after diff
  capture; if the status changes, packet and `run.json` warnings mark the review
  scope as potentially non-atomic. The current coherence check does not detect
  branch-diff base-ref drift, such as a concurrent `git fetch` updating
  `origin/HEAD` or the resolved base while packet generation is running.
  The artifact manifest includes generation-time SHA-256 hashes for the artifact
  text loaded into the packet, so packet-only reviews have a stable snapshot
  reference that matches the packet body even if a file changes later. The
  reviewer cannot independently verify those hashes without file tools; they are
  for moderator audit and stale-packet investigation. Moderators should recompute
  or spot-check hashes for the artifact(s) that support archive/readiness claims
  before treating packet-only review as trusted evidence. Non-packet-only
  reviewers currently have read/search tools but no hash tool, so reviewer prompts
  ask for content/presence spot checks rather than SHA-256 verification claims.
  Non-packet-only review depends on working-tree stability between packet
  generation and reviewer file reads; gated defaults prefer `packetOnly: true`
  for the stronger snapshot boundary.
  Packets include `## Scope Transparency`, which reports active
  `scopeIgnorePatterns`, git-status/untracked path omission counts per pattern,
  and counts for sensitive, oversized, non-regular, outside-repo, or unreadable
  untracked diff omissions. This does not let a packet-only reviewer inspect
  omitted contents, but it gives the reviewer a visible surface for challenging
  packet completeness and suspicious scope shaping.
- `prompt.md`: exact prompt supplied to the auxiliary reviewer.
  With `--packet-only`, this prompt contains the full packet inline and the
  Claude runner uses `--bare` plus disallowed file/edit/shell tools. This is the
  preferred gated-mode integrity path, but it does not provide OS-level path
  isolation.
  Reviewer prompts require `F1`, `F2`, ... finding IDs for automated checks and
  ask for a `Boundary Disclosure` section when denied context was attempted,
  accidentally used, or unavoidable.
- `raw.md`: reviewer stdout/failure report, never rewritten into durable truth.
  For `rawSchemaVersion: 1` runs, `## STDOUT` is the stdout extraction marker;
  if it is missing, latest checks fail closed instead of scanning mixed metadata
  as reviewer stdout. Legacy runs without `rawSchemaVersion` keep a conservative
  compatibility fallback after the `Output Format` line. Legacy run artifacts
  that lack both `rawSchemaVersion` and a recognizable `Output Format` line may
  be treated as unstructured even if they contain findings elsewhere; recreate
  those runs with the current runner before using them for gate claims.
- `stdout.partial.txt` / `stderr.partial.txt`: streamed process output for
  timeout/interruption audit. On Windows, timeout cleanup attempts to terminate
  the reviewer process tree with `taskkill /T`; real-process orphan checks
  remain part of future timeout hardening. On non-Windows platforms, timeout
  cleanup currently carries the open POSIX process-tree limitation. These files
  contain only bytes the reviewer process wrote before termination; a reviewer
  that buffers output internally may still lose findings on timeout. If a
  timeout preserves structured findings, `run.json.failureClass` may be
  `reviewer_timeout_with_output`; latest checks can treat the moderated output
  as pass-with-warning evidence instead of unusable output, but gated mode
  blocks this warning because timeout-truncated findings may be incomplete.
  `--max-output-bytes` bounds stdout/stderr kept in `raw.md` and `run.json`; the
  full reviewer stream still remains in the partial output files when the
  process wrote more bytes.
- `moderation.md`: primary-agent decision table; starts as `status: template`
  and must become `status: complete`. Latest checks read `Finding ID`,
  `Severity`, and `Moderator Decision` by table header when available, so
  moderators may add extra columns without changing the decision contract. A
  moderation table with decision rows but no recognizable header is unreadable
  and cannot satisfy latest checks or gates; keep the canonical English header
  labels when customizing columns. The table is also the trace bridge from
  auxiliary suggestion to durable SteadySpec action: each row should preserve
  the reviewer finding ID, the primary decision, and the follow-up artifact or
  reason so later readers can distinguish auxiliary advice from primary-agent
  acceptance.
- `run.json`: command metadata, reviewer status, failure class, output format,
  `rawSchemaVersion`, platform, prompt/output sizes, `scopeFingerprint`,
  `diffCoherent`, `gitStatusStable`, `diffSectionStatus`, `diffAtomicity`, and
  environment variable names passed to the reviewer. It must not record
  environment values. It is a local audit artifact and may contain absolute
  local paths; generated files include `containsAbsolutePaths: true` plus an
  inline `_warning` reminding users not to share it without sanitization. In
  v0.5, `containsAbsolutePaths` is always `true` because `run.json` records
  `repo`, `changeDir`, `outputParentDir`, and artifact paths as absolute local
  paths.
  On non-Windows reviewer execution, `warnings` records that POSIX support is
  implemented but smoke-untested for v0.5. If a non-Windows reviewer run times
  out, `warnings` and `raw.md` also record that process-group timeout cleanup
  remains smoke-untested until cross-platform smoke exists.
  `gitStatusStable: false`/`diffCoherent: false` means the working tree changed during multi-section
  diff capture; latest checks treat the run as pass-with-warning evidence.
  When drift is observed, `run.json` records `diffCoherenceDrift` with added and
  removed `git status --short` lines so moderators can judge whether the drift
  affected the reviewed scope. Include-diff runs also record `diffSectionStatus`
  with per-section status-before/status-after values and SHA-256 content
  rechecks for branch, staged, unstaged, and untracked diff sections. Its basis
  is `per-section-status-and-content-recheck`, and its `verificationMethod` is
  `re-render-git-section-command`; it is stronger than a single
  before/after status check but still not an atomic filesystem snapshot.
  `gitStatusStable: true`/`diffCoherent: true` is still only the `diffCoherenceBasis`
  (`git-status-short-before-after`) for the packet capture window. It means the
  before/after status checks matched; it does not prove the branch, staged,
  unstaged, and untracked sections were captured as an atomic snapshot. When a
  flow requests `--include-diff`, latest checks and gates require
  that same scope; the scope match is hard, while diff-content authority remains
  advisory in v0.5.
  Current `--include-diff` runs record `diffAtomicity:
  multi-command-status-only`; latest checks treat that as pass-with-warning
  evidence until a future atomic snapshot path exists.
  `stdinBytes` records the actual reviewer stdin prompt size; `auditBytes`
  records packet plus prompt artifact size; `inputBytes` is a deprecated
  compatibility alias for reviewer stdin size, and new consumers should prefer
  `stdinBytes`. New run metadata also carries `_deprecatedInputBytes` next to the
  alias so standalone `run.json` consumers see the deprecation. `--max-prompt-bytes` blocks only `stdinBytes`; it is a
  runner-side guard, not proof that the reviewer model's real context window can
  consume the entire prompt.
  `maxOutputBytes` records the stdout/stderr capture limit used for `raw.md` and
  `reviewerResult.*CapturedBytes`; `reviewerResult.*Truncated` tells consumers
  to inspect the partial stream files before treating missing tail content as
  absence of reviewer evidence. `runArtifactHashes` stores generation-time
  SHA-256 hashes for `packet.md`, `prompt.md`, `raw.md`, and the initial
  `moderation.md` template; v0.5 records these slots for future tamper-evidence
  work, but `--check-latest` does not yet enforce them. `runArtifactHashesNote`
  repeats that audit-only boundary inside each new `run.json`.
  Packet-only prompts include the packet inline, while non-packet-only prompts
  send only the packet path and record large `auditBytes` as a warning instead
  of blocking reviewer execution.

`--check-latest` ignores dry runs for evidence acceptance, reports
`status: "dry-run-only"` when only dry-run artifacts are present, and checks the
latest real run matching the requested reviewer, mode, `--include-diff` setting,
`--packet-only` setting, and current packet fingerprint:

The packet fingerprint intentionally includes conservative packet-generation
signals such as implementation-reference and repo-identity warnings. Cross-fork
or cross-checkout evidence reuse is out of scope for v0.5; when those signals
change, require a fresh review rather than normalizing them away.

- reviewer status is `success`;
- failure class is `none`;
- output format is `findings_table` or `numbered_findings`;
- raw output reclassifies as `findings_table` or `numbered_findings`;
  findings-table rows must carry both a finding ID and P1/P2/P3 severity in the
  same table row;
  heading-style numbered findings with explicit `Severity:` or `Priority:` P
  labels are also recognized; loose priority/severity tables without finding
  headers or labeled finding IDs remain unstructured;
- moderation is `status: complete`;
- moderation has at least one decision row, unless the primary moderator records
  `- No findings: confirmed` after verifying the reviewer produced no findings
  requiring classification.
- P1/P2 rejected moderation rows with weak or placeholder `Reason` text make
  latest checks pass with warning instead of silently becoming high-confidence
  review evidence. In gated mode, the same weak P1/P2 rejection warning blocks
  readiness instead of becoming satisfied-with-warning evidence. Short explicit
  cross-references such as `Duplicate of F3`, `Intentional per D5`, or
  `See D5 in design` are treated as substantive references rather than weak
  placeholders. Bare references such as `Per D99` are not sufficient; `per`
  references need a short justification fragment after the reference. The v0.5
  heuristic treats rejection reasons shorter than 20 characters as weak unless
  they match a recognized cross-reference pattern, and also treats placeholder
  phrases such as `n/a`, `none`, `ok`, `disagree`, `declined`, `won't fix`,
  `will not fix`, `false positive`, `not needed`, and `cosmetic` as weak.
- `- No findings: confirmed` conflicts with structured raw reviewer findings;
  latest checks pass with warning when this bypass shape appears.
Scope fingerprints include filtered git status. Temporary files, build outputs,
or other benign working-tree noise can make a previously moderated run stale
unless the project explicitly lists that generated noise in
`scopeIgnorePatterns`. Matching repo-relative paths are omitted from packet git
status, untracked diff sections, advice status signals, and the scope
fingerprint when the noise appears only through those sections. Tracked
branch/staged/unstaged diffs and non-ignored changes still require fresh
evidence. Packet `Scope Transparency` reports the count each pattern omits; a
surprising nonzero count is a coverage-risk signal, not proof that the omitted
content was safe.

`--check-latest` exit codes:

- `0`: pass.
- `1`: pass-with-warning, such as denied-context pattern matches after an
  otherwise valid review, a moderation table that rejects every finding, weak
  P1/P2 rejection reasons, a `No findings: confirmed` conflict with structured
  raw findings, or a moderation table with P1/P2 findings but no accepted or
  carried-forward P1/P2 rows.
- `2`: no run found, only dry-run artifacts found, or the latest scoped run was
  intentionally skipped.
- `3`: reviewer failed, timed out, or produced no usable output.
- `4`: moderation is missing or incomplete.

Explicit `--run` exits `0` when the reviewer process produced structured output
and exits `3` whenever reviewer output is unstructured, even if the reviewer
process also exited non-zero. It exits `1` for reviewer process failures whose
output is otherwise structured or empty. `--run-if-needed --json` reports its
own `exitCode` field and may return `0`, `1`, or `3` depending on whether it
skipped execution, reused a warning-bearing run, launched a reviewer, or received
unstructured reviewer output. Existing unusable evidence causes
`--run-if-needed` to run the reviewer rather than propagate latest-check exit
code `4`.

Context boundaries are advisory in v0.5. The Claude CLI path uses read-only
tool flags but does not provide OS-level path isolation.
`--packet-only` is stronger than the file-read path because it passes the packet
inline, uses Claude `--bare`, and disallows file/edit/shell tools; it still does
not sandbox the process or prove the reviewer ignored all local context.
Claude reviewer runs refuse CLI versions below the tested minimum because
tool-boundary flags are part of the safety contract in both packet-only and
non-packet-only modes.
Gated init writes `packetOnly: true` by default; operators that rely on reviewer
file spot-checks should either stay in manual/advisory mode during calibration
or pass `--no-packet-only` for a specific gated run and carry the broader context
exposure as a limitation.
The default scrubbed reviewer environment excludes home/config path variables
such as `HOME`, `USERPROFILE`, and `XDG_CONFIG_HOME`; pass them explicitly only
when a reviewer CLI truly requires them.
Closure proofs and scrubbed reviewer runs both construct their environment
through `en/runtime/closure-env.js`. The proof caller uses the shared Windows
baseline plus policy `envKeys`; the reviewer caller adds only its documented
CLI compatibility keys, named `--pass-env` keys, and the
`STEADYSPEC_CROSS_REVIEW_CHILD=1` process marker. Inspection artifacts contain
key names and their sources, never values. A missing proof `envKeys` name fails
closed; a missing reviewer `--pass-env` name is recorded in
`environment.missingExplicitKeys` and emitted as a warning, which prevents that
run from satisfying a warning-free gate. Windows key lookup is
case-insensitive while the actual source spelling is preserved once, so a
single `Path` value is not duplicated as `PATH`.
`TEMP` and `TMP` remain in the scrubbed environment for reviewer CLI
compatibility. They are not recorded with values in `run.json`, but on some
platforms their actual runtime values may point under a user profile directory
and can reveal the OS username to the reviewer process, especially on Windows.
`--dangerously-inherit-env` is an explicit dangerous escape hatch; prefer
`--pass-env` with named provider auth variables. The old `--inherit-env` spelling
is rejected so the risk is visible at the call site. Runs using
`--dangerously-inherit-env` add a structured warning to `run.json`; gated mode
blocks that warning so a full-environment reviewer run cannot satisfy gated
readiness. The shared-helper fixtures prove construction and key-only reporting
for synthetic inputs; they do not prove OS-level secrecy or sandbox the child
process.

Path sanitization reduces accidental local path disclosure in `packet.md` and
`prompt.md`. It is not a privacy or sandbox guarantee for the full run directory,
because `run.json` intentionally records local paths for audit/debugging.
Packet rendering replaces the repo path plus common local path env values
(`HOME`, `USERPROFILE`, `TEMP`, `TMP`, `APPDATA`, `LOCALAPPDATA`, and
`XDG_CONFIG_HOME`) when those values appear in packet text.
When `steadyspec init` enables cross-review, it appends `**/cross-agent/` to
`.gitignore` so local run artifacts are not staged by accident. Full export
sanitization remains a separate future policy before sharing complete run
directories. Custom `--output-dir` locations outside the repository bypass that
init-time `.gitignore` protection; `run.json` records a warning for those runs.

For flow integration, use:

```bash
steadyspec cross-review --change <change-id-or-path> --advice --json
steadyspec cross-review --calibrate-dir <changes-dir> --mode review --include-diff --verbose --json
steadyspec cross-review --change <change-id-or-path> --gate --json
steadyspec cross-review --change <change-id-or-path> --run-if-needed --json
steadyspec cross-review --change <change-id-or-path> --run-if-needed --force --json
steadyspec cross-review --change <change-id-or-path> --mode review --include-diff --check-latest --json
```

The advice JSON includes `status`, `recommended`, `policyActive`,
`adviceActive`, `gateActive`, `configMode`, `reasons`, a `suggestedCommand`
when signals recommend a run, and `suggestedCommandNotes` for known caveats in
that command. With `--verbose`, advice/gate/run-if-needed JSON also includes
`signalDetails` for calibration, including fired signals, matched high-risk
terms, and high-risk terms removed by explicit negation. Even when config mode is
`off`, `--advice --verbose --json` reports observed signal details while keeping
`recommended: false`. Negation filtering is intentionally approximate: it scans
within a bounded clause window of about 200 characters, so unusually long
negated clauses can still fire as false positives and should be handled through
calibration. Calibration JSON from `--calibrate-dir` includes
`changeCount`, `recommendedCount`, `pathSignalsAvailableCount`,
`signalCountSummary`, `calibrationNote`, and per-change advice entries.
Per-change entries include `pathSignalsAvailable` and
`pathSignalStatusLineCount` so clean or already-committed historical changes do
not masquerade as zero path risk. It does not invoke reviewers or create run
artifacts.
The batch helper is intentionally non-recursive: callers must pass a parent
directory whose direct children are change directories, such as `.meta/changes`
or `docs/changes`, rather than a higher-level archive root.
The gate JSON includes
`status`, `policyActive`, `recommended`, `latest`, warnings, and errors. In
`gated` mode, `status: blocked` exits `5` when a recommended review is missing,
failed, stale for the requested scope, unstructured, or unmoderated. The
gated check also blocks all-rejected moderation tables, conflicting
`No findings: confirmed` moderation, and P1/P2 finding sets with no accepted or
carried-forward P1/P2 rows. It also blocks weak or placeholder P1/P2 rejection
reasons. It also checks reviewer-original
P1/P2 severities so a moderation table cannot satisfy the gate by downgrading
every serious reviewer finding to P3. Latest checks warn when reviewer finding
IDs are missing from the moderation table, making omitted findings visible as
pass-with-warning evidence. `needs-user` is a first-class gate stop: if any
P1/P2 moderation row or reviewer-original P1/P2 row is routed to `needs-user`,
or if a reviewer-original P1/P2 finding has no moderation row, gate JSON returns
`status: needs-user`, `action: user-confirmation-required`, `resolutionHint`,
and exit `5`.
This conservative P1/P2 policy can
be stricter than a project ultimately wants when every reviewer P1/P2 is genuinely
rejected with strong reasons; waiver policy remains future work before gated
mode becomes a shared workflow default. In gated mode, denied-context warnings also block
instead of becoming satisfied-with-warning evidence. This blocking is pattern-based and
best-effort: it covers known Windows home/AppData, WSL/UNC, macOS
application-support, Unix home, env/key/cert, and prior cross-agent path shapes,
but novel encodings, line wrapping, or path formats can bypass the scanner. The
scanner reports "no detected disclosure", not proof of compliance or proof that
the reviewer ignored denied context.
scanner matches reviewer home config directories both with and without a trailing
path separator, including standalone `.claude`, `.codex`, and `.ssh` mentions.
The denied-context scanner ignores obvious boundary-restatement lines such as
"I will not access ..." and suppresses a dedicated `Boundary Disclosure` section
so compliant reviewers are less likely to block gated mode by merely repeating
the denied paths. Boundary disclosures that report actual or possible access,
such as "I accidentally read ..." or "I could not avoid ...", remain scannable
and can produce denied-context warnings; denied-path lines inside the disclosure
that are not part of an obvious restatement list remain scannable even without
access verbs. It also filters simple scope-description lines such as "the .codex
folder was outside scope", but descriptive denied-path mentions that do not match
those heuristics can still warn or block. Reviewer execution on non-Windows requires
`--experimental-posix` until cross-platform smoke exists; advice, packet generation, latest
inspection, and read-only gate checks remain available without that opt-in. The
run-if-needed JSON includes
`status`, `action`, `latestBefore`, and `run`. It may invoke a long-running
reviewer process, but it does not moderate findings; successful reviewer output
still leaves `moderation.md` at `status: template` until the primary agent
classifies findings. The latest-check JSON includes `status`,
`exitCode`, latest run identity, reviewer status, failure class, output format,
moderation status, decision-row count, warnings, and errors. Flows should treat
`status: pass-with-warning` as usable evidence with explicit limitations, not as
  a clean pass. `--run-if-needed --force --json` keeps the advice check but
ignores an already usable or warning-bearing latest run and invokes the reviewer
again.
Gate JSON includes `action: "moderation-required"` when a scoped reviewer run
exists but the moderation artifact is still incomplete, allowing flows to route
to moderation instead of treating the block as a missing reviewer run.

### Deterministic Claude Workflow Preflight

The installed Claude `verify` and `archive` workflow scripts use a stricter
read-only carrier than the general skill guidance. They may consume existing
state only through `--advice --json`, `--gate --json`, and an exact claim-bound
`--check-latest --json`. They never plan reviewer-launch, force, skip, automatic
moderation, or experimental execution flags. Advice `suggestedCommand`, gate
`action`/`resolutionHint`, and every command-shaped JSON field remain report
data and are never followed automatically.

An explicit implementation-review claim has precedence over policy advice. It
must bind reviewer, `mode=review`, `includeDiff=true`, packet-only choice, and
the exact output directory. The explicit source list is what creates the claim;
`claimRequired` must agree with that list in both directions. Exactly one
observed candidate artifact parent must normalize to the same output directory;
missing, duplicate, ambiguous, traversal-bearing, or mismatched scope blocks the
claim without defaulting to the newest run. Change, artifact, and output
declarations are repository-relative; explicit claim sources are
change-relative. Both domains use the same strict lexical spelling rules, but
the workflow does not pretend they have the same base. Absolute, drive-relative,
UNC/device, URI, home, encoded-percent, control/format, traversal,
alternate-data-stream, reserved-device-name, duplicate, and case-only alias
forms fail closed; slash and harmless dot segments are canonicalized before an
exact comparison. This is lexical declaration hardening, not existence,
filesystem identity, or symlink/junction containment proof. In gated mode the
exact latest check is followed by
the same scope's read-only gate; gate `not-required` cannot upgrade a failed
claim check. Without an explicit claim, gated mode runs the gate and other modes
run advice. Existing artifact directories alone are unbound traces, not claims.

Workflow code validates the planned argv against the reported executed argv,
requires the exact planned observation count/order/kind, parses one JSON value,
binds JSON/shell exit semantics and policy config mode, and rejects observed
reviewer launch or moderation write. A ready latest check or gate must carry an
exact, current-host native absolute `run.json` identity. Windows ADS, reserved
device names, illegal characters, UNC/device forms, trailing dot/space, and
foreign-host path forms fail closed. For an explicit claim, both the reported
output parent and direct child run path must be under the exact
`projectRoot + outputDir` plan. `check-latest` may supply only its top-level
trace; gate readiness may supply only `latest`, whose status/exit pair must be
`pass/0` or `pass-with-warning/1` as appropriate. A check/gate pair may support
one claim only when their raw path strings are byte-identical; shadow carriers,
a same-looking but different trace, and reordered or extra observations block
instead of being combined. This v0.6.1 correction does not add an observation
fingerprint to the public cross-review JSON contract, so same-path content
replacement between observations remains a named residual risk. `needs-user`,
moderation-required, invalid, missing, skipped, failed, stale, or unstructured
claim evidence cannot support archive readiness.

Advisory recommendations remain non-blocking limitations. The archive composer
returns only six fixed arrays of source-attributed narrative items. Every source
reference must exactly match a code-built allowlist, and extra authority fields
such as readiness, `runJson`, an archive path, or arbitrary archive Markdown are
rejected. Workflow code escapes and quotes each narrative line as explicitly
non-authoritative data, renders all headings and facts, and appends exactly one
final namespaced machine claim block. Natural-language claim-like prose is not
treated as a machine claim and is not promised to be semantically classified;
only that namespaced block is machine-recognized. When included, the block binds
the exact `run.json`; when no explicit claim was made, it records `Included:
no`, `Readiness: not-claimed`, and `Run JSON: None`. It also states that this is
auxiliary evidence, not human acceptance, truth, merge, or release authority.

The `archive` workflow renders exact UTF-8 content, prepares an
`archive-finalize` transaction, and stops at `ready-for-human-archive` plus
`needs-user`. Prepare does not write `archive.md`, move a change, or report
`archived`. The returned archive location is derived in dependency-free code
from the strict change ID, selected substrate, and exact active change root; a
gather-agent path is neither accepted nor forwarded. The public docs check
command remains useful diagnostics, but only the transaction helper's check of
the bound staging tree can support the filesystem transition.

### Hash-Bound Human Decision Transaction

The existing `steadyspec` executable has a hidden internal support route; it is
not a sixth methodology verb and is not listed by public help or the workflow
manifest:

```text
steadyspec internal human-transaction prepare --kind <intent-expansion|archive-finalize> --change <active-change> --request <request.json> --json
steadyspec internal human-transaction status --decision-id <id> --json
steadyspec internal human-transaction commit --decision-id <id> --decision-record .steadyspec/human-transactions/<id>/decision.json --json
steadyspec internal human-transaction cancel --decision-id <id> --decision-record .steadyspec/human-transactions/<id>/decision.json --json
```

`pending.json` is immutable and binds the kind, active change/repository and
helper runtime identity, exact source bytes or manifest, exact operation and
preview, expected postconditions, one-time decision ID, binding hash, and
pending hash. Valid prepare writes control-plane transaction state only and
returns `needs-user`; malformed input fails before a pending record is created.
An active change root must have a non-reserved basename and an exact regular
`proposal.md`; an archive container is never an active change. Archive source
and target roots must also be disjoint in both containment directions.
The primary thread, not an agent schema answer, obtains the real user response
and separately persists the exact `decision.json`. `decisionBindingValid`
proves record/hash binding only. It is not a signature, identity attestation, or
proof that a named human supplied the file.

`commit.json` is a recoverable journal, not an authority source. Its self-hash
detects corruption but does not establish provenance. On every read, helper
code re-derives work paths, target lock identity, runtime identity, before
observation, and allowed phase from immutable pending state. A journal-supplied
redirect, changed decision, stale source/target/runtime, path link/alias,
unknown file constellation, or replay conflict fails closed before an
unapproved domain mutation. Target-scoped lock owner directories are published
atomically. A live owner blocks; a hash-valid dead owner can be moved to its
token-specific quarantine and the exact transaction retried without guessing.
PID reuse may conservatively block and remains an operational soft boundary.

`intent-expansion` accepts only the active change's exact `proposal.md`, one of
five declared fields, one code-derived whole-line section, and one insertion.
The insertion and addition end on line boundaries, the composed after-image is
revalidated as exact UTF-8, and pending carries the complete field before/after
bytes and text plus a deterministic one-hunk unified preview for human audit.
Commit can produce only `before[0:offset] + addition + before[offset:]`; exact
readback proves old-byte preservation and the bound insertion. It does not
prove that the new text is semantically expansion rather than narrowing. Apply
therefore stops after prepare and writes drift evidence only after an exact
commit postcondition; cancel or uncertain process observation writes no drift
evidence.

`archive-finalize` accepts direct active changes under `docs/changes`,
`openspec/changes`, or `.meta/changes`, plus an explicit custom active-change
path that already contains `proposal.md`. Custom mode still derives only the
fixed sibling `<base>/archive/<change-id>` target; callers cannot supply an
arbitrary move target. It binds source and target manifests plus rendered archive bytes,
builds a same-parent staging tree, runs the bound docs check when required,
commits the target, atomically detaches the unchanged source, and removes the
retired tree. Only exact target/archive readback, source/staging/retired absence,
current pending/approve-decision binding, and a fresh target docs check may
return filesystem `archived`. That state is not human acceptance, truth, merge,
publication, or release authority.

Apply/archive workflow code owns the argv and decision path, requires an exact
non-empty `changeDir` on every resume, and requires exact
argv/exit/single-JSON/change-root agreement. Before commit or cancel it runs the
helper's read-only status action and binds decision ID, kind, change ID, and
change root; a mismatch stops before the mutating action is invoked. Workflow
code never follows command-shaped output. The host process call and its
returned stdout remain agent-mediated observations, not proof that a hostile
host executed no additional command. Missing or conflicting observation routes
to inspection/recovery with the same decision ID rather than an inferred
success.

Codex reviewer execution requires `--experimental-codex` and emits an explicit
warning that Codex reviewer version checks are not implemented yet. Debate-mode
reviewer execution requires `--experimental-debate`; without that flag, debate
mode is packet-generation only. For the current mode-3 challenge lane, use
`design` or `review` mode with a challenger prompt; `debate` is still an
experimental output-mode split.

## v0.4 Capability Lane

v0.4 adds an optional capability lane for changes where the problem is not only
drift, but premature selection of a low-ceiling direction. The lane is part of
the existing five verbs. It does not add a public verb and does not let the
agent own high-risk direction choices.

Trigger the lane only when at least one of these applies:

- `fork`: two or more plausible directions have serious support
- `evidence-risk`: the proposal depends on claims that need observable support
- `mainline-risk`: selecting a default path parks or rejects meaningful options
- `high-impact-direction`: the choice changes product thesis, public surface,
  architecture, storage, security, or long-lived workflow behavior
- `low-ceiling-risk`: the user asks for stronger solution search, "wings", or
  equivalent capability-amplification framing

Do not trigger it for routine cleanup, typo fixes, simple metadata updates,
pure status reports, scratch notes, or disposable work.

### direction-map.md

`direction-map.md` is optional. It records pre-mainline solution space when a
real fork exists. The minimum useful shape is:

```markdown
## Direction Map

| Direction | Status | Basis | Evidence Needed | Reopen Trigger |
|-----------|--------|-------|-----------------|----------------|
| <name> | candidate|promoted|parked|rejected | <source or reasoning> | <proof needed or None> | <when to reconsider> |
```

Explore may create a direction map, but explore must not promote a direction to
mainline. Promotion belongs to propose, with risk routing.

### evidence-contract.md

`evidence-contract.md` is optional. It is used when a mainline claim needs proof
before it can be trusted.

```markdown
## Evidence Contract

| Claim | Support Required | Falsifier | Source Label | Coverage Limit | Status |
|-------|------------------|-----------|--------------|----------------|--------|
| <claim> | <observable support> | <what would disprove or weaken it> | deterministic-check|manual-check|user-report|same-agent-review|external-review | <what this cannot prove> | proposed|supported|weakened|blocked |
```

Qualitative evidence is allowed only when its source label and coverage limit
are explicit. Same-model debate is structured scrutiny, not independent
validation.

### Selection Findings

When debate or selection runs, record the selection result in `findings.md` or
the substrate's equivalent finding record. Do not create a default
`selection-findings.md` file if the substrate already has a finding artifact.
Selection findings must separate:

- promoted direction
- parked directions
- rejected directions
- missing evidence
- human-owned or high-risk decisions
- independence limit when the same agent or same model supplied the review

### Mainline Decision

Use a `## Mainline Decision` section in proposal or archive when the default
path matters. Do not create a default `mainline-decision.md` file.

The section should name:

- selected mainline
- why it was selected
- what evidence supports it
- what remains parked
- what was rejected and why
- fallback or reopen trigger
- owner of any high-risk direction decision

## v0.3 Responsibility Model

v0.3 adds a responsibility layer to every governed verb. The layer does not
replace proposal, evidence, review, or archive artifacts. It makes their
decision ownership explicit.

### Decision Ownership Ledger

Meaningful decisions must be recorded as ledger entries. A decision is
meaningful when it affects user-visible scope, proof strategy, risk acceptance,
public interfaces, security posture, data/storage behavior, deletion,
fallback/debt, or archive truth.

```markdown
## Decision Ledger

| decisionId | phase | decision | owner | riskLevel | riskBasis | reversibility | proofSignal | overridePath | status |
|------------|-------|----------|-------|-----------|-----------|---------------|-------------|--------------|--------|
| D1 | propose | <decision> | agent|user|shared | low|medium|high | <why> | easy|moderate|hard|irreversible | <proof or None> | <how to override> | proposed|accepted|overridden|superseded |
```

Ledger entries must preserve:

- basis: source, evidence, or reasoning used
- alternatives: serious alternatives considered
- fallback/debt: residual risk, not proof

Low-risk agent-owned decisions may be collapsed in reports, but they must not be
omitted from the ledger.

### Risk Routing

The agent may classify decisions as low, medium, or high risk, but these hard
triggers always route to the user:

- public API, CLI, or runtime interface change
- migration, schema, storage, data-loss, or irreversible state change
- security, auth, permission, secret, sandbox, or network trust boundary
- deletion, behavior removal, or narrowing of a promised capability
- contradiction with proposal boundary, non-goal, stop condition, or accepted debt
- change spanning three or more modules/layers
- re-slicing that changes scope, proof strategy, or user-visible outcome
- archive claim that turns fallback/debt into proof

Agent judgment may increase risk. It may not downgrade a hard trigger.

### Attention Report

Every user-facing verb report should separate immediate attention from audit
trail:

```markdown
## Attention Report

### Must-read
- <high-risk or user-owned decision>

### Needs glance
- <medium-risk or shared decision>

### Collapsed ledger
- <low-risk agent-owned decision with basis and override path>
```

The report may be short. The underlying ledger must remain complete.

### Apply Re-slice Event

Apply may re-slice work only by recording a re-slice event:

```markdown
## Re-slice Event

| Field | Value |
|-------|-------|
| Type | proposal-gap|implementation-discovery|proof-split|user-override |
| Slice | <slice id or description> |
| Before | <previous scope/proof/slice shape> |
| After | <new scope/proof/slice shape> |
| Risk Level | low|medium|high |
| Owner | agent|user|shared |
| Proof Impact | <what proof changed> |
| User Decision | <required if high-risk or user-owned> |
```

Re-slicing that changes scope, proof strategy, or user-visible outcome is
high-risk and user-owned.

### Trust Checkpoint

The trust checkpoint is a pre-archive verification artifact. It is not an
archive and does not replace tests.

```markdown
## Trust Checkpoint

| Field | Value |
|-------|-------|
| Change | <change id> |
| Intent Match | pass|gap|blocked |
| Evidence Credibility | pass|gap|blocked |
| Risk Routing Review | pass|misclassified|blocked |
| Debt/Fallback Visibility | pass|gap|blocked |
| Recommended Next | continue|archive|handoff|re-open-intent|stop |
```

The checkpoint must name any proof claim that is too broad for its evidence.

### Handoff Snapshot

When work pauses, changes thread, or a user asks for status, the agent should be
able to create a handoff snapshot:

```markdown
## Handoff Snapshot

| Field | Value |
|-------|-------|
| Change | <change id and path> |
| Current Intent | <one sentence> |
| Boundary | <in scope / out of scope summary> |
| Ledger Summary | <must-read plus collapsed count> |
| Pending User Decisions | <high-risk/user-owned items> |
| Proof Signals | <passed/failed/missing> |
| Drift Events | <events or None> |
| Debt/Fallback | <accepted debt, fallback, or None> |
| Next Safest Action | <action> |
```

### Durable Truth Gates

Archive and strategy surfaces must keep truth durable:

- Archive citations to document sections must resolve to existing headings or
  anchors before archive write.
- Cross-change doc staleness should be surfaced as strategy-rollup input, not
  auto-edited.
- Structural rot can be consumed as external proof input. SteadySpec does not
  own linter, complexity, or architecture metric design in v0.3.

## Evidence Table Format

Each completed slice in `evidence.md` must use this table shape:

```markdown
## Slice N: <behavior>

| Field | Value |
|-------|-------|
| Proof Command | <proofCommand> |
| Result | <pass|fail|drift|fallback|blocked> |
| Output Summary | <summary> |
| Coverage Limit | <what this proof does not prove> |
| Linked Decisions | <decision ids or None> |
| Fallback | <fallback or None> |
| Accepted Debt | <debt or None> |
```

Fallback is residual risk, not full proof.

## Grill Question Schema

`GRILL_QUESTION_SCHEMA` must require:

- `question`
- `recommendedAnswer`
- `resolvedBranch`

It must also expose `category` as an enum so downstream artifacts can distinguish
boundary, evidence, stop-condition, non-goal, safety, dependency, and other
questions.

## Debate Findings Schema

`FINDINGS_SCHEMA` must require:

- `decision`
- `basis`
- `status`
- `blindSpotResult`
- `missingEvidence`

Templates must not silently default `blindSpotResult` or `missingEvidence` to
placeholder text.

## Migration Adapter Contract

Every Claude workflow script that reads change artifacts must apply a legacy
evidence migration rule at gather time:

- If `evidence.md` already contains `| Field | Value |`, parse recognized table
  evidence conservatively. Current canonical cell values use a `uri:` plus
  `encodeURIComponent` codec; an older table-cell encoding remains legacy input
  and keeps the complete original source in the preserved-source carrier.
- If the header is absent, treat the content as legacy free-form evidence.
- Extract what can be extracted without deleting or rewriting the source.
- Mark missing fields as `evidence-migration-unavailable`.
- Re-running the adapter must be idempotent.

Apply and verify share one dependency-free normalization contract. Gather must
return an explicit evidence source status plus the complete content string; a
truncated, incomplete, or unreadable source blocks apply and forces a verify
gap. An agent summary is not a replacement for source content. In every source
status, `evidenceSource.path`, the declared `evidencePath`, and the
`proposalPath`-derived `evidence.md` target must identify the same path before
apply implements a slice or verify evaluates readiness. A mismatch stops.

Resumed apply merges canonical evidence by `sliceIndex`. `behavior`, proof
command/result/summary/coverage, linked decisions, fallback, and accepted debt
are identity-bearing semantic fields: an exact replay is idempotent, while a
same-index difference is a conflict and must not overwrite the older row.
Drift and re-slice events use `(timestamp, slice, type)` identity and follow the
same exact-replay/conflict rule.

Legacy free-form content is retained in a `json-string-v1` preserved-source
carrier after the canonical tables. The carrier must round-trip the gathered
content string exactly and remains untrusted evidence; it cannot satisfy a
missing canonical field or support an archive recommendation. Here, lossless
means canonical-field semantic preservation plus exact carrier-string recovery.
It does not claim raw filesystem-byte identity, atomic file replacement, or
live Claude host fidelity. Consumed-source accounting is fail-closed: if the
canonical renderer cannot reproduce the complete input string, the complete
input is retained in the carrier and the normalized view stays `mixed` rather
than silently dropping unknown prose, sections, rows, or formatting.

Verify consumes a read-only normalized view and never rewrites evidence.md.
Legacy, preserved, absent, incomplete, malformed, conflicting, sentinel-bearing,
or `fallback` evidence forces `evidenceCredibility: gap|blocked` and prevents
`recommendedNext: archive`. A `fail` or `drift` proof result stops verification
readiness; a `blocked` result remains unresolved work.
Apply records every allowed proof result, not only passes, and its final route
may recommend archive only when every applicable current result is `pass` and
the re-normalized complete merged evidence view returns `archiveAllowed: true`.
Prior fallback, non-pass, preserved/mixed source, or migration sentinel cannot
be hidden by a later passing slice.
`fallback` and `blocked` remain in apply; `fail` and `drift` stop. Durable
`requiredNext: stop` outranks docs, remaining-slice, fallback, and blocked
continue branches. `Overall status: all-passed` is reserved for a non-empty
all-`pass` slice set;
fallback or any other non-pass result is `partial`, and an empty set is
`no-proof`. Apply writes only a conflict-free changed merge, then requires exact
content-string readback; a mismatch stops instead of reporting the evidence as
written.

## Patch Dependency Order

1. Establish this contract and legacy evidence migration adapters.
2. Update propose workflow shape, debate triggers, and grill budget.
3. Update apply evidence writing and refactor proof validation.
4. Restore archive Gate 2 half-auto user confirmation.
5. Add explore no-substrate and context archaeology guards.
6. Validate syntax and package consistency.

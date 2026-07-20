# v0.6.1 Release-Candidate Evidence

Evidence capture: **pre-release candidate**.

This is the public, sanitized pre-release evidence carrier for the v0.6.1
source-only reliability correction. Its observations describe candidate
construction; they do not make a time-sensitive claim about whether a Git tag,
GitHub Release, or later CI run now exists. Actual release identity must be
checked against the remote tag, GitHub Release, and Actions commit SHA. This
file does not reproduce the private `.meta` process trail and it does not claim
npm publication, external adoption, semantic truth, human acceptance, merge
authority, or release authority.

## Distribution contract

- Official source: `https://github.com/BestBlade/SteadySpec`
- npm registry publication: forbidden (`package.json` has `private: true`)
- Installable artifact: local `npm pack` tarball built from a trusted tag/commit
- Intended release tag: `v0.6.1`
- Release/tag/CI state: external remote evidence; not encoded as mutable
  present-time state in this pre-release capture

## Reproducible commands

```powershell
node --version
npm --version
npm run validate:contract
npm run validate:cross-review
npm run validate:closure
npm run validate:install
npm run validate:portability
npm run validate
npm pack --dry-run --json
git diff --check
```

To replay the Windows transport check from a committed checkout, choose a new
empty disposable directory and run:

```powershell
git -c core.autocrlf=true clone --no-local . <fresh-dir>
Set-Location <fresh-dir>
npm run validate:contract
npm run validate:portability
npm run validate:install
git status --short
```

To replay the upgrade path that keeps unchanged v0.6.0 files in CRLF while
checking out new v0.6.1 files in LF, use a full-history clone and run:

```powershell
git clone --no-checkout https://github.com/BestBlade/SteadySpec.git <upgrade-dir>
Set-Location <upgrade-dir>
git config core.autocrlf true
git checkout --detach 25cc20eb3f8a77d6972ce04b949533c1925a81d6
git checkout --detach <v0.6.1-commit>
npm run validate:contract
npm run validate:cross-review
npm run validate:closure
git status --short
```

## Local candidate environment

- Observation date: 2026-07-20
- OS: Microsoft Windows NT 10.0.22000.0 (`win32`, x64)
- Node.js: v25.9.0
- Additional focused runtime: Node.js v24.18.0 portable closure suite
- npm: 11.12.1
- Git: 2.38.1.windows.1
- Fresh and upgrade transport checks: temporary independent Git snapshots
  using `core.autocrlf=true`; the fresh clone passed and stayed clean, while
  the direct v0.6.0 worktree upgrade passed contract, cross-review, and closure
  after overlaying this uncommitted candidate. A clean final-commit upgrade is
  delegated to the separate CI job.

## Candidate evidence table

| Claim | Source class | Result | Coverage limit |
|---|---|---|---|
| Source/contract validation | deterministic local check | pass at capture, including one 107.0 s composite run | Uncommitted Windows candidate observation; final identity comes from remote CI/tag |
| Cross-review contracts and Workflow preflight | deterministic/synthetic fixtures | pass | No real reviewer-quality claim |
| CRLF schema transport, mixed-EOL v0.6.0 worktree upgrade, plus content-mutation rejection | deterministic portability fixture plus real Git upgrade replay | pass | UTF-8 source and JSON schemas; not arbitrary encodings or arbitrary historical upgrade paths |
| Real Windows 8.3 and long-path identity | runtime observation plus deterministic identity check | pass on one local NTFS host | One volume/configuration; junction checks remain TOCTOU-bounded |
| Closure, human transaction, and interruption contracts | deterministic plus bounded Windows runtime fixtures | pass locally (40.4 s in the composite run; 44.8 s focused on Node 24.18.0) | No arbitrary side-effect isolation or final archive contention |
| Fresh local tarball install and CLI lifecycle | isolated local install smoke plus `autocrlf=true` clone replay | pass locally (7.3 s suite; clone replay also pass) | Local source package on one Windows host, not registry publication |
| Windows/Linux Node 18/22/24 source and local-install matrix | GitHub Actions | not part of local capture | Query Actions for the exact pushed SHA; CI is bounded execution evidence, not semantic acceptance |
| Exact release commit/tag | Git/GitHub | external to this capture | Query the remote tag/Release; requires a human release decision |

## Residual debt

- Windows remains the only platform with real reviewer/process interruption
  dogfood; Linux CI covers portable source and local-install contracts.
- A same-family or same-project Critic/Evaluator is structured scrutiny, not an
  independent source of truth.
- Multi-author concurrency, issue-tracker lifecycle, arbitrary side effects,
  hostile-host attestation, and external adoption remain unvalidated.
- A green suite proves only its enumerated checks. The human remains responsible
  for accepting the candidate and authorizing a tag/Release.

Machine-readable state is in [manifest.json](manifest.json).

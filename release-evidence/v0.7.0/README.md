# v0.7.0 Assurance Protocol Candidate Evidence

Evidence capture: **pre-release candidate**.

This is the public, sanitized evidence carrier for the experimental v0.7
Assurance Protocol Candidate and its product-continuity correction. The current
capture is an uncommitted working tree based on product-continuity correction
commit `82da4603503be47e2b272b26aa618d410fe40fc1` on branch
`codex/v0.7-assurance-core`; it is not an immutable release identity. A later
commit, tag, GitHub Release, or CI run must be checked independently against its
exact SHA.

No comparative effectiveness result exists. This capture does not show that
SteadySpec reduces drift, human review burden, or recovery cost. It also does not
claim external adoption, semantic truth, actor authentication, reviewer
independence, human acceptance, merge authority, or release authority.

## Candidate identity and distribution

- Protocol/package candidate: `0.7` / `0.7.0`
- Capture date: 2026-07-22
- Capture kind: local uncommitted candidate, not a tag or release
- npm registry publication: forbidden (`package.json` has `private: true`)
- Installable artifact: local `npm pack` tarball built from a trusted commit
- Remote CI/tag/Release: external to this capture and not observed here

## Product-continuity rejection and two-stage correction

Commit `3c35b39` passed its technical Critic/Evaluator loop and all six local
validation suites, but the user rejected it as a product candidate. Its docs
called SteadySpec's canonical five-flow software lifecycle a legacy recipe and
made the assurance protocol appear to be the successor product. The validators
were green because they checked the shifted v0.7 target rather than continuity
with the v0.1-v0.6.1 product identity.

The v1 corrected candidate preserved the assurance implementation and restored the
five canonical verbs, attention/responsibility, capability-without-drift, and
host-goal boundary through [PRODUCT.md](../../PRODUCT.md). It retains records
per change and aggregates strategy signals, but defines no model-independent
goal-to-change lineage or completion semantics. It also records
product-identity changes as human-owned and adds deterministic drift signals.
The validator pins the normalized English and Chinese v1 contract content in
code as well as in the source and release manifests; a negative fixture rebinding
both manifests still fails unless the validator baseline or contract version is
also changed. This makes a coordinated product-identity edit explicit in code;
it does not authenticate a human or turn approval into machine truth.

The user then supplied the older product rationale that preceded the eight
mechanisms: SteadySpec addresses the delegation gap when Agents perform more
consequential work than the responsible person can practically redo or inspect,
while external authority and consequences remain human or organizational. That
clarification, followed by explicit authorization to execute it, revealed a
second hierarchy problem: v1 protected the current
five-flow architecture too close to the product purpose.

Contract v2 preserves exact v1 English/Chinese contracts, defines stable
purpose and principles above mechanisms, and retains the five verbs as the
current normative, compatibility-protected software reference architecture.
Responsibility is an external operating premise, not a protocol output. The
whole-product experiment remains a not-yet-pre-registered design candidate and
has no result.

The first v2 review then found a P1 operational gap: installed flows still
treated the user's whole prompt as one intent string, so a questionable
technical means could be frozen as if it were the authorized outcome. The
candidate therefore adds a shared delegation boundary across router, explore,
propose, apply, verify, Codex/Claude entry surfaces, deterministic Claude
workflows, and docs contract version 2. Consequential work separates Authorized
Outcome, Hard Constraints, Challengeable Assumptions, Proposed Means, Delegated
Decisions, and Challenge Resolution. `needs-human`, missing classification, or
an unresolved consequential challenge blocks apply/verify. This is an additive
behavior correction discovered during implementation; it is not evidence that
the classification is semantically correct or that a human decision is wise.

Later exact-worktree review found two more candidate defects rather than
accepting green syntax checks: a stray unary `+` before the shared Claude helper
marker made the first helper unavailable at runtime while the old validator
silently sliced the prefix away; and non-docs archive paths did not repeat the
delegation/trust gate. The marker is now required to be an exact standalone
line, the helpers are executed from source scope, and archive on every substrate
requires a ready boundary plus a present trust checkpoint whose five gates are
all `pass` and whose Recommended Next is `archive`. Authority refs now require
portable change-relative `path.md#heading` shape; docs mode also rejects missing
target files or headings. These checks still do not authenticate an actor or
prove that referenced text semantically authorizes the change.

A subsequent exact-worktree round found a deeper P1: archive still consumed an
Agent-returned trust/delegation object, and a pre-existing pending transaction
could resume before the workflow gather gate. The correction adds the public
`steadyspec delegation-check` process, direct proposal/trust/authority target
readback for OpenSpec, docs, `.meta`, and custom layouts, and authority-target
bytes in the artifact fingerprint. Archive prepare records that fingerprint and
the checker policy identity; commit, replay, and recovery re-read the actual
location and reject missing/stale/legacy bindings. Negative fixtures cover
missing target/heading, traversal, missing/blocked trust, and a forged legacy
pending record. This is model-independent structural readback, not actor
authentication, semantic authority, human acceptance, or correctness.

The next frozen-candidate review found a separate write-before-check path
bypass. An explicit custom base could be a symlink/junction resolving into a
built-in namespace or outside the repository. The lexical workflow gate
accepted it, and `propose` could write context, grill, debate, or proposal files
before the later realpath-aware `delegation-check` rejected the resolved path.
The correction adds the public read-only `steadyspec delegation-path-check`,
runs it before the first proposal artifact write, and carries the zero-write
rule through the canonical primitive, governed path, router, flow, and
Codex/Claude entry surfaces. Contract fixtures cover base, nested, and
active-child links with a real Windows junction; the same fixture selects a
directory symlink on POSIX. They compare target proposal bytes before and after
the rejected preflight. Installed-source smoke executes the new command. The
process result is still observed through the same Agent, and the preflight does
not prevent a hostile host or a filesystem race after the check. POSIX execution
was not observed in this capture.

## Reproducible commands

```powershell
node --version
npm --version
git --version
git branch --show-current
git rev-parse HEAD

node bin/assurance.js reduce --trace protocol/examples/empty-trace.json --json
node bin/assurance.js reduce --trace protocol/examples/minimal-ready-trace.json --json
node tests/assurance-conformance.js --help
node tests/assurance-conformance.js
node tests/assurance-conformance.js --implementation node --arg bin/assurance.js
node tests/assurance-conformance.js --implementation node --arg bin/assurance.js --include-v06-projection

npm run validate:assurance
npm run validate:contract
npm run validate:cross-review
npm run validate:closure
npm run validate:install
npm run validate:portability
npm run validate
npm pack --dry-run --json
git diff --check
```

This negative control is expected to exit non-zero:

```powershell
node tests/assurance-conformance.js --implementation node --arg tests/fixtures/assurance/always-ready.js
node tests/assurance-conformance.js --implementation node --arg tests/fixtures/assurance/incomplete-result.js
```

## Local candidate environment

- OS: Microsoft Windows NT 10.0.22000.0 (`win32`, x64)
- Node.js: v25.9.0
- npm: 11.12.1
- Git: 2.38.1.windows.1
- Base commit: `82da4603503be47e2b272b26aa618d410fe40fc1`

## Current observations

The static 53-case black-box catalog passed the bundled reference process: 51
model-independent core cases and two optional v0.6 projection-extension cases.
The explicit external-process invocation passed the 51-case core profile, and
the opt-in reference invocation passed both profiles. Reduction outputs were
checked against the complete strict result schema and their result fingerprints
were independently recomputed. The default suite also rejected the bundled
always-ready mutant plus an incomplete/forged-result mutant on core behavior.
Focused assurance (53 cases), cross-review, closure, install, and portability suites passed
locally after the final operational corrections. The contract suite passed on
a fresh no-`.git` source candidate; the working tree intentionally cannot claim
that protected flow/primitive edits are a committed candidate yet. The install
suite used a 113-entry local tarball in an isolated global prefix and exercised
both installed `delegation-path-check` and `delegation-check` commands. A
complete no-`.git` working-candidate composite passed after the path and
canonical-surface corrections; the exact committed-candidate run remains
pending at this capture stage.

An earlier composite run against an earlier working-tree candidate timed out in
the legacy closure proof-environment marker fixture even though the immediately
adjacent focused closure run passed. The earlier failure remains relevant flake
evidence; a later green run will not turn one result into a long-term stability
claim. No remote result is included.

## Residual unknowns and debt

- The protocol, schemas, conformance catalog, and reference process are
  experimental pre-1.0 surfaces and may change under a new `protocolVersion`.
- Existing Codex/Claude workflows and the v0.6 closure product are active
  lifecycle/support surfaces, not conformant thin adapters. Only the old v0.6
  closure state format has a lossy compatibility projection.
- The reference reducer checks declared artifact digests but does not dereference
  locators or attest that external bytes match those declarations; producers and
  adapters own that check.
- Without an external monotonic checkpoint, a self-consistent old trace snapshot
  cannot be distinguished from the newest snapshot.
- Declared human decisions use `authentication: unverified`; the protocol records
  the claim but does not authenticate the actor.
- Multi-author concurrency, hostile-host attestation, arbitrary side effects,
  external adoption, and cross-language implementations remain unvalidated.
- The pre-write path process is Agent-observed and cannot exclude a hostile
  host or a filesystem race that replaces a checked component before writing;
  Windows junction rejection was observed locally, while POSIX symlink
  execution remains unobserved.
- A same-family or same-project Critic/Evaluator is structured scrutiny, not an
  independent source of truth.

The preregistered incremental assurance comparison is in
[protocol/EXPERIMENT.md](../../protocol/EXPERIMENT.md). Machine-readable capture
state is in [manifest.json](manifest.json).

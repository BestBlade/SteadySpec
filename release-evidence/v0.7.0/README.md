# v0.7.0 Assurance Protocol Candidate Evidence

Evidence capture: **pre-release candidate**.

This is the public, sanitized evidence carrier for the experimental v0.7
Assurance Protocol Candidate and its product-continuity correction. The current
capture is an uncommitted working tree based on rejected local candidate commit
`3c35b39a4ec6f9d3e61c3fefb2e0a10b056aff3a` on branch
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

## Product-continuity rejection and correction

Commit `3c35b39` passed its technical Critic/Evaluator loop and all six local
validation suites, but the user rejected it as a product candidate. Its docs
called SteadySpec's canonical five-flow software lifecycle a legacy recipe and
made the assurance protocol appear to be the successor product. The validators
were green because they checked the shifted v0.7 target rather than continuity
with the v0.1-v0.6.1 product identity.

The corrected candidate preserves the assurance implementation but restores the
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
- Base commit: `3c35b39a4ec6f9d3e61c3fefb2e0a10b056aff3a`

## Current observations

The static 53-case black-box catalog passed the bundled reference process: 51
model-independent core cases and two optional v0.6 projection-extension cases.
The explicit external-process invocation passed the 51-case core profile, and
the opt-in reference invocation passed both profiles. Reduction outputs were
checked against the complete strict result schema and their result fingerprints
were independently recomputed. The default suite also rejected the bundled
always-ready mutant plus an incomplete/forged-result mutant on core behavior.
Focused assurance, contract, cross-review,
closure, install, and portability suites passed locally. A final composite run
then passed all six suites, including a 108-entry local tarball installed into
an isolated global prefix and both packaged assurance example traces.

An earlier composite run against an earlier working-tree candidate timed out in
the legacy closure proof-environment marker fixture even though the immediately
adjacent focused closure run passed. The final candidate composite passed, but
the earlier failure remains relevant flake evidence; this capture does not turn
one later green run into a long-term stability claim. No remote result is
included.

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
- A same-family or same-project Critic/Evaluator is structured scrutiny, not an
  independent source of truth.

The preregistered incremental assurance comparison is in
[protocol/EXPERIMENT.md](../../protocol/EXPERIMENT.md). Machine-readable capture
state is in [manifest.json](manifest.json).

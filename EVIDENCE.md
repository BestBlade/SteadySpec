# Evidence

SteadySpec was built by applying the method to itself. This is the compressed record. The full self-governance trail lives in `.meta/` (gitignored, local-only).

## v0.2-honest-tuning (failed)

The first attempt at v0.2 tried to restructure all 13 SKILLs into a 5-section format with inline triggers. It failed for three reasons:

1. **No design sketch before edits.** Thirteen files were rewritten in vibe mode. The user couldn't tell what changed.
2. **Surface designed before unique value was named.** Hours were spent on slash-command format without first answering: what does SteadySpec do that OpenSpec doesn't?
3. **Validator written by the same agent in the same session as the rewrite.** The validator passed because the agent introducing the violation also wrote the check.

The user reverted everything. Seven lessons were extracted and archived. The round was cancelled — zero products shipped.

## v0.2-alpha (shipped)

The second attempt ran SteadySpec's own Level 3 governance on itself:

- **Context archaeology** extracted 13 confirmed constraints and 12 open questions from the existing 13 SKILLs and the honest-tuning archive
- **Grill** produced user answers on all 12 architectural questions (orchestration location, cross-runtime symmetry, doc-sync algorithm, adopt heuristic triggers)
- **Orchestration sketch** designed four verb-flows (explore / propose / apply / archive) as closed-loop compositions of primitives, with full ASCII diagrams and concrete scenarios
- **Mini-debate** produced 7 findings, including: insert a dogfood spike (Slice 3a) before committing to all four verb-flows; init must ask on substrate conflict; adopt heuristic time-alone is informational not a trigger
- **Slice 3a dogfood spike** validated that a Tier-2 agent (DeepSeek-V4-Pro) can reliably traverse verb-flow → primitive before the other three verb-flows were built — limiting late-failure cost from 5 slices to 1
- **External review** caught 5 issues internal grill and debate had missed, including a logic gap in the drift-handling feature meant to defend against the exact anti-pattern this product exists to prevent
- **Nine vertical slices** shipped four verb-flow SKILLs, Claude slash commands, Codex yaml descriptors, validator rules, and substrate-conflict logic — with no edits to existing primitive SKILL bodies

The key difference from honest-tuning: design sketch before any edit, grill before any architecture decision, dogfood before full build commitment, external review before declaring done.

## v0.3-alpha (shipped)

v0.3 moved the package center from "fill feature gaps" to "make attention and responsibility explicit":

- Added the decision ownership ledger, risk routing, and attention report contracts
- Added `/steadyspec:verify` as the trust checkpoint verb
- Added handoff snapshot, apply re-slice event, and archive durable truth gates
- Updated Claude/Codex runtime entry points and Claude Workflow scripts
- Updated validation so missing v0.3 contract anchors and verify surfaces fail package validation

This did not make the agent autonomous. It made high-risk ownership and evidence limits harder to hide.

## v0.4-alpha (release candidate)

v0.4 closes the docs-substrate gap the user found in plain docs projects: without OpenSpec, SteadySpec owned the location of records but not their structure.

- Added a native docs substrate contract under `.steadyspec/substrates/docs/`
- Added `steadyspec check` for docs-mode proposal/apply/verify/archive structure
- Added docs templates and install-state metadata for docs-backed projects
- Surfaced docs-check phase commands through flows, Claude commands/workflows, Codex descriptors, and package validation
- Added a minimized optional capability lane: `direction-map.md`, optional `evidence-contract.md`, selection findings folded into findings, and conditional `Mainline Decision` sections
- Added v0.4 validation anchors so release docs, contract, scope, method, and flow support cannot silently drift out of the package

This does not prove semantic correctness, independent validation, or substrate parity with OpenSpec. It gives docs-mode projects a structural checker, and it gives high-uncertainty work a bounded way to avoid low-ceiling mainline choices without handing high-risk decisions to the agent.

## v0.5.0 (shipped, Windows single-user boundary)

v0.5 added packet-bound cross-agent transport, raw/moderation separation,
scope freshness checks, advisory/gated policy, and explicit reviewer environment
handling. Repeated external review found real defects in environment inheritance,
timeout handling, scope completeness, and context boundaries; those defects were
repaired before the v0.5 source snapshot. The remaining evidence was still
single-operator Windows dogfood, not team/POSIX or reviewer-quality proof.

## v0.6.0 (shipped source snapshot)

v0.6 added the optional attention-preserving closure state machine beneath
`verify`: fresh Critic, bounded Builder, operator-configured proof, and fresh
Evaluator records are bound to candidate/evidence fingerprints. Interruption,
recovery, decision, reset, and installed-package fixtures passed on the recorded
Windows host. The machine verdict remained bounded readiness for human audit,
not truth or release authority.

The first clean third-party review after publication found a separate product
gap: the registry install did not exist, Windows line endings and 8.3 path
aliases could break validation, public docs had drifted, and validation lacked
CI and observable suites. These findings are not erased from the v0.6 story;
they are the input to v0.6.1.

## v0.6.1 (source-only reliability candidate)

v0.6.1 does not add methodology features. It makes Git source distribution
honest, prevents accidental npm publication, repairs CRLF/path portability,
splits validation into observable suites, adds Windows/Linux CI, and publishes
sanitized reproducible evidence under
[`release-evidence/v0.6.1/`](release-evidence/v0.6.1/README.md).

This section records the pre-release candidate capture. Current tag, GitHub
Release, and remote CI status are external evidence and must be checked against
the exact remote SHA; this historical capture is not itself a release claim.

## v0.7.0 (experimental assurance protocol candidate)

v0.7 adds a model- and role-independent assurance protocol candidate as
optional claim-integrity support beneath the canonical five-flow lifecycle. It
adds a dependency-free reference reducer, strict trace/result schemas, static
black-box conformance cases, negative controls, and a lossy non-conformant
projection of the old v0.6 closure state format. Public replay commands,
candidate identity, observations, and residual unknowns are in
[`release-evidence/v0.7.0/`](release-evidence/v0.7.0/README.md).

The first local candidate, commit `3c35b39`, passed its technical
Critic/Evaluator loop and every local validation suite but was rejected by the
user: it called the canonical software lifecycle a legacy recipe and made the
support protocol appear to be its successor. That was product-level drift, not
a documentation typo. The correction adds [PRODUCT.md](PRODUCT.md), restores
the lifecycle/capability/attention relationship, narrows legacy terminology to
the old state projection, narrows host-goal claims to per-change records plus
aggregated strategy signals, and adds deterministic continuity signals. The v1
English and Chinese contract content is pinned in validator code as well as in
both manifests, with a coordinated-rebinding negative fixture. The validator
can make future contract changes require an explicit code/version decision; it
cannot prove human approval or prevent that explicit coordinated edit from
being wrong.

After that correction, the user supplied the original product rationale: the
durable problem is the delegation gap created when Agents perform more real
work than a responsible person can practically redo or inspect, while external
authority and consequences still remain with that person or organization. This
showed that Product Contract v1, although useful, over-bound the current
five-flow architecture as product purpose. Contract v2 preserves exact v1
content in `docs/product-contract-history/v1/`, moves purpose and stable
principles above mechanisms, and keeps the five verbs compatibility-protected
as the current software reference architecture.

The next structured review found that this distinction was still prose-only:
installed flows accepted one intent string and could freeze a questionable
means into purpose. The accepted P1 correction adds the delegation boundary to
router/explore/propose/apply/verify and their Codex/Claude surfaces, plus docs
contract version 2. The checker fixtures now reject missing fields,
`needs-human` at apply, `ready` paired with an unresolved challenge, malformed
authority refs, and missing docs targets/headings. Deterministic archive now
repeats the delegation/trust gate for every substrate rather than relying only
on the docs checker. This proves only the declared structural gate, not correct
semantic classification, actor identity, or adequacy of the referenced decision.

The next Critic/Evaluator round found that an Agent-returned archive checkpoint
could still be trusted without deterministic artifact binding, and that an old
pending archive transaction could resume before the workflow's new gather gate.
The accepted correction adds `steadyspec delegation-check`, direct proposal,
trust, authority-target and heading readback across OpenSpec/docs/`.meta`/custom
layouts, authority-byte fingerprinting, and archive transaction prepare/commit/
recovery binding. Negative fixtures cover missing targets/headings, traversal,
missing or blocked trust, and legacy pending records without the binding. The
installed-source smoke also executes the public command before exercising the
archive lifecycle. This closes the observed bypass; it still does not attest
who authored an authority record or whether its decision is substantively wise.

A later exact-candidate review found another write-before-check bypass: an
explicit custom base could be a symlink/junction resolving into a built-in
namespace or outside the repository. The lexical workflow gate accepted it,
then `propose` could write context, grill, or proposal files before the later
realpath-aware `delegation-check` rejected the path. The correction adds the
public read-only `steadyspec delegation-path-check`, runs it before the first
proposal artifact write, and propagates the zero-write rule through the
canonical primitive, governed path, router, flow, and Codex/Claude adapters.
Contract fixtures exercise base, nested, and active-child links with a real
Windows junction; the same fixture selects a directory symlink on POSIX. They
also require proposal target bytes to remain unchanged, and installed-source
smoke executes both path and artifact checks. This is same-Agent-observed path
evidence at check time, not hostile-host attestation or protection from a
post-check filesystem race. POSIX execution remains unobserved in this capture.

This clarification is user-authorized product direction, not effectiveness
evidence. The whole-product comparison in
[`docs/experiments/whole-product-pilot.md`](docs/experiments/whole-product-pilot.md)
is a design candidate, not yet pre-registered, and has no run or result.

This is local candidate evidence, not a causal result. It does not show that
SteadySpec lowers drift or human burden, and it does not authorize a commit,
tag, GitHub Release, npm publication, or adoption claim.

## What this proves (and doesn't)

- The method produced a working orchestration layer from a standing start in a single-author setting
- The method caught its own blind spots when an external reviewer was introduced
- The docs-mode checker can reject missing delegation structure, non-ready
  apply, and known archive truth hazards before a plain-docs change is treated
  as structurally ready
- The v0.5/v0.6 runtimes have bounded local contract and installed-source evidence, with their platform and independence limits preserved
- v0.6.1 source reliability results can be replayed from the public commands and manifest rather than relying only on the private `.meta` trail
- v0.7 protocol behavior can be replayed at a black-box process boundary; its
  effectiveness remains an unanswered experiment
- The method has NOT been validated on multi-author teams, concurrent changes, or projects with issue-tracker substrates

See [SCOPE.md](SCOPE.md) for what the reference skill pack does and does not promise.

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

## What this proves (and doesn't)

- The method produced a working orchestration layer from a standing start in a single-author setting
- The method caught its own blind spots when an external reviewer was introduced
- The docs-mode checker can reject missing structure and known archive truth hazards before a plain-docs change is treated as structurally ready
- The method has NOT been validated on multi-author teams, concurrent changes, or projects with issue-tracker substrates

See [SCOPE.md](SCOPE.md) for what the reference skill pack does and does not promise.

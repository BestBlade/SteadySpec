# Product Contract v1 to v2 Coverage Map

Status: pre-release contract migration. No runtime, flow, skill, protocol,
schema, or CLI capability is removed by this migration. The final v2 candidate
adds a delegation-boundary classification and gate after review found that the
new authority rule otherwise existed only as product prose.

## Why v1 was superseded

v1 was created after candidate `3c35b39` silently demoted SteadySpec's
five-flow lifecycle. It correctly restored the current architecture and human
authority, but it bound that architecture too close to the product's ultimate
purpose. The user subsequently supplied the older source rationale and
explicitly authorized a purpose/mechanism separation.

## Coverage map

| v1 protected concern | v2 location | Treatment |
|---|---|---|
| Long-running intent/evidence/record drift | Product purpose; PC-1; PC-4 | Retained and placed under the delegation problem. |
| Five software verbs | Current reference architecture / Software lifecycle | Retained unchanged as current-normative and compatibility-protected; no deprecation. |
| Human attention and final responsibility | Operating premise; PC-5; PC-6 | Refined: accountability is external; attention routing is triage, not discharge. |
| Capability without drift | Product purpose; PC-2; PC-3 | Promoted into the stable evaluation boundary without promising optimality. |
| Additive assurance role | Implementation and assurance mechanisms | Retained as optional claim-integrity support, not a successor product. |
| Human-owned product identity changes | Evolution and authority boundary | Strengthened with version, coverage-map, migration, evidence, and history requirements. |
| Host-goal non-ownership | Software lifecycle reference | Retained unchanged. |

## Compatibility and migration

- Existing five verb names and order remain unchanged.
- Existing eight mechanism sections remain addressable.
- Existing skills, workflows, closure engine, assurance reducer, schemas,
  conformance cases, and CLI commands remain available.
- Consequential proposals now distinguish Authorized Outcome, Hard Constraints,
  Challengeable Assumptions, Proposed Means, Delegated Decisions, Challenge
  Resolution, and Delegation Status. `apply` and `verify` fail closed unless the
  status is `ready` and consequential challenges are resolved. Resolved
  authority refs use change-relative `path.md#markdown-heading-anchor` form;
  `steadyspec delegation-check` requires the target and heading to exist on
  every substrate and fingerprints the referenced authority artifact bytes.
- `archive` repeats the delegation gate for every substrate and requires a
  current trust checkpoint whose Delegation Review is `pass` and Recommended
  Next is `archive`; the docs checker is defense in depth rather than the sole
  archive guard. Archive prepare binds the directly read proposal, trust, and
  authority-artifact fingerprint; commit and recovery reject missing or stale
  bindings.
- Existing proposals that contain only `## Intent` are not silently reclassified.
  Before a new apply pass, run explore/propose to classify the delegation layers
  and record who owns unresolved challenges. This is an intentional additive
  compatibility gate, not removal or renaming of a lifecycle verb.
- The docs substrate contract advances from version 1 to version 2. Its checker
  validates delegation fields and blocks `needs-human`; OpenSpec remains the
  owner of its substrate schema while installed SteadySpec flows carry the same
  authority rule.

## Evidence boundary

The migration proves only that v1 remains recoverable and that current public
surfaces express the v2 hierarchy consistently. It does not prove the v2
product hypothesis, human understanding, legal sufficiency, or better outcomes.
See [`../../experiments/whole-product-pilot.md`](../../experiments/whole-product-pilot.md).

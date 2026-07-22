# SteadySpec Assurance Protocol Candidate 0.7

Status: experimental protocol candidate. Normative schema version: 1.
Normative protocol version: `0.7`.

This protocol defines when one exact target/candidate/evidence/assessment
snapshot may be called `ready-for-human`. It does not teach an agent how to
explore, propose, build, review, or repair work. Those belong to the governed
change lifecycle and its support mechanisms. This protocol does not prove
semantic truth, reviewer independence, human identity, newest-snapshot
currentness, acceptance, merge authority, or release authority.

The key words MUST, MUST NOT, REQUIRED, SHALL, SHALL NOT, SHOULD, SHOULD NOT,
and MAY are normative requirements in this document.

## 1. Relationship to the SteadySpec product

[PRODUCT.md](../PRODUCT.md) defines the stable product purpose, current
reference architecture, and evolution boundary. The five software verbs are
the current normative, compatibility-protected lifecycle—not the ultimate
product purpose. Purpose fidelity, challenge without usurpation, capability
realization, evidence-bounded claims, and human authority guide that work. This
protocol is optional,
risk-triggered claim-integrity support for verification, handoff, and truthful
finalization. It MUST NOT be interpreted as a replacement for or demotion of
that lifecycle.

Protocol conformance is deliberately narrower than SteadySpec method or product
conformance. An implementation can reduce assurance traces without implementing
the five flows, and a project can use the five flows without assurance. This is
interface separation, not a product hierarchy.

The old v0.6 closure state format has a state-only v0.7 projection that is lossy
and non-conformant. The v0.6 closure product, software lifecycle, and existing
Codex/Claude workflows are not legacy; they are also not claimed to be thin
v0.7 adapters.

## 2. Restricted canonical JSON v1

Fingerprint-bearing values MUST use only:

- null, booleans, strings, arrays, objects, and integers in
  `[-9007199254740991, 9007199254740991]`;
- no floating-point values and no negative zero;
- strings and object keys without unpaired UTF-16 surrogates;
- unique object keys.

The reference process also limits input to 16 MiB, JSON nesting to 128 levels,
and a trace to 10,000 events. Exceeding a limit is invalid input, not a partial
assurance result.

Transport MUST be valid UTF-8 and MAY contain a UTF-8 BOM and JSON whitespace.
They do not enter the canonical value. Invalid UTF-8 and duplicate keys MUST be
rejected before ordinary JSON parsing.
Object keys are sorted lexicographically by their UTF-8 byte sequences. Arrays
preserve order. Serialization is compact UTF-8 JSON using standard JSON string
escaping. Array order is identity-bearing; arrays are not implicit sets.

Structured trace fields described as human-readable strings (for example
locator, statement, claim, label, transport, and reason) MUST be non-empty and
have no leading or trailing ECMAScript whitespace. `occurredAt` MUST be a
calendar-valid RFC3339 UTC timestamp in uppercase `Z` form, with hour `00`-`23`,
minute/second `00`-`59`, and at most nine optional fractional digits. These
restrictions are identical in the normative trace schema and reference reducer.
The generic `fingerprint` command may still hash
other restricted-canonical JSON strings because it is not a trace validator.

Fingerprint domains are separated as follows:

```text
sha256(UTF8("steadyspec-assurance/0.7/<domain>\0") + canonical-json-bytes)
```

The public domains are `target`, `candidate`, `evidence`, `assessment`,
`event`, `trace`, and `result`. A `resultFingerprint` is computed over the
complete valid result object before that field is added.

## 3. Bound objects

Every artifact that contributes to readiness MUST contain:

```json
{
  "id": "intent",
  "locator": "spec/intent.md",
  "contentDigest": "sha256:<64 lowercase hex>",
  "byteLength": 123
}
```

`locator` is descriptive only. `contentDigest` and `byteLength` bind content.
A mutable locator without content identity MUST be recorded as an unresolved
unknown or coverage limit and MUST NOT participate in readiness.
The reference reducer does not dereference locators or recalculate external
bytes. A producer/adapter must calculate those fields from the claimed
snapshot. The protocol binds the supplied declaration; it does not prove the
producer was honest or that the locator still serves those bytes.

### Target

A target binds immutable intent/policy artifacts, a non-empty criterion set,
required evidence IDs, and final-decision ownership. At least one criterion
MUST be required. Every required criterion MUST name one or more lineage-wide
unique required evidence IDs. `authority.finalDecision` MUST be `human`.

### Candidate

A candidate binds one or more output artifacts and the exact current target
fingerprint.

### Evidence

Evidence binds the exact current target and candidate. Observation outcomes are
closed: `pass`, `fail`, `blocked`, `unknown`, `not-run`, or `fallback`.

- `unresolvedUnknowns` are incomplete knowledge and block readiness.
- `coverageLimits` restrict what a successful observation means. They remain
  visible but do not automatically block readiness.
- a `fallback` used for required evidence blocks readiness.

### Assessment

Assessment binds the exact current target, candidate, evidence bundle, and live
invocation. Required criterion results are `pass`, `fail`, `blocked`, `unknown`,
or `not-applicable`. Findings explicitly declare `blocksReadiness`; severity
prose does not control the protocol.

The reducer computes the resulting state. `proposedOutcome` cannot override a
missing/non-pass required observation, unresolved unknown, non-pass required
criterion, or open blocking finding.

### Decision record

A decision record declares `claimedActorClass: human` and
`authentication: unverified`. The protocol binds and preserves that claim; it
does not authenticate who emitted it. Implementations MUST NOT describe a
decision record alone as proof of human review or approval.

## 4. Primary states

| State | Meaning | Next-action class |
|---|---|---|
| `target-required` | No current target binding. | Bind target. |
| `candidate-required` | Target exists; candidate is absent/invalidated. | Bind candidate. |
| `evidence-required` | Required evidence is missing or not run. | Record evidence. |
| `assessment-required` | Required evidence passes; no current assessment. | Start assessment. |
| `assessment-running` | One exact invocation is live. | Complete or explicitly resolve it. |
| `remediation-required` | Current evidence/assessment contains a repairable failure. | Repair and rebind. |
| `ready-for-human` | Exact supplied bindings meet protocol readiness. | Human trust checkpoint. |
| `needs-human` | Unknown, decision, or stale-active invocation needs human attention. | Record an exact decision. |
| `blocked` | Current evidence/assessment reports an environmental or dependency block. | Resolve block. |
| `abandoned` | Lineage is closed by a decision record. | None. |

Staleness is not a primary state. Rebinding records structured invalidations,
clears downstream current bindings, and moves to the exact required state. A
live invocation invalidated by rebinding becomes `stale-active`; current state
is `needs-human` until a binding retry/abandon decision resolves it.

## 5. Events and chaining

Supported events are:

- `target-bound`
- `candidate-bound`
- `evidence-recorded`
- `assessment-started`
- `assessment-completed`
- `decision-recorded`

Every event MUST contain the header required by
`schemas/assurance-trace-v1.schema.json`. New events use a contiguous sequence
and the exact prior event fingerprint. The first event has sequence 1 and
`priorEventFingerprint: null`.

Before sequence validation, an implementation checks event ID replay:

- same event ID and same complete canonical event: ignored exact replay;
- same event ID and different content: `E_EVENT_ID_CONFLICT`;
- new event with a gap: `E_SEQUENCE_GAP`;
- new event with an already-consumed sequence: `E_SEQUENCE_CONFLICT`;
- wrong prior fingerprint: `E_EVENT_CHAIN`.

An ignored exact replay MUST produce the same valid result bytes as the trace
without the duplicate. A new event with a different ID but an identical bound
manifest is a semantic no-op; it advances the trace head but does not invalidate
the binding.

## 6. Transitions

| Event | Preconditions | Effect |
|---|---|---|
| `target-bound` | lineage not abandoned | First/changed fingerprint clears downstream and requires candidate. Identical binding is a semantic no-op. |
| `candidate-bound` | current target; matching target fingerprint | First/changed fingerprint clears evidence/assessment and requires evidence. |
| `evidence-recorded` | current target/candidate; both fingerprints match | First/changed fingerprint clears assessment and runs the evidence gate. |
| `assessment-started` | current primary state and evidence gate are both `assessment-required`; no live/stale-active invocation; all fingerprints match; invocation ID unused | Commits one live invocation before transport and enters `assessment-running`. A rejection, defer, acceptance, or existing assessment cannot be bypassed by reassessing unchanged bindings. |
| `assessment-completed` | exact live invocation and all current fingerprints match | Closes invocation, binds assessment, and computes blocked/human/remediation/readiness state. |
| `decision-recorded` | exact current bindings; action-specific state/invocation matches | Authorizes retry, records accept/reject/defer, or abandons. `defer-current` and `abandon` may bind an all-null pre-target state. It cannot make a non-ready assessment ready or grant external authority. |

Rebinding while an invocation is live preserves it as `stale-active`. Old
completion MUST NOT support current readiness, and a new invocation MUST NOT
start until `authorize-assessment-retry` or `abandon` is recorded. Retry uses a
new invocation ID. The old invocation remains historical.

After abandonment, only exact event replay is valid.

`reject-current` enters `remediation-required`; a new assessment requires a
changed candidate or evidence binding. `defer-current` is valid only for
`ready-for-human` or an all-null pre-target lineage. It enters `needs-human` and
may later be superseded by `accept-current`, `reject-current`, or `abandon` on
the same exact ready assessment, or by a first target binding in the pre-target
case. It cannot pause or authorize another assessment.

Decision action preconditions are deterministic:

| Action | Additional precondition | Effect |
|---|---|---|
| `authorize-assessment-retry` | `invocationId` exactly names the live or stale-active invocation | Preserve the old invocation as retry-authorized, clear it, and derive the next required state from current bindings. |
| `accept-current` | Current or exactly deferred assessment is ready; `invocationId` is null | Preserve `ready-for-human`; record that external action remains human-owned. |
| `reject-current` | Current or exactly deferred assessment is ready; `invocationId` is null | Enter `remediation-required`; unchanged bindings cannot be reassessed. |
| `defer-current` | Current state is ready, or target/bindings are all null; `invocationId` is null | Enter `needs-human` without granting retry authority. |
| `abandon` | If an invocation is active, `invocationId` exactly names it; otherwise it is null | Preserve an active invocation as abandoned and close the lineage. |

## 7. Evidence gate and readiness

For required evidence, state precedence is:

1. missing or `not-run` -> `evidence-required`;
2. `blocked` -> `blocked`;
3. `unknown` or any unresolved unknown -> `needs-human`;
4. `fail` or `fallback` -> `remediation-required`;
5. all required observations `pass` -> `assessment-required`.

`ready-for-human` requires all of these:

1. target, candidate, evidence, and assessment fingerprints exist;
2. target has at least one required criterion;
3. each required evidence ID has exactly one current `pass` observation with
   the declared criterion and permitted source class;
4. each required criterion has one current assessment `pass` result;
   that result names every required evidence ID in `basisEvidenceIds`;
5. no unresolved unknown exists in evidence or assessment;
6. no open finding has `blocksReadiness: true`;
7. no fallback supplies required evidence;
8. assessment proposed `ready-for-human` and matches the exact live invocation
   and current bindings.

Coverage limits MUST remain in the result and MAY coexist with readiness.

`ready-for-human` means only that the exact supplied snapshot is ready for a
human checkpoint within recorded coverage. It is not acceptance, semantic
truth, real-world observation beyond supplied evidence, reviewer independence,
merge/archive/release/deployment authority, or risk acceptance.

## 8. Process and failure contract

The reference process supports:

```text
steadyspec assurance reduce --trace <file> --json
steadyspec assurance project-v06 --state <file> --json
steadyspec assurance fingerprint --domain <name> --input <file> --json
```

`reduce` and `fingerprint` form the model-independent core process profile.
`project-v06` is an optional SteadySpec legacy-projection extension; an
independent conforming core implementation is not required to implement it.

For `reduce --json`:

- valid trace: exit 0, exactly one JSON object plus LF on stdout, empty stderr;
- invalid JSON/schema/version/event/sequence/binding: exit 2, invalid envelope
  on stdout, empty stderr;
- usage or process I/O error: exit 1.

Exit 0 means protocol-valid input, not readiness. Invalid output MUST NOT expose
a top-level `assuranceState` or `resultFingerprint`. It MAY expose accepted
prefix details only inside a field marked non-authoritative.

Valid output is a pure function of input. It MUST NOT contain current clock,
absolute input path, process ID, or host details. Conformance asserts stable
diagnostic codes and paths, not English message text.

`fingerprint` exposes the same restricted canonical JSON and public domain
separation used by the reducer. It exists so adapters and independent
implementations can reproduce event bindings without importing reference code.

## 9. Snapshot/currentness limit

Event chaining detects mutation, reordering, conflict, and truncation inside the
supplied snapshot. It cannot know that a valid older snapshot is not current.
Callers that require rollback/currentness protection MUST maintain an external
monotonic checkpoint for the expected head or result fingerprint. That adapter
responsibility is not implemented by v0.7.

## 10. v0.6 state projection

`project-v06` reads but never writes a v0.6 state file. It validates the
supported version and emits:

- `projectionKind: lossy`;
- `protocolConformant: false`;
- a deterministic advisory state and the legacy next action;
- coverage warnings.

Because the command does not reconstruct all cycle artifacts, legacy
`candidate-ready` MUST project to `needs-human` with
`legacy-ready-claim-unverified`. It MUST NOT become v0.7 readiness.

## 11. Conformance boundary

`tests/assurance-conformance.js` accepts an implementation executable and argv
prefix and invokes the process contract. It does not import the reference
reducer. Static cases are labeled with `core` or `v06-projection` profiles and
carry expected state/error/fingerprint assertions. A custom implementation runs
only `core` by default; `--include-v06-projection` explicitly opts into the
legacy extension. The bundled reference run MUST pass both profiles, and the
core profile MUST reject the bundled always-ready mutant.

For every reduction output, the runner validates the complete strict result
schema (including required fields, nested shapes, and additional-property
rejection) and independently recomputes `resultFingerprint`. This duplicates a
small canonicalization verifier at the process boundary; it does not import
reducer internals.

Conformance proves only the declared trace/process cases. It does not prove
real-world effectiveness or protocol value; that is the experiment boundary.

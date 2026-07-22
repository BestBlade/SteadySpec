# Governed Proposal Path

Use this path when a normal proposal would be too loose because direction, boundary, validation, or architecture can drift.

1. Derive the exact substrate/change base/change ID/active root and run the
   code-owned `steadyspec delegation-path-check` before writing any findings or
   proposal artifact. A linked/junction component, identity drift, or non-zero
   result stops with zero writes.
2. Run or summarize `steadyspec-explore` until the problem is named.
3. Run `steadyspec-context-archaeology` if old structure or project history may affect the proposal.
   Do not turn inferred history into a constraint.
4. Run `steadyspec-grill` if the plan has unresolved decision dependencies.
5. Run `steadyspec-debate` for direction.
6. Run a second boundary debate focused on scope, touched layers, evidence, stop conditions, and non-goals.
7. Write findings before proposal artifacts:
   - direction findings
   - historical constraints and context gaps
   - grilled decision dependencies
   - boundary findings
   - accepted risks
   - parked long-tail concerns
   - unresolved items
   - evidence requirements
8. Generate proposal/design/spec/tasks or equivalent substrate artifacts from findings.
9. In the proposal, distinguish Authorized Outcome, Hard Constraints,
   Challengeable Assumptions, Proposed Means, and Delegated Decisions. Bind
   every consequential challenge to an owner and resolution. `needs-human`
   remains an honest proposal state and blocks apply; it must not be collapsed
   into confident intent prose.
   Do not let artifacts exceed findings or erase rejected alternatives future agents may repeat.
10. Verify every high-impact decision traces to findings.

Report findings, artifact locations, key boundary, stop conditions, unresolved risks, and readiness for `steadyspec-apply`.

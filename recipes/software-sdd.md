# Software SDD Recipe

This is the v1 SteadySpec reference implementation: the general anti-drift method in `METHOD.md` applied to software spec-driven development.

## Mapping

- Intent record: proposal, change record, issue, or spec section.
- Working medium: plain docs, OpenSpec, issue tracker, or project-local protocol.
- Unit of work: one implementation slice, doc update, migration, test asset, or reviewable change.
- Observable check: automated test, fixture replay, static check, build, manual runtime check, or reviewer inspection.
- Output-vs-intent check: implementation review against the original intent and evidence plan.
- Finalized record: archived change, merged spec update, or closed issue with evidence links.

## Flow

1. Start with `steadyspec-adopt` to choose governance strength and working medium.
2. Use `steadyspec-workflow` when the next phase is unclear.
3. Use `steadyspec-explore`, `steadyspec-context-archaeology`, `steadyspec-grill`, and `steadyspec-debate` before proposal when uncertainty is high.
4. Use `steadyspec-propose` to write intent, evidence plan, boundaries, and stop conditions.
5. Use `steadyspec-apply` for one proof-gated implementation slice at a time.
6. Use `steadyspec-review-against-intent` to compare implementation to intent, not just tests.
7. Use `steadyspec-doc-sync` before future work depends on new truth.
8. Use `steadyspec-archive` only after evidence, review, doc-sync, debt, and human decisions are explicit.
9. Use `steadyspec-human-decision-record` when the decision belongs to people, not process.
10. Use `steadyspec-strategy-rollup` when repeated local drift suggests a strategy or operating-model issue.

## Rule Of Thumb

Tests and builds are proof signals, not intent. Passing tests can support completion, but they do not prove that the right thing was built. The review must still compare output to the intent record.

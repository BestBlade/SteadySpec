---
name: steadyspec-debate
description: Run a Proposer/Challenger debate for SDD decisions. Use when architecture, scope, implementation boundary, migration path, or validation strategy is uncertain enough that a one-pass proposal is risky.
---

# SDD Debate

Method link: This skill implements [METHOD.md](../../../METHOD.md) section 3, Decision Pressure Before Agreement, applied to software SDD.

Use when direction can fork, the boundary is risky, or the user asks for debate/review.

1. Declare debate mode and isolation:
   - `mode-1-local-dual-role`: one agent plays both roles in separate passes. Use when the runtime cannot spawn subagents or when the user/project does not allow delegation.
   - `mode-2-pseudo-cross-debate`: the main agent moderates two delegated Proposer/Challenger agents. Use when the runtime supports subagents and the user/project allows delegation. This improves prompt/context isolation but keeps same-model blind spots.
   - `mode-3-true-cross-debate`: Proposer and Challenger come from different models through an external orchestrator. This is outside this skill's internal execution; use existing cross-model findings as input or recommend escalation when cognitive-boundary risk is high.
   State the actual mode used. Mode 2 is stronger than mode 1 for prompt isolation, but only mode 3 changes the model boundary. Same-model debate is not independent validation.
2. State topic, mode, background summary, and hard constraints.
   Give Proposer and Challenger the same background and constraints; only the role instruction differs.
3. Proposer gives the strongest concrete approach as a complete pass.
4. Challenger starts from the fixed Proposer pass and names flaws, breaking scenarios, and alternatives.
   Objections need scenario and alternative, not just doubt.
   In `local-dual-role`, keep Proposer and Challenger in separate passes or messages; do not draft both as one blended exchange.
5. Proposer defends before changing position.
6. Main agent moderates: map each objection to accepted, rejected, or carried forward.
   If positions stall, propose a third direction or smaller reframing.
7. Run a second round when the decision affects architecture, public behavior, data, security, or migration.
8. Before findings, run an expert blind-spot pass:
   - same-model or shared-training limits
   - missing domain expert view
   - moderator bias risk
   - consensus without external evidence
   This pass is unconditional. Debate mode changes role isolation; it does not replace blind-spot review.
9. Write findings:
   - decision
   - basis
   - strongest counter-case
   - missing evidence
   - expert blind-spot pass result
   - status: finding | contested | unverified | blocked
   - implications for proposal/apply
   Consensus is not proof; missing evidence stays visible.
   Do not implement during debate.

Report findings location or findings text, unresolved issues, evidence gaps, debate mode and limits, any mode-3 external findings used or escalation needed, and whether to propose, continue exploring, or stop.

## Failure Modes

- Fails when step 1 does not explicitly state the debate mode used for this debate.
- Fails when same-model consensus is treated as independent validation; run step 8.
- Fails when mode 3 is implied without external cross-model findings or orchestration.
- Fails when `[consensus]` means politeness instead of resolved objection.
- Fails when objections lack a breaking scenario and alternative.
- Fails when the main agent skips step 6 and lets the two sides vote for themselves.
- Fails when local Proposer and Challenger are written as one blended pass instead of separate role passes.

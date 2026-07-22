---
name: "steadyspec: explore"
description: "SteadySpec activation entry - attention-ranked status or topical exploration with project history loaded"
category: Workflow
tags: [steadyspec, explore, workflow]
---

SteadySpec activation entry. Two modes:

- **Status mode** - `/steadyspec:explore` (no topic): aggregate the project's spec workflow state and produce an attention-ranked status report (must-read decisions / active changes / debt aggregate / recent archived / recommended next verb), including docs contract health for docs substrate.
- **Topical mode** - `/steadyspec:explore <topic>`: think with the user about the topic with project history loaded, including likely decision owners and high-risk triggers. Draft without canonizing a delegation boundary that separates Authorized Outcome, Hard Constraints, Challengeable Assumptions, Proposed Means, and Delegated Decisions. Hands off to `/steadyspec:propose` if intent converges.

Once invoked, the agent stays SteadySpec-aware for the rest of the session and reaches for the right `steadyspec-*` skill at later transition points.

---

**Input:** the argument after `/steadyspec:explore` is the topic (optional). No argument = status mode.

Follow the steps in the `steadyspec-explore-flow` SKILL.md exactly.

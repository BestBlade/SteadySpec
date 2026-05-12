---
name: "steadyspec: explore"
description: "SteadySpec activation entry — status report (no topic) or topical exploration (with topic) with project history loaded"
category: Workflow
tags: [steadyspec, explore, workflow]
---

SteadySpec activation entry. Two modes:

- **Status mode** — `/steadyspec:explore` (no topic): aggregate the project's spec workflow state and produce a four-section status report (active changes / debt aggregate / recent archived / recommended next verb).
- **Topical mode** — `/steadyspec:explore <topic>`: think with the user about the topic with project history loaded. Hands off to `/steadyspec:propose` if intent converges.

Once invoked, the agent stays SteadySpec-aware for the rest of the session and reaches for the right `steadyspec-*` skill at later transition points.

---

**Input:** the argument after `/steadyspec:explore` is the topic (optional). No argument = status mode.

Follow the steps in the `steadyspec-explore-flow` SKILL.md exactly.

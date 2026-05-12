---
name: "steadyspec: propose"
description: "SteadySpec propose verb — write a proposal artifact whose intent is grilled, debated when needed, and traceable to prior changes"
category: Workflow
tags: [steadyspec, propose, workflow]
---

SteadySpec propose verb. Auto-incorporates project history + current state, runs grill to harden the decision tree, runs debate when direction forks / area is high-risk / boundary is not yet sharp. Trivial single-file or doc-only changes skip debate. Outputs the proposal artifact in your substrate (openspec/ or docs/changes/) and recommends `/steadyspec:apply` next.

---

**Input:** the argument after `/steadyspec:propose` is the user's own short statement of what this change is about (the intent string). If absent, propose-flow asks for it before continuing.

Follow the steps in the `steadyspec-propose-flow` SKILL.md exactly.

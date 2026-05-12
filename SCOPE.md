# SteadySpec Scope and Boundaries

SteadySpec is the **advanced version of OpenSpec**: same four outward verbs (`explore` / `propose` / `apply` / `archive`), each implemented as a small closed-loop that orchestrates anti-drift mechanisms. To deliver on that promise reliably, the v0.2-alpha release defines specific boundaries. Read this before adopting.

## Agent capability tiers

SteadySpec relies on agents reading SKILL descriptions, matching them to user intent, loading the right skill, and following the constraints inside it. This is not free; it depends on agent capability.

| Tier | Agents | Status |
|------|--------|--------|
| **Tier 1** | Claude Opus 4.x and above; GPT-5 and above | Full support. Skills auto-trigger on natural language; constraints are followed without explicit reminder. |
| **Tier 2** | **DeepSeek-V4-Pro** (the affordable open-source baseline that defines Tier 2); Claude Sonnet 4.5 and above; GPT-4o-class; equivalents | **Primary optimization target for v0.2-alpha.** Skills auto-trigger on slash commands and skill descriptions. MUST-prefixed steps are followed reliably. Soft directives may need user reinforcement. |
| **Tier 3** | Claude Sonnet < 4.5; Claude Haiku; GPT-3.5 and below; local models under 30B; any model with limited tool-use reliability | **Not promised.** SteadySpec may load skills, but auto-triggering, MUST-step adherence, and failure-mode self-checks are not reliable. Use with explicit user guidance per turn or consider a different methodology. |

If you cannot tell which tier your agent is in, assume Tier 3.

## Single-developer assumption

SteadySpec v0.2-alpha is designed for **one author per change**. The "human" referenced in skills (`steadyspec-human-decision-record`, `steadyspec-strategy-rollup`, archive gates) means **future-you or a successor** — someone who needs to re-evaluate decisions without the original context.

What this means in practice:

- Records must stand alone. Do not assume the reader was present.
- No multi-owner workflows, no review assignment, no parallel-author conflict resolution.
- No team rituals (standups, sprint planning, cross-functional sign-off).
- The drift SteadySpec defends against is **time drift** (you forgetting why you decided X) and **succession drift** (a new owner inheriting unclear state), not **coordination drift** (multiple authors moving in different directions simultaneously).

Team usage is not forbidden, but is not validated and not designed for. If you adopt SteadySpec on a team, you carry the cost of adapting the future-self framing to multi-person contexts.

## What SteadySpec does NOT promise

To save users from misaligned expectations:

- **It does not auto-detect drift.** It provides verbs you invoke when you suspect drift; it does not run a background watcher.
- **It does not prevent agents from making mistakes.** It increases the chance an agent will pause at the right moment if you have called the right verb.
- **It does not version your specs.** The substrate (OpenSpec, plain docs, issue tracker) is responsible for that. SteadySpec adds drift defense around the substrate.
- **It does not replace tests.** Tests are one form of observable check. SteadySpec asks whether the right thing was built; tests verify whether the built thing works.
- **It does not enforce its own use.** You can install SteadySpec and never invoke a single verb. The package will not complain.
- **It does not provide CLI commands beyond `init`.** No `update`, no `uninstall`, no `check`, no `status`. Use file operations and re-init to upgrade. To remove SteadySpec from a project, see the manual cleanup checklist in [QUICKSTART.md](QUICKSTART.md). Reason for no uninstall command: a per-project removal command that touches user files is a data-loss risk we won't take in v0.2-alpha.
- **It does not handle issue-tracker substrates in v0.2-alpha.** GitHub issues / Jira / Linear as substrates are deferred to v0.3.
- **It does not guarantee correct primitive skill selection during multi-step verb-flow orchestration.** v0.2-alpha validated this assumption (the F7 trust-the-description architectural principle) only in `explore-flow`. If you observe wrong primitives being loaded during `propose-flow` / `apply-flow` / `archive-flow`, treat it as a known F7-assumption failure and report.
- **`archive-flow` Gate 4 (completeness) is best-effort in v0.2-alpha.** Field-by-field schema enforcement is deferred to v0.3 (would require an `archive-schema.md` and Gate 4 mechanical matcher). Until then, Gate 4 relies on agent judgment of which archive.md fields are required for the change at hand. Reproducibility may vary across agents and runs.
- **`steadyspec-explore-flow` adopt heuristic surfaces baseline guidance only.** Quantitative re-adopt triggers (LOC growth, change count growth, repeated module drift, new structural class) require a baseline schema not present in v0.2-alpha; deferred to v0.3.

## SteadySpec's own self-governance

SteadySpec applies its own method to itself. The records of those self-applications live in `.meta/changes/` in the source repo. **`.meta/` is git-ignored and is not shipped to npm.** This means:

- The published package contains the *result* (verbs, primitives, methodology, recipes), not the *process record* of how it was built.
- Successors inheriting the source repo may not see `.meta/`. That is intentional. Read the public CHANGELOG.md and `git log` for the durable history.
- Treat `.meta/changes/` as SteadySpec's private substrate. **Do not adopt it as your project's substrate.** Use one of the substrates documented in the user-facing recipes.

## Deciding whether SteadySpec fits your project

SteadySpec fits when **all** of these are true:

1. Your agent is Tier 1 or Tier 2.
2. You are working alone or coordinating asynchronously without parallel authors.
3. You expect the work to live long enough that future-you (or a successor) will need the records.
4. You are willing to invoke the four verbs explicitly when the situation calls for them.

If any of those is false, SteadySpec v0.2-alpha is not the right fit. Use a lighter or different tool.

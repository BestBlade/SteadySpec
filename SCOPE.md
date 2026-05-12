# SteadySpec Scope and Boundaries

SteadySpec is a reference skill pack of the anti-drift method described in [METHOD.md](METHOD.md). It provides four outward verbs (`explore` / `propose` / `apply` / `archive`), each a small closed-loop that orchestrates anti-drift mechanisms. To deliver on that promise reliably, the v0.2-alpha release defines specific boundaries. Read this before adopting.

## Agent capability tiers

SteadySpec relies on agents reading SKILL descriptions, matching them to user intent, loading the right skill, and following the constraints inside it. This is not free; it depends on agent capability.

| Tier | Agents | Status |
|------|--------|--------|
| **Tier 1** | Claude Opus 4.x and above; GPT-5 and above | Full support. Skills auto-trigger on natural language; constraints are followed without explicit reminder. |
| **Tier 2** | **DeepSeek-V4-Pro** (the affordable open-source baseline that defines Tier 2); Claude Sonnet 4.5 and above; GPT-4o-class; equivalents | **Primary optimization target for v0.2-alpha.** Skills auto-trigger on slash commands and skill descriptions. MUST-prefixed steps are followed reliably. Soft directives may need user reinforcement. |
| **Tier 3** | Claude Sonnet < 4.5; Claude Haiku; GPT-3.5 and below; local models under 30B; any model with limited tool-use reliability | **Not promised.** SteadySpec may load skills, but auto-triggering, MUST-step adherence, and failure-mode self-checks are not reliable. Use with explicit user guidance per turn or consider a different methodology. |

If you cannot tell which tier your agent is in, assume Tier 3.

## When to use which path

SteadySpec provides a spectrum, not a single workflow. Most of your time should be spent at the light end.

| Path | Use when | What you do |
|---|---|---|
| **Vibe mode** | Disposable experiments, quick questions, one-off scripts | No verbs. No records. Just work. |
| **Level 0–1** | Small maintained projects, routine bug fixes | Light task list + evidence per task. No full proposal/archive. |
| **Level 2–3** (full 4-verb) | Long-lived features, API changes, data model changes, anything you'll need to remember in 6 months | Full propose → apply → archive with drift gates. The heavy path. |
| **Level 4** | Repeated agent work on a mature system | Project-local protocol. Triggered by strategy-rollup signals, not used by default. |

The rule: start one level lighter than you think you need. Escalate only when drift actually appears. A config-file change does not need four verbs and eight gates. Using the full workflow on trivial changes is the fastest way to stop using it on important ones.

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
- **It relies on the agent to detect drift caused by the agent.** The method asks the same agent that produced the output to also verify it against intent. An external reviewer is recommended (and was used during SteadySpec's own development) but the product does not provide one. The honest-tuning failure — where the same agent wrote a violation and the validator that missed it — illustrates this structural limitation.
- **It does not version your specs.** The substrate (OpenSpec, plain docs, issue tracker) is responsible for that. SteadySpec adds drift defense around the substrate.
- **It does not replace tests.** Tests are one form of observable check. SteadySpec asks whether the right thing was built; tests verify whether the built thing works.
- **It does not enforce its own use.** You can install SteadySpec and never invoke a single verb. The package will not complain.
- **It does not provide CLI commands beyond `init`.** No `update`, no `uninstall`, no `check`, no `status`. Use file operations and re-init to upgrade. To remove SteadySpec from a project, see the manual cleanup checklist in [QUICKSTART.md](QUICKSTART.md). Reason for no uninstall command: a per-project removal command that touches user files is a data-loss risk we won't take in v0.2-alpha.
- **It does not handle issue-tracker substrates in v0.2-alpha.** GitHub issues / Jira / Linear as substrates are deferred to v0.3.
- **Tier 2 optimization is a moving target.** The method relies on agents following MUST-prefixed instructions and skill-description-based selection. Model behavior changes across versions; no API contract guarantees that a model which follows MUST-prefix today will do so after the next update. The Tier 2 designation describes the models SteadySpec was tested against at release time, not a permanent guarantee.
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

0. **You have experienced drift — not hypothetically.** You've shipped something and later discovered the agent changed what you didn't ask for, or the docs no longer match the code, or you approved too fast and regretted it. SteadySpec is a method for people who already know why they need it. If you haven't felt that cost yet, this will look like extra work for no reason. Bookmark it. Come back when you do.
1. Your agent is Tier 1 or Tier 2.
2. You are working alone or coordinating asynchronously without parallel authors.
3. You expect the work to live long enough that future-you (or a successor) will need the records.
4. You are willing to invoke the four verbs explicitly when the situation calls for them.

If any of those is false, SteadySpec v0.2-alpha is not the right fit. Use a lighter or different tool.

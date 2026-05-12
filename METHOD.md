# SteadySpec Method

SteadySpec is an anti-drift method. The v1 package applies it to software spec-driven development, but the method itself is about any long-running work where intent, decisions, outputs, validation, and final records can move apart.

The core claim is simple: work does not usually fail because people never wrote an intent. It fails because later execution quietly edits the intent, decisions lose their owner, validation is mistaken for truth, and the final record is cleaned up until it no longer describes what happened.

Use this document as the portable method. Use `recipes/software-sdd.md` as the software reference implementation.

## How Work Drifts

Everyone's coding with agents now. Self-paid, company-funded — it doesn't matter.

And quickly, people notice a pattern. Agents are great at single, small tasks. But when you keep going — no guardrails, conversation stretching across dozens of turns — the output becomes unstable. The agent quietly edits something you never asked it to touch. It made a judgment call, and you weren't in the room.

So document-driven development gets pulled off the shelf. The idea: before the agent writes a line, talk through the requirements. Lock down the direction. Write a spec. Hand the agent that spec and say: follow this. This approach — roughly L3 in AI-coding circles — is the first serious attempt to put a fence around the problem.

**→ Intent Before Production (1).** The spec is an intent record — a short note, written before work begins, that says what you're trying to achieve, where the boundary is, and what evidence would make completion credible. When the agent later touches something outside the boundary, you can point at the record. Without it, the boundary lives only in your head.

L3 works. Until it doesn't.

Code pours out of the agent faster than anyone can read it. The bottleneck moves to you: you're supposed to audit docs AND read code, and the gap between "done" and "next" keeps shrinking. Your brain cannot compile every changed file.

**→ Production With Nearby Checks (4).** Reviewing a finished pile of changes is too late. The fifth change may have quietly undone an assumption the first change depended on. The fix is not "review harder" — it's checking at the moment each small unit is produced. One unit. One check. Record. Then continue.

Then there's the other thing. The agent almost never considers how this new requirement connects to the system you already have. It wants the fastest path to done. Over time, your system fills with scattered one-off functions, duplicated logic, things only there because "the agent put it there."

**→ Durable Record Sync (6).** The code changed. The docs didn't. Every missed update erodes trust, until nobody reads the docs — they know the docs lie. The fix isn't a reminder. It's a gate: before closing, scan which docs reference the changed code, and block until must-update ones are updated.

And here the loop tightens. AI writes. AI builds. AI reviews. The human becomes a Yes machine — approving too fast, too many, too shallowly. When you ship multiple changes a day, you won't remember what the code looked like this morning.

**→ Output-Vs-Intent Review (5).** Review becomes "does the code look good?" instead of "did we solve the problem we opened this for?" You need to go back to the *original intent* — the one written before any code existed — and compare. Not the tests. Not the evolved spec. The intent.

At this point, the agent is like a new hire who starts fresh every morning. Highly capable, zero project memory. Every new session, you reteach the why and the how.

**→ Context Before Confidence (2).** Before the agent acts on unclear history — "this looks like dead code" — separate what's confirmed from what's inferred from what's unknown. Don't let "probably" harden into "definitely." When nobody wrote down why the weird workaround exists, the right answer is "we don't know — flag it."

**→ Decision Pressure Before Agreement (3).** Two messages to agreement feels efficient. It's often just shared blind spots. Before locking a direction, ask: "What would break this? And if it breaks, what alternative handles it better?" Consensus without pressure is just politeness.

Around here, a newer idea surfaces: put explicit boundaries around the workflow itself. SDD tells the agent what to build. This governance layer tells the agent how the work must be governed — what evidence is required before each step can be called complete, what records must be updated, what gates must be passed.

**→ Finalization Without Truth Drift (7).** Closing work is the most dangerous moment. Everyone wants a clean story. The archive wants to say "done" — it doesn't mention the fallback, the untested edge case, the deferred decision. But a clean archive is a lie that compounds: the next person trusts it, and builds on an incomplete foundation. The archive must preserve what actually happened.

**→ Local Signals To Strategy (8).** Ten changes shipped. Three carried the same debt: "manual validation pending." Each one looked reasonable in isolation — "I'll finish later." But three identical deferrals is a pattern. You can't see a pattern looking at one change at a time. The system needs to force that cross-change view.

---

These eight moments are not a list. They're a timeline — the life of a single piece of work:

```
Intent (1) → Context (2) → Decisions (3) → Production (4)
    → Review against intent (5) → Doc sync (6) → Archive (7)
                                                          ↓
                                              Strategy from patterns (8)
```

Skip intent (1), and you can't review against it later (5). Skip review (5), and you don't know what docs need updating (6). Skip doc sync (6), and your archive describes a world that doesn't exist (7). Archive fiction (7), and you'll never spot the strategy patterns (8).

The mechanisms are checkpoints along a path that work naturally drifts off of — each one catching the drift the previous checkpoint can't see.

The story above happens to be about code. But the pattern (intent drifts, decisions lose their owner, records stop matching reality) is the same whether you're drafting a contract, writing a research paper, or outlining a novel. Swap the nouns; the drift stays the same.

---

## Key Terms

These appear throughout the mechanisms. Each names the thing whose absence is where drift gets in.

| Term | What it means |
|---|---|
| **Intent record** | A short note, written before work starts, that says what you're trying to do and where the boundary is. The thing you can point at later. |
| **Observable check** | A concrete signal that something happened — a passing test, a command output you can see, a reviewer's confirmation. Not "I think it works." |
| **Output-vs-intent review** | After the work, comparing what was built against the original intent — not the tests, not the code quality. "Did we solve the problem we set out to solve?" |
| **Human-owned decision** | A call about value, risk, priority, or direction that a process can record but cannot make. Only a person can say "this debt is acceptable" or "this risk is mine." |
| **Drift** | The quiet gap between what was intended and what actually happened. Not a bug. Not a mistake. The natural tendency of work to wander when nobody's watching the boundary. |

Additional vocabulary (working medium, unit of work, finalized record) is defined in context within each mechanism.

## 1. Intent Before Production

### Mechanism

Before producing output, write the intent in a form that can later be checked. The intent record does not need to be large. It needs to name the desired change, the boundary of the work, the evidence expected before completion, and the stop condition.

This prevents the most common drift: output accumulates, then the team retrofits a story that makes the output look intended.

### Example In Software SDD

`steadyspec-propose` records the change intent, evidence plan, stop conditions, and implementation boundary before `steadyspec-apply` changes code or durable docs.

### Transferable Shape

Before starting:
1. State the intended outcome.
2. State what is outside the work.
3. State what observable checks would make completion credible.
4. State when to stop or re-open intent.

## 2. Context Before Confidence

### Mechanism

When history is unclear, recover confirmed context before proposing or changing direction. Unknown history must stay labeled as unknown. Do not turn plausible memory into durable fact.

This prevents context drift: the group acts as though it remembers why earlier choices were made, but the record no longer supports that confidence.

### Example In Software SDD

`steadyspec-context-archaeology` separates confirmed history, missing context, stale assumptions, and constraints before a proposal, debate, or implementation pass.

### Transferable Shape

Before relying on history:
1. List confirmed facts with source links.
2. List unknowns separately.
3. Convert confirmed history into constraints.
4. Keep guesses out of the durable record.

## 3. Decision Pressure Before Agreement

### Mechanism

Before locking a direction, pressure-test the decision tree. Ask one hard question at a time. When there are competing directions, run a structured debate. Require breaking scenarios, alternatives, and blind-spot checks.

This prevents consensus drift: a group confuses quick agreement with tested agreement.

### Example In Software SDD

`steadyspec-grill` hardens unresolved design branches. `steadyspec-debate` separates proposer, challenger, moderator, and expert blind-spot passes, while declaring runtime isolation limits.

### Transferable Shape

Before agreement:
1. Ask what would break the current direction.
2. Ask what alternative would be better under that failure.
3. Separate local objections from strategic objections.
4. Record unresolved human-owned decisions instead of hiding them in process language.

## 4. Production With Nearby Checks

### Mechanism

Produce one minimal unit of work, run the nearest credible observable check, and record the result before moving on. If the output reveals the intent was wrong or incomplete, stop and update the intent instead of silently widening the work.

This prevents execution drift: production changes the target, but the record still claims the original target was followed.

### Example In Software SDD

`steadyspec-apply` defines a proof signal, makes a minimal implementation slice, runs the check, records evidence, and stops on drift. TDD is one special case where the observable check is an automated test.

### Transferable Shape

During production:
1. Work in small units.
2. Attach each unit to an observable check.
3. Record pass, fail, fallback, or blocked explicitly.
4. Stop when the check shows the intent needs revision.

## 5. Output-Vs-Intent Review

### Mechanism

After producing output, review against the original intent. Do not let attractive output, passing checks, or reviewer preference replace the question: did this satisfy the intent and boundaries?

This prevents validation drift: evidence proves one thing, but the team uses it to claim a broader truth.

### Example In Software SDD

`steadyspec-review-against-intent` checks implementation against intent, evidence gaps, residual debt, and whether doc-sync or archive can proceed.

### Transferable Shape

Before accepting output:
1. Compare output to each intent point.
2. Compare output to each stated boundary.
3. Mark evidence gaps separately from defects.
4. Do not treat fallback as proof.

## 6. Durable Record Sync

### Mechanism

When output changes what is true, update the durable record before the next phase depends on old truth. The record should say what was implemented, what was not, what changed, and what remains uncertain.

This prevents record drift: the work is real, but the durable record keeps describing a previous world.

### Example In Software SDD

`steadyspec-doc-sync` writes implemented truth back to specs, change records, tasks, or project-local docs after review and before archive.

### Transferable Shape

Before moving on:
1. Identify durable records that future workers will trust.
2. Update them with implemented truth.
3. Separate completed work, accepted debt, fallback, and open risk.
4. Leave source links to the evidence.

## 7. Finalization Without Truth Drift

### Mechanism

Closing work is a high-risk moment. People want a clean story. The final record must resist that pressure by preserving what actually happened, including incomplete items, fallback decisions, and human-owned risk acceptance.

This prevents archive truth drift: the archive becomes a success narrative instead of a reusable record.

### Example In Software SDD

`steadyspec-archive` verifies human decision records, review status, doc-sync, accepted debt, and follow-up links before closing the change.

### Transferable Shape

Before declaring work finalized:
1. List all items claimed complete and verify evidence.
2. Separate process outputs from human-owned decisions.
3. Mark fallbacks as residual risk, not validation.
4. Preserve unresolved debt with an owner or follow-up.

## 8. Local Signals To Strategy

### Mechanism

Repeated local friction is not always local. When the same kind of drift appears across work items, roll it up as a strategy signal for human review rather than repeatedly fixing symptoms.

This prevents strategy drift: local patches accumulate while the real operating model remains wrong.

### Example In Software SDD

`steadyspec-strategy-rollup` gathers repeated local signals, proposes doc updates, and hands value judgments to `steadyspec-human-decision-record`.

### Transferable Shape

When patterns repeat:
1. Group repeated failures or exceptions.
2. Name the larger assumption they challenge.
3. Recommend a human decision or durable process update.
4. Avoid turning one local incident into strategy without evidence.

## Using This Method Outside Software

To adapt SteadySpec to a new domain, map the vocabulary first:

1. What is the intent record?
2. What is the working medium?
3. What is the unit of work?
4. What counts as an observable check?
5. Who owns value or risk decisions?
6. What record will future workers trust after finalization?

Then copy the eight mechanisms, not the software nouns. A research paper, contract, product brief, or novel outline can all use the same anti-drift shape while using different records and checks.

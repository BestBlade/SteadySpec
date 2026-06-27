// SteadySpec propose-flow as deterministic Workflow script.
// Replaces agent-inferred orchestration with explicit phase gating,
// schema-validated structured output, and deterministic routing.
// Enforces: context-archaeology → grill → [debate] → proposal artifact.
//
// Invocation: /steadyspec:propose <intent>
//
// args: { intent: string, projectRoot: string, substrate?: "openspec"|"docs", changeDir?: string, autoMode?: "single"|"cross-verify" }
//   - intent is required (the user's own words for what this change is about)
//   - substrate overrides auto-detection
//   - changeDir explicitly sets the change directory (skips substrate detection)

export const meta = {
  name: 'steadyspec-propose',
  description: 'SteadySpec propose verb as deterministic workflow — context archaeology → grill → debate (conditional) → proposal artifact with schema-validated gates',
  phases: [
    { title: 'Gather', detail: 'Read substrate state, detect change number, fetch project history' },
    { title: 'Archaeology', detail: 'Recover confirmed context when history is unclear' },
    { title: 'Grill', detail: 'Harden the decision tree one question at a time' },
    { title: 'Debate', detail: 'Proposer vs Challenger with blind-spot check' },
    { title: 'Proposal', detail: 'Write proposal artifact with validated fields' },
    { title: 'OpenSpec', detail: 'Generate OpenSpec-compliant artifacts (tasks.md, design.md, specs/) for external projects' },
  ],
}

// === Schemas ===

const SUBSTRATE_STATE_SCHEMA = {
  type: 'object',
  properties: {
    primary: { type: 'string', enum: ['openspec', 'docs', 'meta', 'custom', 'none'] },
    changeDir: { type: 'string' },
    archiveDir: { type: 'string' },
    nextChangeNumber: { type: 'number' },
  },
  required: ['primary', 'changeDir', 'archiveDir', 'nextChangeNumber'],
}

const HISTORY_SCHEMA = {
  type: 'object',
  properties: {
    relatedChanges: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          id: { type: 'string' },
          summary: { type: 'string' },
          relevance: { type: 'string' },
        },
        required: ['id', 'summary'],
      },
    },
    needsArchaeology: { type: 'boolean' },
    archaeologyReason: { type: 'string' },
  },
  required: ['relatedChanges', 'needsArchaeology'],
}

const ARCHAEOLOGY_SCHEMA = {
  type: 'object',
  properties: {
    confirmedFacts: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          fact: { type: 'string' },
          source: { type: 'string' },
        },
        required: ['fact', 'source'],
      },
    },
    unknowns: { type: 'array', items: { type: 'string' } },
    staleAssumptions: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
  },
  required: ['confirmedFacts', 'unknowns', 'constraints'],
}

const GRILL_QUESTION_SCHEMA = {
  type: 'object',
  properties: {
    "question": { type: 'string' },
    "category": {
      type: 'string',
      enum: ['boundary', 'evidence', 'stop-condition', 'non-goal', 'safety', 'dependency', 'other'],
    },
    "recommendedAnswer": { type: 'string' },
    "reasoning": { type: 'string' },
    "resolvedBranch": { type: 'string', enum: ['accepted', 'rejected', 'blocked', 'parked'] },
    "newQuestions": { type: 'array', items: { type: 'string' } },
    "parkingLotItem": {
      type: 'object',
      properties: {
        concern: { type: 'string' },
        trigger: { type: 'string' },
        risk: { type: 'string' },
        followUpOwner: { type: 'string' },
      },
    },
    "confidence": { type: 'number' },
    "crossVerifyResult": { type: 'object' },
  },
  required: ['question', 'recommendedAnswer', 'resolvedBranch'],
}

const GRILL_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    resolvedDecisions: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          question: { type: 'string' },
          answer: { type: 'string' },
          status: { type: 'string', enum: ['accepted', 'rejected', 'blocked', 'parked'] },
        },
        required: ['question', 'answer', 'status'],
      },
    },
    unresolvedBlockers: { type: 'array', items: { type: 'string' } },
    parkedConcerns: { type: 'array', items: { type: 'string' } },
    triggersDebate: { type: 'boolean' },
    debateReasons: { type: 'array', items: { type: 'string' } },
  },
  required: ['resolvedDecisions', 'triggersDebate'],
}

const GRILL_RECONCILER_SCHEMA = {
  type: 'object',
  properties: {
    divergenceVerdict: { type: 'string', enum: ['agreed', 'diverged', 'partially_diverged'] },
    agentAnswerReferences: { type: 'array', items: { type: 'string' } },
    divergenceSummary: { type: 'string' },
    escalatedBranch: { type: 'string' },
    reconcilerAnswer: { type: 'string' },
    reconciledBranch: { type: 'string' },
  },
  required: ['divergenceVerdict', 'agentAnswerReferences', 'divergenceSummary', 'escalatedBranch', 'reconcilerAnswer', 'reconciledBranch'],
}

const DEBATE_POSITION_SCHEMA = {
  type: 'object',
  properties: {
    approach: { type: 'string' },
    architecture: { type: 'string' },
    implementationBoundary: {
      type: 'object',
      properties: {
        inScope: { type: 'array', items: { type: 'string' } },
        outOfScope: { type: 'array', items: { type: 'string' } },
      },
      required: ['inScope', 'outOfScope'],
    },
    risks: { type: 'array', items: { type: 'string' } },
    assumptions: { type: 'array', items: { type: 'string' } },
  },
  required: ['approach', 'implementationBoundary'],
}

const DEBATE_CHALLENGE_SCHEMA = {
  type: 'object',
  properties: {
    objections: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          flaw: { type: 'string' },
          breakingScenario: { type: 'string' },
          alternative: { type: 'string' },
        },
        required: ['flaw', 'breakingScenario', 'alternative'],
      },
    },
    blindSpots: { type: 'array', items: { type: 'string' } },
    missingEvidence: { type: 'array', items: { type: 'string' } },
  },
  required: ['objections'],
}

const FINDINGS_SCHEMA = {
  type: 'object',
  properties: {
    decision: { type: 'string' },
    basis: { type: 'string' },
    strongestCounterCase: { type: 'string' },
    missingEvidence: { type: 'array', items: { type: 'string' } },
    blindSpotResult: { type: 'string' },
    status: { type: 'string', enum: ['finding', 'contested', 'unverified', 'blocked'] },
    implicationsForApply: { type: 'string' },
  },
  required: ['decision', 'basis', 'status', 'blindSpotResult', 'missingEvidence'],
}

const PROPOSAL_SCHEMA = {
  type: 'object',
  properties: {
    intent: { type: 'string' },
    boundary: {
      type: 'object',
      properties: {
        inScope: { type: 'array', items: { type: 'string' } },
        outOfScope: { type: 'array', items: { type: 'string' } },
      },
      required: ['inScope', 'outOfScope'],
    },
    nonGoals: { type: 'array', items: { type: 'string' } },
    evidenceRequired: { type: 'array', items: { type: 'string' } },
    stopConditions: { type: 'array', items: { type: 'string' } },
    decisionLedger: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          decisionId: { type: 'string' },
          phase: { type: 'string', enum: ['explore', 'propose', 'apply', 'verify', 'archive'] },
          decision: { type: 'string' },
          owner: { type: 'string', enum: ['agent', 'user', 'shared'] },
          riskLevel: { type: 'string', enum: ['low', 'medium', 'high'] },
          riskBasis: { type: 'string' },
          basis: { type: 'string' },
          alternatives: { type: 'array', items: { type: 'string' } },
          reversibility: { type: 'string', enum: ['easy', 'moderate', 'hard', 'irreversible'] },
          proofSignal: { type: 'string' },
          overridePath: { type: 'string' },
          status: { type: 'string', enum: ['proposed', 'accepted', 'overridden', 'superseded'] },
        },
        required: ['decisionId', 'phase', 'decision', 'owner', 'riskLevel', 'riskBasis', 'basis', 'alternatives', 'reversibility', 'overridePath', 'status'],
      },
    },
    riskRouting: {
      type: 'object',
      properties: {
        hardHighRiskTriggers: { type: 'array', items: { type: 'string' } },
        userRoutedDecisions: { type: 'array', items: { type: 'string' } },
        agentOwnedDecisions: { type: 'array', items: { type: 'string' } },
      },
      required: ['hardHighRiskTriggers', 'userRoutedDecisions', 'agentOwnedDecisions'],
    },
    attentionReport: {
      type: 'object',
      properties: {
        mustRead: { type: 'array', items: { type: 'string' } },
        needsGlance: { type: 'array', items: { type: 'string' } },
        collapsedLedger: { type: 'array', items: { type: 'string' } },
      },
      required: ['mustRead', 'needsGlance', 'collapsedLedger'],
    },
    inheritsFrom: { type: 'array', items: { type: 'string' } },
    basis: {
      type: 'object',
      properties: {
        grillRan: { type: 'boolean' },
        debateRan: { type: 'boolean' },
        debateFindingsPath: { type: 'string' },
        archaeologyRan: { type: 'boolean' },
      },
      required: ['grillRan', 'debateRan'],
    },
    unresolvedFields: { type: 'array', items: { type: 'string' } },
  },
  required: ['intent', 'boundary', 'evidenceRequired', 'stopConditions', 'decisionLedger', 'riskRouting', 'attentionReport', 'basis'],
}

const OPENSPEC_TASKS_SCHEMA = {
  type: 'object',
  properties: {
    tasks: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          heading: { type: 'string' },
          items: { type: 'array', items: { type: 'string' } },
        },
        required: ['heading', 'items'],
      },
    },
  },
  required: ['tasks'],
}

const OPENSPEC_DESIGN_SCHEMA = {
  type: 'object',
  properties: {
    architecture: { type: 'string' },
    keyDecisions: { type: 'array', items: { type: 'string' } },
    tradeoffs: { type: 'array', items: { type: 'string' } },
    constraints: { type: 'array', items: { type: 'string' } },
    risks: { type: 'array', items: { type: 'string' } },
  },
  required: ['architecture', 'keyDecisions'],
}

const OPENSPEC_SPEC_SCHEMA = {
  type: 'object',
  properties: {
    specs: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          filename: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['filename', 'content'],
      },
    },
  },
  required: ['specs'],
}

// === Helpers ===

const HIGH_RISK_KEYWORDS = [
  'architecture', 'data model', 'schema', 'migration',
  'public api', 'api', 'interface', 'security', 'auth',
  'authentication', 'authorization', 'encryption',
]

const MAX_GRILL_DEPTH = 5
const MAX_AGENT_CALLS = 40

function touchesHighRiskArea(intent, archaeology) {
  const text = (intent + ' ' + JSON.stringify(archaeology || {})).toLowerCase()
  return HIGH_RISK_KEYWORDS.some(kw => text.includes(kw))
}

function countNamedFiles(text) {
  return (text?.match(/\b[\w.-]+\.[A-Za-z0-9]+\b/g) || []).length
}

function isTrivialChange(intent, boundaryDecision = null) {
  if (countNamedFiles(intent) > 3) return false

  const expansive = /\b(all|every|multiple|many|several|each|restructure|reorganize)\b/i
  if (expansive.test(intent)) return false

  if (boundaryDecision && countNamedFiles(boundaryDecision.answer || '') > 3) {
    return false
  }

  const trivial = /^(fix typo|doc-only|doc update|readme|changelog|comment|format|cleanup import|remove dead code)\b/i
  return trivial.test(intent.trim())
}

function migrateEvidenceFormat(evidenceContent) {
  if (!evidenceContent) {
    return {
      format: 'absent',
      migrated: false,
      notes: ['No evidence.md content supplied during propose gather.'],
    }
  }
  if (evidenceContent.includes('| Field | Value |')) {
    return {
      format: 'table',
      migrated: false,
      notes: ['Evidence already uses the structured table format.'],
    }
  }
  return {
    format: 'legacy-freeform',
    migrated: true,
    notes: ['Treat missing structured fields as evidence-migration-unavailable.'],
  }
}

function parkDepthQuestions(newQuestions, sourceQuestion, parkedConcerns) {
  for (const question of newQuestions || []) {
    parkedConcerns.push(JSON.stringify({
      concern: question,
      trigger: 'depth-cap-exceeded',
      risk: `Question discovered after max grill depth while resolving: ${sourceQuestion}`,
      followUpOwner: 'future apply/re-propose',
    }))
  }
}

function slugFromIntent(intent) {
  return intent
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 60)
}

// === Main ===

const intent = args.intent || null
const root = args.projectRoot || '.'
const forcedSubstrate = args.substrate || null

if (!intent) {
  log('ERROR: intent is required for propose. Pass args.intent with the user\'s change description.')
  return { error: 'missing-intent', help: 'Provide an intent string describing the change.' }
}

const autoMode = args.autoMode || 'single'

log(`Intent: "${intent}"`)

// ─── PHASE: Gather ───
phase('Gather')

const explicitChangeDir = args.changeDir || null
const evidenceMigration = migrateEvidenceFormat(null)

const state = await agent(
  `Determine the project state for a new proposal at ${root}.

   1. Determine changeDir (priority order):
      ${explicitChangeDir ? `a) USE explicitly provided changeDir: "${explicitChangeDir}". Set primary="custom", changeDir="${explicitChangeDir}", archiveDir="${explicitChangeDir}/archive". Skip all detection.` : 'a) No explicit changeDir provided.'}
      b) Read .steadyspec/substrate.json if present. If it records a custom changeDir, use it.
      c) Auto-detect: openspec/ → primary="openspec", changeDir="openspec/changes".
         docs/changes/ with NNN-* → primary="docs", changeDir="docs/changes".
         .meta/changes/ → primary="meta", changeDir=".meta/changes".
         Otherwise → primary="docs", changeDir="docs/changes".
      ${forcedSubstrate ? `NOTE: User forced substrate type to "${forcedSubstrate}". Use this for primary but still respect explicit changeDir if set.` : ''}

   2. Determine the next change number:
      - For NNN-prefix substrates (openspec, docs): find the highest NNN in changeDir (excluding archive/), add 1. Start at 001 if no prior changes.
      - For non-NNN substrates (meta): use 0 as placeholder (the substrate uses descriptive slugs).

   3. Set archiveDir = changeDir + "/archive".

   Legacy evidence migration rule from ARTIFACT_CONTRACT.md:
   ${JSON.stringify(evidenceMigration)}
   If any related evidence.md is read while gathering history, detect whether it
   contains "| Field | Value |". Missing header means legacy free-form evidence;
   preserve it and mark unavailable structured fields as
   "evidence-migration-unavailable".

   Output: primary, changeDir, archiveDir, nextChangeNumber.`,
  { label: 'gather-state', phase: 'Gather', schema: SUBSTRATE_STATE_SCHEMA }
)

if (!state) {
  return { error: 'state-detection-failed' }
}

const substrate = forcedSubstrate || state.primary
const changeNumber = String(state.nextChangeNumber).padStart(3, '0')
const slug = slugFromIntent(intent)
const changeId = `${changeNumber}-${slug}`
const proposalDir = `${state.changeDir}/${changeId}`

log(`Substrate: ${substrate} | Change ID: ${changeId} | Dir: ${proposalDir}`)

// Fetch project history
const history = await agent(
  `Search for prior changes relevant to intent: "${intent}"

   Project root: ${root}
   Archive index: ${state.archiveDir}/
   Active changes: ${state.changeDir}/

   1. Read the archive index and scan for changes mentioning keywords from the intent.
   2. Read proposal.md summaries for the 1-3 most related prior changes.
   3. Determine if context-archaeology is needed:
      - The intent mentions code areas with potentially unclear history
      - Prior changes suggest conflicting or unclear decisions
      - There are known unknowns in the affected code area

   Flag needsArchaeology=true only when there is genuine historical uncertainty.
   Do not flag for routine changes in well-documented areas.`,
  { label: 'fetch-history', phase: 'Gather', schema: HISTORY_SCHEMA }
)

const inheritsFrom = (history?.relatedChanges || []).map(c => c.id)
log(`Related prior changes: ${inheritsFrom.length > 0 ? inheritsFrom.join(', ') : 'none'}`)
if (history?.needsArchaeology) {
  log(`Archaeology needed: ${history.archaeologyReason}`)
}

// ─── PHASE: Archaeology (conditional) ───
let archaeology = null

if (history?.needsArchaeology) {
  phase('Archaeology')

  archaeology = await agent(
    `Run context archaeology for intent: "${intent}"

     Project root: ${root}
     Related changes: ${JSON.stringify(history.relatedChanges)}

     Using git log, file history, prior proposal/archive records, and doc references:
     1. List confirmed facts with source links (file paths, commit hashes, change IDs).
     2. List unknowns separately — things the record doesn't explain.
     3. Convert confirmed history into constraints for the proposal.
     4. Identify stale assumptions (things that were true but may no longer be).
     5. Keep guesses out. Unknown history stays labeled as unknown.`,
    { label: 'archaeology', phase: 'Archaeology', schema: ARCHAEOLOGY_SCHEMA }
  )

  if (archaeology) {
    log(`Archaeology: ${archaeology.confirmedFacts.length} confirmed, ${archaeology.unknowns.length} unknown, ${archaeology.constraints.length} constraints`)

    // Write context.md (archaeology results) as separate artifact
    const contextMd = `# Context Archaeology

## Confirmed Facts

${archaeology.confirmedFacts.map(f => `- **${f.fact}** (source: ${f.source})`).join('\n')}

${archaeology.unknowns.length > 0 ? `## Unknowns\n${archaeology.unknowns.map(u => `- ${u}`).join('\n')}\n` : ''}
${archaeology.staleAssumptions?.length > 0 ? `## Stale Assumptions\n${archaeology.staleAssumptions.map(s => `- ${s}`).join('\n')}\n` : ''}

## Constraints Carried Forward

${archaeology.constraints.map(c => `- ${c}`).join('\n')}
`
    await agent(
      `Write the following context.md content to ${proposalDir}/context.md using the Write tool. Do not modify — write exactly as provided.\n\n${contextMd}`,
      { label: 'write-context', phase: 'Archaeology' }
    )
    log(`context.md written to ${proposalDir}/context.md`)
  }
}

// ─── PHASE: Grill ───
phase('Grill')

// Build context for grill
const grillContext = {
  intent,
  constraints: archaeology?.constraints || [],
  unknowns: archaeology?.unknowns || [],
  relatedChanges: inheritsFrom,
  substrate,
}

// Dynamically discover initial grill questions from intent + context.
// The grill SKILL says questions should be discovered, not templated.
const seedQuestions = await agent(
  `Analyze the change intent and generate the initial set of grill questions.

   INTENT: "${intent}"
   CONSTRAINTS: ${JSON.stringify(grillContext.constraints)}
   UNKNOWNS: ${JSON.stringify(grillContext.unknowns)}
   RELATED CHANGES: ${JSON.stringify(inheritsFrom)}
   SUBSTRATE: ${substrate}

   Generate the essential blocking questions that must be answered before this change can be proposed.
   Cover these dimensions (adapting each to the specific intent, not generic templates):
   - Implementation boundary: what files/layers/interfaces are in vs out of scope?
   - Evidence: what observable proof will show this change is complete?
   - Stop conditions: what would force us to pause and revise?
   - Non-goals: what are we deliberately NOT doing?
   - Safety: any risks or side effects specific to this change?

   Rules:
   - Each question must be SPECIFIC to the intent. Do not use generic phrasing.
   - Inspect the codebase if the intent mentions specific files or modules.
   - Include unknowns from archaeology as questions if present.
   - Start with 4-6 questions. The grill loop can discover more.`,
  { label: 'grill-seed', phase: 'Grill', schema: {
    type: 'object',
    properties: {
      questions: { type: 'array', items: { type: 'string' } },
      rationale: { type: 'string' },
    },
    required: ['questions'],
  }}
)

const grillQuestions = seedQuestions?.questions?.length > 0
  ? seedQuestions.questions
  : [
      `What is the implementation boundary for "${intent}"? Which files, layers, or interfaces are in scope vs out of scope?`,
      `What evidence will prove this change is complete? What observable checks are required?`,
      `What are the stop conditions? What would cause us to pause implementation and revise the intent?`,
      `What are the explicit non-goals — things we are deliberately NOT doing in this change?`,
    ]

log(`Grill seed: ${grillQuestions.length} initial questions discovered`)

const resolvedDecisions = []
const unresolvedBlockers = []
const parkedConcerns = []
let triggersDebate = false
const debateReasons = []

// Ask one question at a time (loop-until-dry pattern for decision tree)
const questionsToAsk = grillQuestions.map(question => ({ question, depth: 0 }))
const crossVerifyResults = []
let agentCallCount = 0

if (autoMode === "cross-verify") {
  // Cross-verify: two parallel agents per question + reconciler
  for (let i = 0; i < questionsToAsk.length; i++) {
    const qItem = questionsToAsk[i]
    const q = qItem.question
    const depth = qItem.depth || 0

    if (agentCallCount + 3 > MAX_AGENT_CALLS) {
      log(`WARN: Grill agent call budget (${MAX_AGENT_CALLS}) reached; stopping with partial results.`)
      break
    }

    const grillPrompt = `GRILL QUESTION ${i + 1}/${questionsToAsk.length}

     Intent: "${intent}"
     Context so far:
     - Constraints: ${JSON.stringify(grillContext.constraints)}
     - Already resolved: ${JSON.stringify(resolvedDecisions)}
     - Known unknowns: ${JSON.stringify(grillContext.unknowns)}

     Question: ${q}

     Rules:
     - Ask ONE blocking question. Give the recommended answer and why.
     - If code/docs/history can answer, inspect them instead of asking.
     - Resolve the branch: accepted answer, rejected alternative, or explicit blocker.
     - Do NOT accept vague answers when they affect scope, correctness, or stop conditions.
     - Put design-outside long tail into the parking lot (trigger, risk, follow-up owner).
       Parked items are NOT new questions — they are explicitly deferred.
     - Only list a new question if you discover a genuine dependency: a decision
       that MUST be resolved before the current branch can be considered complete.
       Unrelated curiosities and nice-to-know items do not qualify.`

    agentCallCount += 2
    const [agent1, agent2] = await parallel([
      () => agent(grillPrompt, { label: `grill-xv-a1-q${i + 1}`, phase: 'Grill', schema: GRILL_QUESTION_SCHEMA }),
      () => agent(grillPrompt, { label: `grill-xv-a2-q${i + 1}`, phase: 'Grill', schema: GRILL_QUESTION_SCHEMA }),
    ])

    if (!agent1 || !agent2) {
      unresolvedBlockers.push(`Grill question ${i + 1} cross-verify failed: ${q}`)
      continue
    }

    agentCallCount += 1
    const reconciler = await agent(
      `You are the RECONCILER for a parallel grill question.

       Question: ${q}

       AGENT 1 ANSWER:
       ${JSON.stringify(agent1)}

       AGENT 2 ANSWER:
       ${JSON.stringify(agent2)}

       TASK:
       1. Compare both agents' answers.
       2. Determine divergence verdict: "agreed" (same answer/same branch), "diverged" (different answers), or "partially_diverged" (same branch but different reasoning).
       3. If diverged, summarize the key differences and recommend an escalated branch.
       4. Provide a single reconcilerAnswer and reconciledBranch for downstream use.
       5. Reference both agent answers in agentAnswerReferences.

       When agents agree, the reconcilerAnswer should match the agreed answer.
       When agents diverge, choose the more conservative, well-reasoned answer.`,
      { label: `grill-xv-reconciler-q${i + 1}`, phase: 'Grill', schema: GRILL_RECONCILER_SCHEMA }
    )

    if (!reconciler) {
      unresolvedBlockers.push(`Grill question ${i + 1} reconciler failed: ${q}`)
      continue
    }

    resolvedDecisions.push({
      originalQuestion: q,
      question: q,
      category: agent1.category || agent2.category || 'other',
      answer: reconciler.reconcilerAnswer || agent1.recommendedAnswer,
      status: reconciler.reconciledBranch || agent1.resolvedBranch,
    })

    if (reconciler.reconciledBranch === 'blocked' || agent1.resolvedBranch === 'blocked') {
      unresolvedBlockers.push(q)
    }

    const highConfidence = (agent1.confidence || 0) > 0.8 && (agent2.confidence || 0) > 0.8
    crossVerifyResults.push({
      verdict: reconciler.divergenceVerdict,
      summary: reconciler.divergenceSummary,
      highConfidence,
    })

    // Add new questions discovered during this round (from agent1)
    if (agent1.newQuestions?.length > 0) {
      if (depth >= MAX_GRILL_DEPTH) {
        parkDepthQuestions(agent1.newQuestions, q, parkedConcerns)
        log(`Grill depth cap (${MAX_GRILL_DEPTH}) reached: parked ${agent1.newQuestions.length} question(s)`)
      } else {
        questionsToAsk.push(...agent1.newQuestions.map(question => ({ question, depth: depth + 1 })))
        log(`Grill cross-verify discovered ${agent1.newQuestions.length} new question(s)`)
      }
    }

    if (agent1.parkingLotItem) {
      parkedConcerns.push(JSON.stringify(agent1.parkingLotItem))
    }
  }
} else {
  for (let i = 0; i < questionsToAsk.length; i++) {
    const qItem = questionsToAsk[i]
    const q = qItem.question
    const depth = qItem.depth || 0

    if (agentCallCount + 1 > MAX_AGENT_CALLS) {
      log(`WARN: Grill agent call budget (${MAX_AGENT_CALLS}) reached; stopping with partial results.`)
      break
    }

    agentCallCount += 1
    const answer = await agent(
      `GRILL QUESTION ${i + 1}/${questionsToAsk.length}

     Intent: "${intent}"
     Context so far:
     - Constraints: ${JSON.stringify(grillContext.constraints)}
     - Already resolved: ${JSON.stringify(resolvedDecisions)}
     - Known unknowns: ${JSON.stringify(grillContext.unknowns)}

     Question: ${q}

     Rules:
     - Ask ONE blocking question. Give the recommended answer and why.
     - If code/docs/history can answer, inspect them instead of asking.
     - Resolve the branch: accepted answer, rejected alternative, or explicit blocker.
     - Do NOT accept vague answers when they affect scope, correctness, or stop conditions.
     - Put design-outside long tail into the parking lot (trigger, risk, follow-up owner).
       Parked items are NOT new questions — they are explicitly deferred.
     - Only list a new question if you discover a genuine dependency: a decision
       that MUST be resolved before the current branch can be considered complete.
       Unrelated curiosities and nice-to-know items do not qualify.`,
      { label: `grill-q${i + 1}`, phase: 'Grill', schema: GRILL_QUESTION_SCHEMA }
    )

    if (!answer) {
      unresolvedBlockers.push(`Grill question ${i + 1} failed to produce an answer: ${q}`)
      continue
    }

    resolvedDecisions.push({
      originalQuestion: q,
      question: q,
      category: answer.category || 'other',
      answer: answer.recommendedAnswer,
      status: answer.resolvedBranch,
    })

    if (answer.resolvedBranch === 'blocked') {
      unresolvedBlockers.push(q)
    }

    if (answer.parkingLotItem) {
      parkedConcerns.push(JSON.stringify(answer.parkingLotItem))
    }

    // Add any new questions discovered during this round
    if (answer.newQuestions?.length > 0) {
      if (depth >= MAX_GRILL_DEPTH) {
        parkDepthQuestions(answer.newQuestions, q, parkedConcerns)
        log(`Grill depth cap (${MAX_GRILL_DEPTH}) reached: parked ${answer.newQuestions.length} question(s)`)
      } else {
        questionsToAsk.push(...answer.newQuestions.map(question => ({ question, depth: depth + 1 })))
        log(`Grill discovered ${answer.newQuestions.length} new question(s)`)
      }
    }
  }
}

log(`Grill complete: ${resolvedDecisions.length} decisions, ${unresolvedBlockers.length} blockers, ${parkedConcerns.length} parked`)

// Write grill.md as separate artifact
const provenanceMode = autoMode === 'cross-verify' ? 'cross-verify' : 'single-agent-auto'
const grillMd = `# Grill Results

## Decision Provenance

Mode: **${provenanceMode}**
${provenanceMode === 'cross-verify' ? 'Each decision was answered by two independent agents in parallel with a reconciler resolving divergence. Decisions with unanimous high-confidence agreement were auto-accepted. Divergent answers triggered debate.' : 'Each decision was answered by a single agent in auto mode. No human confirmation was sought during grill.'}

## Intent

${intent}

## Resolved Decisions

${resolvedDecisions.map((d, i) => `### Decision ${i + 1}

**Question:** ${d.question}
**Answer:** ${d.answer}
**Status:** ${d.status}
`).join('\n')}
${unresolvedBlockers.length > 0 ? `## Unresolved Blockers\n${unresolvedBlockers.map(b => `- ${b}`).join('\n')}\n` : ''}
${parkedConcerns.length > 0 ? `## Parked Concerns\n${parkedConcerns.map(p => `- ${p}`).join('\n')}\n` : ''}
${autoMode === 'cross-verify' ? `## Cross-Verify Results\n${crossVerifyResults.map((r, i) => `- Q${i + 1}: ${r.verdict} (highConfidence: ${r.highConfidence})`).join('\n')}\n` : ''}
`

await agent(
  `Write the following grill.md content to ${proposalDir}/grill.md using the Write tool. Do not modify — write exactly as provided.\n\n${grillMd}`,
  { label: 'write-grill', phase: 'Grill' }
)
log(`grill.md written to ${proposalDir}/grill.md`)

// Determine if debate is needed
// Conditions: fork, high-risk area, or boundary not sharp
const hasFork = resolvedDecisions.some(d => d.status === 'blocked' || d.status === 'parked')
const isHighRisk = touchesHighRiskArea(intent, archaeology)
const boundaryDecision = resolvedDecisions.find(d => d.question.includes('boundary'))
const boundarySharp = boundaryDecision && boundaryDecision.status === 'accepted' && !boundaryDecision.answer.includes('unclear')

if (hasFork) {
  triggersDebate = true
  debateReasons.push('fork: grill found unresolved or contested directions')
}
if (isHighRisk) {
  triggersDebate = true
  debateReasons.push(`high-risk area: intent touches architecture, data model, public API, migration, or security`)
}
if (!boundarySharp) {
  triggersDebate = true
  debateReasons.push('boundary not sharp: implementation boundary is not yet clear enough for apply to provably stay inside')
}

// Cross-verify debate trigger extension
if (autoMode === 'cross-verify' && crossVerifyResults.length > 0) {
  const anyDiverged = crossVerifyResults.some(r => r.verdict === 'diverged')
  const allAgreedHighConf = crossVerifyResults.every(r => r.verdict === 'agreed' && r.highConfidence)
  const anyPartial = crossVerifyResults.some(r => r.verdict === 'partially_diverged')

  if (allAgreedHighConf) {
    triggersDebate = false
    debateReasons.length = 0
    log('Cross-verify: unanimous high-confidence agreement across all grill questions — debate suppressed')
  } else if (anyDiverged) {
    triggersDebate = true
    debateReasons.push('cross-verify: parallel agents diverged on one or more grill questions')
  } else if (anyPartial) {
    triggersDebate = true
    debateReasons.push('cross-verify: partial divergence detected in grill answers')
  }
}

// ─── PHASE: Debate (conditional) ───
let debateFindings = null
let debateFindingsPath = null

if (triggersDebate) {
  phase('Debate')

  log(`Debate triggered: ${debateReasons.join('; ')}`)
  log('Running mode-2 pseudo-cross-debate (Proposer + Challenger subagents with same-model blind-spot check)')

  // Build debate brief
  const debateBrief = {
    intent,
    constraints: archaeology?.constraints || [],
    grillDecisions: resolvedDecisions,
    boundary: boundaryDecision?.answer || 'not yet resolved',
  }

  // Spawn Proposer and Challenger in parallel
  const [proposer, challenger] = await parallel([
    () => agent(
      `You are the PROPOSER in a structured SDD debate.

       TOPIC: ${JSON.stringify(debateBrief)}

       ROLE: Make the strongest, most concrete case for the best approach.
       - Propose a specific architecture and implementation boundary.
       - List in-scope and out-of-scope items explicitly.
       - Name risks and assumptions honestly.
       - This is your complete pass — make it concrete enough to be challenged.`,
      { label: 'proposer', phase: 'Debate', schema: DEBATE_POSITION_SCHEMA }
    ),
    () => agent(
      `You are the CHALLENGER in a structured SDD debate.

       TOPIC: ${JSON.stringify(debateBrief)}

       ROLE: Find flaws in the proposer's approach.
       - For each objection, provide: the flaw, a breaking scenario, and a concrete alternative.
       - Objections without a breaking scenario AND alternative are invalid.
       - Identify blind spots the proposer may have missed.
       - Identify missing evidence that would change the decision.
       - Do NOT propose your own approach from scratch — challenge the proposer's specific claims.`,
      { label: 'challenger', phase: 'Debate', schema: DEBATE_CHALLENGE_SCHEMA }
    ),
  ])

  if (!proposer || !challenger) {
    log('WARN: Debate subagent(s) failed. Proceeding without debate findings.')
  } else {
    // Moderator synthesizes findings
    const findings = await agent(
      `You are the MODERATOR in a structured SDD debate.

       INTENT: ${intent}

       PROPOSER'S CASE:
       ${JSON.stringify(proposer)}

       CHALLENGER'S OBJECTIONS:
       ${JSON.stringify(challenger)}

       TASK:
       1. Map each objection to: accepted, rejected, or carried forward.
       2. If positions stall, propose a third direction or smaller reframing.
       3. Run an expert blind-spot pass (unconditional):
          - same-model or shared-training limits
          - missing domain expert view
          - moderator bias risk
          - consensus without external evidence
       4. Produce findings: decision, basis, strongest counter-case, missing evidence,
          blind-spot result, status, and implications for apply.

       Remember: consensus is not proof. Missing evidence stays visible.`,
      { label: 'moderator', phase: 'Debate', schema: FINDINGS_SCHEMA }
    )

    if (findings) {
      debateFindings = findings
      debateFindingsPath = `${proposalDir}/debate-findings.md`
      log(`Debate complete: status=${findings.status}`)

      // Write debate-findings.md as separate artifact
      const debateMd = `# Debate Findings

## Decision Provenance

**Moderator:** agent-moderated (mode-2 pseudo-cross-debate)
${autoMode === 'cross-verify' ? '**Trigger:** cross-verify divergence detected in grill answers.' : '**Trigger:** standard debate conditions (fork, high-risk, or boundary-not-sharp).'}
**Limitation:** same-model blind spots remain — Proposer, Challenger, and Moderator share the same model.

## Decision

${findings.decision}

## Basis

${findings.basis}

## Strongest Counter-Case

${findings.strongestCounterCase || 'None presented.'}

## Missing Evidence

${(findings.missingEvidence || []).map(e => `- ${e}`).join('\n')}

## Expert Blind-Spot Pass

${findings.blindSpotResult}

## Status

${findings.status}

## Implications for Apply

${findings.implicationsForApply || 'None noted.'}
`
      await agent(
        `Write the following debate-findings.md content to ${debateFindingsPath} using the Write tool. Do not modify — write exactly as provided.\n\n${debateMd}`,
        { label: 'write-debate-findings', phase: 'Debate' }
      )
      log(`debate-findings.md written to ${debateFindingsPath}`)

      // Round 2: second debate pass for architecture, data, security, migration, public API
      if (isHighRisk) {
        log('Round 2 debate triggered — decision affects architecture, data, security, or migration')

        const [proposerR2, challengerR2] = await parallel([
          () => agent(
            `You are the PROPOSER in ROUND 2 of a structured SDD debate.

             INTENT: ${intent}
             ROUND 1 FINDINGS: ${JSON.stringify(findings)}
             CHALLENGER'S R1 OBJECTIONS: ${JSON.stringify(challenger)}

             ROLE: Refine your position based on the challenger's objections.
             - Address each objection explicitly: accepted, rejected with reason, or incorporated.
             - Update your architecture and implementation boundary.
             - Update risks and assumptions based on the debate so far.
             - Do NOT repeat your round 1 position unchanged — this round must show evolution.`,
            { label: 'proposer-r2', phase: 'Debate', schema: DEBATE_POSITION_SCHEMA }
          ),
          () => agent(
            `You are the CHALLENGER in ROUND 2 of a structured SDD debate.

             INTENT: ${intent}
             ROUND 1 FINDINGS: ${JSON.stringify(findings)}
             PROPOSER'S R1 CASE: ${JSON.stringify(proposer)}

             ROLE: Challenge the proposer's refined position.
             - New objections only — do not repeat objections the proposer has already addressed.
             - If you find no new flaws, say so honestly. Do not fabricate objections.
             - Identify any remaining blind spots or missing evidence that round 1 missed.
             - Focus on what changed between round 1 and round 2.`,
            { label: 'challenger-r2', phase: 'Debate', schema: DEBATE_CHALLENGE_SCHEMA }
          ),
        ])

        if (proposerR2 && challengerR2) {
          const findingsR2 = await agent(
            `You are the MODERATOR for ROUND 2 of a structured SDD debate.

             INTENT: ${intent}
             ROUND 1 FINDINGS: ${JSON.stringify(findings)}

             PROPOSER R2 REFINED CASE:
             ${JSON.stringify(proposerR2)}

             CHALLENGER R2 OBJECTIONS:
             ${JSON.stringify(challengerR2)}

             TASK:
             1. Synthesize across BOTH rounds. The final decision should reflect the full two-round debate.
             2. Note what changed between rounds (refinement, concession, hardening).
             3. Run an expert blind-spot pass (unconditional) covering both rounds.
             4. Produce final findings: decision, basis, strongest counter-case, missing evidence,
                blind-spot result, status, and implications for apply.

             The round 2 findings REPLACE round 1 findings as the authoritative debate output.`,
            { label: 'moderator-r2', phase: 'Debate', schema: FINDINGS_SCHEMA }
          )

          if (findingsR2) {
            debateFindings = findingsR2
            log(`Debate round 2 complete: status=${findingsR2.status}`)

            // Rewrite debate-findings.md with round 2 synthesis
            const debateMdR2 = `# Debate Findings (2 Rounds)

## Decision Provenance

**Moderator:** agent-moderated (mode-2 pseudo-cross-debate, 2 rounds)
**Round 2 triggered:** decision affects architecture, data, security, migration, or public API.
**Limitation:** same-model blind spots remain — Proposer, Challenger, and Moderator share the same model.

## Round Summary

- Round 1: initial Proposer/Challenger positions established, Moderator synthesized.
- Round 2: Proposer refined based on Challenger objections, Challenger challenged refined position, Moderator produced final synthesis.

## Decision

${findingsR2.decision}

## Basis

${findingsR2.basis}

## Strongest Counter-Case

${findingsR2.strongestCounterCase || 'None presented.'}

## Missing Evidence

${(findingsR2.missingEvidence || []).map(e => `- ${e}`).join('\n')}

## Expert Blind-Spot Pass

${findingsR2.blindSpotResult}

## Status

${findingsR2.status}

## Implications for Apply

${findingsR2.implicationsForApply || 'None noted.'}
`
            await agent(
              `Overwrite ${debateFindingsPath} with the following round 2 debate-findings.md content using the Write tool. Do not modify — write exactly as provided.\n\n${debateMdR2}`,
              { label: 'write-debate-findings-r2', phase: 'Debate' }
            )
            log(`debate-findings.md overwritten with round 2 synthesis`)
          }
        }
      }
    }
  }
} else {
  log('Debate not triggered — conditions not met.')
}

// ─── PHASE: Proposal ───
phase('Proposal')

const proposal = await agent(
  `Write the proposal artifact for change "${changeId}".

   === INTENT (user's own words) ===
   ${intent}

   === GRILL RESULTS ===
   Resolved decisions: ${JSON.stringify(resolvedDecisions)}
   Unresolved blockers: ${JSON.stringify(unresolvedBlockers)}
   Parked concerns: ${JSON.stringify(parkedConcerns)}

   === DEBATE FINDINGS ===
   ${debateFindings ? JSON.stringify(debateFindings) : 'Debate not run.'}

   === ARCHAEOLOGY ===
   ${archaeology ? `Confirmed: ${JSON.stringify(archaeology.confirmedFacts)}. Unknowns: ${JSON.stringify(archaeology.unknowns)}. Constraints: ${JSON.stringify(archaeology.constraints)}` : 'Not run.'}

   === PRIOR CHANGES ===
   Inherits from: ${JSON.stringify(inheritsFrom)}

   === SUBSTRATE ===
   ${substrate} — write to ${proposalDir}/proposal.md

   Compose the proposal with:
   1. **Intent** — the hardened one-line statement (user's words, clarified by grill/debate)
   2. **Boundary** — in scope (explicit list) / out of scope (explicit list)
   3. **Non-goals** — what we are deliberately NOT doing
   4. **Evidence required** — what observable checks make completion credible
   5. **Stop conditions** — what would pause apply and require intent revision
   6. **Decision ledger** - meaningful decisions with owner, risk, basis, alternatives, reversibility, proof signal, override path, and status
   7. **Risk routing** - hard high-risk triggers, user-routed decisions, and agent-owned low-risk decisions
   8. **Attention report** - must-read, needs-glance, and collapsed ledger
   9. **Basis** — grill ran? debate ran? findings file path (if run)
   10. **Inherits-from** — prior change IDs that influenced this proposal

   CRITICAL RULES:
   - Do NOT invent decisions that grill/debate/user did not justify.
     If a field has no source, mark it "unresolved" in unresolvedFields.
   - Hard high-risk triggers from ARTIFACT_CONTRACT.md must route to the user.
   - Low-risk agent-owned decisions may be collapsed in the attention report, but must remain in decisionLedger.
   - Open questions carry forward explicitly, not buried in confident prose.
   - If implementation tasks are included, write as VERTICAL SLICES (one slice = one provable behavior).
     Do NOT write horizontal layers (DB → service → UI).
   - Links to grill outputs and debate findings by file path. Do not inline them.`,
  { label: 'write-proposal', phase: 'Proposal', schema: PROPOSAL_SCHEMA }
)

if (!proposal) {
  return { error: 'proposal-composition-failed' }
}

// === Compose the actual proposal.md content ===
const proposalMd = `# Proposal: ${proposal.intent}

## Intent

${proposal.intent}

## Boundary

### In Scope
${proposal.boundary.inScope.map(s => `- ${s}`).join('\n')}

### Out of Scope
${proposal.boundary.outOfScope.map(s => `- ${s}`).join('\n')}

## Non-Goals
${(proposal.nonGoals || []).map(g => `- ${g}`).join('\n')}

## Evidence Required
${proposal.evidenceRequired.map(e => `- ${e}`).join('\n')}

## Stop Conditions
${proposal.stopConditions.map(s => `- ${s}`).join('\n')}

## Decision Ledger
${(proposal.decisionLedger || []).length > 0
  ? `| decisionId | phase | owner | riskLevel | decision | riskBasis | reversibility | proofSignal | overridePath | status |
|------------|-------|-------|-----------|----------|-----------|---------------|-------------|--------------|--------|
${proposal.decisionLedger.map(d => `| ${d.decisionId} | ${d.phase} | ${d.owner} | ${d.riskLevel} | ${d.decision} | ${d.riskBasis} | ${d.reversibility} | ${d.proofSignal || 'None'} | ${d.overridePath} | ${d.status} |`).join('\n')}`
  : '- None recorded'}

## Risk Routing

### Hard High-Risk Triggers
${(proposal.riskRouting?.hardHighRiskTriggers || []).length > 0 ? proposal.riskRouting.hardHighRiskTriggers.map(s => `- ${s}`).join('\n') : '- None'}

### User-Routed Decisions
${(proposal.riskRouting?.userRoutedDecisions || []).length > 0 ? proposal.riskRouting.userRoutedDecisions.map(s => `- ${s}`).join('\n') : '- None'}

### Agent-Owned Decisions
${(proposal.riskRouting?.agentOwnedDecisions || []).length > 0 ? proposal.riskRouting.agentOwnedDecisions.map(s => `- ${s}`).join('\n') : '- None'}

## Attention Report

### Must-read
${(proposal.attentionReport?.mustRead || []).length > 0 ? proposal.attentionReport.mustRead.map(s => `- ${s}`).join('\n') : '- None'}

### Needs glance
${(proposal.attentionReport?.needsGlance || []).length > 0 ? proposal.attentionReport.needsGlance.map(s => `- ${s}`).join('\n') : '- None'}

### Collapsed ledger
${(proposal.attentionReport?.collapsedLedger || []).length > 0 ? proposal.attentionReport.collapsedLedger.map(s => `- ${s}`).join('\n') : '- None'}

## Basis

- **Decision provenance:** ${provenanceMode}${autoMode === 'cross-verify' && proposal.basis.debateRan ? ' + agent-moderated debate' : ''}
- Grill ran: ${proposal.basis.grillRan ? 'yes' : 'no'}
- Debate ran: ${proposal.basis.debateRan ? 'yes' : 'no'}
${proposal.basis.debateFindingsPath ? `- Debate findings: ${proposal.basis.debateFindingsPath}` : ''}
- Context archaeology ran: ${proposal.basis.archaeologyRan ? 'yes' : 'no'}

## Inherits From
${(proposal.inheritsFrom || []).length > 0 ? proposal.inheritsFrom.map(id => `- ${id}`).join('\n') : '- (none — first change in this area)'}

${(proposal.unresolvedFields || []).length > 0 ? `## Unresolved Fields\n${proposal.unresolvedFields.map(f => `- ${f}`).join('\n')}` : ''}
`

// ─── PHASE: OpenSpec (external projects only) ───
await agent(
  `Write the following proposal.md content to ${proposalDir}/proposal.md using the Write tool. Create the directory if needed. Do not modify the content - write it exactly as provided.\n\n${proposalMd}`,
  { label: 'write-proposal-file', phase: 'Proposal' }
)
log(`proposal.md written to ${proposalDir}/proposal.md`)

let docsCheck = null
if (substrate === 'docs') {
  docsCheck = await agent(
    `Run docs substrate structural check for proposal phase.

     Command:
     steadyspec check ${proposalDir} --phase proposal --substrate docs

     If the command is unavailable in this runtime, return status="unavailable" and explain why.
     If it runs and fails, return status="fail" with the important error codes.
     If it passes, return status="pass".`,
    { label: 'docs-check-proposal', phase: 'Proposal', schema: {
      type: 'object',
      properties: {
        status: { type: 'string', enum: ['pass', 'fail', 'unavailable'] },
        command: { type: 'string' },
        summary: { type: 'string' },
        errorCodes: { type: 'array', items: { type: 'string' } },
      },
      required: ['status', 'summary'],
    }}
  )
  log(`docs check proposal: ${docsCheck?.status || 'unavailable'}${docsCheck?.summary ? ` - ${docsCheck.summary}` : ''}`)
}

// Generate OpenSpec-compliant artifacts for non-meta substrates.
// Self-dogfood (.meta/) skips this phase — it uses the simpler 4-file convention.
let openSpecArtifacts = null

if (substrate !== 'meta') {
  phase('OpenSpec')

  log(`Generating OpenSpec artifacts for substrate: ${substrate}`)

  // Generate tasks.md
  const tasks = await agent(
    `Generate tasks.md content for change "${changeId}".

     PROPOSAL INTENT: ${proposal.intent}
     IN SCOPE: ${JSON.stringify(proposal.boundary.inScope)}
     OUT OF SCOPE: ${JSON.stringify(proposal.boundary.outOfScope)}
     EVIDENCE REQUIRED: ${JSON.stringify(proposal.evidenceRequired)}
     GRILL DECISIONS: ${JSON.stringify(resolvedDecisions)}

     Produce an OpenSpec-compliant tasks.md with checkbox items.
     Group tasks under ## headings by spec area. Each task is a "- [ ] description" line.
     Tasks should be concrete, verifiable implementation steps derived from the proposal boundary and evidence plan.
     Do NOT include horizontal-layer tasks — use vertical slices.`,
    { label: 'generate-tasks', phase: 'OpenSpec', schema: OPENSPEC_TASKS_SCHEMA }
  )

  if (tasks) {
    const tasksMd = `# Tasks: ${proposal.intent}

${tasks.tasks.map(g => `## ${g.heading}\n${g.items.map(i => `- [ ] ${i}`).join('\n')}`).join('\n\n')}
`
    await agent(
      `Write the following tasks.md content to ${proposalDir}/tasks.md using the Write tool. Do not modify — write exactly as provided.\n\n${tasksMd}`,
      { label: 'write-tasks', phase: 'OpenSpec' }
    )
    log(`tasks.md written to ${proposalDir}/tasks.md`)
  }

  // Generate design.md
  const design = await agent(
    `Generate design.md content for change "${changeId}".

     INTENT: ${proposal.intent}
     GRILL DECISIONS: ${JSON.stringify(resolvedDecisions)}
     DEBATE FINDINGS: ${debateFindings ? JSON.stringify(debateFindings) : 'None.'}
     ARCHAEOLOGY CONSTRAINTS: ${JSON.stringify(archaeology?.constraints || [])}
     BOUNDARY: in=${JSON.stringify(proposal.boundary.inScope)}, out=${JSON.stringify(proposal.boundary.outOfScope)}

     Produce an OpenSpec-compliant design.md covering:
     1. Architecture — the high-level structure and approach
     2. Key Decisions — the important choices made during grill/debate and why
     3. Trade-offs — what was sacrificed and why
     4. Constraints — hard constraints from archaeology or prior changes
     5. Risks — known risks and mitigation strategies`,
    { label: 'generate-design', phase: 'OpenSpec', schema: OPENSPEC_DESIGN_SCHEMA }
  )

  if (design) {
    const designMd = `# Design: ${proposal.intent}

## Architecture

${design.architecture}

## Key Decisions

${design.keyDecisions.map((d, i) => `${i + 1}. ${d}`).join('\n')}

${design.tradeoffs?.length > 0 ? `## Trade-offs\n${design.tradeoffs.map(t => `- ${t}`).join('\n')}\n` : ''}
${design.constraints?.length > 0 ? `## Constraints\n${design.constraints.map(c => `- ${c}`).join('\n')}\n` : ''}
${design.risks?.length > 0 ? `## Risks\n${design.risks.map(r => `- ${r}`).join('\n')}\n` : ''}
`
    await agent(
      `Write the following design.md content to ${proposalDir}/design.md using the Write tool. Do not modify — write exactly as provided.\n\n${designMd}`,
      { label: 'write-design', phase: 'OpenSpec' }
    )
    log(`design.md written to ${proposalDir}/design.md`)
  }

  // Generate specs/*.md
  const specsDir = `${proposalDir}/specs`
  const specs = await agent(
    `Generate spec files for change "${changeId}".

     INTENT: ${proposal.intent}
     IN SCOPE: ${JSON.stringify(proposal.boundary.inScope)}
     EVIDENCE REQUIRED: ${JSON.stringify(proposal.evidenceRequired)}
     GRILL DECISIONS: ${JSON.stringify(resolvedDecisions)}

     Produce one spec file per distinct spec area in the in-scope boundary.
     Each spec file defines:
     - Requirements (what the system must do)
     - Acceptance criteria (how to verify each requirement)
     - Dependencies on other specs or external systems

     Return filename (e.g. "auth-spec.md") and full markdown content for each spec.
     Specs should be concrete and testable, derived from the evidence plan.`,
    { label: 'generate-specs', phase: 'OpenSpec', schema: OPENSPEC_SPEC_SCHEMA }
  )

  if (specs) {
    for (const spec of specs.specs) {
      await agent(
        `Write the following spec content to ${specsDir}/${spec.filename} using the Write tool. Create the directory if needed. Do not modify — write exactly as provided.\n\n${spec.content}`,
        { label: `write-spec-${spec.filename}`, phase: 'OpenSpec' }
      )
    }
    log(`${specs.specs.length} spec(s) written to ${specsDir}/`)
  }

  openSpecArtifacts = {
    tasksWritten: !!tasks,
    designWritten: !!design,
    specsWritten: specs ? specs.specs.length : 0,
    specsDir,
  }
}

// === Compose report ===
return {
  changeId,
  artifactLocation: `${proposalDir}/proposal.md`,
  proposalMd,
  intent: proposal.intent,
  boundary: proposal.boundary,
  evidencePlan: proposal.evidenceRequired,
  stopConditions: proposal.stopConditions,
  decisionLedger: proposal.decisionLedger || [],
  riskRouting: proposal.riskRouting || null,
  attentionReport: proposal.attentionReport || null,
  basis: {
    grillRan: proposal.basis.grillRan,
    debateRan: proposal.basis.debateRan,
    debateFindingsPath: proposal.basis.debateFindingsPath || null,
    archaeologyRan: proposal.basis.archaeologyRan || false,
  },
  inheritsFrom: proposal.inheritsFrom || [],
  unresolvedFields: proposal.unresolvedFields || [],
  docsCheck,
  debateFindings: debateFindings || null,
  archaeology: archaeology ? {
    confirmedCount: archaeology.confirmedFacts.length,
    unknownCount: archaeology.unknowns.length,
    constraintCount: archaeology.constraints.length,
  } : null,
  recommendedNext: proposal.unresolvedFields?.length > 0
    ? `Stay in propose to resolve: ${proposal.unresolvedFields.join(', ')}`
    : docsCheck?.status === 'fail'
      ? `Fix docs check errors for ${changeId}, then re-run /steadyspec:propose or /steadyspec:apply.`
    : `/steadyspec:apply ${changeId}`,
  openSpecArtifacts: openSpecArtifacts || null,
}

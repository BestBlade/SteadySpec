// SteadySpec verify-flow as deterministic Workflow script.
// Runs the v0.3 trust checkpoint before archive, handoff, or risky continuation.
//
// Invocation: /steadyspec:verify <change-id>
//
// args: { changeId: string, projectRoot: string, changeDir?: string, writeSnapshot?: boolean }

export const meta = {
  name: 'steadyspec-verify',
  description: 'SteadySpec verify verb as deterministic workflow - trust checkpoint for intent, evidence, ownership, risk routing, debt visibility, and next safest action',
  phases: [
    { title: 'Gather', detail: 'Read change artifacts, ledger, evidence, and current changed files' },
    { title: 'Intent', detail: 'Review output against original intent and boundary' },
    { title: 'Evidence', detail: 'Check proof signal credibility and coverage limits' },
    { title: 'Responsibility', detail: 'Review decision ownership and risk routing' },
    { title: 'Handoff', detail: 'Create handoff snapshot when requested or recommended' },
    { title: 'Report', detail: 'Report checkpoint result and next safest action' },
  ],
}

const VERIFY_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    changeId: { type: 'string' },
    changeDir: { type: 'string' },
    substrate: { type: 'string', enum: ['openspec', 'docs', 'meta', 'custom', 'none'] },
    proposalPath: { type: 'string' },
    evidencePath: { type: 'string' },
    checkpointPath: { type: 'string' },
    handoffPath: { type: 'string' },
    intent: { type: 'string' },
    boundary: { type: 'array', items: { type: 'string' } },
    nonGoals: { type: 'array', items: { type: 'string' } },
    evidenceRequired: { type: 'array', items: { type: 'string' } },
    completedSlices: { type: 'array', items: { type: 'string' } },
    changedFiles: { type: 'array', items: { type: 'string' } },
    ledgerEntries: { type: 'array', items: { type: 'string' } },
    pendingUserDecisions: { type: 'array', items: { type: 'string' } },
    debtAndFallback: { type: 'array', items: { type: 'string' } },
    driftEvents: { type: 'array', items: { type: 'string' } },
  },
  required: ['changeId', 'intent', 'completedSlices', 'ledgerEntries'],
}

const TRUST_CHECKPOINT_SCHEMA = {
  type: 'object',
  properties: {
    intentMatch: { type: 'string', enum: ['pass', 'gap', 'blocked'] },
    evidenceCredibility: { type: 'string', enum: ['pass', 'gap', 'blocked'] },
    riskRoutingReview: { type: 'string', enum: ['pass', 'misclassified', 'blocked'] },
    debtFallbackVisibility: { type: 'string', enum: ['pass', 'gap', 'blocked'] },
    recommendedNext: { type: 'string', enum: ['continue', 'archive', 'handoff', 're-open-intent', 'stop'] },
    mustReadDecisions: { type: 'array', items: { type: 'string' } },
    needsGlance: { type: 'array', items: { type: 'string' } },
    collapsedLedgerCount: { type: 'number' },
    evidenceGaps: { type: 'array', items: { type: 'string' } },
    riskMisclassifications: { type: 'array', items: { type: 'string' } },
    pendingUserDecisions: { type: 'array', items: { type: 'string' } },
    rationale: { type: 'string' },
  },
  required: [
    'intentMatch',
    'evidenceCredibility',
    'riskRoutingReview',
    'debtFallbackVisibility',
    'recommendedNext',
    'mustReadDecisions',
    'evidenceGaps',
    'pendingUserDecisions',
    'rationale',
  ],
}

const WRITE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    checkpointWritten: { type: 'boolean' },
    checkpointPath: { type: 'string' },
    handoffWritten: { type: 'boolean' },
    handoffPath: { type: 'string' },
    notes: { type: 'string' },
  },
  required: ['checkpointWritten', 'handoffWritten'],
}

const changeId = args.changeId || args.id || args._ || ''
const projectRoot = args.projectRoot || '.'

if (!changeId) {
  throw new Error('steadyspec-verify requires args.changeId')
}

phase('Gather')

const context = await agent(
  `Gather SteadySpec change context for trust checkpoint.

   PROJECT ROOT: ${projectRoot}
   CHANGE ID: ${changeId}
   EXPLICIT CHANGE DIR: ${args.changeDir || 'not provided'}

   Read proposal.md, evidence.md, tasks.md if present, review.md if present,
   decision ledger / attention report sections if present, re-slice events,
   handoff snapshot, and human-decision-records.

   Also inspect current git diff or changed-file list when available.
   Preserve missing fields as empty arrays; do not invent evidence.`,
  { label: 'verify-gather', phase: 'Gather', schema: VERIFY_CONTEXT_SCHEMA },
)

phase('Intent')
phase('Evidence')
phase('Responsibility')

const checkpoint = await agent(
  `Run the SteadySpec v0.3 trust checkpoint.

   CHANGE ID: ${context.changeId}
   INTENT: ${context.intent}
   BOUNDARY: ${(context.boundary || []).join('; ') || 'not recorded'}
   NON-GOALS: ${(context.nonGoals || []).join('; ') || 'not recorded'}
   EVIDENCE REQUIRED: ${(context.evidenceRequired || []).join('; ') || 'not recorded'}
   COMPLETED SLICES: ${(context.completedSlices || []).join('; ') || 'none'}
   LEDGER ENTRIES: ${(context.ledgerEntries || []).join('; ') || 'none'}
   PENDING USER DECISIONS: ${(context.pendingUserDecisions || []).join('; ') || 'none'}
   DEBT/FALLBACK: ${(context.debtAndFallback || []).join('; ') || 'none'}
   DRIFT EVENTS: ${(context.driftEvents || []).join('; ') || 'none'}

   Gates:
   1. Output-vs-intent: pass/gap/blocked.
   2. Evidence credibility: pass/gap/blocked. Do not treat fallback as proof.
   3. Risk routing review: pass/misclassified/blocked. Hard high-risk triggers
      from ARTIFACT_CONTRACT.md cannot be downgraded by agent judgment.
   4. Debt/fallback visibility: pass/gap/blocked.
   5. Recommend exactly one next safest action:
      continue, archive, handoff, re-open-intent, or stop.

   Return must-read decisions first, then needs-glance decisions, then collapsed
   low-risk agent-owned ledger count.`,
  { label: 'trust-checkpoint', phase: 'Responsibility', schema: TRUST_CHECKPOINT_SCHEMA },
)

phase('Handoff')

const shouldWriteHandoff = args.writeSnapshot === true || checkpoint.recommendedNext === 'handoff'

const writeResult = await agent(
  `Write or update trust checkpoint artifacts for this SteadySpec change.

   CHANGE DIR: ${context.changeDir || args.changeDir || changeId}
   CHECKPOINT PATH: ${context.checkpointPath || 'trust-checkpoint.md in the change directory'}
   HANDOFF PATH: ${context.handoffPath || 'handoff-snapshot.md in the change directory if needed'}
   SHOULD WRITE HANDOFF: ${shouldWriteHandoff}

   Write trust-checkpoint.md with this minimum table:
   | Field | Value |
   |-------|-------|
   | Change | ${context.changeId} |
   | Intent Match | ${checkpoint.intentMatch} |
   | Evidence Credibility | ${checkpoint.evidenceCredibility} |
   | Risk Routing Review | ${checkpoint.riskRoutingReview} |
   | Debt/Fallback Visibility | ${checkpoint.debtFallbackVisibility} |
   | Recommended Next | ${checkpoint.recommendedNext} |

   Include must-read decisions, evidence gaps, risk misclassifications, pending
   user decisions, and next safest action rationale.

   If handoff is requested, write handoff-snapshot.md with current intent,
   boundary/non-goals, ledger summary, pending high-risk decisions, proof
   signals passed/failed/missing, drift events, debt/fallback, and next safest
   action.

   Do NOT write archive.md. Do NOT move the change directory.`,
  { label: 'write-trust-checkpoint', phase: 'Handoff', schema: WRITE_RESULT_SCHEMA },
)

let docsCheck = null
if (context.substrate === 'docs' && writeResult.checkpointWritten) {
  docsCheck = await agent(
    `Run docs substrate structural check for verify phase.

     Command:
     steadyspec check ${context.changeDir || args.changeDir || changeId} --phase verify --substrate docs

     If the command is unavailable in this runtime, return status="unavailable" and explain why.
     If it runs and fails, return status="fail" with the important error codes.
     If it passes, return status="pass".`,
    { label: 'docs-check-verify', phase: 'Handoff', schema: {
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
}

phase('Report')

log(`Trust checkpoint for ${context.changeId}:`)
log(`  intent: ${checkpoint.intentMatch}`)
log(`  evidence: ${checkpoint.evidenceCredibility}`)
log(`  risk routing: ${checkpoint.riskRoutingReview}`)
log(`  debt/fallback: ${checkpoint.debtFallbackVisibility}`)
log(`  recommended next: ${checkpoint.recommendedNext}`)
if ((checkpoint.mustReadDecisions || []).length) {
  log(`  must-read decisions: ${checkpoint.mustReadDecisions.length}`)
}
if ((checkpoint.evidenceGaps || []).length) {
  log(`  evidence gaps: ${checkpoint.evidenceGaps.length}`)
}
if (writeResult.checkpointWritten) {
  log(`  checkpoint: ${writeResult.checkpointPath || context.checkpointPath || 'trust-checkpoint.md'}`)
}
if (writeResult.handoffWritten) {
  log(`  handoff: ${writeResult.handoffPath || context.handoffPath || 'handoff-snapshot.md'}`)
}
if (docsCheck) {
  log(`  docs check verify: ${docsCheck.status}${docsCheck.summary ? ` - ${docsCheck.summary}` : ''}`)
}

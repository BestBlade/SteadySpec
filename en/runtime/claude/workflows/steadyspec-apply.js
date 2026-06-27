// SteadySpec apply-flow as deterministic Workflow script.
// Replaces agent-inferred orchestration with explicit per-slice loop,
// proof-gated execution, drift detection, and evidence recording.
//
// Invocation: /steadyspec:apply <change-id>
//
// args: { changeId: string, projectRoot: string, mode?: "auto"|"step-through"|"skip"|"verify", changeDir?: string }
//   - mode="verify": re-run proof signals for already-complete slices to verify they still pass

export const meta = {
  name: 'steadyspec-apply',
  description: 'SteadySpec apply verb as deterministic workflow — slice-by-slice implementation with proof-gated execution, drift detection, and evidence recording',
  phases: [
    { title: 'Gather', detail: 'Read proposal, evidence, and drift signals for the change' },
    { title: 'Slice', detail: 'Execute proof-gated implementation slices one at a time' },
    { title: 'Verify', detail: 'Re-run proof signals for already-complete slices (retroactive mode)' },
    { title: 'Refactor', detail: 'Consolidate code across slices after all proofs pass (TDD discipline #4)' },
    { title: 'Evidence', detail: 'Record evidence and handle drift per slice' },
    { title: 'Report', detail: 'Compose apply report with slices, drift events, and next action' },
  ],
}

// === Schemas ===

const CHANGE_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    changeId: { type: 'string' },
    proposalPath: { type: 'string' },
    evidencePath: { type: 'string' },
    tasksPath: { type: 'string' },
    specsDir: { type: 'string' },
    designPath: { type: 'string' },
    substrateType: { type: 'string', enum: ['openspec', 'docs', 'meta', 'custom', 'none'] },
    intent: { type: 'string' },
    boundary: {
      type: 'object',
      properties: {
        inScope: { type: 'array', items: { type: 'string' } },
        outOfScope: { type: 'array', items: { type: 'string' } },
      },
    },
    nonGoals: { type: 'array', items: { type: 'string' } },
    evidenceRequired: { type: 'array', items: { type: 'string' } },
    stopConditions: { type: 'array', items: { type: 'string' } },
    slices: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          index: { type: 'number' },
          behavior: { type: 'string' },
          status: { type: 'string', enum: ['pending', 'in-progress', 'complete', 'skipped', 'reverted'] },
          proofSignal: { type: 'string' },
          proofResult: { type: 'string', enum: ['pass', 'fail', 'fallback', 'blocked', ''] },
          coverageLimit: { type: 'string' },
          evidenceRecorded: { type: 'boolean' },
        },
        required: ['index', 'behavior', 'status'],
      },
    },
    priorDriftEvents: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          slice: { type: 'number' },
          type: { type: 'string' },
          action: { type: 'string' },
          timestamp: { type: 'string' },
        },
      },
    },
  },
  required: ['changeId', 'intent', 'slices'],
}

const SLICE_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    sliceIndex: { type: 'number' },
    behavior: { type: 'string' },
    proofSignal: { type: 'string' },
    proofCommand: { type: 'string' },
    proofResult: { type: 'string', enum: ['pass', 'fail', 'drift', 'fallback', 'blocked'] },
    outputSummary: { type: 'string' },
    coverageLimit: { type: 'string' },
    fallback: { type: 'string' },
    acceptedDebt: { type: 'string' },
    linkedDecisionIds: { type: 'array', items: { type: 'string' } },
    reSliceNeeded: { type: 'boolean' },
    reSliceType: { type: 'string', enum: ['proposal-gap', 'implementation-discovery', 'proof-split', 'user-override', ''] },
    reSliceImpact: { type: 'string' },
    reSliceRiskLevel: { type: 'string', enum: ['low', 'medium', 'high', ''] },
    reSliceOwner: { type: 'string', enum: ['agent', 'user', 'shared', ''] },
    driftDetected: { type: 'boolean' },
    driftDetail: { type: 'string' },
    driftOption: { type: 'string', enum: ['patch-intent', 'accept-limitation', 'revert-slice', 'stop', ''] },
  },
  required: ['sliceIndex', 'proofSignal', 'proofResult'],
}

const EVIDENCE_ENTRY_SCHEMA = {
  type: 'object',
  properties: {
    proofCommand: { type: 'string' },
    result: { type: 'string', enum: ['pass', 'fail', 'drift', 'fallback', 'blocked'] },
    outputSummary: { type: 'string' },
    coverageLimit: { type: 'string' },
    fallback: { type: 'string' },
    acceptedDebt: { type: 'string' },
    linkedDecisionIds: { type: 'string' },
  },
  required: ['proofCommand', 'result', 'outputSummary', 'coverageLimit', 'fallback', 'acceptedDebt', 'linkedDecisionIds'],
}

const EVIDENCE_PATH_CHECK_SCHEMA = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    resolvedPath: { type: 'string' },
    parentCreatable: { type: 'boolean' },
    crossChangeConflict: { type: 'boolean' },
    reason: { type: 'string' },
  },
  required: ['valid', 'resolvedPath', 'parentCreatable', 'crossChangeConflict', 'reason'],
}

const DRIFT_PATCH_SCHEMA = {
  type: 'object',
  properties: {
    valid: { type: 'boolean' },
    reason: { type: 'string' },
    patchType: { type: 'string', enum: ['expansion', 'forbidden-narrow', 'forbidden-remove'] },
    affectedField: { type: 'string' },
    beforeValue: { type: 'string' },
    afterValue: { type: 'string' },
  },
  required: ['valid', 'reason'],
}

// === Helpers ===

function detectDrift(proofResult, sliceImpl, proposal) {
  // Drift = FAIL because intent/boundary/validation was wrong, not because impl is incomplete
  if (proofResult !== 'fail') return false

  // Check against stop conditions
  for (const cond of proposal.stopConditions || []) {
    if (sliceImpl.toLowerCase().includes(cond.toLowerCase())) return true
  }

  // Check if implementation touched out-of-scope areas
  for (const outItem of proposal.boundary?.outOfScope || []) {
    if (sliceImpl.toLowerCase().includes(outItem.toLowerCase())) return true
  }

  return false
}

function migrateEvidenceFormat(evidenceContent) {
  if (!evidenceContent) {
    return { format: 'absent', migrated: false, notes: ['No prior evidence.md content supplied.'] }
  }
  if (evidenceContent.includes('| Field | Value |')) {
    return { format: 'table', migrated: false, notes: ['Evidence already uses table format.'] }
  }
  return {
    format: 'legacy-freeform',
    migrated: true,
    notes: ['Extract what can be extracted; mark missing structured fields as evidence-migration-unavailable.'],
  }
}

function tableEscape(value) {
  return String(value || 'None').replace(/\|/g, '\\|').replace(/\r?\n/g, '<br>')
}

function renderEvidenceEntry(entry) {
  return `## Slice ${entry.sliceIndex}: ${entry.behavior}

| Field | Value |
|-------|-------|
| Proof Command | ${tableEscape(entry.proofCommand)} |
| Result | ${tableEscape(entry.result)} |
| Output Summary | ${tableEscape(entry.outputSummary)} |
| Coverage Limit | ${tableEscape(entry.coverageLimit)} |
| Linked Decisions | ${tableEscape(entry.linkedDecisionIds)} |
| Fallback | ${tableEscape(entry.fallback)} |
| Accepted Debt | ${tableEscape(entry.acceptedDebt)} |
`
}

function validateEvidenceEntry(entry) {
  return EVIDENCE_ENTRY_SCHEMA.required.every(field => typeof entry[field] === 'string' && entry[field].length > 0)
    && EVIDENCE_ENTRY_SCHEMA.properties.result.enum.includes(entry.result)
}

function evidenceTableLooksValid(content) {
  const rowCount = (content.match(/^\| .* \| .* \|$/gm) || []).length
  return content.includes('| Field | Value |') && rowCount >= 7
}

// === Main ===

const changeId = args.changeId || null
const root = args.projectRoot || '.'

if (!changeId) {
  log('ERROR: changeId is required. Pass args.changeId (e.g. "099-unify-session-timeout").')
  return { error: 'missing-change-id', help: 'Provide the change ID to apply.' }
}

log(`Change ID: ${changeId}`)

// ─── PHASE: Gather ───
phase('Gather')

const explicitChangeDir = args.changeDir || null
const evidenceMigration = migrateEvidenceFormat(null)

const context = await agent(
  `Read the change context for "${changeId}" at ${root}.

   Legacy evidence migration rule from ARTIFACT_CONTRACT.md:
   ${JSON.stringify(evidenceMigration)}
   If evidence.md lacks "| Field | Value |", treat it as legacy free-form
   evidence. Preserve the source and mark unavailable fields as
   "evidence-migration-unavailable".

   1. Locate the change directory (priority order):
      ${explicitChangeDir ? `a) USE "${explicitChangeDir}/${changeId}/". Skip substrate detection.` : `a) No explicit changeDir provided.`}
      b) Read .steadyspec/substrate.json for recorded changeDir.
      c) Auto-detect: check openspec/changes/${changeId}/, docs/changes/${changeId}/, .meta/changes/${changeId}/.
      Use the first one that exists and contains proposal.md.

   2. Read proposal.md — extract intent, boundary (in scope / out of scope), non-goals, evidence required, stop conditions.

   3. Read evidence.md if it exists — extract prior completed slices, drift events, accepted debt, fallback.

   4. Determine the primary slice source (priority order):
      a) IF tasks.md exists in the change directory: parse its task groups as slices.
         Each ## heading group = one slice. Each "- [ ] item" = a subtask within that slice.
         tasks.md is the authoritative work plan when present — use it even if proposal.md also lists tasks.
      b) ELSE IF proposal.md defines implementation tasks: parse them as slices.
      c) ELSE: derive slices from the evidence required list — each evidence item = one slice.

   5. IF specs/ directory exists in the change directory: read each spec-*.md file.
      Map each spec to its corresponding slice by topic/keyword match.
      Attach the spec's requirements and acceptance criteria to the slice as verification context.

   6. IF design.md exists: extract architecture constraints, key decisions, and risks.
      These constrain ALL slices — violations of design.md decisions are drift events.

   7. Record the substrate type: "openspec" if openspec/changes/ is the parent, "docs" if docs/changes/, "meta" if .meta/changes/, "custom" if explicit changeDir was provided, "none" if no substrate.

   8. Mark each slice's status: "complete" if evidence exists for it, "in-progress" if evidence is partial, "pending" otherwise.

   9. List prior drift events from evidence.md (timestamp, slice, type, action taken).`,
  { label: 'gather-context', phase: 'Gather', schema: CHANGE_CONTEXT_SCHEMA }
)

if (!context) {
  return { error: 'context-gather-failed', changeId }
}

log(`Intent: ${context.intent}`)
log(`Slices: ${context.slices.length} total, ${context.slices.filter(s => s.status === 'complete').length} complete, ${context.slices.filter(s => s.status === 'pending').length} pending`)

// ─── PHASE: Slice ───
// Process pending slices one at a time (TDD discipline: one behavior → one proof → one implementation)
phase('Slice')

const pendingSlices = context.slices.filter(s => s.status === 'pending' || s.status === 'in-progress')
const sliceResults = []
const driftEvents = [...(context.priorDriftEvents || [])]
const reSliceEvents = []
let stopRequested = false

for (let i = 0; i < pendingSlices.length && !stopRequested; i++) {
  const slice = pendingSlices[i]
  log(`--- Slice ${slice.index}: ${slice.behavior} ---`)

  // Step 1: Define the proof signal
  const proofDef = await agent(
    `Define the proof signal for this slice BEFORE writing any code.

     CHANGE INTENT: ${context.intent}
     BOUNDARY: in scope [${(context.boundary?.inScope || []).join(', ')}] / out of scope [${(context.boundary?.outOfScope || []).join(', ')}]
     NON-GOALS: ${(context.nonGoals || []).join(', ')}
     SLICE BEHAVIOR: ${slice.behavior}
     EVIDENCE REQUIRED (overall): ${(context.evidenceRequired || []).join('; ')}
     ${slice.specRef ? `SPEC REFERENCE: ${slice.specRef}` : ''}
     ${slice.acceptanceCriteria ? `ACCEPTANCE CRITERIA (from spec): ${JSON.stringify(slice.acceptanceCriteria)}` : ''}
     ${context.designPath ? `DESIGN CONSTRAINTS (from design.md): must not violate architecture decisions or key constraints recorded in design.md.` : ''}

     Define in writing:
     1. What exact proof signal will demonstrate this slice's behavior is met (test command, runtime check, fixture replay, manual check steps).
        ${slice.acceptanceCriteria ? 'The proof MUST verify each acceptance criterion from the spec. Map each criterion to a concrete check.' : ''}
     2. The coverage limit — what this proof does NOT prove.
     3. The expected RED state (proof fails before implementation) and GREEN state (proof passes after).`,
    { label: `slice-${slice.index}-define`, phase: 'Slice', schema: {
      type: 'object',
      properties: {
        proofSignal: { type: 'string' },
        proofCommand: { type: 'string' },
        coverageLimit: { type: 'string' },
        expectedRed: { type: 'string' },
        expectedGreen: { type: 'string' },
      },
      required: ['proofSignal', 'proofCommand', 'coverageLimit'],
    }}
  )

  if (!proofDef) {
    log(`Slice ${slice.index}: proof definition failed — skipping`)
    sliceResults.push({ sliceIndex: slice.index, behavior: slice.behavior, proofResult: 'blocked', outputSummary: 'Proof definition failed' })
    continue
  }

  log(`Proof: ${proofDef.proofSignal} (limit: ${proofDef.coverageLimit})`)

  // Step 2: RED — run proof BEFORE any code change to confirm it fails
  const redCheck = await agent(
    `Run the proof signal BEFORE making any code changes. The proof MUST fail — this is the RED state.

     PROOF COMMAND: ${proofDef.proofCommand}
     EXPECTED RED STATE: ${proofDef.expectedRed || 'Proof should fail because the implementation does not exist yet.'}

     Execute the proof command exactly as written. Do NOT modify any source files.
     Report: (1) whether the proof ran, (2) actual output, (3) whether it was RED (failed) as expected.

     If the proof PASSES unexpectedly (no RED), this means the behavior already exists or the proof is mis-specified. Report this as a signal that the slice may be redundant or mis-scoped.`,
    { label: `slice-${slice.index}-red`, phase: 'Slice', schema: {
      type: 'object',
      properties: {
        proofRan: { type: 'boolean' },
        actualOutput: { type: 'string' },
        wasRed: { type: 'boolean' },
        redDetail: { type: 'string' },
        unexpectedPass: { type: 'boolean' },
      },
      required: ['proofRan', 'wasRed'],
    }}
  )

  if (!redCheck) {
    log(`Slice ${slice.index}: RED check failed to execute — skipping`)
    sliceResults.push({ sliceIndex: slice.index, behavior: slice.behavior, proofResult: 'blocked', outputSummary: 'RED check failed' })
    continue
  }

  if (redCheck.unexpectedPass) {
    log(`Slice ${slice.index}: unexpected GREEN — proof passed before implementation. Behavior may already exist or proof is mis-specified.`)
  } else if (!redCheck.wasRed) {
    log(`Slice ${slice.index}: RED check inconclusive — proceeding with implementation`)
  } else {
    log(`Slice ${slice.index}: RED confirmed — ${redCheck.redDetail}`)
  }

  // Step 3: Implement — smallest code change → run proof → GREEN
  const impl = await agent(
    `IMPLEMENT the smallest code change to make this proof pass.

     CHANGE INTENT: ${context.intent}
     BOUNDARY (DO NOT EXCEED): in scope [${(context.boundary?.inScope || []).join(', ')}]
     OUT OF SCOPE (DO NOT TOUCH): [${(context.boundary?.outOfScope || []).join(', ')}]
     SLICE BEHAVIOR: ${slice.behavior}
     PROOF SIGNAL: ${proofDef.proofSignal}
     PROOF COMMAND: ${proofDef.proofCommand}
     COVERAGE LIMIT: ${proofDef.coverageLimit}
     EXPECTED GREEN: ${proofDef.expectedGreen || 'Proof passes after implementation.'}
     RED CHECK OUTPUT: ${redCheck.actualOutput || 'not available'}
     STOP CONDITIONS: ${(context.stopConditions || []).join('; ')}
     ${context.designPath ? `DESIGN CONSTRAINTS: Read design.md at the change directory. Do NOT violate architecture decisions, key constraints, or trade-offs recorded there. A violation of design.md is a drift event.` : ''}

     RULES:
     1. Write the MINIMAL code change — keep this slice review-sized.
     2. Do NOT refactor. The RED is already confirmed — get to GREEN first.
     3. Do NOT anticipate the next slice.
     4. Do NOT touch out-of-scope areas.
     5. If the implementation reveals the intent/boundary was wrong, report it as drift.
     6. Link the proof to decision ledger ids when proposal.md contains a ledger.
     7. If the original slice shape needs to change, report reSliceNeeded=true with:
        proposal-gap, implementation-discovery, proof-split, or user-override.
        If re-slicing changes scope, proof strategy, or user-visible outcome,
        set reSliceRiskLevel="high" and reSliceOwner="user".

     After implementing, run the proof command. If GREEN: report pass.
     If still RED: iterate within this slice (do not move to next slice).
     If the proof command cannot reach GREEN without violating the boundary: report as drift.`,
    { label: `slice-${slice.index}-implement`, phase: 'Slice', schema: SLICE_RESULT_SCHEMA }
  )

  if (!impl) {
    log(`Slice ${slice.index}: implementation agent failed`)
    sliceResults.push({ sliceIndex: slice.index, behavior: slice.behavior, proofResult: 'blocked', outputSummary: 'Implementation agent failed' })
    continue
  }

  // Step 3: Handle result
  if (impl.driftDetected) {
    log(`DRIFT DETECTED in slice ${slice.index}: ${impl.driftDetail}`)

    // Classify the drift patch validity
    const driftClassification = await agent(
      `Classify this drift event for patch validity.

       DRIFT DETAIL: ${impl.driftDetail}
       CURRENT INTENT: ${context.intent}
       CURRENT BOUNDARY IN SCOPE: ${(context.boundary?.inScope || []).join(', ')}
       CURRENT BOUNDARY OUT OF SCOPE: ${(context.boundary?.outOfScope || []).join(', ')}

       Classify what kind of patch would be needed:
       - "expansion": adding a file/layer to boundary, adding a non-goal, adding a stop condition, adding evidence — these are VALID patches
       - "forbidden-narrow": narrowing boundary to exclude a previously promised user-facing capability — FORBIDDEN
       - "forbidden-remove": removing a promised behavior or deleting an evidence requirement — FORBIDDEN

       If the needed change is forbidden-narrow or forbidden-remove, recommend STOP (option iv).`,
      { label: `slice-${slice.index}-drift-classify`, phase: 'Slice', schema: DRIFT_PATCH_SCHEMA }
    )

    const driftEvent = {
      slice: slice.index,
      type: driftClassification?.patchType || 'unknown',
      detail: impl.driftDetail,
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    }

    if (!driftClassification || driftClassification.patchType === 'forbidden-narrow' || driftClassification.patchType === 'forbidden-remove') {
      driftEvent.action = 'STOP — drift too large to patch. Open new change via /steadyspec:propose.'
      driftEvents.push(driftEvent)
      stopRequested = true
      log(`STOP: ${driftEvent.action}`)
    } else {
      // Expansion — valid patch
      driftEvent.action = `patch-intent: ${driftClassification.affectedField} changed from "${driftClassification.beforeValue}" to "${driftClassification.afterValue}"`
      driftEvents.push(driftEvent)
      log(`PATCH: ${driftEvent.action}`)
    }
  }

  if (impl.reSliceNeeded) {
    const reSliceEvent = {
      slice: slice.index,
      type: impl.reSliceType || 'implementation-discovery',
      impact: impl.reSliceImpact || 'No impact detail recorded.',
      riskLevel: impl.reSliceRiskLevel || 'medium',
      owner: impl.reSliceOwner || 'shared',
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    }
    reSliceEvents.push(reSliceEvent)
    log(`RE-SLICE EVENT in slice ${slice.index}: ${reSliceEvent.type} (${reSliceEvent.riskLevel}/${reSliceEvent.owner})`)
    if (reSliceEvent.riskLevel === 'high' || reSliceEvent.owner === 'user') {
      stopRequested = true
      log('STOP: re-slice changes scope/proof/user-visible outcome and requires user ownership.')
    }
  }

  // Record result
  sliceResults.push({
    sliceIndex: slice.index,
    behavior: slice.behavior,
    proofSignal: proofDef.proofSignal,
    proofCommand: impl.proofCommand || proofDef.proofCommand,
    proofResult: impl.proofResult,
    outputSummary: impl.outputSummary || '',
    coverageLimit: impl.coverageLimit || proofDef.coverageLimit,
    fallback: impl.fallback || '',
    acceptedDebt: impl.acceptedDebt || '',
    linkedDecisionIds: impl.linkedDecisionIds || [],
    reSliceNeeded: impl.reSliceNeeded || false,
    driftDetected: impl.driftDetected || false,
  })

  log(`Slice ${slice.index} result: ${impl.proofResult}${impl.driftDetected ? ' (drift)' : ''}`)
}

// ─── PHASE: Verify (retroactive mode) ───
// When slices are already complete before invocation, re-run each proof signal
// to verify they still pass. Exercises the proof→verify path without requiring
// new implementation. Triggered by mode="verify" or auto-detected when all
// slices are complete and there are no pending slices.
const completedSlices = context.slices.filter(s => s.status === 'complete')
const shouldVerify = args.mode === 'verify' || (pendingSlices.length === 0 && completedSlices.length > 0)

if (shouldVerify && completedSlices.length > 0) {
  phase('Verify')

  log(`Verify mode: re-running proof signals for ${completedSlices.length} completed slice(s)`)

  const verifyResults = []

  for (const slice of completedSlices) {
    log(`--- Verify Slice ${slice.index}: ${slice.behavior} ---`)

    const proofCommand = slice.proofSignal || null

    const verifyResult = await agent(
      `Verify that slice ${slice.index} ("${slice.behavior}") still passes.

       CHANGE INTENT: ${context.intent}
       ORIGINAL PROOF SIGNAL: ${proofCommand || 'not recorded — will need to infer from evidence'}
       SLICE STATUS: ${slice.status}
       ${slice.proofResult ? `ORIGINAL RESULT: ${slice.proofResult}` : ''}

       TASK:
       1. If a proof command is recorded, re-run it.
       2. If no proof command is recorded, infer a reasonable check from the slice behavior
          and the evidence requirements: ${(context.evidenceRequired || []).join('; ')}
       3. Report whether the slice still passes, has regressed, or cannot be verified.
       4. Do NOT make any code changes — this is verification only.`,
      { label: `verify-slice-${slice.index}`, phase: 'Verify', schema: {
        type: 'object',
        properties: {
          sliceIndex: { type: 'number' },
          behavior: { type: 'string' },
          proofCommand: { type: 'string' },
          verificationResult: { type: 'string', enum: ['still-passing', 'regression', 'unable-to-verify'] },
          outputSummary: { type: 'string' },
          notes: { type: 'string' },
        },
        required: ['sliceIndex', 'verificationResult'],
      }}
    )

    if (verifyResult) {
      verifyResults.push(verifyResult)
      log(`  Verify result: ${verifyResult.verificationResult}`)
    } else {
      verifyResults.push({ sliceIndex: slice.index, verificationResult: 'unable-to-verify', notes: 'Verification agent failed' })
    }
  }

  // Record verify results alongside regular slice results
  const regressions = verifyResults.filter(r => r.verificationResult === 'regression')
  if (regressions.length > 0) {
    log(`VERIFY: ${regressions.length} regression(s) detected — see report`)
  } else {
    const passing = verifyResults.filter(r => r.verificationResult === 'still-passing').length
    log(`Verify: ${passing}/${verifyResults.length} still passing`)
  }
}

// ─── PHASE: Refactor (only after all slices pass) ───
// Per TDD discipline #4: refactor only after all slices in this change have passed.
const allSlicesPassed = pendingSlices.length > 0 && sliceResults.filter(s => s.proofResult !== 'pass').length === 0 && !stopRequested

if (allSlicesPassed) {
  phase('Refactor')

  log('All slices passed — running refactor pass (TDD discipline #4)')
  log('Rules: consolidate duplicated code, clean up naming, do NOT change behavior.')

  // Collect all changed files from this change
  const refactorResult = await agent(
    `Run a refactor pass across ALL code changed in this invocation.

     CHANGE INTENT: ${context.intent}
     SLICES COMPLETED: ${sliceResults.map(s => `${s.behavior} (${s.proofResult})`).join(', ')}

     TDD DISCIPLINE #4: Refactor only after all slices have passed.
     - Consolidate any duplicated code introduced across slices.
     - Clean up naming, extract shared helpers, remove dead code.
     - Do NOT change behavior — all proof signals must still pass after refactoring.
     - Do NOT touch out-of-scope areas.
     - Do NOT introduce new dependencies or architectural changes.

     After refactoring, re-run ALL proof commands from the completed slices.
     If any proof fails after refactoring: revert the offending refactor and report which proof broke.`,
    { label: 'refactor', phase: 'Refactor', schema: {
      type: 'object',
      properties: {
        refactored: { type: 'boolean' },
        changes: { type: 'array', items: { type: 'string' } },
        proofsRerun: { type: 'number' },
        proofsStillPassing: { type: 'number' },
        reverted: { type: 'boolean' },
        revertedReason: { type: 'string' },
      },
      required: ['refactored', 'proofsRerun', 'proofsStillPassing'],
    }}
  )

  if (refactorResult) {
    const completedSliceCount = sliceResults.length
    const refactorProofsValid = refactorResult.proofsRerun >= completedSliceCount
      && refactorResult.proofsStillPassing === refactorResult.proofsRerun

    if (!refactorProofsValid) {
      log('Refactor proof signals failed - reverting refactor phase.')
      const revertResult = await agent(
        `Revert only the refactor-phase changes from this invocation.

         Reason: structural proof validation failed.
         Required proofs rerun: at least ${completedSliceCount}
         Actual proofs rerun: ${refactorResult.proofsRerun}
         Proofs still passing: ${refactorResult.proofsStillPassing}

         Do not revert slice implementation changes. Only undo behavior-neutral
         refactor edits made during the Refactor phase.`,
        { label: 'refactor-auto-revert', phase: 'Refactor', schema: {
          type: 'object',
          properties: {
            reverted: { type: 'boolean' },
            revertedReason: { type: 'string' },
          },
          required: ['reverted', 'revertedReason'],
        }}
      )
      refactorResult.reverted = true
      refactorResult.revertedReason = revertResult?.revertedReason || 'proof-rerun-validation-failed'
    }
    if (refactorResult.reverted) {
      log(`Refactor partially reverted: ${refactorResult.revertedReason}`)
    }
    log(`Refactor complete: ${refactorResult.proofsStillPassing}/${refactorResult.proofsRerun} proofs still passing`)
  }
}

// ─── PHASE: Evidence ───
phase('Evidence')

// Compose evidence entries for all completed slices in this invocation
const newEvidenceEntries = sliceResults.filter(s => s.proofResult === 'pass' || s.proofResult === 'fallback')
const evidenceEntries = newEvidenceEntries.map(s => ({
  sliceIndex: s.sliceIndex,
  behavior: s.behavior,
  proofCommand: s.proofCommand || s.proofSignal || 'evidence-migration-unavailable',
  result: s.proofResult,
  outputSummary: s.outputSummary || 'No output summary recorded.',
  coverageLimit: s.coverageLimit || 'evidence-migration-unavailable',
  fallback: s.fallback || 'None',
  acceptedDebt: s.acceptedDebt || 'None',
  linkedDecisionIds: (s.linkedDecisionIds || []).join(', ') || 'None',
}))
const evidenceFormatValidated = evidenceEntries.every(validateEvidenceEntry)
const evidenceOverallStatus = stopRequested
  ? 'stopped-drift'
  : (sliceResults.some(s => s.proofResult === 'blocked' || s.proofResult === 'fail' || s.proofResult === 'drift') ? 'partial' : 'all-passed')
const evidenceMd = evidenceEntries.length > 0 ? {
  evidenceMd: `# Evidence Record: ${changeId}

schemaVersion: 1

## Decision Provenance

All slice proofs in this invocation were auto-verified by the workflow: RED was checked before implementation and GREEN was checked after implementation. No human confirmed these proof results during apply.

${evidenceEntries.map(renderEvidenceEntry).join('\n')}
## Drift Event Log

| Timestamp | Slice | Type | Action |
|-----------|-------|------|--------|
${driftEvents.length > 0 ? driftEvents.map(e => `| ${tableEscape(e.timestamp)} | ${tableEscape(e.slice)} | ${tableEscape(e.type)} | ${tableEscape(e.action || e.detail)} |`).join('\n') : '| None | None | None | No drift events recorded |'}

## Re-slice Event Log

| Timestamp | Slice | Type | Risk | Owner | Impact |
|-----------|-------|------|------|-------|--------|
${reSliceEvents.length > 0 ? reSliceEvents.map(e => `| ${tableEscape(e.timestamp)} | ${tableEscape(e.slice)} | ${tableEscape(e.type)} | ${tableEscape(e.riskLevel)} | ${tableEscape(e.owner)} | ${tableEscape(e.impact)} |`).join('\n') : '| None | None | None | None | None | No re-slice events recorded |'}

## Summary

- Total slices this invocation: ${sliceResults.length}
- Slices completed: ${evidenceEntries.filter(e => e.result === 'pass').length}
- Slices with fallback: ${evidenceEntries.filter(e => e.result === 'fallback').length}
- Drift events: ${driftEvents.length}
- Re-slice events: ${reSliceEvents.length}
- Overall status: ${evidenceOverallStatus}
`,
  slicesCompleted: evidenceEntries.filter(e => e.result === 'pass').length,
  slicesWithFallback: evidenceEntries.filter(e => e.result === 'fallback').length,
  driftEventCount: driftEvents.length,
  reSliceEventCount: reSliceEvents.length,
  overallStatus: evidenceOverallStatus,
  provenance: 'workflow-auto-verified',
  evidenceFormatValidated,
} : null
// Persist evidence.md to the change directory
let docsCheck = null
if (evidenceMd) {
  const evidencePath = `${context.proposalPath.replace(/\/proposal\.md$/, '')}/evidence.md`
  const evidencePathCheck = await agent(
    `Validate evidence write path before writing.

     Project root: ${root}
     Change directory: ${context.proposalPath.replace(/\/proposal\.md$/, '')}
     Evidence path: ${evidencePath}

     Checks:
     1. Normalize the path as if by path.resolve().
     2. Confirm it stays within the project root.
     3. Confirm the parent directory exists or is creatable.
     4. Detect whether another active change would write to the same evidence path.

     Do not write files. Return whether the path is safe.`,
    { label: 'validate-evidence-path', phase: 'Evidence', schema: EVIDENCE_PATH_CHECK_SCHEMA }
  )
  if (!evidenceMd.evidenceFormatValidated || !evidenceTableLooksValid(evidenceMd.evidenceMd)) {
    log('ERROR: evidence.md failed table-format validation; not writing evidence.')
  } else if (!evidencePathCheck?.valid || evidencePathCheck.crossChangeConflict || !evidencePathCheck.parentCreatable) {
    log(`ERROR: evidence path validation failed: ${evidencePathCheck?.reason || 'unknown'}`)
  } else {
  await agent(
    `Write the following content to ${evidencePath} using the Write tool. Do not modify the content — write it exactly as provided.

${evidenceMd.evidenceMd}`,
    { label: 'write-evidence', phase: 'Evidence' }
  )
  const diskEvidence = await agent(
    `Read ${evidencePath} from disk and return its exact markdown content after the write.`,
    { label: 'read-evidence-after-write', phase: 'Evidence', schema: {
      type: 'object',
      properties: {
        evidenceMd: { type: 'string' },
      },
      required: ['evidenceMd'],
    }}
  )
  if (diskEvidence?.evidenceMd) {
    evidenceMd.evidenceMd = diskEvidence.evidenceMd
  }
  log(`evidence.md written to ${evidencePath}`)
  if (context.substrateType === 'docs') {
    docsCheck = await agent(
      `Run docs substrate structural check for apply phase.

       Command:
       steadyspec check ${context.proposalPath.replace(/\/proposal\.md$/, '')} --phase apply --substrate docs

       If the command is unavailable in this runtime, return status="unavailable" and explain why.
       If it runs and fails, return status="fail" with the important error codes.
       If it passes, return status="pass".`,
      { label: 'docs-check-apply', phase: 'Evidence', schema: {
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
    log(`docs check apply: ${docsCheck?.status || 'unavailable'}${docsCheck?.summary ? ` - ${docsCheck.summary}` : ''}`)
  }
  }
}

// ─── PHASE: Report ───
phase('Report')

const completedThisRun = sliceResults.filter(s => s.proofResult === 'pass').length
const remainingCount = pendingSlices.length - sliceResults.length + sliceResults.filter(s => s.proofResult === 'pending' || s.proofResult === 'blocked').length

return {
  changeId,
  substrateLocation: context.proposalPath?.replace(/\/proposal\.md$/, '') || changeId,
  slicesCompletedThisInvocation: completedThisRun,
  slices: sliceResults.map(s => ({
    index: s.sliceIndex,
    behavior: s.behavior,
    proofResult: s.proofResult,
    fallback: s.fallback || null,
    linkedDecisionIds: s.linkedDecisionIds || [],
    reSliceNeeded: s.reSliceNeeded || false,
    drift: s.driftDetected || false,
  })),
  driftEvents: driftEvents.filter(e => !context.priorDriftEvents?.some(p => p.slice === e.slice && p.type === e.type)),
  reSliceEvents,
  evidenceMd: evidenceMd?.evidenceMd || null,
  evidenceSummary: evidenceMd ? {
    slicesCompleted: evidenceMd.slicesCompleted,
    slicesWithFallback: evidenceMd.slicesWithFallback,
    driftEventCount: evidenceMd.driftEventCount,
    reSliceEventCount: evidenceMd.reSliceEventCount,
    overallStatus: evidenceMd.overallStatus,
  } : null,
  docsCheck,
  remainingSlices: Math.max(0, remainingCount),
  recommendedNext: stopRequested
    ? `STOP — open new change via /steadyspec:propose <new-intent>`
    : docsCheck?.status === 'fail'
      ? `Fix docs check errors for ${changeId}, then re-run /steadyspec:apply or /steadyspec:verify.`
    : remainingCount > 0
      ? `Stay in apply for remaining ${remainingCount} slice(s)`
      : `/steadyspec:archive ${changeId}`,
}

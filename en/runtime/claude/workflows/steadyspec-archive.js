// SteadySpec archive-flow as deterministic Workflow script.
// Replaces agent-inferred orchestration with explicit 5-gate execution:
//   Gate 1: review-against-intent
//   Gate 2: doc-sync auto-scan (3 layers)
//   Gate 3: confirmed_by gate
//   Gate 4: completeness check
//   Gate 5: durable truth gates
//   Post-gates: rollup trigger → archive write
//
// Invocation: /steadyspec:archive <change-id>
//
// args: { changeId: string, projectRoot: string, thorough?: boolean, changeDir?: string }

export const meta = {
  name: 'steadyspec-archive',
  description: 'SteadySpec archive verb as deterministic workflow — 5-gate review with doc-sync scan, confirmed_by, completeness check, durable truth gates, rollup trigger, and archive write',
  phases: [
    { title: 'Gather', detail: 'Read change artifacts, git diff, and archive conventions' },
    { title: 'Gate1-Review', detail: 'Gate 1: review implementation against original intent' },
    { title: 'Gate2-DocSync', detail: 'Gate 2: scan docs for staleness, classify must-update/should-check' },
    { title: 'Gate3-Confirm', detail: 'Gate 3: confirmed_by gate for human-owned decisions' },
    { title: 'Gate4-Complete', detail: 'Gate 4: completeness check — all archive fields fillable' },
    { title: 'Gate5-DurableTruth', detail: 'Gate 5: citation anchors, risk misclassification, and fallback/debt truth' },
    { title: 'Rollup', detail: 'Cross-change pattern detection (≥3 of last 10)' },
    { title: 'Write', detail: 'Write archive.md and move to archive location' },
  ],
}

// === Schemas ===

const ARCHIVE_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    changeId: { type: 'string' },
    changeDir: { type: 'string' },
    archiveLocation: { type: 'string' },
    substrate: { type: 'string', enum: ['openspec', 'docs', 'meta', 'custom'] },
    proposalPath: { type: 'string' },
    evidencePath: { type: 'string' },
    intent: { type: 'string' },
    boundary: {
      type: 'object',
      properties: {
        inScope: { type: 'array', items: { type: 'string' } },
        outOfScope: { type: 'array', items: { type: 'string' } },
      },
    },
    evidenceRequired: { type: 'array', items: { type: 'string' } },
    changedFiles: { type: 'array', items: { type: 'string' } },
    hasHumanDecisionRecords: { type: 'boolean' },
    humanDecisionRecordPaths: { type: 'array', items: { type: 'string' } },
    hasEvidence: { type: 'boolean' },
    hasReview: { type: 'boolean' },
  },
  required: ['changeId', 'substrate', 'intent', 'changedFiles'],
}

const REVIEW_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          description: { type: 'string' },
          classification: { type: 'string', enum: ['pass', 'blocker', 'accepted-debt', 'doc-sync-required'] },
        },
        required: ['description', 'classification'],
      },
    },
    blockerCount: { type: 'number' },
    debtCount: { type: 'number' },
    docSyncRequiredCount: { type: 'number' },
    evidenceGaps: { type: 'array', items: { type: 'string' } },
    canProceed: { type: 'boolean' },
  },
  required: ['findings', 'blockerCount', 'canProceed'],
}

const DOC_SYNC_CANDIDATE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    confidence: { type: 'string', enum: ['must-update', 'should-check', 'unlikely'] },
    signal: { type: 'string' },
    updatedInChange: { type: 'boolean' },
  },
  required: ['path', 'confidence', 'updatedInChange'],
}

const DOC_SYNC_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    candidates: { type: 'array', items: DOC_SYNC_CANDIDATE_SCHEMA },
    mustUpdateNotUpdated: { type: 'array', items: { type: 'string' } },
    shouldCheckList: { type: 'array', items: { type: 'string' } },
    canProceed: { type: 'boolean' },
  },
  required: ['candidates', 'mustUpdateNotUpdated', 'canProceed'],
}

const SHOULD_CHECK_REVIEW_SCHEMA = {
  type: 'object',
  properties: {
    confirmations: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          doc: { type: 'string' },
          userConfirmedAccurate: { type: 'boolean' },
          needsUpdate: { type: 'boolean' },
          note: { type: 'string' },
        },
        required: ['doc', 'userConfirmedAccurate', 'needsUpdate'],
      },
    },
    canProceed: { type: 'boolean' },
  },
  required: ['confirmations', 'canProceed'],
}

const ROLLUP_RESULT_SCHEMA = {
  type: 'object',
  properties: {
    triggered: { type: 'boolean' },
    signals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          moduleOrKeyword: { type: 'string' },
          count: { type: 'number' },
          sourceChangeIds: { type: 'array', items: { type: 'string' } },
          recommendation: { type: 'string' },
        },
      },
    },
    digestPath: { type: 'string' },
  },
  required: ['triggered'],
}

const COMPLETENESS_SCHEMA = {
  type: 'object',
  properties: {
    canFillAllFields: { type: 'boolean' },
    missingSources: { type: 'array', items: { type: 'string' } },
    finalDecisions: { type: 'array', items: { type: 'string' } },
    rejectedAlternatives: { type: 'array', items: { type: 'string' } },
    acceptedDebt: { type: 'array', items: { type: 'string' } },
    fallback: { type: 'array', items: { type: 'string' } },
    followUp: { type: 'array', items: { type: 'string' } },
    driftEventSummary: { type: 'array', items: { type: 'string' } },
  },
  required: ['canFillAllFields', 'missingSources'],
}

const DURABLE_TRUTH_SCHEMA = {
  type: 'object',
  properties: {
    canProceed: { type: 'boolean' },
    missingAnchors: { type: 'array', items: { type: 'string' } },
    fallbackAsProofClaims: { type: 'array', items: { type: 'string' } },
    riskMisclassifications: { type: 'array', items: { type: 'string' } },
    docStalenessCandidates: { type: 'array', items: { type: 'string' } },
    notes: { type: 'string' },
  },
  required: ['canProceed', 'missingAnchors', 'fallbackAsProofClaims', 'riskMisclassifications', 'docStalenessCandidates'],
}

// === Helpers ===

const ALWAYS_CHECK_LIST = [
  'README.md',
  'CHANGELOG.md',
  'docs/',
  'openspec/specs/',
]

function migrateEvidenceFormat(evidenceContent) {
  if (!evidenceContent) {
    return { format: 'absent', migrated: false, notes: ['No evidence.md content supplied during archive gather.'] }
  }
  if (evidenceContent.includes('| Field | Value |')) {
    return { format: 'table', migrated: false, notes: ['Evidence already uses table format.'] }
  }
  return {
    format: 'legacy-freeform',
    migrated: true,
    notes: ['Treat missing structured fields as evidence-migration-unavailable.'],
  }
}

// === Main ===

const changeId = args.changeId || null
const root = args.projectRoot || '.'
const thorough = args.thorough || false

if (!changeId) {
  log('ERROR: changeId is required. Pass args.changeId (e.g. "099-unify-session-timeout").')
  return { error: 'missing-change-id', help: 'Provide the change ID to archive.' }
}

log(`Change ID: ${changeId}${thorough ? ' (thorough mode)' : ''}`)

// ─── PHASE: Gather ───
phase('Gather')

const explicitChangeDir = args.changeDir || null
const evidenceMigration = migrateEvidenceFormat(null)

const context = await agent(
  `Gather all artifacts and state for archiving change "${changeId}" at ${root}.

   Legacy evidence migration rule from ARTIFACT_CONTRACT.md:
   ${JSON.stringify(evidenceMigration)}
   If evidence.md lacks "| Field | Value |", treat it as legacy free-form
   evidence. Preserve the source and mark unavailable fields as
   "evidence-migration-unavailable".

   1. Locate the change directory (priority order):
      ${explicitChangeDir ? `a) USE "${explicitChangeDir}/${changeId}/". Set substrate="custom", changeDir="${explicitChangeDir}", archiveLocation="${explicitChangeDir}/archive/${changeId}/archive.md". Skip detection.` : `a) No explicit changeDir provided.`}
      b) Read .steadyspec/substrate.json for recorded changeDir.
      c) Auto-detect: check openspec/changes/${changeId}/, docs/changes/${changeId}/, .meta/changes/${changeId}/.
      Use the first one that exists and contains proposal.md.
   2. Read proposal.md — extract intent, boundary (in scope / out of scope), non-goals, evidence required, stop conditions.
   3. Read evidence.md — extract proof results, drift events, accepted debt, fallback.
   4. Run: git diff $(git log --format=%H -- ${changeId} | tail -1)..HEAD --name-only — get list of changed source files.
   5. Check for human-decision-record files linked to this change (grep for change ID in .steadyspec/ or the change directory).
   6. Determine archive location: <changeDir>/archive/${changeId}/ (for NNN-prefix) or <changeDir>/archive/<slug>/ (for meta). For simplicity, archive.md goes to <changeDir>/<changeId>/archive.md when the substrate keeps archives adjacent.`,
  { label: 'gather-context', phase: 'Gather', schema: ARCHIVE_CONTEXT_SCHEMA }
)

if (!context) {
  return { error: 'context-gather-failed', changeId }
}

log(`Substrate: ${context.substrate} | Changed files: ${context.changedFiles.length}`)
log(`Archive target: ${context.archiveLocation}`)

// ─── GATE 1: Review Against Intent ───
phase('Gate1-Review')

const review = await agent(
  `REVIEW implementation against original intent for change "${changeId}".

   === ORIGINAL INTENT ===
   ${context.intent}

   === BOUNDARY ===
   In scope: ${(context.boundary?.inScope || []).join(', ')}
   Out of scope: ${(context.boundary?.outOfScope || []).join(', ')}

   === EVIDENCE REQUIRED ===
   ${(context.evidenceRequired || []).join('; ')}

   === CHANGED FILES ===
   ${context.changedFiles.join('\n')}

   === EVIDENCE RECORD ===
   ${context.hasEvidence ? `(present at ${context.evidencePath})` : 'MISSING — no evidence record found'}

   CHECK:
   1. Promised behavior missing or partial
   2. Extra behavior or scope creep (changes touching out-of-scope areas)
   3. Evidence weaker than required
   4. Fallback mislabeled as proof
   5. Drift discovered but not written back to evidence
   6. Accepted debt missing follow-up

   Classify each finding as: pass, blocker, accepted-debt, or doc-sync-required.
   - BLOCKER: promised behavior missing, scope creep that breaks boundary, drift not recorded, evidence fabricated
   - ACCEPTED-DEBT: known limitation with owner, fallback path with follow-up
   - DOC-SYNC-REQUIRED: changed files whose docs need updating
   - PASS: everything else that matches intent, OR evidence that can only be satisfied by the archive workflow itself running to completion. Self-referential evidence (e.g. "E6: archive workflow passes all 4 gates") is PASS at Gate 1: the workflow IS the evidence being produced

   CRITICAL: review intent fit, NOT code style. Do not let passing tests hide missing promised behavior.
   Fallback is NOT full proof. Silent drift BLOCKS archive.`,
  { label: 'gate1-review', phase: 'Gate1-Review', schema: REVIEW_RESULT_SCHEMA }
)

if (!review) {
  log('GATE 1 FAILED: review agent could not complete')
  return { error: 'gate1-review-failed', changeId }
}

log(`Gate 1: ${review.blockerCount} blockers, ${review.debtCount} debt, ${review.docSyncRequiredCount} doc-sync-required`)

if (!review.canProceed || review.blockerCount > 0) {
  log(`GATE 1 STOP: ${review.blockerCount} blocker(s) found.`)
  for (const f of review.findings.filter(f => f.classification === 'blocker')) {
    log(`  BLOCKER: ${f.description}`)
  }
  return {
    changeId,
    gate: 1,
    status: 'blocked',
    reviewFindings: review.findings,
    recommendedNext: 'Address blockers before re-running /steadyspec:archive.',
  }
}

// ─── GATE 2: Doc-Sync Auto-Scan ───
phase('Gate2-DocSync')

log(`Gate 2: Scanning docs for staleness (${context.changedFiles.length} changed files)`)

const docSync = await agent(
  `Run a doc-sync auto-scan for change "${changeId}".

   === LAYER 1: Changed Files ===
   ${context.changedFiles.join('\n')}

   === LAYER 2a: Markdown Link References ===
   For each changed source file, grep the project (${root}) for markdown files that contain a link reference to that file path.
   This finds docs that explicitly reference the changed code.

   === LAYER 3: Always-Check Convention List ===
   Always check these regardless of link references:
   ${ALWAYS_CHECK_LIST.join(', ')}

   ${thorough ? `=== LAYER 2b (THOROUGH MODE): Identifier References ===
   For each changed source file, parse it for top-level declarations (functions, classes, exports, interfaces).
   Grep the project for markdown files referencing those identifiers.
   This is the expensive pass — run it because --thorough was specified.` : 'Layer 2b skipped (default mode). Pass --thorough to enable identifier-level scanning.'}

   For each candidate doc found:
   1. Check if it was already updated in this change's commits (search git diff for the doc path).
   2. Classify confidence:
      - "must-update": direct markdown link to the changed file, OR strong identifier match
      - "should-check": mentions related identifier, weaker signal
      - "unlikely": convention-only, no actual signal found

   Report: all candidates with confidence and update status, list of must-update-not-updated, list of should-check items.`,
  { label: 'gate2-docsync', phase: 'Gate2-DocSync', schema: DOC_SYNC_RESULT_SCHEMA }
)

if (!docSync) {
  log('GATE 2 FAILED: doc-sync scan could not complete')
  return { error: 'gate2-docsync-failed', changeId }
}

log(`Gate 2: ${docSync.candidates.length} candidates, ${docSync.mustUpdateNotUpdated.length} must-update not updated, ${docSync.shouldCheckList.length} should-check`)

if (docSync.mustUpdateNotUpdated.length > 0) {
  log(`GATE 2 STOP: ${docSync.mustUpdateNotUpdated.length} must-update doc(s) not updated.`)
  for (const doc of docSync.mustUpdateNotUpdated) {
    log(`  MUST-UPDATE: ${doc}`)
  }
  return {
    changeId,
    gate: 2,
    status: 'blocked',
    docSyncCandidates: docSync.candidates,
    mustUpdateNotUpdated: docSync.mustUpdateNotUpdated,
    recommendedNext: 'Update must-update docs (typically via an extra apply slice), then re-run /steadyspec:archive.',
  }
}

// Ask the user to confirm should-check docs; do not auto-determine accuracy.
if (docSync.shouldCheckList.length > 0) {
  log(`Gate 2: ${docSync.shouldCheckList.length} should-check doc(s) require user confirmation`)
  const shouldCheckReview = await agent(
    `PRESENT TO USER: The following should-check documents were identified for change "${changeId}".

     For each row, ask the user: "Is [doc path] still accurate given this change?"
     Present all rows as one table. Do NOT auto-determine accuracy.

     Should-check docs:
     ${docSync.shouldCheckList.map((doc, i) => `${i + 1}. ${doc}`).join('\n')}

     Changed files:
     ${(context.changedFiles || []).join('\n')}

     Return one confirmation object per doc. If the user says any doc is not
     accurate, set needsUpdate=true and canProceed=false.`,
    { label: 'gate2-shouldcheck-user-table', phase: 'Gate2-DocSync', schema: SHOULD_CHECK_REVIEW_SCHEMA }
  )

  if (!shouldCheckReview?.canProceed || shouldCheckReview.confirmations.some(c => c.needsUpdate)) {
    const needsUpdate = (shouldCheckReview?.confirmations || []).filter(c => c.needsUpdate).map(c => c.doc)
    docSync.mustUpdateNotUpdated.push(...needsUpdate)
    log(`GATE 2 STOP: ${needsUpdate.length} should-check doc(s) need updates after user review.`)
    return {
      changeId,
      gate: 2,
      status: 'blocked',
      docSyncCandidates: docSync.candidates,
      mustUpdateNotUpdated: docSync.mustUpdateNotUpdated,
      shouldCheckNeedsUpdate: needsUpdate,
      recommendedNext: 'Update docs flagged by user review, then re-run /steadyspec:archive.',
    }
  }
}

phase('Gate3-Confirm')

let confirmedByPassed = true
const unconfirmedDecisions = []

if (context.hasHumanDecisionRecords) {
  const confirmedCheck = await agent(
    `Check confirmed_by status for human decision records linked to change "${changeId}".

     Decision record paths: ${(context.humanDecisionRecordPaths || []).join(', ')}

     For each record:
     1. Read the file.
     2. Check if it contains "confirmed_by:" followed by a human name/identifier.
     3. If "confirmed_by:" is missing or empty, flag as unconfirmed.

     Report which records have confirmed_by and which are missing it.`,
    { label: 'gate3-confirm', phase: 'Gate3-Confirm', schema: {
      type: 'object',
      properties: {
        confirmed: { type: 'array', items: { type: 'string' } },
        unconfirmed: { type: 'array', items: { type: 'string' } },
      },
      required: ['confirmed', 'unconfirmed'],
    }}
  )

  if (confirmedCheck?.unconfirmed?.length > 0) {
    confirmedByPassed = false
    unconfirmedDecisions.push(...confirmedCheck.unconfirmed)
    log(`GATE 3 STOP: ${unconfirmedDecisions.length} decision(s) lack confirmed_by.`)
    for (const d of unconfirmedDecisions) {
      log(`  UNCONFIRMED: ${d}`)
    }
  } else {
    log(`Gate 3: ${confirmedCheck?.confirmed?.length || 0} decision(s) confirmed.`)
  }
} else {
  log('Gate 3: No human decision records linked — gate passes by non-applicability.')
}

if (!confirmedByPassed) {
  return {
    changeId,
    gate: 3,
    status: 'blocked',
    unconfirmedDecisions,
    recommendedNext: 'Confirm each unconfirmed decision, then re-run /steadyspec:archive.',
  }
}

// ─── GATE 4: Completeness Check ───
phase('Gate4-Complete')

const completeness = await agent(
  `Verify that all archive.md fields can be filled from real artifacts for change "${changeId}".

   === AVAILABLE ARTIFACTS ===
   - Proposal: ${context.proposalPath} ${context.proposalPath ? '(present)' : '(MISSING)'}
   - Evidence: ${context.evidencePath} ${context.hasEvidence ? '(present)' : '(MISSING)'}
   - Review findings: ${JSON.stringify(review?.findings || [])}
   - Doc-sync candidates: ${JSON.stringify(docSync?.candidates || [])}
   - Human decision records: ${context.humanDecisionRecordPaths?.join(', ') || 'none'}

   Archive.md requires these fields:
   1. Final decisions (source: proposal + grill + debate findings)
   2. Preserved rejected alternatives (source: debate findings or grill parked concerns)
   3. Accepted debt + follow-up (source: evidence.md + review findings)
   4. Fallback, if any (source: evidence.md)
   5. Human-decision-record links (source: Gate 3)
   6. Drift events from evidence (source: evidence.md)
   7. Strategy-rollup link, if rollup runs (source: Gate 5 rollup)

   For each field, determine: can we fill it from a real source?
   Only add to missingSources if a field SHOULD have content but the source is absent. Fields legitimately empty (no debate, no debt, no drift) are valid with "None" as the entry.
   Do NOT create partial archives. Do NOT fill fields with placeholder text.`,
  { label: 'gate4-complete', phase: 'Gate4-Complete', schema: COMPLETENESS_SCHEMA }
)

if (!completeness) {
  log('GATE 4 FAILED: completeness check could not complete')
  return { error: 'gate4-completeness-failed', changeId }
}

log(`Gate 4: ${completeness.canFillAllFields ? 'PASSED' : 'FAILED — ' + completeness.missingSources.length + ' fields missing sources'}`)

if (!completeness.canFillAllFields) {
  log(`GATE 4 STOP: missing sources for: ${completeness.missingSources.join(', ')}`)
  return {
    changeId,
    gate: 4,
    status: 'blocked',
    missingSources: completeness.missingSources,
    recommendedNext: 'Fill missing sources before re-running /steadyspec:archive. Partial archives are NOT created by archive-flow.',
  }
}

// ─── Rollup Trigger Check ───
// Gate 5: Durable Truth Gates
phase('Gate5-DurableTruth')

const durableTruth = await agent(
  `Run SteadySpec v0.3 durable truth gates for archive "${changeId}".

   CHANGE DIR: ${context.changeDir}
   PROPOSAL: ${context.proposalPath || 'unknown'}
   EVIDENCE: ${context.evidencePath || 'unknown'}
   FINAL DECISIONS: ${JSON.stringify(completeness.finalDecisions || [])}
   ACCEPTED DEBT: ${JSON.stringify(completeness.acceptedDebt || [])}
   FALLBACK: ${JSON.stringify(completeness.fallback || [])}
   REVIEW FINDINGS: ${JSON.stringify(review?.findings || [])}

   Checks:
   1. Citation anchors: if archive claims will cite document headings or anchors,
      verify the referenced headings/anchors exist before archive write.
   2. Fallback/debt truth: detect any claim that converts fallback, accepted debt,
      or unverified manual checks into proof.
   3. Risk routing: detect any hard high-risk trigger that was treated as low-risk
      agent-owned work.
   4. Doc staleness: surface cross-change doc staleness candidates as strategy
      input, but do not auto-edit docs and do not block by default.

   canProceed is false if missingAnchors, fallbackAsProofClaims, or
   riskMisclassifications are non-empty.`,
  { label: 'gate5-durable-truth', phase: 'Gate5-DurableTruth', schema: DURABLE_TRUTH_SCHEMA }
)

if (!durableTruth) {
  log('GATE 5 FAILED: durable truth check could not complete')
  return { error: 'gate5-durable-truth-failed', changeId }
}

log(`Gate 5: ${durableTruth.canProceed ? 'PASSED' : 'FAILED'}`)

if (!durableTruth.canProceed) {
  return {
    changeId,
    gate: 5,
    status: 'blocked',
    missingAnchors: durableTruth.missingAnchors,
    fallbackAsProofClaims: durableTruth.fallbackAsProofClaims,
    riskMisclassifications: durableTruth.riskMisclassifications,
    recommendedNext: 'Fix durable truth blockers before re-running /steadyspec:archive.',
  }
}

phase('Rollup')

const rollup = await agent(
  `Check if strategy rollup should be triggered for change "${changeId}".

   Read the last 10 archived changes from ${context.archiveLocation}/.. (parent of archive target).
   Extract debt, fallback, and finding fields from each archive.md.
   If 3 or more of the last 10 mention the same module or keyword:
   - Flag as triggered
   - List the module/keyword, count, and source change IDs
   - Provide a strategy recommendation

   If fewer than 3 complete archives exist, note insufficient data.
   Skip partial-archive entries (their fields are missing).`,
  { label: 'rollup-check', phase: 'Rollup', schema: ROLLUP_RESULT_SCHEMA }
)

if (rollup?.triggered) {
  log(`Rollup TRIGGERED: ${rollup.signals.map(s => `${s.moduleOrKeyword}(${s.count}/10)`).join(', ')}`)
  for (const signal of rollup.signals || []) {
    log(`  ${signal.moduleOrKeyword}: ${signal.count}/10 — ${signal.recommendation}`)
  }
} else {
  log('Rollup: not triggered (insufficient repeated signals or insufficient data).')
}

// ─── Write Archive ───
phase('Write')

const archiveResult = await agent(
  `Compose the archive.md for change "${changeId}".

   === ARCHIVE FIELDS ===
   Final decisions: ${JSON.stringify(completeness.finalDecisions)}
   Rejected alternatives: ${JSON.stringify(completeness.rejectedAlternatives)}
   Accepted debt + follow-up: ${JSON.stringify(completeness.acceptedDebt)}
   Fallback: ${JSON.stringify(completeness.fallback)}
   Follow-up triggers: ${JSON.stringify(completeness.followUp)}
   Drift event summary: ${JSON.stringify(completeness.driftEventSummary)}
   Human decision record links: ${(context.humanDecisionRecordPaths || []).join(', ')}
   ${rollup?.triggered ? `Strategy rollup: ${rollup.digestPath || 'rollup digest attached as sibling artifact'}` : 'Strategy rollup: not triggered'}

   === GATE RESULTS ===
   Gate 1 (review): ${review.blockerCount} blockers, ${review.debtCount} debt
   Gate 2 (doc-sync): ${docSync.candidates.length} candidates, ${docSync.mustUpdateNotUpdated.length} must-update
   Gate 3 (confirmed_by): ${confirmedByPassed ? 'passed' : 'blocked'}
   Gate 4 (completeness): ${completeness.canFillAllFields ? 'passed' : 'blocked'}
   Gate 5 (durable truth): ${durableTruth.canProceed ? 'passed' : 'blocked'}
   Doc staleness candidates: ${JSON.stringify(durableTruth.docStalenessCandidates || [])}

   RULES:
   1. Human-owned decisions, accepted debt, fallback, and strategy signals must be NAMED ITEMS in archive.md — not buried in narrative paragraphs.
   2. Each field must be traceable to a source artifact.
   3. Citation anchors must be real; fallback/debt must not be converted into proof.
   4. Write the complete archive.md content as markdown.

   The archive should be placed at: ${context.archiveLocation}/archive.md
   Also provide the git mv command to move the change directory to archive location.`,
  { label: 'write-archive', phase: 'Write', schema: {
    type: 'object',
    properties: {
      archiveMd: { type: 'string' },
      archivePath: { type: 'string' },
      moveCommand: { type: 'string' },
      fieldsWritten: { type: 'array', items: { type: 'string' } },
    },
    required: ['archiveMd', 'archivePath', 'fieldsWritten'],
  }}
)

if (!archiveResult) {
  return { error: 'archive-write-failed', changeId }
}

await agent(
  `Write the following archive.md content to ${archiveResult.archivePath || `${context.archiveLocation}/archive.md`} using the Write tool. Create the directory if needed. Do not modify the content - write it exactly as provided. Do not move the change directory yet.\n\n${archiveResult.archiveMd}`,
  { label: 'write-archive-file', phase: 'Write' }
)
log(`archive.md written to ${archiveResult.archivePath || `${context.archiveLocation}/archive.md`}`)

let docsCheck = null
if (context.substrate === 'docs') {
  const archiveCheckTarget = (archiveResult.archivePath || `${context.archiveLocation}/archive.md`).replace(/\/archive\.md$/, '')
  docsCheck = await agent(
    `Run docs substrate structural check for archive phase.

     Command:
     steadyspec check ${archiveCheckTarget} --phase archive --substrate docs

     If the command is unavailable in this runtime, return status="unavailable" and explain why.
     If it runs and fails, return status="fail" with the important error codes.
     If it passes, return status="pass".`,
    { label: 'docs-check-archive', phase: 'Write', schema: {
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
  log(`docs check archive: ${docsCheck?.status || 'unavailable'}${docsCheck?.summary ? ` - ${docsCheck.summary}` : ''}`)
  if (docsCheck?.status === 'fail') {
    return {
      error: 'docs-check-failed',
      changeId,
      archiveLocation: archiveResult.archivePath,
      docsCheck,
      recommendedNext: 'Fix docs archive structure before moving or closing this change.',
    }
  }
}

return {
  changeId,
  status: 'archived',
  archiveLocation: archiveResult.archivePath,
  moveCommand: archiveResult.moveCommand,
  docsCheck,
  gateResults: {
    review: {
      blockerCount: review.blockerCount,
      debtCount: review.debtCount,
      docSyncRequiredCount: review.docSyncRequiredCount,
    },
    docSync: {
      candidatesCount: docSync.candidates.length,
      mustUpdateCount: docSync.mustUpdateNotUpdated.length,
      shouldCheckCount: docSync.shouldCheckList.length,
      touchedDocs: docSync.candidates.filter(c => c.confidence !== 'unlikely').map(c => c.path),
    },
    confirmedBy: confirmedByPassed ? 'passed' : 'blocked',
    completeness: 'passed',
    durableTruth: 'passed',
  },
  durableTruth: {
    missingAnchors: durableTruth.missingAnchors,
    fallbackAsProofClaims: durableTruth.fallbackAsProofClaims,
    riskMisclassifications: durableTruth.riskMisclassifications,
    docStalenessCandidates: durableTruth.docStalenessCandidates,
  },
  rollup: rollup?.triggered ? {
    triggered: true,
    signals: rollup.signals,
    digestPath: rollup.digestPath || null,
  } : { triggered: false },
  driftEvents: completeness.driftEventSummary || [],
  finalDecisions: completeness.finalDecisions || [],
  acceptedDebt: completeness.acceptedDebt || [],
  fallback: completeness.fallback || [],
  followUp: completeness.followUp || [],
  recommendedNext: rollup?.triggered
    ? 'Strategy rollup triggered — review the rollup digest. Then: next active change can begin.'
    : 'The next active change can begin.',
}

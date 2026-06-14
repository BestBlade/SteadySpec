// SteadySpec explore-flow as deterministic Workflow script.
// Replaces agent-inferred orchestration with explicit phase gating,
// schema-validated structured output, and deterministic routing.
//
// Invocation: /steadyspec:explore [topic]
//   - No topic → status mode: attention-ranked project state report.
//   - With topic → topical mode: context-loaded exploration.
//
// args: { mode: "status" | "topical", topic?: string, projectRoot: string, changeDir?: string }

export const meta = {
  name: 'steadyspec-explore',
  description: 'SteadySpec explore verb as deterministic workflow — attention-ranked status report or topical exploration with project history loaded, schema-validated gates',
  phases: [
    { title: 'Detect', detail: 'Read substrate config and detect project state' },
    { title: 'Freshness', detail: 'Check document freshness via git log' },
    { title: 'Active', detail: 'Read active changes and compute completion signals' },
    { title: 'Archive', detail: 'Read and classify recent archived changes' },
    { title: 'Aggregate', detail: 'Cross-change debt/fallback pattern detection' },
    { title: 'Report', detail: 'Compose attention-ranked status report' },
  ],
}

// === Schemas for structured output ===

const SUBSTRATE_STATE_SCHEMA = {
  type: 'object',
  properties: {
    exists: { type: 'boolean' },
    primary: { type: 'string', enum: ['openspec', 'docs', 'meta', 'custom', 'none'] },
    changeDir: { type: 'string' },
    archiveDir: { type: 'string' },
    lastAdopt: { type: 'string' },
    schemaVersion: { type: 'number' },
  },
  required: ['exists', 'primary', 'changeDir', 'archiveDir'],
}

const DOC_FRESHNESS_SCHEMA = {
  type: 'object',
  properties: {
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          gitMtime: { type: 'string' },
          selfDeclaredDate: { type: 'string' },
          stale: { type: 'boolean' },
          staleReason: { type: 'string' },
        },
        required: ['path', 'gitMtime', 'stale'],
      },
    },
  },
  required: ['files'],
}

const ACTIVE_CHANGE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    slug: { type: 'string' },
    hasProposal: { type: 'boolean' },
    hasEvidence: { type: 'boolean' },
    hasReview: { type: 'boolean' },
    completionSignal: { type: 'string', enum: ['not-started', 'in-progress', 'review-ready', 'archive-ready'] },
    openDebt: { type: 'string' },
    blocker: { type: 'string' },
  },
  required: ['id', 'completionSignal'],
}

const ARCHIVED_CHANGE_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    classification: { type: 'string', enum: ['complete-archive', 'partial-archive', 'incomplete-archive', 'inaccessible'] },
    summary: { type: 'string' },
    decisions: { type: 'array', items: { type: 'string' } },
    debt: { type: 'array', items: { type: 'string' } },
    fallback: { type: 'array', items: { type: 'string' } },
    followUp: { type: 'array', items: { type: 'string' } },
    classificationReason: { type: 'string' },
  },
  required: ['id', 'classification', 'summary'],
}

const DEBT_AGGREGATE_SCHEMA = {
  type: 'object',
  properties: {
    signals: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          moduleOrKeyword: { type: 'string' },
          count: { type: 'number' },
          sourceChangeIds: { type: 'array', items: { type: 'string' } },
          pattern: { type: 'string' },
        },
        required: ['moduleOrKeyword', 'count', 'sourceChangeIds'],
      },
    },
    unavailableReason: { type: 'string' },
  },
  required: ['signals'],
}

const STATUS_REPORT_SCHEMA = {
  type: 'object',
  properties: {
    adoptNote: { type: 'string' },
    stalenessFlags: { type: 'array', items: { type: 'string' } },
    attentionReport: {
      type: 'object',
      properties: {
        mustRead: { type: 'array', items: { type: 'string' } },
        needsGlance: { type: 'array', items: { type: 'string' } },
        collapsedLedger: { type: 'array', items: { type: 'string' } },
      },
      required: ['mustRead', 'needsGlance', 'collapsedLedger'],
    },
    handoffSnapshot: {
      type: 'object',
      properties: {
        currentIntent: { type: 'string' },
        activeChangePath: { type: 'string' },
        ledgerSummary: { type: 'string' },
        pendingHighRiskDecisions: { type: 'array', items: { type: 'string' } },
        proofStatus: { type: 'string' },
        driftEvents: { type: 'array', items: { type: 'string' } },
        debtFallback: { type: 'string' },
        nextSafestAction: { type: 'string' },
      },
    },
    activeChanges: { type: 'array', items: { type: 'string' } },
    debtAggregate: { type: 'string' },
    recentArchived: { type: 'array', items: { type: 'string' } },
    recommendedNext: { type: 'string' },
  },
  required: ['attentionReport', 'activeChanges', 'debtAggregate', 'recentArchived', 'recommendedNext'],
}

// === Helpers ===

function staleReason(doc) {
  if (!doc.selfDeclaredDate) return 'no self-declared date'
  return `self-declared ${doc.selfDeclaredDate}, git mtime ${doc.gitMtime}`
}

function migrateEvidenceFormat(evidenceContent) {
  if (!evidenceContent) {
    return { format: 'absent', migrated: false, notes: ['No evidence.md content supplied during explore detect.'] }
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

const mode = args.mode || 'status'
const topic = args.topic || null
const root = args.projectRoot || '.'

if (mode === 'topical' && !topic) {
  log('Topical mode requested but no topic provided. Falling back to status mode.')
}

const effectiveMode = (mode === 'topical' && topic) ? 'topical' : 'status'

// ─── PHASE: Detect ───
phase('Detect')

const explicitChangeDir = args.changeDir || null
const evidenceMigration = migrateEvidenceFormat(null)

const substrateState = await agent(
  `Determine the change directory for SteadySpec operations at ${root}.

   Legacy evidence migration rule from ARTIFACT_CONTRACT.md:
   ${JSON.stringify(evidenceMigration)}
   If evidence.md is read while detecting active changes and lacks
   "| Field | Value |", treat it as legacy free-form evidence and mark
   unavailable structured fields as "evidence-migration-unavailable".

   Priority:
   ${explicitChangeDir ? `1. USE THIS explicitly provided changeDir: "${explicitChangeDir}". Set primary="custom", changeDir="${explicitChangeDir}", archiveDir="${explicitChangeDir}/archive". Skip all detection.` : '1. No explicit changeDir provided.'}
   2. Read .steadyspec/substrate.json if it exists at ${root}/.steadyspec/substrate.json.
      If present, extract primary, changeDir (if custom), lastAdopt, schemaVersion.
   3. Auto-detect: if openspec/ exists → primary="openspec", changeDir="openspec/changes".
      If docs/changes/ exists with NNN-* subdirs → primary="docs", changeDir="docs/changes".
      If .meta/changes/ exists → primary="meta", changeDir=".meta/changes".
      If none → primary="none".

   Report: primary, changeDir, archiveDir, exists (whether any substrate was found), lastAdopt.`,
  { label: 'detect-substrate', phase: 'Detect', schema: SUBSTRATE_STATE_SCHEMA }
)

if (!substrateState) {
  log('ERROR: Could not read substrate state.')
  return { error: 'substrate-read-failed' }
}

log(`Substrate: ${substrateState.primary}${substrateState.exists ? '' : ' (no .steadyspec/substrate.json — recommend adopt)'}`)

if (substrateState.primary === 'none' || !substrateState.exists) {
  return {
    mode: effectiveMode,
    substrate: 'none',
    adoptNote: 'No SteadySpec substrate detected. Recommend adopt before running governed explore.',
    stalenessFlags: [],
    activeChanges: [],
    debtAggregate: 'unavailable - no SteadySpec substrate detected',
    recentArchived: [],
    recommendedNext: 'Run steadyspec-adopt or provide args.changeDir; do not pretend a substrate exists.',
  }
}

// Use the changeDir/archiveDir from substrate detection (respects explicit args, substrate.json, or auto-detect)
const changeDir = substrateState.changeDir
const archiveDir = substrateState.archiveDir

// ─── PHASE: Freshness ───
phase('Freshness')

const docFreshness = await agent(
  `For each of these project docs (if they exist at ${root}):
   - TODO.md
   - STRATEGY.md
   - README.md
   - CHANGELOG.md

   Run: git log -1 --format=%ai -- <file> (from ${root}) to get real mtime.
   Read the file and look for "Last updated: YYYY-MM-DD" or similar self-declared date.
   Mark as stale if self-declared date is newer than git mtime by more than 2 days.
   If a file doesn't exist, skip it.`,
  { label: 'check-freshness', phase: 'Freshness', schema: DOC_FRESHNESS_SCHEMA }
)

const staleFiles = (docFreshness?.files || []).filter(f => f.stale)
if (staleFiles.length > 0) {
  log(`STALE DOCS: ${staleFiles.map(f => `${f.path} (${staleReason(f)})`).join(', ')}`)
} else {
  log('Document freshness: all tracked docs up to date.')
}

// ─── If topical mode, branch to exploration ───
if (effectiveMode === 'topical') {
  const exploration = await agent(
    `TOPICAL EXPLORATION for topic: "${topic}"

     Project root: ${root}
     Substrate: ${substrateState.primary}
     Change directory: ${changeDir}

     Context archaeology requirement:
     Separate confirmed facts, unknowns, stale assumptions, and constraints from
     prior change records before recommending a direction. Do not convert likely
     history into fact.

     1. Read related substrate context — prior changes mentioning keywords from the topic.
        Look in ${archiveDir} for archive index; scan ${changeDir} for active changes.
     2. Surface the topic's known constraints from prior change records.
     3. Identify at least one open question with a recommended answer.
     4. List related prior changes that inform this topic.

     CRITICAL: Do NOT write any proposal artifacts. Stay in exploration.
     If intent converges, recommend "/steadyspec:propose <draft-intent>" but do NOT auto-transition.

     Report: clarified intent, open questions, related prior changes, recommended next verb.`,
    { label: 'topical-explore', phase: 'Report', schema: {
      type: 'object',
      properties: {
        clarifiedIntent: { type: 'string' },
        openQuestions: { type: 'array', items: { type: 'string' } },
        relatedPriorChanges: { type: 'array', items: { type: 'string' } },
        recommendedNext: { type: 'string' },
      },
      required: ['clarifiedIntent', 'openQuestions', 'recommendedNext'],
    }}
  )

  if (!exploration) {
    return { error: 'topical-exploration-failed' }
  }

  return {
    mode: 'topical',
    topic,
    ...exploration,
  }
}

// ─── STATUS MODE ───

// ─── PHASE: Active ───
phase('Active')

const activeChanges = await agent(
  `Read the change directory at ${root}/${changeDir}/.
   List all directories matching NNN-slug pattern (not "archive").
   For each active change, read its proposal.md (if exists) and evidence.md (if exists).
   Compute a completion signal for each:
   - "not-started": no evidence.md
   - "in-progress": evidence.md exists but not all slices done
   - "review-ready": all slices done, no review record
   - "archive-ready": review passed, doc-sync done
   Record open debt or blockers from evidence.md.`,
  { label: 'read-active', phase: 'Active', schema: {
    type: 'object',
    properties: {
      changes: { type: 'array', items: ACTIVE_CHANGE_SCHEMA },
    },
    required: ['changes'],
  }}
)

if (!activeChanges) {
  log('No active changes found or could not read change directory.')
}

const changes = activeChanges?.changes || []
log(`Active changes: ${changes.length} found`)
for (const c of changes) {
  log(`  ${c.id}: ${c.completionSignal}${c.blocker ? ` [BLOCKED: ${c.blocker}]` : ''}`)
}

// ─── PHASE: Archive ───
phase('Archive')

const archivedChanges = await agent(
  `Read the archive directory at ${root}/${archiveDir}/.
   List the most recent 5 archived changes (by directory name / mtime).
   For each, inspect its archive.md and classify:
   - "complete-archive": archive.md exists with standard fields (decisions, debt, fallback, follow-up)
   - "partial-archive": archive directory exists but archive.md is missing or fields are empty
   - "incomplete-archive": archive directory exists but no change content inside (empty placeholder)
   - "inaccessible": archive exists but cannot be read

   For complete-archive entries, extract: decisions (list), debt (list), fallback (list), follow-up (list).
   For partial-archive entries, record the reason (e.g. "archive.md missing", "fields empty").
   For all entries, provide a one-line summary.`,
  { label: 'read-archive', phase: 'Archive', schema: {
    type: 'object',
    properties: {
      entries: { type: 'array', items: ARCHIVED_CHANGE_SCHEMA },
    },
    required: ['entries'],
  }}
)

const archiveEntries = archivedChanges?.entries || []
log(`Archived changes classified: ${archiveEntries.length} entries`)

// ─── PHASE: Aggregate ───
phase('Aggregate')

// Collect debt/fallback/finding keywords from complete-archive entries
const completeEntries = archiveEntries.filter(e => e.classification === 'complete-archive')
const partialCount = archiveEntries.filter(e => e.classification === 'partial-archive').length

let debtAggregate = null
if (completeEntries.length === 0) {
  log('Debt aggregate unavailable — no complete-archive entries in recent history.')
} else {
  debtAggregate = await agent(
    `Analyze these archived change records for repeated patterns.
     Complete archive entries:
     ${JSON.stringify(completeEntries.map(e => ({ id: e.id, debt: e.debt, fallback: e.fallback, followUp: e.followUp })))}

     Find keywords or module names that appear in debt/fallback/follow-up fields
     across 3 or more of the entries. For each repeated signal, identify:
     - The module or keyword
     - How many of the last N entries mention it
     - Which change IDs
     - What the pattern suggests

     If fewer than 3 entries were analyzed, note that the sample is too small.`,
    { label: 'aggregate-debt', phase: 'Aggregate', schema: DEBT_AGGREGATE_SCHEMA }
  )
}

// ─── PHASE: Report ───
phase('Report')

const report = await agent(
  `Compose an attention-ranked SteadySpec status report from the data below.

   === ADOPT NOTE ===
   ${!substrateState.exists || !substrateState.lastAdopt ? 'No adopt baseline recorded. Recommend running steadyspec-adopt once.' : `Adopt baseline: ${substrateState.lastAdopt}`}

   === STALE DOCS ===
   ${staleFiles.length > 0 ? staleFiles.map(f => `${f.path}: ${staleReason(f)}`).join('\n') : 'None — all docs up to date.'}

   === ACTIVE CHANGES ===
   ${JSON.stringify(changes)}

   === DEBT AGGREGATE ===
   ${debtAggregate ? JSON.stringify(debtAggregate) : (partialCount > 0 ? 'Debt aggregate unavailable — recent archives have missing fields (partial-archive).' : 'No complete-archive data to aggregate.')}

   === RECENT ARCHIVED (last 5) ===
   ${JSON.stringify(archiveEntries)}

   Compose a 5-section report:
   1. **Attention report** - must-read high-risk/user-owned decisions first,
      needs-glance medium/shared items next, collapsed low-risk agent-owned
      ledger count last.
   2. **Active changes** — each with completion signal + open debt or blocker.
   3. **Debt aggregate** — cross-change repeated patterns, or explanation of why unavailable.
      If recent archives are partial-archive, say "debt aggregate unavailable — recent archives have missing fields, classify as partial-archive".
   4. **Recent archived** — last 5 with one-line summary AND classification label (complete-archive / partial-archive / incomplete-archive / inaccessible).
   5. **Recommended next** — which verb the user should run next with reasoning.
      If multiple partial-archive entries appear, suggest "consider re-archiving partial entries with /steadyspec:archive <id>".

   Include a handoffSnapshot when there is an active change: current intent,
   active change path, ledger summary, pending high-risk decisions, proof status,
   drift events, debt/fallback, and next safest action.

   At the top of the report, include adopt note and staleness flags if any.`,
  { label: 'compose-report', phase: 'Report', schema: STATUS_REPORT_SCHEMA }
)

if (!report) {
  return { error: 'report-composition-failed' }
}

return {
  mode: 'status',
  substrate: substrateState.primary,
  adoptNote: (!substrateState.exists || !substrateState.lastAdopt)
    ? 'No adopt baseline recorded. Recommend running steadyspec-adopt once.'
    : null,
  stalenessFlags: staleFiles.map(f => `${f.path}: ${staleReason(f)}`),
  ...report,
}

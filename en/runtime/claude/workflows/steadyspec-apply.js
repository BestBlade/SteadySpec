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

const EVIDENCE_SOURCE_SCHEMA = {
  type: 'object',
  properties: {
    path: { type: 'string' },
    status: { type: 'string', enum: ['absent', 'present', 'unreadable'] },
    content: { type: 'string' },
    complete: { type: 'boolean' },
    truncated: { type: 'boolean' },
    readError: { type: 'string' },
  },
  required: ['path', 'status', 'content', 'complete', 'truncated', 'readError'],
}

const DELEGATION_BOUNDARY_SCHEMA = {
  type: 'object',
  properties: {
    authorizedOutcome: { type: 'string' },
    hardConstraints: { type: 'array', items: { type: 'string' } },
    challengeableAssumptions: { type: 'array', items: { type: 'string' } },
    proposedMeans: { type: 'array', items: { type: 'string' } },
    delegatedDecisions: { type: 'array', items: { type: 'string' } },
    challengeResolution: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          findingId: { type: 'string' },
          finding: { type: 'string' },
          layer: { type: 'string', enum: ['authorized-outcome', 'hard-constraint', 'assumption', 'means', 'delegated-decision'] },
          owner: { type: 'string', enum: ['user', 'agent', 'shared'] },
          status: { type: 'string', enum: ['resolved', 'unresolved', 'within-delegation'] },
          authorityBasis: { type: 'string', enum: ['human-decision', 'prior-delegation', 'agent-delegation', 'not-required'] },
          authorityRef: { type: 'string' },
          resolution: { type: 'string' },
        },
        required: ['findingId', 'finding', 'layer', 'owner', 'status', 'authorityBasis', 'authorityRef', 'resolution'],
      },
    },
    status: { type: 'string', enum: ['ready', 'needs-human', 'missing'] },
  },
  required: ['authorizedOutcome', 'hardConstraints', 'challengeableAssumptions', 'proposedMeans', 'delegatedDecisions', 'challengeResolution', 'status'],
}

// BEGIN DELEGATION GATE PURE
function unfinishedDelegationValue(value) {
  const normalized = String(value || "").trim()
  if (!normalized || /^<[^>]+>$/.test(normalized)) return true
  return /^(?:unresolved|unknown|tbd|todo|pending)(?:\b|\s*:)/i.test(normalized)
    || /^not\s+(?:recorded|yet\s+(?:known|decided|resolved)|determined)\b/i.test(normalized)
}

function authorityRefParts(value) {
  const normalized = String(value || "").trim()
  if (unfinishedDelegationValue(normalized) || /^(?:none|n\/a|not-required)$/i.test(normalized)) return null
  const hash = normalized.indexOf("#")
  if (hash <= 0 || hash !== normalized.lastIndexOf("#")) return null
  const artifactPath = normalized.slice(0, hash)
  const anchor = normalized.slice(hash + 1)
  const segments = artifactPath.split("/")
  if (!artifactPath.endsWith(".md") || artifactPath.startsWith("/") || artifactPath.includes("\\") || /^[A-Za-z]:/.test(artifactPath)) return null
  if (segments.some((segment) => !segment || segment === "." || segment === ".." || !/^[A-Za-z0-9._-]+$/.test(segment) || /[. ]$/.test(segment) || /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment))) return null
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(anchor)) return null
  return { artifactPath, anchor }
}

function concreteAuthorityRef(value) {
  return authorityRefParts(value) !== null
}

function docsProposalSchemaPrefix(substrate) {
  return substrate === "docs" ? "schemaVersion: 1\n\n" : ""
}

function canonicalActiveChangePath(value) {
  const raw = String(value || "")
  if (!raw || raw !== raw.trim() || raw.includes("\\") || raw.startsWith("/") || /^[A-Za-z]:/.test(raw)) return null
  const segments = raw.split("/")
  if (segments.some((segment) => !segment
    || segment === "."
    || segment === ".."
    || segment.endsWith(".")
    || segment.endsWith(" ")
    || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\..*)?$/i.test(segment)
    || !/^[A-Za-z0-9._-]+$/.test(segment))) return null
  return segments.join("/")
}

function deriveActiveChangeIdentity(changeId, substrate, explicitChangeBase, observedChangeRoot) {
  const id = canonicalActiveChangePath(changeId)
  if (!id || id.includes("/")) return { ok: false, errors: ["active-change-id-invalid"] }
  const builtInBases = { openspec: "openspec/changes", docs: "docs/changes", meta: ".meta/changes" }
  let baseRaw = builtInBases[substrate]
  if (substrate === "custom") {
    baseRaw = explicitChangeBase
    const customBase = canonicalActiveChangePath(baseRaw)
    if (!customBase) return { ok: false, errors: ["active-custom-base-required"] }
    if (Object.values(builtInBases).some((reserved) => customBase.toLowerCase() === reserved.toLowerCase() || customBase.toLowerCase().startsWith(`${reserved.toLowerCase()}/`))) {
      return { ok: false, errors: ["active-custom-base-reserved"] }
    }
  }
  if (!baseRaw) return { ok: false, errors: ["active-substrate-invalid"] }
  const base = canonicalActiveChangePath(baseRaw)
  const observed = canonicalActiveChangePath(observedChangeRoot)
  if (!base || !observed) return { ok: false, errors: ["active-change-path-invalid"] }
  const activeRoot = `${base}/${id}`
  if (substrate === "custom" && Object.values(builtInBases).some((reserved) => activeRoot.toLowerCase() === reserved.toLowerCase() || activeRoot.toLowerCase().startsWith(`${reserved.toLowerCase()}/`))) {
    return { ok: false, errors: ["active-custom-root-reserved"] }
  }
  if (observed !== activeRoot) return { ok: false, errors: ["active-change-root-mismatch"] }
  return {
    ok: true,
    changeId: id,
    changeBase: base,
    activeRoot,
    proposalPath: `${activeRoot}/proposal.md`,
    evidencePath: `${activeRoot}/evidence.md`,
    checkpointPath: `${activeRoot}/trust-checkpoint.md`,
    handoffPath: `${activeRoot}/handoff-snapshot.md`,
    errors: [],
  }
}

function activeChangeContextErrors(context, identity, options = {}) {
  if (!identity || !identity.ok) return [...(identity?.errors || ["active-change-identity-missing"])]
  const errors = []
  if (context?.changeId !== identity.changeId) errors.push("context-change-id-mismatch")
  if (context?.changeDir !== identity.activeRoot) errors.push("context-change-root-mismatch")
  if (context?.proposalPath !== identity.proposalPath) errors.push("context-proposal-path-mismatch")
  if (context?.evidencePath !== identity.evidencePath) errors.push("context-evidence-path-mismatch")
  if (options.requireCheckpoint && context?.checkpointPath !== identity.checkpointPath) errors.push("context-checkpoint-path-mismatch")
  if (context?.checkpointPath && context.checkpointPath !== identity.checkpointPath) errors.push("context-checkpoint-path-mismatch")
  if (context?.handoffPath && context.handoffPath !== identity.handoffPath) errors.push("context-handoff-path-mismatch")
  return [...new Set(errors)]
}

function delegationBoundaryReadbackErrors(expected, observed) {
  const normalize = (value) => ({
    authorizedOutcome: String(value?.authorizedOutcome || ""),
    hardConstraints: Array.isArray(value?.hardConstraints) ? value.hardConstraints.map(String) : [],
    challengeableAssumptions: Array.isArray(value?.challengeableAssumptions) ? value.challengeableAssumptions.map(String) : [],
    proposedMeans: Array.isArray(value?.proposedMeans) ? value.proposedMeans.map(String) : [],
    delegatedDecisions: Array.isArray(value?.delegatedDecisions) ? value.delegatedDecisions.map(String) : [],
    challengeResolution: Array.isArray(value?.challengeResolution) ? value.challengeResolution.map((row) => ({
      findingId: String(row?.findingId || ""), finding: String(row?.finding || ""), layer: String(row?.layer || ""), owner: String(row?.owner || ""),
      status: String(row?.status || ""), authorityBasis: String(row?.authorityBasis || ""), authorityRef: String(row?.authorityRef || ""), resolution: String(row?.resolution || ""),
    })) : [],
    status: String(value?.status || ""),
  })
  return JSON.stringify(normalize(expected)) === JSON.stringify(normalize(observed)) ? [] : ["delegation-boundary-readback-mismatch"]
}

function delegationGateErrors(boundary, requireReady) {
  const errors = []
  if (!boundary || typeof boundary !== "object") return ["delegation-boundary-missing"]
  if (requireReady && boundary.status !== "ready") errors.push("delegation-status-not-ready")
  if (requireReady && unfinishedDelegationValue(boundary.authorizedOutcome)) errors.push("authorized-outcome-not-concrete")
  const hardConstraints = Array.isArray(boundary.hardConstraints) ? boundary.hardConstraints : []
  const challengeableAssumptions = Array.isArray(boundary.challengeableAssumptions) ? boundary.challengeableAssumptions : []
  const proposedMeans = Array.isArray(boundary.proposedMeans) ? boundary.proposedMeans : []
  const delegatedDecisions = Array.isArray(boundary.delegatedDecisions) ? boundary.delegatedDecisions : []
  if (requireReady && (hardConstraints.length === 0 || hardConstraints.some(unfinishedDelegationValue))) errors.push("hard-constraints-not-concrete")
  if (requireReady && (challengeableAssumptions.length === 0 || challengeableAssumptions.some(unfinishedDelegationValue))) errors.push("challengeable-assumptions-not-concrete")
  if (requireReady && (proposedMeans.length === 0 || proposedMeans.some(unfinishedDelegationValue))) errors.push("proposed-means-not-concrete")
  if (requireReady && (delegatedDecisions.length === 0 || delegatedDecisions.some(unfinishedDelegationValue))) errors.push("delegated-decisions-not-concrete")
  const resolutions = Array.isArray(boundary.challengeResolution) ? boundary.challengeResolution : []
  for (const row of resolutions) {
    const id = row && row.findingId ? row.findingId : "unknown"
    if (!row || typeof row !== "object") {
      errors.push(`${id}:challenge-resolution-invalid`)
      continue
    }
    if ([row.findingId, row.finding, row.resolution].some(unfinishedDelegationValue)) errors.push(`${id}:unfinished-challenge-resolution`)
    if (requireReady && row.status === "unresolved") errors.push(`${id}:challenge-unresolved`)
    const coreLayer = row.layer === "authorized-outcome" || row.layer === "hard-constraint"
    if (coreLayer && row.status === "resolved") {
      if (!["user", "shared"].includes(row.owner) || row.authorityBasis !== "human-decision" || !concreteAuthorityRef(row.authorityRef)) {
        errors.push(`${id}:core-change-without-human-decision`)
      }
    } else if (coreLayer && row.status === "within-delegation") {
      if (row.authorityBasis !== "prior-delegation" || !concreteAuthorityRef(row.authorityRef)) errors.push(`${id}:core-change-without-prior-delegation`)
    } else if (row.status !== "unresolved") {
      if (row.authorityBasis === "not-required" || !concreteAuthorityRef(row.authorityRef)) errors.push(`${id}:resolved-challenge-without-authority-ref`)
    }
  }
  return [...new Set(errors)]
}

function archiveDelegationGate(boundary, trustCheckpoint) {
  const delegationErrors = delegationGateErrors(boundary, true)
  const trust = trustCheckpoint && typeof trustCheckpoint === "object"
    ? trustCheckpoint
    : { present: false, delegationReview: "missing", recommendedNext: "missing", sourcePath: "" }
  const trustErrors = []
  if (trust.present !== true) trustErrors.push("trust-checkpoint-missing")
  for (const [field, value] of Object.entries({
    "intent-match": trust.intentMatch,
    "delegation-review": trust.delegationReview,
    "evidence-credibility": trust.evidenceCredibility,
    "risk-routing-review": trust.riskRoutingReview,
    "debt-fallback-visibility": trust.debtFallbackVisibility,
  })) if (value !== "pass") trustErrors.push(`${field}-${value || "missing"}`)
  if (trust.recommendedNext !== "archive") trustErrors.push(`trust-recommended-next-${trust.recommendedNext || "missing"}`)
  return { gateFailed: delegationErrors.length > 0 || trustErrors.length > 0, delegationErrors, trustErrors, trust }
}

function finalizeDelegationCheckpoint(initialErrors, checkpoint) {
  const next = {
    ...checkpoint,
    pendingUserDecisions: [...(checkpoint.pendingUserDecisions || [])],
    evidenceGaps: [...(checkpoint.evidenceGaps || [])],
  }
  const gateValues = [next.intentMatch, next.delegationReview, next.evidenceCredibility, next.riskRoutingReview, next.debtFallbackVisibility]
  const hardBlocked = gateValues.some((value) => value === "blocked" || value === "misclassified")
  const pendingDecision = next.pendingUserDecisions.length > 0
  const gateFailed = (initialErrors || []).length > 0 || hardBlocked || pendingDecision
  if (gateFailed) {
    if ((initialErrors || []).length > 0) {
      next.intentMatch = "blocked"
      next.delegationReview = "blocked"
    }
    const reOpen = (initialErrors || []).length > 0 || [next.intentMatch, next.delegationReview, next.riskRoutingReview].some((value) => value === "blocked" || value === "misclassified")
    next.recommendedNext = reOpen ? "re-open-intent" : "stop"
    const reason = `Trust gate failed: ${[...(initialErrors || []), ...(hardBlocked ? ["blocked-or-misclassified-trust-dimension"] : []), ...(pendingDecision ? ["pending-user-decision"] : [])].join(", ")}.`
    if (!next.pendingUserDecisions.includes(reason)) next.pendingUserDecisions.push(reason)
  } else if (next.recommendedNext === "archive" && gateValues.some((value) => value !== "pass")) {
    next.recommendedNext = "continue"
    const reason = "Archive was withheld because every persisted trust dimension must pass; gaps remain visible."
    if (!next.evidenceGaps.includes(reason)) next.evidenceGaps.push(reason)
  }
  return { gateFailed, checkpoint: next }
}
// END DELEGATION GATE PURE

// BEGIN DELEGATION ARTIFACT CHECK
const DELEGATION_CHECK_OBSERVATION_SCHEMA = {
  type: 'object',
  properties: {
    executedArgv: { type: 'array', items: { type: 'string' } },
    exitCode: { type: 'number' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    extraCommands: { type: 'boolean' },
  },
  required: ['executedArgv', 'exitCode', 'stdout', 'stderr', 'extraCommands'],
}

async function runDelegationArtifactCheck(changeRoot, artifactPhase, workflowPhase) {
  const argv = ['steadyspec', 'delegation-check', '--change', changeRoot, '--phase', artifactPhase, '--json']
  const expectedChangePath = String(changeRoot || '').replace(/\\/g, '/').replace(/^\.\//, '')
  const observation = await agent(
    `Execute exactly one read-only SteadySpec process without a shell.\n\nEXACT ARGV JSON:\n${JSON.stringify(argv)}\n\nDo not write files and do not run any other command. Return exact argv, exit code, stdout, stderr, and extraCommands=true if anything else ran.`,
    { label: `delegation-artifact-${artifactPhase}`, phase: workflowPhase, schema: DELEGATION_CHECK_OBSERVATION_SCHEMA },
  )
  const errors = []
  if (!observation || JSON.stringify(observation.executedArgv) !== JSON.stringify(argv)) errors.push('delegation-check-argv-mismatch')
  if (observation?.extraCommands !== false) errors.push('delegation-check-extra-command')
  if (String(observation?.stderr || '').trim()) errors.push('delegation-check-stderr-not-empty')
  let report = null
  try { report = JSON.parse(observation?.stdout || '') } catch (error) { errors.push('delegation-check-json-invalid') }
  if (observation?.exitCode !== 0 || report?.ok !== true) errors.push('delegation-check-not-ready')
  if (report?.phase !== artifactPhase) errors.push('delegation-check-phase-mismatch')
  if (report?.changePath !== expectedChangePath) errors.push('delegation-check-change-identity-mismatch')
  if (!Array.isArray(report?.results) || !Array.isArray(report?.authorityArtifacts)) errors.push('delegation-check-report-shape-invalid')
  if (typeof report?.proposalContent !== 'string' || !/^sha256:[a-f0-9]{64}$/.test(report?.proposalSha256 || '') || !report?.delegationBoundary || typeof report.delegationBoundary !== 'object') errors.push('delegation-check-proposal-readback-invalid')
  if (['verify', 'archive'].includes(artifactPhase) && (!report?.trustGates || typeof report.trustGates !== 'object' || !/^sha256:[a-f0-9]{64}$/.test(report?.trustSha256 || ''))) errors.push('delegation-check-trust-readback-invalid')
  if (!/^sha256:[a-f0-9]{64}$/.test(report?.artifactFingerprint || '')) errors.push('delegation-check-fingerprint-invalid')
  return { ok: errors.length === 0, errors, report, observationBoundary: 'model-independent-process-readback-observed-by-agent-not-host-attestation' }
}
// END DELEGATION ARTIFACT CHECK

const CHANGE_CONTEXT_SCHEMA = {
  type: 'object',
  properties: {
    changeId: { type: 'string' },
    changeDir: { type: 'string' },
    proposalPath: { type: 'string' },
    evidencePath: { type: 'string' },
    tasksPath: { type: 'string' },
    specsDir: { type: 'string' },
    designPath: { type: 'string' },
    substrateType: { type: 'string', enum: ['openspec', 'docs', 'meta', 'custom', 'none'] },
    intent: { type: 'string' },
    delegationBoundary: DELEGATION_BOUNDARY_SCHEMA,
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
    evidenceSource: EVIDENCE_SOURCE_SCHEMA,
  },
  required: ['changeId', 'changeDir', 'proposalPath', 'evidencePath', 'substrateType', 'intent', 'delegationBoundary', 'slices', 'evidenceSource'],
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
    affectedField: { type: 'string', enum: ['boundary.inScope', 'boundary.outOfScope', 'nonGoals', 'stopConditions', 'evidenceRequired'] },
    beforeValue: { type: 'string' },
    afterValue: { type: 'string' },
  },
  required: ['valid', 'reason'],
}

// BEGIN EVIDENCE CONTINUITY PURE
const EVIDENCE_REQUIRED_FIELDS = [
  "proofCommand",
  "result",
  "outputSummary",
  "coverageLimit",
  "linkedDecisionIds",
  "fallback",
  "acceptedDebt",
]
const EVIDENCE_RESULT_VALUES = ["pass", "fail", "drift", "fallback", "blocked"]

function validateEvidenceSource(source) {
  const normalized = {
    path: source && typeof source.path === "string" ? source.path : "",
    status: source && typeof source.status === "string" ? source.status : "unreadable",
    content: source && typeof source.content === "string" ? source.content : "",
    complete: Boolean(source && source.complete === true),
    truncated: Boolean(source && source.truncated === true),
    readError: source && typeof source.readError === "string" ? source.readError : "",
  }
  const errors = []
  if (!["absent", "present", "unreadable"].includes(normalized.status)) errors.push("invalid-evidence-source-status")
  if (normalized.status === "absent" && (normalized.content !== "" || !normalized.complete || normalized.truncated)) {
    errors.push("invalid-absent-evidence-source")
  }
  if (normalized.status === "present" && (!normalized.complete || normalized.truncated)) {
    errors.push("incomplete-evidence-source")
  }
  if (normalized.status === "unreadable") errors.push("unreadable-evidence-source")
  return { ok: errors.length === 0, source: normalized, errors }
}

function normalizeEvidencePathIdentity(value) {
  const text = String(value || "").trim().replace(/\\/g, "/").replace(/\/{2,}/g, "/")
  const prefix = text.match(/^[A-Za-z]:\//) ? text.slice(0, 3) : (text.startsWith("/") ? "/" : "")
  const body = prefix ? text.slice(prefix.length) : text
  const parts = []
  for (const part of body.split("/")) {
    if (!part || part === ".") continue
    if (part === "..") {
      if (!parts.length) return ""
      parts.pop()
    } else {
      parts.push(part)
    }
  }
  const normalized = `${prefix}${parts.join("/")}`
  return normalized.endsWith("/") ? normalized.slice(0, -1) : normalized
}

function evidenceSourcePathPolicy(source, expectedEvidencePath, proposalPath) {
  const sourcePath = normalizeEvidencePathIdentity(source && source.path)
  const expectedPath = normalizeEvidencePathIdentity(expectedEvidencePath)
  const normalizedProposal = normalizeEvidencePathIdentity(proposalPath)
  const derivedPath = /\/proposal\.md$/i.test(normalizedProposal)
    ? normalizedProposal.replace(/\/proposal\.md$/i, "/evidence.md")
    : ""
  const errors = []
  if (!sourcePath) errors.push("evidence-source-path-missing")
  if (!expectedPath) errors.push("expected-evidence-path-missing")
  if (!derivedPath) errors.push("proposal-path-does-not-identify-evidence")
  if (sourcePath && expectedPath && sourcePath !== expectedPath) errors.push("evidence-source-path-mismatch")
  if (expectedPath && derivedPath && expectedPath !== derivedPath) errors.push("evidence-target-path-mismatch")
  return { ok: errors.length === 0, sourcePath, expectedPath, derivedPath, errors }
}

function splitMarkdownRow(line) {
  const text = String(line || "").trim()
  if (!text.startsWith("|") || !text.endsWith("|")) return []
  const cells = []
  let cell = ""
  let escaped = false
  for (let i = 1; i < text.length - 1; i += 1) {
    const character = text[i]
    if (character === "|" && !escaped) {
      cells.push(cell.trim())
      cell = ""
      continue
    }
    cell += character
    if (character === "\\") escaped = !escaped
    else escaped = false
  }
  cells.push(cell.trim())
  return cells
}

function decodeEvidenceCell(value) {
  const text = String(value || "")
  if (!text.startsWith("uri:")) return text
  try {
    return decodeURIComponent(text.slice(4))
  } catch (error) {
    return "evidence-migration-unavailable:invalid-cell-encoding"
  }
}

function encodeEvidenceCell(value) {
  return `uri:${encodeURIComponent(String(value === undefined || value === null || value === "" ? "None" : value))}`
}

function decodeEvidenceCellForView(value, view, location) {
  const text = String(value || "")
  if (!text.startsWith("uri:")) {
    view.gaps.push(`evidence-migration-unavailable:legacy-cell-encoding@${location}`)
    return text
  }
  const decoded = decodeEvidenceCell(text)
  if (decoded.includes("evidence-migration-unavailable:invalid-cell-encoding")) {
    view.blockingErrors.push(`invalid-evidence-cell-encoding@${location}`)
  }
  return decoded
}

function parseEvidenceEvents(text, heading, fields, view) {
  const marker = `## ${heading}`
  const start = text.indexOf(marker)
  if (start < 0) return []
  const bodyStart = start + marker.length
  const remainder = text.slice(bodyStart)
  const nextHeading = remainder.search(/^## /m)
  const section = nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder
  const events = []
  for (const line of section.split(/\r?\n/)) {
    const cells = splitMarkdownRow(line)
    if (!String(line || "").trim().startsWith("|")) continue
    if (cells[0] && (cells[0].toLowerCase() === fields[0].toLowerCase() || /^-+$/.test(cells[0]) || cells[0] === "None")) continue
    if (cells.length !== fields.length) {
      view.blockingErrors.push(`malformed-evidence-event-row:${heading}`)
      continue
    }
    const event = {}
    fields.forEach((field, index) => { event[field] = decodeEvidenceCellForView(cells[index], view, `${heading}:${field}`) })
    events.push(event)
  }
  return events
}

function parsePreservedEvidence(text, view) {
  const pattern = /<!-- steadyspec-preserved-evidence-json-v1 ([\s\S]*?) -->/g
  for (const match of text.matchAll(pattern)) {
    try {
      const parsed = JSON.parse(match[1])
      if (!parsed || parsed.encoding !== "json-string-v1" || !Array.isArray(parsed.documents)
          || parsed.documents.some((entry) => typeof entry !== "string")) {
        view.blockingErrors.push("invalid-preserved-evidence-carrier")
        continue
      }
      for (const document of parsed.documents) {
        if (!view.preservedSources.includes(document)) view.preservedSources.push(document)
      }
    } catch (error) {
      view.blockingErrors.push("unreadable-preserved-evidence-carrier")
    }
  }
}

function normalizeEvidenceDocument(source) {
  const checked = validateEvidenceSource(source)
  const view = {
    schemaVersion: 1,
    sourceStatus: checked.source.status,
    sourceFormat: checked.source.status === "absent" ? "absent" : "unknown",
    sourceText: checked.source.content,
    sourcePath: checked.source.path,
    slices: [],
    driftEvents: [],
    reSliceEvents: [],
    preservedSources: [],
    gaps: [],
    warnings: [],
    conflicts: [],
    blockingErrors: [...checked.errors],
  }
  if (checked.source.status === "absent") {
    view.gaps.push("evidence-migration-unavailable:no-evidence-source")
    return view
  }
  if (checked.source.status !== "present" || !checked.ok) {
    view.gaps.push("evidence-migration-unavailable:source-unreadable-or-incomplete")
    return view
  }

  const parseText = checked.source.content.replace(/^\uFEFF/, "")
  parsePreservedEvidence(parseText, view)
  const sliceMatches = [...parseText.matchAll(/^## Slice ([^:\r\n]+):[ \t]*(.*)$/gm)]
  const hasCanonicalTable = parseText.includes("| Field | Value |") && sliceMatches.length > 0
  if (!hasCanonicalTable) {
    view.sourceFormat = "legacy-freeform"
    if (!view.preservedSources.includes(checked.source.content)) view.preservedSources.push(checked.source.content)
    view.gaps.push("evidence-migration-unavailable:legacy-freeform-fields")
    return view
  }

  const seenIndices = new Set()
  for (const match of sliceMatches) {
    const sectionStart = match.index + match[0].length
    const remainder = parseText.slice(sectionStart)
    const nextHeading = remainder.search(/^## /m)
    const section = nextHeading >= 0 ? remainder.slice(0, nextHeading) : remainder
    const rows = {}
    for (const line of section.split(/\r?\n/)) {
      const cells = splitMarkdownRow(line)
      if (cells.length !== 2 || cells[0] === "Field" || /^-+$/.test(cells[0])) continue
      rows[cells[0]] = decodeEvidenceCellForView(cells[1], view, `slice-${String(match[1]).trim()}:${cells[0]}`)
    }
    const sliceIndex = String(match[1]).trim()
    const entry = {
      sliceIndex,
      behavior: decodeEvidenceCellForView(String(match[2] || "").trim(), view, `slice-${sliceIndex}:behavior`),
      proofCommand: rows["Proof Command"],
      result: rows.Result,
      outputSummary: rows["Output Summary"],
      coverageLimit: rows["Coverage Limit"],
      linkedDecisionIds: rows["Linked Decisions"],
      fallback: rows.Fallback,
      acceptedDebt: rows["Accepted Debt"],
    }
    if (!sliceIndex || seenIndices.has(sliceIndex)) {
      view.blockingErrors.push(`duplicate-or-missing-slice-index:${sliceIndex || "unknown"}`)
      continue
    }
    seenIndices.add(sliceIndex)
    if (!entry.behavior) {
      entry.behavior = "evidence-migration-unavailable"
      view.gaps.push(`evidence-migration-unavailable:behavior@slice-${sliceIndex}`)
      view.blockingErrors.push(`malformed-canonical-slice:${sliceIndex}`)
    }
    for (const field of EVIDENCE_REQUIRED_FIELDS) {
      if (typeof entry[field] !== "string" || entry[field].length === 0) {
        entry[field] = `evidence-migration-unavailable:${field}`
        view.gaps.push(`evidence-migration-unavailable:${field}@slice-${sliceIndex}`)
        view.blockingErrors.push(`malformed-canonical-slice:${sliceIndex}`)
      }
    }
    if (!EVIDENCE_RESULT_VALUES.includes(entry.result)) {
      view.gaps.push(`evidence-migration-unavailable:invalid-result@slice-${sliceIndex}`)
      view.blockingErrors.push(`malformed-canonical-result:${sliceIndex}`)
    }
    view.slices.push(entry)
  }
  view.driftEvents = parseEvidenceEvents(parseText, "Drift Event Log", ["timestamp", "slice", "type", "action"], view)
  view.reSliceEvents = parseEvidenceEvents(parseText, "Re-slice Event Log", ["timestamp", "slice", "type", "risk", "owner", "impact"], view)
  view.sourceFormat = view.preservedSources.length > 0 ? "mixed" : "canonical-v1"
  const changeIdMatch = parseText.match(/^# Evidence Record:\s*(.+)$/m)
  const changeId = changeIdMatch ? changeIdMatch[1].trim() : "change"
  if (renderEvidenceDocument(view, changeId) !== checked.source.content
      && !view.preservedSources.includes(checked.source.content)) {
    view.preservedSources.push(checked.source.content)
    view.gaps.push("evidence-migration-unavailable:unconsumed-source-content")
  }
  view.sourceFormat = view.preservedSources.length > 0 ? "mixed" : "canonical-v1"
  if (view.preservedSources.length > 0 && !view.gaps.includes("evidence-migration-unavailable:preserved-source-fields")) {
    view.gaps.push("evidence-migration-unavailable:preserved-source-fields")
  }
  return view
}

function normalizeEvidenceEntry(entry) {
  const normalized = {
    sliceIndex: String(entry && entry.sliceIndex !== undefined ? entry.sliceIndex : "").trim(),
    behavior: String(entry && entry.behavior !== undefined ? entry.behavior : ""),
  }
  for (const field of EVIDENCE_REQUIRED_FIELDS) {
    normalized[field] = String(entry && entry[field] !== undefined ? entry[field] : "")
  }
  return normalized
}

function evidenceObjectsEqual(left, right, fields) {
  return fields.every((field) => String(left[field]) === String(right[field]))
}

function mergeEvidenceEvents(existing, incoming, fields, keyFields, conflicts, kind) {
  const result = existing.map((entry) => ({ ...entry }))
  let changed = false
  for (const raw of incoming || []) {
    const event = {}
    for (const field of fields) event[field] = String(raw && raw[field] !== undefined ? raw[field] : "")
    if (fields.some((field) => !event[field])) {
      conflicts.push({ kind: `${kind}-invalid`, event })
      continue
    }
    const found = result.find((entry) => keyFields.every((field) => entry[field] === event[field]))
    if (!found) {
      result.push(event)
      changed = true
    } else if (!evidenceObjectsEqual(found, event, fields)) {
      conflicts.push({ kind: `${kind}-conflict`, key: keyFields.map((field) => event[field]).join("|") })
    }
  }
  return { result, changed }
}

function renderEvidenceSlice(entry) {
  return `## Slice ${entry.sliceIndex}: ${encodeEvidenceCell(entry.behavior)}

| Field | Value |
|-------|-------|
| Proof Command | ${encodeEvidenceCell(entry.proofCommand)} |
| Result | ${encodeEvidenceCell(entry.result)} |
| Output Summary | ${encodeEvidenceCell(entry.outputSummary)} |
| Coverage Limit | ${encodeEvidenceCell(entry.coverageLimit)} |
| Linked Decisions | ${encodeEvidenceCell(entry.linkedDecisionIds)} |
| Fallback | ${encodeEvidenceCell(entry.fallback)} |
| Accepted Debt | ${encodeEvidenceCell(entry.acceptedDebt)} |
`
}

function renderPreservedEvidence(documents) {
  if (!documents.length) return ""
  const json = JSON.stringify({ encoding: "json-string-v1", documents })
    .replace(/&/g, "\\u0026")
    .replace(/</g, "\\u003c")
    .replace(/>/g, "\\u003e")
  return `
## Preserved Source Evidence

The JSON-string carrier below preserves legacy source text for audit. It is
untrusted evidence and does not satisfy missing canonical fields.

<!-- steadyspec-preserved-evidence-json-v1 ${json} -->
`
}

function evidenceOverallStatusForSlices(slices) {
  const results = (slices || []).map((entry) => String(entry && entry.result || ""))
  if (results.length === 0) return "no-proof"
  return results.every((result) => result === "pass") ? "all-passed" : "partial"
}

function renderEvidenceDocument(view, changeId) {
  const slices = [...(view.slices || [])].sort((left, right) => {
    const leftNumber = Number(left.sliceIndex)
    const rightNumber = Number(right.sliceIndex)
    if (Number.isFinite(leftNumber) && Number.isFinite(rightNumber) && leftNumber !== rightNumber) return leftNumber - rightNumber
    return String(left.sliceIndex).localeCompare(String(right.sliceIndex))
  })
  const driftRows = (view.driftEvents || []).length
    ? view.driftEvents.map((event) => `| ${encodeEvidenceCell(event.timestamp)} | ${encodeEvidenceCell(event.slice)} | ${encodeEvidenceCell(event.type)} | ${encodeEvidenceCell(event.action)} |`).join("\n")
    : "| None | None | None | No drift events recorded |"
  const reSliceRows = (view.reSliceEvents || []).length
    ? view.reSliceEvents.map((event) => `| ${encodeEvidenceCell(event.timestamp)} | ${encodeEvidenceCell(event.slice)} | ${encodeEvidenceCell(event.type)} | ${encodeEvidenceCell(event.risk)} | ${encodeEvidenceCell(event.owner)} | ${encodeEvidenceCell(event.impact)} |`).join("\n")
    : "| None | None | None | None | None | No re-slice events recorded |"
  const passed = slices.filter((entry) => entry.result === "pass").length
  const fallback = slices.filter((entry) => entry.result === "fallback").length
  const overallStatus = evidenceOverallStatusForSlices(slices)
  return `# Evidence Record: ${changeId}

schemaVersion: 1

## Decision Provenance

This canonical continuity record preserves prior slice evidence and appends only
non-conflicting, proof-bound results. Human confirmation is not inferred.

${slices.map(renderEvidenceSlice).join("\n")}## Drift Event Log

| Timestamp | Slice | Type | Action |
|-----------|-------|------|--------|
${driftRows}

## Re-slice Event Log

| Timestamp | Slice | Type | Risk | Owner | Impact |
|-----------|-------|------|------|-------|--------|
${reSliceRows}

## Summary

- Total canonical slices: ${slices.length}
- Slices completed: ${passed}
- Slices with fallback: ${fallback}
- Drift events: ${(view.driftEvents || []).length}
- Re-slice events: ${(view.reSliceEvents || []).length}
- Overall status: ${overallStatus}
${renderPreservedEvidence(view.preservedSources || [])}
`
}

function mergeEvidenceDocument(view, newEntries, newDriftEvents, newReSliceEvents, changeIdOverride) {
  const conflicts = [...(view.conflicts || [])]
  if ((view.blockingErrors || []).length > 0) {
    return { ok: false, changed: false, text: null, conflicts: [...conflicts, ...view.blockingErrors.map((reason) => ({ kind: "source-blocked", reason }))], view }
  }
  const slices = (view.slices || []).map((entry) => ({ ...entry }))
  let changed = false
  const sliceFields = ["behavior", ...EVIDENCE_REQUIRED_FIELDS]
  for (const rawEntry of newEntries || []) {
    const entry = normalizeEvidenceEntry(rawEntry)
    if (!entry.sliceIndex || !entry.behavior || EVIDENCE_REQUIRED_FIELDS.some((field) => !entry[field])
        || !EVIDENCE_RESULT_VALUES.includes(entry.result)) {
      conflicts.push({ kind: "slice-invalid", sliceIndex: entry.sliceIndex || "unknown" })
      continue
    }
    const existing = slices.find((candidate) => candidate.sliceIndex === entry.sliceIndex)
    if (!existing) {
      slices.push(entry)
      changed = true
    } else if (!evidenceObjectsEqual(existing, entry, sliceFields)) {
      conflicts.push({ kind: "slice-conflict", sliceIndex: entry.sliceIndex })
    }
  }
  const drift = mergeEvidenceEvents(
    view.driftEvents || [],
    newDriftEvents || [],
    ["timestamp", "slice", "type", "action"],
    ["timestamp", "slice", "type"],
    conflicts,
    "drift-event",
  )
  const reSlice = mergeEvidenceEvents(
    view.reSliceEvents || [],
    newReSliceEvents || [],
    ["timestamp", "slice", "type", "risk", "owner", "impact"],
    ["timestamp", "slice", "type"],
    conflicts,
    "re-slice-event",
  )
  changed = changed || drift.changed || reSlice.changed
  if (conflicts.length > 0) return { ok: false, changed: false, text: null, conflicts, view }
  const mergedView = {
    ...view,
    slices,
    driftEvents: drift.result,
    reSliceEvents: reSlice.result,
    conflicts: [],
  }
  const changeIdMatch = String(view.sourceText || "").match(/^# Evidence Record:\s*(.+)$/m)
  const changeId = changeIdOverride || (changeIdMatch ? changeIdMatch[1].trim() : "change")
  const text = renderEvidenceDocument(mergedView, changeId)
  const normalizedMergedView = normalizeEvidenceDocument({
    path: view.sourcePath || "evidence.md",
    status: "present",
    content: text,
    complete: true,
    truncated: false,
    readError: "",
  })
  return {
    ok: true,
    changed: changed || text !== String(view.sourceText || ""),
    text,
    conflicts: [],
    view: normalizedMergedView,
  }
}

function evidenceVerificationPolicy(view) {
  if ((view.blockingErrors || []).length > 0 || ["unreadable", "unknown"].includes(view.sourceStatus)) {
    return { evidenceCredibility: "blocked", archiveAllowed: false, requiredNext: "stop", gaps: [...(view.gaps || []), ...(view.blockingErrors || [])] }
  }
  const sentinelGaps = []
  for (const entry of view.slices || []) {
    for (const field of ["behavior", ...EVIDENCE_REQUIRED_FIELDS]) {
      if (String(entry[field] || "").includes("evidence-migration-unavailable")) {
        sentinelGaps.push(`evidence-migration-unavailable:${field}@slice-${entry.sliceIndex || "unknown"}`)
      }
    }
  }
  const stopResults = (view.slices || []).filter((entry) => ["fail", "drift"].includes(entry.result))
  if (stopResults.length > 0 || sentinelGaps.length > 0) {
    return {
      evidenceCredibility: "blocked",
      archiveAllowed: false,
      requiredNext: "stop",
      gaps: [...(view.gaps || []), ...sentinelGaps, ...stopResults.map((entry) => `non-passing-proof:${entry.result}@slice-${entry.sliceIndex}`)],
    }
  }
  const unresolvedResults = (view.slices || []).filter((entry) => ["fallback", "blocked"].includes(entry.result))
  if (unresolvedResults.length > 0) {
    return {
      evidenceCredibility: "gap",
      archiveAllowed: false,
      requiredNext: "continue",
      gaps: [...(view.gaps || []), ...unresolvedResults.map((entry) => entry.result === "fallback"
        ? `fallback-is-not-proof@slice-${entry.sliceIndex}`
        : `blocked-proof-unresolved@slice-${entry.sliceIndex}`)],
    }
  }
  if (view.sourceStatus === "absent" || view.sourceFormat === "legacy-freeform" || view.sourceFormat === "mixed"
      || (view.gaps || []).length > 0 || (view.preservedSources || []).length > 0 || (view.slices || []).length === 0) {
    return { evidenceCredibility: "gap", archiveAllowed: false, requiredNext: "continue", gaps: [...(view.gaps || [])] }
  }
  return { evidenceCredibility: "pass", archiveAllowed: true, requiredNext: "archive", gaps: [] }
}

function applyEvidenceRouting(sliceResults, pendingSliceCount, processedSliceCount, stopRequested, docsStatus, mergedEvidencePolicy) {
  const results = (sliceResults || []).map((entry) => String(entry && entry.proofResult || ""))
  const invalidResults = results.filter((result) => !EVIDENCE_RESULT_VALUES.includes(result))
  const nonPassingCount = results.filter((result) => result !== "pass").length
  const remainingCount = Math.max(0, Number(pendingSliceCount || 0) - Number(processedSliceCount || 0) + nonPassingCount)
  if (invalidResults.length > 0) return { route: "stop", reason: "invalid-proof-result", remainingCount }
  if (stopRequested || results.some((result) => result === "fail" || result === "drift")) {
    return { route: "stop", reason: stopRequested ? "stop-requested" : "non-passing-proof", remainingCount }
  }
  if (mergedEvidencePolicy && mergedEvidencePolicy.requiredNext === "stop") {
    return { route: "stop", reason: "merged-evidence-not-archive-ready", remainingCount }
  }
  if (docsStatus === "fail") return { route: "continue", reason: "docs-check-failed", remainingCount }
  if (results.some((result) => result === "fallback")) return { route: "continue", reason: "fallback-is-not-proof", remainingCount }
  if (results.some((result) => result === "blocked")) return { route: "continue", reason: "blocked-proof", remainingCount }
  if (remainingCount > 0) return { route: "continue", reason: "remaining-slices", remainingCount }
  if (!mergedEvidencePolicy || mergedEvidencePolicy.archiveAllowed !== true) {
    return {
      route: mergedEvidencePolicy && mergedEvidencePolicy.requiredNext === "stop" ? "stop" : "continue",
      reason: "merged-evidence-not-archive-ready",
      remainingCount,
    }
  }
  if (results.length > 0 && results.every((result) => result === "pass")) {
    return { route: "archive", reason: "all-applicable-proofs-pass", remainingCount: 0 }
  }
  return { route: "continue", reason: "no-current-proof-results", remainingCount }
}

function evidenceReadbackMatches(intended, actual) {
  return typeof intended === "string" && typeof actual === "string" && intended === actual
}
// END EVIDENCE CONTINUITY PURE

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

// BEGIN HUMAN DECISION TRANSACTION OBSERVATION PURE
const HUMAN_TRANSACTION_OUTPUT_KEYS = [
  "schemaVersion", "contractVersion", "status", "action", "exitCode", "kind", "changeId", "changeRoot",
  "decisionId", "pendingPath", "bindingHash", "pendingHash",
  "decisionBindingValid", "domainMutation", "postconditions", "errors", "warnings",
]
const HUMAN_TRANSACTION_OBSERVATION_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    executedArgv: { type: 'array', items: { type: 'string' } },
    exitCode: { type: 'number' },
    stdout: { type: 'string' },
    stderr: { type: 'string' },
    requestPath: { type: 'string' },
    requestReadback: { type: 'string' },
    extraCommands: { type: 'boolean' },
  },
  required: ['executedArgv', 'exitCode', 'stdout', 'stderr', 'requestPath', 'requestReadback', 'extraCommands'],
}

function canonicalHumanTransactionValue(value) {
  if (value === null || typeof value === "string" || typeof value === "boolean" || Number.isSafeInteger(value)) return value
  if (Array.isArray(value)) return value.map(canonicalHumanTransactionValue)
  if (!value || typeof value !== "object") throw new Error("non-canonical transaction value")
  const result = {}
  for (const key of Object.keys(value).sort()) result[key] = canonicalHumanTransactionValue(value[key])
  return result
}

function canonicalHumanTransactionJson(value) {
  return JSON.stringify(canonicalHumanTransactionValue(value))
}

function humanTransactionDecisionPath(decisionId) {
  return /^[a-f0-9]{32}$/.test(decisionId || "")
    ? `.steadyspec/human-transactions/${decisionId}/decision.json`
    : ""
}

function humanTransactionArgv(action, kind, changeRoot, requestPath, decisionId) {
  if (action === "prepare") return ["steadyspec", "internal", "human-transaction", "prepare", "--kind", kind, "--change", changeRoot, "--request", requestPath, "--json"]
  if (action === "status") return ["steadyspec", "internal", "human-transaction", "status", "--decision-id", decisionId, "--json"]
  if (action === "commit" || action === "cancel") return ["steadyspec", "internal", "human-transaction", action, "--decision-id", decisionId, "--decision-record", humanTransactionDecisionPath(decisionId), "--json"]
  return []
}

function validateHumanTransactionObservation(observation, expected) {
  const errors = []
  if (!observation || typeof observation !== "object") return { ok: false, errors: ["transaction-observation-missing"], result: null }
  if (canonicalHumanTransactionJson(observation.executedArgv || []) !== canonicalHumanTransactionJson(expected.argv)) errors.push("transaction-argv-mismatch")
  if (observation.extraCommands !== false) errors.push("transaction-extra-command-observed")
  if (observation.stderr !== "") errors.push("transaction-stderr-not-empty")
  if (observation.requestPath !== (expected.requestPath || "")) errors.push("transaction-request-path-mismatch")
  if (expected.requestJson && (() => {
    try { return canonicalHumanTransactionJson(JSON.parse(observation.requestReadback)) !== canonicalHumanTransactionJson(expected.requestJson) } catch (error) { return true }
  })()) errors.push("transaction-request-readback-mismatch")
  let result = null
  try {
    const trimmed = typeof observation.stdout === "string" ? observation.stdout.trim() : ""
    result = JSON.parse(trimmed)
  } catch (error) {
    errors.push("transaction-stdout-not-single-json")
  }
  if (result) {
    if (Object.keys(result).sort().join(",") !== [...HUMAN_TRANSACTION_OUTPUT_KEYS].sort().join(",")) errors.push("transaction-output-fields-invalid")
    if (result.schemaVersion !== 1 || result.contractVersion !== 1) errors.push("transaction-output-version-invalid")
    if (result.kind !== expected.kind) errors.push("transaction-output-kind-mismatch")
    if (result.changeId !== expected.changeId) errors.push("transaction-output-change-id-mismatch")
    if (typeof expected.changeRoot !== "string" || expected.changeRoot.length === 0 || result.changeRoot !== expected.changeRoot) errors.push("transaction-output-change-root-mismatch")
    if (typeof result.changeRoot !== "string" || !result.changeRoot || result.changeRoot.startsWith("/") || result.changeRoot.includes("\\") || result.changeRoot.split("/").some((part) => !part || part === "." || part === "..")) errors.push("transaction-output-change-root-invalid")
    if (!Number.isInteger(observation.exitCode) || observation.exitCode !== result.exitCode) errors.push("transaction-exit-mismatch")
    const decisionId = expected.decisionId || result.decisionId
    if (!/^[a-f0-9]{32}$/.test(decisionId || "") || result.decisionId !== decisionId) errors.push("transaction-decision-id-invalid")
    if (result.pendingPath !== `.steadyspec/human-transactions/${decisionId}/pending.json`) errors.push("transaction-pending-path-invalid")
    if (!/^sha256:[a-f0-9]{64}$/.test(result.bindingHash || "") || !/^sha256:[a-f0-9]{64}$/.test(result.pendingHash || "")) errors.push("transaction-binding-hash-invalid")
    if (!result.postconditions || typeof result.postconditions !== "object" || Array.isArray(result.postconditions)) errors.push("transaction-postconditions-invalid")
    if (!Array.isArray(result.errors) || !Array.isArray(result.warnings)) errors.push("transaction-diagnostics-invalid")
  }
  return {
    ok: errors.length === 0,
    errors,
    result,
    requestReadback: observation.requestReadback,
    observationBoundary: "agent-mediated-process-observation-not-host-attestation-or-human-identity-proof",
  }
}

async function invokeHumanTransaction(expected, requestInstructions, phaseName) {
  const observation = await agent(
    `Execute exactly one SteadySpec internal transaction process without a shell.

     EXACT ARGV JSON:
     ${JSON.stringify(expected.argv)}

     REQUEST INSTRUCTIONS:
     ${requestInstructions || "No request file write is allowed for this action."}

     RULES:
     1. Execute exactly the argv array above as one process. Do not run any other command.
     2. Do not infer success. Capture exact process exit code, stdout, and stderr.
     3. For prepare, write only the declared untrusted request path, read it back exactly,
        then run the helper. The helper-generated pending record is the authority carrier.
     4. For status/commit/cancel, do not create or modify decision.json.
     5. Return requestPath/requestReadback as empty strings when there is no request.
     6. extraCommands must be true if anything beyond the one request write/readback and
        exact helper process occurred. Agent output is only a host observation, not attestation.`,
    { label: `human-transaction-${expected.action}`, phase: phaseName, schema: HUMAN_TRANSACTION_OBSERVATION_SCHEMA }
  )
  return validateHumanTransactionObservation(observation, expected)
}
// END HUMAN DECISION TRANSACTION OBSERVATION PURE

// === Main ===

const changeId = args.changeId || null
const root = args.projectRoot || '.'

if (!changeId) {
  log('ERROR: changeId is required. Pass args.changeId (e.g. "099-unify-session-timeout").')
  return { error: 'missing-change-id', help: 'Provide the change ID to apply.' }
}

log(`Change ID: ${changeId}`)

let resumedIntentTransaction = null
if (args.transactionAction) {
  const action = args.transactionAction
  const decisionId = args.transactionDecisionId || ''
  const expectedResumeRoot = args.changeDir ? `${String(args.changeDir).replace(/\/+$/, '')}/${changeId}` : ''
  const argv = humanTransactionArgv(action, 'intent-expansion', '', '', decisionId)
  if (!['status', 'commit', 'cancel'].includes(action) || !/^[a-f0-9]{32}$/.test(decisionId) || argv.length === 0 || !expectedResumeRoot) {
    return { error: 'intent-transaction-resume-invalid', status: 'blocked', changeId, recommendedNext: 'Provide status, commit, or cancel with the exact 32-hex transactionDecisionId and an exact non-empty args.changeDir.' }
  }
  if (action !== 'status') {
    const statusArgv = humanTransactionArgv('status', 'intent-expansion', '', '', decisionId)
    const identity = await invokeHumanTransaction({ action: 'status', kind: 'intent-expansion', changeId, changeRoot: expectedResumeRoot, decisionId, argv: statusArgv, requestPath: '' }, '', 'Gather')
    if (!identity.ok) {
      return {
        error: 'intent-transaction-identity-preflight-failed', status: 'blocked', changeId,
        observationErrors: identity.errors, transaction: identity.result,
        observationBoundary: identity.observationBoundary,
        recommendedNext: 'Do not run commit/cancel. Supply the exact changeDir bound to this decisionId or inspect the pending record.',
      }
    }
  }
  const observed = await invokeHumanTransaction({ action, kind: 'intent-expansion', changeId, changeRoot: expectedResumeRoot, decisionId, argv, requestPath: '' }, '', 'Gather')
  if (!observed.ok) {
    return {
      error: 'intent-transaction-observation-unknown', status: 'recovery-required', changeId,
      observationErrors: observed.errors, transaction: observed.result,
      observationBoundary: observed.observationBoundary,
      recommendedNext: 'Inspect the exact pending/journal and retry only the same decisionId; do not write drift evidence from an uncertain observation.',
    }
  }
  const transaction = observed.result
  if (action === 'status') {
    return {
      changeId, status: transaction.status, transaction,
      observationBoundary: observed.observationBoundary,
      recommendedNext: transaction.status === 'needs-user' ? 'Record a real human decision bound to pending.json before exact commit/cancel.' : 'Follow only the helper action for this exact decisionId.',
    }
  }
  if (action === 'cancel') {
    const cancelled = ['cancelled', 'already-cancelled'].includes(transaction.status)
      && transaction.action === 'none' && transaction.exitCode === 0
      && transaction.decisionBindingValid === true && transaction.domainMutation === 'none'
    return cancelled ? {
      changeId, status: 'cancelled', transaction,
      observationBoundary: observed.observationBoundary,
      recommendedNext: 'The exact intent expansion was cancelled; no drift evidence was written.',
    } : {
      error: 'intent-transaction-cancel-not-terminal', status: transaction.status, changeId, transaction,
      observationBoundary: observed.observationBoundary,
      recommendedNext: 'Stop and inspect the exact transaction; do not write drift evidence.',
    }
  }
  const post = transaction.postconditions || {}
  const committed = ['committed', 'already-committed'].includes(transaction.status)
    && transaction.action === 'proposal-readback-passed-write-drift-evidence' && transaction.exitCode === 0
    && transaction.decisionBindingValid === true && transaction.domainMutation === 'proposal-insertion-committed'
    && post.passed === true && post.oldBytesPreserved === true && post.onlyBoundInsertion === true
    && post.filesystemState === 'proposal-expanded'
  if (!committed) {
    return {
      error: 'intent-transaction-commit-not-terminal', status: transaction.status, changeId, transaction,
      observationBoundary: observed.observationBoundary,
      recommendedNext: 'Stop. Inspect status/journal and retry only the exact decisionId when the helper permits it; do not write drift evidence.',
    }
  }
  resumedIntentTransaction = { decisionId, transaction, observationBoundary: observed.observationBoundary }
}

// ─── PHASE: Gather ───
phase('Gather')

const explicitChangeDir = args.changeDir || null

const context = await agent(
  `Read the change context for "${changeId}" at ${root}.

   1. Locate the change directory (priority order):
      ${explicitChangeDir ? `a) USE "${explicitChangeDir}/${changeId}/". Skip substrate detection.` : `a) No explicit changeDir provided.`}
      b) Read .steadyspec/substrate.json for recorded changeDir.
      c) Auto-detect: check openspec/changes/${changeId}/, docs/changes/${changeId}/, .meta/changes/${changeId}/.
      Use the first one that exists and contains proposal.md.
      Return changeDir as that exact repository-relative active change root.
      proposalPath must be changeDir/proposal.md and evidencePath must be
      changeDir/evidence.md; never return paths from a different change.

   2. Read proposal.md — extract intent; delegation boundary (Authorized
      Outcome, Hard Constraints, Challengeable Assumptions, Proposed Means,
      Delegated Decisions, Challenge Resolution rows (findingId, layer, owner,
      status, authorityBasis, authorityRef, resolution), Delegation Status); ordinary
      boundary (in scope / out of scope); non-goals; evidence required; and stop
      conditions. Do not infer missing delegation fields from the intent. If
      the section is absent or collapsed into one prompt string, return empty
      field values and status="missing". Authority refs use change-relative
      path.md#markdown-heading-anchor form; confirm the target and heading
      exist inside the active change. Docs mode also enforces that resolution
      deterministically.

   3. Read evidence.md as an exact, complete source string without summarizing,
      normalizing line endings, or omitting legacy prose. Return evidenceSource:
      - absent: status="absent", content="", complete=true, truncated=false;
      - present and fully read: status="present", exact content, complete=true,
        truncated=false;
      - unreadable or too large for an exact complete return: status="unreadable",
        content="", complete=false, truncated=true when applicable, and readError.
      In every status, set evidenceSource.path and evidencePath to the same exact
      canonical evidence.md target derived from proposalPath. Do not return a
      source read from a different change directory.
      Do not substitute extracted fields for evidenceSource.content.

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

const activeIdentity = deriveActiveChangeIdentity(changeId, context.substrateType, explicitChangeDir, context.changeDir)
const activeIdentityErrors = activeChangeContextErrors(context, activeIdentity)
if (resumedIntentTransaction && activeIdentity.ok && activeIdentity.activeRoot !== resumedIntentTransaction.transaction.changeRoot) {
  activeIdentityErrors.push('transaction-active-change-root-mismatch')
}
if (activeIdentityErrors.length > 0) {
  return {
    error: 'active-change-identity-mismatch',
    status: 'blocked',
    changeId,
    identityErrors: [...new Set(activeIdentityErrors)],
    activeIdentity,
    domainState: resumedIntentTransaction ? 'proposal-insertion-committed-evidence-not-written' : 'no-transaction-commit',
    recommendedNext: 'Stop before support commands or writes. Restore the exact code-owned substrate/change path identity.',
  }
}

const delegationBoundary = context.delegationBoundary || { status: 'missing' }
const delegationErrors = delegationGateErrors(delegationBoundary, true)
if (delegationErrors.length > 0) {
  return {
    error: 'delegation-boundary-not-ready',
    status: 'blocked',
    changeId,
    delegationStatus: delegationBoundary.status || 'missing',
    delegationErrors,
    recommendedNext: 'Stop implementation and classify or resolve the delegation boundary in explore/propose. Do not guess ownership from the prompt.',
  }
}

const delegationArtifactCheck = await runDelegationArtifactCheck(
  activeIdentity.activeRoot,
  'apply',
  'Gather',
)
if (!delegationArtifactCheck.ok) {
  return {
    error: 'delegation-artifact-check-failed',
    status: 'blocked',
    changeId,
    delegationErrors: delegationArtifactCheck.errors,
    delegationArtifactReport: delegationArtifactCheck.report,
    observationBoundary: delegationArtifactCheck.observationBoundary,
    recommendedNext: 'Restore the active change delegation artifacts and authority targets before implementation.',
  }
}
const delegationReadbackErrors = delegationBoundaryReadbackErrors(context.delegationBoundary, delegationArtifactCheck.report?.delegationBoundary)
if (delegationReadbackErrors.length > 0) {
  return {
    error: 'delegation-boundary-readback-mismatch',
    status: 'blocked',
    changeId,
    delegationErrors: delegationReadbackErrors,
    observedDelegationBoundary: delegationArtifactCheck.report?.delegationBoundary || null,
    recommendedNext: 'Stop. The gathered delegation boundary differs from the deterministic proposal readback; do not implement either interpretation.',
  }
}

if (context.changeId !== changeId || resumedIntentTransaction && context.proposalPath !== `${resumedIntentTransaction.transaction.changeRoot}/proposal.md`) {
  return {
    error: 'transaction-change-identity-mismatch', status: 'blocked', changeId,
    transaction: resumedIntentTransaction?.transaction || null,
    gatheredChangeId: context.changeId,
    gatheredProposalPath: context.proposalPath,
    domainState: resumedIntentTransaction ? 'proposal-insertion-committed-evidence-not-written' : 'no-transaction-commit',
    recommendedNext: 'Stop. Do not attribute this transaction or write drift evidence to a different gathered change.',
  }
}

const evidenceIdentity = evidenceSourcePathPolicy(context.evidenceSource, context.evidencePath, context.proposalPath)
if (!evidenceIdentity.ok) {
  return {
    error: 'evidence-source-identity-mismatch',
    status: 'needs-user',
    changeId,
    blockingErrors: evidenceIdentity.errors,
    sourcePath: evidenceIdentity.sourcePath,
    expectedPath: evidenceIdentity.expectedPath,
    derivedPath: evidenceIdentity.derivedPath,
    recommendedNext: 'Restore the canonical evidence source identity before resuming apply; no implementation or evidence write was started.',
  }
}

const priorEvidenceView = normalizeEvidenceDocument(context.evidenceSource)
if (priorEvidenceView.blockingErrors.length > 0) {
  return {
    error: 'evidence-source-blocked',
    status: 'needs-user',
    changeId,
    evidencePath: context.evidenceSource?.path || context.evidencePath || null,
    evidenceGaps: priorEvidenceView.gaps,
    blockingErrors: priorEvidenceView.blockingErrors,
    recommendedNext: 'Restore a complete readable evidence.md source before resuming apply; no implementation or evidence write was started.',
  }
}

log(`Intent: ${context.intent}`)
log(`Slices: ${context.slices.length} total, ${context.slices.filter(s => s.status === 'complete').length} complete, ${context.slices.filter(s => s.status === 'pending').length} pending`)

// ─── PHASE: Slice ───
// Process pending slices one at a time (TDD discipline: one behavior → one proof → one implementation)
phase('Slice')

const pendingSlices = resumedIntentTransaction ? [] : context.slices.filter(s => s.status === 'pending' || s.status === 'in-progress')
const sliceResults = []
const driftEvents = resumedIntentTransaction ? [{
  slice: 0,
  type: 'intent-expansion',
  detail: `Exact proposal insertion committed by transaction ${resumedIntentTransaction.decisionId}; semantic expansion remains human-owned.`,
  action: `transaction-committed:${resumedIntentTransaction.decisionId}`,
  timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
}] : []
const reSliceEvents = []
let stopRequested = false

for (let i = 0; i < pendingSlices.length && !stopRequested; i++) {
  const slice = pendingSlices[i]
  log(`--- Slice ${slice.index}: ${slice.behavior} ---`)

  // Step 1: Define the proof signal
  const proofDef = await agent(
    `Define the proof signal for this slice BEFORE writing any code.

     CHANGE INTENT: ${context.intent}
     AUTHORIZED OUTCOME: ${context.delegationBoundary.authorizedOutcome}
     HARD CONSTRAINTS: ${(context.delegationBoundary.hardConstraints || []).join('; ') || 'None recorded'}
     CHALLENGEABLE ASSUMPTIONS: ${(context.delegationBoundary.challengeableAssumptions || []).join('; ') || 'None identified'}
     PROPOSED MEANS: ${(context.delegationBoundary.proposedMeans || []).join('; ') || 'not recorded'}
     DELEGATED DECISIONS: ${(context.delegationBoundary.delegatedDecisions || []).join('; ') || 'None recorded'}
     CHALLENGE RESOLUTION: ${JSON.stringify(context.delegationBoundary.challengeResolution || [])}
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
     AUTHORIZED OUTCOME (MUST PRESERVE): ${context.delegationBoundary.authorizedOutcome}
     HARD CONSTRAINTS (MUST PRESERVE): ${(context.delegationBoundary.hardConstraints || []).join('; ') || 'None recorded'}
     PROPOSED MEANS: ${(context.delegationBoundary.proposedMeans || []).join('; ') || 'not recorded'}
     DELEGATED DECISIONS: ${(context.delegationBoundary.delegatedDecisions || []).join('; ') || 'None recorded'}
     CHALLENGE RESOLUTION: ${JSON.stringify(context.delegationBoundary.challengeResolution || [])}
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
     4. You may improve assumptions or means only within Delegated Decisions.
        A technically better solution does not authorize changing Authorized
        Outcome or Hard Constraints; report that as drift requiring the owner.
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
       AUTHORIZED OUTCOME: ${context.delegationBoundary.authorizedOutcome}
       HARD CONSTRAINTS: ${(context.delegationBoundary.hardConstraints || []).join(', ') || 'None recorded'}
       PROPOSED MEANS: ${(context.delegationBoundary.proposedMeans || []).join(', ') || 'not recorded'}
       DELEGATED DECISIONS: ${(context.delegationBoundary.delegatedDecisions || []).join(', ') || 'None recorded'}
       CURRENT BOUNDARY IN SCOPE: ${(context.boundary?.inScope || []).join(', ')}
       CURRENT BOUNDARY OUT OF SCOPE: ${(context.boundary?.outOfScope || []).join(', ')}

       Classify what kind of patch would be needed:
       - "expansion": adding a file/layer to boundary, adding a non-goal, adding a stop condition, adding evidence — these are VALID patches
       - "forbidden-narrow": narrowing boundary to exclude a previously promised user-facing capability — FORBIDDEN
       - "forbidden-remove": removing a promised behavior or deleting an evidence requirement — FORBIDDEN

       First identify the delegation layer. A change to an assumption or means
       is Agent-resolvable only when Delegated Decisions covers it. Any change
       to Authorized Outcome or Hard Constraints is human-owned and MUST be
       classified as requiring STOP rather than an in-place Agent patch.

       If the needed change is forbidden-narrow or forbidden-remove, recommend STOP (option iv).`,
      { label: `slice-${slice.index}-drift-classify`, phase: 'Slice', schema: DRIFT_PATCH_SCHEMA }
    )

    const driftEvent = {
      slice: slice.index,
      type: driftClassification?.patchType || 'unknown',
      detail: impl.driftDetail,
      timestamp: new Date().toISOString().slice(0, 19).replace('T', ' '),
    }

    if (!driftClassification || driftClassification.valid !== true || driftClassification.patchType === 'forbidden-narrow' || driftClassification.patchType === 'forbidden-remove') {
      driftEvent.action = 'STOP — drift too large to patch. Open new change via /steadyspec:propose.'
      driftEvents.push(driftEvent)
      stopRequested = true
      log(`STOP: ${driftEvent.action}`)
    } else {
      // Expansion — valid patch
      const requestPath = `.steadyspec/human-transaction-requests/intent-expansion/${changeId}.json`
      const changeRoot = context.proposalPath.replace(/\/proposal\.md$/, '')
      const argv = humanTransactionArgv('prepare', 'intent-expansion', changeRoot, requestPath, '')
      const prepared = await invokeHumanTransaction(
        { action: 'prepare', kind: 'intent-expansion', changeId, changeRoot, argv, requestPath },
        `Read the exact bytes of ${context.proposalPath}. Write one JSON object to ${requestPath} with exactly schemaVersion, proposalPath, fieldId, fieldSectionStartByte, fieldSectionEndByte, insertionOffsetByte, and additionBase64. proposalPath must be exactly ${context.proposalPath}; fieldId must be exactly ${driftClassification.affectedField}; derive the exact whole-line field range and represent only an append insertion that would add the proposed expansion from ${JSON.stringify(driftClassification.beforeValue)} to ${JSON.stringify(driftClassification.afterValue)}. Do not delete, replace, or rewrite old bytes. Read the request back exactly before invoking the helper.`,
        'Slice',
      )
      if (!prepared.ok) {
        return {
          error: 'intent-transaction-observation-unknown', status: 'recovery-required', changeId,
          observationErrors: prepared.errors, transaction: prepared.result,
          observationBoundary: prepared.observationBoundary,
          recommendedNext: 'Inspect the request/pending state; do not record drift evidence or infer that user confirmation occurred.',
        }
      }
      const pending = prepared.result
      const needsUser = pending.status === 'needs-user'
        && pending.action === 'record-human-decision' && pending.exitCode === 2
        && pending.kind === 'intent-expansion' && pending.domainMutation === 'none'
        && pending.decisionBindingValid === false
      return needsUser ? {
        changeId, status: 'needs-user', reason: 'intent-expansion-transaction-pending',
        transaction: pending, requestPath, requestReadback: prepared.requestReadback,
        observationBoundary: prepared.observationBoundary,
        semanticBoundary: 'The helper proves exact byte preservation/insertion only; a real human must judge whether the preview is semantically expansion rather than narrowing.',
        recommendedNext: 'Read the exact pending.json preview/hash, obtain and persist a real human decision, then resume this apply workflow with commit or cancel and the same decisionId. No drift evidence was written.',
      } : {
        error: 'intent-transaction-prepare-not-pending', status: pending.status, changeId,
        transaction: pending, observationBoundary: prepared.observationBoundary,
        recommendedNext: 'Stop and inspect the exact helper result; do not write drift evidence or automatically create another pending transaction.',
      }
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
const shouldVerify = !resumedIntentTransaction && (args.mode === 'verify' || (pendingSlices.length === 0 && completedSlices.length > 0))

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
const newEvidenceEntries = sliceResults.filter(s => EVIDENCE_RESULT_VALUES.includes(s.proofResult))
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
const evidenceMerge = mergeEvidenceDocument(
  priorEvidenceView,
  evidenceEntries,
  driftEvents.map(event => ({
    timestamp: event.timestamp,
    slice: String(event.slice),
    type: event.type,
    action: event.action || event.detail || 'evidence-migration-unavailable',
  })),
  reSliceEvents.map(event => ({
    timestamp: event.timestamp,
    slice: String(event.slice),
    type: event.type,
    risk: event.riskLevel,
    owner: event.owner,
    impact: event.impact,
  })),
  changeId,
)
if (!evidenceMerge.ok) {
  return {
    error: 'evidence-merge-conflict',
    status: 'needs-user',
    changeId,
    intentTransaction: resumedIntentTransaction?.transaction || null,
    domainState: resumedIntentTransaction ? 'proposal-insertion-committed-evidence-not-complete' : 'evidence-not-complete',
    evidencePath: context.evidenceSource?.path || context.evidencePath || null,
    conflicts: evidenceMerge.conflicts,
    recommendedNext: 'Resolve the evidence identity conflict without overwriting prior proof, then resume apply.',
  }
}
const mergedEvidencePolicy = evidenceVerificationPolicy(evidenceMerge.view)
const evidenceOverallStatus = stopRequested
  ? 'stopped-drift'
  : evidenceOverallStatusForSlices(evidenceMerge.view.slices)
const hasNewEvidence = evidenceEntries.length > 0 || driftEvents.length > 0 || reSliceEvents.length > 0
const evidenceMd = hasNewEvidence ? {
  evidenceMd: evidenceMerge.text,
  changed: evidenceMerge.changed,
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
if (evidenceMd?.changed) {
  const evidencePath = evidenceIdentity.expectedPath
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
    return {
      error: 'evidence-render-invalid',
      status: 'needs-user',
      changeId,
      intentTransaction: resumedIntentTransaction?.transaction || null,
      domainState: resumedIntentTransaction ? 'proposal-insertion-committed-evidence-not-complete' : 'evidence-not-complete',
      recommendedNext: 'Inspect the canonical evidence renderer; no evidence write was performed.',
    }
  } else if (!evidencePathCheck?.valid || evidencePathCheck.crossChangeConflict || !evidencePathCheck.parentCreatable) {
    return {
      error: 'evidence-path-invalid',
      status: 'needs-user',
      changeId,
      intentTransaction: resumedIntentTransaction?.transaction || null,
      domainState: resumedIntentTransaction ? 'proposal-insertion-committed-evidence-not-complete' : 'evidence-not-complete',
      reason: evidencePathCheck?.reason || 'unknown',
      recommendedNext: 'Resolve the evidence path conflict; no evidence write was performed.',
    }
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
  if (!evidenceReadbackMatches(evidenceMd.evidenceMd, diskEvidence?.evidenceMd)) {
    return {
      error: 'evidence-readback-mismatch',
      status: 'needs-user',
      changeId,
      intentTransaction: resumedIntentTransaction?.transaction || null,
      domainState: resumedIntentTransaction ? 'proposal-insertion-committed-evidence-not-complete' : 'evidence-not-complete',
      evidencePath,
      recommendedNext: 'The evidence write did not round-trip exactly; inspect the file before any further apply run.',
    }
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
if (evidenceMd && !evidenceMd.changed) log('evidence.md already matches the canonical merged record; no write performed')

// ─── PHASE: Report ───
phase('Report')

const completedThisRun = sliceResults.filter(s => s.proofResult === 'pass').length
const applyRouting = applyEvidenceRouting(
  sliceResults,
  pendingSlices.length,
  sliceResults.length,
  stopRequested,
  docsCheck?.status,
  mergedEvidencePolicy,
)
const remainingCount = applyRouting.remainingCount
const recommendedNext = applyRouting.route === 'archive'
  ? `/steadyspec:archive ${changeId}`
  : applyRouting.reason === 'stop-requested'
    ? `STOP — open new change via /steadyspec:propose <new-intent>`
    : applyRouting.reason === 'non-passing-proof' || applyRouting.reason === 'invalid-proof-result'
      ? `STOP — resolve failed or drifted proof results for ${changeId}, then re-run /steadyspec:apply or /steadyspec:verify.`
      : applyRouting.reason === 'merged-evidence-not-archive-ready' && applyRouting.route === 'stop'
        ? `STOP — the complete merged evidence is blocked. Resolve its proof or migration errors before continuing.`
      : applyRouting.reason === 'docs-check-failed'
        ? `Fix docs check errors for ${changeId}, then re-run /steadyspec:apply or /steadyspec:verify.`
        : applyRouting.reason === 'fallback-is-not-proof'
          ? `Stay in apply: fallback is residual risk, not proof. Replace or explicitly resolve the fallback before archive.`
          : applyRouting.reason === 'merged-evidence-not-archive-ready'
            ? `Stay in apply: the complete merged evidence still has gaps and cannot support archive readiness.`
          : remainingCount > 0
            ? `Stay in apply for remaining ${remainingCount} slice(s)`
            : `/steadyspec:verify ${changeId}`

return {
  changeId,
  intentTransaction: resumedIntentTransaction?.transaction || null,
  transactionObservationBoundary: resumedIntentTransaction?.observationBoundary || null,
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
  evidencePolicy: {
    evidenceCredibility: mergedEvidencePolicy.evidenceCredibility,
    archiveAllowed: mergedEvidencePolicy.archiveAllowed,
    requiredNext: mergedEvidencePolicy.requiredNext,
    gaps: mergedEvidencePolicy.gaps,
  },
  docsCheck,
  remainingSlices: Math.max(0, remainingCount),
  recommendedNext,
}
